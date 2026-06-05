import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import {
  updatePreisliste, deactivatePreisliste,
  createPosition, updatePosition, deletePosition,
} from '../actions'
import PrintButton from '@/app/(dashboard)/kellerbuch/kellerplan/[id]/PrintButton'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('preislisten') as any).select('name').eq('id', id).single()
  return { title: `${(data as R | null)?.name ?? 'Preisliste'} – software:112` }
}

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
}

export default async function PreislisteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id }   = await params
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [{ data: plRaw }, { data: posRaw }, { data: fuellungenRaw }] = await Promise.all([
    (supabase.from('preislisten') as any)
      .select('*')
      .eq('id', id)
      .eq('aktiv', true)
      .single(),

    (supabase.from('preislisten_positionen') as any)
      .select('*')
      .eq('preisliste_id', id)
      .eq('aktiv', true)
      .order('sort_order')
      .order('name'),

    (supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, vk_preis_brutto')
      .eq('aktiv', true)
      .order('name'),
  ])

  if (!plRaw) notFound()

  const pl        = plRaw as R
  const positionen = (posRaw ?? []) as R[]
  const fuellungen = (fuellungenRaw ?? []) as R[]

  const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  const updateWithId = updatePreisliste.bind(null, id)
  const deactivateWithId = deactivatePreisliste.bind(null, id)
  const createPosWithId  = createPosition.bind(null, id)

  // Gesamtwert der Preisliste
  const gesamtPositionen = positionen.length

  return (
    <div className="space-y-6">
      {/* Print-Styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          aside, nav, header { display: none !important; }
          .print-only { display: block !important; }
        }
        @media screen { .print-only { display: none !important; } }
      `}</style>

      {/* Breadcrumb */}
      <div className="flex items-center justify-between no-print">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weinhandel/preisliste" className="hover:text-s112-teal">Preislisten</Link>
          <span>/</span>
          <span className="text-gray-800 font-medium">{pl.name}</span>
        </nav>
        <div className="flex items-center gap-2">
          <PrintButton />
        </div>
      </div>

      {/* Kopf */}
      <div className="card p-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-900">{pl.name}</h1>
            {pl.beschreibung && <p className="text-sm text-s112-muted mt-0.5">{pl.beschreibung}</p>}
            <div className="flex gap-4 mt-2 text-xs text-s112-muted">
              {pl.gueltig_von && <span>ab {new Date(pl.gueltig_von).toLocaleDateString('de-AT')}</span>}
              {pl.gueltig_bis && <span>bis {new Date(pl.gueltig_bis).toLocaleDateString('de-AT')}</span>}
              <span>{gesamtPositionen} Position{gesamtPositionen !== 1 ? 'en' : ''}</span>
            </div>
          </div>
          {writeOk && (
            <div className="no-print">
              <ConfirmDeleteForm
                action={deactivateWithId}
                message="Preisliste wirklich löschen?"
                label="Löschen"
                className="text-xs text-red-500 hover:text-red-700 hover:underline"
              />
            </div>
          )}
        </div>

        {/* Kopf bearbeiten */}
        {writeOk && (
          <details className="no-print">
            <summary className="text-xs text-s112-teal cursor-pointer hover:underline">Kopfdaten bearbeiten</summary>
            <form action={updateWithId} className="mt-3 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className={labelCls}>Name</label>
                <input name="name" defaultValue={pl.name} required className={inputCls + ' w-full'} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Beschreibung</label>
                <input name="beschreibung" defaultValue={pl.beschreibung ?? ''} className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>Gültig von</label>
                <input name="gueltig_von" type="date" defaultValue={pl.gueltig_von ?? ''} className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>Gültig bis</label>
                <input name="gueltig_bis" type="date" defaultValue={pl.gueltig_bis ?? ''} className={inputCls + ' w-full'} />
              </div>
              <div className="col-span-2">
                <button type="submit" className="text-xs bg-s112-teal text-white px-4 py-1.5 rounded-lg hover:bg-opacity-90">
                  Speichern
                </button>
              </div>
            </form>
          </details>
        )}
      </div>

      {/* Positionen-Tabelle */}
      <div className="card p-0 overflow-hidden">
        {/* Print-Kopf */}
        <div className="print-only px-6 pt-5 pb-3 border-b">
          <h2 className="text-lg font-bold">{pl.name}</h2>
          {pl.gueltig_von && pl.gueltig_bis && (
            <p className="text-xs text-gray-500">
              Gültig {new Date(pl.gueltig_von).toLocaleDateString('de-AT')} –{' '}
              {new Date(pl.gueltig_bis).toLocaleDateString('de-AT')}
            </p>
          )}
        </div>

        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border">
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Produkt</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Einheit</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700">Preis (brutto)</th>
              {writeOk && <th className="no-print px-4 py-3" />}
            </tr>
          </thead>
          <tbody>
            {positionen.length === 0 ? (
              <tr>
                <td colSpan={writeOk ? 4 : 3} className="px-4 py-8 text-center text-s112-muted text-xs">
                  Noch keine Positionen. Unten hinzufügen.
                </td>
              </tr>
            ) : positionen.map((pos: R, i: number) => {
              const deletePosAction = deletePosition.bind(null, pos.id, id)
              return (
                <tr key={pos.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{pos.name}</div>
                    <div className="text-xs text-s112-muted flex gap-2 mt-0.5">
                      {pos.jahrgang    && <span>{pos.jahrgang}</span>}
                      {pos.rebsorte    && <span>{pos.rebsorte}</span>}
                      {pos.flaschengroesse_ml && (
                        <span>{FLASCHEN_LABEL[pos.flaschengroesse_ml] ?? `${pos.flaschengroesse_ml} ml`}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-s112-muted">{pos.einheit}</td>
                  <td className="px-4 py-3 text-right font-semibold text-s112-teal tabular-nums">
                    {pos.preis_brutto != null
                      ? Number(pos.preis_brutto).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                      : <span className="text-s112-muted font-normal">–</span>}
                  </td>
                  {writeOk && (
                    <td className="no-print px-4 py-3 text-right">
                      <ConfirmDeleteForm
                        action={deletePosAction}
                        message="Position löschen?"
                        className="text-xs text-red-400 hover:text-red-600"
                      />
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* MwSt.-Hinweis im Druck */}
        <div className="print-only px-4 py-3 text-xs text-gray-400 text-right border-t">
          Alle Preise in EUR inkl. 13% MwSt.
        </div>
      </div>

      {/* Position hinzufügen */}
      {writeOk && (
        <section className="card p-5 no-print">
          <h2 className="font-semibold text-gray-700 text-sm mb-4">Position hinzufügen</h2>
          <form action={createPosWithId} className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Aus Füllung übernehmen */}
              <div className="col-span-2 sm:col-span-4">
                <label className={labelCls}>Aus Füllung übernehmen (optional)</label>
                <select name="fuellung_id" className={inputCls + ' w-full'}
                  onChange={undefined /* client-side prefill would need 'use client' */}
                >
                  <option value="">– manuell eintragen –</option>
                  {fuellungen.map((f: R) => (
                    <option key={f.id} value={f.id}>
                      {f.name}{f.jahrgang ? ` (${f.jahrgang})` : ''}
                      {f.flaschengroesse_ml ? ` · ${FLASCHEN_LABEL[f.flaschengroesse_ml] ?? f.flaschengroesse_ml + ' ml'}` : ''}
                      {f.vk_preis_brutto ? ` · ${Number(f.vk_preis_brutto).toFixed(2)} €` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div className="col-span-2">
                <label className={labelCls}>Produktname *</label>
                <input name="name" required placeholder="z.B. Grüner Veltliner Ried Hohenberg" className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>Jahrgang</label>
                <input name="jahrgang" type="number" min={1900} max={2100} placeholder="2023" className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>Rebsorte</label>
                <input name="rebsorte" placeholder="z.B. Grüner Veltliner" className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>Flaschengrösse (ml)</label>
                <select name="flaschengroesse_ml" className={inputCls + ' w-full'}>
                  <option value="">–</option>
                  {Object.entries(FLASCHEN_LABEL).map(([ml, lbl]) => (
                    <option key={ml} value={ml}>{lbl}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Einheit</label>
                <select name="einheit" defaultValue="Flasche" className={inputCls + ' w-full'}>
                  <option>Flasche</option>
                  <option>Liter</option>
                  <option>Karton (6 Fl.)</option>
                  <option>Karton (12 Fl.)</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Preis brutto (€)</label>
                <input name="preis_brutto" type="number" step="0.01" min={0} placeholder="12.90" className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>Reihenfolge</label>
                <input name="sort_order" type="number" defaultValue={positionen.length * 10} className={inputCls + ' w-full'} />
              </div>
            </div>
            <button type="submit" className="text-xs bg-s112-teal text-white px-4 py-1.5 rounded-lg hover:bg-opacity-90">
              + Position hinzufügen
            </button>
          </form>
        </section>
      )}
    </div>
  )
}
