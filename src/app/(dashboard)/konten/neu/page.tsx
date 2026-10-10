import { zielNachAbschluss } from '@/lib/navigation/zurueck'
import { geladen } from '@/lib/supabase/geladen'
import { AbbrechenKnopf, ZurueckFeld } from '@/components/navigation/Abbrechen'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { createKonto } from '../actions'
import { heuteWien } from '@/lib/datum/wien'
import SendenKnopf from '@/components/ui/SendenKnopf'

export const dynamic = 'force-dynamic'

const TYPEN = [
  { value: 'giro',        label: 'Girokonto' },
  { value: 'kreditkarte', label: 'Kreditkarte' },
  { value: 'kassa',       label: 'Kassa' },
  { value: 'sonstiges',   label: 'Sonstiges' },
]

export default async function KontoNeuPage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')

  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', membership.tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_ea) redirect('/dashboard')
  if (!canAdmin(membership.role)) redirect('/konten')

  async function handleSubmit(formData: FormData) {
    'use server'
    const result = await createKonto(formData)
    if (!result?.error) redirect(zielNachAbschluss(formData.get('zurueck'), '/konten', 'angelegt'))   // KAN-224
  }

  return (
    <div className="p-6 max-w-lg mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/konten" className="hover:text-s112-blue-700 transition-colors">Konten</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neues Konto</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-6">Neues Konto</h1>

      <form action={handleSubmit} className="bg-white rounded-xl border border-s112-border p-6 space-y-5">
        <ZurueckFeld standard="/konten" />
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung *</label>
          <input aria-label="Bezeichnung" name="name" required placeholder="z.B. Raiffeisen Girokonto"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Typ</label>
          <select aria-label="Typ" name="typ" defaultValue="giro"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
            {TYPEN.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">IBAN</label>
          <input aria-label="IBAN" name="iban" placeholder="Optional"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Eröffnungsdatum *</label>
            <input aria-label="Eröffnungsdatum" type="date" name="eroeffnungsdatum" required
              defaultValue={heuteWien()}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            <p className="text-xs text-s112-muted mt-1">Datum des letzten Kontoauszugs, ab dem hier weitergeführt wird.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Eröffnungssaldo (€) *</label>
            <input aria-label="Eröffnungssaldo (€)" type="number" name="eroeffnungssaldo" step="0.01" required defaultValue="0.00"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <SendenKnopf
            className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
            Konto anlegen
          </SendenKnopf>
          <AbbrechenKnopf standard="/konten"
            className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-s112-text-2 hover:bg-s112-bg" />
        </div>
      </form>
    </div>
  )
}
