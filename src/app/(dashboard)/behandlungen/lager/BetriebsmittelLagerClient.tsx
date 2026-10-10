'use client'

// KAN-167 (01.10.2026): Bestand & Bewegungen der Weinbehandlungs- bzw. Produktionsmittel. Einkauf = Lagerbuchung UND
// E/A-Ausgabe in einer Buchung (nur mit E&A-Rechnung und Schreibrecht E&A); Anfangsbestand und Inventurkorrektur ohne
// Ausgabe. Buchungen werden storniert (Einkauf samt Ausgabe), stornierte lassen sich endgültig löschen.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil } from 'lucide-react'
import StornoButton from '@/components/StornoButton'
import { VerbrauchTr, zeilenChronologisch } from './Verbrauchszeilen'
import LagerHinweise from './LagerHinweise'
import { fmtNum, zahlAus, zahlLokal } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import AnfangsbestandHinweis from './AnfangsbestandHinweis'
import { BM_EINHEITEN, BM_EINHEIT_LABEL, GRUPPE_LABEL, bmBrutto, type BetriebsmittelGruppe } from '@/lib/behandlungen/betriebsmittel'
import type { LagerKonto } from '@/lib/behandlungen/lagerVerbrauch'
import {
  speichereBetriebsmittelBuchung, bucheBetriebsmittelEinkauf, stornoBetriebsmittelBuchung, loescheBetriebsmittelBuchung,
} from './betriebsmittelActions'
import { heuteWien } from '@/lib/datum/wien'

export type BmBewegung = {
  id: string; datum: string; typ: 'anfangsbestand' | 'einkauf' | 'korrektur'; menge: number; einheit: string
  betrag_netto: number | null; ust_satz: number | null; lieferant: string | null; notizen: string | null
  storniert_am: string | null; storniert_von_name: string | null; storno_grund: string | null
}
export type BmKarte = { id: string; name: string; einheit: string; bewegungen: BmBewegung[]; konto: LagerKonto }
export type BmOption = { id: string; name: string; einheit: string; ea_kategorie_id: string | null; preis_pro_einheit: number | null }
export type Auswahl = { id: string; name: string }

const TYP_LABEL: Record<string, string> = { anfangsbestand: 'Anfangsbestand', einkauf: 'Einkauf', korrektur: 'Korrektur' }
const TYP_COLOR: Record<string, string> = {
  anfangsbestand: 'bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100',
  einkauf:        'bg-s112-ok-bg text-s112-ok-fg border-s112-ok/30',
  korrektur:      'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
}
const feld = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
const lbl = 'block text-xs font-medium text-s112-text-2 mb-1'

