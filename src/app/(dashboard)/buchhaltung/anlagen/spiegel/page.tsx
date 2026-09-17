import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { fmtEur, fmtNum } from '@/lib/format'
import { afaSatzProzent, anlagenspiegelZeilen } from '@/lib/ea/anlagen'
import { DashHeader, fmtDate } from '@/app/(dashboard)/dashboard/_shared/ui'
import { getCtx, ladeEinstellungen, type R } from '@/app/(dashboard)/dashboard/_shared/data'
import JahrWaehler from '../JahrWaehler'
import DruckenKnopf from '../DruckenKnopf'
import { ladeAnlagen, anlagenJahre, kontoText } from '../daten'

export const metadata: Metadata = { title: 'Anlagenspiegel – software:112' }
export const dynamic = 'force-dynamic'

// ── Anlagenspiegel – /buchhaltung/anlagen/spiegel?jahr= (Migration 200) ──────
// Druckbare Aufstellung je Jahr: Buchwert 1.1., Zugänge, Abgänge, AfA,
// kumulierte AfA und Buchwert 31.12. je Anlage mit Zwischensummen je Gruppe -
// Beilage zur E&A-Rechnung bzw. für den Steuerberater (Doppik).

const METHODE: Record<string, string> = { linear: 'linear', degressiv: 'degressiv', gwg: 'GWG' }
const eur = (n: number) => (n === 0 ? '–' : fmtEur(n))
type Zeile = ReturnType<typeof anlagenspiegelZeilen>['zeilen'][number]
type Feld = 'buchwertAnfang' | 'zugang' | 'abgang' | 'afa' | 'kumulierteAfa' | 'buchwertEnde'
const summiere = (rows: Zeile[], k: Feld) => Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100

