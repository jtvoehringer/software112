'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Users, Trash2 } from 'lucide-react'
import type { FreigabeRow } from './page'
import { createFreigabe, setFreigabeAktiv, deleteFreigabe } from './actions'

type Tenant = { id: string; name: string }
const inputCls = 'w-full border border-s112-line-str rounded-lg px-3 py-2 text-sm text-s112-text focus:outline-none focus:ring-2 focus:ring-s112-teal focus:border-transparent bg-white'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

export default function KellergemeinschaftClient({ rows, tenants }: { rows: FreigabeRow[]; tenants: Tenant[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [eigentuemer, setEigentuemer] = useState('')
  const [nutzer, setNutzer] = useState('')

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    startTransition(async () => {
      const r = await createFreigabe(fd)
      if (r.error) { setFehler(r.error); return }
      setEigentuemer(''); setNutzer('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <form onSubmit={submit} className="card p-5 space-y-3">
        <h3 className="text-sm font-semibold text-s112-text inline-flex items-center gap-2"><Users className="w-4 h-4 text-s112-tertiary" /> Neue Freigabe</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Eigentümer der Gebinde *</label>
            <select aria-label="Eigentümer der Gebinde" name="eigentuemer_tenant_id" value={eigentuemer} onChange={e => setEigentuemer(e.target.value)} required className={inputCls}>
              <option value="">– Betrieb –</option>
              {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Partnerbetrieb (darf nutzen) *</label>
            <select aria-label="Partnerbetrieb (darf nutzen)" name="nutzer_tenant_id" value={nutzer} onChange={e => setNutzer(e.target.value)} required className={inputCls}>
              <option value="">– Betrieb –</option>
              {tenants.filter(t => t.id !== eigentuemer).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Notiz</label>
            <input aria-label="Notiz" name="notizen" placeholder="z.B. Lohnverarbeitung ab 2026" className={inputCls} />
          </div>
        </div>
        {fehler && <p className="text-xs text-s112-err-fg">{fehler}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending || !eigentuemer || !nutzer} className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Speichern…' : 'Freigabe anlegen'}
          </button>
          <span className="text-[11px] text-s112-tertiary">Der Eigentümer kann einzelne Gebinde unter Kellerbuch › Gebinde von der Freigabe ausnehmen.</span>
        </div>
      </form>

      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border">
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Eigentümer</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Partnerbetrieb</th>
              <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Gebinde freigegeben</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Notiz</th>
              <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Status</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id} className={`border-b border-s112-border/30 last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''} ${!r.aktiv ? 'opacity-50' : ''}`}>
                <td className="px-4 py-2.5 font-medium text-s112-text">{r.eigentuemer_name}</td>
                <td className="px-4 py-2.5 text-s112-text">{r.nutzer_name}</td>
                <td className="px-4 py-2.5 text-right font-mono text-s112-text-2">{r.gebinde_freigegeben} / {r.gebinde_gesamt}</td>
                <td className="px-4 py-2.5 text-s112-text-2 text-xs">{r.notizen ?? '–'}</td>
                <td className="px-4 py-2.5">
                  <button onClick={() => startTransition(async () => { const x = await setFreigabeAktiv(r.id, !r.aktiv); if (x.error) setFehler(x.error); router.refresh() })}
                    className={`text-[10.5px] font-mono uppercase tracking-[.04em] px-1.5 py-0.5 rounded ${r.aktiv ? 'bg-s112-ok-bg text-s112-ok-fg' : 'bg-s112-bg text-s112-text-2 border border-s112-line'}`}
                    title={r.aktiv ? 'Klick: Freigabe pausieren' : 'Klick: Freigabe aktivieren'}>
                    {r.aktiv ? 'aktiv' : 'pausiert'}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button onClick={() => { if (confirm(`Freigabe ${r.eigentuemer_name} → ${r.nutzer_name} löschen? Der Partner sieht die Gebinde dann nicht mehr; bereits eingelagerter Wein bleibt in der Datenbank.`)) startTransition(async () => { const x = await deleteFreigabe(r.id); if (x.error) setFehler(x.error); router.refresh() }) }}
                    className="text-s112-tertiary hover:text-s112-err" title="Freigabe löschen"><Trash2 className="w-4 h-4" /></button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="px-4 py-6 text-center text-xs text-s112-muted italic">Noch keine Freigaben – oben Eigentümer und Partnerbetrieb wählen.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
