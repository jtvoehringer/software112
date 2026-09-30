// ── Maßnahmen aliquot auf die GST verteilen – zentrale Anteilsfunktion (KAN-132, 30.09.2026) ─────────────────
//
// Jörgen, 26.09.2026: „Maßnahmen an der Ried: zB Spritzung ist aliquot auf die der Ried zugeordneten GST zu verteilen!
// Wichtig für die Auswertungen!“ Ebenen: GST-Zeile (grundstuecke, Nutzart WI) → Ried (= Weingarten) → Lage → Betrieb.
// Alle Auswertungen (psm-aufzeichnung, Berichte, Cu-Bilanz, Nährstoffbilanz, Weingarten-Detail, Rückverfolgung,
// Kostenrechnung) verteilen über diese Datei – keine andere Stelle rechnet selbst „Menge × Fläche / Summe“.
//
// Regeln (Ticket KAN-132, Entscheidungen 26.09.2026):
//  1. Fläche f_i = Snapshot behandlung_grundstuecke.flaeche_ha, nur wenn leer die aktuelle grundstuecke.flaeche_ha.
//  2. Anteil a_i = f_i / Σf. Σf = 0 → 1/n („ohne Fläche gleichmäßig verteilt“). Fehlt f nur bei einzelnen GST → a_i = 0
//     mit Warnung „GST ohne Fläche – kein Anteil“.
//  3. Absolute Werte × a_i: „Menge gesamt“ (Spritzung = Spritzbrühe in l, Düngung = Düngermenge; Einheit bleibt),
//     Mittelmenge (mittelmenge() aus psm.ts – bei Spritzungen nie aus „Menge gesamt“), Cu/N/P kg, Kosten.
//  4. Werte je ha, je hl oder in % bleiben je GST gleich (Aufwand kg/ha, Wasser l/ha, Konzentration …) – nie summieren.
//  5. Mittelmenge je GST = Mittelmenge der Maßnahme × a_i (nie getrennt „Aufwand × f_i“ – so stimmt Σ auch bei Σf = 0).
//  6. Cu je ha je GST ungerundet: bei gleichmäßiger Ausbringung für alle GST der Maßnahme Cu / Σf (nie aus gerundeten
//     Anteilen zurückrechnen: 0,0001 ha × 0,525 kg/ha).
//  7. Rundung ausgewiesener Werte (Menge 3, Cu 4, N/P 3, € 2 Stellen) nach der Methode des größten Rests, ganzzahlig in
//     Rundungseinheiten: alle abrunden, fehlende Einheiten an die größten Reste; Gleichstand: größere Fläche, dann KG,
//     dann GST-Nr. numerisch, dann grundstueck_id. Σ Anteile = gerundeter Gesamtwert.
//  8. Summen je Ebene = Σ der gerundeten GST-Anteile (summiereJe); Mittelmengen nur je Mittel × Einheit.
//  9. Maßnahme nur am Weingarten (keine Verknüpfung): mit opt.wiGstJeWeingarten (Bilanzen) auf dessen aktuelle WI-GST
//     nach aktueller Fläche verteilt, Vermerk „am Weingarten erfasst“; ohne diese Angabe eine Zeile je Weingarten
//     (psm-aufzeichnung erfindet keine GST-Zeilen). Ganz ohne Ort: nicht verteilbar (ohneOrt, Warnung).
// 10. Teilflächen: gerechnet je Zeile in grundstuecke (grundstueckId), nicht je GST-Nummer.
//
// Rein (keine Datenbank, kein server-only): Client-Komponenten und node:test nutzen dieselbe Rechnung.

import { mittelmenge, mittelmengeKg, spritzbruehe, type MittelEinheit, type PsmBehandlung, type PsmGrundstueck } from '@/lib/behoerden/psm'

export const STELLEN_ANTEIL = { menge: 3, cu: 4, np: 3, eur: 2 } as const

export const VERMERK_AM_WEINGARTEN = 'am Weingarten erfasst'
export const WARNUNG_GLEICH = 'ohne Fläche gleichmäßig verteilt'
export const WARNUNG_GST_OHNE_FLAECHE = 'GST ohne Fläche – kein Anteil'

export type FlaechenQuelle = 'snapshot' | 'aktuell' | 'gleich' | 'weingarten'

/** Ein aktuelles WI-GST eines Weingartens (für Maßnahmen, die nur am Weingarten erfasst sind) */
export type WiGst = Pick<PsmGrundstueck, 'grundstueckId' | 'gstNr' | 'kgNr' | 'kgName' | 'weingartenId' | 'weingarten' | 'ried' | 'lageId'> & { flaecheHa: number | null }

