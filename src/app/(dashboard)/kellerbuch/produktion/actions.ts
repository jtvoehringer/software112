'use server'

// KAN-118 (08.10.2026): Produktion buchen und stornieren – Regeln in lib/kellerbuch/produktion (wie die RPCs), Buchung in
// einer Transaktion über s112_produktion_buchen / s112_produktion_stornieren.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { wienHeute } from '@/lib/csv'
import { stornoGrundFehler } from '@/lib/storno/grund'
import {
  produktionEingaenge, produktionFehler, PRODUKTION_ARTEN,
  type ProduktionArt, type WeinEingang, type ZutatEingang,
} from '@/lib/kellerbuch/produktion'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function kontext(): Promise<string> {
  const m = await getCurrentMembership()
  if (!m) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(m.tenantId)   // KAN-30
  await pruefeSchreibzugriff(m)   // KAN-5
  if (!canWrite(m, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return m.tenantId
}

export type ProduktionEingabe = {
  art: ProduktionArt
  erzeugnis?: string | null
  datum: string
  name: string
  behaelterId: string
  notizen?: string | null
  wein: { weinausbauId: string; menge: number }[]
  zutaten: ZutatEingang[]
}

export async function produktionBuchen(e: ProduktionEingabe): Promise<{ zielId: string }> {
  const tenantId = await kontext()
  if (!PRODUKTION_ARTEN.includes(e.art)) throw new AktionsFehler('Bitte die Art der Produktion wählen.')
  const supabase = await createSupabaseServerClient()
  const ids = [...new Set(e.wein.map(w => w.weinausbauId))]
  // alle-ausnahme: die ausgewählten Quell-Chargen einer Produktion, wenige
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chargen, error } = ids.length ? await (supabase.from('weinausbau') as any)
    .select('id, name, menge_liter, weinart').eq('tenant_id', tenantId).in('id', ids) : { data: [], error: null }
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Quell-Chargen konnten nicht geladen werden'))
  const jeId = new Map(((chargen ?? []) as R[]).map(c => [String(c.id), c]))
  const wein: WeinEingang[] = e.wein.map(w => {
    const c = jeId.get(w.weinausbauId)
    return { weinausbauId: w.weinausbauId, menge: w.menge, bestand: Number(c?.menge_liter) || 0, weinart: c?.weinart ?? null, name: c?.name ?? null }
  })
  const fehler = produktionFehler({ art: e.art, erzeugnis: e.erzeugnis, name: e.name, behaelterId: e.behaelterId,
    datum: e.datum, heute: wienHeute(), wein, zutaten: e.zutaten })
  if (fehler.length) throw new AktionsFehler(fehler.join(' '))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcErr } = await (supabase as any).rpc('s112_produktion_buchen', {
    p_tenant_id: tenantId,
    p_kopf: { datum: e.datum, art: e.art, erzeugnis: e.erzeugnis || null, name: e.name.trim(), behaelter_id: e.behaelterId, notizen: e.notizen?.trim() || null },
    p_eingaenge: produktionEingaenge(wein, e.zutaten),
  })
  if (rpcErr) throw new AktionsFehler(dbFehlerText(rpcErr, 'Produktion konnte nicht gebucht werden'))
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/produktion')
  for (const id of ids) revalidatePath(`/kellerbuch/weinausbau/${id}`)
  return { zielId: String((data as R).ziel_weinausbau_id) }
}

export async function produktionStornieren(produktionId: string, grund: string): Promise<void> {
  const tenantId = await kontext()
  const gf = stornoGrundFehler(grund)
  if (gf) throw new AktionsFehler(gf)
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_produktion_stornieren', { p_tenant_id: tenantId, p_id: produktionId, p_grund: grund.trim() })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Produktion konnte nicht storniert werden'))
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/produktion')
  // UAT 23.10.2026: Storno auch von der Seite der erzeugten Charge – sie und die Quellen zeigen danach den neuen Stand
  revalidatePath('/kellerbuch/weinausbau', 'layout')
}
