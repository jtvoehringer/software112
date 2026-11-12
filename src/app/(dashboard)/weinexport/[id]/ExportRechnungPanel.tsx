'use client'
// KAN-436 E1: „Rechnung stellen“ bzw. „Muster ausbuchen“ am Exportauftrag – Zustand, Gründe und die beiden Knöpfe.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { fmtEur } from '@/lib/format'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import { fehlerText } from '@/lib/fehler'
import { exportMusterBuchen, exportRechnungStellen } from './actions'

export type ExportRechnungStand = {
  /** Verkauf mit Rechnung zu diesem Exportauftrag (null = noch keine) */
  rechnung: { verkaufId: string; nummer: string | null; datum: string | null; bezahlt: boolean } | null
  /** Gründe, warum keine Rechnung entstehen kann (leer = möglich) */
  rechnungFehler: string[]
  betrag: number
  steuerfall: string | null
  mustersendung: boolean
  musterAusgebuchtAm: string | null
  musterFehler: string[]
  musterFlaschen: number
}

const tag = (d: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('.') : '–')

export default function ExportRechnungPanel({ id, referenz, stand, darfSchreiben }: { id: string; referenz: string; stand: ExportRechnungStand; darfSchreiben: boolean }) {
  const router = useRouter()
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  async function rechnungStellen() {
    if (!(await rueckfrage({
      titel: `Rechnung zum Exportauftrag ${referenz} stellen?`,
      text: `Es entsteht eine Rechnung über ${fmtEur(stand.betrag)} mit heutigem Datum, der Flaschenbestand wird abgebucht. Danach lässt sich der Exportauftrag nicht mehr bearbeiten – der Weg zurück führt über das Storno der Rechnung.`,
      bestaetigen: 'Rechnung stellen',
    }))) return
    setLaeuft(true)
    try {
      setFehler(null)
      const erg = await exportRechnungStellen(id)
      if (erg.error) { setFehler(erg.error); return }
      zeigeErfolg('Rechnung gestellt, Bestand abgebucht.')
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(false)
    }
  }

  async function musterBuchen(zurueck: boolean) {
    if (!(await rueckfrage(zurueck
      ? { titel: 'Muster zurückbuchen?', text: 'Die Flaschen kommen wieder in den Bestand; der Exportauftrag lässt sich danach wieder bearbeiten.', bestaetigen: 'Zurückbuchen' }
      : { titel: `${stand.musterFlaschen} Flaschen als Muster ausbuchen?`, text: 'Der Bestand sinkt als Entnahme mit heutigem Datum; eine Rechnung entsteht nicht. Danach lässt sich der Exportauftrag nicht mehr bearbeiten.', bestaetigen: 'Ausbuchen' }))) return
    setLaeuft(true)
    try {
      setFehler(null)
      const erg = await exportMusterBuchen(id, zurueck)
      if (erg.error) { setFehler(erg.error); return }
      zeigeErfolg(zurueck ? 'Muster zurückgebucht.' : `Muster ausgebucht (${erg.flaschen} Flaschen).`)
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(false)
    }
  }

  const knopf = 'bg-s112-teal text-s112-yellow rounded-lg px-4 py-2 text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50'
  const knopfZweit = 'border border-s112-border rounded-lg px-4 py-2 text-sm text-s112-text-1 hover:bg-s112-bg disabled:opacity-50'

  return (
    <div className="bg-white rounded-xl border border-s112-border p-5">
      <h2 className="font-semibold text-s112-text mb-3">{stand.mustersendung ? 'Mustersendung – Bestand' : 'Rechnung und Bestand'}</h2>

      {stand.mustersendung ? (
        stand.musterAusgebuchtAm ? (
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p>Muster am <span className="font-medium">{tag(stand.musterAusgebuchtAm)}</span> als Entnahme ausgebucht. Eine Rechnung gibt es bei einer Mustersendung nicht.</p>
            {darfSchreiben && <button type="button" onClick={() => musterBuchen(true)} disabled={laeuft} className={knopfZweit}>Zurückbuchen</button>}
          </div>
        ) : (
          <div className="text-sm space-y-3">
            <p className="text-s112-text-2">Eine Mustersendung bekommt keine Rechnung. Der Bestand geht als Entnahme ab, sobald du das Muster ausbuchst.</p>
            {stand.musterFehler.length > 0
              ? <ul className="list-disc pl-5 text-s112-muted">{stand.musterFehler.map((f, i) => <li key={i}>{f}</li>)}</ul>
              : darfSchreiben && <button type="button" onClick={() => musterBuchen(false)} disabled={laeuft} className={knopf}>Muster ausbuchen ({stand.musterFlaschen} Flaschen)</button>}
          </div>
        )
      ) : stand.rechnung ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p>
            Rechnung <span className="font-medium">{stand.rechnung.nummer ?? '–'}</span> vom {tag(stand.rechnung.datum)} über {fmtEur(stand.betrag)}
            {' · '}{stand.rechnung.bezahlt ? 'bezahlt' : 'offen'}{stand.steuerfall ? ` · ${stand.steuerfall}` : ''}. Der Flaschenbestand ist abgebucht.
          </p>
          <Link href={`/weinhandel/verkauf/${stand.rechnung.verkaufId}`} className={knopfZweit}>Zur Rechnung</Link>
        </div>
      ) : (
        <div className="text-sm space-y-3">
          <p className="text-s112-text-2">Noch keine Rechnung: Der Exportauftrag hat bisher weder Bestand abgebucht noch einen Beleg in der Fakturierung.</p>
          {stand.rechnungFehler.length > 0
            ? <ul className="list-disc pl-5 text-s112-muted">{stand.rechnungFehler.map((f, i) => <li key={i}>{f}</li>)}</ul>
            : darfSchreiben && <button type="button" onClick={rechnungStellen} disabled={laeuft} className={knopf}>Rechnung stellen ({fmtEur(stand.betrag)})</button>}
        </div>
      )}
      {fehler && <p role="alert" className="mt-3 text-sm text-s112-err">{fehler}</p>}
    </div>
  )
}
