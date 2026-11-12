// ── Rechnung und Bestandsabgang aus dem Exportauftrag (KAN-436 E1, 12.11.2026 – Epic KAN-431) ───────────────────────────
//
// Bisher minderte ein Exportauftrag weder den Flaschenbestand noch entstand eine Rechnung in der Fakturierung.
// Entscheidungen Jörgen 12.11.2026 (alle A): eigener Knopf „Rechnung stellen“ ab „Bestätigt“ (1A); Nummer aus dem
// normalen Rechnungskreis (2A); nur steuerfreie Fälle – EU ohne UID und Inland als normaler Verkauf (3A); Mustersendung
// ohne Rechnung, Bestand als Entnahme (4A); nur Flaschenware, keine lose Ware (5A); Fracht und Versicherung als eigene
// Positionen (6A); Storno des Auftrags erst nach dem Storno der Rechnung (7A).
// Hier stehen die Regeln und die Umrechnung der Exportpositionen (Kiste, Nettopreis) in Verkaufspositionen (Flaschen,
// Preis je Flasche). Der Verkauf selbst läuft über createVerkauf. Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – wie oben
import { flaschenJeKarton, lieferfall, uidBereinigt } from './grunddaten.ts'
// @ts-expect-error TS5097 – wie oben
import { BEFREIUNG_AUSFUHR, BEFREIUNG_IGL, befreiung, nebenkostenWert, type BefreiungArt } from './rechnungTexte.ts'

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : v === null || v === undefined ? '' : String(v).trim())
const zahl = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v))
  return Number.isFinite(n) ? n : null
}

export type FakturaAuftrag = {
  id?: unknown; referenz?: unknown; status?: unknown; storniert_am?: unknown; mustersendung?: unknown
  verkaufsposten_id?: unknown; muster_ausgebucht_am?: unknown
  kontakt_id?: unknown; firma_id?: unknown; destination_land?: unknown; kunde_uid?: unknown
  fracht_eur?: unknown; versicherung_eur?: unknown
}

export type FakturaExportPosition = {
  fullung_id?: unknown; beschreibung?: unknown; menge?: unknown; einheit?: unknown; preis_eur?: unknown; flaschen_je_karton?: unknown
  /** Name der Füllung (für Meldungen und als Bezeichnung, wenn die Position keine eigene hat) */
  fuellungName?: unknown
}

/** Position, wie createVerkauf sie erwartet (Teilmenge von PositionInput) */
export type FakturaVerkaufPosition = {
  typ: 'flasche' | 'sonstiges'
  fuellung_id?: string
  name: string
  menge: number
  einheit: 'Stk'
  preis_brutto: number
  rabatt_pct: 0
  sonderrabatt_pct: 0
  ust_satz: 0
}

export type Faktura = {
  /** Gründe, warum (noch) keine Rechnung entstehen kann; leer = möglich */
  fehler: string[]
  steuerfall: Exclude<BefreiungArt, 'keine'> | null
  kundeUid: string | null
  lieferland: string | null
  kontaktId: string | null
  firmaId: string | null
  positionen: FakturaVerkaufPosition[]
  /** Summe der Verkaufspositionen (= Rechnungsbetrag der Handelsrechnung) */
  betrag: number
}

/** Flaschen einer Exportposition (Fl direkt, Kiste × Flaschen je Karton); null bei loser Ware bzw. unklarer Kartongröße */
export function fakturaFlaschen(p: FakturaExportPosition, standardKarton: number | null): number | null {
  const menge = zahl(p.menge)
  const einheit = text(p.einheit) || 'Fl'
  if (menge === null) return null
  if (einheit === 'Fl') return menge
  if (einheit !== 'Kiste') return null
  const je = flaschenJeKarton(p.flaschen_je_karton) ?? standardKarton
  return je === null ? null : menge * je
}

/**
 * Prüft, ob aus dem Exportauftrag eine Rechnung entstehen kann, und rechnet die Positionen um. Der Zeilenwert bleibt
 * erhalten: Preis je Flasche = Preis je Einheit ÷ Flaschen je Einheit (höchstens vier Nachkommastellen, wie die
 * Datenbank) – geht das nicht auf den Cent auf, gibt es keinen Vorschlag, sondern eine Meldung.
 */
