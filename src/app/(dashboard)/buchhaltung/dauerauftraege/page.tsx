import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { createEaDauerauftrag } from '../actions'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const INTERVALLE = [
  { value: 'monatlich',        label: 'Monatlich'        },
  { value: 'vierteljaehrlich', label: 'Vierteljährlich'  },
  { value: 'halbjaehrlich',    label: 'Halbjährlich'     },
  { value: 'jaehrlich',        label: 'Jährlich'         },
]

export default async function DauerauftraegePage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')

  const [{ data: dauerauftraege }, { data: kategorien }] = await Promise.all([
    (supabase.from('ea_dauerauftraege') as any)
      .select('*, ea_kategorien(name)')
      .eq('tenant_id', tenantId)
      .order('naechste_faelligkeit'),
    (supabase.from('ea_kategorien') as any)
      .select('id, name, typ')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq('aktiv', true)
      .order('sortierung'),
  ])

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung" className="hover:text-s112-teal transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Daueraufträge</span>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Daueraufträge</h1>
      </div>

      {/* Neuer Dauerauftrag */}
      <div className="bg-white rounded-2xl border border-s112-border p-5 mb-6">
        <h2 className="font-semibold text-gray-800 mb-4">Neuer Dauerauftrag</h2>
        <form action={async (fd: FormData) => { 'use server'; await createEaDauerauftrag(fd) }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Typ *</label>
              <select name="typ" required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="einnahme">Einnahme</option>
                <option value="ausgabe">Ausgabe</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Intervall *</label>
              <select name="intervall" required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                {INTERVALLE.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Bezeichnung *</label>
            <input name="beschreibung" required placeholder="z.B. Miete Lagerhalle"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Betrag Netto (€) *</label>
              <input type="number" name="betrag_netto" step="0.01" min="0.01" required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">USt-Satz</label>
              <select name="ust_satz" defaultValue="20"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="0">0%</option><option value="10">10%</option>
                <option value="13">13%</option><option value="20">20%</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Tag im Monat</label>
              <input type="number" name="tag_im_monat" min="1" max="28" defaultValue="1"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nächste Fälligkeit *</label>
              <input type="date" name="naechste_faelligkeit" required
                defaultValue={new Date().toISOString().split('T')[0]}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Kategorie</label>
              <select name="kategorie_id"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                <option value="">– keine –</option>
                {(kategorien as R[])?.map((k: R) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
            </div>
          </div>
          <button type="submit"
            className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
            Dauerauftrag anlegen
          </button>
        </form>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-2xl border border-s112-border overflow-hidden">
        <div className="px-5 py-3 border-b border-s112-border">
          <h2 className="font-semibold text-gray-800">Aktive Daueraufträge</h2>
        </div>
        {(!dauerauftraege || dauerauftraege.length === 0) ? (
          <p className="text-center py-8 text-s112-muted text-sm">Noch keine Daueraufträge</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-4 py-2 font-medium text-gray-600">Bezeichnung</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Typ</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Intervall</th>
                <th className="text-right px-4 py-2 font-medium text-gray-600">Netto/USt</th>
                <th className="text-left px-4 py-2 font-medium text-gray-600">Nächste Fälligkeit</th>
              </tr>
            </thead>
            <tbody>
              {(dauerauftraege as R[]).filter(d => d.aktiv).map((d: R) => (
                <tr key={d.id} className="border-b border-s112-border/40 hover:bg-s112-bg/40">
                  <td className="px-4 py-2.5 font-medium text-gray-800">{d.beschreibung}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.typ === 'einnahme' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                      {d.typ}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {INTERVALLE.find(i => i.value === d.intervall)?.label ?? d.intervall}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    € {d.betrag_netto?.toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                    <span className="text-gray-400 ml-1">+{d.ust_satz}%</span>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {d.naechste_faelligkeit
                      ? new Date(d.naechste_faelligkeit).toLocaleDateString('de-AT')
                      : '–'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
