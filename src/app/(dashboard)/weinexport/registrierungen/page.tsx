// KAN-437 Teil 2 (13.11.2026): Export-Registrierungen des Betriebs – FDA mit US-Agent, GACC, MFDS, Ermächtigter
// Ausführer, sonstige; mit Ablaufdatum. Erinnerung 90 Tage vorher im Dashboard und am Exportauftrag.
import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { geladen } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { heuteWien } from '@/lib/datum/wien'
import { ladeExportRegistrierungen } from '@/lib/export/registrierungenLaden'
import { REGISTRIERUNG_VORWARNUNG_TAGE } from '@/lib/export/registrierungen'
import RegistrierungenClient from './RegistrierungenClient'

export const metadata: Metadata = { title: 'Export-Registrierungen' }
export const dynamic = 'force-dynamic'

export default async function ExportRegistrierungenPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_export').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_export || !tenantId) redirect('/dashboard')

  const liste = await ladeExportRegistrierungen(supabase, tenantId)
  return (
    <div className="p-8 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-1">
        <Link href="/weinexport" className="hover:text-s112-blue-700 transition-colors">Weinexport</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Registrierungen</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text">Export-Registrierungen</h1>
      <p className="text-sm text-s112-muted mt-1 mb-6 max-w-3xl">
        Registrierungen und Bewilligungen des Betriebs, die Zielländer verlangen – etwa die FDA-Registrierung mit US-Agent (USA),
        die GACC-Registrierung (China), die MFDS-Vorregistrierung (Südkorea) oder die Bewilligung als Ermächtigter Ausführer.
        {' '}{REGISTRIERUNG_VORWARNUNG_TAGE} Tage vor dem Ablauf erscheint die Registrierung unter Dashboard › Meldungen &amp; Fristen und als
        Hinweis an Exportaufträgen in das betreffende Land. EORI und REX-Nummer stehen in den{' '}
        <Link href="/betrieb/einstellungen" className="text-s112-blue-700 hover:underline">Betriebseinstellungen</Link>.
      </p>
      <RegistrierungenClient liste={liste} heute={heuteWien()} darfSchreiben={!!membership && canWrite(membership, 'warenwirtschaft')} />
    </div>
  )
}
