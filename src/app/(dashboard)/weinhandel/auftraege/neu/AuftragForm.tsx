'use client'

// KAN-418 Teil 1: Auftrag erfassen – Kunde, Datum, Reservierungsfrist, Positionen (Füllung und Flaschen).
// KAN-487 (27.11.2026): dazu die Preise je Position (Bruttopreis je Flasche aus der Füllung, Kunden- und Sonderrabatt aus
// den Konditionen des Kunden, USt. des Betriebs – alles änderbar; gespeichert als Momentaufnahme wie am Angebot) und die
// Lieferbedingungen als Pflicht-Freitext. Beides steht auf der Auftragsbestätigung. Geprüft mit denselben Regeln wie
// Server Action und Datenbank.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import PartnerSuche, { type PartnerTreffer } from '@/components/crm/PartnerSuche'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, fmtEur } from '@/lib/format'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { AUFTRAG_NOTIZ_MAX, AUFTRAG_POSITIONEN_MAX, LIEFERBEDINGUNGEN_MAX, auftragFehler, auftragPositionenAus } from '@/lib/auftrag/regeln'
import { angebotSummen, angebotZeileBrutto } from '@/lib/auftrag/angebot'
import { createAuftrag } from '../actions'

type Fuellung = { id: string; name: string; bestand: number; reserviert: number; verfuegbar: number; preis: number | null }
export type AuftragZeileEingabe = { fuellung_id: string; menge: string; preis_brutto: string; rabatt_pct: string; sonderrabatt_pct: string; ust_satz: string }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const UST = ['0', '10', '13', '20']

