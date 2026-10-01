'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function createDacAntrag(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId  = membership?.tenantId ?? null
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo

  const payload: R = {
    tenant_id:       tenantId,
    weinausbau_id:   (formData.get('weinausbau_id') as string) || null,
    bezeichnung:     formData.get('bezeichnung') as string,
    dac_region:      formData.get('dac_region') as string,
    jahrgang:        formData.get('jahrgang') ? Number(dezimal(formData.get('jahrgang'))) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    menge_liter:     formData.get('menge_liter') ? Number(dezimal((formData.get('menge_liter') as string))) : null,
    alkohol_prozent: formData.get('alkohol_prozent') ? Number(dezimal((formData.get('alkohol_prozent') as string))) : null,
    status:          (formData.get('status') as string) || 'entwurf',
    pruefnummer:     (formData.get('pruefnummer') as string) || null,
    eingereicht_am:  (formData.get('eingereicht_am') as string) || null,
    bescheid_am:     (formData.get('bescheid_am') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).insert(payload)
  if (error) throw new AktionsFehler((error as R).message)
  revalidatePath('/dac')
}

export async function updateDacAntrag(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId  = membership?.tenantId ?? null
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  const payload: R = {
    weinausbau_id:   (formData.get('weinausbau_id') as string) || null,
    bezeichnung:     formData.get('bezeichnung') as string,
    dac_region:      formData.get('dac_region') as string,
    jahrgang:        formData.get('jahrgang') ? Number(dezimal(formData.get('jahrgang'))) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    menge_liter:     formData.get('menge_liter') ? Number(dezimal((formData.get('menge_liter') as string))) : null,
    alkohol_prozent: formData.get('alkohol_prozent') ? Number(dezimal((formData.get('alkohol_prozent') as string))) : null,
    status:          formData.get('status') as string,
    pruefnummer:     (formData.get('pruefnummer') as string) || null,
    eingereicht_am:  (formData.get('eingereicht_am') as string) || null,
    bescheid_am:     (formData.get('bescheid_am') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    aktiv:           formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('dac_antrag') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as R).message)
  revalidatePath('/dac')
}

// KAN-150 F2 (01.10.2026): DAC-Anträge werden storniert statt gelöscht (Frage 6: `aktiv` bleibt Ausblende-Schalter).
// Zeitpunkt und Benutzer setzt die Datenbank (s112_storno_schutz), der stornierte Antrag ist danach unveränderlich und
// gilt nicht mehr als Prüfnummer. Endgültig löschen nur über die RPC s112_storniert_loeschen: stornierte Anträge ohne
// Füllungen und Prüfnummernantrag, Entwürfe ohne Bezug auch ohne Storno (nur Betriebsleitung, Frage 8).
async function dacSchreibrecht() {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return membership
}

export async function stornoDacAntrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // Nicht stornierte Füllungen führen die Prüfnummer des Antrags – erst umhängen bzw. stornieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { count, error: fErr } = await (supabase.from('fuellungen') as any)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('dac_antrag_id', id).is('storniert_am', null)
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Füllungen des Antrags konnten nicht geprüft werden'))
  if ((count ?? 0) > 0) {
    throw new AktionsFehler(`Der Antrag ist ${count === 1 ? 'einer Füllung' : `${count} Füllungen`} zugeordnet – bitte die Füllung zuerst einem anderen Antrag zuordnen oder stornieren.`)
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('dac_antrag') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Antrag nicht gefunden oder bereits storniert.')
  revalidatePath('/dac')
  revalidatePath(`/dac/${id}`)
}

export async function loescheDacAntrag(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const { tenantId } = await dacSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'dac_antrag', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Löschen fehlgeschlagen'))
  revalidatePath('/dac')
}

