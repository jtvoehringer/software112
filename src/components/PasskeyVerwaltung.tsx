'use client'

// KAN-287 (10.10.2026): Passkeys des angemeldeten Benutzers – einrichten, anzeigen, entfernen. Die Abfrage läuft nur auf
// der Basis-Adresse (eine Origin je Hauptdomain in Supabase); auf einer Betriebs-Subdomain führt ein Link dorthin.
import { useCallback, useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { passkeyFehlerText, passkeyMoeglich, passkeyName, type PasskeyEintrag } from '@/lib/auth/passkey'
import { subdomainAusHost, subdomainUrl } from '@/lib/tenant/subdomain'
import { rueckfrage } from '@/lib/ui/rueckfrage'

export default function PasskeyVerwaltung() {
  const supabase = createSupabaseBrowserClient()
  const [liste, setListe] = useState<PasskeyEintrag[] | null>(null)
  const [moeglich, setMoeglich] = useState(false)
  const [basis, setBasis] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [meldung, setMeldung] = useState<string | null>(null)

  const laden = useCallback(async () => {
    const { data, error } = await supabase.auth.passkey.list()
    if (error) { setFehler(passkeyFehlerText(error)); setListe([]); return }
    setListe((data ?? []) as PasskeyEintrag[])
  }, [supabase])

  useEffect(() => {
    const sub = subdomainAusHost(window.location.host)
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Browser-Fähigkeit und Adresse erst nach dem Laden prüfen
    setMoeglich(passkeyMoeglich())
    setBasis(sub ? subdomainUrl(null, '/zwei-faktor') : null)
    if (!sub) void laden()
  }, [laden])

  const einrichten = async () => {
    setLaeuft(true); setFehler(null); setMeldung(null)
    try {
      const { data, error } = await supabase.auth.registerPasskey()
      if (error) { setFehler(passkeyFehlerText(error)); return }
      // sprechender Name statt der Vorgabe des Browsers
      if (data?.id) await supabase.auth.passkey.update({ passkeyId: data.id, friendlyName: passkeyName(navigator.userAgent, new Date().toLocaleDateString('de-AT')) })
      setMeldung('Passkey eingerichtet – ab jetzt „Mit Passkey anmelden“ auf der Anmeldeseite.')
      await laden()
    } catch (e) { setFehler(passkeyFehlerText(e)) }
    finally { setLaeuft(false) }
  }

  const entfernen = async (p: PasskeyEintrag) => {
    if (!(await rueckfrage({ titel: `Passkey „${p.friendly_name ?? 'Passkey'}“ entfernen?`, text: 'Die Anmeldung damit ist dann nicht mehr möglich.', bestaetigen: 'Entfernen', gefaehrlich: true }))) return
    setLaeuft(true); setFehler(null); setMeldung(null)
    try {
      const { error } = await supabase.auth.passkey.delete({ passkeyId: p.id })
      if (error) { setFehler(passkeyFehlerText(error)); return }
      await laden()
    } finally { setLaeuft(false) }
  }

  if (!moeglich) return null
  return (
    <div className="space-y-2 pt-2 border-t border-s112-line">
      <p className="text-xs font-semibold text-s112-text-1">Passkeys (Fingerabdruck, Gesicht, Windows Hello)</p>
      {basis ? (
        <p className="text-xs text-s112-text-2">Passkeys werden auf der Hauptadresse eingerichtet: <a href={basis} className="text-s112-blue-700 hover:underline">dort öffnen</a>.</p>
      ) : (
        <>
          <p className="text-xs text-s112-text-2">Mit einem Passkey meldest du dich auf diesem Gerät ohne Passwort an.</p>
          {liste?.map(p => (
            <div key={p.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{p.friendly_name || 'Passkey'}<span className="text-xs text-s112-muted"> · seit {new Date(p.created_at).toLocaleDateString('de-AT')}</span></span>
              <button type="button" onClick={() => entfernen(p)} disabled={laeuft} className="text-xs text-s112-err-fg hover:underline disabled:opacity-40">Entfernen</button>
            </div>
          ))}
          <button type="button" onClick={einrichten} disabled={laeuft}
            className="w-full py-2 rounded-lg text-sm font-semibold border border-s112-line-str text-s112-text-1 hover:bg-s112-bg disabled:opacity-40">
            {laeuft ? 'Bitte am Gerät bestätigen …' : 'Passkey für dieses Gerät einrichten'}
          </button>
        </>
      )}
      {meldung && <p role="status" className="text-xs text-s112-ok-fg">{meldung}</p>}
      {fehler && <p role="alert" className="text-xs text-s112-err-fg">{fehler}</p>}
    </div>
  )
}