export function exportFaktura(auftrag: FakturaAuftrag, positionen: readonly FakturaExportPosition[], standardKarton: number | null): Faktura {
  const fehler: string[] = []
  const fall = lieferfall(auftrag)
  const steuer = befreiung(fall)
  if (auftrag.storniert_am) fehler.push('Der Exportauftrag ist storniert.')
  if (text(auftrag.verkaufsposten_id)) fehler.push('Zu diesem Exportauftrag gibt es schon eine Rechnung.')
  if (auftrag.mustersendung === true) fehler.push('Mustersendung – keine Rechnung; der Bestand geht über „Muster ausbuchen“ ab.')
  if ((text(auftrag.status) || 'entwurf') === 'entwurf') fehler.push('Die Rechnung gibt es erst ab dem Status „Bestätigt“.')
  if (!text(auftrag.kontakt_id) && !text(auftrag.firma_id)) fehler.push('Der Importeur fehlt.')
  if (steuer.art === 'keine') {
    fehler.push(fall.gebiet === null
      ? 'Das Bestimmungsland fehlt.'
      : `Nicht steuerfrei (${fall.gebiet === 'inland' ? 'Lieferung im Inland' : 'EU-Lieferung ohne UID des Kunden'}) – bitte als normalen Verkauf erfassen.`)
  }
  if (positionen.length === 0) fehler.push('Der Exportauftrag hat keine Positionen.')

  const aus: FakturaVerkaufPosition[] = []
  positionen.forEach((p, i) => {
    const nr = `Position ${i + 1}`
    const einheit = text(p.einheit) || 'Fl'
    const name = text(p.beschreibung) || text(p.fuellungName) || 'Wein'
    if (einheit === 'HL') { fehler.push(`${nr} ist lose Ware (HL) – die Rechnung aus dem Export gibt es nur für Flaschenware.`); return }
    if (!text(p.fullung_id)) { fehler.push(`${nr} hat keine Füllung – ohne Füllung lässt sich kein Bestand abbuchen.`); return }
    const flaschen = fakturaFlaschen(p, standardKarton)
    const menge = zahl(p.menge)
    if (flaschen === null || menge === null || !(flaschen > 0) || !Number.isInteger(flaschen)) {
      fehler.push(`${nr}: Die Menge ergibt keine ganze Zahl Flaschen.`); return
    }
    const preis = zahl(p.preis_eur) ?? 0
    const jeFlasche = rund((preis * menge) / flaschen, 4)
    if (rund(jeFlasche * flaschen, 2) !== rund(preis * menge, 2)) {
      fehler.push(`${nr}: Der Preis je Kiste lässt sich nicht genau auf Flaschen umrechnen – bitte die Position auf Flaschen umstellen.`); return
    }
    aus.push({ typ: 'flasche', fuellung_id: text(p.fullung_id), name, menge: flaschen, einheit: 'Stk', preis_brutto: jeFlasche, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 0 })
  })
  // Entscheidung 6A: Nebenkosten als eigene Positionen, damit der Rechnungsbetrag zur Handelsrechnung passt
  for (const [name, wert] of [['Fracht / Freight', nebenkostenWert(auftrag.fracht_eur)], ['Versicherung / Insurance', nebenkostenWert(auftrag.versicherung_eur)]] as const) {
    if (wert !== null && wert > 0) aus.push({ typ: 'sonstiges', name, menge: 1, einheit: 'Stk', preis_brutto: wert, rabatt_pct: 0, sonderrabatt_pct: 0, ust_satz: 0 })
  }
  const land = text(auftrag.destination_land).toUpperCase()
  return {
    fehler,
    steuerfall: steuer.art === 'keine' ? null : steuer.art,
    kundeUid: uidBereinigt(auftrag.kunde_uid) || null,
    lieferland: /^[A-Z]{2}$/.test(land) ? land : null,
    kontaktId: text(auftrag.kontakt_id) || null,
    firmaId: text(auftrag.firma_id) || null,
    positionen: fehler.length === 0 ? aus : [],
    betrag: rund(aus.reduce((s, p) => s + rund(p.preis_brutto * p.menge, 2), 0), 2),
  }
}

/** Flaschen je Füllung, die „Muster ausbuchen“ abbucht; fehler = warum es nicht geht (dieselben Regeln wie die RPC) */
export function musterBuchung(auftrag: FakturaAuftrag, positionen: readonly FakturaExportPosition[], standardKarton: number | null): { fehler: string[]; flaschen: number } {
  const fehler: string[] = []
  if (auftrag.storniert_am) fehler.push('Der Exportauftrag ist storniert.')
  if (auftrag.mustersendung !== true) fehler.push('Kein Muster – der Exportauftrag ist nicht als Mustersendung gekennzeichnet.')
  if (text(auftrag.verkaufsposten_id)) fehler.push('Zu diesem Exportauftrag gibt es eine Rechnung.')
  if (text(auftrag.muster_ausgebucht_am)) fehler.push('Das Muster ist schon ausgebucht.')
  if ((text(auftrag.status) || 'entwurf') === 'entwurf') fehler.push('Ausbuchen geht erst ab dem Status „Bestätigt“.')
  if (positionen.length === 0) fehler.push('Der Exportauftrag hat keine Positionen.')
  let summe = 0
  positionen.forEach((p, i) => {
    const flaschen = text(p.fullung_id) ? fakturaFlaschen(p, standardKarton) : null
    if (flaschen === null || !(flaschen > 0) || !Number.isInteger(flaschen)) {
      fehler.push(`Position ${i + 1}: Ausbuchen geht nur mit Füllung und einer ganzen Zahl Flaschen (keine lose Ware).`)
    } else summe += flaschen
  })
  return { fehler, flaschen: fehler.length === 0 ? summe : 0 }
}

/** Hinweis auf dem Rechnungs-PDF je gespeichertem Steuerfall des Verkaufs (null = gewöhnlicher Verkauf) */
export function steuerfallLabel(steuerfall: unknown): string | null {
  return steuerfall === 'igl' ? 'Innergemeinschaftliche Lieferung' : steuerfall === 'ausfuhr' ? 'Ausfuhrlieferung' : null
}

/**
 * Text auf der Rechnung (verkaufsposten.rechnungstext): Hinweis auf die Steuerbefreiung, UID des Kunden und der
 * Exportauftrag. So drucken ihn Rechnung, Sammelrechnung, Versand und Stornobeleg ohne eigene Logik.
 */
export function fakturaRechnungstext(f: Pick<Faktura, 'steuerfall' | 'kundeUid'>, referenz: unknown): string {
  const zeilen: string[] = []
  if (f.steuerfall === 'igl') zeilen.push(BEFREIUNG_IGL)
  if (f.steuerfall === 'ausfuhr') zeilen.push(BEFREIUNG_AUSFUHR)
  if (f.kundeUid) zeilen.push(`UID des Kunden / Customer VAT No.: ${f.kundeUid}`)
  if (text(referenz)) zeilen.push(`Exportauftrag / Export order: ${text(referenz)}`)
  return zeilen.join('\n')
}
