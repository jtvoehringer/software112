// behoerdenmeldung: bki-rv-eingang, bki-rv-ausgang
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { meldungFinden } from '@/lib/behoerden/register'
import { istParameterFehler, MeldungsFehler } from '@/lib/behoerden/typen'
import { ladeRvAusgang, ladeRvEingang, type RvAusgangZeile, type RvEingangZeile } from '@/lib/behoerden/bki-rv'
import { alle } from '@/lib/supabase/alle'
import { fmtNum } from '@/lib/format'
import LagerTabs from '../_behoerden/LagerTabs'
import { AktionsFehler } from '@/lib/fehler'

// KAN-46 Etappe 1: BKI-Blätter „RV zum Eingang“ (Charge oder Grundstück) und „RV zum Ausgang“ (Charge oder Füllung)
// mit Zeitraum. Dieselben Ladefunktionen liefern die CSV (/meldungen/bki-rv-eingang/csv bzw. bki-rv-ausgang).

export const metadata: Metadata = { title: 'Rückverfolgung (BKI)' }
export const dynamic = 'force-dynamic'

type Sp = Record<string, string | undefined>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const id = (v: string | undefined) => (v && UUID.test(v) ? v : null)
const tag = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
const datumAT = (d: string | null) => (d ? d.split('-').reverse().join('.') : '')

