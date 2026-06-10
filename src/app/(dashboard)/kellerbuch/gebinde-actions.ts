'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as R | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

// EROEFFNUNGSBESTAND

export async function createEroeffnungsbestand(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  const menge     = parseFloat(formData.get('menge_liter') as string)
  const jahr      = new Date().getFullYear()

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
    status:               'ausbau',
    ist_eroeffnungsbestand: true,
    created_at:           new Date(`${jahr}-01-01T00:00:00`).toISOString(),
    aktiv:                true,
  }

  const { error } = await (supabase.from('weinausbau') as any).insert(payload)
  if (error) {
    // Fehler sichtbar machen statt cryptic 500: Redirect mit Fehlermeldung
    console.error('[createEroeffnungsbestand] DB Fehler:', (error as R).message, (error as R).code)
    redirect(`/kellerbuch/gebinde?tab=eroeffnungsbestand&err=${encodeURIComponent((error as R).message)}`)
  }
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

export async function updateEroeffnungsbestand(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const menge    = parseFloat(formData.get('menge_liter') as string)

  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        parseInt(formData.get('jahrgang') as string) || null,
    kmw:             parseFloat(formData.get('kmw') as string) || null,
    menge_liter:     menge,
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    notizen:         (formData.get('notizen') as string) || null,
  }

  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id)
  if (error) {
    console.error('[updateEroeffnungsbestand] DB Fehler:', (error as R).message)
    redirect(`/kellerbuch/gebinde?tab=eroeffnungsbestand&err=${encodeURIComponent((error as R).message)}`)
  }
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=eroeffnungsbestand')
}

export async function deleteEroeffnungsbestand(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('weinausbau') as any)
    .update({ aktiv: false })
    .eq('id', id)
    .eq('ist_eroeffnungsbestand', true)
  if (error) throw new Error((error as R).message)
  revalidatePath('/kellerbuch/gebinde')
}

// UMZIEHEN

export async function createUmzug(formData: FormData) {
  const supabase   = await createSupabaseServerClient()
  const tenantId   = await getTenantId()
  const vonId      = formData.get('von_weinausbau_id') as string
  const vonGebinde = formData.get('von_behaelter_id') as string
  const brutto     = parseFloat(formData.get('brutto_liter') as string)
  const datum      = formData.get('datum') as string
  const notizen    = (formData.get('notizen') as string) || null

  type Ziel = { behaelter_id: string; menge_netto: number }
  const zieleRaw  = JSON.parse((formData.get('ziele_json') as string) || '[]') as Ziel[]
  const ziele     = zieleRaw.filter(z => z.behaelter_id && z.menge_netto > 0)

  if (!vonId || brutto <= 0 || ziele.length === 0) {
    throw new Error('Bitte Charge, Brutto-Menge und mindestens ein Ziel angeben.')
  }

  const sumNetto = ziele.reduce((s, z) => s + z.menge_netto, 0)
  const schwund  = Math.max(0, brutto - sumNetto)

  // Bestandsprüfung
  const { data: waRaw } = await (supabase.from('weinausbau') as any)
    .select('*').eq('id', vonId).single()
  const vonWein  = waRaw as R
  const verfuegbar = parseFloat(vonWein?.menge_liter ?? '0') || 0
  if (brutto > verfuegbar + 0.01) {
    throw new Error(`Brutto (${brutto} L) übersteigt Bestand (${verfuegbar} L)`)
  }

  const batchId = crypto.randomUUID()

  // Pro Ziel: Weinausbau-Lot anlegen/aufstocken + Umzug-Record
  for (let i = 0; i < ziele.length; i++) {
    const z = ziele[i]

    // Bestehendes Lot in Ziel-Gebinde (Name + Jahrgang) suchen
    const { data: existingArr } = await (supabase.from('weinausbau') as any)
      .select('id, menge_liter')
      .eq('behaelter_id', z.behaelter_id)
      .eq('name', vonWein.name)
      .eq('jahrgang', vonWein.jahrgang)
      .eq('aktiv', true)
      .limit(1)

    const existing = ((existingArr ?? []) as R[])[0] ?? null
    let nachWeinausbauId: string | null = null

    if (existing) {
      // Bestehende Charge im Ziel-Gebinde aufstocken
      const altMenge = parseFloat(existing.menge_liter) || 0
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: altMenge + z.menge_netto })
        .eq('id', existing.id)
      nachWeinausbauId = existing.id
    } else {
      // Neue Charge im Ziel-Gebinde anlegen (Kopie der Quell-Charge)
      const { data: neu } = await (supabase.from('weinausbau') as any)
        .insert({
          tenant_id:            tenantId,
          name:                 vonWein.name,
          jahrgang:             vonWein.jahrgang,
          rebsorte:             vonWein.rebsorte,
          qualitaetsstufe:      vonWein.qualitaetsstufe,
          status:               vonWein.status ?? 'ausbau',
          behaelter_id:         z.behaelter_id,
          menge_liter:          z.menge_netto,
          anfangsbestand_liter: null,
          notizen:              vonWein.notizen,
          aktiv:                true,
        })
        .select('id')
        .single()
      nachWeinausbauId = (neu as R | null)?.id ?? null
    }

    // Buchungszeile
    const { error } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:          tenantId,
      von_weinausbau_id:  vonId,
      von_behaelter_id:   vonGebinde || null,
      nach_behaelter_id:  z.behaelter_id,
      nach_weinausbau_id: nachWeinausbauId,
      datum,
      menge_liter:        z.menge_netto,
      schwund_liter:      i === 0 ? schwund : 0,
      brutto_liter:       i === 0 ? brutto  : null,
      notizen:            i === 0 ? notizen : null,
      umzug_batch_id:     batchId,
    })
    if (error) throw new Error((error as R).message)
  }

  // Quell-Charge: Bestand um Brutto reduzieren
  const neuMenge = Math.max(0, verfuegbar - brutto)
  await (supabase.from('weinausbau') as any)
    .update({ menge_liter: neuMenge })
    .eq('id', vonId)

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
}

