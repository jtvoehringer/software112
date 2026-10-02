// ── Stichtag des Eröffnungsbestands (KAN-42 Etappe 1, 02.10.2026) ────────────────────────────────────
//
// Echtbetrieb ab 01.01.2027: Der Eröffnungsbestand (Tank-Chargen, ab KAN-42 auch Flaschen) wird zu einem
// wählbaren Stichtag erfasst – Standard 01.01. des laufenden Jahres (bis KAN-42 fest).
//
// Gespeichert ohne Migration:
//   * Tank (weinausbau, ist_eroeffnungsbestand): weinausbau hat kein Datumsfeld – created_at trägt den Stichtag,
//     00:00 Uhr Wiener Zeit (eroeffnungsZeitpunkt). Gelesen wird überall der WIENER Kalendertag von created_at
//     (eroeffnungsTag): Bewegungsbuch, Bestand zum Stichtag (bestandsmeldung.ts über tag()), Weinbuch.
//     Bestehende Eröffnungsbestände (created_at 2026-01-01T00:00:00Z, damals new Date('JJJJ-01-01T00:00:00') auf dem
//     UTC-Server) ergeben in Wiener Zeit weiterhin den 01.01.2026 – nichts verschiebt sich.
//   * Flaschen (fuellungen ohne Charge): das vorhandene Datumsfeld `datum` (DATE) = Stichtag,
//     Kennzeichen import_quelle = 'eroeffnungsbestand' (IMPORT_QUELLE_EROEFFNUNG).
//
// Isomorph und ohne '@/'-Importe – geprüft in scripts/tests/kan42-eroeffnung.test.mjs.

const TAG_RE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Kennzeichen (fuellungen.import_quelle) einer Füllung, die als Flaschen-Eröffnungsbestand angelegt wurde */
export const IMPORT_QUELLE_EROEFFNUNG = 'eroeffnungsbestand'

const WIEN = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function wienTeile(ms: number): { j: number; m: number; t: number; h: number; min: number; s: number } {
  const p: Record<string, number> = {}
  for (const x of WIEN.formatToParts(new Date(ms))) if (x.type !== 'literal') p[x.type] = Number(x.value)
  return { j: p.year, m: p.month, t: p.day, h: p.hour === 24 ? 0 : p.hour, min: p.minute, s: p.second }
}

/** Abstand Wiener Wandzeit − UTC (ms) zum Zeitpunkt `ms` */
function wienVersatz(ms: number): number {
  const w = wienTeile(ms)
  return Date.UTC(w.j, w.m - 1, w.t, w.h, w.min, w.s) - Math.floor(ms / 1000) * 1000
}

/** Gültiger Kalendertag 'JJJJ-MM-TT'? */
export function istKalendertag(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const m = TAG_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** Standard-Stichtag: 01.01. des laufenden Jahres (heute = Wiener Kalendertag 'JJJJ-MM-TT') */
export function standardEroeffnungsStichtag(heute: string): string {
  return `${heute.slice(0, 4)}-01-01`
}

/** TT.MM.JJJJ */
export function stichtagText(stichtag: string): string {
  const m = TAG_RE.exec(stichtag)
  return m ? `${m[3]}.${m[2]}.${m[1]}` : stichtag
}

/**
 * Prüfung des Stichtags – null = zulässig. Erlaubt ab 01.01.2000 bis zum 31.12. des nächsten Jahres (Erfassung im
 * Dezember für den 01.01. des Folgejahres, KAN-42).
 */
export function eroeffnungsStichtagFehler(stichtag: unknown, heute: string): string | null {
  if (!istKalendertag(stichtag)) return 'Bitte einen gültigen Stichtag angeben (TT.MM.JJJJ).'
  if (stichtag < '2000-01-01') return `Der Stichtag ${stichtagText(stichtag)} liegt vor dem Jahr 2000 – bitte prüfen.`
  const spaetestens = `${Number(heute.slice(0, 4)) + 1}-12-31`
  if (stichtag > spaetestens) return `Der Stichtag ${stichtagText(stichtag)} liegt zu weit in der Zukunft – höchstens bis ${stichtagText(spaetestens)}.`
  return null
}

/**
 * Zeitpunkt (ISO, UTC) für created_at eines Tank-Eröffnungsbestands: Stichtag 00:00 Uhr Wiener Zeit –
 * unabhängig von der Zeitzone des Servers. 2027-01-01 → '2026-12-31T23:00:00.000Z'.
 */
export function eroeffnungsZeitpunkt(stichtag: string): string {
  const m = TAG_RE.exec(stichtag)
  if (!m || !istKalendertag(stichtag)) throw new Error(`Ungültiger Stichtag: ${stichtag}`)
  const mitternachtUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  let t = mitternachtUtc - wienVersatz(mitternachtUtc)
  const v2 = wienVersatz(t)
  if (mitternachtUtc - v2 !== t) t = mitternachtUtc - v2   // Sommerzeitwechsel zwischen Schätzung und Ergebnis
  return new Date(t).toISOString()
}

/**
 * Stichtag eines Tank-Eröffnungsbestands aus created_at: Wiener Kalendertag ('JJJJ-MM-TT'); null, wenn leer oder
 * ungültig. Ein reiner Kalendertag bleibt unverändert.
 */
export function eroeffnungsTag(createdAt: unknown): string | null {
  if (createdAt == null || createdAt === '') return null
  if (typeof createdAt === 'string' && TAG_RE.test(createdAt.trim())) return createdAt.trim()
  const d = createdAt instanceof Date ? createdAt : new Date(String(createdAt))
  const ms = d.getTime()
  if (!Number.isFinite(ms)) return null
  const w = wienTeile(ms)
  return `${String(w.j).padStart(4, '0')}-${String(w.m).padStart(2, '0')}-${String(w.t).padStart(2, '0')}`
}

/** Füllung = Flaschen-Eröffnungsbestand (import_quelle, ohne Charge)? */
export function istFlaschenEroeffnung(f: { import_quelle?: unknown; weinausbau_id?: unknown } | null | undefined): boolean {
  return !!f && f.import_quelle === IMPORT_QUELLE_EROEFFNUNG && !f.weinausbau_id
}
