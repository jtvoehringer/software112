// ── Personendaten eines Kontakts löschen (DSGVO Art. 17, KAN-425 Teil 1, 12.11.2026) ─────────────────────────────────
//
// Der Betrieb löscht auf Verlangen die Personendaten eines Kontakts (RPC s112_kontakt_personendaten_loeschen):
//   * ohne Belege geht der Kontakt samt Aktivitäten, Pipeline-Einträgen, Lieferadressen und gelernten Begriffen ganz;
//   * mit Belegen (Verkauf, Rechnung, Zukauf, Export, Traubenverkauf – Aufbewahrung 7 Jahre) bleibt die Zeile als
//     „Gelöschter Kontakt“ mit ihrer Kundennummer, alle Personendaten sind geleert, die Zeile ist danach unveränderlich.
//     Die Belege behalten ihre Momentaufnahme des Partners.
// Nie automatisch (Entscheidung Jörgen 12.11.2026): software:112 stellt die Funktion bereit, der Betrieb löst sie aus.
// Isomorph, ohne '@/'-Importe (node:test) – gemeinsam für Kontaktseite und Server Action.

export const PERSONENDATEN_GRUND_MIN = 10
export const PERSONENDATEN_GRUND_MAX = 500
export const GELOESCHTER_KONTAKT = 'Gelöschter Kontakt'
export const DOKUMENT_BUCKET = 'aktivitaet-dokumente'

/** Prüfung des Grundes; null = in Ordnung */
export function personendatenGrundFehler(grund: unknown): string | null {
  const t = typeof grund === 'string' ? grund.trim() : ''
  if (t.length < PERSONENDATEN_GRUND_MIN) return `Bitte einen Grund für das Löschen angeben (mindestens ${PERSONENDATEN_GRUND_MIN} Zeichen), z. B. „Löschersuchen per E-Mail vom 12.11.2026“.`
  if (t.length > PERSONENDATEN_GRUND_MAX) return `Der Grund darf höchstens ${PERSONENDATEN_GRUND_MAX} Zeichen lang sein.`
  return null
}

/** Text der Rückfrage: was geht, was bleibt – und was software:112 nicht löschen kann */
export const PERSONENDATEN_HINWEIS =
  'Name, Adresse, Telefon, E-Mail, Notizen, Aktivitäten samt gespeicherter E-Mails und Dokumente, Vorhaben, Lieferadressen und Newsletter-Daten ' +
  'werden endgültig gelöscht. Hat der Kontakt Belege (Verkäufe, Rechnungen …), bleibt er als „Gelöschter Kontakt“ mit seiner Kundennummer stehen; ' +
  'die Belege selbst behalten Name und Adresse (Aufbewahrungspflicht 7 Jahre). ' +
  'E-Mails im Postfach des Betriebs und Ausdrucke löscht software:112 nicht. Das lässt sich nicht rückgängig machen.'

export type PersonendatenErgebnis = { art: 'geloescht' | 'anonymisiert'; dateien: string[] }

/** Antwort der RPC lesen; null = unerwartete Form */
export function personendatenErgebnisAus(roh: unknown): PersonendatenErgebnis | null {
  const r = (Array.isArray(roh) ? roh[0] : roh) as Record<string, unknown> | null
  if (!r || typeof r !== 'object') return null
  if (r.art !== 'geloescht' && r.art !== 'anonymisiert') return null
  const dateien = Array.isArray(r.dateien) ? r.dateien.filter((d): d is string => typeof d === 'string' && d.length > 0) : []
  return { art: r.art, dateien }
}

export function personendatenErfolgText(art: PersonendatenErgebnis['art']): string {
  return art === 'geloescht'
    ? 'Der Kontakt und seine Personendaten wurden gelöscht.'
    : 'Die Personendaten wurden gelöscht. Der Kontakt bleibt wegen seiner Belege als „Gelöschter Kontakt“ stehen.'
}

/** Ist der Kontakt bereits anonymisiert? */
export function istAnonymisiert(k: { anonymisiert_am?: string | null } | null | undefined): boolean {
  return !!k?.anonymisiert_am
}
