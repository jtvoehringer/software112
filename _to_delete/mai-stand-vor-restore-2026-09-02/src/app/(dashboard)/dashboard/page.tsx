import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Übersicht – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memberships } = await supabase
    .from('tenant_memberships')
    .select('role, tenants(name)')

  type MembershipRow = { role: string; tenants: { name: string } | null }
  const membership = (memberships as MembershipRow[] | null)?.[0]
  const tenantName = membership?.tenants?.name ?? null

  // ── Live-Kennzahlen ────────────────────────────────────────────────
  const [
    { count: fuellungenCount },
    { count: weinausbauCount },
    { count: verkaufCount },
    { count: kontakteCount },
    { count: preislistenCount },
    { data: letzteVerkaeufRaw },
    { data: topsRaw },
  ] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('fuellungen') as any)
      .select('*', { count: 'exact', head: true })
      .eq('aktiv', true)
      .gt('bestand_flaschen', 0),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinausbau') as any)
      .select('*', { count: 'exact', head: true })
      .eq('aktiv', true),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('verkaufsposten') as any)
      .select('*', { count: 'exact', head: true })
      .eq('aktiv', true),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kontakte') as any)
      .select('*', { count: 'exact', head: true })
      .eq('aktiv', true),

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('preislisten') as any)
      .select('*', { count: 'exact', head: true })
      .eq('aktiv', true),

    // Letzte 5 Verkäufe
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer,
        kontakt:kontakte(vorname, nachname),
        firma:firmen(name),
        positionen:verkauf_positionen(preis_brutto, menge)
      `)
      .eq('aktiv', true)
      .order('datum', { ascending: false })
      .limit(5),

    // Top-Füllungen nach Bestand
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, bestand_flaschen, vk_preis_brutto')
      .eq('aktiv', true)
      .gt('bestand_flaschen', 0)
      .order('bestand_flaschen', { ascending: false })
      .limit(5),
  ])

  const letzteVerkaeufe = (letzteVerkaeufRaw ?? []) as R[]
  const tops = (topsRaw ?? []) as R[]

  function kundenName(p: R): string {
    if (p.kontakt) return [p.kontakt.vorname, p.kontakt.nachname].filter(Boolean).join(' ')
    if (p.firma)   return p.firma.name
    return '–'
  }

  function verkaufSumme(p: R): number {
    return ((p.positionen ?? []) as R[]).reduce((s: number, pos: R) => {
      return s + (pos.preis_brutto != null ? Number(pos.preis_brutto) * Number(pos.menge) : 0)
    }, 0)
  }

  const heute = new Date()
  const monatVon = new Date(heute.getFullYear(), heute.getMonth(), 1).toISOString().split('T')[0]

  return (
    <div className="space-y-8">

      {/* Begrüßung */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {tenantName ?? 'Übersicht'}
        </h1>
        <p className="text-s112-muted text-sm mt-1">
          {heute.toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* ── KPI-Kacheln ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Link href="/weinhandel" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{fuellungenCount ?? 0}</p>
          <p className="text-xs text-s112-muted mt-0.5">Artikel im Lager</p>
        </Link>
        <Link href="/kellerbuch" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{weinausbauCount ?? 0}</p>
          <p className="text-xs text-s112-muted mt-0.5">Weinausbau-Chargen</p>
        </Link>
        <Link href="/weinhandel/verkauf" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{verkaufCount ?? 0}</p>
          <p className="text-xs text-s112-muted mt-0.5">Verkaufsvorgänge</p>
        </Link>
        <Link href="/weinhandel/preisliste" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{preislistenCount ?? 0}</p>
          <p className="text-xs text-s112-muted mt-0.5">Aktive Preislisten</p>
        </Link>
        <Link href="/crm/kontakte" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{kontakteCount ?? 0}</p>
          <p className="text-xs text-s112-muted mt-0.5">CRM-Kontakte</p>
        </Link>
      </div>

      {/* ── Untere zwei Spalten ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Letzte Verkäufe */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Letzte Verkäufe</h2>
            <Link href="/weinhandel/verkauf" className="text-xs text-s112-teal hover:underline">alle →</Link>
          </div>
          {letzteVerkaeufe.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-2xl mb-2">🛒</p>
              <p className="text-xs text-s112-muted">Noch keine Verkäufe</p>
              <Link href="/weinhandel/verkauf/neu" className="text-xs text-s112-teal hover:underline mt-1 inline-block">
                Ersten Verkauf anlegen →
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {letzteVerkaeufe.map((v: R) => {
                const summe = verkaufSumme(v)
                return (
                  <Link
                    key={v.id}
                    href={`/weinhandel/verkauf/${v.id}`}
                    className="flex items-center justify-between py-2 border-b border-s112-border last:border-0 hover:text-s112-teal group"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-800 group-hover:text-s112-teal">
                        {kundenName(v)}
                      </p>
                      <p className="text-xs text-s112-muted">
                        {new Date(v.datum).toLocaleDateString('de-AT')}
                        {v.rechnungsnummer && <span className="ml-2 font-mono">{v.rechnungsnummer}</span>}
                      </p>
                    </div>
                    {summe > 0 && (
                      <p className="text-sm font-semibold text-s112-teal tabular-nums">
                        {summe.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                      </p>
                    )}
                  </Link>
                )
              })}
            </div>
          )}
        </div>

        {/* Lager-Top 5 */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Lager – meiste Flaschen</h2>
            <Link href="/weinhandel" className="text-xs text-s112-teal hover:underline">alle →</Link>
          </div>
          {tops.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-2xl mb-2">🍾</p>
              <p className="text-xs text-s112-muted">Kein Lagerbestand</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tops.map((f: R) => (
                <div key={f.id} className="flex items-center justify-between py-2 border-b border-s112-border last:border-0">
                  <div>
                    <p className="text-sm font-medium text-gray-800">
                      {f.name}{f.jahrgang ? <span className="text-s112-muted font-normal ml-1">{f.jahrgang}</span> : null}
                    </p>
                    {f.vk_preis_brutto != null && (
                      <p className="text-xs text-s112-muted">
                        {Number(f.vk_preis_brutto).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })} / Fl.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-800 tabular-nums">{f.bestand_flaschen}</p>
                    <p className="text-xs text-s112-muted">Flaschen</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Schnellzugriff ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-s112-muted uppercase tracking-wider mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { href: '/weinhandel/verkauf/neu',  icon: '🛒', label: 'Neuer Verkauf'   },
            { href: '/weinhandel/fuellungen/neu', icon: '🍾', label: 'Füllen'          },
            { href: '/weinhandel/preisliste',   icon: '🏷️', label: 'Preislisten'     },
            { href: '/crm/kontakte',            icon: '🤝', label: 'CRM-Kontakte'    },
          ].map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="card p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-sm transition-all"
            >
              <span className="text-xl">{item.icon}</span>
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
