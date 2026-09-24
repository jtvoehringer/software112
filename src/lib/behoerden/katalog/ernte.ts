// Katalog der Behördenmeldungen – Gruppe „Ernte & Lese“ (Weinerntemeldung, Lesedaten, BKI-Datenblatt Traubenverkauf, Weinbestandsmeldung (KAN-43)).
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
    beschreibung: 'Erntemenge je Rebsorte mit Fläche, hl, Qualitätsstufe, Traubenverkauf, Ertrag je ha und Übermenge (Hektarhöchstertrag).',
  },
  lesedaten: {
    titel: 'Lesedaten je Parzelle',
    behoerde: 'BMLUK-Weindatenbank bzw. eAMA (Kontrolle BKI)',
    zugriff: 'betriebsleitung',
    druckPfad: '/erntemeldung/[id]',
    pflicht: true,
    rechtsgrundlage: 'Weingesetz 2009 (Erntemeldung)',
    beschreibung: 'Lese je Ried bzw. Grundstück: Datum, KG- und GST-Nr., Rebsorte, Menge, °KMW, Qualitätsstufe, Lesemethode.',
  },
  bestandsmeldung: {
    titel: 'Weinbestandsmeldung (Bestand am Abrufdatum)',
    behoerde: 'BMLUK-Weindatenbank',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/ama',
    pflicht: true,
    rechtsgrundlage: '§ 29 Weingesetz 2009 (Stichtag 31. Juli, Meldefrist 15. August)',
    beschreibung: 'Flaschenwein und Wein in Gebinden – Bestand am Tag des Abrufs, KEIN Stichtagsbestand (folgt mit KAN-43).',
  },
  'bki-traubenverkauf': {
    titel: 'BKI-Datenblatt Traubenverkauf',
    behoerde: 'BKI / BMLUK-Weindatenbank',
    zugriff: 'betriebsleitung',
    druckPfad: '/weinhandel/traubenverkauf',
    pflicht: true,
    rechtsgrundlage: '§ 3 Weingesetz-Formularverordnung, BGBl. II Nr. 13/2012',
    beschreibung: 'EDV-Liste zum automatischen Einlesen in die Weindatenbank (Transportbeleg je Traubenlieferung).',
  },
})
