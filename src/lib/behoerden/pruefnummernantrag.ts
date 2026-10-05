// ── Behördenmeldung „Antrag auf Erteilung einer staatlichen Prüfnummer“ (24.09.2026) ──
//
// Eine Ladefunktion für Druckseite (dac/[id]/antrag) UND CSV
// (/meldungen/pruefnummernantrag/csv?id=…): Formulardaten aus
// pruefnummernantraege.formular_daten (JSONB) bzw. – solange nichts gespeichert ist –
// die Vorbelegung, die auch die Druckansicht zeigt (in der CSV als „nicht gespeicherte
// Vorbelegung“ gekennzeichnet).
//
// CSV: eine Zeile je ausgefüllter Mostcharge (Mostwägerbestätigung, nur bei
// Prädikatsweinen), die Kopffelder des Antrags in jeder Zeile. Ohne Mostcharge
// genau eine Zeile mit den Kopffeldern.
//
// Isomorph ohne Server-Importe – Tests: scripts/tests/verkehr.test.mjs

/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase-Abfragen nach Projektkonvention mit „as any“ (CLAUDE.md) */
import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import { qualitaetText } from '@/lib/weinqualitaet'
import { HERKUNFT_LABEL } from '@/lib/herkunft'
import { formatKmw } from '@/lib/wein/mostgewicht'
import { UUID_RE, datumAusEingabe, feld, strasseTeilen, textOderNull, zahlFeld, type R } from './verkehr-hilfen'
import { FORMULAR_GESPEICHERT, FORMULAR_VORBELEGUNG } from './transportbescheinigung'

// ── Formular (JSONB) ─────────────────────────────────────────────────────────

export type PNAMostcharge = {
  betriebsnummer: string
  laufende_nr: string
  jahr: string
  teilmenge: string
}

export type PNADaten = {
  antragsnummer: string
  untersuchungsnummer: string
  eingangsdatum: string
  // Antragsteller
  betriebsnummer: string
  name: string
  vorname: string
  plz: string
  ort: string
  strasse: string
  hausnr: string
  telefon: string
  telefax: string
  email: string
  // Bevollmächtigter
  bevo_name: string
  bevo_vorname: string
  // Aufbewahrungsort
  aufbew_plz: string
  aufbew_ort: string
  aufbew_strasse: string
  aufbew_hausnr: string
  // Weinangaben
  farbe: 'Weiß' | 'Rot' | 'Rosé' | 'Gleichgepresst'
  jahrgangsverschnitt: boolean
  jahrgang: string
  lesegradation: string
  angereichert: boolean
  gesuesst: boolean
  einreichmenge: string
  rebsorte: string
  abgefuellt: '' | 'Ja' | 'Teilweise'
  teilmenge_pn: string
  // Bezeichnung
  bez_rebsorte: string
  qualitaetsstufe: string
  weinbaugebiet: string
  bez_jahrgang: string
  reserve: boolean
  grosse_reserve: boolean
  premium: boolean
  barrique: boolean
  ried: string
  gemeinde: string
  schilcher: boolean
  schilcher_klassik: boolean
  bio_wein: boolean
  sonstiges: string
  // Checkboxen
  naechste_qualitaet: boolean
  versiegelungsverzicht: boolean
  mostchargen: PNAMostcharge[]
}

const LEERE_MOSTCHARGE: PNAMostcharge = { betriebsnummer: '', laufende_nr: '', jahr: '', teilmenge: '' }

/** KAN-98: Farbe des Antrags aus der Weinart der Charge (weiss/rot/rose); sonst null */
export function farbeAusWeinart(weinart: unknown): PNADaten['farbe'] | null {
  return weinart === 'weiss' ? 'Weiß' : weinart === 'rot' ? 'Rot' : weinart === 'rose' ? 'Rosé' : null
}

