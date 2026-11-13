// ── Leserechte je Profil (KAN-412 R1, 13.11.2026) ──────────────────────────────────────────────────────────────────
//
// Bisher liest jedes aktive Mitglied alles im Betrieb. Neu sind zwei feste Profile für Mitarbeiter (Rolle „winzer“):
//   vertrieb  CRM, Verkauf, Füllungen/Warenlager, Auswertungen – nicht Keller, Rieden, E&A-Rechnung
//   extern    Rieden und Maßnahmen – sonst nichts
// Ohne Profil bleibt alles wie bisher (auch für Leser und die Betriebsleitung). Entscheidungen Jörgen 11.11. und
// 13.11.2026 (Jira KAN-412, Fragen 1–8 jeweils A).
//
// Die Datenbank setzt das Lesen ab R2 mit Sperr-Policies durch (dieselbe Zuordnung: public.s112_profil_bereiche und
// scripts/lesebereiche.json – der Test kan412-profil hält die drei Stellen gleich). Diese Datei ist für Navigation,
// Seiten und Server-Code. Isomorph, ohne '@/'-Importe (node:test).

export const LESEBEREICHE = ['allgemein', 'rieden', 'massnahmen', 'betriebsmittel', 'lese', 'keller', 'lager', 'verkauf', 'crm', 'ea',
  'controlling', 'ki', 'betrieb', 'verwaltung'] as const
export type Lesebereich = typeof LESEBEREICHE[number]

export const PROFILE = {
  vertrieb: { label: 'Vertrieb', hinweis: 'CRM, Verkauf und Warenlager bearbeiten, Auswertungen sehen – ohne Keller, Rieden und E&A-Rechnung',
    lesen: ['allgemein', 'crm', 'verkauf', 'lager', 'controlling', 'ki', 'betrieb'], schreibmodule: ['warenwirtschaft', 'crm', 'auswertungen'] },
  extern: { label: 'Extern', hinweis: 'Rieden und Maßnahmen sehen und bearbeiten – sonst nichts (z. B. Lohnunternehmer, Berater)',
    lesen: ['allgemein', 'rieden', 'massnahmen'], schreibmodule: ['rieden'] },
} as const satisfies Record<string, { label: string; hinweis: string; lesen: readonly Lesebereich[]; schreibmodule: readonly string[] }>
export type Profil = keyof typeof PROFILE

export function istProfil(v: unknown): v is Profil {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(PROFILE, v)
}

export function istLesebereich(v: unknown): v is Lesebereich {
  return typeof v === 'string' && (LESEBEREICHE as readonly string[]).includes(v)
}

/** Profil einer Mitgliedschaft: nur Mitarbeiter (Rolle „winzer“) können eines haben – sonst null (liest alles) */
export function profilAus(role: unknown, roh: unknown): Profil | null {
  return role === 'winzer' && istProfil(roh) ? roh : null
}

/**
 * Darf die Mitgliedschaft den Bereich lesen? Ohne Profil ja (wie bisher); mit Profil nur die Bereiche des Profils.
 * Ohne Mitgliedschaft nein.
 */
export function canRead(m: { role?: unknown; profil?: unknown } | null | undefined, bereich: Lesebereich): boolean {
  if (!m || !m.role) return false
  const profil = profilAus(m.role, m.profil)
  if (!profil) return true
  return (PROFILE[profil].lesen as readonly string[]).includes(bereich)
}

/** Bereiche, die die Mitgliedschaft lesen darf (ohne Profil alle) */
export function lesbareBereiche(m: { role?: unknown; profil?: unknown } | null | undefined): Lesebereich[] {
  return LESEBEREICHE.filter(b => canRead(m, b))
}

/** Hinweis auf der Startseite, wenn ein Seiten-Guard (requireLesen, KAN-456) dorthin umgeleitet hat */
export const KEIN_LESERECHT_TEXT = 'Für die aufgerufene Seite fehlt dir das Leserecht – du bist deshalb auf der Übersicht gelandet.'
