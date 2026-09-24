// Katalog der Behördenmeldungen – Gruppe „Buchhaltung & Steuer“ (UVA-Kennzahlen, Aufzeichnungen
// der E&A-Rechnung für Finanzamt/Betriebsprüfung, Anlagenverzeichnis, SVS-Einheitswerte).
// Isomorph (auch in Client-Komponenten nutzbar). Je Eintrag: Schlüssel = id (URL /meldungen/<id>/csv).
// Zu jedem Eintrag gehört genau ein Eintrag in register/buchhaltung.ts (erzwingt der Typ MeldungenZu).
//
// Zugriff wie die Seiten unter /buchhaltung: jedes aktive Mitglied, sofern das Modul
// „E&A-Rechnung“ (modul_ea) freigeschaltet ist.

import { katalogGruppe } from '../typen'

export const KATALOG_BUCHHALTUNG = katalogGruppe('buchhaltung', {
  uva: {
    titel: 'Umsatzsteuervoranmeldung (Kennzahlen U30)',
    behoerde: 'Finanzamt (FinanzOnline)',
    zugriff: 'mitglied',
    modul: 'modul_ea',
    rechtsgrundlage: '§ 21 UStG 1994',
    druckPfad: '/buchhaltung/uva',
    pflicht: true,
    beschreibung: 'Kennzahlen des Formulars U30 je Voranmeldungszeitraum – Kontrolle vor der Eingabe in FinanzOnline bzw. für die Steuerberatung (keine elektronische Übermittlung).',
  },
  'ea-journal': {
    titel: 'Einnahmen-Ausgaben-Journal',
    behoerde: 'Finanzamt (Betriebsprüfung)',
    zugriff: 'mitglied',
    modul: 'modul_ea',
    rechtsgrundlage: '§ 4 Abs. 3 EStG 1988; §§ 126, 131 BAO',
    druckPfad: '/buchhaltung',
    beschreibung: 'Alle Buchungen eines Jahres mit Kategorie, Sachkonto, USt, Zahlungskonto (Bank/Kassa) und Belegverweis.',
  },
  kassabuch: {
    titel: 'Kassabuch',
    behoerde: 'Finanzamt (Betriebsprüfung)',
    zugriff: 'mitglied',
    modul: 'modul_ea',
    rechtsgrundlage: '§ 131 BAO',
    druckPfad: '/buchhaltung/kassabuch',
    beschreibung: 'Bewegungen eines Kassa-Kontos im Zeitraum mit Saldovortrag und laufendem Kassastand.',
  },
  rechnungsausgangsjournal: {
    titel: 'Rechnungsausgangsjournal',
    behoerde: 'Finanzamt (Betriebsprüfung)',
    zugriff: 'mitglied',
    modul: 'modul_ea',
    rechtsgrundlage: '§ 11 UStG 1994; § 131 BAO',
    druckPfad: '/buchhaltung/rechnungsjournal',
    beschreibung: 'Alle Ausgangsrechnungen des Zeitraums inkl. Stornos mit Netto und USt je Steuersatz; Lücken in den Rechnungsnummern werden gemeldet.',
  },
  belegverzeichnis: {
    titel: 'Belegverzeichnis',
    behoerde: 'Finanzamt (Betriebsprüfung)',
    zugriff: 'mitglied',
    modul: 'modul_ea',
    rechtsgrundlage: '§§ 131, 132 BAO',
    druckPfad: '/buchhaltung/belege/verzeichnis',
    beschreibung: 'Hochgeladene Belege eines Jahres mit Status und zugeordneter Buchung.',
  },
  anlagenverzeichnis: {
    titel: 'Anlagenverzeichnis (Anlagenspiegel)',
    behoerde: 'Finanzamt',
    zugriff: 'mitglied',
    modul: 'modul_ea',
    rechtsgrundlage: '§ 7 Abs. 3 EStG 1988; § 13 EStG 1988 (GWG)',
    druckPfad: '/buchhaltung/anlagen/spiegel',
    beschreibung: 'Anlagen eines Jahres mit Anschaffungskosten, AfA und Buchwerten zum 1.1. und 31.12.',
  },
  'svs-einheitswerte': {
    titel: 'Einheitswerte je Grundstück (SVS)',
    behoerde: 'SVS',
    zugriff: 'mitglied',
    modul: 'modul_ea',
    rechtsgrundlage: 'BSVG § 23 (Pauschalsystem)',
    druckPfad: '/buchhaltung/svs',
    beschreibung: 'Einheitswert, Bescheid und SVS-Zurechnung je Grundstück – im Format des Einheitswert-Imports.',
  },
})