/** Vorbelegung eines noch nicht gespeicherten Antrags (unverändert wie bisher in der Druckansicht).
 *  KAN-98: aus der Charge zusätzlich Farbe (Weinart), Lesegradation (KMW), Qualitätsstufe und Weinbaugebiet
 *  (Herkunft) – bei einem DAC-Antrag bleiben Qualitätsstufe/Weinbaugebiet die DAC-Region.
 *  KAN-186: Reserve/Große Reserve aus der Zusatzbezeichnung der Charge (`charge`: qualitaetsstufe,
 *  zusatzbezeichnung – Altwert 'reserve' im Qualitätsfeld wird normalisiert). */
export function pnaVorbelegung(dac: R, cfg: R, charge?: R | null): PNADaten {
  const zusatz = charge ? normalisiereQualitaet(charge).zusatz : null
  const { strasse, hausnr } = strasseTeilen(cfg.betrieb_strasse)
  const menge = dac.menge_liter === null || dac.menge_liter === undefined ? NaN : Number(dac.menge_liter)
  const istDac = !!dac.dac_region && dac.dac_region !== 'sonstiges'
  const kmw = charge?.kmw === null || charge?.kmw === undefined ? NaN : Number(charge.kmw)
  const herkunft = charge?.herkunft_code ? (HERKUNFT_LABEL[String(charge.herkunft_code)] ?? String(charge.herkunft_code)) : ''
  const qualitaet = charge ? qualitaetText(normalisiereQualitaet(charge)) : ''
  return {
    antragsnummer: '',
    untersuchungsnummer: '',
    eingangsdatum: '',
    betriebsnummer: feld(cfg.betrieb_betriebsnummer),
    name: feld(cfg.betrieb_name),
    vorname: '',
    plz: feld(cfg.betrieb_plz),
    ort: feld(cfg.betrieb_ort),
    strasse,
    hausnr,
    telefon: feld(cfg.betrieb_telefon),
    telefax: '',
    email: feld(cfg.betrieb_email),
    bevo_name: '',
    bevo_vorname: '',
    aufbew_plz: '',
    aufbew_ort: '',
    aufbew_strasse: '',
    aufbew_hausnr: '',
    farbe: farbeAusWeinart(charge?.weinart) ?? 'Weiß',
    jahrgangsverschnitt: false,
    jahrgang: dac.jahrgang ? String(dac.jahrgang) : '',
    // KAN-131 (Entscheidung 05.10.2026): °KMW der Charge als Information, wie gespeichert (bis 2 Stellen, abgerundet) –
    // ersetzt die Mostwäger-Bestätigung nicht
    lesegradation: Number.isFinite(kmw) && kmw > 0 ? `${formatKmw(kmw, 2)} °KMW` : '',
    angereichert: false,
    gesuesst: false,
    einreichmenge: Number.isFinite(menge) && menge !== 0 ? String(runden(menge, 0)) : '',
    rebsorte: dac.rebsorte ? formatRebsorteMitKuerzel(dac.rebsorte) : '',
    abgefuellt: '',
    teilmenge_pn: '',
    bez_rebsorte: dac.rebsorte ? formatRebsorteMitKuerzel(dac.rebsorte) : '',
    qualitaetsstufe: istDac || !qualitaet ? feld(dac.dac_region) : qualitaet,
    weinbaugebiet: istDac || !herkunft ? feld(dac.dac_region) : herkunft,
    bez_jahrgang: dac.jahrgang ? String(dac.jahrgang) : '',
    reserve: zusatz === 'reserve',
    grosse_reserve: zusatz === 'grosse_reserve',
    premium: false,
    barrique: false,
    ried: '',
    gemeinde: feld(cfg.betrieb_ort),
    schilcher: false,
    schilcher_klassik: false,
    bio_wein: false,
    sonstiges: '',
    naechste_qualitaet: false,
    versiegelungsverzicht: false,
    mostchargen: [{ ...LEERE_MOSTCHARGE }, { ...LEERE_MOSTCHARGE }, { ...LEERE_MOSTCHARGE }],
  }
}

// ── CSV-Zeile ────────────────────────────────────────────────────────────────

