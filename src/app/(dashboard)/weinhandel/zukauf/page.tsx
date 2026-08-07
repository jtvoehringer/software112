import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import Link from 'next/link'
import { Pencil, AlertTriangle } from 'lucide-react'
import ZukaufLoeschen from './ZukaufLoeschen'
import ClickableTableRow from '@/components/ui/ClickableTableRow'
import StopPropagation from '@/components/ui/StopPropagation'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const ART_LABEL: Record<string, string> = {
  wein:    'Wein',
  trauben: 'Trauben',
  most:    'Most',
}

// Traubenzukauf für Weinproduzenten (nicht für Weinhändler, die i.d.R. gar
// keine eigenen Rieden bewirtschaften) gesetzlich auf eine durchschnittliche
// Menge je Hektar bewirtschafteter Rebfläche pro Kalenderjahr begrenzt
// (Eigenbau-Grenze). Reine Info-/Warnfunktion, ersetzt keine rechtliche Prüfung.
const TRAUBENZUKAUFSGRENZE_KG_HA = 1500

export default async function ZukaufPage({
  searchParams,
}: {
  searchParams: { zjahr?: string }
}) {
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)
  const membership = await getCurrentMembership()

  const sp    = await searchParams
  const zjahr = parseInt(sp.zjahr ?? '') || new Date().getFullYear()

  const { data } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, art, menge, einheit, preis_gesamt, rebsorte, jahrgang, notizen,
      eingangsrechnungsnummer,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(id, vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(id, name),
      ziel_weinausbau:weinausbau!ziel_weinausbau_id(id, name, behaelter:behaelter!behaelter_id(id, name))
    `)
    .eq('aktiv', true)
    .order('datum', { ascending: false })

  const posten = (data ?? []) as R[]

  // ── Traubenzukaufsgrenze (nur Weinproduzenten) ───────────────────────────
  // "Weinproduzent" wird – wie an anderer Stelle im Admin-Bereich (Standard-
  // Umsatzsteuer) – über ust_satz_standard=13 identifiziert; es gibt (noch)
  // kein eigenes Betriebstyp-Flag.
  let traubenzukaufsgrenze: {
    jahr: number; summeKg: number; gesamtFlaecheHaBetrieb: number; maxKg: number
    ueberschreitungKg: number; ueberschritten: boolean
  } | null = null

  if (membership?.tenantId) {
    const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
      .select('ust_satz_standard').eq('tenant_id', membership.tenantId).maybeSingle()
    const istWeinproduzent = Number((einst as R | null)?.ust_satz_standard) === 13

    if (istWeinproduzent) {
      const [{ data: rawGSTFl }, { data: rawTraubenZukauf }] = await Promise.all([
        (supabase.from('grundstuecke') as any).select('flaeche_ha').eq('status', 'aktiv'),
        (supabase.from('zukauf_posten') as any)
          .select('menge')
          .eq('art', 'trauben')
          .eq('aktiv', true)
          .gte('datum', `${zjahr}-01-01`)
          .lte('datum', `${zjahr}-12-31`),
      ])
      const gesamtFlaecheHaBetrieb = ((rawGSTFl ?? []) as R[]).reduce((s, g) => s + (Number(g.flaeche_ha) || 0), 0)
      const summeKg = ((rawTraubenZukauf ?? []) as R[]).reduce((s, z) => s + (Number(z.menge) || 0), 0)
      const maxKg = TRAUBENZUKAUFSGRENZE_KG_HA * gesamtFlaecheHaBetrieb
      traubenzukaufsgrenze = {
        jahr: zjahr, summeKg, gesamtFlaecheHaBetrieb, maxKg,
        ueberschreitungKg: Math.max(0, summeKg - maxKg),
        ueberschritten: gesamtFlaecheHaBetrieb > 0 && summeKg > maxKg,
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-teal transition-colors">Weinhandel</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">Zukäufe</span>
      </div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">Zukäufe</h1>
        {writeOk && (
          <Link href="/weinhandel/zukauf/neu"
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            + Neuer Zukauf
          </Link>
        )}
      </div>

      {traubenzukaufsgrenze && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          traubenzukaufsgrenze.ueberschritten
            ? 'bg-red-50 border-red-200 text-red-700'
            : 'bg-s112-bg border-s112-border text-gray-600'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="inline-flex items-start gap-1.5">
              {traubenzukaufsgrenze.ueberschritten && <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />}
              <span>
                Traubenzukauf {traubenzukaufsgrenze.jahr}: <strong>{traubenzukaufsgrenze.summeKg.toLocaleString('de-AT')} kg</strong>
                {' '}von max. <strong>{traubenzukaufsgrenze.maxKg.toLocaleString('de-AT', { maximumFractionDigits: 0 })} kg</strong>
                {' '}({TRAUBENZUKAUFSGRENZE_KG_HA.toLocaleString('de-AT')} kg/ha × {traubenzukaufsgrenze.gesamtFlaecheHaBetrieb.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha Rebfläche)
              </span>
            </span>
            <div className="flex items-center gap-3">
              {traubenzukaufsgrenze.ueberschritten && (
                <span className="font-semibold">Überschreitung: {traubenzukaufsgrenze.ueberschreitungKg.toLocaleString('de-AT')} kg</span>
              )}
              <div className="flex items-center gap-1 text-xs">
                <Link href={`/weinhandel/zukauf?zjahr=${traubenzukaufsgrenze.jahr - 1}`} className="px-1.5 py-0.5 rounded hover:bg-black/5">← {traubenzukaufsgrenze.jahr - 1}</Link>
                <Link href={`/weinhandel/zukauf?zjahr=${traubenzukaufsgrenze.jahr + 1}`} className="px-1.5 py-0.5 rounded hover:bg-black/5">{traubenzukaufsgrenze.jahr + 1} →</Link>
              </div>
            </div>
          </div>
          <p className="text-xs mt-1 opacity-75">
            Traubenzukauf für Weinproduzenten gesetzlich auf durchschnittlich 1.500 kg je Hektar bewirtschafteter
            Rebfläche pro Betrieb und Kalenderjahr begrenzt (Eigenbau-Grenze). Hinweis, keine rechtliche Prüfung –
            berücksichtigt nur als „Trauben" erfasste Zukäufe des gewählten Kalenderjahres.
          </p>
        </div>
      )}

      {posten.length === 0 ? (
        <div className="card p-10 text-center text-s112-muted text-sm">
          <p className="font-medium">Noch keine Zukäufe erfasst</p>
          <p className="mt-1">Erfasse zugekauften Wein, Trauben oder Traubenmost.</p>
          {writeOk && (
            <Link href="/weinhandel/zukauf/neu"
              className="mt-4 inline-block text-s112-teal hover:underline text-sm font-medium">
              Ersten Zukauf anlegen →
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg text-left">
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Datum</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Belegnr.</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Art</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Lieferant</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Rebsorte / Jg.</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">Menge</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500 text-right">Gesamtpreis</th>
                <th className="px-4 py-3 text-xs font-semibold text-gray-500">Gebinde</th>
                {writeOk && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border">
              {posten.map((p: R) => {
                const lieferant = p.lieferant_kontakt
                  ? [p.lieferant_kontakt.vorname, p.lieferant_kontakt.nachname].filter(Boolean).join(' ')
                  : p.lieferant_firma?.name ?? '–'
                const rebInfo = [p.rebsorte, p.jahrgang].filter(Boolean).join(' ') || '–'
                return (
                  <ClickableTableRow key={p.id} href={`/weinhandel/zukauf/${p.id}/edit`} className="hover:bg-s112-bg/50 transition-colors">
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {new Date(p.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-700">{p.eingangsrechnungsnummer || <span className="text-s112-muted">–</span>}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{ART_LABEL[p.art] ?? p.art}</td>
                    <td className="px-4 py-3 text-gray-700">{lieferant}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{rebInfo}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-800">
                      {Number(p.menge).toLocaleString('de-AT')} {p.einheit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                      {p.preis_gesamt != null
                        ? Number(p.preis_gesamt).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                        : '–'}
                    </td>
                    <td className="px-4 py-3 text-xs text-s112-muted">
                      {p.ziel_weinausbau?.behaelter?.name ?? '–'}
                    </td>
                    {writeOk && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <StopPropagation className="flex items-center justify-end gap-2">
                          <Link
                            href={`/weinhandel/zukauf/${p.id}/edit`}
                            title="Bearbeiten" aria-label="Bearbeiten"
                            className="text-s112-teal hover:text-s112-teal/70">
                            <Pencil className="w-4 h-4" />
                          </Link>
                          <ZukaufLoeschen id={p.id} info={rebInfo} />
                        </StopPropagation>
                      </td>
                    )}
                  </ClickableTableRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
