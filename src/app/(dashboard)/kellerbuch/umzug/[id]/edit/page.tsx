import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { redirect } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import UmziehenFormClient from '@/components/kellerbuch/UmziehenFormClient'
import { updateUmzugBatch } from '../../../gebinde-actions'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Umzug bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function UmzugEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const role = await getCurrentUserRole()
  if (!canWrite(role)) redirect('/kellerbuch/gebinde?tab=umziehen')

  const supabase = await createSupabaseServerClient()

  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt/bearbeitet werden.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Datensatz laden (um batch_id zu ermitteln)
  const { data: rowRaw } = await tf((supabase.from('keller_umzuege') as any)
    .select('id, umzug_batch_id, datum, notizen, zeilen_typ, von_weinausbau_id, von_behaelter_id, nach_behaelter_id, menge_liter, brutto_liter, schwund_liter')
    .eq('id', id)).single()
  const umzug = rowRaw as R | null
  if (!umzug) notFound()

  const batchId = umzug.umzug_batch_id

  // Alle Batch-Zeilen laden
  let batchRecs: R[] = []
  if (batchId) {
    const { data: batchData } = await tf((supabase.from('keller_umzuege') as any)
      .select('id, zeilen_typ, von_weinausbau_id, von_behaelter_id, nach_behaelter_id, menge_liter, brutto_liter, schwund_liter, datum, notizen')
      .eq('umzug_batch_id', batchId))
    batchRecs = (batchData ?? []) as R[]
  } else {
    batchRecs = [umzug]
  }

  // Gebinde + Chargen laden
  const [{ data: gebindeRaw }, { data: chargenRaw }] = await Promise.all([
    tf((supabase.from('behaelter') as any)
      .select('id, name, aktiv').eq('aktiv', true).order('name')),
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter, behaelter_id, aktiv, behaelter:behaelter_id(name)')
      .eq('aktiv', true).order('name')),
  ])

  const gebinde = (gebindeRaw ?? []) as R[]
  const chargen = (chargenRaw ?? []) as R[]

  // Defaults aus Batch-Zeilen extrahieren
  type Quelle = { weinausbau_id: string; brutto: number }
  type Ziel   = { behaelter_id: string; menge_netto: number }

  const isNewFormat = batchRecs.some(r => r.zeilen_typ === 'quelle' || r.zeilen_typ === 'ziel')

  let defaultQuellen: Quelle[]
  let defaultZiele: Ziel[]
  let defaultDatum: string
  let defaultNotizen: string
  let ersteId: string

  if (isNewFormat) {
    const quelleRecs = batchRecs.filter(r => r.zeilen_typ === 'quelle')
    const zielRecs   = batchRecs.filter(r => r.zeilen_typ === 'ziel')
    defaultQuellen   = quelleRecs.map(r => ({ weinausbau_id: r.von_weinausbau_id ?? '', brutto: parseFloat(r.brutto_liter) || 0 }))
    defaultZiele     = zielRecs.map(r => ({ behaelter_id: r.nach_behaelter_id ?? '', menge_netto: parseFloat(r.menge_liter) || 0 }))
    defaultDatum     = quelleRecs[0]?.datum ?? umzug.datum
    defaultNotizen   = quelleRecs[0]?.notizen ?? ''
    ersteId          = quelleRecs[0]?.id ?? umzug.id
  } else {
    // Altes Format: alle Zeilen teilen dieselbe Quelle, jede Zeile hat ein Ziel
    const hauptRec = batchRecs.find(r => r.brutto_liter != null) ?? batchRecs[0]
    const brutto = parseFloat(hauptRec?.brutto_liter ?? '0') ||
      batchRecs.reduce((s: number, r: R) =>
        s + (parseFloat(r.menge_liter) || 0) + (parseFloat(r.schwund_liter) || 0), 0)
    defaultQuellen   = [{ weinausbau_id: hauptRec?.von_weinausbau_id ?? '', brutto }]
    defaultZiele     = batchRecs.map(r => ({ behaelter_id: r.nach_behaelter_id ?? '', menge_netto: parseFloat(r.menge_liter) || 0 }))
    defaultDatum     = umzug.datum
    defaultNotizen   = hauptRec?.notizen ?? ''
    ersteId          = batchRecs[0]?.id ?? umzug.id
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch/gebinde?tab=umziehen" className="hover:text-s112-blue-700 transition-colors">
          Umziehen
        </Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Bearbeiten</span>
      </div>

      <h1 className="text-2xl font-semibold text-s112-text">Umzug bearbeiten</h1>

      <p className="text-sm text-s112-muted">
        Beim Speichern wird die bestehende Buchung storniert und neu angelegt. Die Bestände werden entsprechend angepasst.
      </p>

      <div className="card p-6">
        <UmziehenFormClient
          gebinde={gebinde}
          chargen={chargen}
          action={updateUmzugBatch.bind(null, ersteId)}
          inputCls={inputCls}
          labelCls={labelCls}
          defaultQuellen={defaultQuellen}
          defaultZiele={defaultZiele}
          defaultDatum={defaultDatum}
          defaultNotizen={defaultNotizen}
          submitLabel="Speichern"
        />
      </div>

      <Link href="/kellerbuch/gebinde?tab=umziehen"
        className="inline-block text-sm text-s112-text-2 hover:text-s112-text-1 transition-colors">
        ← Abbrechen
      </Link>
    </div>
  )
}
