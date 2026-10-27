// Stornobeleg als PDF (KAN-379, 27.10.2026): Inhalt für renderVerkaufRechnungPdf – Positionen des Originals (Momentaufnahme
// storno_positionen, über alsBeleg mit negativer Menge) mit negativen Beträgen, Summen wie rechnungSummen(), je Lieferschein
// eine Zwischenzeile, wenn das Original mehrere Lieferscheine umfasste. Titel „Stornorechnung“, „zu Rechnung … vom …“ und
// der Grund kommen aus `storno`. Isomorph und ohne @/-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rechnungSummen } from './rechnungDruck.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { alsBeleg, istStornobeleg } from './rechnungen.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type StornobelegPdfInhalt = {
  nummer: string
  datumIso: string
  storno: { zuNummer: string; zuDatumIso: string; grund: string | null }
  positionen: { abschnitt: string | null; name: string; sub: string | null; menge: number; einheit: string;
                preisBrutto: number | null; rabattPct: number; summe: number | null }[]
  gesamt: number
  gesamtNetto: number
  ustGruppen: Record<string, number>
}

function datumDe(d: unknown): string {
  const [j, m, t] = String(d ?? '').slice(0, 10).split('-')
  return j && m && t ? `${t}.${m}.${j}` : ''
}

/** PDF-Inhalt eines Stornobelegs (Zeile aus rechnungen mit STORNO_FELDER) – wirft, wenn es kein Stornobeleg ist */
export function stornobelegPdfInhalt(roh: R): StornobelegPdfInhalt {
  if (!istStornobeleg(roh)) throw new AktionsFehler('Kein Stornobeleg')
  const original = (roh.storno_von ?? null) as R | null
  if (!original) throw new AktionsFehler('Stornobeleg ohne Rechnung')
  const b = alsBeleg(roh)
  const pos = b.verkauf_positionen as R[]
  const mehrere = new Set(pos.map(p => String(p.lieferscheinnummer ?? ''))).size > 1
  const positionen = pos.map(p => {
    const preis = p.preis_brutto != null ? Number(p.preis_brutto) : null
    const rabatt = Number(p.rabatt_pct ?? 0)
    const sonder = Number(p.sonderrabatt_pct ?? 0)
    return {
      abschnitt: mehrere && p.lieferscheinnummer ? `Lieferschein ${p.lieferscheinnummer} vom ${datumDe(p.lieferdatum)}` : null,
      name: String(p.name ?? ''),
      sub: p.typ === 'tank' ? 'Tankverkauf' : null,
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
    storno: { zuNummer: String(original.rechnungsnummer ?? ''), zuDatumIso: String(original.datum ?? ''), grund: (roh.notizen ?? null) as string | null },
    positionen,
    gesamt: s.brutto,
    gesamtNetto: s.netto,
    ustGruppen,
  }
}
