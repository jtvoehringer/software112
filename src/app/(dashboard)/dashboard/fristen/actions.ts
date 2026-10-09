'use server'

// Server Actions der Sicht "Meldungen & Fristen" – betriebseigene Fristen
// (Tabelle fristen, Migration 178).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { FRISTEN_VORLAGE } from './vorlage'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { lokalerTag, wienJetzt } from '@/lib/datum/wien'

const PFAD = '/dashboard/fristen'
const revalidate = () => { revalidatePath(PFAD); revalidatePath('/dashboard') }

async function kontext() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const { data: { user } } = await supabase.auth.getUser()
  if (!membership?.tenantId || !user) throw new AktionsFehler('Nicht angemeldet')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'betrieb')) throw new AktionsFehler('Keine Berechtigung')
  return { supabase, tenantId: membership.tenantId, userId: user.id }
}

/** Nächstes Vorkommen von Tag/Monat ab heute (heuer oder nächstes Jahr) */
function naechstesDatum(monat: number, tag: number) {
  // KAN-255: Wiener Kalendertag und lokale Felder (toISOString verschob ein lokal gebautes Datum je nach Zone um einen Tag)
  const heute = wienJetzt(); heute.setHours(0, 0, 0, 0)
  let d = new Date(heute.getFullYear(), monat - 1, tag)
  if (d < heute) d = new Date(heute.getFullYear() + 1, monat - 1, tag)
  return lokalerTag(d)
}

export async function standardfristenAnlegen() {
  const { supabase, tenantId } = await kontext()
  // alle-ausnahme: Fristen eines Betriebs – Vorlagen-Abgleich, wenige Dutzend
  const { data: vorhanden, error: vorhandenErr } = await (supabase.from('fristen') as any).select('bezeichnung').eq('tenant_id', tenantId)
  // KAN-253: sonst legte ein Lesefehler alle Standardfristen doppelt an
  if (vorhandenErr) throw new AktionsFehler(dbFehlerText(vorhandenErr, 'Fristen konnten nicht geladen werden'))
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
  const { data: f, error: fErr } = await (supabase.from('fristen') as any).select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (fErr) throw new AktionsFehler(dbFehlerText(fErr, 'Frist konnte nicht geladen werden'))
  if (!f) throw new AktionsFehler('Frist nicht gefunden')
  const { data: geaendert, error } = await (supabase.from('fristen') as any)
    .update({ status: 'erledigt', erledigt_am: new Date().toISOString(), erledigt_von: userId, aktualisiert_am: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(error.message)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
  if (f.wiederholung === 'jaehrlich') {
    const d = new Date(`${String(f.faellig_am).slice(0, 10)}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() + 1)   // KAN-255: durchgehend UTC
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
  const { data: geaendert, error } = await (supabase.from('fristen') as any)
    .update({ status: 'offen', erledigt_am: null, erledigt_von: null, aktualisiert_am: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(error.message)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
  revalidate()
}

export async function fristLoeschen(id: string) {
  const { supabase, tenantId } = await kontext()
  const { data: weg, error } = await (supabase.from('fristen') as any).delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(error.message)
  if (((weg ?? []) as unknown[]).length === 0) throw new AktionsFehler('Die Frist wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.')   // KAN-243
  revalidate()
}
