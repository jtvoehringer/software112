// ── Kellerbehandlungen (önologische Verfahren) je Gebinde – Seite UND CSV (24.09.2026) ──
//
// Zusatzfund der Vollständigkeitsprüfung: Die BKI prüft die Aufzeichnungen je Gebinde,
// bisher gab es sie nur am Bildschirm (kellerbuch/behaelter/[id]/behandlungen) bzw. je
// Charge im Weinbuch. Eine Zeile je Behandlung; Zeitraum und Gebinde optional (ohne
// Gebinde: alle Gebinde des Betriebs – so nutzt sie auch die Keller-Auswertung).
//
// Charge: die an der Behandlung erfasste. Ältere Einträge ohne Charge bekommen die
// Charge, die laut Bewegungsbuch an diesem Tag als einzige im Gebinde lag
// (Belegungszeitraum, bewegungsbuch.ts) – nie eine frühere oder spätere Charge desselben
// Gebindes. Nicht eindeutig → leer, Spalte „Zuordnung“ und Hinweis sagen es.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { ladeBehaelter, type BehaelterZeile } from '@/lib/keller/behaelter'
import { chargeAmTag, ladeBelegungen, type Belegung } from './bewegungsbuch'
import { numOderNull, tag, text, type R, type Zeitraum } from './kellerbuch-hilfen'

export type Zuordnung = 'erfasst' | 'belegung' | 'mehrdeutig' | 'offen'

export const ZUORDNUNG_LABEL: Record<Zuordnung, string> = {
  erfasst:    'an der Behandlung erfasst',
  belegung:   'aus dem Belegungszeitraum des Gebindes',
  mehrdeutig: 'nicht eindeutig (mehrere Chargen im Gebinde)',
  offen:      'keine Charge im Gebinde',
}

export type KellerBehandlungZeile = {
  id: string
  datum: string
  behaelterId: string | null
  gebinde: string | null
  chargeId: string | null
  charge: string | null
  zuordnung: Zuordnung
  behandlung: string
  menge: number | null
  einheit: string | null
  /** Dosierung in g/hl – nur bei Mengen in kg, g oder mg und bekanntem Volumen */
  gProHl: number | null
  volumenLiter: number | null
  notizen: string | null
}

/** Stellen der Spalte „Menge“ (kleine Zusätze wie 0,005 kg bleiben sichtbar) */
export const STELLEN_BEHANDLUNG_MENGE = 3

/** g/hl wie auf der Seite: Menge in g umrechnen, durch Volumen (l) × 100 */
export function gProHl(menge: number | null, einheit: string | null, volumenLiter: number | null): number | null {
  if (!menge || !volumenLiter || volumenLiter <= 0) return null
  const faktor = einheit === 'kg' ? 1000 : einheit === 'g' ? 1 : einheit === 'mg' ? 0.001 : null
  if (faktor === null) return null
  return runden((menge * faktor / volumenLiter) * 100, 1)
}

export type KellerBehandlungen = {
  zeilen: KellerBehandlungZeile[]
  warnungen: string[]
  /** gewähltes Gebinde (null = alle) */
  gebinde: BehaelterZeile | null
}

/**
 * Kellerbehandlungen des Betriebs (optional nur ein Gebinde, optional Zeitraum), chronologisch.
 * null, wenn ein angegebenes Gebinde nicht sichtbar ist.
 */
