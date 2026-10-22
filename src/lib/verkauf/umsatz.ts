// KAN-346/347/348 (Entscheidung Jörgen 22.10.2026): Umsatz ist NETTO NACH RECHNUNGSDATUM – wie die UVA. Eine Rechnung
// (Tabelle rechnungen, KAN-102/105) zählt mit den Positionen aller ihrer Lieferscheine; nicht berechnete Lieferscheine
// zählen nicht, stornierte und inaktive Rechnungen nicht. Je Position auf Cent gerundet wie positionBrutto() (Trigger
// sync_*_bezahlt), netto daraus über den Steuersatz der Position (fehlender Satz = 13 % wie Rechnung und Journal).
//
// Vorher rechnete jede Stelle selbst: Dashboard und Auswertung brutto nach Lieferdatum über die Lieferscheine (auch
// nicht berechnete), die Finanzübersicht netto über die Lieferscheine, ohne Cent-Rundung – drei verschiedene Zahlen
// für „Umsatz“ im selben Monat.
//
// Offene Posten: nur Rechnungen (aktiv, nicht storniert, nicht bezahlt), offener Betrag = Brutto − nicht stornierte
// Zahlungen (Teilzahlungen mindern), Fälligkeit und Verzug über faelligkeit() (KAN-374).
//
// Verwendet von: Dashboard (dashboard/_shared/data.ts, dashboard/verkauf), Umsatz-Auswertung (api/reports/umsatz,
// api/reports/umsatz-detail, reports/(controlling)), Finanzübersicht (lib/finanzen/uebersicht.ts), Offene Posten
// (weinhandel/offene-posten) und Morgenbericht (lib/morgenbericht/pruefungen.ts).
// Ohne '@/'-Importe, damit node:test sie prüfen kann; die Lader nehmen den Supabase-Client entgegen.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { alsBeleg, lieferscheineSelect, positionBrutto } from './rechnungen.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund2 } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { alle, inBloecken } from '../supabase/alle.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { momentaufnahmeAnwenden } from '../stammdaten/momentaufnahme.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { faelligkeit, type Faelligkeit } from './faelligkeit.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { tageZwischen } from '../datum/wien.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Beschriftung für Kacheln, Achsen und Überschriften */
export const UMSATZ_BESCHRIFTUNG = 'Umsatz netto nach Rechnungsdatum'

/** Steuersatz, wenn die Position keinen hat (wie Rechnung, Rechnungsjournal und Rechnungsdruck) */
export const UST_SATZ_STANDARD = 13

/** Spalten der Positionen, die Umsatz und offener Betrag brauchen */
export const UMSATZ_POSITIONEN = 'preis_brutto, menge, rabatt_pct, sonderrabatt_pct, ust_satz'

/** Netto einer Position: Brutto je Position auf Cent (positionBrutto), daraus netto über den Steuersatz, auf Cent */
export function positionNetto(p: R): number {
  const satz = p.ust_satz === null || p.ust_satz === undefined || p.ust_satz === '' ? UST_SATZ_STANDARD : Number(p.ust_satz)
  const brutto = positionBrutto(p)
  return rund2(brutto / (1 + (Number.isFinite(satz) ? satz : UST_SATZ_STANDARD) / 100))
}

/** Positionen eines Belegs: nach alsBeleg() verkauf_positionen, sonst die der Lieferscheine */
function positionen(r: R): R[] {
  if (Array.isArray(r.verkauf_positionen)) return r.verkauf_positionen as R[]
  return ((r.lieferscheine ?? []) as R[]).flatMap(l => (l.verkauf_positionen ?? []) as R[])
}

/** Netto-Umsatz einer Rechnung = Summe der gerundeten Positionswerte */
export function rechnungNetto(r: R): number {
  return rund2(positionen(r).reduce((s, p) => s + positionNetto(p), 0))
}

/** Brutto einer Rechnung = Summe der gerundeten Positionswerte (wie der Trigger bezahlt rechnet) */
export function rechnungBrutto(r: R): number {
  return rund2(positionen(r).reduce((s, p) => s + positionBrutto(p), 0))
}

/** Zählt die Rechnung als Umsatz? Aktiv, nicht storniert, mit mindestens einem Lieferschein (sonst nichts berechnet) */
export function zaehltAlsUmsatz(r: R): boolean {
  if (r.aktiv === false || r.storniert === true) return false
  if (Array.isArray(r.verkaufsposten_ids)) return r.verkaufsposten_ids.length > 0
  return Array.isArray(r.lieferscheine) ? r.lieferscheine.length > 0 : Array.isArray(r.verkauf_positionen)
}

