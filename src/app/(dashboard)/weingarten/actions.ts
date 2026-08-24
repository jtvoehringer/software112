'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

async function getTenantId(): Promise<string | null> {
  const membership = await getCurrentMembership()
  return membership?.tenantId ?? null
}

export async function createWeingarten(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: AnyRecord = {
    tenant_id:            tenantId,
    name:                 formData.get('name') as string,
    ama_feldnummer:       (formData.get('ama_feldnummer') as string) || null,
    codes:                (formData.get('codes') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    aktiv:                true,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).insert(payload)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function updateWeingarten(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: AnyRecord = {
    name:                 formData.get('name') as string,
    ama_feldnummer:       (formData.get('ama_feldnummer') as string) || null,
    codes:                (formData.get('codes') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    aktiv:                formData.get('aktiv') === 'true',
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function deactivateWeingarten(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).update({ aktiv: false }).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function deleteWeingarten(id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    if (!tenantId) return { error: 'Kein Betrieb gefunden' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('weingarten') as any).delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) {
      const err = error as AnyRecord
      // Postgres 23503 = Foreign-Key-Verletzung, z.B. wenn noch Pressungen
      // (Lese/Pressvorgänge, siehe Migration 018) auf dieses Ried verweisen –
      // pressungen.weingarten_id hat bewusst kein "on delete cascade/set null",
      // damit ein Pressvorgang nie stillschweigend seinen Ried-Bezug verliert.
      if (err.code === '23503' || /foreign key/i.test(String(err.message ?? ''))) {
        return {
          error: 'Dieser Ried kann nicht gelöscht werden, da noch verknüpfte Daten vorhanden sind ' +
            '(z. B. Pressungen/Lese). Bitte zuerst diese Datensätze entfernen oder den Ried stattdessen ' +
            'deaktivieren statt löschen.',
        }
      }
      return { error: err.message }
    }
    revalidatePath('/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen des Rieds' }
  }
}

// ── Grundstücke ─────────────────────────────────────────────────────────────────────────────────

export async function createGrundstueck(weingartenId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  // Rückmeldung 24.8.2026: "status" wird nicht mehr gepflegt (abgelöst durch
  // "nutzart") - bewusst NICHT mehr aus formData gelesen/geschrieben, das
  // Formular hat kein Status-Feld mehr. spritzbar leitet sich jetzt aus
  // nutzart==='WI' ab (vorher status==='aktiv') - steuert Ernte-Meldung,
  // Behandlungsplanung, KI-Assistent-Validierung und Zukauf-Flächensumme.
  const nutzart = formData.get('nutzart') as string
  if (!nutzart) throw new Error('Nutzart ist ein Pflichtfeld')
  const payload: AnyRecord = {
    tenant_id:             tenantId,
    weingarten_id:         weingartenId,
    gst_nr:                formData.get('gst_nr') as string,
    katastralgemeinde:     (formData.get('katastralgemeinde') as string) || null,
    einlagezahl:           (formData.get('einlagezahl') as string) || null,
    ama_feldnummer:        (formData.get('ama_feldnummer') as string) || null,
    kg_bezeichnung:        (formData.get('kg_bezeichnung') as string) || null,
    boden:                 (formData.get('boden') as string) || null,
    rechtsverhaeltnis:     (formData.get('rechtsverhaeltnis') as string) || null,
    unterlagsrebe:         (formData.get('unterlagsrebe') as string) || null,
    rebsorte:              (formData.get('rebsorte') as string) || null,
    pflanzjahr:            formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
    weinart:               (formData.get('weinart') as string) || null,
    bewirtschaftung:       (formData.get('bewirtschaftung') as string) || null,
    bewirtschaftung_seit:  (formData.get('bewirtschaftung_seit') as string) || null,
    flaeche_ha:            formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
    flaeche_ha_kataster:   formData.get('flaeche_ha_kataster') ? Number(formData.get('flaeche_ha_kataster')) : null,
    trauben_herkunft_code: (formData.get('trauben_herkunft_code') as string) || null,
    nutzart,
    spritzbar:             nutzart === 'WI',
    notizen:               (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('grundstuecke') as any).insert(payload)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
}

export async function updateGrundstueck(id: string, weingartenId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')
  // Rückmeldung 24.8.2026: "status" wird nicht mehr gepflegt, siehe
  // createGrundstueck weiter oben.
  const nutzart = formData.get('nutzart') as string
  if (!nutzart) throw new Error('Nutzart ist ein Pflichtfeld')
  const payload: AnyRecord = {
    gst_nr:                formData.get('gst_nr') as string,
    katastralgemeinde:     (formData.get('katastralgemeinde') as string) || null,
    einlagezahl:           (formData.get('einlagezahl') as string) || null,
    ama_feldnummer:        (formData.get('ama_feldnummer') as string) || null,
    kg_bezeichnung:        (formData.get('kg_bezeichnung') as string) || null,
    boden:                 (formData.get('boden') as string) || null,
    rechtsverhaeltnis:     (formData.get('rechtsverhaeltnis') as string) || null,
    unterlagsrebe:         (formData.get('unterlagsrebe') as string) || null,
    rebsorte:              (formData.get('rebsorte') as string) || null,
    pflanzjahr:            formData.get('pflanzjahr') ? Number(formData.get('pflanzjahr')) : null,
    weinart:               (formData.get('weinart') as string) || null,
    bewirtschaftung:       (formData.get('bewirtschaftung') as string) || null,
    bewirtschaftung_seit:  (formData.get('bewirtschaftung_seit') as string) || null,
    flaeche_ha:            formData.get('flaeche_ha') ? Number(formData.get('flaeche_ha')) : null,
    flaeche_ha_kataster:   formData.get('flaeche_ha_kataster') ? Number(formData.get('flaeche_ha_kataster')) : null,
    trauben_herkunft_code: (formData.get('trauben_herkunft_code') as string) || null,
    nutzart,
    spritzbar:             nutzart === 'WI',
    notizen:               (formData.get('notizen') as string) || null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('grundstuecke') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
  revalidatePath(`/weingarten/${weingartenId}`)
}

export async function deleteGrundstueck(id: string, weingartenId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('grundstuecke') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
  revalidatePath(`/weingarten/${weingartenId}`)
}

// ── BEV Kataster-API ────────────────────────────────────────────────────────────────────────────

export type BevNutzung = { ns: string; nutzung: string; ha: number }
export type BevResult = {
  ok: true; ha: number
  nutzungen: BevNutzung[]
} | {
  ok: false; message: string
  alleNutzungen?: BevNutzung[]  // gefüllt wenn GST gefunden aber kein ns=53
}

export async function fetchBevFlaeche(kgnr: string, gstNr: string): Promise<BevResult> {
  if (!kgnr || !gstNr) return { ok: false, message: 'KGNr und GST-Nr erforderlich' }
  try {
    // KGNr auf 5 Stellen padden (z.B. "4023" → "04023")
    const paddedKgnr = kgnr.padStart(5, '0')
    // Slash in GST-Nr ist ein echter Pfad-Trenner, NICHT url-encodieren
    const url = 'https://kataster.bev.gv.at/api/gst/' + paddedKgnr + '/' + gstNr
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return { ok: false, message: 'BEV-API Fehler: ' + res.status }
    const data = await res.json() as Record<string, unknown>
    if ('message' in data) return { ok: false, message: String(data.message) }
    type RawNutzung = { ns: string; nutzung: string; fl: number }
    const props = (data.properties as { nutzungen?: RawNutzung[] } | undefined)
    const alleRaw: RawNutzung[] = props?.nutzungen ?? []
    const toNutzung = (n: RawNutzung): BevNutzung => ({ ns: String(n.ns), nutzung: n.nutzung, ha: Math.round(n.fl) / 10000 })
    // Nur Weingärten (Nutzungsschlüssel ns=53)
    const weingarten = alleRaw.filter(n => String(n.ns) === '53')
    if (weingarten.length === 0) {
      return {
        ok: false,
        message: 'Keine Weingarten-Nutzung (ns=53) – Nutzungsaufschlüsselung:',
        alleNutzungen: alleRaw.map(toNutzung),
      }
    }
    const totalM2 = weingarten.reduce((s, n) => s + (n.fl ?? 0), 0)
    return {
      ok: true,
      ha: Math.round(totalM2) / 10000,
      nutzungen: weingarten.map(toNutzung),
    }
  } catch {
    return { ok: false, message: 'BEV-API nicht erreichbar' }
  }
}
