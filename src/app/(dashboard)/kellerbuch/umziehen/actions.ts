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

  const quellen: QuelleInput[] = JSON.parse(fd.get('quellen_json') as string || '[]')
  const ziele:   ZielInput[]   = JSON.parse(fd.get('ziele_json')   as string || '[]')
  const notizen  = (fd.get('notizen') as string) || null
  const datum    = (fd.get('datum')   as string) || new Date().toISOString().split('T')[0]

  if (quellen.length === 0 || ziele.length === 0) throw new Error('Mindestens eine Quelle und ein Ziel erforderlich')

  const totalVon  = quellen.reduce((s, q) => s + q.menge, 0)
  const totalNach = ziele.reduce((s, z) => s + z.menge, 0)
  const schwund   = Math.max(0, +(totalVon - totalNach).toFixed(3))

  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  const tenantId = (membership as R)?.tenant_id

  // ── Qualitätsminimum aller Quellen ermitteln ──────────────────────────────────
  let minQualStufe: string | null = null
  const quellenDaten: R[] = []

  for (const q of quellen) {
    const { data: vonRaw } = await (supabase.from('weinausbau') as any)
      .select('*').eq('id', q.weinausbau_id).single()
    const von = vonRaw as R
    if (!von) throw new Error(`Charge nicht gefunden`)
    quellenDaten.push(von)
    minQualStufe = minQualitaet(minQualStufe, von.qualitaetsstufe ?? null)
  }

  // ── Quellen reduzieren / abschließen ──────────────────────────────────────────
  for (let i = 0; i < quellen.length; i++) {
    const q   = quellen[i]
    const von = quellenDaten[i]
    const restmenge = Math.max(0, +(((von.menge_liter ?? 0) - q.menge).toFixed(3)))
    const vollstaendig = restmenge <= 0.01

    if (vollstaendig) {
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: 0, aktiv: false, status: 'abgeschlossen', behaelter_id: null })
        .eq('id', q.weinausbau_id)
    } else {
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: restmenge })
        .eq('id', q.weinausbau_id)
    }

    // Protokoll
    await (supabase.from('keller_umzuege') as any).insert({
      tenant_id:         tenantId,
      datum,
      von_weinausbau_id: q.weinausbau_id,
      nach_behaelter_id: ziele[0].behaelter_id,
      menge_liter:       q.menge,
      schwund_liter:     i === 0 ? schwund : 0,
      verschnitt:        false,
      qualitaet_vorher:  von.qualitaetsstufe ?? null,
      qualitaet_nachher: minQualStufe,
      notizen,
    })
  }

  // ── Ziele befüllen ────────────────────────────────────────────────────────────
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
      await (supabase.from('weinausbau') as any).insert({
        tenant_id:       tenantId,
        name:            quellenDaten.length > 1 ? 'Zusammenführung' : (von0?.name ?? 'Umzug'),
        jahrgang:        von0?.jahrgang ?? null,
        rebsorte:        von0?.rebsorte ?? null,
        weingarten_id:   von0?.weingarten_id ?? null,
        behaelter_id:    z.behaelter_id,
        menge_liter:     z.menge,
        qualitaetsstufe: minQualStufe,
        status:          von0?.status ?? 'ausbau',
        notizen:         quellen.length > 1
          ? `Zusammengeführt aus ${quellen.length} Chargen`
          : `Umzug aus "${von0?.name ?? ''}"`,
        aktiv:           true,
      })
    }
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
}
