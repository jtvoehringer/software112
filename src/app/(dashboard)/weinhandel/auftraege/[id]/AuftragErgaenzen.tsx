'use client'

// KAN-487: Einem Auftrag von früher (vor dem 27.11.2026 ohne Preise bzw. Vereinbarungen angelegt) fehlt, was die
// Auftragsbestätigung jetzt druckt. Hier werden Preise je Position und die Vereinbarungen einmal nachgetragen
// (RPC s112_auftrag_ergaenzen – nur solange der Auftrag Flaschen reserviert). Geprüft wie Server Action und Datenbank.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, fmtEur } from '@/lib/format'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { LIEFERBEDINGUNGEN_MAX, ergaenzFehler, ergaenzPositionenAus } from '@/lib/auftrag/regeln'
import { angebotSummen, angebotZeileBrutto } from '@/lib/auftrag/angebot'
import { ergaenzeAuftrag } from '../actions'

export type ErgaenzZeile = { position_id: string; name: string; menge: number; preis_brutto: string; rabatt_pct: string; sonderrabatt_pct: string; ust_satz: string }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const UST = ['0', '10', '13', '20']

export default function AuftragErgaenzen({ id, nummer, lieferbedingungen: lbStart, zeilen: start }: {
  id: string; nummer: string; lieferbedingungen: string; zeilen: ErgaenzZeile[]
}) {
  const router = useRouter()
  const [lieferbedingungen, setVereinbarungen] = useState(lbStart)
  const [zeilen, setZeilen] = useState<ErgaenzZeile[]>(start)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const setze = (i: number, teil: Partial<ErgaenzZeile>) => setZeilen(z => z.map((x, j) => (j === i ? { ...x, ...teil } : x)))
  const summen = useMemo(() => angebotSummen(zeilen.filter(z => z.preis_brutto)), [zeilen])

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    const json = JSON.stringify(zeilen.map(z => ({ position_id: z.position_id, preis_brutto: z.preis_brutto, rabatt_pct: z.rabatt_pct, sonderrabatt_pct: z.sonderrabatt_pct, ust_satz: z.ust_satz })))
    const f = ergaenzFehler(lieferbedingungen, ergaenzPositionenAus(json))
    setFehler(f)
    if (f) return
    setLaeuft(true)
    try {
      const fd = new FormData()
      fd.set('id', id); fd.set('lieferbedingungen', lieferbedingungen); fd.set('positionen_json', json)
      const r = await ergaenzeAuftrag(fd)
      if (r.error) { setFehler(r.error); return }
      zeigeErfolg(`Auftrag ${nummer} ergänzt – die Auftragsbestätigung ist jetzt verfügbar.`)
      router.refresh()
    } catch (err) {
      setFehler(fehlerText(err, 'Die Angaben wurden nicht gespeichert'))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <form data-ungespeichert onSubmit={speichern} className="card p-6 space-y-4" data-auftrag-ergaenzen>
      <div>
        <h2 className="text-sm font-semibold text-s112-text">Preise und Vereinbarungen ergänzen</h2>
        <p className="text-sm text-s112-text-2 mt-1">
          Dieser Auftrag wurde ohne Preise bzw. Vereinbarungen angelegt. Beides steht auf der Auftragsbestätigung – bitte einmal nachtragen.
          Danach lassen sich die Angaben nicht mehr ändern.
        </p>
      </div>
      {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg text-sm px-3 py-2.5 rounded-lg">{fehler}</div>}

      <div className="space-y-3">
        {zeilen.map((z, i) => {
          const betrag = z.preis_brutto ? angebotZeileBrutto(z) : null
          return (
            <div key={z.position_id} className="border border-s112-border rounded-xl p-3 space-y-2">
              <p className="text-sm font-medium text-s112-text">{z.name} <span className="text-s112-muted font-normal tabular-nums">· {fmtNum(z.menge, 0)} Flaschen</span></p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <label className="text-xs text-s112-text-2">Preis je Flasche (€, brutto)
                  <input aria-label={`Preis je Flasche ${i + 1}`} type="number" min="0" step="0.01" inputMode="decimal" required
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
        {summen.flaschen > 0 && (
          <p className="text-sm text-right tabular-nums">
            <span className="text-s112-muted">netto {fmtEur(summen.netto)} · </span>
            <span className="font-semibold text-s112-text">Gesamt brutto {fmtEur(summen.brutto)}</span>
          </p>
        )}
      </div>

      <div>
        <label htmlFor="ergaenzen-lieferbedingungen" className="block text-xs font-medium text-s112-text-2 mb-1">Vereinbarungen *</label>
        <textarea id="ergaenzen-lieferbedingungen" rows={2} required maxLength={LIEFERBEDINGUNGEN_MAX} value={lieferbedingungen}
          aria-describedby="ergaenzen-lieferbedingungen-hilfe" onChange={e => setVereinbarungen(e.target.value)} className={`${feld} resize-none`} />
        <p id="ergaenzen-lieferbedingungen-hilfe" className="text-xs text-s112-muted mt-1">
          Was mit dem Kunden vereinbart wurde, z. B. Abholung ab Hof, Lieferung frei Haus, Liefertermin, Zahlungsziel.
        </p>
      </div>

      <button type="submit" disabled={laeuft}
        className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
        {laeuft ? 'Wird gespeichert…' : 'Angaben speichern'}
      </button>
    </form>
  )
}
