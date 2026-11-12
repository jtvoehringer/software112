// ── Grunddaten des Exportauftrags (KAN-432, 12.11.2026 – Epic KAN-431 „Weinexport auslieferfähig“) ───────────────────────
//
// Was die Exportdokumente brauchen, kommt aus den vorhandenen Daten (Füllung, Prüfnummernantrag, Analyse, Kunde,
// Betrieb) und wird hier BERECHNET, nicht gespeichert. Entscheidungen Jörgen 12.11.2026 (alle A):
//   1A UID des Kunden am Auftrag (aus der Firma vorbelegt) – mit UID gilt die Lieferung als B2B
//   2A Flaschen je Karton: Standard je Betrieb, je Position änderbar; bei „Kiste“ zugleich Flaschen je Kiste
//   3A Alkohol aus dem Prüfnummernantrag, sonst der jüngsten Analyse der Charge – kein Überschreiben am Auftrag
//   4A KN-Code achtstellig erwartet; kürzere Codes bleiben speicherbar, erscheinen aber als Hinweis
// Fehlende Werte werden nie geschätzt: Der Auftrag zeigt eine Hinweisliste „Für die Dokumente fehlt noch …“.
// Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { istEuLand, istLand } from '../katalog/laender.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'

export const KARTON_MIN = 1
export const KARTON_MAX = 60
export const KARTON_STANDARD = 6
export const ZAHLUNGSBEDINGUNGEN_MAX = 300
export const KUNDE_UID_MAX = 20
export const BETRIEB_EORI_MAX = 30

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim())
const zahl = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v))
  return Number.isFinite(n) ? n : null
}

// ── Lieferfall ───────────────────────────────────────────────────────────────────

export type Liefergebiet = 'inland' | 'eu' | 'drittland'
export type Lieferfall = {
  /** null = Bestimmungsland fehlt bzw. unbekannt */
  gebiet: Liefergebiet | null
  /** mit UID = Unternehmer (B2B), ohne = Privat (B2C) */
  kunde: 'b2b' | 'b2c'
  /** Kurztext für das Kennzeichen am Auftrag, z. B. „EU · B2B“ */
  label: string
}

const GEBIET_LABEL: Record<Liefergebiet, string> = { inland: 'Inland', eu: 'EU', drittland: 'Drittland' }

/** Lieferfall aus Bestimmungsland (ISO-Code) und UID des Kunden */
export function lieferfall(a: { destination_land?: unknown; kunde_uid?: unknown }): Lieferfall {
  const land = text(a.destination_land).toUpperCase()
  const gebiet: Liefergebiet | null = !land || !istLand(land) ? null : land === 'AT' ? 'inland' : istEuLand(land) ? 'eu' : 'drittland'
  const kunde = uidBereinigt(a.kunde_uid) ? 'b2b' : 'b2c'
  return { gebiet, kunde, label: `${gebiet ? GEBIET_LABEL[gebiet] : 'Land fehlt'} · ${kunde === 'b2b' ? 'B2B' : 'B2C'}` }
}

/** UID ohne Leerzeichen, in Großbuchstaben ('' = keine) */
export function uidBereinigt(v: unknown): string {
  return text(v).replace(/\s+/g, '').toUpperCase()
}

/** Prüfung der UID des Kunden; null = in Ordnung (leer ist erlaubt) */
export function kundeUidFehler(v: unknown): string | null {
  const uid = uidBereinigt(v)
  if (!uid) return null
  if (uid.length > KUNDE_UID_MAX) return `Die UID des Kunden darf höchstens ${KUNDE_UID_MAX} Zeichen haben.`
  if (!/^[A-Z]{2}[A-Z0-9+*.]{2,}$/.test(uid)) return 'Die UID des Kunden beginnt mit dem Länderkürzel, z. B. DE123456789.'
  return null
}

/** Vorschlag für die Zahlungsbedingungen aus dem Zahlungsziel in Tagen ('' ohne Ziel) */
export function zahlungsbedingungenVorschlag(tage: unknown): string {
  const n = zahl(tage)
  if (n === null || n < 0 || !Number.isInteger(n)) return ''
  return n === 0 ? 'Zahlbar sofort ohne Abzug' : `Zahlbar innerhalb von ${n} Tagen netto`
}

// ── Packstücke ───────────────────────────────────────────────────────────────────

/** Flaschen je Karton als ganze Zahl 1–60; null = keine bzw. ungültige Angabe */
export function flaschenJeKarton(v: unknown): number | null {
  const n = zahl(v)
  return n !== null && Number.isInteger(n) && n >= KARTON_MIN && n <= KARTON_MAX ? n : null
}

