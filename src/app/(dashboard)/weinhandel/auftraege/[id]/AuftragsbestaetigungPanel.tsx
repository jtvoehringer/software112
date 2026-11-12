'use client'

// KAN-418 Teil 3: Auftragsbestätigung als PDF öffnen bzw. per E-Mail an den Kunden senden (Panel wie beim
// Rechnungsversand: Empfänger vorbelegt, optionale Nachricht). Senden nur mit Schreibrecht Warenwirtschaft.

import { useId, useState } from 'react'
import { useRouter } from 'next/navigation'
import { FileText, Mail } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { AB_NACHRICHT_MAX, abEmpfaengerFehler } from '@/lib/auftrag/bestaetigung'

export default function AuftragsbestaetigungPanel({ id, nummer, defaultEmail, gesendetText, darfSenden, beleg }: {
  id: string; nummer: string; defaultEmail: string; /** „gesendet am … an …“ oder null */ gesendetText: string | null; darfSenden: boolean
  /** KAN-418 Teil 4: anderer Beleg mit demselben Ablauf (Angebot) – ohne Angabe die Auftragsbestätigung */
  beleg?: { titel: string; api: string; hinweis: string }
}) {
  const titel = beleg?.titel ?? 'Auftragsbestätigung'
  const api = beleg?.api ?? `/api/weinhandel/auftraege/${id}`
  const hinweis = beleg?.hinweis ?? 'Bestätigt werden die bestellten Flaschen und die Reservierung – ohne Preise.'
  const router = useRouter()
  const feldId = useId()
  const [offen, setOffen] = useState(false)
  const [an, setAn] = useState(defaultEmail)
  const [nachricht, setNachricht] = useState('')
  const [sendet, setSendet] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)

  async function senden() {
    const f = abEmpfaengerFehler(an)
    setFehler(f)
    if (f) return
    setSendet(true)
    try {
      const res = await fetch(`${api}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: an.trim(), message: nachricht.trim() || undefined }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setFehler(json.error ?? json.fehler ?? 'Der Versand ist fehlgeschlagen.'); return }
      // erst nach Erfolg leeren und schließen
      setOffen(false)
      setNachricht('')
      zeigeErfolg(`${titel} ${nummer} an ${json.sentTo ?? an.trim()} gesendet.`)
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e, 'Der Versand ist fehlgeschlagen'))
    } finally {
      setSendet(false)
    }
  }

  return (
    <div className="card p-5 space-y-3 print:hidden">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-sm font-semibold text-s112-text">{titel}</h2>
          <p className="text-xs text-s112-muted mt-0.5">
            {gesendetText ?? 'Noch nicht an den Kunden gesendet.'} {hinweis}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <a href={`${api}/pdf`} target="_blank" rel="noopener"
            className="inline-flex items-center gap-1.5 border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
            <FileText className="w-4 h-4" aria-hidden="true" /> {titel} (PDF)
          </a>
          {darfSenden && !offen && (
            <button type="button" onClick={() => { setOffen(true); setFehler(null) }}
              className="inline-flex items-center gap-1.5 border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
              <Mail className="w-4 h-4" aria-hidden="true" /> Per E-Mail senden
            </button>
          )}
        </div>
      </div>

      {offen && (
        <div className="border-t border-s112-border pt-3 space-y-3">
          <label className="block text-sm">
            <span className="block text-xs font-medium text-s112-text-2 mb-1">Empfänger <span className="text-s112-err">*</span></span>
            <input type="email" required value={an} onChange={e => setAn(e.target.value)} disabled={sendet} autoComplete="off"
              aria-invalid={!!fehler || undefined} aria-describedby={fehler ? `${feldId}-f` : undefined}
              placeholder="kunde@example.at" className="input w-full py-2 text-sm" />
          </label>
          <label className="block text-sm">
            <span className="block text-xs font-medium text-s112-text-2 mb-1">Nachricht (optional – ergänzt den Standardtext)</span>
            <textarea value={nachricht} onChange={e => setNachricht(e.target.value)} disabled={sendet} rows={3} maxLength={AB_NACHRICHT_MAX}
              className="input w-full py-2 text-sm" />
          </label>
          {fehler && <div id={`${feldId}-f`} role="alert" className="bg-s112-err-bg border border-s112-err/30 text-sm text-s112-err-fg rounded-lg px-3 py-2">{fehler}</div>}
          <div className="flex items-center gap-3">
            <button type="button" onClick={senden} disabled={sendet}
              className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
              {sendet ? 'Wird gesendet…' : 'Senden'}
            </button>
            <button type="button" onClick={() => { setOffen(false); setFehler(null) }} disabled={sendet}
              className="text-sm text-s112-text-2 hover:text-s112-text">Abbrechen</button>
          </div>
        </div>
      )}
    </div>
  )
}
