'use server'

// KAN-232 (08.10.2026): Lohnversektung – Versand der Grundwein-Charge und Storno über die RPCs
// s112_lohnversektung_versenden / s112_lohnversektung_stornieren. Die Rückkehr ist eine Füllung (Füllungsformular mit
// ?lohnversektung=<id>, createFuellung setzt das Kennzeichen).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { versandFehler } from '@/lib/kellerbuch/lohnversektung'
import { wienHeute } from '@/lib/csv'

async function kontext(): Promise<string> {
  const m = await getCurrentMembership()
  if (!m) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(m.tenantId)   // KAN-30
  await pruefeSchreibzugriff(m)   // KAN-5
  if (!canWrite(m, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return m.tenantId
}

export async function lohnversektungVersenden(e: { weinausbauId: string; firmaId: string; datum: string; notizen?: string | null }): Promise<{ id: string }> {
  const tenantId = await kontext()
  const fehler = versandFehler({ ...e, heute: wienHeute() })
  if (fehler) throw new AktionsFehler(fehler)
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('s112_lohnversektung_versenden', {
    p_tenant_id: tenantId, p_weinausbau_id: e.weinausbauId, p_datum: e.datum, p_firma_id: e.firmaId, p_notizen: e.notizen?.trim() || null,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Versand zur Lohnversektung konnte nicht gebucht werden'))
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/lohnversektung')
  revalidatePath(`/kellerbuch/weinausbau/${e.weinausbauId}`)
  return { id: String(data) }
}

export async function lohnversektungStornieren(id: string, grund: string): Promise<void> {
  const tenantId = await kontext()
  const gf = stornoGrundFehler(grund)
  if (gf) throw new AktionsFehler(gf)
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_lohnversektung_stornieren', { p_tenant_id: tenantId, p_id: id, p_grund: grund.trim() })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Versand konnte nicht storniert werden'))
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/lohnversektung')
}
