'use client'

// KAN-115 (07.10.2026): Einstellungen und Lagerkonto eines Sonstigen Produkts. Bewegungen sind append-only – Korrektur
// per Inventur oder Storno; Verkauf und Verarbeitung storniert man über ihren Vorgang.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import StornoButton from '@/components/StornoButton'
import { zahlLokal } from '@/lib/format'
import {
  BEWEGUNG_ART_LABEL, PRODUKT_ARTEN, produktKonto, type ProduktBewegung,
} from '@/lib/warenwirtschaft/sonstigeProdukte'
import { produktBuchen, produktBuchungStornieren, produktEinstellungenSpeichern } from '../actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export interface ProduktZeile {
  id: string
  name: string
  einheit: string
  aktiv: boolean
  art: string | null
  bestand_fuehren: boolean
  liter_je_stk: number | string | null
}

const zahl = (v: number) => zahlLokal(v, { maximumFractionDigits: 3 })
const datumText = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`
const inp = 'input w-full py-2.5 sm:py-2 text-base sm:text-sm'

function bezugText(b: AR): React.ReactNode {
  if (b.verarbeitung?.weinausbau_id) {
    return <Link href={`/kellerbuch/weinausbau/${b.verarbeitung.weinausbau_id}`} className="text-s112-blue-700 hover:underline">Charge {b.verarbeitung.weinausbau?.name ?? ''}</Link>
  }
  if (b.verkaufsposten_id) {
    return <Link href={`/weinhandel/verkauf/${b.verkaufsposten_id}`} className="text-s112-blue-700 hover:underline">Verkauf {b.verkaufsposten?.rechnungsnummer ?? ''}</Link>
  }
  return null
}

export default function ProduktLagerClient({ artikel, bewegungen, writeOk, heute }: {
  artikel: ProduktZeile
  bewegungen: (ProduktBewegung & AR)[]
  writeOk: boolean
  heute: string
}) {
  const router = useRouter()
  const [laeuft, starte] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [art, setArt] = useState('zugang')
  const konto = produktKonto(bewegungen)

  function einstellungen(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null); setHinweis(null)
    starte(async () => {
      const r = await produktEinstellungenSpeichern(fd)
      if (r.error) { setFehler(r.error); return }
      setHinweis('Gespeichert.')
      router.refresh()
    })
  }

  function buchen(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = e.currentTarget
    const fd = new FormData(form)
    setFehler(null); setHinweis(null)
    starte(async () => {
      const r = await produktBuchen(fd)
      if (r.error) { setFehler(r.error); return }
      form.reset()
      setHinweis('Gebucht.')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {fehler && <p role="alert" className="text-sm bg-s112-err-bg text-s112-err-fg rounded-lg px-3 py-2">{fehler}</p>}
      {hinweis && <p role="status" className="text-sm bg-s112-ok-bg text-s112-ok-fg rounded-lg px-3 py-2">{hinweis}</p>}

      <form onSubmit={einstellungen} className="card space-y-4">
        <h2 className="text-base font-semibold text-s112-text">Einstellungen</h2>
        <input type="hidden" name="id" value={artikel.id} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="p-art" className="block text-xs font-medium text-s112-text-2 mb-1">Art</label>
            <select id="p-art" name="art" defaultValue={artikel.art ?? ''} disabled={!writeOk} className={inp}>
              <option value="">– nicht festgelegt –</option>
              {PRODUKT_ARTEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="p-liter" className="block text-xs font-medium text-s112-text-2 mb-1">Liter je {artikel.einheit}</label>
            <input id="p-liter" name="liter_je_stk" type="text" inputMode="decimal" disabled={!writeOk} placeholder="z. B. 1 oder 0,75"
              defaultValue={artikel.liter_je_stk != null ? String(artikel.liter_je_stk).replace('.', ',') : ''} className={inp} />
          </div>
          <label className="flex items-center gap-2 text-sm text-s112-text sm:mt-6">
            <input type="checkbox" name="bestand_fuehren" defaultChecked={artikel.bestand_fuehren} disabled={!writeOk} />
            Lagerstand führen
          </label>
        </div>
        <p className="text-xs text-s112-muted">
          Mit Lagerstand mindert jeder Verkauf den Bestand (ein Verkauf über den Bestand hinaus wird abgelehnt); „Liter je {artikel.einheit}“
          schlägt beim Verarbeiten die Stückzahl vor.
        </p>
        {writeOk && (
          <button type="submit" disabled={laeuft} className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
            Einstellungen speichern
          </button>
        )}
      </form>

      {artikel.bestand_fuehren && (
        <div className="card space-y-4">
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <h2 className="text-base font-semibold text-s112-text">Lagerkonto</h2>
            <p className="text-sm">Lagerstand: <span className={`font-semibold tabular-nums ${konto.saldo < 0 ? 'text-s112-err-fg' : ''}`}>{zahl(konto.saldo)} {artikel.einheit}</span></p>
          </div>

          {writeOk && (
            <form onSubmit={buchen} className="rounded-xl border border-s112-line p-4 grid grid-cols-2 sm:grid-cols-5 gap-3 items-end">
              <input type="hidden" name="artikel_id" value={artikel.id} />
              <div>
                <label htmlFor="b-art" className="block text-xs font-medium text-s112-text-2 mb-1">Buchung</label>
                <select id="b-art" name="art" value={art} onChange={e => setArt(e.target.value)} className={inp}>
                  <option value="anfangsbestand">Anfangsbestand</option>
                  <option value="zugang">Zugang</option>
                  <option value="inventur">Inventur (gezählt)</option>
                </select>
              </div>
              <div>
                <label htmlFor="b-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
                <input id="b-datum" name="datum" type="date" required max={heute} defaultValue={heute} className={inp} />
              </div>
              <div>
                <label htmlFor="b-menge" className="block text-xs font-medium text-s112-text-2 mb-1">{art === 'inventur' ? `Gezählt (${artikel.einheit})` : `Menge (${artikel.einheit})`}</label>
                <input id="b-menge" name="menge" type="text" inputMode="decimal" required className={inp} />
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="b-notiz" className="block text-xs font-medium text-s112-text-2 mb-1">Notiz</label>
                <input id="b-notiz" name="notizen" type="text" className={inp} />
              </div>
              <button type="submit" disabled={laeuft} className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
                Buchen
              </button>
            </form>
          )}

          {konto.zeilen.length === 0 ? (
            <p className="text-sm text-s112-muted italic">Noch keine Lagerbewegung.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-s112-muted border-b border-s112-line">
                    <th className="py-2 pr-3 font-medium">Datum</th>
                    <th className="py-2 pr-3 font-medium">Art</th>
                    <th className="py-2 pr-3 font-medium text-right">Menge</th>
                    <th className="py-2 pr-3 font-medium text-right">Bestand</th>
                    <th className="py-2 pr-3 font-medium">Bezug / Notiz</th>
                    {writeOk && <th className="py-2 font-medium"><span className="sr-only">Aktionen</span></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-s112-line">
                  {[...konto.zeilen].reverse().map(({ bewegung: b, menge, saldo, storniert }) => (
                    <tr key={b.id} className={storniert ? 'opacity-60' : ''}>
                      <td className="py-2 pr-3 font-mono text-[12.5px] whitespace-nowrap">{datumText(b.datum)}</td>
                      <td className="py-2 pr-3 whitespace-nowrap">{BEWEGUNG_ART_LABEL[b.art] ?? b.art}{storniert ? ' (storniert)' : ''}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${menge < 0 ? 'text-s112-err-fg' : ''}`}>{menge > 0 ? '+' : ''}{zahl(menge)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{zahl(saldo)}</td>
                      <td className="py-2 pr-3 text-xs text-s112-text-2">
                        {bezugText(b)}{bezugText(b) && b.notizen ? ' · ' : ''}{b.notizen ?? ''}
                        {b.erstellt_von_name ? <span className="text-s112-tertiary"> · {b.erstellt_von_name}</span> : null}
                      </td>
                      {writeOk && (
                        <td className="py-2 text-right">
                          {['anfangsbestand', 'zugang', 'inventur'].includes(b.art) && !storniert && (
                            <StornoButton schwebend
                              hinweis="Die Buchung bleibt stehen; eine Gegenbuchung mit heutigem Datum hebt sie auf."
                              action={grund => produktBuchungStornieren(b.id, artikel.id, grund)}
                              danach={() => router.refresh()} />
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
