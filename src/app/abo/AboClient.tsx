'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { ArrowLeft } from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { createOwnStripePortalSession, starteZahlungAction, wechslePaketAction, setzeBuchhaltungsartAction, type Buchhaltungsart } from './actions'
import { PAKETE, preisText, type PaketKey } from '@/lib/pakete'

// Rückmeldung 31.8.2026 ("die Plattform soll sich selber abrechnen können,
// damit wir zu unserem Geld kommen"): Selbstverwaltungsseite für Abo und
// Zahlung - Layout/Stil analog (auth)/betrieb-waehlen/page.tsx. Seit KAN-5
// (25.9.2026) arbeitet ein gesperrter Betrieb im Nur-Lesen-Modus weiter; die
// Hinweisleiste im Arbeitsbereich verlinkt hierher.

export default function AboClient({
  aktuellesPaket,
  verfuegbarePakete,
  benutzerAnzahl,
  hardBlocked,
  trialAbgelaufen,
  warned,
  darfVerwalten,
  hasCustomer,
  hatAbo,
  planLabel,
  statusLabel,
  hatEa,
  buchhaltungsart: buchhaltungsartAktuell,
  kundennummer = null,
  betriebName = null,
}: {
  kundennummer?: string | null
  betriebName?: string | null
  aktuellesPaket:    PaketKey | null
  verfuegbarePakete: PaketKey[]
  benutzerAnzahl:    number
  hardBlocked:     boolean
  trialAbgelaufen: boolean
  warned:          boolean
  darfVerwalten:   boolean
  hasCustomer:     boolean
  hatAbo:          boolean
  planLabel:       string | null
  statusLabel:     string | null
  /** E&A-Modul aktuell aktiv (dann ist die Buchhaltungsart schon entschieden) */
  hatEa:           boolean
  /** Migration 197: 'ea' = E&A in software:112, 'doppik' = Steuerberater/BMD */
  buchhaltungsart: Buchhaltungsart
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)
  // Paketwechsel: zweistufig (Klick -> Bestätigen), damit ein Downgrade nicht
  // aus Versehen passiert.
  const [wahl, setWahl]       = useState<PaketKey | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  // KAN-5: offener Paketwechsel (Zahlung ausständig) ist kein Erfolg → Warnoptik
  const [hinweisWarnung, setHinweisWarnung] = useState(false)
  // Migration 197 (Rückmeldung 4.9.2026): kommt mit dem Paket die E&A-Rechnung
  // neu dazu, muss der Betrieb sagen, wer die Buchhaltung führt. '' = noch
  // nicht gewählt -> Bestätigen gesperrt (die Server-Action prüft zusätzlich).
  const [buchhaltungsWahl, setBuchhaltungsWahl] = useState<Buchhaltungsart | ''>('')
  const [artSpeichern, setArtSpeichern] = useState(false)
  const brauchtBuchhaltungsWahl = (k: PaketKey) => PAKETE[k].module.modul_ea && !hatEa

  async function handleBuchhaltungsart(art: Buchhaltungsart) {
    if (art === buchhaltungsartAktuell) return
    setArtSpeichern(true); setError(null); setHinweis(null)
    const res = await setzeBuchhaltungsartAction(art)
    if ('error' in res && res.error) setError(res.error)
    else {
      setHinweisWarnung(false)
      setHinweis(art === 'doppik'
        ? 'Umgestellt: Ihr Steuerberater führt die Buchhaltung in BMD – Belege übergeben Sie unter „Belege & BMD“, die UVA ist nur noch eine Vorschau.'
        : 'Umgestellt: Sie führen die E&A-Rechnung in software:112 (UVA, Monatsabschluss).')
    }
    setArtSpeichern(false)
    router.refresh()
  }

  async function handlePortal() {
    setLoading(true)
    setError(null)
    const res = await createOwnStripePortalSession()
    if ('error' in res && res.error) {
      setError(res.error)
      setLoading(false)
      return
    }
    if ('url' in res && res.url) {
      window.location.href = res.url
      return
    }
    setLoading(false)
  }

  async function handleZahlungNachholen(paket?: PaketKey) {
    setLoading(true)
    setError(null)
    const res = await starteZahlungAction(paket, buchhaltungsWahl || undefined)
    if ('error' in res && res.error) {
      setError(res.error)
      setLoading(false)
      return
    }
    if ('url' in res && res.url) {
      window.location.href = res.url
      return
    }
    setLoading(false)
  }

  async function handlePaketwechsel(paket: PaketKey) {
    setLoading(true)
    setError(null)
    setHinweis(null)
    const res = await wechslePaketAction(paket, buchhaltungsWahl || undefined)
    if ('error' in res && res.error) {
      setError(res.error)
      setLoading(false)
      return
    }
    setWahl(null)
    // KAN-5: bei offener Zahlung schaltet der Server das neue Paket erst nach Zahlungseingang frei
    setHinweisWarnung('hinweisArt' in res && res.hinweisArt === 'warnung')
    setHinweis('hinweis' in res && res.hinweis ? res.hinweis : `Ihr Paket wurde auf ${PAKETE[paket].label} umgestellt. Die Abrechnung erfolgt anteilig ab heute.`)
    setLoading(false)
    router.refresh()
  }

  function istDowngrade(paket: PaketKey): boolean {
    if (!aktuellesPaket) return false
    return PAKETE[paket].preisMonat < PAKETE[aktuellesPaket].preisMonat
  }

  // Module, die beim Wechsel wegfallen würden (Downgrade-Hinweis)
  function wegfallendeModule(paket: PaketKey): string[] {
    if (!aktuellesPaket) return []
    const alt = PAKETE[aktuellesPaket].module, neu = PAKETE[paket].module
    const namen: [keyof typeof alt, string][] = [
      ['modul_newsletter', 'Newsletter'], ['modul_ea', 'E&A-Rechnung'], ['modul_controlling', 'Controlling'],
      ['modul_export', 'Exportaufträge'], ['assistent_aktiv', 'bot:112'],
    ]
    return namen.filter(([k]) => alt[k] === true && neu[k] === false).map(([, n]) => n)
  }

  // Radio "wer macht die Buchhaltung?" (in der Paketkarte beim Wechsel/Kauf)
  function BuchhaltungsWahl({ wert, onChange }: { wert: Buchhaltungsart | ''; onChange: (a: Buchhaltungsart) => void }) {
    return (
      <div className="space-y-1.5">
        <p className="text-[11.5px] font-medium text-s112-text-1">Enthält die E&amp;A-Rechnung – wer macht Ihre Buchhaltung?</p>
        {([
          ['ea',     'Ich führe die E&A-Rechnung in software:112', 'UVA und Monatsabschluss entstehen hier.'],
          ['doppik', 'Mein Steuerberater (doppelte Buchhaltung, BMD)', 'Ich erfasse Belege, software:112 übergibt sie an BMD. UVA nur Vorschau.'],
        ] as [Buchhaltungsart, string, string][]).map(([key, label, hinweisText]) => (
          <label key={key} className={`flex items-start gap-2 cursor-pointer rounded-lg border px-2.5 py-2 text-left ${wert === key ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-line'}`}>
            <input type="radio" checked={wert === key} onChange={() => onChange(key)} className="mt-0.5" />
            <span>
              <span className="block text-[12px] font-medium text-s112-text">{label}</span>
              <span className="block text-[11px] text-s112-muted">{hinweisText}</span>
            </span>
          </label>
        ))}
      </div>
    )
  }

  async function handleLogout() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className={`w-full ${darfVerwalten && verfuegbarePakete.length > 0 ? 'max-w-3xl' : 'max-w-md'}`}>
        {/* Rückweg in die Anwendung (Rückmeldung 4.9.2026). Seit KAN-5 auch für
            gesperrte Betriebe - sie arbeiten im Nur-Lesen-Modus weiter. */}
        {hardBlocked ? (
          <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-s112-muted hover:text-s112-blue-700 mb-4">
            <ArrowLeft size={15} strokeWidth={1.75} /> Zurück zur Anwendung (Nur-Lesen-Modus)
          </Link>
        ) : (
          <Link href="/betrieb/einstellungen" className="inline-flex items-center gap-1.5 text-sm text-s112-muted hover:text-s112-blue-700 mb-4">
            <ArrowLeft size={15} strokeWidth={1.75} /> Zurück zu „Mein Betrieb“
          </Link>
        )}
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-semibold text-s112-blue-700 inline-flex items-baseline gap-0">
            software<span className="text-s112-yellow">:</span>112
          </h1>
          <p className="text-s112-muted text-sm mt-1">Abo & Zahlung</p>
          {(betriebName || kundennummer) && (
            <p className="text-xs text-s112-muted mt-1">
              {betriebName}{betriebName && kundennummer ? ' · ' : ''}{kundennummer && <>Kundennummer <span className="font-mono text-s112-text-1">{kundennummer}</span></>}
            </p>
          )}
        </div>

        <div className="card space-y-4">
          {hardBlocked && trialAbgelaufen ? (
            <div className="px-4 py-3 rounded-lg bg-s112-err-bg text-s112-err-fg text-sm">
              <p className="font-semibold mb-1">Testphase abgelaufen</p>
              <p>
                Ihre kostenlose 14-tägige Testphase ist beendet. Bitte hinterlegen Sie Ihre Zahlungsdaten,
                um software:112 weiter zu nutzen. Bis dahin arbeitet Ihr Betrieb im Nur-Lesen-Modus:
                Daten ansehen, drucken und exportieren bleibt möglich, Änderungen sind gesperrt.
              </p>
            </div>
          ) : hardBlocked ? (
            <div className="px-4 py-3 rounded-lg bg-s112-err-bg text-s112-err-fg text-sm">
              <p className="font-semibold mb-1">Nur-Lesen-Modus</p>
              <p>
                Ihr Betrieb hat aktuell kein aktives Abo{statusLabel ? ` (Status: ${statusLabel})` : ''}.
                Daten ansehen, drucken und exportieren bleibt möglich; Änderungen, KI-Abfragen und der
                Assistent sind gesperrt, bis die Zahlungsdaten aktualisiert sind.
              </p>
            </div>
          ) : warned ? (
            <div className="px-4 py-3 rounded-lg bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg text-sm">
              <p className="font-semibold mb-1">Problem mit der letzten Zahlung</p>
              <p>
                Bitte aktualisieren Sie Ihre Zahlungsdaten zeitnah, um eine Sperre zu vermeiden.
              </p>
            </div>
          ) : (
            <div className="px-4 py-3 rounded-lg bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg text-sm">
              <p className="font-semibold">Ihr Abo ist aktiv.</p>
              {planLabel && <p className="mt-0.5">Aktueller Plan: {planLabel}</p>}
            </div>
          )}

          {darfVerwalten ? (
            hatAbo ? (
              <button
                onClick={handlePortal}
                disabled={loading}
                className="w-full bg-s112-teal text-s112-yellow px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-60"
              >
                {loading ? 'Wird geöffnet…' : 'Zahlungsdaten verwalten'}
              </button>
            ) : hasCustomer ? (
              // Self-Service-Signup ohne abgeschlossenen Checkout: noch kein
              // Abo vorhanden - das Customer-Portal (oben) hätte hier nichts
              // zu verwalten. Startet stattdessen einen neuen Checkout inkl.
              // der vollen 14-tägigen Testphase.
              <button
                onClick={() => handleZahlungNachholen()}
                disabled={loading}
                className="w-full bg-s112-teal text-s112-yellow px-4 py-2.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-60"
              >
                {loading ? 'Wird geöffnet…' : 'Jetzt Zahlungsdaten hinterlegen'}
              </button>
            ) : (
              <p className="text-sm text-s112-muted">
                Für Ihren Betrieb ist noch kein Zahlungskonto hinterlegt. Bitte kontaktieren Sie uns, damit wir Ihr Abo einrichten.
              </p>
            )
          ) : (
            <p className="text-sm text-s112-muted">
              Nur der Betriebs-Manager kann die Zahlungsdaten verwalten. Bitte wenden Sie sich an Ihren Betriebs-Manager.
            </p>
          )}

          {error && (
            <p className="text-sm text-s112-err-fg">{error}</p>
          )}
          {hinweis && (
            <p role="status" className={hinweisWarnung
              ? 'text-sm text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2'
              : 'text-sm text-s112-ok-fg bg-s112-ok-bg border border-s112-ok/30 rounded-lg px-3 py-2'}>{hinweis}</p>
          )}

          {/* Paketwahl / -wechsel (Paketmodell Basis · Standard · Premium, 2.9.2026) */}
          {darfVerwalten && verfuegbarePakete.length > 0 && (
            <div className="pt-2">
              <p className="text-sm font-semibold text-s112-text mb-2">
                {hatAbo ? 'Paket wechseln' : 'Paket wählen'}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {verfuegbarePakete.map(k => {
                  const p = PAKETE[k]
                  const aktiv = aktuellesPaket === k
                  const wegfall = wegfallendeModule(k)
                  const ueberBenutzer = p.maxBenutzer !== null && benutzerAnzahl > p.maxBenutzer
                  return (
                    <div key={k} className={`rounded-xl border p-3.5 flex flex-col ${aktiv ? 'border-s112-teal ring-1 ring-s112-teal bg-s112-teal/5' : 'border-s112-line'}`}>
                      <div className="flex items-baseline justify-between">
                        <p className="font-semibold text-s112-text">{p.label}</p>
                        {aktiv && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-s112-blue-700">Aktuell</span>}
                      </div>
                      <p className="text-s112-blue-700 font-medium text-sm">{preisText(p)}</p>
                      <ul className="text-[11.5px] text-s112-muted mt-2 space-y-0.5 flex-1">
                        {p.leistungen.map(l => <li key={l}>· {l}</li>)}
                      </ul>
                      {!aktiv && (
                        hatAbo ? (
                          wahl === k ? (
                            <div className="mt-3 space-y-1.5">
                              {istDowngrade(k) && (
                                <p className="text-[11.5px] text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-md px-2 py-1.5">
                                  {wegfall.length > 0 && <>Nicht mehr enthalten: {wegfall.join(', ')}. Ihre Daten bleiben erhalten.<br /></>}
                                  {ueberBenutzer && <>Sie haben {benutzerAnzahl} aktive Benutzer, das Paket umfasst {p.maxBenutzer}. Bestehende bleiben aktiv, neue können nicht eingeladen werden.</>}
                                  {!wegfall.length && !ueberBenutzer && 'Ihr Abo wird ab sofort anteilig auf das neue Paket umgestellt.'}
                                </p>
                              )}
                              {brauchtBuchhaltungsWahl(k) && <BuchhaltungsWahl wert={buchhaltungsWahl} onChange={setBuchhaltungsWahl} />}
                              <button onClick={() => handlePaketwechsel(k)} disabled={loading || (brauchtBuchhaltungsWahl(k) && !buchhaltungsWahl)}
                                className="w-full bg-s112-teal text-s112-yellow px-3 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-60">
                                {loading ? 'Wird umgestellt…' : 'Wechsel bestätigen'}
                              </button>
                              <button onClick={() => setWahl(null)} disabled={loading}
                                className="w-full text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
                            </div>
                          ) : (
                            <button onClick={() => { setWahl(k); setBuchhaltungsWahl(''); setError(null); setHinweis(null) }} disabled={loading}
                              className="mt-3 w-full border border-s112-teal text-s112-blue-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/5 disabled:opacity-60">
                              {istDowngrade(k) ? 'Auf dieses Paket wechseln' : 'Upgrade'}
                            </button>
                          )
                        ) : hasCustomer ? (
                          brauchtBuchhaltungsWahl(k) ? (
                            wahl === k ? (
                              <div className="mt-3 space-y-1.5">
                                <BuchhaltungsWahl wert={buchhaltungsWahl} onChange={setBuchhaltungsWahl} />
                                <button onClick={() => handleZahlungNachholen(k)} disabled={loading || !buchhaltungsWahl}
                                  className="w-full bg-s112-teal text-s112-yellow px-3 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-60">
                                  {loading ? 'Weiter zu Stripe…' : 'Weiter zur Zahlung'}
                                </button>
                                <button onClick={() => setWahl(null)} disabled={loading}
                                  className="w-full text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
                              </div>
                            ) : (
                              <button onClick={() => { setWahl(k); setBuchhaltungsWahl(''); setError(null); setHinweis(null) }} disabled={loading}
                                className="mt-3 w-full border border-s112-teal text-s112-blue-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/5 disabled:opacity-60">
                                Auswählen
                              </button>
                            )
                          ) : (
                            <button onClick={() => handleZahlungNachholen(k)} disabled={loading}
                              className="mt-3 w-full border border-s112-teal text-s112-blue-700 px-3 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/5 disabled:opacity-60">
                              Auswählen
                            </button>
                          )
                        ) : null
                      )}
                    </div>
                  )
                })}
              </div>
              {hatAbo && (
                <p className="text-[11.5px] text-s112-muted mt-2">
                  Ein Wechsel wird sofort wirksam und anteilig abgerechnet. Kündigung und Rechnungen finden Sie unter „Zahlungsdaten verwalten".
                </p>
              )}
            </div>
          )}

          {/* Buchhaltungsart (Migration 197): jederzeit umstellbar, gleiche Einstellung wie in der Administration */}
          {darfVerwalten && hatEa && (
            <div className="pt-2 border-t border-s112-line">
              <p className="text-sm font-semibold text-s112-text mb-1">Buchhaltung</p>
              <p className="text-[11.5px] text-s112-muted mb-2">Wer macht die Buchhaltung Ihres Betriebs? Kann jederzeit umgestellt werden – Ihre Belege bleiben erhalten.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {([
                  ['ea',     'E&A-Rechnung in software:112',                  'UVA, Monatsabschluss und Jahresergebnis entstehen hier.'],
                  ['doppik', 'Doppelte Buchhaltung beim Steuerberater (BMD)', 'Sie erfassen Belege, software:112 übergibt sie an BMD. UVA nur als Vorschau.'],
                ] as [Buchhaltungsart, string, string][]).map(([key, label, hinweisText]) => (
                  <label key={key} className={`flex items-start gap-2 cursor-pointer rounded-xl border px-3 py-2.5 ${buchhaltungsartAktuell === key ? 'border-s112-teal ring-1 ring-s112-teal bg-s112-teal/5' : 'border-s112-line'}`}>
                    <input type="radio" name="buchhaltungsart" checked={buchhaltungsartAktuell === key} disabled={artSpeichern}
                      onChange={() => handleBuchhaltungsart(key)} className="mt-1" />
                    <span>
                      <span className="block text-sm font-medium text-s112-text">{label}</span>
                      <span className="block text-[11px] text-s112-muted">{hinweisText}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <button
            onClick={handleLogout}
            className="w-full text-center text-xs text-s112-muted hover:text-s112-blue-700 transition-colors pt-2"
          >
            Abmelden
          </button>
        </div>
      </div>
    </div>
  )
}
