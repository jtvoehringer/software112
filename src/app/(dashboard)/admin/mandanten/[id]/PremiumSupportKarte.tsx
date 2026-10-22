'use client'

// KAN-226: Premium-Support im Reiter „Stripe“ der Mandantenverwaltung. Bis Stripe steht (KAN-11), trägt der
// Plattform-Admin Beginn und Ende von Hand ein; Kündigung wirkt zum Monatsende.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { kuendigungZumMonatsende, premiumSupportStand, premiumSupportText, PREMIUM_SUPPORT, heuteWien } from '@/lib/abo/premiumSupport'
import { setPremiumSupport } from './actions'
import { rueckfrage } from '@/lib/ui/rueckfrage'

export default function PremiumSupportKarte({ tenantId, zeitraum }: {
  tenantId: string; zeitraum: { seit: string | null; bis: string | null } | undefined
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [seit, setSeit] = useState(zeitraum?.seit ?? '')
  const [bis, setBis] = useState(zeitraum?.bis ?? '')

  if (!zeitraum) {
    return (
      <div className="card p-4 space-y-2">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Premium-Support</h2>
        <p className="text-xs text-s112-muted">Die Datenbank-Spalten für den Premium-Support fehlen noch (Migration KAN-226).</p>
      </div>
    )
  }

  const stand = premiumSupportStand(zeitraum)
  const speichern = (s: string, b: string) => {
    setFehler(null)
    startTransition(async () => {
      const r = await setPremiumSupport(tenantId, s, b)
      if (r.error) setFehler(r.error)
      else { setSeit(s); setBis(b); router.refresh() }
    })
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Premium-Support</h2>
      <p className="text-sm">
        <span className={stand.status === 'aktiv' ? 'font-semibold text-s112-ok-fg' : 'text-s112-text-2'}>{premiumSupportText(stand)}</span>
        <span className="text-s112-muted"> · {PREMIUM_SUPPORT.preisMonatNetto} € netto / Monat, monatlich kündbar</span>
      </p>
      <p className="text-xs text-s112-text-2">
        Bis zur Stripe-Anbindung von Hand pflegen: Beginn = erster Tag, Ende = letzter Tag mit Premium-Support (leer = unbefristet).
      </p>
      {fehler && <p className="text-xs text-s112-err-fg">{fehler}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="text-xs text-s112-text-2 space-y-1">
          <span>Beginn</span>
          <input type="date" value={seit} onChange={e => setSeit(e.target.value)} className="form-input text-sm w-full" />
        </label>
        <label className="text-xs text-s112-text-2 space-y-1">
          <span>Ende (leer = unbefristet)</span>
          <input type="date" value={bis} onChange={e => setBis(e.target.value)} className="form-input text-sm w-full" />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={pending} onClick={() => speichern(seit, bis)}
          className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
          {pending ? 'Wird gespeichert…' : 'Speichern'}
        </button>
        {stand.status === 'ohne' || stand.status === 'beendet' ? (
          <button type="button" disabled={pending}
            onClick={() => speichern(heuteWien(), '')}
            className="border border-s112-line-str rounded-lg px-3 py-1.5 text-xs font-medium hover:bg-s112-bg disabled:opacity-50">
            Ab heute buchen
          </button>
        ) : !stand.bis && (
          <button type="button" disabled={pending}
            onClick={async () => { const ende = kuendigungZumMonatsende(); if (await rueckfrage({ titel: `Premium-Support zum ${ende.split('-').reverse().join('.')} kündigen?`, bestaetigen: 'Kündigen', gefaehrlich: true })) speichern(stand.seit, ende) }}
            className="border border-s112-line-str rounded-lg px-3 py-1.5 text-xs font-medium text-s112-err-fg hover:bg-s112-err-bg disabled:opacity-50">
            Zum Monatsende kündigen
          </button>
        )}
      </div>
    </div>
  )
}
