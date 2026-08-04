'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type CustomWeinbaugebiet = { id: string; name: string }

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
}

// Lädt die eigenen (aktiven) Weinbaugebiete des Mandanten – wird server-seitig
// von allen Seiten geladen, die das Herkunft-Code(BKI)-Dropdown rendern
// (Grundstück-Formular, Füllung anlegen/bearbeiten).
export async function ladeCustomWeinbaugebiete(): Promise<CustomWeinbaugebiet[]> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('weinbaugebiete_custom') as any)
    .select('id, name')
    .eq('aktiv', true)
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
      await (supabase.from('weinbaugebiete_custom') as any).update({ aktiv: true }).eq('id', b.id)
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
