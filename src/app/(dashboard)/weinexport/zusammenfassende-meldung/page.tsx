// behoerdenmeldung: zusammenfassende-meldung
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import Link from '@/components/ui/Link'
import PrintButton from '@/app/(dashboard)/reports/PrintButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { fmtEur } from '@/lib/format'
import { wienJetzt } from '@/lib/datum/wien'
import { ladeZm } from '@/lib/behoerden/zm'
import { UVA_MONATE } from '@/lib/behoerden/uva'

export const metadata: Metadata = { title: 'Zusammenfassende Meldung' }
export const dynamic = 'force-dynamic'

// KAN-439: Zusammenfassende Meldung (Art. 21 UStG) – je UID des Erwerbers die Summe der steuerfreien
// innergemeinschaftlichen Lieferungen im Meldezeitraum. Druck und CSV aus derselben Ladefunktion (lib/behoerden/zm.ts).
// Keine elektronische Übermittlung: Die Werte werden in FinanzOnline eingegeben.

const ZEITRAUM_RE = /^(Q[1-4]|0[1-9]|1[0-2])$/
const tag = (d: string) => d.split('-').reverse().join('.')

export default async function ZusammenfassendeMeldungPage({ searchParams }: { searchParams: Promise<{ jahr?: string; zeitraum?: string }> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/dashboard')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  // wienJetzt(): Date, dessen lokale Felder die Wiener Zeit tragen (Vercel läuft in UTC)
  const jetzt = wienJetzt()
  const diesesJahr = jetzt.getFullYear()
  const dieserMonat = jetzt.getMonth() + 1
  const jahrRoh = Number(sp.jahr)
  const jahr = Number.isInteger(jahrRoh) && jahrRoh >= 2000 && jahrRoh <= 2100 ? jahrRoh : diesesJahr
  // Vorgabe: das laufende Quartal (die ZM ist monatlich oder vierteljährlich abzugeben)
  const zeitraum = sp.zeitraum === 'jahr' ? null : ZEITRAUM_RE.test(sp.zeitraum ?? '') ? sp.zeitraum! : `Q${Math.floor((dieserMonat - 1) / 3) + 1}`
  const jahre = Array.from({ length: 4 }, (_, i) => diesesJahr - i)
  if (!jahre.includes(jahr)) jahre.push(jahr)

  const [zm, einstRes] = await Promise.all([
    ladeZm(supabase, tenantId, { jahr, zeitraum }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any).select('betrieb_name, betrieb_uid, modul_export').eq('tenant_id', tenantId).maybeSingle(),
  ])
  const einst = geladen(einstRes, 'Einstellungen') as { betrieb_name?: string | null; betrieb_uid?: string | null; modul_export?: boolean | null } | null
  // wie die übrigen Seiten unter /weinexport: nur mit dem Modul Exportaufträge
  if (!einst?.modul_export) redirect('/dashboard')

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weinexport" className="hover:text-s112-blue-700">Weinexport</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">Zusammenfassende Meldung</span>
        </nav>
        <div className="flex items-start gap-2 flex-wrap">
          <form method="GET" action="/weinexport/zusammenfassende-meldung" className="flex gap-2">
            <select name="jahr" aria-label="Jahr" defaultValue={jahr} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden">
              {jahre.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
            <select name="zeitraum" aria-label="Meldezeitraum" defaultValue={zeitraum ?? 'jahr'} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden">
              {['Q1', 'Q2', 'Q3', 'Q4'].map(q => <option key={q} value={q}>{q}</option>)}
              {UVA_MONATE.map((m, i) => <option key={m} value={String(i + 1).padStart(2, '0')}>{m}</option>)}
              <option value="jahr">ganzes Jahr</option>
            </select>
            <button type="submit" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">Anzeigen</button>
          </form>
          <PrintButton />
          <CsvExportKnopf href={csvPfad('zusammenfassende-meldung', { jahr, zeitraum })} />
        </div>
      </div>

      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        <div className="flex items-start justify-between border-b-2 border-s112-text pb-4 mb-6">
          <div>
            <p className="font-semibold text-s112-text">{einst?.betrieb_name ?? ''}</p>
            <p className="text-sm text-s112-text-2">UID: {einst?.betrieb_uid ?? '–'}</p>
          </div>
          <div className="text-right">
            <h1 className="text-lg font-semibold text-s112-text">Zusammenfassende Meldung</h1>
            <p className="text-2xl font-semibold text-s112-blue-700">{zm.zeilen[0]?.zeitraumLabel ?? (zeitraum ? `${zeitraum} ${jahr}` : `Jahr ${jahr}`)}</p>
            <p className="text-xs text-s112-tertiary mt-1">Art. 21 UStG · Rechnungen vom {tag(zm.von)} bis {tag(zm.bis)}</p>
          </div>
        </div>

        {zm.warnungen.length > 0 && (
          <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 mb-5 text-sm text-s112-warn-fg print:hidden">
            <ul className="list-disc pl-5 space-y-0.5">{zm.warnungen.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </div>
        )}

        {zm.zeilen.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-s112-border text-left text-xs text-s112-text-2">
                  <th className="py-2 pr-3 font-semibold">Land</th>
                  <th className="py-2 pr-3 font-semibold">UID des Erwerbers</th>
                  <th className="py-2 pr-3 font-semibold text-right">Bemessungsgrundlage</th>
                  <th className="py-2 font-semibold">Belege</th>
                </tr>
              </thead>
              <tbody>
                {zm.zeilen.map(z => (
                  <tr key={z.uid ?? 'ohne'} className="border-b border-s112-border/60">
                    <td className="py-2 pr-3 font-mono">{z.land ?? '–'}</td>
                    <td className="py-2 pr-3 font-mono">{z.uid ?? '–'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtEur(z.bemessungsgrundlage)}</td>
                    <td className="py-2 text-xs text-s112-text-2">{z.rechnungsnummern || '–'}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={2} className="py-2 pr-3">Summe</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtEur(zm.summe)}</td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-s112-muted mt-6">
          Gezählt werden Rechnungen aus dem Exportauftrag mit innergemeinschaftlicher Lieferung, nach Rechnungsdatum. Ein Stornobeleg mindert die Summe im Zeitraum seines Datums.
          Die Meldung wird nicht elektronisch übermittelt – die Werte bitte in FinanzOnline eingeben.
        </p>
      </div>
    </div>
  )
}
