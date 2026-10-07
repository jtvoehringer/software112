// ── BKI-Blätter „Lagerstand zum Datum“ und „Lagerbewegungen“ aus dem Bewegungsjournal (KAN-44 Teil 1, 06.10.2026) ──
//
// Grundlage ist kellerbuch_buchungen (KAN-40): je Zeile Buchungsart, Menge und die Merkmale zum Buchungszeitpunkt.
// Die Spalten folgen der BKI-Schnittstelle („SchnittstelleDatenMitDefinitionTypen“, Blätter Lagerstand zum Datum A–AI
// und Lagerbewegungen A–AW). Entscheidung Jörgen 06.10.2026: Umsetzung nach bestem Wissen ohne BKI-Abnahme.
//
//  Lagerstand: Bestand je Posten (Charge offen in Litern, Füllung in Stück und Litern) zum Stichtag = Summe der
//  Journalzeilen bis einschließlich Stichtag; Merkmale aus der letzten Zeile des Postens bis dahin (Umstufungen wirken).
//  Flaschen getrennt nach etikettiert/unetikettiert (anzahl_unetikettiert − Etikettierungen bis zum Stichtag, KAN-41 3d).
//  Lagerbewegungen: jede Journalzeile im Zeitraum mit Anfangsmenge (Bestand des Postens vor der Zeile, chronologisch nach
//  Datum, Beleg, Position) und Buchungsmenge; Storno-Gegenbuchungen bleiben als eigene Zeilen sichtbar.
//
// Noch leer (nicht im Journal, Folgeschritte): Großlage, Ortswein, Gemeinde, Katastralgemeinde, Ried, Anteil Fremdsorte
// und Fremdjahrgang, Behandlungsmengen (Anreicherung, Süßung …), Adressen der Käufer/Verkäufer (nur Name und Land).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, wienHeute, type CsvSpalte } from '@/lib/csv'
import { sektStufeLabel } from '@/lib/wein/sekt'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { herkunftKnoten } from '@/lib/herkunft'
import { KAT_BUCHUNGSART, katalogQualitaet, meldeFarbe } from '@/lib/katalog/bki'
import { istEuLand, landAnzeige } from '@/lib/katalog/laender'
import { bkiRebsorteKuerzel, fehlendeKuerzelHinweise } from '@/lib/wein/bki_kuerzel'
import { abrunden } from '@/lib/wein/mostgewicht'
import { ladeJournalBeginn } from '@/lib/kellerbuch/journal'
import { istTag, num, numOderNull, tag, text, type R, type Zeitraum } from './kellerbuch-hilfen'
import { parameterFehler, type ParameterFehler } from './typen'

/** Spalten der Journalzeilen für beide Blätter */
const JOURNAL_SPALTEN_LAGER = 'id, beleg_nr, pos, datum, buchungsart_code, bestand, weinausbau_id, fuellung_id, behaelter_id, menge_liter, menge_stk, partner_name, partner_land, quelle_tabelle, storno_von_id, charge_name, fuellung_name, flaschengroesse_ml, erzeugnis, qualitaetsstufe, zusatzbezeichnung, weinart, herkunft_code, land_iso, rebsorte, jahrgang, hinweis'

/** Merkmalsspalten, die beide Blätter gleich führen (Erzeugnis bis Prüfnummer) */
export type LagerMerkmale = {
  erzeugnis: string | null
  farbe: string | null
  land: string | null
  produkt: string | null
  sorte: string | null
  /** Sortenname, falls kein amtliches Kürzel existiert (nur für den Hinweis) */
  sorteName: string | null
  qualitaet: string | null
  jahrgang: number | null
  zusatz: string | null
  herkunft: string | null
  herkunftGga: string | null
  herkunftGu: string | null
  herkunftStufe: string | null
  pruefnummer: string | null
}

