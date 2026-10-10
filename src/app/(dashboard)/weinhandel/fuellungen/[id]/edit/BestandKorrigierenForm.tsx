'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { bestandKorrigieren } from '../../../actions'
import { BEWEGUNGSARTEN, type BewegungsArt } from '../../bewegungsarten'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, zahlAus } from '@/lib/format'

// „Bestand korrigieren“ (KAN-35, 24.09.2026): datierte Flaschenbewegung über
// rpc('fuellung_bestand_buchen') statt Überschreiben von bestand_flaschen. Eigenes
// Formular AUSSERHALB des Bearbeiten-Formulars. Die Vorschau rechnet mit dem Bestand
// beim Laden der Seite; maßgeblich ist der Bestand zum Buchungszeitpunkt (die RPC
// sperrt die Füllung und lehnt einen negativen Bestand ab).
export default function BestandKorrigierenForm({
  fuellungId,
  bestand,
  heute,
  abfuelldatum,
}: {
  fuellungId: string
  bestand: number
  heute: string
  abfuelldatum: string | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [art, setArt] = useState<BewegungsArt>('inventur')
  const [menge, setMenge] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState<string | null>(null)

  const artDef = BEWEGUNGSARTEN.find(a => a.value === art) ?? BEWEGUNGSARTEN[0]
  const zahl = zahlAus(menge)
  const gueltig = zahl !== null && Number.isInteger(zahl)
  const delta = !gueltig
    ? null
    : art === 'inventur'
      ? (zahl as number) - bestand
      : artDef.abgang ? -Math.abs(zahl as number) : (zahl as number)
  const neu = delta === null ? null : bestand + delta
  const buchbar = delta !== null && delta !== 0 && neu !== null && neu >= 0 && !(art === 'inventur' && (zahl as number) < 0)

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setFehler(null)
    setErfolg(null)
    const form = e.currentTarget
    const fd = new FormData(form)
    startTransition(async () => {
      try {
        const r = await bestandKorrigieren(fuellungId, fd)
        setErfolg(`Gebucht – neuer Bestand: ${fmtNum(r.bestand, 0)} Flaschen.`)
        setMenge('')
        form.reset()
        router.refresh()
      } catch (err) {
        setFehler(fehlerText(err, 'Bestandskorrektur fehlgeschlagen'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className={labelCls} htmlFor="bk-art">Art der Buchung *</label>
          <select required
            id="bk-art"
            name="art"
            value={art}
            onChange={e => { setArt(e.target.value as BewegungsArt); setFehler(null); setErfolg(null) }}
            className={inputCls}
          >
            {BEWEGUNGSARTEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls} htmlFor="bk-menge">
            {art === 'inventur'
              ? 'Gezählter Ist-Bestand (Flaschen) *'
              : artDef.abgang ? 'Abgang (Flaschen) *' : 'Menge (± Flaschen) *'}
          </label>
          <input
            id="bk-menge"
            name={art === 'inventur' ? 'ist_bestand' : 'menge'}
            type="number"
            step={1}
            min={art === 'inventur' ? 0 : artDef.abgang ? 1 : undefined}
            inputMode="numeric"
            value={menge}
            onChange={e => setMenge(e.target.value)}
            placeholder={art === 'inventur' ? `z. B. ${bestand}` : artDef.abgang ? 'z. B. 6' : 'z. B. -6 oder 12'}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="bk-datum">Datum *</label>
          <input
            id="bk-datum"
            name="datum"
            type="date"
            defaultValue={heute}
            min={abfuelldatum ?? undefined}
            max={heute}
            required
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} htmlFor="bk-grund">Grund{artDef.grundPflicht ? ' *' : ' (optional)'}</label>
          <input
            id="bk-grund"
            name="grund"
            placeholder={art === 'inventur' ? 'z. B. Jahresinventur' : 'z. B. Karton beim Verladen zerbrochen'}
            required={artDef.grundPflicht}
            className={inputCls}
          />
        </div>
      </div>

      <p className="text-xs text-s112-text-1">
        Bestand jetzt <strong className="tabular-nums">{fmtNum(bestand, 0)}</strong>
        {neu !== null && delta !== null && delta !== 0 && (
          <>
            {' '}→ nach der Buchung <strong className={`tabular-nums ${neu < 0 ? 'text-s112-err-fg' : ''}`}>{fmtNum(neu, 0)}</strong>
            {' '}({delta > 0 ? '+' : '−'}{fmtNum(Math.abs(delta), 0)} Flaschen)
          </>
        )}
        {art === 'inventur' && delta === 0 && ' – keine Differenz, nichts zu buchen'}
        {neu !== null && neu < 0 && ' – der Bestand darf nicht negativ werden'}
      </p>

      {fehler && (
        <p role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-4 py-2">{fehler}</p>
      )}
      {erfolg && (
        <p role="status" className="text-sm text-s112-ok-fg bg-s112-ok-bg border border-s112-ok/30 rounded-lg px-4 py-2">{erfolg}</p>
      )}

      <button
        type="submit"
        disabled={pending || !buchbar}
        className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50"
      >
        {pending ? 'Wird gebucht …' : 'Bestand buchen'}
      </button>
    </form>
  )
}
