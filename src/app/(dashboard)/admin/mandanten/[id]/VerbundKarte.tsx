'use client'

// KAN-215: Abrechnungsverbund im Reiter „Stripe“ der Mandantenverwaltung – Nebenmandant über einen Hauptmandanten
// abrechnen (Standardpreis oder vereinbarter Preis), Austritt (→ Nur-Lesen bis zum eigenen Abo), Übersicht der
// Nebenmandanten eines Hauptmandanten.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import type { VerbundInfo } from './page'
import { verbundBeitreten, verbundVerlassen } from './actions'

const euro = (cent: number | null) => cent == null ? 'Standardpreis' : (cent / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }) + ' / Monat'

export default function VerbundKarte({ tenantId, tenantName, verbund, hatEigenesAbo }: {
  tenantId: string; tenantName: string; verbund: VerbundInfo; hatEigenesAbo: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [haupt, setHaupt] = useState('')
  const [preis, setPreis] = useState('')

  const ausfuehren = (f: () => Promise<{ error?: string }>) => {
    setFehler(null)
    startTransition(async () => {
      const r = await f()
      if (r.error) setFehler(r.error)
      else { setHaupt(''); setPreis(''); router.refresh() }
    })
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Abrechnungsverbund</h2>
      {fehler && <p className="text-xs text-s112-err-fg">{fehler}</p>}

      {verbund.hauptId ? (
        <div className="space-y-2 text-sm">
          <p>
            Abgerechnet über{' '}
            <Link href={`/admin/mandanten/${verbund.hauptId}`} className="font-medium text-s112-blue-700 hover:underline">{verbund.hauptName ?? 'Hauptmandant'}</Link>
            {' '}als Zusatzmandant · {euro(verbund.preisCent)}. Rechnung, Zahlungsdaten und Kündigung laufen über den Hauptmandanten.
          </p>
          <button type="button" disabled={pending}
            onClick={() => { if (confirm(`${tenantName} aus dem Verbund lösen? Der Betrieb ist danach im Nur-Lesen-Modus, bis er ein eigenes Abo abschließt (ohne neue Testphase).`)) ausfuehren(() => verbundVerlassen(tenantId)) }}
            className="border border-s112-line-str rounded-lg px-3 py-1.5 text-xs font-medium text-s112-err-fg hover:bg-s112-err-bg disabled:opacity-50">
            {pending ? 'Wird gelöst…' : 'Aus dem Verbund lösen'}
          </button>
        </div>
      ) : verbund.neben.length > 0 ? (
        <div className="text-sm space-y-1">
          <p>Hauptmandant – rechnet über sein Abo ab (Premium ist Pflicht):</p>
          <ul className="list-disc ml-5 text-s112-text-2">
            {verbund.neben.map(n => (
              <li key={n.id}><Link href={`/admin/mandanten/${n.id}`} className="text-s112-blue-700 hover:underline">{n.name}</Link> · {euro(n.preisCent)}</li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-s112-text-2">
            {tenantName} als Zusatzmandant über einen Hauptmandanten mit Premium-Abo abrechnen. Der Betrieb bekommt Premium,
            Status und Testphase des Hauptmandanten; die Rechnung geht an den Hauptmandanten.
            {hatEigenesAbo && ' Das eigene Stripe-Abo dieses Betriebs muss vorher gekündigt sein.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select aria-label="Hauptmandant" value={haupt} onChange={e => setHaupt(e.target.value)} className="form-input text-sm sm:col-span-2">
              <option value="">– Hauptmandant (Premium) –</option>
              {verbund.kandidaten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <input aria-label="Vereinbarter Preis in Euro (leer = Standardpreis)" value={preis} onChange={e => setPreis(e.target.value)}
              inputMode="decimal" placeholder="Preis € (leer = Standard)" className="form-input text-sm" />
          </div>
          {verbund.kandidaten.length === 0 && <p className="text-xs text-s112-muted">Kein Betrieb mit Premium-Abo vorhanden.</p>}
          <button type="button" disabled={pending || !haupt}
            onClick={() => ausfuehren(() => verbundBeitreten(tenantId, haupt, preis))}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50">
            {pending ? 'Wird verbunden…' : 'Über Hauptmandanten abrechnen'}
          </button>
        </div>
      )}
    </div>
  )
}