export type LagerstandZeile = LagerMerkmale & {
  datum: string
  gebindeArt: 'offen' | 'Flasche'
  etikett: 'etikettiert' | 'unetikettiert' | null
  gebinde: string | null
  nennvolumen: number | null
  stk: number | null
  liter: number
  kmw: number | null
  anmerkung: string | null
}

export type LagerbewegungZeile = LagerMerkmale & {
  datum: string
  beleg: string
  chargenNr: string | null
  gebindeArt: 'offen' | 'Flasche'
  gebinde: string | null
  nennvolumen: number | null
  anfangStk: number | null
  buchungStk: number | null
  anfangLiter: number
  buchungLiter: number
  kmw: number | null
  buchungsartBsm: string | null
  buchungsart: string
  kaeufer: string | null
  kaeuferAdresse: string | null
  verkaeufer: string | null
  verkaeuferAdresse: string | null
  anmerkung: string | null
}

/** Stammdaten zu den Posten (heutiger Stand – Mostgewicht, Prüf- und Chargennummer, Gebinde) */
export type LagerStamm = {
  chargen: Map<string, R>
  fuellungen: Map<string, R>
  behaelter: Map<string, { name: string; volumen_liter: number | null }>
  /** fuellung_etikettierungen (nicht storniert) */
  etikettierungen: R[]
}

const HERKUNFT_STUFE: Record<string, string> = { dac_gebiet: 'Gebietswein', dac_ort: 'Ortswein', dac_ried: 'Riedenwein' }
const BUCHUNGSART = new Map(KAT_BUCHUNGSART.map(b => [b.code, b]))

/** „Erzeugnis lt. Liste“ (kat_erzeugnis): Spalte erzeugnis der Zeile, sonst aus Herkunftsland, Stufe, Sorte/Jahrgang */
export function erzeugnisCode(r: R): string | null {
  const e = text(r.erzeugnis)
  if (e) return e
  const land = text(r.land_iso)
  if (land && land !== 'AT') return istEuLand(land) ? 'EUWEIN' : 'DRITTLD'
  const q = katalogQualitaet(text(r.qualitaetsstufe))
  if (!q) return text(r.rebsorte) || numOderNull(r.jahrgang) ? 'WEINSORT' : null
  if (q.code === 'SOE') return null
  if (q.code === 'LDW') return 'WEINGGA'
  if ((q.rang ?? 0) >= 4) return 'WEINGU'
  return text(r.rebsorte) || numOderNull(r.jahrgang) ? 'WEINSORT' : 'WEIN'
}

/** Merkmalsspalten aus einer Journalzeile */
export function lagerMerkmale(r: R, pruefnummer: string | null, sektStufe: string | null = null): LagerMerkmale {
  const h = herkunftKnoten(text(r.herkunft_code))
  const rebsorte = text(r.rebsorte)
  const kuerzel = bkiRebsorteKuerzel(rebsorte)
  return {
    erzeugnis: erzeugnisCode(r),
    farbe: meldeFarbe(text(r.weinart)),
    land: text(r.land_iso),
    produkt: text(r.bestand === 'flasche' ? r.fuellung_name : r.charge_name) ?? text(r.charge_name),
    sorte: kuerzel,
    sorteName: kuerzel ? null : rebsorte,
    qualitaet: katalogQualitaet(text(r.qualitaetsstufe))?.code ?? null,
    jahrgang: numOderNull(r.jahrgang),
    zusatz: text(r.zusatzbezeichnung) ?? sektStufeLabel(sektStufe),   // KAN-190: Sekt-Stufe als zusätzliche Bezeichnung
    herkunft: h?.bki ?? null,
    herkunftGga: h && h.ebene === 'landwein' ? h.gebiet : null,
    herkunftGu: h && (h.ebene === 'qualitaetswein' || h.ebene.startsWith('dac_')) ? h.gebiet : null,
    herkunftStufe: h ? HERKUNFT_STUFE[h.ebene] ?? null : null,
    pruefnummer,
  }
}

