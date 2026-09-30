import { createSupabaseServerClient } from '@/lib/supabase/server'
import { ladeBehaelterEinzeln } from '@/lib/keller/behaelter'
import { getCurrentMembership } from '@/lib/auth/roles'
import { fmtLiter, fmtNum } from '@/lib/format'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { Boxes } from 'lucide-react'

export const metadata: Metadata = { title: 'Umzüge – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null) {
  if (n == null || isNaN(n)) return '–'
  return fmtNum(n, 2) + ' L'
}

export default async function BehaelterUmzuegePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden.
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Eigenes oder freigegebenes Gebinde (Kellergemeinschaft, Migration 203) - die
  // Bewegungen/Umzüge darunter bleiben über tf() auf den eigenen Betrieb beschränkt.
  const bhRow = await ladeBehaelterEinzeln(supabase, tenantId, id)
  if (!bhRow) notFound()
  const bh = { ...bhRow, name: bhRow.anzeigeName } as R

  // Alle Umzüge bei denen dieser Behälter Quelle ODER Ziel war (alle Zeilentypen laden –
  // bei n:n-Umzügen steckt "Quelle" und "Ziel" auf zwei getrennten Zeilen, verknüpft über umzug_batch_id)
  const UMZUG_SELECT = `
      id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, notizen, umzug_batch_id,
      von_behaelter:von_behaelter_id(id, name),
      nach_behaelter:nach_behaelter_id(id, name),
      von_weinausbau:von_weinausbau_id(name),
      nach_weinausbau:nach_weinausbau_id(name)
    `
  const { data: initialRaw } = await tf((supabase.from('keller_umzuege') as any)
    .select(UMZUG_SELECT)
    .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
    .or(`von_behaelter_id.eq.${id},nach_behaelter_id.eq.${id}`)
    .order('datum', { ascending: false }))

  const initial = (initialRaw ?? []) as R[]

  // Für n:n-Umzüge fehlt in `initial` ggf. die Gegenzeile (Quelle oder Ziel), wenn dieser Behälter
  // dort nicht direkt referenziert ist – deshalb den kompletten Batch nachladen.
  const batchIds = [...new Set(initial.filter(r => r.umzug_batch_id).map(r => r.umzug_batch_id as string))]
  const { data: batchRowsRaw } = batchIds.length > 0
    ? await tf((supabase.from('keller_umzuege') as any)
        .select(UMZUG_SELECT)
        .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
        .in('umzug_batch_id', batchIds))
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
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{bh.name}</span>
        <span>/</span>
        <span className="text-s112-text-2">Umzüge</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <Boxes className="w-7 h-7 text-s112-blue-700 mt-0.5" />
          <div>
            <h1 className="text-2xl font-semibold text-s112-text">{bh.name}</h1>
            <div className="flex items-center gap-3 mt-0.5 flex-wrap text-xs text-s112-muted">
              {bh.standort && <span>{bh.standort}</span>}
              {bh.volumen_liter && <span>{fmtLiter(parseFloat(bh.volumen_liter))} Kapazität</span>}
            </div>
          </div>
        </div>
        <Link href="/kellerbuch/umziehen?neu=1"
          className="text-xs border border-s112-teal text-s112-blue-700 px-3 py-1.5 rounded-lg hover:bg-s112-teal/5 font-medium">
          Neuer Umzug
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-s112-border">
        <Link href={`/kellerbuch/behaelter/${id}/bewegungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors">
          Bewegungsbuch
        </Link>
        <span className="px-4 py-2 text-sm font-medium text-s112-blue-700 border-b-2 border-s112-teal -mb-px">
          Umziehen
        </span>
        <Link href={`/kellerbuch/behaelter/${id}/behandlungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors">
          Kellerbehandlungen
        </Link>
      </div>

      {/* Tabelle */}
      {umzuege.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-s112-muted">Noch keine Umzüge für diesen Behälter</p>
          <Link href="/kellerbuch/umziehen?neu=1"
            className="mt-3 inline-block text-xs text-s112-blue-700 font-semibold hover:underline">
            → Zum Umziehen-Formular
          </Link>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Art</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Von</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Nach</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Brutto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Netto</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Schwund</th>
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
                  ? { cls: 'bg-s112-warn-bg text-s112-warn-fg', label: 'Schwund' }
                  : istFilt
                    ? { cls: 'bg-s112-blue-100 text-s112-blue-700', label: 'Filtration' }
                    : { cls: 'bg-[#F2F3F5] text-s112-text-2', label: 'Umzug' }
                return (
                  <tr key={u.id}
                    className={`border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40 ${istQuelle ? 'bg-s112-err-bg/20' : 'bg-s112-ok-bg/20'}`}>
                    <td className="px-4 py-2.5 text-xs text-s112-text-2 whitespace-nowrap">
                      {new Date(u.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${artBadge.cls}`}>
                        {artBadge.label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <p className={`text-sm ${istQuelle ? 'font-semibold text-s112-blue-700' : 'text-s112-text-2'}`}>{vonBeh}</p>
                      {vonCharge && <p className="text-xs text-s112-muted">{vonCharge}</p>}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className={`text-sm ${!istQuelle ? 'font-semibold text-s112-blue-700' : 'text-s112-text-2'}`}>{nachBeh}</p>
                      {nachCharge && <p className="text-xs text-s112-muted">{nachCharge}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-1 text-xs">{fmt(brutto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-text">{fmt(netto)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-warn-fg text-xs">
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
