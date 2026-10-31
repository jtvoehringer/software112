'use server'
// schreibsperre-ausnahme-datei: persönliche Anordnung der Übersicht (benutzer_dashboard), kein Betriebsdatum – gilt auch im Nur-Lesen-Modus
import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { layoutPruefen, LAYOUT_MAX } from '@/lib/dashboard/widgets'

// KAN-388: eigene Anordnung der Übersicht je Benutzer, über alle Betriebe (Entscheidung Jörgen 31.10.2026).
// Jeder angemeldete Benutzer – auch Leser – schreibt nur seine eigene Zeile (user_id aus getUser(), RLS wie DB-Test 87).
// Kein Betriebsbezug: daher weder Seiten-Betrieb noch Abo-Schreibsperre noch Modulrecht.

type Ergebnis = { ok: true } | { ok: false; fehler: string }

/** Anordnung speichern – nur bekannte Widgets, keine doppelten (layoutPruefen), dieselbe Grenze wie die DB */
export async function dashboardSpeichern(roh: unknown): Promise<Ergebnis> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, fehler: 'Nicht angemeldet.' }
  // seiten-betrieb-ausnahme: persönliche Einstellung über alle Betriebe, ein Betriebswechsel ändert nichts daran
  const layout = layoutPruefen(roh)
  if (!layout || !Array.isArray(roh) || roh.length > LAYOUT_MAX) return { ok: false, fehler: 'Die Anordnung ist ungültig – bitte die Seite neu laden.' }
  // tenant-isolation-ignore: benutzer_dashboard hat keine tenant_id, gilt je Benutzer über alle Betriebe (RLS: eigene Zeile)
  const { data, error } = await (supabase.from('benutzer_dashboard') as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .upsert({ user_id: user.id, layout, aktualisiert_am: new Date().toISOString() }, { onConflict: 'user_id' })
    .select('user_id')
  if (error) return { ok: false, fehler: `Anordnung nicht gespeichert: ${dbFehlerText(error)}` }
  if (!data || data.length === 0) return { ok: false, fehler: NICHT_GESPEICHERT }
  revalidatePath('/dashboard')
  return { ok: true }
}

/** Auf Standard zurücksetzen = eigene Zeile löschen (ohne Zeile gilt STANDARD_LAYOUT) */
export async function dashboardZuruecksetzen(): Promise<Ergebnis> {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, fehler: 'Nicht angemeldet.' }
  // seiten-betrieb-ausnahme: persönliche Einstellung über alle Betriebe, ein Betriebswechsel ändert nichts daran
  // tenant-isolation-ignore: benutzer_dashboard hat keine tenant_id, gilt je Benutzer über alle Betriebe (RLS: eigene Zeile)
  const { error } = await (supabase.from('benutzer_dashboard') as any) // eslint-disable-line @typescript-eslint/no-explicit-any
    .delete().eq('user_id', user.id).select('user_id')   // loeschen-ohne-pruefung: ohne gespeicherte Anordnung ist 0 Zeilen der Standard
  if (error) return { ok: false, fehler: `Zurücksetzen fehlgeschlagen: ${dbFehlerText(error)}` }
  revalidatePath('/dashboard')
  return { ok: true }
}
