import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { schliesseEaMonat } from '../actions'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import { Lock, LockOpen } from 'lucide-react'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const MONATE = ['Jänner', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']

function fmtDateTime(ts: string | null) {
  return ts ? new Date(ts).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null
}

export default async function MonatsabschlussPage({
  searchParams,
}: {
  searchParams: { jahr?: string }
}) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const adminOk  = canAdmin(membership.role)

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, buchhaltungsart').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')
  // Migration 197: bei Doppik beim Steuerberater bedeutet der Abschluss "Belege
  // dieses Monats sind vollständig und übergeben" - keine steuerliche Sperre.
  const doppik = einst?.buchhaltungsart === 'doppik'

  const sp   = await searchParams
  const jahr = parseInt(sp.jahr ?? '') || new Date().getFullYear()
  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)

  const { data: abschluesseRaw } = await (supabase.from('ea_monatsabschluss') as any)
    .select('monat, abgeschlossen_am')
    .eq('tenant_id', tenantId)
    .eq('jahr', jahr)
  const abschluesse = new Map(((abschluesseRaw ?? []) as R[]).map(a => [a.monat, a.abgeschlossen_am]))

  const heute = new Date()
  const istZukunft = (monat: number) =>
    jahr > heute.getFullYear() || (jahr === heute.getFullYear() && monat > heute.getMonth() + 1)

  async function handleAbschliessen(monat: number, j: number) {
    'use server'
    await schliesseEaMonat(j, monat)
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buchhaltung" className="text-sm text-s112-muted hover:text-gray-700">← Buchungen</Link>
        <h1 className="text-2xl font-bold text-gray-900">Monatsabschluss</h1>
      </div>

      <p className="text-sm text-s112-muted mb-6">
        Ein abgeschlossener Monat sperrt alle Buchungen dieses Monats gegen Bearbeiten, Löschen und neue
        Buchungen mit einem Datum in diesem Monat. Das ist nicht rückgängig zu machen.
      </p>
      {doppik && (
        <div className="bg-blue-50 border border-blue-200 text-blue-800 rounded-2xl px-5 py-4 mb-6 text-sm">
          <p className="font-semibold mb-1">Doppelte Buchhaltung beim Steuerberater</p>
          <p>
            Der Monatsabschluss heißt hier: alle Belege des Monats sind erfasst und per BMD-Übergabe an die Kanzlei
            gegangen – danach sollen sie sich nicht mehr ändern. Vor dem Abschließen also zuerst{' '}
            <Link href="/controlling/bmd" className="underline font-medium">Ausgangsrechnungen und Eingangsbelege übergeben</Link>.
          </p>
        </div>
      )}

      <form method="GET" className="flex gap-3 mb-6 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Jahr</label>
          <select name="jahr" defaultValue={String(jahr)}
            className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
            {jahre.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <button type="submit" className="bg-s112-teal text-white px-4 py-2 rounded-lg text-sm">Anzeigen</button>
      </form>

      <div className="bg-white rounded-2xl border border-s112-border overflow-hidden">
        {MONATE.map((name, idx) => {
          const monat = idx + 1
          const abgeschlossenAm = abschluesse.get(monat) as string | undefined
          const zukunft = istZukunft(monat)
          return (
            <div key={monat}
              className="flex items-center justify-between px-5 py-3 border-b border-s112-border/60 last:border-0">
              <div className="flex items-center gap-2.5">
                {abgeschlossenAm
                  ? <Lock className="w-4 h-4 text-gray-400" />
                  : <LockOpen className="w-4 h-4 text-s112-teal/60" />}
                <span className="text-sm font-medium text-gray-800">{name} {jahr}</span>
              </div>
              {abgeschlossenAm ? (
                <span className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                  Abgeschlossen am {fmtDateTime(abgeschlossenAm)}
                </span>
              ) : zukunft ? (
                <span className="text-xs text-s112-muted">–</span>
              ) : adminOk ? (
                <ConfirmDeleteForm
                  action={handleAbschliessen.bind(null, monat, jahr)}
                  message={`${name} ${jahr} abschließen? Alle Buchungen dieses Monats werden gesperrt und können nicht mehr bearbeitet, gelöscht oder durch neue Buchungen mit diesem Datum ergänzt werden. Das ist nicht rückgängig zu machen.`}
                  label="Monat abschließen"
                  title="Monat abschließen"
                  className="text-xs bg-s112-teal text-white px-2.5 py-1 rounded-full font-medium hover:bg-opacity-90"
                />
              ) : (
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Offen</span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
