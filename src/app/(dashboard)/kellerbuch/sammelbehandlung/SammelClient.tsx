'use client'

// KAN-413 (11.11.2026): Formular der Sammelmaßnahme – Gebinde ankreuzen, Typ/Datum/Menge erfassen, Vorschau der
// Aufteilung je Gebinde (derselbe Baustein wie die Server Action: src/lib/kellerbuch/sammelbehandlung.ts).

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import StornoButton from '@/components/StornoButton'
import { fmtNum, zahlAus } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { serverRueckfrage } from '@/lib/ui/rueckfrage'
import { istStoffkontoTyp } from '@/lib/kellerbuch/stoffkonto'
import { sammelFehler, sammelSumme, sammelZeilen, type SammelModus } from '@/lib/kellerbuch/sammelbehandlung'
import { speichereSammelbehandlung, storniereSammelbehandlung } from './actions'

export type SammelChargeZeile = {
  id: string; name: string; jahrgang: number | null; rebsorte: string | null; liter: number; behaelterId: string; behaelterName: string
}
export type Sammlung = {
  id: string; datum: string; typ: string; einheit: string | null; menge: number; anzahl: number; storniert: number; gebinde: string[]
}
type Typ = { id: string; name: string; einheit: string | null; pnWirkung: string | null }
type Stoff = { id: string; name: string; einheit: string }

