'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

// Atomisch: Rechnungsnummer generieren (Zähler +1 in einer DB-Transaktion)
async function generateRechnungsnummer(tenantId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await (supabase.rpc as any)('get_next_rechnungsnummer', {
    p_tenant_id: tenantId,
  })
  if (error) {
    console.error('generateRechnungsnummer:', error.message)
    return null
  }
  return data as string | null
}

// Positions-Typ aus der Form
interface PositionInput {
  typ:               'flasche' | 'tank' | 'sonstiges'
  fuellung_id:       string | null
  weinausbau_id:     string | null
  name:              string
  menge:             number
  einheit:           string
  preis_brutto:      number | null
}

// ── Verkauf anlegen ───────────────────────────────────────────────────────────

export async function createVerkauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Kopfdaten
  const datum               = (formData.get('datum') as string) || new Date().toISOString().split('T')[0]
  const rechnungsnummerInput = (formData.get('rechnungsnummer') as string).trim()
  // Wenn keine Nummer eingetragen → automatisch generieren
  const rechnungsnummer = rechnungsnummerInput || await generateRechnungsnummer(tenantId)
  const kontaktId      = (formData.get('kontakt_id') as string) || null
  const firmaId        = (formData.get('firma_id') as string) || null
  const notizen        = (formData.get('notizen') as string) || null

  // Positionen als JSON aus hidden input
  const posJson = formData.get('positionen_json') as string
  let positionen: PositionInput[] = []
  try {
    positionen = JSON.parse(posJson || '[]')
  } catch {
    throw new Error('Ungültige Positions-Daten')
  }

  if (positionen.length === 0) {
    throw new Error('Mindestens eine Position erforderlich')
  }

  // 1. Verkaufsposten anlegen (UUID selbst generieren)
  const postenId = randomUUID()
  const { error: postenErr } = await (supabase.from('verkaufsposten') as any).insert({
    id:              postenId,
    tenant_id:       tenantId,
    datum,
    rechnungsnummer,
    kontakt_id:      kontaktId  || null,
    firma_id:        firmaId    || null,
    notizen,
  })

  if (postenErr) throw new Error((postenErr as AR).message)

  // 2. Positionen anlegen
  const posInserts = positionen.map(p => ({
    tenant_id:         tenantId,
    verkaufsposten_id: postenId,
    typ:               p.typ,
    fuellung_id:       p.fuellung_id || null,
    weinausbau_id:     p.weinausbau_id || null,
    name:              p.name,
    menge:             p.menge,
    einheit:           p.einheit || 'Stk',
    preis_brutto:      p.preis_brutto ?? null,
  }))

  const { error: posErr } = await (supabase.from('verkauf_positionen') as any).insert(posInserts)
  if (posErr) throw new Error((posErr as AR).message)

  // 3. Bestand reduzieren
  for (const p of positionen) {
    if (p.typ === 'flasche' && p.fuellung_id) {
      // bestand_flaschen dekrementieren
      const { data: fuellung } = await (supabase.from('fuellungen') as any)
        .select('bestand_flaschen')
        .eq('id', p.fuellung_id)
        .single()
      const aktuell = (fuellung as AR | null)?.bestand_flaschen ?? 0
      const neu = Math.max(0, aktuell - Math.round(p.menge))
      await (supabase.from('fuellungen') as any)
        .update({ bestand_flaschen: neu, aktualisiert_am: new Date().toISOString() })
        .eq('id', p.fuellung_id)
    } else if (p.typ === 'tank' && p.weinausbau_id) {
      // menge_liter dekrementieren
      const { data: wein } = await (supabase.from('weinausbau') as any)
        .select('menge_liter')
        .eq('id', p.weinausbau_id)
        .single()
      const aktuell = parseFloat((wein as AR | null)?.menge_liter ?? '0') || 0
      const neu = Math.max(0, aktuell - p.menge)
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: neu })
        .eq('id', p.weinausbau_id)
    }
  }

  // 4. CRM Aktivität auto-loggen (wenn Kontakt oder Firma angegeben)
  if (kontaktId || firmaId) {
    try {
      const gesamtBetrag = positionen.reduce((s, p) => s + (p.preis_brutto ?? 0) * p.menge, 0)
      const betreff = [
        rechnungsnummer ? `Verkauf ${rechnungsnummer}` : 'Verkauf',
        gesamtBetrag > 0
          ? gesamtBetrag.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
          : null,
      ].filter(Boolean).join(' · ')

      const { data: { user } } = await supabase.auth.getUser()
      await (supabase.from('aktivitaeten') as any).insert({
        tenant_id:    tenantId,
        kontakt_id:   kontaktId  || null,
        firma_id:     firmaId    || null,
        art:          'verkauf',
        betreff,
        beschreibung: `Verkaufsposten: ${postenId}`,
        datum:        datum,
        erledigt:     true,
        erstellt_von: user?.id ?? null,
      })
    } catch {
      // CRM-Fehler nicht auf Verkauf durchschlagen
    }
  }

  revalidatePath('/weinhandel/verkauf')
  redirect(`/weinhandel/verkauf/${postenId}`)
}

