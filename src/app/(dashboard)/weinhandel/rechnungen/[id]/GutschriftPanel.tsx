'use client'
// KAN-419 G1 (13.11.2026): „Gutschrift ausstellen“ an der Rechnung – einzelne Positionen bis zur Restmenge und/oder ein
// freier Betrag (Preisnachlass, Bonus). Dieselben Regeln wie die Datenbank (src/lib/verkauf/gutschrift.ts); gebucht wird
// erst mit dem Knopf, die Gutschrift ist danach unveränderlich.
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import { fmtEur, fmtNum, zahlAus } from '@/lib/format'
import {
  GUTSCHRIFT_GRUND_MAX, GUTSCHRIFT_GRUND_MIN, GUTSCHRIFT_TEXT_MAX, bereitsGutgeschrieben, betragAufteilen, gutschriftBrutto,
  gutschriftEingabeFehler, neueGutschriftBrutto, restBetrag, restMenge,
} from '@/lib/verkauf/gutschrift'
import { gutschriftAusstellen } from '../../verkauf/actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  rechnungId: string
  rechnungsnummer: string
  rechnungDatum: string
  heute: string
  /** Positionen der Rechnung (id, name, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz) */
  positionen: R[]
  /** bisherige Gutschriften (id, rechnungsnummer, datum, aktiv, gutschrift_positionen) */
  gutschriften: R[]
  darfSchreiben: boolean
}

type Feld = 'datum' | 'grund' | 'positionen' | 'betrag'
const tag = (d: string) => d.slice(0, 10).split('-').reverse().join('.')
const eingabe = 'border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden'

