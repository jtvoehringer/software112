// ── Weinbestandsmeldung – Bestand zum STICHTAG (Behördenmeldung, KAN-43 Etappe 1, 02.10.2026) ──────
//
// Genau der Inhalt des Abschnitts „Weinbestandsmeldung“ auf /reports/ama:
//   A – Flaschenwein            je Füllung: Flaschen am Ende des Stichtags
//   B – Wein in Gebinden        je Charge (weinausbau) mit ihrem Gebinde: Liter am Ende des Stichtags
// Stichtag: ?stichtag=JJJJ-MM-TT, Standard 31.07. des laufenden Weinwirtschaftsjahres (standardStichtag),
// „heute“ bzw. das heutige Datum = Ist-Bestand (bis 02.10.2026 das einzige Verhalten).
//
// Rechenweg (bestandZum.ts): heutiger Bestand − Buchungen nach dem Stichtag.
//   Gebinde: Buchungen je Charge aus ladeBewegungenBetrieb() – dieselbe Ereignislogik wie das Bewegungsbuch
//            (Zukauf, Pressung, Umzug/Filtration, Schwund, Abfüllung, Tankverkauf, Verschnitt, Eröffnungsbestand,
//            Storno-Gegenbuchungen am Storno-Tag), aber für den ganzen Betrieb in einem Zug. Heutiger Bestand =
//            menge_liter aktiver, nicht abgeschlossener Chargen (wie bisher), Gebinde = heutiges Gebinde der Charge.
//   Flaschen: Abfüllung (+ Flaschen am Abfülldatum), fuellung_bewegungen (Inventur, Bruch, Verkauf … KAN-35/149),
//            Flaschenverkäufe ohne Bewegungszeile (vor KAN-149) aus verkauf_positionen samt Storno am Storno-Tag,
//            Storno einer Füllung (Restbestand am Storno-Tag ab).
// Stammdaten (Bezeichnung, Jahrgang, Rebsorte, Farbe, Qualitätsstufe) sind die heutigen.
//
// Druckseite und CSV nutzen diese Ladefunktion; Zeilenwerte sind gerundet (Liter 2,
// hl 3 Stellen wie bisher im Ausdruck), die Summen im Ausdruck addieren genau diese.
// Farbe (Weinart der Charge, sonst aus der BKI-Kürzelliste) und Qualitätsstufe je Position
// (Review 25.09.2026) – danach gliedert das amtliche Formular.
// Gebinde der Kellergemeinschaft: Namen über lade_behaelter (SECURITY DEFINER) –
// fremde Gebinde heißen „a1 · Weingut X“; Wein anderer Betriebe zählt nie mit.

import { STELLEN, runden, wienHeute, type CsvSpalte } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { bkiFarbe, bkiRebsorteKuerzel } from '@/lib/wein/bki_kuerzel'
import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'
import { datumAT, kuerzelWarnungen, textOderNull, zahlOderNull } from './ernte_hilfen'
import { ladeBewegungenBetrieb, type BetriebsBewegungen } from './bewegungsbuch'
import { bestandAmStichtag, fruehesterTag, standardStichtag, type MengenBuchung, type StichtagsBestand } from './bestandZum'
import { istTag, tag } from './kellerbuch-hilfen'
import { parameterFehler, type ParameterFehler } from './typen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

/** hl im Bestand mit 3 Stellen (wie der bisherige Ausdruck) */
export const HL_STELLEN_BESTAND = 3
/** Flaschengröße, wenn an der Füllung keine erfasst ist (wie bisher im Ausdruck) */
export const FLASCHE_ML_STANDARD = 750
/** Unter einem halben Zentiliter gilt eine Charge als leer (menge_liter ist numeric(10,2)) */
const LEER_UNTER = 0.005

export { standardStichtag }

