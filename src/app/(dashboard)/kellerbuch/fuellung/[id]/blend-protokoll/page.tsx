import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { GitMerge } from 'lucide-react'
import { resolveBlendKompositionFuellung, type KompositionUrsprung } from '@/lib/wein/blendKomposition'
import PrintButton from './PrintButton'

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

function fmtMenge(liter: number | null): string {
  if (!liter) return '–'
  return `${parseFloat(String(liter)).toLocaleString('de-AT')} L`
}

export default async function BlendProtokollFuellungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const [{ data: fRaw }, { data: settingsRaw }] = await Promise.all([
    (supabase.from('fuellungen') as any)
      .select('id, name, chargennummer, pruefnummer, jahrgang, rebsorte, datum, anzahl_flaschen, flaschengroesse_ml, menge_liter_gefuellt')
      .eq('id', id)
      .maybeSingle(),
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url')
      .limit(1).maybeSingle(),
  ])

  const fuellung = fRaw as R | null
  if (!fuellung) notFound()
  const s = (settingsRaw as R | null) ?? {}

  const komposition = await resolveBlendKompositionFuellung(supabase, id)

  return (
    <div className="max-w-2xl space-y-6">

      {/* Breadcrumb + Aktionen (ausgeblendet beim Drucken) */}
      <div className="flex items-center justify-between print:hidden flex-wrap gap-2">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/kellerbuch/rueckverfolgung" className="hover:text-s112-teal">Rückverfolgung</Link>
          <span>/</span>
          <span className="text-gray-700 font-medium">Blend-Protokoll</span>
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
                src={s.logo_url}
                alt={s.betrieb_name ?? 'Weingut'}
                width={160} height={50}
                className="object-contain object-left max-h-12 w-auto mb-2"
              />
            )}
            {s.betrieb_name && (
              <p className="text-base font-bold text-gray-900">{s.betrieb_name}</p>
            )}
            {(s.betrieb_strasse || s.betrieb_plz || s.betrieb_ort) && (
              <p className="text-sm text-gray-600">
                {[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}
              </p>
            )}
            {s.betrieb_uid && (
              <p className="text-xs text-gray-400 mt-0.5">UID: {s.betrieb_uid}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide flex items-center justify-end gap-1.5">
              <GitMerge size={13} strokeWidth={1.75} />Blend-Protokoll
            </p>
            {fuellung.pruefnummer && (
              <p className="text-lg font-bold text-s112-teal font-mono mt-0.5">{fuellung.pruefnummer}</p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">
              Stand: {new Date().toLocaleDateString('de-AT')}
            </p>
          </div>
        </div>

        {/* Produktbezeichnung */}
        <div className="text-center py-4 border-b border-s112-border">
          <p className="text-2xl font-bold text-gray-900 tracking-tight">{fuellung.name ?? '–'}</p>
          <p className="text-sm text-gray-600 mt-1">
            {[fuellung.jahrgang, fuellung.rebsorte].filter(Boolean).join(' · ')}
          </p>
          <div className="flex items-center justify-center gap-4 text-xs text-gray-400 mt-2">
            {fuellung.chargennummer && <span>Charge: {fuellung.chargennummer}</span>}
            {fuellung.datum && <span>Abgefüllt: {new Date(fuellung.datum).toLocaleDateString('de-AT')}</span>}
            {fuellung.anzahl_flaschen && fuellung.flaschengroesse_ml && (
              <span>{parseInt(fuellung.anzahl_flaschen).toLocaleString('de-AT')} × {fuellung.flaschengroesse_ml} ml</span>
            )}
            {fuellung.menge_liter_gefuellt && <span>{fmtMenge(fuellung.menge_liter_gefuellt)} abgefüllt</span>}
          </div>
        </div>

        {/* Herkunfts-Tabelle */}
        {komposition.length === 0 ? (
          <p className="text-sm text-s112-muted text-center py-4">
            Keine Herkunftsdaten für diese Füllung ermittelbar.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border text-left">
                <th className="py-2 font-semibold text-gray-500 text-xs uppercase tracking-wide">Herkunft</th>
                <th className="py-2 font-semibold text-gray-500 text-xs uppercase tracking-wide">Rebsorte</th>
                <th className="py-2 font-semibold text-gray-500 text-xs uppercase tracking-wide">Jahrgang</th>
                <th className="py-2 font-semibold text-gray-500 text-xs uppercase tracking-wide text-right">Anteil</th>
              </tr>
            </thead>
            <tbody>
              {komposition.map(u => (
                <tr key={u.key} className="border-b border-s112-border/60 last:border-0">
                  <td className="py-2 text-gray-800">{herkunftLabel(u)}</td>
                  <td className="py-2 text-gray-600">{u.rebsorte ?? '–'}</td>
                  <td className="py-2 text-gray-600">{u.jahrgang ?? '–'}</td>
                  <td className="py-2 text-gray-800 font-semibold text-right">
                    {u.anteil_pct.toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3} className="pt-2 text-xs text-gray-400">Gesamt</td>
                <td className="pt-2 text-xs text-gray-400 text-right">
                  {komposition.reduce((s, u) => s + u.anteil_pct, 0).toLocaleString('de-AT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %
                </td>
              </tr>
            </tfoot>
          </table>
        )}

        {/* Fußzeile */}
        <div className="border-t border-s112-border pt-4 flex items-end justify-between">
          <p className="text-xs text-gray-400">
            Automatisch generiert aus den Kellerbuch-Verschneidungsdaten – rekursiv aufgelöst bis
            zur ursprünglichen Pressung/Ernte.
          </p>
          <p className="text-xs text-gray-300">software:112</p>
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
