// behoerdenmeldung: blend-protokoll
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { AlertTriangle, GitMerge } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import PrintButton from './PrintButton'
import { fmtNum } from '@/lib/format'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { herkunftLabel, ladeBlendProtokoll } from '@/lib/behoerden/blend'

export const metadata: Metadata = { title: 'Blend-Protokoll – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function BlendProtokollPage({ params, searchParams }: {
  params: Promise<{ id: string }>; searchParams: Promise<{ stichtag?: string }>
}) {
  const { id } = await params
  // KAN-76: optional zu einem Stichtag (Zusammensetzung, Bestand und Prüfnummer an diesem Tag)
  const stRoh = (await searchParams).stichtag?.trim() ?? ''
  const stichtag = /^\d{4}-\d{2}-\d{2}$/.test(stRoh) && !Number.isNaN(Date.parse(stRoh)) ? stRoh : null
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  if (!tenantId) notFound()
  // Dieselbe Ladefunktion wie die CSV „blend-protokoll“ (lib/behoerden/blend.ts)
  const [protokoll, { data: settingsRaw }] = await Promise.all([
    ladeBlendProtokoll(supabase, tenantId, { art: 'charge', id, stichtag }),
    tf((supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url')
      .limit(1).maybeSingle()),
  ])

  if (!protokoll) notFound()
  const { kopf, komposition } = protokoll
  const wa = { name: kopf.name, jahrgang: kopf.jahrgang, rebsorte: kopf.rebsorte, qualitaet: kopf.qualitaet, menge_liter: kopf.bezugLiter }
  const s = (settingsRaw as R | null) ?? {}

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
        <div className="flex items-start gap-2">
          <PrintButton />
          <CsvExportKnopf href={csvPfad('blend-protokoll', { charge: id, ...(stichtag ? { stichtag } : {}) })} />
        </div>
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
            {/* KAN-72: nur eine für den heutigen Bestand gültige Prüfnummer */}
            {kopf.pruefnummer && (
              <p className="text-lg font-semibold text-s112-blue-700 font-mono mt-0.5">{kopf.pruefnummer}</p>
            )}
            <p className="text-xs text-s112-tertiary mt-0.5">
              Stand: {(stichtag ? new Date(`${stichtag}T12:00:00`) : new Date()).toLocaleDateString('de-AT')}
            </p>
          </div>
        </div>

        {/* KAN-76: Stichtag wählen (nur am Bildschirm) */}
        <form method="get" className="print:hidden flex items-end gap-2 flex-wrap text-sm">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-s112-text-2">Zusammensetzung zum Stichtag</span>
            <input type="date" name="stichtag" defaultValue={stichtag ?? ''} aria-label="Stichtag"
              className="border border-s112-border rounded-lg px-2 py-1 text-sm" />
          </label>
          <button type="submit" className="border border-s112-border rounded-lg px-3 py-1 text-sm hover:bg-s112-bg">Anzeigen</button>
          {stichtag && <Link href={`/kellerbuch/weinausbau/${id}/blend-protokoll`} className="text-xs underline text-s112-text-2">heute</Link>}
        </form>

        {/* KAN-76: Hinweise der Mischungsrechnung (Bestand ≠ Saldo, Abgänge > Bestand …) – auch im Druck */}
        {protokoll.warnungen.filter(w => w !== kopf.pruefnummerHinweis && !w.startsWith(kopf.pruefnummerHinweis ?? '\u0000')).map((w, i) => (
          <p key={i} className="text-sm text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span>{w}</span>
          </p>
        ))}

        {/* KAN-72: frühere Prüfnummer gilt nicht (mehr) für den Bestand – Hinweis statt Nummer */}
        {kopf.pruefnummerHinweis && (
          <p className="text-sm text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
            <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            <span>{kopf.pruefnummerHinweis}</span>
          </p>
        )}

        {/* Chargenbezeichnung */}
        <div className="text-center py-4 border-b border-s112-border">
          <p className="text-2xl font-semibold text-s112-text tracking-tight">{wa.name}</p>
          <p className="text-sm text-s112-text-2 mt-1">
            {[wa.jahrgang, wa.rebsorte ? formatRebsorteMitKuerzel(wa.rebsorte) : null, wa.qualitaet].filter(Boolean).join(' · ')}
          </p>
          {wa.menge_liter && (
            <p className="text-xs text-s112-tertiary mt-1">
              {stichtag ? 'Bestand zum Stichtag' : 'Aktueller Bestand'}: {fmtNum(wa.menge_liter)} L
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
