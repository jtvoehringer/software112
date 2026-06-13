'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { minQualitaet, istNiedrigerAls } from '@/lib/weinqualitaet'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getTenantId(): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data } = await supabase.from('tenant_memberships').select('tenant_id').limit(1).single()
  return (data as R | null)?.tenant_id ?? null
}

// BEHAELTER
export async function createBehaelter(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const payload: R = {
    tenant_id:     tenantId,
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    aktiv:         true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).insert(payload)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

export async function updateBehaelter(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const payload: R = {
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number((formData.get('volumen_liter') as string).replace(',', '.')) : null,
    standort:      (formData.get('standort') as string) || null,
    aktiv:         formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch')
}

// WEINAUSBAU
export async function createWeinausbau(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const payload: R = {
    tenant_id:       tenantId,
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:          formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    anfangsbestand_liter: formData.get('menge_liter') ? Number((formData.get('menge_liter') as string).replace(',', '.')) : null,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    status:               (formData.get('status') as string) || 'ernte',
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newWA, error } = await (supabase.from('weinausbau') as any).insert(payload).select('id').single()
  if (error) throw new Error((error as R).message)
  // Junction-Tabelle: Rieden/Weingärten verknüpfen
  if (wgIds.length > 0 && (newWA as R)?.id) {
    const waId = (newWA as R).id as string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau_weingaerten') as any).insert(
      wgIds.map(wgId => ({ tenant_id: tenantId, weinausbau_id: waId, weingarten_id: wgId }))
    )
  }
  revalidatePath('/kellerbuch')
}

export async function updateWeinausbau(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const neueMenge = formData.get('menge_liter')
    ? Number((formData.get('menge_liter') as string).replace(',', '.'))
    : null
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(formData.get('jahrgang')) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:     neueMenge,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    status:               formData.get('status') as string,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number((formData.get('einstandspreis_pro_liter') as string).replace(',', '.'))
      : null,
    aktiv:           formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id)
  if (error) throw new Error((error as R).message)

  // Junction-Tabelle: Rieden/Weingärten neu setzen (delete + insert)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('weinausbau_weingaerten') as any).delete().eq('weinausbau_id', id)
  if (wgIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau_weingaerten') as any).insert(
      wgIds.map(wgId => ({ tenant_id: tenantId, weinausbau_id: id, weingarten_id: wgId }))
    )
  }

  // KEIN Sync auf pressung_behaelter.menge_liter – das ist der historische Pressbetrag
  // und darf nicht mit dem laufenden Bestand überschrieben werden.

  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
}

// ANALYSEN
export async function createAnalyse(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const weinausbauId = formData.get('weinausbau_id') as string
  if (!weinausbauId) throw new Error('Keine Charge angegeben')

  function numOrNull(key: string): number | null {
    const v = (formData.get(key) as string)?.replace(',', '.').trim()
    if (!v) return null
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  const payload: R = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    analyse_datum:        formData.get('analyse_datum') as string,
    labor:                (formData.get('labor') as string) || null,
    probe_nr:             (formData.get('probe_nr') as string) || null,
    alkohol_vol:          numOrNull('alkohol_vol'),
    restzucker_gl:        numOrNull('restzucker_gl'),
    gesamtsaeure_gl:      numOrNull('gesamtsaeure_gl'),
    ph_wert:              numOrNull('ph_wert'),
    // Spaltenname im DB hat Umlaut – via Alias im Formular (fluechtige_saeure_gl)
    'flüchtige_saeure_gl': numOrNull('fluechtige_saeure_gl'),
    freie_so2_mgl:        numOrNull('freie_so2_mgl'),
    gesamt_so2_mgl:       numOrNull('gesamt_so2_mgl'),
    bewertung:            (formData.get('bewertung') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinanalysen') as any).insert(payload)
  if (error) throw new Error((error as R).message)

  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/analysen`)
  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/buch`)
}

// VERSCHNEIDUNG
export async function createVerschneidung(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const datum        = formData.get('datum') as string
  const zielId       = formData.get('ziel_weinausbau_id') as string
  const notizen      = (formData.get('notizen') as string) || null
  const quellenJson  = formData.get('quellen_json') as string
  const quellen: { weinausbau_id: string; menge_liter: number }[] = JSON.parse(quellenJson || '[]')

  if (!datum || !zielId || quellen.length === 0) throw new Error('Pflichtfelder fehlen')

  // Qualitätsstufe der Ziel-Charge vor Verschneidung sichern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: zielVorher } = await (supabase.from('weinausbau') as any)
    .select('qualitaetsstufe').eq('id', zielId).single()
  const zielQualitaetVorher = (zielVorher as R | null)?.qualitaetsstufe ?? null

  // Verschneidungs-Datensatz anlegen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error: ve } = await (supabase.from('verschneidungen') as any)
    .insert({ tenant_id: tenantId, datum, ziel_weinausbau_id: zielId, notizen, ziel_qualitaet_vorher: zielQualitaetVorher })
    .select('id').single()
  if (ve) throw new Error((ve as R).message)
  const vId = (neu as R).id as string

  // Quellen anlegen + anteil_pct berechnen
  const gesamtLiter = quellen.reduce((s, q) => s + q.menge_liter, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('verschneidung_quellen') as any).insert(
    quellen.map(q => ({
      verschneidung_id:    vId,
      quell_weinausbau_id: q.weinausbau_id,
      menge_liter:         q.menge_liter,
      anteil_pct:          gesamtLiter > 0 ? Math.round((q.menge_liter / gesamtLiter) * 1000) / 10 : null,
    }))
  )

  // Ziel-Charge: Bestand um die Summe der Quellen erhöhen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ziel } = await (supabase.from('weinausbau') as any)
    .select('menge_liter').eq('id', zielId).single()
  const aktuell = parseFloat((ziel as R)?.menge_liter ?? '0') || 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('weinausbau') as any)
    .update({ menge_liter: aktuell + gesamtLiter })
    .eq('id', zielId)

  // Quell-Chargen: Bestand reduzieren
  for (const q of quellen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: src } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', q.weinausbau_id).single()
    const srcLiter = parseFloat((src as R)?.menge_liter ?? '0') || 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: Math.max(0, srcLiter - q.menge_liter) })
      .eq('id', q.weinausbau_id)
  }

  // Qualitäts-Abstufung: niedrigste Qualitätsstufe aller beteiligten Chargen gewinnt
  const quelleIds = quellen.map(q => q.weinausbau_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: alleChargenQ } = await (supabase.from('weinausbau') as any)
    .select('id, qualitaetsstufe')
    .in('id', [zielId, ...quelleIds])
  if (alleChargenQ && (alleChargenQ as R[]).length > 0) {
    const stufen = (alleChargenQ as R[]).map((c: R) => c.qualitaetsstufe as string | null)
    const zielQ = (alleChargenQ as R[]).find((c: R) => c.id === zielId)?.qualitaetsstufe ?? null
    const minQ = minQualitaet(stufen)
    if (minQ && zielQ && istNiedrigerAls(zielQ, minQ)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('weinausbau') as any)
        .update({ qualitaetsstufe: minQ })
        .eq('id', zielId)
    }
  }

  revalidatePath('/kellerbuch')
  quellen.forEach(q => revalidatePath(`/kellerbuch/weinausbau/${q.weinausbau_id}/buch`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)
}

