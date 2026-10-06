import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { getCurrentUserRole } from '@/lib/auth/roles'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ereignisseLaden, type EreignisZeile } from '@/lib/system/ereignis'
import { TAEGLICH_QUELLE, cronLaufBeginn, cronProtokollFehlt } from '@/lib/morgenbericht/zeitplan'
import Link from '@/components/ui/Link'
import SmokeTestClient from './SmokeTestClient'
import SchluesselClient from './SchluesselClient'

export const metadata: Metadata = { title: 'Systembericht – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Systembericht (20.9.2026): alle Server-, Browser- und Cron-Fehler der letzten
// 24 h bzw. 7 Tage aus system_ereignisse (Migration 222), gruppiert nach Meldung.
// Quellen: src/instrumentation.ts (Server), (dashboard)/error.tsx (Browser),
// /api/cron/taeglich (Cron). Nur Super-Admin.

const ART_LABEL: Record<string, string> = { server: 'Server', client: 'Browser', cron: 'Cron', db: 'Datenbank' }

function fmtZeit(iso: string) {
  return new Date(iso).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}

/** Meldung für die Gruppierung normalisieren (UUIDs, Zahlen, Anführungszeichen-Inhalte) */
function schluessel(z: EreignisZeile) {
  const m = z.meldung
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.]+Z?/g, '<zeit>')
    .replace(/\d+/g, '#')
    .slice(0, 160)
  const q = z.quelle.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<id>')
  return `${z.art}|${q}|${m}`
}

