// ── Quellgebinde eines Verschnitts – Lader (KAN-77, 03.10.2026) ──────────────────────────────────────────────
//
// quellGebindeDesVerschnitts() bestimmt für jede Quelle eines Verschnitts das Gebinde, aus dem der Wein am Tag
// des Verschnitts kam (Regeln samt Zwischencharge in quellGebindeKern.ts) – für Chargen-Seite, Weinbuch (+ CSV),
// Bewegungsbuch (+ CSV) und Blend-Protokoll. Keine Migration: nur keller_umzuege (nicht storniert),
// weinausbau.behaelter_id und behaelter.name, alles mit tenant_id gefiltert. KAN-112: Die Aufrufer geben
// quell_behaelter_id/gebinde_rekonstruiert der Quellen mit – die Momentaufnahme hat Vorrang vor der Regel.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle } from '@/lib/supabase/alle'
import {
  letzterUmzugIn, quellGebindeAusDaten, type Quellgebinde, type UmzugGebinde, type VerschnittGebinde,
} from './quellGebindeKern'
import { AktionsFehler } from '@/lib/fehler'

export {
  gebindeAmTag, gebindeText, GEBINDE_REKONSTRUIERT, quellGebindeAusDaten, quellGebindeId, quellGebindeSchluessel, verschnittQuelleText,
  type Quellgebinde, type UmzugGebinde, type VerschnittGebinde,
} from './quellGebindeKern'

type R = Record<string, any>

export const UMZUG_GEBINDE_SELECT = 'id, datum, erstellt_am, von_weinausbau_id, nach_weinausbau_id, von_behaelter_id, nach_behaelter_id, umzug_batch_id, zeilen_typ, umzug_typ, storniert_am'

async function liste(query: any, was: string): Promise<R[]> {
  const { data, error } = await alle<R>(query)
  if (error) throw new AktionsFehler(`Quellgebinde: ${was} konnte nicht geladen werden (${error.message ?? 'unbekannter Fehler'})`)
  return data
}

/** Gebinde-Daten (Umzüge, heutiges Gebinde) für Chargen – Umzüge werden in `umzuege` gesammelt */
async function ladeGebindeDaten(
  supabase: any, tenantId: string, ids: readonly string[],
  umzuege: Map<string, UmzugGebinde>, gebindeJeCharge: Map<string, string | null>,
): Promise<void> {
  if (ids.length === 0) return
  const [ein, aus, chargen] = await Promise.all([
    liste((supabase.from('keller_umzuege') as any).select(UMZUG_GEBINDE_SELECT)
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .in('nach_weinausbau_id', ids).order('id'), 'Umzüge'),
    liste((supabase.from('keller_umzuege') as any).select(UMZUG_GEBINDE_SELECT)
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145
      .in('von_weinausbau_id', ids).order('id'), 'Umzüge'),
    liste((supabase.from('weinausbau') as any).select('id, behaelter_id')
      .eq('tenant_id', tenantId).in('id', ids).order('id'), 'Chargen'),
  ])
  for (const u of [...ein, ...aus]) umzuege.set(u.id, u as UmzugGebinde)
  for (const c of chargen) gebindeJeCharge.set(c.id, c.behaelter_id ?? null)
}

/** Namen der Gebinde (eigener Betrieb) */
export async function ladeBehaelterNamen(supabase: any, tenantId: string, ids: Iterable<string | null | undefined>): Promise<Map<string, string>> {
  const liste_ = [...new Set([...ids].filter((x): x is string => !!x))]
  const namen = new Map<string, string>()
  if (liste_.length === 0) return namen
  const rows = await liste((supabase.from('behaelter') as any).select('id, name')
    .eq('tenant_id', tenantId).in('id', liste_).order('id'), 'Gebinde')
  for (const b of rows) if (b.name) namen.set(b.id, b.name)
  return namen
}

/**
 * Quellgebinde je Verschnitt-Quelle – Schlüssel `${verschneidungId}:${quellWeinausbauId}` → { behaelterId, name }.
 * Fehlt ein Gebinde (keine Umzüge, Charge ohne Gebinde), fehlt der Eintrag.
 */
export async function quellGebindeDesVerschnitts(
  supabase: any, tenantId: string, verschneidungen: readonly VerschnittGebinde[],
): Promise<Map<string, Quellgebinde>> {
  const ids = new Set<string>()
  for (const v of verschneidungen) {
    if (v.ziel_weinausbau_id) ids.add(v.ziel_weinausbau_id)
    for (const q of v.quellen ?? []) if (q.quell_weinausbau_id) ids.add(q.quell_weinausbau_id)
  }
  if (ids.size === 0) return new Map()
  const umzuege = new Map<string, UmzugGebinde>()
  const gebindeJeCharge = new Map<string, string | null>()
  await ladeGebindeDaten(supabase, tenantId, [...ids], umzuege, gebindeJeCharge)

  // Zwischencharge: Herkunft des letzten Umzugs in die Quelle – n:m-Quellzeilen bzw. (Altdaten ohne
  // von_behaelter_id) die Vorgänger-Charge nachladen
  const batches = new Set<string>()
  const vorgaenger = new Set<string>()
  const alleUmzuege = [...umzuege.values()]
  for (const v of verschneidungen) {
    for (const q of v.quellen ?? []) {
      if (!q.quell_weinausbau_id) continue
      const ein = letzterUmzugIn(q.quell_weinausbau_id, (v.datum ?? '').slice(0, 10), alleUmzuege)
      if (!ein || ein.von_behaelter_id) continue
      if (ein.umzug_batch_id) batches.add(ein.umzug_batch_id)
      if (ein.von_weinausbau_id && !ids.has(ein.von_weinausbau_id)) vorgaenger.add(ein.von_weinausbau_id)
    }
  }
  if (batches.size > 0) {
    const zeilen = await liste((supabase.from('keller_umzuege') as any).select(UMZUG_GEBINDE_SELECT)
      .eq('tenant_id', tenantId).is('storniert_am', null)   // KAN-145
      .in('umzug_batch_id', [...batches]).order('id'), 'Umzüge')
    for (const u of zeilen) umzuege.set(u.id, u as UmzugGebinde)
  }
  await ladeGebindeDaten(supabase, tenantId, [...vorgaenger], umzuege, gebindeJeCharge)

  const umzugListe = [...umzuege.values()]
  const namen = await ladeBehaelterNamen(supabase, tenantId, [
    ...gebindeJeCharge.values(), ...umzugListe.flatMap(u => [u.von_behaelter_id, u.nach_behaelter_id]),
    ...verschneidungen.flatMap(v => (v.quellen ?? []).map(q => q.quell_behaelter_id)),   // KAN-112
  ])
  return quellGebindeAusDaten(verschneidungen, umzugListe, gebindeJeCharge, namen)
}