// VERSCHNEIDUNG STORNIEREN
export async function deleteVerschneidung(verschneidungId: string) {
  const supabase = await createSupabaseServerClient()

  // Quellen + Mengen laden bevor gelöscht wird
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vRaw } = await (supabase.from('verschneidungen') as any)
    .select('id, ziel_weinausbau_id, ziel_qualitaet_vorher, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter)')
    .eq('id', verschneidungId)
    .single()
  if (!vRaw) throw new Error('Verschneidung nicht gefunden')
  const v = vRaw as R

  const zielId = v.ziel_weinausbau_id as string
  const quellen = (v.quellen ?? []) as R[]
  const gesamtLiter = quellen.reduce((s: number, q: R) => s + (parseFloat(q.menge_liter) || 0), 0)

  // Ziel-Charge: Bestand wieder reduzieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ziel } = await (supabase.from('weinausbau') as any)
    .select('menge_liter').eq('id', zielId).single()
  const zielAkt = parseFloat((ziel as R)?.menge_liter ?? '0') || 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('weinausbau') as any)
    .update({ menge_liter: Math.max(0, zielAkt - gesamtLiter) })
    .eq('id', zielId)

  // Quell-Chargen: Menge wieder gutschreiben
  for (const q of quellen) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: src } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', q.quell_weinausbau_id).single()
    const srcAkt = parseFloat((src as R)?.menge_liter ?? '0') || 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: srcAkt + (parseFloat(q.menge_liter) || 0) })
      .eq('id', q.quell_weinausbau_id)
  }

  // Qualitätsstufe wiederherstellen falls gespeichert
  const zielQualitaetVorher = (vRaw as R).ziel_qualitaet_vorher as string | null
  if (zielQualitaetVorher) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({ qualitaetsstufe: zielQualitaetVorher })
      .eq('id', zielId)
  }

  // Datensatz löschen (CASCADE löscht verschneidung_quellen automatisch)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('verschneidungen') as any)
    .delete().eq('id', verschneidungId)
  if (error) throw new Error((error as R).message)

  revalidatePath('/kellerbuch')
  quellen.forEach((q: R) => revalidatePath(`/kellerbuch/weinausbau/${q.quell_weinausbau_id}`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
}

// MANUELLER SCHWUND
// Bucht einen Schwund-Abgang als keller_umzug mit umzug_typ='schwund'.
// brutto_liter = Schwundmenge, menge_liter = 0 → kein Nettozugang im Zielbehälter.
// Erscheint im Bewegungsbuch als Abgang mit Icon 💧 und Beschreibung "Schwund / Verlust".

export async function manuellSchwundBuchen(formData: FormData) {
  const supabase     = await createSupabaseServerClient()
  const tenantId     = await getTenantId()
  if (!tenantId) throw new Error('Kein Betrieb gefunden')

  const behaelterId  = formData.get('behaelter_id')  as string
  const weinausbauId = formData.get('weinausbau_id') as string
  const menge        = parseFloat((formData.get('menge') as string)?.replace(',', '.') || '0')
  const datum        = formData.get('datum') as string

  if (!behaelterId || !weinausbauId || menge <= 0 || !datum) {
    throw new Error('Ungültige Eingabe: alle Felder sind erforderlich')
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('keller_umzuege') as any).insert({
    tenant_id:         tenantId,
    von_weinausbau_id: weinausbauId,
    nach_behaelter_id: behaelterId,  // Pflichtfeld – selber Behälter, menge_liter=0 → kein Zugang
    menge_liter:       0,
    brutto_liter:      menge,
    schwund_liter:     menge,
    datum,
    umzug_typ:         'schwund',
    notizen:           'Manueller Schwund',
  })

  if (error) throw new Error((error as R).message)

  revalidatePath(`/kellerbuch/behaelter/${behaelterId}/bewegungen`)
  revalidatePath('/kellerbuch')
}
