import 'server-only'

// ── Bestandsbuchungen von Verkauf und Storno (KAN-35, 24.09.2026) ────────────
// Übergangslösung bis zum Journal (AP3). Gemeinsam genutzt von
//   weinhandel/verkauf/actions.ts         (createVerkauf, stornoVerkauf)
//   weinhandel/traubenverkauf/actions.ts  (deleteTraubenverkauf → Storno der Rechnung)
//
// Grundsätze:
//  - Tankverkauf nur aus Kellerbuch-Chargen (weinausbau.menge_liter). Zugangs- und
//    Belegmengen (zukauf_posten.menge, pressung_behaelter.menge_liter) werden nie
//    mehr herabgesetzt oder zurückgebucht.
//  - Keine stillen Mengenänderungen: kein Math.max(0, …) – wer mehr bucht, als da
//    ist, bekommt eine Fehlermeldung (die DB-CHECKs weinausbau_menge_liter_nicht_negativ
//    und fuellungen_bestand_flaschen sind nur das Sicherheitsnetz).
//  - Rechte VOR dem ersten Schreibzugriff prüfen (pruefeVerkaufsRechte): Verkaufsposten
//    brauchen Warenwirtschaft, die Charge eines Tankverkaufs Kellerbuch oder Rieden (RLS,
//    Migration 218). Ein per RLS still gefiltertes UPDATE hinterließ sonst halbe Buchungen.
//  - Bestand ändern mit „Vergleichen und Setzen“: das UPDATE greift nur, wenn der
//    Bestand noch dem gelesenen Wert entspricht – zwei gleichzeitige Verkäufe
//    überschreiben sich so nicht gegenseitig (kein verlorenes Update).
//  - Chargen-Status folgt dem Bestand wie in allen übrigen Pfaden: leer (< 0,005 L)
//    → abgeschlossen/inaktiv; eine Rückbuchung auf eine abgeschlossene oder inaktive
//    Charge macht sie wieder aktiv (Status „Ausbau“, der Gebinde-Trigger der
//    Kellergemeinschaft prüft dabei das Gebinde).
//  - Verkäufe werden storniert, nie gelöscht. Beim Storno wird ZUERST der Bestand
//    zurückgebucht und erst dann das Kennzeichen gesetzt (nur bei storniert = false);
//    scheitert eins davon, wird die Rückbuchung zurückgenommen – es bleibt nichts halb.
// Alle Änderungen landen über die DB-Trigger im bestandsprotokoll (mit Benutzer) –
// deshalb immer mit dem Benutzer-Client (createSupabaseServerClient) aufrufen.

