'use server'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole, isSystemAdmin } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Wie viele Benutzer haben die jeweilige Note schon weggeklickt? (nur Super-Admin) */
export async function releaseNotesGesehenZaehler(): Promise<Record<string, number>> {
  const role = await getCurrentUserRole()
  if (!isSystemAdmin(role)) return {}
  const admin = createSupabaseAdminClient()
  const { data } = await (admin.from('release_notes_gesehen') as any).select('release_note_id')
  const out: Record<string, number> = {}
  for (const z of (data ?? []) as R[]) out[z.release_note_id] = (out[z.release_note_id] ?? 0) + 1
  return out
}

/** „Erneut anzeigen“: Gesehen-Vermerke löschen, die Note erscheint bei allen beim
 *  nächsten Einstieg wieder – z.B. nachdem der Text ergänzt wurde (19.9.2026). */
export async function releaseNoteErneutAnzeigen(releaseNoteId: string): Promise<{ error?: string; anzahl?: number }> {
  const role = await getCurrentUserRole()
  if (!isSystemAdmin(role)) return { error: 'Nur Super-Admins können Release Notes erneut anzeigen lassen.' }
  if (!releaseNoteId) return { error: 'Keine Release Note angegeben.' }
  const admin = createSupabaseAdminClient()
  const { error, count } = await (admin.from('release_notes_gesehen') as any)
    .delete({ count: 'exact' })
    .eq('release_note_id', releaseNoteId)
  if (error) return { error: error.message }
  return { anzahl: count ?? 0 }
}