function fmtDate(d: string) { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}` }
function euro(n: number) { return zahlLokal(n, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) }

type Ctx = {
  alle: BmOption[]; kategorien: Auswahl[]; lieferanten: Auswahl[]
  /** Einkauf möglich (E&A aktiv, Buchhaltungsart E/A, Schreibrecht E&A); sonst Grund */
  einkaufSperre: string | null
}

function BuchungsForm({ ctx, mittelId, edit, onDone }: { ctx: Ctx; mittelId?: string; edit?: BmBewegung & { betriebsmittel_id: string }; onDone: () => void }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [typ, setTyp] = useState<string>(edit?.typ ?? (ctx.einkaufSperre ? 'anfangsbestand' : 'einkauf'))
  const [mittel, setMittel] = useState<string>(edit?.betriebsmittel_id ?? mittelId ?? '')
  const [richtung, setRichtung] = useState<'eingang' | 'ausgang'>(edit && edit.menge < 0 ? 'ausgang' : 'eingang')
  const [netto, setNetto] = useState('')
  const [datum, setDatum] = useState<string>(edit?.datum ?? heuteWien())
  const [ust, setUst] = useState('20')
  const stamm = ctx.alle.find(m => m.id === mittel)
  const einkauf = typ === 'einkauf'
  const nettoZahl = zahlAus(netto) ?? NaN

  function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    fd.set('richtung', richtung)
    start(async () => {
      try {
        if (einkauf) await bucheBetriebsmittelEinkauf(fd)
        else await speichereBetriebsmittelBuchung(fd)
        setFehler(null); onDone(); router.refresh()
      } catch (err) { setFehler(fehlerText(err)) }
    })
  }

  return (
    <form onSubmit={absenden} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      {fehler && <div role="alert" className="p-2.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">{fehler}</div>}
      <h3 className="text-sm font-semibold text-s112-text">{edit ? 'Buchung bearbeiten' : 'Neue Buchung'}</h3>
      {edit && <input type="hidden" name="existing_id" value={edit.id} />}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={lbl}>Mittel *</label>
          <select aria-label="Mittel" name="betriebsmittel_id" required value={mittel} onChange={e => setMittel(e.target.value)} disabled={!!edit} className={feld}>
            <option value="">– Auswählen –</option>
            {ctx.alle.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          {edit && <input type="hidden" name="betriebsmittel_id" value={edit.betriebsmittel_id} />}
        </div>
        <div>
          <label className={lbl}>Typ *</label>
          <select aria-label="Typ" name="typ" required value={typ} onChange={e => setTyp(e.target.value)} disabled={!!edit} className={feld}>
            <option value="einkauf" disabled={!!ctx.einkaufSperre}>Einkauf (mit E/A-Ausgabe)</option>
            <option value="anfangsbestand">Anfangsbestand</option>
            <option value="korrektur">Inventurkorrektur</option>
          </select>
          {edit && <input type="hidden" name="typ" value={edit.typ} />}
        </div>
        <div>
          <label className={lbl}>Datum *</label>
          <input aria-label="Datum" name="datum" type="date" required value={datum} onChange={e => setDatum(e.target.value)} className={feld} />
        </div>
        <AnfangsbestandHinweis typ={typ} datum={datum} />
        {typ === 'korrektur' && (
          <div className="col-span-2 flex gap-3">
            {(['eingang', 'ausgang'] as const).map(r => (
              <label key={r} className="flex items-center gap-1.5 cursor-pointer text-sm">
                <input type="radio" checked={richtung === r} onChange={() => setRichtung(r)} className="accent-s112-teal" />
                {r === 'eingang' ? 'Aufbuchen' : 'Abbuchen'}
              </label>
            ))}
          </div>
        )}
        <div>
          <label className={lbl}>Menge *</label>
          <input aria-label="Menge" name="menge" type="text" inputMode="decimal" required defaultValue={edit ? String(Math.abs(edit.menge)).replace('.', ',') : ''} className={feld} />
        </div>
        <div>
          <label className={lbl}>Einheit</label>
          <select aria-label="Einheit" name="einheit" key={mittel} defaultValue={edit?.einheit ?? stamm?.einheit ?? 'stk'} className={feld}>
            {BM_EINHEITEN.map(e => <option key={e} value={e}>{BM_EINHEIT_LABEL[e]}</option>)}
          </select>
        </div>
        {einkauf && (
          <>
            <div>
              <label className={lbl}>Betrag netto (€) *</label>
              <input aria-label="Betrag netto" name="betrag_netto" type="text" inputMode="decimal" required value={netto} onChange={e => setNetto(e.target.value)} className={feld} />
            </div>
            <div>
              <label className={lbl}>USt-Satz</label>
              <select aria-label="USt-Satz" name="ust_satz" value={ust} onChange={e => setUst(e.target.value)} className={feld}>
                {['20', '13', '10', '0'].map(s => <option key={s} value={s}>{s} %</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Ausgaben-Kategorie (E&A) *</label>
              <select aria-label="Ausgaben-Kategorie" name="ea_kategorie_id" required key={`k-${mittel}`} defaultValue={stamm?.ea_kategorie_id ?? ''} className={feld}>
                <option value="">– Auswählen –</option>
                {ctx.kategorien.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Lieferant</label>
              <select aria-label="Lieferant" name="lieferant_firma_id" defaultValue="" className={feld}>
                <option value="">– ohne –</option>
                {ctx.lieferanten.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <p className="col-span-2 text-xs text-s112-muted">
              Beim Speichern wird zugleich die E/A-Ausgabe gebucht{Number.isFinite(nettoZahl) ? ` (brutto € ${euro(bmBrutto(nettoZahl, Number(ust)))})` : ''}.
              Ein Einkauf lässt sich danach nicht mehr ändern, nur stornieren – die Ausgabe wird dabei mitstorniert.
            </p>
          </>
        )}
        <div className="col-span-2">
          <label className={lbl}>Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={edit?.notizen ?? ''} placeholder={einkauf ? 'z. B. Rechnungsnummer' : 'z. B. Grund der Korrektur'} className={feld} />
        </div>
      </div>
      {ctx.einkaufSperre && !edit && <p className="text-xs text-s112-muted">Einkauf nicht möglich: {ctx.einkaufSperre}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending} className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50">
          {pending ? 'Speichert…' : einkauf ? 'Einkauf buchen' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone} className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">Abbrechen</button>
      </div>
    </form>
  )
}

function Karte({ k, ctx, writeOk }: { k: BmKarte; ctx: Ctx; writeOk: boolean }) {
  const router = useRouter()
  const [form, setForm] = useState(false)
  const [edit, setEdit] = useState<(BmBewegung & { betriebsmittel_id: string }) | null>(null)
  const { einheit, zugang, abgang, verbrauch, posten, bestand, hinweise } = k.konto
  const farbe = bestand < 0 ? 'text-s112-err-fg' : bestand === 0 ? 'text-s112-warn-fg' : 'text-s112-blue-700'
  return (
    <div className="card">
      <div className="flex items-start justify-between mb-4">
        <h3 className="font-semibold text-s112-text">{k.name}</h3>
        <div className="text-right">
          <p className={`text-2xl font-semibold tabular-nums ${farbe}`}>{fmtNum(bestand, { max: 3 })} {einheit}</p>
          <p className="text-xs text-s112-muted">Aktueller Bestand</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 mb-4 text-center">
        <div className="bg-s112-ok-bg rounded-lg p-2"><p className="text-sm font-semibold text-s112-ok-fg tabular-nums">+{fmtNum(zugang, { max: 3 })} {einheit}</p><p className="text-xs text-s112-ok-fg">Zugänge</p></div>
        <div className="bg-s112-blue-50 rounded-lg p-2"><p className="text-sm font-semibold text-s112-blue-700 tabular-nums">–{fmtNum(verbrauch, { max: 3 })} {einheit}</p><p className="text-xs text-s112-blue-700">Verbrauch (Maßnahmen)</p></div>
        <div className="bg-s112-warn-bg rounded-lg p-2"><p className="text-sm font-semibold text-s112-warn-fg tabular-nums">{abgang > 0 ? `–${fmtNum(abgang, { max: 3 })} ${einheit}` : '–'}</p><p className="text-xs text-s112-warn-fg">Korrekturen</p></div>
      </div>
      <LagerHinweise hinweise={hinweise} writeOk={writeOk} />
      {(form || edit) && (
        <div className="mb-4">
          <BuchungsForm ctx={ctx} mittelId={k.id} edit={edit ?? undefined} onDone={() => { setForm(false); setEdit(null) }} />
        </div>
      )}
      {(k.bewegungen.length > 0 || posten.length > 0) && (
        <div className="border border-s112-border rounded-xl overflow-hidden mb-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-s112-text-2">
                <th className="text-left px-3 py-2 font-semibold">Datum</th>
                <th className="text-left px-3 py-2 font-semibold">Typ</th>
                <th className="text-right px-3 py-2 font-semibold">Menge</th>
                <th className="text-left px-3 py-2 font-semibold">Einkauf / Notizen</th>
                {writeOk && <th className="px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {zeilenChronologisch(k.bewegungen, posten).map(z => z.verbrauch ? (
                <VerbrauchTr key={`v-${z.verbrauch.behandlungId}`} v={z.verbrauch} einheit={einheit} mitAktionen={writeOk} />
              ) : ((b: BmBewegung) => (
                <tr key={b.id} className={`border-b border-s112-border/40 last:border-0 ${b.storniert_am ? 'opacity-70' : 'hover:bg-s112-bg/30'}`}>
                  <td className="px-3 py-2 tabular-nums text-s112-muted">{fmtDate(b.datum)}</td>
                  <td className="px-3 py-2">
                    {b.storniert_am
                      ? <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-s112-err-bg text-s112-err-fg">Storniert</span>
                      : <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${TYP_COLOR[b.typ] ?? ''}`}>{TYP_LABEL[b.typ] ?? b.typ}</span>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium whitespace-nowrap ${b.storniert_am ? 'line-through text-s112-muted' : b.menge < 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
                    {b.menge < 0 ? '–' : '+'}{fmtNum(Math.abs(b.menge), { max: 3 })} {BM_EINHEIT_LABEL[b.einheit] ?? b.einheit}
                  </td>
                  <td className="px-3 py-2 text-xs text-s112-muted">
                    {b.typ === 'einkauf' && b.betrag_netto !== null && (
                      <span className="whitespace-nowrap">€ {euro(b.betrag_netto)} netto ({b.ust_satz ?? 0} %){b.lieferant ? ` · ${b.lieferant}` : ''}{b.notizen ? ' · ' : ''}</span>
                    )}
                    {b.notizen}
                    {b.storniert_am && (
                      <p className="text-[11px] text-s112-warn-fg">storniert am {new Date(b.storniert_am).toLocaleDateString('de-AT')}{b.storniert_von_name ? ` von ${b.storniert_von_name}` : ''}{b.storno_grund ? ` – ${b.storno_grund}` : ''}</p>
                    )}
                  </td>
                  {writeOk && (
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {!b.storniert_am && b.typ !== 'einkauf' && (
                          <button onClick={() => setEdit({ ...b, betriebsmittel_id: k.id })} title="Bearbeiten" aria-label="Bearbeiten"
                            className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil className="w-4 h-4" /></button>
                        )}
                        {b.storniert_am ? (
                          <StornoButton modus="loeschen" label="Endgültig löschen" schwebend danach={() => router.refresh()}
                            action={grund => loescheBetriebsmittelBuchung(b.id, grund)}
                            hinweis="Nur bei Fehlbuchungen: Die stornierte Buchung wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll." />
                        ) : (
                          <StornoButton schwebend danach={() => router.refresh()}
                            action={grund => stornoBetriebsmittelBuchung(b.id, grund)}
                            hinweis={b.typ === 'einkauf'
                              ? 'Der Einkauf bleibt als storniert stehen; die E/A-Ausgabe wird mit einer Gegenbuchung storniert.'
                              : 'Die Buchung bleibt als storniert stehen und zählt nicht mehr zum Bestand.'} />
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              ))(z.buchung as BmBewegung))}
            </tbody>
          </table>
        </div>
      )}
      {writeOk && !form && !edit && (
        <button onClick={() => setForm(true)} className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-blue-700 font-medium px-3 py-1.5 rounded-lg transition-colors">
          Buchung erfassen
        </button>
      )}
    </div>
  )
}

