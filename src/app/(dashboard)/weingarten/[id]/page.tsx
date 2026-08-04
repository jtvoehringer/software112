
type ErtragHistorie = {
  jahrgang: number
  menge_kg: number
  datum: string | null
  grundstueck_id: string | null
  gst_nr: string | null
}
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'

export const dynamic = 'force-dynamic'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import WeingartenForm from '@/components/weingarten/WeingartenForm'
import GrundstueckePanel, { type GST, type MassnahmeHistorie } from '../GrundstueckePanel'
import { updateWeingarten } from '../actions'
import { ladeCustomWeinbaugebiete } from '../../weinbaugebiete/actions'

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
}

export default async function WeingartenEditPage({ params }: Props) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const writeOk = canWrite(role)
  const adminOk = canAdmin(role)

  // Weingarten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase.from('weingarten') as any)
    .select('id, name, rebsorte, pflanzjahr, bewirtschaftung, bewirtschaftung_seit, weinart, notizen, aktiv')
    .eq('id', id)
    .limit(1)
  const weingarten = ((rows as WeingartenRow[] | null)?.[0]) ?? null
  if (!weingarten) notFound()

  // Grundstücke
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawG } = await (supabase.from('grundstuecke') as any)
    .select('id, weingarten_id, gst_nr, katastralgemeinde, einlagezahl, kg_bezeichnung, ama_feldnummer, boden, rechtsverhaeltnis, unterlagsrebe, rebsorte, pflanzjahr, weinart, bewirtschaftung, bewirtschaftung_seit, flaeche_ha, flaeche_ha_kataster, trauben_herkunft_code, status, notizen')
    .eq('weingarten_id', id)
    .order('gst_nr')
  const grundstuecke = (rawG ?? []) as GST[]

  // Eigene, vom Mandanten selbst angelegte Weinbaugebiete (Herkunft-Code-Selbstverwaltung)
  const customWeinbaugebiete = await ladeCustomWeinbaugebiete()

  // Historische Ertragsdaten
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawErtrag } = await (supabase.from('ernte_parzellen') as any)
    .select('menge_kg, ernte_datum, grundstueck_id, weinjahrgaenge!jahrgang_id(jahrgang), grundstueck:grundstueck_id(gst_nr)')
    .eq('weingarten_id', id)
    .not('menge_kg', 'is', null)
    .order('ernte_datum', { ascending: false })
  const ertragHistorie: ErtragHistorie[] = ((rawErtrag ?? []) as AR[])
    .filter((r: AR) => r.weinjahrgaenge?.jahrgang)
    .map((r: AR) => ({
      jahrgang: r.weinjahrgaenge.jahrgang as number,
      menge_kg: r.menge_kg as number,
      datum: r.ernte_datum as string | null,
      grundstueck_id: r.grundstueck_id ?? null,
      gst_nr: (r.grundstueck as AR | null)?.gst_nr ?? null,
    }))

  // Flächensummen aus Grundstücken
  const gstHaAma      = grundstuecke.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)
  const gstHaKataster = grundstuecke.reduce((s, g) => s + (g.flaeche_ha_kataster ?? 0), 0)
  const flaecheByGstId: Record<string, number> = {}
  for (const g of grundstuecke) flaecheByGstId[g.id] = g.flaeche_ha ?? 0
  // Fläche für eine Ertragszeile: die des tatsächlich geernteten Grundstücks (wenn bekannt),
  // sonst Fallback auf die volle Ried-Fläche (Ernte ohne GST-Aufteilung) – NICHT immer die
  // Summe aller Grundstücke, sonst wird der Ertrag bei mehreren GSTs pro Ried verwässert.
  const flaecheFuerZeile = (e: ErtragHistorie): number =>
    e.grundstueck_id ? (flaecheByGstId[e.grundstueck_id] ?? gstHaAma) : gstHaAma

  // Ertragshistorie gruppiert nach GST (für GrundstueckePanel)
  const ertragByGst: Record<string, ErtragHistorie[]> = {}
  for (const e of ertragHistorie) {
    const key = e.grundstueck_id ?? '__ohne__'
    if (!ertragByGst[key]) ertragByGst[key] = []
    ertragByGst[key].push(e)
  }

  // Maßnahmen-Verlauf je GST (Punkt 10, analog Ertragshistorie) – Verknüpfung existiert
  // bereits über die Junction-Tabelle behandlung_grundstuecke, wurde bisher aber nirgends
  // auf GST-Ebene angezeigt.
  const gstIds = grundstuecke.map(g => g.id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawMassnahmen } = gstIds.length > 0
    ? await (supabase.from('behandlung_grundstuecke') as any)
        .select(`
          grundstueck_id,
          behandlung:behandlung_id ( id, datum, art, aufwandmenge, aufwandmenge_einheit, psm:psm_id(name) )
        `)
        .in('grundstueck_id', gstIds)
    : { data: [] }

  const massnahmenByGst: Record<string, MassnahmeHistorie[]> = {}
  for (const row of ((rawMassnahmen ?? []) as AR[])) {
    const b = row.behandlung as AR | null
    if (!b) continue
    const key = row.grundstueck_id as string
    if (!massnahmenByGst[key]) massnahmenByGst[key] = []
    massnahmenByGst[key].push({
      id: b.id,
      datum: b.datum,
      art: b.art ?? 'spritzung',
      psm_name: b.psm?.name ?? null,
      aufwandmenge: b.aufwandmenge ?? null,
      aufwandmenge_einheit: b.aufwandmenge_einheit ?? null,
    })
  }
  for (const key of Object.keys(massnahmenByGst)) {
    massnahmenByGst[key].sort((a, b) => b.datum.localeCompare(a.datum))
  }

  const action = updateWeingarten.bind(null, id)

  return (
    <div>
      <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/weingarten" className="hover:text-s112-teal transition-colors">Rieden</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{weingarten.name}</span>
      </div>

      <div className="flex items-start justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{weingarten.name}</h1>
        {!weingarten.aktiv && (
          <span className="bg-gray-100 text-gray-500 text-xs px-2 py-1 rounded-full font-medium">
            Inaktiv
          </span>
        )}
      </div>

      {/* Stammdaten-Formular */}
      <div className="card mb-6">
        <h2 className="text-base font-semibold text-gray-800 mb-4">Stammdaten</h2>
        <WeingartenForm weingarten={weingarten} action={action} />

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

      {/* Grundstücke – volle Breite */}
      <div className="card mt-6">
        <GrundstueckePanel
          weingartenId={id}
          grundstuecke={grundstuecke}
          ertragByGst={ertragByGst}
          massnahmenByGst={massnahmenByGst}
          customWeinbaugebiete={customWeinbaugebiete}
        />
      </div>

      {/* Historische Ertragsdaten */}
      <div className="max-w-2xl">
      {ertragHistorie.length > 0 && (
        <div className="card mt-6">
          <h2 className="text-base font-semibold text-gray-800 mb-4">Ertragshistorie</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Jahrgang</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">GST</th>
                <th className="text-left px-3 py-2 text-xs font-semibold text-gray-600">Ernte-Datum</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">Menge (kg)</th>
                <th className="text-right px-3 py-2 text-xs font-semibold text-gray-600">kg/ha (AMA)</th>
              </tr>
            </thead>
            <tbody>
              {ertragHistorie.map((e, i) => {
                const zeilenFlaeche = flaecheFuerZeile(e)
                return (
                  <tr key={i} className="border-b border-s112-border/40 hover:bg-s112-bg/50">
                    <td className="px-3 py-2 font-semibold text-gray-800">{e.jahrgang}</td>
                    <td className="px-3 py-2 font-mono text-xs text-s112-muted">{e.gst_nr ?? '–'}</td>
                    <td className="px-3 py-2 text-gray-600">
                      {e.datum ? new Date(e.datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-800">
                      {e.menge_kg.toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray-600">
                      {zeilenFlaeche > 0
                        ? (e.menge_kg / zeilenFlaeche).toLocaleString('de-AT', { maximumFractionDigits: 0 })
                        : '–'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>{/* end max-w-2xl (Ertragshistorie) */}
    </div>
  )
}
