// ── Transportscheinnummer (TBS-Nr.) bei Verkauf und Zukauf (KAN-90, 06.10.2026) ───────────────────────────────────────
//
// Eigene Transportbescheinigung: Nummer und Jahr stehen im Formular (laufende_nr, jahr); die Datenbank leitet daraus
// transportbescheinigungen.tbs_nummer/tbs_jahr ab (Trigger b_tbs_spalten) und lehnt ein Duplikat im selben Jahr ab
// (UNIQUE, nicht stornierte). Zukauf: Nummer und Jahr der Transportbescheinigung des Lieferanten
// (zukauf_posten.tbs_nummer_lieferant/tbs_jahr_lieferant). Anzeige überall „1234/2026“, Suche nach Nummer oder Nr./Jahr.
// Isomorph (node:test lädt die Datei über die Hooks).

/** Höchstlänge der Nummer (DB-CHECK zukauf_posten_tbs_nummer_chk) */
export const TBS_NUMMER_MAX = 30

const text = (v: unknown): string => (v == null ? '' : String(v).trim())

/** „1234/2026“, „1234“ (ohne Jahr) bzw. null ohne Nummer */
export function tbsText(nummer: unknown, jahr: unknown): string | null {
  const n = text(nummer)
  if (!n) return null
  const j = text(jahr)
  return j ? `${n}/${j}` : n
}

/** Jahr aus der Eingabe: vierstellig 2000–2100, leer = null, sonst NaN (ungültig) */
export function tbsJahrAus(v: unknown): number | null {
  const j = text(v)
  if (!j) return null
  return /^\d{4}$/.test(j) && Number(j) >= 2000 && Number(j) <= 2100 ? Number(j) : NaN
}

/** Prüfung der Lieferanten-TBS beim Zukauf: Jahr nur mit Nummer, Nummer höchstens 30 Zeichen, Jahr vierstellig */
export function tbsLieferantFehler(nummer: unknown, jahr: unknown): string | null {
  const n = text(nummer)
  const j = tbsJahrAus(jahr)
  if (n.length > TBS_NUMMER_MAX) return `Die Transportschein-Nr. darf höchstens ${TBS_NUMMER_MAX} Zeichen haben.`
  if (Number.isNaN(j)) return 'Das Jahr der Transportschein-Nr. bitte vierstellig angeben (z. B. 2026).'
  if (!n && j !== null) return 'Zum Jahr fehlt die Transportschein-Nr.'
  return null
}

/** Spalten für zukauf_posten aus der Eingabe (vorher tbsLieferantFehler prüfen) */
export function tbsLieferantSpalten(nummer: unknown, jahr: unknown): { tbs_nummer_lieferant: string | null; tbs_jahr_lieferant: number | null } {
  const n = text(nummer)
  const j = tbsJahrAus(jahr)
  return { tbs_nummer_lieferant: n || null, tbs_jahr_lieferant: n && j !== null && !Number.isNaN(j) ? j : null }
}

/** Suchbegriff → Nummer und (optional) Jahr: „1234“, „1234/2026“, „TBS 1234/2026“; null = keine TBS-Suche */
export function tbsSuche(q: unknown): { nummer: string; jahr: number | null } | null {
  const s = text(q).replace(/^tbs[\s.:-]*(nr\.?)?\s*/i, '')
  const m = /^([A-Za-z0-9-]{1,30})(?:\s*\/\s*(\d{4}))?$/.exec(s)
  if (!m) return null
  return { nummer: m[1], jahr: m[2] ? Number(m[2]) : null }
}

/** Trifft der Suchbegriff die TBS-Nr.? Nummer genau (ohne Groß-/Kleinschreibung), Jahr nur, wenn angegeben */
export function tbsTrifft(q: unknown, nummer: unknown, jahr: unknown): boolean {
  const s = tbsSuche(q)
  const n = text(nummer)
  if (!s || !n) return false
  if (s.nummer.toLowerCase() !== n.toLowerCase()) return false
  return s.jahr === null || s.jahr === Number(text(jahr))
}

/** Meldung bei einem Duplikat (DB 23505, Index transportbescheinigungen_tbs_nummer_uq) */
export function tbsDuplikatText(nummer: unknown, jahr: unknown): string {
  return `Die Transportschein-Nr. ${tbsText(nummer, jahr) ?? ''} ist in diesem Jahr bereits vergeben – bitte eine andere eintragen oder das Feld leer lassen (beim Ausstellen wird dann die nächste vergeben).`
}

/** Hinweis im Weinbuch der Ziel-Charge: „Zukauf lt. TBS 1234/2026“ bzw. „Transportschein-Nr. nicht erfasst“ */
export function zukaufTbsVermerk(nummer: unknown, jahr: unknown): string {
  const t = tbsText(nummer, jahr)
  return t ? `Zukauf lt. TBS ${t}` : 'Transportschein-Nr. nicht erfasst'
}

/** Listensuche (Verkauf, Zukauf): TBS-Nr. genau („1234“, „1234/2026“) oder Teiltext in einem der übrigen Felder */
export function listeTrifft(q: unknown, tbs: { nummer: unknown; jahr: unknown }, texte: readonly unknown[]): boolean {
  const s = text(q).toLowerCase()
  if (!s) return true
  if (tbsTrifft(s, tbs.nummer, tbs.jahr)) return true
  const t = tbsText(tbs.nummer, tbs.jahr)
  return [...texte, t].some(w => text(w).toLowerCase().includes(s))
}
