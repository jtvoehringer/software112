// ── Aktiver Navigationspunkt und Bereich (ohne @/-Importe, damit node:test es direkt laden kann) ──

/** Pfade, die nur exakt matchen (kein Präfix-Match für Unterrouten) */
export const EXACT_PATHS = new Set(['/dashboard', '/crm', '/weinhandel', '/auswertungen', '/kellerbuch', '/behandlungen', '/buchhaltung'])

export function isActivePath(href: string, pathname: string): boolean {
  return pathname === href || (!EXACT_PATHS.has(href) && pathname.startsWith(href))
}

/**
 * Bereich (Index), zu dem der Pfad gehört: längster passender Navigationspunkt; bei gleicher Länge der erste in
 * NAV-Reihenfolge. KAN-378 (Abnahme 23.10.2026): Unterseiten ohne eigenen Navigationspunkt unter einem exakt
 * matchenden Pfad (z. B. /weinhandel/fuellungen/<id>/edit unter „Warenlager“ /weinhandel) fielen bisher auf den
 * ersten Bereich (Übersicht) zurück – die Topbar markierte „Übersicht“ statt „Warenwirtschaft“. Jetzt zählt in
 * einem zweiten Durchgang der Präfix dieser Pfade; erst ohne jeden Treffer bleibt der erste Bereich.
 */
export function aktiverBereichIndex(bereiche: { items: { href: string }[] }[], pathname: string): number {
  let best: { i: number; len: number } | null = null
  bereiche.forEach((g, i) => {
    for (const it of g.items) {
      if (isActivePath(it.href, pathname) && (!best || it.href.length > best.len)) best = { i, len: it.href.length }
    }
  })
  if (!best) {
    bereiche.forEach((g, i) => {
      for (const it of g.items) {
        if (EXACT_PATHS.has(it.href) && pathname.startsWith(it.href + '/') && (!best || it.href.length > best.len)) best = { i, len: it.href.length }
      }
    })
  }
  return (best as { i: number } | null)?.i ?? 0
}
