// ── Bestandsmeldung im Aufbau des BKI-Formulars (KAN-473) ───────────────────────────────────────────────────────────
//
// Neun Spalten und die Zeilen des Formulars in ganzen Litern; darunter die Abstimmzeile „Sonstige Veränderungen“,
// Konzentrate (§ 29 Abs. 3 WG), Beitragserklärung und das Ankreuzfeld zur Anreicherung. Ohne Hooks (Server-Komponente).
// Die Werte kommen fertig gerundet aus bsmFormular() – dieselben wie in der CSV.

import { BSM_FORMULAR_SPALTEN, type BsmFormular, type BsmFormularZeile } from '@/lib/behoerden/bsmFormular'
import { fmtNum } from '@/lib/format'

const zahl = (n: number) => (n === 0 ? '' : fmtNum(n, 0))
const zelle = 'px-2 py-1 border border-s112-line text-right tabular-nums whitespace-nowrap'

function Zeile({ z, gruppe }: { z: BsmFormularZeile; gruppe?: string }) {
  const summe = z.key.startsWith('summe_') || z.key === 'bestand_neu'
  return (
    <tr className={summe ? 'bg-s112-bg font-semibold' : z.key === 'sonstige_veraenderung' ? 'text-s112-text-2 italic' : ''}>
      <th scope="row" className="px-2 py-1 border border-s112-line text-left font-[inherit]">
        {gruppe && <span className="sr-only">{gruppe}: </span>}{z.bezeichnung}
      </th>
      {BSM_FORMULAR_SPALTEN.map(s => <td key={s.key} className={zelle}>{zahl(z.werte[s.key])}</td>)}
      <td className={`${zelle} font-semibold`}>{zahl(z.summe)}</td>
    </tr>
  )
}

export default function BsmFormularTabelle({ formular, konzentrate, stichtag }: {
  formular: BsmFormular
  /** Bestände an konzentriertem Traubenmost (KTM) und rektifiziertem konzentriertem Traubenmost (RTK) aus dem Stoffkonto */
  konzentrate: readonly { art: string; bestand: number; einheit: string }[]
  stichtag: string
}) {
  const je = (abschnitt: string) => formular.zeilen.filter(z => z.abschnitt === abschnitt)
  const bestand = je('Bestand')
  const konzentrat = (art: RegExp) => {
    const k = konzentrate.filter(x => art.test(x.art))
    return k.length === 0 ? '–' : k.map(x => `${fmtNum(x.bestand, { max: 3 })} ${x.einheit}`).join(' + ')
  }
  return (
    <div className="text-xs">
      <div className="overflow-x-auto print:overflow-visible">
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-[#F2F3F5]">
              <th scope="col" className="px-2 py-1.5 border border-s112-line-str text-left align-bottom font-semibold">in Liter</th>
              {BSM_FORMULAR_SPALTEN.map(s => <th key={s.key} scope="col" className="px-2 py-1.5 border border-s112-line-str text-right align-bottom font-semibold max-w-[7.5rem]">{s.label}</th>)}
              <th scope="col" className="px-2 py-1.5 border border-s112-line-str text-right align-bottom font-semibold">Summe</th>
            </tr>
          </thead>
          <tbody>
            {bestand.filter(z => z.key === 'bestand_alt').map(z => <Zeile key={z.key} z={z} />)}
            <tr><th scope="rowgroup" colSpan={BSM_FORMULAR_SPALTEN.length + 2} className="px-2 py-1 border border-s112-line text-left font-semibold uppercase tracking-[.04em] text-s112-text-2">Zugang in Liter</th></tr>
            {je('Zugang').map(z => <Zeile key={z.key} z={z} gruppe="Zugang" />)}
            <tr><th scope="rowgroup" colSpan={BSM_FORMULAR_SPALTEN.length + 2} className="px-2 py-1 border border-s112-line text-left font-semibold uppercase tracking-[.04em] text-s112-text-2">Abgang in Liter</th></tr>
            {je('Abgang').map(z => <Zeile key={z.key} z={z} gruppe="Abgang" />)}
            {je('Abstimmung').map(z => <Zeile key={z.key} z={z} />)}
            {bestand.filter(z => z.key !== 'bestand_alt').map(z => <Zeile key={z.key} z={z} />)}
          </tbody>
        </table>
      </div>

      <div className="mt-3 grid grid-cols-1 md:grid-cols-2 print:grid-cols-2 gap-x-8 gap-y-2">
        <p>
          <span className="font-semibold">Bestand an konzentriertem Traubenmost</span> zum {stichtag}: <span className="tabular-nums">{konzentrat(/KTM|^konzentriert/i)}</span>
          <br />
          <span className="font-semibold">Bestand an rektifiziertem konz. Traubenmost</span>: <span className="tabular-nums">{konzentrat(/RTK|rektifiziert/i)}</span>
        </p>
        <p className="md:text-right print:text-right">
          <span className="font-semibold">Beitragserklärung gem. §§ 21a ff AMA-Gesetz</span> (nur für verkaufte Mengen über 3.000 Liter)
          <br />
          Beitragspflichtige Menge: <span className="tabular-nums font-medium">{formular.beitrag.pflichtig ? `${fmtNum(formular.beitrag.mengeLiter, 0)} l` : '–'}</span>
          {' · '}Den Beitrag setzt die AMA nach der Einreichung fest.
        </p>
      </div>
      <p className="mt-2 inline-flex items-center gap-1.5 text-s112-text-2">
        <span aria-hidden="true" className="inline-block w-3.5 h-3.5 border border-s112-text" />
        Beabsichtigte Anreicherung bei der nächsten Ernte<span className="sr-only"> (am Ausdruck ankreuzen)</span>
      </p>
    </div>
  )
}