/** Netto-Umsatz einer Liste von Rechnungen (nur zählende) */
export function umsatzNetto(rechnungen: readonly R[]): number {
  return rund2(rechnungen.filter(zaehltAlsUmsatz).reduce((s, r) => s + rechnungNetto(r), 0))
}

export type UmsatzMonatSumme = { umsatz: number; anzahl: number }

/** Netto-Umsatz und Anzahl Rechnungen je Monat ('JJJJ-MM') nach Rechnungsdatum; nur die angegebenen Monate */
export function umsatzJeMonat(rechnungen: readonly R[], monate: readonly string[]): Map<string, UmsatzMonatSumme> {
  const out = new Map<string, UmsatzMonatSumme>(monate.map(m => [m, { umsatz: 0, anzahl: 0 }]))
  for (const r of rechnungen) {
    if (!zaehltAlsUmsatz(r)) continue
    const z = out.get(String(r.datum ?? '').slice(0, 7))
    if (!z) continue
    z.umsatz = rund2(z.umsatz + rechnungNetto(r))
    z.anzahl += 1
  }
  return out
}

// ── Lader ────────────────────────────────────────────────────────────────────

/** select-Teil der Umsatz-Rechnungen (mit Kunde für die Belegliste der Auswertung) */
export const UMSATZ_RECHNUNG_SELECT =
  `id, datum, rechnungsnummer, aktiv, storniert, bezahlt, bmd_export_id, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen!firma_id(name), ${lieferscheineSelect(UMSATZ_POSITIONEN)}`

/**
 * Rechnungen mit Rechnungsdatum von–bis (einschließlich, 'JJJJ-MM-TT') des Betriebs, die als Umsatz zählen – vollständig
 * über alle(), in der Form von alsBeleg() (verkauf_positionen = Positionen aller Lieferscheine). Fehler kommt zurück.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeUmsatzRechnungen(supabase: any, tenantId: string, von: string, bis: string): Promise<{ data: R[]; error: R | null }> {
  const { data, error } = await alle<R>(supabase.from('rechnungen')
    .select(UMSATZ_RECHNUNG_SELECT)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true).eq('storniert', false)
    .gte('datum', von).lte('datum', bis)
    .order('datum', { ascending: false }).order('id'))
  if (error) return { data: [], error }
  return { data: ((data ?? []) as R[]).map(alsBeleg).filter(zaehltAlsUmsatz), error: null }
}

/** select-Teil der Umsatz-Lieferscheine (Basis Lieferdatum der Umsatz-Auswertung, KAN-105) */
export const UMSATZ_LIEFERSCHEIN_SELECT =
  `id, datum, lieferscheinnummer, rechnungsnummer, rechnung_id, aktiv, storniert, bezahlt, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), verkauf_positionen(${UMSATZ_POSITIONEN})`

/**
 * Basis Lieferdatum (nur Umsatz-Auswertung /reports, KAN-105/346): Lieferscheine mit Lieferdatum von–bis des Betriebs,
 * aktiv und nicht storniert – auch noch nicht berechnete. Netto über dieselbe Positionslogik (rechnungNetto). Fehler kommt zurück.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeUmsatzLieferscheine(supabase: any, tenantId: string, von: string, bis: string): Promise<{ data: R[]; error: R | null }> {
  const { data, error } = await alle<R>(supabase.from('verkaufsposten')
    .select(UMSATZ_LIEFERSCHEIN_SELECT)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true).eq('storniert', false)
    .gte('datum', von).lte('datum', bis)
    .order('datum', { ascending: false }).order('id'))
  if (error) return { data: [], error }
  return { data: ((data ?? []) as R[]).filter(zaehltAlsUmsatz), error: null }
}

/** Belege der Umsatz-Auswertung je Basis: Rechnungen nach Rechnungsdatum (Standard) oder Lieferscheine nach Lieferdatum */
export function ladeUmsatzBelege(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, von: string, bis: string, basis: 'rechnung' | 'lieferung',
): Promise<{ data: R[]; error: R | null }> {
  return basis === 'lieferung' ? ladeUmsatzLieferscheine(supabase, tenantId, von, bis) : ladeUmsatzRechnungen(supabase, tenantId, von, bis)
}

