'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { minQualitaet } from '@/lib/wein/qualitaet'

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

  // -- Qualitätsminimum aller Quellen ermitteln + Menge validieren
  let minQualStufe: string | null = null
  const quellenDaten: R[] = []

  for (const q of quellen) {
    const { data: vonRaw } = await (supabase.from('weinausbau') as any)
      .select('*').eq('id', q.weinausbau_id).single()
    const von = vonRaw as R
    if (!von) throw new Error('Charge nicht gefunden')

    // Punkt 5: Behälterinhalt darf nicht überschritten werden
    const verfuegbar = parseFloat(von.menge_liter) || 0
    if (q.menge > verfuegbar + 0.01) {
      throw new Error(
        `„${von.name}": Menge (${q.menge.toLocaleString('de-AT')} L) überschreitet verfügbaren Bestand (${verfuegbar.toLocaleString('de-AT')} L)`
      )
    }

    quellenDaten.push(von)
    minQualStufe = minQualitaet(minQualStufe, von.qualitaetsstufe ?? null)
  }

  // -- Ziel-Charge vorab ermitteln (für nach_weinausbau_id in keller_umzuege)
  const primaryZielBehaelterId = ziele[0].behaelter_id
  const { data: preCheckRaw } = await (supabase.from('weinausbau') as any)
    .select('id')
    .eq('behaelter_id', primaryZielBehaelterId)
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .maybeSingle()
  let primaryNachWeinausbauId: string | null = (preCheckRaw as R | null)?.id ?? null

  // -- Quellen reduzieren / abschließen
  const insertedUmzugIds: string[] = []

  for (let i = 0; i < quellen.length; i++) {
    const q   = quellen[i]
    const von = quellenDaten[i]
    const restmenge = Math.max(0, +(((von.menge_liter ?? 0) - q.menge).toFixed(3)))
    const vollstaendig = restmenge <= 0.01

    if (vollstaendig) {
      // behaelter_id NICHT nullen → historischer Link bleibt erhalten
      // (Bewegungsbuch findet die Charge weiterhin via behaelter_id)
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: 0, aktiv: false, status: 'abgeschlossen' })
        .eq('id', q.weinausbau_id)
    } else {
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: restmenge })
        .eq('id', q.weinausbau_id)
    }

    // Protokoll
    // menge_liter = Netto (proportionaler Anteil am Zielvolumen)
    // brutto_liter = Brutto (was die Quelle tatsächlich verlässt)
    const nettoAnteil = +(totalNach * (q.menge / totalVon)).toFixed(3)

    const { data: umzugData } = await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:          tenantId,
      datum,
      von_behaelter_id:   von.behaelter_id,
      von_weinausbau_id:  q.weinausbau_id,
      nach_behaelter_id:  ziele[0].behaelter_id,
      nach_weinausbau_id: primaryNachWeinausbauId,
      menge_liter:        nettoAnteil,   // Netto = was beim Ziel ankommt
      brutto_liter:       q.menge,       // Brutto = was die Quelle verlässt
      schwund_liter:      i === 0 ? schwund : 0,
      verschnitt:         false,
      qualitaet_vorher:   von.qualitaetsstufe ?? null,
      qualitaet_nachher:  minQualStufe,
      umzug_typ:          umzugTyp,
      notizen,
    }).select('id')
    if (umzugData) {
      for (const u of (umzugData as R[])) insertedUmzugIds.push(u.id)
    }
  }

  // -- Ziele befüllen
  for (const z of ziele) {
    const { data: vorhandenRaw } = await (supabase.from('weinausbau') as any)
      .select('*')
      .eq('behaelter_id', z.behaelter_id)
      .eq('aktiv', true)
      .neq('status', 'abgeschlossen')
      .maybeSingle()
    const vorhanden = vorhandenRaw as R | null

    if (vorhanden) {
      await (supabase.from('weinausbau') as any)
        .update({
          menge_liter:     +((vorhanden.menge_liter ?? 0) + z.menge).toFixed(3),
          qualitaetsstufe: minQualitaet(vorhanden.qualitaetsstufe ?? null, minQualStufe),
        })
        .eq('id', vorhanden.id)
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

      const newId = ((newChargeData as R[])?.[0] as R | undefined)?.id ?? null

      if (newId && primaryNachWeinausbauId === null && insertedUmzugIds.length > 0) {
        await (supabase.from('keller_umzuege') as any)
          .update({ nach_weinausbau_id: newId })
          .in('id', insertedUmzugIds)
      }
    }
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}

// ── Umzug löschen (mit Mengen-Reversal) ─────────────────────────────────────

export async function deleteUmzug(umzugId: string) {
  const supabase = await createSupabaseServerClient()

  const { data: umzugRaw } = await (supabase.from('keller_umzuege') as any)
    .select('*').eq('id', umzugId).single()
  const umzug = umzugRaw as R | null
  if (!umzug) throw new Error('Umzug nicht gefunden')

  const umzugMenge   = parseFloat(umzug.menge_liter)  || 0
  const schwundMenge = parseFloat(umzug.schwund_liter) || 0

  // 1. Quell-Charge: Menge wiederherstellen + reaktivieren
  if (umzug.von_weinausbau_id) {
    const { data: vonRaw } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', umzug.von_weinausbau_id).single()
    if (vonRaw) {
      const restored = +((parseFloat((vonRaw as R).menge_liter) || 0) + umzugMenge + schwundMenge).toFixed(3)
      const vonUpdate: R = { menge_liter: restored, aktiv: true }
      if (umzug.von_behaelter_id) vonUpdate.behaelter_id = umzug.von_behaelter_id
      await (supabase.from('weinausbau') as any)
        .update(vonUpdate)
        .eq('id', umzug.von_weinausbau_id)
    }
  }

  // 2. Ziel-Charge: Menge reduzieren
  if (umzug.nach_weinausbau_id) {
    const { data: nachRaw } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('id', umzug.nach_weinausbau_id).single()
    if (nachRaw) {
      const reduced = Math.max(0, +((parseFloat((nachRaw as R).menge_liter) || 0) - umzugMenge).toFixed(3))
      if (reduced <= 0.01) {
        // behaelter_id NICHT nullen → historischer Link bleibt erhalten
        await (supabase.from('weinausbau') as any)
          .update({ menge_liter: 0, aktiv: false })
          .eq('id', umzug.nach_weinausbau_id)
      } else {
        await (supabase.from('weinausbau') as any)
          .update({ menge_liter: reduced })
          .eq('id', umzug.nach_weinausbau_id)
      }
    }
  }

  // 3. Eintrag löschen
  await (supabase.from('keller_umzuege') as any).delete().eq('id', umzugId)

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}

// ── Umzug bearbeiten (Datum + Notizen) ──────────────────────────────────────

export async function updateUmzug(umzugId: string, datum: string, notizen: string | null) {
  const supabase = await createSupabaseServerClient()
  await (supabase.from('keller_umzuege') as any)
    .update({ datum, notizen: notizen || null })
    .eq('id', umzugId)
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}
