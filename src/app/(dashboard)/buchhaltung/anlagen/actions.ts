'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import type { AfaMethode } from '@/lib/ea/anlagen'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { pruefeModul } from '@/lib/auth/modul'

// ── Anlagenverzeichnis: Server-Aktionen (Migration 200) ──────────────────────
// Schreiben dürfen Betriebsleiter und Winzer (RLS ea_anlagen_write). Die
// AfA-Buchung läuft über ea_transaktionen mit anlage_id und respektiert wie
// jede Buchung Monatsabschluss/UVA-Sperre (pruefe_ea_zeitraum_offen).
// KAN-149 D2c (01.10.2026): AfA wird nicht mehr gelöscht, sondern storniert (Gegenbuchung per 31.12., RPC
// s112_ea_stornieren) – beim Neuberechnen automatisch, beim Zurücknehmen mit Grund. Das dürfen wie jedes
// E&A-Storno auch Mitarbeiter (winzer).

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
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership.role, 'ea')) throw new AktionsFehler('Keine Berechtigung')
  await pruefeModul('modul_ea')   // KAN-6: Anlagenverzeichnis gehört zur E&A
  const supabase = await createSupabaseServerClient()
  return { supabase, tenantId: membership.tenantId, role: membership.role }
}

const pfade = () => { revalidatePath('/buchhaltung/anlagen'); revalidatePath('/buchhaltung'); revalidatePath('/buchhaltung/uebersicht') }

const AFA_GEAENDERT = 'Die AfA-Buchungen wurden inzwischen geändert – die Seite wurde aktualisiert'

/** Grund der automatischen Gegenbuchung beim Neuberechnen (≥ 10 Zeichen, Änderungsprotokoll) */
const grundAfaNeu = (jahr: number) => `AfA ${jahr} laut Anlagenverzeichnis neu berechnet`

type Sb = Awaited<ReturnType<typeof createSupabaseServerClient>>

/** Die übergebenen AfA-Buchungen – nur wenn alle noch gültig sind (nicht storniert, keine Gegenbuchung), sonst null */
async function gueltigeAfaBuchungen(supabase: Sb, tenantId: string, ids: string[]): Promise<{ ok: true; buchungen: Map<string, number> | null } | { ok: false; fehler: string }> {
  const eindeutig = [...new Set(ids)]
  const { data, error } = await (supabase.from('ea_transaktionen') as any).select('id, betrag_netto')
    .in('id', eindeutig).eq('tenant_id', tenantId).not('anlage_id', 'is', null).is('storniert_am', null).is('storno_von_id', null)
  if (error) return { ok: false, fehler: `Die AfA-Buchungen konnten nicht geprüft werden: ${(error as R).message}` }
  const buchungen = new Map(((data ?? []) as R[]).map(r => [r.id as string, Number(r.betrag_netto)]))
  return { ok: true, buchungen: buchungen.size === eindeutig.length ? buchungen : null }
}

