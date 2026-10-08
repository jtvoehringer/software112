'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type CustomWeinbaugebiet = { id: string; name: string }

// Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
// beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
// Daten eines anderen Betriebs als des gerade ausgewählten angezeigt/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

// Für die schreibenden Actions (KAN-30): Seite aus einem anderen Betrieb? – nicht in
// getTenantId(), weil ladeCustomWeinbaugebiete() auch beim Rendern der Seiten läuft.
// Aus demselben Grund steht hier auch die Schreibsperre (KAN-5, Nur-Lesen-Modus).
async function schreibTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  // KAN-242: wie RLS (modul_insert/_update auf weinbaugebiete_custom = Rieden) – auch aus dem Füllungsformular
  if (!canWrite(membership, 'rieden')) throw new AktionsFehler('Keine Berechtigung, eigene Weinbaugebiete anzulegen – dafür ist die Freigabe Rieden nötig.')
  return membership.tenantId
}

// Lädt die eigenen (aktiven) Weinbaugebiete des Mandanten – wird server-seitig
// von allen Seiten geladen, die das Herkunft-Code(BKI)-Dropdown rendern
// (Grundstück-Formular, Füllung anlegen/bearbeiten).
// schreibsperre-ausnahme: nur lesend – läuft beim Rendern der Seiten (Herkunft-Dropdown)
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
  const tenantId = await schreibTenantId()

  const { data: bestehend } = await (supabase.from('weinbaugebiete_custom') as any)
    .select('id, name, aktiv')
    .eq('tenant_id', tenantId)
    .ilike('name', trimmed)
    .maybeSingle()

  if (bestehend) {
    const b = bestehend as AR
    if (!b.aktiv) {
      { const { error: e } = await (supabase.from('weinbaugebiete_custom') as any).update({ aktiv: true }).eq('id', b.id).eq('tenant_id', tenantId)
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinbaugebiete_custom): ${e.message}`) }
    }
    return { id: b.id, name: b.name }
  }

  const { data, error } = await (supabase.from('weinbaugebiete_custom') as any)
    .insert({ tenant_id: tenantId, name: trimmed })
    .select('id, name')
    .single()

  if (error) throw new AktionsFehler((error as AR).message)
  return data as CustomWeinbaugebiet
}

// Deaktiviert ein eigenes Weinbaugebiet (bereits verwendete Werte auf
// bestehenden Datensätzen bleiben unverändert – nur die Auswahlliste für
// zukünftige Erfassungen wird bereinigt).
export async function deaktiviereCustomWeinbaugebiet(id: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await schreibTenantId()
  const { error } = await (supabase.from('weinbaugebiete_custom') as any)
    .update({ aktiv: false })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
}
