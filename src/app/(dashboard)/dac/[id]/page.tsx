import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import { FileText, Tag } from 'lucide-react'
import DacForm from '@/components/dac/DacForm'
import { updateDacAntrag, stornoDacAntrag, loescheDacAntrag, setzeDacStatus, kopiereDacAntragAlsEntwurf } from '../actions'
import DacStatusKarte, { type PnEreignis } from '@/components/dac/DacStatusKarte'
import StornoKarte from '@/components/StornoKarte'
import FreezeKorrektur from '@/components/FreezeKorrektur'
import { pnPflichtFehlend } from '@/lib/dac/workflow'
import { ladePruefnummernantrag } from '@/lib/behoerden/pruefnummernantrag'
import { KORREKTUR_FELDER } from '@/lib/freeze/korrektur'

export const metadata: Metadata = { title: 'Prüfnummern-Antrag bearbeiten' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function DacEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [rowsRes, waRawRes, evRawRes] = await Promise.all([
    // storno-sichtbar: die Detailseite zeigt den stornierten Antrag mit Vermerk (KAN-150 F2)
    tf((supabase.from('dac_antrag') as any)
      .select('id, weinausbau_id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, alkohol_prozent, status, pruefnummer, eingereicht_am, bescheid_am, notizen, aktiv, storniert_am, storniert_von_name, storno_grund, status_seit, antragsnummer, untersuchungsnummer, entzug_am, entzug_grund')
      .eq('id', id).limit(1)),
    alle(tf((supabase.from('weinausbau') as any).select('id, name, jahrgang, rebsorte, menge_liter').eq('aktiv', true).order('name').order('id'))),
    // KAN-97: Verlauf der Statuswechsel
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('pruefnummer_ereignisse') as any)
      .select('id, status_alt, status_neu, datum, pruefnummer, grund, benutzer_name, erstellt_am')
      .eq('dac_antrag_id', id).order('erstellt_am', { ascending: true })),
  ])
  const rows = geladen(rowsRes, 'Prüfnummernanträge')
  const waRaw = geladen(waRawRes, 'Chargen')
  const evRaw = geladen(evRawRes, 'Prüfnummer-Ereignisse')

  const dac0 = (((rows ?? []) as R[])[0] ?? null)
  const { data: anRaw } = dac0?.weinausbau_id
    ? await tf((supabase.from('weinanalysen') as any)
        .select('analyse_datum, labor, alkohol_vol, restzucker_gl, gesamtsaeure_gl, ph_wert, flüchtige_saeure_gl, freie_so2_mgl, gesamt_so2_mgl')
        .eq('weinausbau_id', dac0.weinausbau_id)
        .is('storniert_am', null)   // KAN-150 F2: stornierte Analysen gelten nicht
        .order('analyse_datum', { ascending: false }))
    : { data: [] }
  const analysen = (anRaw ?? []) as R[]

  type DacRow = { id: string; weinausbau_id: string | null; bezeichnung: string; dac_region: string; jahrgang: number | null; rebsorte: string | null; menge_liter: number | null; alkohol_prozent: number | null; status: string; pruefnummer: string | null; eingereicht_am: string | null; bescheid_am: string | null; notizen: string | null; aktiv: boolean; storniert_am: string | null; storniert_von_name: string | null; storno_grund: string | null; status_seit: string | null; antragsnummer: string | null; untersuchungsnummer: string | null; entzug_am: string | null; entzug_grund: string | null }
  type NameRow = { id: string; name: string; jahrgang: number | null; rebsorte: string | null; menge_liter: number | null }

  const dac       = dac0 as DacRow | null
  if (!dac) notFound()
  const weinausbau = (waRaw ?? []) as NameRow[]
  const ereignisse = (evRaw ?? []) as PnEreignis[]
  const schreiben = !!membership && canWrite(membership, 'kellerbuch')
  // Rückmeldung Jörgen 07.10.2026: im Entwurf vorab zeigen, was zum Einreichen fehlt (dieselbe Prüfung wie setzeDacStatus)
  const imEntwurf = schreiben && !!tenantId && dac.status === 'entwurf' && !dac.storniert_am
  const pna = imEntwurf && tenantId ? await ladePruefnummernantrag(supabase, tenantId, { id }) : null
  const einreichFehlend = imEntwurf ? pnPflichtFehlend(dac as unknown as R, (pna?.formular ?? null) as R | null, !!pna?.gespeichert) : []
  // KAN-196: gesperrter Antrag (ab Eingereicht) – Korrektur mit Grund nur für die Betriebsleitung
  const korrektur = !!membership && canAdmin(membership.role) && !dac.storniert_am && dac.status !== 'entwurf'

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/dac" className="hover:text-s112-blue-700 transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{dac.bezeichnung}</span>
      </div>
      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">{dac.bezeichnung}</h1>
        <div className="flex items-center gap-2">
          {dac.pruefnummer && (
            <span className="bg-s112-ok-bg text-s112-ok-fg text-sm font-mono px-3 py-1 rounded-lg border border-s112-ok/30">
              {dac.pruefnummer}
            </span>
          )}
          <Link
            href={`/dac/${id}/antrag`}
            className="flex items-center gap-1.5 border border-s112-border px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-s112-bg transition-colors"
          >
            <FileText size={14} /> Prüfnummernantrag
          </Link>
          {dac.pruefnummer && (
            <Link
              href={`/dac/${id}/etikett`}
              className="flex items-center gap-1.5 bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-s112-teal/90 transition-colors"
            >
              <Tag size={14} /> Etikett
            </Link>
          )}
        </div>
      </div>
      {/* KAN-150 F2: stornierter Antrag ist unveränderlich – nur der Vermerk, kein Formular */}
      <div className="mb-6">
        <DacStatusKarte status={dac.status} pruefnummer={dac.pruefnummer} ereignisse={ereignisse} schreiben={schreiben}
          storniert={!!dac.storniert_am} setzen={setzeDacStatus.bind(null, id)} kopieren={kopiereDacAntragAlsEntwurf.bind(null, id)}
          einreichFehlend={einreichFehlend} antragHref={`/dac/${id}/antrag`} />
      </div>
      {!dac.storniert_am && <DacForm dac={dac} weinausbau={weinausbau} analysen={analysen} action={updateDacAntrag.bind(null, id)} betriebsleitung={korrektur} />}
      {korrektur && (
        <div className="mt-4">
          <FreezeKorrektur tabelle="dac_antrag" id={id} felder={KORREKTUR_FELDER.dac_antrag} werte={dac}
            hinweis="Nur für die Betriebsleitung – z. B. versehentlich eingereicht, Tippfehler in Prüfnummer oder Datum. Status bewusst an der Übergangsmatrix vorbei; Entzug weiter über den Statuswechsel. Alt/Neu, Benutzer und Grund stehen im Änderungsprotokoll." />
        </div>
      )}
      {membership && schreiben && (
        <div className="mt-6">
          <StornoKarte was="der Antrag" stand={dac}
            stornieren={dac.storniert_am ? undefined : stornoDacAntrag.bind(null, id)}
            loeschen={loescheDacAntrag.bind(null, id)}
            entwurfLoeschbar={dac.status === 'entwurf' && canAdmin(membership.role)}
            nachLoeschen="/dac"
            hinweis="Der Antrag bleibt als storniert stehen, gilt aber nicht mehr als Prüfnummer und wird nicht mehr zur Auswahl angeboten." />
        </div>
      )}
    </div>
  )
}
