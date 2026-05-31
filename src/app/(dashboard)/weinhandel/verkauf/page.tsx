import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Verkauf – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function VerkaufPage() {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  // Verkaufsposten mit Positionen + Kundendaten
  const { data: postenRaw } = await (supabase.from('verkaufsposten') as any)
    .select(`
      id, datum, rechnungsnummer, notizen, erstellt_am, storniert, bezahlt,
      kontakt:kontakte(id, vorname, nachname),
      firma:firmen(id, name),
      positionen:verkauf_positionen(id, name, menge, einheit, preis_brutto, typ)
    `)
    .eq('aktiv', true)
    .order('datum', { ascending: false })
    .order('erstellt_am', { ascending: false })
    .limit(100)

  const posten = (postenRaw ?? []) as R[]

  // Umsatz-KPIs
  const heute   = new Date()
  const monatVon = new Date(heute.getFullYear(), heute.getMonth(), 1).toISOString().split('T')[0]
  const monatBis = new Date(heute.getFullYear(), heute.getMonth() + 1, 0).toISOString().split('T')[0]

  const monatPosten = posten.filter((p: R) => p.datum >= monatVon && p.datum <= monatBis)

  function postenSumme(p: R): number {
    return ((p.positionen ?? []) as R[]).reduce((s: number, pos: R) => {
      return s + (pos.preis_brutto != null ? Number(pos.preis_brutto) * Number(pos.menge) : 0)
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
          <h1 className="text-2xl font-bold text-gray-900">Verkauf</h1>
          <p className="text-sm text-s112-muted mt-0.5">Verkaufsvorgänge &amp; Rechnungen</p>
        </div>
        {writeOk && (
          <Link
            href="/weinhandel/verkauf/neu"
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
          >
            + Neuer Verkauf
          </Link>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card p-5">
          <p className="text-xs text-s112-muted">{monatName}</p>
          <p className="text-2xl font-bold text-s112-teal mt-1 tabular-nums">
            {monatUmsatz.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
          </p>
          <p className="text-xs text-s112-muted mt-0.5">{monatPosten.length} Vorgang{monatPosten.length !== 1 ? 'ä' : ''}nge</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-s112-muted">Gesamt (aktive)</p>
          <p className="text-2xl font-bold text-gray-800 mt-1 tabular-nums">
            {gesamtUmsatz.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
          </p>
          <p className="text-xs text-s112-muted mt-0.5">{posten.length} Vorgang{posten.length !== 1 ? 'ä' : ''}nge</p>
        </div>
      </div>

      {/* Tabelle */}
      {posten.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-3xl mb-3">🛒</p>
          <p className="text-sm text-s112-muted">Noch keine Verkäufe erfasst.</p>
          {writeOk && (
            <Link href="/weinhandel/verkauf/neu" className="mt-3 inline-block text-sm text-s112-teal hover:underline">
              Ersten Verkauf anlegen →
            </Link>
          )}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Datum</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Belegnr.</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Kunde</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700">Positionen</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Summe</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {posten.map((p: R, i: number) => {
                const summe = postenSumme(p)
                const posCount = ((p.positionen ?? []) as R[]).length
                const hasTank = ((p.positionen ?? []) as R[]).some((pos: R) => pos.typ === 'tank')
                return (
                  <tr key={p.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                    <td className="px-4 py-3 text-s112-muted whitespace-nowrap">
                      {new Date(p.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700">
                      {p.rechnungsnummer ?? <span className="text-s112-muted">–</span>}
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-900">{kundenName(p)}</td>
                    <td className="px-4 py-3">
                      {p.storniert
                        ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">Storniert</span>
                        : p.bezahlt
                          ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">Bezahlt</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">Offen</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-s112-muted text-xs">
                      {posCount} Position{posCount !== 1 ? 'en' : ''}
                      {hasTank && <span className="ml-2 bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded text-xs">Tank</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-s112-teal tabular-nums">
                      {summe > 0
                        ? summe.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                        : <span className="text-s112-muted font-normal">–</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/weinhandel/verkauf/${p.id}`}
                        className="text-xs text-s112-teal hover:underline"
                      >
                        Details →
                      </Link>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
