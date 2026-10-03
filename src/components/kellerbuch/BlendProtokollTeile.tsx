// Gemeinsame Bausteine der Blend-Protokoll-Druckseiten (Charge und Füllung) – KAN-77 (03.10.2026):
// Herkunftstabelle mit Liter-Spalte und Summenzeile (Σ Liter = Bezugsmenge, Größter-Rest-Verteilung in
// lib/behoerden/blend.ts), Hinweise der Mischungsrechnung (auch im Druck) und die Verschnitt- und Umzugsschritte.
import { AlertTriangle } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { herkunftLabel, type BlendZeile } from '@/lib/behoerden/blend'
import { schrittStelleText, type BlendSchritt, type SchrittStelle } from '@/lib/behoerden/blendSchritte'
import type { KompositionUrsprung } from '@/lib/wein/blendKomposition'

const TH = 'py-2 font-semibold text-s112-text-2 text-xs uppercase tracking-wide'

/** Hinweise als Liste (auch im Druck – sie gehören zum Nachweis) */
export function BlendHinweise({ warnungen }: { warnungen: readonly string[] }) {
  if (warnungen.length === 0) return null
  return (
    <>
      {warnungen.map((w, i) => (
        <p key={i} className="text-sm text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
          <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{w}</span>
        </p>
      ))}
    </>
  )
}

/** Herkunftsanteile mit enthaltenen Litern – `zeilen` stammen aus blendZeilen() (gleiche Reihenfolge) */
export function BlendHerkunftTabelle({ komposition, zeilen, bezugLiter }: {
  komposition: readonly KompositionUrsprung[]; zeilen: readonly BlendZeile[]; bezugLiter: number | null
}) {
  const summeLiter = zeilen.reduce((s, z) => s + (z.mengeLiter ?? 0), 0)
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-s112-border text-left">
          <th scope="col" className={TH}>Herkunft</th>
          <th scope="col" className={TH}>Rebsorte</th>
          <th scope="col" className={TH}>Jahrgang</th>
          <th scope="col" className={`${TH} text-right`}>Liter</th>
          <th scope="col" className={`${TH} text-right`}>Anteil</th>
        </tr>
      </thead>
      <tbody>
        {komposition.map((u, i) => (
          <tr key={u.key} className="border-b border-s112-border/60 last:border-0">
            <td className="py-2 text-s112-text">{herkunftLabel(u)}</td>
            <td className="py-2 text-s112-text-2">{formatRebsorteMitKuerzel(u.rebsorte)}</td>
            <td className="py-2 text-s112-text-2">{u.jahrgang ?? '–'}</td>
            <td className="py-2 text-s112-text-2 text-right tabular-nums whitespace-nowrap">
              {zeilen[i]?.mengeLiter != null ? `${fmtNum(zeilen[i].mengeLiter as number, 2)} L` : '–'}
            </td>
            <td className="py-2 text-s112-text font-semibold text-right tabular-nums whitespace-nowrap">
              {fmtNum(u.anteil_pct, 1)} %
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="border-t border-s112-border">
          <th scope="row" colSpan={3} className="pt-2 text-xs text-s112-text-2 font-semibold text-left">Summe</th>
          <td className="pt-2 text-xs text-s112-text-2 font-semibold text-right tabular-nums whitespace-nowrap">
            {bezugLiter != null ? `${fmtNum(Math.round(summeLiter * 100) / 100, 2)} L` : '–'}
          </td>
          <td className="pt-2 text-xs text-s112-text-2 font-semibold text-right tabular-nums whitespace-nowrap">
            {fmtNum(komposition.reduce((s, u) => s + u.anteil_pct, 0), 1)} %
          </td>
        </tr>
      </tfoot>
    </table>
  )
}

function stellen(liste: readonly SchrittStelle[]): string {
  return liste.map(s => `${schrittStelleText(s)}${s.liter != null ? ` · ${fmtNum(s.liter, 2)} L` : ''}`).join(', ') || '–'
}

const ttmmjjjj = (d: string) => (d ? d.split('-').reverse().join('.') : '–')

/** Verschnitt- und Umzugsschritte (Zuflussmengen) */
export function BlendSchritteTabelle({ schritte, bis }: { schritte: readonly BlendSchritt[]; bis: 'stichtag' | 'abfuellung' | null }) {
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold text-s112-text">Verschnitt- und Umzugsschritte</h2>
      <p className="text-xs text-s112-text-2">
        Die Herkunftstabelle oben zeigt die enthaltenen Liter je Herkunft (bezogen auf die Bezugsmenge); hier stehen
        die bewegten Zuflussmengen (brutto, Schwund, netto). Nach Füllungen, Verkäufen oder Schwund enthält eine
        Herkunft weniger, als einst zufloss.
        {bis === 'stichtag' && ' Nur Schritte bis zum Stichtag.'}
        {bis === 'abfuellung' && ' Nur Schritte bis zur Abfüllung.'}
      </p>
      {schritte.length === 0 ? (
        <p className="text-sm text-s112-muted">Keine Umzüge oder Verschnitte erfasst.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border text-left">
              <th scope="col" className={TH}>Datum</th>
              <th scope="col" className={TH}>Vorgang</th>
              <th scope="col" className={TH}>Von → Nach</th>
              <th scope="col" className={`${TH} text-right`}>Brutto</th>
              <th scope="col" className={`${TH} text-right`}>Schwund</th>
              <th scope="col" className={`${TH} text-right`}>Netto</th>
            </tr>
          </thead>
          <tbody>
            {schritte.map(s => (
              <tr key={s.id} className="border-b border-s112-border/60 last:border-0 align-top">
                <td className="py-2 text-s112-text-2 tabular-nums whitespace-nowrap">{ttmmjjjj(s.datum)}</td>
                <td className="py-2 text-s112-text">{s.vorgang}</td>
                <td className="py-2 text-s112-text-2">{stellen(s.von)} → {stellen(s.nach)}</td>
                <td className="py-2 text-s112-text-2 text-right tabular-nums whitespace-nowrap">{fmtNum(s.bruttoLiter, 2)} L</td>
                <td className="py-2 text-s112-text-2 text-right tabular-nums whitespace-nowrap">{s.schwundLiter > 0 ? `${fmtNum(s.schwundLiter, 2)} L` : '–'}</td>
                <td className="py-2 text-s112-text font-semibold text-right tabular-nums whitespace-nowrap">{fmtNum(s.nettoLiter, 2)} L</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
