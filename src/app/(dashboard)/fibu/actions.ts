'use server'
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getCtx() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new Error('Kein Mandant')
  return { supabase, tenantId: membership.tenantId }
}

// ── Periode sicherstellen / anlegen ──────────────────────────────────────────

async function getOrCreatePeriode(supabase: R, tenantId: string, datum: string) {
  const d     = new Date(datum)
  const jahr  = d.getFullYear()
  const monat = d.getMonth() + 1

  const { data: existing } = await (supabase.from('fibu_perioden') as any)
    .select('id, gesperrt')
    .eq('tenant_id', tenantId)
    .eq('jahr', jahr)
    .eq('monat', monat)
    .maybeSingle()

  if (existing?.gesperrt) throw new Error(`Periode ${monat}/${jahr} ist gesperrt`)
  if (existing) return existing.id

  const { data: neu, error } = await (supabase.from('fibu_perioden') as any)
    .insert({ tenant_id: tenantId, jahr, monat })
    .select('id').single()

  if (error) throw new Error((error as R).message)
  return (neu as R).id
}

// ── Buchungssatz anlegen ──────────────────────────────────────────────────────

export async function createFibuBuchungssatz(formData: FormData) {
  const { supabase, tenantId } = await getCtx()

  const belegdatum   = formData.get('belegdatum') as string
  const beschreibung = formData.get('beschreibung') as string

  // Zeilen aus formData extrahieren (konto_id_0, seite_0, betrag_0 …)
  const zeilen: { konto_id: string; seite: string; betrag: number }[] = []
  let i = 0
  while (formData.get(`konto_id_${i}`)) {
    zeilen.push({
      konto_id: formData.get(`konto_id_${i}`) as string,
      seite:    formData.get(`seite_${i}`) as string,
      betrag:   parseFloat(formData.get(`betrag_${i}`) as string),
    })
    i++
  }

  if (zeilen.length < 2) return { error: 'Mindestens 2 Buchungszeilen erforderlich' }

  // Soll = Haben prüfen (clientseitige Vorabprüfung)
  const soll  = zeilen.filter(z => z.seite === 'soll').reduce((s, z) => s + z.betrag, 0)
  const haben = zeilen.filter(z => z.seite === 'haben').reduce((s, z) => s + z.betrag, 0)
  if (Math.abs(soll - haben) > 0.01) return { error: `Buchungssatz nicht ausgeglichen: Soll ${soll.toFixed(2)} ≠ Haben ${haben.toFixed(2)}` }

  try {
    const periodeId   = await getOrCreatePeriode(supabase, tenantId, belegdatum)
    const belegnummer = await (supabase.rpc as any)('get_next_belegnummer', {
      p_tenant_id: tenantId,
      p_jahr:      new Date(belegdatum).getFullYear(),
    }).then((r: R) => r.data)

    const { data: satz, error: satzErr } = await (supabase.from('fibu_buchungssaetze') as any)
      .insert({
        tenant_id: tenantId, periode_id: periodeId,
        belegnummer, belegdatum, beschreibung,
      })
      .select('id').single()

    if (satzErr) return { error: (satzErr as R).message }
    const satzId = (satz as R).id

    const { error: zeilenErr } = await (supabase.from('fibu_buchungszeilen') as any)
      .insert(zeilen.map(z => ({ buchungssatz_id: satzId, ...z })))

    if (zeilenErr) return { error: (zeilenErr as R).message }

    revalidatePath('/fibu')
    return { ok: true, belegnummer }
  } catch (err) {
    return { error: String(err) }
  }
}

// ── Buchungssatz stornieren ───────────────────────────────────────────────────

export async function storniereFibuBuchungssatz(satzId: string) {
  const { supabase, tenantId } = await getCtx()

  // Original laden
  const { data: orig } = await (supabase.from('fibu_buchungssaetze') as any)
    .select('*, fibu_buchungszeilen(*)')
    .eq('id', satzId)
    .eq('tenant_id', tenantId)
    .single()

  if (!orig) return { error: 'Buchungssatz nicht gefunden' }
  if ((orig as R).gesperrt) return { error: 'Buchungssatz ist gesperrt' }

  const heute     = new Date().toISOString().split('T')[0]
  const periodeId = await getOrCreatePeriode(supabase, tenantId, heute)
  const belegnummer = await (supabase.rpc as any)('get_next_belegnummer', {
    p_tenant_id: tenantId,
    p_jahr:      new Date().getFullYear(),
  }).then((r: R) => r.data)

  const { data: storno, error: stornoErr } = await (supabase.from('fibu_buchungssaetze') as any)
    .insert({
      tenant_id: tenantId, periode_id: periodeId,
      belegnummer, belegdatum: heute,
      beschreibung: `Storno zu ${(orig as R).belegnummer}: ${(orig as R).beschreibung}`,
    })
    .select('id').single()

  if (stornoErr) return { error: (stornoErr as R).message }

  // Zeilen invertiert anlegen (Soll↔Haben tauschen)
  const stornoZeilen = ((orig as R).fibu_buchungszeilen as R[]).map((z: R) => ({
    buchungssatz_id: (storno as R).id,
    konto_id: z.konto_id,
    seite:    z.seite === 'soll' ? 'haben' : 'soll',
    betrag:   z.betrag,
  }))

  const { error: zErr } = await (supabase.from('fibu_buchungszeilen') as any).insert(stornoZeilen)
  if (zErr) return { error: (zErr as R).message }

  revalidatePath('/fibu')
  return { ok: true }
}
