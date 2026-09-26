// behoerdenmeldung: cu-bilanz, cu-bilanz-behandlungen
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import PrintButton from '../../PrintButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { datumDe, jahrAus } from '@/lib/behoerden/psm'
import {
  CU_GRENZWERT_KG_HA_5J, CU_GRENZWERT_KG_HA_7J, CU_GRENZWERT_KG_HA_JAHR, CU_STATUS_LABEL, ladeCuBilanz,
} from '@/lib/behoerden/cu'

export const metadata: Metadata = { title: 'Cu-Bilanz – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Kupfer-Bilanz (Pflichtmeldung, Druck + CSV „cu-bilanz“ je Weingarten und
// „cu-bilanz-behandlungen“). Druck, CSV und der Tab „Cu-Bilanz“ in /behandlungen/berichte
// rechnen mit derselben Funktion (lib/behoerden/cu.ts); Summen = Summe der gerundeten Zeilen.

const kg = (n: number | null) => (n === null ? '–' : fmtNum(n, 4))
const ha = (n: number | null) => (n === null ? '–' : fmtNum(n, { min: 2, max: 4 }))

export default async function CuBilanzPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const { jahr: jahrParam } = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/dashboard')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const heute = wienHeute()
  const diesesJahr = Number(heute.slice(0, 4))
  const aktJahr = jahrAus(jahrParam) ?? diesesJahr
  const jahre = Array.from({ length: 5 }, (_, i) => diesesJahr - i)
  if (!jahre.includes(aktJahr)) jahre.push(aktJahr)

  const [bilanz, { data: settingsRaw }] = await Promise.all([
    ladeCuBilanz(supabase, tenantId, { jahr: aktJahr }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url, modul_controlling')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])

  const s = (settingsRaw as R | null) ?? {}
  // Brotkrume wie die Navigation (Rieden › Maßnahmen › …) – die Tab-Leiste zeigt diese Seite
  // immer unter „Rieden“, auch mit Modul Controlling (Review 25.09.2026)
  const zurueck = { href: '/behandlungen', label: 'Maßnahmen' }

  const jahr = bilanz.jahre.find(j => j.jahr === aktJahr)
  const eintraege = jahr?.behandlungen ?? []
  const weingaerten = jahr?.weingaerten ?? []
  const gesamtHa = bilanz.gesamtHa
  const totalCuKg = jahr?.cuKg ?? 0
  const totalCuKgHa = jahr?.cuKgHa ?? null
  const ueberlimit = jahr?.status === 'ueber'
  const wgUeber = weingaerten.filter(w => w.cuKgHa !== null && w.cuKgHa > CU_GRENZWERT_KG_HA_JAHR).length

  return (
    <div className="max-w-5xl space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weingarten" className="hover:text-s112-blue-700">Rieden</Link>
          <span>/</span>
          <Link href={zurueck.href} className="hover:text-s112-blue-700">{zurueck.label}</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">Cu-Bilanz Jahresbericht</span>
        </nav>
        <div className="flex items-start gap-2 flex-wrap">
          <form method="GET" action="/reports/cu-bilanz" className="flex gap-2">
            <select name="jahr" aria-label="Jahr"
              defaultValue={aktJahr}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
              {jahre.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
            <button type="submit" aria-label="Anzeigen" title="Anzeigen" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
              ↻
            </button>
          </form>
          <PrintButton />
          <CsvExportKnopf label="Kupfer je Weingarten als CSV" href={csvPfad('cu-bilanz', { jahr: aktJahr })} />
          <CsvExportKnopf label="Einzelbehandlungen als CSV" href={csvPfad('cu-bilanz-behandlungen', { jahr: aktJahr })} />
        </div>
      </div>

      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        <div className="flex items-start justify-between border-b-2 border-s112-text pb-4 mb-6">
          <div>
            {s.logo_url && <Image unoptimized src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
            <p className="font-semibold text-s112-text">{s.betrieb_name ?? ''}</p>
            <p className="text-sm text-s112-text-2">{[s.betrieb_strasse, [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-s112-text">Kupfer-Bilanz (Cu-Bilanz)</p>
            <p className="text-2xl font-semibold text-s112-blue-700">Jahr {aktJahr}</p>
            <p className="text-xs text-s112-tertiary mt-1">Gem. EU-Bio-VO 2018/848 · Erstellt: {datumDe(heute)}</p>
          </div>
        </div>

        {/* KPI-Zusammenfassung (Betrieb) */}
        {/* ohne Betriebsfläche (keine WI-Grundstücke) kein Cu je ha – neutral statt grün */}
        <div className={`grid grid-cols-3 gap-4 mb-2 p-4 rounded-xl border-2 ${ueberlimit ? 'border-s112-err/50 bg-s112-err-bg' : totalCuKgHa === null ? 'border-s112-line-str bg-s112-bg' : 'border-s112-ok/50 bg-s112-ok-bg'}`}>
          <div className="text-center">
            <p className="text-xs text-s112-text-2 mb-1">Betriebsfläche (WI)</p>
            <p className="text-xl font-semibold">{fmtNum(gesamtHa, 2)} ha</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-s112-text-2 mb-1">Cu eingesetzt gesamt</p>
            <p className="text-xl font-semibold">{fmtNum(totalCuKg, 3)} kg</p>
          </div>
          <div className="text-center">
            <p className="text-xs text-s112-text-2 mb-1">Cu je ha</p>
            <p className={`text-xl font-semibold ${ueberlimit ? 'text-s112-err-fg' : totalCuKgHa === null ? 'text-s112-text-2' : 'text-s112-ok-fg'}`}>
              {totalCuKgHa !== null ? `${fmtNum(totalCuKgHa, 3)} kg/ha` : '–'}
            </p>
            <p className="text-xs mt-0.5">{ueberlimit ? 'ÜBER EU-Limit' : `Limit: ${CU_GRENZWERT_KG_HA_JAHR} kg/ha/Jahr`}</p>
          </div>
        </div>
        <p className="text-xs text-s112-text-2 mb-6">
          Betrieb über 5 Jahre ({aktJahr - 4}–{aktJahr}): <strong>{jahr?.cuKgHa5J != null ? `${fmtNum(jahr.cuKgHa5J, 3)} kg/ha` : '–'}</strong> (ÖPUL-Grenze {CU_GRENZWERT_KG_HA_5J} kg/ha)
          {' · '}über 7 Jahre ({aktJahr - 6}–{aktJahr}): <strong>{jahr?.cuKgHa7J != null ? `${fmtNum(jahr.cuKgHa7J, 3)} kg/ha` : '–'}</strong> (EU {CU_GRENZWERT_KG_HA_7J} kg/ha)
          {wgUeber > 0 && <span className="text-s112-err-fg font-medium"> · {wgUeber} {wgUeber === 1 ? 'Weingarten' : 'Weingärten'} über {CU_GRENZWERT_KG_HA_JAHR} kg/ha</span>}
        </p>

        {/* Je Weingarten */}
        <h2 className="text-sm font-semibold text-s112-text mb-2">Je Weingarten</h2>
        <table className="w-full text-sm border-collapse mb-6">
          <thead>
            <tr className="bg-[#F2F3F5]">
              {['Weingarten', 'Ried', 'Fläche ha', 'Anw.', 'Cu kg', 'Cu kg/ha', '5 J. kg/ha', '7 J. kg/ha', 'Status'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-s112-line-str font-semibold text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weingaerten.map((w, i) => (
              <tr key={w.weingartenId} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                <td className="px-2 py-1.5 border border-s112-line text-xs">{w.weingarten}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs">{w.ried ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{ha(w.flaecheHa)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{w.behandlungen}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{kg(w.cuKg)}</td>
                <td className={`px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs font-medium ${w.cuKgHa !== null && w.cuKgHa > CU_GRENZWERT_KG_HA_JAHR ? 'text-s112-err-fg' : ''}`}>{kg(w.cuKgHa)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{kg(w.cuKgHa5J)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{kg(w.cuKgHa7J)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs whitespace-nowrap">{w.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {weingaerten.length === 0 && eintraege.length > 0 && (
          <p className="text-xs text-s112-muted -mt-4 mb-6">Die Kupferbehandlungen sind keinem Weingarten zugeordnet.</p>
        )}

        {/* Einzelbehandlungen */}
        <h2 className="text-sm font-semibold text-s112-text mb-2">Einzelbehandlungen</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#F2F3F5]">
              {['Datum', 'Weingarten', 'Mittel', 'Cu-Gehalt %', 'Aufwand', 'Mittelmenge kg', 'Fläche ha', 'Cu kg gesamt', 'Cu kg/ha'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-s112-line-str font-semibold text-xs whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {eintraege.map((e, i) => (
              <tr key={e.behandlungId} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                <td className="px-2 py-1.5 border border-s112-line tabular-nums whitespace-nowrap text-xs">{datumDe(e.datum)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs">{e.weingarten ?? '–'}</td>
                <td className="px-2 py-1.5 border border-s112-line text-xs">
                  {e.mittel}
                  {e.cuGehaltQuelle !== 'Stammdaten' && <span className="block text-[10px] text-s112-warn-fg">Cu-Gehalt: {e.cuGehaltQuelle}</span>}
                </td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{fmtNum(e.cuGehaltPct, { max: 3 })}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs whitespace-nowrap">
                  {e.aufwand !== null ? `${fmtNum(e.aufwand, { max: 3 })} ${e.aufwandEinheit}` : '–'}
                  {e.spritzbruehe !== null && <span className="block text-[10px] text-s112-tertiary">Brühe {fmtNum(e.spritzbruehe, { max: 3 })} l</span>}
                </td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">
                  {fmtNum(e.mengeKg, { max: 3 })}
                  <span className="block text-[10px] text-s112-tertiary">{e.mengeBasis}</span>
                </td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{ha(e.flaecheHa)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums font-medium text-xs">{kg(e.cuKg)}</td>
                <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums text-xs">{kg(e.cuKgHa)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-2 py-2 border border-s112-line-str text-xs" colSpan={7}>GESAMT {aktJahr} (Betrieb, {fmtNum(gesamtHa, { min: 2, max: 4 })} ha)</td>
              <td className="px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs">{kg(totalCuKg)} kg</td>
              <td className={`px-2 py-2 border border-s112-line-str text-right tabular-nums text-xs ${ueberlimit ? 'text-s112-err-fg' : totalCuKgHa === null ? 'text-s112-text-2' : 'text-s112-ok-fg'}`}>
                {totalCuKgHa !== null ? `${kg(totalCuKgHa)} kg/ha` : '–'}
              </td>
            </tr>
          </tfoot>
        </table>

        {eintraege.length === 0 && <p className="text-center text-s112-muted py-8">Keine Kupferbehandlungen für {aktJahr} erfasst.</p>}

        {bilanz.warnungen.length > 0 && (
          <ul className="text-xs text-s112-warn-fg mt-3 list-disc pl-4 space-y-0.5">
            {bilanz.warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <p className="text-xs text-s112-tertiary mt-4">
          Grenzwert: max. {CU_GRENZWERT_KG_HA_JAHR} kg Cu/ha/Jahr (EU-Bio-VO 2018/848 Art. 24) ·
          Österreich: max. {CU_GRENZWERT_KG_HA_5J} kg Cu/ha über 5 Jahre (ÖPUL) · EU: {CU_GRENZWERT_KG_HA_7J} kg Cu/ha über 7 Jahre (DVO (EU) 2021/1165 Anhang II).
          Cu je Behandlung = Mittelmenge × Cu-Gehalt; Mittelmenge = Aufwand × Fläche (bzw. Konzentration im Tank ×
          Spritzbrühe), nie die Spritzbrühe selbst; Mittel in Litern mit 1 kg/l. Je ha bezogen auf die behandelte Fläche
          (Summe der Grundstücke); je Weingarten anteilig nach Grundstücksfläche, bezogen auf die Weingartenfläche; Betrieb
          bezogen auf die Fläche der Grundstücke mit Nutzart WI aller aktiven Weingärten.
          Status: {CU_STATUS_LABEL.warnung} ab {fmtNum(CU_GRENZWERT_KG_HA_JAHR * 0.8, 1)} kg/ha.
        </p>

        <div className="grid grid-cols-2 gap-16 mt-10 pt-4">
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Datum, Unterschrift Betriebsführer/in</div></div>
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Bio-Kontrollstelle / Stempel</div></div>
        </div>
      </div>
    </div>
  )
}
