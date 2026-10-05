// ── Charge: Pflichtmerkmale, Abstufen-Pflicht und Sperre bei Prüfnummer (KAN-204, 05.10.2026; Matrix KAN-85) ─────────
//
// Pflicht beim Bearbeiten einer Charge: Jahrgang, Rebsorte, Weinart (nicht „unbekannt“), Qualitätsstufe und – solange
// Wein in der Charge ist – das Gebinde. Geprüft wird nur, was im Formular änderbar ist (Merkmale aus Pressung/Zukauf
// bzw. unter Prüfnummer sind gesperrt und bleiben, wie sie sind).
// Eröffnungsbestand (Entscheidung Jörgen 05.10.2026): Jahrgang, Rebsorte, Weinart und Herkunft dürfen fehlen (alter
// Mischbestand) – dann nur ein Hinweis, die Angaben in die Notizen zu schreiben; Gebinde und Qualitätsstufe sind Pflicht.
// Qualität, Zusatzbezeichnung und Erzeugnis ändern sich nur über „Abstufen“ (datiert, mit Grund, KAN-82) – ausgenommen
// die erstmalige Angabe bei einer Charge ohne Qualitätsstufe.
// Prüfnummer: Ab „Eingereicht“ (bis zum Bescheid) sind alle Merkmale gesperrt – auch in der Datenbank (Trigger a_freeze
// auf weinausbau, dieselbe Bedingung); bei gültiger Prüfnummer bleiben Jahrgang, Rebsorte, Weinart, Mostgewicht und
// Rieden gesperrt (Abstufen bleibt möglich und beendet die Nummer, KAN-100).
// Isomorph, ohne '@/'-Importe (node:test).

/** Grund der DB-Sperre – derselbe Text steht im Trigger (Migration kan204) */
export const CHARGE_FREEZE_GRUND = 'Prüfnummernantrag eingereicht'

/** Spalten, die trotz Sperre änderbar bleiben (Bestand, Gebinde, Status, Notizen, Preis, Storno) */
export const CHARGE_FREEZE_ERLAUBT = [
  'name', 'behaelter_id', 'menge_liter', 'status', 'aktiv', 'notizen', 'einstandspreis_pro_liter', 'updated_at',
  'storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund',
] as const

/** Antragsstatus, in denen die Charge gesperrt ist (eingereicht bis zum Bescheid) */
export const CHARGE_SPERR_STATUS = ['eingereicht', 'in_pruefung'] as const

export type ChargePnSperre = 'eingereicht' | 'gueltig' | null

/** Sperrstufe der Charge: Antrag eingereicht/in Prüfung → alle Merkmale; gültige Prüfnummer → Merkmale außer Qualität */
export function chargePnSperre(
  antraege: { status: string | null; storniert_am?: string | null }[],
  gueltigkeiten: { gueltig_bis: string | null }[],
): ChargePnSperre {
  if (antraege.some(a => !a.storniert_am && (CHARGE_SPERR_STATUS as readonly string[]).includes(String(a.status)))) return 'eingereicht'
  if (gueltigkeiten.some(g => g.gueltig_bis == null)) return 'gueltig'
  return null
}

/** Text zur Sperrstufe (Formular und Server) */
export function chargePnSperreText(s: ChargePnSperre): string | null {
  if (s === 'eingereicht') return 'Für die Charge ist ein Prüfnummernantrag eingereicht – Jahrgang, Rebsorte, Weinart, Qualität, Mostgewicht und Rieden sind bis zum Bescheid gesperrt.'
  if (s === 'gueltig') return 'Die Charge hat eine gültige Prüfnummer – Jahrgang, Rebsorte, Weinart, Mostgewicht und Rieden sind gesperrt. Abstufen ist möglich (die Prüfnummer erlischt dann für den Tankbestand).'
  return null
}

export type ChargeWerte = {
  jahrgang: number | null
  rebsorte: string | null
  weinart: string | null
  qualitaetsstufe: string | null
  behaelterId: string | null
  /** Wein in der Charge (aktiv, Bestand > 0,01 L) – dann ist das Gebinde Pflicht */
  mitBestand: boolean
}

/** Fehlende Pflichtangaben (nur geprüfte Felder); null = vollständig */
export function chargePflichtFehler(w: ChargeWerte, opt: { eroeffnungsbestand?: boolean; geprueft?: Partial<Record<keyof ChargeWerte, boolean>> } = {}): string | null {
  const g = (k: keyof ChargeWerte) => opt.geprueft?.[k] !== false
  const fehlt: string[] = []
  if (!opt.eroeffnungsbestand) {
    if (g('jahrgang') && (w.jahrgang == null || !Number.isFinite(w.jahrgang))) fehlt.push('Jahrgang')
    if (g('rebsorte') && !(w.rebsorte ?? '').trim()) fehlt.push('Rebsorte')
    if (g('weinart') && (!w.weinart || w.weinart === 'unbekannt')) fehlt.push('Weinart (weiß, rot oder rosé)')
  }
  if (g('qualitaetsstufe') && !w.qualitaetsstufe) fehlt.push('Qualitätsstufe')
  if (g('behaelterId') && w.mitBestand && !w.behaelterId) fehlt.push('Gebinde')
  if (fehlt.length === 0) return null
  return `Bitte noch angeben: ${fehlt.join(', ')}.`
}

/** Eröffnungsbestand: Hinweis, wenn Jahrgang, Rebsorte, Weinart oder Herkunft fehlen (speichern geht trotzdem) */
export function eroeffnungsbestandHinweis(w: { jahrgang: number | null; rebsorte: string | null; weinart: string | null; herkunft: string | null }): string | null {
  const fehlt: string[] = []
  if (w.jahrgang == null) fehlt.push('Jahrgang')
  if (!(w.rebsorte ?? '').trim()) fehlt.push('Rebsorte')
  if (!w.weinart || w.weinart === 'unbekannt') fehlt.push('Weinart')
  if (!w.herkunft) fehlt.push('Herkunft')
  if (fehlt.length === 0) return null
  return `Ohne ${fehlt.join(', ')} – bei einem Mischbestand bitte die bekannten Angaben (z. B. Jahrgänge und Sorten mit Anteil) in den Notizen festhalten.`
}

/** Meldung, wenn Qualität, Zusatz oder Erzeugnis außerhalb von „Abstufen“ geändert werden sollen */
export const NUR_ABSTUFEN_MELDUNG = 'Qualitätsstufe, Zusatzbezeichnung und Erzeugnis ändern sich nur über „Abstufen“ (mit Datum und Grund) – '
  + 'bitte auf der Chargen-Seite „Abstufen“ verwenden. War die Angabe falsch erfasst, die zugrunde liegende Buchung (Lese, Pressung, Zukauf) korrigieren.'

/** Hinweis unter den Notizen des Eröffnungsbestands (Formulare) */
export const EB_NOTIZEN_HINWEIS = 'Jahrgang, Rebsorte und Weinart dürfen bei einem Mischbestand fehlen – dann bitte die bekannten Angaben (Jahrgänge, Sorten mit Anteil) hier festhalten.'
