'use client'

// KAN-87: Startuhrzeit, Ende, Anwender und Art der Verwendung – Neu und Bearbeiten. Die Prüfung macht die Server
// Action (anwendungSpalten), das Formular zeigt Pflicht und den Hinweis „Nacherfassung (+n h)“ schon vorher.

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  ANWENDER_FREMD, ART_VERWENDUNG, ART_VERWENDUNG_LABEL, erfassungsverzugH, nacherfassungHinweis,
} from '@/lib/behandlungen/erfassungsfrist'

export type MitgliedAuswahl = { id: string; name: string }

const feld = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

export default function AnwendungFelder({
  mitglieder, ichId, mitPsm, fristRelevant = mitPsm, bienengefaehrlich, datum, datumBis, fristH, vorschau = true,
  start = {},
}: {
  mitglieder: MitgliedAuswahl[]
  /** angemeldeter Benutzer – Vorbelegung Anwender */
  ichId: string | null
  /** Maßnahme mit Pflanzenschutzmittel: Art der Verwendung */
  mitPsm: boolean
  /** Erfassungsfrist gilt (Pflanzenschutz und Düngung): Hinweis „Nacherfassung“ */
  fristRelevant?: boolean
  bienengefaehrlich: boolean
  datum: string
  datumBis: string
  fristH: number
  /** Neu: Hinweis „Nacherfassung“ vor dem Speichern; Bearbeiten: aus (erfasst am steht fest) */
  vorschau?: boolean
  start?: { uhrzeitVon?: string | null; uhrzeitBis?: string | null; durchgefuehrtVon?: string | null; anwenderName?: string | null; artVerwendung?: string | null }
}) {
  const [von, setVon] = useState((start.uhrzeitVon ?? '').slice(0, 5))
  const [bis, setBis] = useState((start.uhrzeitBis ?? '').slice(0, 5))
  const [wahl, setWahl] = useState(start.anwenderName ? ANWENDER_FREMD : (start.durchgefuehrtVon ?? ichId ?? ''))
  const [fremd, setFremd] = useState(start.anwenderName ?? '')
  const [jetzt, setJetzt] = useState<number | null>(null)
  // Uhrzeit erst im Browser (kein Hydration-Unterschied), danach jede Minute
  useEffect(() => {
    const erst = setTimeout(() => setJetzt(Date.now()), 0)
    const t = setInterval(() => setJetzt(Date.now()), 60000)
    return () => { clearTimeout(erst); clearInterval(t) }
  }, [])

  const hinweis = vorschau && fristRelevant && datum && jetzt !== null
    ? nacherfassungHinweis(erfassungsverzugH({ datum, datumBis: datumBis || null }, jetzt), fristH)
    : null
  // ein früherer Anwender, der nicht mehr Mitglied ist, bleibt wählbar
  const optionen = start.durchgefuehrtVon && !mitglieder.some(m => m.id === start.durchgefuehrtVon)
    ? [...mitglieder, { id: start.durchgefuehrtVon, name: 'früheres Mitglied' }]
    : mitglieder

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-s112-text-1 mb-1">
            Startuhrzeit{bienengefaehrlich && <span className="text-s112-err"> *</span>}
          </label>
          <input aria-label="Startuhrzeit" name="uhrzeit_von" type="time" value={von} required={bienengefaehrlich}
            onChange={e => setVon(e.target.value)} className={feld} />
          {bienengefaehrlich && <p className="text-xs text-s112-warn-fg mt-1">Bienengefährliches Mittel – Startuhrzeit ist Pflicht.</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-s112-text-1 mb-1">Ende (Uhrzeit)</label>
          <input aria-label="Ende (Uhrzeit)" name="uhrzeit_bis" type="time" value={bis}
            onChange={e => setBis(e.target.value)} className={feld} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-s112-text-1 mb-1">Anwender</label>
          <select aria-label="Anwender" name="anwender" value={wahl} onChange={e => setWahl(e.target.value)} className={feld}>
            {!ichId && <option value="">– angemeldeter Benutzer –</option>}
            {optionen.map(m => <option key={m.id} value={m.id}>{m.name}{m.id === ichId ? ' (ich)' : ''}</option>)}
            <option value={ANWENDER_FREMD}>Fremdanwender …</option>
          </select>
          {wahl === ANWENDER_FREMD && (
            <input aria-label="Name des Fremdanwenders" name="anwender_name" type="text" required maxLength={120}
              value={fremd} onChange={e => setFremd(e.target.value)} placeholder="z. B. Lohnunternehmer Huber"
              className={`${feld} mt-2`} />
          )}
        </div>
        {mitPsm && (
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Art der Verwendung</label>
            <select aria-label="Art der Verwendung" name="art_verwendung" defaultValue={start.artVerwendung ?? 'freiland'} className={feld}>
              {ART_VERWENDUNG.map(a => <option key={a} value={a}>{ART_VERWENDUNG_LABEL[a]}</option>)}
            </select>
          </div>
        )}
      </div>
      {hinweis && (
        <p className="text-xs text-s112-warn-fg inline-flex items-start gap-1" role="status">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />{hinweis}
        </p>
      )}
    </div>
  )
}
