import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentUserRole, getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import WeingartenForm from '@/components/weingarten/WeingartenForm'
import GrundstueckePanel, { type GST, type MassnahmeHistorie } from '../GrundstueckePanel'
import { updateWeingarten } from '../actions'
import RiedGeoPanel from '@/components/weingarten/RiedGeoPanel'
import { ladeCustomWeinbaugebiete } from '../../weinbaugebiete/actions'
import { alle } from '@/lib/supabase/alle'
import { ladeBehandlungen, type PsmBehandlung } from '@/lib/behoerden/psm'
import { verteileMassnahme, type WiGst } from '@/lib/wein/massnahmeAnteile'
import ReifeMessungen from './ReifeMessungen'
import type { ReifeMessung } from '@/lib/wein/reifemessung'
import { wienHeute } from '@/lib/csv'

export const metadata: Metadata = { title: 'Ried bearbeiten – software:112' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

interface Props {
  params: Promise<{ id: string }>
}

type WeingartenRow = {
  id: string; name: string
  rebsorte: string | null; pflanzjahr: number | null
  bewirtschaftung: string | null; bewirtschaftung_seit: string | null
  notizen: string | null; aktiv: boolean; weinart: string | null
  ama_feldnummer: string | null; codes: string | null; interne_bezeichnung: string | null
  zentrum_lat: number | null; zentrum_lon: number | null; geometrie: unknown; geo_quelle: string | null; geo_stand: string | null
}

export default async function WeingartenEditPage({ params }: Props) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const writeOk = canWrite(role, 'rieden')
  const adminOk = canAdmin(role)

  // Weingarten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let weingartenQuery = (supabase.from('weingarten') as any)
    .select('id, name, rebsorte, pflanzjahr, bewirtschaftung, bewirtschaftung_seit, weinart, notizen, aktiv, ama_feldnummer, codes, interne_bezeichnung, zentrum_lat, zentrum_lon, geometrie, geo_quelle, geo_stand')
    .eq('id', id)
  if (membership) weingartenQuery = weingartenQuery.eq('tenant_id', membership.tenantId)
  const rows = geladen(await weingartenQuery.limit(1), 'Ried')
  const weingarten = ((rows as WeingartenRow[] | null)?.[0]) ?? null
  if (!weingarten) notFound()

  // Grundstücke
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let grundstueckeQuery = (supabase.from('grundstuecke') as any)
    .select('id, weingarten_id, gst_nr, katastralgemeinde, einlagezahl, kg_bezeichnung, ama_feldnummer, boden, rechtsverhaeltnis, unterlagsrebe, rebsorte, pflanzjahr, weinart, bewirtschaftung, bewirtschaftung_seit, flaeche_ha, flaeche_ha_kataster, trauben_herkunft_code, status, nutzart, notizen, lse_stueckzahl, geometrie, aktiv, deaktiviert_am')
    .eq('weingarten_id', id)
  if (membership) grundstueckeQuery = grundstueckeQuery.eq('tenant_id', membership.tenantId)
  const rawG = geladen(await grundstueckeQuery.order('gst_nr'), 'Grundstücke')
  const grundstuecke = (rawG ?? []) as GST[]

  // Eigene, vom Mandanten selbst angelegte Weinbaugebiete (Herkunft-Code-Selbstverwaltung)
  const customWeinbaugebiete = await ladeCustomWeinbaugebiete()

  // Flächensummen aus Grundstücken
  const gstHaAma      = grundstuecke.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)
  const gstHaKataster = grundstuecke.reduce((s, g) => s + (g.flaeche_ha_kataster ?? 0), 0)

  // Maßnahmen-Verlauf je GST (Punkt 10). KAN-132: je Maßnahme ALLE Grundstücke laden (über die
  // mandantengefilterte Maßnahme, ladeBehandlungen) und mit verteileMassnahme() anteilig auf die GST verteilen –
  // bei Aufwand in kg bzw. l (gesamt) stand bisher an jedem GST die Gesamtmenge. Maßnahmen nur an dieser Ried
  // (ohne Grundstück) werden auf deren WI-GST verteilt, mit Vermerk.
  const gstIds = grundstuecke.map(g => g.id)
  const gstIdSet = new Set(gstIds)
  const tenantIdFuerMassnahmen = membership?.tenantId ?? null
  const massnahmenByGst: Record<string, MassnahmeHistorie[]> = {}
  if (tenantIdFuerMassnahmen) {
    const [bgRes, nurWgRes] = await Promise.all([
      gstIds.length > 0
        // alle-ausnahme: Grundstücke eines einzelnen Rieds, wenige
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? alle<AR>((supabase.from('behandlung_grundstuecke') as any).select('behandlung_id, grundstueck_id').in('grundstueck_id', gstIds).order('behandlung_id'))
        : Promise.resolve({ data: [] as AR[], error: null }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      alle<AR>((supabase.from('behandlungen') as any).select('id').eq('tenant_id', tenantIdFuerMassnahmen).eq('weingarten_id', id).is('storniert_am', null).order('id')),
    ])
    const ids = [...new Set([...(bgRes.data ?? []).map(r => String(r.behandlung_id)), ...(nurWgRes.data ?? []).map(r => String(r.id))])]
    const [{ behandlungen }, kostenRes] = await Promise.all([
      ids.length > 0
        ? ladeBehandlungen(supabase, tenantIdFuerMassnahmen, { ids })
        : Promise.resolve({ behandlungen: [] as PsmBehandlung[] }),
      // KAN-132 Soll 10: Kosten je GST laufend = Betrag der Maßnahme × Anteil (nicht gespeichert)
      ids.length > 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ? alle<AR>((supabase.from('kosteneintraege') as any).select('behandlung_id, betrag').eq('tenant_id', tenantIdFuerMassnahmen).not('behandlung_id', 'is', null).order('behandlung_id'))
        : Promise.resolve({ data: [] as AR[], error: null }),
    ])
    const kostenJeMassnahme = new Map<string, number>()
    for (const k of kostenRes.data ?? []) {
      const bid = String(k.behandlung_id)
      kostenJeMassnahme.set(bid, (kostenJeMassnahme.get(bid) ?? 0) + (Number(k.betrag) || 0))
    }
    const wi: WiGst[] = grundstuecke.filter(g => g.nutzart === 'WI').map(g => ({
      grundstueckId: g.id, gstNr: g.gst_nr, kgNr: g.katastralgemeinde, kgName: g.kg_bezeichnung ?? null,
      weingartenId: id, weingarten: weingarten.name, ried: null, lageId: null, flaecheHa: g.flaeche_ha,
    }))
    const wiJeWg = new Map([[id, wi]])
    for (const b of behandlungen) {
      const v = verteileMassnahme(b, { wiGstJeWeingarten: wiJeWg, kostenEur: kostenJeMassnahme.get(b.id) ?? null })
      for (const a of v.anteile) {
        if (!a.grundstueckId || !gstIdSet.has(a.grundstueckId)) continue
        ;(massnahmenByGst[a.grundstueckId] ??= []).push({
          id: b.id,
          datum: b.datum,
          art: b.art,
          psm_name: b.psm?.name ?? b.duengemittel?.name ?? null,
          aufwandmenge: b.aufwand,
          aufwandmenge_einheit: b.aufwandEinheit,
          menge: a.mittel, menge_einheit: a.mittelEinheit,
          bruehe: a.bruehe,
          flaeche_ha: a.flaecheHa, anteil_pct: v.anteile.length > 1 ? a.anteil * 100 : null,
          vermerk: a.vermerk,
          kosten_eur: a.kostenEur,
        })
      }
    }
  }
  for (const key of Object.keys(massnahmenByGst)) {
    massnahmenByGst[key].sort((a, b) => b.datum.localeCompare(a.datum))
  }

  // KAN-203: Reife-Messungen dieser Ried (Verlauf, neueste zuerst in der Komponente)
  const reifeRes = membership
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ? await alle<ReifeMessung>((supabase.from('reifemessungen') as any)
        .select('id, datum, kmw, oechsle, mostgewicht_einheit, gesamtsaeure_gl, ph_wert, notizen, created_at')
        .eq('tenant_id', membership.tenantId).eq('weingarten_id', id).order('datum').order('id'))
    : { data: [] as ReifeMessung[], error: null }

  const action = updateWeingarten.bind(null, id)

  return (
    <div>
      <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weingarten" className="hover:text-s112-blue-700 transition-colors">Rieden</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{weingarten.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">{weingarten.name}</h1>
        {!weingarten.aktiv && (
          <span className="bg-[#F2F3F5] text-s112-text-2 text-xs px-2 py-1 rounded-full font-medium">
            Inaktiv
          </span>
        )}
      </div>

      {/* Stammdaten-Formular */}
      <div className="card mb-6">
        <h2 className="text-base font-semibold text-s112-text mb-4">Stammdaten</h2>
        <WeingartenForm weingarten={weingarten} action={action} readOnly={!writeOk} />

        {/* GST-Flächensummen (read-only, aus Grundstücken) */}
        {grundstuecke.length > 0 && (
          <div className="mt-4 pt-4 border-t border-s112-border grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-s112-muted mb-0.5">GST-Fläche lt. AMA</p>
              <p className="text-sm font-semibold tabular-nums">
                {gstHaAma > 0 ? gstHaAma.toFixed(4).replace('.', ',') + ' ha' : '–'}
              </p>
              <p className="text-xs text-s112-muted">Summe aller Grundstücke</p>
            </div>
            <div>
              <p className="text-xs text-s112-muted mb-0.5">GST-Fläche lt. Kataster</p>
              <p className="text-sm font-semibold tabular-nums">
                {gstHaKataster > 0 ? gstHaKataster.toFixed(4).replace('.', ',') + ' ha' : '–'}
              </p>
              <p className="text-xs text-s112-muted">Summe aller Grundstücke</p>
            </div>
          </div>
        )}
      </div>

      </div>{/* end max-w-2xl */}

      {/* KAN-203: Reife-Messungen (Mostgewicht-Verlauf je Ried) */}
      {reifeRes.error
        ? <p role="alert" className="card mt-6 text-sm text-s112-err-fg">Reife-Messungen konnten nicht geladen werden: {reifeRes.error.message}</p>
        : <ReifeMessungen weingartenId={id} messungen={reifeRes.data ?? []} writeOk={writeOk} heute={wienHeute()} />}

      {/* Lage & Koordinaten – Riedenebene (Stufe 1, Migration 181) */}
      <div className="mt-6">
        <RiedGeoPanel
          weingartenId={id}
          name={weingarten.name}
          lat={weingarten.zentrum_lat != null ? Number(weingarten.zentrum_lat) : null}
          lon={weingarten.zentrum_lon != null ? Number(weingarten.zentrum_lon) : null}
          geometrie={weingarten.geometrie ?? null}
          weitere={(grundstuecke as (GST & { geometrie?: unknown })[]).filter(g => g.geometrie).map(g => ({ name: `GST ${g.gst_nr}${g.rebsorte ? ` · ${g.rebsorte}` : ''}${g.ama_feldnummer ? ` · Schlag ${g.ama_feldnummer}` : ''}`, geometrie: g.geometrie }))}
          geoQuelle={weingarten.geo_quelle}
          geoStand={weingarten.geo_stand}
          writeOk={writeOk}
        />
      </div>

      {/* Grundstücke – volle Breite */}
      <div className="card mt-6">
        <GrundstueckePanel
          weingartenId={id}
          grundstuecke={grundstuecke}
          massnahmenByGst={massnahmenByGst}
          customWeinbaugebiete={customWeinbaugebiete}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      </div>
    </div>
  )
}
