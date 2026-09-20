'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type CustomWeinbaugebiet = { id: string; name: string }

// Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
// beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
// Daten eines anderen Betriebs als des gerade ausgewählten angezeigt/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

// Lädt die eigenen (aktiven) Weinbaugebiete des Mandanten – wird server-seitig
// von allen Seiten geladen, die das Herkunft-Code(BKI)-Dropdown rendern
// (Grundstück-Formular, Füllung anlegen/bearbeiten).
export async function ladeCustomWeinbaugebiete(): Promise<CustomWeinbaugebiet[]> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { data } = await (supabase.from('weinbaugebiete_custom') as any)
    .select('id, name')
    .eq('aktiv', true)
    .eq('tenant_id', tenantId)
    .order('name', { ascending: true })
  return (data ?? []) as CustomWeinbaugebiet[]
}

// Legt ein neues eigenes Weinbaugebiet an (Inline-"+ Neu" im Dropdown).
// Existiert bereits ein (auch deaktivierter) Eintrag mit demselben Namen für
// diesen Mandanten, wird dieser reaktiviert statt ein Duplikat anzulegen.
export async function createCustomWeinbaugebiet(name: string): Promise<CustomWeinbaugebiet | null> {
  const trimmed = name.trim()
  if (!trimmed) return null

  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const { data: bestehend } = await (supabase.from('weinbaugebiete_custom') as any)
    .select('id, name, aktiv')
    .eq('tenant_id', tenantId)
    .ilike('name', trimmed)
    .maybeSingle()

  if (bestehend) {
    const b = bestehend as AR
    if (!b.aktiv) {
      { const { error: e } = await (supabase.from('weinbaugebiete_custom') as any).update({ aktiv: true }).eq('id', b.id).eq('tenant_id', tenantId)
        if (e) throw new Error(`Speichern fehlgeschlagen (weinbaugebiete_custom): ${e.message}`) }
    }
    return { id: b.id, name: b.name }
  }

  const { data, error } = await (supabase.from('weinbaugebiete_custom') as any)
    .insert({ tenant_id: tenantId, name: trimmed })
    .select('id, name')
    .single()

  if (error) throw new Error((error as AR).message)
  return data as CustomWeinbaugebiet
}

// Deaktiviert ein eigenes Weinbaugebiet (bereits verwendete Werte auf
// bestehenden Datensätzen bleiben unverändert – nur die Auswahlliste für
// zukünftige Erfassungen wird bereinigt).
export async function deaktiviereCustomWeinbaugebiet(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('weinbaugebiete_custom') as any)
    .update({ aktiv: false })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
}