export default async function AnlagenspiegelPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  if (!einst.modulEa) redirect('/dashboard')

  const [anlagen, { data: bRaw }] = await Promise.all([
    ladeAnlagen(ctx),
    ctx.tf(ctx.q('tenant_einstellungen').select('betrieb_uid, betrieb_betriebsnummer')).maybeSingle(),
  ])
  const betrieb = (bRaw ?? {}) as R
  const aktJahr = ctx.heute.getFullYear()
  const { jahr: jahrParam } = await searchParams
  const jahre = anlagenJahre(anlagen, aktJahr)
  const jahr = jahre.includes(Number(jahrParam)) ? Number(jahrParam) : aktJahr
  const { zeilen, summe } = anlagenspiegelZeilen(anlagen, jahr)
  const erstellt = ctx.heute.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' })

  const gruppen = new Map<string, Zeile[]>()
  for (const z of zeilen) {
    const g = z.anlage.gruppe?.trim() || 'Ohne Gruppe'
    gruppen.set(g, [...(gruppen.get(g) ?? []), z])
  }

  const th = 'px-2 py-2 text-left font-mono text-[10.5px] font-semibold tracking-[.06em] uppercase text-s112-tertiary border-b border-s112-line-str whitespace-nowrap print:text-[8.5px] print:px-1.5'
  const thNum = th + ' text-right'
  const td = 'px-2 py-1.5 text-[12.5px] text-s112-text border-b border-s112-line align-top print:text-[9.5px] print:px-1.5 print:py-1'
  const tdNum = td + ' font-mono text-right whitespace-nowrap tabular-nums'
  const tdSum = 'px-2 py-2 text-[12.5px] font-semibold text-s112-text border-t border-s112-text print:text-[9.5px] print:px-1.5'
  const tdSumNum = tdSum + ' font-mono text-right whitespace-nowrap tabular-nums'
  const tdZw = 'px-2 py-1.5 text-[11.5px] font-semibold text-s112-text-1 bg-s112-bg border-b border-s112-line-str print:text-[9px] print:px-1.5'

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
            </div>
          }
        />
      </div>

      {/* Kopf im Druck */}
      <div className="hidden print:block">
        <h1 className="font-display text-[18px] font-semibold text-s112-text">Anlagenspiegel {jahr}</h1>
        <div className="flex items-baseline justify-between text-[10px] text-s112-text-2 mt-1">
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
                  <td className={tdSum} colSpan={4}>Summe {jahr} · {summe.anzahlAktiv} {summe.anzahlAktiv === 1 ? 'Anlage' : 'Anlagen'} im Bestand</td>
                  <td className={tdSumNum}>{fmtEur(summe.anschaffungskosten + summe.abgaenge)}</td>
                  <td className={tdSumNum}>{fmtEur(summiere(zeilen, 'buchwertAnfang'))}</td>
                  <td className={tdSumNum}>{eur(summe.zugaenge)}</td>
                  <td className={tdSumNum}>{eur(summe.abgaenge)}</td>
                  <td className={tdSumNum}>{fmtEur(summe.afaJahr)}</td>
                  <td className={tdSumNum}>{fmtEur(summiere(zeilen, 'kumulierteAfa'))}</td>
                  <td className={tdSumNum}>{fmtEur(summe.buchwertEnde)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {summe.abgaenge > 0 && (
            <p className="text-[12px] text-s112-text-2 print:text-[9.5px]">
              Abgänge {jahr}: Restbuchwert zum Abgang <span className="font-mono">{fmtEur(summe.restbuchwertAbgaenge)}</span>
              {summe.veraeusserungserloese > 0 && <> · Veräußerungserlöse netto <span className="font-mono">{fmtEur(summe.veraeusserungserloese)}</span></>}
              {' '}· Buchgewinn/-verlust <span className="font-mono">{fmtEur(Math.round((summe.veraeusserungserloese - summe.restbuchwertAbgaenge) * 100) / 100)}</span>
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

function GruppenBlock({ gruppe, rows, mehrereGruppen, td, tdNum, tdZw }: { gruppe: string; rows: Zeile[]; mehrereGruppen: boolean; td: string; tdNum: string; tdZw: string }) {
  return (
    <>
      {mehrereGruppen && <tr><td className={tdZw} colSpan={11}>{gruppe}</td></tr>}
      {rows.map(z => {
        const a = z.anlage
        return (
          <tr key={a.id} className={z.abgegangen ? 'text-s112-tertiary' : ''}>
            <td className={td}>
              <span className="font-medium">{a.name}</span>
              {z.abgegangen && <span className="block text-[11px] text-s112-tertiary">Abgang {fmtDate(a.abgang_am)}{z.erloes > 0 ? ` · Erlös ${fmtEur(z.erloes)}` : ''}</span>}
            </td>
            <td className={td + ' font-mono'}>{kontoText(a.konto_nr)}</td>
            <td className={td + ' font-mono whitespace-nowrap'}>{fmtDate(a.anschaffung_am)}</td>
            <td className={td + ' whitespace-nowrap'}>
              {a.methode === 'gwg' ? 'GWG' : `${a.nutzungsdauer_jahre} J. · ${METHODE[a.methode]}`}
              <span className="font-mono text-s112-tertiary"> {fmtNum(afaSatzProzent(a), { max: 2 })} %</span>
            </td>
            <td className={tdNum}>{fmtEur(a.ak_netto)}</td>
            <td className={tdNum}>{eur(z.buchwertAnfang)}</td>
            <td className={tdNum}>{eur(z.zugang)}</td>
            <td className={tdNum}>{eur(z.abgang)}</td>
            <td className={tdNum}>{z.afa > 0 ? <>{fmtEur(z.afa)}{z.halb && <span className="text-s112-tertiary" title="Halbjahresregel"> ½</span>}</> : '–'}</td>
            <td className={tdNum}>{fmtEur(z.kumulierteAfa)}</td>
            <td className={tdNum + ' font-semibold'}>{fmtEur(z.buchwertEnde)}</td>
          </tr>
        )
      })}
      {mehrereGruppen && (
        <tr className="bg-s112-bg/60">
          <td className={td + ' text-[11.5px] text-s112-text-2 italic'} colSpan={4}>Zwischensumme {gruppe}</td>
          <td className={tdNum + ' text-s112-text-2'}>{fmtEur(rows.reduce((s, r) => s + r.anlage.ak_netto, 0))}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(summiere(rows, 'buchwertAnfang'))}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(summiere(rows, 'zugang'))}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(summiere(rows, 'abgang'))}</td>
          <td className={tdNum + ' text-s112-text-2'}>{eur(summiere(rows, 'afa'))}</td>
          <td className={tdNum + ' text-s112-text-2'}>{fmtEur(summiere(rows, 'kumulierteAfa'))}</td>
          <td className={tdNum + ' text-s112-text-2'}>{fmtEur(summiere(rows, 'buchwertEnde'))}</td>
        </tr>
      )}
    </>
  )
}
