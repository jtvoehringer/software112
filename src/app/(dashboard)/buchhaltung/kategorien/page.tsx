import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { createEaKategorie } from '../actions'
import SendenKnopf from '@/components/ui/SendenKnopf'
import { ergebnisPruefen } from '@/lib/fehler'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Buchungskategorien' }

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function KategorienPage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_ea) redirect('/dashboard')

  const kategorien = geladen(await (supabase.from('ea_kategorien') as any)
    .select('*')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('aktiv', true)
    .order('sortierung'), 'Kategorien')

  const systemKat   = (kategorien as R[])?.filter(k => !k.tenant_id) ?? []
  const mandantKat  = (kategorien as R[])?.filter(k => k.tenant_id)  ?? []

  const typFarbe = (typ: string) =>
    typ === 'einnahme' ? 'bg-s112-ok-bg text-s112-ok-fg' :
    typ === 'ausgabe'  ? 'bg-s112-err-bg text-s112-err-fg' :
    'bg-[#F2F3F5] text-s112-text-2'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Buchungskategorien</span>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Buchungskategorien</h1>
      </div>

      {/* Neue Kategorie */}
      <div className="bg-white rounded-xl border border-s112-border p-5 mb-6">
        <h2 className="font-semibold text-s112-text mb-4">Neue Kategorie anlegen</h2>
        <form action={async (fd: FormData) => { 'use server'; ergebnisPruefen(await createEaKategorie(fd)) }} className="grid grid-cols-5 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Typ *</label>
            <select aria-label="Typ" name="typ" required
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
              <option value="einnahme">Einnahme</option>
              <option value="ausgabe">Ausgabe</option>
              <option value="beides">Beides</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Name *</label>
            <input aria-label="Name" name="name" required placeholder="z.B. Hofverkauf"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Konto-Nr. (EKR)</label>
            <input aria-label="Konto-Nr. (EKR)" name="konto_nr" type="number" step="1" placeholder="z.B. 4000"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">USt-Satz</label>
            <select aria-label="USt-Satz" name="ust_satz_std" defaultValue="20"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
              <option value="0">0%</option>
              <option value="10">10%</option>
              <option value="13">13%</option>
              <option value="20">20%</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Abzugsfähig %</label>
            <input aria-label="Abzugsfähig %" name="abzugsfaehig_pct" type="number" min="0" max="100" step="1" defaultValue={100}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden" />
            <p className="text-[11px] text-s112-tertiary mt-0.5">z.B. 50 bei Bewirtung/Repräsentation (§ 20 EStG)</p>
          </div>
          <div className="col-span-5 flex justify-end">
            <SendenKnopf
              className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
              Speichern
            </SendenKnopf>
          </div>
        </form>
      </div>

      {/* Eigene Kategorien */}
      {mandantKat.length > 0 && (
        <div className="bg-white rounded-xl border border-s112-border mb-4">
          <div className="px-5 py-3 border-b border-s112-border">
            <h2 className="font-semibold text-s112-text">Eigene Kategorien</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Name</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Typ</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Konto</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">USt</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Abzugsfähig</th>
              </tr>
            </thead>
            <tbody>
              {mandantKat.map((k: R) => (
                <tr key={k.id} className="border-b border-s112-border/40">
                  <td className="px-4 py-2.5 font-medium text-s112-text">{k.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${typFarbe(k.typ)}`}>{k.typ}</span>
                  </td>
                  <td className="px-4 py-2.5 text-s112-text-2">{k.konto_nr ?? '–'}</td>
                  <td className="px-4 py-2.5 text-s112-text-2">{k.ust_satz_std}%</td>
                  <td className="px-4 py-2.5">
                    {Number(k.abzugsfaehig_pct) < 100
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">{k.abzugsfaehig_pct}%</span>
                      : <span className="text-s112-tertiary text-xs">100%</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Systemkategorien */}
      <div className="bg-white rounded-xl border border-s112-border">
        <div className="px-5 py-3 border-b border-s112-border flex items-center justify-between">
          <h2 className="font-semibold text-s112-text">Systemkategorien (österr. EKR)</h2>
          <span className="text-xs text-s112-muted">Nur Ansicht, nicht bearbeitbar</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border bg-s112-bg">
              <th className="text-left px-4 py-2 font-medium text-s112-text-2">Name</th>
              <th className="text-left px-4 py-2 font-medium text-s112-text-2">Typ</th>
              <th className="text-left px-4 py-2 font-medium text-s112-text-2">Konto</th>
              <th className="text-left px-4 py-2 font-medium text-s112-text-2">USt</th>
              <th className="text-left px-4 py-2 font-medium text-s112-text-2">Abzugsfähig</th>
            </tr>
          </thead>
          <tbody>
            {systemKat.map((k: R) => (
              <tr key={k.id} className="border-b border-s112-border/40 hover:bg-s112-bg/40">
                <td className="px-4 py-2 text-s112-text-1">{k.name}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${typFarbe(k.typ)}`}>{k.typ}</span>
                </td>
                <td className="px-4 py-2 text-s112-text-2">{k.konto_nr ?? '–'}</td>
                <td className="px-4 py-2 text-s112-text-2">{k.ust_satz_std}%</td>
                <td className="px-4 py-2">
                  {Number(k.abzugsfaehig_pct) < 100
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">{k.abzugsfaehig_pct}%</span>
                    : <span className="text-s112-tertiary text-xs">100%</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