/** Prüfung der Eingabe „Flaschen je Karton“ einer Position; null = in Ordnung (leer ist erlaubt) */
export function kartonFehler(v: unknown): string | null {
  if (v === null || v === undefined || text(v) === '') return null
  return flaschenJeKarton(v) === null ? `Flaschen je Karton bitte als ganze Zahl von ${KARTON_MIN} bis ${KARTON_MAX} angeben.` : null
}

/** Flaschen einer Position: „Fl“ = Menge, „Kiste“ = Menge × Flaschen je Kiste, „HL“ (lose Ware) = keine */
export function flaschenDerPosition(p: { menge?: unknown; einheit?: unknown; flaschen_je_karton?: unknown }): number | null {
  const menge = zahl(p.menge)
  if (menge === null || !(menge > 0)) return null
  const einheit = text(p.einheit) || 'Fl'
  if (einheit === 'Fl') return menge
  if (einheit === 'Kiste') { const n = flaschenJeKarton(p.flaschen_je_karton); return n === null ? null : menge * n }
  return null
}

export type Packstuecke = { kartons: number; /** Flaschen im letzten, nicht vollen Karton (0 = alle voll) */ anbruch: number }

/** Kartons einer Position (aufgerundet); null, wenn Flaschen bzw. Flaschen je Karton fehlen */
export function packstuecke(p: { menge?: unknown; einheit?: unknown; flaschen_je_karton?: unknown }): Packstuecke | null {
  const n = flaschenJeKarton(p.flaschen_je_karton)
  const flaschen = flaschenDerPosition(p)
  if (n === null || flaschen === null) return null
  return { kartons: Math.ceil(flaschen / n), anbruch: flaschen % n === 0 ? 0 : rund(flaschen % n, 2) }
}

// ── Aus der Füllung ─────────────────────────────────────────────────────────────────

export type AlkoholQuelle = 'pruefnummernantrag' | 'analyse'

/** Alkohol % vol: Wert des Prüfnummernantrags, sonst der jüngsten Analyse (Entscheidung 3A); null = unbekannt */
export function alkoholAus(antragAlkohol: unknown, analyseAlkohol: unknown): { wert: number; quelle: AlkoholQuelle } | null {
  const a = zahl(antragAlkohol)
  if (a !== null && a > 0) return { wert: rund(a, 1), quelle: 'pruefnummernantrag' }
  const b = zahl(analyseAlkohol)
  if (b !== null && b > 0) return { wert: rund(b, 1), quelle: 'analyse' }
  return null
}

/** Jüngste Analyse mit Alkoholwert: nach Analysedatum, dann Erfassungszeitpunkt, dann id (alles absteigend) */
export function juengsteAnalyse<T extends { analyse_datum?: unknown; created_at?: unknown; id?: unknown; alkohol_vol?: unknown }>(analysen: readonly T[]): T | null {
  const mitWert = analysen.filter(x => { const n = zahl(x.alkohol_vol); return n !== null && n > 0 })
  if (mitWert.length === 0) return null
  const schluessel = (x: T) => `${text(x.analyse_datum)}|${text(x.created_at)}|${text(x.id)}`
  return [...mitWert].sort((x, y) => (schluessel(x) < schluessel(y) ? 1 : schluessel(x) > schluessel(y) ? -1 : 0))[0]
}

export type WeinFarbe = 'weiss' | 'rot' | 'rose'
const FARBE_LABEL: Record<WeinFarbe, string> = { weiss: 'Weiß', rot: 'Rot', rose: 'Rosé' }

export function farbeAus(weinart: unknown): WeinFarbe | null {
  const w = text(weinart).toLowerCase()
  return w === 'weiss' || w === 'rot' || w === 'rose' ? w : null
}
export function farbeLabel(f: WeinFarbe | null): string { return f ? FARBE_LABEL[f] : '' }

/** KN-Code nur aus Ziffern (Punkte und Leerzeichen entfernt) */
export function knZiffern(code: unknown): string {
  return text(code).replace(/[\s.]/g, '')
}

/** Achtstelliger KN-Code? (Entscheidung 4A: prüfen und Lücke anzeigen, kein Vorschlag) */
export function knAchtstellig(code: unknown): boolean {
  return /^\d{8}$/.test(knZiffern(code))
}

// ── Position mit allen abgeleiteten Angaben ───────────────────────────────────────────────────────

