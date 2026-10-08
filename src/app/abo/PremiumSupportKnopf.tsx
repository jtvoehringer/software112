'use client'

// KAN-226 Teil 2: Premium-Support buchen bzw. kündigen (Betriebsleitung, nur mit Stripe-Preis und Abo).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { premiumSupportBuchenAction, premiumSupportKuendigenAction } from './actions'

export default function PremiumSupportKnopf({ gebucht, preisNetto, monatsende }: { gebucht: boolean; preisNetto: number; monatsende: string }) {
  const router = useRouter()
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, starten] = useTransition()

  const ausfuehren = () => {
    const frage = gebucht
      ? `Premium-Support zum Monatsende (${monatsende}) kündigen? Bis dahin bleibt er aktiv.`
      : `Premium-Support für ${preisNetto} € netto pro Monat buchen? Der laufende Monat wird anteilig verrechnet; monatlich kündbar.`
    if (!confirm(frage)) return
    setFehler(null)
    starten(async () => {
      const r = gebucht ? await premiumSupportKuendigenAction() : await premiumSupportBuchenAction()
      if ('error' in r && r.error) { setFehler(r.error); return }
      router.refresh()
    })
  }

  return (
    <div className="pt-2 space-y-1">
      <button type="button" onClick={ausfuehren} disabled={laeuft}
        className={gebucht
          ? 'text-sm border border-s112-border text-s112-text-1 px-3 py-1.5 rounded-lg hover:bg-s112-bg disabled:opacity-50'
          : 'btn-primary text-sm disabled:opacity-50'}>
        {laeuft ? 'Wird ausgeführt …' : gebucht ? 'Zum Monatsende kündigen' : 'Premium-Support buchen'}
      </button>
      {fehler && <p className="text-sm text-s112-err-fg" role="alert">{fehler}</p>}
    </div>
  )
}
