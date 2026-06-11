'use client'

import { useState, useTransition } from 'react'
import { upsertLagerBewegung, deleteLagerBewegung } from './actions'
import type { PSMLager, PSMOption } from './page'

const TYP_LABEL: Record<string, string> = {
  anfangsbestand: 'Anfangsbestand',
  einkauf:        'Einkauf',
  korrektur:      'Korrektur',
}
const TYP_COLOR: Record<string, string> = {
  anfangsbestand: 'bg-blue-50 text-blue-700 border-blue-200',
  einkauf:        'bg-green-50 text-green-700 border-green-200',
  korrektur:      'bg-amber-50 text-amber-700 border-amber-200',
}

function fmtDate(d: string) {
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}
function fmtMenge(m: number, einheit: string | null) {
  const abs = Math.abs(m).toLocaleString('de-AT', { maximumFractionDigits: 3 })
  return `${m < 0 ? '–' : '+'}${abs} ${einheit ?? ''}`
}

// ── Buchungsformular ──────────────────────────────────────────────────────────
function BuchungsForm({
  allePsm, defaultPsmId, onDone, edit,
}: {
  allePsm: PSMOption[]
  defaultPsmId?: string
  onDone: () => void
  edit?: PSMLager['bewegungen'][0] & { psm_id: string }
}) {
  const [pending, startTransition] = useTransition()
  const [typ, setTyp] = useState<string>(edit?.typ ?? 'einkauf')
  const isKorrektur = typ === 'korrektur'
  const [richtung, setRichtung] = useState<'eingang' | 'ausgang'>(
    edit ? (edit.menge < 0 ? 'ausgang' : 'eingang') : 'eingang'
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('richtung', richtung)
    startTransition(async () => {
      await upsertLagerBewegung(fd)
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">
        {edit ? 'Buchung bearbeiten' : 'Neue Buchung'}
      </h3>
      {edit && <input type="hidden" name="existing_id" value={edit.id} />}

      <div className="grid grid-cols-2 gap-3">
        {/* PSM */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Mittel *</label>
          <select name="psm_id" required defaultValue={edit?.psm_id ?? defaultPsmId ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {allePsm.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Typ */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Typ *</label>
          <select name="typ" required value={typ} onChange={e => setTyp(e.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="anfangsbestand">Anfangsbestand</option>
            <option value="einkauf">Einkauf / Zugang</option>
            <option value="korrektur">Inventurkorrektur</option>
          </select>
        </div>

        {/* Datum */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
          <input name="datum" type="date" required
            defaultValue={edit?.datum ?? new Date().toISOString().split('T')[0]}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Richtung (nur bei Korrektur) */}
        {isKorrektur && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Richtung</label>
            <div className="flex gap-3">
              {(['eingang', 'ausgang'] as const).map(r => (
                <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" value={r} checked={richtung === r}
                    onChange={() => setRichtung(r)}
                    className="accent-s112-teal" />
                  <span className="text-sm">{r === 'eingang' ? '↑ Aufbuchen' : '↓ Abbuchen'}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Menge */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Menge *</label>
          <input name="menge" type="number" step="0.001" min="0" required
            defaultValue={edit ? Math.abs(edit.menge) : ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Einheit */}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Einheit</label>
          <select name="einheit" defaultValue={edit?.einheit ?? 'kg'}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="kg">kg</option>
            <option value="l">l</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
          </select>
        </div>

        {/* Notizen */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <input name="notizen" defaultValue={edit?.notizen ?? ''}
            placeholder="z.B. Lieferant, Rechnung, Grund der Korrektur…"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
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

// ── PSM-Karte ─────────────────────────────────────────────────────────────────
function PsmKarte({
  psm, allePsm, writeOk, adminOk,
}: {
  psm: PSMLager; allePsm: PSMOption[]; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editBew, setEditBew] = useState<(PSMLager['bewegungen'][0] & { psm_id: string }) | null>(null)
  const [pending, startTransition] = useTransition()

  const zugang  = psm.bewegungen.filter(b => b.menge > 0).reduce((s, b) => s + b.menge, 0)
  const abgang  = psm.bewegungen.filter(b => b.menge < 0).reduce((s, b) => s + Math.abs(b.menge), 0)
  const bestand = zugang - abgang - psm.verbrauch_gesamt
  const einheit = psm.bewegungen[0]?.einheit ?? psm.einheit_behandlung ?? 'kg'

  const bestandColor = bestand < 0 ? 'text-red-600' : bestand < 1 ? 'text-amber-500' : 'text-s112-teal'

  function handleDelete(id: string) {
    if (!confirm('Buchung löschen?')) return
    startTransition(() => deleteLagerBewegung(id))
  }

  return (
    <div className={`card ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-gray-900">{psm.psm_name}</h3>
          {psm.kategorie && (
            <span className="text-xs text-s112-muted capitalize">{psm.kategorie}</span>
          )}
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold tabular-nums ${bestandColor}`}>
            {bestand.toLocaleString('de-AT', { maximumFractionDigits: 3 })} {einheit}
          </p>
          <p className="text-xs text-s112-muted">Aktueller Bestand</p>
        </div>
      </div>

      {/* Saldo-Übersicht */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div className="bg-green-50 rounded-lg p-2">
          <p className="text-sm font-semibold text-green-700 tabular-nums">
            +{zugang.toLocaleString('de-AT', { maximumFractionDigits: 3 })} {einheit}
          </p>
          <p className="text-xs text-green-600">Zugänge</p>
        </div>
        <div className="bg-blue-50 rounded-lg p-2">
          <p className="text-sm font-semibold text-blue-700 tabular-nums">
            –{psm.verbrauch_gesamt.toLocaleString('de-AT', { maximumFractionDigits: 3 })} {psm.einheit_behandlung ?? einheit}
          </p>
          <p className="text-xs text-blue-600">Verbrauch (Behandlungen)</p>
        </div>
        <div className="bg-amber-50 rounded-lg p-2">
          <p className="text-sm font-semibold text-amber-700 tabular-nums">
            {abgang > 0 ? `–${abgang.toLocaleString('de-AT', { maximumFractionDigits: 3 })}` : '–'} {abgang > 0 ? einheit : ''}
          </p>
          <p className="text-xs text-amber-600">Korrekturen</p>
        </div>
      </div>

      {/* Buchungsformular */}
      {(showForm || editBew) && (
        <div className="mb-4">
          <BuchungsForm
            allePsm={allePsm}
            defaultPsmId={psm.psm_id}
            edit={editBew ?? undefined}
            onDone={() => { setShowForm(false); setEditBew(null) }}
          />
        </div>
      )}

      {/* Bewegungshistorie */}
      {psm.bewegungen.length > 0 && (
        <div className="border border-s112-border rounded-xl overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="text-left px-3 py-2 font-semibold">Datum</th>
                <th className="text-left px-3 py-2 font-semibold">Typ</th>
                <th className="text-right px-3 py-2 font-semibold">Menge</th>
                <th className="text-left px-3 py-2 font-semibold">Notizen</th>
                {(writeOk || adminOk) && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {psm.bewegungen.map(b => (
                <tr key={b.id} className="border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30">
                  <td className="px-3 py-2 tabular-nums text-s112-muted">{fmtDate(b.datum)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TYP_COLOR[b.typ] ?? ''}`}>
                      {TYP_LABEL[b.typ] ?? b.typ}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${b.menge < 0 ? 'text-red-600' : 'text-green-700'}`}>
                    {fmtMenge(b.menge, b.einheit)}
                  </td>
                  <td className="px-3 py-2 text-xs text-s112-muted">{b.notizen ?? '–'}</td>
                  {(writeOk || adminOk) && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {writeOk && (
                          <button onClick={() => setEditBew({ ...b, psm_id: psm.psm_id })}
                            className="text-xs text-s112-teal hover:underline">Bearb.</button>
                        )}
                        {adminOk && (
                          <button onClick={() => handleDelete(b.id)}
                            className="text-xs text-red-400 hover:text-red-600">Löschen</button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {/* Verbrauch-Zeile (read-only, aus Behandlungen) */}
              {psm.verbrauch_gesamt > 0 && (
                <tr className="border-b border-s112-border/40 last:border-0 bg-blue-50/30">
                  <td className="px-3 py-2 tabular-nums text-s112-muted text-xs">aus Behandlungen</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-blue-50 text-blue-700 border-blue-200 font-medium">
                      Verbrauch (berechnet)
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-600">
                    –{psm.verbrauch_gesamt.toLocaleString('de-AT', { maximumFractionDigits: 3 })} {psm.einheit_behandlung ?? ''}
                  </td>
                  <td className="px-3 py-2 text-xs text-s112-muted italic">automatisch aus Spritzungen</td>
                  {(writeOk || adminOk) && <td />}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* + Buchung Button */}
      {writeOk && !showForm && !editBew && (
        <button onClick={() => setShowForm(true)}
          className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-teal font-medium px-3 py-1.5 rounded-lg transition-colors">
          ＋ Buchung erfassen
        </button>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function LagerClient({
  psms, allePsm, writeOk, adminOk,
}: {
  psms: PSMLager[]; allePsm: PSMOption[]; writeOk: boolean; adminOk: boolean
}) {
  const [showNeuForm, setShowNeuForm] = useState(false)

  return (
    <div>
      {/* Neues PSM einbuchen */}
      <div className="mb-6">
        {showNeuForm ? (
          <BuchungsForm allePsm={allePsm} onDone={() => setShowNeuForm(false)} />
        ) : (
          writeOk && (
            <button onClick={() => setShowNeuForm(true)}
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              <span>＋</span> Neues Mittel einbuchen
            </button>
          )
        )}
      </div>

      {psms.length === 0 ? (
        <div className="card text-center py-16 text-s112-muted">
          <p className="text-3xl mb-3">📦</p>
          <p className="font-medium text-gray-600">Noch keine Lagerbewegungen</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Erfasse den Anfangsbestand oder einen Einkauf für ein Pflanzenschutzmittel.
            Der Verbrauch wird automatisch aus den Behandlungen berechnet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {psms.map(p => (
            <PsmKarte
              key={p.psm_id}
              psm={p}
              allePsm={allePsm}
              writeOk={writeOk}
              adminOk={adminOk}
            />
          ))}
        </div>
      )}
    </div>
  )
}
