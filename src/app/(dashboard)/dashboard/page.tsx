import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Übersicht – software:112' }
export const dynamic = 'force-dynamic'
type AR = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function DashboardPage() {
  const supabase = await createSupabaseServerClient()

  const { data: memberships } = await supabase
    .from('tenant_memberships')
    .select('role, tenants(name)')
  type MembershipRow = { role: string; tenants: { name: string } | null }
  const membership = (memberships as MembershipRow[] | null)?.[0]
  const tenantName = membership?.tenants?.name ?? null

  const heute = new Date()
  const monatVon  = new Date(heute.getFullYear(), heute.getMonth(), 1).toISOString().split('T')[0]
  const monatBis  = new Date(heute.getFullYear(), heute.getMonth() + 1, 0).toISOString().split('T')[0]
  const vorMonVon = new Date(heute.getFullYear(), heute.getMonth() - 1, 1).toISOString().split('T')[0]
  const vorMonBis = new Date(heute.getFullYear(), heute.getMonth(), 0).toISOString().split('T')[0]
  const heuteStr  = heute.toISOString().split('T')[0]

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const q = (t: string) => (supabase.from(t) as any)

  const [
    { count: fuellungenCount },
    { count: weinausbauCount },
    { count: kontakteCount },
    { data: offenePostenRaw },
    { data: monatsVerkaufRaw },
    { data: vormonatsVerkaufRaw },
    { data: letzteVerkaeufRaw },
    { data: topsRaw },
    { data: naechsteAktivitaetenRaw },
    { count: leadCount },
  ] = await Promise.all([
    q('fuellungen').select('*', { count: 'exact', head: true }).eq('aktiv', true).gt('bestand_flaschen', 0),
    q('weinausbau').select('*', { count: 'exact', head: true }).eq('aktiv', true),
    q('kontakte').select('*', { count: 'exact', head: true }).eq('aktiv', true),

    // Offene Posten (unbezahlt, nicht storniert)
    q('verkaufsposten')
      .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('bezahlt', false).eq('storniert', false),

    // Verkäufe aktueller Monat
    q('verkaufsposten')
      .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).gte('datum', monatVon).lte('datum', monatBis),

    // Verkäufe Vormonat
    q('verkaufsposten')
      .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).gte('datum', vorMonVon).lte('datum', vorMonBis),

    // Letzte 5 Verkäufe
    q('verkaufsposten')
      .select('id, datum, rechnungsnummer, bezahlt, storniert, kontakt:kontakte(vorname, nachname), firma:firmen(name), positionen:verkauf_positionen(preis_brutto, menge)')
      .eq('aktiv', true).order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).limit(5),

    // Top-Füllungen nach Bestand
    q('fuellungen')
      .select('id, name, jahrgang, bestand_flaschen, vk_preis_brutto')
      .eq('aktiv', true).gt('bestand_flaschen', 0)
      .order('bestand_flaschen', { ascending: false }).limit(5),

    // Nächste unerledigte Aktivitäten
    q('aktivitaeten')
      .select('id, art, betreff, datum, erledigt, kontakt:kontakte(vorname, nachname), firma:firmen(name)')
      .eq('erledigt', false).gte('datum', heuteStr)
      .order('datum', { ascending: true }).limit(4),

    // Leads zählen
    q('kontakte').select('*', { count: 'exact', head: true }).eq('aktiv', true).eq('is_lead', true),
  ])

  function posSum(posten: R[]): number {
    return (posten ?? []).reduce((s: number, p: R) => {
      const pos = (p.positionen ?? p.verkauf_positionen ?? []) as R[]
      return s + pos.reduce((ps: number, pos: R) => {
        const brutto = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0)
        const r = (Number(pos.rabatt_pct) || 0) / 100
        const sr = (Number(pos.sonderrabatt_pct) || 0) / 100
        return ps + brutto * (1 - r) * (1 - sr)
      }, 0)
    }, 0)
  }

  const monatUmsatz   = posSum((monatsVerkaufRaw    ?? []) as R[])
  const vormonUmsatz  = posSum((vormonatsVerkaufRaw ?? []) as R[])
  const offenePosten  = posSum((offenePostenRaw     ?? []) as R[])
  const letzteVerkaeufe = (letzteVerkaeufRaw ?? []) as R[]
  const tops            = (topsRaw ?? []) as R[]
  const naechsteAkt     = (naechsteAktivitaetenRaw ?? []) as R[]

  const umsatzDelta = vormonUmsatz > 0
    ? ((monatUmsatz - vormonUmsatz) / vormonUmsatz * 100).toFixed(0)
    : null

  function kundenName(p: R): string {
    if (p.kontakt) return [p.kontakt.vorname, p.kontakt.nachname].filter(Boolean).join(' ')
    if (p.firma)   return p.firma.name
    return '–'
  }
  function aktKundenName(a: R): string {
    if (a.kontakt) return [a.kontakt.vorname, a.kontakt.nachname].filter(Boolean).join(' ')
    if (a.firma)   return a.firma.name
    return ''
  }

  const ART_ICON: Record<string, string> = {
    anruf: '📞', email: '✉', besuch: '🚗', notiz: '📝',
    angebot: '📋', verkostung: '🍷', messe: '🎪',
  }


  // Meine Aktivitäten (nächste 30 Tage, offen)
  const { data: { user } } = await supabase.auth.getUser()
  const in30 = new Date(Date.now() + 30*24*60*60*1000).toISOString().split('T')[0]
  const { data: meineAkts } = await (supabase.from('aktivitaeten') as any)
    .select('id, art, betreff, datum, erledigt, kontakt_id, firma_id, kontakte(vorname,nachname), firmen(name)')
    .eq('erledigt', false)
    .gte('datum', heuteStr).lte('datum', in30)
    .order('datum', { ascending: true }).limit(10)

  const monatName = heute.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">

      {/* Begrüßung */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{tenantName ?? 'Übersicht'}</h1>
        <p className="text-s112-muted text-sm mt-1">
          {heute.toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* ── KPI-Kacheln ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Monatsumsatz */}
        <Link href="/weinhandel/verkauf" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-xs text-s112-muted mb-1">{monatName}</p>
          <p className="text-2xl font-bold text-s112-teal tabular-nums">
            {monatUmsatz.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </p>
          <div className="flex items-center gap-1 mt-1">
            <p className="text-xs text-s112-muted">Umsatz</p>
            {umsatzDelta !== null && (
              <span className={`text-xs font-semibold ml-auto ${Number(umsatzDelta) >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {Number(umsatzDelta) >= 0 ? '▲' : '▼'} {Math.abs(Number(umsatzDelta))} %
              </span>
            )}
          </div>
        </Link>

        {/* Offene Posten */}
        <Link href="/weinhandel/offene-posten" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-xs text-s112-muted mb-1">Offene Posten</p>
          <p className={`text-2xl font-bold tabular-nums ${offenePosten > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
            {offenePosten.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-s112-muted mt-1">unbezahlt, nicht storniert</p>
        </Link>

        {/* Lagerbestand */}
        <Link href="/weinhandel" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-xs text-s112-muted mb-1">Lager</p>
          <p className="text-2xl font-bold text-s112-teal tabular-nums">{fuellungenCount ?? 0}</p>
          <p className="text-xs text-s112-muted mt-1">Artikel mit Bestand</p>
        </Link>

        {/* Leads */}
        <Link href="/crm/kontakte" className="card p-4 hover:shadow-md transition-shadow">
          <p className="text-xs text-s112-muted mb-1">Leads</p>
          <p className="text-2xl font-bold text-amber-500 tabular-nums">{leadCount ?? 0}</p>
          <div className="flex items-center gap-1 mt-1">
            <p className="text-xs text-s112-muted">{kontakteCount ?? 0} Kontakte gesamt</p>
          </div>
        </Link>
      </div>

      {/* ── Untere drei Spalten ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Letzte Verkäufe */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Letzte Verkäufe</h2>
            <Link href="/weinhandel/verkauf" className="text-xs text-s112-teal hover:underline">alle →</Link>
          </div>
          {letzteVerkaeufe.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xl mb-1">🛒</p>
              <p className="text-xs text-s112-muted">Noch keine Verkäufe</p>
            </div>
          ) : (
            <div className="space-y-2">
              {letzteVerkaeufe.map((v: R) => (
                <Link key={v.id} href={`/weinhandel/verkauf/${v.id}`}
                  className="flex items-center justify-between py-2 border-b border-s112-border last:border-0 hover:text-s112-teal group">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 group-hover:text-s112-teal truncate">{kundenName(v)}</p>
                    <p className="text-xs text-s112-muted">
                      {new Date(v.datum).toLocaleDateString('de-AT')}
                      {v.storniert && <span className="ml-1 text-red-400">Storniert</span>}
                      {v.bezahlt && !v.storniert && <span className="ml-1 text-green-500">✓</span>}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* Meine Aktivitäten */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Meine Aktivitäten</h2>
            <Link href="/crm" className="text-xs text-s112-teal hover:underline">Kalender →</Link>
          </div>
          {(meineAkts ?? []).length === 0 ? (
            <div className="text-center py-4">
              <p className="text-xs text-s112-muted">Keine offenen Aktivitäten in den nächsten 30 Tagen</p>
            </div>
          ) : (
            <div className="space-y-2">
              {(meineAkts as AR[]).map(a => {
                const who = a.kontakte ? [a.kontakte.vorname, a.kontakte.nachname].filter(Boolean).join(' ') : a.firmen?.name ?? ''
                return (
                  <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-s112-border/30 last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-gray-800 truncate">{a.betreff}</p>
                      {who && <p className="text-[10px] text-s112-muted truncate">{who}</p>}
                    </div>
                    <span className="text-[10px] text-s112-muted flex-shrink-0">{new Date(a.datum).toLocaleDateString('de-AT', {day:'2-digit',month:'2-digit'})}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Nächste Aktivitäten */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-700 text-sm">Nächste Termine</h2>
            <Link href="/crm" className="text-xs text-s112-teal hover:underline">Kalender →</Link>
          </div>
          {naechsteAkt.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-xl mb-1">📅</p>
              <p className="text-xs text-s112-muted">Keine offenen Termine</p>
              <Link href="/crm" className="text-xs text-s112-teal hover:underline mt-1 inline-block">Aktivität anlegen →</Link>
            </div>
          ) : (
            <div className="space-y-2">
              {naechsteAkt.map((a: R) => (
                <div key={a.id} className="flex items-start gap-2 py-2 border-b border-s112-border last:border-0">
                  <span className="text-base flex-shrink-0 mt-0.5">{ART_ICON[a.art] ?? '📝'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{a.betreff || a.art}</p>
                    <p className="text-xs text-s112-muted">
                      {new Date(a.datum).toLocaleDateString('de-AT')}
                      {aktKundenName(a) && <span className="ml-1">· {aktKundenName(a)}</span>}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Schnellzugriff ───────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-s112-muted uppercase tracking-wider mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { href: '/weinhandel/verkauf/neu',    icon: '🛒', label: 'Neuer Verkauf'    },
            { href: '/weinhandel/fuellungen/neu',  icon: '🍾', label: 'Füllen'           },
            { href: '/crm',                        icon: '📅', label: 'Aktivität'        },
            { href: '/kellerbuch/umziehen',        icon: '🔄', label: 'Umziehen'         },
            { href: '/weinhandel/offene-posten',   icon: '💶', label: 'Offene Posten'    },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="card p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-sm transition-all">
              <span className="text-xl">{item.icon}</span>
              <span className="text-sm font-medium text-gray-700">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>

    </div>
  )
}
