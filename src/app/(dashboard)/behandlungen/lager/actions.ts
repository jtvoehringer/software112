'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function upsertLagerBewegung(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new Error('Nicht angemeldet')

  // Tenant ermitteln
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).single()
  if (!membership) throw new Error('Kein Mandant')

  const existingId = fd.get('existing_id') as string | null
  const mengeRaw = parseFloat((fd.get('menge') as string) ?? '0')
  const richtung = fd.get('richtung') as string // 'eingang' | 'ausgang'
  const menge = richtung === 'ausgang' ? -Math.abs(mengeRaw) : Math.abs(mengeRaw)

  const payload = {
    tenant_id: membership.tenant_id,
    psm_id:    fd.get('psm_id') as string,
    datum:     fd.get('datum') as string,
    typ:       fd.get('typ') as string,
    menge,
    einheit:   fd.get('einheit') as string || null,
    notizen:   (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('psm_lager_bewegungen') as any)
      .update(payload).eq('id', existingId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('psm_lager_bewegungen') as any).insert(payload)
  }

  revalidatePath('/behandlungen/lager')
}

export async function deleteLagerBewegung(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('psm_lager_bewegungen') as any).delete().eq('id', id)
  revalidatePath('/behandlungen/lager')
}

// ── PSM-Stammdaten (vormals /pflanzenschutz, jetzt Teil der Betriebsmittel-Lagerverwaltung) ────────

export async function upsertPSM(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new Error('Nicht angemeldet')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).single()
  if (!membership) throw new Error('Kein Mandant')

  const existingId = fd.get('existing_id') as string | null

  const payload = {
    tenant_id:          membership.tenant_id,
    name:               fd.get('name') as string,
    handelsname:        (fd.get('handelsname') as string) || null,
    wirkstoff:          (fd.get('wirkstoff') as string) || null,
    wirkstoffgehalt_pct: parseFloat(fd.get('wirkstoffgehalt_pct') as string) || null,
    cu_gehalt_pct:      parseFloat(fd.get('cu_gehalt_pct') as string) || null,
    kategorie:          (fd.get('kategorie') as string) || null,
    wartezeit_tage:     parseInt(fd.get('wartezeit_tage') as string) || null,
    max_aufwand_kg_ha:  parseFloat(fd.get('max_aufwand_kg_ha') as string) || null,
    max_anwendungen:    parseInt(fd.get('max_anwendungen') as string) || null,
    oeko_zugelassen:    fd.get('oeko_zugelassen') === 'true',
    aktiv:              true,
    notizen:            (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pflanzenschutzmittel') as any)
      .update(payload).eq('id', existingId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('pflanzenschutzmittel') as any).insert(payload)
  }

  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
  revalidatePath('/behandlungen/berichte')
}

export async function deactivatePSM(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('pflanzenschutzmittel') as any)
    .update({ aktiv: false }).eq('id', id)
  revalidatePath('/behandlungen/lager')
}

// ── Düngemittel-Stammdaten (Phase 2 Massnahmenformular, migration 133) ────────

export async function upsertDuengemittel(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new Error('Nicht angemeldet')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).single()
  if (!membership) throw new Error('Kein Mandant')

  const existingId = fd.get('existing_id') as string | null

  const payload = {
    tenant_id:                 membership.tenant_id,
    name:                      fd.get('name') as string,
    handelsname:               (fd.get('handelsname') as string) || null,
    typ:                       (fd.get('typ') as string) || null,
    naehrstoff_n_pct:          parseFloat(fd.get('naehrstoff_n_pct') as string) || null,
    naehrstoff_p_pct:          parseFloat(fd.get('naehrstoff_p_pct') as string) || null,
    naehrstoff_k_pct:          parseFloat(fd.get('naehrstoff_k_pct') as string) || null,
    wartezeit_tage:            parseInt(fd.get('wartezeit_tage') as string) || null,
    oeko_zugelassen:           fd.get('oeko_zugelassen') === 'true',
    einarbeitung_erforderlich: fd.get('einarbeitung_erforderlich') === 'true',
    preis_pro_einheit:         parseFloat(fd.get('preis_pro_einheit') as string) || null,
    einheit:                   (fd.get('einheit') as string) || null,
    aktiv:                     true,
    notizen:                   (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('duengemittel') as any)
      .update(payload).eq('id', existingId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('duengemittel') as any).insert(payload)
  }

  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
}

export async function deactivateDuengemittel(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('duengemittel') as any)
    .update({ aktiv: false }).eq('id', id)
  revalidatePath('/behandlungen/lager')
}

// ── Sätze/Stundensätze je Maßnahmenart (Phase 2/3 Massnahmenformular, migration 133) ────────

export async function upsertSatzMassnahme(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new Error('Nicht angemeldet')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase.from('tenant_memberships') as any)
    .select('tenant_id').eq('user_id', user.id).single()
  if (!membership) throw new Error('Kein Mandant')

  const existingId = fd.get('existing_id') as string | null

  const payload = {
    tenant_id:    membership.tenant_id,
    art:          fd.get('art') as string,
    bezeichnung:  fd.get('bezeichnung') as string,
    satz_pro_ha:  parseFloat(fd.get('satz_pro_ha') as string) || 0,
    gueltig_ab:   (fd.get('gueltig_ab') as string) || null,
    notizen:      (fd.get('notizen') as string) || null,
    aktiv:        true,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('saetze_massnahmen') as any)
      .update(payload).eq('id', existingId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('saetze_massnahmen') as any).insert(payload)
  }

  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
}

export async function deactivateSatzMassnahme(id: string) {
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('saetze_massnahmen') as any)
    .update({ aktiv: false }).eq('id', id)
  revalidatePath('/behandlungen/lager')
}
