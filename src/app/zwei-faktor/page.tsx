'use client'

// ── Zwei-Faktor-Anmeldung einrichten, bestätigen, verwalten (Sicherheits-Welle 2, S3) ──
// Eine Seite für drei Fälle:
//  - Faktor vorhanden, Sitzung noch Stufe aal1 → 6-stelligen Code eingeben (nach dem Passwort)
//  - kein Faktor → Authenticator-App einrichten (QR-Code scannen, Code bestätigen)
//  - Faktor vorhanden und bestätigt (aal2) → Status, entfernen
// Liegt bewusst außerhalb von (dashboard), damit die Pflicht-Weiterleitung keine Schleife bildet.

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { BetriebsPruefMelder } from '@/components/BetriebsWaechter'

type Modus = 'laden' | 'code' | 'einrichten' | 'aktiv'
type Faktor = { id: string; status: string; friendly_name?: string | null; created_at?: string }

function ZweiFaktor() {
  const router = useRouter()
  const params = useSearchParams()
  const pflicht = params.get('pflicht') === '1'
  const supabase = createSupabaseBrowserClient()

  const [modus, setModus] = useState<Modus>('laden')
  const [faktor, setFaktor] = useState<Faktor | null>(null)
  const [qr, setQr] = useState<string | null>(null)
  const [geheimnis, setGeheimnis] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  const laden = useCallback(async () => {
    setFehler(null)
    const [{ data: aal }, { data: fl, error }] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ])
    if (error) { setFehler(error.message); return }
    const bestaetigt = (fl?.totp ?? []).find(f => f.status === 'verified') as Faktor | undefined
    if (bestaetigt) {
      setFaktor(bestaetigt)
      setModus(aal?.currentLevel === 'aal2' ? 'aktiv' : 'code')
    } else {
      setFaktor(null)
      setModus('einrichten')
    }
  }, [supabase])

  useEffect(() => { void laden() }, [laden])

  const weiter = () => { router.push('/betrieb-waehlen'); router.refresh() }

  // Einrichtung starten: offene (unbestätigte) Versuche aufräumen, neuen Faktor anlegen
  const einrichtungStarten = async () => {
    setLaeuft(true); setFehler(null)
    try {
      const { data: fl } = await supabase.auth.mfa.listFactors()
      for (const f of (fl?.all ?? []).filter(f => f.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id })
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `software:112 ${new Date().toLocaleDateString('de-AT')}` })
      if (error) throw error
      setFaktor({ id: data.id, status: 'unverified' })
      setQr(data.totp.qr_code)
      setGeheimnis(data.totp.secret)
    } catch (e) { setFehler(e instanceof Error ? e.message : String(e)) }
    finally { setLaeuft(false) }
  }

  const bestaetigen = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!faktor) return
    setLaeuft(true); setFehler(null)
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: faktor.id, code: code.replace(/\s/g, '') })
    setLaeuft(false)
    if (error) { setFehler(error.message.includes('Invalid') ? 'Der Code stimmt nicht – bitte den aktuellen Code aus der App eingeben.' : error.message); return }
    setCode(''); setQr(null); setGeheimnis(null)
    weiter()
  }

  const entfernen = async () => {
    if (!faktor || !confirm('Zwei-Faktor-Anmeldung wirklich entfernen? Das Konto ist dann nur noch durch das Passwort geschützt.')) return
    setLaeuft(true); setFehler(null)
    const { error } = await supabase.auth.mfa.unenroll({ factorId: faktor.id })
    setLaeuft(false)
    if (error) { setFehler(error.message); return }
    await supabase.auth.refreshSession()
    await laden()
  }

  const abmelden = async () => { await supabase.auth.signOut(); router.push('/login') }

  const codeFeld = (
    <form onSubmit={bestaetigen} className="space-y-3">
      <div>
        <label htmlFor="mfa-code" className="block text-sm font-medium text-s112-text-1 mb-1">6-stelliger Code aus der App</label>
        <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={7}
          value={code} onChange={e => setCode(e.target.value)} placeholder="123 456"
          className="w-full border border-s112-line-str rounded-lg px-3 py-2 text-lg tracking-widest font-mono focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
      </div>
      <button type="submit" disabled={laeuft || code.replace(/\s/g, '').length !== 6}
        className="w-full bg-s112-teal text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
        {laeuft ? 'Wird geprüft …' : 'Bestätigen'}
      </button>
    </form>
  )

  return (
    <div className="min-h-screen bg-s112-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/software112-logo.svg" alt="software:112" className="h-10 w-auto mx-auto" />
        </div>
        <div className="card space-y-4">
          <h1 className="text-lg font-semibold text-s112-text">Zwei-Faktor-Anmeldung</h1>

          {modus === 'laden' && <p className="text-sm text-s112-muted">Wird geladen …</p>}

          {modus === 'code' && (
            <>
              <p className="text-sm text-s112-text-1">Öffne deine Authenticator-App (z. B. Microsoft oder Google Authenticator) und gib den aktuellen Code für software:112 ein.</p>
              {codeFeld}
            </>
          )}

          {modus === 'einrichten' && (
            <>
              {pflicht && (
                <p className="text-sm bg-s112-warn-bg text-s112-warn-fg border border-s112-warn/30 rounded-lg px-3 py-2">
                  Für Administratoren ist die Zwei-Faktor-Anmeldung Pflicht. Bitte richte sie jetzt ein – es dauert etwa zwei Minuten.
                </p>
              )}
              {!qr ? (
                <>
                  <p className="text-sm text-s112-text-1">Schützt dein Konto zusätzlich zum Passwort: Nach der Anmeldung fragt software:112 einen 6-stelligen Code aus einer App auf deinem Handy ab.</p>
                  <ol className="text-sm text-s112-text-1 list-decimal pl-5 space-y-1">
                    <li>Authenticator-App installieren (Microsoft Authenticator, Google Authenticator o. Ä.).</li>
                    <li>Hier auf „Einrichten“ klicken und den QR-Code scannen.</li>
                    <li>Den angezeigten Code eingeben.</li>
                  </ol>
                  <button type="button" onClick={einrichtungStarten} disabled={laeuft}
                    className="w-full bg-s112-teal text-white py-2 rounded-lg text-sm font-semibold disabled:opacity-40">
                    {laeuft ? 'Wird vorbereitet …' : 'Einrichten'}
                  </button>
                </>
              ) : (
                <>
                  <p className="text-sm text-s112-text-1">QR-Code mit der Authenticator-App scannen:</p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={qr} alt="QR-Code zum Einrichten der Authenticator-App" className="w-48 h-48 mx-auto bg-white p-2 rounded-lg border border-s112-line" />
                  {geheimnis && (
                    <p className="text-xs text-s112-text-2">Scannen nicht möglich? Schlüssel manuell eingeben: <span className="font-mono break-all text-s112-text">{geheimnis}</span></p>
                  )}
                  {codeFeld}
                </>
              )}
            </>
          )}

          {modus === 'aktiv' && (
            <>
              <p className="text-sm text-s112-ok-fg bg-s112-ok-bg rounded-lg px-3 py-2">Zwei-Faktor-Anmeldung ist aktiv{faktor?.created_at ? ` seit ${new Date(faktor.created_at).toLocaleDateString('de-AT')}` : ''}.</p>
              <p className="text-xs text-s112-text-2">Handy verloren oder neu? Wende dich an deinen Administrator – er kann die Einrichtung zurücksetzen.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => router.push('/profil')} className="flex-1 bg-s112-teal text-white py-2 rounded-lg text-sm font-semibold">Zurück zum Profil</button>
                <button type="button" onClick={entfernen} disabled={laeuft} className="px-3 py-2 rounded-lg text-sm border border-s112-line-str text-s112-err-fg hover:bg-s112-err-bg disabled:opacity-40">Entfernen</button>
              </div>
            </>
          )}

          {fehler && <p role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{fehler}</p>}

          <div className="pt-2 border-t border-s112-line flex justify-between text-xs">
            {modus === 'einrichten' && !pflicht ? <button type="button" onClick={weiter} className="text-s112-blue-700 hover:underline">Später</button> : <span />}
            <button type="button" onClick={abmelden} className="text-s112-text-2 hover:underline">Abmelden</button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ZweiFaktorSeite() {
  return (
    <>
      {/* KAN-30: Ziel der Zwei-Faktor-Pflicht nach einem Betriebswechsel – andere Tabs prüfen lassen */}
      <BetriebsPruefMelder />
      <Suspense fallback={null}><ZweiFaktor /></Suspense>
    </>
  )
}
