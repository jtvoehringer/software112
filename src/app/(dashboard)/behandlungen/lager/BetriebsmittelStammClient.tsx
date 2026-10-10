'use client'

// KAN-167 (01.10.2026): Stammdaten „Weinbehandlungsmittel“ bzw. „Produktionsmittel“ – anlegen, bearbeiten,
// deaktivieren (Betriebsleitung). Löschen nur ohne Bezug (DB-Sperre); mit Lagerbuchung oder Maßnahme deaktivieren.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, PowerOff, RotateCcw } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { BM_EINHEITEN, BM_EINHEIT_LABEL, GRUPPE_BEISPIELE, GRUPPE_LABEL, type BetriebsmittelGruppe } from '@/lib/behandlungen/betriebsmittel'
import { speichereBetriebsmittel, setzeBetriebsmittelAktiv } from './betriebsmittelActions'
import { LagerJahrKopf, LagerJahrZellen, LagerJahrHinweis, type StammLager } from './LagerJahrSpalten'
import { ZAHL_LOCALE } from '@/lib/format'

export type BmStamm = {
  id: string; name: string; einheit: string; preis_pro_einheit: number | null
  ea_kategorie_id: string | null; notizen: string | null; aktiv: boolean
  /** KAN-173: Lagerbewegung im laufenden Geschäftsjahr */
  lager?: StammLager | null
}

const feld = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
const lbl = 'block text-xs font-medium text-s112-text-2 mb-1'