const posten = (r: R) => (r.bestand === 'flasche' ? `F|${r.fuellung_id}` : `C|${r.weinausbau_id}`)
const l2 = (n: number) => runden(n, STELLEN.liter)
/** chronologisch: Datum, dann Beleg und Position */
const chronologisch = (a: R, b: R) =>
  tag(a.datum).localeCompare(tag(b.datum)) || num(a.beleg_nr) - num(b.beleg_nr) || num(a.pos) - num(b.pos)

/** °KMW der Charge (bei Flaschen: Charge der Füllung), abgerundet auf 1 Stelle (BKI NN,N) */
function kmwVon(r: R, s: LagerStamm): number | null {
  const chargeId = r.bestand === 'flasche' ? text(s.fuellungen.get(r.fuellung_id)?.weinausbau_id) : text(r.weinausbau_id)
  const kmw = chargeId ? numOderNull(s.chargen.get(chargeId)?.kmw) : null
  return kmw === null ? null : abrunden(kmw, 1)
}

function gebindeVon(r: R, s: LagerStamm): { gebinde: string | null; nennvolumen: number | null } {
  if (r.bestand === 'flasche') {
    const ml = numOderNull(r.flaschengroesse_ml) ?? numOderNull(s.fuellungen.get(r.fuellung_id)?.flaschengroesse_ml)
    return { gebinde: 'Flasche', nennvolumen: ml === null ? null : runden(ml / 1000, 3) }
  }
  const b = r.behaelter_id ? s.behaelter.get(r.behaelter_id) : undefined
  return { gebinde: b?.name ?? null, nennvolumen: b?.volumen_liter ?? null }
}

/** Hinweise auf Zeiträume vor dem Journalbeginn */
function journalHinweise(journalAb: string | null, ab: string | null): string[] {
  if (!journalAb) return ['Das Bewegungsjournal ist für diesen Betrieb noch nicht eröffnet – das Blatt bleibt leer.']
  if (ab && ab < journalAb) return [`Das Bewegungsjournal beginnt am ${journalAb.split('-').reverse().join('.')} – frühere Bewegungen sind nicht enthalten.`]
  return []
}

// ── Lagerstand zum Datum ─────────────────────────────────────────────────────────────────────────────────

