// behoerdenmeldung: dac-antraege
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Pencil } from 'lucide-react'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeDacAntraege, DAC_STATUS_LABEL, type DacAntragZeile } from '@/lib/behoerden/dac'

export const metadata: Metadata = { title: 'DAC & Prüfnummern – software:112' }
export const dynamic = 'force-dynamic'

const STATUS_FARBE: Record<string, string> = {
  entwurf:      'bg-[#F2F3F5] text-s112-text-2',
  eingereicht:  'bg-s112-blue-100 text-s112-blue-700',
  in_pruefung:  'bg-s112-warn-bg text-s112-warn-fg',
  genehmigt:    'bg-s112-ok-bg text-s112-ok-fg',
  abgelehnt:    'bg-s112-err-bg text-s112-err-fg',
}

export default async function DacPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'kellerbuch')
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  // Dieselbe Ladefunktion wie die CSV (/meldungen/dac-antraege/csv)
  const antraege: DacAntragZeile[] = tenantId ? (await ladeDacAntraege(supabase, tenantId)).zeilen : []
  // KAN-150 F2: stornierte Anträge zählen in keiner Kennzahl (bleiben in der Liste mit Vermerk)
  const gueltig     = antraege.filter(a => !a.storniertAm)
  const genehmigt   = gueltig.filter(a => a.status === 'genehmigt').length
  const offen       = gueltig.filter(a => ['eingereicht','in_pruefung'].includes(a.status ?? '')).length
  const entwuerfe   = gueltig.filter(a => a.status === 'entwurf').length

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">DAC & Prüfnummern</h1>
          <p className="text-sm text-s112-muted mt-0.5">Anträge nach österreichischem Weinrecht</p>
        </div>
        <div className="flex items-start gap-2">
          <CsvExportKnopf href={csvPfad('dac-antraege')} className="self-center" />
          {writeOk && (
            <Link href="/dac/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Neuer Antrag
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-ok-fg">{genehmigt}</p>
          <p className="text-xs text-s112-muted mt-1">Genehmigt</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{offen}</p>
          <p className="text-xs text-s112-muted mt-1">In Bearbeitung</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-text-2">{entwuerfe}</p>
          <p className="text-xs text-s112-muted mt-1">Entwürfe</p>
        </div>
      </div>

      {antraege.length > 0 ? (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Bezeichnung</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">DAC-Region</th>
                <th className="text-center px-4 py-3 font-semibold text-s112-text-1">JG</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Status</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Prüfnummer</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Eingereicht</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1"></th>
              </tr>
            </thead>
            <tbody>
              {antraege.map((a, i) => {
                const st = { label: a.statusLabel ?? (a.status ? (DAC_STATUS_LABEL[a.status] ?? a.status) : ''), color: (a.status && STATUS_FARBE[a.status]) || 'bg-[#F2F3F5] text-s112-text-2' }
                return (
                  <tr key={a.id} className={`border-b border-s112-border last:border-0 ${a.storniertAm ? 'opacity-70' : !a.aktiv ? 'opacity-40' : ''} ${i%2===1 ? 'bg-s112-bg/50' : ''}`}>
                    <td className="px-4 py-3 font-medium">
                      {a.bezeichnung}
                      {a.storniertAm && (
                        <p className="text-[11px] font-normal text-s112-warn-fg">
                          storniert am {new Date(a.storniertAm).toLocaleDateString('de-AT')}{a.storniertVon ? ` von ${a.storniertVon}` : ''}{a.stornoGrund ? ` – ${a.stornoGrund}` : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-s112-muted">{a.dacRegionLabel}</td>
                    <td className="px-4 py-3 text-center tabular-nums">{a.jahrgang ?? '–'}</td>
                    <td className="px-4 py-3">
                      {a.storniertAm
                        ? <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-s112-err-bg text-s112-err-fg">Storniert</span>
                        : <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {a.pruefnummer ? (
                        <span className="bg-s112-ok-bg text-s112-ok-fg px-2 py-1 rounded">{a.pruefnummer}</span>
                      ) : '–'}
                    </td>
                    <td className="px-4 py-3 text-s112-muted text-xs">
                      {a.eingereichtAm ? new Date(a.eingereichtAm).toLocaleDateString('de-AT') : '–'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {writeOk && (
                        <Link href={`/dac/${a.id}`}
                          title={a.storniertAm ? 'Ansehen' : 'Bearbeiten'} aria-label={a.storniertAm ? 'Ansehen' : 'Bearbeiten'}
                          className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={16} /></Link>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card text-center py-16">
          <p className="text-s112-text-1 font-medium">Noch keine Anträge</p>
          <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihren ersten Antrag an</p>
          {writeOk && (
            <Link href="/dac/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
              Erster Antrag
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