export type PNAZeile = {
  dacBezeichnung: string | null
  formularstand: string
  gespeichertAm: string | null
  antragsnummer: string
  untersuchungsnummer: string
  eingangsdatum: string | null
  betriebsnummer: string
  name: string
  vorname: string
  plz: string
  ort: string
  strasse: string
  hausnr: string
  telefon: string
  telefax: string
  email: string
  bevoName: string
  bevoVorname: string
  aufbewPlz: string
  aufbewOrt: string
  aufbewStrasse: string
  farbe: string | null
  jahrgangsverschnitt: boolean | null
  jahrgang: string | null
  lesegradation: string | null
  angereichert: boolean | null
  gesuesst: boolean | null
  einreichmengeL: number | null
  rebsorte: string | null
  abgefuellt: string | null
  teilmengePnL: number | null
  bezRebsorte: string | null
  qualitaetsstufe: string | null
  weinbaugebiet: string | null
  bezJahrgang: string | null
  reserve: boolean | null
  grosseReserve: boolean | null
  premium: boolean | null
  barrique: boolean | null
  schilcher: boolean | null
  schilcherKlassik: boolean | null
  bioWein: boolean | null
  ried: string | null
  gemeinde: string | null
  sonstiges: string | null
  naechsteQualitaet: boolean | null
  versiegelungsverzicht: boolean | null
  mostchargeNr: number | null
  mcBetriebsnummer: string | null
  mcLaufendeNr: string | null
  mcJahr: string | null
  mcTeilmengeL: number | null
}

