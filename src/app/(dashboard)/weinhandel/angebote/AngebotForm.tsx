'use client'

// KAN-418 Teil 4: Angebot erfassen bzw. ein offenes Angebot bearbeiten – Kunde, Datum, „gültig bis“ und Positionen mit
// Preisen (Bruttopreis je Flasche aus der Füllung, Kunden- und Sonderrabatt aus den Konditionen des Kunden, USt. des
// Betriebs – alles änderbar; gespeichert als Momentaufnahme). Ein Angebot reserviert nichts: „verfügbar“ ist nur ein
// Hinweis. Geprüft mit denselben Regeln wie Server Action und Datenbank.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import PartnerSuche, { type PartnerTreffer } from '@/components/crm/PartnerSuche'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, fmtEur } from '@/lib/format'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import {
  ANGEBOT_NOTIZ_MAX, ANGEBOT_POSITIONEN_MAX, angebotFehler, angebotPositionenAus, angebotSummen, angebotZeileBrutto,
} from '@/lib/auftrag/angebot'
import { speichereAngebot } from './actions'

export type AngebotFuellung = { id: string; name: string; preis: number | null; verfuegbar: number }
type Zeile = { fuellung_id: string; menge: string; preis_brutto: string; rabatt_pct: string; sonderrabatt_pct: string; ust_satz: string }
export type AngebotVorgabe = { id: string; nummer: string; kunde: string; datum: string; gueltig_bis: string; notizen: string; zeilen: Zeile[] }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const UST = ['0', '10', '13', '20']

