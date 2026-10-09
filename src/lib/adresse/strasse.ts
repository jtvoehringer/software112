// Straße und Hausnummer aus einer Adresszeile trennen (KAN-48 AP11, 09.10.2026)
//
// Gespeichert wird die Adresse als eine Zeile („Jubiläumsstr. 43“) – Briefkopf, Rechnungen und Formulare zeigen sie so.
// Getrennte Felder brauchen die BKI-Schnittstelle (Betriebsdaten: Straße, Hausnummer varchar 20), Transport-
// bescheinigung, Prüfnummernantrag und das Traubenverkauf-Datenblatt. Bis 09.10.2026 gab es dafür zwei Regeln:
// strasseTeilen nahm das letzte Wort („Am Berg“ → Hausnummer „Berg“, „Hauptstraße 12 / 3“ → „3“), splitStrasseHausnr
// nur eine Zahl am Ende. Jetzt gilt eine Regel für alle:
//   Hausnummer = Zahl am Ende, auch mit Buchstabe und Stiege/Tür („12a“, „12-14“, „12/3“, „12 / 3“), davor optional ein
//   Komma; ohne erkennbare Hausnummer bleibt die ganze Zeile die Straße.
// Isomorph, ohne '@/'-Importe (node:test).

const HAUSNUMMER_AM_ENDE = /^(.+?),?\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)*)$/

export function strasseHausnummer(zeile: unknown): { strasse: string; hausnr: string } {
  const t = typeof zeile === 'string' ? zeile.replace(/\s+/g, ' ').trim() : ''
  if (!t) return { strasse: '', hausnr: '' }
  const m = HAUSNUMMER_AM_ENDE.exec(t)
  if (!m) return { strasse: t, hausnr: '' }
  return { strasse: m[1].trim(), hausnr: m[2].replace(/\s*([-/])\s*/g, '$1') }
}
