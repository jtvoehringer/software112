import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { CheckCircle2, TrendingUp } from 'lucide-react'

export const metadata: Metadata = { title: 'Neuerungen – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Alle Release Notes zum Nachlesen (Rückmeldung 19.9.2026: das Einstiegs-Fenster
// erscheint pro Benutzer nur einmal - wer es weggeklickt hat, fand die
// Neuerungen bisher nirgends mehr).
export default async function NeuerungenPage() {
  const supabase = await createSupabaseServerClient()
  const data = geladen(await (supabase.from('release_notes') as any)
    .select('id, version, titel, features, fixes, veroeffentlicht_am')
    .eq('aktiv', true)
    .order('veroeffentlicht_am', { ascending: false })
    .limit(50), 'Neuerungen')
  const notes = (data ?? []) as R[]

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/hilfe/handbuch" className="hover:text-s112-blue-700 transition-colors">Hilfe</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neuerungen</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Neuerungen</h1>
        <p className="text-sm text-s112-muted mt-0.5">Was sich in software:112 geändert hat – neueste Version zuerst</p>
      </div>

      {notes.length === 0 && <p className="text-sm text-s112-muted">Noch keine Release Notes veröffentlicht.</p>}

      <div className="space-y-6 max-w-3xl">
        {notes.map((n, i) => (
          <section key={n.id} className="card p-0 overflow-hidden">
            <div className={`px-6 py-4 ${i === 0 ? 'bg-s112-teal' : 'bg-s112-bg border-b border-s112-line'}`}>
              <p className={`text-xs font-medium ${i === 0 ? 'text-s112-yellow' : 'text-s112-muted'}`}>
                Version {n.version}{i === 0 && ' · aktuell'}
              </p>
              <h2 className={`text-lg font-semibold ${i === 0 ? 'text-white' : 'text-s112-text'}`}>{n.titel}</h2>
              <p className={`text-xs mt-0.5 ${i === 0 ? 'text-s112-yellow/80' : 'text-s112-muted'}`}>
                {new Date(n.veroeffentlicht_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
            </div>
            <div className="px-6 py-5 space-y-5">
              {Array.isArray(n.features) && n.features.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-s112-text mb-2 flex items-center gap-2">
                    <span className="w-5 h-5 bg-s112-ok-bg text-s112-ok-fg rounded-full flex items-center justify-center"><CheckCircle2 size={12} /></span>
                    Neue Funktionen
                  </h3>
                  <ul className="space-y-1.5">
                    {n.features.map((f: string, k: number) => (
                      <li key={k} className="flex items-start gap-2 text-sm text-s112-text-1">
                        <span className="text-s112-blue-700 mt-0.5 shrink-0">›</span><span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {Array.isArray(n.fixes) && n.fixes.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-s112-text mb-2 flex items-center gap-2">
                    <span className="w-5 h-5 bg-s112-blue-100 text-s112-blue-700 rounded-full flex items-center justify-center"><TrendingUp size={12} /></span>
                    Verbesserungen
                  </h3>
                  <ul className="space-y-1.5">
                    {n.fixes.map((f: string, k: number) => (
                      <li key={k} className="flex items-start gap-2 text-sm text-s112-text-1">
                        <span className="text-s112-blue-700 mt-0.5 shrink-0">›</span><span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
