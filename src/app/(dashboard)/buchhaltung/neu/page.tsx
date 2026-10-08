import { zielNachAbschluss } from '@/lib/navigation/zurueck'
import { AbbrechenKnopf, ZurueckFeld } from '@/components/navigation/Abbrechen'
import { redirect } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { createEaTransaktion } from '../actions'
import { heuteWien } from '@/lib/datum/wien'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UST_SAETZE = [
  { value: 0,  label: '0% (Export / befreit)' },
  { value: 10, label: '10%' },
  { value: 13, label: '13% (Wein, Landwirtschaft)' },
  { value: 20, label: '20% (Standard)' },
]

export default async function BuchhaltungNeuPage() {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, ust_satz_standard').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')

  const ustStandard = einst?.ust_satz_standard ?? 20

  // Kategorien laden
  const { data: kategorien } = await (supabase.from('ea_kategorien') as any)
    .select('id, name, typ, ust_satz_std, abzugsfaehig_pct')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('aktiv', true)
    .order('sortierung')

  // Konten laden (optional – nur wenn welche angelegt sind)
  const { data: konten } = await (supabase.from('konten') as any)
    .select('id, name')
    .eq('tenant_id', tenantId).eq('aktiv', true)
    .order('sortierung').order('name')

  async function handleSubmit(formData: FormData) {
    'use server'
    const result = await createEaTransaktion(formData)
    if (!result?.error) redirect(zielNachAbschluss(formData.get('zurueck'), '/buchhaltung', 'gespeichert'))   // KAN-224
  }

  const einnahmeKat = (kategorien as R[])?.filter(k => k.typ === 'einnahme' || k.typ === 'beides') ?? []
  const ausgabeKat  = (kategorien as R[])?.filter(k => k.typ === 'ausgabe' || k.typ === 'beides') ?? []

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neue Buchung</span>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Neue Buchung</h1>
      </div>

      <form action={handleSubmit} className="bg-white rounded-xl border border-s112-border p-6 space-y-5">
        <ZurueckFeld standard="/buchhaltung" />
        {/* Typ */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-2">Typ *</label>
          <div className="flex gap-3">
            {[
              { value: 'einnahme', label: '↑ Einnahme', color: 'text-s112-ok-fg border-s112-ok/30 bg-s112-ok-bg' },
              { value: 'ausgabe',  label: '↓ Ausgabe',  color: 'text-s112-err-fg border-s112-err/30 bg-s112-err-bg'     },
            ].map(t => (
              <label key={t.value} className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium ${t.color}`}>
                <input type="radio" name="typ" value={t.value} required className="accent-current" />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        {/* Datum + Bezeichnung */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
            <input aria-label="Datum" type="date" name="datum" required
              defaultValue={heuteWien()}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">USt-Satz *</label>
            <select aria-label="USt-Satz" name="ust_satz" defaultValue={ustStandard}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              {UST_SAETZE.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung *</label>
          <input aria-label="Bezeichnung" name="beschreibung" required placeholder="z.B. Weinverkauf Mayer, Rechnung Nr. 2026-042"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Betrag */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Betrag Netto (€) *</label>
          <input aria-label="Betrag Netto (€)" type="number" name="betrag_netto" step="0.01" min="0" required placeholder="0.00"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
          <p className="text-xs text-s112-muted mt-1">USt wird automatisch aufgeschlagen. Bruttobetrag erscheint nach dem Speichern.</p>
        </div>

        {/* Kategorie (JS-unabhängige Auswahl – beide Listen immer vorhanden, Nutzer wählt passendes) */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Kategorie</label>
          <select aria-label="Kategorie" name="kategorie_id"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– keine –</option>
            <optgroup label="Einnahmen">
              {einnahmeKat.map((k: R) => <option key={k.id} value={k.id}>{k.name}{Number(k.abzugsfaehig_pct) < 100 ? ` — nur ${k.abzugsfaehig_pct}% abzugsfähig` : ''}</option>)}
            </optgroup>
            <optgroup label="Ausgaben">
              {ausgabeKat.map((k: R) => <option key={k.id} value={k.id}>{k.name}{Number(k.abzugsfaehig_pct) < 100 ? ` — nur ${k.abzugsfaehig_pct}% abzugsfähig` : ''}</option>)}
            </optgroup>
          </select>
          <p className="text-xs text-s112-muted mt-1">Bei eingeschränkt abzugsfähigen Kategorien (z.B. Bewirtung) wird der nicht abzugsfähige Anteil automatisch erfasst und in der Übersicht ausgewiesen.</p>
        </div>

        {/* Konto (optional – für Kontoabstimmung) */}
        {konten && (konten as R[]).length > 0 && (
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Konto</label>
            <select aria-label="Konto" name="konto_id" defaultValue=""
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– keines –</option>
              {(konten as R[]).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <p className="text-xs text-s112-muted mt-1">Optional – wenn gesetzt, erscheint die Buchung in der Kontoabstimmung dieses Kontos.</p>
          </div>
        )}

        {/* Notizen */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen / Belegnummer</label>
          <textarea aria-label="Notizen / Belegnummer" name="notizen" rows={2} placeholder="z.B. Rechnung 2026-042 liegt in Ablage"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 resize-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit"
            className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
            Buchung speichern
          </button>
          <AbbrechenKnopf standard="/buchhaltung"
            className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-s112-text-2 hover:bg-s112-bg" />
        </div>
      </form>
    </div>
  )
}
