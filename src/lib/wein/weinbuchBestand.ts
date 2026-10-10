// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { zahlLokal } from '../format.ts'
// ── Weinbuch: Mengenbewegungen aus dem Bewegungsjournal (KAN-44 Teil 3, 08.10.2026) ──────────────────────────────
//
// Bis KAN-44 kannte die Zeitleiste des Weinbuchs (lib/wein/weinbuch.ts) nur Pressung, Umzug, Schwund, Verschnitt und
// Füllung – Zukauf, Fassverkauf, Eröffnungsbestand, Bestandskorrekturen, Verarbeitung, Produktion und Lohnversektung
// fehlten. Damit gab es zwei widersprüchliche „Kellerbücher“: das Bewegungsjournal (kellerbuch_buchungen, BKI-Blätter,
// BSM) und das Weinbuch der Charge. Jetzt:
//   - Ab dem Journalbeginn (tenant_einstellungen.journal_ab) kommen alle Mengenbewegungen der Charge, die das Weinbuch
//     nicht schon aus den eigenen Tabellen zeigt, aus dem Journal – mit Vorzeichen, Partner und „Bestand danach“ (Saldo
//     aller Journalzeilen der Charge bis einschließlich dieser Buchung). Neue Buchungsarten erscheinen damit
//     automatisch. Storno = Gegenbuchung im Journal → Eintrag „Storno: …“, die Buchung selbst bekommt „storniert“.
//   - Abgedeckt bleiben (eigene, ausführlichere Einträge): Umzug/Filtration/Schwund (keller_umzuege), Lese/Pressung
//     (pressung_behaelter), Verschnitt (verschneidung_quellen), Füllung (fuellungen, Buchungsart FUELLUNG) und die
//     Merkmalsänderung, wenn am selben Tag eine Abstufung (charge_umstufungen) steht.
//   - Vor dem Journalbeginn bzw. ohne Journal (Betrieb hat es nicht eröffnet) bilden Zukauf, Fassverkauf und
//     Eröffnungsbestand aus den Bewegungstabellen dieselben Einträge (ohne Saldo) – die Zeitleiste ist damit in beiden
//     Fällen vollständig.
//   - Abweicht der Journal-Saldo vom Bestand der Charge, steht das als Hinweis im Weinbuch (Abgleich: Kellerbuch ›
//     Journal; der tägliche Abgleich bucht direkte Mengenänderungen als Inventurdifferenz).
// Isomorph und ohne '@/'-Importe (node:test).

export type WeinbuchMengenTyp = 'eroeffnung' | 'zukauf' | 'verkauf' | 'bestand'

export type WeinbuchMengenEreignis = {
  datum: string
  typ: WeinbuchMengenTyp
  titel: string
  details: string[]
  badge?: string
}

/** Journalzeile, wie das Weinbuch sie braucht (Teilmenge von JournalBuchung) */
export type WbJournalZeile = {
  id: string
  beleg_nr: number
  pos: number
  datum: string
  buchungsart_code: string
  menge_liter: number
  partner_name: string | null
  partner_land: string | null
  quelle_tabelle: string
  storno_von_id: string | null
  rekonstruiert: boolean
  hinweis: string | null
}

export const WB_JOURNAL_SPALTEN = 'id, beleg_nr, pos, datum, buchungsart_code, menge_liter, partner_name, partner_land, quelle_tabelle, storno_von_id, rekonstruiert, hinweis'

/** Bezeichnungen der Buchungsarten (kat_buchungsart) – Rückfall, falls der Katalog nicht geladen werden kann */
export const BUCHUNGSART_TEXT: Record<string, string> = {
  ERNTE: 'Eigene Ernte', ZK_FASS: 'Zukauf Fasswein', ZK_TRAUB: 'Zukauf Trauben', ZK_MAISC: 'Zukauf Maische', ZK_MOST: 'Zukauf Most',
  ZK_FLA: 'Zukauf Flaschen', ZU_ABW: 'Zugang Abwertung', ZU_BEH: 'Zugang durch Behandlung', AB_ABW: 'Abgang Abwertung',
  VK_FA_AT: 'Fassverkauf in Österreich', VK_FA_AU: 'Fassverkauf ins Ausland', AB_VERAR: 'Abgang durch Verarbeitung',
  SCHWUND: 'Eigenverbrauch / Schwund', VS_ZU: 'Verschnitt Zugang', VS_AB: 'Verschnitt Abgang', EROEFF: 'Eröffnungsbestand',
  UMZUG: 'Umzug', FILTRAT: 'Filtration', FUELLUNG: 'Füllung', INV_PLUS: 'Inventurdifferenz Mehrmenge',
  INV_MIN: 'Inventurdifferenz Mindermenge', ZU_PROD: 'Zugang durch Produktion', LNSKT: 'Abgang zur Lohnversektung',
  LNSKT_ZU: 'Zugang aus Lohnversektung',
}

