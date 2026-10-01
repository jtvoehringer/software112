'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getCtx() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Kein Mandant')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return { supabase, tenantId: membership.tenantId, role: membership.role }
}

// ── Konto anlegen (nur Admin – Kontenstruktur ist administrativ) ─────────────

export async function createKonto(formData: FormData) {
  const { supabase, tenantId, role } = await getCtx()
  if (!canAdmin(role)) return { error: 'Keine Berechtigung – nur Admins dürfen Konten anlegen.' }

  const name             = formData.get('name') as string
  const typ              = formData.get('typ') as string
  const iban             = (formData.get('iban') as string) || null
  const eroeffnungsdatum = formData.get('eroeffnungsdatum') as string
  const eroeffnungssaldo = parseFloat(dezimal((formData.get('eroeffnungssaldo') as string || '0'))) || 0

  if (!name || !eroeffnungsdatum) return { error: 'Pflichtfelder fehlen' }

  const { error } = await (supabase.from('konten') as any).insert({
    tenant_id: tenantId, name, typ: typ || 'giro', iban,
    eroeffnungsdatum, eroeffnungssaldo,
  })

  if (error) return { error: (error as R).message }
  revalidatePath('/konten')
  return { ok: true }
}

// ── Konto deaktivieren (kein Hard-Delete – Historie bleibt erhalten) ────────

export async function deaktiviereKonto(id: string) {
  const { supabase, tenantId, role } = await getCtx()
  if (!canAdmin(role)) return { error: 'Keine Berechtigung.' }

  const { error } = await (supabase.from('konten') as any)
    .update({ aktiv: false })
    .eq('id', id).eq('tenant_id', tenantId)

  if (error) return { error: (error as R).message }
  revalidatePath('/konten')
  return { ok: true }
}

// ── Umbuchung zwischen zwei Konten erfassen ──────────────────────────────────

export async function createUmbuchung(formData: FormData) {
  const { supabase, tenantId, role } = await getCtx()
  if (!canWrite(role, 'ea')) return { error: 'Keine Berechtigung.' }

  const vonKontoId  = formData.get('von_konto_id') as string
  const nachKontoId = formData.get('nach_konto_id') as string
  const betrag      = parseFloat(dezimal((formData.get('betrag') as string || '')))
  const datum       = (formData.get('datum') as string) || new Date().toISOString().slice(0, 10)
  const beschreibung = (formData.get('beschreibung') as string) || null

  if (!vonKontoId || !nachKontoId) return { error: 'Bitte beide Konten wählen.' }
  if (vonKontoId === nachKontoId) return { error: 'Von- und Nach-Konto müssen unterschiedlich sein.' }
  if (isNaN(betrag) || betrag <= 0) return { error: 'Ungültiger Betrag.' }

  const { error } = await (supabase.from('konto_umbuchungen') as any).insert({
    tenant_id: tenantId, von_konto_id: vonKontoId, nach_konto_id: nachKontoId,
    betrag, datum, beschreibung,
  })

  if (error) return { error: (error as R).message }
  revalidatePath(`/konten/${vonKontoId}/abstimmung`)
  revalidatePath(`/konten/${nachKontoId}/abstimmung`)
  revalidatePath('/konten')
  return { ok: true }
}

// ── Umbuchung löschen (nur Admin – entfernt beide Seiten in einem Schritt) ──

// Umbuchung stornieren statt löschen (KAN-149 D2b): bleibt mit Datum, Benutzer und Grund auf beiden Konten stehen, das
// Kassabuch und die Abstimmung zeigen am Storno-Tag die Gegenzeile. Rechte und Grund prüft die RPC (E&A-Schreibrecht).
export async function stornoUmbuchung(id: string, vonKontoId: string, nachKontoId: string, grund: string) {
  const fehler = stornoGrundFehler(grund)
  if (fehler) return { error: fehler }
  const { supabase, tenantId } = await getCtx()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_umbuchung_stornieren', { p_tenant_id: tenantId, p_id: id, p_grund: grund.trim() })

  if (error) return { error: dbFehlerText(error, 'Umbuchung konnte nicht storniert werden') }
  revalidatePath(`/konten/${vonKontoId}/abstimmung`)
  revalidatePath(`/konten/${nachKontoId}/abstimmung`)
  return { ok: true }
}

// ── Abgeglichen-Häkchen setzen/entfernen ─────────────────────────────────────
//
// Bewusst unabhängig von is_locked (Monatsabschluss/UVA-Sperre) – siehe
// Kommentar bei setze_kontobewegung_abgeglichen in Migration 163.
export async function setzeAbgeglichen(
  kontoId: string,
  quelle: 'zahlung' | 'ea_transaktion' | 'umbuchung_von' | 'umbuchung_nach',
  id: string,
  abgeglichen: boolean
) {
  const { supabase, tenantId, role } = await getCtx()
  if (!canWrite(role, 'ea')) return { error: 'Keine Berechtigung.' }

  const { error } = await (supabase.rpc as any)('setze_kontobewegung_abgeglichen', {
    p_tenant_id: tenantId, p_quelle: quelle, p_id: id, p_abgeglichen: abgeglichen,
  })

  if (error) return { error: (error as R).message }
  revalidatePath(`/konten/${kontoId}/abstimmung`)
  return { ok: true }
}
