// ── Besondere Konten (Stoffkonto) – Ladefunktion für Seite und CSV „besondere-konten“ (KAN-107, 07.10.2026) ──
// Je Stoff der Kontoauszug im Weinwirtschaftsjahr (01.08.–31.07.): Übertrag (Saldo vor dem Jahr), jede Buchung mit
// laufendem Saldo, stornierte Buchungen gekennzeichnet. Dieselbe Rechnung wie die Seite /kellerbuch/besondere-konten.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle } from '@/lib/supabase/alle'
import type { CsvSpalte } from '@/lib/csv'
import { kontoauszug, KONTO_ART_LABEL, weinwirtschaftsjahr, type BesondereKontenZeile, type KontoArt, type KontoBuchung } from '@/lib/kellerbuch/stoffkonto'

type R = Record<string, any>

export type Stoff = { id: string; name: string; einheit: string; aktiv: boolean }

/** Alle Stoffe des Betriebs (alphabetisch) */
export async function ladeStoffe(supabase: any, tenantId: string): Promise<Stoff[]> {
  const { data, error } = await alle<R>((supabase.from('kellermittel') as any).select('id, name, einheit, aktiv').eq('tenant_id', tenantId).order('name').order('id'))
  if (error) throw new Error(`Stoffe konnten nicht geladen werden (${error.message ?? 'unbekannter Fehler'})`)
  return data.map(s => ({ id: String(s.id), name: String(s.name), einheit: String(s.einheit), aktiv: !!s.aktiv }))
}

/** Buchungen eines bzw. aller Stoffe (mit Charge und Behälter als Namen) */
export async function ladeKontoBuchungen(supabase: any, tenantId: string, kellermittelId: string | null): Promise<(KontoBuchung & { kellermittel_id: string })[]> {
  let q = (supabase.from('kellermittel_buchungen') as any)
    .select('id, kellermittel_id, datum, art, menge, erstellt_am, lieferant, beleg, los, zweck, storno_von_id, notizen, erstellt_von_name, weinausbau:weinausbau_id(name), behaelter:behaelter_id(name)')
    .eq('tenant_id', tenantId)
  if (kellermittelId) q = q.eq('kellermittel_id', kellermittelId)
  const { data, error } = await alle<R>(q.order('datum').order('id'))
  if (error) throw new Error(`Buchungen konnten nicht geladen werden (${error.message ?? 'unbekannter Fehler'})`)
  return data.map(b => ({
    id: String(b.id), kellermittel_id: String(b.kellermittel_id), datum: String(b.datum).slice(0, 10), art: b.art as KontoArt,
    menge: Number(b.menge), erstellt_am: b.erstellt_am ?? null, lieferant: b.lieferant ?? null, beleg: b.beleg ?? null, los: b.los ?? null,
    zweck: b.zweck ?? null, storno_von_id: b.storno_von_id ?? null, notizen: b.notizen ?? null, erstellt_von_name: b.erstellt_von_name ?? null,
    charge: b.weinausbau?.name ?? null, behaelter: b.behaelter?.name ?? null,
  }))
}

/** Meldung: Kontoauszüge aller Stoffe im Weinwirtschaftsjahr ab `jahrStart` (z. B. 2025 → 01.08.2025–31.07.2026) */
export async function ladeBesondereKonten(supabase: any, tenantId: string, jahrStart: number): Promise<{ zeilen: BesondereKontenZeile[]; warnungen: string[] }> {
  const wwj = weinwirtschaftsjahr(`${jahrStart}-08-01`)
  const [stoffe, buchungen] = await Promise.all([ladeStoffe(supabase, tenantId), ladeKontoBuchungen(supabase, tenantId, null)])
  const zeilen: BesondereKontenZeile[] = []
  const warnungen: string[] = []
  for (const s of stoffe) {
    const eigene = buchungen.filter(b => b.kellermittel_id === s.id && b.datum <= wwj.bis)
    const vorher = eigene.filter(b => b.datum < wwj.von)
    const imJahr = eigene.filter(b => b.datum >= wwj.von)
    if (!vorher.length && !imJahr.length) continue
    const uebertrag = Math.round(vorher.reduce((a, b) => a + b.menge, 0) * 1000) / 1000
    zeilen.push({ stoff: s.name, einheit: s.einheit, datum: wwj.von, art: 'Übertrag', menge: uebertrag, saldo: uebertrag, lieferant: null, beleg: null, los: null, charge: null, behaelter: null, zweck: null, storniert: false })
    const a = kontoauszug([{ id: '0', datum: wwj.von, art: 'anfangsbestand', menge: uebertrag, erstellt_am: '' }, ...imJahr])
    for (const z of a.zeilen.slice(1)) {
      zeilen.push({
        stoff: s.name, einheit: s.einheit, datum: z.datum, art: KONTO_ART_LABEL[z.art], menge: z.menge, saldo: z.saldo,
        lieferant: z.lieferant ?? null, beleg: z.beleg ?? null, los: z.los ?? null, charge: z.charge ?? null, behaelter: z.behaelter ?? null,
        zweck: z.zweck ?? null, storniert: z.storniert,
      })
    }
    for (const w of a.warnungen) warnungen.push(`${s.name}: ${w}`)
  }
  return { zeilen, warnungen }
}

export const SPALTEN_BESONDERE_KONTEN: CsvSpalte<BesondereKontenZeile>[] = [
  { kopf: 'Stoff', typ: 'text', wert: z => z.stoff },
  { kopf: 'Einheit', typ: 'text', wert: z => z.einheit },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Buchungsart', typ: 'text', wert: z => z.art },
  { kopf: 'Menge', typ: 'dezimal', stellen: 3, wert: z => z.menge },
  { kopf: 'Saldo', typ: 'dezimal', stellen: 3, wert: z => z.saldo },
  { kopf: 'Lieferant', typ: 'text', wert: z => z.lieferant },
  { kopf: 'Beleg', typ: 'code', wert: z => z.beleg },
  { kopf: 'Los', typ: 'code', wert: z => z.los },
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Behälter', typ: 'text', wert: z => z.behaelter },
  { kopf: 'Zweck', typ: 'text', wert: z => z.zweck },
  { kopf: 'Storniert', typ: 'janein', wert: z => z.storniert },
]
