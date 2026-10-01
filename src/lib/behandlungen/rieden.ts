// ── Rieden einer Maßnahme (KAN-121, 01.10.2026) ──────────────────────────────
//
// Über die App erfasste Maßnahmen setzen kein behandlungen.weingarten_id – die Zuordnung steht nur in
// behandlung_grundstuecke (Grundstück → weingarten_id). Wartefristen (Dashboard), Wetterregeln (letzte
// Spritzung je Ried) und Morgenbericht lasen bisher nur weingarten_id und zeigten „–“ bzw. fanden keine
// Spritzung. Die Rieden ergeben sich deshalb aus beiden Quellen: dem alten Einzelbezug (Altdaten, Demo)
// und den Grundstücken der Maßnahme. Eine Maßnahme kann mehrere Rieden betreffen.
//
// Maßgeblich sind die Grundstücke: Hat eine Maßnahme Grundstücke, gelten deren Rieden (in der Demo steht in
// weingarten_id nur die erste von mehreren Rieden). Nur ohne Grundstück zählt weingarten_id (Altdaten
// „nur an dieser Ried“, wie auf der Ried-Detailseite).
//
// Isomorph und ohne Abhängigkeiten (Server, node:test).

/** Select-Teil für behandlungen: alter Einzelbezug plus Rieden über die Grundstücke der Maßnahme */
export const BEHANDLUNG_RIEDEN_SELECT =
  'weingarten_id, weingarten:weingarten_id(id, name, ried), '
  + 'behandlung_grundstuecke(grundstueck:grundstueck_id(weingarten_id, weingarten:weingarten_id(id, name, ried)))'

export type MassnahmeRied = { id: string; name: string | null; ried: string | null }

type Roh = Record<string, unknown> | null | undefined
const einzeln = (v: unknown): Roh => (Array.isArray(v) ? (v[0] as Roh) : (v as Roh))

/** Alle Rieden einer Maßnahme (ohne Doppelte): über die Grundstücke, sonst über weingarten_id */
export function riedenDerMassnahme(b: Roh): MassnahmeRied[] {
  if (!b) return []
  const out = new Map<string, MassnahmeRied>()
  const dazu = (id: unknown, wg: Roh) => {
    const key = id ? String(id) : (wg?.id ? String(wg.id) : '')
    if (!key || out.has(key)) return
    out.set(key, {
      id: key,
      name: wg?.name != null ? String(wg.name) : null,
      ried: wg?.ried != null && String(wg.ried).trim() !== '' ? String(wg.ried) : null,
    })
  }
  const bg = Array.isArray(b.behandlung_grundstuecke) ? b.behandlung_grundstuecke : []
  for (const zeile of bg as Roh[]) {
    const g = einzeln(zeile?.grundstueck)
    if (g) dazu(g.weingarten_id, einzeln(g.weingarten))
  }
  if (out.size === 0) dazu(b.weingarten_id, einzeln(b.weingarten))
  return [...out.values()].sort((x, y) => (x.name ?? '').localeCompare(y.name ?? '', 'de'))
}

/** Ried-IDs einer Maßnahme */
export function riedIdsDerMassnahme(b: Roh): string[] {
  return riedenDerMassnahme(b).map(r => r.id)
}

/**
 * Anzeigetext: Namen der Rieden mit „, “ verbunden, höchstens `max` (Standard 3), danach „+N“.
 * `bevorzugt: 'ried'` nimmt die Riedbezeichnung, wenn gepflegt (Morgenbericht), sonst den Namen.
 * Ohne Ried: `leer` (Standard „–“).
 */
export function riedText(b: Roh, opts: { bevorzugt?: 'name' | 'ried'; leer?: string; max?: number } = {}): string {
  const namen = [...new Set(riedenDerMassnahme(b)
    .map(r => (opts.bevorzugt === 'ried' ? (r.ried || r.name) : (r.name || r.ried)))
    .filter((n): n is string => !!n))]
  if (namen.length === 0) return opts.leer ?? '–'
  const max = Math.max(1, opts.max ?? 3)
  return namen.length > max ? `${namen.slice(0, max).join(', ')} +${namen.length - max}` : namen.join(', ')
}
