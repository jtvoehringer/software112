// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// ── Mischungsrechnung (KAN-76, 29.09.2026): Herkunftsanteile einer Charge zeitrichtig ─────────────────────────
//
// Reiner Rechenkern ohne Datenbank (isomorph, node:test). Alle Bewegungen der beteiligten Chargen werden
// chronologisch abgespielt – Datum, dann Erfassungszeit, dann Art (Zugang vor Übertrag vor Abgang), dann ID:
//   • Zugang (Pressung – nach kg auf die GST verteilt –, Zukauf, Eröffnungsbestand) fügt Herkunfts-Liter hinzu,
//   • Abgang (Füllung, Tankverkauf, Schwund, Umzug/Verschnitt aus dem Betrieb hinaus) entnimmt anteilig,
//   • Übertrag (Umzug, Filtration, Verschnitt) entnimmt anteilig aus den Quellen und gibt genau diese Mischung
//     an die Ziele (Schwund beim Umzug: Ziele bekommen weniger, aber dieselbe Zusammensetzung).
// So gilt: 5.000 L Riesling − 4.500 L Füllung + 48 L Grüner Veltliner → 91,2 % / 8,8 % (Ticket-Beispiel), und
// eine Füllung zeigt die Zusammensetzung unmittelbar vor ihrer Abfüllung.
//
// Entscheidungen Jörgen (29.09.2026): Bestand ≠ Saldo nur warnen (Anteile beziehen sich auf den gebuchten
// Bestand); Stichtag abrufbar; Reihenfolge am selben Tag nach Erfassungszeit.
//
// Die Lader stehen in blendKomposition.ts (Supabase); Chips, Blend-Protokoll, Rückverfolgung und CSV nutzen
// nur diesen Kern. Ohne '@/'-Importe.

export type HerkunftTyp = 'pressung' | 'zukauf' | 'eroeffnungsbestand' | 'unbekannt'

export type HerkunftInfo = {
  typ: HerkunftTyp
  rebsorte: string | null
  jahrgang: number | null
  /** Ried (Weingarten) */
  weingarten_name: string | null
  /** KAN-110: amtliche Ried der Lage (lagen.amtliche_ried) – Grundlage der 85-%-Regel; fehlt = nicht gepflegt */
  ried?: string | null
  gst_nr: string | null
  katastralgemeinde: string | null
  ernte_datum: string | null
  kmw: number | null
  /** KAN-131: °Oe und gemessene Einheit der Quelle (Lese, Zukauf, Eröffnungsbestand); gemischte Einträge: aus °KMW */
  oechsle?: number | null
  mostgewicht_einheit?: string | null
  /** Lieferant (nur Zukauf) */
  zukauf_von: string | null
}

/** Eine Herkunft mit Litern (Schlüssel fasst gleiche Herkünfte zusammen) */
export type HerkunftLiter = { key: string; liter: number; info: HerkunftInfo }

type Basis = {
  /** eindeutige ID des Ereignisses (Tabelle:ID) – Gleichstand-Regel und Bezug der Entnahmen */
  id: string
  /** Kalendertag 'JJJJ-MM-TT'; '' = vor allem anderen (Eröffnungsbestand) */
  datum: string
  /** Erfassungszeit (ISO) – Reihenfolge am selben Tag; null = zuletzt */
  erfasst: string | null
}

export type Ereignis =
  | (Basis & { art: 'zugang'; charge: string; herkunft: HerkunftLiter[] })
  | (Basis & { art: 'abgang'; charge: string; liter: number; grund: 'fuellung' | 'verkauf' | 'schwund' | 'umzug' | 'verschnitt'; bezug?: string | null })
  | (Basis & { art: 'uebertrag'; grund: 'umzug' | 'verschnitt'; quellen: { charge: string; liter: number }[]; ziele: { charge: string; liter: number }[] })

const EPS = 1e-9
const RANG: Record<Ereignis['art'], number> = { zugang: 0, uebertrag: 1, abgang: 2 }