/** Quellen, die das Weinbuch selbst (ausführlicher) zeigt */
const ABGEDECKT_QUELLEN = new Set(['keller_umzuege', 'pressung_behaelter', 'verschneidung_quellen'])

/** Steht die Journalzeile schon über einen eigenen Weinbuch-Eintrag in der Zeitleiste? */
export function journalZeileAbgedeckt(z: Pick<WbJournalZeile, 'quelle_tabelle' | 'buchungsart_code' | 'datum'>, abstufungTage: ReadonlySet<string>): boolean {
  if (ABGEDECKT_QUELLEN.has(z.quelle_tabelle)) return true
  if (z.quelle_tabelle === 'fuellungen' && z.buchungsart_code === 'FUELLUNG') return true
  if (z.quelle_tabelle === 'weinausbau_merkmale' && abstufungTage.has(z.datum.slice(0, 10))) return true
  return false
}

export function mengenTyp(code: string, quelle: string): WeinbuchMengenTyp {
  if (code === 'EROEFF') return 'eroeffnung'
  if (code.startsWith('ZK_')) return 'zukauf'
  if (code.startsWith('VK_')) return 'verkauf'
  return quelle === 'zukauf_posten' ? 'zukauf' : 'bestand'
}

const runde = (n: number) => rund(n, 3)

/** Liter mit Vorzeichen, österreichisch formatiert („+1.200 L“, „−35,5 L“) */
export function literMitVorzeichen(l: number): string {
  const r = runde(l)
  const betrag = zahlLokal(Math.abs(r), { maximumFractionDigits: 3 })
  return `${r > 0 ? '+' : r < 0 ? '−' : '±'}${betrag} L`
}

export function liter(l: number): string {
  return `${zahlLokal(runde(l), { maximumFractionDigits: 3 })} L`
}

/** Journalzeilen in Buchungsreihenfolge (Datum, Beleg, Position) */
export function journalSortiert<T extends Pick<WbJournalZeile, 'datum' | 'beleg_nr' | 'pos'>>(zeilen: readonly T[]): T[] {
  return [...zeilen].sort((a, b) => a.datum.slice(0, 10).localeCompare(b.datum.slice(0, 10)) || a.beleg_nr - b.beleg_nr || a.pos - b.pos)
}

/** Saldo aller Journalzeilen (Liter) */
export function journalSaldo(zeilen: readonly Pick<WbJournalZeile, 'menge_liter'>[]): number {
  return runde(zeilen.reduce((s, z) => s + (Number(z.menge_liter) || 0), 0))
}

/**
 * Weinbuch-Einträge aus dem Journal der Charge: nur nicht abgedeckte Zeilen, jede mit Saldo danach.
 * text: Bezeichnung je Buchungsart (Katalog), sonst BUCHUNGSART_TEXT.
 */
export function journalEreignisse(
  zeilen: readonly WbJournalZeile[],
  o: { abstufungTage: ReadonlySet<string>; journalBeginn: string | null; text?: Record<string, string> },
): WeinbuchMengenEreignis[] {
  const bez = (code: string) => o.text?.[code] ?? BUCHUNGSART_TEXT[code] ?? code
  const storniert = new Set(zeilen.map(z => z.storno_von_id).filter((x): x is string => !!x))
  const ereignisse: WeinbuchMengenEreignis[] = []
  let saldo = 0
  for (const z of journalSortiert(zeilen)) {
    saldo = runde(saldo + (Number(z.menge_liter) || 0))
    if (journalZeileAbgedeckt(z, o.abstufungTage)) continue
    const datum = z.datum.slice(0, 10)
    const uebertrag = z.quelle_tabelle === 'journal_eroeffnen'
    const titel = uebertrag
      ? 'Übertrag bei Eröffnung des Bewegungsjournals'
      : z.storno_von_id ? `Storno: ${bez(z.buchungsart_code)}` : bez(z.buchungsart_code)
    const partner = z.partner_name ? `${Number(z.menge_liter) < 0 ? 'an' : 'von'} ${z.partner_name}${z.partner_land && z.partner_land !== 'AT' ? ` (${z.partner_land})` : ''}` : null
    ereignisse.push({
      datum,
      typ: mengenTyp(z.buchungsart_code, z.quelle_tabelle),
      titel,
      badge: z.storno_von_id ? 'Storno' : storniert.has(z.id) ? 'storniert' : undefined,
      details: [
        `Menge: ${literMitVorzeichen(Number(z.menge_liter) || 0)}`,
        partner,
        z.hinweis,
        z.rekonstruiert ? 'Nachträglich aus den Bewegungen rekonstruiert' : null,
        `Bestand danach (Bewegungsjournal): ${liter(saldo)}`,
        uebertrag && o.journalBeginn ? `Bestand am Journalbeginn ${o.journalBeginn.split('-').reverse().join('.')}` : null,
      ].filter((x): x is string => !!x),
    })
  }
  return ereignisse
}

