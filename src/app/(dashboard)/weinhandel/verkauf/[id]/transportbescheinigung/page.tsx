import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import TBFormular from './TBFormular'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Transportbescheinigung – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function TransportbescheinigungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const admin    = createSupabaseAdminClient()

  const [{ data: postenRaw, error: postenErr }, { data: cfgRaw }, { data: tbRaw }] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, rechnungsnummer, datum,
        kontakt:kontakte(vorname, nachname, telefon, strasse, plz, ort),
        firma:firmen(name, telefon, strasse, plz, ort),
        positionen:verkauf_positionen(
          id, typ, name, menge,
          weinausbau:weinausbau(id, name, jahrgang, qualitaetsstufe, rebsorte)
        )
      `)
      .eq('id', id)
      .single(),
    (admin.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_betriebsnummer')
      .limit(1).single(),
    (supabase.from('transportbescheinigungen') as any)
      .select('formular_daten')
      .eq('verkaufsposten_id', id)
      .maybeSingle(),
  ])

  if (postenErr || !postenRaw) notFound()

  // Prüfnummern für Tank-Positionen nachladen (dac_antrag.weinausbau_id → pruefnummer)
  const tankWaIds = ((postenRaw as R).positionen ?? [])
    .filter((p: R) => p.typ === 'tank' && p.weinausbau?.id)
    .map((p: R) => p.weinausbau.id as string)

  const pnMap: Record<string, string> = {}
  if (tankWaIds.length > 0) {
    const { data: dacRaw } = await (supabase.from('dac_antrag') as any)
      .select('weinausbau_id, pruefnummer')
      .in('weinausbau_id', tankWaIds)
      .not('pruefnummer', 'is', null)
    for (const d of (dacRaw ?? []) as R[]) {
      if (!pnMap[d.weinausbau_id]) pnMap[d.weinausbau_id] = d.pruefnummer
    }
  }

  const posten  = postenRaw as R
  const cfg     = (cfgRaw as R | null) ?? {}
  const tankPos = ((posten.positionen ?? []) as R[]).filter((p: R) => p.typ === 'tank')

  // Empfänger aus Kontakt oder Firma
  const src   = posten.kontakt ?? posten.firma ?? {}
  const isK   = !!posten.kontakt
  const eName = isK
    ? [src.vorname, src.nachname].filter(Boolean).join(' ')
    : (src.name ?? '')

  const gespeichert = (tbRaw as R | null)?.formular_daten ?? null
  const heute = new Date()

  const initial = gespeichert ?? {
    laufende_nr: '',
    jahr:        String(heute.getFullYear()),
    datum_tag:   String(heute.getDate()).padStart(2, '0'),
    datum_monat: String(heute.getMonth() + 1).padStart(2, '0'),
    datum_jahr:  String(heute.getFullYear()),
    uhrzeit:     '',
    zugmaschine: '',
    anhaenger1:  '',
    anhaenger2:  '',
    // Versender (= Betrieb)
    v_betriebsnummer: cfg.betrieb_betriebsnummer ?? '',
    v_telefon:        cfg.betrieb_telefon ?? '',
    v_name:           cfg.betrieb_name ?? '',
    v_vorname:        '',
    v_strasse:        (cfg.betrieb_strasse ?? '').split(' ').slice(0, -1).join(' '),
    v_hausnr:         (cfg.betrieb_strasse ?? '').split(' ').at(-1) ?? '',
    v_plz:            cfg.betrieb_plz ?? '',
    v_ort:            cfg.betrieb_ort ?? '',
    v_ort_versendung: cfg.betrieb_ort ?? '',
    v_plz_versendung: cfg.betrieb_plz ?? '',
    // Empfänger (= Kunde)
    e_betriebsnummer:  '',
    e_telefon:         src.telefon ?? '',
    e_name:            eName,
    e_vorname:         '',
    e_strasse:         (src.strasse ?? '').split(' ').slice(0, -1).join(' '),
    e_hausnr:          (src.strasse ?? '').split(' ').at(-1) ?? '',
    e_plz:             src.plz ?? '',
    e_ort:             src.ort ?? '',
    e_ort_einlagerung: src.ort ?? '',
    e_plz_einlagerung: src.plz ?? '',
    // Weinpositionen aus Tank-Positionen
    positionen: tankPos.length > 0
      ? tankPos.map((p: R) => {
          const wa = p.weinausbau as R | null
          return {
            menge_liter:      String(p.menge ?? ''),
            art:              'Weiß',
            traubensorte:     wa?.rebsorte ?? '',
            qualitaetsstufe:  wa?.qualitaetsstufe ?? '',
            jahrgang:         wa?.jahrgang ? String(wa.jahrgang) : '',
            herkunft:         cfg.betrieb_ort ?? '',
            fremd_sorten_pct: '',
            fremd_jg_pct:     '',
            pruefnummer:      wa?.id ? (pnMap[wa.id] ?? '') : '',
            anreicherung:     'N',
            alkohol_pct:      '',
            kmw:              '',
          }
        })
      : [{
          menge_liter: '', art: 'Weiß', traubensorte: '', qualitaetsstufe: '',
          jahrgang: '', herkunft: '', fremd_sorten_pct: '', fremd_jg_pct: '',
          pruefnummer: '', anreicherung: 'N', alkohol_pct: '', kmw: '',
        }],
  }

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-center gap-2 text-sm text-s112-muted no-print">
        <Link href="/weinhandel/verkauf" className="hover:text-s112-teal transition-colors">Verkauf</Link>
        <span>/</span>
        <Link href={`/weinhandel/verkauf/${id}`} className="hover:text-s112-teal transition-colors">
          {posten.rechnungsnummer ?? new Date(posten.datum).toLocaleDateString('de-AT')}
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Transportbescheinigung</span>
      </div>

      <TBFormular verkaufspostenId={id} initial={initial} />
    </div>
  )
}
