import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import ClickableTableRow from '@/components/ui/ClickableTableRow'
import StopPropagation from '@/components/ui/StopPropagation'
import { fmtEur } from '@/lib/format'
import { inBloecken } from '@/lib/supabase/alle'
import { tbsSuche, tbsText } from '@/lib/handel/tbsNummer'
import ListenSuche from '@/components/ui/ListenSuche'

export const metadata: Metadata = { title: 'Verkauf – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function VerkaufPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role, 'warenwirtschaft')
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // KAN-90: Suche nach TBS-Nr. (genau, „1234“ bzw. „1234/2026“) oder Teil der Beleg-/Transaktionsnummer
  const q = ((await searchParams).q ?? '').trim()
  const qSicher = q.replace(/[^\p{L}\p{N}/\- ]/gu, '').slice(0, 40)
  const tbsQ = tbsSuche(q)
  let tbsTreffer: string[] = []
  if (q && tbsQ && tenantId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tq = (supabase.from('transportbescheinigungen') as any)
      .select('verkaufsposten_id').eq('tenant_id', tenantId).is('storniert_am', null).ilike('tbs_nummer', tbsQ.nummer)
    if (tbsQ.jahr !== null) tq = tq.eq('tbs_jahr', tbsQ.jahr)
    const { data: tr } = await tq.limit(100)   // alle-ausnahme: Treffer einer Nummernsuche, je Jahr eindeutig
    tbsTreffer = ((tr ?? []) as R[]).map(t => String(t.verkaufsposten_id)).filter(id => /^[0-9a-f-]{36}$/.test(id))
  }

  // Verkaufsposten mit Positionen + Kundendaten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query
  const { data: postenRaw } = await tf(
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, transaktions_nr, notizen, erstellt_am, storniert, bezahlt,
        kontakt:kontakte!kontakt_id(id, vorname, nachname),
        firma:firmen(id, name),
        positionen:verkauf_positionen(id, name, menge, einheit, preis_brutto, typ, rabatt_pct, sonderrabatt_pct)
      `)
      .eq('aktiv', true)
  )
    .or(q ? [`rechnungsnummer.ilike.*${qSicher}*`, `transaktions_nr.ilike.*${qSicher}*`, ...(tbsTreffer.length ? [`id.in.(${tbsTreffer.join(',')})`] : [])].join(',') : 'id.not.is.null')
    .order('datum', { ascending: false })
    .order('erstellt_am', { ascending: false })
    .limit(100)

  const posten = (postenRaw ?? []) as R[]

  // KAN-90: TBS-Nr. der (nicht stornierten) Transportbescheinigung je Verkauf
  const tbsJePosten = new Map<string, string>()
  if (tenantId && posten.length > 0) {
    const { data: tbs } = await inBloecken<R>(posten.map(p => String(p.id)), b =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('transportbescheinigungen') as any)
        .select('verkaufsposten_id, tbs_nummer, tbs_jahr').eq('tenant_id', tenantId).is('storniert_am', null).in('verkaufsposten_id', b))
    for (const t of tbs) {
      const txt = tbsText(t.tbs_nummer, t.tbs_jahr)
      if (txt) tbsJePosten.set(String(t.verkaufsposten_id), txt)
    }
  }

  // Umsatz-KPIs
  const heute   = new Date()
  const monatVon = new Date(heute.getFullYear(), heute.getMonth(), 1).toISOString().split('T')[0]
  const monatBis = new Date(heute.getFullYear(), heute.getMonth() + 1, 0).toISOString().split('T')[0]

  const monatPosten = posten.filter((p: R) => p.datum >= monatVon && p.datum <= monatBis)

  function postenSumme(p: R): number {
    return ((p.positionen ?? []) as R[]).reduce((s: number, pos: R) => {
      if (pos.preis_brutto == null) return s
      const brutto = Number(pos.preis_brutto) * Number(pos.menge)
      const rabatt = Number(pos.rabatt_pct ?? 0) / 100
      const sonder = Number(pos.sonderrabatt_pct ?? 0) / 100
      return s + brutto * (1 - rabatt) * (1 - sonder)
    }, 0)
  }

  const monatUmsatz    = monatPosten.reduce((s: number, p: R) => s + postenSumme(p), 0)
  const gesamtUmsatz   = posten.reduce((s: number, p: R) => s + postenSumme(p), 0)

  function kundenName(p: R): string {
    if (p.kontakt) {
      const k = p.kontakt as R
      return [k.vorname, k.nachname].filter(Boolean).join(' ')
    }
    if (p.firma) return (p.firma as R).name
    return '–'
  }

  const monatName = heute.toLocaleDateString('de-AT', { month: 'long', year: 'numeric' })

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Verkauf</h1>
          <p className="text-sm text-s112-muted mt-0.5">Verkaufsvorgänge &amp; Rechnungen</p>
        </div>
        {writeOk && (
          <Link
            href="/weinhandel/verkauf/neu"
            className="bg-s112-teal text-s112-yellow px-4 py-2.5 sm:py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            + Neuer Verkauf
          </Link>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <div className="card p-4 sm:p-5">
          <p className="text-xs text-s112-muted">{monatName}</p>
          <p className="text-xl sm:text-2xl font-semibold text-s112-blue-700 mt-1 tabular-nums">
            {fmtEur(monatUmsatz)}
          </p>
          <p className="text-xs text-s112-muted mt-0.5">{monatPosten.length} {monatPosten.length === 1 ? 'Vorgang' : 'Vorgänge'}</p>
        </div>
        <div className="card p-4 sm:p-5">
          <p className="text-xs text-s112-muted">Gesamt (aktive)</p>
          <p className="text-xl sm:text-2xl font-semibold text-s112-text mt-1 tabular-nums">
            {fmtEur(gesamtUmsatz)}
          </p>
          <p className="text-xs text-s112-muted mt-0.5">{posten.length} {posten.length === 1 ? 'Vorgang' : 'Vorgänge'}</p>
        </div>
      </div>

      <ListenSuche q={q} pfad="/weinhandel/verkauf" platzhalter="TBS-Nr. (z. B. 12/2026), Beleg- oder Transaktionsnummer…" />

      {/* Tabelle */}
      {q && posten.length === 0 ? (
        <div className="card text-center py-12 text-sm text-s112-muted">Kein Verkauf passt zu „{q}“.</div>
      ) : posten.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-sm text-s112-muted">Noch keine Verkäufe erfasst.</p>
          {writeOk && (
            <Link href="/weinhandel/verkauf/neu" className="mt-3 inline-block text-sm text-s112-blue-700 hover:underline">
              Ersten Verkauf anlegen →
            </Link>
          )}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Datum</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Belegnr. / TBS-Nr.</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Kunde</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Positionen</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Summe</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {posten.map((p: R, i: number) => {
                const summe = postenSumme(p)
                const posCount = ((p.positionen ?? []) as R[]).length
                const hasTank = ((p.positionen ?? []) as R[]).some((pos: R) => pos.typ === 'tank')
                return (
                  <ClickableTableRow key={p.id} href={`/weinhandel/verkauf/${p.id}`} className={`border-b border-s112-border last:border-0 hover:bg-s112-bg/50 transition-colors ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-3 text-s112-muted whitespace-nowrap">
                      {new Date(p.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-mono text-xs text-s112-text-1">{p.rechnungsnummer ?? <span className="text-s112-muted">–</span>}</div>
                      {p.transaktions_nr && <div className="font-mono text-xs text-s112-muted mt-0.5">{p.transaktions_nr}</div>}
                      {tbsJePosten.has(String(p.id)) && <div className="font-mono text-xs text-s112-muted mt-0.5">TBS {tbsJePosten.get(String(p.id))}</div>}
                    </td>
                    <td className="px-4 py-3 font-medium text-s112-text">{kundenName(p)}</td>
                    <td className="px-4 py-3">
                      {p.storniert
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-s112-err-bg text-s112-err-fg font-medium">Storniert</span>
                        : p.bezahlt
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-s112-ok-bg text-s112-ok-fg font-medium">Bezahlt</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">Offen</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-s112-muted text-xs">
                      {posCount} Position{posCount !== 1 ? 'en' : ''}
                      {hasTank && <span className="ml-2 bg-s112-blue-100 text-s112-blue-700 px-1.5 py-0.5 rounded text-xs">Tank</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-s112-blue-700 tabular-nums">
                      {summe > 0
                        ? fmtEur(summe)
                        : <span className="text-s112-muted font-normal">–</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <StopPropagation>
                        <Link
                          href={`/weinhandel/verkauf/${p.id}`}
                          className="text-xs text-s112-blue-700 hover:underline"
                        >
                          Details →
                        </Link>
                      </StopPropagation>
                    </td>
                  </ClickableTableRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
