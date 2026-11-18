// ── Weinerntemeldung im Aufbau des BKI-Formulars „Erntemeldung“ (KAN-472) ───────────────────────────────────────────
//
// Zeilen je Rebsorte und Qualitätsstufe mit „Selbsteingefüllter Wein in Liter“, „Verkaufte Trauben (kg × 0,75 = Liter)“
// und „Summe in Liter“; darunter Flächen in ha/ar, Summen und die Beitragserklärung gem. §§ 21a ff AMA-Gesetz.
// Ohne Hooks (Server-Komponente). Die Werte kommen fertig gerundet aus ernteFormular() – dieselben wie in der CSV.

import type { ErnteFormular } from '@/lib/behoerden/erntemeldungFormular'
import { fmtNum } from '@/lib/format'

const liter = (n: number) => (n === 0 ? '' : fmtNum(n, 0))
const zelle = 'px-3 py-1.5 border border-s112-line'
const kopf = 'px-3 py-2 border border-s112-line-str font-semibold align-bottom'

function HaArFeld({ wert }: { wert: { ha: number; ar: number } }) {
  return <span className="tabular-nums whitespace-nowrap font-medium">{wert.ha} ha {String(wert.ar).padStart(2, '0')} ar</span>
}

function Ankreuzfeld({ an, text }: { an: boolean; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span aria-hidden="true" className="inline-flex items-center justify-center w-3.5 h-3.5 border border-s112-text text-[10px] leading-none">{an ? '✕' : ''}</span>
      {text}<span className="sr-only">: {an ? 'ja' : 'nein'}</span>
    </span>
  )
}

export default function ErntemeldungFormular({ formular, biobetrieb, suessung = false, entsaeuerung = false }: {
  formular: ErnteFormular; biobetrieb: boolean
  /** KAN-472 Teil 2: am Jahrgang gespeicherte Ankreuzfelder der Meldung */
  suessung?: boolean; entsaeuerung?: boolean
}) {
  const oben = formular.zeilen.filter(z => z.block === 'rlqp')
  return (
    <div className="text-sm">
      <div className="flex items-center justify-between gap-4 mb-2">
        <p className="font-semibold text-s112-text">Ernte von Rebsorten-, Land-, Qualitäts- und Prädikatswein</p>
        <Ankreuzfeld an={formular.leer} text="Keine Ernte = Leermeldung" />
      </div>
      <table className="w-full border-collapse mb-4">
        <thead>
          <tr className="bg-[#F2F3F5]">
            <th scope="col" className={`${kopf} text-left`}>Traubensorte(n)</th>
            <th scope="col" className={`${kopf} text-left`}>Qualitätsstufe</th>
            <th scope="col" className={`${kopf} text-right`}>Selbsteingefüllter Wein<br />in Liter</th>
            <th scope="col" className={`${kopf} text-right`}>Verkaufte Trauben<br /><span className="font-normal">(kg × 0,75 = Liter)</span> in Liter</th>
            <th scope="col" className={`${kopf} text-right`}>Summe in Liter</th>
          </tr>
        </thead>
        <tbody>
          {oben.length === 0 ? (
            <tr><td colSpan={5} className={`${zelle} py-4 text-center text-s112-tertiary italic`}>Keine Ernte von Rebsorten-, Land-, Qualitäts- und Prädikatswein bis zum Stichtag</td></tr>
          ) : oben.map((z, i) => (
            <tr key={i}>
              <td className={`${zelle} font-medium`}>{z.kuerzel ?? z.rebsorte}{z.kuerzel && <span className="text-xs font-normal text-s112-tertiary"> · {z.rebsorte}</span>}</td>
              <td className={zelle}>{z.stufeKuerzel ?? '–'}</td>
              <td className={`${zelle} text-right tabular-nums`}>{liter(z.selbstLiter)}</td>
              <td className={`${zelle} text-right tabular-nums`}>{liter(z.verkauftLiter)}</td>
              <td className={`${zelle} text-right tabular-nums font-medium`}>{fmtNum(z.summeLiter, 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="w-full border-collapse mb-4">
        <tbody>
          <tr>
            <th scope="row" className={`${zelle} text-left font-semibold w-[34%]`}>Fläche für die Errechnung des ha-Höchstertrages für Rebsorten-, Land-, Qualitäts- u. Prädikatswein</th>
            <td className={`${zelle} w-[16%]`}><HaArFeld wert={formular.rlqp.flaeche} /></td>
            <th scope="row" className={`${zelle} text-left font-semibold`}>Summe Erntemenge in Liter an Rebsorten-, Land-, Qualitäts- u. Prädikatswein</th>
            <td className={`${zelle} text-right tabular-nums font-semibold w-[14%]`}>{fmtNum(formular.rlqp.liter, 0)}</td>
          </tr>
          <tr>
            <th scope="row" className={`${zelle} text-left font-semibold`}>Wein (ohne Sorte und Jahrgang) und Sturm</th>
            <td className={zelle}><HaArFeld wert={formular.wein.flaeche} /></td>
            <td className={zelle}>
              Summe Erntemenge in Liter an
              <span className="ml-3">weiß: <span className="tabular-nums font-medium">{fmtNum(formular.wein.weissLiter, 0)}</span></span>
              <span className="ml-3">rot/rosé: <span className="tabular-nums font-medium">{fmtNum(formular.wein.rotLiter, 0)}</span></span>
            </td>
            <td className={`${zelle} text-right tabular-nums font-semibold`}>{fmtNum(formular.wein.liter, 0)}</td>
          </tr>
          <tr>
            <th scope="row" className={`${zelle} text-left font-semibold`}>Sonstige Erzeugnisse (Traubenmost, etc.)</th>
            <td className={zelle}><span className="text-s112-tertiary">ha&nbsp;&nbsp;&nbsp;&nbsp;ar</span></td>
            <td className={zelle} colSpan={2} />
          </tr>
          <tr>
            <th scope="row" className={`${zelle} text-left font-semibold`}>Gesamte bewirtschaftete Fläche des Betriebes</th>
            <td className={zelle}><HaArFeld wert={formular.betrieb} /></td>
            <th scope="row" className={`${zelle} text-left font-semibold`}>Ertragsfähige Fläche des Betriebes</th>
            <td className={`${zelle} text-right`}><HaArFeld wert={formular.betrieb} /></td>
          </tr>
        </tbody>
      </table>

      <table className="w-full border-collapse border-2 border-s112-text mb-3">
        <tbody>
          <tr>
            <th scope="row" className="px-3 py-2 text-left font-semibold w-[40%]">
              Beitragserklärung gem. §§ 21a ff AMA-Gesetz<br />
              <span className="font-normal text-xs">(nur für Erntemengen über 3.000 Liter auszufüllen)</span>
            </th>
            <td className="px-3 py-2">
              <span className="block text-[11px] text-s112-text-2">Beitragspflichtige Menge in Liter</span>
              <span className="tabular-nums font-semibold">{formular.beitrag.pflichtig ? fmtNum(formular.beitrag.mengeLiter, 0) : '–'}</span>
            </td>
            <td className="px-3 py-2 text-xs text-s112-text-2">Den Beitrag setzt die AMA nach der Einreichung fest.</td>
          </tr>
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-s112-text-2">
        <Ankreuzfeld an={suessung} text="beabsichtige Süßung" />
        <Ankreuzfeld an={entsaeuerung} text="beabsichtige Entsäuerung" />
        <Ankreuzfeld an={biobetrieb} text="Biobetrieb" />
      </div>
    </div>
  )
}