export function berechneLagerstand(journal: readonly R[], s: LagerStamm, stichtag: string): { zeilen: LagerstandZeile[]; warnungen: string[] } {
  const je = new Map<string, { letzte: R; liter: number; stk: number }>()
  for (const r of [...journal].sort(chronologisch)) {
    if (tag(r.datum) > stichtag) continue
    const k = posten(r)
    const x = je.get(k) ?? { letzte: r, liter: 0, stk: 0 }
    x.letzte = r
    x.liter += num(r.menge_liter)
    x.stk += Math.trunc(num(r.menge_stk))
    je.set(k, x)
  }
  const etikettiert = new Map<string, number>()
  for (const e of s.etikettierungen) {
    if (e.storniert_am || tag(e.datum) > stichtag) continue
    etikettiert.set(e.fuellung_id, (etikettiert.get(e.fuellung_id) ?? 0) + Math.trunc(num(e.menge_stk)))
  }

  const zeilen: LagerstandZeile[] = []
  const negativ: string[] = []
  for (const { letzte: r, liter, stk } of je.values()) {
    const flasche = r.bestand === 'flasche'
    const m = lagerMerkmale(r, flasche ? text(s.fuellungen.get(r.fuellung_id)?.pruefnummer) : null, flasche ? text(s.fuellungen.get(r.fuellung_id)?.sekt_stufe) : null)
    if (flasche ? stk < 0 : l2(liter) < 0) { negativ.push(m.produkt ?? 'ohne Bezeichnung'); continue }
    if (flasche ? stk === 0 : Math.abs(l2(liter)) < 0.005) continue
    const basis = { ...m, datum: stichtag, ...gebindeVon(r, s), kmw: kmwVon(r, s), anmerkung: null }
    if (!flasche) { zeilen.push({ ...basis, gebindeArt: 'offen', etikett: null, stk: null, liter: l2(liter) }); continue }
    const f = s.fuellungen.get(r.fuellung_id)
    const ohne = Math.min(stk, Math.max(0, Math.trunc(num(f?.anzahl_unetikettiert)) - (etikettiert.get(r.fuellung_id) ?? 0)))
    const literJeStk = stk > 0 ? liter / stk : 0
    if (stk - ohne > 0) zeilen.push({ ...basis, gebindeArt: 'Flasche', etikett: 'etikettiert', stk: stk - ohne, liter: l2(literJeStk * (stk - ohne)) })
    if (ohne > 0) zeilen.push({ ...basis, gebindeArt: 'Flasche', etikett: 'unetikettiert', stk: ohne, liter: l2(literJeStk * ohne) })
  }
  zeilen.sort((a, b) => a.gebindeArt.localeCompare(b.gebindeArt, 'de') || (a.produkt ?? '').localeCompare(b.produkt ?? '', 'de') || (a.etikett ?? '').localeCompare(b.etikett ?? ''))

  const warnungen: string[] = []
  if (negativ.length > 0) warnungen.push(`Negativer Bestand am Stichtag (nicht im Blatt): ${[...new Set(negativ)].slice(0, 5).join(', ')}${negativ.length > 5 ? ' …' : ''} – Buchungen prüfen.`)
  warnungen.push(...fehlendeKuerzelHinweise(zeilen.map(z => z.sorteName), { einheit: ['Posten', 'Posten'], stammdaten: 'Charge bzw. Füllung' }))
  return { zeilen, warnungen }
}

// ── Lagerbewegungen ──────────────────────────────────────────────────────────────────────────────────────

/** BSM-Buchungsart einer Journalzeile (amtliche Codes; INV_MIN → SCHWUND; neutrale Vorgänge leer) */
export function bsmBuchungsart(code: string): string | null {
  const b = BUCHUNGSART.get(code)
  if (!b) return null
  return b.bsm ? b.code : b.bsmCode
}

export function berechneLagerbewegungen(journal: readonly R[], s: LagerStamm, z: Zeitraum): { zeilen: LagerbewegungZeile[]; warnungen: string[] } {
  const saldo = new Map<string, { liter: number; stk: number }>()
  const gegengebucht = new Set(journal.map(r => r.storno_von_id).filter(Boolean))
  const zeilen: LagerbewegungZeile[] = []
  for (const r of [...journal].sort(chronologisch)) {
    const d = tag(r.datum)
    if (z.bis && d > z.bis) continue
    const k = posten(r)
    const vorher = saldo.get(k) ?? { liter: 0, stk: 0 }
    const liter = num(r.menge_liter)
    const stk = Math.trunc(num(r.menge_stk))
    saldo.set(k, { liter: vorher.liter + liter, stk: vorher.stk + stk })
    if (z.von && d < z.von) continue

    const flasche = r.bestand === 'flasche'
    const code = String(r.buchungsart_code)
    const partner = text(r.partner_name)
    const adresse = text(r.partner_land) ? landAnzeige(text(r.partner_land)) : null
    const abgang = code.startsWith('VK_')
    const zugang = code.startsWith('ZK_')
    const f = flasche ? s.fuellungen.get(r.fuellung_id) : undefined
    const c = !flasche && r.weinausbau_id ? s.chargen.get(r.weinausbau_id) : undefined
    zeilen.push({
      ...lagerMerkmale(r, flasche ? text(f?.pruefnummer) : null, flasche ? text(f?.sekt_stufe) : null),
      datum: d,
      beleg: `${r.beleg_nr}/${r.pos}`,
      chargenNr: text(flasche ? f?.chargennummer : c?.chargennummer),
      gebindeArt: flasche ? 'Flasche' : 'offen',
      ...gebindeVon(r, s),
      anfangStk: flasche ? vorher.stk : null,
      buchungStk: flasche ? stk : null,
      anfangLiter: l2(vorher.liter),
      buchungLiter: l2(liter),
      kmw: kmwVon(r, s),
      buchungsartBsm: bsmBuchungsart(code),
      buchungsart: BUCHUNGSART.get(code)?.bezeichnung ?? code,
      kaeufer: abgang ? partner : null,
      kaeuferAdresse: abgang ? adresse : null,
      verkaeufer: zugang ? partner : null,
      verkaeuferAdresse: zugang ? adresse : null,
      anmerkung: [
        text(r.hinweis),
        r.storno_von_id ? 'Storno-Gegenbuchung' : gegengebucht.has(r.id) ? 'storniert (Gegenbuchung folgt)' : null,
      ].filter(Boolean).join(' · ') || null,
    })
  }
  return {
    zeilen,
    warnungen: fehlendeKuerzelHinweise(zeilen.map(x => x.sorteName), { einheit: ['Buchung', 'Buchungen'], stammdaten: 'Charge bzw. Füllung' }),
  }
}

