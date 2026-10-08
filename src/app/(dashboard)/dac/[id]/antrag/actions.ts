'use server'

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-150 F2 (01.10.2026): Speichern über den Benutzer-Client (RLS pna_* + modul_*), damit der Benutzer im
// Änderungsprotokoll steht – vorher Service-Role ohne Benutzerbezug. Ein stornierter Antrag gilt nicht mehr; danach
// legt Speichern einen neuen an (Vorbelegung).
async function pnaSchreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!membership || !tenantId) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return tenantId
}

// KAN-97: höchstens ein gültiges Formular je DAC-Antrag (eindeutiger Index) – legen zwei Tabs gleichzeitig an, wird der
// zweite Insert (23505) zur Änderung des ersten. Ab „Eingereicht“ lehnt die Datenbank Anlegen und Ändern ab (42501).
export async function savePNA(dacAntragId: string, daten: R, zweiterVersuch = false): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await pnaSchreibrecht()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing, error: exErr } = await (supabase.from('pruefnummernantraege') as any)
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('dac_antrag_id', dacAntragId)
    .is('storniert_am', null)
    .maybeSingle()
  if (exErr) throw new AktionsFehler(dbFehlerText(exErr, 'Prüfnummernantrag konnte nicht geladen werden'))

  if (existing?.id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: geaendert, error: e } = await (supabase.from('pruefnummernantraege') as any)
      .update({ formular_daten: daten, aktualisiert_am: new Date().toISOString() })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId).select('id')
    if (e) throw new AktionsFehler(dbFehlerText(e, 'Speichern fehlgeschlagen (pruefnummernantraege)'))
    if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
    revalidatePath(`/dac/${dacAntragId}/antrag`)
    return { id: existing.id }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error } = await (supabase.from('pruefnummernantraege') as any)
    .insert({ tenant_id: tenantId, dac_antrag_id: dacAntragId, formular_daten: daten })
    .select('id').single()
  if (error && (error as R).code === '23505' && !zweiterVersuch) return savePNA(dacAntragId, daten, true)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (pruefnummernantraege)'))
  revalidatePath(`/dac/${dacAntragId}/antrag`)
  return { id: (neu as R).id }
}

export async function stornoPNA(dacAntragId: string, id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await pnaSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('pruefnummernantraege') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).eq('dac_antrag_id', dacAntragId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Prüfnummernantrag nicht gefunden oder bereits storniert.')
  revalidatePath(`/dac/${dacAntragId}/antrag`)
}

export async function loeschePNA(dacAntragId: string, id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await pnaSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'pruefnummernantraege', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  revalidatePath(`/dac/${dacAntragId}/antrag`)
}
