// ── Merkmale eines Zukaufs fest (KAN-351, 22.10.2026) ─────────────────────────────────────────────────
// Dieselbe Bedingung wie der Trigger a_freeze auf zukauf_posten (Migration kan41_zukauf_flaschen):
//   o.art = 'flaschen' OR (o.ziel_weinausbau_id IS NOT NULL AND s112_zukauf_hat_folgebuchung(…))
// Genutzt von der Bearbeiten-Seite (Felder gesperrt, <GesperrtHinweis>) und von updateZukauf (Ablehnung vor dem
// Schreiben) – Projektregel: dieselbe Bedingung in Server Action und Formular. Befund UAT: Rebsorte & Co. wirkten
// änderbar, die Ablehnung kam erst nach dem Speichern.
// Isomorph, ohne '@/'-Importe (node:test).

export type ZukaufMerkmalLage = {
  /** gespeicherte Art des Zukaufs (zukauf_posten.art) */
  art: string | null | undefined
  /** zukauf_posten.ziel_weinausbau_id */
  zielWeinausbauId: string | null | undefined
  /** Anzahl Folgebuchungen an der Zielcharge ohne den Zukauf selbst (folgebuchungenDerZielcharge) */
  folgebuchungen: number
}

/** Merkmale (Datum, Art, Weinart, Rebsorte, Jahrgang, Qualität, Herkunft, Land, Mostgewicht, Alkohol,
 *  Anreicherung, Menge, Einheit) sind fest – wie der Trigger a_freeze. */
export function zukaufMerkmaleFest(z: ZukaufMerkmalLage): boolean {
  if (z.art === 'flaschen') return true
  return !!z.zielWeinausbauId && z.folgebuchungen > 0
}

/** Grund der Sperre für <GesperrtHinweis> – null, wenn die Merkmale änderbar sind. */
export function zukaufMerkmalSperrGrund(z: ZukaufMerkmalLage): string | null {
  if (!zukaufMerkmaleFest(z)) return null
  if (z.art === 'flaschen') return 'Der Flaschenzukauf ist bereits als Weinlager-Artikel gebucht'
  return 'Die Zielcharge ist bereits weiterbewegt'
}

/** Felder, die trotz Sperre änderbar bleiben (Positivliste des Triggers, Anzeigenamen) */
export const ZUKAUF_ERLAUBT_TROTZ_SPERRE = [
  'Rechnungsnummer', 'Uhrzeit', 'Transportmittel', 'Transportschein-Nr.', 'Preis', 'Einstandspreis', 'Prüfnummer', 'Notizen',
] as const
