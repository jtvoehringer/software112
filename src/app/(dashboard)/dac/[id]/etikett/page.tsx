import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import PrintButton from './PrintButton'

export const metadata: Metadata = { title: 'Weinetikett – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const DAC_REGION_LABEL: Record<string, string> = {
  weinviertel: 'Weinviertel DAC', kamptal: 'Kamptal DAC', kremstal: 'Kremstal DAC',
  wachau: 'Wachau', wagram: 'Wagram DAC', traisental: 'Traisental DAC',
  carnuntum: 'Carnuntum DAC', leithaberg: 'Leithaberg DAC',
  neusiedlersee: 'Neusiedlersee DAC', mittelburgenland: 'Mittelburgenland DAC',
  eisenberg: 'Eisenberg DAC', rosalia: 'Rosalia DAC',
  wiener_gemischter_satz: 'Wiener Gemischter Satz DAC', sonstiges: 'Österreich',
}

function fmtMenge(liter: number | null): string {
  if (!liter) return '–'
  if (liter < 1) return `${(liter * 1000).toFixed(0)} ml`
  return `${liter.toFixed(2).replace('.', ',')} L`
}

export default async function EtikettPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: rows }, { data: settingsRaw }] = await Promise.all([
    tf((supabase.from('dac_antrag') as any)
      .select('id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, bescheid_am')
      .eq('id', id).limit(1)),
    tf((supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url')
      .limit(1)).maybeSingle(),
  ])

  const dac = (((rows ?? []) as R[])[0] ?? null) as R | null
  if (!dac) notFound()

  const s = (settingsRaw as R | null) ?? {}

  const regionLabel = DAC_REGION_LABEL[dac.dac_region] ?? dac.dac_region

  return (
    <div className="max-w-2xl space-y-6">

      {/* Breadcrumb + Aktionen (ausgeblendet beim Drucken) */}
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/dac" className="hover:text-s112-blue-700">Prüfnummern</Link>
          <span>/</span>
          <Link href={`/dac/${id}`} className="hover:text-s112-blue-700">{dac.bezeichnung}</Link>
          <span>/</span>
          <span className="text-s112-text-1 font-medium">Etikett</span>
        </nav>
        <PrintButton />
      </div>

      {/* Hinweis wenn noch keine Prüfnummer */}
      {!dac.pruefnummer && (
        <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-sm text-s112-warn-fg print:hidden">
          Noch keine Prüfnummer vergeben – Etikett enthält Platzhalterdaten. Bitte erst nach Genehmigung drucken.
        </div>
      )}

      {/* ── ETIKETT-VORSCHAU ──────────────────────────────────────────────── */}
      <div className="card border-2 border-s112-border p-8 space-y-6 print:border-0 print:shadow-none print:p-0">

        {/* Kopfzeile: Logo + Weingut */}
        <div className="flex items-start justify-between border-b border-s112-border pb-5">
          <div>
            {s.logo_url && (
              <Image
                unoptimized  /* S7: Logos ohne Bildoptimierung (kein Proxy für fremde Adressen) */
                src={s.logo_url}
                alt={s.betrieb_name ?? 'Weingut'}
                width={160} height={50}
                className="object-contain object-left max-h-12 w-auto mb-2"
              />
            )}
            {s.betrieb_name && (
              <p className="text-base font-semibold text-s112-text">{s.betrieb_name}</p>
            )}
            {(s.betrieb_strasse || s.betrieb_plz || s.betrieb_ort) && (
              <p className="text-sm text-s112-text-2">
                {[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
              </p>
            )}
            {s.betrieb_uid && (
              <p className="text-xs text-s112-tertiary mt-0.5">UID: {s.betrieb_uid}</p>
            )}
          </div>
          {dac.pruefnummer && (
            <div className="text-right">
              <p className="text-xs text-s112-tertiary font-medium uppercase tracking-wide">Prüfnummer</p>
              <p className="text-2xl font-semibold text-s112-blue-700 font-mono mt-0.5">{dac.pruefnummer}</p>
              {dac.bescheid_am && (
                <p className="text-xs text-s112-tertiary mt-0.5">
                  Bescheid: {new Date(dac.bescheid_am).toLocaleDateString('de-AT')}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Weinbezeichnung */}
        <div className="text-center py-4 border-b border-s112-border">
          <p className="text-3xl font-semibold text-s112-text tracking-tight">{dac.bezeichnung}</p>
          {dac.jahrgang && (
            <p className="text-xl text-s112-text-2 mt-1">{dac.jahrgang}</p>
          )}
          <p className="text-base font-semibold text-s112-blue-700 mt-2">{regionLabel}</p>
        </div>

        {/* Pflichtangaben Grid */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-3">
          {[
            ['Rebsorte', dac.rebsorte ? formatRebsorteMitKuerzel(dac.rebsorte) : '–'],
            ['Qualitätsstufe', 'DAC – Qualitätswein bestimmter Herkunft'],
            ['Alkohol', dac.alkohol_prozent ? `${String(dac.alkohol_prozent).replace('.', ',')} % vol.` : '–'],
            ['Füllmenge', fmtMenge(dac.menge_liter)],
            ['Herkunft', 'Österreich'],
            ['Enthält', 'Sulfite'],
          ].map(([label, value]) => (
            <div key={label}>
              <p className="text-xs font-semibold text-s112-tertiary uppercase tracking-wide">{label}</p>
              <p className="text-sm font-medium text-s112-text mt-0.5">{value}</p>
            </div>
          ))}
        </div>

        {/* Fußzeile */}
        <div className="border-t border-s112-border pt-4 flex items-end justify-between">
          <div>
            <p className="text-xs text-s112-tertiary">Erzeuger &amp; Abfüller</p>
            <p className="text-sm font-medium text-s112-text-1">
              {s.betrieb_name ?? '–'}
              {s.betrieb_ort ? `, ${s.betrieb_ort}` : ''}
              , Österreich
            </p>
          </div>
          <p className="text-xs text-s112-tertiary">software:112</p>
        </div>
      </div>

      {/* Druckhinweis */}
      <p className="text-xs text-s112-muted text-center print:hidden">
        Pflichtangaben gemäß EU-Weinetikettierungsverordnung (VO 2019/33). Vor dem Druck bitte rechtliche Prüfung durch den Erzeuger.
      </p>

    </div>
  )
}
