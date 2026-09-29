'use client'

import { useEffect, useState, useTransition } from 'react'
import { schluesselStatus, schluesselTauschen, type SchluesselStatus } from './schluessel-actions'
import { fehlerText } from '@/lib/fehler'

// Schlüsseltausch der gespeicherten Zugangsdaten (Sicherheits-Welle 2, S2b) auf /admin/system.
export default function SchluesselClient() {
  const [status, setStatus] = useState<SchluesselStatus | null>(null)
  const [ergebnis, setErgebnis] = useState<{ umgestellt: number; fehler: string[] } | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, start] = useTransition()

  useEffect(() => { schluesselStatus().then(setStatus).catch(e => setFehler(fehlerText(e))) }, [])

  const tauschen = () => start(async () => {
    setFehler(null); setErgebnis(null)
    try {
      const r = await schluesselTauschen()
      setErgebnis({ umgestellt: r.umgestellt, fehler: r.fehler }); setStatus(r.status)
    } catch (e) { setFehler(fehlerText(e)) }
  })

  const fertig = status && status.v2Aktiv && status.alt === 0

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-s112-text">Verschlüsselung der Zugangsdaten</h2>
        <button type="button" onClick={tauschen} disabled={laeuft || !status?.v2Aktiv || status.alt === 0}
          className="px-3 py-1.5 rounded-lg bg-s112-teal text-s112-yellow text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {laeuft ? 'Läuft …' : 'Jetzt umschlüsseln'}
        </button>
      </div>
      <p className="text-xs text-s112-muted mb-3">
        Postfach-Passwörter und Microsoft-Tokens werden verschlüsselt gespeichert. Mit gesetztem EMAIL_CRYPT_SECRET_V2 schreibt die App das neue Format (AES-GCM);
        dieser Schritt stellt alle noch alten Werte einmalig um. Danach kann EMAIL_CRYPT_SECRET in Vercel entfernt werden.
      </p>
      {fehler && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm mb-3">{fehler}</div>}
      {status && (
        <div className="bg-white border border-s112-border rounded-xl px-4 py-3 text-sm space-y-1">
          <p>
            Neuer Schlüssel: {status.v2Aktiv ? <span className="text-s112-ok-fg font-medium">gesetzt</span> : <span className="text-s112-err-fg font-medium">fehlt – EMAIL_CRYPT_SECRET_V2 in Vercel eintragen und neu deployen</span>}
          </p>
          <p>Werte im alten Format: <b>{status.alt}</b> · im neuen Format: <b>{status.neu}</b>{fertig && <span className="text-s112-ok-fg"> – alles umgestellt, alter Schlüssel kann entfernt werden</span>}</p>
          {ergebnis && <p className="text-s112-text-2">Umgestellt: {ergebnis.umgestellt}{ergebnis.fehler.length > 0 && `, ${ergebnis.fehler.length} Fehler`}</p>}
          {ergebnis?.fehler.map((f, i) => <p key={i} className="text-xs text-s112-err-fg">{f}</p>)}
        </div>
      )}
    </section>
  )
}