function Formular({ gruppe, edit, kategorien, onDone }: { gruppe: BetriebsmittelGruppe; edit?: BmStamm; kategorien: { id: string; name: string }[]; onDone: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  return (
    <form className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3"
      onSubmit={e => {
        e.preventDefault()
        const fd = new FormData(e.currentTarget)
        start(async () => {
          try { await speichereBetriebsmittel(fd); setFehler(null); onDone(); router.refresh() }
          catch (err) { setFehler(fehlerText(err)) }
        })
      }}>
      {fehler && <div role="alert" className="p-2.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">{fehler}</div>}
      <h3 className="text-sm font-semibold text-s112-text">{edit ? `${GRUPPE_LABEL[gruppe]} bearbeiten` : `Neues ${GRUPPE_LABEL[gruppe]}`}</h3>
      <input type="hidden" name="gruppe" value={gruppe} />
      {edit && <input type="hidden" name="existing_id" value={edit.id} />}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={lbl}>Bezeichnung *</label>
          <input aria-label="Bezeichnung" name="name" required defaultValue={edit?.name ?? ''} placeholder={GRUPPE_BEISPIELE[gruppe]} className={feld} />
        </div>
        <div>
          <label className={lbl}>Einheit *</label>
          <select aria-label="Einheit" name="einheit" defaultValue={edit?.einheit ?? 'stk'} className={feld}>
            {BM_EINHEITEN.map(e => <option key={e} value={e}>{BM_EINHEIT_LABEL[e]}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Einkaufspreis je Einheit (€)</label>
          <input aria-label="Einkaufspreis je Einheit" name="preis_pro_einheit" type="text" inputMode="decimal"
            defaultValue={edit?.preis_pro_einheit != null ? String(edit.preis_pro_einheit).replace('.', ',') : ''} className={feld} />
        </div>
        <div className="col-span-2">
          <label className={lbl}>E/A-Kategorie für Einkäufe (Vorbelegung)</label>
          <select aria-label="E/A-Kategorie" name="ea_kategorie_id" defaultValue={edit?.ea_kategorie_id ?? ''} className={feld}>
            <option value="">– keine Vorbelegung –</option>
            {kategorien.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </div>
        <div className="col-span-2">
          <label className={lbl}>Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={edit?.notizen ?? ''} className={feld} />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone} className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">Abbrechen</button>
      </div>
    </form>
  )
}

export default function BetriebsmittelStammClient({ gruppe, mittel, jahr, kategorien, writeOk, adminOk }: {
  gruppe: BetriebsmittelGruppe; mittel: BmStamm[]; jahr: number; kategorien: { id: string; name: string }[]; writeOk: boolean; adminOk: boolean
}) {
  const router = useRouter()
  const [neu, setNeu] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [inaktive, setInaktive] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const katName = new Map(kategorien.map(k => [k.id, k.name]))
  const sichtbar = mittel.filter(m => inaktive || m.aktiv)
  const anzahlInaktiv = mittel.filter(m => !m.aktiv).length

  function aktiv(id: string, wert: boolean) {
    start(async () => {
      try { await setzeBetriebsmittelAktiv(id, wert); setFehler(null); router.refresh() }
      catch (err) { setFehler(fehlerText(err)) }
    })
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        {writeOk && !neu ? (
          <button onClick={() => setNeu(true)} className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
            Neu anlegen
          </button>
        ) : <span />}
        {anzahlInaktiv > 0 && (
          <label className="flex items-center gap-2 text-xs text-s112-muted cursor-pointer">
            <input type="checkbox" checked={inaktive} onChange={e => setInaktive(e.target.checked)} className="accent-s112-teal" />
            Inaktive anzeigen ({anzahlInaktiv})
          </label>
        )}
      </div>
      {fehler && <div role="alert" className="mb-3 p-2.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">{fehler}</div>}
      {neu && <div className="mb-4"><Formular gruppe={gruppe} kategorien={kategorien} onDone={() => setNeu(false)} /></div>}
      {sichtbar.length === 0 ? (
        <div className="card text-center py-10 text-s112-muted">
          <p className="font-medium text-s112-text-2">Noch keine {GRUPPE_LABEL[gruppe]}</p>
          <p className="text-sm mt-1">{GRUPPE_BEISPIELE[gruppe]}</p>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-s112-text-2">
                <th className="text-left px-3 py-2 font-semibold">Bezeichnung</th>
                {/* KAN-173: Detailspalten je nach Breite ausblenden, damit die Lagerspalten ohne seitliches Scrollen passen */}
                <th className="hidden sm:table-cell text-left px-3 py-2 font-semibold">Einheit</th>
                <th className="hidden lg:table-cell text-right px-3 py-2 font-semibold">Preis je Einheit</th>
                <th className="hidden xl:table-cell text-left px-3 py-2 font-semibold">E/A-Kategorie</th>
                <th className="hidden xl:table-cell text-left px-3 py-2 font-semibold">Notizen</th>
                <LagerJahrKopf jahr={jahr} klasse="text-right px-3 py-2 font-semibold whitespace-nowrap" />
                {(writeOk || adminOk) && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {sichtbar.map(m => editId === m.id ? (
                <tr key={m.id}><td colSpan={10} className="p-3">
                  <Formular gruppe={gruppe} edit={m} kategorien={kategorien} onDone={() => setEditId(null)} />
                </td></tr>
              ) : (
                <tr key={m.id} className={`border-b border-s112-border/40 last:border-0 ${m.aktiv ? '' : 'opacity-60'}`}>
                  <td className="px-3 py-2 font-medium">
                    {m.name}
                    {!m.aktiv && <span className="ml-2 text-[11px] px-1.5 rounded-full bg-[#F2F3F5] text-s112-text-2">deaktiviert</span>}
                  </td>
                  <td className="hidden sm:table-cell px-3 py-2">{BM_EINHEIT_LABEL[m.einheit] ?? m.einheit}</td>
                  <td className="hidden lg:table-cell px-3 py-2 text-right tabular-nums">
                    {m.preis_pro_einheit != null ? `€ ${m.preis_pro_einheit.toLocaleString(ZAHL_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}` : '–'}
                  </td>
                  <td className="hidden xl:table-cell px-3 py-2 text-xs text-s112-muted">{m.ea_kategorie_id ? katName.get(m.ea_kategorie_id) ?? '–' : '–'}</td>
                  <td className="hidden xl:table-cell px-3 py-2 text-xs text-s112-muted">{m.notizen ?? '–'}</td>
                  <LagerJahrZellen lager={m.lager} klasse="px-3 py-2 text-right tabular-nums text-xs whitespace-nowrap" />
                  {(writeOk || adminOk) && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {writeOk && m.aktiv && (
                          <button onClick={() => setEditId(m.id)} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil className="w-4 h-4" /></button>
                        )}
                        {adminOk && (m.aktiv ? (
                          <button onClick={() => aktiv(m.id, false)} title="Deaktivieren" aria-label="Deaktivieren" className="text-s112-text-2 hover:text-s112-text"><PowerOff className="w-4 h-4" /></button>
                        ) : (
                          <button onClick={() => aktiv(m.id, true)} title="Reaktivieren" aria-label="Reaktivieren" className="text-s112-blue-700 hover:text-s112-blue-700/70"><RotateCcw className="w-4 h-4" /></button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sichtbar.length > 0 && <LagerJahrHinweis jahr={jahr} />}
    </div>
  )
}
