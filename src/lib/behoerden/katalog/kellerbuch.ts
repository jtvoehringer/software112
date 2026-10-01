// Katalog der Behördenmeldungen – Gruppe „Kellerbuch“ (Bewegungsbuch, Kellerbehandlungen,
// Gebindeverzeichnis, Weinbuch, Weinbuch-Sammlung, Rückverfolgung, Blend-Protokoll,
// Keller-Auswertungen, Änderungsprotokoll).
// Isomorph (auch in Client-Komponenten nutzbar). Je Eintrag: Schlüssel = id (URL /meldungen/<id>/csv).
// Zu jedem Eintrag gehört genau ein Eintrag in register/kellerbuch.ts (erzwingt der Typ MeldungenZu).
//
// Zugriff: Die Kellerbuch-Seiten sieht jedes Mitglied (auch Leser) – ihre CSV ebenso
// ('mitglied'). Die Weinbuch-Sammlung ist Pflichtmeldung ('betriebsleitung', Entscheidung
// 24.09.2026), die Keller-Auswertungen gehören zum Modul Controlling ('auswertungen'). Das
// Änderungsprotokoll hat Zugriff 'verwaltung' (Betriebs-Manager, Super-Admin – nur diese
// dürfen das bestandsprotokoll lesen, RLS); die Ladefunktion prüft die Rolle als zweite Linie.
//
// Rechtsgrundlagen stammen aus der Inventur (24.09.2026) und sind fachlich zu prüfen.

import { wienHeute } from '@/lib/csv'
import { katalogGruppe } from '../typen'

/** Standardauswahl von /reports/keller: ab 1. Jänner des laufenden Jahres (Wiener Zeit) */
const abJahresbeginn = () => ({ von: `${wienHeute().slice(0, 4)}-01-01` })

const KELLERBUCH_RECHT = 'Weingesetz 2009 (Kellerbuch/Weinbuchführung) und VO (EU) 2018/273 Art. 28 ff. (Ein- und Ausgangsbücher) – zu prüfen'

export const KATALOG_KELLERBUCH = katalogGruppe('kellerbuch', {
  bewegungsbuch: {
    titel: 'Bewegungsbuch je Gebinde (Ein- und Ausgangsbuch)',
    behoerde: 'BKI (Kellerbuchprüfung)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/behaelter/[id]/bewegungen',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Zu- und Abgänge eines Gebindes mit laufendem Saldo, Zeitraum frei wählbar (Übertrag am Anfang).',
  },
  'keller-behandlungen': {
    titel: 'Kellerbehandlungen (önologische Verfahren)',
    behoerde: 'BKI (Kellerbuchprüfung)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/behaelter/[id]/behandlungen',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Behandlungen eines Gebindes im Zeitraum, mit Charge, Menge, Dosierung und Volumen.',
  },
  // Die gebindeübergreifende Liste war Teil der Controlling-Auswertung /reports/keller und bleibt
  // dort (Entscheidung 24.09.2026: übrige Reports hinter Controlling + Auswertungsrecht).
  'keller-behandlungen-alle': {
    titel: 'Kellerbehandlungen aller Gebinde',
    behoerde: 'BKI (Kellerbuchprüfung)',
    zugriff: 'auswertungen',
    druckPfad: '/reports/keller',
    standardParameter: abJahresbeginn,
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Behandlungen aller Gebinde im gewählten Zeitraum (Keller-Auswertungen), gleiche Spalten wie je Gebinde.',
  },
  gebindeverzeichnis: {
    titel: 'Gebindeverzeichnis',
    behoerde: 'BKI (Prüfung vor Ort)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/gebinde',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Alle Gebinde mit Nennvolumen, aktueller Charge und Menge; Kellergemeinschaft nur als Belegung.',
  },
  weinbuch: {
    titel: 'Weinbuch je Charge',
    behoerde: 'BKI (Betriebsprüfung)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/weinausbau/[id]/buch',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Vollständige Prozesshistorie einer Charge von der Rebe bis zur Flasche, eine Zeile je Ereignis.',
  },
  'weinbuch-sammlung': {
    titel: 'Weinbuch-Sammlung',
    behoerde: 'BKI (Betriebsprüfung)',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/weinbuecher-sammlung',
    pflicht: true,
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Weinbücher aller Chargen nach Jahrgang, Sorte oder Bezeichnung.',
  },
  rueckverfolgung: {
    titel: 'Rückverfolgung Füllung → Charge → Pressung → Weingarten',
    behoerde: 'BKI / Lebensmittelaufsicht',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/rueckverfolgung',
    rechtsgrundlage: 'Art. 18 VO (EG) 178/2002 (Rückverfolgbarkeit) – zu prüfen',
    beschreibung: 'Eine Zeile je Füllung × Ursprung: Charge, Anteil, Pressung, Weingarten/Ried, GST-Nr., Behandlungen des Grundstücks bis zur Lese.',
  },
  'blend-protokoll': {
    titel: 'Blend-Protokoll',
    behoerde: 'BKI (Nachweis der Sorten- und Jahrgangsanteile)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/fuellung/[id]/blend-protokoll',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Herkunftsanteile einer Füllung bzw. Charge (auch /kellerbuch/weinausbau/[id]/blend-protokoll).',
  },
  'keller-auswertungen': {
    titel: 'Keller-Auswertungen: Umzüge, Filtrationen und Schwund',
    behoerde: 'BKI (Kellerbuchführung)',
    zugriff: 'auswertungen',
    druckPfad: '/reports/keller',
    standardParameter: abJahresbeginn,
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Alle Umzüge, Filtrationen und Schwundbuchungen im gewählten Zeitraum.',
  },
  aenderungsprotokoll: {
    titel: 'Änderungs- und Löschprotokoll (Bestandsprotokoll)',
    behoerde: 'BKI / Weinaufsicht',
    zugriff: 'verwaltung',
    druckPfad: '/kellerbuch/gebinde',
    rechtsgrundlage: 'Nachvollziehbarkeit nachträglicher Änderungen der Aufzeichnungen – zu prüfen',
    beschreibung: 'Nachträgliche Änderungen und Löschungen in Kellerbuch, Lese, Verkauf, E&A und Stammdaten (Rieden, Grundstücke, Mittel) – nur Betriebs-Manager und Super-Admins.',
  },
})