import { AktionsFehler, dbFehlerText, fehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'
import { gebindeFehlerText } from '@/lib/keller/behaelter'
import { getCurrentMembership, canWrite, type Membership } from '@/lib/auth/roles'
import { lokalerTag, wienJetzt } from '@/lib/datum/wien'
import { stornoGrundFehler } from '@/lib/storno/grund'
import type { createSupabaseServerClient } from '@/lib/supabase/server'

type SB = Awaited<ReturnType<typeof createSupabaseServerClient>>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Unter einem halben Milliliter gilt ein Liter-Rest als 0 (Gleitkomma-Rauschen, keine Mengenänderung) */
export const LITER_TOLERANZ = 0.0005

/** Rest, ab dem eine Charge als leer gilt: weinausbau.menge_liter ist numeric(10,2) – darunter speichert die DB 0,00 */
const LEER_UNTER = 0.005

const VERSUCHE = 4

/** Gleitkomma-Rauschen entfernen (0,1 + 0,2 = 0,30000000000000004) */
function literRunden(x: number): number {
  const r = Math.round(x * 1e6) / 1e6
  return Math.abs(r) < LITER_TOLERANZ ? 0 : r
}

// ── Rechte ────────────────────────────────────────────────────────────────────

/**
 * Schreibrechte für einen Verkauf bzw. Storno VOR dem ersten Schreibzugriff prüfen
 * (wie RLS, Migration 218): verkaufsposten/verkauf_positionen → Warenwirtschaft,
 * fuellungen (Flaschen) → Kellerbuch oder Warenwirtschaft, weinausbau (Tank) →
 * Kellerbuch oder Rieden.
 */
export function pruefeVerkaufsRechte(
  m: Membership,
  opts: { tank: boolean; flasche: boolean; vorgang: 'verkauf' | 'storno'; rechnungsnummer?: string | null },
): void {
  const beleg = opts.rechnungsnummer ? `Die Rechnung ${opts.rechnungsnummer}` : 'Der Verkauf'
  if (!canWrite(m, 'warenwirtschaft')) {
    throw new AktionsFehler(opts.vorgang === 'storno'
      ? `${beleg} kann nur von einem Betriebs-Manager oder einem Mitarbeiter mit Freigabe Warenwirtschaft storniert werden (Weinhandel › Verkauf). Es wurde nichts geändert.`
      : 'Keine Berechtigung für Verkäufe – dafür ist die Freigabe Warenwirtschaft nötig.')
  }
  if (opts.flasche && !(canWrite(m, 'kellerbuch') || canWrite(m, 'warenwirtschaft'))) {
    throw new AktionsFehler('Keine Berechtigung, den Flaschenbestand zu ändern – dafür ist die Freigabe Kellerbuch oder Warenwirtschaft nötig.')
  }
  if (opts.tank && !(canWrite(m, 'kellerbuch') || canWrite(m, 'rieden'))) {
    throw new AktionsFehler(opts.vorgang === 'storno'
      ? `${beleg} enthält offenen Wein (Tank): Beim Storno werden die Liter auf die Kellerbuch-Charge zurückgebucht – das dürfen nur Betriebs-Manager und Mitarbeiter mit Freigabe Kellerbuch (oder Rieden). Bitte den Storno von ihnen durchführen lassen. Es wurde nichts geändert.`
      : 'Ein Tankverkauf bucht die Liter von der Kellerbuch-Charge ab – dafür ist zusätzlich zur Warenwirtschaft die Freigabe Kellerbuch (oder Rieden) nötig. Bitte den Verkauf von einem Betriebs-Manager oder einem Mitarbeiter mit Kellerbuch-Freigabe erfassen lassen.')
  }
}

// ── Charge (offener Wein) ─────────────────────────────────────────────────────

/** Eine ausgeführte Bestandsänderung an einer Charge – Grundlage für die Rücknahme */
export type ChargeBuchung = {
  id: string
  name: string
  delta: number
  /** menge_liter, aktiv, status vor bzw. nach der Buchung */
  vorher: { menge_liter: number | string | null; aktiv: boolean; status: string | null }
  nachher: { menge_liter: number; aktiv: boolean; status: string | null }
}

/**
 * Liter-Bestand einer Kellerbuch-Charge um `deltaLiter` ändern (negativ = Abgang).
 * Lehnt ab, wenn der Bestand dadurch negativ würde. Bleibt nichts übrig, wird die
 * Charge abgeschlossen; eine Rückbuchung auf eine abgeschlossene/inaktive Charge macht
 * sie wieder aktiv (Status „Ausbau“). Liefert die ausgeführte Buchung (für die Rücknahme).
 */
export async function chargeBestandAendern(
  supabase: SB,
  tenantId: string,
  weinausbauId: string,
  deltaLiter: number,
): Promise<ChargeBuchung> {
  if (!Number.isFinite(deltaLiter)) throw new AktionsFehler('Ungültige Literangabe für die Bestandsbuchung')
  let vorherText: string | undefined
  for (let versuch = 0; versuch < VERSUCHE; versuch++) {
    const { data, error } = await (supabase.from('weinausbau') as any)
      .select('name, menge_liter, aktiv, status')
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Bestand der Charge konnte nicht gelesen werden'))
    if (!data) throw new AktionsFehler('Kellerbuch-Charge nicht gefunden – bitte Seite neu laden.')
    const w = data as R
    const roh = w.menge_liter as number | string | null
    // Zweiter Durchlauf mit unverändertem Wert: das UPDATE wurde nicht durch eine
    // gleichzeitige Buchung verhindert, sondern von RLS (keine Schreibberechtigung)
    if (versuch > 0 && String(roh) === vorherText) {
      throw new AktionsFehler(`Der Bestand der Charge „${w.name}“ konnte nicht geändert werden – vermutlich fehlt die Schreibberechtigung für das Kellerbuch`)
    }
    vorherText = String(roh)

    const aktuell = roh == null ? 0 : Number(roh)
    const neu = literRunden(aktuell + deltaLiter)
    if (neu < 0) {
      throw new AktionsFehler(
        `„${w.name}“: nur noch ${fmtNum(aktuell)} L verfügbar, ${fmtNum(-deltaLiter)} L angefragt.`,
      )
    }

    // Status folgt dem Bestand (wie Umzug, Verschnitt, Füllung, Schwund)
    const werte: R = { menge_liter: neu }
    let aktivNeu = w.aktiv !== false
    let statusNeu = (w.status as string | null) ?? null
    if (neu < LEER_UNTER) {
      werte.menge_liter = 0
      if (deltaLiter < 0) {
        werte.aktiv = false
        werte.status = 'abgeschlossen'
        aktivNeu = false
        statusNeu = 'abgeschlossen'
      }
    } else if (w.aktiv === false || w.status === 'abgeschlossen') {
      werte.aktiv = true
      aktivNeu = true
      if (w.status === 'abgeschlossen') { werte.status = 'ausbau'; statusNeu = 'ausbau' }
    }

    let q = (supabase.from('weinausbau') as any)
      .update(werte)
      .eq('id', weinausbauId)
      .eq('tenant_id', tenantId)
    // Vergleichen und Setzen (Bereich statt Gleichheit: numeric → JSON-Zahl ist nicht immer exakt)
    q = roh == null
      ? q.is('menge_liter', null)
      : q.gte('menge_liter', aktuell - 1e-9).lte('menge_liter', aktuell + 1e-9)
    const { data: geaendert, error: uErr } = await q.select('id')
    if (uErr) {
      // P0001 (weinausbau_gebinde_pruefen): Gebinde inzwischen durch einen anderen Betrieb belegt
      const text = gebindeFehlerText(dbFehlerText(uErr, `Bestand der Charge „${w.name}“ konnte nicht gespeichert werden`))
      throw new AktionsFehler((uErr as R).code === 'P0001'
        ? `Charge „${w.name}“: ${text.replace(/[.\s]+$/, '')}. Bitte das Gebinde freimachen bzw. Support kontaktieren`
        : text)
    }
    if ((geaendert as R[] | null)?.length) {
      return {
        id: weinausbauId,
        name: String(w.name ?? ''),
        delta: deltaLiter,
        vorher: { menge_liter: roh, aktiv: w.aktiv !== false, status: (w.status as string | null) ?? null },
        nachher: { menge_liter: Number(werte.menge_liter), aktiv: aktivNeu, status: statusNeu },
      }
    }
    // 0 Zeilen: Bestand wurde inzwischen geändert → neu lesen und erneut versuchen
  }
  throw new AktionsFehler('Der Bestand der Charge wurde gleichzeitig mehrfach geändert – bitte erneut versuchen.')
}

/**
 * Eine mit chargeBestandAendern ausgeführte Buchung zurücknehmen: Menge, aktiv und Status
 * auf den Stand davor – per Vergleichen und Setzen gegen den Stand danach. Hat sich der
 * Bestand inzwischen geändert, wird nur die Menge um das Gegen-Delta korrigiert.
 */
export async function chargeBuchungZuruecknehmen(supabase: SB, tenantId: string, b: ChargeBuchung): Promise<void> {
  const nachher = b.nachher.menge_liter
  const { data, error } = await (supabase.from('weinausbau') as any)
    .update({ menge_liter: b.vorher.menge_liter, aktiv: b.vorher.aktiv, status: b.vorher.status })
    .eq('id', b.id)
    .eq('tenant_id', tenantId)
    .gte('menge_liter', nachher - 1e-9)
    .lte('menge_liter', nachher + 1e-9)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, `Charge „${b.name}“ konnte nicht zurückgesetzt werden`))
  if ((data as R[] | null)?.length) return
  await chargeBestandAendern(supabase, tenantId, b.id, -b.delta)
}

