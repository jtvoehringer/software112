'use client'

// Stornieren mit Pflicht-Grund (KAN-145, 30.09.2026): Die Buchung bleibt stehen und wird gekennzeichnet; der Grund
// (mind. 10 Zeichen) landet in storno_grund und im Änderungsprotokoll. Ersetzt beim Kellerbuch das bisherige
// „Löschen“ per window.confirm (LoeschenButton).

import { useId, useState } from 'react'
import { Undo2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { STORNO_GRUND_MIN, stornoGrundFehler } from '@/lib/storno/grund'

interface Props {
  /** Server Action mit dem Grund */
  action: (grund: string) => Promise<void | { error?: string }>
  /** Was passiert (z. B. „Quelle und Ziel werden zurückgebucht …“) */
  hinweis: string
  /** Beschriftung (Tooltip/Screenreader) */
  label?: string
  /** Nach Erfolg (z. B. router.refresh) */
  danach?: () => void
}

export default function StornoButton({ action, hinweis, label = 'Stornieren', danach }: Props) {
  const id = useId()
  const [offen, setOffen] = useState(false)
  const [grund, setGrund] = useState('')
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function absenden() {
    const f = stornoGrundFehler(grund)
    if (f) { setFehler(f); return }
    setFehler(null)
    setPending(true)
    try {
      const r = await action(grund.trim())
      if (r && 'error' in r && r.error) { setFehler(r.error); return }
      setOffen(false)
      setGrund('')
      danach?.()
    } catch (err) {
      setFehler(fehlerText(err, 'Storno fehlgeschlagen'))
    } finally {
      setPending(false)
    }
  }

  if (!offen) {
    return (
      <span className="inline-flex flex-col items-end gap-0.5 align-top">
        <button type="button" onClick={() => { setOffen(true); setFehler(null) }} title={label} aria-label={label}
          className="text-s112-err hover:text-s112-err-fg">
          <Undo2 className="w-4 h-4" />
        </button>
        {fehler && (
          <span role="alert" className="block text-[11px] leading-snug text-s112-err-fg w-[240px] max-w-[70vw] text-left whitespace-normal break-words">{fehler}</span>
        )}
      </span>
    )
  }

  return (
    <span className="inline-flex flex-col items-stretch gap-1 w-[280px] max-w-[80vw] text-left whitespace-normal align-top">
      <span className="text-[11px] leading-snug text-s112-text-2">{hinweis}</span>
      <label htmlFor={id} className="text-[11px] font-medium text-s112-text-1">
        Grund des Stornos <span className="text-s112-err">*</span>
      </label>
      <textarea id={id} value={grund} onChange={e => setGrund(e.target.value)} rows={2} autoFocus
        minLength={STORNO_GRUND_MIN} aria-invalid={!!fehler || undefined} aria-describedby={fehler ? `${id}-f` : undefined}
        placeholder="z. B. Menge falsch erfasst, doppelt gebucht"
        className="w-full border border-s112-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
      {fehler && <span id={`${id}-f`} role="alert" className="text-[11px] leading-snug text-s112-err-fg">{fehler}</span>}
      <span className="flex justify-end gap-2">
        <button type="button" onClick={() => { setOffen(false); setFehler(null) }} disabled={pending}
          className="text-xs text-s112-text-2 hover:text-s112-text-1 px-1">Abbrechen</button>
        <button type="button" onClick={absenden} disabled={pending}
          className="text-xs bg-s112-err text-white px-2 py-0.5 rounded font-medium disabled:opacity-50">
          {pending ? '…' : 'Stornieren'}
        </button>
      </span>
    </span>
  )
}
