// ── Kellerbehandlungen (önologische Verfahren) je Charge – Seite UND CSV ──────────────────────────
//
// Seit KAN-479 (BKI-Sitzung 16.11.2026) führen die Unterlagen für die BKI Kellerbehandlungen je
// Charge; das Gebinde wird nicht mehr ausgewiesen (die Behandlung bleibt bei der Charge, auch wenn
// sie das Gebinde wechselt – KAN-475). Eine Zeile je Behandlung; Zeitraum und Charge optional
// (ohne Charge: alle Chargen des Betriebs – so nutzt sie auch die Keller-Auswertung).
//
// Einträge ohne Charge sind Gebindepflege (Reinigen, Konservieren, Umbenennung, Notiz – seit
// KAN-475 lässt die Datenbank ohne Charge nichts anderes zu). Sie sind keine Behandlung eines
// Weins und stehen nicht in der Meldung; ihre Anzahl nennt ein Hinweis.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle } from '@/lib/supabase/alle'
import { numOderNull, tag, text, type R, type Zeitraum } from './kellerbuch-hilfen'
import { AktionsFehler } from '@/lib/fehler'

export type KellerBehandlungZeile = {
  id: string
  datum: string
  chargeId: string
  charge: string | null
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
  /** gewählte Charge (null = alle) */
  charge: { id: string; name: string | null } | null
}

/** Hinweis auf nicht enthaltene Einträge ohne Charge (Gebindepflege) – nur in der Liste aller Chargen */
export function ohneChargeHinweis(n: number): string | null {
  if (n <= 0) return null
  return `${n} ${n === 1 ? 'Eintrag' : 'Einträge'} ohne Charge (Gebindepflege: Reinigen, Konservieren, Notiz) ${n === 1 ? 'ist' : 'sind'} nicht enthalten – ${n === 1 ? 'er steht' : 'sie stehen'} am Gebinde.`
}

/**
 * Kellerbehandlungen des Betriebs (optional nur eine Charge, optional Zeitraum), chronologisch.
 * null, wenn eine angegebene Charge nicht zum Betrieb gehört.
 */
export async function ladeKellerBehandlungen(
  supabase: any,
  tenantId: string,
  p: { chargeId?: string | null } & Zeitraum,
): Promise<KellerBehandlungen | null> {
  let charge: KellerBehandlungen['charge'] = null
  if (p.chargeId) {
    const { data: w, error: wFehler } = await (supabase.from('weinausbau') as any)
      .select('id, name').eq('id', p.chargeId).eq('tenant_id', tenantId).maybeSingle()
    if (wFehler) throw new AktionsFehler(`Charge konnte nicht geladen werden: ${wFehler.message}`)
    if (!w) return null
    charge = { id: String(w.id), name: text(w.name) }
  }

  let q = (supabase.from('keller_behandlungen') as any)
    .select('id, datum, created_at, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, weinausbau_id, typ:typ_id(name), weinausbau:weinausbau_id(name)')
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)   // KAN-145: stornierte Kellerbehandlungen zählen nicht
  if (p.chargeId) q = q.eq('weinausbau_id', p.chargeId)
  if (p.von) q = q.gte('datum', p.von)
  if (p.bis) q = q.lte('datum', p.bis)
  const { data, error } = await alle<R>(q.order('datum', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }))
  if (error) throw new AktionsFehler(`Kellerbehandlungen konnten nicht geladen werden: ${error.message}`)

  const zeilen: KellerBehandlungZeile[] = data.filter(b => b.weinausbau_id).map(b => {
    const menge = numOderNull(b.menge)
    const einheit = text(b.einheit)
    const volumenLiter = numOderNull(b.volumen_liter_ist)
    return {
      id: b.id,
      datum: tag(b.datum),
      chargeId: String(b.weinausbau_id),
      charge: text((b.weinausbau as R | null)?.name),
      behandlung: text((b.typ as R | null)?.name) ?? text(b.typ_name_snapshot) ?? 'Behandlung',
      menge: menge === null || einheit === '-' ? null : runden(menge, STELLEN_BEHANDLUNG_MENGE),
      einheit: einheit === '-' ? null : einheit,
      gProHl: gProHl(menge, einheit, volumenLiter),
      volumenLiter: volumenLiter === null ? null : runden(volumenLiter, STELLEN.liter),
      notizen: text(b.notizen),
    }
  })

  const warnungen: string[] = []
  const hinweis = ohneChargeHinweis(data.length - zeilen.length)
  if (hinweis) warnungen.push(hinweis)

  return { zeilen, warnungen, charge }
}

/** Summen je Behandlungstyp (Keller-Auswertungen) */
export function behandlungenJeTyp(zeilen: readonly KellerBehandlungZeile[]): [string, number][] {
  const m = new Map<string, number>()
  for (const z of zeilen) m.set(z.behandlung, (m.get(z.behandlung) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'))
}

export const SPALTEN_KELLER_BEHANDLUNGEN: CsvSpalte<KellerBehandlungZeile>[] = [
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Behandlung / Verfahren', typ: 'text', wert: z => z.behandlung },
  { kopf: 'Menge', typ: 'dezimal', stellen: STELLEN_BEHANDLUNG_MENGE, wert: z => z.menge },
  { kopf: 'Einheit', typ: 'code', wert: z => z.einheit },
  { kopf: 'Dosierung (g/hl)', typ: 'dezimal', stellen: 1, wert: z => z.gProHl },
  { kopf: 'Volumen Ist (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.volumenLiter },
  { kopf: 'Notizen', typ: 'text', wert: z => z.notizen },
]
