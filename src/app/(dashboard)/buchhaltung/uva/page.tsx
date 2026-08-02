import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { berechneUndSpeichereUva } from '../actions'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const QUARTALE = ['Q1', 'Q2', 'Q3', 'Q4']

export default async function UvaPage({
  searchParams,
}: {
  searchParams: { jahr?: string }
}) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, ea_uva_zeitraum').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')

  const sp   = await searchParams
  const jahr = parseInt(sp.jahr ?? '') || new Date().getFullYear()
  const uvaZeitraum = einst?.ea_uva_zeitraum ?? 'quartalsweise'

  // Gespeicherte UVA-Meldungen für dieses Jahr laden
  const { data: uvaListe } = await (supabase.from('ea_uva') as any)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('jahr', jahr)
    .order('zeitraum')

  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)
  const zeitraeume = uvaZeitraum === 'monatlich'
    ? Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
    : QUARTALE

  const zeitraumLabel = (z: string) => {
    if (z.startsWith('Q')) return `${z} ${jahr}`
    const mon = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
    return `${mon[parseInt(z) - 1]} ${jahr}`
  }

  async function handleBerechnen(formData: FormData) {
    'use server'
    const j = parseInt(formData.get('jahr') as string)
    const z = formData.get('zeitraum') as string
    await berechneUndSpeichereUva(j, z)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buchhaltung" className="text-sm text-s112-muted hover:text-gray-700">← Buchungen</Link>
        <h1 className="text-2xl font-bold text-gray-900">UVA-Meldung</h1>
      </div>

      {/* Jahr-Wahl */}
      <form method="GET" className="flex gap-3 mb-6 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Geschäftsjahr</label>
          <select name="jahr" defaultValue={String(jahr)}
            className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
            {jahre.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <button type="submit" className="bg-s112-teal text-white px-4 py-2 rounded-lg text-sm">Anzeigen</button>
      </form>

      {/* Berechnen */}
      <div className="bg-white rounded-2xl border border-s112-border p-5 mb-6">
        <h2 className="font-semibold text-gray-800 mb-3">Zeitraum berechnen</h2>
        <form action={handleBerechnen} className="flex gap-3 items-end">
          <input type="hidden" name="jahr" value={jahr} />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Zeitraum *</label>
            <select name="zeitraum" required
              className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
              {zeitraeume.map(z => <option key={z} value={z}>{zeitraumLabel(z)}</option>)}
            </select>
          </div>
          <button type="submit"
            className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            Berechnen & Speichern
          </button>
        </form>
        <p className="text-xs text-s112-muted mt-2">
          Berechnet USt und VSt aus den Buchungen und speichert die Meldung. Bereits übermittelte (gesperrte) Meldungen werden nicht überschrieben.
        </p>
      </div>

      {/* UVA-Liste */}
      {(!uvaListe || uvaListe.length === 0) ? (
        <div className="bg-white rounded-2xl border border-s112-border p-8 text-center text-s112-muted">
          Noch keine UVA-Meldungen für {jahr}. Zeitraum berechnen →
        </div>
      ) : (
        <div className="space-y-4">
          {(uvaListe as R[]).map((uva: R) => (
            <div key={uva.id} className="bg-white rounded-2xl border border-s112-border p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-gray-800">{zeitraumLabel(uva.zeitraum)}</h3>
                {uva.gesperrt
                  ? <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">Übermittelt</span>
                  : <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Entwurf</span>}
              </div>

              <div className="grid grid-cols-2 gap-6 text-sm">
                {/* USt */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">UMSATZSTEUER (Einnahmen)</p>
                  <table className="w-full">
                    <tbody className="space-y-1">
                      {[
                        { label: 'Steuerfrei (0%)',  bmgl: uva.bmgl_ust_0,  ust: 0 },
                        { label: 'USt 10%', bmgl: uva.bmgl_ust_10, ust: uva.ust_10 },
                        { label: 'USt 13%', bmgl: uva.bmgl_ust_13, ust: uva.ust_13 },
                        { label: 'USt 20%', bmgl: uva.bmgl_ust_20, ust: uva.ust_20 },
                      ].map(row => (
                        <tr key={row.label}>
                          <td className="py-1 text-gray-600">{row.label}</td>
                          <td className="py-1 text-right text-gray-500">€ {fmt(row.bmgl)}</td>
                          <td className="py-1 text-right font-medium">€ {fmt(row.ust)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-s112-border font-semibold">
                        <td className="pt-2">USt gesamt</td>
                        <td />
                        <td className="pt-2 text-right text-orange-600">€ {fmt(uva.ust_gesamt)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* VSt */}
                <div>
                  <p className="text-xs font-medium text-gray-500 mb-2">VORSTEUER (Ausgaben)</p>
                  <table className="w-full">
                    <tbody>
                      {[
                        { label: 'VSt 10%', vst: uva.vst_10 },
                        { label: 'VSt 13%', vst: uva.vst_13 },
                        { label: 'VSt 20%', vst: uva.vst_20 },
                      ].map(row => (
                        <tr key={row.label}>
                          <td className="py-1 text-gray-600">{row.label}</td>
                          <td className="py-1 text-right font-medium">€ {fmt(row.vst)}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-s112-border font-semibold">
                        <td className="pt-2">VSt gesamt</td>
                        <td className="pt-2 text-right text-blue-600">€ {fmt(uva.vst_gesamt)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Zahllast */}
              <div className={`mt-4 pt-4 border-t border-s112-border flex items-center justify-between`}>
                <span className="font-semibold text-gray-700">
                  {(uva.zahllast ?? 0) >= 0 ? 'Zahllast' : 'Gutschrift'}
                </span>
                <span className={`text-xl font-bold ${(uva.zahllast ?? 0) >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  € {fmt(Math.abs(uva.zahllast ?? 0))}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
