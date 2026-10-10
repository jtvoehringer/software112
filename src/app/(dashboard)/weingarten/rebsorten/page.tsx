import type { Metadata } from 'next'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { amtlicheSorten } from '@/lib/wein/bki_kuerzel'
import { ohneKuerzel, REBSORTEN_TABELLEN, type OhneKuerzel } from '@/lib/wein/rebsortenPruefung'
import RebsortenKorrektur from './RebsortenKorrektur'

export const metadata: Metadata = { title: 'Rebsorten prüfen' }
export const dynamic = 'force-dynamic'

// KAN-89 (05.10.2026): Rebsorten ohne amtliches BKI-Kürzel je Tabelle, mit Sammelkorrektur (Rieden, Grundstücke,
// Chargen). Ziel: 0 Einträge – sonst bleibt das Kürzel in Meldungen leer (Weinbestandsmeldung, Weinbuch, TB …).

export default async function RebsortenPruefenPage() {
  const membership = await getCurrentMembership()
  if (!membership) return <p className="text-sm text-s112-muted">Kein Betrieb gewählt.</p>
  const supabase = await createSupabaseServerClient()
  const tenantId = membership.tenantId

  const ergebnisse = await Promise.all(REBSORTEN_TABELLEN.map(async t => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from(t.tabelle) as any).select('id, rebsorte').eq('tenant_id', tenantId).not('rebsorte', 'is', null)
    if (t.storno) q = q.is('storniert_am', null)   // stornierte zählen nirgends
    const { data, error } = await alle<{ rebsorte: string | null }>(q.order('id'))
    return { t, fehler: error ? error.message : null, liste: error ? [] as OhneKuerzel[] : ohneKuerzel(data.map(z => z.rebsorte)) }
  }))
  const gesamt = ergebnisse.reduce((s, e) => s + e.liste.reduce((x, w) => x + w.anzahl, 0), 0)
  const sorten = amtlicheSorten()

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Rebsorten ohne Kürzel</h1>
        <p className="text-sm text-s112-muted mt-1">
          Rebsorten, die nicht in der BKI-Kürzelliste (Stand 01.10.2024) stehen, erscheinen in Meldungen ohne Kürzel.
          Hier lassen sie sich je Tabelle gesammelt auf die amtliche Schreibweise umstellen – jede Änderung steht im Änderungsprotokoll.
        </p>
      </div>

      <div className={`card ${gesamt === 0 ? 'bg-s112-ok-bg border-s112-ok/30' : ''}`}>
        <p className={`text-sm font-semibold ${gesamt === 0 ? 'text-s112-ok-fg' : 'text-s112-warn-fg'}`}>
          {gesamt === 0 ? 'Alle Rebsorten haben ein amtliches Kürzel.' : `${gesamt} ${gesamt === 1 ? 'Eintrag' : 'Einträge'} ohne amtliches Kürzel`}
        </p>
      </div>

      {ergebnisse.map(({ t, fehler, liste }) => (
        <div key={t.tabelle} className="card">
          <h2 className="text-base font-semibold text-s112-text mb-2">{t.label}</h2>
          {fehler && <p className="text-sm text-s112-err-fg">Konnte nicht geladen werden: {fehler}</p>}
          {!fehler && liste.length === 0 && <p className="text-sm text-s112-muted">Keine Einträge ohne Kürzel.</p>}
          {liste.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-s112-text-2 border-b border-s112-border">
                    <th className="text-left px-2 py-1.5">Rebsorte</th>
                    <th className="text-right px-2 py-1.5">Anzahl</th>
                    <th className="text-left px-2 py-1.5">{t.korrigierbar ? 'Ersetzen durch' : 'Korrektur'}</th>
                  </tr>
                </thead>
                <tbody>
                  {liste.map(w => (
                    <tr key={w.wert} className="border-b border-s112-border/40 last:border-0 align-top">
                      <td className="px-2 py-2 font-medium text-s112-text">{w.wert}</td>
                      <td className="px-2 py-2 text-right tabular-nums">{w.anzahl}</td>
                      <td className="px-2 py-2">
                        {t.korrigierbar && canWrite(membership, t.modul)
                          ? <RebsortenKorrektur tabelle={t.tabelle} wert={w.wert} vorschlag={w.vorschlag} sorten={sorten} />
                          : <span className="text-xs text-s112-muted">{t.korrigierbar ? 'Kein Schreibrecht im Modul' : 'Am Datensatz korrigieren'}{w.vorschlag ? ` – Vorschlag: ${w.vorschlag}` : ''}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
