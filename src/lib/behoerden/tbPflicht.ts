// ── Transportbescheinigung: Pflichtangaben und Ausstellen (KAN-209, 05.10.2026; Matrix KAN-85) ───────────────────────
//
// Eine Transportbescheinigung ist bis zum Ausstellen ein Entwurf (beliebig speicherbar, Druck mit Vermerk „ENTWURF“).
// Ausstellen prüft die Pflichtangaben des Formblatts – laufende Nummer/Jahr, Lieferdatum, Kennzeichen der Zugmaschine,
// Versender und Empfänger je mit Name und Betriebsnummer, mindestens eine Weinposition mit Menge, Farbe, Sorte,
// Qualität, Jahrgang, Herkunft und Mostgewicht bzw. Alkohol – und vergibt ohne Eingabe die nächste laufende Nummer
// des Jahres. Danach ist die Bescheinigung fest (DB-Trigger a_freeze); Korrektur = Storno + neue Bescheinigung.
// Isomorph (node:test lädt die Datei über die Hooks).

import { zahlAus } from '@/lib/format'
import { herkunftPruefen } from '@/lib/wein/bki_kuerzel'

export const TB_FREEZE_GRUND = 'Transportbescheinigung ausgestellt'

type TBKopf = {
  laufende_nr?: string; jahr?: string; datum_tag?: string; datum_monat?: string; datum_jahr?: string
  zugmaschine?: string
  v_betriebsnummer?: string; v_name?: string
  e_betriebsnummer?: string; e_name?: string
  positionen?: TBPos[]
}
type TBPos = {
  menge_liter?: string; art?: string; traubensorte?: string; qualitaetsstufe?: string; jahrgang?: string; herkunft?: string
  alkohol_pct?: string; kmw?: string | number | null; oechsle?: string | number | null
}

const leer = (v: unknown) => v == null || String(v).trim() === ''

/** Gültiges Lieferdatum aus Tag/Monat/Jahr (TT, MM, JJJJ) */
export function tbDatumGueltig(tag?: string, monat?: string, jahr?: string): boolean {
  const t = Number(tag), m = Number(monat), j = Number(jahr)
  if (!Number.isInteger(t) || !Number.isInteger(m) || !Number.isInteger(j) || j < 2000 || j > 2100) return false
  const d = new Date(Date.UTC(j, m - 1, t))
  return d.getUTCFullYear() === j && d.getUTCMonth() === m - 1 && d.getUTCDate() === t
}

/** Fehlende Pflichtangaben (leer = ausstellbar); die laufende Nummer darf fehlen, wenn sie vergeben wird.
 *  versenderOhneBetriebsnummer: Versender ist ein Weinhändler (KAN-261) – seine Betriebsnummer ist dann optional. */
export function tbPflichtFehler(d: TBKopf, opt: { nummerWirdVergeben?: boolean; versenderOhneBetriebsnummer?: boolean } = {}): string[] {
  const f: string[] = []
  if (!opt.nummerWirdVergeben && leer(d.laufende_nr)) f.push('Laufende Nummer')
  if (!/^\d{4}$/.test(String(d.jahr ?? '').trim())) f.push('Jahr (vierstellig)')
  if (!tbDatumGueltig(d.datum_tag, d.datum_monat, d.datum_jahr)) f.push('Datum der Lieferung (TT, MM, JJJJ)')
  if (leer(d.zugmaschine)) f.push('Kennzeichen der Zugmaschine')
  if (leer(d.v_name)) f.push('Name des Versenders')
  if (!opt.versenderOhneBetriebsnummer && leer(d.v_betriebsnummer)) f.push('Betriebsnummer des Versenders')
  if (leer(d.e_name)) f.push('Name des Empfängers')
  if (leer(d.e_betriebsnummer)) f.push('Betriebsnummer des Empfängers')
  const pos = Array.isArray(d.positionen) ? d.positionen : []
  if (pos.length === 0) f.push('mindestens eine Weinposition')
  pos.forEach((p, i) => {
    const fehlt: string[] = []
    const menge = zahlAus(p.menge_liter)
    if (!(menge != null && menge > 0)) fehlt.push('Menge')
    if (leer(p.art)) fehlt.push('Farbe')
    if (leer(p.traubensorte)) fehlt.push('Sorte')
    if (leer(p.qualitaetsstufe)) fehlt.push('Qualität')
    if (leer(p.jahrgang)) fehlt.push('Jahrgang')
    if (leer(p.herkunft)) fehlt.push('Herkunft')
    // KAN-90 (R16): nur amtliche BKI-Herkunftskürzel (z. B. WLNO, NOE), kein Betriebsort oder interner Code
    else if (!herkunftPruefen(p.herkunft).kuerzel) fehlt.push(`Herkunft als amtliches Kürzel (statt „${String(p.herkunft).trim()}“)`)
    if (leer(p.alkohol_pct) && leer(p.kmw) && leer(p.oechsle)) fehlt.push('Alkohol bzw. Mostgewicht')
    if (fehlt.length > 0) f.push(`Position ${i + 1}: ${fehlt.join(', ')}`)
  })
  return f
}

/** Nächste laufende Nummer des Jahres aus den bereits ausgestellten Nummern (nur Ziffern zählen) */
export function naechsteTbNummer(vergeben: readonly (string | null | undefined)[]): string {
  const max = vergeben.reduce<number>((m, v) => {
    const n = Number(String(v ?? '').trim())
    return Number.isInteger(n) && n > m ? n : m
  }, 0)
  return String(max + 1)
}

/** Ist die Nummer im Jahr schon vergeben? */
export function tbNummerVergeben(nummer: string, vergeben: readonly (string | null | undefined)[]): boolean {
  const n = nummer.trim()
  return vergeben.some(v => String(v ?? '').trim() === n)
}
