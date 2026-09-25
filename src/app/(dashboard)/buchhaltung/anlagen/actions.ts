'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import type { AfaMethode } from '@/lib/ea/anlagen'
import { AktionsFehler } from '@/lib/fehler'

// ── Anlagenverzeichnis: Server-Aktionen (Migration 200) ──────────────────────
// Schreiben dürfen Betriebsleiter und Winzer (RLS ea_anlagen_write). Die
// AfA-Buchung läuft über ea_transaktionen mit anlage_id und respektiert wie
// jede Buchung Monatsabschluss/UVA-Sperre (pruefe_ea_zeitraum_offen).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type AnlageEingabe = {
  id?: string
  name: string
  gruppe: string | null
  konto_nr: number | null
  anschaffung_am: string
  ak_netto: number
  nutzungsdauer_jahre: number
  methode: AfaMethode
  degressiv_satz: number | null
  restwert: number
  abgang_am: string | null
  veraeusserungserloes: number | null
  transaktion_id: string | null
  notizen: string | null
}

async function ctx() {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Kein Mandant')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb? (AfA → E&A-Journal)
  if (!canWrite(membership.role, 'ea')) throw new AktionsFehler('Keine Berechtigung')
  const supabase = await createSupabaseServerClient()
  return { supabase, tenantId: membership.tenantId }
}

const pfade = () => { revalidatePath('/buchhaltung/anlagen'); revalidatePath('/buchhaltung'); revalidatePath('/buchhaltung/uebersicht') }

export async function speichereAnlage(a: AnlageEingabe): Promise<{ ok: true; id: string } | { ok: false; fehler: string }> {
  const { supabase, tenantId } = await ctx()
  if (!a.name.trim()) return { ok: false, fehler: 'Bezeichnung ist ein Pflichtfeld.' }
  if (!a.anschaffung_am) return { ok: false, fehler: 'Anschaffungsdatum fehlt.' }
  if (!(a.ak_netto > 0)) return { ok: false, fehler: 'Anschaffungskosten müssen größer als 0 sein.' }
  if (a.methode !== 'gwg' && !(a.nutzungsdauer_jahre >= 1)) return { ok: false, fehler: 'Nutzungsdauer in Jahren angeben.' }
  if (a.methode === 'gwg' && a.ak_netto > 1000) return { ok: false, fehler: 'Geringwertige Wirtschaftsgüter sind bis 1.000 € netto möglich.' }
  if (a.abgang_am && a.abgang_am < a.anschaffung_am) return { ok: false, fehler: 'Der Abgang kann nicht vor der Anschaffung liegen.' }
  if (a.restwert < 0 || a.restwert > a.ak_netto) return { ok: false, fehler: 'Der Restwert muss zwischen 0 und den Anschaffungskosten liegen.' }

  const payload = {
    tenant_id: tenantId,
    name: a.name.trim(),
    gruppe: a.gruppe?.trim() || null,
    konto_nr: a.konto_nr ?? null,
    anschaffung_am: a.anschaffung_am,
    ak_netto: Math.round(a.ak_netto * 100) / 100,
    nutzungsdauer_jahre: a.methode === 'gwg' ? 1 : Math.round(a.nutzungsdauer_jahre),
    methode: a.methode,
    degressiv_satz: a.methode === 'degressiv' ? Math.min(30, Math.max(0.5, a.degressiv_satz || 30)) : null,
    restwert: Math.round((a.restwert || 0) * 100) / 100,
    abgang_am: a.abgang_am || null,
    veraeusserungserloes: a.abgang_am ? Math.round((a.veraeusserungserloes || 0) * 100) / 100 : null,
    transaktion_id: a.transaktion_id || null,
    notizen: a.notizen?.trim() || null,
  }
  if (a.id) {
    const { error } = await (supabase.from('ea_anlagen') as any).update(payload).eq('id', a.id).eq('tenant_id', tenantId)
    if (error) return { ok: false, fehler: (error as R).message }
    pfade()
    return { ok: true, id: a.id }
  }
  const { data, error } = await (supabase.from('ea_anlagen') as any).insert(payload).select('id').single()
  if (error) return { ok: false, fehler: (error as R).message }
  pfade()
  return { ok: true, id: (data as R).id }
}