export type GrunddatenFuellung = {
  id?: unknown; name?: unknown; jahrgang?: unknown; rebsorte?: unknown; weinart?: unknown; flaschengroesse_ml?: unknown
  pruefnummer?: unknown; weinausbau_id?: unknown
}
export type GrunddatenEingabe = {
  menge?: unknown; einheit?: unknown; flaschen_je_karton?: unknown; taric_code?: unknown; beschreibung?: unknown
  fuellung?: GrunddatenFuellung | null
  /** Alkohol und Prüfnummer des Prüfnummernantrags der Füllung (falls vorhanden) */
  antrag?: { alkohol_prozent?: unknown; pruefnummer?: unknown } | null
  /** Alkohol der jüngsten Analyse der Charge (falls vorhanden) */
  analyseAlkohol?: unknown
}
export type GrunddatenPosition = {
  flaschen: number | null
  liter: number | null
  kartons: number | null
  anbruch: number
  flaschenJeKarton: number | null
  alkohol: number | null
  alkoholQuelle: AlkoholQuelle | null
  pruefnummer: string | null
  farbe: WeinFarbe | null
  rebsorte: string | null
  jahrgang: string | null
  knAchtstellig: boolean
}

export function grunddatenPosition(p: GrunddatenEingabe): GrunddatenPosition {
  const f = p.fuellung ?? null
  const menge = zahl(p.menge)
  const einheit = text(p.einheit) || 'Fl'
  const flaschen = flaschenDerPosition(p)
  const ml = zahl(f?.flaschengroesse_ml)
  const liter = einheit === 'HL' ? (menge !== null && menge > 0 ? rund(menge * 100, 3) : null)
    : flaschen !== null && ml !== null && ml > 0 ? rund((flaschen * ml) / 1000, 3) : null
  const pack = packstuecke(p)
  const alk = f ? alkoholAus(p.antrag?.alkohol_prozent, p.analyseAlkohol) : null
  return {
    flaschen, liter,
    kartons: pack?.kartons ?? null, anbruch: pack?.anbruch ?? 0, flaschenJeKarton: flaschenJeKarton(p.flaschen_je_karton),
    alkohol: alk?.wert ?? null, alkoholQuelle: alk?.quelle ?? null,
    pruefnummer: text(f?.pruefnummer) || text(p.antrag?.pruefnummer) || null,
    farbe: farbeAus(f?.weinart),
    rebsorte: text(f?.rebsorte) || null,
    jahrgang: text(f?.jahrgang) || null,
    knAchtstellig: knAchtstellig(p.taric_code),
  }
}

export type GrunddatenSummen = {
  flaschen: number; kartons: number | null
  /** Liter gesamt; null, sobald einer Position die Liter fehlen */
  liter: number | null
  literWeiss: number; literRot: number
  /** Liter ohne bekannte Farbe (zählt in keiner der beiden Spalten) */
  literOhneFarbe: number
}

/** Summen wie in Handelsrechnung und Packliste: Liter weiß (inkl. Süßwein) und rot (Rosé zählt zu rot, wie in der BSM-Meldung) */
export function grunddatenSummen(positionen: readonly GrunddatenPosition[]): GrunddatenSummen {
  let flaschen = 0, liter = 0, weiss = 0, rot = 0, ohne = 0, kartons = 0
  let literFehlt = positionen.length === 0, kartonsFehlen = positionen.length === 0
  for (const p of positionen) {
    flaschen += p.flaschen ?? 0
    if (p.liter === null) literFehlt = true
    else {
      liter += p.liter
      if (p.farbe === 'weiss') weiss += p.liter
      else if (p.farbe === 'rot' || p.farbe === 'rose') rot += p.liter
      else ohne += p.liter
    }
    if (p.flaschen !== null) { if (p.kartons === null) kartonsFehlen = true; else kartons += p.kartons }
  }
  return {
    flaschen: rund(flaschen, 2), kartons: kartonsFehlen ? null : kartons,
    liter: literFehlt ? null : rund(liter, 3), literWeiss: rund(weiss, 3), literRot: rund(rot, 3), literOhneFarbe: rund(ohne, 3),
  }
}

// ── Hinweisliste „Für die Dokumente fehlt noch …“ ──────────────────────────────────────────────────────

export type GrunddatenHinweis = { text: string; /** Stelle, an der der Wert gepflegt wird */ href: string | null }