export type GstAnteil = {
  grundstueckId: string | null
  gstNr: string | null
  kgNr: string | null
  kgName: string | null
  weingartenId: string | null
  weingarten: string | null
  /** Lage (lagen.name, sonst weingarten.ried) */
  lage: string | null
  lageId: string | null
  flaecheHa: number | null
  flaechenQuelle: FlaechenQuelle
  /** Anteil an der Maßnahme (0…1, ungerundet) */
  anteil: number
  /** „Menge gesamt“ anteilig (Spritzung: Brühe, Düngung: Düngermenge), Einheit wie erfasst */
  menge: number | null
  mengeEinheit: string | null
  /** Mittel- bzw. Düngermenge anteilig (mittelmenge(), 3 Stellen) */
  mittel: number | null
  mittelEinheit: MittelEinheit | null
  mittelBasis: string | null
  /** Spritzbrühe anteilig (l; spritzbruehe() – „Menge gesamt“ bzw. Wasser × Fläche), nur Spritzungen */
  bruehe: number | null
  cuKg: number | null
  nKg: number | null
  pKg: number | null
  kostenEur: number | null
  /** Cu je ha dieser Maßnahme auf diesem GST, ungerundet (Regel 6) */
  cuKgHa: number | null
  vermerk: string | null
}

export type Verteilung = {
  behandlungId: string
  jahr: number
  mittelName: string | null
  anteile: GstAnteil[]
  /** Σ Fläche der verteilten GST (ha, ungerundet) */
  flaecheHa: number
  /** Maßnahme ohne Grundstück und ohne Weingarten – nicht verteilbar, nur Betriebssumme */
  ohneOrt: boolean
  warnungen: string[]
}

export type VerteilOptionen = {
  /** Cu-Gehalt des Mittels in % (cuGehalt() aus cu.ts); null/undefined = kein Cu */
  cuPct?: number | null
  /** Kosten der Maßnahme in € (werden anteilig verteilt) */
  kostenEur?: number | null
  /** Mittelmenge in l für Cu als kg zählen (Dichte 1, wie die Cu-Bilanz) */
  literAlsKg?: boolean
  /** aktuelle WI-GST je Weingarten – nur dann werden Maßnahmen am Weingarten auf GST verteilt (Regel 9) */
  wiGstJeWeingarten?: ReadonlyMap<string, readonly WiGst[]>
}

const KOLLATOR = new Intl.Collator('de', { numeric: true, sensitivity: 'base' })

