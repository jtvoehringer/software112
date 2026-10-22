// behoerdenmeldung: psm-aufzeichnung, psm-uebermittlung
import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
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
import {
  ART_LABEL, artAus, aufwandEinheitText, datumDe, gstAnzahl, jahrAus, ladePsmAufzeichnung, mittelmenge, mittelName,
  riedenMitLage, spritzbruehe, windText, witterungText, type PsmBehandlung,
} from '@/lib/behoerden/psm'
import SortierungUmschalter from '@/components/SortierungUmschalter'
import { PROTOKOLL_SORT_LABEL, PROTOKOLL_SORT_VORGABE, inAnzeigeReihenfolge, protokollSortAus } from '@/lib/protokoll/sortierung'

export const metadata: Metadata = { title: 'Behandlungsprotokoll' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Pflanzenschutz-Aufzeichnungen (Pflichtmeldung, Druck + CSV „psm-aufzeichnung“). Druck und CSV
// laden über dieselbe Funktion ladePsmAufzeichnung() (lib/behoerden/psm.ts): der Ausdruck zeigt
// eine Zeile je Maßnahme, die CSV eine Zeile je Maßnahme × Grundstück (KG, GST-Nr., Fläche).
// Mengen je Maßnahme aus denselben Funktionen wie die CSV (KAN-133): „Mittel X kg · Brühe X l“
// bzw. „Dünger X kg“ – die CSV verteilt genau diese Werte nach Grundstücksfläche.

/** „Mittel 1,2 kg · Brühe 800 l“ (Spritzung), „Mittel 0,4 kg“ (Sonstiges mit Aufwand, KAN-154) bzw. „Dünger 1.000 kg“ (Düngung); sonst null */
function mengenText(b: PsmBehandlung): string | null {
  if (b.art === 'sonstiges') {
    const mm = mittelmenge(b)
    return b.psm && mm.menge !== null ? `Mittel ${fmtNum(mm.menge, { max: 3 })} ${mm.einheit}` : null
  }
  if (b.art !== 'spritzung' && b.art !== 'duengung') return null
  const mm = mittelmenge(b)
  const menge = mm.menge !== null ? `${fmtNum(mm.menge, { max: 3 })} ${mm.einheit}` : `– (${mm.warnung})`
  if (b.art === 'duengung') return `Dünger ${menge}`
  const bruehe = spritzbruehe(b)
  return `Mittel ${menge}${bruehe !== null ? ` · Brühe ${fmtNum(bruehe, { max: 3 })} l` : ''}`
}
/** Eine Zeile des Protokolls (Bildschirm und Druck); i = Position für die Streifen */
function zeile(b: PsmBehandlung, i: number) {
  const rieden = riedenMitLage(b)
  const nGst = gstAnzahl(b)
  const wetter = [witterungText(b.witterung), b.temperaturC !== null ? `${fmtNum(b.temperaturC, { max: 1 })} °C` : null, windText(b.wind)].filter(Boolean).join(', ')
  const mengen = mengenText(b)
  return (
    <tr key={b.id} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
      <td className="px-2 py-1.5 border border-s112-line tabular-nums whitespace-nowrap">
        {datumDe(b.datum)}{b.datumBis && b.datumBis !== b.datum ? <><br />– {datumDe(b.datumBis)}</> : null}
      </td>
      <td className="px-2 py-1.5 border border-s112-line">{ART_LABEL[b.art] ?? b.art}</td>
      <td className="px-2 py-1.5 border border-s112-line">
        {/* Rückmeldung 30.09.2026: ab vier Rieden kompakt – die vollständige Liste (je Grundstück) steht im CSV */}
        {rieden.length === 0 ? '–' : rieden.length <= 3 ? rieden.join(', ') : `${rieden.length} Rieden · Details siehe CSV`}
        {b.anwender && <span className="block text-[10px] text-s112-tertiary">Anwender: {b.anwender}</span>}
      </td>
      <td className="px-2 py-1.5 border border-s112-line text-right tabular-nums whitespace-nowrap">
        {b.flaecheHa !== null ? fmtNum(b.flaecheHa, { min: 2, max: 4 }) : '–'}
        {nGst > 0 && <span className="block text-[10px] text-s112-tertiary">{nGst} GST</span>}
      </td>
      <td className="px-2 py-1.5 border border-s112-line">
        {mittelName(b) ?? '–'}
        {b.psm?.zulassungsnr && <span className="block text-[10px] text-s112-tertiary">Zul.-Nr. {b.psm.zulassungsnr}</span>}
      </td>
      <td className="px-2 py-1.5 border border-s112-line text-s112-text-2">{b.psm?.wirkstoff ?? '–'}</td>
      <td className="px-2 py-1.5 border border-s112-line">{b.schaderreger ?? '–'}</td>
      <td className="px-2 py-1.5 border border-s112-line text-center">{b.bbch ?? '–'}</td>
      <td className="px-2 py-1.5 border border-s112-line tabular-nums whitespace-nowrap">
        {b.aufwand !== null ? `${fmtNum(b.aufwand, { max: 3 })} ${aufwandEinheitText(b.aufwandEinheit)}` : '–'}
        {mengen && <span className="block text-[10px] text-s112-tertiary">{mengen}</span>}
        {b.wasserLHa !== null && <span className="block text-[10px] text-s112-tertiary">Wasser {fmtNum(b.wasserLHa, { max: 1 })} l/ha</span>}
      </td>
      <td className="px-2 py-1.5 border border-s112-line text-center whitespace-nowrap">
        {b.psm?.wartezeitTage ? `${b.psm.wartezeitTage} T` : '–'}
        {b.fruehesterLesetermin && b.psm?.wartezeitTage ? <span className="block text-[10px] text-s112-tertiary">ab {datumDe(b.fruehesterLesetermin)}</span> : null}
      </td>
      <td className="px-2 py-1.5 border border-s112-line text-center">{(b.psm?.oeko ?? b.duengemittel?.oeko) ? 'Ja' : ''}</td>
      <td className="px-2 py-1.5 border border-s112-line text-s112-text-2">{wetter || '–'}</td>
      <td className="px-2 py-1.5 border border-s112-line text-s112-text-2">{b.notiz ?? ''}</td>
    </tr>
  )
}

export default async function BehandlungsprotokollPage({ searchParams }: { searchParams: Promise<{ jahr?: string; art?: string; sort?: string }> }) {
  const { jahr: jahrParam, art: artParam, sort: sortParam } = await searchParams
  // KAN-350: Bildschirm neueste zuerst (Vorgabe) oder chronologisch – Druck und CSV immer chronologisch
  const sort = protokollSortAus(sortParam)
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/dashboard')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const heute = wienHeute()
  const diesesJahr = Number(heute.slice(0, 4))
  const aktJahr = jahrAus(jahrParam) ?? diesesJahr
  const art = artAus(artParam) ?? null
  const jahre = Array.from({ length: 5 }, (_, i) => diesesJahr - i)
  if (!jahre.includes(aktJahr)) jahre.push(aktJahr)

  const [aufzeichnung, settingsRawRes] = await Promise.all([
    ladePsmAufzeichnung(supabase, tenantId, { jahr: aktJahr, art, ried: null }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url, modul_controlling')
      .eq('tenant_id', tenantId)
      .maybeSingle(),
  ])
  const settingsRaw = geladen(settingsRawRes, 'Einstellungen')

  // behandlungen kommt chronologisch (ladeBehandlungen: datum, id aufsteigend) – so bleibt es für Druck und CSV
  const { behandlungen, zeilen, warnungen } = aufzeichnung
  const anzeige = inAnzeigeReihenfolge(behandlungen, sort)
  const s = (settingsRaw as R | null) ?? {}
  // Brotkrume wie die Navigation (Rieden › Maßnahmen › …) – die Tab-Leiste zeigt diese Seite
  // immer unter „Rieden“, auch mit Modul Controlling (Review 25.09.2026)
  const zurueck = { href: '/behandlungen', label: 'Maßnahmen' }

  return (
    <div className="max-w-6xl space-y-4">
      {/* 13 Spalten – im Querformat drucken, sonst verkleinert der Browser stark bzw. schneidet ab */}
      <style>{`@media print { @page { size: A4 landscape; margin: 10mm 10mm 12mm; } }`}</style>
      <div className="flex items-start justify-between gap-3 flex-wrap print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weingarten" className="hover:text-s112-blue-700">Rieden</Link>
          <span>/</span>
          <Link href={zurueck.href} className="hover:text-s112-blue-700">{zurueck.label}</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">Behandlungsprotokoll</span>
        </nav>
        <div className="flex items-start gap-2 flex-wrap">
          <form method="GET" action="/reports/behandlungsprotokoll" className="flex gap-2">
            <select name="jahr" aria-label="Saison"
              defaultValue={aktJahr}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden">
              {jahre.map(j => <option key={j} value={j}>{j}</option>)}
            </select>
            <select name="art" aria-label="Maßnahmenart"
              defaultValue={art ?? ''}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden">
              <option value="">Alle Maßnahmen</option>
              {Object.entries(ART_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
            {sort !== PROTOKOLL_SORT_VORGABE && <input type="hidden" name="sort" value={sort} />}
            <button type="submit" aria-label="Anzeigen" title="Anzeigen" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
              ↻
            </button>
          </form>
          <SortierungUmschalter sort={sort} pfad="/reports/behandlungsprotokoll" parameter={{ jahr: aktJahr, art }} />
          <PrintButton />
          <CsvExportKnopf href={csvPfad('psm-aufzeichnung', { jahr: aktJahr, art })} />
          {/* KAN-87: maschinenlesbare Aufzeichnung (DVO (EU) 2023/564), nur Pflanzenschutzmittel */}
          <CsvExportKnopf href={csvPfad('psm-uebermittlung', { jahr: aktJahr })} label="CSV Übermittlung"
            hinweis="Pflanzenschutz-Aufzeichnung maschinenlesbar (DVO (EU) 2023/564): je Anwendung und Grundstück, mit Anwender, Startzeit, erfasst am/von und Verzug" />
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
            {/* Hauptüberschrift der Seite (bisher <p>: Seite ohne Überschrift, gefunden im ersten E2E-Lauf 10.10.2026) */}
            <h1 className="text-lg font-semibold text-s112-text">Weinbauliches Behandlungsprotokoll</h1>
            <p className="text-2xl font-semibold text-s112-blue-700">Saison {aktJahr}</p>
            <p className="text-xs text-s112-tertiary mt-1">
              {art ? `${ART_LABEL[art]} · ` : ''}Erstellt: {datumDe(heute)} · {behandlungen.length} Einträge · {zeilen.length} Grundstückszeilen
            </p>
          </div>
        </div>

        {/* Bildschirm: breite Tabelle scrollt in der Karte statt über den Rand zu laufen (Rückmeldung 30.09.2026);
            im Druck hebt globals.css den Scroll-Container auf (Querformat, Zellen brechen um) */}
        <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[#F2F3F5]">
              {['Datum', 'Art', 'Ried (Lage)', 'Fläche (ha)', 'Mittel (Zulassungsnr.)', 'Wirkstoff', 'Schaderreger', 'BBCH', 'Aufwand', 'Wartezeit', 'Öko', 'Witterung', 'Notiz'].map(h => (
                <th key={h} className="text-left px-2 py-2 border border-s112-line-str font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          {/* KAN-350: Bildschirm in der gewählten Reihenfolge; ist sie „neueste zuerst“, druckt ein eigener Tabellenkörper
              chronologisch (Pflichtaufzeichnung) */}
          <tbody className={sort === 'alt' ? undefined : 'print:hidden'}>
            {anzeige.map((b, i) => zeile(b, i))}
          </tbody>
          {sort !== 'alt' && (
            <tbody className="hidden print:table-row-group">
              {behandlungen.map((b, i) => zeile(b, i))}
            </tbody>
          )}
        </table>
        </div>

        {behandlungen.length === 0 && <p className="text-center text-s112-muted py-12">Keine Behandlungen für {aktJahr} erfasst.</p>}
        {behandlungen.length > 1 && (
          <p className="text-xs text-s112-tertiary mt-2 print:hidden">
            Anzeige: {PROTOKOLL_SORT_LABEL[sort].toLowerCase()} – Druck und CSV sind immer chronologisch.
          </p>
        )}

        {warnungen.length > 0 && (
          <ul className="text-xs text-s112-warn-fg mt-3 list-disc pl-4 space-y-0.5">
            {warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        <p className="text-xs text-s112-tertiary mt-4">
          Kultur: Weinrebe (EPPO VITVI) · Fläche = Summe der behandelten Grundstücke · Mittelmenge = Aufwand × Fläche
          (bzw. Konzentration im Tank × Spritzbrühe) · Spritzbrühe = Mittel und Wasser im Tank, bei einer Tankmischung
          je Mittel dieselbe Brühe · Die CSV-Datei enthält je Maßnahme eine Zeile pro Grundstück (KG-Nr., GST-Nr., Fläche,
          Mittelmenge und Spritzbrühe anteilig nach Fläche).
        </p>

        <div className="grid grid-cols-2 gap-16 mt-12 pt-4">
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Datum, Unterschrift Betriebsführer/in</div></div>
          <div><div className="border-t border-s112-line-str pt-2 text-xs text-s112-text-2">Stempel / Kontrollstelle</div></div>
        </div>
      </div>
    </div>
  )
}
