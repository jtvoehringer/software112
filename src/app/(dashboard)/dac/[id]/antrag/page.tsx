import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import PNAFormular from './PNAFormular'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Prüfnummernantrag – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function PruefnummernantragPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const [{ data: dacRaw }, { data: cfgRaw }, { data: pnaRaw }] = await Promise.all([
    (supabase.from('dac_antrag') as any)
      .select('id, bezeichnung, dac_region, jahrgang, rebsorte, menge_liter, qualitaetsstufe: status, weinausbau_id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .single(),
    // RLS-gescopter Client statt Admin-Client (wie reports/ama, reports/cu-bilanz):
    // verhindert Betriebsdaten eines fremden Mandanten auf dem amtlichen Prüfnummernantrag.
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_email, betrieb_betriebsnummer')
      .eq('tenant_id', tenantId)
      .limit(1).maybeSingle(),
    (supabase.from('pruefnummernantraege') as any)
      .select('formular_daten')
      .eq('dac_antrag_id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  if (!dacRaw) notFound()

  const dac = dacRaw as R
  const cfg = (cfgRaw as R | null) ?? {}

  // Vorhandene Daten oder Prefill
  const gespeichert = (pnaRaw as R | null)?.formular_daten ?? null

  // Straße / Hausnr. splitten
  const strasseTeile = (cfg.betrieb_strasse ?? '').trim().split(/\s+/)
  const hausnr       = strasseTeile.length > 1 ? strasseTeile.at(-1)! : ''
  const strasse      = strasseTeile.length > 1 ? strasseTeile.slice(0, -1).join(' ') : (strasseTeile[0] ?? '')

  const initial = gespeichert ?? {
    antragsnummer: '',
    untersuchungsnummer: '',
    eingangsdatum: '',
    betriebsnummer: cfg.betrieb_betriebsnummer ?? '',
    name: cfg.betrieb_name ?? '',
    vorname: '',
    plz: cfg.betrieb_plz ?? '',
    ort: cfg.betrieb_ort ?? '',
    strasse,
    hausnr,
    telefon: cfg.betrieb_telefon ?? '',
    telefax: '',
    email: cfg.betrieb_email ?? '',
    bevo_name: '',
    bevo_vorname: '',
    aufbew_plz: '',
    aufbew_ort: '',
    aufbew_strasse: '',
    aufbew_hausnr: '',
    farbe: 'Weiß' as const,
    jahrgangsverschnitt: false,
    jahrgang: dac.jahrgang ? String(dac.jahrgang) : '',
    lesegradation: '',
    angereichert: false,
    gesuesst: false,
    einreichmenge: dac.menge_liter ? String(Math.round(Number(dac.menge_liter))) : '',
    rebsorte: dac.rebsorte ?? '',
    abgefuellt: '' as const,
    teilmenge_pn: '',
    bez_rebsorte: dac.rebsorte ?? '',
    qualitaetsstufe: dac.dac_region ?? '',
    weinbaugebiet: dac.dac_region ?? '',
    bez_jahrgang: dac.jahrgang ? String(dac.jahrgang) : '',
    reserve: false,
    grosse_reserve: false,
    premium: false,
    barrique: false,
    ried: '',
    gemeinde: cfg.betrieb_ort ?? '',
    schilcher: false,
    schilcher_klassik: false,
    bio_wein: false,
    sonstiges: '',
    naechste_qualitaet: false,
    versiegelungsverzicht: false,
    mostchargen: [
      { betriebsnummer: '', laufende_nr: '', jahr: '', teilmenge: '' },
      { betriebsnummer: '', laufende_nr: '', jahr: '', teilmenge: '' },
      { betriebsnummer: '', laufende_nr: '', jahr: '', teilmenge: '' },
    ],
  }

  return (
    <div className="max-w-4xl space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted no-print">
        <Link href="/dac" className="hover:text-s112-teal transition-colors">DAC & Prüfnummern</Link>
        <span>/</span>
        <Link href={`/dac/${id}`} className="hover:text-s112-teal transition-colors">{dac.bezeichnung}</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Prüfnummernantrag</span>
      </div>

      <PNAFormular dacAntragId={id} initial={initial} />
    </div>
  )
}
