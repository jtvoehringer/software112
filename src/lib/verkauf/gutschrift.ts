// ── Gutschrift zur Rechnung (KAN-419 G1, 13.11.2026) ───────────────────────────────────────────────────────────────
//
// Eine Gutschrift berichtigt eine Rechnung teilweise: einzelne Positionen bzw. Mengen und/oder ein freier Betrag
// (Preisnachlass, Bonus). Sie ist ein eigener Beleg (rechnungen.art = 'gutschrift', Nummer GS-JJJJ-NNNN) mit eigenen
// Positionen als Momentaufnahme (gutschrift_positionen: Mengen und Preise positiv – die Leser rechnen negativ, alsBeleg()).
//
// Entscheidungen Jörgen (Jira KAN-419, 11.11. und 13.11.2026, Fragen 1–7 jeweils A): je Position höchstens die Restmenge,
// alle Gutschriften zusammen höchstens der Rechnungsbetrag; freier Betrag anteilig auf die Steuersätze der Rechnung;
// Datum wie beim Storno; Grund mindestens 10 Zeichen; eine Rechnung mit Gutschrift lässt sich nicht mehr voll stornieren.
// Dieselben Regeln wie die RPC s112_gutschrift_anlegen – dort wird endgültig geprüft, Preise kommen nie aus dem Aufruf.
// Isomorph, relative Importe mit .ts-Endung (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund, rund2, rundText } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { positionBrutto } from './rechnungen.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { stornoDatumFehler } from '../storno/datum.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const GUTSCHRIFT_GRUND_MIN = 10
export const GUTSCHRIFT_GRUND_MAX = 300
export const GUTSCHRIFT_TEXT_MAX = 120
/** Steuersatz, wenn die Position keinen hat (wie die Datenbank und die UVA) */
const UST_STANDARD = 13

/** Zeilen einer Gutschrift (Momentaufnahme); fehlt die Spalte, leer */
export function gutschriftZeilen(g: R): R[] {
  return Array.isArray(g.gutschrift_positionen) ? (g.gutschrift_positionen as R[]) : []
}

/** Bruttobetrag einer Gutschrift, positiv (Summe der gerundeten Zeilen – wie s112_gutschrift_summe) */
export function gutschriftBrutto(g: R): number {
  return rund2(gutschriftZeilen(g).reduce((s, z) => s + positionBrutto(z), 0))
}

/** Summe mehrerer Gutschriften, brutto und positiv; inaktive zählen nicht */
export function gutschriftSumme(gutschriften: readonly R[]): number {
  return rund2(gutschriften.filter(g => g.aktiv !== false).reduce((s, g) => s + gutschriftBrutto(g), 0))
}

/** Bereits gutgeschriebene Menge je Position der Rechnung (Schlüssel: Positions-ID) */
export function bereitsGutgeschrieben(gutschriften: readonly R[]): Map<string, number> {
  const aus = new Map<string, number>()
  for (const g of gutschriften) {
    if (g.aktiv === false) continue
    for (const z of gutschriftZeilen(g)) {
      if (!z.position_id) continue
      const k = String(z.position_id)
      aus.set(k, (aus.get(k) ?? 0) + (Number(z.menge) || 0))
    }
  }
  return aus
}

/** Noch gutschreibbare Menge einer Position (nie unter 0) */
export function restMenge(position: R, bisher: ReadonlyMap<string, number>): number {
  return Math.max(0, rund((Number(position.menge) || 0) - (bisher.get(String(position.id)) ?? 0), 4))
}

/**
 * Freien Bruttobetrag anteilig auf die Steuersätze der Rechnung verteilen (nach dem Bruttobetrag je Satz). Der
 * Rundungsrest geht auf den größten Anteil – dieselbe Reihenfolge wie die Datenbank (aufsteigend nach Betrag, dann Satz).
 */
export function betragAufteilen(betrag: number, positionen: readonly R[]): { ustSatz: number; anteil: number }[] {
  const jeSatz = new Map<number, number>()
  for (const p of positionen) {
    const satz = p.ust_satz === null || p.ust_satz === undefined || p.ust_satz === '' ? UST_STANDARD : Number(p.ust_satz)
    jeSatz.set(satz, rund2((jeSatz.get(satz) ?? 0) + positionBrutto(p)))
  }
  const saetze = [...jeSatz.entries()].filter(([, brutto]) => brutto > 0).sort((a, b) => a[1] - b[1] || a[0] - b[0])
  const gesamt = rund2(positionen.reduce((s, p) => s + positionBrutto(p), 0))
  if (!(betrag > 0) || gesamt <= 0 || saetze.length === 0) return []
  let rest = rund2(betrag)
  const aus: { ustSatz: number; anteil: number }[] = []
  saetze.forEach(([ustSatz, brutto], i) => {
    const anteil = i === saetze.length - 1 ? rest : rund2((betrag * brutto) / gesamt)
    rest = rund2(rest - anteil)
    if (anteil > 0) aus.push({ ustSatz, anteil })
  })
  return aus
}

