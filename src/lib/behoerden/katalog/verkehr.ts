// Katalog der Behördenmeldungen – Gruppe „Weinverkehr & Export“ (Transportbescheinigung (TBS), Prüfnummernantrag (PNA), DAC-Anträge, Weinexport/EMCS).
// Isomorph (auch in Client-Komponenten nutzbar). Je Eintrag: Schlüssel = id (URL /meldungen/<id>/csv).
// Zu jedem Eintrag gehört genau ein Eintrag in register/verkehr.ts (erzwingt der Typ MeldungenZu).
//
// Zugriff wie die jeweilige Seite: Transportbescheinigung, Prüfnummernantrag und die DAC-Liste
// sehen alle aktiven Mitglieder (die Seiten haben keinen weiteren Guard, Speichern verlangt
// Schreibrecht); Weinexport zusätzlich nur mit Modul „Weinexport“ (modul_export).

import { katalogGruppe } from '../typen'

export const KATALOG_VERKEHR = katalogGruppe('verkehr', {
  transportbescheinigung: {
    titel: 'Transportbescheinigung',
    behoerde: 'Bundeskellereiinspektion (BKI)',
    zugriff: 'mitglied',
    rechtsgrundlage: 'Weingesetz 2009 (Transportbescheinigung)',
    druckPfad: '/weinhandel/verkauf/[id]/transportbescheinigung',
    pflicht: true,
    beschreibung: 'Je Verkaufsposten eine Zeile je Weinposition mit Versender, Empfänger, Transportmittel, Menge, Art, Sorte, Jahrgang, Herkunft und Prüfnummer.',
  },
  transportbescheinigungen: {
    titel: 'Transportbescheinigungen eines Zeitraums',
    behoerde: 'Bundeskellereiinspektion (BKI)',
    zugriff: 'mitglied',
    rechtsgrundlage: 'Weingesetz 2009 (Transportbescheinigung)',
    druckPfad: '/weinhandel/transportbescheinigungen',
    beschreibung: 'Alle Verkäufe von–bis mit Tank-, Flaschen- oder Traubenpositionen, gleiche Spalten wie die einzelne Transportbescheinigung, mit Formularstand.',
  },
  pruefnummernantrag: {
    titel: 'Antrag auf staatliche Prüfnummer',
    behoerde: 'Bundesamt für Weinbau (Prüfnummer)',
    zugriff: 'mitglied',
    rechtsgrundlage: '§ 25 Weingesetz 2009',
    druckPfad: '/dac/[id]/antrag',
    pflicht: true,
    beschreibung: 'Antragsangaben je DAC-Antrag, eine Zeile je Mostcharge (ohne Mostcharge eine Zeile).',
  },
  'dac-antraege': {
    titel: 'DAC- und Prüfnummernanträge',
    behoerde: 'Bundesamt für Weinbau (Prüfnummer)',
    zugriff: 'mitglied',
    druckPfad: '/dac',
    beschreibung: 'Alle Anträge mit DAC-Region, Jahrgang, Rebsorte, Menge, Status, Einreichung, Prüfnummer und Bescheid.',
  },
  exportauftrag: {
    titel: 'Weinexport – Positionsliste zu den Begleitpapieren',
    behoerde: 'Zoll, Wirtschaftskammer (Ursprung)',
    zugriff: 'mitglied',
    modul: 'modul_export',
    druckPfad: '/weinexport/[id]',
    beschreibung: 'Anlage zu V1/V2, EUR.1, CMR und Ursprungszeugnis: je Position Bezeichnung, TARIC, Menge, Einheit, Liter, Wert, Ursprung, Bestimmungsland und EORI.',
  },
  exportauftraege: {
    titel: 'Weinexport – Aufträge mit Dokument- und EMCS-Status',
    behoerde: 'Zoll (EMCS-AT)',
    zugriff: 'mitglied',
    modul: 'modul_export',
    druckPfad: '/weinexport',
    beschreibung: 'Alle aktiven Exportaufträge mit Warenwert, Volumen, Status der Begleitpapiere (auch Phytosanitär), ARC-Nummer und EMCS-Status.',
  },
})