export default function BetriebsmittelLagerClient({ gruppe, karten, ctx, writeOk }: { gruppe: BetriebsmittelGruppe; karten: BmKarte[]; ctx: Ctx; writeOk: boolean }) {
  const [neu, setNeu] = useState(false)
  return (
    <div>
      {writeOk && ctx.alle.length > 0 && (
        <div className="mb-4">
          {neu ? <BuchungsForm ctx={ctx} onDone={() => setNeu(false)} /> : (
            <button onClick={() => setNeu(true)} className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
              Buchung erfassen
            </button>
          )}
        </div>
      )}
      {karten.length === 0 ? (
        <div className="card text-center py-10 text-s112-muted">
          <p className="font-medium text-s112-text-2">Noch keine Lagerbewegungen ({GRUPPE_LABEL[gruppe]})</p>
          <p className="text-sm mt-1 max-w-md mx-auto">
            {ctx.alle.length === 0
              ? `Lege zuerst unter „${GRUPPE_LABEL[gruppe]}“ ein Mittel an.`
              : 'Erfasse einen Einkauf oder den Anfangsbestand. Der Verbrauch kommt aus Maßnahmen „Sonstiges“ und „Laubarbeit“ (Aufwand × Fläche).'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {karten.map(k => <Karte key={k.id} k={k} ctx={ctx} writeOk={writeOk} />)}
        </div>
      )}
    </div>
  )
}
