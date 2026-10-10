// behoerdenmeldung: blend-protokoll
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import { notFound } from 'next/navigation'
import { GitMerge } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import PrintButton from './PrintButton'
import { fmtNum } from '@/lib/format'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeBlendProtokoll } from '@/lib/behoerden/blend'
import { BlendHerkunftTabelle, BlendHinweise, BlendSchritteTabelle, BlendSortenAbsteigend } from '@/components/kellerbuch/BlendProtokollTeile'
import { weinartAusSortenverschnitt } from '@/lib/wein/sortenangabe'

export const metadata: Metadata = { title: 'Blend-Protokoll' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmtMenge(liter: number | null): string {
  if (!liter) return '–'
  return `${fmtNum(parseFloat(String(liter)))} L`
}

export default async function BlendProtokollFuellungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  if (!tenantId) notFound()
  // Dieselbe Ladefunktion wie die CSV „blend-protokoll“ (lib/behoerden/blend.ts)
  const [protokoll, settingsRawRes] = await Promise.all([
    ladeBlendProtokoll(supabase, tenantId, { art: 'fuellung', id }),
    tf((supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url')
      .limit(1).maybeSingle()),
  ])
  const settingsRaw = geladen(settingsRawRes, 'Einstellungen')

  if (!protokoll) notFound()
  const { kopf, komposition } = protokoll
  const fuellung = {
    name: kopf.name, pruefnummer: kopf.pruefnummer, chargennummer: kopf.chargennummer, jahrgang: kopf.jahrgang,
    rebsorte: kopf.rebsorte, datum: kopf.datum, anzahl_flaschen: kopf.anzahlFlaschen,
    flaschengroesse_ml: kopf.flaschengroesseMl, menge_liter_gefuellt: kopf.bezugLiter,
  }
  const s = (settingsRaw as R | null) ?? {}

  return (
    <div className="max-w-2xl space-y-6">

      {/* Breadcrumb + Aktionen (ausgeblendet beim Drucken) */}
      <div className="flex items-center justify-between print:hidden flex-wrap gap-2">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/kellerbuch/rueckverfolgung" className="hover:text-s112-blue-700">Rückverfolgung</Link>
          <span>/</span>
          <span className="text-s112-text-1 font-medium">Blend-Protokoll</span>
        </nav>
        <div className="flex items-start gap-2">
          <PrintButton />
          <CsvExportKnopf href={csvPfad('blend-protokoll', { fuellung: id })} />
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
            <h1 className="text-xs text-s112-tertiary font-medium uppercase tracking-wide flex items-center justify-end gap-1.5">
              <GitMerge size={13} strokeWidth={1.75} />Blend-Protokoll
            </h1>
            {fuellung.pruefnummer && (
              <p className="text-lg font-semibold text-s112-blue-700 font-mono mt-0.5">{fuellung.pruefnummer}</p>
            )}
            <p className="text-xs text-s112-tertiary mt-0.5">
              Stand: {new Date().toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
            </p>
          </div>
        </div>

        {/* KAN-77: Hinweise der Mischungsrechnung und zur Prüfnummer (bisher nur in der CSV) – auch im Druck */}
        <BlendHinweise warnungen={protokoll.warnungen} />

        {/* Produktbezeichnung */}
        <div className="text-center py-4 border-b border-s112-border">
          <p className="text-2xl font-semibold text-s112-text tracking-tight">{fuellung.name ?? '–'}</p>
          <p className="text-sm text-s112-text-2 mt-1">
            {[fuellung.jahrgang, fuellung.rebsorte ? formatRebsorteMitKuerzel(fuellung.rebsorte) : null].filter(Boolean).join(' · ')}
          </p>
          <div className="flex items-center justify-center gap-4 text-xs text-s112-tertiary mt-2">
            {fuellung.chargennummer && <span>Charge: {fuellung.chargennummer}</span>}
            {fuellung.datum && <span>Abgefüllt: {fuellung.datum.split('-').reverse().join('.')}</span>}
            {fuellung.anzahl_flaschen && fuellung.flaschengroesse_ml && (
              <span>{fmtNum(fuellung.anzahl_flaschen)} × {fuellung.flaschengroesse_ml} ml</span>
            )}
            {fuellung.menge_liter_gefuellt && <span>{fmtMenge(fuellung.menge_liter_gefuellt)} abgefüllt</span>}
          </div>
        </div>

        {/* KAN-113: Rebsorten absteigend nach Menge, Vorschlag der Sortenangabe */}
        <BlendSortenAbsteigend komposition={komposition} weinart={weinartAusSortenverschnitt(kopf.rebsorte)} />

        {/* Herkunfts-Tabelle */}
        {komposition.length === 0 ? (
          <p className="text-sm text-s112-muted text-center py-4">
            Keine Herkunftsdaten für diese Füllung ermittelbar.
          </p>
        ) : (
          <BlendHerkunftTabelle komposition={komposition} zeilen={protokoll.zeilen} bezugLiter={kopf.bezugLiter} />
        )}

        {/* KAN-77: Verschnitt- und Umzugsschritte (Zuflussmengen) */}
        <BlendSchritteTabelle schritte={protokoll.schritte} bis={kopf.datum ? 'abfuellung' : null} />

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
        unbekannt“ ausgewiesen sein.
      </p>

    </div>
  )
}