/** Storniert die Buchungen nacheinander; bei einem Fehler mit Hinweis, wie viele schon gegengebucht sind */
async function afaStornieren(supabase: Sb, tenantId: string, ids: string[], grund: string, datum: string): Promise<string | null> {
  let n = 0
  for (const id of ids) {
    const { error } = await (supabase.rpc as any)('s112_ea_stornieren', { p_tenant_id: tenantId, p_id: id, p_grund: grund, p_datum: datum })
    if (error) return `${dbFehlerText(error, 'AfA-Buchung konnte nicht storniert werden')}${n ? ` (${n} bereits gegengebucht)` : ''}`
    n++
  }
  return null
}

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
  const { data: afa, error: afaErr } = await (supabase.from('ea_transaktionen') as any).select('datum, storniert_am, storno_von_id').eq('anlage_id', id).eq('tenant_id', tenantId)
  if (afaErr) return { ok: false, fehler: `Die AfA-Buchungen der Anlage konnten nicht geprüft werden: ${(afaErr as R).message}` }
  const gueltig = ((afa ?? []) as R[]).filter(t => !t.storniert_am && !t.storno_von_id)
  if (gueltig.length > 0) {
    const jahre = [...new Set(gueltig.map(t => String(t.datum).slice(0, 4)))].sort().join(', ')
    return { ok: false, fehler: `Für diese Anlage ist die AfA ${jahre} gebucht. Bitte zuerst im Anlagenverzeichnis die AfA-Buchungen zurücknehmen.` }
  }
  // KAN-149 D2c: Stornierte AfA bleibt samt Gegenbuchung in der E&A und verweist auf die Anlage (FK RESTRICT)
  if ((afa ?? []).length > 0) {
    return { ok: false, fehler: 'Für diese Anlage gibt es stornierte AfA-Buchungen – sie bleibt deshalb zur Nachvollziehbarkeit im Verzeichnis. Ist sie nicht mehr im Betrieb, bitte den Abgang eintragen.' }
  }
  const { error } = await (supabase.from('ea_anlagen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) return { ok: false, fehler: (error as R).message }
  pfade()
  return { ok: true }
}

/**
 * AfA eines Jahres buchen: je Anlage eine Ausgabe „Abschreibung (AfA)“ per
 * 31.12., 0 % USt, ohne Zahlungskonto. Abweichende/überflüssige Buchungen
 * werden vorher storniert (Gegenbuchung per 31.12., KAN-149 D2c). Sperre über
 * pruefe_ea_zeitraum_offen (Dezember).
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

  // Bestehende AfA dieser Anlagen: gleicher Betrag bleibt stehen, abweichende wird gegengebucht und neu gebucht
  const alt = zeilen.filter(z => z.buchungId)
  const bleibt = new Set<string>()
  if (alt.length) {
    const g = await gueltigeAfaBuchungen(supabase, tenantId, alt.map(z => z.buchungId as string))
    if (!g.ok) return { ok: false, fehler: g.fehler }
    // inzwischen storniert oder anders gebucht (veralteter Tab): nichts tun, Seite neu laden
    if (!g.buchungen) { pfade(); return { ok: false, fehler: `${AFA_GEAENDERT}, bitte erneut buchen.` } }
    const weg: string[] = []
    for (const z of alt) {
      const ist = g.buchungen.get(z.buchungId as string) ?? 0
      if (z.soll > 0 && Math.abs(ist - Math.round(z.soll * 100) / 100) < 0.005) bleibt.add(z.anlageId)
      else weg.push(z.buchungId as string)
    }
    const fehler = await afaStornieren(supabase, tenantId, weg, grundAfaNeu(jahr), stichtag)
    if (fehler) { pfade(); return { ok: false, fehler } }
  }
  const neu = zeilen.filter(z => z.soll > 0 && !bleibt.has(z.anlageId)).map(z => ({
    tenant_id: tenantId, typ: 'ausgabe', datum: stichtag,
    beschreibung: `AfA ${jahr}: ${z.name}`,
    kategorie_id: kat.id, betrag_netto: Math.round(z.soll * 100) / 100, ust_satz: 0,
    konto_id: null, abzugsfaehig_pct: 100, anlage_id: z.anlageId, import_quelle: 'manuell',
  }))
  if (neu.length) {
    const { error } = await (supabase.from('ea_transaktionen') as any).insert(neu)
    // Gegenbuchungen sind dann schon da – Seite aktualisieren, damit die Anlagen als offen erscheinen
    if (error) { pfade(); return { ok: false, fehler: (error as R).message } }
  }
  pfade()
  return { ok: true, gebucht: neu.length }
}

export async function nimmAfaZurueck(jahr: number, buchungIds: string[], grund: string): Promise<{ ok: boolean; fehler?: string }> {
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) return { ok: false, fehler: grundFehler }
  const { supabase, tenantId } = await ctx()
  const stichtag = `${jahr}-12-31`
  const { data: pruefRaw } = await (supabase.rpc as any)('pruefe_ea_zeitraum_offen', { p_tenant_id: tenantId, p_datum: stichtag })
  const pruef = Array.isArray(pruefRaw) ? pruefRaw[0] : pruefRaw
  if (pruef && pruef.offen === false) return { ok: false, fehler: pruef.grund ?? `Dezember ${jahr} ist abgeschlossen.` }
  if (!buchungIds.length) return { ok: true }
  const g = await gueltigeAfaBuchungen(supabase, tenantId, buchungIds)
  if (!g.ok) return { ok: false, fehler: g.fehler }
  if (!g.buchungen) { pfade(); return { ok: false, fehler: `${AFA_GEAENDERT}, bitte erneut zurücknehmen.` } }
  // KAN-149 D2c: Gegenbuchung per 31.12. statt Löschen – die AfA-Buchungen bleiben storniert in der E&A
  const fehler = await afaStornieren(supabase, tenantId, [...g.buchungen.keys()], grund.trim(), stichtag)
  pfade()
  if (fehler) return { ok: false, fehler }
  return { ok: true }
}