export default function AuftragForm({ fuellungen, heute, reserviertBis, ustStandard, crmSchreiben, angebot }: {
  fuellungen: Fuellung[]; heute: string; reserviertBis: string; ustStandard: number; crmSchreiben: boolean
  /** KAN-418 Teil 4: Übernahme aus einem offenen Angebot – Kunde fest, Positionen samt Preisen vorbelegt (änderbar) */
  angebot?: { id: string; nummer: string; kunde: string; zeilen: AuftragZeileEingabe[] }
}) {
  const router = useRouter()
  const leer = (r = '0', s = '0'): AuftragZeileEingabe => ({ fuellung_id: '', menge: '', preis_brutto: '', rabatt_pct: r, sonderrabatt_pct: s, ust_satz: String(ustStandard) })
  const [kunde, setKunde] = useState(angebot?.kunde ?? '')
  const [datum, setDatum] = useState(heute)
  const [bis, setBis] = useState(reserviertBis)
  const [lieferbedingungen, setLieferbedingungen] = useState('')
  const [notizen, setNotizen] = useState('')
  const [zeilen, setZeilen] = useState<AuftragZeileEingabe[]>(angebot?.zeilen.length ? angebot.zeilen : [leer()])
  const [rabatt, setRabatt] = useState<{ r: string; s: string }>({ r: '0', s: '0' })   // Konditionen des gewählten Kunden für neue Zeilen
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const jeFuellung = useMemo(() => new Map(fuellungen.map(f => [f.id, f])), [fuellungen])
  const verfuegbarMap = useMemo(() => new Map(fuellungen.map(f => [f.id, { name: f.name, verfuegbar: f.verfuegbar }])), [fuellungen])
  const setze = (i: number, teil: Partial<AuftragZeileEingabe>) => setZeilen(z => z.map((x, j) => (j === i ? { ...x, ...teil } : x)))
  const summen = useMemo(() => angebotSummen(zeilen.filter(z => z.fuellung_id && z.menge && z.preis_brutto)), [zeilen])

  function kundeWaehlen(id: string, treffer: PartnerTreffer | null) {
    setKunde(id)
    if (!treffer?.daten) return
    // Konditionen des Kunden wie im Verkauf und am Angebot: gelten für alle Positionen und für neue Zeilen
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
    const f = auftragFehler({ kunde, datum, reserviert_bis: bis, lieferbedingungen, notizen }, auftragPositionenAus(json), heute, verfuegbarMap)
    setFehler(f)
    if (f) return
    setLaeuft(true)
    try {
      const fd = new FormData()
      fd.set('kunde', kunde); fd.set('datum', datum); fd.set('reserviert_bis', bis); fd.set('lieferbedingungen', lieferbedingungen)
      fd.set('notizen', notizen); fd.set('positionen_json', json)
      if (angebot) fd.set('angebot_id', angebot.id)
      const r = await createAuftrag(fd)
      if (r.error || !r.id) { setFehler(r.error ?? 'Der Auftrag wurde nicht gespeichert.'); return }
      zeigeErfolg(`Auftrag ${r.nummer} angelegt – die Flaschen sind reserviert.`)
      router.push(`/weinhandel/auftraege/${r.id}`)
    } catch (err) {
      setFehler(fehlerText(err, 'Der Auftrag wurde nicht gespeichert'))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <form data-ungespeichert onSubmit={speichern} className="card p-6 space-y-5">
      {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm px-3 py-2.5 rounded-lg">{fehler}</div>}
      {angebot && (
        <p role="status" className="bg-s112-bg border border-s112-border text-sm text-s112-text-2 rounded-xl px-4 py-3">
          Übernahme aus Angebot {angebot.nummer}: Mit dem Speichern werden die Flaschen reserviert und das Angebot gilt als angenommen.
          Die Preise des Angebots sind vorbelegt – bitte prüfen.
        </p>
      )}

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Kunde *</label>
        <PartnerSuche art="kunde" value={kunde} onChange={kundeWaehlen} anlegen={crmSchreiben} ariaLabel="Kunde suchen" disabled={!!angebot} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Auftragsdatum *</label>
          <input type="date" aria-label="Auftragsdatum" required value={datum} max={heute} onChange={e => setDatum(e.target.value)} className={feld} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Reserviert bis *</label>
          <ZukunftsDatum aria-label="Reserviert bis" required value={bis} min={heute} onChange={e => setBis(e.target.value)} className={feld} />
          <p className="text-xs text-s112-muted mt-1">Nach diesem Tag bleibt die Reservierung bestehen, wird aber als abgelaufen angezeigt – verlängern oder stornieren.</p>
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
                    {fuellungen.map(x => <option key={x.id} value={x.id} disabled={x.verfuegbar <= 0}>{x.name} (verfügbar {fmtNum(Math.max(x.verfuegbar, 0), 0)})</option>)}
                  </select>
                  {f && (
                    <p className="text-xs text-s112-muted mt-1 tabular-nums">
                      Bestand {fmtNum(f.bestand, 0)} · reserviert {fmtNum(f.reserviert, 0)} · verfügbar {fmtNum(Math.max(f.verfuegbar, 0), 0)} Flaschen
                    </p>
                  )}
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
        {zeilen.length < AUFTRAG_POSITIONEN_MAX && (
          <button type="button" onClick={() => setZeilen(z => [...z, leer(rabatt.r, rabatt.s)])}
            className="inline-flex items-center gap-1.5 text-xs text-s112-blue-700 hover:underline">
            <Plus className="w-3.5 h-3.5" /> Weitere Position
          </button>
        )}
        {fuellungen.length === 0 && <p className="text-sm text-s112-muted">Es gibt keine Füllung mit Bestand.</p>}
        {summen.flaschen > 0 && (
          <p className="text-sm text-right tabular-nums">
            <span className="text-s112-muted">{fmtNum(summen.flaschen, 0)} Flaschen · netto {fmtEur(summen.netto)} · </span>
            <span className="font-semibold text-s112-text">Gesamt brutto {fmtEur(summen.brutto)}</span>
          </p>
        )}
      </div>

      <div>
        <label htmlFor="auftrag-lieferbedingungen" className="block text-xs font-medium text-s112-text-2 mb-1">Lieferbedingungen *</label>
        <textarea id="auftrag-lieferbedingungen" rows={2} required maxLength={LIEFERBEDINGUNGEN_MAX} value={lieferbedingungen}
          aria-describedby="auftrag-lieferbedingungen-hilfe" onChange={e => setLieferbedingungen(e.target.value)} className={`${feld} resize-none`} />
        <p id="auftrag-lieferbedingungen-hilfe" className="text-xs text-s112-muted mt-1">
          Was mit dem Kunden vereinbart wurde, z. B. Abholung ab Hof, Lieferung frei Haus, Liefertermin. Steht auf der Auftragsbestätigung.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notiz (intern)</label>
        <textarea aria-label="Notiz" rows={2} maxLength={AUFTRAG_NOTIZ_MAX} value={notizen} onChange={e => setNotizen(e.target.value)} className={`${feld} resize-none`} />
      </div>

      <p className="text-xs text-s112-muted">Preise und Lieferbedingungen stehen auf der Auftragsbestätigung. Bei der Lieferung sind die Preise vorbelegt und lassen sich dort noch ändern.</p>

      <div className="flex gap-3 pt-1">
        <button type="submit" disabled={laeuft}
          className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
          {laeuft ? 'Wird gespeichert…' : 'Auftrag speichern'}
        </button>
        <AbbrechenKnopf standard="/weinhandel/auftraege" className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-s112-text-2 hover:bg-s112-bg" />
      </div>
    </form>
  )
}