export function vergleicheEreignisse(a: Ereignis, b: Ereignis): number {
  if (a.datum !== b.datum) return a.datum < b.datum ? -1 : 1
  const ea = a.erfasst ?? '9999', eb = b.erfasst ?? '9999'
  if (ea !== eb) return ea < eb ? -1 : 1
  if (RANG[a.art] !== RANG[b.art]) return RANG[a.art] - RANG[b.art]
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Mischung = Herkunftsschlüssel → Liter (+ Info) */
type Mischung = Map<string, { liter: number; info: HerkunftInfo }>

function summe(m: Mischung): number {
  let s = 0
  for (const v of m.values()) s += v.liter
  return s
}

/** KAN-131: zwei °KMW nach Litern gemittelt (gleiche Herkunft, z. B. mehrere Lesetage desselben Grundstücks);
 *  auf 2 Stellen abgerundet – ohne Wert zählt nur der andere */
export function kmwGemittelt(l1: number, k1: number | null, l2: number, k2: number | null): number | null {
  if (k1 === null) return k2
  if (k2 === null || k1 === k2) return k1
  return Math.floor(((l1 * k1 + l2 * k2) / (l1 + l2)) * 100 + 1e-9) / 100
}

function hinzu(ziel: Mischung, key: string, liter: number, info: HerkunftInfo) {
  if (liter <= EPS) return
  const e = ziel.get(key)
  if (e) {
    // KAN-131: verschiedene Mostgewichte derselben Herkunft nicht verwerfen (vorher galt der erste Eintrag)
    const kmw = kmwGemittelt(e.liter, e.info.kmw, liter, info.kmw)
    if (kmw !== e.info.kmw) e.info = { ...e.info, kmw, oechsle: null, mostgewicht_einheit: 'kmw' }
    e.liter += liter
  } else ziel.set(key, { liter, info })
}

/** Entnimmt `liter` anteilig; liefert die entnommene Mischung und wie viel fehlte */
function entnimm(quelle: Mischung, liter: number): { teil: Mischung; fehlt: number } {
  const teil: Mischung = new Map()
  const bestand = summe(quelle)
  if (liter <= EPS || bestand <= EPS) return { teil, fehlt: Math.max(0, liter) }
  const faktor = Math.min(1, liter / bestand)
  for (const [k, v] of quelle) {
    const weg = v.liter * faktor
    hinzu(teil, k, weg, v.info)
    v.liter -= weg
    if (v.liter <= EPS) quelle.delete(k)
  }
  return { teil, fehlt: Math.max(0, liter - bestand) }
}

export const UNBEKANNT: HerkunftInfo = {
  typ: 'unbekannt', rebsorte: null, jahrgang: null, weingarten_name: null, gst_nr: null, katastralgemeinde: null,
  ernte_datum: null, kmw: null, zukauf_von: null,
}

export type Simulation = {
  /** Bestand je Charge nach dem letzten berücksichtigten Ereignis */
  bestand: Map<string, Mischung>
  /** entnommene Mischung je Abgang (Füllung, Verkauf …) – für „Zusammensetzung unmittelbar vor der Abfüllung“ */
  entnahmen: Map<string, { charge: string; bezug: string | null; teil: Mischung }>
  /** Abgänge größer als der Bestand (Liter je Charge) */
  fehlmengen: Map<string, number>
}

/**
 * Spielt die Ereignisse bis einschließlich `stichtag` ('JJJJ-MM-TT', ohne = alle) ab. Zirkel sind hier
 * unmöglich: jedes Ereignis wird genau einmal in zeitlicher Reihenfolge angewandt.
 */
export function simuliere(ereignisse: readonly Ereignis[], stichtag: string | null = null): Simulation {
  const bestand = new Map<string, Mischung>()
  const entnahmen: Simulation['entnahmen'] = new Map()
  const fehlmengen = new Map<string, number>()
  const von = (c: string) => { let m = bestand.get(c); if (!m) { m = new Map(); bestand.set(c, m) } return m }
  const fehl = (c: string, l: number) => { if (l > 0.005) fehlmengen.set(c, (fehlmengen.get(c) ?? 0) + l) }

  const sortiert = [...ereignisse].filter(e => !stichtag || e.datum <= stichtag).sort(vergleicheEreignisse)
  for (const e of sortiert) {
    if (e.art === 'zugang') {
      const m = von(e.charge)
      for (const h of e.herkunft) hinzu(m, h.key, h.liter, h.info)
    } else if (e.art === 'abgang') {
      const { teil, fehlt } = entnimm(von(e.charge), e.liter)
      fehl(e.charge, fehlt)
      entnahmen.set(e.id, { charge: e.charge, bezug: e.bezug ?? null, teil })
    } else {
      const pool: Mischung = new Map()
      for (const q of e.quellen) {
        const { teil, fehlt } = entnimm(von(q.charge), q.liter)
        fehl(q.charge, fehlt)
        for (const [k, v] of teil) hinzu(pool, k, v.liter, v.info)
      }
      const poolSumme = summe(pool)
      for (const z of e.ziele) {
        if (z.liter <= EPS) continue
        const m = von(z.charge)
        if (poolSumme <= EPS) { hinzu(m, `unbekannt:${e.id}`, z.liter, UNBEKANNT); continue }
        for (const [k, v] of pool) hinzu(m, k, v.liter / poolSumme * z.liter, v.info)
      }
    }
  }
  return { bestand, entnahmen, fehlmengen }
}

// ── Ergebnis: Anteile ─────────────────────────────────────────────────────────────────────────────────────

export type Herkunftsanteil = HerkunftInfo & {
  key: string
  /** Liter bezogen auf die Bezugsmenge (gebuchter Bestand bzw. abgefüllte Liter) */
  liter: number
  /** Prozent, 1 Stelle; Summe genau 100,0 */
  anteil_pct: number
}

/** Größter-Rest-Rundung auf `stellen` Nachkommastellen, Summe = `ziel` (in Rundungseinheiten) */
export function verteileGerundet(werte: readonly number[], ziel: number, stellen: number): number[] {
  const f = 10 ** stellen
  const summeW = werte.reduce((s, w) => s + w, 0)
  if (summeW <= EPS) return werte.map(() => 0)
  const zielE = Math.round(ziel * f)
  const roh = werte.map(w => w / summeW * zielE)
  const basis = roh.map(r => Math.floor(r + 1e-9))
  let rest = zielE - basis.reduce((s, b) => s + b, 0)
  // gleiche Reste (bis auf Gleitkomma-Rauschen): die größere Menge zuerst, dann die Eingabereihenfolge
  const reihenfolge = roh.map((r, i) => ({ i, rest: r - basis[i] }))
    .sort((a, b) => (Math.abs(b.rest - a.rest) > 1e-9 ? b.rest - a.rest : (werte[b.i] - werte[a.i]) || (a.i - b.i)))
  for (const r of reihenfolge) { if (rest <= 0) break; basis[r.i] += 1; rest -= 1 }
  return basis.map(b => b / f)
}

/**
 * KAN-77: Liter auf 2 Stellen nach der Größter-Rest-Methode – die Summe ist genau `ziel` (auf 2 Stellen gerundet),
 * z. B. Liter je Herkunft im Blend-Protokoll (500,00 + 48,00 = 548,00 L statt Einzelrundung mit Rest).
 */
export function verteileLiter(werte: readonly number[], ziel: number): number[] {
  return verteileGerundet(werte, ziel, 2)
}

/**
 * Mischung → Anteile, absteigend nach Litern (Gleichstand alphabetisch nach Schlüssel). `bezugLiter` = die
 * Menge, auf die sich die Liter beziehen (ohne Angabe die Summe der Mischung). Prozent summieren auf 100,0,
 * die Liter genau auf die Bezugsmenge (KAN-77).
 */
export function anteile(m: ReadonlyMap<string, { liter: number; info: HerkunftInfo }>, bezugLiter: number | null = null): Herkunftsanteil[] {
  const eintraege = [...m.entries()].filter(([, v]) => v.liter > EPS)
    .sort((a, b) => (b[1].liter - a[1].liter) || a[0].localeCompare(b[0]))
  const gesamt = eintraege.reduce((s, [, v]) => s + v.liter, 0)
  if (gesamt <= EPS) return []
  const pct = verteileGerundet(eintraege.map(([, v]) => v.liter), 100, 1)
  // KAN-77: Liter nach dem größten Rest statt einzeln gerundet – Summe = Bezugsmenge
  const liter = verteileLiter(eintraege.map(([, v]) => v.liter), bezugLiter ?? gesamt)
  return eintraege.map(([key, v], i) => ({
    key, ...v.info, liter: liter[i], anteil_pct: pct[i],
  }))
}

export type GruppenAnteil = { wert: string; liter: number; anteil_pct: number }

function gruppiere(a: readonly Herkunftsanteil[], wert: (h: Herkunftsanteil) => string): GruppenAnteil[] {
  const m = new Map<string, number>()
  for (const h of a) m.set(wert(h), (m.get(wert(h)) ?? 0) + h.liter)
  const liste = [...m.entries()].sort((x, y) => (y[1] - x[1]) || x[0].localeCompare(y[0], 'de'))
  const pct = verteileGerundet(liste.map(([, l]) => l), 100, 1)
  return liste.map(([w, l], i) => ({ wert: w, liter: rund(l, 2), anteil_pct: pct[i] }))
}

/** Rebsorten-Anteile, absteigend (Gleichstand alphabetisch); ohne Rebsorte: „unbekannt“ */
export function sortenAnteile(a: readonly Herkunftsanteil[]): GruppenAnteil[] {
  return gruppiere(a, h => h.rebsorte?.trim() || 'unbekannt')
}

/** Jahrgangs-Anteile, absteigend (Gleichstand aufsteigend nach Jahr); ohne Jahrgang: „unbekannt“ */
export function jahrgangsAnteile(a: readonly Herkunftsanteil[]): GruppenAnteil[] {
  return gruppiere(a, h => (h.jahrgang == null ? 'unbekannt' : String(h.jahrgang)))
}

// ── Komfort: Zusammensetzung einer Charge bzw. Füllung ───────────────────────────────────────────────────

export type Zusammensetzung = { anteile: Herkunftsanteil[]; warnungen: string[]; saldoLiter: number }

function lt(n: number): string {
  return `${(rund(n, 2)).toLocaleString('de-AT', { maximumFractionDigits: 2 })} L`
}

/**
 * Zusammensetzung einer Charge zum Stichtag. `gebuchterBestand` (heute: weinausbau.menge_liter): weicht der
 * Saldo der Bewegungen um mehr als 0,5 L ab, gibt es eine Warnung und die Liter beziehen sich auf den
 * gebuchten Bestand (Entscheidung Jörgen 29.09.2026).
 */
export function zusammensetzung(
  ereignisse: readonly Ereignis[], charge: string,
  opt: { stichtag?: string | null; gebuchterBestand?: number | null; name?: string | null } = {},
): Zusammensetzung {
  const sim = simuliere(ereignisse, opt.stichtag ?? null)
  const m = sim.bestand.get(charge) ?? new Map()
  const saldo = summe(m)
  const warnungen: string[] = []
  const wer = opt.name ? `Charge „${opt.name}“` : 'Charge'
  for (const [c, l] of sim.fehlmengen) {
    if (c === charge) warnungen.push(`${wer}: Abgänge übersteigen den Bestand um ${lt(l)} – Buchungen prüfen.`)
  }
  const gebucht = opt.gebuchterBestand ?? null
  let bezug: number | null = null
  if (gebucht != null && Math.abs(gebucht - saldo) > 0.5) {
    warnungen.push(`${wer}: Bestand laut Kellerbuch ${lt(gebucht)}, Saldo der Bewegungen ${lt(saldo)} – die Anteile beziehen sich auf den gebuchten Bestand.`)
    bezug = gebucht
  }
  if (saldo <= EPS && (gebucht ?? 0) > 0.5) {
    const unbekannt: Mischung = new Map([[`unbekannt:${charge}`, { liter: gebucht as number, info: UNBEKANNT }]])
    return { anteile: anteile(unbekannt), warnungen, saldoLiter: saldo }
  }
  return { anteile: anteile(m, bezug), warnungen, saldoLiter: saldo }
}

/** Zusammensetzung dessen, was mit den Abgängen `bezug` (z. B. einer Füllung) entnommen wurde */
export function zusammensetzungEntnahme(ereignisse: readonly Ereignis[], bezug: string, stichtag: string | null = null): Zusammensetzung {
  const sim = simuliere(ereignisse, stichtag)
  const m: Mischung = new Map()
  for (const e of sim.entnahmen.values()) {
    if (e.bezug !== bezug) continue
    for (const [k, v] of e.teil) hinzu(m, k, v.liter, v.info)
  }
  return { anteile: anteile(m), warnungen: [], saldoLiter: summe(m) }
}

/**
 * KAN-77: Bestand (Liter) einer Charge unmittelbar nach dem Ereignis `ereignisId` (z. B. 'vs:<verschnitt-id>') –
 * Bezugsmenge für „Anteil am Ergebnis“ eines Verschnitts. null, wenn das Ereignis fehlt.
 */
export function bestandNachEreignis(ereignisse: readonly Ereignis[], charge: string, ereignisId: string): number | null {
  const e = ereignisse.find(x => x.id === ereignisId)
  if (!e) return null
  const sim = simuliere(ereignisse.filter(x => vergleicheEreignisse(x, e) <= 0))
  return summe(sim.bestand.get(charge) ?? new Map())
}