// ── Parameter ────────────────────────────────────────────────────────────────────────────────────────────

/** ?stichtag=JJJJ-MM-TT (Standard: heute, Wiener Zeit; nicht in der Zukunft) */
export function lagerstandStichtag(sp: URLSearchParams, heute: string = wienHeute()): { stichtag: string } | ParameterFehler {
  const roh = (sp.get('stichtag') ?? '').trim()
  if (!roh) return { stichtag: heute }
  if (!istTag(roh)) return parameterFehler('Ungültiger Stichtag – bitte als JJJJ-MM-TT angeben (z. B. ?stichtag=2026-07-31).')
  if (roh > heute) return parameterFehler('Der Stichtag liegt in der Zukunft – ein Lagerstand ist nur bis heute bestimmbar.')
  return { stichtag: roh }
}

// ── Laden ────────────────────────────────────────────────────────────────────────────────────────────────

async function ladeStamm(supabase: any, tenantId: string): Promise<LagerStamm> {
  const [cRes, fRes, eRes, gebinde] = await Promise.all([
    alle<R>((supabase.from('weinausbau') as any).select('id, kmw, chargennummer').eq('tenant_id', tenantId).order('id')),
    alle<R>((supabase.from('fuellungen') as any)
      .select('id, weinausbau_id, pruefnummer, chargennummer, flaschengroesse_ml, anzahl_unetikettiert, sekt_stufe')
      .eq('tenant_id', tenantId).order('id')),
    alle<R>((supabase.from('fuellung_etikettierungen') as any)
      .select('id, fuellung_id, datum, menge_stk, storniert_am')
      .eq('tenant_id', tenantId).is('storniert_am', null).order('id')),
    ladeBehaelter(supabase, tenantId),
  ])
  for (const [n, res] of [['weinausbau', cRes], ['fuellungen', fRes], ['fuellung_etikettierungen', eRes]] as const) {
    if (res.error) throw new Error(`Laden fehlgeschlagen (${n}): ${res.error.message}`)
  }
  return {
    chargen: new Map(cRes.data.map(c => [c.id, c])),
    fuellungen: new Map(fRes.data.map(f => [f.id, f])),
    behaelter: new Map(gebinde.map(b => [b.id, { name: b.anzeigeName ?? b.name, volumen_liter: b.volumen_liter }])),
    etikettierungen: eRes.data,
  }
}

async function ladeJournal(supabase: any, tenantId: string, bis: string | null): Promise<R[]> {
  let q = (supabase.from('kellerbuch_buchungen') as any).select(JOURNAL_SPALTEN_LAGER).eq('tenant_id', tenantId)
  if (bis) q = q.lte('datum', bis)
  const res = await alle<R>(q.order('beleg_nr').order('pos'))
  if (res.error) throw new Error(`Laden fehlgeschlagen (kellerbuch_buchungen): ${res.error.message}`)
  return res.data
}

