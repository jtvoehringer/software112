'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { upsertDuengerBewegung, deleteDuengerBewegung } from './actions'
import type { DuengerLager, DuengerOption } from './page'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'

// Analog LagerClient.tsx (PSM) – volle Lagerbewegungs-Erfassung für Düngemittel
// (Migration 142): Anfangsbestand, Einkauf, Inventurkorrektur, berechneter
// Bestand = Zugänge - Korrektur-Abgänge - Verbrauch (aus Behandlungen).

const TYP_LABEL: Record<string, string> = {
  anfangsbestand: 'Anfangsbestand',
  einkauf:        'Einkauf',
  korrektur:      'Korrektur',
}
const TYP_COLOR: Record<string, string> = {
  anfangsbestand: 'bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100',
  einkauf:        'bg-s112-ok-bg text-s112-ok-fg border-s112-ok/30',
  korrektur:      'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
}

function fmtDate(d: string) {
  const [y, m, dd] = d.split('-')
  return `${dd}.${m}.${y}`
}
function fmtMenge(m: number, einheit: string | null) {
  const abs = fmtNum(Math.abs(m), { max: 3 })
  return `${m < 0 ? '–' : '+'}${abs} ${einheit ?? ''}`
}

// ── Buchungsformular ──────────────────────────────────────────────────────────
function BuchungsForm({
  alleDuenger, defaultDuengerId, onDone, edit,
}: {
  alleDuenger: DuengerOption[]
  defaultDuengerId?: string
  onDone: () => void
  edit?: DuengerLager['bewegungen'][0] & { duengemittel_id: string }
}) {
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
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
      try { await upsertDuengerBewegung(fd); setFehler(null); onDone() }
      catch (e) { setFehler(fehlerText(e)) }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      {fehler && <div className="p-2.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">{fehler}</div>}
      <h3 className="text-sm font-semibold text-s112-text">
        {edit ? 'Buchung bearbeiten' : 'Neue Buchung'}
      </h3>
      {edit && <input type="hidden" name="existing_id" value={edit.id} />}

      <div className="grid grid-cols-2 gap-3">
        {/* Düngemittel */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Mittel *</label>
          <select aria-label="Mittel" name="duengemittel_id" required defaultValue={edit?.duengemittel_id ?? defaultDuengerId ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {alleDuenger.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        {/* Typ */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Typ *</label>
          <select aria-label="Typ" name="typ" required value={typ} onChange={e => setTyp(e.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="anfangsbestand">Anfangsbestand</option>
            <option value="einkauf">Einkauf / Zugang</option>
            <option value="korrektur">Inventurkorrektur</option>
          </select>
        </div>

        {/* Datum */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input aria-label="Datum" name="datum" type="date" required
            defaultValue={edit?.datum ?? new Date().toISOString().split('T')[0]}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Richtung (nur bei Korrektur) */}
        {isKorrektur && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Richtung</label>
            <div className="flex gap-3">
              {(['eingang', 'ausgang'] as const).map(r => (
                <label key={r} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" value={r} checked={richtung === r}
                    onChange={() => setRichtung(r)}
                    className="accent-s112-teal" />
                  <span className="text-sm">{r === 'eingang' ? 'Aufbuchen' : 'Abbuchen'}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Menge */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge *</label>
          <input aria-label="Menge" name="menge" type="number" step="0.001" min="0" required
            defaultValue={edit ? Math.abs(edit.menge) : ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Einheit */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Einheit</label>
          <select aria-label="Einheit" name="einheit" defaultValue={edit?.einheit ?? 'kg'}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="kg">kg</option>
            <option value="l">l</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
          </select>
        </div>

        {/* Notizen */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={edit?.notizen ?? ''}
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
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Düngemittel-Karte ─────────────────────────────────────────────────────────
function DuengerKarte({
  duenger, alleDuenger, writeOk, adminOk,
}: {
  duenger: DuengerLager; alleDuenger: DuengerOption[]; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editBew, setEditBew] = useState<(DuengerLager['bewegungen'][0] & { duengemittel_id: string }) | null>(null)
  const [pending, startTransition] = useTransition()

  const zugang  = duenger.bewegungen.filter(b => b.menge > 0).reduce((s, b) => s + b.menge, 0)
  const abgang  = duenger.bewegungen.filter(b => b.menge < 0).reduce((s, b) => s + Math.abs(b.menge), 0)
  const bestand = zugang - abgang - duenger.verbrauch_gesamt
  const einheit = duenger.bewegungen[0]?.einheit ?? duenger.einheit_behandlung ?? 'kg'

  const bestandColor = bestand < 0 ? 'text-s112-err-fg' : bestand < 1 ? 'text-s112-warn-fg' : 'text-s112-blue-700'

  function handleDelete(id: string) {
    if (!confirm('Buchung löschen?')) return
    startTransition(() => deleteDuengerBewegung(id))
  }

  return (
    <div className={`card ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-s112-text">{duenger.duengemittel_name}</h3>
          {duenger.typ && (
            <span className="text-xs text-s112-muted capitalize">{duenger.typ}</span>
          )}
        </div>
        <div className="text-right">
          <p className={`text-2xl font-semibold tabular-nums ${bestandColor}`}>
            {fmtNum(bestand, { max: 3 })} {einheit}
          </p>
          <p className="text-xs text-s112-muted">Aktueller Bestand</p>
        </div>
      </div>

      {/* Saldo-Übersicht */}
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div className="bg-s112-ok-bg rounded-lg p-2">
          <p className="text-sm font-semibold text-s112-ok-fg tabular-nums">
            +{fmtNum(zugang, { max: 3 })} {einheit}
          </p>
          <p className="text-xs text-s112-ok-fg">Zugänge</p>
        </div>
        <div className="bg-s112-blue-50 rounded-lg p-2">
          <p className="text-sm font-semibold text-s112-blue-700 tabular-nums">
            –{fmtNum(duenger.verbrauch_gesamt, { max: 3 })} {duenger.einheit_behandlung ?? einheit}
          </p>
          <p className="text-xs text-s112-blue-700">Verbrauch (Maßnahmen)</p>
        </div>
        <div className="bg-s112-warn-bg rounded-lg p-2">
          <p className="text-sm font-semibold text-s112-warn-fg tabular-nums">
            {abgang > 0 ? `–${fmtNum(abgang, { max: 3 })}` : '–'} {abgang > 0 ? einheit : ''}
          </p>
          <p className="text-xs text-s112-warn-fg">Korrekturen</p>
        </div>
      </div>

      {/* Buchungsformular */}
      {(showForm || editBew) && (
        <div className="mb-4">
          <BuchungsForm
            alleDuenger={alleDuenger}
            defaultDuengerId={duenger.duengemittel_id}
            edit={editBew ?? undefined}
            onDone={() => { setShowForm(false); setEditBew(null) }}
          />
        </div>
      )}

      {/* Bewegungshistorie */}
      {duenger.bewegungen.length > 0 && (
        <div className="border border-s112-border rounded-xl overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-s112-text-2">
                <th className="text-left px-3 py-2 font-semibold">Datum</th>
                <th className="text-left px-3 py-2 font-semibold">Typ</th>
                <th className="text-right px-3 py-2 font-semibold">Menge</th>
                <th className="text-left px-3 py-2 font-semibold">Notizen</th>
                {(writeOk || adminOk) && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {duenger.bewegungen.map(b => (
                <tr key={b.id} className="group border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30">
                  <td className="px-3 py-2 tabular-nums text-s112-muted">{fmtDate(b.datum)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TYP_COLOR[b.typ] ?? ''}`}>
                      {TYP_LABEL[b.typ] ?? b.typ}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${b.menge < 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                    {fmtMenge(b.menge, b.einheit)}
                  </td>
                  <td className="px-3 py-2 text-xs text-s112-muted">{b.notizen ?? '–'}</td>
                  {(writeOk || adminOk) && (
                    <td className="px-3 py-2 text-right sticky right-0 bg-white">
                      <div className="flex items-center justify-end gap-2">
                        {writeOk && (
                          <button onClick={() => setEditBew({ ...b, duengemittel_id: duenger.duengemittel_id })}
                            title="Bearbeiten" aria-label="Bearbeiten"
                            className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil className="w-4 h-4" /></button>
                        )}
                        {adminOk && (
                          <button onClick={() => handleDelete(b.id)}
                            title="Löschen" aria-label="Löschen"
                            className="text-s112-err hover:text-s112-err-fg"><Trash2 className="w-4 h-4" /></button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {/* Verbrauch-Zeile (read-only, aus Behandlungen) */}
              {duenger.verbrauch_gesamt > 0 && (
                <tr className="border-b border-s112-border/40 last:border-0 bg-s112-blue-50/30">
                  <td className="px-3 py-2 tabular-nums text-s112-muted text-xs">aus Maßnahmen</td>
                  <td className="px-3 py-2">
                    <span className="text-xs px-2 py-0.5 rounded-full border bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100 font-medium">
                      Verbrauch (berechnet)
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-s112-blue-700">
                    –{fmtNum(duenger.verbrauch_gesamt, { max: 3 })} {duenger.einheit_behandlung ?? ''}
                  </td>
                  <td className="px-3 py-2 text-xs text-s112-muted italic">automatisch aus Düngungen</td>
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
          className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-blue-700 font-medium px-3 py-1.5 rounded-lg transition-colors">
          Buchung erfassen
        </button>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function DuengerLagerClient({
  duenger, alleDuenger, writeOk, adminOk,
}: {
  duenger: DuengerLager[]; alleDuenger: DuengerOption[]; writeOk: boolean; adminOk: boolean
}) {
  const [showNeuForm, setShowNeuForm] = useState(false)

  return (
    <div>
      {/* Neues Düngemittel einbuchen */}
      <div className="mb-6">
        {showNeuForm ? (
          <BuchungsForm alleDuenger={alleDuenger} onDone={() => setShowNeuForm(false)} />
        ) : (
          writeOk && (
            <button onClick={() => setShowNeuForm(true)}
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Neues Mittel anlegen
            </button>
          )
        )}
      </div>

      {duenger.length === 0 ? (
        <div className="card text-center py-16 text-s112-muted">
          <p className="font-medium text-s112-text-2">Noch keine Lagerbewegungen</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Erfasse den Anfangsbestand oder einen Einkauf für ein Düngemittel.
            Der Verbrauch wird automatisch aus den Maßnahmen berechnet.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {duenger.map(d => (
            <DuengerKarte
              key={d.duengemittel_id}
              duenger={d}
              alleDuenger={alleDuenger}
              writeOk={writeOk}
              adminOk={adminOk}
            />
          ))}
        </div>
      )}
    </div>
  )
}