export type UmsatzBelegZeile = {
  id: string; datum: string; nummer: string | null; art: 'rechnung' | 'lieferschein'; storniert: boolean; bezahlt: boolean
  kontakt: R | null; firma: R | null; netto: number; href: string
}

/** Zeile der Belegliste („Belege anzeigen“) – netto wie die Monatssumme (umsatzNetto), damit die Liste den Balken ergibt */
export function umsatzBelegZeile(r: R, basis: 'rechnung' | 'lieferung'): UmsatzBelegZeile {
  const lieferung = basis === 'lieferung'
  return {
    id: String(r.id), datum: String(r.datum).slice(0, 10),
    nummer: ((lieferung ? r.lieferscheinnummer ?? r.rechnungsnummer : r.rechnungsnummer) ?? null) as string | null,
    art: lieferung ? 'lieferschein' : 'rechnung',
    storniert: !!r.storniert, bezahlt: !!r.bezahlt,
    kontakt: (r.kontakt ?? null) as R | null, firma: (r.firma ?? null) as R | null,
    netto: rechnungNetto(r),
    href: lieferung ? `/weinhandel/verkauf/${r.id}` : `/weinhandel/rechnungen/${r.id}`,
  }
}

export type OffenerPosten = Faelligkeit & {
  id: string
  datum: string
  rechnungsnummer: string | null
  kunde: string
  kontaktId: string | null
  firmaId: string | null
  /** Lieferscheine der Rechnung (erster = Link/Zahlung, KAN-105) */
  verkaufspostenIds: string[]
  bezahlt: boolean
  bezahltAm: string | null
  brutto: number
  gezahlt: number
  /** Brutto − Zahlungen, nie unter 0 */
  offen: number
  /** Tage seit dem Rechnungsdatum (Rechnungsalter, nicht der Verzug) */
  alterTage: number
}

/** Ein Beleg (nach alsBeleg und Momentaufnahme) mit den Zahlungen → offener Posten am Tag `heute` ('JJJJ-MM-TT') */
export function offenerPosten(r: R, gezahlt: number, heute: string): OffenerPosten {
  const brutto = rechnungBrutto(r)
  const kontakt = (r.kontakt ?? null) as R | null
  const firma = (r.firma ?? null) as R | null
  const f = faelligkeit({ datum: String(r.datum), kontakt, firma }, heute)
  return {
    ...f,
    id: String(r.id),
    datum: String(r.datum).slice(0, 10),
    rechnungsnummer: (r.rechnungsnummer ?? null) as string | null,
    kunde: firma?.name ? String(firma.name) : kontakt ? [kontakt.vorname, kontakt.nachname].filter(Boolean).join(' ') || '–' : '–',
    kontaktId: (kontakt?.id ?? null) as string | null,
    firmaId: (firma?.id ?? null) as string | null,
    verkaufspostenIds: ((r.verkaufsposten_ids ?? []) as string[]),
    bezahlt: !!r.bezahlt,
    bezahltAm: (r.bezahlt_am ?? null) as string | null,
    brutto,
    gezahlt: rund2(gezahlt),
    offen: r.bezahlt ? 0 : Math.max(0, rund2(brutto - gezahlt)),
    alterTage: Math.max(0, tageZwischen(String(r.datum), heute)),
  }
}

export type OffenePostenSumme = { anzahl: number; summe: number; ueberfaellig: number; ueberfaelligSumme: number; avgAlterTage: number }

/** Kennzahlen der offenen (nicht bezahlten) Posten: Summe = offene Beträge nach Teilzahlungen */
export function offenePostenSumme(posten: readonly OffenerPosten[]): OffenePostenSumme {
  const offen = posten.filter(p => !p.bezahlt)
  const ueber = offen.filter(p => p.ueberfaellig)
  return {
    anzahl: offen.length,
    summe: rund2(offen.reduce((s, p) => s + p.offen, 0)),
    ueberfaellig: ueber.length,
    ueberfaelligSumme: rund2(ueber.reduce((s, p) => s + p.offen, 0)),
    avgAlterTage: offen.length ? Math.round(offen.reduce((s, p) => s + p.alterTage, 0) / offen.length) : 0,
  }
}

/** select-Teil der offenen Posten: Kunde mit Zahlungsziel, Momentaufnahme, Positionen aller Lieferscheine */
export const OFFENE_POSTEN_SELECT = `id, datum, rechnungsnummer, aktiv, storniert, bezahlt, bezahlt_am, partner_daten,
  kontakt:kontakte!kontakt_id(id, vorname, nachname, zahlungsziel_tage),
  firma:firmen!firma_id(id, name, zahlungsziel_tage),
  ${lieferscheineSelect(UMSATZ_POSITIONEN)}`

