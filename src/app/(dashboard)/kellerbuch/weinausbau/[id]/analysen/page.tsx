import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { ZAHL_LOCALE } from '@/lib/format'

export const metadata: Metadata = { title: 'Laboranalysen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmtDate(d: string | null | undefined) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function fmtNum(v: number | null | undefined, dec = 2): string {
  if (v == null) return '–'
  return parseFloat(String(v)).toLocaleString(ZAHL_LOCALE, { minimumFractionDigits: dec, maximumFractionDigits: dec })
}

type Analyse = {
  id: string
  analyse_datum: string
  labor: string | null
  probe_nr: string | null
  alkohol_vol: number | null
  restzucker_gl: number | null
  gesamtsaeure_gl: number | null
  ph_wert: number | null
  flüchtige_saeure_gl: number | null
  freie_so2_mgl: number | null
  gesamt_so2_mgl: number | null
  bewertung: string | null
  notizen: string | null
}

export default async function AnalysenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role)
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: waRaw }, { data: anRaw }] = await Promise.all([
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte')
      .eq('id', id).maybeSingle()),
    tf((supabase.from('weinanalysen') as any)
      .select('id, analyse_datum, labor, probe_nr, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl, bewertung, notizen')
      .eq('weinausbau_id', id)
      .order('analyse_datum', { ascending: false })),
  ])

  if (!waRaw) notFound()
  const wa = waRaw as R
  const analysen = (anRaw ?? []) as Analyse[]

  return (
    <div className="max-w-4xl space-y-6">

      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-s112-muted flex-wrap">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
        <span>/</span>
        <Link href={`/kellerbuch/weinausbau/${id}`} className="hover:text-s112-blue-700">{wa.name}</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Laboranalysen</span>
      </nav>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Laboranalysen</h1>
          <p className="text-sm text-s112-muted mt-0.5">
            {wa.name}{wa.jahrgang ? ` · ${wa.jahrgang}` : ''}{wa.rebsorte ? ` · ${formatRebsorteMitKuerzel(wa.rebsorte)}` : ''}
          </p>
        </div>
        {writeOk && (
          <Link
            href={`/kellerbuch/weinausbau/${id}/analysen/neu`}
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            + Analyse erfassen
          </Link>
        )}
      </div>

      {/* Liste */}
      {analysen.length === 0 ? (
        <div className="card text-center py-12 text-s112-muted">
          <p className="font-medium text-s112-text-2">Noch keine Analysen erfasst</p>
          {writeOk && (
            <Link
              href={`/kellerbuch/weinausbau/${id}/analysen/neu`}
              className="mt-4 inline-block text-sm text-s112-blue-700 hover:underline"
            >
              Erste Analyse erfassen →
            </Link>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {analysen.map((a) => (
            <div key={a.id} className="card space-y-4">
              {/* Kopf */}
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <p className="font-semibold text-s112-text">{fmtDate(a.analyse_datum)}</p>
                  <p className="text-sm text-s112-muted">
                    {a.labor ? a.labor : 'Eigenlabor'}
                    {a.probe_nr ? ` · Probe-Nr. ${a.probe_nr}` : ''}
                  </p>
                </div>
                <span className="text-xs bg-s112-blue-50 text-s112-blue-700 border border-s112-blue-100 px-2 py-0.5 rounded-lg font-medium">
                  Analyse
                </span>
              </div>

              {/* Parameter-Tabelle */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-2 text-sm">
                {a.alkohol_vol != null && (
                  <div>
                    <span className="text-s112-muted text-xs">Alkohol</span>
                    <p className="font-medium tabular-nums">{fmtNum(a.alkohol_vol)} % vol</p>
                  </div>
                )}
                {a.restzucker_gl != null && (
                  <div>
                    <span className="text-s112-muted text-xs">Restzucker</span>
                    <p className="font-medium tabular-nums">{fmtNum(a.restzucker_gl)} g/l</p>
                  </div>
                )}
                {a.gesamtsaeure_gl != null && (
                  <div>
                    <span className="text-s112-muted text-xs">Gesamtsäure</span>
                    <p className="font-medium tabular-nums">{fmtNum(a.gesamtsaeure_gl)} g/l</p>
                  </div>
                )}
                {a.ph_wert != null && (
                  <div>
                    <span className="text-s112-muted text-xs">pH-Wert</span>
                    <p className="font-medium tabular-nums">{fmtNum(a.ph_wert)}</p>
                  </div>
                )}
                {a['flüchtige_saeure_gl'] != null && (
                  <div>
                    <span className="text-s112-muted text-xs">Flüchtige Säure</span>
                    <p className="font-medium tabular-nums">{fmtNum(a['flüchtige_saeure_gl'])} g/l</p>
                  </div>
                )}
                {a.freie_so2_mgl != null && (
                  <div>
                    <span className="text-s112-muted text-xs">Freies SO₂</span>
                    <p className="font-medium tabular-nums">{fmtNum(a.freie_so2_mgl)} mg/l</p>
                  </div>
                )}
                {a.gesamt_so2_mgl != null && (
                  <div>
                    <span className="text-s112-muted text-xs">Gesamt-SO₂</span>
                    <p className="font-medium tabular-nums">{fmtNum(a.gesamt_so2_mgl)} mg/l</p>
                  </div>
                )}
              </div>

              {/* Bewertung / Notizen */}
              {(a.bewertung || a.notizen) && (
                <div className="border-t border-s112-border pt-3 space-y-1 text-sm text-s112-text-2">
                  {a.bewertung && <p><span className="font-medium">Bewertung:</span> {a.bewertung}</p>}
                  {a.notizen   && <p><span className="font-medium">Notizen:</span> {a.notizen}</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
