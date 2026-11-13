'use server'

// KAN-437 Teil 2 (13.11.2026): Export-Registrierungen des Betriebs anlegen, ändern, entfernen.
// Schreiben wie die RLS der Tabelle: Schreibrecht Warenwirtschaft und Paket-Modul Exportaufträge.
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { pruefeModul } from '@/lib/auth/modul'
import { AktionsFehler, dbFehlerText, fehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { registrierungEingabeFehler } from '@/lib/export/registrierungen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function schreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Schreibberechtigung für die Warenwirtschaft in diesem Betrieb.')
  await pruefeModul('modul_export')   // KAN-6: Paket-Modul Exportaufträge
  return membership.tenantId
}

const text = (v: unknown) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export type RegistrierungEingabe = { id?: string | null; art: string; bezeichnung?: string | null; nummer: string; gueltig_bis?: string | null; zusatz?: string | null; notiz?: string | null }

/** Registrierung anlegen (ohne id) bzw. ändern */
export async function speichereRegistrierung(e: RegistrierungEingabe): Promise<{ error?: string }> {
  try {
    const tenantId = await schreibrecht()
    const f = registrierungEingabeFehler(e)
    if (f) return { error: f }
    if (e.id && !UUID.test(e.id)) return { error: 'Ungültige Registrierung.' }
    const supabase = await createSupabaseServerClient()
    const werte = {
      art: e.art, bezeichnung: text(e.bezeichnung), nummer: String(e.nummer).trim(), gueltig_bis: text(e.gueltig_bis),
      zusatz: text(e.zusatz), notiz: text(e.notiz),
    }
    if (e.id) {
      // KAN-248: geänderte Zeile zurückholen – 0 Zeilen heißt „nicht gespeichert“
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('export_registrierungen') as any)
        .update({ ...werte, aktualisiert_am: new Date().toISOString() }).eq('id', e.id).eq('tenant_id', tenantId).select('id')
      if (error) return { error: dbFehlerText(error, 'Registrierung konnte nicht gespeichert werden') }
      if (!((data ?? []) as R[]).length) return { error: NICHT_GESPEICHERT }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.from('export_registrierungen') as any)
        .insert({ tenant_id: tenantId, ...werte }).select('id')
      if (error) return { error: dbFehlerText(error, 'Registrierung konnte nicht gespeichert werden') }
      if (!((data ?? []) as R[]).length) return { error: NICHT_GESPEICHERT }
    }
    revalidatePath('/weinexport/registrierungen')
    revalidatePath('/dashboard/fristen')
    return {}
  } catch (err) {
    return { error: fehlerText(err) }
  }
}

/** Registrierung entfernen */
export async function entferneRegistrierung(id: string): Promise<{ error?: string }> {
  try {
    const tenantId = await schreibrecht()
    if (!UUID.test(id)) return { error: 'Ungültige Registrierung.' }
    const supabase = await createSupabaseServerClient()
    // KAN-243: gelöschte Zeile zurückholen – 0 Zeilen heißt „nicht gelöscht“
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('export_registrierungen') as any)
      .delete().eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) return { error: dbFehlerText(error, 'Registrierung konnte nicht entfernt werden') }
    if (!((data ?? []) as R[]).length) return { error: 'Die Registrierung wurde nicht entfernt – bitte die Seite neu laden.' }
    revalidatePath('/weinexport/registrierungen')
    revalidatePath('/dashboard/fristen')
    return {}
  } catch (err) {
    return { error: fehlerText(err) }
  }
}
