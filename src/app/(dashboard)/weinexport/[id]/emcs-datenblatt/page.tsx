// behoerdenmeldung: emcs-datenblatt
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import Link from '@/components/ui/Link'
import PrintButton from '@/app/(dashboard)/reports/PrintButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { landAnzeige } from '@/lib/katalog/laender'
import { zahlDe } from '@/lib/export/dokumente'
import { DATENBLATT_VERMERK, PRODUKTCODE_VERMERK, ladeEmcsDatenblatt } from '@/lib/behoerden/emcsDatenblatt'

export const metadata: Metadata = { title: 'EMCS-Datenblatt' }
export const dynamic = 'force-dynamic'

// KAN-435 D1 (13.11.2026): Datenblatt zum Erfassen in EMCS – ersetzt die nicht einreichbare e-AD-XML-Datei.
// Druck und CSV aus derselben Ladefunktion (lib/behoerden/emcsDatenblatt.ts). Kein amtliches Dokument, keine Übermittlung.

const tag = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '–')
const oder = (v: string | null | undefined) => (v && v.trim() ? v : '–')

function Feld({ name, wert, mono = false }: { name: string; wert: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-s112-muted">{name}</dt>
      <dd className={`text-sm text-s112-text ${mono ? 'font-mono' : ''}`}>{wert}</dd>
    </div>
  )
}

