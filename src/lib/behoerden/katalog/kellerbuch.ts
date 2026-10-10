// Katalog der Behördenmeldungen – Gruppe „Kellerbuch“ (Bewegungsbuch, Kellerbehandlungen,
// Gebindeverzeichnis, Weinbuch, Weinbuch-Sammlung, Rückverfolgung, Blend-Protokoll,
// BKI-Lagerstand und -Lagerbewegungen, Keller-Auswertungen, Änderungsprotokoll).
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
  // KAN-109: Rückruf-Liste vorwärts (Los/Charge/Pressung → Abnehmer); sehen dürfen alle Mitglieder (Entscheidung 06.10.2026)
  'rueckverfolgung-vorwaerts': {
    titel: 'Rückverfolgung vorwärts – Rückruf-Liste',
    behoerde: 'Lebensmittelaufsicht (Rückruf)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/rueckverfolgung/vorwaerts',
    rechtsgrundlage: 'Art. 18 VO (EG) 178/2002 (Rückverfolgbarkeit, Abnehmer je Stufe) – zu prüfen',
    beschreibung: 'Von einem Los, einer Charge oder einer Pressung über Umzüge und Verschnitte bis zu den Abnehmern: Verkäufe, Tankverkäufe, Export; Endverbraucher summiert; Abgleich je Füllung.',
  },
  'blend-protokoll': {
    titel: 'Blend-Protokoll',
    behoerde: 'BKI (Nachweis der Sorten- und Jahrgangsanteile)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/fuellung/[id]/blend-protokoll',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Herkunftsanteile einer Füllung bzw. Charge (auch /kellerbuch/weinausbau/[id]/blend-protokoll).',
  },
  // KAN-44 Teil 1: die beiden Blätter der BKI-Schnittstelle aus dem Bewegungsjournal (kellerbuch_buchungen)
  // KAN-107: Stoffkonto (besondere Konten) je Weinwirtschaftsjahr
  'besondere-konten': {
    titel: 'Besondere Konten – Stoffkonto',
    behoerde: 'BKI (Kellerbuch, besondere Konten)',
    zugriff: 'betriebsleitung',
    druckPfad: '/kellerbuch/besondere-konten',
    pflicht: true,
    rechtsgrundlage: 'Del. VO (EU) 2018/273, § 31 WeinG (besondere Konten) – zu prüfen',
    beschreibung: 'Kontoauszug je Stoff (Zucker, RTK, Säuerungs- und Entsäuerungsmittel …) im Weinwirtschaftsjahr 01.08.–31.07.: Übertrag, Zugänge, Verwendungen mit Charge und Behälter, Inventur, Saldo.',
  },
  // KAN-45: Blatt „Besondere Konten“ der BKI-Schnittstelle (je Buchung, Anfangsstand, Empfangscharge)
  'bki-besondere-konten': {
    titel: 'Besondere Konten (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/besondere-konten',
    standardParameter: abJahresbeginn,
    rechtsgrundlage: 'Del. VO (EU) 2018/273, § 31 WeinG (besondere Konten) – zu prüfen',
    beschreibung: 'Jede Buchung des Stoffkontos im Zeitraum mit Art des Stoffs (Zucker, RTK, Säuerungs-, Entsäuerungsmittel), Los, Anfangsstand, Menge und Empfangscharge.',
  },
  'bki-lagerstand': {
    titel: 'Lagerstand zum Datum (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/lagerstand',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Bestand je Charge (offen) und Füllung (Flasche, etikettiert/unetikettiert) zum Stichtag aus dem Bewegungsjournal, mit Erzeugnis, Farbe, Sorte, Stufe, Herkunft und Prüfnummer.',
  },
  'bki-lagerbewegungen': {
    titel: 'Lagerbewegungen (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/lagerbewegungen',
    standardParameter: abJahresbeginn,
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Jede Buchung des Bewegungsjournals im Zeitraum mit Anfangs- und Buchungsmenge, Buchungsart (BSM) sowie Käufer bzw. Verkäufer.',
  },
  // KAN-48 AP11: Stammdaten-Blätter der BKI-Schnittstelle (eine Seite für beide)
  'bki-betriebsdaten': {
    titel: 'Betriebsdaten (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/bki-stammdaten',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Betriebsnummer, Name bzw. Firmenname, Betriebsstätte, Adresse (Straße und Hausnummer getrennt) und Bio-Kennzeichen.',
  },
  'bki-gebindeverzeichnis': {
    titel: 'Gebindeverzeichnis (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/bki-stammdaten',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Bezeichnung, Langbezeichnung, Material, Aufstellungsort und Nenninhalt je Gebinde, mit den mitbenutzten Gebinden der Kellergemeinschaft.',
  },
  // KAN-47 AP10 Schritt 1: Blatt „Weingärten“ aus den vorhandenen Ried- und Grundstücksdaten
  'bki-weingaerten': {
    titel: 'Weingärten (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/bki-weingaerten',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Eine Zeile je Grundstück: KG, Feldstück, Nutzungsart, Eigen/Pacht, Sorte mit Fläche und Pflanzjahr, Bundesland, Gemeinde, g.U. und DAC-Gebiet; Großlage und Lagen folgen mit den amtlichen Katalogen.',
  },
  // KAN-50 AP13: Katalogblätter der BKI-Schnittstelle (Kürzel von software:112, KAN-38 E2)
  'bki-qualitaetsstufen': {
    titel: 'Qualitätsstufen (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/bki-schnittstelle',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Qualitätsstufen mit dem Kürzel, das software:112 in allen Blättern verwendet (amtliche BKI-Kürzel, eigene Vorschläge gekennzeichnet).',
  },
  'bki-erzeugnisse': {
    titel: 'Erzeugnisse (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/bki-schnittstelle',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Erzeugnisse laut Schnittstelle mit dem Kürzel von software:112 (vorläufig, die BKI kennt keine Liste).',
  },
  'bki-buchungsarten': {
    titel: 'Buchungsarten (BKI-Schnittstelle)',
    behoerde: 'BKI (Weindatenbank)',
    zugriff: 'mitglied',
    druckPfad: '/kellerbuch/bki-schnittstelle',
    rechtsgrundlage: KELLERBUCH_RECHT,
    beschreibung: 'Die Buchungsarten der Bestandsmeldung mit Kürzel, Richtung und Einheit.',
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
