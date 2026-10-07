// KAN-176 (07.10.2026): mehrere Lieferadressen je Kontakt bzw. Firma; Verkauf mit abweichender Lieferadresse.
// Gemeinsam für CRM-Pflege, Verkaufsformular, Server Actions und Ausgaben (Rechnung, Lieferschein, TB).
// Isomorph und ohne '@/'-Importe (node:test).

export type Lieferadresse = {
  id?: string
  bezeichnung: string | null
  empfaenger: string | null
  strasse: string
  plz: string
  ort: string
  land: string
}

/** Momentaufnahme am Verkauf (verkaufsposten.lieferadresse) – dieselben Felder ohne id */
export type LieferadresseMoment = Omit<Lieferadresse, 'id'>

const text = (x: unknown) => (typeof x === 'string' ? x.trim() : '')

/** Rohe Eingabe (Formularfelder `<praefix>strasse` usw. bzw. Objekt) → Adresse; das Land prüft der Aufrufer (ISO) */
export function lieferadresseAus(roh: Record<string, unknown>, land: string): Lieferadresse {
  return {
    bezeichnung: text(roh.bezeichnung) || null,
    empfaenger: text(roh.empfaenger) || null,
    strasse: text(roh.strasse),
    plz: text(roh.plz),
    ort: text(roh.ort),
    land,
  }
}

/** Pflichtfelder und Längen wie die CHECKs der Tabelle; null = in Ordnung */
export function lieferadresseFehler(a: Lieferadresse): string | null {
  if (!a.strasse) return 'Bitte Straße und Hausnummer der Lieferadresse angeben.'
  if (!a.plz) return 'Bitte die PLZ der Lieferadresse angeben.'
  if (!a.ort) return 'Bitte den Ort der Lieferadresse angeben.'
  if (a.strasse.length > 120 || a.ort.length > 80 || a.plz.length > 12) return 'Ein Feld der Lieferadresse ist zu lang.'
  if ((a.bezeichnung ?? '').length > 80 || (a.empfaenger ?? '').length > 120) return 'Bezeichnung bzw. Empfänger der Lieferadresse ist zu lang.'
  if (!/^[A-Z]{2}$/.test(a.land)) return 'Bitte ein Land aus der Liste wählen.'
  return null
}

/** Momentaufnahme für den Verkauf */
export function lieferadresseMoment(a: Lieferadresse): LieferadresseMoment {
  return { bezeichnung: a.bezeichnung, empfaenger: a.empfaenger, strasse: a.strasse, plz: a.plz, ort: a.ort, land: a.land }
}

/** Zeilen für Druck und PDF: [Empfänger], Straße, PLZ Ort[, Land außer AT] */
export function lieferadresseZeilen(a: Partial<LieferadresseMoment> | null | undefined, landName: (iso: string) => string = x => x): string[] {
  if (!a || !a.strasse) return []
  return [
    a.empfaenger ?? '',
    a.strasse,
    [a.plz, a.ort].filter(Boolean).join(' '),
    a.land && a.land !== 'AT' ? landName(a.land) : '',
  ].filter(Boolean)
}

/** Eine Zeile für Auswahllisten: „Lager Wien – Hauptstraße 1, 1010 Wien“ */
export function lieferadresseKurz(a: Partial<Lieferadresse>): string {
  const ort = [a.plz, a.ort].filter(Boolean).join(' ')
  const adr = [a.strasse, ort, a.land && a.land !== 'AT' ? a.land : ''].filter(Boolean).join(', ')
  return a.bezeichnung ? `${a.bezeichnung} – ${adr}` : adr
}

/** Gleiche Adresse (für „schon gespeichert?“) – Groß-/Kleinschreibung und Leerraum egal */
export function gleicheLieferadresse(a: Partial<Lieferadresse>, b: Partial<Lieferadresse>): boolean {
  const n = (x: unknown) => text(x).toLocaleLowerCase('de').replace(/\s+/g, ' ')
  return n(a.strasse) === n(b.strasse) && n(a.plz) === n(b.plz) && n(a.ort) === n(b.ort) && n(a.land || 'AT') === n(b.land || 'AT')
    && n(a.empfaenger) === n(b.empfaenger)
}
