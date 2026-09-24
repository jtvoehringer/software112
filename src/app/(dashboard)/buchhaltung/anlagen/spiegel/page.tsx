// behoerdenmeldung: anlagenverzeichnis
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { fmtEur, fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { anlagenSummen, anlagenverzeichnis, ladeAnlagenverzeichnis, type AnlagenZeile } from '@/lib/behoerden/anlagen'
import { datumText, summe } from '@/lib/behoerden/buchhaltung-gemeinsam'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { DashHeader } from '@/app/(dashboard)/dashboard/_shared/ui'
import { getCtx, ladeEinstellungen, type R } from '@/app/(dashboard)/dashboard/_shared/data'
import JahrWaehler from '../JahrWaehler'
import DruckenKnopf from '../DruckenKnopf'
import { anlagenJahre } from '../daten'

export const metadata: Metadata = { title: 'Anlagenspiegel – software:112' }
export const dynamic = 'force-dynamic'

// ── Anlagenspiegel – /buchhaltung/anlagen/spiegel?jahr= (Migration 200) ──────
// Druckbare Aufstellung je Jahr: Buchwert 1.1., Zugänge, Abgänge, AfA,
// kumulierte AfA und Buchwert 31.12. je Anlage mit Zwischensummen je Gruppe -
// Beilage zur E&A-Rechnung bzw. für den Steuerberater (Doppik).
// Behördenmeldung „anlagenverzeichnis“ (24.09.2026): Zeilen aus ladeAnlagenverzeichnis()
// (lib/behoerden/anlagen.ts) – dieselbe Ladefunktion liefert die CSV; alle Summen
// addieren die gerundeten Zeilenwerte (Ausdruck und CSV stimmen überein).

const eur = (n: number) => (n === 0 ? '–' : fmtEur(n))

export default async function AnlagenspiegelPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  if (!einst.modulEa) redirect('/dashboard')

  const heute = wienHeute()
  const aktJahr = Number(heute.slice(0, 4))
  const { jahr: jahrParam } = await searchParams
  const gewuenscht = Number(jahrParam)
  const [verzeichnis, { data: bRaw }] = await Promise.all([
    ladeAnlagenverzeichnis(ctx.supabase, ctx.tenantId, { jahr: Number.isInteger(gewuenscht) && gewuenscht > 0 ? gewuenscht : aktJahr }),
    ctx.tf(ctx.q('tenant_einstellungen').select('betrieb_uid, betrieb_betriebsnummer')).maybeSingle(),
  ])
  const betrieb = (bRaw ?? {}) as R
  const jahre = anlagenJahre(verzeichnis.anlagen, aktJahr)
  const jahr = jahre.includes(gewuenscht) ? gewuenscht : aktJahr
  // Jahr außerhalb der Auswahl → wie bisher auf das laufende Jahr zurückfallen (gleiche Rechnung, ohne neue Abfrage)
  const { zeilen, summen } = jahr === gewuenscht ? verzeichnis : anlagenverzeichnis(verzeichnis.anlagen, jahr)
  const erstellt = datumText(heute)

  const gruppen = new Map<string, AnlagenZeile[]>()
  for (const z of zeilen) gruppen.set(z.gruppe, [...(gruppen.get(z.gruppe) ?? []), z])

  const th = 'px-2 py-2 text-left font-mono text-[10.5px] font-semibold tracking-[.06em] uppercase text-s112-tertiary border-b border-s112-line-str whitespace-nowrap print:text-[8.5px] print:px-1.5'
  const thNum = th + ' text-right'
  const td = 'px-2 py-1.5 text-[12.5px] text-s112-text border-b border-s112-line align-top print:text-[9.5px] print:px-1.5 print:py-1'
  const tdNum = td + ' font-mono text-right whitespace-nowrap tabular-nums'
  const tdSum = 'px-2 py-2 text-[12.5px] font-semibold text-s112-text border-t border-s112-text print:text-[9.5px] print:px-1.5'
  const tdSumNum = tdSum + ' font-mono text-right whitespace-nowrap tabular-nums'
  const tdZw = 'px-2 py-1.5 text-[11.5px] font-semibold text-s112-text-1 bg-s112-bg border-b border-s112-line-str print:text-[10px] print:px-1.5'

  return (
    <div className="space-y-6 print:space-y-3">
      <style>{`@media print { @page { size: A4 landscape; margin: 12mm 12mm 14mm; } }`}</style>
      <div data-print="hide">
        <DashHeader
          title={`Anlagenspiegel ${jahr}`}
          sub={`${ctx.tenantName ?? ''} · Stichtag 31.12.${jahr} · Anlagenverzeichnis nach § 7 EStG`}
          right={
            <div className="flex items-center gap-2 flex-wrap">
              <Link href={`/buchhaltung/anlagen?jahr=${jahr}`} className="px-3 py-1.5 rounded-lg text-[13px] font-medium text-s112-text-1 border border-s112-line-str bg-white hover:bg-s112-bg">← Zum Verzeichnis</Link>
              <JahrWaehler jahre={jahre} jahr={jahr} basis="/buchhaltung/anlagen/spiegel" />
              <DruckenKnopf />
              <CsvExportKnopf href={csvPfad('anlagenverzeichnis', { jahr })} />
            </div>
          }
        />
      </div>

      {/* Kopf im Druck */}
      <div className="hidden print:block">
        <h1 className="font-display text-[18px] font-semibold text-s112-text">Anlagenspiegel {jahr}</h1>
        <div className="flex items-baseline justify-between text-[11px] text-s112-text-2 mt-1">
          <span>{ctx.tenantName}{betrieb.betrieb_uid ? ` · UID ${betrieb.betrieb_uid}` : ''}{betrieb.betrieb_betriebsnummer ? ` · Betriebsnummer ${betrieb.betrieb_betriebsnummer}` : ''} · Stichtag 31.12.{jahr}</span>
          <span>erstellt am {erstellt} · software:112</span>
        </div>
      </div>

      {zeilen.length === 0 ? (
        <div className="bg-white border border-s112-line rounded-xl p-5 text-[13px] text-s112-text-2">
          Für {jahr} gibt es keine Anlagen im Verzeichnis. <Link href="/buchhaltung/anlagen/neu" className="text-s112-blue-700 hover:underline">Anlage erfassen →</Link>
        </div>
      ) : (
        <>
          <div className="bg-white border border-s112-line rounded-xl overflow-x-auto print:overflow-visible print:border-0 print:rounded-none">
            <table className="w-full min-w-[980px] print:min-w-0 border-collapse">
              <thead>
                <tr>
                  <th className={th}>Anlage</th><th className={th}>Konto</th><th className={th}>Anschaffung</th><th className={th}>ND / Methode</th>
                  <th className={thNum}>AK netto</th><th className={thNum}>Buchwert 1.1.</th><th className={thNum}>Zugang {jahr}</th><th className={thNum}>Abgang {jahr}</th>
                  <th className={thNum}>AfA {jahr}</th><th className={thNum}>kum. AfA</th><th className={thNum}>Buchwert 31.12.</th>
                </tr>
              </thead>
              <tbody>
                {[...gruppen.entries()].map(([gruppe, rows]) => (
                  <GruppenBlock key={gruppe} gruppe={gruppe} rows={rows} mehrereGruppen={gruppen.size > 1} td={td} tdNum={tdNum} tdZw={tdZw} />
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={tdSum} colSpan={4}>Summe {jahr} · {summen.anzahlAktiv} {summen.anzahlAktiv === 1 ? 'Anlage' : 'Anlagen'} im Bestand</td>
                  <td className={tdSumNum}>{fmtEur(summen.akNetto)}</td>
                  <td className={tdSumNum}>{fmtEur(summen.buchwertAnfang)}</td>
                  <td className={tdSumNum}>{eur(summen.zugang)}</td>
                  <td className={tdSumNum}>{eur(summen.abgang)}</td>
                  <td className={tdSumNum}>{fmtEur(summen.afa)}</td>
                  <td className={tdSumNum}>{fmtEur(summen.kumulierteAfa)}</td>
                  <td className={tdSumNum}>{fmtEur(summen.buchwertEnde)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {summen.abgang > 0 && (
            <p className="text-[12px] text-s112-text-2 print:text-[9.5px]">
              Abgänge {jahr}: Restbuchwert zum Abgang <span className="font-mono">{fmtEur(summen.restbuchwertAbgaenge)}</span>
              {summen.erloese > 0 && <> · Veräußerungserlöse netto <span className="font-mono">{fmtEur(summen.erloese)}</span></>}
              {' '}· Buchgewinn/-verlust <span className="font-mono">{fmtEur(summe([summen.erloese, -summen.restbuchwertAbgaenge]))}</span>
            </p>
          )}

          <p className="text-[11px] text-s112-tertiary leading-relaxed print:text-[8.5px]">
            Alle Beträge in Euro, netto. Lineare AfA nach § 7 Abs. 1 EStG; Halbjahresregel (½) nach § 7 Abs. 2 bei Inbetriebnahme bzw.
            Ausscheiden im zweiten bzw. ersten Halbjahr; degressive AfA nach § 7 Abs. 1a (max. 30 % vom Restbuchwert); geringwertige
            Wirtschaftsgüter (GWG) nach § 13 EStG im Anschaffungsjahr voll abgeschrieben. Buchwert 1.1. = Buchwert zum 31.12. des Vorjahres.
            kum. AfA = Anschaffungskosten abzüglich Buchwert 31.12. (bei Abgängen: bis zum Abgang). Erstellt mit software:112 am {erstellt};
            ersetzt keine steuerliche Beratung.
          </p>
        </>
      )}
    </div>
  )
}

function GruppenBlock({ gruppe, rows, mehrereGruppen, td, tdNum, tdZw }: { gruppe: string; rows: AnlagenZeile[]; mehrereGruppen: boolean; td: string; tdNum: string; tdZw: string }) {
  const zw = anlagenSummen(rows)
  return (
    <>
      {mehrereGruppen && <tr><td className={tdZw} colSpan={11}>{gruppe}</td></tr>}
      {rows.map(z => {
        const a = z.anlage
        return (
          <tr key={a.id} className={z.abgegangen ? 'text-s112-tertiary' : ''}>
            <td className={td}>
              <span className="font-medium">{z.bezeichnung}</span>
              {z.abgegangen && <span className="block text-[11px] text-s112-tertiary">Abgang {datumText(z.abgangAm)}{(z.erloes ?? 0) > 0 ? ` · Erlös ${fmtEur(z.erloes ?? 0)}` : ''}</span>}
            </td>
            <td className={td + ' font-mono'}>{z.konto ?? '–'}</td>
            <td className={td + ' font-mono whitespace-nowrap'}>{datumText(z.anschaffung)}</td>
            <td className={td + ' whitespace-nowrap'}>
              {z.gwg ? 'GWG' : `${z.nutzungsdauer} J. · ${z.methode}`}
              <span className="font-mono text-s112-tertiary"> {fmtNum(z.afaSatz, { max: 2 })} %</span>
            </td>
            <td className={tdNum}>{fmtEur(z.akNetto)}</td>
            <td className={tdNum}>{eur(z.buchwertAnfang)}</td>
            <td className={tdNum}>{eur(z.zugang)}</td>
            <td className={tdNum}>{eur(z.abgang)}</td>
            <td className={tdNum}>{z.afa > 0 ? <>{fmtEur(z.afa)}{z.halbjahr && <span className="text-s112-tertiary" title="Halbjahresregel"> ½</span>}</> : '–'}</td>
            <td className={tdNum}>{fmtEur(z.kumulierteAfa)}</td>
            <td className={tdNum + ' font-semibold'}>{fmtEur(z.buchwertEnde)}</td>
          </tr>
        )
      })}
      {mehrereGruppen && (
        <tr className="bg-s112-bg/60">
          <td className={td + ' text-[11.5px] text-s112-text-2 italic'} colSpan={4}>Zwischensumme {gruppe}</td>
          <td className={tdNum + ' text-s112-text-2'}>{fmtEur(zw.akNetto)}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(zw.buchwertAnfang)}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(zw.zugang)}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(zw.abgang)}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(zw.afa)}</td>
          <td className={tdNum + ' text-s112-text-2'}>{fmtEur(zw.kumulierteAfa)}</td>
          <td className={tdNum + ' text-s112-text-2'}>{fmtEur(zw.buchwertEnde)}</td>
        </tr>
      )}
    </>
  )
}
