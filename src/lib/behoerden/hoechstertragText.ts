// KAN-79 (02.10.2026): Rechtsfolge bei Überschreitung der Hektarhöchstmenge – eigene Datei ohne Importe, damit auch
// Client-Komponenten (Lese-Seite) sie nutzen können; lib/behoerden/erntemeldung.ts reicht sie weiter.
// Wortlaut § 23 Abs. 3 Weingesetz 2009 (RIS, Fassung BGBl. I Nr. 47/2016, geprüft 02.10.2026): „Wird die
// Hektarhöchstmenge gemäß Abs. 2 überschritten, so darf die gesamte Menge der Ernte eines Jahrgangs nur als Wein ohne
// Rebsorten- und Jahrgangsbezeichnung in Verkehr gebracht werden.“
export const HOECHSTERTRAG_RECHTSFOLGE = 'Rechtsfolge (§ 23 Abs. 3 WeinG 2009): Die GESAMTE Ernte des Jahrgangs darf nur als Wein ohne Rebsorten- und Jahrgangsbezeichnung in Verkehr gebracht werden – Chargen und Füllungen dieses Jahrgangs entsprechend abstufen'
