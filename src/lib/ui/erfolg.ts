// ── Erfolgsmeldungen als kurzes Pop-up (KAN-359, 22.10.2026) ──
// Entscheidung Jörgen 22.10.2026: Erfolg („Gespeichert.“, „Umzug gebucht.“) erscheint einheitlich als kurzes Pop-up
// (Toast) an EINER Stelle – am Handy oben unter der Kopfleiste, ab md unten rechts –, mit role="status", schließbar und
// nach ERFOLG_DAUER_MS von selbst weg. Angezeigt von MeldungsPopup (Root-Layout); Quellen:
//  - zeigeErfolg(text) direkt nach einer erfolgreichen Aktion (z. B. <ErfolgsMeldung text={ok} />),
//  - der Parameter `erledigt=<Schlüssel>` nach einem Redirect (KAN-224, ZurueckLeiste),
//  - grüne Ergebniskästen (role="status") der Seiten, die nach einer Aktion außer Sicht erscheinen (KAN-338).
// Hier nur der Zustand (ohne React und DOM, testbar). Konzept: docs/Meldungskonzept.md.

/** Anzeigedauer eines Erfolgs-Pop-ups */
export const ERFOLG_DAUER_MS = 5_000
/** Höchstens so viele Pop-ups gleichzeitig (ältere fallen weg) */
export const MAX_ERFOLGE = 3
/** Höchstlänge des Texts */
export const MAX_ERFOLG_TEXT = 300

export type Erfolg = {
  id: number
  text: string
  /** schon vorgelesen (grüner Kasten mit role="status" auf der Seite) – das Pop-up wird dann nicht noch einmal angesagt */
  vorgelesen: boolean
}

let liste: readonly Erfolg[] = []
let naechsteId = 1
const hoerer = new Set<() => void>()
const melden = () => hoerer.forEach(h => h())

/** Text fürs Pop-up: Leerraum zusammengefasst, gekürzt */
export function erfolgText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > MAX_ERFOLG_TEXT ? `${t.slice(0, MAX_ERFOLG_TEXT - 1)}…` : t
}

/** Erfolg melden; derselbe Text, der gerade schon steht, erscheint nicht doppelt. Rückgabe: id bzw. null */
export function zeigeErfolg(text: string | null | undefined, o?: { vorgelesen?: boolean }): number | null {
  const t = erfolgText(text ?? '')
  if (!t) return null
  const da = liste.find(e => e.text === t)
  if (da) return da.id
  const neu: Erfolg = { id: naechsteId++, text: t, vorgelesen: o?.vorgelesen === true }
  liste = [...liste.slice(-(MAX_ERFOLGE - 1)), neu]
  melden()
  return neu.id
}

export function schliesseErfolg(id: number): void {
  if (!liste.some(e => e.id === id)) return
  liste = liste.filter(e => e.id !== id)
  melden()
}

/** Die angezeigten Erfolge (stabile Referenz für useSyncExternalStore) */
export function aktuelleErfolge(): readonly Erfolg[] {
  return liste
}

const LEER: readonly Erfolg[] = []
/** Serverseitig gibt es keine Pop-ups */
export function keineErfolge(): readonly Erfolg[] {
  return LEER
}

export function abonniereErfolge(fn: () => void): () => void {
  hoerer.add(fn)
  return () => { hoerer.delete(fn) }
}