const EINHEITEN = ['kg', 'g', 'L', 'mL', 'mg', '-']
const datumDe = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}` : d)

export default function SammelClient({ chargen, typen, stoffe, sammlungen, heute, writeOk }: {
  chargen: SammelChargeZeile[]; typen: Typ[]; stoffe: Stoff[]; sammlungen: Sammlung[]; heute: string; writeOk: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [gewaehlt, setGewaehlt] = useState<Set<string>>(new Set())
  const [suche, setSuche] = useState('')
  const [datum, setDatum] = useState(heute)
  const [typId, setTypId] = useState('')
  const [modus, setModus] = useState<SammelModus>('gesamt')
  const [menge, setMenge] = useState('')
  const [einheit, setEinheit] = useState('g')
  const [stoffId, setStoffId] = useState('')
  const [stoffMenge, setStoffMenge] = useState('')
  const [notizen, setNotizen] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)

  const typ = typen.find(t => t.id === typId) ?? null
  const stoff = stoffe.find(s => s.id === stoffId) ?? null
  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase()
    if (!q) return chargen
    return chargen.filter(c => `${c.behaelterName} ${c.name} ${c.jahrgang ?? ''} ${c.rebsorte ?? ''}`.toLowerCase().includes(q))
  }, [chargen, suche])
  const auswahl = useMemo(() => chargen.filter(c => gewaehlt.has(c.id)), [chargen, gewaehlt])

  const mengeZahl = einheit === '-' ? null : zahlAus(menge)
  const stoffZahl = stoffId ? zahlAus(stoffMenge) : null
  const eingabe = {
    chargen: auswahl.map(c => ({ chargeId: c.id, behaelterId: c.behaelterId, liter: c.liter })),
    modus, menge: mengeZahl, einheit, stoffId: stoffId || null, stoffGesamt: stoffZahl,
  }
  const zeilen = sammelZeilen({ chargen: eingabe.chargen, modus, menge: mengeZahl, stoffGesamt: stoffZahl })
  const jeCharge = new Map(zeilen.map(z => [z.chargeId, z]))
  const alleSichtbarenGewaehlt = sichtbar.length > 0 && sichtbar.every(c => gewaehlt.has(c.id))

  function umschalten(id: string) {
    setGewaehlt(alt => { const neu = new Set(alt); if (neu.has(id)) neu.delete(id); else neu.add(id); return neu })
  }
  function alleSichtbaren(an: boolean) {
    setGewaehlt(alt => { const neu = new Set(alt); for (const c of sichtbar) { if (an) neu.add(c.id); else neu.delete(c.id) } return neu })
  }
  function typGewaehlt(id: string) {
    setTypId(id)
    const t = typen.find(x => x.id === id)
    if (t?.einheit && EINHEITEN.includes(t.einheit)) setEinheit(t.einheit)
  }

  function absenden(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFehler(null)
    setHinweis(null)
    if (!typId) { setFehler('Bitte einen Behandlungstyp wählen.'); return }
    const f = sammelFehler(eingabe)
    if (f) { setFehler(f); return }
    const fd = new FormData()
    fd.set('datum', datum)
    fd.set('typ_id', typId)
    fd.set('modus', modus)
    fd.set('menge', einheit === '-' ? '' : menge)
    fd.set('einheit', einheit)
    fd.set('notizen', notizen)
    fd.set('chargen_json', JSON.stringify(auswahl.map(c => c.id)))
    if (stoffId) { fd.set('kellermittel_id', stoffId); fd.set('kellermittel_menge', stoffMenge) }
    startTransition(async () => {
      try {
        let r = await speichereSammelbehandlung(fd)
        if (r.bestaetigung) {
          if (!(await serverRueckfrage(r.bestaetigung, 'Trotzdem speichern'))) return
          fd.set('pn_bestaetigt', '1')
          r = await speichereSammelbehandlung(fd)
        }
        setHinweis(r.hinweis ?? null)
        zeigeErfolg(`Sammelmaßnahme gespeichert: ${r.anzahl ?? auswahl.length} Gebinde.`)
        setGewaehlt(new Set())
        setMenge('')
        setStoffMenge('')
        setNotizen('')
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Die Sammelmaßnahme wurde nicht gespeichert'))
      }
    })
  }

  if (chargen.length === 0) {
    return <p className="card p-5 text-sm text-s112-muted">Es liegt derzeit kein Wein in einem Gebinde – eine Sammelmaßnahme braucht mindestens zwei belegte Gebinde.</p>
  }

  return (
    <div className="space-y-6">
      <form data-ungespeichert onSubmit={absenden} className="space-y-6">
        <section className="card p-5 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="font-semibold text-s112-text text-sm">1. Gebinde wählen</h2>
              <p className="text-xs text-s112-muted">{auswahl.length} gewählt · {fmtNum(sammelSumme(zeilen, 'liter'), 0)} L</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input type="search" value={suche} onChange={e => setSuche(e.target.value)} placeholder="Gebinde, Charge, Jahrgang, Sorte"
                aria-label="Gebinde filtern" className="input py-2 text-sm w-64 max-w-full" />
              <button type="button" onClick={() => alleSichtbaren(!alleSichtbarenGewaehlt)} disabled={!writeOk || sichtbar.length === 0}
                className="text-xs text-s112-blue-700 border border-s112-teal/30 px-3 py-2 rounded-lg hover:bg-s112-teal hover:text-s112-yellow transition-colors disabled:opacity-50">
                {alleSichtbarenGewaehlt ? 'Angezeigte abwählen' : 'Alle angezeigten wählen'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-s112-text-2 border-b border-s112-border">
                  <th className="py-2 pr-2 w-8"><span className="sr-only">Auswahl</span></th>
                  <th className="py-2 pr-3 font-medium">Gebinde</th>
                  <th className="py-2 pr-3 font-medium">Charge</th>
                  <th className="py-2 pr-3 font-medium text-right">Liter</th>
                  <th className="py-2 pr-3 font-medium text-right">Menge{einheit !== '-' ? ` (${einheit})` : ''}</th>
                  {stoff && <th className="py-2 pr-3 font-medium text-right">{stoff.name} ({stoff.einheit})</th>}
                </tr>
              </thead>
              <tbody>
                {sichtbar.map(c => {
                  const z = jeCharge.get(c.id)
                  const an = gewaehlt.has(c.id)
                  return (
                    <tr key={c.id} className={`border-b border-s112-border last:border-0 ${an ? 'bg-s112-bg' : ''}`}>
                      <td className="py-2 pr-2">
                        <input type="checkbox" checked={an} onChange={() => umschalten(c.id)} disabled={!writeOk}
                          aria-label={`${c.behaelterName} – ${c.name}`} className="h-4 w-4" />
                      </td>
                      <td className="py-2 pr-3 font-medium text-s112-text">{c.behaelterName}</td>
                      <td className="py-2 pr-3">
                        <Link href={`/kellerbuch/weinausbau/${c.id}`} className="text-s112-blue-700 hover:underline">{c.name}</Link>
                        <span className="text-xs text-s112-muted"> {[c.jahrgang, c.rebsorte].filter(Boolean).join(' · ')}</span>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(c.liter, 0)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{an && z?.menge != null && z.menge > 0 ? fmtNum(z.menge, 3) : '–'}</td>
                      {stoff && <td className="py-2 pr-3 text-right tabular-nums">{an && z?.stoffMenge != null && z.stoffMenge > 0 ? fmtNum(z.stoffMenge, 3) : '–'}</td>}
                    </tr>
                  )
                })}
                {sichtbar.length === 0 && (
                  <tr><td colSpan={stoff ? 6 : 5} className="py-4 text-center text-xs text-s112-muted">Kein Gebinde passt zum Filter.</td></tr>
                )}
              </tbody>
              {auswahl.length > 0 && (
                <tfoot>
                  <tr className="border-t border-s112-border font-medium">
                    <td />
                    <td className="py-2 pr-3" colSpan={2}>Summe der gewählten Gebinde</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(sammelSumme(zeilen, 'liter'), 0)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{mengeZahl != null ? fmtNum(sammelSumme(zeilen, 'menge'), 3) : '–'}</td>
                    {stoff && <td className="py-2 pr-3 text-right tabular-nums">{stoffZahl != null ? fmtNum(sammelSumme(zeilen, 'stoffMenge'), 3) : '–'}</td>}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        <section className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text text-sm">2. Behandlung</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <label className="block text-sm">
              <span className="block text-xs font-medium text-s112-text-2 mb-1">Datum</span>
              <input type="date" value={datum} onChange={e => setDatum(e.target.value)} required disabled={!writeOk} className="input w-full py-2 text-sm" />
            </label>
            <label className="block text-sm lg:col-span-2">
              <span className="block text-xs font-medium text-s112-text-2 mb-1">Behandlungstyp</span>
              <select value={typId} onChange={e => typGewaehlt(e.target.value)} required disabled={!writeOk} className="input w-full py-2 text-sm">
                <option value="">– wählen –</option>
                {typen.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="block text-sm">
              <span className="block text-xs font-medium text-s112-text-2 mb-1">Einheit</span>
              <select value={einheit} onChange={e => setEinheit(e.target.value)} disabled={!writeOk} className="input w-full py-2 text-sm">
                {EINHEITEN.map(x => <option key={x} value={x}>{x === '-' ? '- (ohne Mengenangabe)' : x}</option>)}
              </select>
            </label>
          </div>

          {einheit !== '-' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <fieldset className="text-sm">
                <legend className="block text-xs font-medium text-s112-text-2 mb-1">Die Menge gilt als</legend>
                <label className="flex items-center gap-2 py-1">
                  <input type="radio" name="modus" checked={modus === 'gesamt'} onChange={() => setModus('gesamt')} disabled={!writeOk} />
                  Gesamtmenge – wird nach Litern auf die Gebinde aufgeteilt
                </label>
                <label className="flex items-center gap-2 py-1">
                  <input type="radio" name="modus" checked={modus === 'dosis'} onChange={() => setModus('dosis')} disabled={!writeOk} />
                  Dosis je hl – jedes Gebinde bekommt Dosis × Liter ÷ 100
                </label>
              </fieldset>
              <label className="block text-sm">
                <span className="block text-xs font-medium text-s112-text-2 mb-1">{modus === 'dosis' ? `Dosis (${einheit} je hl)` : `Gesamtmenge (${einheit})`}</span>
                <input type="text" inputMode="decimal" value={menge} onChange={e => setMenge(e.target.value)} disabled={!writeOk}
                  placeholder="z. B. 35" className="input w-full py-2 text-sm" />
                {modus === 'dosis' && mengeZahl != null && auswahl.length > 0 && (
                  <span className="block text-xs text-s112-muted mt-1">Ergibt insgesamt {fmtNum(sammelSumme(zeilen, 'menge'), 3)} {einheit}.</span>
                )}
              </label>
            </div>
          )}

          {stoffe.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <label className="block text-sm">
                <span className="block text-xs font-medium text-s112-text-2 mb-1">
                  Verwendeter Stoff (Stoffkonto){typ && istStoffkontoTyp(typ.name) ? ' – bei diesem Typ Pflicht' : ' – optional'}
                </span>
                <select value={stoffId} onChange={e => setStoffId(e.target.value)} disabled={!writeOk} className="input w-full py-2 text-sm">
                  <option value="">– keiner –</option>
                  {stoffe.map(s => <option key={s.id} value={s.id}>{s.name} ({s.einheit})</option>)}
                </select>
              </label>
              {stoff && (
                <label className="block text-sm">
                  <span className="block text-xs font-medium text-s112-text-2 mb-1">Verwendete Menge gesamt ({stoff.einheit}) – wird nach Litern aufgeteilt</span>
                  <input type="text" inputMode="decimal" value={stoffMenge} onChange={e => setStoffMenge(e.target.value)} disabled={!writeOk} className="input w-full py-2 text-sm" />
                </label>
              )}
            </div>
          )}

          <label className="block text-sm">
            <span className="block text-xs font-medium text-s112-text-2 mb-1">Notizen (gelten für alle Gebinde)</span>
            <textarea value={notizen} onChange={e => setNotizen(e.target.value)} rows={2} disabled={!writeOk} className="input w-full py-2 text-sm" />
          </label>

          {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-sm text-s112-err-fg rounded-lg px-3 py-2">{fehler}</div>}
          {hinweis && <div role="alert" className="bg-s112-warn-bg border border-s112-warn/30 text-sm text-s112-warn-fg rounded-lg px-3 py-2">{hinweis}</div>}

          {writeOk ? (
            <div className="flex flex-wrap items-center gap-3">
              <button type="submit" disabled={pending || auswahl.length < 2}
                className="bg-s112-teal text-s112-yellow text-sm font-medium px-4 py-2 rounded-lg disabled:opacity-50">
                {pending ? 'Speichert …' : `Für ${auswahl.length} Gebinde speichern`}
              </button>
              <Link href="/kellerbuch" className="text-sm text-s112-muted hover:text-s112-text">Abbrechen</Link>
              <span className="text-xs text-s112-muted">Alles oder nichts: Lässt sich eine Behandlung nicht buchen, wird keine gespeichert.</span>
            </div>
          ) : (
            <p className="text-xs text-s112-muted">Zum Erfassen ist das Schreibrecht für das Kellerbuch nötig.</p>
          )}
        </section>
      </form>

      {sammlungen.length > 0 && (
        <section className="card p-5 space-y-3">
          <h2 className="font-semibold text-s112-text text-sm">Letzte Sammelmaßnahmen</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-s112-text-2 border-b border-s112-border">
                  <th className="py-2 pr-3 font-medium">Datum</th>
                  <th className="py-2 pr-3 font-medium">Behandlung</th>
                  <th className="py-2 pr-3 font-medium text-right">Menge gesamt</th>
                  <th className="py-2 pr-3 font-medium">Gebinde</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {sammlungen.map(s => {
                  const ganzStorniert = s.storniert === s.anzahl
                  return (
                    <tr key={s.id} className={`border-b border-s112-border last:border-0 align-top ${ganzStorniert ? 'text-s112-muted line-through' : ''}`}>
                      <td className="py-2 pr-3 whitespace-nowrap tabular-nums">{datumDe(s.datum)}</td>
                      <td className="py-2 pr-3">{s.typ}</td>
                      <td className="py-2 pr-3 text-right tabular-nums whitespace-nowrap">{s.einheit && s.einheit !== '-' ? `${fmtNum(s.menge, 3)} ${s.einheit}` : '–'}</td>
                      <td className="py-2 pr-3">
                        {s.anzahl} Gebinde{s.storniert > 0 && !ganzStorniert ? `, davon ${s.storniert} storniert` : ''}
                        <span className="block text-xs text-s112-muted">{s.gebinde.slice(0, 8).join(', ')}{s.gebinde.length > 8 ? ' …' : ''}</span>
                      </td>
                      <td className="py-2 text-right">
                        {writeOk && !ganzStorniert && (
                          <StornoButton schwebend label="Ganze Sammelmaßnahme stornieren"
                            hinweis="Alle noch nicht stornierten Behandlungen dieser Sammelmaßnahme werden storniert, der verwendete Stoff geht zurück ins Stoffkonto."
                            action={async (grund) => { await storniereSammelbehandlung(s.id, grund) }}
                            danach={() => { zeigeErfolg('Sammelmaßnahme storniert.'); router.refresh() }} />
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
