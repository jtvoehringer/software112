import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { aboStandAktuell } from '@/lib/auth/sperren'
import { createEaDauerauftrag, deaktiviereEaDauerauftrag } from '../actions'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import { fmtNum } from '@/lib/format'
import { heuteWien } from '@/lib/datum/wien'

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
  const adminOk  = canAdmin(membership.role)

  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_ea) redirect('/dashboard')

  // KAN-5: Der tägliche Lauf (process_ea_dauerauftraege) bucht bei gesperrtem Abo nichts. Maßgeblich
  // ist die Regel des Betriebs, nicht die Ausnahme des Betrachters – daher ohne Rolle abfragen.
  const aboGesperrt = (await aboStandAktuell({ tenantId, role: null })).gesperrt

  const [dauerauftraegeRes, kategorienRes, kontenRes, logRes] = await Promise.all([
    (supabase.from('ea_dauerauftraege') as any)
      .select('*, ea_kategorien(name), konten(name)')
      .eq('tenant_id', tenantId)
      .order('naechste_faelligkeit'),
    (supabase.from('ea_kategorien') as any)
      .select('id, name, typ')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq('aktiv', true)
      .order('sortierung'),
    (supabase.from('konten') as any)
      .select('id, name').eq('tenant_id', tenantId).eq('aktiv', true)
      .order('sortierung').order('name'),
    (supabase.from('ea_dauerauftrag_log') as any)
      .select('*, ea_dauerauftraege(beschreibung)')
      .eq('tenant_id', tenantId)
      .order('erstellt_am', { ascending: false })
      .limit(10),
  ])
  const dauerauftraege = geladen(dauerauftraegeRes, 'Daueraufträge')
  const kategorien = geladen(kategorienRes, 'Kategorien')
  const konten = geladen(kontenRes, 'Konten')
  const log = geladen(logRes, 'Protokoll der Daueraufträge')

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Daueraufträge</span>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Daueraufträge</h1>
      </div>

      {aboGesperrt && (
        <p role="status" className="mb-6 px-4 py-2.5 rounded-lg bg-s112-warn-bg border border-s112-warn/40 text-s112-warn-fg text-sm">
          <strong className="font-semibold">Daueraufträge pausiert:</strong> Solange das Abo gesperrt ist, bucht der tägliche Lauf keine
          fälligen Daueraufträge. Nach der Klärung unter <Link href="/abo" className="underline">Abo</Link> werden sie nachgeholt – eine
          Fälligkeit je Tag und Dauerauftrag.
        </p>
      )}

      {/* Neuer Dauerauftrag */}
      <div className="bg-white rounded-xl border border-s112-border p-5 mb-6">
        <h2 className="font-semibold text-s112-text mb-4">Neuer Dauerauftrag</h2>
        <form action={async (fd: FormData) => { 'use server'; await createEaDauerauftrag(fd) }} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Typ *</label>
              <select aria-label="Typ" name="typ" required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
                <option value="einnahme">Einnahme</option>
                <option value="ausgabe">Ausgabe</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Intervall *</label>
              <select aria-label="Intervall" name="intervall" required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
                {INTERVALLE.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung *</label>
            <input aria-label="Bezeichnung" name="beschreibung" required placeholder="z.B. Miete Lagerhalle"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Betrag Netto (€) *</label>
              <input aria-label="Betrag Netto (€)" type="number" name="betrag_netto" step="0.01" min="0.01" required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">USt-Satz</label>
              <select aria-label="USt-Satz" name="ust_satz" defaultValue="20"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
                <option value="0">0%</option><option value="10">10%</option>
                <option value="13">13%</option><option value="20">20%</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Tag im Monat</label>
              <input aria-label="Tag im Monat" type="number" name="tag_im_monat" min="1" max="28" defaultValue="1"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Nächste Fälligkeit *</label>
              <input aria-label="Nächste Fälligkeit" type="date" name="naechste_faelligkeit" required
                defaultValue={heuteWien()}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Kategorie</label>
              <select aria-label="Kategorie" name="kategorie_id"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
                <option value="">– keine –</option>
                {(kategorien as R[])?.map((k: R) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
            </div>
          </div>
          {konten && (konten as R[]).length > 0 && (
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Konto</label>
              <select aria-label="Konto" name="konto_id" defaultValue=""
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
                <option value="">– keines –</option>
                {(konten as R[]).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
              <p className="text-xs text-s112-muted mt-1">Optional – wird an jede automatisch erzeugte Buchung weitergegeben.</p>
            </div>
          )}
          <button type="submit"
            className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
            Dauerauftrag anlegen
          </button>
        </form>
      </div>

      {/* Liste */}
      <div className="bg-white rounded-xl border border-s112-border overflow-hidden">
        <div className="px-5 py-3 border-b border-s112-border">
          <h2 className="font-semibold text-s112-text">Aktive Daueraufträge</h2>
        </div>
        {(!dauerauftraege || dauerauftraege.length === 0) ? (
          <p className="text-center py-8 text-s112-muted text-sm">Noch keine Daueraufträge</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Bezeichnung</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Typ</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Intervall</th>
                <th className="text-right px-4 py-2 font-medium text-s112-text-2">Netto/USt</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Nächste Fälligkeit</th>
                <th className="text-left px-4 py-2 font-medium text-s112-text-2">Konto</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {(dauerauftraege as R[]).filter(d => d.aktiv).map((d: R) => (
                <tr key={d.id} className="border-b border-s112-border/40 hover:bg-s112-bg/40">
                  <td className="px-4 py-2.5 font-medium text-s112-text">{d.beschreibung}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${d.typ === 'einnahme' ? 'bg-s112-ok-bg text-s112-ok-fg' : 'bg-s112-err-bg text-s112-err-fg'}`}>
                      {d.typ}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-s112-text-2">
                    {INTERVALLE.find(i => i.value === d.intervall)?.label ?? d.intervall}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">
                    € {(d.betrag_netto == null ? undefined : fmtNum(d.betrag_netto, { min: 2 }))}
                    <span className="text-s112-tertiary ml-1">+{d.ust_satz}%</span>
                  </td>
                  <td className="px-4 py-2.5 text-s112-text-2">
                    {d.naechste_faelligkeit
                      ? new Date(d.naechste_faelligkeit).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })
                      : '–'}
                  </td>
                  <td className="px-4 py-2.5 text-s112-text-2 text-xs">{d.konten?.name ?? '–'}</td>
                  <td className="px-4 py-2.5 text-right">
                    {adminOk && (
                      <ConfirmDeleteForm
                        action={async () => { 'use server'; await deaktiviereEaDauerauftrag(d.id) }}
                        message={`"${d.beschreibung}" deaktivieren? Es werden dann keine weiteren Buchungen mehr automatisch erzeugt.`}
                        title="Deaktivieren"
                        label="Deaktivieren"
                        className="text-xs text-s112-err hover:text-s112-err-fg"
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Letzte Ausführungen */}
      {log && (log as R[]).length > 0 && (
        <div className="bg-white rounded-xl border border-s112-border overflow-hidden mt-6">
          <div className="px-5 py-3 border-b border-s112-border">
            <h2 className="font-semibold text-s112-text">Letzte Ausführungen</h2>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {(log as R[]).map(l => (
                <tr key={l.id} className="border-b border-s112-border/40 last:border-0">
                  <td className="px-4 py-2 text-s112-text-2 whitespace-nowrap">
                    {new Date(l.erstellt_am).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className="px-4 py-2 text-s112-text">{l.ea_dauerauftraege?.beschreibung ?? '–'}</td>
                  <td className="px-4 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      l.status === 'erstellt' ? 'bg-s112-ok-bg text-s112-ok-fg'
                      : l.status === 'uebersprungen' ? 'bg-[#F2F3F5] text-s112-text-2'
                      : 'bg-s112-err-bg text-s112-err-fg'
                    }`}>
                      {l.status === 'erstellt' ? 'Erstellt' : l.status === 'uebersprungen' ? 'Übersprungen' : 'Fehler'}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-s112-text-2 text-xs">{l.fehler_details ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
