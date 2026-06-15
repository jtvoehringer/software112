import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { createEaKategorie } from '../actions'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function KategorienPage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')

  const { data: kategorien } = await (supabase.from('ea_kategorien') as any)
    .select('*')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('aktiv', true)
    .order('sortierung')

  const systemKat   = (kategorien as R[])?.filter(k => !k.tenant_id) ?? []
  const mandantKat  = (kategorien as R[])?.filter(k => k.tenant_id)  ?? []

  const typFarbe = (typ: string) =>
    typ === 'einnahme' ? 'bg-green-100 text-green-700' :
    typ === 'ausgabe'  ? 'bg-red-100 text-red-600' :
    'bg-gray-100 text-gray-600'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/buchhaltung" className="text-sm text-s112-muted hover:text-gray-700">← Buchungen</Link>
        <h1 className="text-2xl font-bold text-gray-900">Buchungskategorien</h1>
      </div>

      {/* Neue Kategorie */}
      <div className="bg-white rounded-2xl border border-s112-border p-5 mb-6">
        <h2 className="font-semibold text-gray-800 mb-4">Neue Kategorie anlegen</h2>
        <form action={async (fd: FormData) => { 'use server'; await createEaKategorie(fd) }} className="grid grid-cols-4 gap-3 items-end">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Typ *</label>
            <select name="typ" required
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="einnahme">Einnahme</option>
              <option value="ausgabe">Ausgabe</option>
              <option value="beides">Beides</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
            <input name="name" required placeholder="z.B. Hofverkauf"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Konto-Nr. (EKR)</label>
            <input name="konto_nr" type="number" placeholder="z.B. 4000"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">USt-Satz</label>
            <select name="ust_satz_std" defaultValue="20"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="0">0%</option>
              <option value="10">10%</option>
              <option value="13">13%</option>
              <option value="20">20%</option>
            </select>
          </div>
          <div className="col-span-4 flex justify-end">
            <button type="submit"
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
              Speichern
            </button>
          </div>
        </form>
      </div>

      {/* Eigene Kategorien */}
      {mandantKat.length > 0 && (
        <div className="bg-white rounded-2xl border border-s112-border mb-4">
          <div className="px-5 py-3 border-b border-s112-border">
            <h2 className="font-semibold text-gray-800">Eigene Kategorien</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-4 py-2 font-medium text-gray-600">Name</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Typ</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Konto</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">USt</th>
              </tr>
            </thead>
            <tbody>
              {mandantKat.map((k: R) => (
                <tr key={k.id} className="border-b border-s112-border/40">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{k.name}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${typFarbe(k.typ)}`}>{k.typ}</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{k.konto_nr ?? '–'}</td>
                  <td className="px-4 py-2.5 text-gray-500">{k.ust_satz_std}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Systemkategorien */}
      <div className="bg-white rounded-2xl border border-s112-border">
        <div className="px-5 py-3 border-b border-s112-border flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">Systemkategorien (österr. EKR)</h2>
          <span className="text-xs text-s112-muted">Nur Ansicht, nicht bearbeitbar</span>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border bg-s112-bg">
              <th className="text-left px-4 py-2 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Typ</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">Konto</th>
              <th className="text-left px-4 py-2 font-medium text-gray-600">USt</th>
            </tr>
          </thead>
          <tbody>
            {systemKat.map((k: R) => (
              <tr key={k.id} className="border-b border-s112-border/40 hover:bg-s112-bg/40">
                <td className="px-4 py-2 text-gray-700">{k.name}</td>
                <td className="px-4 py-2">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${typFarbe(k.typ)}`}>{k.typ}</span>
                </td>
                <td className="px-4 py-2 text-gray-500">{k.konto_nr ?? '–'}</td>
                <td className="px-4 py-2 text-gray-500">{k.ust_satz_std}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
