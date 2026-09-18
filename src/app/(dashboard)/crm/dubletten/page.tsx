import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import DublettenClient, { type DublettenGruppe } from './DublettenClient'

export const metadata: Metadata = { title: 'Kontakt-Dubletten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Mögliche Dubletten (gleiche E-Mail bzw. gleicher Name) aus dem Morgenbericht
// als Liste mit Zusammenführen – serverseitig über RPC crm_dubletten (Migration 213),
// damit auch große Kontaktbestände vollständig geprüft werden.
export default async function DublettenPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const writeOk = canWrite(membership?.role ?? null)

  let gruppen: DublettenGruppe[] = []
  let fehler: string | null = null
  if (tenantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('crm_dubletten', { p_tenant_id: tenantId })
    if (error) fehler = error.message
    gruppen = ((data ?? []) as R[]).map(g => ({
      art: g.art === 'email' ? 'email' : 'name',
      schluessel: String(g.schluessel),
      anzahl: Number(g.anzahl ?? 0),
      kontakte: ((g.kontakte ?? []) as R[]).map(k => ({
        id: String(k.id),
        accountnummer: k.accountnummer ?? null,
        vorname: k.vorname ?? null,
        nachname: k.nachname ?? null,
        email: k.email ?? null,
        email_weitere: Array.isArray(k.email_weitere) ? (k.email_weitere as string[]) : [],
        plz: k.plz ?? null,
        ort: k.ort ?? null,
        telefon: k.telefon ?? null,
        is_lead: !!k.is_lead,
        erstellt_am: k.erstellt_am ?? null,
        firma_id: k.firma_id ?? null,
        anz_aktivitaeten: Number(k.anz_aktivitaeten ?? 0),
        anz_verkaeufe: Number(k.anz_verkaeufe ?? 0),
      })),
    }))
  }

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/crm" className="hover:text-s112-blue-700 transition-colors">CRM</Link>
        <span>/</span>
        <Link href="/crm/kontakte" className="hover:text-s112-blue-700 transition-colors">Kontakte</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Dubletten</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Mögliche Kontakt-Dubletten</h1>
          <p className="text-sm text-s112-muted mt-0.5">Gleiche E-Mail-Adresse oder gleicher Name · prüfen, zusammenführen oder als „keine Dublette“ markieren</p>
        </div>
        <span className="text-sm text-s112-muted">{gruppen.length} {gruppen.length === 1 ? 'Gruppe' : 'Gruppen'}</span>
      </div>

      {fehler && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm mb-4">
          Dubletten konnten nicht geladen werden: {fehler}
        </div>
      )}

      <DublettenClient gruppen={gruppen} writeOk={writeOk} />
    </div>
  )
}
