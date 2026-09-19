// Module der Benutzer-Matrix (Migration 218) – bewusst ohne Server-Importe,
// damit auch Client-Komponenten (Benutzerverwaltung) die Liste nutzen können.

export type Modul = 'rieden' | 'kellerbuch' | 'warenwirtschaft' | 'crm' | 'ea' | 'auswertungen'

export const MODULE: { key: Modul; label: string; hinweis: string }[] = [
  { key: 'rieden',          label: 'Rieden',          hinweis: 'Weingärten, Maßnahmen, Betriebsmittel, Lese und Erntemeldung' },
  { key: 'kellerbuch',      label: 'Kellerbuch',      hinweis: 'Gebinde, Chargen, Kellerarbeiten, Analysen, Füllungen, Prüfnummer, Keller-Assistent' },
  { key: 'warenwirtschaft', label: 'Warenwirtschaft', hinweis: 'Warenlager, Verkauf, Offene Posten, Zukauf, Artikel, Rabattgruppen, Export – Verkäufe verändern den Flaschenbestand' },
  { key: 'crm',             label: 'CRM',             hinweis: 'Kontakte, Firmen, Aktivitäten, Pipeline, E-Mail, Dubletten' },
  { key: 'ea',              label: 'E&A-Rechnung',    hinweis: 'Buchungen, Belege, Bank/Kassa, UVA, Anlagen – Zugriff auf Finanzdaten, bewusst freigeben' },
  { key: 'auswertungen',    label: 'Controlling & Frag dein Weingut', hinweis: 'Auswertungen, Kostenrechnung und KI-Abfragen sehen (zeigt Umsätze und Margen des Betriebs)' },
]
export const ALLE_MODULE: Modul[] = MODULE.map(m => m.key)
export function isModul(x: unknown): x is Modul { return typeof x === 'string' && (ALLE_MODULE as string[]).includes(x) }

/** Vorlagen beim Anlegen eines Mitarbeiters - E&A bewusst in keiner Vorlage */
export const MODUL_VORLAGEN: { key: string; label: string; module: Modul[]; hinweis: string }[] = [
  { key: 'rieden_keller', label: 'Rieden & Keller', module: ['rieden', 'kellerbuch'],               hinweis: 'Weingarten und Keller bearbeiten' },
  { key: 'vertrieb',      label: 'Vertrieb',        module: ['warenwirtschaft', 'crm', 'auswertungen'], hinweis: 'Verkauf und CRM bearbeiten, Auswertungen sehen' },
  { key: 'alles',         label: 'Alle Module',     module: ['rieden', 'kellerbuch', 'warenwirtschaft', 'crm', 'ea', 'auswertungen'], hinweis: 'wie bisher Mitarbeiter' },
]