export async function loescheAnlage(id: string): Promise<{ ok: boolean; fehler?: string }> {
  const { supabase, tenantId } = await ctx()
  const { data: afa } = await (supabase.from('ea_transaktionen') as any).select('datum').eq('anlage_id', id).eq('tenant_id', tenantId)
  if (afa && afa.length > 0) {
    const jahre = [...new Set((afa as R[]).map(t => String(t.datum).slice(0, 4)))].sort().join(', ')
    return { ok: false, fehler: `Für diese Anlage ist die AfA ${jahre} gebucht. Bitte zuerst im Anlagenverzeichnis die AfA-Buchungen zurücknehmen.` }
  }
  const { error } = await (supabase.from('ea_anlagen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) return { ok: false, fehler: (error as R).message }
  pfade()
  return { ok: true }
}

/**
 * AfA eines Jahres buchen: je Anlage eine Ausgabe „Abschreibung (AfA)“ per
 * 31.12., 0 % USt, ohne Zahlungskonto. Abweichende/überflüssige Buchungen
 * werden vorher entfernt. Sperre über pruefe_ea_zeitraum_offen (Dezember).
 */
export async function bucheAfa(jahr: number, zeilen: { anlageId: string; name: string; soll: number; buchungId: string | null }[]): Promise<{ ok: boolean; fehler?: string; gebucht?: number }> {
  const { supabase, tenantId } = await ctx()
  const stichtag = `${jahr}-12-31`
  const { data: pruefRaw } = await (supabase.rpc as any)('pruefe_ea_zeitraum_offen', { p_tenant_id: tenantId, p_datum: stichtag })
  const pruef = Array.isArray(pruefRaw) ? pruefRaw[0] : pruefRaw
  if (pruef && pruef.offen === false) return { ok: false, fehler: pruef.grund ?? `Dezember ${jahr} ist abgeschlossen.` }

  // tenant-isolation-ignore: Systemkategorie (tenant_id IS NULL) – gilt bewusst für alle Mandanten, kein Mandantendatum
  const { data: kat } = await (supabase.from('ea_kategorien') as any)
    .select('id').is('tenant_id', null).eq('name', 'Abschreibung (AfA)').limit(1).maybeSingle()
  if (!kat?.id) return { ok: false, fehler: 'Die Systemkategorie „Abschreibung (AfA)“ fehlt (Migration 200).' }

  const alt = zeilen.filter(z => z.buchungId).map(z => z.buchungId as string)
  if (alt.length) {
    const { error } = await (supabase.from('ea_transaktionen') as any).delete().in('id', alt).eq('tenant_id', tenantId)
    if (error) return { ok: false, fehler: (error as R).message }
  }
  const neu = zeilen.filter(z => z.soll > 0).map(z => ({
    tenant_id: tenantId, typ: 'ausgabe', datum: stichtag,
    beschreibung: `AfA ${jahr}: ${z.name}`,
    kategorie_id: kat.id, betrag_netto: Math.round(z.soll * 100) / 100, ust_satz: 0,
    konto_id: null, abzugsfaehig_pct: 100, anlage_id: z.anlageId, import_quelle: 'manuell',
  }))
  if (neu.length) {
    const { error } = await (supabase.from('ea_transaktionen') as any).insert(neu)
    if (error) return { ok: false, fehler: (error as R).message }
  }
  pfade()
  return { ok: true, gebucht: neu.length }
}

export async function nimmAfaZurueck(jahr: number, buchungIds: string[]): Promise<{ ok: boolean; fehler?: string }> {
  const { supabase, tenantId } = await ctx()
  const { data: pruefRaw } = await (supabase.rpc as any)('pruefe_ea_zeitraum_offen', { p_tenant_id: tenantId, p_datum: `${jahr}-12-31` })
  const pruef = Array.isArray(pruefRaw) ? pruefRaw[0] : pruefRaw
  if (pruef && pruef.offen === false) return { ok: false, fehler: pruef.grund ?? `Dezember ${jahr} ist abgeschlossen.` }
  if (!buchungIds.length) return { ok: true }
  const { error } = await (supabase.from('ea_transaktionen') as any).delete().in('id', buchungIds).eq('tenant_id', tenantId).not('anlage_id', 'is', null)
  if (error) return { ok: false, fehler: (error as R).message }
  pfade()
  return { ok: true }
}