function endlich(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/**
 * Methode des größten Rests (Regel 7): verteilt `gesamt` (auf `stellen` gerundet) nach `gewichte` so, dass die
 * gerundeten Anteile genau `gesamt` ergeben. Gleichstand beim Rest: größeres Gewicht, dann Reihenfolge
 * (Aufrufer sortiert nach KG, GST-Nr., id). Negative oder fehlende Gewichte zählen als 0; Σ Gewichte = 0 → gleich.
 */
export function verteileMitRest(gesamt: number, gewichte: readonly number[], stellen: number): number[] {
  const n = gewichte.length
  if (n === 0) return []
  const faktor = 10 ** stellen
  const einheiten = Math.round(gesamt * faktor)
  const g = gewichte.map(w => (endlich(w) && w > 0 ? w : 0))
  const summe = g.reduce((s, w) => s + w, 0)
  const basis = summe > 0 ? g : g.map(() => 1)
  const nenner = summe > 0 ? summe : n
  const vorzeichen = einheiten < 0 ? -1 : 1
  const betrag = Math.abs(einheiten)
  const roh = basis.map(w => betrag * w / nenner)
  // Gleitkomma: 1049,9999… zählt als 1050
  const ganz = roh.map(r => Math.floor(r + 1e-9))
  let fehlt = betrag - ganz.reduce((s, x) => s + x, 0)
  const reihenfolge = roh
    .map((r, i) => ({ i, rest: r - ganz[i], w: basis[i] }))
    .sort((a, b) => (Math.abs(b.rest - a.rest) > 1e-9 ? b.rest - a.rest : (b.w - a.w) || (a.i - b.i)))
  for (let k = 0; fehlt > 0 && k < reihenfolge.length; k++, fehlt--) ganz[reihenfolge[k].i] += 1
  return ganz.map(x => (vorzeichen * x) / faktor)
}

/** Reihenfolge für den Gleichstand (Regel 7): größere Fläche, KG, GST-Nr. numerisch, grundstueck_id */
function vergleicheOrte(a: { flaecheHa: number | null; kgNr: string | null; gstNr: string | null; grundstueckId: string | null }, b: typeof a): number {
  return ((b.flaecheHa ?? 0) - (a.flaecheHa ?? 0))
    || KOLLATOR.compare(a.kgNr ?? '', b.kgNr ?? '')
    || KOLLATOR.compare(a.gstNr ?? '', b.gstNr ?? '')
    || (a.grundstueckId ?? '').localeCompare(b.grundstueckId ?? '')
}

type Ort = Omit<GstAnteil, 'anteil' | 'menge' | 'mengeEinheit' | 'mittel' | 'mittelEinheit' | 'mittelBasis' | 'bruehe' | 'cuKg' | 'nKg' | 'pKg' | 'kostenEur' | 'cuKgHa'>

/** Orte der Maßnahme mit Fläche und Quelle (Regeln 1, 9, 10); doppelte grundstueck_id nur einmal */
function orteDerMassnahme(b: PsmBehandlung, opt: VerteilOptionen): { orte: Ort[]; ohneOrt: boolean } {
  const gst = b.grundstuecke.filter(g => g.grundstueckId !== null)
  const gesehen = new Set<string>()
  const orte: Ort[] = []
  for (const g of gst) {
    if (gesehen.has(g.grundstueckId as string)) continue
    gesehen.add(g.grundstueckId as string)
    orte.push({
      grundstueckId: g.grundstueckId, gstNr: g.gstNr, kgNr: g.kgNr, kgName: g.kgName, weingartenId: g.weingartenId, weingarten: g.weingarten,
      lage: g.ried, lageId: g.lageId, flaecheHa: endlich(g.flaecheHa) ? g.flaecheHa : null,
      flaechenQuelle: g.flaechenQuelle === 'aktuell' ? 'aktuell' : 'snapshot', vermerk: null,
    })
  }
  if (orte.length > 0) return { orte, ohneOrt: false }
  // Regel 9: nur am Weingarten erfasst
  const wg = b.grundstuecke.filter(g => g.grundstueckId === null && g.weingartenId)
  if (wg.length === 0) return { orte: [], ohneOrt: true }
  for (const w of wg) {
    const wi = opt.wiGstJeWeingarten?.get(w.weingartenId as string)
    if (wi && wi.length > 0) {
      for (const g of wi) {
        if (!g.grundstueckId || gesehen.has(g.grundstueckId)) continue
        gesehen.add(g.grundstueckId)
        orte.push({
          grundstueckId: g.grundstueckId, gstNr: g.gstNr, kgNr: g.kgNr, kgName: g.kgName ?? null, weingartenId: g.weingartenId ?? w.weingartenId,
          weingarten: g.weingarten ?? w.weingarten, lage: g.ried ?? w.ried, lageId: g.lageId ?? w.lageId,
          flaecheHa: endlich(g.flaecheHa) ? g.flaecheHa : null, flaechenQuelle: 'weingarten', vermerk: VERMERK_AM_WEINGARTEN,
        })
      }
    } else {
      orte.push({
        grundstueckId: null, gstNr: null, kgNr: null, kgName: null, weingartenId: w.weingartenId, weingarten: w.weingarten,
        lage: w.ried, lageId: w.lageId, flaecheHa: endlich(w.flaecheHa) ? w.flaecheHa : null,
        flaechenQuelle: 'weingarten', vermerk: VERMERK_AM_WEINGARTEN,
      })
    }
  }
  return { orte, ohneOrt: false }
}

/**
 * Verteilt eine Maßnahme auf ihre GST-Zeilen (Regeln im Dateikopf). Die Anteile stehen in der Reihenfolge
 * größere Fläche, KG, GST-Nr. – Summen je Ebene über summiereJe().
 */
export function verteileMassnahme(b: PsmBehandlung, opt: VerteilOptionen = {}): Verteilung {
  const warnungen: string[] = []
  const { orte, ohneOrt } = orteDerMassnahme(b, opt)
  const mittelName = b.psm?.name ?? b.duengemittel?.name ?? null
  if (ohneOrt) {
    warnungen.push('Maßnahme ohne Grundstück und ohne Ried – nicht verteilbar, nur in der Betriebssumme.')
    return { behandlungId: b.id, jahr: b.jahr, mittelName, anteile: [], flaecheHa: 0, ohneOrt: true, warnungen }
  }
  orte.sort(vergleicheOrte)

  // Regel 2: Anteile
  const mitFlaeche = orte.filter(o => (o.flaecheHa ?? 0) > 0)
  const summeF = mitFlaeche.reduce((s, o) => s + (o.flaecheHa as number), 0)
  let gewichte: number[]
  if (summeF > 0) {
    gewichte = orte.map(o => ((o.flaecheHa ?? 0) > 0 ? (o.flaecheHa as number) : 0))
    if (mitFlaeche.length < orte.length) warnungen.push(WARNUNG_GST_OHNE_FLAECHE)
  } else {
    gewichte = orte.map(() => 1)
    for (const o of orte) o.flaechenQuelle = 'gleich'
    if (orte.length > 1) warnungen.push(WARNUNG_GLEICH)
  }
  const summeG = gewichte.reduce((s, w) => s + w, 0)
  const anteil = gewichte.map(w => w / summeG)

  // Regel 3/5/7: absolute Werte verteilen
  const verteile = (gesamt: number | null, stellen: number) => (gesamt === null ? orte.map(() => null) : verteileMitRest(gesamt, gewichte, stellen))
  const menge = verteile(endlich(b.mengeGesamt) ? b.mengeGesamt : null, STELLEN_ANTEIL.menge)
  const mm = mittelmenge(b)
  const mittel = verteile(mm.menge, STELLEN_ANTEIL.menge)
  const bruehe = verteile(spritzbruehe(b), STELLEN_ANTEIL.menge)
  const mmKg = mittelmengeKg(b, { literAlsKg: !!opt.literAlsKg })
  const cuPct = endlich(opt.cuPct) ? opt.cuPct : null
  const cuRoh = mmKg && cuPct !== null ? mmKg.kg * cuPct / 100 : null
  const cu = verteile(cuRoh, STELLEN_ANTEIL.cu)
  const nPct = b.art === 'duengung' ? b.duengemittel?.nPct ?? null : null
  const pPct = b.art === 'duengung' ? b.duengemittel?.pPct ?? null : null
  const npKg = b.art === 'duengung' ? mittelmengeKg(b, { literAlsKg: false }) : null
  const n = verteile(npKg && endlich(nPct) ? npKg.kg * nPct / 100 : null, STELLEN_ANTEIL.np)
  const p = verteile(npKg && endlich(pPct) ? npKg.kg * pPct / 100 : null, STELLEN_ANTEIL.np)
  const kosten = verteile(endlich(opt.kostenEur) ? opt.kostenEur : null, STELLEN_ANTEIL.eur)
  // Regel 6: Cu je ha je GST ungerundet (bei „gleich“ ohne Fläche nicht bestimmbar). Bei Aufwand je ha direkt
  // Aufwand × Cu-Gehalt – die Mittelmenge ist schon auf 3 Stellen gerundet (1,5 kg/ha × 1,0001 ha = 1,50015 → 1,5).
  const jeHa = b.aufwand !== null && (b.aufwandEinheit === 'kg_ha' || (b.aufwandEinheit === 'l_ha' && opt.literAlsKg)) && mmKg !== null
  const cuKgHa = cuRoh === null || summeF <= 0 ? null
    : jeHa && cuPct !== null ? (b.aufwand as number) * cuPct / 100
    : cuRoh / summeF

  const anteile: GstAnteil[] = orte.map((o, i) => ({
    ...o,
    anteil: anteil[i],
    menge: menge[i], mengeEinheit: menge[i] === null ? null : b.mengeEinheit,
    mittel: mittel[i], mittelEinheit: mittel[i] === null ? null : mm.einheit, mittelBasis: mittel[i] === null ? null : mm.basis,
    bruehe: bruehe[i],
    cuKg: cu[i], nKg: n[i], pKg: p[i], kostenEur: kosten[i],
    cuKgHa: cuKgHa !== null && gewichte[i] > 0 ? cuKgHa : cuKgHa !== null ? 0 : null,
  }))
  return { behandlungId: b.id, jahr: b.jahr, mittelName, anteile, flaecheHa: summeF, ohneOrt: false, warnungen }
}

export type Ebene = 'grundstueck' | 'weingarten' | 'lage' | 'betrieb'

export type EbenenSumme = {
  schluessel: string
  /** Anzeige: GST-Nr. bzw. Ried- bzw. Lage-Name bzw. „Betrieb“ */
  name: string
  cuKg: number
  nKg: number
  pKg: number
  kostenEur: number
  /** Mittelmengen je „Mittel|Einheit“ (nie über Mittel oder Einheiten hinweg addieren) */
  mittel: Map<string, { mittel: string; einheit: MittelEinheit; menge: number }>
  /** „Menge gesamt“ je Einheit (Brühe l, Düngermenge kg …) */
  menge: Map<string, number>
  /** Maßnahmen mit Anteil an dieser Ebene */
  massnahmen: Set<string>
}

const OHNE = '_ohne'

function schluesselJe(a: GstAnteil, ebene: Ebene): { schluessel: string; name: string } {
  if (ebene === 'betrieb') return { schluessel: 'betrieb', name: 'Betrieb' }
  if (ebene === 'lage') return { schluessel: a.lageId ?? (a.lage ? `name:${a.lage}` : OHNE), name: a.lage ?? 'Ohne Lage' }
  if (ebene === 'weingarten') return { schluessel: a.weingartenId ?? OHNE, name: a.weingarten ?? 'Ohne Ried' }
  return { schluessel: a.grundstueckId ?? `wg:${a.weingartenId ?? OHNE}`, name: a.gstNr ? `${a.kgNr ? `KG ${a.kgNr} ` : ''}GST ${a.gstNr}` : (a.weingarten ?? 'Ohne GST') }
}

/** Summen der gerundeten GST-Anteile je Ebene (Regel 8); Werte auf die jeweilige Stelle gerundet */
export function summiereJe(verteilungen: readonly Verteilung[], ebene: Ebene): Map<string, EbenenSumme> {
  const r = (x: number, s: number) => Math.round(x * 10 ** s) / 10 ** s
  const erg = new Map<string, EbenenSumme>()
  for (const v of verteilungen) {
    for (const a of v.anteile) {
      const { schluessel, name } = schluesselJe(a, ebene)
      const e = erg.get(schluessel) ?? { schluessel, name, cuKg: 0, nKg: 0, pKg: 0, kostenEur: 0, mittel: new Map(), menge: new Map(), massnahmen: new Set<string>() }
      e.cuKg = r(e.cuKg + (a.cuKg ?? 0), STELLEN_ANTEIL.cu)
      e.nKg = r(e.nKg + (a.nKg ?? 0), STELLEN_ANTEIL.np)
      e.pKg = r(e.pKg + (a.pKg ?? 0), STELLEN_ANTEIL.np)
      e.kostenEur = r(e.kostenEur + (a.kostenEur ?? 0), STELLEN_ANTEIL.eur)
      if (a.mittel !== null && a.mittelEinheit && v.mittelName) {
        const k = `${v.mittelName}|${a.mittelEinheit}`
        const m = e.mittel.get(k) ?? { mittel: v.mittelName, einheit: a.mittelEinheit, menge: 0 }
        m.menge = r(m.menge + a.mittel, STELLEN_ANTEIL.menge)
        e.mittel.set(k, m)
      }
      if (a.menge !== null) e.menge.set(a.mengeEinheit ?? '', r((e.menge.get(a.mengeEinheit ?? '') ?? 0) + a.menge, STELLEN_ANTEIL.menge))
      e.massnahmen.add(v.behandlungId)
      erg.set(schluessel, e)
    }
  }
  return erg
}

/**
 * Höchste Cu-Belastung je GST-Zeile und Jahr in kg/ha (Regel 6): Σ der ungerundeten cuKgHa aller Maßnahmen des
 * Jahres auf dieser GST-Zeile, davon das Maximum je Schlüssel der Ebene (z. B. je Weingarten). Map Schlüssel → kg/ha.
 */
export function hoechsteGstBelastung(verteilungen: readonly Verteilung[], ebene: Exclude<Ebene, 'grundstueck'>): Map<string, number> {
  const jeGst = new Map<string, { kgHa: number; a: GstAnteil }>()
  for (const v of verteilungen) {
    for (const a of v.anteile) {
      if (a.cuKgHa === null || !a.grundstueckId) continue
      const k = `${v.jahr}|${a.grundstueckId}`
      const e = jeGst.get(k) ?? { kgHa: 0, a }
      e.kgHa += a.cuKgHa
      jeGst.set(k, e)
    }
  }
  const erg = new Map<string, number>()
  for (const { kgHa, a } of jeGst.values()) {
    const { schluessel } = schluesselJe(a, ebene)
    erg.set(schluessel, Math.max(erg.get(schluessel) ?? 0, kgHa))
  }
  return erg
}
