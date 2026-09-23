import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { GitMerge } from 'lucide-react'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { resolveBlendKomposition, type KompositionUrsprung } from '@/lib/wein/blendKomposition'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import PrintButton from './PrintButton'
import { fmtNum } from '@/lib/format'

export const metadata: Metadata = { title: 'Blend-Protokoll – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function herkunftLabel(u: KompositionUrsprung): string {
  if (u.typ === 'pressung') {
    const teile = [u.weingarten_name, u.gst_nr ? `GST ${u.gst_nr}` : null].filter(Boolean)
    return teile.length > 0 ? teile.join(' · ') : 'Pressung (Weingarten unbekannt)'
  }
  if (u.typ === 'zukauf') return u.zukauf_von ? `Zukauf – ${u.zukauf_von}` : 'Zukauf'
  if (u.typ === 'eroeffnungsbestand') return 'Eröffnungsbestand (historisch)'
  return 'Herkunft unbekannt'
}

export default async function BlendProtokollPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: waRaw }, { data: settingsRaw }] = await Promise.all([
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, qualitaetsstufe, menge_liter')
      .eq('id', id)
      .maybeSingle()),
    tf((supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url')
      .limit(1).maybeSingle()),
  ])

  const wa = waRaw as R | null
  if (!wa) notFound()
  const s = (settingsRaw as R | null) ?? {}

  const komposition = await resolveBlendKomposition(supabase, id, tenantId)

  return (
    <div className="max-w-2xl space-y-6">

      {/* Breadcrumb + Aktionen (ausgeblendet beim Drucken) */}
      <div className="flex items-center justify-between print:hidden flex-wrap gap-2">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/kellerbuch" className="hover:text-s112-blue-700">Kellerbuch</Link>
          <span>/</span>
          <Link href={`/kellerbuch/weinausbau/${id}/buch`} className="hover:text-s112-blue-700">{wa.name}</Link>
          <span>/</span>
          <span className="text-s112-text-1 font-medium">Blend-Protokoll</span>
        </nav>
        <PrintButton />
      </div>

      {/* ── PROTOKOLL ─────────────────────────────────────────────────────── */}
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
          <div className="text-right">
            <p className="text-xs text-s112-tertiary font-medium uppercase tracking-wide flex items-center justify-end gap-1.5">
              <GitMerge size={13} strokeWidth={1.75} />Blend-Protokoll
            </p>
            <p className="text-xs text-s112-tertiary mt-0.5">
              Stand: {new Date().toLocaleDateString('de-AT')}
            </p>
          </div>
        </div>

        {/* Chargenbezeichnung */}
        <div className="text-center py-4 border-b border-s112-border">
          <p className="text-2xl font-semibold text-s112-text tracking-tight">{wa.name}</p>
          <p className="text-sm text-s112-text-2 mt-1">
            {[wa.jahrgang, wa.rebsorte ? formatRebsorteMitKuerzel(wa.rebsorte) : null, wa.qualitaetsstufe ? qualitaetLabel(wa.qualitaetsstufe) : null].filter(Boolean).join(' · ')}
          </p>
          {wa.menge_liter && (
            <p className="text-xs text-s112-tertiary mt-1">
              Aktueller Bestand: {fmtNum(parseFloat(wa.menge_liter))} L
            </p>
          )}
        </div>

        {/* Herkunfts-Tabelle */}
        {komposition.length === 0 ? (
          <p className="text-sm text-s112-muted text-center py-4">
            Keine Herkunftsdaten für diese Charge ermittelbar.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border text-left">
                <th className="py-2 font-semibold text-s112-text-2 text-xs uppercase tracking-wide">Herkunft</th>
                <th className="py-2 font-semibold text-s112-text-2 text-xs uppercase tracking-wide">Rebsorte</th>
                <th className="py-2 font-semibold text-s112-text-2 text-xs uppercase tracking-wide">Jahrgang</th>
                <th className="py-2 font-semibold text-s112-text-2 text-xs uppercase tracking-wide text-right">Anteil</th>
              </tr>
            </thead>
            <tbody>
              {komposition.map(u => (
                <tr key={u.key} className="border-b border-s112-border/60 last:border-0">
                  <td className="py-2 text-s112-text">{herkunftLabel(u)}</td>
                  <td className="py-2 text-s112-text-2">{formatRebsorteMitKuerzel(u.rebsorte)}</td>
                  <td className="py-2 text-s112-text-2">{u.jahrgang ?? '–'}</td>
                  <td className="py-2 text-s112-text font-semibold text-right">
                    {fmtNum(u.anteil_pct, 1)} %
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-xs text-s112-tertiary">Gesamt</td>
                <td className="pt-2 text-xs text-s112-tertiary text-right">
                  {fmtNum(komposition.reduce((s, u) => s + u.anteil_pct, 0), 1)} %
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Fußzeile */}
        <div className="border-t border-s112-border pt-4 flex items-end justify-between">
          <p className="text-xs text-s112-tertiary">
            Automatisch generiert aus den Kellerbuch-Verschneidungsdaten – rekursiv aufgelöst bis
            zur ursprünglichen Pressung/Ernte.
          </p>
          <p className="text-xs text-s112-tertiary">software:112</p>
        </div>
      </div>

      <p className="text-xs text-s112-muted text-center print:hidden">
        Rückverfolgbarkeitsnachweis Flasche → Weingarten. Bei Chargen ohne vollständig gepflegte
        Pressungs-/Verschneidungsdaten kann die Zusammensetzung unvollständig oder als „Herkunft
        unbekannt" ausgewiesen sein.
      </p>

    </div>
  )
}
