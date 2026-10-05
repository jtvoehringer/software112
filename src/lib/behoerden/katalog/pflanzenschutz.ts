// Katalog der Behördenmeldungen – Gruppe „Pflanzenschutz & Düngung“ (Pflanzenschutz-Aufzeichnungen, Mittelverbrauch, Kupfer-Bilanz, Nährstoffbilanz).
// Isomorph (auch in Client-Komponenten nutzbar). Je Eintrag: Schlüssel = id (URL /meldungen/<id>/csv).
// Zu jedem Eintrag gehört genau ein Eintrag in register/pflanzenschutz.ts (erzwingt der Typ MeldungenZu).
// Berechnung und Spalten: lib/behoerden/psm.ts, cu.ts, naehrstoff.ts.
//
// Zugriff „betriebsleitung“ (Entscheidung 24.09.2026): Betriebsleiter (system_admin, tenant_admin,
// winzer) auch ohne Modul Controlling; Leser nur mit Controlling + Auswertungsrecht – wie die
// Druckseiten unter reports/(pflicht)/.

import { wienHeute } from '@/lib/csv'
import { katalogGruppe } from '../typen'

/** Standardauswahl der Druckseiten unter reports/(pflicht)/: laufendes Jahr (Wiener Zeit) */
const laufendesJahr = () => ({ jahr: wienHeute().slice(0, 4) })

