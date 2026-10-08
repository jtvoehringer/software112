// ── Lohnversektung (KAN-232, 08.10.2026) ──────────────────────────────────────────────────────────────────
//
// Grundwein geht außer Haus zur Versektung (bleibt eigener Bestand, Gebinde wird frei), Sekt kommt in Flaschen zurück –
// je Lieferung eine Füllung mit lohnversektung_id (Journal LNSKT/LNSKT_ZU). Regeln der Datenbank:
// s112_lohnversektung_versenden/_stornieren, Trigger b_lohnversektung/z_lohnversektung_stand.
// Ohne '@/'-Importe, damit node:test sie prüfen kann.

export type LohnversektungStand = 'unterwegs' | 'teilweise' | 'abgeschlossen' | 'storniert'

export const STAND_TEXT: Record<LohnversektungStand, string> = {
  unterwegs: 'beim Versekter',
  teilweise: 'teilweise zurück',
  abgeschlossen: 'abgeschlossen',
  storniert: 'storniert',
}

/** Stand eines Versands aus Storno, Abschluss und den Litern der (nicht stornierten) Rückkehr-Füllungen */
export function lohnversektungStand(l: { storniertAm: string | null; abgeschlossenAm: string | null; literZurueck: number }): LohnversektungStand {
  if (l.storniertAm) return 'storniert'
  if (l.abgeschlossenAm) return 'abgeschlossen'
  return l.literZurueck > 0.005 ? 'teilweise' : 'unterwegs'
}

/** Prüfung im Formular und in der Server Action (die RPC prüft Bestand, Periode und Bewegungen) */
export function versandFehler(e: { weinausbauId: string; firmaId: string; datum: string; heute: string }): string | null {
  if (!e.weinausbauId) return 'Bitte die Grundwein-Charge wählen.'
  if (!e.firmaId) return 'Bitte die Sektkellerei (Versekter) wählen.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.datum)) return 'Bitte ein gültiges Versanddatum angeben.'
  if (e.datum > e.heute) return 'Das Versanddatum liegt in der Zukunft.'
  return null
}

/** Pfad zum Erfassen einer Rückkehr (Füllungsformular im Lohnversektungs-Modus) */
export function rueckkehrPfad(lohnversektungId: string): string {
  return `/weinhandel/fuellungen/neu?lohnversektung=${encodeURIComponent(lohnversektungId)}`
}