// ── Füllung (Flaschen) ────────────────────────────────────────────────────────

/** Bezug einer Flaschenbuchung zum Verkauf (KAN-149 D1): Beleg, Buchungstag, optional Grund */
export type FlaschenKontext = { postenId: string; datum: string; grund?: string | null }

/** Heutiger Tag in Wien (JJJJ-MM-TT) – Buchungstag von Storno und Rücknahme */
export function heuteWien(): string {
  return lokalerTag(wienJetzt())
}

/**
 * Flaschenbestand einer Füllung um `deltaStk` ändern (negativ = Verkauf, positiv = Storno-Rückbuchung, ganze Stück).
 * Seit KAN-149 D1 über die RPC s112_fuellung_verkauf_buchen: Sperre auf der Füllung, datierte Zeile in
 * fuellung_bewegungen (Art verkauf/verkauf_storno mit Bestand vorher/nachher und Verkaufsbezug) – die Bestandskette
 * hat so keine Lücken mehr. Lehnt ab, wenn der Bestand negativ würde. Liefert den neuen Bestand.
 */
export async function fuellungBestandAendern(
  supabase: SB,
  tenantId: string,
  fuellungId: string,
  deltaStk: number,
  kontext: FlaschenKontext,
): Promise<number> {
  if (!Number.isInteger(deltaStk)) throw new AktionsFehler('Flaschen können nur in ganzen Stück gebucht werden.')
  const { data, error } = await (supabase.rpc as any)('s112_fuellung_verkauf_buchen', {
    p_tenant_id: tenantId,
    p_fuellung_id: fuellungId,
    p_verkaufsposten_id: kontext.postenId,
    p_menge_stk: deltaStk,
    p_datum: kontext.datum,
    p_grund: kontext.grund ?? null,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Flaschenbestand konnte nicht gebucht werden'))
  return Number(data)
}

// ── Mehrere Buchungen mit Rücknahme ───────────────────────────────────────────

export type BestandsBuchung =
  | { art: 'charge'; buchung: ChargeBuchung }
  | { art: 'flasche'; fuellungId: string; stueck: number; kontext: FlaschenKontext }

/** Ausgeführte Buchungen in umgekehrter Reihenfolge zurücknehmen; liefert die Fehlschläge als Text */
export async function bestandsBuchungenZuruecknehmen(
  supabase: SB,
  tenantId: string,
  buchungen: BestandsBuchung[],
): Promise<string[]> {
  const fehler: string[] = []
  for (const b of [...buchungen].reverse()) {
    try {
      if (b.art === 'charge') await chargeBuchungZuruecknehmen(supabase, tenantId, b.buchung)
      // Rücknahme als Gegenzeile am heutigen Tag (die Bestandskette bleibt vollständig)
      else await fuellungBestandAendern(supabase, tenantId, b.fuellungId, -b.stueck,
        { postenId: b.kontext.postenId, datum: heuteWien(), grund: 'Rücknahme: Buchung nicht abgeschlossen' })
    } catch (e) {
      fehler.push(fehlerText(e, 'Rücknahme fehlgeschlagen').replace(/[.\s]+$/, ''))
    }
  }
  return fehler
}

/**
 * Bestand je Charge (Liter) und Füllung (Stück) ändern – alles oder nichts: scheitert eine
 * Buchung, werden die bereits ausgeführten zurückgenommen und der Fehler geworfen.
 * Vorzeichen: negativ = Abgang (Verkauf), positiv = Zugang (Storno).
 */
export async function bestandBuchenAllesOderNichts(
  supabase: SB,
  tenantId: string,
  literJeCharge: Map<string, number>,
  stueckJeFuellung: Map<string, number>,
  /** Verkauf, Buchungstag und Grund der Flaschenzeilen (KAN-149 D1) */
  flaschen: FlaschenKontext,
): Promise<BestandsBuchung[]> {
  const ausgefuehrt: BestandsBuchung[] = []
  try {
    for (const [fuellungId, stueck] of stueckJeFuellung) {
      if (stueck === 0) continue
      await fuellungBestandAendern(supabase, tenantId, fuellungId, stueck, flaschen)
      ausgefuehrt.push({ art: 'flasche', fuellungId, stueck, kontext: flaschen })
    }
    for (const [weinausbauId, liter] of literJeCharge) {
      if (Math.abs(liter) < LITER_TOLERANZ) continue
      const buchung = await chargeBestandAendern(supabase, tenantId, weinausbauId, liter)
      ausgefuehrt.push({ art: 'charge', buchung })
    }
  } catch (e) {
    const meldung = fehlerText(e, 'Bestandsbuchung fehlgeschlagen').replace(/[.\s]+$/, '')
    const rueckFehler = await bestandsBuchungenZuruecknehmen(supabase, tenantId, ausgefuehrt)
    throw new AktionsFehler(rueckFehler.length
      ? `${meldung}. Achtung: Bereits gebuchte Bestände konnten nicht zurückgesetzt werden (${rueckFehler.join(' · ')}) – bitte Bestand prüfen und Support kontaktieren.`
      : `${meldung}.`)
  }
  return ausgefuehrt
}

// ── Storno ────────────────────────────────────────────────────────────────────

/**
 * Verkaufsposten stornieren – der einzige Weg, einen Verkauf zurückzunehmen
 * (Verkäufe werden nie gelöscht oder deaktiviert).
 *  0. Rechte prüfen (Warenwirtschaft; bei Tankpositionen zusätzlich Kellerbuch/Rieden)
 *  1. Bestand zurückbuchen: Flaschen (fuellungen.bestand_flaschen) und offener Wein aus
 *     Chargen (weinausbau.menge_liter, abgeschlossene Chargen werden wieder aktiv).
 *     Positionen mit Zukauf-/Pressungsbezug (Altbestand, 0 Zeilen) werden nicht
 *     zurückgebucht – Zugangsmengen bleiben unverändert. Scheitert eine Rückbuchung
 *     (z. B. Gebinde inzwischen fremd belegt), wird alles zurückgenommen: nichts geändert.
 *  2. Kennzeichen storniert/storniert_am mit Grund setzen (KAN-149 D1: Benutzer und Zeitpunkt setzt die Datenbank,
 *     Trigger a_verkauf_storno_schutz) – nur wenn noch nicht storniert; sonst
 *     (Doppelklick, zweiter Tab) wird die Rückbuchung zurückgenommen.
 *  3. Traubenverkauf-Datensätze des Postens stornieren (KAN-148: Kennzeichen statt Löschen – die Zeile, ihre
 *     Liefernummer und verkauf_positionen.traubenverkauf_id bleiben, die kg werden frei; über
 *     verkauf_positionen.traubenverkauf_id UND traubenverkauf.verkaufsposten_id – auch Rechnungen aus
 *     Traubenverkauf/Erntemeldung). Grund: derselbe wie beim Verkauf.
 *  4. Mit Erstattung (KAN-149 D2b, Ticket Frage 1): die gültigen Zahlungen am Erstattungstag stornieren – ihre
 *     E&A-Einnahmen bucht s112_zahlung_stornieren an diesem Tag gegen. Ohne Erstattung bleiben Zahlungen und
 *     Einnahmen stehen (das Geld ist eingegangen). CRM-Aktivität kennzeichnen.
 * Scheitert Schritt 3 oder 4, ist der Verkauf storniert und der Bestand zurückgebucht:
 * am Ende kommt eine Fehlermeldung mit den offenen Punkten.
 */
export async function verkaufspostenStornieren(
  supabase: SB, tenantId: string, postenId: string, grund: string,
  /** KAN-149 D2b: bezahlte Beträge am Tag erstattet (JJJJ-MM-TT) → Zahlungen stornieren, Einnahmen gegenbuchen */
  opt: { erstattetAm?: string | null } = {},
): Promise<void> {
  // KAN-149 D1: Grund Pflicht (mind. 10 Zeichen) – Beleg, Flaschenzeilen und Traubenverkauf tragen ihn
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)
  const stornoGrund = grund.trim()
  const { data: postenRaw, error: postenErr } = await (supabase.from('verkaufsposten') as any)
    .select('id, rechnungsnummer, storniert')
    .eq('id', postenId)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (postenErr) throw new AktionsFehler(dbFehlerText(postenErr, 'Verkauf konnte nicht geladen werden'))
  if (!postenRaw) throw new AktionsFehler('Verkauf nicht gefunden – bitte Seite neu laden.')
  const posten = postenRaw as R
  if (posten.storniert) {
    throw new AktionsFehler('Dieser Verkauf ist bereits storniert – der Bestand wurde schon zurückgebucht.')
  }

  // Positionen und Traubenverkäufe VOR dem ersten Schreibzugriff lesen:
  // ein Lesefehler bricht so ab, bevor irgendetwas geändert ist.
  const { data: posRaw, error: posErr } = await (supabase.from('verkauf_positionen') as any)
    .select('name, typ, fuellung_id, weinausbau_id, menge, traubenverkauf_id')
    .eq('verkaufsposten_id', postenId)
    .eq('tenant_id', tenantId)
  if (posErr) throw new AktionsFehler(dbFehlerText(posErr, 'Positionen des Verkaufs konnten nicht geladen werden'))
  const positionen = (posRaw ?? []) as R[]

  const { data: tvRaw, error: tvErr } = await (supabase.from('traubenverkauf') as any)
    .select('id')
    .eq('verkaufsposten_id', postenId)
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)
  if (tvErr) throw new AktionsFehler(dbFehlerText(tvErr, 'Traubenverkäufe des Verkaufs konnten nicht geladen werden'))
  const tvIds = [...new Set<string>([
    ...((tvRaw ?? []) as R[]).map(t => t.id as string),
    ...positionen.filter(p => p.traubenverkauf_id).map(p => p.traubenverkauf_id as string),
  ])]

  // 0. Rechte vor dem ersten Schreibzugriff
  const literJeCharge = new Map<string, number>()
  const stueckJeFuellung = new Map<string, number>()
  for (const p of positionen) {
    if (p.typ === 'flasche' && p.fuellung_id) {
      // Math.round wie bei der ursprünglichen Abbuchung (ältere Positionen); neue sind ganzzahlig
      stueckJeFuellung.set(p.fuellung_id, (stueckJeFuellung.get(p.fuellung_id) ?? 0) + Math.round(Number(p.menge) || 0))
    } else if (p.typ === 'tank' && p.weinausbau_id) {
      literJeCharge.set(p.weinausbau_id, (literJeCharge.get(p.weinausbau_id) ?? 0) + (Number(p.menge) || 0))
    }
  }
  const membership = await getCurrentMembership()
  if (!membership || membership.tenantId !== tenantId) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  pruefeVerkaufsRechte(membership, {
    tank: literJeCharge.size > 0,
    flasche: stueckJeFuellung.size > 0,
    vorgang: 'storno',
    rechnungsnummer: posten.rechnungsnummer ?? null,
  })

  // 1. Bestand zurückbuchen – alles oder nichts
  let rueckbuchungen: BestandsBuchung[]
  try {
    rueckbuchungen = await bestandBuchenAllesOderNichts(supabase, tenantId, literJeCharge, stueckJeFuellung,
      { postenId, datum: heuteWien(), grund: stornoGrund })
  } catch (e) {
    throw new AktionsFehler(`Der Verkauf konnte nicht storniert werden – der Bestand ließ sich nicht zurückbuchen: ${fehlerText(e).replace(/[.\s]+$/, '')}. Es wurde nichts geändert.`)
  }

  // 2. Kennzeichen setzen – nur, wenn der Posten noch nicht storniert ist
  const { data: gesetzt, error: setzErr } = await (supabase.from('verkaufsposten') as any)
    .update({ storniert: true, storniert_am: new Date().toISOString(), storno_grund: stornoGrund })
    .eq('id', postenId)
    .eq('tenant_id', tenantId)
    .eq('storniert', false)
    .select('id')
  if (setzErr || !(gesetzt as R[] | null)?.length) {
    let grund: string
    if (setzErr) {
      grund = dbFehlerText(setzErr, 'Storno fehlgeschlagen (verkaufsposten)')
    } else {
      const { data: jetzt } = await (supabase.from('verkaufsposten') as any)
        .select('storniert')
        .eq('id', postenId)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      grund = (jetzt as R | null)?.storniert
        ? 'Dieser Verkauf wurde soeben bereits storniert – bitte Seite neu laden'
        : 'Der Verkauf konnte nicht storniert werden – vermutlich fehlt die Schreibberechtigung für Verkäufe'
    }
    const rueckFehler = await bestandsBuchungenZuruecknehmen(supabase, tenantId, rueckbuchungen)
    throw new AktionsFehler(rueckFehler.length
      ? `${grund.replace(/[.\s]+$/, '')}. Achtung: Der bereits zurückgebuchte Bestand konnte nicht zurückgesetzt werden (${rueckFehler.join(' · ')}) – bitte Bestand prüfen und Support kontaktieren.`
      : `${grund.replace(/[.\s]+$/, '')}. Es wurde nichts geändert.`)
  }

  const probleme: string[] = []

  // 3. Traubenverkauf-Datensätze stornieren (KAN-148) → verfügbare kg werden wieder frei; Zeile, Liefernummer und
  //    Rechnungsbezug bleiben. Schon stornierte (Verweis aus einer Position) bleiben unverändert.
  if (tvIds.length > 0) {
    const tvGrund = `Rechnung ${posten.rechnungsnummer ?? '(ohne Nummer)'} storniert: ${stornoGrund}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: stornoErr } = await (supabase.from('traubenverkauf') as any)
      .update({ storniert_am: new Date().toISOString(), storno_grund: tvGrund })
      .in('id', tvIds)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null)
    if (stornoErr) probleme.push(dbFehlerText(stornoErr, 'Traubenverkauf (BKI) konnte nicht storniert werden'))
    else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: offen, error: offenErr } = await (supabase.from('traubenverkauf') as any)
        .select('id', { count: 'exact', head: true })
        .in('id', tvIds)
        .eq('tenant_id', tenantId)
        .is('storniert_am', null)
      if (offenErr) probleme.push(dbFehlerText(offenErr, 'Storno des Traubenverkaufs (BKI) konnte nicht geprüft werden'))
      else if ((offen ?? 0) > 0) {
        probleme.push('Traubenverkauf (BKI) konnte nicht storniert werden – keine Schreibberechtigung. Bitte unter Weinhandel › Traubenverkauf stornieren')
      }
    }
  }

  // 4a. Erstattung (KAN-149 D2b): gültige Zahlungen am Erstattungstag stornieren – die RPC bucht ihre E&A-Einnahmen an
  //     diesem Tag gegen (offener Zeitraum). Ohne Erstattung bleiben Zahlungen und Einnahmen stehen; der Aufrufer
  //     gleicht danach die Einnahmen ab (Alt-Einnahmen ohne Zahlungsbezug). Fehler landen als offener Punkt in
  //     `probleme` – der Storno ist dann schon durchgeführt.
  if (opt.erstattetAm) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: zRaw, error: zErr } = await (supabase.from('zahlungen') as any)
      .select('id')
      .eq('verkaufsposten_id', postenId)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null)
    if (zErr) probleme.push(dbFehlerText(zErr, 'Zahlungen des Verkaufs konnten nicht geladen werden'))
    for (const z of ((zRaw ?? []) as R[])) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase.rpc as any)('s112_zahlung_stornieren', {
        p_tenant_id: tenantId, p_zahlung_id: z.id, p_grund: `Erstattung – ${stornoGrund}`, p_datum: opt.erstattetAm,
      })
      if (error) probleme.push(dbFehlerText(error, 'Zahlung konnte nicht storniert werden (Erstattung)'))
    }
  }

  // 4b. CRM-Aktivität auf STORNIERT setzen (nicht kritisch)
  {
    const { error: crmErr } = await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${posten.rechnungsnummer ?? ''} · STORNIERT` })
      .eq('beschreibung', `Verkaufsposten: ${postenId}`)
      .eq('tenant_id', tenantId)
    if (crmErr) console.error('verkaufspostenStornieren – CRM-Aktivität:', crmErr.message)
  }

  if (probleme.length > 0) {
    throw new AktionsFehler(
      `Der Verkauf ist storniert und der Bestand zurückgebucht, aber: ${probleme.map(t => t.replace(/[.\s]+$/, '')).join(' · ')}.`,
    )
  }
}
