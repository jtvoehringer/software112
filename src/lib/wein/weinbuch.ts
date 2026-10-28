// Gemeinsame Datenlogik für das "Weinbuch" einer Weinausbau-Charge (vollständige
// Prozesshistorie von der Rebe bis zur Flasche). Ursprünglich Teil von
// kellerbuch/weinausbau/[id]/buch/page.tsx – für die Weinbuch-Sammlung
// (Auswertungen, BKI-Prüfung) am 7.8.2026 hierher ausgelagert, damit dieselbe
// (aufwändige) Abfrage-Logik für EINE Charge (Einzelseite) und für VIELE Chargen
// (Sammel-PDF) identisch wiederverwendet werden kann, statt sie zu duplizieren.
//
// KAN-127 (Entscheidungen Jörgen 26.09.2026): Die Sicht liegt auf der Charge.
//   - Ried-Maßnahmen, Lesen und Pressungen kommen aus den Lesezeilen der Charge UND ihrer Vorgänger (Umzüge,
//     Verschnitte – wie im Blend-Protokoll), über denselben Kern wie die Rückverfolgung Weingarten
//     (ladeRvWeingarten → ladeMassnahmenZuLesezeilen): nur die gelesenen GST, nur im Fenster „Ernte bis Ernte“
//     bis zur jeweiligen Lese, eine Zeile je Maßnahme ohne Dubletten, Herkunft erkennbar („über Charge …“).
//     Bis dahin kamen über die RPC get_behandlungen_fuer_grundstuecke alle Maßnahmen aller GST der Weingärten
//     ohne Datumsgrenze (Musterhof: 1.028 statt 445 Zeilen, 519 nach der Lese).
//   - Zukauf (Wein, Most, Trauben): Hinweis, dass die Ried-Maßnahmen beim Lieferbetrieb liegen (Name,
//     Betriebsnummer, Datum, Menge; Transportschein-Nr. bis KAN-90 „nicht erfasst“). Eröffnungsbestand: Hinweis
//     „Ried-Maßnahmen vor der Übernahme nicht in software:112 erfasst“. Hinweise auf Seite, Ausdruck und CSV.
//   - Ende: Ist die Charge leer, endet das Weinbuch mit der letzten Füllung – spätere Einträge (Analysen,
//     Prüfnummern, Kellerarbeiten) gehören nicht mehr dazu.
//
// Mengenbewegungen (KAN-44 Teil 3, 08.10.2026): Zukauf, Fassverkauf, Eröffnungsbestand, Bestandskorrekturen,
// Verarbeitung, Produktion und Lohnversektung kommen ab dem Journalbeginn aus dem Bewegungsjournal (mit „Bestand danach“),
// davor bzw. ohne Journal aus den Bewegungstabellen – Regeln in lib/wein/weinbuchBestand.ts.
//
// Storno (KAN-145 B2b, 30.09.2026): Stornierte Umzüge, Schwundbuchungen und Verschnitte bleiben am Buchungstag
// stehen (Kennzeichen „storniert“) und bekommen am Storno-Tag einen eigenen Eintrag „Storno: …“ mit Grund und
// Benutzer.