export const SPALTEN_PRUEFNUMMERNANTRAG: CsvSpalte<PNAZeile>[] = [
  { kopf: 'DAC-Antrag', typ: 'text', wert: z => z.dacBezeichnung },
  { kopf: 'Formularstand', typ: 'text', wert: z => z.formularstand },
  { kopf: 'Gespeichert am', typ: 'zeitpunkt', wert: z => z.gespeichertAm },
  { kopf: 'Antragsnummer', typ: 'code', wert: z => z.antragsnummer },
  { kopf: 'Untersuchungsnummer', typ: 'code', wert: z => z.untersuchungsnummer },
  { kopf: 'Eingangsdatum', typ: 'datum', wert: z => z.eingangsdatum },
  { kopf: 'Betriebsnummer', typ: 'code', wert: z => z.betriebsnummer },
  { kopf: 'Firmen- oder Familienname', typ: 'text', wert: z => z.name },
  { kopf: 'Vorname', typ: 'text', wert: z => z.vorname },
  { kopf: 'PLZ', typ: 'code', wert: z => z.plz },
  { kopf: 'Ort', typ: 'text', wert: z => z.ort },
  { kopf: 'Straße', typ: 'text', wert: z => z.strasse },
  { kopf: 'Hausnr.', typ: 'code', wert: z => z.hausnr },
  { kopf: 'Telefon', typ: 'code', wert: z => z.telefon },
  { kopf: 'Telefax', typ: 'code', wert: z => z.telefax },
  { kopf: 'E-Mail', typ: 'text', wert: z => z.email },
  { kopf: 'Bevollmächtigter Familienname', typ: 'text', wert: z => z.bevoName },
  { kopf: 'Bevollmächtigter Vorname', typ: 'text', wert: z => z.bevoVorname },
  { kopf: 'Aufbewahrungsort PLZ', typ: 'code', wert: z => z.aufbewPlz },
  { kopf: 'Aufbewahrungsort Ort', typ: 'text', wert: z => z.aufbewOrt },
  { kopf: 'Aufbewahrungsort Straße', typ: 'text', wert: z => z.aufbewStrasse },
  { kopf: 'Farbe', typ: 'text', wert: z => z.farbe },
  { kopf: 'Jahrgangsverschnitt', typ: 'janein', wert: z => z.jahrgangsverschnitt },
  { kopf: 'Jahrgang', typ: 'code', wert: z => z.jahrgang },
  { kopf: 'Lesegradation', typ: 'text', wert: z => z.lesegradation },
  { kopf: 'Angereichert', typ: 'janein', wert: z => z.angereichert },
  { kopf: 'Gesüßt', typ: 'janein', wert: z => z.gesuesst },
  { kopf: 'Einreichmenge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.einreichmengeL },
  { kopf: 'Qualitätsweinrebsorte(n)', typ: 'text', wert: z => z.rebsorte },
  { kopf: 'Abgefüllt', typ: 'text', wert: z => z.abgefuellt },
  { kopf: 'Teilmenge mit vorhandenen Prüfnummern (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.teilmengePnL },
  { kopf: 'Bezeichnung Rebsorte(n)', typ: 'text', wert: z => z.bezRebsorte },
  { kopf: 'Qualitätsstufe', typ: 'text', wert: z => z.qualitaetsstufe },
  { kopf: 'Weinbaugebiet', typ: 'text', wert: z => z.weinbaugebiet },
  { kopf: 'Bezeichnung Jahrgang', typ: 'code', wert: z => z.bezJahrgang },
  { kopf: 'Reserve', typ: 'janein', wert: z => z.reserve },
  { kopf: 'Große Reserve', typ: 'janein', wert: z => z.grosseReserve },
  { kopf: 'Premium', typ: 'janein', wert: z => z.premium },
  { kopf: 'Barrique', typ: 'janein', wert: z => z.barrique },
  { kopf: 'Schilcher', typ: 'janein', wert: z => z.schilcher },
  { kopf: 'Schilcher Klassik', typ: 'janein', wert: z => z.schilcherKlassik },
  { kopf: 'Bio-Wein', typ: 'janein', wert: z => z.bioWein },
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Gemeinde', typ: 'text', wert: z => z.gemeinde },
  { kopf: 'Sonstiges', typ: 'text', wert: z => z.sonstiges },
  { kopf: 'Bei Nichterreichen nächstniedrigere Qualitätsstufe', typ: 'janein', wert: z => z.naechsteQualitaet },
  { kopf: 'Versiegelungsverzicht 4. Probe', typ: 'janein', wert: z => z.versiegelungsverzicht },
  { kopf: 'Mostcharge', typ: 'ganzzahl', wert: z => z.mostchargeNr },
  { kopf: 'Mostcharge Betriebsnummer', typ: 'code', wert: z => z.mcBetriebsnummer },
  { kopf: 'Mostcharge Laufende Nummer', typ: 'code', wert: z => z.mcLaufendeNr },
  { kopf: 'Mostcharge Jahr', typ: 'code', wert: z => z.mcJahr },
  { kopf: 'Mostcharge Teilmenge (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.mcTeilmengeL },
]

/** Checkbox-Feld → boolean | null (nur echte Booleans; sonst leer) */
function kreuz(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}

function liter(v: unknown, bezeichnung: string, warnungen: string[]): number | null {
  const n = zahlFeld(v, bezeichnung, warnungen)
  return n === null ? null : runden(n, STELLEN.liter)
}

export type PNAMeta = { dacBezeichnung: string | null; gespeichert: boolean; gespeichertAm: string | null }

/** Antragsdaten in CSV-Zeilen: eine je ausgefüllter Mostcharge, ohne Mostcharge genau eine Zeile */
export function pnaZeilen(formular: R, meta: PNAMeta, warnungen: string[]): PNAZeile[] {
  const d = formular ?? {}
  const kopf: Omit<PNAZeile, 'mostchargeNr' | 'mcBetriebsnummer' | 'mcLaufendeNr' | 'mcJahr' | 'mcTeilmengeL'> = {
    dacBezeichnung: meta.dacBezeichnung,
    formularstand: meta.gespeichert ? FORMULAR_GESPEICHERT : FORMULAR_VORBELEGUNG,
    gespeichertAm: meta.gespeichertAm,
    antragsnummer: feld(d.antragsnummer),
    untersuchungsnummer: feld(d.untersuchungsnummer),
    eingangsdatum: datumAusEingabe(d.eingangsdatum, 'Eingangsdatum', warnungen),
    betriebsnummer: feld(d.betriebsnummer),
    name: feld(d.name),
    vorname: feld(d.vorname),
    plz: feld(d.plz),
    ort: feld(d.ort),
    strasse: feld(d.strasse),
    hausnr: feld(d.hausnr),
    telefon: feld(d.telefon),
    telefax: feld(d.telefax),
    email: feld(d.email),
    bevoName: feld(d.bevo_name),
    bevoVorname: feld(d.bevo_vorname),
    aufbewPlz: feld(d.aufbew_plz),
    aufbewOrt: feld(d.aufbew_ort),
    aufbewStrasse: feld(d.aufbew_strasse),
    farbe: textOderNull(d.farbe),
    jahrgangsverschnitt: kreuz(d.jahrgangsverschnitt),
    jahrgang: textOderNull(d.jahrgang),
    lesegradation: textOderNull(d.lesegradation),
    angereichert: kreuz(d.angereichert),
    gesuesst: kreuz(d.gesuesst),
    einreichmengeL: liter(d.einreichmenge, 'Einreichmenge', warnungen),
    rebsorte: textOderNull(d.rebsorte),
    abgefuellt: textOderNull(d.abgefuellt),
    teilmengePnL: liter(d.teilmenge_pn, 'Teilmenge mit vorhandenen Prüfnummern', warnungen),
    bezRebsorte: textOderNull(d.bez_rebsorte),
    qualitaetsstufe: textOderNull(d.qualitaetsstufe),
    weinbaugebiet: textOderNull(d.weinbaugebiet),
    bezJahrgang: textOderNull(d.bez_jahrgang),
    reserve: kreuz(d.reserve),
    grosseReserve: kreuz(d.grosse_reserve),
    premium: kreuz(d.premium),
    barrique: kreuz(d.barrique),
    schilcher: kreuz(d.schilcher),
    schilcherKlassik: kreuz(d.schilcher_klassik),
    bioWein: kreuz(d.bio_wein),
    ried: textOderNull(d.ried),
    gemeinde: textOderNull(d.gemeinde),
    sonstiges: textOderNull(d.sonstiges),
    naechsteQualitaet: kreuz(d.naechste_qualitaet),
    versiegelungsverzicht: kreuz(d.versiegelungsverzicht),
  }

  const mostchargen = (Array.isArray(d.mostchargen) ? d.mostchargen : []) as R[]
  const zeilen: PNAZeile[] = []
  mostchargen.forEach((mc, i) => {
    if (!mc || typeof mc !== 'object') return
    if (['betriebsnummer', 'laufende_nr', 'jahr', 'teilmenge'].every(k => feld(mc[k]) === '')) return
    zeilen.push({
      ...kopf,
      mostchargeNr: i + 1,
      mcBetriebsnummer: textOderNull(mc.betriebsnummer),
      mcLaufendeNr: textOderNull(mc.laufende_nr),
      mcJahr: textOderNull(mc.jahr),
      mcTeilmengeL: liter(mc.teilmenge, `Mostcharge ${i + 1}: Teilmenge`, warnungen),
    })
  })
  if (zeilen.length === 0) {
    zeilen.push({ ...kopf, mostchargeNr: null, mcBetriebsnummer: null, mcLaufendeNr: null, mcJahr: null, mcTeilmengeL: null })
  }
  return zeilen
}

// ── Laden ────────────────────────────────────────────────────────────────────

type Client = any

export type PNAErgebnis = {
  /** KAN-97: status/eingereichtAm/storniert – ab „Eingereicht“ ist das Formular gesperrt */
  dac: { id: string; bezeichnung: string | null; status: string | null; eingereichtAm: string | null; storniert: boolean }
  formular: PNADaten
  gespeichert: boolean
  gespeichertAm: string | null
  /** KAN-150 F2: id des gespeicherten (nicht stornierten) Antrags – für Stornieren */
  gespeichertId: string | null
  zeilen: PNAZeile[]
  warnungen: string[]
}

const HINWEIS_VORBELEGUNG = 'Prüfnummernantrag ist noch nicht gespeichert – ausgegeben ist die nicht gespeicherte Vorbelegung wie in der Druckansicht (u. a. Farbe „Weiß“, Qualitätsstufe und Weinbaugebiet aus der DAC-Region). Bitte Formular prüfen und speichern.'

/**
 * Prüfnummernantrag zu einem DAC-Antrag – für Druckseite und CSV.
 * null = DAC-Antrag nicht gefunden (oder keine gültige id).
 */
export async function ladePruefnummernantrag(supabase: Client, tenantId: string, p: { id: string }): Promise<PNAErgebnis | null> {
  if (!UUID_RE.test(p.id)) return null
  const [dacRes, cfgRes, pnaRes] = await Promise.all([
    // storno-sichtbar: der Druck zeigt auch einen stornierten DAC-Antrag, mit Vermerk (KAN-150 F2)
    (supabase.from('dac_antrag') as any)
      .select('id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, weinausbau_id, status, eingereicht_am, storniert_am')
      .eq('id', p.id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    // RLS-gescopter Client statt Admin-Client: keine Betriebsdaten eines fremden Mandanten auf dem amtlichen Antrag
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_email, betrieb_betriebsnummer')
      .eq('tenant_id', tenantId)
      .limit(1).maybeSingle(),
    (supabase.from('pruefnummernantraege') as any)
      .select('id, formular_daten, erstellt_am, aktualisiert_am')
      .eq('dac_antrag_id', p.id)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null)   // KAN-150 F2: ein stornierter Antrag gilt nicht mehr – danach wieder die Vorbelegung
      .maybeSingle(),
  ])
  if (dacRes.error) throw new Error(`Laden fehlgeschlagen (dac_antrag): ${dacRes.error.message}`)
  if (cfgRes.error) throw new Error(`Laden fehlgeschlagen (tenant_einstellungen): ${cfgRes.error.message}`)
  if (pnaRes.error) throw new Error(`Laden fehlgeschlagen (pruefnummernantraege): ${pnaRes.error.message}`)
  const dac = dacRes.data as R | null
  if (!dac) return null

  const warnungen: string[] = []
  const pna = pnaRes.data as R | null
  const gespeicherteDaten = pna?.formular_daten && typeof pna.formular_daten === 'object' ? (pna.formular_daten as PNADaten) : null
  const gespeichertAm = pna ? (pna.aktualisiert_am ?? pna.erstellt_am ?? null) : null
  // KAN-186: Zusatzbezeichnung der Charge für die Vorbelegung (Reserve/Große Reserve) – nur ohne gespeichertes Formular
  let charge: R | null = null
  if (!gespeicherteDaten && dac.weinausbau_id && UUID_RE.test(String(dac.weinausbau_id))) {
    const chRes = await (supabase.from('weinausbau') as any)
      .select('qualitaetsstufe, zusatzbezeichnung, erzeugnis, weinart, kmw, herkunft_code')
      .eq('id', dac.weinausbau_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (chRes.error) throw new Error(`Laden fehlgeschlagen (weinausbau): ${chRes.error.message}`)
    charge = (chRes.data ?? null) as R | null
  }
  const formular: PNADaten = gespeicherteDaten
    ? { ...gespeicherteDaten, mostchargen: Array.isArray(gespeicherteDaten.mostchargen) ? gespeicherteDaten.mostchargen : [] }
    : pnaVorbelegung(dac, (cfgRes.data ?? {}) as R, charge)
  if (!gespeicherteDaten) warnungen.push(HINWEIS_VORBELEGUNG)

  const zeilen = pnaZeilen(formular, { dacBezeichnung: textOderNull(dac.bezeichnung), gespeichert: !!gespeicherteDaten, gespeichertAm }, warnungen)
  return { dac: { id: dac.id, bezeichnung: textOderNull(dac.bezeichnung), status: textOderNull(dac.status), eingereichtAm: textOderNull(dac.eingereicht_am), storniert: !!dac.storniert_am }, formular, gespeichert: !!gespeicherteDaten, gespeichertAm, gespeichertId: pna?.id ? String(pna.id) : null, zeilen, warnungen }
}
