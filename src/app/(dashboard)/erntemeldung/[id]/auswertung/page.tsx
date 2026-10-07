import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import DruckFormatKnopf from '@/components/DruckFormatKnopf'
import { fmtNum } from '@/lib/format'
import { HEKTARHOECHSTERTRAG_KG_HA, ladeLesedaten, unterliegtHoechstertrag, type LeseZeile } from '@/lib/behoerden/erntemeldung'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import {
  ertragJeRied, kgJeHa, lesefortschritt, mostgewichtJeSorte, vorjahresvergleich, type LeseDaten, type RiedFlaeche,
} from '@/lib/wein/leseAuswertung'
import LeseAuswertungCsv from './LeseAuswertungCsv'

export const metadata: Metadata = { title: 'Lese-Auswertung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// ── Lese-Auswertung je Jahrgang (KAN-147, 07.10.2026) ──
// Betriebliche Auswertung der Lesedaten (keine Behördenmeldung): Ertrag je Ried, Mostgewicht je Sorte und Ried,
// Lesefortschritt, Vorjahresvergleich. Dieselbe Ladefunktion wie Lese-Seite und Erntemeldung (ohne stornierte Einträge),
// Rechnung in lib/wein/leseAuswertung.ts. Zugriff wie die Lese-Seite (Mitglied des Betriebs).

const VORJAHRE = 3

const ld = (z: LeseZeile): LeseDaten => ({
  weingartenId: z.weingartenId, ried: z.ried, rebsorte: z.rebsorte, datum: z.datum, mengeKg: z.mengeKg, mengeHl: z.mengeHl,
  kmw: z.kmw, qualitaetsstufe: z.qualitaetsstufe,
})
const datum = (d: string) => d.split('-').reverse().join('.')

export default async function LeseAuswertungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!tenantId) notFound()
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (q: any) => q.eq('tenant_id', tenantId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jg } = await tf((supabase.from('weinjahrgaenge') as any).select('id, jahrgang').eq('id', id)).maybeSingle()
  if (!jg) notFound()
  const jahr = Number((jg as AR).jahrgang)

  const [lese, wgRes, gstRes, vjRes] = await Promise.all([
    ladeLesedaten(supabase, id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<AR>(tf((supabase.from('weingarten') as any).select('id, name, flaeche_ha').eq('aktiv', true).order('id'))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<AR>(tf((supabase.from('grundstuecke') as any).select('id, weingarten_id, flaeche_ha, nutzart, aktiv').order('id'))),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tf((supabase.from('weinjahrgaenge') as any).select('id, jahrgang').lt('jahrgang', jahr).order('jahrgang', { ascending: false }).limit(VORJAHRE)),
  ])
  if (wgRes.error) throw new Error(`Rieden konnten nicht geladen werden (${wgRes.error.message})`)
  if (gstRes.error) throw new Error(`Grundstücke konnten nicht geladen werden (${gstRes.error.message})`)
  const vorjahre = await Promise.all(((vjRes.data ?? []) as AR[]).map(async v => ({
    jahrgang: Number(v.jahrgang), zeilen: (await ladeLesedaten(supabase, v.id)).zeilen.map(ld),
  })))

  // Weingartenfläche je Ried: Grundstücke der Nutzart WI (wie der Hektarhöchstertrag); ohne Grundstücke die Fläche
  // des Rieds (erntebar ohne GST, KAN-160/161)
  const gstJeRied = new Map<string, AR[]>()
  for (const g of gstRes.data) if (g.weingarten_id) gstJeRied.set(g.weingarten_id, [...(gstJeRied.get(g.weingarten_id) ?? []), g])
  const rieden: RiedFlaeche[] = wgRes.data.flatMap(w => {
    const gst = gstJeRied.get(w.id) ?? []
    const wi = gst.filter(g => g.nutzart === 'WI' && g.aktiv !== false)
    if (gst.length > 0 && wi.length === 0) return []   // nicht erntebar
    const ha = wi.length > 0 ? wi.reduce((s, g) => s + (Number(g.flaeche_ha) || 0), 0) : Number(w.flaeche_ha) || 0
    return [{ id: w.id, name: w.name, flaecheHa: ha }]
  })
  const flaecheBetrieb = rieden.reduce((s, r) => s + r.flaecheHa, 0)

  const zeilen = lese.zeilen.map(ld)
  const ertrag = ertragJeRied(zeilen, rieden, HEKTARHOECHSTERTRAG_KG_HA, unterliegtHoechstertrag)
  const most = mostgewichtJeSorte(zeilen)
  const fort = lesefortschritt(zeilen, rieden)
  const vergleich = vorjahresvergleich([{ jahrgang: jahr, zeilen }, ...vorjahre])
  const jahre = [jahr, ...vorjahre.map(v => v.jahrgang)]
  const kgHaJe = [{ jahrgang: jahr, kgHa: kgJeHa(zeilen, flaecheBetrieb) }, ...vorjahre.map(v => ({ jahrgang: v.jahrgang, kgHa: kgJeHa(v.zeilen, flaecheBetrieb) }))]
  const summeKg = zeilen.reduce((s, z) => s + (z.mengeKg ?? 0), 0)

  const th = 'px-3 py-2 text-left text-xs font-medium text-s112-text-2'
  const td = 'px-3 py-1.5 text-sm'
  const tdz = `${td} text-right tabular-nums`
  return (
    <div className="max-w-5xl space-y-8">
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/erntemeldung" className="hover:text-s112-blue-700">Lese</Link><span>/</span>
        <Link href={`/erntemeldung/${id}`} className="hover:text-s112-blue-700">Jahrgang {jahr}</Link><span>/</span>
        <span className="text-s112-text-1 font-medium">Auswertung</span>
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Lese-Auswertung {jahr}</h1>
          <p className="text-sm text-s112-muted">{fmtNum(summeKg, 0)} kg gesamt · Weingartenfläche {fmtNum(flaecheBetrieb, 2)} ha · ohne stornierte Einträge</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <LeseAuswertungCsv jahrgang={jahr} ertrag={ertrag} mostgewicht={most} />
          <DruckFormatKnopf standard="quer" klein />
        </div>
      </div>

      {zeilen.length === 0 && <p className="text-sm text-s112-muted">Für diesen Jahrgang sind noch keine Lesedaten erfasst.</p>}

      {/* 1. Ertrag je Ried */}
      <section className="space-y-2">
        <h2 className="font-semibold text-s112-text">Ertrag je Ried</h2>
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-s112-border">
              <th className={th}>Ried</th><th className={`${th} text-right`}>kg</th><th className={`${th} text-right`}>hl</th>
              <th className={`${th} text-right`}>Fläche (ha)</th><th className={`${th} text-right`}>kg/ha</th>
              <th className={`${th} text-right`}>Abstand Höchstertrag (kg/ha)</th>
            </tr></thead>
            <tbody>
              {ertrag.map(e => (
                <tr key={e.weingartenId ?? e.ried} className="border-b border-s112-border/60">
                  <td className={td}>{e.ried}</td><td className={tdz}>{fmtNum(e.kg, 0)}</td><td className={tdz}>{fmtNum(e.hl, 2)}</td>
                  <td className={tdz}>{e.flaecheHa === null ? '–' : fmtNum(e.flaecheHa, 4)}</td>
                  <td className={tdz}>{e.kgHa === null ? '–' : fmtNum(e.kgHa, 0)}</td>
                  <td className={`${tdz} ${e.abstandKgHa !== null && e.abstandKgHa < 0 ? 'text-s112-err-fg font-semibold' : ''}`}>
                    {e.abstandKgHa === null ? '–' : `${e.abstandKgHa < 0 ? 'überschritten ' : ''}${fmtNum(e.abstandKgHa, 0)}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-s112-muted">Hektarhöchstertrag {fmtNum(HEKTARHOECHSTERTRAG_KG_HA, 0)} kg/ha (Stufen ab Landwein) – je Ried nur zur Orientierung; maßgeblich ist der Betrieb (Lese-Seite).</p>
      </section>

      {/* 2. Mostgewicht je Sorte und Ried */}
      <section className="space-y-2">
        <h2 className="font-semibold text-s112-text">Mostgewicht je Sorte und Ried</h2>
        <div className="card p-0 overflow-x-auto">
          <table className="w-full">
            <thead><tr className="border-b border-s112-border">
              <th className={th}>Rebsorte</th><th className={th}>Ried</th><th className={`${th} text-right`}>kg</th>
              <th className={`${th} text-right`}>Ø °KMW</th><th className={`${th} text-right`}>≈ °Oe</th>
              <th className={`${th} text-right`}>Min–Max °KMW</th><th className={th}>Qualitätsstufen (kg)</th>
            </tr></thead>
            <tbody>
              {most.map(m => (
                <tr key={`${m.rebsorte}|${m.ried}`} className="border-b border-s112-border/60">
                  <td className={td}>{m.rebsorte}</td><td className={td}>{m.ried ?? '–'}</td><td className={tdz}>{fmtNum(m.kg, 0)}</td>
                  <td className={tdz}>{m.kmw === null ? '–' : fmtNum(m.kmw, 2)}</td>
                  <td className={tdz}>{m.oechsle === null ? '–' : fmtNum(m.oechsle, 1)}</td>
                  <td className={tdz}>{m.kmwMin === null ? '–' : `${fmtNum(m.kmwMin, 1)}–${fmtNum(m.kmwMax ?? m.kmwMin, 1)}`}</td>
                  <td className={`${td} text-xs`}>{Object.entries(m.stufen).map(([s, kg]) => `${s === 'ohne' ? 'ohne Stufe' : qualitaetLabel(s)} ${fmtNum(kg, 0)}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-s112-muted">Mittel massegewichtet über °KMW (kg × °KMW ÷ kg), °Oe daraus umgerechnet – nie °Oe gemittelt.</p>
      </section>

      {/* 3. Lesefortschritt */}
      <section className="space-y-2">
        <h2 className="font-semibold text-s112-text">Lesefortschritt</h2>
        <p className="text-sm">
          {fort.riedenGelesen} von {fort.riedenGesamt} Rieden gelesen · {fmtNum(fort.flaecheGelesenHa, 2)} von {fmtNum(fort.flaecheGesamtHa, 2)} ha
          {fort.flaecheGesamtHa > 0 && ` (${fmtNum(fort.flaecheGelesenHa / fort.flaecheGesamtHa * 100, 0)} %)`}
        </p>
        {fort.offen.length > 0 && <p className="text-xs text-s112-muted">Noch offen: {fort.offen.join(', ')}</p>}
        {fort.tage.length > 0 && (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-s112-border">
                <th className={th}>Lesetag</th><th className={`${th} text-right`}>kg</th><th className={`${th} text-right`}>kumuliert (kg)</th><th className={th}>Anteil</th>
              </tr></thead>
              <tbody>
                {fort.tage.map(t => (
                  <tr key={t.datum} className="border-b border-s112-border/60">
                    <td className={td}>{datum(t.datum)}</td><td className={tdz}>{fmtNum(t.kg, 0)}</td><td className={tdz}>{fmtNum(t.kumuliert, 0)}</td>
                    <td className={td}>
                      <div className="h-2 bg-s112-bg rounded-full w-40" aria-hidden="true">
                        <div className="h-2 bg-s112-teal rounded-full" style={{ width: `${summeKg > 0 ? Math.min(100, t.kumuliert / summeKg * 100) : 0}%` }} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Vorjahresvergleich */}
      <section className="space-y-2">
        <h2 className="font-semibold text-s112-text">Vorjahresvergleich</h2>
        {vorjahre.length === 0 ? <p className="text-sm text-s112-muted">Keine früheren Jahrgänge erfasst.</p> : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full">
              <thead><tr className="border-b border-s112-border">
                <th className={th}>Rebsorte</th>
                {jahre.map(j => <th key={j} className={`${th} text-right`}>{j}: kg · Ø °KMW</th>)}
              </tr></thead>
              <tbody>
                {vergleich.map(v => (
                  <tr key={v.rebsorte} className="border-b border-s112-border/60">
                    <td className={td}>{v.rebsorte}</td>
                    {jahre.map(j => {
                      const w = v.jahre[j]
                      return <td key={j} className={tdz}>{w ? `${fmtNum(w.kg, 0)} · ${w.kmw === null ? '–' : fmtNum(w.kmw, 2)}` : '–'}</td>
                    })}
                  </tr>
                ))}
                <tr className="font-medium">
                  <td className={td}>kg/ha Betrieb</td>
                  {kgHaJe.map(k => <td key={k.jahrgang} className={tdz}>{k.kgHa === null ? '–' : fmtNum(k.kgHa, 0)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-s112-muted">kg/ha der Vorjahre bezogen auf die heutige Weingartenfläche.</p>
      </section>
    </div>
  )
}