/**
 * Offene Posten des Betriebs am Tag `heute` ('JJJJ-MM-TT', Wiener Kalendertag): Rechnungen (aktiv, nicht storniert, mit
 * Lieferscheinen) mit offenem Betrag nach nicht stornierten Zahlungen und Fälligkeit nach Kundenziel. `mitBezahlten`
 * lädt auch bezahlte Rechnungen (Liste „Bezahlte anzeigen“). Sortiert nach Rechnungsdatum (älteste zuerst).
 */
export async function ladeOffenePostenListe(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, tenantId: string, heute: string, opts: { mitBezahlten?: boolean } = {},
): Promise<{ data: OffenerPosten[]; error: R | null }> {
  const { data, error } = await alle<R>(supabase.from('rechnungen')
    .select(OFFENE_POSTEN_SELECT)
    .eq('tenant_id', tenantId)
    .eq('aktiv', true).eq('storniert', false)
    .in('bezahlt', opts.mitBezahlten ? [false, true] : [false])   // bezahlt ist NOT NULL (KAN-102)
    .order('datum', { ascending: true }).order('id'))
  if (error) return { data: [], error }
  const belege = ((data ?? []) as R[])
    .map(r => alsBeleg(momentaufnahmeAnwenden(r, ['kontakt', 'firma'])))
    .filter(r => r.verkaufsposten_ids.length > 0)

  const offeneIds = belege.filter(r => !r.bezahlt).map(r => String(r.id))
  const gezahlt = new Map<string, number>()
  // inBloecken: ab ≈ 350 IDs scheitert die URL; je Rechnung alle nicht stornierten Zahlungen (Teilzahlungen)
  const { data: zahlungen, error: zErr } = await inBloecken<R>(offeneIds, b => alle(supabase.from('zahlungen')
    .select('id, rechnung_id, betrag')
    .eq('tenant_id', tenantId)
    .in('rechnung_id', b)
    .is('storniert_am', null)   // KAN-149 D2b: stornierte Zahlungen zählen nicht
    .order('id')))
  if (zErr) return { data: [], error: zErr }
  for (const z of (zahlungen ?? []) as R[]) {
    const k = String(z.rechnung_id)
    gezahlt.set(k, (gezahlt.get(k) ?? 0) + (Number(z.betrag) || 0))
  }
  return { data: belege.map(r => offenerPosten(r, gezahlt.get(String(r.id)) ?? 0, heute)), error: null }
}

// ── BMD-Übergabe (KAN-375) ───────────────────────────────────────────────────

/**
 * Rechnungen ohne BMD-Übergabe: zählen als Umsatz (aktiv, nicht storniert, mit Lieferscheinen) und haben keinen
 * bmd_export_id. Eine Zählung für die Finanzübersicht (Übergabe, lib/finanzen/uebersicht.ts) und die Dashboard-Frist
 * „BMD-Übergabe“ (dashboard/_shared/data.ts) – vorher zählte die Frist Lieferscheine, auch nicht berechnete.
 */
export function rechnungenOhneBmdExport(rechnungen: readonly R[]): R[] {
  return rechnungen.filter(r => zaehltAlsUmsatz(r) && !r.bmd_export_id)
}

/**
 * Rechnungen mit Rechnungsdatum von–bis (einschließlich, 'JJJJ-MM-TT') des Betriebs, die noch nicht an BMD übergeben
 * sind – vollständig über alle(), ohne Positionen (nur für die Zählung je Periode), gefiltert über
 * rechnungenOhneBmdExport(). Fehler kommt zurück.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeRechnungenOhneBmdExport(supabase: any, tenantId: string, von: string, bis: string): Promise<{ data: R[]; error: R | null }> {
  const { data, error } = await alle<R>(supabase.from('rechnungen')
    .select('id, datum, aktiv, storniert, bmd_export_id, lieferscheine:verkaufsposten!rechnung_id(id)')
    .eq('tenant_id', tenantId)
    .eq('aktiv', true).eq('storniert', false)
    .is('bmd_export_id', null)
    .gte('datum', von).lte('datum', bis)
    .order('datum').order('id'))
  if (error) return { data: [], error }
  return { data: rechnungenOhneBmdExport((data ?? []) as R[]), error: null }
}
