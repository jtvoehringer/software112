// ── Morgenbericht: Zeitplan des täglichen Laufs (KAN-123, 25.09.2026) ────────
// Der tägliche Cron riss am 60-s-Limit: die Betriebe liefen nacheinander nach created_at,
// das Budget wurde nur vor jedem Betrieb geprüft, Wetter und KI hatten kein Zeitlimit –
// den letzten Betrieb traf es regelmäßig, ohne dass das Protokoll es als Fehler zeigte.
// Hier liegen die Regeln an EINER Stelle: Zeitbudget und Grenzen, faire Reihenfolge,
// Einordnung der Ergebnisse (Fehler / bewusst ausgelassen) und die Prüfungen für den
// Systembericht. Bewusst ohne '@/'-Importe: genutzt von lauf.ts, erstellen.ts, ki.ts,
// den Cron-Routen, /admin/system und node:test (scripts/tests/kan123-morgenbericht.test.mjs).

/** Reserve nach dem Morgenbericht-Lauf bis maxDuration (Bereinigung, Protokoll, Antwort) */
export const LAUF_RESERVE_MS = 30_000
/** Zeitgrenze je Betrieb – Gebeshuber (bis 12 Wetterpunkte, KI) brauchte bisher höchstens 46 s */
export const BETRIEB_ZEITGRENZE_MS = 120_000
/** Ein Betrieb beginnt nur, wenn bis zum Laufende noch so viel Zeit bleibt (Prüfungen + Speichern ≈ 6 s) */
export const BETRIEB_MINDESTZEIT_MS = 15_000
/** Überzieht ein Betrieb seine Grenze trotzdem (hängende Abfrage), wartet der Lauf höchstens so lange nach */
export const BETRIEB_NACHLAUF_MS = 10_000
/** KI nur starten (und damit zählen), wenn noch so viel Zeit bleibt: Zeitlimit des Aufrufs 20 s (ki.ts) + Speichern */
export const KI_MINDESTZEIT_MS = 22_000
/** Wetterpunkte nur bis zur Grenze abzüglich dieser Reserve beginnen (Prüfungen, KI, Speichern) */
export const WETTER_RESERVE_MS = 30_000
/** Höchstens so viele Betriebe gleichzeitig (Wetterpunkte je Betrieb: siehe lib/wetter/daten.ts) */
export const BETRIEBE_PARALLEL = 2

/** Quelle des Protokolleintrags des täglichen Crons in system_ereignisse */
export const TAEGLICH_QUELLE = '/api/cron/taeglich'

export const GRUND = {
  zeitbudget: 'Zeitbudget erschöpft',
  deaktiviert: 'Morgenbericht deaktiviert',
  abo: 'Abo gesperrt (Nur-Lesen-Modus)',
  demo: 'Demo-Betrieb: kein tägliches Update',
} as const

/** Bewusste Auslassungen – zählen im Cron-Protokoll nicht als Fehler */
const BEWUSST: ReadonlySet<string> = new Set([GRUND.deaktiviert, GRUND.abo, GRUND.demo])

export type LaufErgebnis = {
  tenant: string
  befunde?: number
  hoch?: number
  dauerMs?: number
  fehler?: string
  uebersprungen?: string
  /** Bericht gespeichert, aber wegen der Zeitgrenze gekürzt (Wetter nicht vollständig, KI ausgelassen) */
  zeitgrenze?: string
}

