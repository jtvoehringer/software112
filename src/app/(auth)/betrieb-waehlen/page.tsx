import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import BetriebListe, { type BetriebEintrag } from './BetriebListe'
import { BetriebsPruefMelder } from '@/components/BetriebsWaechter'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ROLE_LABEL: Record<string, string> = {
  tenant_admin: 'Betriebs-Manager',
  winzer:       'Mitarbeiter',
  leser:        'Leser',
  system_admin: 'Super-Admin',
}

export default async function BetriebWaehlenPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Alle Memberships mit Tenant-Info laden.
  // WICHTIG: .eq('user_id', ...) explizit setzen statt nur auf RLS zu
  // vertrauen – die RLS-Policy "memberships: tenant_admin can view all in
  // tenant" erlaubt system_admin/tenant_admin absichtlich das Lesen ALLER
  // Mitgliedschafts-Zeilen eines Mandanten (für /benutzer-Verwaltung).
  // Ohne diesen Filter sah ein system_admin hier eine Karte pro
  // Mitgliedschafts-Zeile im Mandanten (also z.B. eine Karte pro User mit
  // Zugriff auf "Sandbox"), statt eine Karte pro eigenem Mandanten.
  // .eq('aktiv', true) blendet zusätzlich gesperrte Mitgliedschaften aus,
  // konsistent mit dem Mitgliedschaft-Aktiv-Toggle (Migration 159).
  // alle(): auch bei mehreren hundert Betrieben vollständig (PostgREST kappt bei 1.000)
  const { data: memberships } = await alle((supabase.from('tenant_memberships') as any)
    .select('tenant_id, role, tenants(name, slug)')
    .eq('user_id', user.id)
    .eq('aktiv', true)
    .order('created_at', { ascending: true }).order('tenant_id'))

  if (!memberships || memberships.length === 0) redirect('/login')

  // Einzelner Betrieb: über den Route Handler setzen (Cookies dürfen nicht
  // beim Rendern geschrieben werden – sonst Serverfehler beim ersten Login).
  if (memberships.length === 1) {
    redirect(`/auth/betrieb?tenant_id=${(memberships[0] as R).tenant_id}`)
  }

  // Anzeigenamen aus tenant_einstellungen laden
  const tenantIds = (memberships as R[]).map(m => m.tenant_id)
  // Bewusst mandantenübergreifend: diese Seite existiert genau dafür, ALLE eigenen Betriebe
  // zur Auswahl anzuzeigen (bevor ein „aktiver“ Tenant gewählt wurde).
  // Ohne .in(): bei mehreren hundert Betrieben würde die URL zu lang; RLS liefert ohnehin
  // nur die Einstellungen der eigenen Betriebe, gefiltert wird zusätzlich über tenantIds.
  // tenant-isolation-ignore: mandantenübergreifende Auswahlseite, siehe Kommentar oben
  const { data: einstellungen } = await alle((supabase.from('tenant_einstellungen') as any)
    .select('tenant_id, anzeigename, logo_url, primary_color').order('tenant_id'))

  const eigene = new Set(tenantIds)
  const anzeigeMap: Record<string, { anzeigename: string | null; logo_url: string | null; primary_color: string | null }> = {}
  for (const e of (einstellungen ?? []) as R[]) {
    if (eigene.has(e.tenant_id)) anzeigeMap[e.tenant_id] = { anzeigename: e.anzeigename, logo_url: e.logo_url, primary_color: e.primary_color ?? null }
  }

  const betriebe: BetriebEintrag[] = (memberships as R[]).map(m => {
    const tenant = m.tenants as R
    const eins = anzeigeMap[m.tenant_id]
    return {
      tenantId: m.tenant_id,
      displayName: eins?.anzeigename || tenant?.name || m.tenant_id,
      slug: tenant?.slug ?? '',
      roleLabel: ROLE_LABEL[m.role] ?? m.role,
      accentColor: eins?.primary_color ?? null,
    }
  })

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-s112-blue-700 inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">Welchen Betrieb möchtest du öffnen?</p>
        </div>

        {/* Betrieb-Karten – ab 8 Betrieben mit Suchfeld und „zuletzt geöffnet“ */}
        <BetriebListe betriebe={betriebe} />

        <p className="text-center text-xs text-s112-muted mt-6">
          Angemeldet als {user.email}
        </p>
      </div>
      {/* KAN-30: Wechselwege, die hier landen (z. B. /auth/betrieb?weiter=/betrieb-waehlen), den anderen Tabs melden */}
      <BetriebsPruefMelder />
    </div>
  )
}
