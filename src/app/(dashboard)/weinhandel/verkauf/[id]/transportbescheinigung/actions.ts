'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-150 F2 (01.10.2026): Speichern über den Benutzer-Client (RLS tb_* + modul_*), damit der Benutzer im
// Änderungsprotokoll steht – vorher Service-Role ohne Benutzerbezug. Aktiv gewählter Betrieb (Cookie) statt einer
// beliebigen Mitgliedschaft. Eine stornierte Bescheinigung gilt nicht mehr; danach legt Speichern eine neue an.
async function tbSchreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!membership || !tenantId) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.')
  return tenantId
}

export async function saveTB(verkaufspostenId: string, daten: R): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await tbSchreibrecht()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: exErr } = await (supabase.from('transportbescheinigungen') as any)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('verkaufsposten_id', verkaufspostenId)
    .is('storniert_am', null)
    .maybeSingle()
  if (exErr) throw new AktionsFehler(dbFehlerText(exErr, 'Transportbescheinigung konnte nicht geladen werden'))

  if (existing?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase.from('transportbescheinigungen') as any)
      .update({ formular_daten: daten, aktualisiert_am: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId)
    if (e) throw new AktionsFehler(dbFehlerText(e, 'Speichern fehlgeschlagen (transportbescheinigungen)'))
    revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
    return { id: existing.id }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error } = await (supabase.from('transportbescheinigungen') as any)
    .insert({ tenant_id: tenantId, verkaufsposten_id: verkaufspostenId, formular_daten: daten })
    .select('id').single()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (transportbescheinigungen)'))
  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
  return { id: (neu as R).id }
}

export async function stornoTB(verkaufspostenId: string, id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await tbSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('transportbescheinigungen') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).eq('verkaufsposten_id', verkaufspostenId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Transportbescheinigung nicht gefunden oder bereits storniert.')
  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
}

export async function loescheTB(verkaufspostenId: string, id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await tbSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'transportbescheinigungen', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}/transportbescheinigung`)
}
