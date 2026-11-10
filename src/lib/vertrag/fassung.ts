// ── Vertragsunterlagen software:112 (KAN-300, 10.11.2026) ───────────────────────────────────────────────────────
//
// Gültige Fassung der AGB samt Vereinbarung zur Auftragsverarbeitung (Anlage 2) und Leistungsbeschreibung (Anlage 3).
// Die Seite /agb zeigt sie an, die Registrierung speichert beim neuen Betrieb, welche Fassung bestätigt wurde
// (tenants.vertrag_fassung/_bestaetigt_am/_bestaetigt_von). Neue Fassung: PDF unter public/agb/ ablegen und die
// Konstanten anpassen – die alte PDF bleibt liegen (Nachweis für Betriebe, die sie bestätigt haben).
// Isomorph, ohne @/-Importe (node:test).

export const VERTRAG_FASSUNG = '3'
/** Datum der Fassung, wie es auf den Unterlagen steht */
export const VERTRAG_DATUM = '10. November 2026'
/** Kennung, die beim Betrieb gespeichert wird */
export const VERTRAG_KENNUNG = 'v3 2026-11-10'
/** Öffentlicher Pfad der PDF (public/agb/…, im Proxy über /agb freigegeben) */
export const VERTRAG_PDF = '/agb/AGB_AVV_Leistungsbeschreibung_software112_v3.pdf'

/** Hat die Person der Registrierung AGB und Datenschutzerklärung zugestimmt? (Formularwert des Häkchens) */
export function zustimmungGegeben(wert: FormDataEntryValue | null): boolean {
  return wert === '1' || wert === 'on' || wert === 'true'
}