export default async function BkiRvPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const [ch, gs, fu] = await Promise.all([
    alle<{ id: string; name: string | null; chargennummer: string | null; jahrgang: number | null }>((supabase.from('weinausbau') as any)   // eslint-disable-line @typescript-eslint/no-explicit-any
      .select('id, name, chargennummer, jahrgang').eq('tenant_id', tenantId).is('storniert_am', null).order('name').order('id')),
    alle<{ id: string; gst_nr: string | null; kg_bezeichnung: string | null; katastralgemeinde: string | null }>((supabase.from('grundstuecke') as any)   // eslint-disable-line @typescript-eslint/no-explicit-any
      .select('id, gst_nr, kg_bezeichnung, katastralgemeinde').eq('tenant_id', tenantId).order('gst_nr').order('id')),
    alle<{ id: string; name: string | null; chargennummer: string | null }>((supabase.from('fuellungen') as any)   // eslint-disable-line @typescript-eslint/no-explicit-any
      .select('id, name, chargennummer').eq('tenant_id', tenantId).order('name').order('id')),
  ])
  for (const [n, r] of [['Chargen', ch], ['Grundstücke', gs], ['Füllungen', fu]] as const) if (r.error) throw new AktionsFehler(`${n} konnten nicht geladen werden: ${r.error.message}`)

  const von = tag(sp.von), bis = tag(sp.bis)
  const ein = { charge: id(sp.e_charge), gst: id(sp.e_gst) }
  const aus = { charge: id(sp.a_charge), fuellung: id(sp.a_fuellung) }
  const zeit = { von, bis }

  let eingang: { zeilen: RvEingangZeile[]; warnungen: string[] } | null = null
  let ausgang: { zeilen: RvAusgangZeile[]; warnungen: string[] } | null = null
  const fehler: string[] = []
  const pruefe = (meldung: 'bki-rv-eingang' | 'bki-rv-ausgang', p: Record<string, string | null>) => {
    const r = meldungFinden(meldung)?.parameter(new URLSearchParams(Object.entries(p).filter((e): e is [string, string] => !!e[1])))
    return r && istParameterFehler(r) ? r.fehler : null
  }
  try {
    if (ein.charge || ein.gst) {
      const f = pruefe('bki-rv-eingang', { ...ein, ...zeit })
      if (f) fehler.push(f)
      else eingang = await ladeRvEingang(supabase, tenantId, { ...ein, ...zeit })
    }
    if (aus.charge || aus.fuellung) {
      const f = pruefe('bki-rv-ausgang', { ...aus, ...zeit })
      if (f) fehler.push(f)
      else ausgang = await ladeRvAusgang(supabase, tenantId, { ...aus, ...zeit })
    }
  } catch (e) {
    if (e instanceof MeldungsFehler) fehler.push(e.message)
    else throw e
  }

  const chargeName = (c: { name: string | null; chargennummer: string | null; jahrgang: number | null }) => [c.chargennummer, c.name, c.jahrgang].filter(Boolean).join(' · ')
  const sel = 'form-input text-sm block mt-1 max-w-xs'
  const lbl = 'text-xs text-s112-text-2'

  return (
    <div className="space-y-6">
      <LagerTabs aktiv="rv" />
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Rückverfolgung – RV zum Eingang und zum Ausgang</h1>
        <p className="text-xs text-s112-muted mt-0.5">
          Blätter der BKI-Schnittstelle. Eingang: Herkunft einer Charge bis zur Lese bzw. zum Zukauf – oder ab einem Grundstück die Chargen, in die es
          gelesen wurde. Ausgang: Weg einer Charge bzw. Füllung bis zum Abnehmer. Zeitraum optional.
        </p>
      </div>

      <form method="get" className="card grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end print:hidden">
        <label className={lbl}>Eingang: Charge
          <select name="e_charge" defaultValue={ein.charge ?? ''} className={sel}>
            <option value="">–</option>
            {ch.data.map(c => <option key={c.id} value={c.id}>{chargeName(c)}</option>)}
          </select>
        </label>
        <label className={lbl}>oder Grundstück
          <select name="e_gst" defaultValue={ein.gst ?? ''} className={sel}>
            <option value="">–</option>
            {gs.data.map(g => <option key={g.id} value={g.id}>{[g.gst_nr, g.kg_bezeichnung ?? g.katastralgemeinde].filter(Boolean).join(' · ')}</option>)}
          </select>
        </label>
        <label className={lbl}>Ausgang: Charge
          <select name="a_charge" defaultValue={aus.charge ?? ''} className={sel}>
            <option value="">–</option>
            {ch.data.map(c => <option key={c.id} value={c.id}>{chargeName(c)}</option>)}
          </select>
        </label>
        <label className={lbl}>oder Füllung
          <select name="a_fuellung" defaultValue={aus.fuellung ?? ''} className={sel}>
            <option value="">–</option>
            {fu.data.map(f => <option key={f.id} value={f.id}>{[f.chargennummer, f.name].filter(Boolean).join(' · ')}</option>)}
          </select>
        </label>
        <label className={lbl}>Von
          <input type="date" name="von" defaultValue={von ?? ''} className={sel} />
        </label>
        <label className={lbl}>Bis
          <input type="date" name="bis" defaultValue={bis ?? ''} className={sel} />
        </label>
        <button type="submit" className="btn-primary text-sm">Anzeigen</button>
      </form>
      {fehler.map(f => <p key={f} role="alert" className="text-sm text-s112-err-fg">{f}</p>)}

      {eingang && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-s112-text">RV zum Eingang</h2>
            <CsvExportKnopf href={csvPfad('bki-rv-eingang', { ...ein, ...zeit })} ariaLabel="CSV exportieren: RV zum Eingang" />
          </div>
          {eingang.warnungen.length > 0 && <ul className="text-xs text-s112-warn-fg list-disc pl-4">{eingang.warnungen.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg text-left text-xs font-semibold text-s112-text-2">
                  <th className="px-3 py-2">Charge</th><th className="px-3 py-2">Lese</th><th className="px-3 py-2">Quelle</th><th className="px-3 py-2">Sorte</th><th className="px-3 py-2">JG</th>
                  <th className="px-3 py-2">Ried</th><th className="px-3 py-2">GST · KG</th><th className="px-3 py-2">Feldstück / Schlag</th>
                  <th className="px-3 py-2 text-right">Liter</th><th className="px-3 py-2 text-right">Anteil %</th><th className="px-3 py-2 text-right">KMW</th>
                </tr>
              </thead>
              <tbody>
                {eingang.zeilen.length === 0 ? <tr><td colSpan={11} className="px-3 py-3 text-s112-muted">Keine Herkunft gefunden.</td></tr> : eingang.zeilen.map((z, i) => (
                  <tr key={i} className="border-t border-s112-border">
                    <td className="px-3 py-1.5">{z.chargenNr}</td><td className="px-3 py-1.5">{datumAT(z.datum)}</td><td className="px-3 py-1.5">{z.quelle}</td>
                    <td className="px-3 py-1.5">{z.herkunftSorte}</td><td className="px-3 py-1.5">{z.herkunftJahrgang ?? ''}</td><td className="px-3 py-1.5">{z.ried ?? ''}</td>
                    <td className="px-3 py-1.5">{[z.gstNr, z.katastralgemeinde].filter(Boolean).join(' · ')}</td>
                    <td className="px-3 py-1.5">{[z.feldstueck, z.schlag].filter(Boolean).join(' / ')}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(z.liter, { max: 3 })}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(z.anteilPct, { max: 2 })}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{z.kmw == null ? '' : fmtNum(z.kmw, { max: 1 })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ausgang && (
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="text-base font-semibold text-s112-text">RV zum Ausgang</h2>
            <CsvExportKnopf href={csvPfad('bki-rv-ausgang', { ...aus, ...zeit })} ariaLabel="CSV exportieren: RV zum Ausgang" />
          </div>
          {ausgang.warnungen.length > 0 && <ul className="text-xs text-s112-warn-fg list-disc pl-4">{ausgang.warnungen.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className="card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-s112-bg text-left text-xs font-semibold text-s112-text-2">
                  <th className="px-3 py-2">Datum</th><th className="px-3 py-2">Beleg</th><th className="px-3 py-2">Los</th><th className="px-3 py-2">Produkt</th>
                  <th className="px-3 py-2">Buchungsart</th><th className="px-3 py-2">BSM</th><th className="px-3 py-2">Abnehmer</th><th className="px-3 py-2 text-right">Menge</th>
                </tr>
              </thead>
              <tbody>
                {ausgang.zeilen.length === 0 ? <tr><td colSpan={8} className="px-3 py-3 text-s112-muted">Keine Abgänge im Zeitraum.</td></tr> : ausgang.zeilen.map((z, i) => (
                  <tr key={i} className="border-t border-s112-border">
                    <td className="px-3 py-1.5">{datumAT(z.datum)}</td><td className="px-3 py-1.5">{z.beleg ?? ''}</td><td className="px-3 py-1.5">{z.los ?? ''}</td>
                    <td className="px-3 py-1.5">{z.produkt}</td><td className="px-3 py-1.5">{z.art}</td><td className="px-3 py-1.5 font-mono text-xs">{z.buchungsartBsm ?? ''}</td>
                    <td className="px-3 py-1.5">{z.abnehmer}</td><td className="px-3 py-1.5 text-right tabular-nums">{fmtNum(z.menge, { max: 3 })} {z.einheit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
