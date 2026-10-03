/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import Link from '@/components/ui/Link'
import { fmtNum } from '@/lib/format'
import { datumAT } from '@/lib/behoerden/ernte_hilfen'
import { KAT_BUCHUNGSART } from '@/lib/katalog/bki'
import { ladeJournalBeginn } from '@/lib/kellerbuch/journal'
import {
  vergleicheHerkunft, verdichteHerkunft, zugaengeLautRechnung, HERKUNFT_TOLERANZ_LITER, type HerkunftKante, type HerkunftZeile,
} from '@/lib/kellerbuch/herkunft'
import { ladeBewegungsgraph } from '@/lib/wein/blendKomposition'
import { alle } from '@/lib/supabase/alle'

// KAN-192 Etappe B: Herkunft laut Bewegungsjournal (Sicht charge_herkunft) und Abgleich mit der Mischungsrechnung.
// Nur bei eröffnetem Journal; ohne Journal rendert die Karte nichts.

/** Zeilen der Sicht charge_herkunft, an denen die Charge beteiligt ist (als Ziel oder Quelle) */
async function ladeHerkunftZeilen(supabase: any, tenantId: string, chargeId: string): Promise<HerkunftZeile[]> {
  const { data, error } = await alle<HerkunftZeile>(
    (supabase.from('charge_herkunft') as any)
      .select('beleg_nr, datum, art, nach_weinausbau_id, nach_fuellung_id, von_weinausbau_id, liter, gegenbuchung, buchung_id')
      .eq('tenant_id', tenantId)
      .or(`nach_weinausbau_id.eq.${chargeId},von_weinausbau_id.eq.${chargeId}`)
      .order('beleg_nr')
      .order('buchung_id'),
  )
  if (error) throw new Error(`Herkunft laut Journal konnte nicht geladen werden (${error.message})`)
  return data
}

const ART_LABEL = new Map(KAT_BUCHUNGSART.map(b => [b.code, b.bezeichnung]))
const arten = (k: HerkunftKante) => k.arten.map(a => ART_LABEL.get(a) ?? a).join(', ')
const zeitraum = (k: HerkunftKante) => (k.erstes === k.letztes ? datumAT(k.erstes) : `${datumAT(k.erstes)} – ${datumAT(k.letztes)}`)

