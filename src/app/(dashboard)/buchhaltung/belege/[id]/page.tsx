import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { verbucheBeleg, verwerfeBeleg } from '../../actions'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import { AlertTriangle, Trash2 } from 'lucide-react'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UST_SAETZE = [
  { value: 0,  label: '0% (Export / befreit)' },
  { value: 10, label: '10%' },
  { value: 13, label: '13% (Wein, Landwirtschaft)' },
  { value: 20, label: '20% (Standard)' },
]

export default async function BelegBuchenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, ust_satz_standard').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')
  const ustStandard = einst?.ust_satz_standard ?? 20

  const { data: belegRaw } = await (supabase.from('ea_belege') as any)
    .select('id, dateiname, dateityp, status, storage_pfad, erkannte_daten, fehler_details, hochgeladen_am')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (!belegRaw) notFound()
  const beleg = belegRaw as R
  if (beleg.status === 'verbucht') redirect('/buchhaltung/belege')

  const { data: signed } = await supabase.storage
    .from('ea-belege')
    .createSignedUrl(beleg.storage_pfad, 3600)
  const previewUrl = signed?.signedUrl ?? null
  const istBild = (beleg.dateityp as string)?.startsWith('image/')

  const [{ data: kategorien }, { data: konten }] = await Promise.all([
    (supabase.from('ea_kategorien') as any)
      .select('id, name, typ')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq('aktiv', true)
      .order('sortierung'),
    (supabase.from('konten') as any)
      .select('id, name')
      .eq('tenant_id', tenantId).eq('aktiv', true)
      .order('sortierung').order('name'),
  ])

  const e = (beleg.erkannte_daten ?? {}) as R
  const einnahmeKat = (kategorien as R[])?.filter(k => k.typ === 'einnahme' || k.typ === 'beides') ?? []
  const ausgabeKat  = (kategorien as R[])?.filter(k => k.typ === 'ausgabe' || k.typ === 'beides') ?? []

  async function handleSubmit(formData: FormData) {
    'use server'
    const result = await verbucheBeleg(id, formData)
    if (!result?.error) redirect('/buchhaltung/belege')
  }

  const verwerfenWithId = verwerfeBeleg.bind(null, id)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung/belege" className="hover:text-s112-teal transition-colors">Belege</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium truncate">{beleg.dateiname}</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Beleg buchen</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Vorschau */}
        <div className="bg-white rounded-2xl border border-s112-border p-4">
          {previewUrl ? (
            istBild ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={beleg.dateiname} className="w-full rounded-lg" />
            ) : (
              <iframe src={previewUrl} className="w-full h-[600px] rounded-lg border border-s112-border" title={beleg.dateiname} />
            )
          ) : (
            <p className="text-sm text-s112-muted text-center py-10">Vorschau nicht verfügbar</p>
          )}
        </div>

        {/* Formular */}
        <div className="bg-white rounded-2xl border border-s112-border p-6 space-y-5">
          {beleg.status === 'fehler' && (
            <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-sm px-3 py-2.5 rounded-lg">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>Automatische Erkennung fehlgeschlagen{beleg.fehler_details ? ` (${beleg.fehler_details})` : ''} – bitte alle Felder manuell ausfüllen.</span>
            </div>
          )}
          {e.hinweis && (
            <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-sm px-3 py-2.5 rounded-lg">
              <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <span>{e.hinweis}</span>
            </div>
          )}
          {e.konfidenz && e.konfidenz !== 'hoch' && (
            <p className="text-xs text-s112-muted">Erkennungssicherheit: {e.konfidenz === 'mittel' ? 'mittel' : 'niedrig'} – bitte Werte vor dem Buchen prüfen.</p>
          )}

          <form action={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Typ *</label>
              <div className="flex gap-3">
                {[
                  { value: 'einnahme', label: '↑ Einnahme', color: 'text-green-700 border-green-300 bg-green-50' },
                  { value: 'ausgabe',  label: '↓ Ausgabe',  color: 'text-red-600 border-red-300 bg-red-50'     },
                ].map(t => (
                  <label key={t.value} className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium ${t.color}`}>
                    <input type="radio" name="typ" value={t.value} required
                      defaultChecked={(e.typ ?? 'ausgabe') === t.value}
                      className="accent-current" />
                    {t.label}
                  </label>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
                <input type="date" name="datum" required
                  defaultValue={e.datum ?? new Date().toISOString().split('T')[0]}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">USt-Satz *</label>
                <select name="ust_satz" defaultValue={e.ust_satz ?? ustStandard}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  {UST_SAETZE.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bezeichnung *</label>
              <input name="beschreibung" required defaultValue={e.beschreibung ?? ''}
                placeholder="z.B. Diesel Tankstelle Müller"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Betrag Netto (€) *</label>
              <input type="number" name="betrag_netto" step="0.01" min="0" required
                defaultValue={e.betrag_netto ?? ''} placeholder="0.00"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              {e.betrag_brutto != null && (
                <p className="text-xs text-s112-muted mt-1">
                  Erkannter Bruttobetrag auf dem Beleg: € {Number(e.betrag_brutto).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
                </p>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Kategorie</label>
              <select name="kategorie_id" defaultValue={e.kategorie_id ?? ''}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="">– keine –</option>
                <optgroup label="Einnahmen">
                  {einnahmeKat.map((k: R) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </optgroup>
                <optgroup label="Ausgaben">
                  {ausgabeKat.map((k: R) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </optgroup>
              </select>
            </div>

            {konten && (konten as R[]).length > 0 && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Konto</label>
                <select name="konto_id" defaultValue=""
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">– keines –</option>
                  {(konten as R[]).map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
                <p className="text-xs text-s112-muted mt-1">Optional – wenn gesetzt, erscheint die Buchung in der Kontoabstimmung dieses Kontos.</p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
              <textarea name="notizen" rows={2} defaultValue={`Beleg: ${beleg.dateiname}`}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
            </div>

            <div className="flex gap-3 pt-2">
              <button type="submit"
                className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90">
                Buchung anlegen
              </button>
              <Link href="/buchhaltung/belege"
                className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-gray-600 hover:bg-s112-bg">
                Später
              </Link>
            </div>
          </form>

          <div className="pt-3 border-t border-s112-border">
            <ConfirmDeleteForm
              action={verwerfenWithId}
              message="Beleg verwerfen? Die Datei wird endgültig gelöscht, es entsteht keine Buchung."
              label={<span className="inline-flex items-center gap-1.5"><Trash2 size={14} /> Beleg verwerfen</span>}
              title="Verwerfen"
              className="text-xs text-red-400 hover:text-red-600"
            />
          </div>
        </div>
      </div>
    </div>
  )
}
