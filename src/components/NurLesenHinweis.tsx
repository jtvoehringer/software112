'use client'

// ── Hinweis im Nur-Lesen-Modus (KAN-5, 25.09.2026) ────────────────────────────
// Das (dashboard)-Layout rendert diese Komponente nur, wenn das Abo des Betriebs gesperrt ist –
// NACH der AppShell, damit der Hinweis im DOM und in der Tab-Reihenfolge dort steht, wo er
// angezeigt wird (unten rechts; der Assistent ist im Nur-Lesen-Modus ausgeblendet).
// Meldet der Betriebs-Wächter (components/BetriebsWaechter.tsx) NUR_LESEN_EREIGNIS – der Server
// hat eine Server Action mit der Sperrmeldung abgelehnt bzw. der Wächter hat eine API- oder
// Supabase-Schreibanfrage zurückgehalten –, erscheint der Hinweis mit Link zum Abo. Die
// aufrufende Seite zeigt die Meldung zusätzlich an ihrer Stelle an.
//
// Barrierefreiheit: kein automatisches Ausblenden (WCAG 2.2.1) – der Hinweis bleibt, bis er
// geschlossen wird (Knopf oder Escape, solange der Fokus im Hinweis steht). Vorgelesen wird nur
// ein kurzer Satz über eine dauerhaft vorhandene Statusregion; die ausführliche Meldung steht
// schon im Formular (keine doppelte Ansage).

import { useCallback, useEffect, useState } from 'react'
import { Lock, X } from 'lucide-react'
import Link from '@/components/ui/Link'
import { NUR_LESEN_EREIGNIS, type NurLesenDetail } from '@/lib/abo/nurLesen'
import { NUR_LESEN_TITEL, sperrMeldung, type SperrArt } from '@/lib/abo/regeln'

export default function NurLesenHinweis() {
  const [art, setArt] = useState<SperrArt | null>(null)
  const [ansage, setAnsage] = useState('')

  const schliessen = useCallback(() => setArt(null), [])

  useEffect(() => {
    const zeigen = (e: Event) => {
      const detail = (e as CustomEvent<NurLesenDetail | undefined>).detail
      const neu: SperrArt = detail?.sperrArt === 'ki' ? 'ki' : 'speichern'
      setArt(neu)
      // Statusregion kurz leeren, damit auch eine wiederholte gleiche Ansage vorgelesen wird
      setAnsage('')
      window.setTimeout(() => setAnsage(neu === 'ki' ? `${NUR_LESEN_TITEL}: KI nicht verfügbar.` : `${NUR_LESEN_TITEL}: nicht gespeichert.`), 50)
    }
    window.addEventListener(NUR_LESEN_EREIGNIS, zeigen)
    return () => window.removeEventListener(NUR_LESEN_EREIGNIS, zeigen)
  }, [])

  return (
    <>
      {/* dauerhaft vorhanden, damit Vorleseprogramme Änderungen zuverlässig ansagen */}
      <div role="status" aria-live="polite" className="sr-only">{ansage}</div>
      {art && (
        <div
          role="region" aria-labelledby="nur-lesen-titel"
          onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); schliessen() } }}
          className="fixed z-900 bottom-4 right-4 left-4 sm:left-auto sm:max-w-sm bg-white border border-s112-err/30 rounded-xl shadow-2xl p-4 flex gap-3 print:hidden">
          <span className="w-9 h-9 rounded-full bg-s112-err-bg text-s112-err-fg flex items-center justify-center shrink-0" aria-hidden="true">
            <Lock size={18} strokeWidth={1.75} />
          </span>
          <div className="flex-1 min-w-0 space-y-1.5">
            <p id="nur-lesen-titel" className="text-sm font-semibold text-s112-text">
              {art === 'ki' ? `${NUR_LESEN_TITEL} – KI nicht verfügbar` : `${NUR_LESEN_TITEL} – nicht gespeichert`}
            </p>
            <p className="text-sm text-s112-text-1">{sperrMeldung(art)}</p>
            <Link href="/abo" onClick={schliessen} className="inline-block text-sm font-semibold text-s112-blue-700 underline">Zum Abo →</Link>
          </div>
          <button type="button" onClick={schliessen} aria-label="Hinweis schließen" title="Hinweis schließen"
            className="self-start p-1 rounded-md text-s112-muted hover:text-s112-text hover:bg-s112-bg">
            <X size={16} strokeWidth={1.75} aria-hidden="true" />
          </button>
        </div>
      )}
    </>
  )
}