export type BestandZeile = {
  abschnitt: 'A' | 'B'
  /** Stichtag 'JJJJ-MM-TT' (Bestand am Ende dieses Tages) */
  bestandAm: string
  bezeichnung: string | null
  jahrgang: number | null
  rebsorte: string | null
  kuerzel: string | null
  /** Rot/Weiß/Rosé – Weinart der Charge, sonst aus der BKI-Kürzelliste; null = nicht bestimmbar */
  farbe: string | null
  /** Qualitätsstufe (Anzeige-Bezeichnung) */
  qualitaet: string | null
  /** nur B: Gebinde (fremde Gebinde „a1 · Weingut X“) */
  behaelter: string | null
  /** nur A */
  flaschengroesseMl: number | null
  /** nur A */
  flaschen: number | null
  liter: number | null
  hl: number | null
}

export type BestandsmeldungDaten = {
  /** Stichtag 'JJJJ-MM-TT' */
  stichtag: string
  /** Abrufdatum 'JJJJ-MM-TT' (Wiener Zeit) */
  heute: string
  flaschen: BestandZeile[]
  gebinde: BestandZeile[]
  /** A und B in einer Liste (CSV) */
  zeilen: BestandZeile[]
  summe: { flaschen: number; flaschenHl: number; gebindeHl: number; gesamtHl: number }
  warnungen: string[]
}

const FARBE_LABEL: Record<string, string> = { rot: 'Rot', weiss: 'Weiß', rose: 'Rosé' }

/** Farbe: Weinart der Charge (rot/weiss/rose), sonst aus der BKI-Kürzelliste */
function farbeAus(weinart: unknown, rebsorte: string | null): string | null {
  if (typeof weinart === 'string' && FARBE_LABEL[weinart]) return FARBE_LABEL[weinart]
  const f = bkiFarbe(rebsorte)
  return f ? FARBE_LABEL[f] : null
}

export const ABSCHNITT_LABEL: Record<BestandZeile['abschnitt'], string> = {
  A: 'A – Flaschenwein',
  B: 'B – Wein in Gebinden (Tank / Fass)',
}

/** Kennzeichnung für Dateiname und BKI-Berichtsname */
export function bestandKennzeichnung(stichtag: string): string {
  return `Stichtag ${stichtag}`
}

/**
 * ?stichtag= der Druckseite und der CSV: leer → 31.07. des laufenden Weinwirtschaftsjahres, „heute“ → Abrufdatum,
 * sonst JJJJ-MM-TT (nicht in der Zukunft).
 */
export function stichtagParameter(sp: URLSearchParams, heute: string = wienHeute()): { stichtag: string } | ParameterFehler {
  const roh = (sp.get('stichtag') ?? '').trim()
  if (!roh) return { stichtag: standardStichtag(heute) }
  if (roh.toLowerCase() === 'heute') return { stichtag: heute }
  if (!istTag(roh)) return parameterFehler('Ungültiger Stichtag – bitte als JJJJ-MM-TT angeben (z. B. ?stichtag=2026-07-31).')
  if (roh > heute) return parameterFehler(`Der Stichtag ${datumAT(roh)} liegt in der Zukunft – ein Bestand ist nur bis heute (${datumAT(heute)}) bestimmbar.`)
  return { stichtag: roh }
}

const anzahl = (n: number, eins: string, mehr: string) => `${n} ${n === 1 ? eins : mehr}`

/** Namen für Hinweise: höchstens fünf, Rest mit „…“ */
const auszug = (namen: readonly string[]) => [...new Set(namen)].slice(0, 5).join(', ') + (new Set(namen).size > 5 ? ' …' : '')

// ── Grundlage und Bestand je Posten (KAN-43 Etappe 2: auch für die BSM nach Buchungsarten, lib/behoerden/bsm.ts) ──

/** Flaschenbuchung einer Füllung (Stück, + Zugang, − Abgang) mit Herkunft der Buchung */
export type FlaschenBuchung = MengenBuchung & {
  /** 'abfuellung' | 'storno_fuellung' | fuellung_bewegungen.art | 'verkauf_alt' | 'verkauf_alt_storno' */
  art: string
  verkaufspostenId: string | null
}

/** Charge mit heutigem Bestand und allen Kellerbuchungen */
export type ChargenPosten = { c: R; heuteLiter: number; buchungen: MengenBuchung[]; beginn: string | null }

