'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, getCurrentUserRole, canWrite } from '@/lib/auth/roles'
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

  const name = formData.get('name') as string
  const payload: AnyRecord = {
    tenant_id:            tenantId,
    name,
    // "ried" ist das Feld, nach dem die Rieden-Übersicht gruppiert
    // (WeingartenBaum.tsx) - ohne das würde eine neu angelegte Ried hier in
    // den "Rieden"-Auffangkorb für nicht zugeordnete Weingärten fallen statt
    // als eigene Gruppe mit ihrem Namen zu erscheinen.
    ried:                 name || null,
    ama_feldnummer:       (formData.get('ama_feldnummer') as string) || null,
    codes:                (formData.get('codes') as string) || null,
    interne_bezeichnung:  (formData.get('interne_bezeichnung') as string) || null,
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

  const name = formData.get('name') as string

  const payload: AnyRecord = {
    name,
    ama_feldnummer:       (formData.get('ama_feldnummer') as string) || null,
    codes:                (formData.get('codes') as string) || null,
    interne_bezeichnung:  (formData.get('interne_bezeichnung') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    aktiv:                formData.get('aktiv') === 'true',
  }

  // Rückmeldung 24.8.2026: Umbenennen einer Ried über das "Riedname"-Feld
  // aktualisierte bisher nur weingarten.name - die Rieden-Übersicht
  // (WeingartenBaum.tsx) gruppiert aber nach dem separaten Textfeld "ried",
  // das dadurch beim alten Namen blieb. Praktisch jeder bestehende
  // Weingarten-Datensatz ist über lage_id mit einer Zeile in "lagen"
  // verknüpft (der Kellerbuch-Altsystem-Import in api/import/route.ts setzt
  // lage_id und ried immer gemeinsam) - für diesen Fall wird beim Umbenennen
  // jetzt auch lagen.name mitgezogen und "ried" für ALLE Weingarten-
  // Datensätze dieser Lage aktualisiert (eine Ried kann aus mehreren
  // Weingarten-Datensätzen bestehen, siehe Kommentare in WeingartenBaum.tsx -
  // das Umbenennen betrifft dann bewusst die ganze Ried-Gruppe, nicht nur
  // diesen einen Datensatz). Nur bei Datensätzen ganz ohne Lage-Verknüpfung
  // wird "ried" direkt auf dieser Zeile mitgesetzt.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: existing } = await (supabase.from('weingarten') as any)
    .select('lage_id')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle()

  if (existing?.lage_id) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('lagen') as any)
      .update({ name })
      .eq('id', existing.lage_id).eq('tenant_id', tenantId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weingarten') as any)
      .update({ ried: name })
      .eq('lage_id', existing.lage_id).eq('tenant_id', tenantId)
  } else {
    payload.ried = name || null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weingarten') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AnyRecord).message)
  revalidatePath('/weingarten')
  revalidatePath('/lagen')
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

// Gemeinsame Fehlermeldung für FK-Verletzungen beim Löschen eines oder
// mehrerer Ried-Datensätze (weingarten). grundstuecke.weingarten_id hat "on
// delete cascade" (Migration 012) - GST-Zeilen werden also automatisch mit
// gelöscht, das braucht hier keinen eigenen Schritt. Blockieren können nur
// die Tabellen OHNE Cascade/Set-Null: pressungen.weingarten_id (Migration 018,
// Lese/Pressvorgänge) und traubenverkauf.weingarten_id (Migration 109).
function friendlyFkError(err: AnyRecord): string | null {
  if (err.code === '23503' || /foreign key/i.test(String(err.message ?? ''))) {
    return 'Dieser Ried kann nicht gelöscht werden, da noch verknüpfte Daten vorhanden sind ' +
      '(z. B. Pressungen/Lese oder Traubenverkauf). Bitte zuerst diese Datensätze entfernen oder den ' +
      'Ried stattdessen deaktivieren statt löschen.'
  }
  return null
}

export async function deleteWeingarten(id: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    if (!tenantId) return { error: 'Kein Betrieb gefunden' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('weingarten') as any).delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) {
      const friendly = friendlyFkError(error as AnyRecord)
      if (friendly) return { error: friendly }
      return { error: (error as AnyRecord).message }
    }
    revalidatePath('/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen des Rieds' }
  }
}

