'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { seitenBetriebFehler } from '@/lib/auth/seitenBetrieb'
import { schreibSperreFehler } from '@/lib/auth/sperren'
import { MAPPING_FELDER } from '@/lib/buchhaltung/bmd'
import { hatModul, modulAusMeldung } from '@/lib/auth/modul'

// Konten-Mapping speichern (Migration 196): es werden nur Abweichungen von der
// Vorbelegung abgelegt - ein Wert, der der Vorbelegung entspricht oder leer
// ist, löscht den Eintrag wieder. Nur Mandanten-Admins (RLS bkm_write).
export async function speichereKontenmapping(werte: Record<string, string>): Promise<{ ok: boolean; fehler?: string }> {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return { ok: false, fehler: 'Kein Mandant' }
  const betriebGewechselt = await seitenBetriebFehler(membership.tenantId)   // KAN-30
  if (betriebGewechselt) return { ok: false, fehler: betriebGewechselt }
  const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (aboGesperrt) return { ok: false, fehler: aboGesperrt }
  if (!(await hatModul('modul_ea'))) return { ok: false, fehler: modulAusMeldung('modul_ea') }   // KAN-6: BMD-Übergabe gehört zur E&A
  if (!canAdmin(membership.role)) return { ok: false, fehler: 'Nur Mandanten-Administratoren dürfen das Konten-Mapping ändern.' }
  const supabase = await createSupabaseServerClient()
  const tenantId = membership.tenantId

  const upserts: { tenant_id: string; schluessel: string; wert: string; aktualisiert_am: string }[] = []
  const loeschen: string[] = []
  for (const f of MAPPING_FELDER) {
    const wert = (werte[f.schluessel] ?? '').trim()
    // Steuercode "leer" ist bei steuercode_frei ein gültiger Wert = Vorbelegung
    if (wert === '' || wert === f.standard) loeschen.push(f.schluessel)
    else {
      if (!/^[A-Za-z0-9._\-]{1,20}$/.test(wert)) return { ok: false, fehler: `Ungültiger Wert bei „${f.label}“: ${wert}` }
      upserts.push({ tenant_id: tenantId, schluessel: f.schluessel, wert, aktualisiert_am: new Date().toISOString() })
    }
  }

  if (loeschen.length) {
    const { error } = await (supabase.from('buchhaltung_kontenmapping') as any)
      .delete().eq('tenant_id', tenantId).in('schluessel', loeschen)
    if (error) return { ok: false, fehler: error.message }
  }
  if (upserts.length) {
    const { error } = await (supabase.from('buchhaltung_kontenmapping') as any)
      .upsert(upserts, { onConflict: 'tenant_id,schluessel' })
    if (error) return { ok: false, fehler: error.message }
  }
  revalidatePath('/controlling/bmd')
  return { ok: true }
}

/** Alle Abweichungen löschen -> Vorbelegung gilt wieder */
export async function setzeKontenmappingZurueck(): Promise<{ ok: boolean; fehler?: string }> {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return { ok: false, fehler: 'Kein Mandant' }
  const betriebGewechselt = await seitenBetriebFehler(membership.tenantId)   // KAN-30
  if (betriebGewechselt) return { ok: false, fehler: betriebGewechselt }
  const aboGesperrt = await schreibSperreFehler(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (aboGesperrt) return { ok: false, fehler: aboGesperrt }
  if (!(await hatModul('modul_ea'))) return { ok: false, fehler: modulAusMeldung('modul_ea') }   // KAN-6: BMD-Übergabe gehört zur E&A
  if (!canAdmin(membership.role)) return { ok: false, fehler: 'Nur Mandanten-Administratoren dürfen das Konten-Mapping ändern.' }
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('buchhaltung_kontenmapping') as any).delete().eq('tenant_id', membership.tenantId)
  if (error) return { ok: false, fehler: error.message }
  revalidatePath('/controlling/bmd')
  return { ok: true }
}
