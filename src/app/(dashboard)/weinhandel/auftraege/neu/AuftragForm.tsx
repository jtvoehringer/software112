'use client'

// KAN-418 Teil 1: Auftrag erfassen – Kunde, Datum, Reservierungsfrist, Positionen (Füllung und Flaschen). Preise gibt es
// hier bewusst nicht (sie entstehen bei der Lieferung). Geprüft mit denselben Regeln wie Server Action und Datenbank.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X } from 'lucide-react'
import PartnerSuche from '@/components/crm/PartnerSuche'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'
import { fehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { AUFTRAG_NOTIZ_MAX, AUFTRAG_POSITIONEN_MAX, auftragFehler, auftragPositionenAus } from '@/lib/auftrag/regeln'
import { createAuftrag } from '../actions'

type Fuellung = { id: string; name: string; bestand: number; reserviert: number; verfuegbar: number }
type Zeile = { fuellung_id: string; menge: string }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'

export default function AuftragForm({ fuellungen, heute, reserviertBis, crmSchreiben }: {
  fuellungen: Fuellung[]; heute: string; reserviertBis: string; crmSchreiben: boolean
}) {
  const router = useRouter()
  const [kunde, setKunde] = useState('')
  const [datum, setDatum] = useState(heute)
  const [bis, setBis] = useState(reserviertBis)
  const [notizen, setNotizen] = useState('')
  const [zeilen, setZeilen] = useState<Zeile[]>([{ fuellung_id: '', menge: '' }])
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const jeFuellung = useMemo(() => new Map(fuellungen.map(f => [f.id, f])), [fuellungen])
  const verfuegbarMap = useMemo(() => new Map(fuellungen.map(f => [f.id, { name: f.name, verfuegbar: f.verfuegbar }])), [fuellungen])
  const setze = (i: number, teil: Partial<Zeile>) => setZeilen(z => z.map((x, j) => (j === i ? { ...x, ...teil } : x)))

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    const json = JSON.stringify(zeilen)
    const f = auftragFehler({ kunde, datum, reserviert_bis: bis, notizen }, auftragPositionenAus(json), heute, verfuegbarMap)
    setFehler(f)
    if (f) return
    setLaeuft(true)
    try {
      const fd = new FormData()
      fd.set('kunde', kunde); fd.set('datum', datum); fd.set('reserviert_bis', bis); fd.set('notizen', notizen); fd.set('positionen_json', json)
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

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Kunde *</label>
        <PartnerSuche art="kunde" value={kunde} onChange={id => setKunde(id)} anlegen={crmSchreiben} ariaLabel="Kunde suchen" />
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

      <div className="space-y-2">
        <p className="text-xs font-medium text-s112-text-2">Positionen *</p>
        {zeilen.map((z, i) => {
          const f = z.fuellung_id ? jeFuellung.get(z.fuellung_id) : undefined
          return (
            <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_8rem_auto] gap-2 items-start">
              <div>
                <select aria-label={`Füllung ${i + 1}`} value={z.fuellung_id} onChange={e => setze(i, { fuellung_id: e.target.value })} className={feld}>
                  <option value="">– Füllung wählen –</option>
                  {fuellungen.map(x => <option key={x.id} value={x.id} disabled={x.verfuegbar <= 0}>{x.name} (verfügbar {fmtNum(Math.max(x.verfuegbar, 0), 0)})</option>)}
                </select>
                {f && (
                  <p className="text-xs text-s112-muted mt-1 tabular-nums">
                    Bestand {fmtNum(f.bestand, 0)} · reserviert {fmtNum(f.reserviert, 0)} · verfügbar {fmtNum(Math.max(f.verfuegbar, 0), 0)} Flaschen
                  </p>
                )}
              </div>
              <input aria-label={`Flaschen ${i + 1}`} type="number" min="1" step="1" inputMode="numeric" placeholder="Flaschen"
                value={z.menge} onChange={e => setze(i, { menge: e.target.value })} className={`${feld} text-right tabular-nums`} />
              <button type="button" aria-label={`Position ${i + 1} entfernen`} title="Entfernen" disabled={zeilen.length === 1}
                onClick={() => setZeilen(alt => alt.filter((_, j) => j !== i))}
                className="p-2 rounded-lg text-s112-muted hover:text-s112-err-fg hover:bg-s112-err-bg disabled:opacity-30">
                <X className="w-4 h-4" />
              </button>
            </div>
          )
        })}
        {zeilen.length < AUFTRAG_POSITIONEN_MAX && (
          <button type="button" onClick={() => setZeilen(z => [...z, { fuellung_id: '', menge: '' }])}
            className="inline-flex items-center gap-1.5 text-xs text-s112-blue-700 hover:underline">
            <Plus className="w-3.5 h-3.5" /> Weitere Position
          </button>
        )}
        {fuellungen.length === 0 && <p className="text-sm text-s112-muted">Es gibt keine Füllung mit Bestand.</p>}
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notiz</label>
        <textarea aria-label="Notiz" rows={2} maxLength={AUFTRAG_NOTIZ_MAX} value={notizen} onChange={e => setNotizen(e.target.value)} className={`${feld} resize-none`} />
      </div>

      <p className="text-xs text-s112-muted">Preise und Rabatte entstehen erst bei der Lieferung – der Auftrag reserviert nur die Flaschen.</p>

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
