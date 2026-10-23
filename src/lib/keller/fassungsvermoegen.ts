// ── Fassungsvermögen eines Gebindes (KAN-381, Entscheidung Jörgen 23.10.2026) ─────────────────────────────────
// Ein Gebinde darf nicht überfüllt werden, sofern sein Fassungsvermögen (behaelter.volumen_liter > 0) hinterlegt ist;
// unbekannt → keine Sperre, nur ein Hinweis. Toleranz 0,5 l (wie Kellerplan-Ziehen, KAN-114). Freier Platz =
// Fassungsvermögen − Inhalt aller aktiven Chargen im Gebinde – auch der Chargen eines anderen Betriebs der
// Kellergemeinschaft (lade_behaelter: eigen_liter + fremd_liter).
//
// Gesperrt wird nur ein Zugang, der den Inhalt erhöht: eine bestehende Überfüllung (Bestandsaufnahme 23.10.2026:
// Musterhof „Barrique 3“, „Immervolltank 09“) blockiert weder Minderung noch Umbenennung einer Charge darin.
// Dieselbe Regel setzt die Datenbank durch (Trigger s112_fassungsvermoegen auf weinausbau, Entwurf
// supabase/entwurf/kan381_fassungsvermoegen.sql) – die App prüft VOR der ersten Buchung, weil manche Wege (Umzug)
// in mehreren Anfragen buchen und sonst die Quelle schon gemindert wäre.
//
// Formulare und Server Actions aller Zugangswege nutzen diese Datei (Umzug, Kellerplan, Verschnitt, Zukauf, Pressung,
// Produktion, Zugangskorrektur, Eröffnungsbestand, Charge bearbeiten). Isomorph (node:test) – ohne '@/'-Importe.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { zahlLokal } from '../format.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { ladeBehaelter } from './behaelter.ts'

/** Toleranz in Litern, um die ein Gebinde über sein Fassungsvermögen gefüllt werden darf (Messungenauigkeit) */
export const FASSUNG_TOLERANZ_LITER = 0.5

/** Gebinde mit Fassungsvermögen (null/0 = unbekannt) und aktuellem Inhalt aller aktiven Chargen (eigen + fremd) */
export type FassungGebinde = {
  id?: string
  name: string
  volumen_liter: number | string | null | undefined
  inhalt: number
}

/** Zugang in ein Gebinde: `zugang` Liter hinein, `abgang` Liter im selben Vorgang aus demselben Gebinde heraus */
export type FassungZugang = { behaelterId: string; zugang: number; abgang?: number }

const zahl = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const liter = (n: number) => `${zahlLokal(n, { maximumFractionDigits: 2 })} l`

/** Fassungsvermögen in Litern; null = nicht hinterlegt (keine Sperre) */
export function fassungsvermoegen(g: Pick<FassungGebinde, 'volumen_liter'> | null | undefined): number | null {
  const vol = zahl(g?.volumen_liter)
  return vol > 0 ? vol : null
}

/** Freier Platz in Litern (nie negativ); null = Fassungsvermögen unbekannt */
export function freiLiter(g: FassungGebinde | null | undefined): number | null {
  const vol = fassungsvermoegen(g)
  if (vol == null || !g) return null
  return Math.max(0, vol - zahl(g.inhalt))
}

/**
 * Passt der Zugang ins Gebinde? null = ja (oder Fassungsvermögen unbekannt, oder der Inhalt steigt nicht);
 * sonst die Meldung „Die Charge (X l) passt nicht in „<Gebinde>“ (Fassungsvermögen Y l, frei Z l).“
 */
export function fassungsFehler(g: FassungGebinde | null | undefined, zugang: number, opts: { abgang?: number } = {}): string | null {
  const vol = fassungsvermoegen(g)
  if (vol == null || !g) return null
  const zu = zahl(zugang)
  const ab = zahl(opts.abgang)
  if (!(zu - ab > 0)) return null   // keine Erhöhung – eine bestehende Überfüllung sperrt nicht
  const vorher = zahl(g.inhalt) - ab
  if (vorher + zu <= vol + FASSUNG_TOLERANZ_LITER) return null
  return `Die Charge (${liter(zu)}) passt nicht in „${g.name}“ (Fassungsvermögen ${liter(vol)}, frei ${liter(Math.max(0, vol - vorher))}).`
}

/** Hinweis (keine Sperre), wenn das Fassungsvermögen des Gebindes nicht hinterlegt ist */
export function fassungsHinweis(g: Pick<FassungGebinde, 'name' | 'volumen_liter'> | null | undefined): string | null {
  if (!g || fassungsvermoegen(g) != null) return null
  return `Das Fassungsvermögen von „${g.name}“ ist nicht hinterlegt – die Menge wird nicht gegen das Gebinde geprüft.`
}

/**
 * Mehrere Zugänge eines Vorgangs (z. B. n:m-Umzug, mehrere Mostzeilen): je Gebinde summiert geprüft. Unbekannte Gebinde
 * (nicht in `gebinde`) prüft diese Regel nicht – das melden die Gebinde-Prüfungen des Aufrufers. null = alles passt.
 */
export function fassungsFehlerListe(
  gebinde: ReadonlyMap<string, FassungGebinde>,
  zugaenge: readonly FassungZugang[],
): string | null {
  const jeGebinde = new Map<string, { zugang: number; abgang: number }>()
  for (const z of zugaenge) {
    if (!z.behaelterId) continue
    const b = jeGebinde.get(z.behaelterId) ?? { zugang: 0, abgang: 0 }
    jeGebinde.set(z.behaelterId, { zugang: b.zugang + zahl(z.zugang), abgang: b.abgang + zahl(z.abgang) })
  }
  for (const [id, { zugang, abgang }] of jeGebinde) {
    const f = fassungsFehler(gebinde.get(id), zugang, { abgang })
    if (f) return f
  }
  return null
}

type GebindeZeile = { id: string; name: string; volumen_liter: number | null; eigen_liter: number; fremd_liter: number }

/** Gebindeliste (lade_behaelter) → Fassungen je id; Inhalt = eigene + fremde aktive Chargen */
export function fassungenAus(zeilen: readonly GebindeZeile[]): Map<string, FassungGebinde> {
  return new Map(zeilen.map(b => [b.id, { id: b.id, name: b.name, volumen_liter: b.volumen_liter, inhalt: zahl(b.eigen_liter) + zahl(b.fremd_liter) }]))
}

/** Server: Fassungen aller eigenen und freigegebenen Gebinde (lade_behaelter, wirft AktionsFehler bei Lesefehler) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeFassungen(client: any, tenantId: string): Promise<Map<string, FassungGebinde>> {
  return fassungenAus(await ladeBehaelter(client, tenantId))
}

/** Server: Zugänge gegen den aktuellen Inhalt prüfen – null = passt, sonst die Meldung (vor der ersten Buchung aufrufen) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function pruefeFassung(client: any, tenantId: string, zugaenge: readonly FassungZugang[]): Promise<string | null> {
  if (!zugaenge.some(z => z.behaelterId && zahl(z.zugang) > 0)) return null
  return fassungsFehlerListe(await ladeFassungen(client, tenantId), zugaenge)
}
