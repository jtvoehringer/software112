import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import TBFormular from './TBFormular'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Transportbescheinigung – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function TransportbescheinigungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const [{ data: postenRaw, error: postenErr }, { data: cfgRaw }, { data: tbRaw }] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, rechnungsnummer, datum,
        kontakt:kontakte!verkaufsposten_kontakt_id_fkey(vorname, nachname, telefon, strasse, plz, ort),
        firma:firmen(name, telefon, strasse, plz, ort),
        positionen:verkauf_positionen(
          id, typ, name, menge,
          weinausbau:weinausbau(id, name, jahrgang, qualitaetsstufe, rebsorte),
          fuellung:fuellungen(id, name, jahrgang, qualitaet, rebsorte, anbaugebiet, flaschengroesse_ml),
          traubenverkauf:traubenverkauf(id, kmw_grad, qualitaetsstufe, herkunft_code, grundstueck:grundstuecke(rebsorte))
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId ?? '')
      .single(),
    // RLS-gescopter Client statt Admin-Client: verhindert, dass Firmendaten eines
    // anderen Mandanten auf dieses gesetzlich vorgeschriebene Dokument gelangen.
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_betriebsnummer')
      .eq('tenant_id', tenantId ?? '')
      .limit(1).maybeSingle(),
    (supabase.from('transportbescheinigungen') as any)
      .select('formular_daten')
      .eq('verkaufsposten_id', id)
      .eq('tenant_id', tenantId ?? '')
      .maybeSingle(),
  ])

  if (postenErr || !postenRaw) notFound()

  // Prüfnummern für Tank-Positionen nachladen
  const tankWaIds = ((postenRaw as R).positionen ?? [])
    .filter((p: R) => p.typ === 'tank' && p.weinausbau?.id)
    .map((p: R) => p.weinausbau.id as string)

  const pnMap: Record<string, string> = {}
  if (tankWaIds.length > 0) {
    const { data: dacRaw } = await (supabase.from('dac_antrag') as any)
      .select('weinausbau_id, pruefnummer')
      .in('weinausbau_id', tankWaIds)
      .eq('tenant_id', tenantId ?? '')
      .not('pruefnummer', 'is', null)
    for (const d of (dacRaw ?? []) as R[]) {
      if (!pnMap[d.weinausbau_id]) pnMap[d.weinausbau_id] = d.pruefnummer
    }
  }

  const posten  = postenRaw as R
  const cfg     = (cfgRaw as R | null) ?? {}
  // Mostverkauf (Tank), Weinverkauf (Flasche) und Traubenverkauf benötigen alle
  // eine Transportbescheinigung gem. Weingesetz - "sonstiges"-Positionen nicht.
  const relevantePos = ((posten.positionen ?? []) as R[]).filter((p: R) => ['tank', 'flasche', 'trauben'].includes(p.typ))

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
    positionen: relevantePos.length > 0
      ? relevantePos.map((p: R) => {
          if (p.typ === 'tank') {
            const wa = p.weinausbau as R | null
            return {
              menge_liter:      String(p.menge ?? ''),
              art:              'Weiß',
              traubensorte:     wa?.rebsorte ? formatRebsorteMitKuerzel(wa.rebsorte) : '',
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
          }
          if (p.typ === 'flasche') {
            const f = p.fuellung as R | null
            // Menge bei Flaschenverkauf ist die Stückzahl - für den Transportschein
            // (Menge in Liter) auf Basis der Flaschengröße umrechnen.
            const literMenge = f?.flaschengroesse_ml
              ? (Number(p.menge) * Number(f.flaschengroesse_ml)) / 1000
              : null
            return {
              menge_liter:      literMenge != null ? String(literMenge) : String(p.menge ?? ''),
              art:              'Weiß',
              traubensorte:     f?.rebsorte ? formatRebsorteMitKuerzel(f.rebsorte) : '',
              qualitaetsstufe:  f?.qualitaet ?? '',
              jahrgang:         f?.jahrgang ? String(f.jahrgang) : '',
              herkunft:         f?.anbaugebiet ?? cfg.betrieb_ort ?? '',
              fremd_sorten_pct: '',
              fremd_jg_pct:     '',
              pruefnummer:      '',
              anreicherung:     'N',
              alkohol_pct:      '',
              kmw:              '',
            }
          }
          // Traubenverkauf (Menge in kg statt Liter)
          const tv = p.traubenverkauf as R | null
          return {
            menge_liter:      String(p.menge ?? ''),
            art:              'Weiß',
            traubensorte:     (tv?.grundstueck as R | null)?.rebsorte ? formatRebsorteMitKuerzel((tv?.grundstueck as R | null)?.rebsorte) : '',
            qualitaetsstufe:  tv?.qualitaetsstufe ?? '',
            jahrgang:         '',
            herkunft:         tv?.herkunft_code ?? cfg.betrieb_ort ?? '',
            fremd_sorten_pct: '',
            fremd_jg_pct:     '',
            pruefnummer:      '',
            anreicherung:     'N',
            alkohol_pct:      '',
            kmw:              tv?.kmw_grad != null ? String(tv.kmw_grad) : '',
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
        <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700 transition-colors">Verkauf</Link>
        <span>/</span>
        <Link href={`/weinhandel/verkauf/${id}`} className="hover:text-s112-blue-700 transition-colors">
          {posten.rechnungsnummer ?? new Date(posten.datum).toLocaleDateString('de-AT')}
        </Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Transportbescheinigung</span>
      </div>

      <TBFormular verkaufspostenId={id} initial={initial} />
    </div>
  )
}