export const KATALOG_PFLANZENSCHUTZ = katalogGruppe('pflanzenschutz', {
  'psm-aufzeichnung': {
    titel: 'Pflanzenschutz-Aufzeichnungen (Behandlungsprotokoll)',
    behoerde: 'Landwirtschaftskammer / Landes-Pflanzenschutzbehörde, AMA (Konditionalität), Bio-Kontrollstelle',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/behandlungsprotokoll',
    standardParameter: laufendesJahr,
    pflicht: true,
    rechtsgrundlage: 'Art. 67 VO (EG) 1107/2009, DVO (EU) 2023/564; Pflanzenschutzmittelgesetz 2011',
    beschreibung: 'Eine Zeile je Maßnahme und Grundstück: Datum, Ried, KG, GST-Nr., Fläche, Kultur, Mittel, Zulassungsnr., Wirkstoff, Schaderreger, BBCH, Aufwand, Mittelmenge und Spritzbrühe anteilig nach Fläche, Wasser, Wartezeit, Anwender, Witterung.',
  },
  // KAN-87: maschinenlesbar für die künftige digitale Übermittlung (KAN-120 verwendet sie weiter)
  'psm-uebermittlung': {
    titel: 'Pflanzenschutz – Aufzeichnung zur Übermittlung (maschinenlesbar)',
    behoerde: 'Landes-Pflanzenschutzbehörde / AMA (DVO (EU) 2023/564)',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/behandlungsprotokoll',
    standardParameter: laufendesJahr,
    pflicht: true,
    rechtsgrundlage: 'Art. 67 VO (EG) 1107/2009, DVO (EU) 2023/564 (elektronisch ab 01.01.2027, DVO (EU) 2025/2203)',
    beschreibung: 'Je Anwendung eines Pflanzenschutzmittels und Grundstück: Datensatz-ID, Betriebsnummer, Anwender, Datum, Start-/Endzeit, Art der Verwendung, Kultur (EPPO), BBCH, Mittel, Registernummer, Aufwand, Fläche, KG, GST, AMA-Feldstück/-Schlag, erfasst am/von, Verzug und Nacherfassung.',
  },
  'psm-mittelverbrauch': {
    titel: 'Pflanzenschutz – Mittelverbrauch und Grenzwerte',
    behoerde: 'Landwirtschaftskammer / Bio-Kontrollstelle',
    zugriff: 'betriebsleitung',
    druckPfad: '/behandlungen/berichte',
    beschreibung: 'Je Saison und Mittel: Anwendungen, Mittelmenge (aus dem Aufwand), behandelte Fläche, Ø Aufwand je ha gegen die Grenzwerte der Stammdaten.',
  },
  'cu-bilanz': {
    titel: 'Kupfer-Bilanz (je Weingarten)',
    behoerde: 'Bio-Kontrollstelle / AMA (ÖPUL)',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/cu-bilanz',
    standardParameter: laufendesJahr,
    pflicht: true,
    rechtsgrundlage: 'VO (EU) 2018/848, DVO (EU) 2021/1165 Anhang II; ÖPUL',
    beschreibung: 'Je Jahr und Weingarten: Fläche, Cu (kg), Cu (kg/ha), Grenzwert, Ampel sowie 5- und 7-Jahres-Summe je ha.',
  },
  'cu-bilanz-behandlungen': {
    titel: 'Kupfer-Bilanz – Einzelbehandlungen',
    behoerde: 'Bio-Kontrollstelle / AMA (ÖPUL)',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/cu-bilanz',
    standardParameter: laufendesJahr,
    pflicht: true,
    rechtsgrundlage: 'VO (EU) 2018/848, DVO (EU) 2021/1165 Anhang II',
    beschreibung: 'Jede Kupfer-Anwendung: Datum, Weingarten, Mittel, Cu-Gehalt, Spritzbrühe, Aufwand, Mittelmenge (aus dem Aufwand), behandelte Fläche, Cu (kg) und Cu (kg/ha).',
  },
  naehrstoffbilanz: {
    titel: 'Nährstoffbilanz (Düngeaufzeichnung)',
    behoerde: 'Landwirtschaftskammer / Landesbehörde, AMA (Konditionalität)',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/naehrstoffbilanz',
    standardParameter: laufendesJahr,
    pflicht: true,
    rechtsgrundlage: 'Nitrat-Aktionsprogramm-Verordnung (NAPV) 2023',
    beschreibung: 'Eine Zeile je Düngung: Datum, Ried, Lage, Fläche, Düngemittel, Düngermenge (kg), N/P-Gehalt, N/P (kg) und (kg/ha).',
  },
  // KAN-132: N/P je Ried aus den GST-Anteilen der Düngungen
  'naehrstoffbilanz-weingarten': {
    titel: 'Nährstoffbilanz je Ried',
    behoerde: 'Landwirtschaftskammer / Landesbehörde, AMA (Konditionalität)',
    zugriff: 'betriebsleitung',
    druckPfad: '/reports/naehrstoffbilanz',
    standardParameter: laufendesJahr,
    pflicht: true,
    rechtsgrundlage: 'Nitrat-Aktionsprogramm-Verordnung (NAPV) 2023',
    beschreibung: 'Eine Zeile je Jahr und Ried: WI-Fläche, Anzahl Düngungen, N/P (kg) und (kg/ha) anteilig nach Grundstücksfläche, Vergleich mit dem Richtwert 50 kg N/ha.',
  },
  // KAN-108: Rückverfolgung geteilt in Weingarten und Weinkeller (BKI R19) – wie die Kellerbuch-Rückverfolgung
  // für jedes Mitglied abrufbar; Einstieg über Jahrgang/GST, Lese, Charge oder Füllung
  'rueckverfolgung-weingarten': {
    titel: 'Rückverfolgung Weingarten (Maßnahmen bis zur Lese, Wartezeiten)',
    behoerde: 'BKI / Lebensmittelaufsicht, Landes-Pflanzenschutzbehörde',
    zugriff: 'mitglied',
    druckPfad: '/weingarten/rueckverfolgung',
    standardParameter: () => ({ jahrgang: wienHeute().slice(0, 4) }),
    rechtsgrundlage: 'Art. 18 VO (EG) 178/2002 (Rückverfolgbarkeit), Art. 67 VO (EG) 1107/2009',
    beschreibung: 'Eine Zeile je Lese-Grundstück und Maßnahme „von Ernte bis Ernte“: Weingarten, KG, GST, Feldstück, Sorte, Lesedatum, kg, KMW, Traubenverkauf mit Abnehmer und Liefernummer; je Pflanzenschutzmittel Registernummer, Aufwand, Wartezeit, frühester Lesetermin und Prüfung gegen den Lesetag.',
  },
})
