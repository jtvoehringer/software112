import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { alle } from '@/lib/supabase/alle'
import { wienHeute } from '@/lib/csv'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import { offeneLieferscheineJeKunde } from '@/lib/verkauf/sammelrechnung'
import { rechnungErstellen } from '../verkauf/actions'
import SammelrechnungClient from './SammelrechnungClient'

export const metadata: Metadata = { title: 'Sammelrechnung' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-104 (08.10.2026): Sammelrechnung – nicht berechnete Lieferscheine je Kunde (ein Empfänger, ganze Lieferscheine), vor dem
// Erstellen eine Liste der abzurechnenden Lieferscheine zur Freigabe (Entscheidung Jörgen 06.10.2026). Die Rechnung legt
// s112_rechnung_erstellen an (Nummer, Leistungszeitraum, Zahlungen).
export default async function SammelrechnungPage() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? ''
  const darf = !!membership && canWrite(membership, 'warenwirtschaft') && !(await schreibSperre(membership))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await alle<R>((supabase.from('verkaufsposten') as any)
    .select(`id, datum, lieferscheinnummer, kontakt_id, firma_id,
      kontakt:kontakte!kontakt_id(titel, vorname, nachname, titel_nachgestellt), firma:firmen!firma_id(name),
      verkauf_positionen(menge, preis_brutto, rabatt_pct, sonderrabatt_pct)`)
    .eq('tenant_id', tenantId).eq('aktiv', true).eq('storniert', false).is('rechnung_id', null)
    .order('datum').order('id'))
  const kunden = offeneLieferscheineJeKunde((data ?? []) as R[], l =>
    l.firma ? String((l.firma as R).name) : l.kontakt ? kontaktAnzeigename(l.kontakt as R) : 'ohne Kunde (Barverkauf)')

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700 transition-colors">Verkauf</Link>
        <span>/</span>
        <span className="text-s112-text-2">Sammelrechnung</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-s112-text">Sammelrechnung</h1>
        <p className="text-sm text-s112-muted mt-1">
          Nicht berechnete Lieferscheine eines Kunden zu einer Rechnung zusammenfassen. Die Lieferscheine werden zur Gänze
          berechnet; vor dem Erstellen zeigt die Liste alle abzurechnenden Lieferscheine zur Freigabe.
        </p>
      </div>
      {error ? (
        <p role="alert" className="card p-4 text-sm text-s112-err">Lieferscheine konnten nicht geladen werden: {error.message}</p>
      ) : kunden.length === 0 ? (
        <p className="card p-4 text-sm text-s112-muted">Keine nicht berechneten Lieferscheine.</p>
      ) : (
        <SammelrechnungClient kunden={kunden} heute={wienHeute()} darf={darf} erstellen={rechnungErstellen} />
      )}
    </div>
  )
}