// Rückmeldung 24.8.2026: eine "echte" Ried (Lage) besteht in der Rieden-
// Übersicht oft aus mehreren weingarten-Datensätzen (deren GST-Zeilen dort
// flach zusammen unter einer Gruppe angezeigt werden, siehe LageGruppe in
// WeingartenBaum.tsx) - dafür gab es bisher gar keine Löschen-Möglichkeit,
// nur einzelne weingarten-Datensätze waren löschbar. Löscht alle
// weingarten-Zeilen der Gruppe in EINEM atomaren DELETE-Statement (entweder
// alle oder keine, z.B. falls eine davon noch verknüpfte Pressungen hat) -
// die zugehörigen grundstuecke-Zeilen werden dank "on delete cascade"
// automatisch mitgelöscht.
export async function deleteRied(weingartenIds: string[]): Promise<{ error?: string }> {
  try {
    if (weingartenIds.length === 0) return { error: 'Keine Weingarten-Datensätze zum Löschen übergeben' }
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    if (!tenantId) return { error: 'Kein Betrieb gefunden' }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('weingarten') as any)
      .delete()
      .in('id', weingartenIds)
      .eq('tenant_id', tenantId)
    if (error) {
      const friendly = friendlyFkError(error as AnyRecord)
      if (friendly) return { error: friendly }
      return { error: (error as AnyRecord).message }
    }
    revalidatePath('/weingarten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Löschen der Ried' }
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
    // Stückzahl (Bäume/Büsche) gehört nur zu Nutzart "LSE" - bewusst nur dann
    // aus formData übernehmen, sonst null (auch wenn das Feld aus einer alten
    // Eingabe technisch noch im FormData-Objekt hängen würde).
    lse_stueckzahl:        nutzart === 'LSE' && formData.get('lse_stueckzahl') ? Number(formData.get('lse_stueckzahl')) : null,
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
    lse_stueckzahl:        nutzart === 'LSE' && formData.get('lse_stueckzahl') ? Number(formData.get('lse_stueckzahl')) : null,
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

// ── Rieden-Koordinaten (Stufe 1, Migration 181) ───────────────────────────────
//
// Riedenebene: eine Ried kann aus mehreren weingarten-Zeilen bestehen (gleiche
// lage_id bzw. gleicher ried-Text, siehe Kommentare in WeingartenBaum.tsx).
// Der Pin wird deshalb auf ALLE Zeilen derselben Ried geschrieben – analog zum
// Umbenennen in updateWeingarten().
async function riedGeschwister(supabase: any, tenantId: string, weingartenId: string): Promise<string[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data: w } = await (supabase.from('weingarten') as any).select('id, lage_id, ried').eq('id', weingartenId).eq('tenant_id', tenantId).maybeSingle()
  if (!w) return []
  let q = (supabase.from('weingarten') as any).select('id').eq('tenant_id', tenantId)
  if (w.lage_id) q = q.eq('lage_id', w.lage_id)
  else if (w.ried) q = q.eq('ried', w.ried).is('lage_id', null)
  else return [w.id]
  const { data: rows } = await q
  const ids = ((rows ?? []) as { id: string }[]).map(r => r.id)
  return ids.length ? ids : [w.id]
}

export async function speichereRiedGeo(weingartenId: string, lat: number, lon: number): Promise<{ error?: string; anzahl?: number }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) return { error: 'Kein Betrieb gefunden' }
  const role = await getCurrentUserRole()
  if (!canWrite(role)) return { error: 'Keine Berechtigung' }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: 'Ungültige Koordinaten' }

  const ids = await riedGeschwister(supabase, tenantId, weingartenId)
  if (!ids.length) return { error: 'Ried nicht gefunden' }
  const { error } = await (supabase.from('weingarten') as any)
    .update({ zentrum_lat: Number(lat.toFixed(6)), zentrum_lon: Number(lon.toFixed(6)), geo_quelle: 'manuell', geo_stand: new Date().toISOString() })
    .in('id', ids).eq('tenant_id', tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/weingarten/${weingartenId}`); revalidatePath('/weingarten'); revalidatePath('/dashboard/weingarten')
  return { anzahl: ids.length }
}

export async function loescheRiedGeo(weingartenId: string): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) return { error: 'Kein Betrieb gefunden' }
  const role = await getCurrentUserRole()
  if (!canWrite(role)) return { error: 'Keine Berechtigung' }
  const ids = await riedGeschwister(supabase, tenantId, weingartenId)
  const { error } = await (supabase.from('weingarten') as any)
    .update({ zentrum_lat: null, zentrum_lon: null, geometrie: null, geo_quelle: null, geo_stand: null })
    .in('id', ids).eq('tenant_id', tenantId)
  if (error) return { error: error.message }
  revalidatePath(`/weingarten/${weingartenId}`); revalidatePath('/weingarten'); revalidatePath('/dashboard/weingarten')
  return {}
}
