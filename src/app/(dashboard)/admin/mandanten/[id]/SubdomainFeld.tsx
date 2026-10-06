'use client'

// ── KAN-31: Betriebs-Subdomain pflegen (nur Plattform-Admins) ─────────────────────────────────────────────────────
// Die Subdomain gilt erst, wenn NEXT_PUBLIC_S112_SUBDOMAIN_BASIS gesetzt und DNS/Vercel eingerichtet sind; bis dahin
// wird sie nur gespeichert. undefined = Spalte noch nicht vorhanden (Migration fehlt) → Feld ausgeblendet.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { fehlerText } from '@/lib/fehler'
import { subdomainBasis, subdomainFehler } from '@/lib/tenant/subdomain'

export default function SubdomainFeld({ tenantId, subdomain, speichern }: {
  tenantId: string
  subdomain: string | null | undefined
  speichern: (tenantId: string, wert: string) => Promise<void>
}) {
  const router = useRouter()
  const [wert, setWert] = useState(subdomain ?? '')
  const [fehler, setFehler] = useState<string | null>(null)
  const [ok, setOk] = useState(false)
  const [pending, startTransition] = useTransition()
  if (subdomain === undefined) return null
  const basis = subdomainBasis() || 'software112.icp-consultants.at'
  const t = wert.trim().toLowerCase()
  const lokalFehler = t ? subdomainFehler(t) : null

  function los(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null); setOk(false)
    startTransition(async () => {
      try { await speichern(tenantId, t); setOk(true); router.refresh() } catch (err) { setFehler(fehlerText(err)) }
    })
  }

  return (
    <form onSubmit={los} className="card p-4 mb-4 space-y-2">
      <h3 className="text-sm font-semibold text-s112-text">Subdomain (Betrieb je Tab)</h3>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <input aria-label="Subdomain" value={wert} onChange={e => setWert(e.target.value)} placeholder="z. B. gebeshuber"
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm w-48" />
        <span className="text-s112-muted">.{basis}</span>
        <button type="submit" disabled={pending || !!lokalFehler || t === (subdomain ?? '')}
          className="bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-sm disabled:opacity-40">Speichern</button>
      </div>
      {lokalFehler && <p className="text-xs text-s112-err-fg">{lokalFehler}</p>}
      {fehler && <p role="alert" className="text-xs text-s112-err-fg">{fehler}</p>}
      {ok && <p className="text-xs text-s112-ok-fg">Gespeichert.</p>}
      <p className="text-xs text-s112-muted">
        Leer = keine Subdomain. Wirksam erst mit eingerichteter Domain (DNS, Vercel) und NEXT_PUBLIC_S112_SUBDOMAIN_BASIS.
        Achtung: gedruckte QR-Codes enthalten die Subdomain – später nicht mehr ändern.
      </p>
    </form>
  )
}