export default async function SystemberichtPage({ searchParams }: { searchParams: Promise<{ tage?: string }> }) {
  const role = await getCurrentUserRole()
  if (role !== 'system_admin') redirect('/dashboard')

  const sp = await searchParams
  const tage = sp.tage === '7' ? 7 : sp.tage === '30' ? 30 : 1
  const seit = new Date(Date.now() - tage * 86400000)

  const admin = createSupabaseAdminClient()
  const jetzt = new Date()
  const [zeilen, { data: tenantsRaw }, { data: cronHeute }] = await Promise.all([
    ereignisseLaden(seit),
    // tenant-isolation-ignore: Namen aller Betriebe für die Anzeige (Super-Admin)
    (admin.from('tenants') as any).select('id, name'),
    // tenant-isolation-ignore: Systemprotokoll ohne Mandantenbezug – Protokolleintrag des täglichen Crons von heute (KAN-123)
    (admin.from('system_ereignisse') as any).select('erstellt_am').eq('art', 'cron').eq('quelle', TAEGLICH_QUELLE)
      .gte('erstellt_am', cronLaufBeginn(jetzt).toISOString()).order('erstellt_am', { ascending: false }).limit(1).maybeSingle(),
  ])
  const tenantName = new Map(((tenantsRaw ?? []) as R[]).map(t => [t.id as string, t.name as string]))
  // KAN-123: Reißt der Lauf das Zeitlimit, fehlt sein Protokolleintrag ganz – dann steht unten nichts
  const cronOhneProtokoll = cronProtokollFehlt(jetzt, (cronHeute as R | null)?.erstellt_am ?? null)

  const fehler = zeilen.filter(z => z.art !== 'cron')
  const cron = zeilen.filter(z => z.art === 'cron')
  const anzahl = { server: 0, client: 0, db: 0, cron: 0 } as Record<string, number>
  for (const z of zeilen) anzahl[z.art] = (anzahl[z.art] ?? 0) + 1

  // Gruppen nach normalisierter Meldung
  const gruppen = new Map<string, { art: string; quelle: string; meldung: string; anzahl: number; zuletzt: string; tenants: Set<string> }>()
  for (const z of fehler) {
    const k = schluessel(z)
    const g = gruppen.get(k)
    if (g) { g.anzahl++; if (z.tenant_id) g.tenants.add(z.tenant_id) }
    else gruppen.set(k, { art: z.art, quelle: z.quelle, meldung: z.meldung, anzahl: 1, zuletzt: z.erstellt_am, tenants: new Set(z.tenant_id ? [z.tenant_id] : []) })
  }
  const gruppenListe = [...gruppen.values()].sort((a, b) => b.anzahl - a.anzahl || b.zuletzt.localeCompare(a.zuletzt))

  const cronFehler = cron.filter(z => Number((z.details as R | null)?.fehler ?? 0) > 0)

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <span>Administration</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Systembericht</span>
      </div>
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Systembericht</h1>
          <p className="text-sm text-s112-muted mt-0.5">Server-, Browser- und Cron-Fehler aller Betriebe · Aufbewahrung 30 Tage</p>
        </div>
        <div className="flex gap-1 text-sm">
          {[[1, '24 Stunden'], [7, '7 Tage'], [30, '30 Tage']].map(([t, l]) => (
            <Link key={t} href={`/admin/system?tage=${t}`} className={`px-3 py-1.5 rounded-full border ${tage === t ? 'bg-s112-teal text-s112-yellow border-s112-teal' : 'bg-white text-s112-text-1 border-s112-border hover:bg-s112-bg'}`}>{l}</Link>
          ))}
        </div>
      </div>

      {cronOhneProtokoll && (
        <div role="alert" className="mb-6 p-4 bg-s112-err-bg border border-s112-err/30 rounded-xl text-sm text-s112-err-fg">
          <strong>Täglicher Cron ohne Protokoll:</strong> Für heute gibt es nach 05:30 UTC keinen Eintrag von <code className="font-mono text-xs">{TAEGLICH_QUELLE}</code>.
          Der Lauf ist vermutlich vor dem Protokoll abgebrochen (Zeitlimit) oder nicht gestartet – Laufzeitprotokoll in Vercel prüfen.
          Fehlende Morgenberichte meldet der Sandbox-Morgenbericht am Folgetag.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        {(['server', 'client', 'db', 'cron'] as const).map(a => (
          <div key={a} className="bg-white border border-s112-border rounded-xl px-4 py-3">
            <div className="text-xs text-s112-muted uppercase tracking-wide">{ART_LABEL[a]}</div>
            <div className={`text-2xl font-semibold mt-1 ${a !== 'cron' && anzahl[a] > 0 ? 'text-s112-err-fg' : 'text-s112-text'}`}>{anzahl[a] ?? 0}</div>
          </div>
        ))}
      </div>

      <SmokeTestClient />
      <SchluesselClient />

      {zeilen.length === 0 && (
        <div className="bg-white border border-s112-border rounded-xl px-4 py-6 text-sm text-s112-muted text-center">
          Keine Ereignisse im gewählten Zeitraum. Das Protokoll wird seit der Version mit Migration 222 befüllt.
        </div>
      )}

      {gruppenListe.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-s112-text mb-2">Fehler nach Meldung</h2>
          <div className="bg-white border border-s112-border rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-s112-bg text-xs uppercase tracking-wide text-s112-muted">
                <tr>
                  <th className="text-left px-3 py-2 w-16">Anzahl</th>
                  <th className="text-left px-3 py-2 w-20">Art</th>
                  <th className="text-left px-3 py-2">Quelle · Meldung</th>
                  <th className="text-left px-3 py-2 w-28">Betrieb</th>
                  <th className="text-left px-3 py-2 w-28">Zuletzt</th>
                </tr>
              </thead>
              <tbody>
                {gruppenListe.map((g, i) => (
                  <tr key={i} className="border-t border-s112-border align-top">
                    <td className="px-3 py-2 font-semibold text-s112-err-fg">{g.anzahl}</td>
                    <td className="px-3 py-2 text-s112-muted">{ART_LABEL[g.art] ?? g.art}</td>
                    <td className="px-3 py-2">
                      <div className="font-mono text-xs text-s112-muted break-all">{g.quelle}</div>
                      <div className="wrap-break-word">{g.meldung}</div>
                    </td>
                    <td className="px-3 py-2 text-s112-muted">{[...g.tenants].map(t => tenantName.get(t) ?? '?').join(', ') || '–'}</td>
                    <td className="px-3 py-2 text-s112-muted whitespace-nowrap">{fmtZeit(g.zuletzt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {cron.length > 0 && (
        <section className="mb-8">
          <h2 className="text-base font-semibold text-s112-text mb-2">Cron-Läufe {cronFehler.length > 0 && <span className="text-s112-err-fg text-sm font-normal">· {cronFehler.length} mit Fehlern</span>}</h2>
          <div className="bg-white border border-s112-border rounded-xl divide-y divide-s112-border">
            {cron.map(z => (
              <details key={z.id} className="px-3 py-2 text-sm">
                <summary className="cursor-pointer flex gap-3 items-baseline">
                  <span className="text-s112-muted whitespace-nowrap">{fmtZeit(z.erstellt_am)}</span>
                  <span className="font-mono text-xs text-s112-muted">{z.quelle}</span>
                  <span className={cronFehler.includes(z) ? 'text-s112-err-fg' : ''}>{z.meldung}</span>
                </summary>
                {z.details && <pre className="mt-2 text-xs bg-s112-bg rounded-lg p-3 overflow-auto max-h-80">{JSON.stringify(z.details, null, 2)}</pre>}
              </details>
            ))}
          </div>
        </section>
      )}

      {fehler.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-s112-text mb-2">Einzelne Ereignisse <span className="text-sm font-normal text-s112-muted">({Math.min(fehler.length, 200)} von {fehler.length})</span></h2>
          <div className="bg-white border border-s112-border rounded-xl divide-y divide-s112-border">
            {fehler.slice(0, 200).map(z => (
              <details key={z.id} className="px-3 py-2 text-sm">
                <summary className="cursor-pointer flex gap-3 items-baseline flex-wrap">
                  <span className="text-s112-muted whitespace-nowrap">{fmtZeit(z.erstellt_am)}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded-sm bg-s112-bg text-s112-muted">{ART_LABEL[z.art] ?? z.art}</span>
                  <span className="font-mono text-xs text-s112-muted break-all">{z.quelle}</span>
                  {z.tenant_id && <span className="text-xs text-s112-muted">{tenantName.get(z.tenant_id) ?? '?'}</span>}
                  <span className="basis-full wrap-break-word">{z.meldung}</span>
                </summary>
                {z.details && <pre className="mt-2 text-xs bg-s112-bg rounded-lg p-3 overflow-auto max-h-80 whitespace-pre-wrap">{JSON.stringify(z.details, null, 2)}</pre>}
              </details>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
