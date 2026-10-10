// behoerdenmeldung: erntemeldung, bestandsmeldung
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import Image from 'next/image'
import PrintButton from '../../PrintButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { HEKTARHOECHSTERTRAG_KG_HA, HOECHSTERTRAG_RECHTSFOLGE, ladeErntemeldung, type ErnteZeile } from '@/lib/behoerden/erntemeldung'
import { HL_STELLEN_BESTAND, ladeBestandsmeldung, standardStichtag, stichtagParameter, type BestandZeile } from '@/lib/behoerden/bestandsmeldung'
import { istParameterFehler } from '@/lib/behoerden/typen'
import { datumAT } from '@/lib/behoerden/ernte_hilfen'
import { qualitaetLabel } from '@/lib/wein/qualitaet'
import { fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { AktionsFehler } from '@/lib/fehler'

export const metadata: Metadata = { title: 'AMA Erntemeldung – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Weinerntemeldung und Weinbestandsmeldung (Pflichtmeldungen, reports/(pflicht)/layout.tsx).
// Druck und CSV (/meldungen/erntemeldung/csv, /meldungen/bestandsmeldung/csv) kommen aus
// denselben Ladefunktionen in lib/behoerden – die Summen addieren die gerundeten Zeilenwerte.
// Weinbestand zum Stichtag (KAN-43): ?stichtag= wie die CSV (stichtagParameter), Standard 31.07. des laufenden
// Weinwirtschaftsjahres; ein ungültiger Stichtag zeigt einen Hinweis und den Standard-Stichtag.

/** Rebsorte mit amtlichem Kürzel – ohne Ersatzkürzel (Behördenausdruck) */
function sorteMitKuerzel(rebsorte: string | null, kuerzel: string | null): string {
  if (!rebsorte) return '–'
  return kuerzel ? `${rebsorte} (${kuerzel})` : rebsorte
}

const zahl = (n: number | null, stellen: number) => (n === null ? '–' : fmtNum(n, stellen))

/** Farbe und Qualitätsstufe einer Bestandsposition (wie die CSV-Spalten „Farbe“, „Qualitätsstufe“) */
const farbeQualitaet = (z: BestandZeile) => [z.farbe, z.qualitaet].filter(Boolean).join(' · ') || '–'

export default async function AMAPage({ searchParams }: { searchParams: Promise<{ jahrgang?: string; stichtag?: string }> }) {
  const { jahrgang: jahrgangParam, stichtag: stichtagParam } = await searchParams
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  if (!membership || !tenantId) {
    return <div className="card p-10 text-center text-s112-muted text-sm">Nicht angemeldet.</div>
  }

  const [{ data: jahrgaengeRaw, error: jgFehler }, { data: settingsRaw, error: stFehler }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinjahrgaenge') as any).select('id, jahrgang').eq('tenant_id', tenantId).order('jahrgang', { ascending: false }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_uid, logo_url, modul_controlling')
      .eq('tenant_id', tenantId).maybeSingle(),
  ])
  if (jgFehler) throw new AktionsFehler(`Jahrgänge konnten nicht geladen werden: ${jgFehler.message}`)
  if (stFehler) throw new AktionsFehler(`Betriebsdaten konnten nicht geladen werden: ${stFehler.message}`)

  const jahrgaenge = (jahrgaengeRaw ?? []) as R[]
  const s = (settingsRaw as R | null) ?? {}
  const aktJahrgang = jahrgaenge.find(j => String(j.jahrgang) === jahrgangParam) ?? jahrgaenge[0]
  // Brotkrume wie die Navigation: Rieden › Lese › AMA-Erntemeldung (Review 25.09.2026)

  const heuteIso = wienHeute()
  const stichtagPruefung = stichtagParameter(new URLSearchParams({ stichtag: stichtagParam ?? '' }), heuteIso)
  const stichtag = istParameterFehler(stichtagPruefung) ? standardStichtag(heuteIso) : stichtagPruefung.stichtag
  const stichtagFehler = istParameterFehler(stichtagPruefung) ? stichtagPruefung.fehler : null

  const [ernte, bestand] = await Promise.all([
    aktJahrgang ? ladeErntemeldung(supabase, tenantId, { id: aktJahrgang.id, jahrgang: Number(aktJahrgang.jahrgang) }) : Promise.resolve(null),
    ladeBestandsmeldung(supabase, tenantId, { stichtag, heute: heuteIso }),
  ])
  const zeilen: ErnteZeile[] = ernte?.zeilen ?? []
  const hht = ernte?.hektarhoechstertrag ?? null
  const heute = datumAT(heuteIso)
  const stichtagText = datumAT(stichtag)

  return (
    <div className="max-w-5xl space-y-4">
      {/* Breadcrumb + Aktionen */}
      <div className="flex items-start justify-between gap-4 flex-wrap print:hidden">
        <nav className="flex items-center gap-2 text-sm text-s112-muted mt-1.5">
          <Link href="/weingarten" className="hover:text-s112-blue-700">Rieden</Link>
          <span>/</span>
          <Link href="/erntemeldung" className="hover:text-s112-blue-700">Lese</Link>
          <span>/</span>
          <span className="font-medium text-s112-text">AMA-Erntemeldung</span>
        </nav>
        <div className="flex items-start gap-2 flex-wrap">
          <form method="GET" action="/reports/ama" className="flex items-center gap-1 flex-wrap">
            <select name="jahrgang" aria-label="Jahrgang"
              defaultValue={aktJahrgang?.jahrgang ?? ''}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden">
              {jahrgaenge.map(j => <option key={j.id} value={j.jahrgang}>{j.jahrgang}</option>)}
            </select>
            {/* KAN-43: Stichtag der Weinbestandsmeldung (Ende des Tages), höchstens heute */}
            <label className="flex items-center gap-1 text-xs text-s112-text-2 ml-1">
              Bestand am
              <input type="date" name="stichtag" aria-label="Stichtag der Weinbestandsmeldung"
                defaultValue={stichtag} max={heuteIso}
                className="border border-s112-border rounded-lg px-2 py-1 text-sm focus:outline-hidden" />
            </label>
            <button type="submit" aria-label="Jahrgang und Stichtag anzeigen" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
              ↻
            </button>
          </form>
          <PrintButton />
          {/* Ohne angelegten Jahrgang: Leermeldung (nur Kopfzeile) für das laufende Jahr */}
          <CsvExportKnopf label="Erntemeldung als CSV" href={csvPfad('erntemeldung', { jahrgang: aktJahrgang?.jahrgang ?? wienHeute().slice(0, 4) })} />
          <CsvExportKnopf label="Weinbestand als CSV" href={csvPfad('bestandsmeldung', { stichtag })} />
        </div>
      </div>

      {stichtagFehler && (
        <div role="alert" className="print:hidden rounded-xl border border-s112-border bg-s112-bg px-4 py-3 text-xs text-s112-err-fg">
          {stichtagFehler} Angezeigt wird der Standard-Stichtag {stichtagText}.
        </div>
      )}

      {ernte && ernte.warnungen.length > 0 && (
        <div className="print:hidden rounded-xl border border-s112-border bg-s112-bg px-4 py-3 text-xs text-s112-text-2">
          <p className="font-semibold text-s112-text mb-1">Hinweise zur Erntemeldung {ernte.jahrgang.jahrgang}</p>
          <ul className="list-disc pl-4 space-y-0.5">
            {ernte.warnungen.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      {/* Dokument */}
      <div className="card p-8 print:border-0 print:shadow-none print:p-0">
        {/* Kopf */}
        <div className="flex items-start justify-between border-b-2 border-s112-text pb-4 mb-6">
          <div>
            {s.logo_url && <Image unoptimized src={s.logo_url} alt="" width={150} height={40} className="object-contain object-left max-h-10 mb-2" />}
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
        <table className="w-full text-sm border-collapse mb-3">
          <thead>
            <tr className="bg-[#F2F3F5] border border-s112-line-str">
              <th className="text-left align-bottom px-3 py-2 border border-s112-line-str font-semibold">Rebsorte</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">Fläche<br />(ha)</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">Menge<br />(kg)</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">davon verkauft<br />(kg)</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">Menge<br />(hl)</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">°KMW</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">°Oe</th>
              <th className="text-left align-bottom px-3 py-2 border border-s112-line-str font-semibold">Qualitätsstufe</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">Ertrag<br />(kg/ha)</th>
              <th className="text-right align-bottom px-3 py-2 border border-s112-line-str font-semibold whitespace-nowrap">Übermenge<br />(kg)</th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-4 text-center text-s112-tertiary text-sm italic border border-s112-line">
                  Keine Erntemeldung vorhanden – bitte auf der Lese-Seite &quot;AMA-Meldung erstellen&quot; klicken
                </td>
              </tr>
            ) : zeilen.map((z, i) => (
              <tr key={i} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                <td className="px-3 py-2 border border-s112-line font-medium">
                  {sorteMitKuerzel(z.rebsorte, z.kuerzel)}
                  {/* KAN-165: bei Rieden aus mehreren Bundesländern eine Position je Weinbaugebiet */}
                  {(ernte?.gebiete.length ?? 0) > 1 && <span className="block text-xs font-normal text-s112-tertiary">{z.weinbaugebiet ?? 'ohne Weinbaugebiet'}</span>}
                </td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap">{zahl(z.flaecheHa, 4)}</td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap font-medium">{zahl(z.mengeKg, 0)}</td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap">{zahl(z.verkauftKg, 0)}</td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap" title={z.hlGeschaetzt ? 'aus Menge (kg) ÷ 130 umgerechnet' : undefined}>
                  {zahl(z.mengeHl, 2)}
                </td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap" title="Mostgewicht, mengengewichtetes Mittel der Lesen (abgerundet)">{z.kmw === null ? '–' : fmtNum(z.kmw, { min: 1, max: 2 })}</td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap" title="Mostgewicht in °Oe, aus dem °KMW-Mittel umgerechnet">{z.oechsle === null ? '–' : fmtNum(z.oechsle, { min: 1, max: 1 })}</td>
                <td className="px-3 py-2 border border-s112-line">{qualitaetLabel(z.qualitaetsstufe)}</td>
                <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap">{zahl(z.ertragKgHa, 0)}</td>
                <td className={`px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap ${(z.uebermengeKg ?? 0) > 0 ? 'text-s112-err-fg font-semibold' : ''}`}>
                  {zahl(z.uebermengeKg, 0)}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-3 py-2 border border-s112-line-str">GESAMT</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums whitespace-nowrap">{ernte ? fmtNum(ernte.summe.flaecheHa, 4) : ''}</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums whitespace-nowrap">{fmtNum(ernte?.summe.mengeKg ?? 0, 0)} kg</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums whitespace-nowrap">{fmtNum(ernte?.summe.verkauftKg ?? 0, 0)} kg</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums whitespace-nowrap">{fmtNum(ernte?.summe.mengeHl ?? 0, 2)} hl</td>
              <td className="px-3 py-2 border border-s112-line-str" colSpan={5} />
            </tr>
          </tfoot>
        </table>

        {/* Hektarhöchstertrag (betriebsweit, maßgeblich) */}
        {hht && hht.gesamtKg > 0 && (
          <p className={`text-xs mb-6 ${hht.ueberschritten ? 'text-s112-err-fg font-semibold' : 'text-s112-text-2'}`}>
            Hektarhöchstertrag betriebsweit (alle Lesen, § 23 WeinG): {fmtNum(hht.gesamtKg, 0)} kg von max. {fmtNum(hht.maxKg, 0)} kg
            {' '}({fmtNum(HEKTARHOECHSTERTRAG_KG_HA, 0)} kg/ha × {fmtNum(hht.gesamtFlaecheHaBetrieb, 4)} ha Weingartenfläche lt. AMA) –{' '}
            {hht.ueberschritten ? `überschritten um ${fmtNum(hht.ueberschreitungKg, 0)} kg. ${HOECHSTERTRAG_RECHTSFOLGE}` : 'eingehalten'}.
            {' '}Die Spalte „Übermenge“ zeigt die rechnerische Überschreitung je Sorte.
          </p>
        )}
        {ernte?.quelle === 'lesedaten' && zeilen.length > 0 && (
          <p className="text-xs text-s112-warn-fg mb-6 print:hidden">
            Vorschau aus den Lesedaten – für diesen Jahrgang ist noch keine AMA-Meldung erstellt (Lese-Seite: „AMA-Meldung erstellen“).
          </p>
        )}

        {/* Weinbestandsmeldung */}
        <div className="mt-10 pt-6 border-t-2 border-s112-line-str">
          <h2 className="text-base font-semibold text-s112-text mb-1">Weinbestandsmeldung</h2>
          <p className="text-xs text-s112-text-2 mb-1">§ 29 Weingesetz 2009 · Stichtag: <strong>31. Juli</strong> · Meldefrist: <strong>15. August</strong> · Weindatenbank: online.wein.bmluk.gv.at</p>
          <p className="text-xs text-s112-text-2 mb-3">
            Bestand am <strong>{stichtagText}</strong> (Ende des Tages){stichtag === heuteIso ? ' – heutiger Bestand' : ''}.
          </p>
          {bestand.warnungen.length > 0 && (
            <div className="print:hidden rounded-xl border border-s112-border bg-s112-bg px-4 py-3 text-xs text-s112-text-2 mb-3">
              <p className="font-semibold text-s112-text mb-1">Hinweise zur Weinbestandsmeldung</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {bestand.warnungen.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}

          {/* Abschnitt A: Flaschen */}
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-1">A – Flaschenwein</p>
          <table className="w-full border-collapse text-sm mb-4">
            <thead><tr className="bg-[#F2F3F5]">
              <th className="px-3 py-2 border border-s112-line text-left">Bezeichnung</th>
              <th className="px-3 py-2 border border-s112-line text-left">Jg.</th>
              <th className="px-3 py-2 border border-s112-line text-left">Rebsorte</th>
              <th className="px-3 py-2 border border-s112-line text-left">Farbe · Qualität</th>
              <th className="px-3 py-2 border border-s112-line text-right">ml</th>
              <th className="px-3 py-2 border border-s112-line text-right">Flaschen</th>
              <th className="px-3 py-2 border border-s112-line text-right">hl</th>
            </tr></thead>
            <tbody>
              {bestand.flaschen.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-3 text-center text-s112-tertiary italic border border-s112-line text-xs">Kein Flaschenbestand</td></tr>
              ) : bestand.flaschen.map((f: BestandZeile, i: number) => (
                <tr key={i} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                  <td className="px-3 py-2 border border-s112-line">{f.bezeichnung ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line">{f.jahrgang ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line">{sorteMitKuerzel(f.rebsorte, f.kuerzel)}</td>
                  <td className="px-3 py-2 border border-s112-line text-xs">{farbeQualitaet(f)}</td>
                  <td className="px-3 py-2 border border-s112-line text-right">{f.flaschengroesseMl}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap">{zahl(f.flaschen, 0)}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap">{zahl(f.hl, HL_STELLEN_BESTAND)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-3 py-2 border border-s112-line-str" colSpan={5}>GESAMT Flaschen</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums whitespace-nowrap">{fmtNum(bestand.summe.flaschen, 0)} Fl.</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums whitespace-nowrap">{fmtNum(bestand.summe.flaschenHl, HL_STELLEN_BESTAND)} hl</td>
            </tr></tfoot>
          </table>

          {/* Abschnitt B: Wein in Gebinden */}
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-1 mt-4">B – Wein in Gebinden (Tank / Fass)</p>
          <table className="w-full border-collapse text-sm">
            <thead><tr className="bg-[#F2F3F5]">
              <th className="px-3 py-2 border border-s112-line text-left">Charge / Bezeichnung</th>
              <th className="px-3 py-2 border border-s112-line text-left">Jg.</th>
              <th className="px-3 py-2 border border-s112-line text-left">Rebsorte</th>
              <th className="px-3 py-2 border border-s112-line text-left">Farbe · Qualität</th>
              <th className="px-3 py-2 border border-s112-line text-left">Behälter</th>
              <th className="px-3 py-2 border border-s112-line text-right">Liter</th>
              <th className="px-3 py-2 border border-s112-line text-right">hl</th>
            </tr></thead>
            <tbody>
              {bestand.gebinde.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-3 text-center text-s112-tertiary italic border border-s112-line text-xs">Kein Wein in Gebinden</td></tr>
              ) : bestand.gebinde.map((t: BestandZeile, i: number) => (
                <tr key={i} className={i % 2 === 1 ? 'bg-s112-bg' : ''}>
                  <td className="px-3 py-2 border border-s112-line">{t.bezeichnung ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line">{t.jahrgang ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line">{sorteMitKuerzel(t.rebsorte, t.kuerzel)}</td>
                  <td className="px-3 py-2 border border-s112-line text-xs">{farbeQualitaet(t)}</td>
                  <td className="px-3 py-2 border border-s112-line text-xs text-s112-text-2">{t.behaelter ?? '–'}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap">{t.liter === null ? '–' : fmtNum(t.liter, { max: 2 })}</td>
                  <td className="px-3 py-2 border border-s112-line text-right tabular-nums whitespace-nowrap">{zahl(t.hl, HL_STELLEN_BESTAND)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="bg-s112-line font-semibold border-t-2 border-s112-line-str">
              <td className="px-3 py-2 border border-s112-line-str" colSpan={6}>GESAMT Gebinde</td>
              <td className="px-3 py-2 border border-s112-line-str text-right tabular-nums whitespace-nowrap">{fmtNum(bestand.summe.gebindeHl, HL_STELLEN_BESTAND)} hl</td>
            </tr></tfoot>
          </table>

          {/* Gesamtsumme */}
          <div className="mt-3 flex justify-end">
            <div className="bg-s112-text text-white px-4 py-2 rounded-lg text-sm font-semibold">
              Gesamtbestand: {fmtNum(bestand.summe.gesamtHl, HL_STELLEN_BESTAND)} hl
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
