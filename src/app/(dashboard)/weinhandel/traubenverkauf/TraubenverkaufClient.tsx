'use client'

import { useState, useTransition } from 'react'
import { upsertTraubenverkauf, deleteTraubenverkauf } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  verkaufe:   R[]
  wgOptions:  R[]
  jahrgaenge: R[]
  kontakte:   R[]
  firmen:     R[]
  writeOk:    boolean
}

const QUALITAETSSTUFEN = [
  { value: 'landwein',       label: 'Landwein' },
  { value: 'qualitaetswein', label: 'Qualitätswein' },
  { value: 'kabinett',       label: 'Kabinett' },
  { value: 'spaetlese',      label: 'Spätlese' },
  { value: 'auslese',        label: 'Auslese' },
  { value: 'beerenauslese',  label: 'Beerenauslese' },
  { value: 'tba',            label: 'Trockenbeerenauslese' },
  { value: 'eiswein',        label: 'Eiswein' },
  { value: 'dac',            label: 'DAC' },
]

function kaeuferName(v: R): string {
  if (v.kontakt) return [v.kontakt.vorname, v.kontakt.nachname].filter(Boolean).join(' ')
  if (v.firma) return v.firma.firmenname ?? '–'
  return '–'
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function fmtEur(n: number | null | undefined): string {
  if (n == null) return '–'
  return n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
}

export default function TraubenverkaufClient({ verkaufe, wgOptions, jahrgaenge, kontakte, firmen, writeOk }: Props) {
  const [showForm, setShowForm]     = useState(false)
  const [editRow, setEditRow]       = useState<R | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [kaeuferTyp, setKaeuferTyp] = useState<'kontakt' | 'firma'>('kontakt')
  const [herkunft, setHerkunft]     = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)

  function openNew() {
    setEditRow(null)
    setKaeuferTyp('kontakt')
    setHerkunft('')
    setError(null)
    setShowForm(true)
  }

  function openEdit(v: R) {
    setEditRow(v)
    setKaeuferTyp(v.kontakt_id ? 'kontakt' : 'firma')
    setHerkunft(v.herkunft_code ?? '')
    setError(null)
    setShowForm(true)
  }

  function handleWgChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const wg = wgOptions.find(w => w.id === e.target.value)
    setHerkunft(wg?.trauben_herkunft_code ?? '')
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    // Sicherstellen dass der nicht gewählte Käufertyp leer ist
    if (kaeuferTyp === 'kontakt') fd.set('firma_id', '')
    else fd.set('kontakt_id', '')

    startTransition(async () => {
      try {
        await upsertTraubenverkauf(fd)
        setShowForm(false)
        setEditRow(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unbekannter Fehler')
      }
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      try {
        await deleteTraubenverkauf(id)
        setDeleteConfirm(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Löschen')
      }
    })
  }

  // Gesamtsummen
  const sumKg  = verkaufe.reduce((s, v) => s + Number(v.menge_kg ?? 0), 0)
  const sumEur = verkaufe.reduce((s, v) => {
    if (v.preis_per_kg == null) return s
    return s + Number(v.menge_kg) * Number(v.preis_per_kg)
  }, 0)
  const hatPreis = verkaufe.some(v => v.preis_per_kg != null)

  return (
    <div className="space-y-6">

      {/* Aktions-Leiste */}
      {writeOk && (
        <div className="flex justify-end">
          <button
            onClick={openNew}
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            + Neuer Traubenverkauf
          </button>
        </div>
      )}

      {/* Formular */}
      {showForm && writeOk && (
        <div className="card p-5 border-2 border-s112-teal/30 space-y-4">
          <h2 className="text-base font-semibold text-gray-800">
            {editRow ? 'Traubenverkauf bearbeiten' : 'Neuer Traubenverkauf'}
          </h2>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              <strong>Fehler:</strong> {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {editRow && <input type="hidden" name="existing_id" value={editRow.id} />}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Weingarten */}
              <div>
                <label className="form-label">Weingarten *</label>
                <select
                  name="weingarten_id"
                  required
                  defaultValue={editRow?.weingarten?.id ?? ''}
                  onChange={handleWgChange}
                  className="form-input"
                >
                  <option value="">– Weingarten wählen –</option>
                  {wgOptions.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.name}{w.rebsorte ? ` (${w.rebsorte})` : ''}
                    </option>
                  ))}
                </select>
                {wgOptions.length === 0 && (
                  <p className="text-xs text-amber-600 mt-1">Kein Weingarten für Traubenverkauf freigegeben.</p>
                )}
              </div>

              {/* Datum */}
              <div>
                <label className="form-label">Lieferdatum *</label>
                <input
                  name="datum"
                  type="date"
                  required
                  defaultValue={editRow?.datum ?? new Date().toISOString().split('T')[0]}
                  className="form-input"
                />
              </div>

              {/* Jahrgang */}
              <div>
                <label className="form-label">Jahrgang</label>
                <select
                  name="jahrgang_id"
                  defaultValue={editRow?.jahrgang_id ?? ''}
                  className="form-input"
                >
                  <option value="">– kein Jahrgang –</option>
                  {jahrgaenge.map(j => (
                    <option key={j.id} value={j.id}>{j.jahrgang}</option>
                  ))}
                </select>
              </div>

              {/* Menge */}
              <div>
                <label className="form-label">Menge (kg) *</label>
                <input
                  name="menge_kg"
                  type="text"
                  inputMode="decimal"
                  required
                  defaultValue={editRow?.menge_kg?.toString().replace('.', ',') ?? ''}
                  className="form-input"
                  placeholder="z.B. 1250,00"
                />
              </div>

              {/* Preis */}
              <div>
                <label className="form-label">Preis €/kg</label>
                <input
                  name="preis_per_kg"
                  type="text"
                  inputMode="decimal"
                  defaultValue={editRow?.preis_per_kg?.toString().replace('.', ',') ?? ''}
                  className="form-input"
                  placeholder="z.B. 0,55"
                />
              </div>

              {/* KMW */}
              <div>
                <label className="form-label">KMW°</label>
                <input
                  name="kmw_grad"
                  type="text"
                  inputMode="decimal"
                  defaultValue={editRow?.kmw_grad?.toString().replace('.', ',') ?? ''}
                  className="form-input"
                  placeholder="z.B. 18,5"
                />
              </div>
              {/* Qualitätsstufe */}
              <div>
                <label className="form-label">Qualitätsstufe</label>
                <select
                  name="qualitaetsstufe"
                  defaultValue={editRow?.qualitaetsstufe ?? ''}
                  className="form-input"
                >
                  <option value="">– keine –</option>
                  {QUALITAETSSTUFEN.map(q => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
              </div>

              {/* Herkunft-Code */}
              <div>
                <label className="form-label">Herkunft-Code (BKI)</label>
                <input
                  name="herkunft_code"
                  type="text"
                  value={herkunft}
                  onChange={e => setHerkunft(e.target.value)}
                  className="form-input"
                  placeholder="z.B. WLWV"
                />
                <p className="text-xs text-s112-muted mt-1">Wird aus Weingarten vorgeschlagen</p>
              </div>
            </div>

            {/* Gesundheitsstatus */}
            <div>
              <label className="form-label">Traubengesundheit</label>
              <select
                name="gesundheit"
                defaultValue={editRow?.gesundheit ?? 'G'}
                className="form-input"
              >
                <option value="G">G – Gut (Standard)</option>
                <option value="K">K – Krank / beschädigt</option>
              </select>
            </div>

            {/* Käufer */}
            <div className="border-t border-s112-border pt-4">
              <label className="form-label mb-2">Käufer</label>
              <div className="flex gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => setKaeuferTyp('kontakt')}
                  className={`text-sm px-3 py-1 rounded-lg border transition-colors ${
                    kaeuferTyp === 'kontakt'
                      ? 'bg-s112-teal text-white border-s112-teal'
                      : 'border-s112-border text-gray-600 hover:border-s112-teal'
                  }`}
                >
                  Privatperson
                </button>
                <button
                  type="button"
                  onClick={() => setKaeuferTyp('firma')}
                  className={`text-sm px-3 py-1 rounded-lg border transition-colors ${
                    kaeuferTyp === 'firma'
                      ? 'bg-s112-teal text-white border-s112-teal'
                      : 'border-s112-border text-gray-600 hover:border-s112-teal'
                  }`}
                >
                  Firma
                </button>
              </div>

              {kaeuferTyp === 'kontakt' ? (
                <select
                  name="kontakt_id"
                  defaultValue={editRow?.kontakt?.id ?? ''}
                  className="form-input"
                >
                  <option value="">– kein Kontakt –</option>
                  {kontakte.map(k => (
                    <option key={k.id} value={k.id}>
                      {[k.nachname, k.vorname].filter(Boolean).join(', ')}
                    </option>
                  ))}
                </select>
              ) : (
                <select
                  name="firma_id"
                  defaultValue={editRow?.firma?.id ?? ''}
                  className="form-input"
                >
                  <option value="">– keine Firma –</option>
                  {firmen.map(f => (
                    <option key={f.id} value={f.id}>{f.firmenname}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Notizen */}
            <div>
              <label className="form-label">Notizen</label>
              <textarea
                name="notizen"
                rows={3}
                defaultValue={editRow?.notizen ?? ''}
                className="form-input resize-none"
                placeholder="Besonderheiten, Vereinbarungen …"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={isPending}
                className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50"
              >
                {isPending ? 'Wird gespeichert …' : 'Speichern'}
              </button>
              <button
                type="button"
                onClick={() => { setShowForm(false); setEditRow(null) }}
                className="text-sm text-s112-muted hover:text-gray-700 transition-colors"
              >
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Tabelle */}
      {verkaufe.length === 0 ? (
        <div className="card p-10 text-center text-s112-muted text-sm">
          <p className="text-2xl mb-2">🍇</p>
          <p className="font-medium">Noch keine Traubenverkäufe erfasst</p>
          {writeOk && (
            <button
              onClick={openNew}
              className="mt-4 text-s112-teal hover:underline text-sm font-medium"
            >
              Ersten Traubenverkauf anlegen →
            </button>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Lief.-Nr.</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Datum</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Weingarten</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Käufer</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">kg</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">€/kg</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">Gesamt</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">KMW°</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Jg.</th>
                {writeOk && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border">
              {verkaufe.map(v => {
                const gesamt = v.preis_per_kg != null
                  ? Number(v.menge_kg) * Number(v.preis_per_kg)
                  : null
                return (
                  <tr key={v.id} className="hover:bg-s112-bg/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap font-mono text-xs text-s112-muted">
                      {v.liefernummer ?? '–'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {new Date(v.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-medium">{v.weingarten?.name ?? '–'}</span>
                      {v.weingarten?.rebsorte && (
                        <span className="text-xs text-s112-muted ml-1">({v.weingarten.rebsorte})</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{kaeuferName(v)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(Number(v.menge_kg), 0)}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(v.preis_per_kg, 4)}</td>
                    <td className="px-4 py-3 text-right font-mono">{gesamt != null ? fmtEur(gesamt) : '–'}</td>
                    <td className="px-4 py-3 text-right font-mono">{fmt(v.kmw_grad, 1)}</td>
                    <td className="px-4 py-3">{v.jahrgang?.jahrgang ?? '–'}</td>
                    {writeOk && (
                      <td className="px-4 py-3 text-right">
                        {deleteConfirm === v.id ? (
                          <span className="flex items-center justify-end gap-2 text-xs">
                            <span className="text-red-600">Wirklich löschen?</span>
                            <button
                              onClick={() => handleDelete(v.id)}
                              disabled={isPending}
                              className="text-red-600 font-semibold hover:text-red-800"
                            >
                              Ja
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(null)}
                              className="text-s112-muted hover:text-gray-700"
                            >
                              Nein
                            </button>
                          </span>
                        ) : (
                          <span className="flex items-center justify-end gap-3">
                            <button
                              onClick={() => openEdit(v)}
                              className="text-xs text-s112-teal hover:underline"
                            >
                              Bearbeiten
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(v.id)}
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              Löschen
                            </button>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
            {/* Summenzeile */}
            <tfoot>
              <tr className="border-t-2 border-s112-border bg-s112-bg font-semibold">
                <td colSpan={3} className="px-4 py-3 text-xs text-gray-500">Gesamt</td>
                <td className="px-4 py-3 text-right font-mono text-sm">
                  {sumKg.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: 0 })} kg
                </td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right font-mono text-sm">
                  {hatPreis ? fmtEur(sumEur) : '–'}
                </td>
                <td colSpan={writeOk ? 3 : 2} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  )
}
