import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import MandantenClient from './MandantenClient'

export const metadata: Metadata = { title: 'Mandanten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type MandantRow = {
  id: string
  name: string
  erstellt_am: string
  benutzer_anzahl: number
  // Branding
  anzeigename:      string | null
  logo_url:         string | null
  primary_color:    string
  secondary_color:  string
  modul_newsletter: boolean
}

export default async function MandantenPage() {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') redirect('/dashboard')

  const supabase = createSupabaseAdminClient()

  const [{ data: tenants }, { data: memberships }] = await Promise.all([
    (supabase.from('tenants') as any).select('id, name, created_at').order('created_at'),
    (supabase.from('tenant_memberships') as any).select('tenant_id'),
  ])

  // tenant_einstellungen existiert erst nach Migration 021 → graceful fallback
  let einstellungen: R[] = []
  try {
    const { data } = await (supabase.from('tenant_einstellungen') as any)
      .select('tenant_id, anzeigename, logo_url, primary_color, secondary_color, modul_newsletter')
    einstellungen = (data ?? []) as R[]
  } catch {
    // Tabelle noch nicht migriert – Branding-Felder bleiben leer
  }

  // Benutzeranzahl je Mandant zählen
  const countMap: Record<string, number> = {}
  for (const m of (memberships ?? []) as R[]) {
    countMap[m.tenant_id] = (countMap[m.tenant_id] ?? 0) + 1
  }

  // Branding-Map
  const brandingMap: Record<string, R> = {}
  for (const e of (einstellungen ?? []) as R[]) {
    brandingMap[e.tenant_id] = e
  }

  const mandanten: MandantRow[] = ((tenants ?? []) as R[]).map(t => {
    const b = brandingMap[t.id]
    return {
      id:              t.id,
      name:            t.name,
      erstellt_am:     t.created_at,
      benutzer_anzahl: countMap[t.id] ?? 0,
      anzeigename:     b?.anzeigename ?? null,
      logo_url:        b?.logo_url ?? null,
      primary_color:   b?.primary_color ?? '#2a7c6f',
      secondary_color: b?.secondary_color ?? '#f5c842',
      modul_newsletter: b?.modul_newsletter ?? false,
    }
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Mandanten</h1>
          <p className="text-sm text-s112-muted mt-0.5">Alle Betriebe auf dieser Instanz</p>
        </div>
        <span className="text-sm text-s112-muted">{mandanten.length} Mandanten</span>
      </div>
      <MandantenClient mandanten={mandanten} />
    </div>
  )
}