export default async function EmcsDatenblattPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/dashboard')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()
  // wie die übrigen Seiten unter /weinexport: nur mit dem Modul Exportaufträge
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_export) redirect('/dashboard')

  const blatt = await ladeEmcsDatenblatt(supabase, tenantId, { id })
  if (!blatt) return (
    <div className="p-8">
      <p className="text-s112-err-fg">Exportauftrag nicht gefunden.</p>
      <Link href="/weinexport" className="text-s112-blue-700 text-sm mt-2 inline-block">← Zurück</Link>
    </div>
  )
  const k = blatt.kopf

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weinexport" className="hover:text-s112-blue-700">Weinexport</Link>
          <span>/</span>
          <Link href={`/weinexport/${id}`} className="hover:text-s112-blue-700">{k.referenz ?? 'Exportauftrag'}</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">EMCS-Datenblatt</span>
        </nav>
        <div className="flex items-start gap-2 flex-wrap">
          <PrintButton />
          <CsvExportKnopf href={csvPfad('emcs-datenblatt', { id, referenz: k.referenz })} />
        </div>
      </div>

      {blatt.fehlt.length > 0 && (
        <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-sm text-s112-warn-fg print:hidden">
          <p className="font-semibold">Für die Erfassung in EMCS fehlt noch:</p>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">{blatt.fehlt.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <p className="mt-1">Fehlende Angaben stehen im Datenblatt als „–“. Eintragen am <Link href={`/weinexport/${id}`} className="underline">Exportauftrag</Link>.</p>
        </div>
      )}

      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        <div className="flex items-start justify-between gap-4 border-b-2 border-s112-text pb-4 mb-5">
          <div>
            <p className="font-semibold text-s112-text">{oder(k.versenderName)}</p>
            <p className="text-sm text-s112-text-2">{oder(k.versenderAnschrift)}</p>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold text-s112-text">EMCS-Datenblatt</h1>
            <p className="text-2xl font-semibold text-s112-blue-700">{k.referenz ?? '–'}</p>
          </div>
        </div>

        <p className="border border-s112-text px-3 py-2 text-sm font-semibold text-s112-text mb-5">
          {DATENBLATT_VERMERK}. software:112 übermittelt nichts an EMCS; die Angaben werden dort von Hand erfasst.
          {blatt.storniert ? ' Der Exportauftrag ist storniert.' : ''}
        </p>

        <dl className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 mb-6">
          <Feld name="Versender" wert={oder(k.versenderName)} />
          <Feld name="Anschrift Versender" wert={oder(k.versenderAnschrift)} />
          <Feld name="UID Versender" wert={oder(k.versenderUid)} mono />
          <Feld name="Verbrauchsteuernummer Versender" wert={oder(k.versenderVerbrauchsteuernr)} mono />
          <Feld name="Empfänger" wert={oder(k.empfaengerName)} />
          <Feld name="Bestimmungsort" wert={[k.empfaengerOrt, k.empfaengerLand ? landAnzeige(k.empfaengerLand) : null].filter(Boolean).join(', ') || '–'} />
          <Feld name="UID Empfänger" wert={oder(k.empfaengerUid)} mono />
          <Feld name="Verbrauchsteuernummer Empfänger" wert={oder(k.empfaengerVerbrauchsteuernr)} mono />
          <Feld name="Verbrauchsteuerverfahren" wert={oder(k.verfahren)} />
          <Feld name="Lieferfall" wert={oder(k.lieferfall)} />
          <Feld name="Versanddatum" wert={tag(k.versanddatum)} />
          <Feld name="Verkehrszweig" wert={k.verkehrszweigCode ? `${k.verkehrszweigCode} – ${k.verkehrszweigText}` : oder(k.verkehrszweigText)} />
          <Feld name="ARC (aus EMCS)" wert={oder(k.arc)} mono />
          <Feld name="MVV-Code" wert={oder(k.mvvCode)} mono />
          <Feld name="Nummer des Begleitdokuments" wert={oder(k.begleitdokumentNr)} mono />
          <Feld name="MRN der Ausfuhranmeldung" wert={oder(k.ausfuhrMrn)} mono />
        </dl>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-s112-border text-left text-xs text-s112-text-2">
                <th className="py-2 pr-3 font-semibold">Pos.</th>
                <th className="py-2 pr-3 font-semibold">Produktcode*</th>
                <th className="py-2 pr-3 font-semibold">KN-Code</th>
                <th className="py-2 pr-3 font-semibold">Bezeichnung</th>
                <th className="py-2 pr-3 font-semibold text-right">Menge (l)</th>
                <th className="py-2 pr-3 font-semibold text-right">% vol</th>
                <th className="py-2 pr-3 font-semibold text-right">Netto (kg)</th>
                <th className="py-2 pr-3 font-semibold text-right">Brutto (kg)</th>
                <th className="py-2 font-semibold text-right">Packstücke</th>
              </tr>
            </thead>
            <tbody>
              {blatt.zeilen.map(z => (
                <tr key={z.positionId} className="border-b border-s112-border/60 align-top">
                  <td className="py-2 pr-3">{z.position}</td>
                  <td className="py-2 pr-3 font-mono">{z.produktcode ?? '–'}</td>
                  <td className="py-2 pr-3 font-mono">{z.knCode ?? '–'}</td>
                  <td className="py-2 pr-3">
                    {z.bezeichnung ?? '–'}
                    {z.flaschen !== null && (
                      <div className="text-xs text-s112-muted">{zahlDe(z.flaschen)} Fl.{z.flaschengroesseMl ? ` à ${zahlDe(z.flaschengroesseMl / 1000, 3)} l` : ''}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahlDe(z.liter)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahlDe(z.alkohol, 1)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahlDe(z.nettoKg)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahlDe(z.bruttoKg)}</td>
                  <td className="py-2 text-right tabular-nums">{z.packstuecke ?? '–'}</td>
                </tr>
              ))}
              {blatt.zeilen.length === 0 && (
                <tr><td colSpan={9} className="py-4 text-center text-s112-muted">Der Exportauftrag hat keine Positionen.</td></tr>
              )}
              {blatt.zeilen.length > 0 && (
                <tr className="font-semibold">
                  <td colSpan={4} className="py-2 pr-3">Summe</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahlDe(blatt.literGesamt)}</td>
                  <td />
                  <td className="py-2 pr-3 text-right tabular-nums">{zahlDe(blatt.nettoKgGesamt)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahlDe(blatt.bruttoKgGesamt)}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-s112-muted mt-5">
          * Produktcode: {PRODUKTCODE_VERMERK}. Abgeleitet aus dem KN-Code (2204 10 Schaumwein → W300, übriger Wein in Behältnissen → W200).
          Das Bruttogewicht der Sendung enthält die Verpackung des Auftrags. Die Verbrauchsteuernummer des Betriebs steht in den
          Betriebseinstellungen, die des Empfängers am Exportauftrag.
        </p>
      </div>
    </div>
  )
}
