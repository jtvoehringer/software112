'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { zahlAus } from '@/lib/format'
import { alle } from '@/lib/supabase/alle'
import { wienHeute } from '@/lib/csv'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { istProduktArt, lagerstand, produktBuchungFehler, type ProduktBewegung } from '@/lib/warenwirtschaft/sonstigeProdukte'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  // KAN-242: wie RLS (modul_* auf sonstige_artikel) und die RPCs s112_artikel_buchen/_bewegung_stornieren = Warenwirtschaft
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Berechtigung für Produkte – dafür ist die Freigabe Warenwirtschaft nötig.')
  return membership.tenantId
}

export async function upsertSonstigesArtikel(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const id           = (formData.get('id')           as string).trim() || null
  const name         = (formData.get('name')         as string).trim()
  const einheit      = (formData.get('einheit')      as string).trim() || 'Stk'
  const defaultPreis = zahlAus(formData.get('default_preis'))

  if (!name) throw new AktionsFehler('Name darf nicht leer sein')

  if (id) {
    const { data: geaendert, error } = await (supabase.from('sonstige_artikel') as any)
      .update({ name, einheit, default_preis: defaultPreis })
      .eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler((error as AR).message)
    if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
  } else {
    const { error } = await (supabase.from('sonstige_artikel') as any)
      .insert({ tenant_id: tenantId, name, einheit, default_preis: defaultPreis })
    if (error) throw new AktionsFehler((error as AR).message)
  }

  revalidatePath('/weinhandel/sonstige-artikel')
}

export async function toggleAktivSonstigesArtikel(id: string, aktiv: boolean) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { data: geaendert, error } = await (supabase.from('sonstige_artikel') as any)
    .update({ aktiv })
    .eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler((error as AR).message)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
  revalidatePath('/weinhandel/sonstige-artikel')
}

export async function deleteSonstigesArtikel(id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    // KAN-115: Produkte mit Lagerbewegungen oder Verkaufspositionen (sonstige_artikel_id) lassen sich nicht löschen –
    // die Datenbank lehnt ab (FK), dann deaktivieren statt löschen.
    const { data, error } = await (supabase.from('sonstige_artikel') as any)
      .delete()
      .eq('id', id).eq('tenant_id', tenantId)
      .select('id')
    if (error) {
      if ((error as AR).code === '23503') return { error: 'Das Produkt hat Lagerbewegungen oder Verkäufe und kann nicht gelöscht werden – bitte deaktivieren.' }
      return { error: (error as AR).message }
    }
    // KAN-242: RLS filtert still (0 Zeilen) – vorher meldete die Seite „gelöscht“, das Produkt blieb aber stehen
    if (((data ?? []) as unknown[]).length !== 1) return { error: 'Das Produkt wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte deaktivieren.' }
    revalidatePath('/weinhandel/sonstige-artikel')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen' }
  }
}

// ── KAN-115: Lagerstand Sonstiger Produkte (Traubensaft, Essig, Destillat …) ──────────────────────────────────────
// Einstellungen am Produkt per Update; Bewegungen nur über die RPCs (append-only, Rechte prüft die Datenbank erneut).

export async function produktEinstellungenSpeichern(formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const id = String(formData.get('id') ?? '').trim()
    const artRoh = String(formData.get('art') ?? '').trim()
    if (artRoh && !istProduktArt(artRoh)) return { error: 'Unbekannte Produktart.' }
    const literRoh = String(formData.get('liter_je_stk') ?? '').trim()
    const liter = literRoh ? zahlAus(literRoh) : null
    if (literRoh && !(liter !== null && liter > 0)) return { error: 'Liter je Stück bitte als Zahl größer als 0 angeben (z. B. 1 oder 0,75).' }
    const { data: geaendert, error } = await (supabase.from('sonstige_artikel') as unknown as AR)
      .update({ art: artRoh || null, bestand_fuehren: formData.get('bestand_fuehren') === 'on' || formData.get('bestand_fuehren') === 'true', liter_je_stk: liter })
      .eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) return { error: dbFehlerText(error, 'Speichern fehlgeschlagen') }
    if (!(geaendert as unknown[] | null)?.length) return { error: NICHT_GESPEICHERT }   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
    revalidatePath('/weinhandel/sonstige-artikel')
    revalidatePath(`/weinhandel/sonstige-artikel/${id}`)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Speichern' }
  }
}

export async function produktBuchen(formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const id = String(formData.get('artikel_id') ?? '').trim()
    const art = String(formData.get('art') ?? '')
    const datum = String(formData.get('datum') ?? '').slice(0, 10)
    const menge = zahlAus(formData.get('menge'))
    const notizen = String(formData.get('notizen') ?? '').trim() || null
    const { data: bew, error: bErr } = await alle<AR>((supabase.from('sonstige_artikel_bewegungen') as unknown as AR)
      .select('id, menge').eq('tenant_id', tenantId).eq('artikel_id', id).order('id'))
    if (bErr) return { error: dbFehlerText(bErr, 'Lagerstand konnte nicht geladen werden') }
    const fehler = produktBuchungFehler({ art, menge, datum, heute: wienHeute(), bestand: lagerstand((bew ?? []) as ProduktBewegung[]) })
    if (fehler) return { error: fehler }
    const { error } = await (supabase.rpc as unknown as (fn: string, args: AR) => Promise<{ error: AR | null }>)('s112_artikel_buchen', {
      p_tenant_id: tenantId, p_artikel_id: id, p_datum: datum, p_art: art, p_menge: menge, p_notizen: notizen,
    })
    if (error) return { error: dbFehlerText(error, 'Buchung fehlgeschlagen') }
    revalidatePath(`/weinhandel/sonstige-artikel/${id}`)
    revalidatePath('/weinhandel/sonstige-artikel')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Buchen' }
  }
}

export async function produktBuchungStornieren(bewegungId: string, artikelId: string, grund: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const grundFehler = stornoGrundFehler(grund)
    if (grundFehler) return { error: grundFehler }
    const { error } = await (supabase.rpc as unknown as (fn: string, args: AR) => Promise<{ error: AR | null }>)('s112_artikel_bewegung_stornieren', {
      p_tenant_id: tenantId, p_id: bewegungId, p_grund: grund.trim(),
    })
    if (error) return { error: dbFehlerText(error, 'Storno fehlgeschlagen') }
    revalidatePath(`/weinhandel/sonstige-artikel/${artikelId}`)
    revalidatePath('/weinhandel/sonstige-artikel')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Stornieren' }
  }
}