function Tabelle({ titel, kanten, name }: { titel: string; kanten: HerkunftKante[]; name: (k: HerkunftKante) => React.ReactNode }) {
  if (kanten.length === 0) return null
  return (
    <div>
      <h3 className="text-xs font-semibold text-s112-text-2 mb-1">{titel}</h3>
      <table className="w-full text-sm">
        <tbody>
          {kanten.map(k => (
            <tr key={`${k.chargeId ?? ''}-${k.fuellungId ?? ''}-${k.arten.join()}`} className="border-b border-s112-border/60">
              <td className="py-1.5 pr-3">{name(k)}</td>
              <td className="py-1.5 pr-3 text-xs text-s112-muted">{arten(k)}</td>
              <td className="py-1.5 pr-3 text-xs text-s112-muted whitespace-nowrap">{zeitraum(k)} · {k.belege} {k.belege === 1 ? 'Beleg' : 'Belege'}</td>
              <td className="py-1.5 text-right whitespace-nowrap">{fmtNum(k.liter, 2)} l</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default async function HerkunftJournalKarte({ supabase, tenantId, chargeId }: { supabase: any; tenantId: string; chargeId: string }) {
  const beginn = await ladeJournalBeginn(supabase, tenantId)
  if (!beginn) return null
  const [zeilen, graph] = await Promise.all([
    ladeHerkunftZeilen(supabase, tenantId, chargeId),
    ladeBewegungsgraph(supabase, tenantId, [chargeId]),
  ])
  const v = verdichteHerkunft(zeilen, chargeId)
  const abweichungen = vergleicheHerkunft(v.vorgaenger, zugaengeLautRechnung(graph.ereignisse, chargeId, beginn))

  // Namen der Gegenstellen (eigener Betrieb)
  const chargeIds = [...new Set([...v.vorgaenger, ...v.nachfolger].map(k => k.chargeId).concat(abweichungen.map(a => a.chargeId)).filter((x): x is string => !!x))]
  const fuellungIds = [...new Set(v.nachfolger.map(k => k.fuellungId).filter((x): x is string => !!x))]
  const [cRes, fRes] = await Promise.all([
    chargeIds.length ? (supabase.from('weinausbau') as any).select('id, name, chargennummer').eq('tenant_id', tenantId).in('id', chargeIds) : { data: [] },
    fuellungIds.length ? (supabase.from('fuellungen') as any).select('id, name').eq('tenant_id', tenantId).in('id', fuellungIds) : { data: [] },
  ])
  const chargen = new Map<string, any>(((cRes.data ?? []) as any[]).map(c => [c.id, c]))
  const fuellungen = new Map<string, any>(((fRes.data ?? []) as any[]).map(f => [f.id, f]))
  const chargeName = (id: string | null) => {
    const c = id ? chargen.get(id) : null
    return c ? <Link href={`/kellerbuch/weinausbau/${c.id}`} className="hover:text-s112-blue-700">{c.name}{c.chargennummer ? ` (${c.chargennummer})` : ''}</Link> : <span className="text-s112-muted">Charge (gelöscht)</span>
  }
  const nachName = (k: HerkunftKante) => {
    if (k.fuellungId) {
      const f = fuellungen.get(k.fuellungId)
      return f ? <Link href={`/weinhandel/fuellungen/${f.id}/edit`} className="hover:text-s112-blue-700">Füllung {f.name}</Link> : <span className="text-s112-muted">Füllung (gelöscht)</span>
    }
    return chargeName(k.chargeId)
  }
  const leer = v.vorgaenger.length + v.nachfolger.length + v.wurzeln.length === 0

  return (
    <section>
      <h2 className="font-semibold text-s112-text mb-3">Herkunft laut Bewegungsjournal</h2>
      <div className="card p-5 space-y-4">
        <p className="text-xs text-s112-muted">
          Aus dem Bewegungsjournal (ab {datumAT(beginn)}): woher der Wein dieser Charge kommt und wohin er gegangen ist –
          netto je Gegenstelle, Stornos sind herausgerechnet.
        </p>
        {leer && <p className="text-sm text-s112-muted">Noch keine Bewegungen im Journal.</p>}
        <Tabelle titel="Ursprung (ohne Quell-Charge)" kanten={v.wurzeln} name={k => arten(k)} />
        <Tabelle titel="Zugänge aus Chargen" kanten={v.vorgaenger} name={k => chargeName(k.chargeId)} />
        <Tabelle titel="Abgänge an Chargen und Füllungen" kanten={v.nachfolger} name={nachName} />
        {abweichungen.length === 0 ? (
          <p className="text-xs text-s112-muted">Abgleich mit der Mischungsrechnung: Zugänge je Quell-Charge stimmen überein (Toleranz {fmtNum(HERKUNFT_TOLERANZ_LITER, 1)} l).</p>
        ) : (
          <div className="rounded-lg bg-s112-warn-bg text-s112-warn-fg px-4 py-3 text-sm space-y-1">
            <p className="font-medium">Abgleich mit der Mischungsrechnung: {abweichungen.length} {abweichungen.length === 1 ? 'Abweichung' : 'Abweichungen'}</p>
            <ul className="text-xs space-y-0.5">
              {abweichungen.map(a => (
                <li key={a.chargeId}>
                  {chargeName(a.chargeId)}: Journal {fmtNum(a.journal, 2)} l · Mischungsrechnung {fmtNum(a.rechnung, 2)} l (Differenz {a.differenz > 0 ? '+' : ''}{fmtNum(a.differenz, 2)} l)
                </li>
              ))}
            </ul>
            <p className="text-xs">Mögliche Ursachen: Bewegung vor dem Journalbeginn bzw. rückdatiert, Storno über die Journalgrenze, Umzug ohne Gegenbuchung.</p>
          </div>
        )}
      </div>
    </section>
  )
}
