'use client'

// KAN-203 (07.10.2026): Reife-Messungen je Ried – Mostgewicht über MostgewichtEingabe (Messwert + Einheit, beide Werte
// gespeichert), Anzeige mit der bevorzugten Einheit zuerst; Zuwachs zur vorigen Messung in °KMW.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Trash2 } from 'lucide-react'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'
import { reifeVerlauf, type ReifeMessung } from '@/lib/wein/reifemessung'
import { zahlLokal } from '@/lib/format'
import { reifemessungLoeschen, reifemessungSpeichern } from '../actions'
import { rueckfrage } from '@/lib/ui/rueckfrage'

const zahl = (v: unknown, stellen: number) =>
  v == null || v === '' ? '–' : zahlLokal(Number(v), { minimumFractionDigits: stellen, maximumFractionDigits: stellen })
const datumText = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`

export default function ReifeMessungen({ weingartenId, messungen, writeOk, heute }: {
  weingartenId: string
  messungen: ReifeMessung[]
  writeOk: boolean
  heute: string
}) {
  const router = useRouter()
  const [bearbeiten, setBearbeiten] = useState<ReifeMessung | 'neu' | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, starte] = useTransition()
  const zeilen = reifeVerlauf(messungen)
  const offen = bearbeiten !== null
  const m = bearbeiten !== null && bearbeiten !== 'neu' ? bearbeiten : null

  function speichern(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    starte(async () => {
      const r = await reifemessungSpeichern(weingartenId, fd)
      if (r.error) { setFehler(r.error); return }
      setBearbeiten(null)
      router.refresh()
    })
  }

  async function loeschen(id: string, datum: string) {
    if (!(await rueckfrage({ titel: `Reife-Messung vom ${datumText(datum)} löschen?`, bestaetigen: 'Löschen', gefaehrlich: true }))) return
    setFehler(null)
    starte(async () => {
      const r = await reifemessungLoeschen(weingartenId, id)
      if (r.error) { setFehler(r.error); return }
      router.refresh()
    })
  }

  return (
    <div className="card mt-6 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-s112-text">Reife-Messungen</h2>
          <p className="text-xs text-s112-muted">Mostgewicht in °KMW oder °Oe, die andere Einheit wird umgerechnet (≈). Zuwachs immer in °KMW.</p>
        </div>
        {writeOk && !offen && (
          <button type="button" onClick={() => { setFehler(null); setBearbeiten('neu') }}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
            + Messung erfassen
          </button>
        )}
      </div>

      {fehler && <p role="alert" className="text-sm bg-s112-err-bg text-s112-err-fg rounded-lg px-3 py-2">{fehler}</p>}

      {writeOk && offen && (
        <form key={m?.id ?? 'neu'} onSubmit={speichern} className="rounded-xl border border-s112-line p-4 space-y-3">
          {m && <input type="hidden" name="id" value={m.id} />}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1" htmlFor="reife-datum">Datum *</label>
              <input id="reife-datum" name="datum" type="date" required max={heute} defaultValue={m?.datum ?? heute}
                className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
            </div>
            <div className="col-span-2 sm:col-span-3">
              <MostgewichtEingabe name="mostgewicht" required qualitaetsVorschau
                startwert={m ? { kmw: m.kmw, oechsle: m.oechsle, einheit: m.mostgewicht_einheit } : null} />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1" htmlFor="reife-saeure">Gesamtsäure (g/l)</label>
              <input id="reife-saeure" name="gesamtsaeure_gl" type="text" inputMode="decimal" placeholder="z. B. 7,2"
                defaultValue={m?.gesamtsaeure_gl != null ? String(m.gesamtsaeure_gl).replace('.', ',') : ''}
                className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1" htmlFor="reife-ph">pH-Wert</label>
              <input id="reife-ph" name="ph_wert" type="text" inputMode="decimal" placeholder="z. B. 3,25"
                defaultValue={m?.ph_wert != null ? String(m.ph_wert).replace('.', ',') : ''}
                className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-s112-text-2 mb-1" htmlFor="reife-notizen">Notiz</label>
              <input id="reife-notizen" name="notizen" type="text" placeholder="z. B. Probe aus 3 Zeilen, Beeren weich"
                defaultValue={m?.notizen ?? ''} className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={laeuft}
              className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
              {laeuft ? 'Wird gespeichert …' : 'Messung speichern'}
            </button>
            <button type="button" onClick={() => { setBearbeiten(null); setFehler(null) }} className="text-sm text-s112-muted hover:text-s112-text-1">Abbrechen</button>
          </div>
        </form>
      )}

      {zeilen.length === 0 ? (
        <p className="text-sm text-s112-muted italic">Noch keine Reife-Messung für diese Ried erfasst.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-s112-muted border-b border-s112-line">
                <th className="py-2 pr-3 font-medium">Datum</th>
                <th className="py-2 pr-3 font-medium">Mostgewicht</th>
                <th className="py-2 pr-3 font-medium">Zuwachs</th>
                <th className="py-2 pr-3 font-medium text-right">Säure (g/l)</th>
                <th className="py-2 pr-3 font-medium text-right">pH</th>
                <th className="py-2 pr-3 font-medium">Notiz</th>
                {writeOk && <th className="py-2 font-medium"><span className="sr-only">Aktionen</span></th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-line">
              {zeilen.map(({ messung: r, zuwachsKmw, tage }) => (
                <tr key={r.id}>
                  <td className="py-2 pr-3 font-mono text-[12.5px] whitespace-nowrap">{datumText(r.datum)}</td>
                  <td className="py-2 pr-3 whitespace-nowrap"><MostgewichtAnzeige wert={{ kmw: r.kmw, oechsle: r.oechsle, einheit: r.mostgewicht_einheit }} /></td>
                  <td className="py-2 pr-3 text-xs text-s112-text-2 whitespace-nowrap tabular-nums">
                    {zuwachsKmw === null ? '–' : `${zuwachsKmw > 0 ? '+' : ''}${zahl(zuwachsKmw, 2)} °KMW${tage ? ` in ${tage} T` : ''}`}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahl(r.gesamtsaeure_gl, 1)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{zahl(r.ph_wert, 2)}</td>
                  <td className="py-2 pr-3 text-xs text-s112-text-2">{r.notizen ?? ''}</td>
                  {writeOk && (
                    <td className="py-2 whitespace-nowrap text-right">
                      <button type="button" aria-label={`Messung vom ${datumText(r.datum)} bearbeiten`} disabled={laeuft}
                        onClick={() => { setFehler(null); setBearbeiten(r) }} className="text-s112-muted hover:text-s112-blue-700 p-1">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button type="button" aria-label={`Messung vom ${datumText(r.datum)} löschen`} disabled={laeuft}
                        onClick={() => loeschen(r.id, r.datum)} className="text-s112-muted hover:text-s112-err-fg p-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
