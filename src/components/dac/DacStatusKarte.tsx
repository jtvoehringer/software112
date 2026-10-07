'use client'

// ── Statuswechsel des Prüfnummernantrags (KAN-97, 04.10.2026) ──────────────────────────────────────────
// Knöpfe nur für die zulässigen Übergänge (PN_UEBERGAENGE – dieselbe Matrix wie die RPC); je Wechsel Datum,
// bei „Zugeteilt“ die Prüfnummer, bei „Entzogen“ ein Grund (Pflicht). Darunter der Verlauf aus pruefnummer_ereignisse.
// Im Endstatus: „Als neuen Entwurf kopieren“.

import { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { PN_UEBERGAENGE, PN_UEBERGANG_KNOPF, istPnStatus, pnEndstatus, pnFormatHinweis, pnStatusLabel, pnUebergangAngaben, type PnStatus } from '@/lib/dac/workflow'

export type PnEreignis = {
  id: string
  status_alt: string | null
  status_neu: string | null
  datum: string
  pruefnummer: string | null
  grund: string | null
  benutzer_name: string | null
  erstellt_am: string
}

const heute = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Vienna' })
const datumDe = (d: string) => new Date(d).toLocaleDateString('de-AT')

/** Pflichtangaben, die vor dem Einreichen fehlen – Antragsformular mit Link, die übrigen stehen unten im Formular */
export function EinreichCheckliste({ fehlend, antragHref }: { fehlend: string[]; antragHref?: string }) {
  const formular = fehlend.filter(f => f.startsWith('Antragsformular') || f.startsWith('Antragsteller') || ['Farbe', 'Mostgewicht (Lesegradation)', 'Einreichmenge', 'Qualitätsstufe', 'Weinbaugebiet (Herkunft)'].includes(f))
  const antrag = fehlend.filter(f => !formular.includes(f))
  return (
    <div role="status" className="rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-3 py-2 text-sm text-s112-warn-fg space-y-1.5">
      <p className="font-semibold">Vor dem Einreichen fehlt noch:</p>
      {antrag.length > 0 && (
        <p>Im Antrag unten: {antrag.join(', ')} – eintragen und „Speichern“.</p>
      )}
      {formular.length > 0 && (
        <p>
          Im Antragsformular: {formular.map(f => f.replace(' (Prüfnummernantrag) speichern', ' noch nicht gespeichert')).join(', ')}
          {antragHref && <>{' – '}<Link href={antragHref} className="font-semibold underline">Antragsformular öffnen</Link>, ausfüllen und speichern.</>}
        </p>
      )}
    </div>
  )
}

export default function DacStatusKarte({ status, pruefnummer, ereignisse, schreiben, storniert, setzen, kopieren, einreichFehlend = [], antragHref }: {
  status: string
  pruefnummer: string | null
  ereignisse: PnEreignis[]
  schreiben: boolean
  storniert: boolean
  setzen: (eingabe: { status: string; datum: string | null; pruefnummer?: string | null; grund?: string | null }) => Promise<void>
  kopieren: () => Promise<{ id: string }>
  /** Rückmeldung Jörgen 07.10.2026: was vor dem Einreichen noch fehlt (pnPflichtFehlend) – nur im Entwurf */
  einreichFehlend?: string[]
  /** Link zum Antragsformular (Prüfnummernantrag) */
  antragHref?: string
}) {
  const router = useRouter()
  const [ziel, setZiel] = useState<PnStatus | null>(null)
  const [datum, setDatum] = useState(heute())
  const [nr, setNr] = useState(pruefnummer ?? '')
  const [grund, setGrund] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const moeglich = !storniert && istPnStatus(status) ? PN_UEBERGAENGE[status] : []
  const angaben = ziel ? pnUebergangAngaben(ziel) : null

  function waehle(s: PnStatus) {
    setZiel(s); setFehler(null); setDatum(heute()); setNr(pruefnummer ?? ''); setGrund('')
  }

  function bestaetigen() {
    if (!ziel || !angaben) return
    if (angaben.pruefnummer === 'pflicht' && !nr.trim()) { setFehler('Bitte die zugeteilte Prüfnummer angeben.'); return }
    if (angaben.grundPflicht && grund.trim().length < 10) { setFehler('Bitte einen Grund angeben (mindestens 10 Zeichen).'); return }
    startTransition(async () => {
      setFehler(null)
      try {
        await setzen({ status: ziel, datum, pruefnummer: angaben.pruefnummer === 'nein' ? null : nr, grund })
        setZiel(null)
        router.refresh()
      } catch (e) {
        setFehler(fehlerText(e, 'Statuswechsel fehlgeschlagen'))
        router.refresh()   // Checkliste mit dem aktuellen Stand
      }
    })
  }

  function kopie() {
    startTransition(async () => {
      setFehler(null)
      try {
        const { id } = await kopieren()
        router.push(`/dac/${id}`)
      } catch (e) {
        setFehler(fehlerText(e, 'Kopieren fehlgeschlagen'))
      }
    })
  }

  return (
    <div className="card space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Ablauf</h2>
        <span className="text-sm font-medium">{storniert ? 'Storniert' : pnStatusLabel(status)}</span>
      </div>

      {/* Rückmeldung Jörgen 07.10.2026: vor dem Einreichen zeigen, was fehlt und wo man es nachträgt */}
      {schreiben && !storniert && status === 'entwurf' && einreichFehlend.length > 0 && (
        <EinreichCheckliste fehlend={einreichFehlend} antragHref={antragHref} />
      )}

      {schreiben && moeglich.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {moeglich.map(s => (
            <button key={s} type="button" onClick={() => waehle(s)} disabled={pending}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors disabled:opacity-50 ${ziel === s ? 'bg-s112-teal text-s112-yellow border-s112-teal' : 'border-s112-border hover:bg-s112-bg'}`}>
              {PN_UEBERGANG_KNOPF[s]}
            </button>
          ))}
        </div>
      )}

      {ziel && angaben && (
        <div className="rounded-lg border border-s112-border bg-s112-bg p-3 space-y-3">
          <p className="text-sm">Status „{pnStatusLabel(status)}“ → „{pnStatusLabel(ziel)}“</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="form-label" htmlFor="pn-datum">{angaben.datumLabel}</label>
              <input id="pn-datum" type="date" max={heute()} value={datum} onChange={e => setDatum(e.target.value)} className="form-input" />
            </div>
            {angaben.pruefnummer !== 'nein' && (
              <div>
                <label className="form-label" htmlFor="pn-nr">Prüfnummer{angaben.pruefnummer === 'pflicht' ? ' *' : ''}</label>
                <input id="pn-nr" type="text" value={nr} onChange={e => setNr(e.target.value)} className="form-input font-mono" />
                {pnFormatHinweis(nr) && <p className="text-xs text-s112-warn-fg mt-1">{pnFormatHinweis(nr)}</p>}
              </div>
            )}
          </div>
          <div>
            <label className="form-label" htmlFor="pn-grund">Grund / Anmerkung{angaben.grundPflicht ? ' *' : ''}</label>
            <input id="pn-grund" type="text" value={grund} onChange={e => setGrund(e.target.value)} className="form-input" />
          </div>
          {ziel === 'eingereicht' && einreichFehlend.length > 0 && <EinreichCheckliste fehlend={einreichFehlend} antragHref={antragHref} />}
          {ziel === 'eingereicht' && (
            <p className="text-xs text-s112-muted">Einreichen geht nur mit vollständigen Pflichtangaben und gespeichertem Antragsformular – fehlt etwas, erscheint die Liste. Ab der Einreichung sind Antrags- und Weinangaben, Menge und Charge gesperrt (§ 25 Abs. 6 WeinG); Prüf-, Antrags- und Untersuchungsnummer bleiben bis zur Zuteilung änderbar.</p>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={bestaetigen} disabled={pending}
              className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
              {pending ? 'Wird gespeichert …' : 'Status setzen'}
            </button>
            <button type="button" onClick={() => setZiel(null)} className="text-sm text-s112-muted hover:text-s112-text-1">Abbrechen</button>
          </div>
        </div>
      )}

      {schreiben && (storniert || pnEndstatus(status)) && (
        <button type="button" onClick={kopie} disabled={pending}
          className="border border-s112-border px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-s112-bg disabled:opacity-50">
          Als neuen Entwurf kopieren
        </button>
      )}

      {fehler && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {fehler}</div>}

      {ereignisse.length > 0 && (
        <div>
          <h3 className="text-xs font-semibold text-s112-muted mb-2">Verlauf</h3>
          <ul className="space-y-1.5 text-sm">
            {ereignisse.map(e => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="tabular-nums text-s112-muted">{datumDe(e.datum)}</span>
                <span className="font-medium">{pnStatusLabel(e.status_alt)} → {pnStatusLabel(e.status_neu)}</span>
                {e.pruefnummer && <span className="font-mono text-xs self-center">{e.pruefnummer}</span>}
                {e.grund && <span className="text-s112-text-2">– {e.grund}</span>}
                <span className="text-xs text-s112-muted self-center">
                  ({e.benutzer_name ?? 'unbekannt'}, {new Date(e.erstellt_am).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'short', timeStyle: 'short' })})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