/** Füllung mit heutigem Bestand (Stück) und allen Flaschenbuchungen samt Abfüllung und Storno */
export type FuellungsPosten = {
  f: R
  heuteStk: number
  buchungen: FlaschenBuchung[]
  beginn: string | null
  /** Flaschengröße (ml), ohne Angabe FLASCHE_ML_STANDARD */
  ml: number
  mlErfasst: boolean
}

export type BestandsGrundlage = {
  betrieb: BetriebsBewegungen
  chargen: ChargenPosten[]
  fuellungen: FuellungsPosten[]
  /** Kellerbuchungen ohne Datum (zählen als vor jedem Stichtag) */
  ohneDatum: number
  /** deaktivierte Füllungen mit Restbestand ohne Storno-Datum – nicht enthalten */
  deaktiviertOhneDatum: number
}

/** Alle Daten für den Bestand zu beliebigen Stichtagen – einmal geladen (Bestandsmeldung, BSM) */
export async function ladeBestandsGrundlage(supabase: Client, tenantId: string): Promise<BestandsGrundlage> {
  const [betrieb, fbRes, vpRes] = await Promise.all([
    ladeBewegungenBetrieb(supabase, tenantId),
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('fuellung_bewegungen') as any)
        .select('id, fuellung_id, datum, art, menge_stk, verkaufsposten_id')
        .eq('tenant_id', tenantId)
        .order('datum')
        .order('id'),
    ),
    alle<R>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('verkauf_positionen') as any)
        .select('id, menge, fuellung_id, verkaufsposten_id, verkaufsposten:verkaufsposten_id(datum, storniert, storniert_am)')
        .eq('tenant_id', tenantId)
        .eq('typ', 'flasche')
        .not('fuellung_id', 'is', null)
        .order('id'),
    ),
  ])
  if (fbRes.error) throw new Error(`Laden fehlgeschlagen (fuellung_bewegungen): ${fbRes.error.message}`)
  if (vpRes.error) throw new Error(`Laden fehlgeschlagen (verkauf_positionen): ${vpRes.error.message}`)

  // Chargen: Buchungen aus den Bewegungen (Kellerbehandlungen ohne Menge zählen nicht)
  const buchungenJeCharge = new Map<string, MengenBuchung[]>()
  const ersterTagJeCharge = new Map<string, string>()
  let ohneDatum = 0
  for (const b of betrieb.bewegungen) {
    if (!b.chargeId || b.menge === 0) continue
    if (!b.datum) ohneDatum++
    const liste = buchungenJeCharge.get(b.chargeId) ?? []
    liste.push({ datum: b.datum, menge: b.menge })
    buchungenJeCharge.set(b.chargeId, liste)
    const erster = ersterTagJeCharge.get(b.chargeId)
    if (b.datum && (!erster || b.datum < erster)) ersterTagJeCharge.set(b.chargeId, b.datum)
  }
  const chargen: ChargenPosten[] = []
  for (const c of betrieb.chargen) {
    const heuteLiter = c.aktiv && c.status !== 'abgeschlossen' ? (zahlOderNull(c.menge_liter) ?? 0) : 0
    const buchungen = buchungenJeCharge.get(c.id) ?? []
    if (heuteLiter < LEER_UNTER && buchungen.length === 0) continue
    chargen.push({ c, heuteLiter, buchungen, beginn: fruehesterTag(ersterTagJeCharge.get(c.id), tag(c.created_at) || null) })
  }

  // Flaschen: Bestandsbuchungen, Flaschenverkäufe ohne Bewegungszeile (vor KAN-149 D1): Abgang am Verkaufstag,
  // Storno-Rückbuchung am Storno-Tag; Alt-Stornos ohne Zeitpunkt entfallen ganz (wie im Bewegungsbuch)
  const buchungenJeFuellung = new Map<string, FlaschenBuchung[]>()
  const plus = (id: string, b: FlaschenBuchung) => {
    const liste = buchungenJeFuellung.get(id) ?? []
    liste.push(b)
    buchungenJeFuellung.set(id, liste)
  }
  const verkaufMitZeile = new Set<string>()
  const stornoMitZeile = new Set<string>()
  for (const fb of fbRes.data) {
    if (!fb.fuellung_id) continue
    plus(fb.fuellung_id, { datum: tag(fb.datum), menge: Math.trunc(zahlOderNull(fb.menge_stk) ?? 0), art: String(fb.art ?? ''), verkaufspostenId: fb.verkaufsposten_id ?? null })
    if (fb.verkaufsposten_id && fb.art === 'verkauf') verkaufMitZeile.add(`${fb.verkaufsposten_id}|${fb.fuellung_id}`)
    if (fb.verkaufsposten_id && fb.art === 'verkauf_storno') stornoMitZeile.add(`${fb.verkaufsposten_id}|${fb.fuellung_id}`)
  }
  for (const p of vpRes.data) {
    const vp = p.verkaufsposten as R | null
    const schluessel = `${p.verkaufsposten_id}|${p.fuellung_id}`
    const stk = Math.round(zahlOderNull(p.menge) ?? 0)
    if (!vp || stk === 0) continue
    if (vp.storniert && !vp.storniert_am) continue
    if (!verkaufMitZeile.has(schluessel)) plus(p.fuellung_id, { datum: tag(vp.datum), menge: -stk, art: 'verkauf_alt', verkaufspostenId: p.verkaufsposten_id ?? null })
    if (vp.storniert && !stornoMitZeile.has(schluessel)) plus(p.fuellung_id, { datum: tag(vp.storniert_am), menge: stk, art: 'verkauf_alt_storno', verkaufspostenId: p.verkaufsposten_id ?? null })
  }

  let deaktiviertOhneDatum = 0
  const fuellungen: FuellungsPosten[] = []
  for (const f of betrieb.fuellungen) {
    const bestandHeute = Math.trunc(zahlOderNull(f.bestand_flaschen) ?? 0)
    const buchungen = [...(buchungenJeFuellung.get(f.id) ?? [])]
    const abfuelltag = tag(f.datum)
    const abgefuellt = Math.trunc(zahlOderNull(f.anzahl_flaschen) ?? 0)
    if (abgefuellt > 0) buchungen.push({ datum: abfuelltag, menge: abgefuellt, art: 'abfuellung', verkaufspostenId: null })
    let heuteStk = bestandHeute
    if (!f.aktiv) {
      heuteStk = 0
      if (f.storniert_am) {
        // KAN-145 B3: der Storno lässt bestand_flaschen stehen – der Rest geht am Storno-Tag ab
        if (bestandHeute !== 0) buchungen.push({ datum: tag(f.storniert_am), menge: -bestandHeute, art: 'storno_fuellung', verkaufspostenId: null })
      } else if (bestandHeute > 0) {
        deaktiviertOhneDatum++
        continue
      }
    }
    if (heuteStk === 0 && buchungen.length === 0) continue
    const erfasst = zahlOderNull(f.flaschengroesse_ml)
    fuellungen.push({
      f, heuteStk, buchungen,
      beginn: abfuelltag || tag(f.erstellt_am) || null,
      ml: erfasst ?? FLASCHE_ML_STANDARD,
      mlErfasst: erfasst !== null,
    })
  }

  return { betrieb, chargen, fuellungen, ohneDatum, deaktiviertOhneDatum }
}