export default function AngebotForm({ fuellungen, heute, gueltigBis, ustStandard, crmSchreiben, vorgabe }: {
  fuellungen: AngebotFuellung[]; heute: string; gueltigBis: string; ustStandard: number; crmSchreiben: boolean
  /** Bearbeiten: das offene Angebot mit seinen Positionen */
  vorgabe?: AngebotVorgabe
}) {
  const router = useRouter()
  const leer = (r = '0', s = '0'): Zeile => ({ fuellung_id: '', menge: '', preis_brutto: '', rabatt_pct: r, sonderrabatt_pct: s, ust_satz: String(ustStandard) })
  const [kunde, setKunde] = useState(vorgabe?.kunde ?? '')
  const [datum, setDatum] = useState(vorgabe?.datum ?? heute)
  const [bis, setBis] = useState(vorgabe?.gueltig_bis ?? gueltigBis)
  const [notizen, setNotizen] = useState(vorgabe?.notizen ?? '')
  const [zeilen, setZeilen] = useState<Zeile[]>(vorgabe?.zeilen.length ? vorgabe.zeilen : [leer()])
  const [rabatt, setRabatt] = useState<{ r: string; s: string }>({ r: '0', s: '0' })   // Konditionen des gewählten Kunden für neue Zeilen
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const jeFuellung = useMemo(() => new Map(fuellungen.map(f => [f.id, f])), [fuellungen])
  const setze = (i: number, teil: Partial<Zeile>) => setZeilen(z => z.map((x, j) => (j === i ? { ...x, ...teil } : x)))
  const summen = useMemo(() => angebotSummen(zeilen.filter(z => z.fuellung_id && z.menge && z.preis_brutto)), [zeilen])

  function kundeWaehlen(id: string, treffer: PartnerTreffer | null) {
    setKunde(id)
    if (!treffer?.daten) return   // Vorbelegung beim Bearbeiten: die gespeicherten Rabatte bleiben
    // Konditionen des Kunden wie im Verkauf: gelten für alle Positionen und für neue Zeilen
    const r = String(treffer.daten.rabatt_pct ?? 0), s = String(treffer.daten.sonderrabatt_pct ?? 0)
    setRabatt({ r, s })
    setZeilen(z => z.map(x => ({ ...x, rabatt_pct: r, sonderrabatt_pct: s })))
  }

  function fuellungWaehlen(i: number, id: string) {
    const f = jeFuellung.get(id)
    // Preis der Füllung vorschlagen – einen schon eingegebenen Preis überschreibt nur ein Wechsel der Füllung
    setze(i, { fuellung_id: id, preis_brutto: f?.preis != null ? String(f.preis) : '' })
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    const json = JSON.stringify(zeilen)
    const f = angebotFehler({ kunde, datum, gueltig_bis: bis, notizen }, angebotPositionenAus(json), heute)
    setFehler(f)
    if (f) return
    setLaeuft(true)
    try {
      const fd = new FormData()
      if (vorgabe) fd.set('id', vorgabe.id)
      fd.set('kunde', kunde); fd.set('datum', datum); fd.set('gueltig_bis', bis); fd.set('notizen', notizen); fd.set('positionen_json', json)
      const r = await speichereAngebot(fd)
      if (r.error || !r.id) { setFehler(r.error ?? 'Das Angebot wurde nicht gespeichert.'); return }
      zeigeErfolg(vorgabe ? `Angebot ${r.nummer} gespeichert.` : `Angebot ${r.nummer} angelegt.`)
      router.push(`/weinhandel/angebote/${r.id}`)
    } catch (err) {
      setFehler(fehlerText(err, 'Das Angebot wurde nicht gespeichert'))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <form data-ungespeichert onSubmit={speichern} className="card p-6 space-y-5">
      {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm px-3 py-2.5 rounded-lg">{fehler}</div>}

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Kunde *</label>
        <PartnerSuche art="kunde" value={kunde} onChange={kundeWaehlen} anlegen={crmSchreiben} ariaLabel="Kunde suchen" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Angebotsdatum *</label>
          <input type="date" aria-label="Angebotsdatum" required value={datum} max={heute} onChange={e => setDatum(e.target.value)} className={feld} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Gültig bis *</label>
          <input type="date" aria-label="Gültig bis" required value={bis} min={datum} onChange={e => setBis(e.target.value)} className={feld} />
          <p className="text-xs text-s112-muted mt-1">Danach wird das Angebot als abgelaufen angezeigt – es lässt sich trotzdem noch in einen Auftrag übernehmen.</p>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs font-medium text-s112-text-2">Positionen *</p>
        {zeilen.map((z, i) => {
          const f = z.fuellung_id ? jeFuellung.get(z.fuellung_id) : undefined
          const betrag = z.fuellung_id && z.menge && z.preis_brutto ? angebotZeileBrutto(z) : null
          return (
            <div key={i} className="border border-s112-border rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-start">
                <div>
                  <select aria-label={`Füllung ${i + 1}`} value={z.fuellung_id} onChange={e => fuellungWaehlen(i, e.target.value)} className={feld}>
                    <option value="">– Füllung wählen –</option>
                    {fuellungen.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  {f && <p className="text-xs text-s112-muted mt-1 tabular-nums">Derzeit verfügbar: {fmtNum(Math.max(f.verfuegbar, 0), 0)} Flaschen (wird nicht reserviert)</p>}
                </div>
                <button type="button" aria-label={`Position ${i + 1} entfernen`} title="Entfernen" disabled={zeilen.length === 1}
                  onClick={() => setZeilen(alt => alt.filter((_, j) => j !== i))}
                  className="p-2 rounded-lg text-s112-muted hover:text-s112-err-fg hover:bg-s112-err-bg disabled:opacity-30 justify-self-end">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <label className="text-xs text-s112-text-2">Flaschen
                  <input aria-label={`Flaschen ${i + 1}`} type="number" min="1" step="1" inputMode="numeric"
                    value={z.menge} onChange={e => setze(i, { menge: e.target.value })} className={`${feld} mt-1 text-right tabular-nums`} />
                </label>
                <label className="text-xs text-s112-text-2">Preis je Flasche (€, brutto)
                  <input aria-label={`Preis je Flasche ${i + 1}`} type="number" min="0" step="0.01" inputMode="decimal"
                    value={z.preis_brutto} onChange={e => setze(i, { preis_brutto: e.target.value })} className={`${feld} mt-1 text-right tabular-nums`} />
                </label>
                <label className="text-xs text-s112-text-2">Rabatt %
                  <input aria-label={`Rabatt ${i + 1}`} type="number" min="0" max="100" step="0.01" inputMode="decimal"
                    value={z.rabatt_pct} onChange={e => setze(i, { rabatt_pct: e.target.value })} className={`${feld} mt-1 text-right tabular-nums`} />
                </label>
                <label className="text-xs text-s112-text-2">Sonderrabatt %
                  <input aria-label={`Sonderrabatt ${i + 1}`} type="number" min="0" max="100" step="0.01" inputMode="decimal"
                    value={z.sonderrabatt_pct} onChange={e => setze(i, { sonderrabatt_pct: e.target.value })} className={`${feld} mt-1 text-right tabular-nums`} />
                </label>
                <label className="text-xs text-s112-text-2">USt.
                  <select aria-label={`USt. ${i + 1}`} value={z.ust_satz} onChange={e => setze(i, { ust_satz: e.target.value })} className={`${feld} mt-1`}>
                    {[...new Set([...UST, z.ust_satz])].filter(Boolean).map(u => <option key={u} value={u}>{u.replace('.', ',')} %</option>)}
                  </select>
                </label>
              </div>
              {betrag !== null && <p className="text-xs text-s112-muted text-right tabular-nums">Betrag: {fmtEur(betrag)}</p>}
            </div>
          )
        })}
        {zeilen.length < ANGEBOT_POSITIONEN_MAX && (
          <button type="button" onClick={() => setZeilen(z => [...z, leer(rabatt.r, rabatt.s)])}
            className="inline-flex items-center gap-1.5 text-xs text-s112-blue-700 hover:underline">
            <Plus className="w-3.5 h-3.5" /> Weitere Position
          </button>
        )}
        {fuellungen.length === 0 && <p className="text-sm text-s112-muted">Es gibt keine aktive Füllung.</p>}
        {summen.flaschen > 0 && (
          <p className="text-sm text-right tabular-nums">
            <span className="text-s112-muted">{fmtNum(summen.flaschen, 0)} Flaschen · netto {fmtEur(summen.netto)} · </span>
            <span className="font-semibold text-s112-text">Gesamt brutto {fmtEur(summen.brutto)}</span>
          </p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notiz (intern)</label>
        <textarea aria-label="Notiz" rows={2} maxLength={ANGEBOT_NOTIZ_MAX} value={notizen} onChange={e => setNotizen(e.target.value)} className={`${feld} resize-none`} />
      </div>

      <p className="text-xs text-s112-muted">Ein Angebot reserviert keine Flaschen. Erst der Auftrag („In Auftrag übernehmen“) prüft den Bestand und reserviert.</p>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={laeuft}
          className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
          {laeuft ? 'Wird gespeichert…' : 'Angebot speichern'}
        </button>
        <AbbrechenKnopf standard={vorgabe ? `/weinhandel/angebote/${vorgabe.id}` : '/weinhandel/angebote'} className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-s112-text-2 hover:bg-s112-bg" />
      </div>
    </form>
  )
}
