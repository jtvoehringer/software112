// ── Freeze-Sperren (KAN-96, 04.10.2026) ─────────────────────────────────────────────────────────────────
// Der Datenbank-Trigger s112_freeze lehnt Änderungen an gesperrten Datensätzen mit 42501 ab (HINT 'freeze',
// DETAIL als JSON). Diese Helfer machen daraus eine verständliche Meldung und liefern den Text für den
// UI-Baustein <GesperrtHinweis>. Korrigieren darf nur der Betriebsleiter über die RPC s112_freeze_korrektur
// (mit Grund, protokolliert). Isomorph, ohne '@/'-Importe (node:test).

export type FreezeSperre = {
  tabelle: string
  grund: string
  /** TT.MM.JJJJ oder null */
  seit: string | null
  erlaubt: string[]
  /** Spalten, deren Änderung abgelehnt wurde (leer beim Löschen) */
  spalten: string[]
  aktion: 'UPDATE' | 'DELETE'
}

type DbFehler = { code?: unknown; hint?: unknown; details?: unknown; message?: unknown }

/** Liest die Sperre aus einem Supabase-/PostgREST-Fehler; null, wenn es keine Freeze-Sperre ist. */
export function freezeSperreAus(error: unknown): FreezeSperre | null {
  if (!error || typeof error !== 'object') return null
  const e = error as DbFehler
  if (e.code !== '42501' || e.hint !== 'freeze' || typeof e.details !== 'string') return null
  try {
    const d = JSON.parse(e.details) as Record<string, unknown>
    if (typeof d.tabelle !== 'string' || typeof d.grund !== 'string') return null
    const liste = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : [])
    return {
      tabelle: d.tabelle,
      grund: d.grund,
      seit: typeof d.seit === 'string' && d.seit ? d.seit : null,
      erlaubt: liste(d.erlaubt),
      spalten: liste(d.spalten),
      aktion: d.aktion === 'DELETE' ? 'DELETE' : 'UPDATE',
    }
  } catch {
    return null
  }
}

/** Kurztext „Gesperrt: <Grund> am <Datum>“ für Hinweise und Meldungen. */
export function sperrTitel(s: Pick<FreezeSperre, 'grund' | 'seit'>): string {
  return `Gesperrt: ${s.grund}${s.seit ? ` am ${s.seit}` : ''}`
}

/** Vollständige Meldung für ein abgelehntes Speichern bzw. Löschen. */
export function sperrMeldung(s: FreezeSperre, feldName: (spalte: string) => string = x => x): string {
  const titel = sperrTitel(s)
  if (s.aktion === 'DELETE') return `${titel} – Löschen ist nicht möglich.`
  const nicht = s.spalten.map(feldName).join(', ')
  if (s.erlaubt.length === 0) return `${titel} – keine Änderung möglich${nicht ? ` (${nicht})` : ''}. Korrekturen nur durch die Betriebsleitung.`
  return `${titel} – änderbar sind nur ${s.erlaubt.map(feldName).join(', ')}${nicht ? ` (nicht: ${nicht})` : ''}. Weitere Korrekturen nur durch die Betriebsleitung.`
}