export async function updateUmzug(id: string, formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const menge     = parseFloat(formData.get('menge_liter') as string)
  const schwund   = parseFloat(formData.get('schwund_liter') as string) || 0

  // Alte Werte laden
  const { data: alt } = await (supabase.from('keller_umzuege') as any)
    .select('menge_liter, schwund_liter, brutto_liter, von_weinausbau_id').eq('id', id).single()
  const altBrutto  = parseFloat((alt as R | null)?.brutto_liter ?? '0')
    || (parseFloat((alt as R | null)?.menge_liter ?? '0') + parseFloat((alt as R | null)?.schwund_liter ?? '0'))
  const vonId      = (alt as R | null)?.von_weinausbau_id

  const { error } = await (supabase.from('keller_umzuege') as any).update({
    datum:             formData.get('datum') as string,
    nach_behaelter_id: formData.get('nach_behaelter_id') as string,
    menge_liter:       menge,
    schwund_liter:     schwund,
    brutto_liter:      menge + schwund,
    notizen:           (formData.get('notizen') as string) || null,
  }).eq('id', id)
  if (error) throw new Error((error as R).message)

  // Bestandskorrektur: Quell-Charge um Differenz anpassen
  if (vonId && altBrutto !== menge + schwund) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', vonId).single()
    const aktuell  = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
    const neuMenge = Math.max(0, aktuell + altBrutto - (menge + schwund))
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: neuMenge }).eq('id', vonId)
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
  redirect('/kellerbuch/gebinde?tab=umziehen')
}

export async function deleteUmzug(id: string) {
  const supabase = await createSupabaseServerClient()

  // Datensatz laden
  const { data: u } = await (supabase.from('keller_umzuege') as any)
    .select('menge_liter, schwund_liter, brutto_liter, von_weinausbau_id, umzug_batch_id')
    .eq('id', id).single()
  const rec     = u as R | null
  const vonId   = rec?.von_weinausbau_id
  const batchId = rec?.umzug_batch_id

  // Brutto berechnen: brutto_liter direkt ODER menge + schwund (Altdaten)
  let bruttoZurueck = 0
  if (batchId) {
    // Ganzen Batch laden → brutto aus Hauptzeile
    const { data: batch } = await (supabase.from('keller_umzuege') as any)
      .select('brutto_liter, menge_liter, schwund_liter')
      .eq('umzug_batch_id', batchId)
    const recs = (batch ?? []) as R[]
    bruttoZurueck = recs.reduce((s, r) => s + (parseFloat(r.brutto_liter) || 0), 0)
    if (bruttoZurueck === 0) {
      bruttoZurueck = recs.reduce((s, r) =>
        s + (parseFloat(r.menge_liter) || 0) + (parseFloat(r.schwund_liter) || 0), 0)
    }
  } else {
    bruttoZurueck =
      (parseFloat(rec?.brutto_liter ?? '0') || 0) ||
      ((parseFloat(rec?.menge_liter ?? '0') || 0) + (parseFloat(rec?.schwund_liter ?? '0') || 0))
  }

  // Quell-Charge: Brutto zurückbuchen
  if (vonId && bruttoZurueck > 0) {
    const { data: wa } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', vonId).single()
    const aktuell = parseFloat((wa as R | null)?.menge_liter ?? '0') || 0
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: aktuell + bruttoZurueck }).eq('id', vonId)
  }

  // Alle Batch-Zeilen löschen (oder nur diesen Datensatz)
  if (batchId) {
    const { error } = await (supabase.from('keller_umzuege') as any)
      .delete().eq('umzug_batch_id', batchId)
    if (error) throw new Error((error as R).message)
  } else {
    const { error } = await (supabase.from('keller_umzuege') as any)
      .delete().eq('id', id)
    if (error) throw new Error((error as R).message)
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
}
