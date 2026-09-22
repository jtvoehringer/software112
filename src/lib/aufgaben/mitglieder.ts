// ── Mitglieder des Betriebs für die Verantwortlich-Auswahl (server-only) ─────
// Über die RPC s112_mandant_mitglieder (SECURITY DEFINER, Migration 224): jedes
// aktive Mitglied sieht die Kolleginnen/Kollegen seines Betriebs mit Name –
// ohne Service-Role-Key, nur id + Name + Rolle (keine E-Mail).

import { createSupabaseServerClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type MitgliedOption = { id: string; name: string; role?: string }

export async function ladeMandantMitglieder(tenantId: string): Promise<MitgliedOption[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase as any).rpc('s112_mandant_mitglieder', { p_tenant_id: tenantId })
  return ((data ?? []) as R[])
    .map(r => ({ id: r.user_id as string, name: (r.name as string) || 'Unbekannt', role: r.role as string }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'))
}

/** Map user_id → Anzeigename */
export function mitgliederMap(m: MitgliedOption[]): Map<string, string> {
  return new Map(m.map(x => [x.id, x.name]))
}
