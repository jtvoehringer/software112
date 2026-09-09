'use client'

import React, { useState, useTransition } from 'react'
import { upsertErnteParzelle, deleteErnteParzelle, createOrUpdateAMAMeldung } from '../actions'
import type { ErnteParzelle, WeingartenOpt, AMAMeldung } from './page'
import PressungSection from './PressungSection'
import type { Pressung, WGOption, BehOption, WAOption } from './PressungSection'

const QUALITAET_OPTS = [
  { value: 'tafelwein', label: 'Tafelwein' },
  { value: 'landwein', label: 'Landwein' },
  { value: 'qualitaetswein', label: 'Qualitätswein' },
  { value: 'kabinett', label: 'Kabinett' },
  { value: 'spaetlese', label: 'Spätlese' },
  { value: 'auslese', label: 'Auslese' },
  { value: 'beerenauslese', label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese', label: 'TBA' },
  { value: 'eiswein', label: 'Eiswein' },
]
const LESEMETHODE_OPTS = [
  { value: 'handlese', label: 'Handlese' },
  { value: 'maschinenlese', label: 'Maschinenlese' },
  { value: 'selektionslese', label: 'Selektionslese' },
]
const AMA_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  entwurf:     { label: 'Entwurf',     cls: 'bg-gray-100 text-gray-600' },
  bereit:      { label: 'Bereit',      cls: 'bg-blue-100 text-blue-700' },
  eingereicht: { label: 'Eingereicht', cls: 'bg-amber-100 text-amber-700' },
  bestaetigt:  { label: 'Bestätigt',   cls: 'bg-green-100 text-green-700' },
  abgelehnt:   { label: 'Abgelehnt',   cls: 'bg-red-100 text-red-700' },
}

