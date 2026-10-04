'use client'

// ── Prüfnummer bzw. DAC-Antrag einer Füllung einmal nachtragen (KAN-101, 04.10.2026) ─────────────────────
// Nur Anträge der Charge der Füllung (eingereicht, in Prüfung, zugeteilt). Zugeteilt: die Nummer kommt aus dem Antrag;
// eingereicht: Verknüpfung ohne Nummer (vorläufig) – nach dem Bescheid hier erneut „Prüfnummer übernehmen“.
// Prüfung im Server (pruefnummerNachtragen, KAN-72-Datumsregeln) und in der Datenbank (s112_fuellung_nachtragen).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { pnStatusLabel } from '@/lib/dac/workflow'

export type NachtragAntrag = { id: string; bezeichnung: string; status: string; pruefnummer: string | null }

export default function PruefnummerNachtragen({ antraege, verknuepftId, nachtragen }: {
  antraege: NachtragAntrag[]
  /** bereits verknüpfter Antrag (eingereicht, ohne Nummer) */
  verknuepftId: string | null
  nachtragen: (dacAntragId: string) => Promise<{ pruefnummer: string | null }>
}) {
  const router = useRouter()
  const [wahl, setWahl] = useState(verknuepftId ?? antraege[0]?.id ?? '')
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const gewaehlt = antraege.find(a => a.id === wahl) ?? null
  const zugeteilt = gewaehlt ? ['genehmigt', 'erloschen', 'aufgebraucht'].includes(gewaehlt.status) : false

  function los() {
    if (!wahl) return
    setFehler(null)
    startTransition(async () => {
      try {
        await nachtragen(wahl)
        router.refresh()
      } catch (e) {
        setFehler(fehlerText(e, 'Nachtrag fehlgeschlagen'))
      }
    })
  }

  if (antraege.length === 0) {
    return <p className="text-xs text-s112-muted">Zur Charge gibt es keinen eingereichten oder zugeteilten DAC-Antrag.</p>
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor="pn-antrag" className="block text-xs font-medium text-s112-text-2 mb-1">DAC-Antrag der Charge</label>
          <select id="pn-antrag" value={wahl} onChange={e => setWahl(e.target.value)} disabled={!!verknuepftId || pending}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm">
            {antraege.map(a => (
              <option key={a.id} value={a.id}>{a.bezeichnung} · {pnStatusLabel(a.status)}{a.pruefnummer ? ` · ${a.pruefnummer}` : ''}</option>
            ))}
          </select>
        </div>
        <button type="button" onClick={los} disabled={pending || !wahl || (!!verknuepftId && !zugeteilt)}
          className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50">
          {pending ? 'Wird eingetragen …' : zugeteilt ? 'Prüfnummer übernehmen' : 'Antrag verknüpfen'}
        </button>
      </div>
      {gewaehlt && !zugeteilt && (
        <p className="text-xs text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded px-2 py-1 inline-flex items-center gap-1">
          <AlertTriangle size={12} strokeWidth={2} />
          {verknuepftId
            ? 'Der Antrag ist noch nicht zugeteilt – die Prüfnummer lässt sich nach dem Bescheid übernehmen.'
            : 'Vorläufig: Der Antrag ist noch nicht zugeteilt – die Füllung wird ohne Prüfnummer verknüpft.'}
        </p>
      )}
      <p className="text-xs text-s112-muted">Einmalig: Danach sind DAC-Antrag und Prüfnummer der Füllung gesperrt (Korrektur nur durch die Betriebsleitung).</p>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{fehler}</p>}
    </div>
  )
}