export default function GutschriftPanel({ rechnungId, rechnungsnummer, rechnungDatum, heute, positionen, gutschriften, darfSchreiben }: Props) {
  const router = useRouter()
  const [offen, setOffen] = useState(false)
  const [datum, setDatum] = useState(heute)
  const [grund, setGrund] = useState('')
  const [mengen, setMengen] = useState<Record<string, string>>({})
  const [betrag, setBetrag] = useState('')
  const [betragText, setBetragText] = useState('')
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<{ feld: Feld | null; text: string } | null>(null)

  const bisher = useMemo(() => bereitsGutgeschrieben(gutschriften), [gutschriften])
  const rest = restBetrag(positionen, gutschriften)
  const gewaehlt = positionen
    .map(p => ({ position_id: String(p.id), menge: zahlAus(mengen[String(p.id)] ?? '') ?? 0, roh: (mengen[String(p.id)] ?? '').trim() }))
    .filter(z => z.roh !== '')
  const betragZahl = betrag.trim() === '' ? 0 : (zahlAus(betrag) ?? Number.NaN)
  const neu = Number.isFinite(betragZahl) ? neueGutschriftBrutto({ positionen: gewaehlt, betrag: betragZahl }, positionen) : 0
  const anteile = Number.isFinite(betragZahl) && betragZahl > 0 ? betragAufteilen(betragZahl, positionen) : []

  async function ausstellen() {
    const e = { datum, grund, positionen: gewaehlt.map(({ position_id, menge }) => ({ position_id, menge })), betrag: betragZahl, betragText }
    const f = gutschriftEingabeFehler(e, { rechnungDatum, heute, positionen, gutschriften })
    if (f) { setFehler(f); return }
    if (!(await rueckfrage({
      titel: `Gutschrift über ${fmtEur(neu)} ausstellen?`,
      text: `Zur Rechnung ${rechnungsnummer} entsteht ein eigener Beleg mit Datum ${tag(datum)}. Er lässt sich danach nicht mehr ändern.`,
      bestaetigen: 'Gutschrift ausstellen',
    }))) return
    setSaving(true)
    try {
      setFehler(null)
      const erg = await gutschriftAusstellen(rechnungId, { ...e, betragText: betragText.trim() || null })
      if ('error' in erg) { setFehler({ feld: erg.feld ?? null, text: erg.error }); return }
      zeigeErfolg('Gutschrift ausgestellt.')
      router.push(`/weinhandel/rechnungen/${erg.gutschriftId}`)
    } catch {
      setFehler({ feld: null, text: 'Die Gutschrift konnte nicht ausgestellt werden – bitte die Verbindung prüfen.' })
    } finally {
      setSaving(false)
    }
  }

  const meldung = (feld: Feld) => fehler?.feld === feld && <p id={`gs-fehler-${feld}`} role="alert" className="text-xs text-s112-err mt-1">{fehler.text}</p>

  return (
    <div className="bg-white rounded-xl border border-s112-border p-5 no-print">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-s112-text">Gutschriften</h2>
          {gutschriften.length === 0
            ? <p className="text-sm text-s112-muted mt-0.5">Zu dieser Rechnung gibt es noch keine Gutschrift.</p>
            : (
              <ul className="text-sm mt-1 space-y-0.5">
                {gutschriften.map(g => (
                  <li key={String(g.id)}>
                    <Link href={`/weinhandel/rechnungen/${g.id}`} className="font-mono text-s112-blue-700 hover:underline">{g.rechnungsnummer}</Link>
                    {' '}vom {tag(String(g.datum))} · −{fmtEur(gutschriftBrutto(g))}
                  </li>
                ))}
              </ul>
            )}
          <p className="text-xs text-s112-muted mt-1">Noch gutschreibbar: {fmtEur(rest)}</p>
        </div>
        {darfSchreiben && rest > 0 && !offen && (
          <button type="button" onClick={() => setOffen(true)}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm text-s112-text-1 hover:bg-s112-bg">Gutschrift ausstellen</button>
        )}
      </div>

      {offen && (
        <form className="mt-4 space-y-4" onSubmit={e => { e.preventDefault(); void ausstellen() }}>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="gs-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum der Gutschrift</label>
              <input id="gs-datum" type="date" value={datum} min={rechnungDatum} max={heute} onChange={e => setDatum(e.target.value)}
                aria-describedby={fehler?.feld === 'datum' ? 'gs-fehler-datum' : undefined} className={eingabe} />
              {meldung('datum')}
            </div>
            <div>
              <label htmlFor="gs-grund" className="block text-xs font-medium text-s112-text-2 mb-1">Grund (mindestens {GUTSCHRIFT_GRUND_MIN} Zeichen, steht auf dem Beleg)</label>
              <input id="gs-grund" value={grund} maxLength={GUTSCHRIFT_GRUND_MAX} onChange={e => setGrund(e.target.value)}
                aria-describedby={fehler?.feld === 'grund' ? 'gs-fehler-grund' : undefined} className={`${eingabe} w-full`} />
              {meldung('grund')}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-s112-border text-left text-xs text-s112-text-2">
                  <th className="py-2 pr-3 font-semibold">Position</th>
                  <th className="py-2 pr-3 font-semibold text-right">Verrechnet</th>
                  <th className="py-2 pr-3 font-semibold text-right">Noch gutschreibbar</th>
                  <th className="py-2 font-semibold text-right">Menge der Gutschrift</th>
                </tr>
              </thead>
              <tbody>
                {positionen.map(p => {
                  const r = restMenge(p, bisher)
                  return (
                    <tr key={String(p.id)} className="border-b border-s112-border/60">
                      <td className="py-2 pr-3">{p.name} <span className="text-xs text-s112-muted">à {p.preis_brutto != null ? fmtEur(Number(p.preis_brutto)) : '–'}</span></td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(Number(p.menge))} {p.einheit ?? ''}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(r)}</td>
                      <td className="py-2 text-right">
                        <input aria-label={`Menge der Gutschrift für ${p.name}`} inputMode="decimal" disabled={r <= 0 || p.preis_brutto == null}
                          value={mengen[String(p.id)] ?? ''} onChange={e => setMengen(m => ({ ...m, [String(p.id)]: e.target.value }))}
                          className={`${eingabe} w-24 text-right disabled:bg-s112-bg`} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {meldung('positionen')}
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="gs-betrag" className="block text-xs font-medium text-s112-text-2 mb-1">Freier Betrag brutto (€), z. B. Preisnachlass</label>
              <input id="gs-betrag" inputMode="decimal" value={betrag} onChange={e => setBetrag(e.target.value)}
                aria-describedby={fehler?.feld === 'betrag' ? 'gs-fehler-betrag' : undefined} className={`${eingabe} w-40 text-right`} />
              {anteile.length > 1 && (
                <p className="text-xs text-s112-muted mt-1">Anteilig: {anteile.map(a => `${fmtEur(a.anteil)} zu ${fmtNum(a.ustSatz)} %`).join(', ')}</p>
              )}
              {meldung('betrag')}
            </div>
            <div>
              <label htmlFor="gs-text" className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung des Betrags (leer = „Preisnachlass“)</label>
              <input id="gs-text" value={betragText} maxLength={GUTSCHRIFT_TEXT_MAX} onChange={e => setBetragText(e.target.value)} className={`${eingabe} w-full`} />
            </div>
          </div>

          {fehler && fehler.feld === null && <p role="alert" className="text-sm text-s112-err">{fehler.text}</p>}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-s112-text-1">Betrag der Gutschrift: <span className="font-semibold">{fmtEur(neu)}</span> <span className="text-s112-muted">(höchstens {fmtEur(rest)})</span></p>
            <div className="flex gap-2">
              <button type="button" disabled={saving} onClick={() => { setOffen(false); setFehler(null) }}
                className="border border-s112-border rounded-lg px-3 py-1.5 text-sm">Abbrechen</button>
              <button type="submit" disabled={saving}
                className="bg-s112-teal text-s112-yellow rounded-lg px-3 py-1.5 text-sm font-medium hover:opacity-90 disabled:opacity-50">
                {saving ? 'Wird ausgestellt …' : 'Gutschrift ausstellen'}
              </button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