export type GutschriftEingabe = {
  datum: unknown
  grund: unknown
  /** gewählte Positionen mit Menge (0 bzw. leer = nicht gewählt) */
  positionen: readonly { position_id: string; menge: number }[]
  /** freier Bruttobetrag (0 = keiner) */
  betrag: number
  betragText?: unknown
}

export type GutschriftRahmen = {
  rechnungDatum: string | null
  heute: string
  /** Positionen der Rechnung (id, name, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz) */
  positionen: readonly R[]
  /** bisherige Gutschriften der Rechnung */
  gutschriften: readonly R[]
}

/** Betrag der neuen Gutschrift (brutto, positiv) aus gewählten Positionen und freiem Betrag */
export function neueGutschriftBrutto(e: Pick<GutschriftEingabe, 'positionen' | 'betrag'>, positionen: readonly R[]): number {
  const jeId = new Map(positionen.map(p => [String(p.id), p]))
  const ausPositionen = e.positionen.reduce((s, z) => {
    const p = jeId.get(String(z.position_id))
    return p ? s + positionBrutto({ ...p, menge: z.menge }) : s
  }, 0)
  return rund2(ausPositionen + (e.betrag > 0 ? e.betrag : 0))
}

/** Noch gutschreibbarer Betrag der Rechnung (brutto, nie unter 0) */
export function restBetrag(positionen: readonly R[], gutschriften: readonly R[]): number {
  return Math.max(0, rund2(positionen.reduce((s, p) => s + positionBrutto(p), 0) - gutschriftSumme(gutschriften)))
}

/** Eingabeprüfung wie die Datenbank; `feld` sagt, wo die Meldung hingehört. null = in Ordnung */
export function gutschriftEingabeFehler(e: GutschriftEingabe, r: GutschriftRahmen): { feld: 'datum' | 'grund' | 'positionen' | 'betrag'; text: string } | null {
  const datumFehler = stornoDatumFehler(e.datum, { ab: r.rechnungDatum, heute: r.heute })
  if (datumFehler) return { feld: 'datum', text: datumFehler.replace(/Storno-Datum/g, 'Datum der Gutschrift').replace('Belegdatum', 'Rechnungsdatum') }
  const grund = typeof e.grund === 'string' ? e.grund.trim() : ''
  if (grund.length < GUTSCHRIFT_GRUND_MIN) return { feld: 'grund', text: `Bitte einen Grund für die Gutschrift angeben (mindestens ${GUTSCHRIFT_GRUND_MIN} Zeichen).` }
  if (grund.length > GUTSCHRIFT_GRUND_MAX) return { feld: 'grund', text: `Der Grund darf höchstens ${GUTSCHRIFT_GRUND_MAX} Zeichen lang sein.` }
  if (typeof e.betragText === 'string' && e.betragText.trim().length > GUTSCHRIFT_TEXT_MAX) return { feld: 'betrag', text: `Die Bezeichnung des Betrags darf höchstens ${GUTSCHRIFT_TEXT_MAX} Zeichen lang sein.` }
  if (!Number.isFinite(e.betrag) || e.betrag < 0) return { feld: 'betrag', text: 'Der Betrag der Gutschrift ist ungültig.' }
  if (e.positionen.length === 0 && !(e.betrag > 0)) return { feld: 'positionen', text: 'Bitte mindestens eine Position oder einen Betrag angeben.' }

  const jeId = new Map(r.positionen.map(p => [String(p.id), p]))
  const bisher = bereitsGutgeschrieben(r.gutschriften)
  const gesehen = new Set<string>()
  for (const z of e.positionen) {
    const p = jeId.get(String(z.position_id))
    if (!p) return { feld: 'positionen', text: 'Eine Position gehört nicht zu dieser Rechnung.' }
    if (gesehen.has(String(z.position_id))) return { feld: 'positionen', text: 'Eine Position ist doppelt angegeben.' }
    gesehen.add(String(z.position_id))
    if (!Number.isFinite(z.menge) || z.menge <= 0) return { feld: 'positionen', text: `Position „${p.name ?? ''}“: Die Menge muss größer als 0 sein.` }
    const rest = restMenge(p, bisher)
    if (z.menge > rest) return { feld: 'positionen', text: `Position „${p.name ?? ''}“: höchstens ${String(rest).replace('.', ',')} gutschreibbar.` }
  }
  const neu = neueGutschriftBrutto(e, r.positionen)
  if (neu <= 0) return { feld: 'positionen', text: 'Die Gutschrift hat keinen Betrag.' }
  const rest = restBetrag(r.positionen, r.gutschriften)
  if (neu > rest) return { feld: e.betrag > 0 ? 'betrag' : 'positionen', text: `Die Gutschrift (${rundText(neu, 2).replace('.', ',')} €) übersteigt den noch gutschreibbaren Betrag (${rundText(rest, 2).replace('.', ',')} €).` }
  return null
}