export async function ladeKellerBehandlungen(
  supabase: any,
  tenantId: string,
  p: { behaelterId?: string | null } & Zeitraum,
  opts: { gebindeListe?: BehaelterZeile[] } = {},
): Promise<KellerBehandlungen | null> {
  // Gebinde-Namen über lade_behaelter: auch freigegebene Gebinde eines Partnerbetriebs
  const gebindeListe = opts.gebindeListe ?? await ladeBehaelter(supabase, tenantId)
  const gebindeMap = new Map(gebindeListe.map(g => [g.id, g]))
  const gebinde = p.behaelterId ? gebindeMap.get(p.behaelterId) ?? null : null
  if (p.behaelterId && !gebinde) return null

  let q = (supabase.from('keller_behandlungen') as any)
    .select('id, datum, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, behaelter_id, weinausbau_id, typ:typ_id(name), weinausbau:weinausbau_id(name), behaelter:behaelter_id(name)')
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)   // KAN-145: stornierte Kellerbehandlungen zählen nicht
  if (p.behaelterId) q = q.eq('behaelter_id', p.behaelterId)
  if (p.von) q = q.gte('datum', p.von)
  if (p.bis) q = q.lte('datum', p.bis)
  const { data, error } = await alle<R>(q.order('datum', { ascending: true }).order('id', { ascending: true }))
  if (error) throw new Error(`Kellerbehandlungen konnten nicht geladen werden: ${error.message}`)

  // Belegungszeiträume nur für Gebinde mit Einträgen ohne Charge (selten, teuer)
  const ohneCharge = [...new Set(data.filter(b => !b.weinausbau_id && b.behaelter_id).map(b => b.behaelter_id as string))]
  const belegungen = new Map<string, Belegung[]>()
  for (const id of ohneCharge) belegungen.set(id, await ladeBelegungen(supabase, tenantId, id))

  const zeilen: KellerBehandlungZeile[] = data.map(b => {
    const datum = tag(b.datum)
    let chargeId: string | null = b.weinausbau_id ?? null
    let charge: string | null = text((b.weinausbau as R | null)?.name)
    let zuordnung: Zuordnung = 'erfasst'
    if (!chargeId) {
      const treffer = b.behaelter_id ? chargeAmTag(belegungen.get(b.behaelter_id) ?? [], datum) : null
      if (treffer === 'mehrdeutig') zuordnung = 'mehrdeutig'
      else if (treffer) { chargeId = treffer.chargeId; charge = treffer.charge; zuordnung = 'belegung' }
      else zuordnung = 'offen'
    }
    const menge = numOderNull(b.menge)
    const einheit = text(b.einheit)
    const volumenLiter = numOderNull(b.volumen_liter_ist)
    return {
      id: b.id,
      datum,
      behaelterId: b.behaelter_id ?? null,
      gebinde: (b.behaelter_id ? gebindeMap.get(b.behaelter_id)?.anzeigeName : null) ?? text((b.behaelter as R | null)?.name),
      chargeId,
      charge,
      zuordnung,
      behandlung: text((b.typ as R | null)?.name) ?? text(b.typ_name_snapshot) ?? 'Behandlung',
      menge: menge === null || einheit === '-' ? null : runden(menge, STELLEN_BEHANDLUNG_MENGE),
      einheit: einheit === '-' ? null : einheit,
      gProHl: gProHl(menge, einheit, volumenLiter),
      volumenLiter: volumenLiter === null ? null : runden(volumenLiter, STELLEN.liter),
      notizen: text(b.notizen),
    }
  })

  const warnungen: string[] = []
  const zaehle = (z: Zuordnung) => zeilen.filter(r => r.zuordnung === z).length
  const ausBelegung = zaehle('belegung'), unklar = zaehle('mehrdeutig') + zaehle('offen')
  if (ausBelegung > 0) warnungen.push(`${ausBelegung} ${ausBelegung === 1 ? 'Behandlung ist' : 'Behandlungen sind'} ohne erfasste Charge – Charge aus dem Belegungszeitraum des Gebindes ergänzt (Spalte „Zuordnung“).`)
  if (unklar > 0) warnungen.push(`${unklar} ${unklar === 1 ? 'Behandlung hat' : 'Behandlungen haben'} keine Charge und keine eindeutige Belegung des Gebindes – Spalte „Charge“ leer.`)
  if (gebinde?.fremd) warnungen.push(`Kellergemeinschaft: Das Gebinde gehört ${gebinde.eigentuemer_name || 'einem Partnerbetrieb'} – enthalten sind nur die Behandlungen des eigenen Betriebs.`)
  if (gebinde && gebinde.fremd_liter > 0) warnungen.push(`Kellergemeinschaft: Behandlungen von ${gebinde.fremd_betrieb ?? 'Partnerbetrieben'} in diesem Gebinde sind nicht enthalten.`)

  return { zeilen, warnungen, gebinde }
}

/** Summen je Behandlungstyp (Keller-Auswertungen) */
export function behandlungenJeTyp(zeilen: readonly KellerBehandlungZeile[]): [string, number][] {
  const m = new Map<string, number>()
  for (const z of zeilen) m.set(z.behandlung, (m.get(z.behandlung) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
}

export const SPALTEN_KELLER_BEHANDLUNGEN: CsvSpalte<KellerBehandlungZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Gebinde', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Zuordnung Charge', typ: 'text', wert: z => ZUORDNUNG_LABEL[z.zuordnung] },
  { kopf: 'Behandlung / Verfahren', typ: 'text', wert: z => z.behandlung },
  { kopf: 'Menge', typ: 'dezimal', stellen: STELLEN_BEHANDLUNG_MENGE, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'code', wert: z => z.einheit },
  { kopf: 'Dosierung (g/hl)', typ: 'dezimal', stellen: 1, wert: z => z.gProHl },
  { kopf: 'Volumen Ist (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.volumenLiter },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
]
