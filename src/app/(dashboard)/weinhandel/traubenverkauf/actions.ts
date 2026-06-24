'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// ── Hilfs-Funktion: Verkaufsposten + Position für Traubenverkauf anlegen ─────

async function createVerkaufspostenFuerTrauben(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  opts: {
    datum: string
    kontaktId: string | null
    firmaId: string | null
    weingartenName: string
    mengeKg: number
    preisPerKg: number | null
  }
): Promise<string> {
  // Rechnungsnummer auto-generieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rnData } = await (supabase.rpc as any)('get_next_rechnungsnummer', { p_tenant_id: tenantId })
  const rechnungsnummer = (rnData as string | null) ?? null

  const postenId = randomUUID()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: postenErr } = await (supabase.from('verkaufsposten') as any).insert({
    id:              postenId,
    tenant_id:       tenantId,
    datum:           opts.datum,
    rechnungsnummer,
    kontakt_id:      opts.kontaktId,
    firma_id:        opts.firmaId,
    notizen:         `Traubenverkauf – ${opts.weingartenName}`,
  })
  if (postenErr) throw new Error((postenErr as AR).message)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: posErr } = await (supabase.from('verkauf_positionen') as any).insert({
    tenant_id:         tenantId,
    verkaufsposten_id: postenId,
    typ:               'sonstiges',
    name:              `Weintrauben – ${opts.weingartenName}`,
    menge:             opts.mengeKg,
    einheit:           'kg',
    preis_brutto:      opts.preisPerKg,
    ust_satz:          13,
    rabatt_pct:        0,
    sonderrabatt_pct:  0,
  })
  if (posErr) throw new Error((posErr as AR).message)

  return postenId
}

// ── Verkaufsposten + Position aktualisieren ───────────────────────────────────

async function updateVerkaufspostenFuerTrauben(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  postenId: string,
  opts: {
    datum: string
    kontaktId: string | null
    firmaId: string | null
    weingartenName: string
    mengeKg: number
    preisPerKg: number | null
  }
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase.from('verkaufsposten') as any)
    .update({ datum: opts.datum, kontakt_id: opts.kontaktId, firma_id: opts.firmaId })
    .eq('id', postenId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pos } = await (supabase.from('verkauf_positionen') as any)
    .select('id')
    .eq('verkaufsposten_id', postenId)
    .limit(1)
    .single()
  const posId = (pos as AR | null)?.id as string | null
  if (posId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('verkauf_positionen') as any)
      .update({
        name:         `Weintrauben – ${opts.weingartenName}`,
        menge:        opts.mengeKg,
        preis_brutto: opts.preisPerKg,
      })
      .eq('id', posId)
  }
}

// ── upsertTraubenverkauf ──────────────────────────────────────────────────────

export async function upsertTraubenverkauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Nicht angemeldet')

  const existing_id = formData.get('existing_id') as string | null
  const tenantId    = membership.tenantId

  function getNum(key: string): number | null {
    const val = formData.get(key) as string | null
    if (!val || val.trim() === '') return null
    return Number(val.replace(',', '.'))
  }

  const weingartenId = formData.get('weingarten_id') as string
  const kontaktId    = (formData.get('kontakt_id') as string) || null
  const firmaId      = (formData.get('firma_id') as string) || null
  const datum        = formData.get('datum') as string
  const mengeKg      = Number((formData.get('menge_kg') as string).replace(',', '.'))
  const preisPerKg   = getNum('preis_per_kg')

  // Weingarten-Name für Positionsbezeichnung laden
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wgData } = await (supabase.from('weingarten') as any)
    .select('name')
    .eq('id', weingartenId)
    .single()
  const weingartenName = (wgData as AR | null)?.name as string ?? 'Weingarten'

  const verkaufsOpts = { datum, kontaktId, firmaId, weingartenName, mengeKg, preisPerKg }

  const payload: AR = {
    tenant_id:       tenantId,
    weingarten_id:   weingartenId,
    jahrgang_id:     (formData.get('jahrgang_id') as string) || null,
    grundstueck_id:  (formData.get('grundstueck_id') as string) || null,
    kontakt_id:      kontaktId,
    firma_id:        firmaId,
    datum,
    menge_kg:        mengeKg,
    preis_per_kg:    preisPerKg,
    kmw_grad:        getNum('kmw_grad'),
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    herkunft_code:   (formData.get('herkunft_code') as string) || null,
    gesundheit:      (formData.get('gesundheit') as string) || 'G',
    notizen:         (formData.get('notizen') as string) || null,
    updated_at:      new Date().toISOString(),
  }

  if (existing_id) {
    // Bestehenden Traubenverkauf laden (für verkaufsposten_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tvAlt } = await (supabase.from('traubenverkauf') as any)
      .select('verkaufsposten_id')
      .eq('id', existing_id)
      .single()
    const altPostenId = (tvAlt as AR | null)?.verkaufsposten_id as string | null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('traubenverkauf') as any)
      .update(payload)
      .eq('id', existing_id)
      .eq('tenant_id', tenantId)
    if (error) throw new Error((error as AR).message)

    if (altPostenId) {
      await updateVerkaufspostenFuerTrauben(supabase, altPostenId, verkaufsOpts)
    } else {
      const postenId = await createVerkaufspostenFuerTrauben(supabase, tenantId, verkaufsOpts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('traubenverkauf') as any)
        .update({ verkaufsposten_id: postenId })
        .eq('id', existing_id)
    }
  } else {
    // Liefernummer bei Neuanlage auto-generieren
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lnData } = await (supabase.rpc as any)('get_next_liefernummer', { p_tenant_id: tenantId })
    if (lnData) payload.liefernummer = lnData

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (supabase.from('traubenverkauf') as any)
      .insert(payload)
      .select('id')
      .single()
    if (error) throw new Error((error as AR).message)

    const newId    = (inserted as AR).id as string
    const postenId = await createVerkaufspostenFuerTrauben(supabase, tenantId, verkaufsOpts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('traubenverkauf') as any)
      .update({ verkaufsposten_id: postenId })
      .eq('id', newId)
  }

  revalidatePath('/weinhandel/traubenverkauf')
  revalidatePath('/weinhandel/verkauf')
}

// ── deleteTraubenverkauf ──────────────────────────────────────────────────────

export async function deleteTraubenverkauf(id: string) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Nicht angemeldet')

  // Verknüpften Verkaufsposten mitlöschen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tv } = await (supabase.from('traubenverkauf') as any)
    .select('verkaufsposten_id')
    .eq('id', id)
    .single()
  const postenId = (tv as AR | null)?.verkaufsposten_id as string | null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('traubenverkauf') as any)
    .delete()
    .eq('id', id)
    .eq('tenant_id', membership.tenantId)
  if (error) throw new Error((error as AR).message)

  if (postenId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('verkauf_positionen') as any)
      .delete()
      .eq('verkaufsposten_id', postenId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase.from('verkaufsposten') as any)
      .delete()
      .eq('id', postenId)
  }

  revalidatePath('/weinhandel/traubenverkauf')
  revalidatePath('/weinhandel/verkauf')
}
