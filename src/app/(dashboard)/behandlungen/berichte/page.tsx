// behoerdenmeldung: psm-aufzeichnung, psm-mittelverbrauch, cu-bilanz, cu-bilanz-behandlungen
import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import BerichteClient from './BerichteClient'
import { ladeBehandlungen, ladeWeingaerten } from '@/lib/behoerden/psm'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { KATALOG_PFLANZENSCHUTZ } from '@/lib/behoerden/katalog/pflanzenschutz'

export const metadata: Metadata = { title: 'Maßnahmen-Berichte – software:112' }
export const dynamic = 'force-dynamic'

// Maßnahmen-Berichte (Tabs Ried, Mittelverbrauch, Cu-Bilanz). Daten über dieselbe Ladefunktion wie
// die Behördenmeldungen (lib/behoerden/psm.ts: Maßnahmen samt Grundstücken, Mandantenfilter, alle());
// Mittelverbrauch und Cu-Bilanz rechnet der Client mit mittelverbrauch()/cuBilanz() – identisch zu
// den CSV-Dateien der zentralen Route /meldungen/<id>/csv.
export default async function BerichtePage() {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/dashboard')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const [{ behandlungen }, weingaerten, { betrieb, module }] = await Promise.all([
    ladeBehandlungen(supabase, tenantId),
    ladeWeingaerten(supabase, tenantId),
    betriebUndModuleLaden(supabase, tenantId),
  ])

  // Druckkopf: Betriebsname aus den Einstellungen, sonst Name des Mandanten (bis 24.09.2026 fest „Gebeshuber Weinbau“)
  let betriebName = betrieb.name
  if (!betriebName) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tenant = geladen(await (supabase.from('tenants') as any).select('name').eq('id', tenantId).maybeSingle(), 'Betrieb')
    betriebName = typeof tenant?.name === 'string' && tenant.name.trim() ? tenant.name.trim() : null
  }

  // CSV-Knöpfe nur, wenn die Route sie auch ausliefert (Pflichtmeldungen: Betriebsleiter; Leser mit Controlling)
  const csvErlaubt = zugriffsFehler(KATALOG_PFLANZENSCHUTZ['psm-aufzeichnung'], membership, module) === null

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-blue-700 transition-colors">Maßnahmen</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Berichte</span>
      </div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Berichte & Aufzeichnungen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Anteilige Mittelverteilung · Cu-Bilanz · Behördennachweise</p>
        </div>
      </div>
      {/* neueste Maßnahmen zuerst (wie bisher) */}
      <BerichteClient
        behandlungen={[...behandlungen].reverse()}
        weingaerten={weingaerten}
        betriebName={betriebName}
        csvErlaubt={csvErlaubt}
      />
    </div>
  )
}
