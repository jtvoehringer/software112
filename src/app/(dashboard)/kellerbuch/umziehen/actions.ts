'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { minQualitaet } from '@/lib/wein/qualitaet'
import { deleteUmzug as _deleteUmzug } from '../gebinde-actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface QuelleInput { weinausbau_id: string; menge: number }
interface ZielInput   { behaelter_id: string;  menge: number }

export async function umziehen(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  const quellen:    QuelleInput[] = JSON.parse(fd.get('quellen_json') as string || '[]')
  const ziele:      ZielInput[]   = JSON.parse(fd.get('ziele_json')   as string || '[]')
  const notizen   = (fd.get('notizen')   as string) || null
  const datum     = (fd.get('datum')     as string) || new Date().toISOString().split('T')[0]
  const umzugTyp  = (fd.get('umzug_typ') as string) || 'normal'

  if (quellen.length === 0 || ziele.length === 0) throw new Error('Mindestens eine Quelle und ein Ziel erforderlich')

  const totalVon  = quellen.reduce((s, q) => s + q.menge, 0)
  const totalNach = ziele.reduce((s, z) => s + z.menge, 0)
  const schwund   = Math.max(0, +(totalVon - totalNach).toFixed(3))

  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  const tenantId = (membership as R)?.tenant_id

  const batchId = crypto.randomUUID()

  // ── Phase 1: Quellen validieren, reduzieren, Quelle-Records anlegen ──────────
  let minQualStufe: string | null = null
  const quellenDaten: R[] = []

  for (let i = 0; i < quellen.length; i++) {
    const q = quellen[i]

    const { data: vonRaw } = await (supabase.from('weinausbau') as any)
      .select('*').eq('id', q.weinausbau_id).single()
    const von = vonRaw as R
    if (!von) throw new Error('Charge nicht gefunden')

    const verfuegbar = parseFloat(von.menge_liter) || 0
    if (q.menge > verfuegbar + 0.01) {
      throw new Error(
        `„${von.name}": Menge (${q.menge.toLocaleString('de-AT')} L) überschreitet verfügbaren Bestand (${verfuegbar.toLocaleString('de-AT')} L)`
      )
    }

    quellenDaten.push(von)
    minQualStufe = minQualitaet(minQualStufe, von.qualitaetsstufe ?? null)

    // Bestand reduzieren / Charge abschließen
    const restmenge = Math.max(0, +(verfuegbar - q.menge).toFixed(3))
    if (restmenge <= 0.01) {
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
        .eq('id', q.weinausbau_id)
    } else {
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: restmenge })
        .eq('id', q.weinausbau_id)
    }

    // Quelle-Record (zeilen_typ = 'quelle') – ein Eintrag pro Quell-Charge
    const { error: qErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:         tenantId,
      datum,
      von_behaelter_id:  von.behaelter_id,
      von_weinausbau_id: q.weinausbau_id,
      brutto_liter:      q.menge,
      menge_liter:       q.menge,   // für quelle-Records: menge = brutto
      schwund_liter:     i === 0 ? schwund : 0,
      umzug_typ:         umzugTyp,
      qualitaet_vorher:  von.qualitaetsstufe ?? null,
      qualitaet_nachher: minQualStufe,
      verschnitt:        false,
      notizen:           i === 0 ? notizen : null,
      umzug_batch_id:    batchId,
      zeilen_typ:        'quelle',
    })
    if (qErr) throw new Error((qErr as R).message)
  }

  // ── Phase 2: Ziele befüllen, Ziel-Records anlegen ────────────────────────────
  for (const z of ziele) {
    const { data: vorhandenRaw } = await (supabase.from('weinausbau') as any)
      .select('*')
      .eq('behaelter_id', z.behaelter_id)
      .eq('aktiv', true)
      .neq('status', 'abgeschlossen')
      .maybeSingle()
    const vorhanden = vorhandenRaw as R | null

    let nachWeinausbauId: string | null = null

    if (vorhanden) {
      await (supabase.from('weinausbau') as any)
        .update({
          menge_liter:     +((vorhanden.menge_liter ?? 0) + z.menge).toFixed(3),
          qualitaetsstufe: minQualitaet(vorhanden.qualitaetsstufe ?? null, minQualStufe),
        })
        .eq('id', vorhanden.id)
      nachWeinausbauId = vorhanden.id
    } else {
      const von0 = quellenDaten[0]
      const { data: newChargeData } = await (supabase.from('weinausbau') as any).insert({
        tenant_id:            tenantId,
        name:                 quellenDaten.length > 1 ? 'Zusammenführung' : (von0?.name ?? 'Umzug'),
        jahrgang:             von0?.jahrgang ?? null,
        rebsorte:             von0?.rebsorte ?? null,
        weingarten_id:        von0?.weingarten_id ?? null,
        behaelter_id:         z.behaelter_id,
        menge_liter:          z.menge,
        anfangsbestand_liter: z.menge,
        qualitaetsstufe:      minQualStufe,
        status:               von0?.status ?? 'ausbau',
        notizen:              quellen.length > 1
          ? `Zusammengeführt aus ${quellen.length} Chargen`
          : `Umzug aus „${von0?.name ?? ''}"`,
        aktiv:                true,
      }).select('id')
      nachWeinausbauId = ((newChargeData as R[])?.[0] as R | undefined)?.id ?? null
    }

    // Ziel-Record (zeilen_typ = 'ziel') – ein Eintrag pro Ziel-Gebinde
    const { error: zErr } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:          tenantId,
      datum,
      nach_behaelter_id:  z.behaelter_id,
      nach_weinausbau_id: nachWeinausbauId,
      menge_liter:        z.menge,   // Netto für dieses Ziel
      schwund_liter:      0,
      brutto_liter:       null,
      umzug_typ:          umzugTyp,
      notizen:            null,
      umzug_batch_id:     batchId,
      zeilen_typ:         'ziel',
    })
    if (zErr) throw new Error((zErr as R).message)
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}

// ── Umzug löschen ────────────────────────────────────────────────────────────
// Wrapper um gebinde-actions.deleteUmzug – behandelt beide Formate (alt + neu)
export async function deleteUmzug(id: string) {
  return _deleteUmzug(id)
}

// ── Umzug Datum/Notizen aktualisieren ────────────────────────────────────────
export async function updateUmzug(umzugId: string, datum: string, notizen: string | null) {
  const supabase = await createSupabaseServerClient()
  await (supabase.from('keller_umzuege') as any)
    .update({ datum, notizen: notizen || null })
    .eq('id', umzugId)
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}
