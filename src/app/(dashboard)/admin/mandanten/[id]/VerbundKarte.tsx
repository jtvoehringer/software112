'use client'

// KAN-215/KAN-214: Hauptmandant und Submandanten im Reiter „Stripe“ der Mandantenverwaltung – Betrieb als Submandant
// einem Hauptmandanten (Premium) zuordnen (0 €, CRM und Kellergebinde gemeinsam, Support unter dem Hauptmandanten),
// Austritt, Übersicht der Submandanten eines Hauptmandanten.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import type { VerbundInfo } from './page'
import { verbundBeitreten, verbundVerlassen } from './actions'
import { rueckfrage } from '@/lib/ui/rueckfrage'

export default function VerbundKarte({ tenantId, tenantName, verbund, hatEigenesAbo }: {
  tenantId: string; tenantName: string; verbund: VerbundInfo; hatEigenesAbo: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [haupt, setHaupt] = useState('')

  const ausfuehren = (f: () => Promise<{ error?: string }>) => {
    setFehler(null)
    startTransition(async () => {
      const r = await f()
      if (r.error) setFehler(r.error)
      else { setHaupt(''); router.refresh() }
    })
  }

  return (
    <div className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Hauptmandant / Submandanten</h2>
      {fehler && <p className="text-xs text-s112-err-fg">{fehler}</p>}

      {verbund.hauptId ? (
        <div className="space-y-2 text-sm">
          <p>
            Submandant von{' '}
            <Link href={`/admin/mandanten/${verbund.hauptId}`} className="font-medium text-s112-blue-700 hover:underline">{verbund.hauptName ?? 'Hauptmandant'}</Link>
            {' '}· 0 €. Abo, Rechnung und Support laufen über den Hauptmandanten; CRM und Kellergebinde sind gemeinsam.
          </p>
          <button type="button" disabled={pending}
            onClick={async () => { if (await rueckfrage({ titel: `${tenantName} vom Hauptmandanten lösen?`, text: 'Mit Stripe-Abo des Hauptmandanten ist der Betrieb danach im Nur-Lesen-Modus, bis er ein eigenes Abo abschließt (ohne neue Testphase). Die Gemeinschaften (CRM, Keller) bleiben bestehen – bei Bedarf unter Administration › Gemeinschaften deaktivieren.', bestaetigen: 'Lösen', gefaehrlich: true })) ausfuehren(() => verbundVerlassen(tenantId)) }}
            className="border border-s112-line-str rounded-lg px-3 py-1.5 text-xs font-medium text-s112-err-fg hover:bg-s112-err-bg disabled:opacity-50">
            {pending ? 'Wird gelöst…' : 'Vom Hauptmandanten lösen'}
          </button>
        </div>
      ) : verbund.neben.length > 0 ? (
        <div className="text-sm space-y-1">
          <p>Hauptmandant (Premium ist Pflicht) – Submandanten:</p>
          <ul className="list-disc ml-5 text-s112-text-2">
            {verbund.neben.map(n => (
              <li key={n.id}><Link href={`/admin/mandanten/${n.id}`} className="text-s112-blue-700 hover:underline">{n.name}</Link></li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-s112-text-2">
            {tenantName} als Submandant einem Hauptmandanten mit Premium zuordnen (0 €). Der Betrieb bekommt Premium und – falls
            vorhanden – Stripe-Abo, Status und Testphase des Hauptmandanten; CRM und Kellergebinde werden gemeinsam genutzt
            (Freigaben in beide Richtungen), Support-Anfragen laufen unter dem Hauptmandanten.
            {hatEigenesAbo && ' Das eigene Stripe-Abo dieses Betriebs muss vorher gekündigt sein.'}
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <select aria-label="Hauptmandant" value={haupt} onChange={e => setHaupt(e.target.value)} className="form-input text-sm sm:col-span-3">
              <option value="">– Hauptmandant (Premium) –</option>
              {verbund.kandidaten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          {verbund.kandidaten.length === 0 && <p className="text-xs text-s112-muted">Kein Betrieb mit Premium vorhanden.</p>}
          <button type="button" disabled={pending || !haupt}
            onClick={() => ausfuehren(() => verbundBeitreten(tenantId, haupt))}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
            {pending ? 'Wird zugeordnet…' : 'Als Submandant zuordnen'}
          </button>
        </div>
      )}
    </div>
  )
}
