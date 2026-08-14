'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen/ersten
// tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft Daten des falschen
// Betriebs gelesen/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

// EROEFFNUNGSBESTAND

// Gemeinsame Einfuegelogik fuer Eroeffnungsbestand-Chargen - wird sowohl von der
// "normalen" Erfassung (Kellerbuch > Gebinde > Eroeffnungsbestand) als auch von der
// Anfangsbestandsbuchung im Datenimport (Gebinde) verwendet ("Chargenformular recyceln").
// Gibt bei Erfolg null zurueck, sonst die Fehlermeldung.
async function insertEroeffnungsbestand(formData: FormData): Promise<string | null> {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const menge     = parseFloat(formData.get('menge_liter') as string)
  const jahr      = new Date().getFullYear()

  const epRaw = (formData.get('einstandspreis_pro_liter') as string)?.replace(',', '.') ?? ''
  // Transaktionsnummer vergeben
  const { data: txnEb } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'eroeffnung' })

  const payload: R = {
    tenant_id:            tenantId,
    name:                 formData.get('name') as string,
    jahrgang:             parseInt(formData.get('jahrgang') as string) || null,
    kmw:                  parseFloat(formData.get('kmw') as string) || null,
    menge_liter:          menge,
    anfangsbestand_liter: menge,
    qualitaetsstufe:      (formData.get('qualitaetsstufe') as string) || null,
    behaelter_id:         (formData.get('behaelter_id') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: epRaw ? parseFloat(epRaw) : null,
    referenz_altsystem:   (formData.get('referenz_altsystem') as string) || null,
    transaktions_nr:      txnEb ?? null,
    status:               'ausbau',
    ist_eroeffnungsbestand: true,
    created_at:           new Date(`${jahr}-01-01T00:00:00`).toISOString(),
    aktiv:                true,
  }

  const { error } = await (supabase.from('weinausbau') as any).insert(payload)
  if (error) {
    console.error('[insertEroeffnungsbestand] DB Fehler:', (error as R).message, (error as R).code)
    return (error as R).message
  }
  revalidatePath('/kellerbuch/gebinde')
  return null
}

export async function createEroeffnungsbestand(formData: FormData) {
  const fehler = await insertEroeffnungsbestand(formData)
  if (fehler) {
    redirect(`/kellerbuch/gebinde?tab=eroeffnungsbestand&err=${encodeURIComponent(fehler)}`)
  }
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

// Wie createEroeffnungsbestand, aber fuer die Anfangsbestandsbuchung innerhalb des
// Datenimport-Menuepunkts (Gebinde) - fuehrt nach dem Speichern zurueck zum Datenimport
// statt zum Kellerbuch. Diese Buchungsmoeglichkeit wird bewusst NUR dort angeboten.
export async function createEroeffnungsbestandVonImport(formData: FormData) {
  const fehler = await insertEroeffnungsbestand(formData)
  if (fehler) {
    redirect(`/admin/import?typ=gebinde&err=${encodeURIComponent(fehler)}`)
  }
  redirect('/admin/import?typ=gebinde&eb=1')
}

export async function updateEroeffnungsbestand(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const menge    = parseFloat(formData.get('menge_liter') as string)

  const epRaw2 = (formData.get('einstandspreis_pro_liter') as string)?.replace(',', '.') ?? ''
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        parseInt(formData.get('jahrgang') as string) || null,
    kmw:             parseFloat(formData.get('kmw') as string) || null,
    menge_liter:     menge,
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: epRaw2 ? parseFloat(epRaw2) : null,
    referenz_altsystem: (formData.get('referenz_altsystem') as string) || null,
  }

  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) {
    console.error('[updateEroeffnungsbestand] DB Fehler:', (error as R).message)
    redirect(`/kellerbuch/gebinde?tab=eroeffnungsbestand&err=${encodeURIComponent((error as R).message)}`)
  }
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

export async function deleteEroeffnungsbestand(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('weinausbau') as any)
    .update({ aktiv: false })
    .eq('id', id)
    .eq('ist_eroeffnungsbestand', true)
    .eq('tenant_id', tenantId)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch/gebinde')
}

// UMZIEHEN

