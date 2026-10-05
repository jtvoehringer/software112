import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import Link from '@/components/ui/Link'
import { Pencil, AlertTriangle } from 'lucide-react'
import ZukaufLoeschen from './ZukaufLoeschen'
import ClickableTableRow from '@/components/ui/ClickableTableRow'
import StopPropagation from '@/components/ui/StopPropagation'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtEur, fmtNum } from '@/lib/format'
import { gstImJahr } from '@/lib/wein/grundstueckAktiv'

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
  const writeOk  = canWrite(role, 'warenwirtschaft')
  const membership = await getCurrentMembership()

  const sp    = await searchParams
  const zjahr = parseInt(sp.zjahr ?? '') || new Date().getFullYear()
  const tenantId = membership?.tenantId ?? null

  const { data } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, art, menge, einheit, preis_gesamt, rebsorte, jahrgang, notizen,
      eingangsrechnungsnummer,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(id, vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(id, name),
      ziel_weinausbau:weinausbau!ziel_weinausbau_id(id, name, behaelter:behaelter!behaelter_id(id, name))
    `)
    .eq('aktiv', true)
    .eq('tenant_id', tenantId ?? '')
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
        // alle(): Betriebsfläche über alle Grundstücke, nicht nur die ersten 1.000
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        alle((supabase.from('grundstuecke') as any).select('flaeche_ha, aktiv, deaktiviert_am').eq('nutzart', 'WI').eq('tenant_id', membership.tenantId).order('id')),
        (supabase.from('zukauf_posten') as any)
          .select('menge')
          .eq('art', 'trauben')
          .eq('aktiv', true)
          .eq('tenant_id', membership.tenantId)
          .gte('datum', `${zjahr}-01-01`)
          .lte('datum', `${zjahr}-12-31`),
      ])
      // KAN-150 F1: deaktivierte Grundstücke nur, wenn sie am 1.1. des Jahres noch bewirtschaftet wurden
      const gesamtFlaecheHaBetrieb = ((rawGSTFl ?? []) as R[]).filter(g => gstImJahr(g, zjahr)).reduce((s, g) => s + (Number(g.flaeche_ha) || 0), 0)
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
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-s112-text">Zukäufe</h1>
        {writeOk && (
          <Link href="/weinhandel/zukauf/neu"
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            + Neuer Zukauf
          </Link>
        )}
      </div>

      {traubenzukaufsgrenze && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          traubenzukaufsgrenze.ueberschritten
            ? 'bg-s112-err-bg border-s112-err/30 text-s112-err-fg'
            : 'bg-s112-bg border-s112-border text-s112-text-2'
        }`}>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="inline-flex items-start gap-1.5">
              {traubenzukaufsgrenze.ueberschritten && <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />}
              <span>
                Traubenzukauf {traubenzukaufsgrenze.jahr}: <strong>{fmtNum(traubenzukaufsgrenze.summeKg)} kg</strong>
                {' '}von max. <strong>{fmtNum(traubenzukaufsgrenze.maxKg, { max: 0 })} kg</strong>
                {' '}({fmtNum(TRAUBENZUKAUFSGRENZE_KG_HA)} kg/ha × {fmtNum(traubenzukaufsgrenze.gesamtFlaecheHaBetrieb, 2)} ha Rebfläche)
              </span>
            </span>
            <div className="flex items-center gap-3">
              {traubenzukaufsgrenze.ueberschritten && (
                <span className="font-semibold">Überschreitung: {fmtNum(traubenzukaufsgrenze.ueberschreitungKg)} kg</span>
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
              className="mt-4 inline-block text-s112-blue-700 hover:underline text-sm font-medium">
              Ersten Zukauf anlegen →
            </Link>
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg text-left">
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2">Belegnr.</th>
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2">Art</th>
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2">Lieferant</th>
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2">Rebsorte / Jg.</th>
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2 text-right">Menge</th>
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2 text-right">Gesamtpreis</th>
                <th className="px-4 py-3 text-xs font-semibold text-s112-text-2">Gebinde</th>
                {/* Bearbeiten/Löschen nur für Schreibrollen (Modul Warenwirtschaft); deleteZukauf prüft das serverseitig ebenso */}
                {writeOk && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border">
              {posten.map((p: R) => {
                const lieferant = p.lieferant_kontakt
                  ? [p.lieferant_kontakt.vorname, p.lieferant_kontakt.nachname].filter(Boolean).join(' ')
                  : p.lieferant_firma?.name ?? '–'
                const rebInfo = [p.rebsorte ? formatRebsorteMitKuerzel(p.rebsorte) : null, p.jahrgang].filter(Boolean).join(' ') || '–'
                return (
                  <ClickableTableRow key={p.id} href={`/weinhandel/zukauf/${p.id}/edit`} className="hover:bg-s112-bg/50 transition-colors">
                    <td className="px-4 py-3 text-s112-text-1 whitespace-nowrap">
                      {new Date(p.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-s112-text-1">{p.eingangsrechnungsnummer || <span className="text-s112-muted">–</span>}</span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">{ART_LABEL[p.art] ?? p.art}</td>
                    <td className="px-4 py-3 text-s112-text-1">{lieferant}</td>
                    <td className="px-4 py-3 text-s112-text-2 text-xs">{rebInfo}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium text-s112-text">
                      {fmtNum(Number(p.menge))} {p.einheit}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-s112-text-1">
                      {p.preis_gesamt != null
                        ? fmtEur(Number(p.preis_gesamt))
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
                            className="text-s112-blue-700 hover:text-s112-blue-700/70">
                            <Pencil className="w-4 h-4" />
                          </Link>
                          <ZukaufLoeschen id={p.id} info={rebInfo} hatCharge={!!p.ziel_weinausbau} />
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