/** Hinweis bei abweichendem Journal-Saldo (null = stimmt, ±0,5 L Toleranz wie das Ende der Charge) */
export function journalAbweichungHinweis(saldo: number, bestand: number): string | null {
  if (Math.abs(runde(saldo - bestand)) <= 0.5) return null
  return `Bestand laut Bewegungsjournal (${liter(saldo)}) weicht vom Bestand der Charge (${liter(bestand)}) ab – `
    + 'bitte unter Kellerbuch › Journal prüfen; der tägliche Abgleich bucht direkte Mengenänderungen als Inventurdifferenz.'
}

/** Liegt ein Tag vor dem Journalbeginn (bzw. gibt es kein Journal)? Dann zeigt das Weinbuch die Bewegung aus der Tabelle. */
export function vorJournal(datum: string | null | undefined, journalBeginn: string | null): boolean {
  if (!datum) return false
  return !journalBeginn || datum.slice(0, 10) < journalBeginn
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ZUKAUF_TEXT: Record<string, string> = { wein: 'Zukauf Fasswein', most: 'Zukauf Most', maische: 'Zukauf Maische', trauben: 'Zukauf Trauben', flaschen: 'Zukauf Flaschen' }

const partnerName = (firma: R | null | undefined, kontakt: R | null | undefined): string | null =>
  (typeof firma?.name === 'string' && firma.name.trim()) || [kontakt?.vorname, kontakt?.nachname].filter(Boolean).join(' ').trim() || null

/** Zukauf in die Charge vor dem Journal (zukauf_posten mit ziel_weinausbau_id = Charge); Storno kennzeichnet der Aufrufer */
export function zukaufEreignis(z: R): WeinbuchMengenEreignis | null {
  const datum = typeof z.datum === 'string' ? z.datum.slice(0, 10) : null
  if (!datum || (z.aktiv === false && !z.storniert_am)) return null   // vor KAN-145 gelöscht
  const name = partnerName(z.lieferant_firma, z.lieferant_kontakt)
  const menge = z.menge != null ? Number(z.menge) : null
  return {
    datum, typ: 'zukauf', titel: ZUKAUF_TEXT[z.art] ?? 'Zukauf',
    details: [
      menge != null && Number.isFinite(menge) ? `Menge: +${zahlLokal(menge, { maximumFractionDigits: 3 })} ${z.einheit ?? 'l'}` : null,
      name ? `von ${name}` : null,
      [z.rebsorte, z.jahrgang].filter(Boolean).join(' ') || null,
    ].filter((x): x is string => !!x),
  }
}

/** Fassverkauf aus der Charge vor dem Journal (verkauf_positionen typ tank mit weinausbau_id = Charge); Storno kennzeichnet der Aufrufer */
export function fassverkaufEreignis(p: R): WeinbuchMengenEreignis | null {
  const vp = (p.verkaufsposten ?? null) as R | null
  const datum = typeof vp?.datum === 'string' ? vp.datum.slice(0, 10) : null
  if (!datum || (vp?.aktiv === false && !vp?.storniert_am)) return null
  const menge = Number(p.menge) || 0
  const name = partnerName(vp?.firma, vp?.kontakt)
  return {
    datum, typ: 'verkauf', titel: 'Fassverkauf',
    badge: vp?.storniert && !vp?.storniert_am ? 'storniert' : undefined,   // Storno vor KAN-145 (ohne Zeitpunkt)
    details: [
      `Menge: ${literMitVorzeichen(-menge)}`,
      name ? `an ${name}` : null,
      vp?.rechnungsnummer ? `Rechnung ${vp.rechnungsnummer}` : null,
    ].filter((x): x is string => !!x),
  }
}

/** Eröffnungsbestand der Charge (Übernahme aus dem Altsystem) vor dem Journal */
export function eroeffnungEreignis(wa: R): WeinbuchMengenEreignis | null {
  if (!wa.ist_eroeffnungsbestand) return null
  const datum = typeof wa.created_at === 'string' ? wa.created_at.slice(0, 10) : null
  const l = Number(wa.anfangsbestand_liter ?? wa.menge_liter ?? 0)
  if (!datum || !(l > 0)) return null
  return {
    datum, typ: 'eroeffnung', titel: 'Eröffnungsbestand',
    details: [`Menge: ${literMitVorzeichen(l)}`, 'Übernahme aus dem Altsystem'],
  }
}