export async function ladeLagerstand(supabase: any, tenantId: string, p: { stichtag: string }): Promise<{ zeilen: LagerstandZeile[]; warnungen: string[]; journalAb: string | null }> {
  const journalAb = await ladeJournalBeginn(supabase, tenantId)
  if (!journalAb) return { zeilen: [], warnungen: journalHinweise(null, null), journalAb }
  const [journal, stamm] = await Promise.all([ladeJournal(supabase, tenantId, p.stichtag), ladeStamm(supabase, tenantId)])
  const e = berechneLagerstand(journal, stamm, p.stichtag)
  return { ...e, warnungen: [...journalHinweise(journalAb, p.stichtag < journalAb ? p.stichtag : null), ...e.warnungen], journalAb }
}

export async function ladeLagerbewegungen(supabase: any, tenantId: string, z: Zeitraum): Promise<{ zeilen: LagerbewegungZeile[]; warnungen: string[]; journalAb: string | null }> {
  const journalAb = await ladeJournalBeginn(supabase, tenantId)
  if (!journalAb) return { zeilen: [], warnungen: journalHinweise(null, null), journalAb }
  const [journal, stamm] = await Promise.all([ladeJournal(supabase, tenantId, z.bis), ladeStamm(supabase, tenantId)])
  const e = berechneLagerbewegungen(journal, stamm, z)
  return { ...e, warnungen: [...journalHinweise(journalAb, z.von ?? '0000-01-01'), ...e.warnungen], journalAb }
}

// ── Spalten (Reihenfolge und Köpfe wie die BKI-Blätter) ──────────────────────────────────────────────────

const leer = () => null

