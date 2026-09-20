'use server'

// Server Actions der Sicht "Meldungen & Fristen" – betriebseigene Fristen
// (Tabelle fristen, Migration 178).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { FRISTEN_VORLAGE } from './vorlage'
import { AktionsFehler } from '@/lib/fehler'

const PFAD = '/dashboard/fristen'
const revalidate = () => { revalidatePath(PFAD); revalidatePath('/dashboard') }

async function kontext() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const { data: { user } } = await supabase.auth.getUser()
  if (!membership?.tenantId || !user) throw new AktionsFehler('Nicht angemeldet')
  if (!canWrite(membership.role, 'betrieb')) throw new AktionsFehler('Keine Berechtigung')
  return { supabase, tenantId: membership.tenantId, userId: user.id }
}

/** Nächstes Vorkommen von Tag/Monat ab heute (heuer oder nächstes Jahr) */
function naechstesDatum(monat: number, tag: number) {
  const heute = new Date(); heute.setHours(0, 0, 0, 0)
  let d = new Date(heute.getFullYear(), monat - 1, tag)
  if (d < heute) d = new Date(heute.getFullYear() + 1, monat - 1, tag)
  return d.toISOString().split('T')[0]
}

export async function standardfristenAnlegen() {
  const { supabase, tenantId } = await kontext()
  const { data: vorhanden } = await (supabase.from('fristen') as any).select('bezeichnung').eq('tenant_id', tenantId)
  const namen = new Set(((vorhanden ?? []) as { bezeichnung: string }[]).map(v => v.bezeichnung))
  const rows = FRISTEN_VORLAGE.filter(v => !namen.has(v.bezeichnung)).map(v => ({
    tenant_id: tenantId, bezeichnung: v.bezeichnung, beschreibung: v.beschreibung, kategorie: v.kategorie,
    faellig_am: naechstesDatum(v.monat, v.tag), wiederholung: 'jaehrlich', href: v.href ?? null,
  }))
  if (rows.length) {
    const { error } = await (supabase.from('fristen') as any).insert(rows)
    if (error) throw new AktionsFehler(error.message)
  }
  revalidate()
}

export async function fristAnlegen(input: { bezeichnung: string; beschreibung: string; kategorie: string; faellig_am: string; wiederholung: string }) {
  const { supabase, tenantId } = await kontext()
  if (!input.bezeichnung.trim() || !input.faellig_am) throw new AktionsFehler('Bezeichnung und Fälligkeit sind Pflicht')
  const { error } = await (supabase.from('fristen') as any).insert({
    tenant_id: tenantId, bezeichnung: input.bezeichnung.trim(), beschreibung: input.beschreibung.trim() || null,
    kategorie: ['meldung', 'steuer', 'weinrecht', 'betrieb'].includes(input.kategorie) ? input.kategorie : 'meldung',
    faellig_am: input.faellig_am, wiederholung: input.wiederholung === 'jaehrlich' ? 'jaehrlich' : 'einmalig',
  })
  if (error) throw new AktionsFehler(error.message)
  revalidate()
}

/** Erledigt setzen – bei jährlicher Wiederholung wird automatisch die Frist des Folgejahres angelegt. */
export async function fristErledigen(id: string) {
  const { supabase, tenantId, userId } = await kontext()
  const { data: f } = await (supabase.from('fristen') as any).select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!f) throw new AktionsFehler('Frist nicht gefunden')
  const { error } = await (supabase.from('fristen') as any)
    .update({ status: 'erledigt', erledigt_am: new Date().toISOString(), erledigt_von: userId, aktualisiert_am: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(error.message)
  if (f.wiederholung === 'jaehrlich') {
    const d = new Date(f.faellig_am); d.setFullYear(d.getFullYear() + 1)
    { const { error: e } = await (supabase.from('fristen') as any).insert({
      tenant_id: tenantId, bezeichnung: f.bezeichnung, beschreibung: f.beschreibung, kategorie: f.kategorie,
      faellig_am: d.toISOString().split('T')[0], wiederholung: 'jaehrlich', href: f.href,
    })
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (fristen): ${e.message}`) }
  }
  revalidate()
}

export async function fristWiedereroeffnen(id: string) {
  const { supabase, tenantId } = await kontext()
  const { error } = await (supabase.from('fristen') as any)
    .update({ status: 'offen', erledigt_am: null, erledigt_von: null, aktualisiert_am: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(error.message)
  revalidate()
}

export async function fristLoeschen(id: string) {
  const { supabase, tenantId } = await kontext()
  const { error } = await (supabase.from('fristen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(error.message)
  revalidate()
}