// ── Verkauf deaktivieren ──────────────────────────────────────────────────────

export async function deactivateVerkauf(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('verkaufsposten') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/weinhandel/verkauf')
  redirect('/weinhandel/verkauf')
}

// ── Verkauf stornieren (mit Bestandsrückbuchung) ──────────────────────────────

export async function stornoVerkauf(id: string) {
  const supabase = await createSupabaseServerClient()

  // Positionen laden für Rückbuchung
  const { data: posRaw } = await (supabase.from('verkauf_positionen') as any)
    .select('typ, fuellung_id, weinausbau_id, menge')
    .eq('verkaufsposten_id', id)

  const positionen = (posRaw ?? []) as AR[]

  // Bestand zurückbuchen
  for (const p of positionen) {
    if (p.typ === 'flasche' && p.fuellung_id) {
      const { data: f } = await (supabase.from('fuellungen') as any)
        .select('bestand_flaschen').eq('id', p.fuellung_id).single()
      const aktuell = (f as AR | null)?.bestand_flaschen ?? 0
      await (supabase.from('fuellungen') as any)
        .update({ bestand_flaschen: aktuell + Math.round(p.menge), aktualisiert_am: new Date().toISOString() })
        .eq('id', p.fuellung_id)
    } else if (p.typ === 'tank' && p.weinausbau_id) {
      const { data: w } = await (supabase.from('weinausbau') as any)
        .select('menge_liter').eq('id', p.weinausbau_id).single()
      const aktuell = parseFloat((w as AR | null)?.menge_liter ?? '0') || 0
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: aktuell + p.menge })
        .eq('id', p.weinausbau_id)
    }
  }

  // Posten als storniert markieren
  const { data: postenRaw, error } = await (supabase.from('verkaufsposten') as any)
    .update({ storniert: true, storniert_am: new Date().toISOString() })
    .eq('id', id)
    .select('rechnungsnummer')
    .single()
  if (error) throw new Error((error as AR).message)

  // CRM-Aktivität auf STORNIERT setzen
  try {
    const re = (postenRaw as AR | null)?.rechnungsnummer
    await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${re ?? ''} · STORNIERT` })
      .eq('beschreibung', `Verkaufsposten: ${id}`)
  } catch { /* nicht kritisch */ }

  revalidatePath('/weinhandel/verkauf')
  revalidatePath(`/weinhandel/verkauf/${id}`)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

// ── Verkauf als bezahlt markieren ─────────────────────────────────────────────

export async function markiereAlsBezahlt(id: string) {
  const supabase = await createSupabaseServerClient()

  const { data: postenRaw, error } = await (supabase.from('verkaufsposten') as any)
    .update({ bezahlt: true, bezahlt_am: new Date().toISOString() })
    .eq('id', id)
    .select('rechnungsnummer')
    .single()
  if (error) throw new Error((error as AR).message)

  // CRM-Aktivität aktualisieren
  try {
    const re = (postenRaw as AR | null)?.rechnungsnummer
    await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${re ?? ''} · Bezahlt` })
      .eq('beschreibung', `Verkaufsposten: ${id}`)
  } catch { /* nicht kritisch */ }

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath(`/weinhandel/verkauf/${id}`)
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}
