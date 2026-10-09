// behoerdenmeldung: bki-betriebsdaten, bki-gebindeverzeichnis
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeBetriebsdaten, ladeBkiGebindeverzeichnis } from '@/lib/behoerden/bki-stammdaten'
import { fmtNum } from '@/lib/format'
import DruckKnopf from '../_behoerden/DruckKnopf'
import LagerTabs from '../_behoerden/LagerTabs'

// KAN-48 AP11: BKI-Blätter „Betriebsdaten“ und „GebindeVerzeichnis“ – dieselben Ladefunktionen liefern die CSV
// (/meldungen/bki-betriebsdaten/csv, /meldungen/bki-gebindeverzeichnis/csv). Annahmen A1–A6 in lib/behoerden/bki-stammdaten.ts.

export const metadata: Metadata = { title: 'Betriebsdaten & Gebinde (BKI) – software:112' }
export const dynamic = 'force-dynamic'

function Hinweise({ liste }: { liste: string[] }) {
  if (liste.length === 0) return null
  return (
    <ul className="text-xs text-s112-warn-fg list-disc pl-4 space-y-0.5">
      {liste.map((w, i) => <li key={i}>{w}</li>)}
    </ul>
  )
}

export default async function BkiStammdatenPage() {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const supabase = await createSupabaseServerClient()
  const [b, g] = await Promise.all([
    ladeBetriebsdaten(supabase, membership.tenantId),
    ladeBkiGebindeverzeichnis(supabase, membership.tenantId),
  ])
  const z = b.zeilen[0]
  const zeile = (label: string, wert: string | null | undefined) => (
    <div className="flex gap-3 py-1 border-b border-s112-border/30 last:border-0">
      <dt className="w-44 shrink-0 text-xs text-s112-muted">{label}</dt>
      <dd className="text-sm text-s112-text">{wert || '–'}</dd>
    </div>
  )

  return (
    <div className="space-y-6">
      <LagerTabs aktiv="stammdaten" />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Betriebsdaten &amp; Gebindeverzeichnis</h1>
          <p className="text-xs text-s112-muted mt-0.5">
            BKI-Schnittstelle, Blätter „Betriebsdaten“ und „GebindeVerzeichnis“. Ändern unter{' '}
            <Link href="/betrieb/einstellungen" className="text-s112-blue-700 hover:underline">Betrieb › Einstellungen</Link> bzw.{' '}
            <Link href="/kellerbuch/gebinde" className="text-s112-blue-700 hover:underline">Kellerbuch › Gebinde</Link>.
          </p>
        </div>
        <div className="print:hidden"><DruckKnopf /></div>
      </div>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-s112-text">Betriebsdaten</h2>
          <div className="print:hidden"><CsvExportKnopf href={csvPfad('bki-betriebsdaten', {})} /></div>
        </div>
        <Hinweise liste={b.warnungen} />
        {z && (
          <dl className="card p-4 max-w-xl">
            {zeile('Betriebsnummer', z.betriebsnummer)}
            {zeile('Vorname/Firmenname', z.vorname)}
            {zeile('Nachname/Firmenname', z.nachname)}
            {zeile('Bez. Betriebsstätte', z.betriebsstaette)}
            {zeile('PLZ / Ort', [z.plz, z.ort].filter(Boolean).join(' '))}
            {zeile('Straße / Hausnummer', [z.strasse, z.hausnummer].filter(Boolean).join(' · '))}
            {zeile('Bio-Betrieb', z.bio ? 'Ja' : 'Nein')}
          </dl>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold text-s112-text">Gebindeverzeichnis <span className="text-xs font-normal text-s112-muted">({g.zeilen.length} Gebinde)</span></h2>
          <div className="print:hidden"><CsvExportKnopf href={csvPfad('bki-gebindeverzeichnis', {})} /></div>
        </div>
        <Hinweise liste={g.warnungen} />
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-left text-xs font-semibold text-s112-text-2">
                <th className="px-3 py-2.5">Bezeichnung</th>
                <th className="px-3 py-2.5">Bezeichnung lang</th>
                <th className="px-3 py-2.5">Material</th>
                <th className="px-3 py-2.5">Aufstellungsort</th>
                <th className="px-3 py-2.5 text-right">Nenninhalt (l)</th>
              </tr>
            </thead>
            <tbody>
              {g.zeilen.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-xs text-s112-muted italic">Noch keine Gebinde angelegt</td></tr>
              ) : g.zeilen.map((r, i) => (
                <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${r.aktiv ? '' : 'text-s112-muted'}`}>
                  <td className="px-3 py-2">{r.bezeichnung}{r.eigentuemer && <span className="text-xs text-s112-muted"> · {r.eigentuemer}</span>}{!r.aktiv && <span className="text-xs"> (inaktiv)</span>}</td>
                  <td className="px-3 py-2 text-xs">{r.bezeichnungLang ?? '–'}</td>
                  <td className="px-3 py-2 text-xs">{r.material ?? <span className="text-s112-warn-fg">fehlt</span>}</td>
                  <td className="px-3 py-2 text-xs">{r.aufstellungsort ?? '–'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.nenninhalt === null ? '–' : fmtNum(r.nenninhalt, 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
