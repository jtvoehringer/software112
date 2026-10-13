'use client'

import { gebindeOption } from '@/lib/keller/gebindeAnzeige'
import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { weinartKonflikt, WEINART_LABEL } from '@/lib/keller/weinart'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum, dezimal } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import Link from '@/components/ui/Link'
import { verschnittHinweis, type VerschnittHinweisDaten } from '@/lib/kellerbuch/verschnittHinweis'
import { heuteWien } from '@/lib/datum/wien'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'

type Gebinde = { id: string; name: string; volumen_liter?: number | null }
type Charge  = { id: string; name: string; menge_liter: number | null; behaelter_id?: string | null; rebsorte?: string | null; weinart?: string | null }

interface Props {
  chargeId:        string
  chargeName:      string
  verfuegbarLiter: number
  gebinde:         Gebinde[]
  alleChargen:     Charge[]
  action:          (fd: FormData) => Promise<{ verschnitte?: (VerschnittHinweisDaten & { zielChargeId: string | null })[]; abstufung?: { von: string; nach: string; vonLabel: string; nachLabel: string }; bestaetigung?: string } | void>
  initialOpen?:    boolean
  quelleRebsorte?: string | null
  quelleWeinart?:  string | null
}

export default function UmziehenWidget({ chargeId, chargeName, verfuegbarLiter, gebinde, alleChargen, action, initialOpen = false, quelleRebsorte = null, quelleWeinart = null }: Props) {
  const router  = useRouter()
  const [open,  setOpen]  = useState(initialOpen)
  // Rückmeldung Jörgen 07.10.2026: nach dem Buchen klar bestätigen, dass der Umzug abgeschlossen ist – das Formular
  // „Charge bearbeiten“ darunter ist kein weiterer Schritt
  const [erfolg, setErfolg] = useState<{ liter: number; gebindeId: string; gebindeName: string } | null>(null)
  // (beim Rendern statt im Effekt)
  const [initialOpenVorher, setInitialOpenVorher] = useState(initialOpen)
  if (initialOpen !== initialOpenVorher) { setInitialOpenVorher(initialOpen); setOpen(initialOpen) }
  // KAN-181: über ?form=umziehen geöffnet steht das Formular weit unten – einmalig hinscrollen
  const sectionRef = useRef<HTMLElement>(null)
  const gescrollt  = useRef(false)
  useEffect(() => {
    if (!open || !initialOpen || gescrollt.current) return
    gescrollt.current = true
    sectionRef.current?.scrollIntoView({ block: 'start' })
  }, [open, initialOpen])
  const [brutto, setBrutto] = useState('')
  const [netto,  setNetto]  = useState('')
  const [zielId, setZielId] = useState('')
  const [datum,  setDatum]  = useState(heuteWien())
  const [notizen, setNotizen] = useState('')
  const [error,  setError]  = useState<string | null>(null)
  // KAN-112: Hinweis „Als Verschnitt in … gebucht“ (statt Weiterleitung ins Verschneiden-Formular)
  const [verschnitt, setVerschnitt] = useState<{ zeilen: string[]; chargeId: string | null }[] | null>(null)
  const [pending, start]    = useTransition()

  // Freie Kapazität pro Gebinde
  const inhalt: Record<string, number> = {}
  for (const c of alleChargen) {
    if (c.behaelter_id) inhalt[c.behaelter_id] = (inhalt[c.behaelter_id] ?? 0) + (parseFloat(String(c.menge_liter)) || 0)
  }

  // Weininhalt pro Gebinde (für Dropdown-Beschriftung)
  const weinByGebinde: Record<string, string[]> = {}
  for (const c of alleChargen) {
    if (c.behaelter_id) {
      const label = c.rebsorte ? formatRebsorteMitKuerzel(c.rebsorte) : c.name
      if (!weinByGebinde[c.behaelter_id]) weinByGebinde[c.behaelter_id] = []
      if (!weinByGebinde[c.behaelter_id].includes(label)) weinByGebinde[c.behaelter_id].push(label)
    }
  }
  const frei = (g: Gebinde) =>
    g.volumen_liter != null ? Math.max(0, g.volumen_liter - (inhalt[g.id] ?? 0)) : null

  // Rebsortenmix: gibt es im Ziel-Gebinde Chargen mit anderer Rebsorte?
  const andereRebsorten = zielId && quelleRebsorte
    ? [...new Set(
        alleChargen
          .filter(c => c.behaelter_id === zielId && c.rebsorte && c.rebsorte !== quelleRebsorte)
          .map(c => c.rebsorte as string)
      )]
    : []
  const hatRebsortenmix = andereRebsorten.length > 0

  // Weinart (21.9.2026): Rot + Weiß in einem Gebinde – KAN-193: kein Sperren mehr, sondern ein Hinweis (der Server bucht
  // einen Verschnitt mit Abstufung auf Wein aus Österreich nach einer Rückfrage)
  const weinartKonfliktCharge = zielId
    ? alleChargen.find(c => c.behaelter_id === zielId && c.id !== chargeId && weinartKonflikt(quelleWeinart, c.weinart)) ?? null
    : null

  const bruttoVal = parseFloat(dezimal(brutto)) || 0
  const nettoVal  = parseFloat(dezimal(netto))  || 0
  const schwund   = bruttoVal - nettoVal

  const selectedGebinde = gebinde.find(g => g.id === zielId)
  const restKapGebinde   = selectedGebinde ? frei(selectedGebinde) : null
  const canSubmit = bruttoVal > 0 && nettoVal > 0
    && nettoVal <= bruttoVal + 0.01
    && bruttoVal <= verfuegbarLiter + 0.01
    && (restKapGebinde == null || nettoVal <= restKapGebinde + 0.01)
    && !!zielId

  function handleClose() {
    setOpen(false)
    router.push(`/kellerbuch/weinausbau/${chargeId}`)   // Abbrechen: Formular zu, auf der Charge bleiben
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setVerschnitt(null)
    const fd = new FormData()
    fd.set('quellen_json', JSON.stringify([{ weinausbau_id: chargeId, menge: bruttoVal }]))
    fd.set('ziele_json',   JSON.stringify([{ behaelter_id: zielId, menge: nettoVal }]))
    fd.set('datum',   datum)
    fd.set('notizen', notizen)
    start(async () => {
      try {
        let result = await action(fd)
        // KAN-83: Zusammenführung mit einer Charge mit Prüfnummer – nur nach Bestätigung buchen
        if (result?.bestaetigung) {
          if (!window.confirm(result.bestaetigung)) return
          fd.set('pn_bestaetigt', '1')
          fd.set('rotweiss_bestaetigt', '1')   // KAN-193: Rückfrage Rot/Weiß steht in derselben Bestätigung
          result = await action(fd)
        }
        const gebucht = { liter: nettoVal, gebindeId: zielId, gebindeName: gebinde.find(g => g.id === zielId)?.name ?? 'Ziel-Gebinde' }
        setBrutto(''); setNetto(''); setZielId(''); setNotizen('')
        if (result?.verschnitte?.length) {
          // KAN-112: abweichender Wein im Ziel-Gebinde – sofort als Verschnitt gebucht; Hinweis zeigen und Daten neu laden
          setVerschnitt(result.verschnitte.map(v => ({ zeilen: verschnittHinweis(v), chargeId: v.zielChargeId })))
          router.refresh()
        } else if (result?.abstufung) {
          // Harte Navigation (neuer Query-Parameter): ein router.push() direkt nach einer Server Action
          // kann vom impliziten Neuladen der Route überholt werden (Bugreport 5.8.2026).
          const { vonLabel, nachLabel } = result.abstufung
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- harte Navigation gewollt (siehe oben, Bugreport 5.8.2026)
          window.location.href = `/kellerbuch/weinausbau/${chargeId}?abstufung=${encodeURIComponent(`${vonLabel}→${nachLabel}`)}`
        } else {
          // Bleibt auf derselben Charge - ein bloßer Push auf dieselbe URL lädt in Next.js
          // keine frischen Serverdaten nach, hier ist das explizite refresh() nötig.
          // KAN-334 (Rückmeldung Jörgen 13.10.2026): nach dem Buchen auf der Charge bleiben – die Bestätigung zeigt das
          // Formular (setErfolg); früher ging es zur vorherigen Seite (KAN-224) und damit oft aus dem Kellerbuch hinaus
          setErfolg(gebucht)
          router.refresh()
        }
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Umziehen'))
      }
    })
  }

  if (!open && erfolg) {
    return (
      <div role="status" className="bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg rounded-lg px-4 py-3 text-sm flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold">Umzug gebucht: {fmtNum(erfolg.liter, { max: 2 })} L nach {erfolg.gebindeName}.</span>
        <span>Der Vorgang ist abgeschlossen – es ist nichts weiter zu speichern.</span>
        <Link href={`/kellerbuch/behaelter/${erfolg.gebindeId}/bewegungen`} className="underline">Ziel-Gebinde ansehen</Link>
        <button type="button" onClick={() => setErfolg(null)} className="ml-auto text-xs underline">Schließen</button>
      </div>
    )
  }
  if (!open) return null

  return (
    <section ref={sectionRef} className="scroll-mt-4">
      <h2 className="font-semibold text-s112-text mb-3">Umziehen</h2>
      <div className="card space-y-4">
        {error && (
          <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-4 py-2.5 text-sm">{error}</div>
        )}
        {verschnitt && (
          <div role="status" className="bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg rounded-lg px-4 py-2.5 text-sm space-y-1">
            {verschnitt.map((b, k) => (
              <div key={k} className="space-y-1">
                {b.zeilen.map((z, i) => <p key={i} className={i === 0 ? 'font-semibold' : 'text-xs'}>{z}</p>)}
                {b.chargeId && b.chargeId !== chargeId && (
                  <p className="text-xs"><Link href={`/kellerbuch/weinausbau/${b.chargeId}`} className="underline">Zur Ziel-Charge</Link></p>
                )}
              </div>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Datum *</label>
              <ZukunftsDatum aria-label="Datum" value={datum} onChange={e => setDatum(e.target.value)} className="form-input py-2.5 sm:py-2 text-base sm:text-sm" required />
            </div>
            <div>
              <label className="form-label">Notizen</label>
              <input aria-label="Notizen" type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
                placeholder="z.B. Abstich nach Gärung …" className="form-input py-2.5 sm:py-2 text-base sm:text-sm" />
            </div>
          </div>

          {/* Quelle – gesperrt */}
          <div>
            <label className="form-label">Quelle (diese Partie)</label>
            <div className="form-input py-2.5 sm:py-2 text-base sm:text-sm bg-s112-bg text-s112-text-2 cursor-not-allowed select-none">{chargeName}</div>
            <p className="text-xs text-s112-muted mt-1">
              Verfügbar: <span className="text-s112-blue-700 font-medium">
                {fmtNum(verfuegbarLiter, { max: 2 })} L
              </span>
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="form-label">Brutto (Liter) *</label>
              <input required aria-label="Brutto (Liter)" type="text" inputMode="decimal" value={brutto}
                onChange={e => setBrutto(e.target.value)} placeholder="z.B. 1.200" className="form-input py-2.5 sm:py-2 text-base sm:text-sm" />
              {bruttoVal > verfuegbarLiter + 0.01 && (
                <p className="text-xs text-s112-err-fg mt-1">Überschreitet verfügbaren Bestand</p>
              )}
            </div>
            <div>
              <label className="form-label">Netto (Liter) *</label>
              <input required aria-label="Netto (Liter)" type="text" inputMode="decimal" value={netto}
                onChange={e => setNetto(e.target.value)} placeholder="z.B. 1.190" className="form-input py-2.5 sm:py-2 text-base sm:text-sm" />
              {nettoVal > bruttoVal + 0.01 && (
                <p className="text-xs text-s112-err-fg mt-1">Netto &gt; Brutto nicht erlaubt</p>
              )}
            </div>
          </div>

          {/* Schwund-Vorschau */}
          {bruttoVal > 0 && nettoVal > 0 && nettoVal <= bruttoVal + 0.01 && (
            <div className="bg-s112-bg border border-s112-border rounded-lg px-4 py-2 text-sm flex justify-between">
              <span className="text-s112-muted">Schwund:</span>
              <span className="font-medium tabular-nums">
                {fmtNum(schwund, 2)} L
              </span>
            </div>
          )}

          {/* Ziel-Gebinde */}
          <div>
            <label className="form-label">Ziel-Gebinde *</label>
            <select required aria-label="Ziel-Gebinde" value={zielId} onChange={e => setZielId(e.target.value)} className="form-input py-2.5 sm:py-2 text-base sm:text-sm">
              <option value="">– Gebinde wählen –</option>
              {gebinde.map(g => {
                // KAN-174 C: „Name · Inhalt – Charge | frei“ statt Kapazität
                return (
                  <option key={g.id} value={g.id}>
                    {gebindeOption({ name: g.name, inhaltLiter: inhalt[g.id] ?? 0, chargen: weinByGebinde[g.id] ?? [], volumenLiter: g.volumen_liter })}
                  </option>
                )
              })}
            </select>
            {zielId && (() => {
              const g = gebinde.find(g => g.id === zielId)
              if (!g) return null
              const inhaltJetzt = inhalt[g.id] ?? 0
              const restJetzt   = frei(g)
              const restNach    = restJetzt != null ? restJetzt - nettoVal : null
              const ueber       = restJetzt != null && nettoVal > restJetzt + 0.01
              return (
                <div className="mt-2 bg-s112-bg border border-s112-border rounded-lg px-4 py-2.5 text-xs space-y-2">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-s112-muted mb-0.5">Kapazität</p>
                      <p className="font-medium tabular-nums">{g.volumen_liter != null ? fmtNum(g.volumen_liter) + ' L' : '–'}</p>
                    </div>
                    <div>
                      <p className="text-s112-muted mb-0.5">Inhalt jetzt</p>
                      <p className="font-medium tabular-nums">{fmtNum(inhaltJetzt, { max: 1 })} L</p>
                    </div>
                    <div>
                      <p className="text-s112-muted mb-0.5">{nettoVal > 0 ? 'Rest nach Umzug' : 'Restkapazität'}</p>
                      <p className={`font-medium tabular-nums ${ueber ? 'text-s112-err-fg' : 'text-s112-blue-700'}`}>
                        {restJetzt != null ? fmtNum((nettoVal > 0 ? restNach : restJetzt)!, { max: 1 }) + ' L' : '–'}
                      </p>
                    </div>
                  </div>
                  {(weinByGebinde[g.id] ?? []).length > 0 && (
                    <div className="border-t border-s112-border/50 pt-2">
                      <p className="text-s112-muted mb-0.5">Inhalt (Wein)</p>
                      <p className="font-medium">{weinByGebinde[g.id].join(', ')}</p>
                    </div>
                  )}
                </div>
              )
            })()}
            {(() => {
              const g = gebinde.find(g => g.id === zielId)
              const f = g ? frei(g) : null
              return f != null && nettoVal > f + 0.01 ? (
                <p className="text-xs text-s112-err-fg mt-1">Netto überschreitet Restkapazität des Gebindes</p>
              ) : null
            })()}
            {weinartKonfliktCharge && (
              <div className="mt-2 bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 text-xs text-s112-warn-fg flex items-start gap-1.5">
                <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">Rot- und Weißwein werden verschnitten – Abstufung auf Wein (aus Österreich):</span>{' '}
                  „{chargeName}“ ({WEINART_LABEL[quelleWeinart ?? 'unbekannt']}) in dieses Gebinde – dort liegt „{weinartKonfliktCharge.name}“ ({WEINART_LABEL[weinartKonfliktCharge.weinart ?? 'unbekannt']}). Sind alle schon „Wein (ohne Herkunft)“, wird nicht abgestuft (KAN-170); sonst folgt beim Speichern eine Rückfrage.
                </span>
              </div>
            )}
            {hatRebsortenmix && !weinartKonfliktCharge && (
              <div className="mt-2 bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 text-xs text-s112-warn-fg flex items-start gap-1.5">
                <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">Rebsortenverschnitt:</span>{' '}
                  Das Ziel-Gebinde enthält bereits Chargen mit Rebsorte <strong>{andereRebsorten.map(r => formatRebsorteMitKuerzel(r)).join(', ')}</strong>.
                  Der Umzug wird als Verschnitt in die Charge im Ziel-Gebinde gebucht (KAN-112).
                </span>
              </div>
            )}
          </div>

          {/* KAN-181: am Handy bleibt die Leiste beim Scrollen unten sichtbar */}
          <div className="flex items-center gap-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-6 max-sm:-mb-6 max-sm:px-6 max-sm:py-3 max-sm:bg-s112-bg max-sm:border-t max-sm:border-s112-line max-sm:z-10">
            <button type="submit" disabled={!canSubmit || pending}
              className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-5 py-3 sm:py-2 rounded-xl text-base sm:text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              {pending ? 'Wird gebucht …' : 'Umzug buchen'}
            </button>
             <button type="button" onClick={handleClose}
              className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors">
              Abbrechen
            </button>
          </div>
        </form>
      </div>
    </section>
  )
}
