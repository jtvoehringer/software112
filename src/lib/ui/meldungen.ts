// ── Meldungen als Pop-up (KAN-338, 14.10.2026) ──
// UAT: Fehlermeldungen (rot) und Bestätigungen (grün) stehen in langen Formularen oben – wer unten auf „Speichern“
// klickt, sieht sie nicht. MeldungsPopup (App-Rahmen) zeigt eine neue Meldung zusätzlich als Pop-up rechts unten,
// wenn sie nach einer Aktion des Benutzers erscheint und gerade nicht im sichtbaren Bereich liegt.
// Hier nur die reinen Regeln (ohne DOM, testbar): Was ist eine Meldung, und wann wird sie gezeigt.

export type MeldungsArt = 'fehler' | 'ok'

/** Was der Baustein über ein Element weiß (aus dem DOM gelesen) */
export type MeldungsKandidat = {
  tag: string
  className: string
  role: string | null
  text: string
}

/** Höchstlänge des Pop-up-Texts */
export const MAX_TEXT = 300
/** Zeitfenster nach einer Aktion (Absenden, Knopf), in dem eine neue Meldung als Antwort darauf gilt */
export const AKTION_FENSTER_MS = 20_000
/** Anzeigedauer einer Bestätigung; Fehler bleiben, bis man sie schließt */
export const OK_DAUER_MS = 5_000

const tokens = (c: string) => new Set(c.split(/\s+/).filter(Boolean))

/** Kleines Abzeichen (Status-Pille wie „Überfällig“) – nie eine Meldung */
function istAbzeichen(t: Set<string>, tag: string): boolean {
  return t.has('rounded-full') || tag === 'tr' || tag === 'td' || tag === 'th'
}

/**
 * Art der Meldung oder null:
 * - role="alert" bzw. role="status" mit roter/gelber (Fehler) bzw. grüner (Bestätigung) Farbe
 * - roter Meldungskasten (bg-s112-err-bg), kein Abzeichen; grüne nur mit role (sonst Kennzahl-Kacheln)
 * - Fehlerzeile ohne Kasten (text-s112-err-fg auf p/div, nicht klein wie ein Feldhinweis)
 */
export function meldungsArt(k: MeldungsKandidat): MeldungsArt | null {
  const text = k.text.trim()
  if (text.length < 3) return null
  const t = tokens(k.className)
  const tag = k.tag.toLowerCase()
  if (istAbzeichen(t, tag)) return null
  // rot = Fehler, gelb = Warnung (wird wie ein Fehler gezeigt), grün = Bestätigung; role ohne Farbe ist keine Meldung
  // (z. B. ein Kasten, der nur im Fehlerfall rot wird, oder eine Live-Region mit Zählern)
  const rot = ['bg-s112-err-bg', 'text-s112-err-fg', 'text-s112-err', 'bg-s112-warn-bg', 'text-s112-warn-fg'].some(x => t.has(x))
  const gruen = t.has('bg-s112-ok-bg') || t.has('text-s112-ok-fg')
  if (k.role === 'alert' || k.role === 'status') return rot ? 'fehler' : gruen ? 'ok' : null
  if (t.has('bg-s112-err-bg')) return 'fehler'
  // grüne Kästen ohne role sind oft Kennzahl-Kacheln (Lagerstand …) – Bestätigung nur mit role="status"/"alert"
  // Fehlerzeile ohne Kasten; Feldhinweise (text-xs) und große Kennzahlen (text-xl …) sind keine Meldung
  const kleinOderGross = [...t].some(x => /^text-(xs|\[11px\]|xl|2xl|3xl)$/.test(x))
  if ((tag === 'p' || tag === 'div') && t.has('text-s112-err-fg') && !kleinOderGross) return 'fehler'
  return null
}

/** Pop-up-Text: Leerraum zusammengefasst, gekürzt */
export function popupText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t
}

/**
 * Soll eine neue bzw. geänderte Meldung als Pop-up erscheinen?
 * Nur als Antwort auf eine Aktion (innerhalb von AKTION_FENSTER_MS, ohne Seitenwechsel dazwischen) und nur, wenn die
 * Meldung nicht vollständig sichtbar ist – eine sichtbare Meldung braucht kein Pop-up, ein Hinweis beim Seitenaufbau auch nicht.
 */
export function popupZeigen(o: {
  jetzt: number
  letzteAktion: number | null
  pfadBeiAktion: string | null
  pfadJetzt: string
  sichtbar: boolean
}): boolean {
  if (o.sichtbar) return false
  if (o.letzteAktion === null || o.jetzt - o.letzteAktion > AKTION_FENSTER_MS || o.jetzt < o.letzteAktion) return false
  return o.pfadBeiAktion === o.pfadJetzt
}

/** Vollständig im Sichtbereich (Rechteck des Elements innerhalb des Fensters) */
export function vollSichtbar(r: { top: number; bottom: number; height: number }, fensterHoehe: number): boolean {
  if (r.height === 0) return false
  return r.top >= 0 && r.bottom <= fensterHoehe
}