function merkmalSpalten<Z extends LagerMerkmale>(): CsvSpalte<Z>[] {
  return [
    { kopf: 'Erzeugnis lt. Liste', typ: 'code', wert: z => z.erzeugnis },
    { kopf: 'Farbe', typ: 'code', wert: z => z.farbe },
    { kopf: 'Länderkürzel', typ: 'code', wert: z => z.land },
    { kopf: 'Produktbezeichnung', typ: 'text', wert: z => z.produkt },
    { kopf: 'Sorte', typ: 'code', wert: z => z.sorte },
    { kopf: 'Qualitätsstufe', typ: 'code', wert: z => z.qualitaet },
    { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
    { kopf: 'zusätzliche Bezeichnung', typ: 'text', wert: z => z.zusatz },
    { kopf: 'Herkunft', typ: 'code', wert: z => z.herkunft },
    { kopf: 'Herkunft g.g.A', typ: 'text', wert: z => z.herkunftGga },
    { kopf: 'Herkunft Gebiet/Name der g.U.', typ: 'text', wert: z => z.herkunftGu },
    { kopf: 'Gebiets-/Orts-/Riedenwein', typ: 'text', wert: z => z.herkunftStufe },
    { kopf: 'Herkunft Großlage', typ: 'text', wert: leer },
    { kopf: 'Herkunft Ortswein', typ: 'text', wert: leer },
    { kopf: 'Herkunft Gemeinde', typ: 'text', wert: leer },
    { kopf: 'Herkunft Katastralgemeinde', typ: 'text', wert: leer },
    { kopf: 'Herkunft Ried', typ: 'text', wert: leer },
    { kopf: 'Staatl. Prüfnr.', typ: 'code', wert: z => z.pruefnummer },
  ]
}

function behandlungsSpalten<Z>(): CsvSpalte<Z>[] {
  return [
    { kopf: 'Anteil FremdSorte', typ: 'prozent', wert: leer },
    { kopf: 'Anteil FremdJG', typ: 'prozent', wert: leer },
    { kopf: 'Anreicherung kg/hl', typ: 'dezimal', wert: leer },
    { kopf: 'Süßung g/lt', typ: 'dezimal', wert: leer },
    { kopf: 'Konzentrierung %', typ: 'dezimal', wert: leer },
    { kopf: 'Entsäuerung g/lt', typ: 'dezimal', wert: leer },
    { kopf: 'Säuerung g/lt', typ: 'dezimal', wert: leer },
    { kopf: 'Alkoholkorrektur %vol', typ: 'dezimal', wert: leer },
  ]
}

export const SPALTEN_LAGERSTAND: CsvSpalte<LagerstandZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  ...merkmalSpalten<LagerstandZeile>(),
  { kopf: 'offener Wein / Flasche', typ: 'text', wert: z => z.gebindeArt },
  { kopf: 'etikettiert / unetikettiert', typ: 'text', wert: z => z.etikett },
  { kopf: 'Gebinde-Kennzeichnung', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Nennvolumen in lt.', typ: 'dezimal', stellen: 3, wert: z => z.nennvolumen },
  { kopf: 'IST-Menge in St.', typ: 'ganzzahl', wert: z => z.stk },
  { kopf: 'IST-Menge in lt.', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.liter },
  { kopf: 'Lesegradation in KMW', typ: 'dezimal', stellen: STELLEN.kmwBki, wert: z => z.kmw },
  ...behandlungsSpalten<LagerstandZeile>(),
  { kopf: 'Anmerkungen', typ: 'text', wert: z => z.anmerkung },
]

export const SPALTEN_LAGERBEWEGUNGEN: CsvSpalte<LagerbewegungZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'BelegNr.', typ: 'code', wert: z => z.beleg },
  ...merkmalSpalten<LagerbewegungZeile>(),
  { kopf: 'ChargenNr.', typ: 'code', wert: z => z.chargenNr },
  { kopf: 'offener Wein / Flasche', typ: 'text', wert: z => z.gebindeArt },
  { kopf: 'Gebinde', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Nennvolumen in lt.', typ: 'dezimal', stellen: 3, wert: z => z.nennvolumen },
  { kopf: 'Anfangsmenge in St.', typ: 'ganzzahl', wert: z => z.anfangStk },
  { kopf: 'Buchungsmenge in St.', typ: 'ganzzahl', wert: z => z.buchungStk },
  { kopf: 'Anfangsmenge in lt.', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.anfangLiter },
  { kopf: 'Buchungsmenge in lt.', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.buchungLiter },
  { kopf: 'Lesegradation in KMW', typ: 'dezimal', stellen: STELLEN.kmwBki, wert: z => z.kmw },
  ...behandlungsSpalten<LagerbewegungZeile>(),
  { kopf: 'Buchungsart BSM', typ: 'code', wert: z => z.buchungsartBsm },
  { kopf: 'Buchungsart', typ: 'text', wert: z => z.buchungsart },
  { kopf: 'Name Käufer', typ: 'text', wert: z => z.kaeufer },
  { kopf: 'Adresse Käufer', typ: 'text', wert: z => z.kaeuferAdresse },
  { kopf: 'Name Verkäufer', typ: 'text', wert: z => z.verkaeufer },
  { kopf: 'Adresse Verkäufer', typ: 'text', wert: z => z.verkaeuferAdresse },
  { kopf: 'Anmerkungen', typ: 'text', wert: z => z.anmerkung },
  { kopf: 'Behandlungen/Maßnahmen 1', typ: 'text', wert: leer },
  { kopf: 'Behandlungen/Maßnahmen 2', typ: 'text', wert: leer },
  { kopf: 'Behandlungen/Maßnahmen 3', typ: 'text', wert: leer },
  { kopf: 'Behandlungen/Maßnahmen 4', typ: 'text', wert: leer },
  { kopf: 'Behandlungen/Maßnahmen 5', typ: 'text', wert: leer },
]
