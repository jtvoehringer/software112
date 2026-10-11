'use client'

import { useState, useTransition } from 'react'
import { upsertLagerBewegung, bucheLagerEinkauf, stornoLagerBewegung, loescheLagerBewegung } from './actions'
import StornoButton from '@/components/StornoButton'
import { VerbrauchTr, zeilenChronologisch } from './Verbrauchszeilen'
import type { PSMLager, PSMOption } from './page'
import LagerHinweise from './LagerHinweise'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import AnfangsbestandHinweis from './AnfangsbestandHinweis'
import { heuteWien } from '@/lib/datum/wien'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'
import EinkaufAusgabeFelder, { TYP_EINKAUF_EA, type EinkaufCtx } from './EinkaufAusgabeFelder'

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
  allePsm, defaultPsmId, defaultEinheit, onDone, einkauf, edit,
}: {
  allePsm: PSMOption[]
  defaultPsmId?: string
  /** Lager-Einheit des Mittels als Vorgabe für neue Buchungen */
  defaultEinheit?: string
  onDone: () => void
  /** KAN-326: Einkauf mit E/A-Ausgabe (Kategorien, Lieferanten, Sperrgrund) */
  einkauf?: EinkaufCtx
  edit?: PSMLager['bewegungen'][0] & { psm_id: string }
}) {
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  // KAN-326: mit E&A ist der Einkauf mit Ausgabe die Vorgabe (wie bei den Betriebsmitteln)
  const [typ, setTyp] = useState<string>(edit?.typ ?? (einkauf && !einkauf.einkaufSperre ? TYP_EINKAUF_EA : 'einkauf'))
  const mitAusgabe = typ === TYP_EINKAUF_EA
  const isKorrektur = typ === 'korrektur'
  const [datum, setDatum] = useState<string>(edit?.datum ?? heuteWien())
  const [richtung, setRichtung] = useState<'eingang' | 'ausgang'>(
    edit ? (edit.menge < 0 ? 'ausgang' : 'eingang') : 'eingang'
  )

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('richtung', richtung)
    startTransition(async () => {
      try {
        if (mitAusgabe) { fd.set('art', 'psm'); await bucheLagerEinkauf(fd) }
        else await upsertLagerBewegung(fd)
        setFehler(null); onDone()
      }
      catch (e) { setFehler(fehlerText(e)) }
    })
  }

  return (
    <form data-ungespeichert onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      {fehler && <div className="p-2.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">{fehler}</div>}
      <h3 className="text-sm font-semibold text-s112-text">
        {edit ? 'Buchung bearbeiten' : 'Neue Buchung'}
      </h3>
      {edit && <input type="hidden" name="existing_id" value={edit.id} />}

      <div className="grid grid-cols-2 gap-3">
        {/* PSM */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Mittel *</label>
          <select aria-label="Mittel" name="psm_id" required defaultValue={edit?.psm_id ?? defaultPsmId ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {allePsm.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {/* Typ */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Typ *</label>
          <select aria-label="Typ" name="typ" required value={typ} onChange={e => setTyp(e.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
            {einkauf && <option value={TYP_EINKAUF_EA} disabled={!!einkauf.einkaufSperre}>Einkauf (mit E/A-Ausgabe)</option>}
            <option value="anfangsbestand">Anfangsbestand</option>
            <option value="einkauf">{einkauf ? 'Einkauf / Zugang (ohne Ausgabe)' : 'Einkauf / Zugang'}</option>
            <option value="korrektur">Inventurkorrektur</option>
          </select>
        </div>

        {/* Datum */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <ZukunftsDatum aria-label="Datum" name="datum" required
            value={datum} onChange={e => setDatum(e.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <AnfangsbestandHinweis typ={typ} datum={datum} />

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
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        {/* Einheit */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Einheit</label>
          <select aria-label="Einheit" name="einheit" defaultValue={edit?.einheit ?? defaultEinheit ?? 'kg'}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
            <option value="kg">kg</option>
            <option value="l">l</option>
            <option value="g">g</option>
            <option value="ml">ml</option>
          </select>
        </div>

        {mitAusgabe && einkauf && <EinkaufAusgabeFelder ctx={einkauf} />}

        {/* Notizen */}
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={edit?.notizen ?? ''}
            placeholder="z.B. Lieferant, Rechnung, Grund der Korrektur…"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>
      {einkauf?.einkaufSperre && !edit && <p className="text-xs text-s112-muted">Einkauf mit E/A-Ausgabe nicht möglich: {einkauf.einkaufSperre}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50">
          {pending ? 'Speichert…' : mitAusgabe ? 'Einkauf buchen' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── PSM-Karte ─────────────────────────────────────────────────────────────────
function PsmKarte({
  psm, allePsm, writeOk, adminOk, einkauf,
}: {
  psm: PSMLager; allePsm: PSMOption[]; writeOk: boolean; adminOk: boolean; einkauf?: EinkaufCtx
}) {
  const [showForm, setShowForm] = useState(false)
  const [pending] = useTransition()

  // Alle Mengen in der Lager-Einheit; Verbrauch = Σ Mittelmenge der Spritzungen (lib/behandlungen/lagerVerbrauch.ts)
  const { einheit, zugang, abgang, verbrauch, posten, bestand, hinweise } = psm.konto

  const bestandColor = bestand < 0 ? 'text-s112-err-fg' : bestand < 1 ? 'text-s112-warn-fg' : 'text-s112-blue-700'


  return (
    <div className={`card ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-s112-text">{psm.psm_name}</h3>
          {psm.kategorie && (
            <span className="text-xs text-s112-muted capitalize">{psm.kategorie}</span>
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
            –{fmtNum(verbrauch, { max: 3 })} {einheit}
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

      {/* Nicht abgezogene Maßnahmen (ohne Aufwand, l-Mittel bei Lager in kg …) */}
      <LagerHinweise hinweise={hinweise} writeOk={writeOk} />

      {/* Buchungsformular */}
      {showForm && (
        <div className="mb-4">
          <BuchungsForm
            allePsm={allePsm}
            defaultPsmId={psm.psm_id}
            defaultEinheit={einheit}
            einkauf={einkauf}
            onDone={() => setShowForm(false)}
          />
        </div>
      )}

      {/* Bewegungshistorie */}
      {(psm.bewegungen.length > 0 || posten.length > 0) && (
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
              {/* chronologisch: Buchungen und Verbrauch je Maßnahme (Rückmeldung 30.09.2026) */}
              {zeilenChronologisch(psm.bewegungen, posten).map(z => z.verbrauch ? (
                <VerbrauchTr key={`v-${z.verbrauch.behandlungId}`} v={z.verbrauch} einheit={einheit} mitAktionen={writeOk || adminOk} />
              ) : ((b: (typeof psm.bewegungen)[number]) => (
                <tr key={b.id} className={`group border-b border-s112-border/40 last:border-0 ${b.storniert_am ? 'opacity-70' : 'hover:bg-s112-bg/30'}`}>
                  <td className="px-3 py-2 tabular-nums text-s112-muted">{fmtDate(b.datum)}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TYP_COLOR[b.typ] ?? ''}`}>
                      {TYP_LABEL[b.typ] ?? b.typ}
                    </span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${b.storniert_am ? 'line-through text-s112-muted' : b.menge < 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                    {fmtMenge(b.menge, b.einheit)}
                  </td>
                  <td className="px-3 py-2 text-xs text-s112-muted">
                    {b.notizen ?? '–'}
                    {/* KAN-326: Einkauf mit E/A-Ausgabe (Storno storniert die Ausgabe mit) */}
                    {b.mit_ausgabe && <p className="text-[11px] text-s112-ok-fg">mit Ausgabe{b.betrag_netto != null ? ` · € ${fmtNum(b.betrag_netto, 2)} netto` : ''}</p>}
                    {/* KAN-88: stornierte Buchung bleibt gekennzeichnet stehen, zählt nicht zum Bestand */}
                    {b.storniert_am && (
                      <p className="text-[11px] text-s112-warn-fg">storniert am {new Date(b.storniert_am).toLocaleDateString('de-AT')}{b.storniert_von_name ? ` von ${b.storniert_von_name}` : ''}{b.storno_grund ? ` – ${b.storno_grund}` : ''}</p>
                    )}
                  </td>
                  {(writeOk || adminOk) && (
                    <td className="px-3 py-2 text-right sticky right-0 bg-white">
                      <div className="flex items-center justify-end gap-2">
                        {writeOk && (b.storniert_am ? (
                          // KAN-88: endgültig löschen nur stornierte Buchungen (Grund im Änderungsprotokoll)
                          <StornoButton modus="loeschen" label="Endgültig löschen" action={grund => loescheLagerBewegung(b.id, grund)}
                            hinweis="Nur bei Fehlbuchungen: Die stornierte Buchung wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll." />
                        ) : (
                          // KAN-88: stornieren statt löschen – auch Mitarbeiter mit Schreibrecht Rieden
                          <StornoButton action={grund => stornoLagerBewegung(b.id, grund)}
                            hinweis="Die Buchung bleibt als storniert stehen und zählt nicht mehr zum Bestand. Korrektur: neu buchen bzw. Inventurkorrektur." />
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))(z.buchung as (typeof psm.bewegungen)[number]))}
            </tbody>
          </table>
        </div>
      )}

      {/* + Buchung Button */}
      {writeOk && !showForm && (
        <button onClick={() => setShowForm(true)}
          className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-blue-700 font-medium px-3 py-1.5 rounded-lg transition-colors">
          Buchung erfassen
        </button>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function LagerClient({
  psms, allePsm, writeOk, adminOk, einkauf,
}: {
  psms: PSMLager[]; allePsm: PSMOption[]; writeOk: boolean; adminOk: boolean
  /** KAN-326: Einkauf mit E/A-Ausgabe */
  einkauf?: EinkaufCtx
}) {
  const [showNeuForm, setShowNeuForm] = useState(false)

  return (
    <div>
      {/* Neues PSM einbuchen */}
      <div className="mb-6">
        {showNeuForm ? (
          <BuchungsForm allePsm={allePsm} einkauf={einkauf} onDone={() => setShowNeuForm(false)} />
        ) : (
          writeOk && (
            <button onClick={() => setShowNeuForm(true)}
              className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
              Neues Mittel anlegen
            </button>
          )
        )}
      </div>

      {psms.length === 0 ? (
        <div className="card text-center py-16 text-s112-muted">
          <p className="font-medium text-s112-text-2">Noch keine Lagerbewegungen</p>
          <p className="text-sm mt-1 max-w-sm mx-auto">
            Erfasse den Anfangsbestand oder einen Einkauf für ein Pflanzenschutzmittel.
            Der Verbrauch wird automatisch aus den Spritzungen berechnet (Aufwand × Fläche).
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
              einkauf={einkauf}
            />
          ))}
        </div>
      )}
    </div>
  )
}
