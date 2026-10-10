// ── BKI-Schnittstelle: Katalogblätter „Qualitätsstufen“, „Erzeugnisse“, „Buchungsarten“ (KAN-50, 10.10.2026) ──
//
// Die Spezifikation listet je Katalog die Bezeichnungen und lässt die Spalte „kürzel aus dem kellerbuch zum
// konvertieren / matchen“ offen – die Kürzel wählt software:112 selbst (Entscheidung KAN-38 E2). Quelle sind die
// Kataloge in src/lib/katalog/bki.ts (Spiegel der Tabellen kat_*); vorläufige Kürzel sind gekennzeichnet.

import type { CsvSpalte } from '@/lib/csv'
import { KAT_BUCHUNGSART, KAT_ERZEUGNIS, KAT_QUALITAETSSTUFE } from '@/lib/katalog/bki'

export type KatalogZeile = { bezeichnung: string; kuerzel: string; vorlaeufig: boolean; hinweis: string | null }

export const SPALTEN_BKI_KATALOG: CsvSpalte<KatalogZeile>[] = [
  { kopf: 'Bezeichnung', typ: 'text', wert: z => z.bezeichnung },
  { kopf: 'Kürzel', typ: 'code', wert: z => z.kuerzel },
  { kopf: 'Kürzel vorläufig', typ: 'janein', wert: z => z.vorlaeufig },
  { kopf: 'Hinweis', typ: 'text', wert: z => z.hinweis },
]

const VORLAEUFIG = 'Kürzel vorläufig – die BKI kennt (noch) keine Liste (KAN-38).'

export function qualitaetsstufenZeilen(): KatalogZeile[] {
  return KAT_QUALITAETSSTUFE.map(q => ({ bezeichnung: q.bezeichnung, kuerzel: q.code, vorlaeufig: q.vorlaeufig, hinweis: q.vorlaeufig ? 'eigener Vorschlag, nicht in der BKI-Kürzelliste' : null }))
}

export function erzeugnisZeilen(): KatalogZeile[] {
  return KAT_ERZEUGNIS.map(e => ({ bezeichnung: e.bezeichnung, kuerzel: e.code, vorlaeufig: true, hinweis: e.bsmRelevant ? null : 'nicht bestandsmeldepflichtig' }))
}

/** Nur die Buchungsarten der Bestandsmeldung (BSM) – interne, BSM-neutrale Vorgänge gehören nicht ins Blatt */
export function buchungsartZeilen(): KatalogZeile[] {
  return KAT_BUCHUNGSART.filter(b => b.bsm).map(b => ({
    bezeichnung: b.bezeichnung, kuerzel: b.code, vorlaeufig: true,
    hinweis: `${b.richtung === 'zu' ? 'Zugang' : b.richtung === 'ab' ? 'Abgang' : 'neutral'} in ${b.einheit === 'stk' ? 'Stück' : b.einheit}`,
  }))
}

export const KATALOG_HINWEIS = VORLAEUFIG