export async function createUmzug(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const datum    = formData.get('datum') as string
  const notizen  = (formData.get('notizen') as string) || null

  type Quelle = { weinausbau_id: string; brutto: number }
  type Ziel   = { behaelter_id: string; menge_netto: number }

  const quellenRaw = JSON.parse((formData.get('quellen_json') as string) || '[]') as Quelle[]
  const zieleRaw   = JSON.parse((formData.get('ziele_json')   as string) || '[]') as Ziel[]

  const quellen = quellenRaw.filter(q => q.weinausbau_id && q.brutto > 0)
  const ziele   = zieleRaw.filter(z => z.behaelter_id && z.menge_netto > 0)

  if (quellen.length === 0 || ziele.length === 0) {
    throw new Error('Bitte mindestens eine Quelle und ein Ziel angeben.')
  }

  const batchId = crypto.randomUUID()

  // Transaktionsnummer für diesen Umzugs-Batch
  const { data: txnKu } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'umzug' })

  // --- Quellen verarbeiten ---
  const quelleData: R[] = []
  for (let qi = 0; qi < quellen.length; qi++) {
    const q = quellen[qi]

    const { data: waRaw } = await (supabase.from('weinausbau') as any)
      .select('*').eq('id', q.weinausbau_id).eq('tenant_id', tenantId).single()
    const wa = waRaw as R
    const verfuegbar = parseFloat(wa?.menge_liter ?? '0') || 0

    if (q.brutto > verfuegbar + 0.01) {
      throw new Error(
        `Brutto (${q.brutto.toLocaleString('de-AT', { maximumFractionDigits: 2 })} L) für Charge "${wa?.name}" übersteigt Bestand (${verfuegbar.toLocaleString('de-AT', { maximumFractionDigits: 2 })} L)`
      )
    }
    quelleData.push(wa)

    // Bestand reduzieren
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: Math.max(0, verfuegbar - q.brutto) })
      .eq('id', q.weinausbau_id)
      .eq('tenant_id', tenantId)

    // Quelle-Record anlegen
    const { error: qErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:         tenantId,
      von_weinausbau_id: q.weinausbau_id,
      von_behaelter_id:  wa?.behaelter_id ?? null,
      datum,
      brutto_liter:      q.brutto,
      menge_liter:       q.brutto,
      schwund_liter:     0,
      notizen:           qi === 0 ? notizen : null,
      transaktions_nr:   qi === 0 ? (txnKu ?? null) : null,
      umzug_batch_id:    batchId,
      zeilen_typ:        'quelle',
    })
    if (qErr) throw new Error((qErr as R).message)
  }

  // --- Ziele verarbeiten ---
  // Lot-Metadaten (Name, Jahrgang, …) von der ersten Quelle übernehmen
  const hauptQuelle = quelleData[0]

  for (const z of ziele) {
    // Bestehendes Lot im Ziel-Gebinde suchen (Name + Jahrgang).
    // WICHTIG: .eq('jahrgang', null) matched bei PostgREST NIE echte NULL-Werte – für
    // Chargen ohne Jahrgang (z.B. NV-Cuvées) muss .is() verwendet werden, sonst wird
    // nie das bestehende Lot gefunden und stattdessen jedes Mal ein neues angelegt.
    let existingQuery = (supabase.from('weinausbau') as any)
      .select('id, menge_liter, rebsorte')
      .eq('behaelter_id', z.behaelter_id)
      .eq('name', hauptQuelle?.name ?? '')
      .eq('aktiv', true)
      .eq('tenant_id', tenantId)
    existingQuery = (hauptQuelle?.jahrgang == null)
      ? existingQuery.is('jahrgang', null)
      : existingQuery.eq('jahrgang', hauptQuelle.jahrgang)
    const { data: existingArr } = await existingQuery.limit(1)
    let existing: R | null = ((existingArr ?? []) as R[])[0] ?? null

    // Rebsortenmix-Schutz: nicht blind in ein Lot mit anderer Rebsorte mischen (wie umziehen()
    // es für den normalen "neuer Umzug"-Weg bereits verhindert) – sonst würde beim Bearbeiten
    // eines Umzugs eine Verschneidung ohne Verschneidungs-Workflow/Kennzeichnung entstehen.
    if (existing && hauptQuelle?.rebsorte && existing.rebsorte && existing.rebsorte !== hauptQuelle.rebsorte) {
      existing = null
    }
    let nachWeinausbauId: string | null = null

    if (existing) {
      const altMenge = parseFloat(existing.menge_liter) || 0
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: altMenge + z.menge_netto })
        .eq('id', existing.id)
        .eq('tenant_id', tenantId)
      nachWeinausbauId = existing.id
    } else {
      const { data: neu } = await (supabase.from('weinausbau') as any)
        .insert({
          tenant_id:            tenantId,
          name:                 hauptQuelle?.name ?? 'Unbekannt',
          jahrgang:             hauptQuelle?.jahrgang ?? null,
          rebsorte:             hauptQuelle?.rebsorte ?? null,
          qualitaetsstufe:      hauptQuelle?.qualitaetsstufe ?? null,
          status:               hauptQuelle?.status ?? 'ausbau',
          behaelter_id:         z.behaelter_id,
          menge_liter:          z.menge_netto,
          anfangsbestand_liter: null,
          notizen:              null,
          aktiv:                true,
        })
        .select('id').single()
      nachWeinausbauId = (neu as R | null)?.id ?? null
    }

    // Ziel-Record anlegen
    const { error: zErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:          tenantId,
      nach_behaelter_id:  z.behaelter_id,
      nach_weinausbau_id: nachWeinausbauId,
      datum,
      menge_liter:        z.menge_netto,
      schwund_liter:      0,
      brutto_liter:       null,
      notizen:            null,
      umzug_batch_id:     batchId,
      zeilen_typ:         'ziel',
    })
    if (zErr) throw new Error((zErr as R).message)
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
}

