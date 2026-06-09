'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { minQualitaet } from '@/lib/wein/qualitaet'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function umziehen(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  const vonId     = fd.get('von_weinausbau_id') as string
  const nachBehId = fd.get('nach_behaelter_id') as string
  const menge     = parseFloat((fd.get('menge_liter') as string).replace(',', '.'))
  const schwund   = parseFloat((fd.get('schwund_liter') as string || '0').replace(',', '.')) || 0
  const notizen   = (fd.get('notizen') as string) || null
  const datum     = (fd.get('datum') as string) || new Date().toISOString().split('T')[0]

  // Tenant
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').limit(1).single()
  const tenantId = (membership as R)?.tenant_id

  // Quell-Charge laden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vonRaw } = await (supabase.from('weinausbau') as any)
    .select('*').eq('id', vonId).single()
  const von = vonRaw as R
  if (!von) throw new Error('Quell-Charge nicht gefunden')

  // Prüfen ob Ziel-Behälter bereits Wein enthält
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: nachRaw } = await (supabase.from('weinausbau') as any)
    .select('*')
    .eq('behaelter_id', nachBehId)
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .maybeSingle()
  const nachCharge = nachRaw as R | null

  const verschnitt      = !!nachCharge
  const qualitaetVorher = von.qualitaetsstufe ?? null
  const qualitaetNachher = verschnitt
    ? minQualitaet(qualitaetVorher, nachCharge!.qualitaetsstufe ?? null)
    : qualitaetVorher

  // Umzug protokollieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('keller_umzuege') as any).insert({
    tenant_id:         tenantId,
    datum,
    von_weinausbau_id: vonId,
    nach_behaelter_id: nachBehId,
    menge_liter:       menge,
    schwund_liter:     schwund,
    verschnitt,
    qualitaet_vorher:  qualitaetVorher,
    qualitaet_nachher: qualitaetNachher,
    notizen,
  })

  const vonRestmenge = (von.menge_liter ?? 0) - menge - schwund
  const istVollstaendig = vonRestmenge <= 0.01

  if (verschnitt && nachCharge) {
    // VERSCHNITT: Ziel-Charge bekommt Menge + ggf. neue Qualitätsstufe
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({
        menge_liter:     (nachCharge.menge_liter ?? 0) + menge,
        qualitaetsstufe: qualitaetNachher,
      })
      .eq('id', nachCharge.id)

    // Quell-Charge reduzieren oder abschließen
    if (istVollstaendig) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: 0, behaelter_id: null, aktiv: false, status: 'abgeschlossen' })
        .eq('id', vonId)
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: vonRestmenge })
        .eq('id', vonId)
    }
  } else if (istVollstaendig) {
    // VOLLSTÄNDIGER UMZUG in leeren Behälter: Charge zieht mit
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({
        behaelter_id: nachBehId,
        menge_liter:  (von.menge_liter ?? 0) - schwund,
      })
      .eq('id', vonId)
  } else {
    // TEILUMZUG in leeren Behälter: neue Charge für den umgezogenen Teil
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any)
      .update({ menge_liter: vonRestmenge })
      .eq('id', vonId)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('weinausbau') as any).insert({
      tenant_id:       tenantId,
      name:            von.name + ' (Teilumzug)',
      jahrgang:        von.jahrgang,
      rebsorte:        von.rebsorte,
      weingarten_id:   von.weingarten_id,
      behaelter_id:    nachBehId,
      menge_liter:     menge,
      qualitaetsstufe: von.qualitaetsstufe,
      status:          von.status,
      notizen:         `Teilumzug aus "${von.name}"`,
      aktiv:           true,
    })
  }

  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/umziehen')
}
