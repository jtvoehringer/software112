// Katalog der Behördenmeldungen – Gruppe „Ernte & Lese“ (Weinerntemeldung, Lesedaten, BKI-Datenblatt Traubenverkauf, Weinbestandsmeldung (KAN-43) samt BSM nach Buchungsarten und Kontrolljournal).
// Isomorph (auch in Client-Komponenten nutzbar). Je Eintrag: Schlüssel = id (URL /meldungen/<id>/csv).
// Zu jedem Eintrag gehört genau ein Eintrag in register/ernte.ts (erzwingt der Typ MeldungenZu).
//
// Zugriff 'betriebsleitung' (Entscheidung Jörgen 24.09.2026): Pflichtmeldungen samt Druck
// und CSV erreichen Super-Admins, Betriebs-Manager und Mitarbeiter auch ohne Modul
// „Controlling“; Leser nur mit Controlling + Auswertungsrecht.

import { katalogGruppe } from '../typen'

export const KATALOG_ERNTE = katalogGruppe('ernte', {
  erntemeldung: {
    titel: 'Weinerntemeldung',
    behoerde: 'BMLUK-Weindatenbank bzw. eAMA (Kontrolle BKI)',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/ama',
    pflicht: true,
    rechtsgrundlage: 'Weingesetz 2009 (Erntemeldung); VO (EU) 2018/273',
    beschreibung: 'Erntemenge je Rebsorte mit Fläche, hl, Mostgewicht (Mittel in °KMW und °Oe), Qualitätsstufe, Traubenverkauf, Ertrag je ha und Übermenge (Hektarhöchstertrag).',
  },
  lesedaten: {
    titel: 'Lesedaten je Parzelle',
    behoerde: 'BMLUK-Weindatenbank bzw. eAMA (Kontrolle BKI)',
    zugriff: 'betriebsleitung',
    druckPfad: '/erntemeldung/[id]',
    pflicht: true,
    rechtsgrundlage: 'Weingesetz 2009 (Erntemeldung)',
    beschreibung: 'Lese je Ried bzw. Grundstück: Datum, KG- und GST-Nr., Rebsorte, Menge, Mostgewicht in °KMW und °Oe samt gemessener Einheit, Qualitätsstufe, Lesemethode, Notizen (z. B. Grund für 0 kg).',
  },
  bestandsmeldung: {
    titel: 'Weinbestandsmeldung (Bestand zum Stichtag)',
    behoerde: 'BMLUK-Weindatenbank',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/ama',
    pflicht: true,
    rechtsgrundlage: '§ 29 Weingesetz 2009 (Stichtag 31. Juli, Meldefrist 15. August)',
    beschreibung: 'Flaschenwein und Wein in Gebinden – Bestand zum Stichtag (Standard 31. Juli), aus dem heutigen Bestand und den Buchungen danach zurückgerechnet.',
  },
  // KAN-43 Etappe 2: BSM je Meldezeitraum (Entscheidung Jörgen 02.10.2026: BSM = 1.8.–31.7.), gegliedert nach Buchungsarten
  bsm: {
    titel: 'Weinbestandsmeldung nach Buchungsarten (BSM)',
    behoerde: 'BMLUK-Weindatenbank',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/bestandsmeldung-bsm',
    pflicht: true,
    rechtsgrundlage: '§ 29 Weingesetz 2009 (Weinwirtschaftsjahr 1. August – 31. Juli, Meldefrist 15. August)',
    beschreibung: 'Anfangsbestand + Zugänge − Abgänge je BSM-Buchungsart = Endbestand, je Herkunft, BSM-Spalte (Wein … Prädikatswein, Perl-/Schaumwein, Sonstige), weiß/rot und offen/Flasche – mit Abgleich gegen den Stichtagsbestand.',
  },
  'bsm-kontrolljournal': {
    titel: 'Kontrolljournal zur Bestandsmeldung (BSM)',
    behoerde: 'BMLUK-Weindatenbank',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/bestandsmeldung-bsm',
    pflicht: true,
    rechtsgrundlage: '§ 29 Weingesetz 2009',
    beschreibung: 'Jede Buchung der BSM mit Datum, Beleg, Charge/Füllung, Buchungsart, Spalte, Farbe, Herkunft und offen/Flasche – filterbar nach Buchungsart (z. B. nur Abwertung).',
  },
  'bki-traubenverkauf': {
    titel: 'BKI-Datenblatt Traubenverkauf',
    behoerde: 'BKI / BMLUK-Weindatenbank',
    zugriff: 'betriebsleitung',
    druckPfad: '/weinhandel/traubenverkauf',
    pflicht: true,
    rechtsgrundlage: '§ 3 Weingesetz-Formularverordnung, BGBl. II Nr. 13/2012',
    beschreibung: 'EDV-Liste zum automatischen Einlesen in die Weindatenbank (eine Zeile je Traubenlieferung).',
  },
})