export async function updateUmzugBatch(firstRecordId: string, formData: FormData) {
  // Alten Batch loeschen (Bestaende werden wiederhergestellt)
  await deleteUmzug(firstRecordId)
  // Neuen Batch anlegen
  await createUmzug(formData)
  redirect('/kellerbuch/gebinde?tab=umziehen')
}

export async function deleteUmzug(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Datensatz laden
  const { data: u } = await (supabase.from('keller_umzuege') as any)
    .select('von_weinausbau_id, umzug_batch_id, brutto_liter, menge_liter, schwund_liter, zeilen_typ')
    .eq('id', id).eq('tenant_id', tenantId).single()
  const rec     = u as R | null
  const batchId = rec?.umzug_batch_id

  // Alle Batch-Zeilen laden
  let batchRecs: R[] = []
  if (batchId) {
    const { data: batch } = await (supabase.from('keller_umzuege') as any)
      .select('id, zeilen_typ, von_weinausbau_id, nach_weinausbau_id, brutto_liter, menge_liter, schwund_liter')
      .eq('umzug_batch_id', batchId).eq('tenant_id', tenantId)
    batchRecs = (batch ?? []) as R[]
  } else {
    batchRecs = rec ? [rec] : []
  }

  const isNewFormat = batchRecs.some((r: R) => r.zeilen_typ === 'quelle' || r.zeilen_typ === 'ziel')

  if (isNewFormat) {
    // Neues Format: Quellen wiederherstellen + Ziele rueckbuchen
    for (const r of batchRecs.filter((r: R) => r.zeilen_typ === 'quelle')) {
      if (!r.von_weinausbau_id) continue
      const brutto = parseFloat(r.brutto_liter) || 0
      if (brutto <= 0) continue
      const { data: wa } = await (supabase.from('weinausbau') as any)
        .select('menge_liter').eq('id', r.von_weinausbau_id).eq('tenant_id', tenantId).single()
      const aktuell = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: aktuell + brutto }).eq('id', r.von_weinausbau_id).eq('tenant_id', tenantId)
    }
    for (const r of batchRecs.filter((r: R) => r.zeilen_typ === 'ziel')) {
      if (!r.nach_weinausbau_id) continue
      const netto = parseFloat(r.menge_liter) || 0
      if (netto <= 0) continue
      const { data: wa } = await (supabase.from('weinausbau') as any)
        .select('menge_liter').eq('id', r.nach_weinausbau_id).eq('tenant_id', tenantId).single()
      const aktuell = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: Math.max(0, aktuell - netto) }).eq('id', r.nach_weinausbau_id).eq('tenant_id', tenantId)
    }
  } else {
    // Altes Format (transfer): Quell-Charge wiederherstellen
    const vonId = batchRecs[0]?.von_weinausbau_id
    if (vonId) {
      const hauptRec = batchRecs.find((r: R) => r.brutto_liter != null) ?? batchRecs[0]
      const bruttoZurueck = parseFloat(hauptRec?.brutto_liter ?? '0') ||
        batchRecs.reduce((s: number, r: R) =>
          s + (parseFloat(r.menge_liter) || 0) + (parseFloat(r.schwund_liter) || 0), 0)
      if (bruttoZurueck > 0) {
        const { data: wa } = await (supabase.from('weinausbau') as any)
          .select('menge_liter').eq('id', vonId).eq('tenant_id', tenantId).single()
        const aktuell = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
        await (supabase.from('weinausbau') as any)
          .update({ menge_liter: aktuell + bruttoZurueck }).eq('id', vonId).eq('tenant_id', tenantId)
      }
    }
  }

  // Alle Batch-Zeilen loeschen
  if (batchId) {
    const { error } = await (supabase.from('keller_umzuege') as any)
      .delete().eq('umzug_batch_id', batchId).eq('tenant_id', tenantId)
    if (error) throw new Error((error as R).message)
  } else {
    const { error } = await (supabase.from('keller_umzuege') as any)
      .delete().eq('id', id).eq('tenant_id', tenantId)
    if (error) throw new Error((error as R).message)
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
}