function formatDate(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ── Ernte-Formular ─────────────────────────────────────────────────────────────
function ParzellForm({
  jahrgangId, weingaerten, parzelle, onDone,
}: {
  jahrgangId: string; weingaerten: WeingartenOpt[]
  parzelle?: ErnteParzelle; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      await upsertErnteParzelle(jahrgangId, fd)
      onDone()
    })
  }

  // Weingärten nach Lage gruppieren
  const lagenMap = new Map<string, WeingartenOpt[]>()
  for (const w of weingaerten) {
    const key = w.lage_name ?? '(Keine Lage)'
    const arr = lagenMap.get(key) ?? []
    arr.push(w)
    lagenMap.set(key, arr)
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {parzelle ? 'Lesedaten bearbeiten' : 'Lesedaten erfassen'}
      </h3>
      {parzelle && <input type="hidden" name="existing_id" value={parzelle.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">
            Weingarten <span className="text-red-500">*</span>
          </label>
          <select name="weingarten_id" required defaultValue={parzelle?.weingarten_id ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {Array.from(lagenMap.entries()).map(([lage, wgs]) => (
              <optgroup key={lage} label={lage}>
                {wgs.map(w => (
                  <option key={w.id} value={w.id}>{w.name}{w.rebsorte ? ` (${w.rebsorte})` : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Ernte-Datum</label>
          <input name="ernte_datum" type="date" defaultValue={parzelle?.ernte_datum ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Lesemethode</label>
          <select name="lesemethode" defaultValue={parzelle?.lesemethode ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">–</option>
            {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Menge (kg)</label>
          <input name="menge_kg" type="number" step="0.01" min="0"
            defaultValue={parzelle?.menge_kg ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">°Oechsle</label>
          <input name="oechsle" type="number" step="0.1" min="0"
            defaultValue={parzelle?.oechsle ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">°KMW</label>
          <input name="klosterneuburger" type="number" step="0.01" min="0"
            defaultValue={parzelle?.klosterneuburger ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Qualitätsstufe</label>
          <select name="qualitaetsstufe" defaultValue={parzelle?.qualitaetsstufe ?? 'qualitaetswein'}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            {QUALITAET_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input name="notizen" defaultValue={parzelle?.notizen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ErnteDetailClient({ jahrgang, parzellen, weingaerten, amaMeldung, pressungen, wgOptions, behOptions, waOptions, writeOk, adminOk }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jahrgang: Record<string, any>; parzellen: ErnteParzelle[]
  weingaerten: WeingartenOpt[]; amaMeldung: AMAMeldung | null
  pressungen: Pressung[]; wgOptions: WGOption[]; behOptions: BehOption[]; waOptions: WAOption[]
  writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const gesamtKg = parzellen.reduce((s, p) => s + (p.menge_kg ?? 0), 0)

  function handleDelete(id: string) {
    if (!confirm('Lesedaten löschen?')) return
    startTransition(() => deleteErnteParzelle(id, jahrgang.id))
  }

  function handleAMA() {
    if (!confirm('AMA-Meldung aus aktuellen Lesedaten aufbauen?')) return
    startTransition(() => createOrUpdateAMAMeldung(jahrgang.id))
  }

  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className={`space-y-6 ${pending ? 'opacity-60 pointer-events-none' : ''}`}>

      {/* Print-Header (nur beim Drucken sichtbar) */}
      <div className="hidden print:block mb-4 pb-4 border-b-2 border-gray-300">
        <p className="text-xs text-gray-500 font-semibold tracking-widest uppercase">software:112 – Gebeshuber Weinbau</p>
        <h1 className="text-2xl font-bold text-gray-900 mt-0.5">Jahrgang {jahrgang.jahrgang}</h1>
        <p className="text-sm text-gray-400 mt-1">Erstellt: {heute}</p>
      </div>

      {/* Ernte-Übersicht */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-800">Lesedaten</h2>
          <div className="flex items-center gap-3">
            <span className="text-sm text-s112-muted">{parzellen.length} Parzellen · {(gesamtKg/1000).toFixed(2)} t</span>
            {writeOk && !showForm && (
              <button onClick={() => { setShowForm(true); setEditId(null) }}
                data-print="hide"
                className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-teal font-medium px-3 py-1.5 rounded-lg transition-colors">
                ＋ Ernte
              </button>
            )}
            <button
              onClick={() => window.print()}
              data-print="hide"
              className="inline-flex items-center gap-1.5 border border-s112-border text-gray-600 px-3 py-1.5 rounded-lg text-xs hover:bg-s112-bg transition-colors"
              title="Als PDF speichern oder drucken"
            >
              🖨 Drucken / PDF
            </button>
          </div>
        </div>

        {showForm && !editId && (
          <div className="mb-4" data-print="hide">
            <ParzellForm jahrgangId={jahrgang.id} weingaerten={weingaerten} onDone={() => setShowForm(false)} />
          </div>
        )}

        {parzellen.length > 0 ? (
          <div className="border border-s112-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                  <th className="text-left px-3 py-2 font-semibold">Weingarten</th>
                  <th className="text-left px-3 py-2 font-semibold">Datum</th>
                  <th className="text-right px-3 py-2 font-semibold">kg</th>
                  <th className="text-right px-3 py-2 font-semibold">°Oe</th>
                  <th className="text-left px-3 py-2 font-semibold">Qualität</th>
                  {(writeOk || adminOk) && <th className="px-3 py-2" />}
                </tr>
              </thead>
              <tbody>
                {parzellen.map(p => (
                  <React.Fragment key={p.id}>
                    <tr className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30">
                      <td className="px-3 py-2 font-medium text-gray-800">
                        {p.weingarten_name}
                        {p.weingarten_rebsorte && <span className="ml-1 text-xs text-s112-muted">({p.weingarten_rebsorte})</span>}
                      </td>
                      <td className="px-3 py-2 text-s112-muted">{formatDate(p.ernte_datum)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.menge_kg?.toLocaleString('de-AT') ?? '–'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{p.oechsle ?? '–'}</td>
                      <td className="px-3 py-2 text-xs text-s112-muted capitalize">{p.qualitaetsstufe ?? '–'}</td>
                      {(writeOk || adminOk) && (
                        <td className="px-3 py-2 text-right" data-print="hide">
                          <div className="flex items-center justify-end gap-2">
                            {writeOk && (
                              <button onClick={() => { setEditId(p.id); setShowForm(false) }}
                                className="text-xs text-s112-teal hover:underline">Bearb.</button>
                            )}
                            {adminOk && (
                              <button onClick={() => handleDelete(p.id)}
                                className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {editId === p.id && (
                      <tr>
                        <td colSpan={6} className="px-3 py-2">
                          <ParzellForm jahrgangId={jahrgang.id} weingaerten={weingaerten} parzelle={p} onDone={() => setEditId(null)} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-s112-bg border-t-2 border-s112-border font-semibold text-sm">
                  <td className="px-3 py-2 text-gray-700" colSpan={2}>Gesamt</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-800">{gesamtKg.toLocaleString('de-AT')} kg</td>
                  <td colSpan={3} className="px-3 py-2 text-xs text-s112-muted">
                    ≈ {(gesamtKg / 130).toFixed(1)} hl
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="border border-dashed border-s112-border rounded-xl p-8 text-center text-sm text-s112-muted">
            Noch keine Lesedaten erfasst.
          </div>
        )}
      </div>

      {/* AMA Meldung */}
      {writeOk && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-800">AMA Erntemeldung</h2>
            {amaMeldung && (
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${AMA_STATUS_BADGE[amaMeldung.status]?.cls ?? 'bg-gray-100 text-gray-600'}`}>
                {AMA_STATUS_BADGE[amaMeldung.status]?.label ?? amaMeldung.status}
              </span>
            )}
          </div>

          {amaMeldung ? (
            <div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-s112-bg rounded-xl p-3">
                  <p className="text-lg font-bold text-gray-800">{amaMeldung.gesamtmenge_kg?.toLocaleString('de-AT')} kg</p>
                  <p className="text-xs text-s112-muted">Gesamtmenge</p>
                </div>
                <div className="bg-s112-bg rounded-xl p-3">
                  <p className="text-lg font-bold text-gray-800">{amaMeldung.gesamtmenge_hl?.toFixed(1)} hl</p>
                  <p className="text-xs text-s112-muted">Most (≈)</p>
                </div>
              </div>

              {amaMeldung.positionen.length > 0 && (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="border-b border-s112-border text-xs text-gray-600">
                      <th className="text-left pb-1 font-semibold">Rebsorte</th>
                      <th className="text-right pb-1 font-semibold">Fläche (ha)</th>
                      <th className="text-right pb-1 font-semibold">Menge (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amaMeldung.positionen.map((pos, i) => (
                      <tr key={i} className="border-b border-s112-border/40 last:border-0">
                        <td className="py-1.5">{pos.rebsorte_name}</td>
                        <td className="py-1.5 text-right tabular-nums">{pos.flaeche_ha?.toFixed(4) ?? '–'}</td>
                        <td className="py-1.5 text-right tabular-nums">{pos.menge_kg?.toLocaleString('de-AT') ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {amaMeldung.n8n_fehler && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2 text-xs mb-3">
                  Fehler: {amaMeldung.n8n_fehler}
                </div>
              )}

              <div className="flex gap-2" data-print="hide">
                <button onClick={handleAMA}
                  className="text-sm bg-s112-bg border border-s112-border hover:border-s112-teal text-gray-700 hover:text-s112-teal px-4 py-2 rounded-lg transition-colors">
                  Neu berechnen
                </button>
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-s112-muted mb-4" data-print="hide">
                Lesedaten aus {parzellen.length} Parzellen zu AMA-Meldung aggregieren.
              </p>
              <button onClick={handleAMA} disabled={parzellen.length === 0}
                data-print="hide"
                className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
                AMA-Meldung erstellen
              </button>
            </div>
          )}
        </div>
      )}

      {/* Pressungen / Lese */}
      <PressungSection
        jahrgangId={jahrgang.id}
        pressungen={pressungen}
        wgOptions={wgOptions}
        behOptions={behOptions}
        waOptions={waOptions}
        leseParzellen={parzellen.map(p => ({
          weingarten_id: p.weingarten_id,
          weingarten_name: p.weingarten_name,
          menge_kg: p.menge_kg,
          rebsorte: p.weingarten_rebsorte,
        }))}
        writeOk={writeOk}
        adminOk={adminOk}
      />
    </div>
  )
}