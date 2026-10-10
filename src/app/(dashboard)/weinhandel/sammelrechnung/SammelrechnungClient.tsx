'use client'

// KAN-104 (08.10.2026): Sammelrechnung – Kunde wählen, Lieferscheine auswählen (ganze Lieferscheine), dann die Liste der
// abzurechnenden Lieferscheine zur Freigabe; erst dort Rechnungsdatum und „Sammelrechnung erstellen“.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { fmtEur } from '@/lib/format'
import type { KundeMitLieferscheinen } from '@/lib/verkauf/sammelrechnung'
import { rund } from '@/lib/zahl/runden'

const d = (x: string) => new Date(`${x.slice(0, 10)}T00:00:00`).toLocaleDateString('de-AT')

export default function SammelrechnungClient({ kunden, heute, darf, erstellen }: {
  kunden: KundeMitLieferscheinen[]
  heute: string
  darf: boolean
  erstellen: (lieferscheinIds: string[], formData: FormData) => Promise<{ rechnungId: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [kunde, setKunde] = useState<string>(kunden[0]?.schluessel ?? '')
  const [auswahl, setAuswahl] = useState<Set<string>>(() => new Set(kunden[0]?.lieferscheine.map(l => l.id) ?? []))
  const [vorschau, setVorschau] = useState(false)
  const [datum, setDatum] = useState(heute)
  const [fehler, setFehler] = useState<string | null>(null)

  const k = kunden.find(x => x.schluessel === kunde) ?? kunden[0]
  const gewaehlt = k.lieferscheine.filter(l => auswahl.has(l.id))
  const summe = rund(gewaehlt.reduce((s, l) => s + l.betrag, 0), 2)
  const spaetestes = gewaehlt.reduce((m, l) => (l.datum > m ? l.datum : m), '')

  function kundeWaehlen(schluessel: string) {
    const neu = kunden.find(x => x.schluessel === schluessel)
    setKunde(schluessel)
    setAuswahl(new Set(neu?.lieferscheine.map(l => l.id) ?? []))
    setVorschau(false)
    setFehler(null)
  }
  function umschalten(id: string) {
    setAuswahl(a => { const n = new Set(a); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }
  function erstellenKlick() {
    setFehler(null)
    const fd = new FormData()
    fd.set('rechnungsdatum', datum)
    startTransition(async () => {
      try {
        const { rechnungId } = await erstellen(gewaehlt.map(l => l.id), fd)
        router.push(`/weinhandel/rechnungen/${rechnungId}`)
      } catch (e) {
        setFehler(fehlerText(e, 'Sammelrechnung konnte nicht erstellt werden'))
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="card p-4">
        <label htmlFor="sr-kunde" className="block text-xs font-medium text-s112-text-2 mb-1">Kunde (Rechnungsempfänger)</label>
        <select id="sr-kunde" value={k.schluessel} onChange={e => kundeWaehlen(e.target.value)}
          className="w-full sm:w-auto border border-s112-border rounded-lg px-3 py-2 text-sm bg-white">
          {kunden.map(x => <option key={x.schluessel} value={x.schluessel}>{x.name} – {x.lieferscheine.length} Lieferschein(e), {fmtEur(x.summe)}</option>)}
        </select>
      </div>

      {!vorschau ? (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-s112-text">Nicht berechnete Lieferscheine</h2>
          <ul className="divide-y divide-s112-line text-sm">
            {k.lieferscheine.map(l => (
              <li key={l.id} className="py-2 flex items-center gap-3">
                <input id={`sr-${l.id}`} type="checkbox" checked={auswahl.has(l.id)} onChange={() => umschalten(l.id)} />
                <label htmlFor={`sr-${l.id}`} className="flex-1 flex flex-wrap gap-x-4">
                  <span className="font-mono">{l.nummer ?? '–'}</span>
                  <span className="text-s112-muted">{d(l.datum)}</span>
                  {l.ohnePreis && <span className="text-xs text-s112-warn-fg">Position ohne Preis</span>}
                </label>
                <span className="tabular-nums">{fmtEur(l.betrag)}</span>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm">Ausgewählt: {gewaehlt.length} · <strong className="tabular-nums">{fmtEur(summe)}</strong></span>
            <button type="button" disabled={!darf || gewaehlt.length === 0} onClick={() => { setVorschau(true); if (spaetestes > datum) setDatum(spaetestes) }}
              className="btn-primary text-sm">Weiter: Liste prüfen</button>
          </div>
          {!darf && <p className="text-xs text-s112-muted">Nur lesend – Schreibrecht Warenwirtschaft fehlt bzw. Nur-Lesen-Modus.</p>}
        </div>
      ) : (
        <div className="card p-4 space-y-3">
          <h2 className="text-sm font-semibold text-s112-text">Abzurechnende Lieferscheine – bitte prüfen</h2>
          <p className="text-sm">Rechnungsempfänger: <strong>{k.name}</strong></p>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-s112-muted text-left border-b border-s112-line">
                <th className="py-1 font-medium">Lieferschein</th>
                <th className="py-1 font-medium">Lieferdatum</th>
                <th className="py-1 font-medium text-right">Betrag brutto</th>
              </tr>
            </thead>
            <tbody>
              {gewaehlt.map(l => (
                <tr key={l.id} className="border-b border-s112-line">
                  <td className="py-1.5 font-mono">{l.nummer ?? '–'}</td>
                  <td className="py-1.5">{d(l.datum)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmtEur(l.betrag)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr><td colSpan={2} className="py-2 font-semibold text-right">Summe</td><td className="py-2 text-right font-semibold tabular-nums">{fmtEur(summe)}</td></tr>
            </tfoot>
          </table>
          <div className="max-w-[12rem]">
            <label htmlFor="sr-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Rechnungsdatum *</label>
            <input required id="sr-datum" type="date" value={datum} min={spaetestes || undefined} max={heute} onChange={e => setDatum(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white" />
          </div>
          {fehler && <p role="alert" className="text-sm text-s112-err">{fehler}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={erstellenKlick} disabled={pending || !darf} className="btn-primary text-sm">
              {pending ? 'Erstellt …' : 'Sammelrechnung erstellen'}
            </button>
            <button type="button" onClick={() => setVorschau(false)} className="btn-secondary text-sm">Zurück zur Auswahl</button>
          </div>
        </div>
      )}
    </div>
  )
}