export function grunddatenHinweise(e: {
  auftragId: string
  auftrag: { destination_land?: unknown; kunde_uid?: unknown; versanddatum?: unknown; zahlungsbedingungen?: unknown }
  betrieb: { betrieb_eori?: unknown; betrieb_uid?: unknown }
  positionen: readonly { eingabe: GrunddatenEingabe; daten: GrunddatenPosition }[]
  /** Auftrag noch bearbeitbar (Entwurf/Bestätigt)? Sonst führen die Hinweise des Auftrags nirgends hin */
  bearbeitbar: boolean
}): GrunddatenHinweis[] {
  const aus: GrunddatenHinweis[] = []
  const bearbeiten = e.bearbeitbar ? `/weinexport/${e.auftragId}/bearbeiten` : null
  const fall = lieferfall(e.auftrag)
  if (fall.gebiet === null) aus.push({ text: 'Bestimmungsland fehlt – EU oder Drittland ist nicht bestimmbar.', href: bearbeiten })
  if (fall.gebiet === 'inland') aus.push({ text: 'Bestimmungsland ist Österreich – das ist keine Ausfuhr.', href: bearbeiten })
  if (!text(e.auftrag.versanddatum)) aus.push({ text: 'Versanddatum fehlt.', href: bearbeiten })
  if (!text(e.auftrag.zahlungsbedingungen)) aus.push({ text: 'Zahlungsbedingungen fehlen.', href: bearbeiten })
  if (fall.gebiet === 'eu' && fall.kunde === 'b2c') {
    aus.push({ text: 'UID des Kunden fehlt – ohne UID gilt die EU-Lieferung als Verkauf an Private (keine steuerfreie innergemeinschaftliche Lieferung).', href: bearbeiten })
  }
  if (!text(e.betrieb.betrieb_uid)) aus.push({ text: 'UID des Betriebs fehlt.', href: '/betrieb/einstellungen' })
  if (fall.gebiet === 'drittland' && !text(e.betrieb.betrieb_eori)) {
    aus.push({ text: 'EORI-Nummer des Betriebs fehlt (Ausfuhr in ein Drittland).', href: '/betrieb/einstellungen' })
  }
  const gesehen = new Set<string>()
  const einmal = (schluessel: string, h: GrunddatenHinweis) => { if (!gesehen.has(schluessel)) { gesehen.add(schluessel); aus.push(h) } }
  e.positionen.forEach(({ eingabe, daten }, i) => {
    const f = eingabe.fuellung ?? null
    const nr = `Position ${i + 1}`
    const einheit = text(eingabe.einheit) || 'Fl'
    if (!f) {
      if (einheit !== 'HL') aus.push({ text: `${nr} hat keine Füllung – Liter, Alkohol, Prüfnummer und Farbe fehlen.`, href: bearbeiten })
    } else {
      const id = text(f.id)
      const name = [text(f.name), text(f.jahrgang)].filter(Boolean).join(' ') || 'Füllung'
      const fuellungHref = id ? `/weinhandel/fuellungen/${id}/edit` : null
      if (daten.alkohol === null) {
        einmal(`alk:${id}`, { text: `„${name}“: Alkohol fehlt (weder Prüfnummernantrag noch Analyse mit Alkoholwert).`,
          href: text(f.weinausbau_id) ? `/kellerbuch/weinausbau/${text(f.weinausbau_id)}` : fuellungHref })
      }
      if (!daten.pruefnummer) einmal(`pn:${id}`, { text: `„${name}“: Prüfnummer fehlt.`, href: fuellungHref })
      if (!daten.farbe) einmal(`farbe:${id}`, { text: `„${name}“: Weinart (weiß, rot, rosé) fehlt.`, href: fuellungHref })
      if (einheit !== 'HL' && zahl(f.flaschengroesse_ml) === null) einmal(`ml:${id}`, { text: `„${name}“: Flaschengröße fehlt.`, href: fuellungHref })
    }
    if (einheit !== 'HL' && daten.flaschenJeKarton === null) aus.push({ text: `${nr}: Flaschen je Karton fehlen – Packstücke${einheit === 'Kiste' ? ', Liter und Gewicht' : ''} nicht bestimmbar.`, href: bearbeiten })
    if (!daten.knAchtstellig) {
      aus.push({ text: `${nr}: Zolltarifnummer „${text(eingabe.taric_code) || '–'}“ ist nicht achtstellig (KN-Code).`,
        href: f && text(f.id) ? `/weinhandel/fuellungen/${text(f.id)}/edit` : bearbeiten })
    }
  })
  return aus
}
