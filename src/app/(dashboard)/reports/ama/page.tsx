import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import Image from 'next/image'
import PrintButton from '../PrintButton'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'

export const metadata: Metadata = { title: 'AMA Erntemeldung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function AMAPage({ searchParams }: { searchParams: Promise<{ jahrgang?: string }> }) {
  const { jahrgang: jahrgangParam } = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [{ data: jahrgaengeRaw }, { data: settingsRaw }] = await Promise.all([
    tf((supabase.from('weinjahrgaenge') as any).select('id, jahrgang').order('jahrgang', { ascending: false })),
    tf((supabase.from('tenant_einstellungen') as any).select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url').limit(1).maybeSingle()),
  ])

  const jahrgaenge = (jahrgaengeRaw ?? []) as R[]
  const s = (settingsRaw as R | null) ?? {}
  const aktJahrgang = jahrgaenge.find(j => String(j.jahrgang) === jahrgangParam) ?? jahrgaenge[0]

  // ── Erntemeldungs-Positionen: primär aus ama_meldepositionen ────────────────
  let positionen: R[] = []
  let gesamtKg = 0
  let gesamtHl = 0

  if (aktJahrgang) {
    // Zuerst: AMA-Meldung für diesen Jahrgang suchen
    const { data: amaMeldung } = await tf((supabase.from('ama_erntemeldungen') as any)
      .select('id, gesamtmenge_kg, gesamtmenge_hl, status')
      .eq('jahrgang_id', aktJahrgang.id)
      .maybeSingle())

    if (amaMeldung) {
      // Positionen aus ama_meldepositionen (aggregiert je Rebsorte)
      const { data: pos } = await tf((supabase.from('ama_meldepositionen') as any)
        .select('rebsorte_name, flaeche_ha, menge_kg, menge_hl, qualitaetsstufe, oechsle')
        .eq('meldung_id', (amaMeldung as R).id)
        .order('rebsorte_name'))
      positionen = (pos ?? []) as R[]
      gesamtKg = (amaMeldung as R).gesamtmenge_kg ?? positionen.reduce((s: number, p: R) => s + (p.menge_kg ?? 0), 0)
      gesamtHl = (amaMeldung as R).gesamtmenge_hl ?? positionen.reduce((s: number, p: R) => s + (p.menge_hl ?? 0), 0)
    } else {
      // Fallback: ernte_parzellen direkt (gruppiert nach Rebsorte)
      const { data: parz } = await tf((supabase.from('ernte_parzellen') as any)
        .select('menge_kg, menge_hl, klosterneuburger, qualitaetsstufe, weingarten:weingarten_id(name, rebsorte, flaeche_ha)')
        .eq('jahrgang_id', aktJahrgang.id)
        .order('id'))
      const rawParz = (parz ?? []) as R[]
      // Aggregieren nach Rebsorte
      const byRebsorte = new Map<string, R>()
      for (const p of rawParz) {
        const wg = (p.weingarten as R) ?? {}
        const key = wg.rebsorte ?? '–'
        const curr = byRebsorte.get(key) ?? { rebsorte_name: key, flaeche_ha: 0, menge_kg: 0, menge_hl: 0, qualitaetsstufe: p.qualitaetsstufe }
        curr.flaeche_ha += wg.flaeche_ha ?? 0
        curr.menge_kg   += p.menge_kg ?? 0
        curr.menge_hl   += p.menge_hl ?? 0
        byRebsorte.set(key, curr)
      }
      positionen = Array.from(byRebsorte.values())
      gesamtKg   = positionen.reduce((s, p) => s + (p.menge_kg ?? 0), 0)
      gesamtHl   = positionen.reduce((s, p) => s + (p.menge_hl ?? 0), 0)
    }
  }

  // ── Lagerbestand: Flaschen ──────────────────────────────────────────────────
  const { data: bestandRaw } = await tf((supabase.from('fuellungen') as any)
    .select('name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen')
    .eq('aktiv', true).gt('bestand_flaschen', 0).order('name'))
  const bestand = (bestandRaw ?? []) as R[]
  const gesamtFlaschen = bestand.reduce((s: number, f: R) => s + (f.bestand_flaschen ?? 0), 0)
  const gesamtFlaschenHl = bestand.reduce((s: number, f: R) => s + ((f.bestand_flaschen ?? 0) * (f.flaschengroesse_ml ?? 750)) / 100000, 0)

  // ── Lagerbestand: Wein in Gebinden (Tanks/Fässer) ──────────────────────────
  const { data: tanksRaw } = await tf((supabase.from('weinausbau') as any)
    .select('name, jahrgang, rebsorte, menge_liter, status, behaelter:behaelter_id(name)')
    .eq('aktiv', true)
    .neq('status', 'abgeschlossen')
    .gt('menge_liter', 0)
    .order('jahrgang', { ascending: false }))
  const tanks = (tanksRaw ?? []) as R[]
  const gesamtTankHl = tanks.reduce((s: number, t: R) => s + (parseFloat(t.menge_liter) || 0), 0) / 100

  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className="max-w-4xl space-y-4">
      {/* Breadcrumb + Aktionen */}
      <div className="flex items-center justify-between print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/reports" className="hover:text-s112-blue-700">Auswertungen</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">AMA Erntemeldung</span>
        </nav>
        <div className="flex gap-2">
          <form method="GET" action="/reports/ama">
            <select name="jahrgang"
              defaultValue={aktJahrgang?.jahrgang ?? ''}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
              {jahrgaenge.map(j => <option key={j.id} value={j.jahrgang}>{j.jahrgang}</option>)}
            </select>
            <button type="submit" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg ml-1">
              ↻
            </button>
          </form>
          <PrintButton />
        </div>
      </div>

      {/* Dokument */}
      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        {/* Kopf */}
        <div className="flex items-start justify-between border-b-2 border-s112-text pb-4 mb-6">
          <div>
            {s.logo_url && <Image src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
            <p className="font-semibold text-s112-text">{s.betrieb_name ?? 'software:112'}</p>
            <p className="text-sm text-s112-text-2">{[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
            {s.betrieb_uid && <p className="text-xs text-s112-tertiary">UID: {s.betrieb_uid}</p>}
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-s112-text">AMA Weinerntemeldung</p>
            <p className="text-2xl font-semibold text-s112-blue-700">Jahrgang {aktJahrgang?.jahrgang ?? '–'}</p>
            <p className="text-xs text-s112-tertiary mt-1">Erstellt: {heute}</p>
          </div>
        </div>

        {/* Erntemeldung-Tabelle (je Rebsorte) */}
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-[#F2F3F5] border border-s112-line-str">
              <th className="text-left px-3 py-2 border border-s112-line-str font-semibold">Rebsorte</th>
              <th className="text-right px-3 py-2 border border-s112-line-str font-semibold">Fläche (ha)</th>
              <th className="text-right px-3 py-2 border border-s112-line-str font-semibold">Menge (kg)</th>
              <th className="text-right px-3 py-2 border border-s112-line-str font-semibold">Menge (hl)</th>
              <th className="text-left px-3 py-2 border border-s112-line-str font-semibold">Qualitätsstufe</th>
            </tr>
          </thead>
          <tbody>
            {positionen.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-s112-tertiary text-sm italic border border-s112-line">
                  Keine Erntemeldung vorhanden – bitte auf der Lese-Seite &quot;AMA-Meldung erstellen&quot; klicken
                </td>
              </tr>
            ) : positionen.map((p, i) => (
              <tr key={i} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                <td className="px-3 py-2 border border-s112-line font-medium">{formatRebsorteMitKuerzel(p.rebsorte_name)}</td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums">
                  {p.flaeche_ha != null ? fmtNum(Number(p.flaeche_ha), 4) : '–'}
                </td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums font-medium">
                  {p.menge_kg != null ? fmtNum(Number(p.menge_kg)) : '–'}
                </td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums">
                  {p.menge_hl != null
                    ? Number(p.menge_hl).toFixed(2).replace('.', ',')
                    : p.menge_kg != null
                      ? (p.menge_kg / 130).toFixed(2).replace('.', ',')
                      : '–'}
                </td>
                <td className="px-3 py-2 border border-s112-line">{qualitaetLabel(p.qualitaetsstufe)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-3 py-2 border border-s112-line-str">GESAMT</td>
              <td className="px-3 py-2 border border-s112-line-str" />
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums">{fmtNum(gesamtKg)} kg</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums">{gesamtHl > 0 ? gesamtHl.toFixed(2).replace('.', ',') : (gesamtKg / 130).toFixed(2).replace('.', ',')} hl</td>
              <td className="px-3 py-2 border border-s112-line-str" />
            </tr>
          </tfoot>
        </table>

        {/* Weinbestandsmeldung */}
        <div className="mt-10 pt-6 border-t-2 border-s112-line-str">
          <h2 className="text-base font-semibold text-s112-text mb-1">Weinbestandsmeldung</h2>
          <p className="text-xs text-s112-text-2 mb-3">§ 29 Weingesetz 2009 · Stichtag: <strong>31. Juli</strong> · Meldefrist: <strong>15. August</strong> · Weindatenbank: online.wein.bmluk.gv.at</p>

          {/* Abschnitt A: Flaschen */}
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-1">A – Flaschenwein</p>
          <table className="w-full border-collapse text-sm mb-4">
            <thead><tr className="bg-[#F2F3F5]">
              <th className="px-3 py-2 border border-s112-line text-left">Bezeichnung</th>
              <th className="px-3 py-2 border border-s112-line text-left">Jg.</th>
              <th className="px-3 py-2 border border-s112-line text-left">Rebsorte</th>
              <th className="px-3 py-2 border border-s112-line text-right">ml</th>
              <th className="px-3 py-2 border border-s112-line text-right">Flaschen</th>
              <th className="px-3 py-2 border border-s112-line text-right">hl</th>
            </tr></thead>
            <tbody>
              {bestand.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-3 text-center text-s112-tertiary italic border border-s112-line text-xs">Kein Flaschenbestand</td></tr>
              ) : bestand.map((f: R, i: number) => {
                const hl = ((f.bestand_flaschen ?? 0) * (f.flaschengroesse_ml ?? 750)) / 100000
                return (<tr key={i} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                  <td className="px-3 py-2 border border-s112-line">{f.name}</td>
                  <td className="px-3 py-2 border border-s112-line">{f.jahrgang ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line">{formatRebsorteMitKuerzel(f.rebsorte)}</td>
                  <td className="px-3 py-2 border border-s112-line text-right">{f.flaschengroesse_ml ?? 750}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums">{fmtNum((f.bestand_flaschen ?? 0))}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums">{hl.toFixed(3).replace('.', ',')}</td>
                </tr>)
              })}
            </tbody>
            <tfoot><tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-3 py-2 border border-s112-line-str" colSpan={4}>GESAMT Flaschen</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums">{fmtNum(gesamtFlaschen)} Fl.</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums">{gesamtFlaschenHl.toFixed(3).replace('.', ',')} hl</td>
            </tr></tfoot>
          </table>

          {/* Abschnitt B: Wein in Gebinden */}
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-1 mt-4">B – Wein in Gebinden (Tank / Fass)</p>
          <table className="w-full border-collapse text-sm">
            <thead><tr className="bg-[#F2F3F5]">
              <th className="px-3 py-2 border border-s112-line text-left">Charge / Bezeichnung</th>
              <th className="px-3 py-2 border border-s112-line text-left">Jg.</th>
              <th className="px-3 py-2 border border-s112-line text-left">Rebsorte</th>
              <th className="px-3 py-2 border border-s112-line text-left">Behälter</th>
              <th className="px-3 py-2 border border-s112-line text-right">Liter</th>
              <th className="px-3 py-2 border border-s112-line text-right">hl</th>
            </tr></thead>
            <tbody>
              {tanks.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-3 text-center text-s112-tertiary italic border border-s112-line text-xs">Kein Wein in Gebinden</td></tr>
              ) : tanks.map((t: R, i: number) => {
                const liter = parseFloat(t.menge_liter) || 0
                const hl    = liter / 100
                return (<tr key={i} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                  <td className="px-3 py-2 border border-s112-line">{t.name}</td>
                  <td className="px-3 py-2 border border-s112-line">{t.jahrgang ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line">{formatRebsorteMitKuerzel(t.rebsorte)}</td>
                  <td className="px-3 py-2 border border-s112-line text-xs text-s112-text-2">{(t.behaelter as R)?.name ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums">{fmtNum(liter, { max: 1 })}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums">{hl.toFixed(3).replace('.', ',')}</td>
                </tr>)
              })}
            </tbody>
            <tfoot><tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-3 py-2 border border-s112-line-str" colSpan={5}>GESAMT Gebinde</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums">{gesamtTankHl.toFixed(3).replace('.', ',')} hl</td>
            </tr></tfoot>
          </table>

          {/* Gesamtsumme */}
          <div className="mt-3 flex justify-end">
            <div className="bg-s112-text text-white px-4 py-2 rounded-lg text-sm font-semibold">
              Gesamtbestand: {(gesamtFlaschenHl + gesamtTankHl).toFixed(3).replace('.', ',')} hl
            </div>
          </div>
        </div>

        {/* Unterschrift */}
        <div className="grid grid-cols-2 gap-16 mt-12 pt-4">
          <div>
            <div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Datum, Unterschrift Betriebsführer/in</div>
          </div>
          <div>
            <div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Stempel</div>
          </div>
        </div>
      </div>
    </div>
  )
}