import { momentaufnahmeAnwenden } from '../stammdaten/momentaufnahme'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'
import { istStorniert, stornoAngaben } from '@/lib/kellerbuch/stornoFilter'
import { ladeBelegungen } from '@/lib/behoerden/bewegungsbuch'
import { mostgewichtWeinbuchText } from '@/lib/behoerden/mostgewicht_export'
import { tag, text } from '@/lib/behoerden/kellerbuch-hilfen'
import { massnahmenArtLabel } from '@/lib/behandlungen/arten'
import { pnStatusLabel } from '@/lib/dac/workflow'
import { massnahmeMittel, massnahmeZeitraum } from '@/lib/behoerden/rueckverfolgung'
import { ladeRvWeingarten, massnahmeWartezeit, type RvLese } from '@/lib/behoerden/rv-weingarten'
import { ttmmjjjj } from '@/lib/behoerden/rueckverfolgungFenster'
import { quellGebindeDesVerschnitts, quellGebindeSchluessel, verschnittQuelleText } from '@/lib/kellerbuch/quellGebinde'
import { abstufungText } from '@/lib/kellerbuch/abstufen'
import { normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import { zukaufTbsVermerk } from '@/lib/handel/tbsNummer'
import { pnStandAm, pnStandText, pnVerlaufEreignisse, type PnVerlauf } from '@/lib/kellerbuch/pruefnummerVerlauf'
import { ladeJournalBeginn } from '@/lib/kellerbuch/journal'
import { ladeWeinbuchDaten, type WeinbuchDaten } from '@/lib/wein/weinbuchDaten'
import {
  eroeffnungEreignis, fassverkaufEreignis, journalAbweichungHinweis, journalEreignisse, journalSaldo,
  vorJournal, zukaufEreignis,
} from '@/lib/wein/weinbuchBestand'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { nachTagUndZeit } from '../datum/reihenfolge.ts'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type EventTyp =
  | 'feldbehandlung'
  | 'ernte'
  | 'pressung'
  | 'umzug'
  | 'schwund'
  | 'kellerbehandlung'
  | 'analyse'
  | 'dac'
  | 'fuellung'
  | 'verschneidung'
  | 'umstufung'   // KAN-82: Abstufung der Charge (charge_umstufungen)
  | 'eroeffnung'  // KAN-44: Eröffnungsbestand bzw. Übertrag bei Eröffnung des Journals
  | 'zukauf'      // KAN-44: Zukauf in die Charge
  | 'verkauf'     // KAN-44: Fassverkauf aus der Charge
  | 'bestand'     // KAN-44: weitere Mengenbewegungen (Korrektur, Verarbeitung, Produktion, Lohnversektung …)

export interface TimelineEvent {
  datum: string        // ISO date string zum Sortieren
  /** KAN-384: Erfassungszeitpunkt – Reihenfolge innerhalb des Tages (fehlt er, steht der Eintrag am Tagesanfang) */
  zeitpunkt?: string | null
  typ: EventTyp
  titel: string
  details: string[]
  badge?: string
  /** KAN-365: Gebinde, aus dem der Wein kam (Umzug: Von-Gebinde, Verschnitt: Quellgebinde) – eigene CSV-Spalte */
  quellgebinde?: string | null
}

export interface WeinbuchCharge {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  qualitaetsstufe: string | null
  status: string
  menge_liter: number
  behaelter_id: string | null
  behaelter_name: string | null
  /** KAN-131: Mostgewicht der Charge (Kopf) */
  kmw?: number | null
  oechsle?: number | null
  mostgewicht_einheit?: string | null
  /** KAN-200: aktuell gültige Prüfnummer der Charge (auch per Umzug übernommen) bzw. „… erloschen am …“ */
  pruefnummer?: string | null
}

export interface Weinbuch {
  wa: WeinbuchCharge
  events: TimelineEvent[]
  /** Hinweise für Seite, Ausdruck und CSV (z. B. Kellerbehandlungen ohne eindeutige Charge, Zukauf, Eröffnungsbestand) */
  warnungen: string[]
  /** Tag der Füllung, mit der die (jetzt leere) Charge abgeschlossen wurde – danach keine Einträge mehr; sonst null */
  abgeschlossenAm: string | null
  /** KAN-365: Prüfnummer-Verlauf der Charge (pruefnummer_chargen) – für „Prüfnummer (gültig am Datum)“ je Zeile */
  pnVerlauf?: PnVerlauf[]
}

export const HINWEIS_EROEFFNUNGSBESTAND = 'Eröffnungsbestand – Ried-Maßnahmen vor der Übernahme nicht in software:112 erfasst.'

const ZUKAUF_ART: Record<string, string> = { wein: 'Wein', most: 'Most', trauben: 'Trauben', maische: 'Maische', flaschen: 'Flaschen' }

/** Hinweis zu einem Zukauf: Ried-Maßnahmen liegen beim Lieferbetrieb (KAN-127), mit der TBS-Nr. des Lieferanten (KAN-90) */
export function zukaufHinweis(z: R, ueberCharge: string | null): string {
  momentaufnahmeAnwenden(z, ['lieferant_firma', 'lieferant_kontakt'])   // KAN-150 F1c: Lieferant wie beim Zukauf
  const firma = z.lieferant_firma as R | null
  const kontakt = z.lieferant_kontakt as R | null
  const name = text(firma?.name) ?? ([kontakt?.vorname, kontakt?.nachname].filter(Boolean).join(' ') || 'Lieferant nicht erfasst')
  const bnr = text(firma?.betrieb_nr) ?? text(kontakt?.betrieb_nr)
  const menge = z.menge != null ? `${fmtNum(parseFloat(z.menge))} ${z.einheit ?? ''}`.trim() : null
  const was = [ZUKAUF_ART[z.art] ?? text(z.art) ?? 'Zukauf', text(z.rebsorte), z.jahrgang ? String(z.jahrgang) : null].filter(Boolean).join(' ')
  return `Zukauf ${was}${z.datum ? ` vom ${ttmmjjjj(tag(z.datum))}` : ''}${menge ? ` (${menge})` : ''}${ueberCharge ? ` über Charge „${ueberCharge}“` : ''}: `
    + `Die Ried-Maßnahmen liegen beim Lieferbetrieb ${name}${bnr ? ` (Betriebsnr. ${bnr})` : ' (Betriebsnummer nicht erfasst)'}; ${zukaufTbsVermerk(z.tbs_nummer_lieferant, z.tbs_jahr_lieferant)}.`
}

/** Vermerk an Kellerbehandlungen ohne Charge, die keiner Charge eindeutig zuzuordnen sind */
export const VERMERK_NICHT_EINDEUTIG = 'Zuordnung zur Charge nicht eindeutig (Behandlung ohne Charge erfasst)'

export async function buildWeinbuch(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, id: string, tenantId: string | null,
  /** journalBeginn: vorab geladen (Sammlung, einmal je Betrieb); undefined = hier laden.
   *  daten: Rohdaten der Charge aus ladeWeinbuchDaten (Sammlung, KAN-385); undefined = hier laden */
  opts: { journalBeginn?: string | null; daten?: WeinbuchDaten | null } = {},
): Promise<Weinbuch | null> {
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // ── 1. Charge und ihre Buchungen – ein Abfrageweg für Einzel-Weinbuch und Sammlung (KAN-385) ──────────
  const d = opts.daten !== undefined ? opts.daten : (await ladeWeinbuchDaten(supabase, tenantId, [id])).get(id) ?? null
  if (!d) return null
  const waRow = d.wa
  const wa: WeinbuchCharge = {
    id: waRow.id,
    name: waRow.name,
    jahrgang: waRow.jahrgang,
    rebsorte: waRow.rebsorte,
    qualitaetsstufe: waRow.qualitaetsstufe,
    status: waRow.status,
    menge_liter: waRow.menge_liter,
    behaelter_id: waRow.behaelter_id,
    behaelter_name: (waRow.behaelter as R | null)?.name ?? null,
    kmw: waRow.kmw ?? null, oechsle: waRow.oechsle ?? null, mostgewicht_einheit: waRow.mostgewicht_einheit ?? null,
  }

  const pressungen    = d.pressungen
  const umzuegeRaw    = d.umzuege
  let kellerBeh     = d.kellerBeh
  const warnungen: string[] = []
  // Fallback: alte Einträge OHNE Charge (weinausbau_id leer) aus dem Gebinde der Charge.
  // Seit 24.09.2026 entfallen nur Behandlungen, die laut Belegung (Bewegungsbuch,
  // lib/behoerden/bewegungsbuch.ts) nachweislich NICHT diese Charge betreffen: Tag in der
  // Belegung genau einer anderen Charge, mehrere Chargen ohne diese, oder nach dem letzten
  // Tag dieser Charge im Gebinde. Ist die Zuordnung offen (diese und weitere Chargen im
  // Gebinde, keine Belegung an dem Tag – z. B. vor dem Eröffnungsbestand –, kein Datum),
  // bleibt die Behandlung mit Vermerk im Weinbuch: der Ausdruck darf gegenüber früher
  // (alle Behandlungen des Gebindes) nichts still verlieren (Review 25.09.2026).
  if (kellerBeh.length === 0 && wa.behaelter_id && tenantId) {
    const { data: kbFallbackRaw, error: kbFallbackErr } = await (supabase.from('keller_behandlungen') as any)
      .select('id, datum, created_at, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name), storniert_am, storno_grund, storniert_von_name')
      // storno-sichtbar: das Weinbuch zeigt stornierte Kellerbehandlungen gekennzeichnet (KAN-145 B3)
      .eq('tenant_id', tenantId)
      .eq('behaelter_id', wa.behaelter_id)
      .is('weinausbau_id', null)
      .order('datum', { ascending: true }).order('created_at', { ascending: true }).order('id')
    if (kbFallbackErr) warnungen.push(`Kellerbehandlungen ohne Charge konnten nicht geladen werden (${kbFallbackErr.message}).`)
    const kandidaten = (kbFallbackRaw ?? []) as R[]
    if (kandidaten.length > 0) {
      const belegungen = await ladeBelegungen(supabase, tenantId, wa.behaelter_id)
      const eigene = belegungen.find(b => b.chargeId === wa.id) ?? null
      let unklar = 0
      kellerBeh = []
      for (const kb of kandidaten) {
        const d = tag(kb.datum)
        const treffer = d ? belegungen.filter(b => d >= b.von && (b.bis === null || d <= b.bis)) : []
        const diese = treffer.some(b => b.chargeId === wa.id)
        if (treffer.length === 1) {
          if (diese) kellerBeh.push(kb)
          continue                                              // Zeit genau einer anderen Charge
        }
        if (treffer.length > 1 && !diese) continue              // nur andere Chargen im Gebinde
        if (treffer.length === 0 && d && eigene && eigene.bis !== null && d > eigene.bis) continue  // nach dem Auszug
        unklar++
        kellerBeh.push({ ...kb, _vermerk: VERMERK_NICHT_EINDEUTIG })
      }
      if (unklar > 0) {
        warnungen.push(`${unklar} ${unklar === 1 ? 'Kellerbehandlung' : 'Kellerbehandlungen'} ohne Charge ${unklar === 1 ? 'ist' : 'sind'} keiner Charge eindeutig zuzuordnen (mehrere eigene Chargen im Gebinde oder keine Belegung an dem Tag) – im Weinbuch mit Vermerk „Zuordnung zur Charge nicht eindeutig“ aufgeführt, bitte prüfen.`)
      }
    }
  }
  const analysen      = d.analysen
  const dacAntraege   = d.dacAntraege
  const fuellChargen  = d.fuellChargen
  const fuellChargenIds = new Set(fuellChargen.map((fc: R) => (fc.fuellung as R | null)?.id).filter(Boolean))
  const direktFuellungen = d.fuellDirekt
    .filter((f: R) => !fuellChargenIds.has(f.id))
    .map((f: R) => ({ anteil_liter: null, fuellung: f }))
  // KAN-145 B3: aktive und stornierte Füllungen (gekennzeichnet); vor KAN-145 „gelöschte“ (aktiv = false ohne
  // Storno-Kennzeichen) zählen nicht – ihre Liter wurden auf die Charge zurückgebucht
  const alleFuellungen = [...fuellChargen, ...direktFuellungen].filter((fc: R) => {
    const f = fc.fuellung as R | null
    return !f || f.aktiv !== false || !!f.storniert_am
  })

  const verschnEin = d.verschnEin
  const verschnAus = d.verschnAus   // stornierte mit Kennzeichen (KAN-145 B2b)

  // Umzüge: Ziel-Behälter via Batch-Lookup ergänzen
  const batchIds = [...new Set(
    umzuegeRaw.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id)
  )] as string[]
  const zielByBatch: Record<string, R> = {}
  if (batchIds.length > 0) {
    // alle-ausnahme: Umzüge einer einzelnen Charge im Weinbuch, wenige
    const { data: zielRows, error: zielErr } = await tf((supabase.from('keller_umzuege') as any)
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name)')
      // storno-sichtbar: nur der Name des Ziel-Gebindes (die Zeilen einer Buchung sind gemeinsam storniert)
      .in('umzug_batch_id', batchIds)
      .eq('zeilen_typ', 'ziel'))
    // KAN-254: sonst fehlten im Weinbuch (Aufzeichnung für die Behörde) still die Ziel-Gebinde der Umzüge
    if (zielErr) throw new AktionsFehler(`Ziel-Gebinde der Umzüge konnten nicht geladen werden: ${zielErr.message}`)
    for (const z of ((zielRows ?? []) as R[])) {
      if (!zielByBatch[z.umzug_batch_id]) zielByBatch[z.umzug_batch_id] = z
    }
  }
  const umzuege = umzuegeRaw.map(u => {
    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id && zielByBatch[u.umzug_batch_id]) {
      return { ...u, nach_behaelter: zielByBatch[u.umzug_batch_id].nach_behaelter }
    }
    return u
  })

  // ── Ried: Lesen, Pressungen der Vorgänger, Maßnahmen bis zur Lese (KAN-127) ──────────────────────────────
  // Derselbe Kern wie die Rückverfolgung Weingarten: Lesezeilen der Charge und ihrer Vorgänger, je Lesezeile die
  // Maßnahmen der gelesenen GST im Fenster „Ernte bis Ernte“ (rueckverfolgungFenster.ts).
  const rv = tenantId
    ? await ladeRvWeingarten(supabase, tenantId, { charge: id, lese: null, jahrgang: null, gst: null, weingarten: null, fuellung: null })
    : null
  const rvLesen: RvLese[] = rv?.lesen ?? []
  if (rv) warnungen.push(...rv.warnungen)
  const herkunft = rv?.herkunftChargen ?? new Map<string, R>([[wa.id, waRow]])

  // Hinweise: Zukauf (beim Lieferbetrieb), Eröffnungsbestand, Charge ohne Lese
  const trauben = [...new Set(rvLesen.map(l => text(l.lese.zukauf_posten_id)).filter((x): x is string => !!x))]
  if (tenantId) {
    const zkSelect = 'id, datum, art, menge, einheit, rebsorte, jahrgang, ziel_weinausbau_id, partner_daten, tbs_nummer_lieferant, tbs_jahr_lieferant, lieferant_firma:firmen!lieferant_firma_id(name, betrieb_nr), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname, betrieb_nr)'
    const [zkZiel, zkTrauben] = await Promise.all([
      (supabase.from('zukauf_posten') as any).select(zkSelect).eq('tenant_id', tenantId).eq('aktiv', true)
        .in('ziel_weinausbau_id', [...herkunft.keys()]).order('datum').order('erstellt_am').order('id'),
      trauben.length > 0
        ? (supabase.from('zukauf_posten') as any).select(zkSelect).eq('tenant_id', tenantId).in('id', trauben).order('datum').order('erstellt_am').order('id')
        : Promise.resolve({ data: [], error: null }),
    ])
    if (zkZiel.error || zkTrauben.error) warnungen.push('Zukäufe konnten nicht geladen werden – Hinweise zum Lieferbetrieb fehlen.')
    const gesehen = new Set<string>()
    for (const z of [...((zkZiel.data ?? []) as R[]), ...((zkTrauben.data ?? []) as R[])]) {
      if (gesehen.has(z.id)) continue
      gesehen.add(z.id)
      const ziel = text(z.ziel_weinausbau_id)
      warnungen.push(zukaufHinweis(z, ziel && ziel !== wa.id ? text(herkunft.get(ziel)?.name) ?? 'Vorgänger' : null))
    }
  }
  for (const [cid, c] of herkunft) {
    if (!c.ist_eroeffnungsbestand) continue
    warnungen.push(cid === wa.id ? HINWEIS_EROEFFNUNGSBESTAND : `Charge „${text(c.name) ?? 'Vorgänger'}“: ${HINWEIS_EROEFFNUNGSBESTAND}`)
  }
  if (rvLesen.length === 0 && !waRow.ist_eroeffnungsbestand && ![...herkunft.values()].some(c => c.ist_eroeffnungsbestand)) {
    const riede = d.weingaerten.map(r => text((r.weingarten as R | null)?.name)).filter(Boolean)
    if (!warnungen.some(w => w.startsWith('Zukauf '))) {
      warnungen.push(`Keine Lese und keine Pressung zugeordnet – im Weinbuch stehen keine Ried-Maßnahmen${riede.length > 0 ? ` (Herkunft laut Charge: ${riede.join(', ')})` : ''}.`)
    }
  }

  // ── 3. Timeline zusammenbauen ─────────────────────────────────────────────
  const events: TimelineEvent[] = []
  const ueberText = (l: RvLese) => (l.ueberCharge ? `über Charge „${l.ueberCharge.name ?? 'Vorgänger'}“` : null)

  // Feldbehandlungen: eine je Maßnahme, vereinigt über alle Lesen (Charge und Vorgänger), ohne Dubletten
  type Feld = { b: R; gst: Set<string>; riede: Set<string>; flaeche: Map<string, number>; menge: Map<string, number>; einheit: string | null; nurWeingarten: boolean; ueber: Set<string>; eigene: boolean; fruehester: string | null }
  const feld = new Map<string, Feld>()
  for (const l of rvLesen) {
    for (const m of l.massnahmen) {
      const bid = String(m.behandlung.id)
      const x = feld.get(bid) ?? { b: m.behandlung, gst: new Set(), riede: new Set(), flaeche: new Map(), menge: new Map(), einheit: null, nurWeingarten: false, ueber: new Set(), eigene: false, fruehester: null }
      for (const g of m.grundstuecke) x.gst.add(g)
      if (l.weingarten) x.riede.add(l.weingarten)
      if (m.flaecheHa !== null) x.flaeche.set(m.grundstuecke.join(', '), m.flaecheHa)
      // KAN-132: Menge anteilig auf die gelesenen GST (je GST-Gruppe einmal, wie die Fläche)
      if (m.menge !== null) { x.menge.set(m.grundstuecke.join(', '), m.menge); x.einheit = m.mengeEinheit }
      if (m.nurWeingarten) x.nurWeingarten = true
      const u = ueberText(l)
      if (u) x.ueber.add(u); else x.eigene = true
      x.fruehester = x.fruehester ?? massnahmeWartezeit(m, l.fenster).fruehester
      feld.set(bid, x)
    }
  }
  for (const x of feld.values()) {
    const b = x.b
    const artText = massnahmenArtLabel(b.art)
    const flaeche = [...x.flaeche.values()].reduce((a, v) => a + v, 0)
    const menge = rund([...x.menge.values()].reduce((a, v) => a + v, 0), 3)
    events.push({
      datum: tag(b.datum),
      typ: 'feldbehandlung',
      titel: (b.psm as R | null) ? massnahmeMittel(b) : artText ?? 'Behandlung',
      details: [
        b.datum_bis && tag(b.datum_bis) !== tag(b.datum) ? `Zeitraum: ${massnahmeZeitraum(b)}` : null,
        artText && `Art: ${artText}`,
        b.aufwandmenge && `${b.aufwandmenge} ${b.aufwandmenge_einheit ?? ''}`.trim(),
        b.bbch_stadium && `BBCH ${b.bbch_stadium}`,
        b.schaderreger && `Schaderreger: ${b.schaderreger}`,
        x.gst.size > 0 ? `GST ${[...x.gst].join(', ')}${x.riede.size > 0 ? ` (Ried: ${[...x.riede].join(', ')})` : ''}` : null,
        x.nurWeingarten ? `am Weingarten erfasst (ohne Grundstück)${x.gst.size === 0 && x.riede.size > 0 ? ` – Ried: ${[...x.riede].join(', ')}` : ''}` : null,
        flaeche > 0 ? `Fläche: ${fmtNum(flaeche)} ha` : null,
        x.menge.size > 0 ? `Menge anteilig: ${fmtNum(menge)} ${x.einheit ?? ''}`.trim() : null,
        x.fruehester ? `Frühester Lesetermin: ${ttmmjjjj(x.fruehester)}` : null,
        !x.eigene && x.ueber.size > 0 ? `Herkunft: ${[...x.ueber].join(', ')}` : null,
        b.notizen,
      ].filter(Boolean) as string[],
    })
  }

  // Lesen: aus den Lesezeilen der Charge und ihrer Vorgänger (nicht aus allen Erntemeldungs-Einträgen der Weingärten)
  for (const l of rvLesen) {
    if (l.quelle !== 'pressung' || !l.pressung) continue
    const ausErnte = !l.lesedatum && l.fenster?.bisAus === 'erntemeldung' ? l.fenster.bis : null
    const datum = l.lesedatum ?? ausErnte ?? tag(l.pressung.datum)
    if (!datum) continue
    const mostgewicht = mostgewichtWeinbuchText({ kmw: l.lese.kmw, oechsle: l.lese.oechsle, einheit: l.lese.mostgewicht_einheit })
    events.push({
      datum,
      typ: 'ernte',
      titel: l.leseText ? `Lese ${l.leseText}` : 'Lese',
      details: [
        l.weingarten ? `Ried: ${l.weingarten}` : l.lese.zukauf_posten_id ? 'Trauben-Zukauf' : null,
        l.gstNr && `GST ${l.gstNr}`,
        l.kg !== null ? `${fmtNum(l.kg)} kg` : null,
        mostgewicht,
        l.rebsorte && formatRebsorteMitKuerzel(l.rebsorte),
        ausErnte ? 'Lesedatum laut Erntemeldung' : !l.lesedatum ? 'Lesedatum nicht erfasst – Datum der Pressung' : null,
        ueberText(l),
      ].filter(Boolean) as string[],
    })
  }

  // KAN-145 B2b: Storno-Angaben je Ereignis – merkeStorno(zeile) direkt vor dem push merkt den Index des Eintrags
  // (bis zum Sortieren wird nur angehängt, der Index bleibt gültig); seit KAN-148 C1c auch für Pressungen
  const stornoIdx: [number, NonNullable<ReturnType<typeof stornoAngaben>>][] = []
  const merkeStorno = (z: R) => { const st = stornoAngaben(z); if (st) stornoIdx.push([events.length, st]) }

  for (const pb of pressungen) {
    const p = pb.pressung as R | null
    if (!p || !p.datum) continue
    merkeStorno(pb)
    const wgListe = (p.pressung_weingaerten ?? []) as R[]
    const weingaertenText = wgListe
      .map((wg: R) => (wg.weingarten as R | null)?.name)
      .filter(Boolean).join(', ')
    events.push({
      datum: p.datum,
      zeitpunkt: p.erstellt_am ?? null,
      typ: 'pressung',
      titel: p.weinbezeichnung ? `Pressung – ${p.weinbezeichnung}` : 'Pressung',
      details: [
        p.most_liter_gesamt && `${fmtNum(parseFloat(p.most_liter_gesamt))} L Most`,
        pb.menge_liter && `Anteil: ${fmtNum(parseFloat(pb.menge_liter))} L`,
        weingaertenText && `Weingärten: ${weingaertenText}`,
        // KAN-131: Mostgewicht der Pressung, beide Werte
        mostgewichtWeinbuchText({ kmw: p.kmw_grad, oechsle: p.oechsle, einheit: p.mostgewicht_einheit }),
      ].filter(Boolean) as string[],
    })
  }
  // Pressungen der Vorgänger-Chargen (Herkunft über Umzug/Verschnitt)
  const vorgaengerPressungen = new Map<string, RvLese[]>()
  for (const l of rvLesen) {
    if (!l.ueberCharge || !l.pressung) continue
    const k = `${l.pressung.id}:${l.ueberCharge.id}`
    vorgaengerPressungen.set(k, [...(vorgaengerPressungen.get(k) ?? []), l])
  }
  for (const zeilen of vorgaengerPressungen.values()) {
    const p = zeilen[0].pressung as R
    const riede = [...new Set(zeilen.map(l => l.weingarten).filter(Boolean))].join(', ')
    events.push({
      datum: tag(p.datum),
      zeitpunkt: p.erstellt_am ?? null,
      typ: 'pressung',
      titel: `${p.weinbezeichnung ? `Pressung – ${p.weinbezeichnung}` : 'Pressung'} (${ueberText(zeilen[0])})`,
      details: [
        p.most_liter_gesamt && `${fmtNum(parseFloat(p.most_liter_gesamt))} L Most`,
        riede && `Weingärten: ${riede}`,
      ].filter(Boolean) as string[],
    })
  }


  for (const u of umzuege) {
    if (u.umzug_typ === 'schwund') {
      merkeStorno(u)
      const behaelterName = (u.nach_behaelter as R | null)?.name ?? null
      const menge = u.schwund_liter ?? u.brutto_liter ?? u.menge_liter
      events.push({
        datum: u.datum,
        zeitpunkt: u.erstellt_am ?? null,
        typ: 'schwund',
        titel: behaelterName ? `Schwund – ${behaelterName}` : 'Schwund',
        details: [
          menge && `${fmtNum(parseFloat(menge))} L Schwund`,
          u.notizen,
        ].filter(Boolean) as string[],
      })
      continue
    }
    const von = (u.von_behaelter as R | null)?.name ?? '?'
    const nach = (u.nach_behaelter as R | null)?.name ?? '?'
    const liter = u.brutto_liter ?? u.menge_liter
    merkeStorno(u)
    events.push({
      datum: u.datum,
      zeitpunkt: u.erstellt_am ?? null,
      typ: 'umzug',
      titel: `${von} → ${nach}`,
      quellgebinde: (u.von_behaelter as R | null)?.name ?? null,
      details: [
        liter && `${fmtNum(parseFloat(liter))} L`,
        u.schwund_liter && `Schwund: ${fmtNum(parseFloat(u.schwund_liter))} L`,
      ].filter(Boolean) as string[],
    })
  }

  for (const kb of kellerBeh) {
    const typName = (kb.typ as R | null)?.name ?? kb.typ_name_snapshot ?? 'Kellerbehandlung'
    merkeStorno(kb)
    events.push({
      datum: kb.datum,
      zeitpunkt: kb.created_at ?? null,
      typ: 'kellerbehandlung',
      titel: typName,
      details: [
        kb.menge != null && kb.einheit ? `${fmtNum(parseFloat(kb.menge))} ${kb.einheit}` : null,
        kb.volumen_liter_ist ? `Volumen Ist: ${fmtNum(parseFloat(kb.volumen_liter_ist))} L` : null,
        kb.notizen,
        kb._vermerk ?? null,
      ].filter(Boolean) as string[],
    })
  }

  for (const a of analysen) {
    const params: string[] = [
      a.alkohol_vol != null       ? `Alkohol: ${fmtNum(parseFloat(a.alkohol_vol))} % vol` : null,
      a.restzucker_gl != null     ? `Restzucker: ${fmtNum(parseFloat(a.restzucker_gl))} g/l` : null,
      a.gesamtsaeure_gl != null   ? `Gesamtsäure: ${fmtNum(parseFloat(a.gesamtsaeure_gl))} g/l` : null,
      a.ph_wert != null           ? `pH-Wert: ${fmtNum(parseFloat(a.ph_wert))}` : null,
      a['flüchtige_saeure_gl'] != null ? `Flüchtige Säure: ${fmtNum(parseFloat(a['flüchtige_saeure_gl']))} g/l` : null,
      a.freie_so2_mgl != null     ? `Freies SO₂: ${fmtNum(parseFloat(a.freie_so2_mgl))} mg/l` : null,
      a.gesamt_so2_mgl != null    ? `Gesamt-SO₂: ${fmtNum(parseFloat(a.gesamt_so2_mgl))} mg/l` : null,
      a.probe_nr                  ? `Probe-Nr.: ${a.probe_nr}` : null,
      a.bewertung,
      a.notizen,
    ].filter(Boolean) as string[]
    merkeStorno(a)   // KAN-150 F2
    events.push({
      datum: a.analyse_datum,
      zeitpunkt: a.created_at ?? null,
      typ: 'analyse',
      titel: `Analyse${a.labor ? ` – ${a.labor}` : ''}`,
      details: params,
    })
  }

  // KAN-384: Reihenfolge im Tag nach dem letzten Status-Ereignis des Antrags (zugeteilt, eingereicht …), sonst Anlage
  const dacZeit = d.dacZeit
  if (d.dacZeitFehler) warnungen.push(d.dacZeitFehler)
  for (const dac of dacAntraege) {
    const datum = dac.bescheid_am ?? dac.eingereicht_am ?? dac.created_at ?? null
    if (!datum) continue
    const statusBadge = pnStatusLabel(dac.status)   // KAN-97
    merkeStorno(dac)   // KAN-150 F2
    events.push({
      datum,
      zeitpunkt: dacZeit.get(dac.id) ?? dac.created_at ?? null,
      typ: 'dac',
      titel: dac.bezeichnung,
      badge: statusBadge,
      details: [
        dac.pruefnummer && `Prüfnummer: ${dac.pruefnummer}`,
        dac.eingereicht_am && `Eingereicht: ${new Date(dac.eingereicht_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}`,
        dac.bescheid_am && `Bescheid: ${new Date(dac.bescheid_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}`,
      ].filter(Boolean) as string[],
    })
  }

  // KAN-77: Quelle mit Quellgebinde am Tag des Verschnitts und Litern („Grüner Veltliner Sandgrube (Stahltank 03) · 48 L“).
  // Die gespeicherten Prozente entfallen hier: bis KAN-77 Anteil am Verschnitt, seither am Ergebnis – das Blend-Protokoll
  // zeigt die Anteile zeitrichtig.
  const quellGebinde = tenantId && verschnEin.length > 0
    ? await quellGebindeDesVerschnitts(supabase, tenantId, verschnEin.map((v: R) => ({
      id: v.id, datum: v.datum ?? null, ziel_weinausbau_id: v.ziel_weinausbau_id ?? id,
      // KAN-112: Momentaufnahme des Gebindes am Verschnitt (Vorrang vor der Regel)
      quellen: ((v.quellen ?? []) as R[]).map((q: R) => ({ quell_weinausbau_id: q.quell_weinausbau_id ?? (q.quelle as R | null)?.id ?? null, quell_behaelter_id: q.quell_behaelter_id ?? null, gebinde_rekonstruiert: q.gebinde_rekonstruiert ?? null })),
    })))
    : new Map<string, { name: string | null; rekonstruiert?: true }>()
  for (const v of verschnEin) {
    merkeStorno(v)
    const quellNamen: string[] = []
    const quelleTexte = ((v.quellen ?? []) as R[]).map((q: R) => {
      const qid = q.quell_weinausbau_id ?? (q.quelle as R | null)?.id
      const g = qid ? quellGebinde.get(quellGebindeSchluessel(v.id, qid)) ?? null : null
      if (g?.name && !quellNamen.includes(g.name)) quellNamen.push(g.name)
      // KAN-112: nachträglich ermitteltes Gebinde mit Hinweis „Gebinde rekonstruiert“
      return `Verschneidung von ${verschnittQuelleText((q.quelle as R | null)?.name, g?.name ?? null, `${fmtNum(parseFloat(q.menge_liter ?? 0))} L`, g?.rekonstruiert)}`
    })
    events.push({
      datum: v.datum,
      zeitpunkt: v.created_at ?? null,
      typ: 'verschneidung',
      titel: 'Verschneidung – eingehend',
      details: [...quelleTexte, v.notizen].filter(Boolean) as string[],
      quellgebinde: quellNamen.length > 0 ? quellNamen.join(', ') : null,
    })
  }

  for (const vq of verschnAus) {
    const v = vq.verschneidung as R | null
    if (!v) continue
    const zielName = (v.ziel as R | null)?.name ?? '?'
    // KAN-77: ohne die gespeicherten Prozente (Bedeutung bis/seit KAN-77 verschieden, siehe oben)
    const detail = `→ ${zielName} · ${fmtNum(parseFloat(vq.menge_liter ?? 0))} L`
    merkeStorno(vq)
    events.push({
      datum: v.datum,
      zeitpunkt: v.created_at ?? null,
      typ: 'verschneidung',
      titel: 'Verschneidung – abgegeben',
      details: [detail, v.notizen].filter(Boolean) as string[],
    })
  }

  for (const fc of alleFuellungen) {
    const f = fc.fuellung as R | null
    if (!f || !f.datum) continue

    const schwundZurFuellung = umzuege.find(
      (u) => u.umzug_typ === 'schwund' && u.datum === f.datum && !istStorniert(u)   // KAN-145
    )
    const schwundMenge = schwundZurFuellung
      ? parseFloat(schwundZurFuellung.schwund_liter ?? schwundZurFuellung.brutto_liter ?? '0')
      : null
    const gefuellt = f.menge_liter_gefuellt ? parseFloat(f.menge_liter_gefuellt) : null
    const verarbeitet = gefuellt != null && schwundMenge ? gefuellt + schwundMenge : null

    merkeStorno(f)
    events.push({
      datum: f.datum,
      zeitpunkt: f.erstellt_am ?? null,
      typ: 'fuellung',
      titel: f.name ?? 'Abfüllung',
      details: [
        f.chargennummer && `Charge: ${f.chargennummer}`,
        f.pruefnummer && `Prüfnr.: ${f.pruefnummer}`,
        f.anzahl_flaschen && f.flaschengroesse_ml
          ? `${fmtNum(parseInt(f.anzahl_flaschen))} × ${f.flaschengroesse_ml} ml`
          : null,
        gefuellt != null ? `${fmtNum(gefuellt)} L abgefüllt` : null,
        verarbeitet != null
          ? `Verarbeitete Menge aus Behälter: ${fmtNum(verarbeitet)} L (davon ${fmtNum(schwundMenge!)} L Schwund)`
          : null,
        fc.anteil_liter
          ? `Anteil diese Charge: ${fmtNum(parseFloat(fc.anteil_liter))} L`
          : null,
      ].filter(Boolean) as string[],
    })
  }

  // KAN-82: Abstufungen der Charge – Datum, Menge, alt → neu, Grund und Benutzer
  if (d.umstufungenFehler) warnungen.push(d.umstufungenFehler)
  for (const u of d.umstufungen) {
    const alt = { ...normalisiereQualitaet({ qualitaetsstufe: u.alt_qualitaetsstufe, zusatzbezeichnung: u.alt_zusatzbezeichnung, erzeugnis: u.alt_erzeugnis }), herkunft: u.alt_herkunft_code ?? null }
    const neu = { ...normalisiereQualitaet({ qualitaetsstufe: u.neu_qualitaetsstufe, zusatzbezeichnung: u.neu_zusatzbezeichnung, erzeugnis: u.neu_erzeugnis }), herkunft: u.neu_herkunft_code ?? null }
    events.push({
      datum: u.datum,
      zeitpunkt: u.erstellt_am ?? null,
      typ: 'umstufung',
      titel: `Abstufung: ${abstufungText(alt, neu)}`,
      details: [
        `${fmtNum(parseFloat(u.menge_liter ?? 0))} L`,
        (u.quelle as R | null)?.name ? `Teilmenge aus „${(u.quelle as R).name}“` : null,
        u.grund ? `Grund: ${u.grund}` : null,
        u.erstellt_von_name ? `von ${u.erstellt_von_name}` : null,
      ].filter(Boolean) as string[],
    })
  }

  // KAN-44 Teil 3: Mengenbewegungen – ab dem Journalbeginn aus dem Journal, davor aus Zukauf, Fassverkauf, Eröffnung
  if (tenantId) {
    let journalBeginn: string | null = null
    try {
      journalBeginn = opts.journalBeginn !== undefined ? opts.journalBeginn : await ladeJournalBeginn(supabase, tenantId)
    } catch (e) {
      warnungen.push(e instanceof Error ? e.message : 'Journalbeginn konnte nicht geladen werden.')
    }
    if (journalBeginn) {
      if (d.journalFehler) {
        warnungen.push(d.journalFehler)
      } else {
        const abstufungTage = new Set(d.umstufungen.map(u => tag(u.datum)).filter(Boolean))
        const zeilen = d.journal.map(z => ({ ...z, menge_liter: Number(z.menge_liter) || 0 }))
        events.push(...journalEreignisse(zeilen, { abstufungTage, journalBeginn }))
        if (zeilen.length > 0) {
          const h = journalAbweichungHinweis(journalSaldo(zeilen), parseFloat(String(wa.menge_liter ?? 0)) || 0)
          if (h) warnungen.push(h)
        }
      }
    }
    // Vor dem Journalbeginn bzw. ohne Journal: aus den Bewegungstabellen
    if (d.zkFvFehler) warnungen.push('Zukäufe bzw. Fassverkäufe der Charge konnten nicht geladen werden.')
    for (const z of d.zukaeufe) {
      momentaufnahmeAnwenden(z, ['lieferant_firma', 'lieferant_kontakt'])
      const ev = vorJournal(z.datum, journalBeginn) ? zukaufEreignis(z) : null
      if (!ev) continue
      merkeStorno(z)
      events.push(ev)
    }
    for (const p of d.fassverkaeufe) {
      const vp = p.verkaufsposten as R | null
      momentaufnahmeAnwenden(vp, ['firma', 'kontakt'])
      const ev = vorJournal(vp?.datum, journalBeginn) ? fassverkaufEreignis(p) : null
      if (!ev) continue
      merkeStorno(vp ?? {})
      events.push(ev)
    }
    const er = vorJournal(waRow.created_at, journalBeginn) ? eroeffnungEreignis(waRow) : null
    if (er) events.push(er)
  }

  // KAN-200: Prüfnummer je Charge (pruefnummer_chargen) – Übernahme per Umzug und Ende für den Tankbestand
  let pnVerlauf: PnVerlauf[] | undefined
  if (tenantId) {
    if (d.pnFehler) {
      warnungen.push(d.pnFehler)
    } else {
      const verlauf = d.pnVerlauf
      pnVerlauf = verlauf
      wa.pruefnummer = pnStandText(pnStandAm(verlauf))
      for (const e of pnVerlaufEreignisse(verlauf)) events.push({ ...e, typ: 'dac' })
    }
  }

  // KAN-145 B2b: stornierte Buchungen kennzeichnen und je einen Storno-Eintrag am Storno-Tag ergänzen
  for (const [i, st] of stornoIdx) {
    const ev = events[i]
    if (!ev) continue
    ev.badge = 'storniert'
    events.push({
      datum: tag(st.am),
      zeitpunkt: st.am,
      typ: ev.typ,
      titel: `Storno: ${ev.titel}`,
      badge: 'Storno',
      details: [
        `Buchung vom ${String(ev.datum).slice(0, 10).split('-').reverse().join('.')} storniert`,
        st.grund ? `Grund: ${st.grund}` : null,
        st.von ? `von ${st.von}` : null,
      ].filter(Boolean) as string[],
    })
  }

  // KAN-384: Tag, dann Erfassungszeitpunkt (Storno-Einträge: Zeitpunkt des Stornos); stabil für Einträge ohne Zeitpunkt
  events.sort(nachTagUndZeit(ev => ({ tag: ev.datum, zeit: ev.zeitpunkt ?? (ev.datum && ev.datum.length > 10 ? ev.datum : null) })))

  // Ende (KAN-127): leere Charge mit Füllungen → nach der letzten Füllung keine Einträge mehr; seit KAN-44 zählt auch
  // ein Fassverkauf (die Charge kann verkauft statt gefüllt worden sein)
  const fuellTage = alleFuellungen.filter(fc => !istStorniert(fc.fuellung as R | null)).map(fc => tag((fc.fuellung as R | null)?.datum)).filter(Boolean)
  const verkaufTage = events.filter(ev => ev.typ === 'verkauf' && !ev.badge).map(ev => tag(ev.datum)).filter(Boolean)
  const endTage = [...fuellTage, ...verkaufTage].sort()
  const abgeschlossenAm = parseFloat(String(wa.menge_liter ?? 0)) <= 0.5 && endTage.length > 0 ? endTage[endTage.length - 1] : null
  const imWeinbuch = abgeschlossenAm ? events.filter(ev => !tag(ev.datum) || tag(ev.datum) <= abgeschlossenAm) : events

  return { wa, events: imWeinbuch, warnungen, abgeschlossenAm, pnVerlauf }
}