/** Datum des Berichts in Wiener Zeit (Cron läuft 05:00 UTC = 07:00 MESZ) */
export const berichtDatum = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/** Vortag in Wiener Zeit (Kalenderrechnung, unabhängig von der Sommerzeit) */
export function vortagVon(heute: Date): string {
  const d = new Date(`${berichtDatum(heute)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Faire Reihenfolge ────────────────────────────────────────────────────────

/** Letzter Cron-Bericht je Betrieb (größtes Datum) aus Zeilen { tenant_id, datum } */
export function letzteCronBerichte(zeilen: readonly { tenant_id: string; datum: string }[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const z of zeilen) {
    const d = String(z.datum).slice(0, 10)
    if (!m.has(z.tenant_id) || d > (m.get(z.tenant_id) as string)) m.set(z.tenant_id, d)
  }
  return m
}

/**
 * Betriebe ohne Cron-Bericht zuerst, dann der mit dem ältesten letzten Cron-Bericht,
 * bei Gleichstand nach created_at – wer gestern ausgelassen wurde, kommt heute zuerst dran.
 */
export function fairReihenfolge<T extends { id: string; created_at?: string | null }>(betriebe: readonly T[], letzterCron: ReadonlyMap<string, string>): T[] {
  const angelegt = (b: T) => { const t = b.created_at ? Date.parse(b.created_at) : NaN; return Number.isNaN(t) ? Infinity : t }
  return betriebe.map((b, i) => ({ b, i })).sort((x, y) => {
    const a = letzterCron.get(x.b.id) ?? '', c = letzterCron.get(y.b.id) ?? ''
    if (a !== c) return a < c ? -1 : 1
    const ka = angelegt(x.b), kc = angelegt(y.b)
    if (ka !== kc) return ka < kc ? -1 : 1
    return x.i - y.i
  }).map(x => x.b)
}

// ── Zeitgrenzen ──────────────────────────────────────────────────────────────

/** Grenze für einen Betrieb: höchstens `grenzeMs`, nie über das Laufende; null = nicht mehr beginnen */
export function betriebsDeadline(jetzt: number, laufEnde: number, grenzeMs = BETRIEB_ZEITGRENZE_MS): number | null {
  if (laufEnde - jetzt < BETRIEB_MINDESTZEIT_MS) return null
  return Math.min(jetzt + grenzeMs, laufEnde)
}

/** Grenze für das Auffrischen des Wetters (Reserve für Prüfungen, KI und Speichern) */
export const wetterDeadline = (deadline: number | undefined) => deadline === undefined ? undefined : deadline - WETTER_RESERVE_MS

/** Reicht die Restzeit für einen KI-Aufruf? Ohne Grenze (manueller Bericht) immer. */
export const kiStartErlaubt = (deadline: number | undefined, jetzt = Date.now()) => deadline === undefined || deadline - jetzt >= KI_MINDESTZEIT_MS

export class ZeitgrenzeFehler extends Error {}

/**
 * Wartet höchstens bis `bis` (ms) auf `p`, sonst ZeitgrenzeFehler. `p` läuft im Hintergrund
 * weiter (ein später gespeicherter Bericht schadet nicht), der Lauf kommt aber rechtzeitig
 * zum Protokoll.
 */
export async function mitZeitgrenze<T>(p: Promise<T>, bis: number, meldung = 'Zeitgrenze des Betriebs überschritten – Bericht abgebrochen'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<never>((_, nein) => { timer = setTimeout(() => nein(new ZeitgrenzeFehler(meldung)), Math.max(0, bis - Date.now())) })])
  } finally {
    clearTimeout(timer)
  }
}

// ── Einordnung der Ergebnisse (Cron-Protokoll) ───────────────────────────────

export type ErgebnisArt = 'ok' | 'fehler' | 'zeit' | 'bewusst'

/** fehler = Ausnahme; zeit = aus Zeitmangel übersprungen oder gekürzt; bewusst = deaktiviert, Abo gesperrt, Demo */
export function ergebnisArt(e: Pick<LaufErgebnis, 'fehler' | 'uebersprungen' | 'zeitgrenze'>): ErgebnisArt {
  if (e.fehler) return 'fehler'
  if (e.uebersprungen) return BEWUSST.has(e.uebersprungen) ? 'bewusst' : e.uebersprungen === GRUND.zeitbudget ? 'zeit' : 'fehler'
  return e.zeitgrenze ? 'zeit' : 'ok'
}

/** Zahlen für das Cron-Protokoll; alsFehler = alles außer ok und bewusst */
export function laufBilanz(ergebnis: readonly LaufErgebnis[]) {
  const b = { erstellt: 0, gekuerzt: 0, fehler: 0, zeitUebersprungen: 0, bewusst: 0, alsFehler: 0 }
  for (const e of ergebnis) {
    const art = ergebnisArt(e)
    if (art === 'bewusst') b.bewusst++
    else if (art === 'fehler') b.fehler++
    else if (art === 'zeit' && e.uebersprungen) b.zeitUebersprungen++
    else { b.erstellt++; if (art === 'zeit') b.gekuerzt++ }
  }
  b.alsFehler = b.fehler + b.zeitUebersprungen + b.gekuerzt
  return b
}

// ── Systembericht ────────────────────────────────────────────────────────────

export type VortagBetrieb = { id: string; name: string; createdAt: string | null; aktiv: boolean; morgenberichtAktiv: boolean; aboGesperrt: boolean; demo: boolean }

/**
 * Betriebe ohne JEGLICHE morgenberichte-Zeile am Vortag. Ausgenommen: Demo-Betrieb, inaktive
 * Betriebe, Morgenbericht deaktiviert, Abo gesperrt und Betriebe, die erst am Vortag (oder später)
 * angelegt wurden – der Cron um 07:00 kann vor dem Anlegen gelaufen sein.
 */
export function betriebeOhneVortagsbericht(betriebe: readonly VortagBetrieb[], mitBericht: ReadonlySet<string>, vortag: string): VortagBetrieb[] {
  return betriebe.filter(b => b.aktiv && b.morgenberichtAktiv && !b.aboGesperrt && !b.demo
    && (b.createdAt === null || berichtDatum(new Date(b.createdAt)) < vortag)
    && !mitBericht.has(b.id))
}

/** Cron-Zeitplan laut vercel.json („0 5 * * *“) – ab 05:30 UTC muss das Protokoll von heute da sein */
const CRON_START_UTC = { stunde: 5, minute: 0 }
const CRON_PROTOKOLL_SPAETESTENS_UTC = { stunde: 5, minute: 30 }

/** Beginn des heutigen Cron-Laufs (UTC) – Einträge ab hier gehören zu heute */
export function cronLaufBeginn(jetzt: Date): Date {
  return new Date(Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate(), CRON_START_UTC.stunde, CRON_START_UTC.minute))
}

/** Nach 05:30 UTC noch kein Protokolleintrag des täglichen Crons von heute (Abbruch vor dem Protokoll)? */
export function cronProtokollFehlt(jetzt: Date, letzterEintrag: string | null): boolean {
  const pruefenAb = Date.UTC(jetzt.getUTCFullYear(), jetzt.getUTCMonth(), jetzt.getUTCDate(), CRON_PROTOKOLL_SPAETESTENS_UTC.stunde, CRON_PROTOKOLL_SPAETESTENS_UTC.minute)
  if (jetzt.getTime() < pruefenAb) return false
  return !letzterEintrag || Date.parse(letzterEintrag) < cronLaufBeginn(jetzt).getTime()
}
