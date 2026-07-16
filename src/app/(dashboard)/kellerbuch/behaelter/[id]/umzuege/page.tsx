import { createSupabaseServerClient } from '@/lib/supabase/server'
import { fmtLiter } from '@/lib/format'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export const metadata: Metadata = { title: 'Umzüge – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const TYP_ICONS: Record<string, string> = {
  lagertank: '🪣', immervolltank: '🪣', stahltank: '🪣', holzfass: '🪵', betonei: '⚪', amphore: '🏺', sonstiges: '📦',
}

function fmt(n: number | null) {
  if (n == null || isNaN(n)) return '–'
  return n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' L'
}

export default async function BehaelterUmzuegePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()

  const { data: bhRow } = await (supabase.from('behaelter') as any)
    .select('id, name, typ, volumen_liter, standort')
    .eq('id', id)
    .single()

  if (!bhRow) notFound()
  const bh = bhRow as R

  // Alle Umzüge bei denen dieser Behälter Quelle ODER Ziel war (alle Zeilentypen laden –
  // bei n:n-Umzügen steckt "Quelle" und "Ziel" auf zwei getrennten Zeilen, verknüpft über umzug_batch_id)
  const UMZUG_SELECT = `
      id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, notizen, umzug_batch_id,
      von_behaelter:von_behaelter_id(id, name),
      nach_behaelter:nach_behaelter_id(id, name),
      von_weinausbau:von_weinausbau_id(name),
      nach_weinausbau:nach_weinausbau_id(name)
    `
  const { data: initialRaw } = await (supabase.from('keller_umzuege') as any)
    .select(UMZUG_SELECT)
    .or(`von_behaelter_id.eq.${id},nach_behaelter_id.eq.${id}`)
    .order('datum', { ascending: false })

  const initial = (initialRaw ?? []) as R[]

  // Für n:n-Umzüge fehlt in `initial` ggf. die Gegenzeile (Quelle oder Ziel), wenn dieser Behälter
  // dort nicht direkt referenziert ist – deshalb den kompletten Batch nachladen.
  const batchIds = [...new Set(initial.filter(r => r.umzug_batch_id).map(r => r.umzug_batch_id as string))]
  const { data: batchRowsRaw } = batchIds.length > 0
    ? await (supabase.from('keller_umzuege') as any)
        .select(UMZUG_SELECT)
        .in('umzug_batch_id', batchIds)
    : { data: [] }
  const batchRows = (batchRowsRaw ?? []) as R[]

  type UmzugZeile = {
    id: string; datum: string; umzug_typ: string
    vonBeh: string; nachBeh: string; vonCharge: string | null; nachCharge: string | null
    istQuelle: boolean; brutto: number; netto: number; schwund: number
  }
  const umzuege: UmzugZeile[] = []
  const seenBatches = new Set<string>()

  for (const u of initial) {
    const batchId = u.umzug_batch_id as string | null

    if (!batchId) {
      // Altes Format: eine Zeile trägt Quelle+Ziel direkt
      umzuege.push({
        id: u.id, datum: u.datum, umzug_typ: u.umzug_typ,
        vonBeh: (u.von_behaelter as R | null)?.name ?? '–',
        nachBeh: (u.nach_behaelter as R | null)?.name ?? '–',
        vonCharge: (u.von_weinausbau as R | null)?.name ?? null,
        nachCharge: (u.nach_weinausbau as R | null)?.name ?? null,
        istQuelle: (u.von_behaelter as R | null)?.id === id,
        brutto: parseFloat(u.brutto_liter) || ((parseFloat(u.menge_liter) || 0) + (parseFloat(u.schwund_liter) || 0)),
        netto: parseFloat(u.menge_liter) || 0,
        schwund: parseFloat(u.schwund_liter) || 0,
      })
      continue
    }

    if (seenBatches.has(batchId)) continue
    seenBatches.add(batchId)

    const batch = batchRows.filter(r => r.umzug_batch_id === batchId)
    const quelleRecs = batch.filter(r => r.zeilen_typ === 'quelle')
    const zielRecs   = batch.filter(r => r.zeilen_typ === 'ziel')
    const istQuelle  = quelleRecs.some(r => (r.von_behaelter as R | null)?.id === id)

    const vonNamen  = quelleRecs.map(r => (r.von_behaelter as R | null)?.name ?? (r.von_weinausbau as R | null)?.name ?? '–').join(', ')
    const nachNamen = zielRecs.map(r => (r.nach_behaelter as R | null)?.name ?? '–').join(', ')
    const bruttoSum = quelleRecs.reduce((s, r) => s + (parseFloat(r.brutto_liter) || 0), 0)
    const nettoSum  = zielRecs.reduce((s, r) => s + (parseFloat(r.menge_liter) || 0), 0)
    const haupt = quelleRecs[0] ?? zielRecs[0] ?? batch[0]

    umzuege.push({
      id: haupt.id, datum: haupt.datum, umzug_typ: haupt.umzug_typ,
      vonBeh: vonNamen || '–',
      nachBeh: nachNamen || '–',
      vonCharge: (quelleRecs[0]?.von_weinausbau as R | null)?.name ?? null,
      nachCharge: (zielRecs[0]?.nach_weinausbau as R | null)?.name ?? null,
      istQuelle,
      brutto: bruttoSum || nettoSum,
      netto: nettoSum,
      schwund: Math.max(0, bruttoSum - nettoSum),
    })
  }

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{bh.name}</span>
        <span>/</span>
        <span className="text-gray-500">Umzüge</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <span className="text-3xl mt-0.5">{TYP_ICONS[bh.typ] ?? '📦'}</span>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{bh.name}</h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-s112-muted">
              {bh.standort && <span>{bh.standort}</span>}
              {bh.volumen_liter && <span>{fmtLiter(parseFloat(bh.volumen_liter))} Kapazität</span>}
            </div>
          </div>
        </div>
        <Link href="/kellerbuch/umziehen?neu=1"
          className="text-xs border border-s112-teal text-s112-teal px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
          ↔️ Neuer Umzug
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-s112-border">
        <Link href={`/kellerbuch/behaelter/${id}/bewegungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          📊 Bewegungsbuch
        </Link>
        <span className="px-4 py-2 text-sm font-medium text-s112-teal border-b-2 border-s112-teal -mb-px">
          ↔️ Umziehen
        </span>
        <Link href={`/kellerbuch/behaelter/${id}/behandlungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          🧪 Kellerbehandlungen
        </Link>
      </div>

      {/* Tabelle */}
      {umzuege.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-2xl mb-2">↔️</p>
          <p className="text-sm text-s112-muted">Noch keine Umzüge für diesen Behälter</p>
          <Link href="/kellerbuch/umziehen?neu=1"
            className="mt-3 inline-block text-xs text-s112-teal font-semibold hover:underline">
            → Zum Umziehen-Formular
          </Link>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Art</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Von</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Nach</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Brutto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Netto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Schwund</th>
              </tr>
            </thead>
            <tbody>
              {umzuege.map((u) => {
                const vonBeh   = u.vonBeh
                const nachBeh  = u.nachBeh
                const vonCharge  = u.vonCharge
                const nachCharge = u.nachCharge
                const istQuelle  = u.istQuelle
                const netto    = u.netto
                const brutto   = u.brutto
                const schwund  = u.schwund
                const istFilt    = u.umzug_typ === 'filtration'
                const istSchwund = u.umzug_typ === 'schwund'
                const artBadge = istSchwund
                  ? { cls: 'bg-amber-100 text-amber-700', label: '💧 Schwund' }
                  : istFilt
                    ? { cls: 'bg-blue-100 text-blue-700', label: '🔽 Filtration' }
                    : { cls: 'bg-gray-100 text-gray-600', label: '↔️ Umzug' }
                return (
                  <tr key={u.id}
                    className={`border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40 ${istQuelle ? 'bg-red-50/20' : 'bg-green-50/20'}`}>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${artBadge.cls}`}>
                        {artBadge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className={`text-sm ${istQuelle ? 'font-semibold text-s112-teal' : 'text-gray-600'}`}>{vonBeh}</p>
                      {vonCharge && <p className="text-xs text-s112-muted">{vonCharge}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className={`text-sm ${!istQuelle ? 'font-semibold text-s112-teal' : 'text-gray-600'}`}>{nachBeh}</p>
                      {nachCharge && <p className="text-xs text-s112-muted">{nachCharge}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 text-xs">{fmt(brutto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-gray-800">{fmt(netto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-amber-600 text-xs">
                      {schwund > 0 ? fmt(schwund) : '–'}
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