/** Bestand jeder Charge (Liter) und jeder Füllung (Stück) am Ende des Stichtags – ohne Filter (auch 0 und negativ) */
export function bestandJePosten(g: BestandsGrundlage, stichtag: string): {
  chargen: { p: ChargenPosten; r: StichtagsBestand }[]
  fuellungen: { p: FuellungsPosten; r: StichtagsBestand }[]
} {
  return {
    chargen: g.chargen.map(p => ({ p, r: bestandAmStichtag(p.heuteLiter, p.buchungen, stichtag, p.beginn, STELLEN.liter) })),
    fuellungen: g.fuellungen.map(p => ({ p, r: bestandAmStichtag(p.heuteStk, p.buchungen, stichtag, p.beginn, 0) })),
  }
}

/** Gilt eine Charge mit diesem Bestand als leer bzw. negativ? (menge_liter ist numeric(10,2)) */
export const istLeer = (liter: number) => Math.abs(liter) < LEER_UNTER
export const istNegativ = (liter: number) => liter <= -LEER_UNTER

export async function ladeBestandsmeldung(
  supabase: Client,
  tenantId: string,
  opts: { stichtag?: string; heute?: string } = {},
): Promise<BestandsmeldungDaten> {
  const heute = opts.heute ?? wienHeute()
  const stichtag = opts.stichtag ?? heute
  const warnungen: string[] = []

  const g = await ladeBestandsGrundlage(supabase, tenantId)
  const je = bestandJePosten(g, stichtag)

  if (stichtag < heute) {
    warnungen.push(`Bestand zum Stichtag ${datumAT(stichtag)} (Ende des Tages), zurückgerechnet aus dem Bestand am ${datumAT(heute)} und allen Buchungen danach. Bestandsänderungen ohne Buchung (z. B. Flaschenkorrekturen vor dem 24.09.2026 oder ein Gebindewechsel über „Charge bearbeiten“) sind darin nicht enthalten; Bezeichnung, Rebsorte, Qualitätsstufe und Gebinde sind die heutigen.`)
  }
  if (stichtag.slice(5) !== '07-31') {
    warnungen.push(`Stichtag ${datumAT(stichtag)} – die Weinbestandsmeldung (§ 29 Weingesetz 2009) verlangt den Bestand zum 31. Juli.`)
  }

  // ── B: Chargen ──────────────────────────────────────────────────────────────────────────────────────
  if (g.ohneDatum > 0) warnungen.push(`${anzahl(g.ohneDatum, 'Kellerbuchung hat', 'Kellerbuchungen haben')} kein Datum – sie zählen als vor dem Stichtag gebucht.`)

  const ungeklaertChargen: string[] = []
  let ungeklaertLiter = 0
  const negativChargen: string[] = []
  const chargenImBestand: { c: R; liter: number }[] = []
  for (const { p: { c }, r } of je.chargen) {
    const name = textOderNull(c.name) ?? 'ohne Bezeichnung'
    if (Math.abs(r.ungeklaert) >= LEER_UNTER) {
      ungeklaertChargen.push(name)
      ungeklaertLiter = runden(ungeklaertLiter + r.ungeklaert, STELLEN.liter)
    }
    if (istNegativ(r.bestand)) { negativChargen.push(`${name} (${fmtNum(r.bestand, 2)} l)`); continue }
    if (r.bestand >= LEER_UNTER) chargenImBestand.push({ c, liter: r.bestand })
  }
  if (ungeklaertChargen.length > 0) {
    warnungen.push(`${anzahl(ungeklaertChargen.length, 'Charge', 'Chargen')}: Der heutige Bestand ist durch die Kellerbuchungen nicht vollständig erklärt (zusammen ${fmtNum(ungeklaertLiter, 2)} l, z. B. Altbestand ohne Zugangsbuchung oder nachträgliche Korrektur) – dieser Teil ist im Stichtagsbestand ab der ersten Buchung der Charge enthalten: ${auszug(ungeklaertChargen)}.`)
  }
  if (negativChargen.length > 0) {
    warnungen.push(`${anzahl(negativChargen.length, 'Charge ergibt', 'Chargen ergeben')} zum Stichtag einen negativen Bestand und ${negativChargen.length === 1 ? 'ist' : 'sind'} nicht enthalten – Buchungen prüfen: ${auszug(negativChargen)}.`)
  }

  // Gebindenamen inkl. Kellergemeinschaft; scheitert die RPC, bleibt der eigene Name
  const gebindeName = new Map<string, string>()
  if (chargenImBestand.some(x => x.c.behaelter_id)) {
    try {
      for (const b of await ladeBehaelter(supabase, tenantId)) gebindeName.set(b.id, b.anzeigeName)
    } catch {
      warnungen.push('Gebindenamen der Kellergemeinschaft konnten nicht geladen werden – bei Partner-Gebinden fehlt der Betriebsname.')
    }
  }

  // Reihenfolge wie bisher: Jahrgang absteigend (ohne Jahrgang zuerst, wie Postgres), Bezeichnung, id
  chargenImBestand.sort((a, b) => {
    const ja = zahlOderNull(a.c.jahrgang), jb = zahlOderNull(b.c.jahrgang)
    if (ja !== jb) return ja === null ? -1 : jb === null ? 1 : jb - ja
    const na = String(a.c.name ?? ''), nb = String(b.c.name ?? '')
    if (na !== nb) return na < nb ? -1 : 1
    return String(a.c.id) < String(b.c.id) ? -1 : 1
  })

  const gebinde: BestandZeile[] = chargenImBestand.map(({ c, liter }) => {
    const rebsorte = textOderNull(c.rebsorte)
    return {
      abschnitt: 'B', bestandAm: stichtag,
      bezeichnung: textOderNull(c.name),
      jahrgang: zahlOderNull(c.jahrgang),
      rebsorte, kuerzel: bkiRebsorteKuerzel(rebsorte),
      farbe: farbeAus(c.weinart, rebsorte),
      qualitaet: qualitaetAnzeigeOderNull(c),   // KAN-186: Stufe + Zusatzbezeichnung/Erzeugnis
      behaelter: (c.behaelter_id ? gebindeName.get(c.behaelter_id) : undefined) ?? textOderNull((c.behaelter as R | null)?.name),
      flaschengroesseMl: null,
      flaschen: null,
      liter: runden(liter, STELLEN.liter),
      hl: runden(liter / 100, HL_STELLEN_BESTAND),
    }
  })

  // Gebinde mit mehr als einer Charge am Stichtag (Charge-Zuordnung prüfen)
  const chargenJeGebinde = new Map<string, number>()
  for (const { c } of chargenImBestand) if (c.behaelter_id) chargenJeGebinde.set(c.behaelter_id, (chargenJeGebinde.get(c.behaelter_id) ?? 0) + 1)
  const mehrfach: string[] = []
  chargenImBestand.forEach(({ c }, i) => {
    if (c.behaelter_id && (chargenJeGebinde.get(c.behaelter_id) ?? 0) > 1) mehrfach.push(gebinde[i].behaelter ?? '?')
  })
  if (mehrfach.length > 0) {
    const n = new Set(mehrfach).size
    warnungen.push(`${anzahl(n, 'Gebinde enthält', 'Gebinde enthalten')} am Stichtag mehr als eine Charge – Zuordnung prüfen (z. B. noch nicht nachgezogener Verschnitt): ${auszug(mehrfach)}.`)
  }

  // ── A: Flaschen ─────────────────────────────────────────────────────────────────────────────────────
  let ohneGroesse = 0
  const deaktiviertOhneDatum = g.deaktiviertOhneDatum
  const ungeklaertFuellungen: string[] = []
  const negativFuellungen: string[] = []
  const flaschen: BestandZeile[] = []
  for (const { p: { f, ml, mlErfasst }, r } of je.fuellungen) {
    const name = textOderNull(f.name) ?? 'ohne Bezeichnung'
    if (r.ungeklaert !== 0) ungeklaertFuellungen.push(name)
    if (r.bestand < 0) { negativFuellungen.push(`${name} (${r.bestand} Fl.)`); continue }
    if (r.bestand === 0) continue
    if (!mlErfasst) ohneGroesse++
    const rebsorte = textOderNull(f.rebsorte)
    flaschen.push({
      abschnitt: 'A', bestandAm: stichtag,
      bezeichnung: textOderNull(f.name),
      jahrgang: zahlOderNull(f.jahrgang),
      rebsorte, kuerzel: bkiRebsorteKuerzel(rebsorte),
      // KAN-42: Füllung ohne Charge (Flaschen-Eröffnungsbestand) – Weinart der Füllung
      farbe: farbeAus(((f.weinausbau as R | null)?.weinart ?? null) || (f.weinart !== 'unbekannt' ? f.weinart : null), rebsorte),
      qualitaet: qualitaetAnzeigeOderNull(f),   // KAN-186: Stufe + Zusatzbezeichnung/Erzeugnis
      behaelter: null,
      flaschengroesseMl: ml,
      flaschen: r.bestand,
      liter: runden((r.bestand * ml) / 1000, STELLEN.liter),
      hl: runden((r.bestand * ml) / 100000, HL_STELLEN_BESTAND),
    })
  }
  if (ohneGroesse > 0) {
    warnungen.push(`${anzahl(ohneGroesse, 'Füllung', 'Füllungen')} ohne Flaschengröße – ${FLASCHE_ML_STANDARD} ml angenommen (wie im Ausdruck).`)
  }
  if (ungeklaertFuellungen.length > 0) {
    warnungen.push(`${anzahl(ungeklaertFuellungen.length, 'Füllung', 'Füllungen')}: Der heutige Flaschenbestand ist durch Abfüllung, Verkäufe und Bestandsbuchungen nicht vollständig erklärt (z. B. Korrektur vor Einführung der Bestandsbuchungen am 24.09.2026) – der Unterschied ist ab dem Abfülltag enthalten: ${auszug(ungeklaertFuellungen)}.`)
  }
  if (negativFuellungen.length > 0) {
    warnungen.push(`${anzahl(negativFuellungen.length, 'Füllung ergibt', 'Füllungen ergeben')} zum Stichtag einen negativen Bestand und ${negativFuellungen.length === 1 ? 'ist' : 'sind'} nicht enthalten – Bestandsbuchungen prüfen: ${auszug(negativFuellungen)}.`)
  }
  if (deaktiviertOhneDatum > 0) {
    warnungen.push(`${anzahl(deaktiviertOhneDatum, 'deaktivierte Füllung', 'deaktivierte Füllungen')} mit Restbestand ohne Storno-Datum (vor dem 30.09.2026 deaktiviert) – nicht enthalten, weil unklar ist, ab wann die Flaschen fehlen.`)
  }

  const zeilen = [...flaschen, ...gebinde]
  warnungen.push(...kuerzelWarnungen(zeilen.map(z => z.rebsorte), ['Position', 'Positionen']))
  const ohneFarbe = zeilen.filter(z => z.farbe === null).length
  if (ohneFarbe > 0) warnungen.push(`${anzahl(ohneFarbe, 'Position', 'Positionen')} ohne bestimmbare Farbe (weder Weinart der Charge noch eindeutige Rebsorte) – Spalte „Farbe“ leer gelassen.`)

  const summe = (liste: BestandZeile[]) => runden(liste.reduce((s, z) => s + (z.hl ?? 0), 0), HL_STELLEN_BESTAND)
  const flaschenHl = summe(flaschen)
  const gebindeHl = summe(gebinde)
  return {
    stichtag,
    heute,
    flaschen,
    gebinde,
    zeilen,
    summe: {
      flaschen: flaschen.reduce((s, z) => s + (z.flaschen ?? 0), 0),
      flaschenHl,
      gebindeHl,
      gesamtHl: runden(flaschenHl + gebindeHl, HL_STELLEN_BESTAND),
    },
    warnungen,
  }
}

export const SPALTEN_BESTANDSMELDUNG: CsvSpalte<BestandZeile>[] = [
  { kopf: 'Bestand am', typ: 'datum', wert: z => z.bestandAm },
  { kopf: 'Abschnitt', typ: 'text', wert: z => ABSCHNITT_LABEL[z.abschnitt] },
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Jahrgang', typ: 'ganzzahl', wert: z => z.jahrgang },
  { kopf: 'Rebsorte', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'BKI-Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Farbe', typ: 'text', wert: z => z.farbe },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => z.qualitaet },
  { kopf: 'Behälter', typ: 'text', wert: z => z.behaelter },
  { kopf: 'Flaschengröße (ml)', typ: 'ganzzahl', wert: z => z.flaschengroesseMl },
  { kopf: 'Flaschen', typ: 'ganzzahl', wert: z => z.flaschen },
  { kopf: 'Menge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.liter },
  { kopf: 'Menge (hl)', typ: 'dezimal', stellen: HL_STELLEN_BESTAND, wert: z => z.hl },
]
