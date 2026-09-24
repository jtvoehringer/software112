// ── Behördenmeldung „svs-einheitswerte“: Einheitswerte je Grundstück (24.09.2026) ──
//
// Grundlage der bäuerlichen SV-Beiträge im Pauschalsystem (BSVG § 23): je Grundstück
// KG, GST-Nr., Einheitswert, Bescheid und SVS-Zurechnung. Die ersten fünf Spalten
// entsprechen dem Einheitswert-Import auf /buchhaltung/svs (KG;GST;Einheitswert;Bescheid;
// Zurechnung) – die Datei lässt sich dort wieder einlesen. Die Vergleichsrechnung
// Pauschal/Option ist eine Orientierungsrechnung und nicht Teil der Datei.
// Eine Ladefunktion für die Seite /buchhaltung/svs (Reiter „Einheitswerte je Grundstück“)
// UND die CSV (/meldungen/svs-einheitswerte/csv).

import { STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { ZURECHNUNG_LABEL, type Zurechnung } from '@/lib/svs/berechnung'
import { betrag, istIsoDatum, text, zahl } from './buchhaltung-gemeinsam'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type SvsEinheitswertZeile = {
  id: string
  katastralgemeinde: string
  kgBezeichnung: string
  gstNr: string
  einlagezahl: string
  ried: string
  /** Fläche lt. Kataster, sonst lt. Weingarten */
  flaecheHa: number | null
  nutzart: string
  rechtsverhaeltnis: string
  einheitswert: number | null
  /** DATE 'JJJJ-MM-TT' */
  bescheid: string | null
  /** Quelle des Einheitswerts als Text (manuell/Import) */
  quelle: string | null
  /** einheitswert_quelle wie gespeichert ('manuell' | 'import') */
  quelleRoh: string | null
  zurechnung: string
}

export const SPALTEN_SVS_EINHEITSWERTE: CsvSpalte<SvsEinheitswertZeile>[] = [
  // Reihenfolge und Kopf so, dass der Import auf /buchhaltung/svs die Datei wieder erkennt
  { kopf: 'KG-Nr.', typ: 'code', wert: z => z.katastralgemeinde },
  { kopf: 'GST-Nr.', typ: 'code', wert: z => z.gstNr },
  { kopf: 'Einheitswert (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.einheitswert },
  { kopf: 'Bescheid', typ: 'datum', wert: z => z.bescheid },
  { kopf: 'Zurechnung', typ: 'code', wert: z => z.zurechnung },
  { kopf: 'Zurechnung (Bezeichnung)', typ: 'text', wert: z => ZURECHNUNG_LABEL[z.zurechnung as Zurechnung] ?? z.zurechnung },
  { kopf: 'KG-Bezeichnung', typ: 'text', wert: z => z.kgBezeichnung },
  { kopf: 'Einlagezahl', typ: 'code', wert: z => z.einlagezahl },
  { kopf: 'Ried', typ: 'text', wert: z => z.ried },
  { kopf: 'Fläche (ha)', typ: 'dezimal', stellen: STELLEN.ha, wert: z => z.flaecheHa },
  { kopf: 'Nutzart (eAMA)', typ: 'text', wert: z => z.nutzart },
  { kopf: 'Rechtsverhältnis (eAMA)', typ: 'text', wert: z => z.rechtsverhaeltnis },
  { kopf: 'Quelle Einheitswert', typ: 'text', wert: z => z.quelle },
]

const QUELLE: Record<string, string> = { manuell: 'manuell', import: 'Import' }

/** grundstuecke-Zeile (mit weingarten) → Einheitswert-Zeile */
export function svsEinheitswertZeile(g: R): SvsEinheitswertZeile {
  const s = (v: unknown) => text(v) ?? ''
  const bescheid = text(g.einheitswert_bescheid)
  const quelle = text(g.einheitswert_quelle)
  return {
    id: String(g.id),
    katastralgemeinde: s(g.katastralgemeinde),
    kgBezeichnung: s(g.kg_bezeichnung),
    gstNr: s(g.gst_nr),
    einlagezahl: s(g.einlagezahl),
    ried: text(g.weingarten?.ried) ?? text(g.weingarten?.name) ?? '',
    flaecheHa: zahl(g.flaeche_ha_kataster) ?? zahl(g.flaeche_ha),
    nutzart: s(g.nutzart),
    rechtsverhaeltnis: s(g.rechtsverhaeltnis),
    einheitswert: betrag(g.einheitswert),
    bescheid: bescheid && istIsoDatum(bescheid.slice(0, 10)) ? bescheid.slice(0, 10) : null,
    quelle: quelle ? (QUELLE[quelle] ?? quelle) : null,
    quelleRoh: quelle,
    zurechnung: text(g.svs_zurechnung) ?? 'eigen',
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeSvsEinheitswerte(supabase: any, tenantId: string): Promise<{ zeilen: SvsEinheitswertZeile[]; warnungen: string[] }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle<R>((supabase.from('grundstuecke') as any)
    .select('id, gst_nr, katastralgemeinde, kg_bezeichnung, einlagezahl, flaeche_ha, flaeche_ha_kataster, nutzart, rechtsverhaeltnis, einheitswert, einheitswert_bescheid, einheitswert_quelle, svs_zurechnung, weingarten:weingarten!weingarten_id(name, ried)')
    .eq('tenant_id', tenantId)
    .order('katastralgemeinde').order('gst_nr').order('id'))
  if (error) throw new Error(`Laden fehlgeschlagen (grundstuecke): ${error.message}`)

  const zeilen = data.map(svsEinheitswertZeile)
  const warnungen: string[] = []
  const ohneWert = zeilen.filter(z => z.einheitswert === null && z.zurechnung !== 'keine').length
  if (ohneWert > 0) warnungen.push(`${ohneWert} ${ohneWert === 1 ? 'Grundstück hat' : 'Grundstücke haben'} noch keinen Einheitswert – die Beitragsgrundlage ist unvollständig.`)
  return { zeilen, warnungen }
}
