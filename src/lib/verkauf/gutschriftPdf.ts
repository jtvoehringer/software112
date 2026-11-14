// Gutschrift als PDF (KAN-453 G3a, 14.11.2026): Inhalt für renderVerkaufRechnungPdf({ gutschrift }) – die eigenen Zeilen der
// Gutschrift (Momentaufnahme gutschrift_positionen, über alsBeleg mit negativer Menge) mit negativen Beträgen, Summen wie
// rechnungSummen(). Titel „Gutschrift“, „Rechnungskorrektur zu Rechnung … vom …“ (KAN-419, Entscheidung 1A) und der Grund
// kommen aus `bezug`; je Zeile „Ware zurückgenommen“, wenn die Menge in den Bestand zurückgebucht wurde (KAN-452).
// Isomorph und ohne @/-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rechnungSummen } from './rechnungDruck.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { alsBeleg, istGutschrift } from './rechnungen.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rundText } from '../zahl/runden.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type GutschriftPdfInhalt = {
  nummer: string
  datumIso: string
  bezug: { zuNummer: string; zuDatumIso: string; grund: string | null }
  positionen: { abschnitt: string | null; name: string; sub: string | null; menge: number; einheit: string;
                preisBrutto: number | null; rabattPct: number; summe: number | null }[]
  gesamt: number
  gesamtNetto: number
  ustGruppen: Record<string, number>
}

/** PDF-Inhalt einer Gutschrift (Zeile aus rechnungen mit STORNO_FELDER) – wirft, wenn es keine Gutschrift ist */
export function gutschriftPdfInhalt(roh: R): GutschriftPdfInhalt {
  if (!istGutschrift(roh)) throw new AktionsFehler('Keine Gutschrift')
  const rechnung = (roh.gutschrift_zu ?? null) as R | null
  if (!rechnung) throw new AktionsFehler('Gutschrift ohne Rechnung')
  const pos = alsBeleg(roh).verkauf_positionen as R[]
  const mehrere = new Set(pos.filter(p => p.lieferscheinnummer).map(p => String(p.lieferscheinnummer))).size > 1
  const positionen = pos.map(p => {
    const preis = p.preis_brutto != null ? Number(p.preis_brutto) : null
    const rabatt = Number(p.rabatt_pct ?? 0)
    const sonder = Number(p.sonderrabatt_pct ?? 0)
    const sub = [p.typ === 'tank' ? 'Tankverkauf' : null, p.ruecknahme === true ? 'Ware zurückgenommen' : null].filter(Boolean).join(' · ')
    return {
      // die Momentaufnahme der Gutschrift kennt kein Lieferdatum; freie Zeilen (Preisnachlass) haben keinen Lieferschein
      abschnitt: mehrere ? (p.lieferscheinnummer ? `Lieferschein ${p.lieferscheinnummer}` : 'Ohne Lieferschein') : null,
      name: String(p.name ?? ''),
      sub: sub || null,
      menge: Number(p.menge) || 0,
      einheit: String(p.einheit ?? ''),
      preisBrutto: preis,
      rabattPct: rabatt + sonder,
      summe: preis != null ? preis * (Number(p.menge) || 0) * (1 - rabatt / 100) * (1 - sonder / 100) : null,
    }
  })
  const s = rechnungSummen(pos)
  const ustGruppen: Record<string, number> = {}
  for (const u of s.ust) ustGruppen[String(u.satz)] = u.netto
  return {
    nummer: String(roh.rechnungsnummer ?? ''),
    datumIso: String(roh.datum ?? ''),
    bezug: { zuNummer: String(rechnung.rechnungsnummer ?? ''), zuDatumIso: String(rechnung.datum ?? ''), grund: (roh.notizen ?? null) as string | null },
    positionen,
    gesamt: s.brutto,
    gesamtNetto: s.netto,
    ustGruppen,
  }
}

/** Betreff der CRM-Aktivität beim Ausstellen: „Gutschrift GS-2026-0001 · −20,00 € zu Rechnung RE-2026-0007“ */
export function gutschriftAktivitaetBetreff(nummer: string, bruttoPositiv: number, rechnungsnummer: string | null): string {
  const betrag = `−${rundText(bruttoPositiv, 2).replace('.', ',')} €`
  return [`Gutschrift ${nummer}`.trim(), betrag].join(' · ') + (rechnungsnummer ? ` zu Rechnung ${rechnungsnummer}` : '')
}
