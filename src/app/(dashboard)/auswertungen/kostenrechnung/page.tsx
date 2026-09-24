'use client'
import { useState, useEffect } from 'react'
import Link from '@/components/ui/Link'
import { fmtEur } from '@/lib/format'
import { exportCSV as csvExportieren } from '@/lib/utils/csv'
import { csvDateiname, runden } from '@/lib/csv'

type Eintrag = {
  betrag: number; periode: string | null; objekt_typ: string | null
  kostenstelle: { name: string } | null; kostenart: { name: string } | null
  wg: { name: string } | null; behaelter: { name: string } | null
}
type Split = { kosteneintrag_id: string; betrag_anteil: number; wg: { name: string } | null }

function eur(n: number) { return fmtEur(n) }
function sumBy<T>(arr: T[], key: (t: T) => string, val: (t: T) => number) {
  const m: Record<string, number> = {}
  arr.forEach(t => { const k = key(t); m[k] = (m[k] || 0) + val(t) })
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}

// CSV im Standard EXCEL_AT über lib/utils/csv (→ lib/csv, 24.09.2026): Semikolon, UTF-8 mit
// BOM, CRLF, Betrag als Zahl mit Dezimalkomma, Formelschutz für Text. Vorher eigener Serializer.
function exportCSV(jahr: string, daten: Eintrag[]) {
  csvExportieren(
    daten.map(e => ({
      periode:      e.periode ?? null,
      kostenstelle: e.kostenstelle?.name ?? null,
      kostenart:    e.kostenart?.name ?? null,
      ried:         e.wg?.name ?? null,
      behaelter:    e.behaelter?.name ?? null,
      betrag:       runden(Number(e.betrag), 2),
    })),
    [
      { key: 'periode',      header: 'Periode',      typ: 'text' },
      { key: 'kostenstelle', header: 'Kostenstelle', typ: 'text' },
      { key: 'kostenart',    header: 'Kostenart',    typ: 'text' },
      { key: 'ried',         header: 'Ried',         typ: 'text' },
      { key: 'behaelter',    header: 'Behälter',     typ: 'text' },
      { key: 'betrag',       header: 'Betrag (€)',   typ: 'betrag' },
    ],
    csvDateiname(['Kostenauswertung', jahr]).utf8,
  )
}

export default function KostenAuswertungPage() {
  const [jahr, setJahr] = useState(new Date().getFullYear().toString())
  const [daten, setDaten] = useState<Eintrag[]>([])
  const [splits, setSplits] = useState<Split[]>([])

  async function laden(j: string) {
    const d = await fetch(`/api/kostenrechnung?action=auswertung&jahr=${j}`).then(r => r.json())
    setDaten(d.eintraege ?? [])
    setSplits(d.splits ?? [])
  }

  useEffect(() => { laden(jahr) }, [])

  const gesamt = daten.reduce((s, e) => s + e.betrag, 0)
  const monate = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5 print:p-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
        <Link href="/reports" className="hover:text-s112-blue-700 transition-colors">Auswertungen</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Kosten-Auswertung</span>
      </div>

      <div className="flex items-center justify-between print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Kosten-Auswertung</h1>
          <p className="text-sm text-s112-muted mt-0.5">Jahresübersicht nach Kostenstelle, Kostenart und Weingarten</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={jahr} onChange={e => { setJahr(e.target.value); laden(e.target.value) }}
            className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {[2026,2025,2024,2023].map(y => <option key={y}>{y}</option>)}
          </select>
          <button onClick={() => exportCSV(jahr, daten)}
            className="text-sm border border-s112-border px-4 py-1.5 rounded-lg hover:bg-s112-bg flex items-center gap-2">
            CSV exportieren
          </button>
          <button onClick={() => window.print()}
            className="text-sm border border-s112-border px-4 py-1.5 rounded-lg hover:bg-s112-bg flex items-center gap-2">
            Drucken / PDF
          </button>
        </div>
      </div>

      {/* Druckkopf */}
      <div className="hidden print:block mb-6">
        <h1 className="text-2xl font-semibold">Kosten-Auswertung {jahr}</h1>
        <p className="text-sm text-s112-text-2">Gesamt: {eur(gesamt)}</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        {[
          ['Gesamtkosten', eur(gesamt), 'text-s112-text'],
          ['Kostenstellen', String(new Set(daten.map(e=>e.kostenstelle?.name).filter(Boolean)).size), 'text-s112-blue-700'],
          ['Buchungen', String(daten.length), 'text-s112-blue-700'],
        ].map(([label, val, cls]) => (
          <div key={label} className="bg-white rounded-xl border border-s112-border p-4 text-center">
            <p className="text-xs text-s112-muted mb-1">{label}</p>
            <p className={`text-2xl font-semibold ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      {/* Drei Kacheln */}
      <div className="grid grid-cols-3 gap-4">
        {([
          ['Nach Kostenstelle', (e: Eintrag) => e.kostenstelle?.name ?? '(keine)', (e: Eintrag) => e.betrag] as const,
          ['Nach Kostenart',    (e: Eintrag) => e.kostenart?.name    ?? '(keine)', (e: Eintrag) => e.betrag] as const,
        ]).map(([title, kFn, vFn]) => (
          <div key={title} className="bg-white rounded-xl border border-s112-border p-4">
            <h3 className="text-sm font-semibold text-s112-text mb-3 pb-2 border-b border-s112-border">{title}</h3>
            {sumBy(daten, kFn, vFn).map(([n, s]) => (
              <div key={n} className="flex justify-between text-sm mb-2">
                <span className="text-s112-text-2 truncate mr-2">{n}</span>
                <span className="font-medium tabular-nums flex-shrink-0">{eur(s)}</span>
              </div>
            ))}
            {daten.length === 0 && <p className="text-xs text-s112-muted">Keine Daten</p>}
          </div>
        ))}

        {/* Nach Weingarten */}
        <div className="bg-white rounded-xl border border-s112-border p-4">
          <h3 className="text-sm font-semibold text-s112-text mb-3 pb-2 border-b border-s112-border">Nach Ried</h3>
          {(() => {
            const m: Record<string, number> = {}
            splits.forEach(s => { const n = s.wg?.name ?? '?'; m[n] = (m[n]||0) + (s.betrag_anteil ?? 0) })
            const ohneSplit = daten.filter(e => e.objekt_typ === 'weingarten')
            if (ohneSplit.length > 0) m['Alle WG'] = (m['Alle WG']||0) + ohneSplit.reduce((s,e)=>s+e.betrag,0)
            return Object.entries(m).sort((a,b)=>b[1]-a[1]).map(([n,s]) => (
              <div key={n} className="flex justify-between text-sm mb-2">
                <span className="text-s112-text-2 truncate mr-2">{n}</span>
                <span className="font-medium tabular-nums flex-shrink-0">{eur(s)}</span>
              </div>
            ))
          })()}
          {splits.length === 0 && daten.filter(e=>e.objekt_typ==='weingarten').length === 0 && <p className="text-xs text-s112-muted">Keine Daten</p>}
        </div>
      </div>

      {/* Monatsverlauf */}
      <div className="bg-white rounded-xl border border-s112-border p-5">
        <h3 className="text-sm font-semibold text-s112-text mb-4">Monatsverlauf {jahr}</h3>
        <div className="grid grid-cols-12 gap-2">
          {Array.from({length:12},(_,i)=>{
            const m = String(i+1).padStart(2,'0')
            const per = `${jahr}-${m}`
            const sum = daten.filter(e=>e.periode===per).reduce((s,e)=>s+e.betrag,0)
            const max = Math.max(...Array.from({length:12},(_,j)=>daten.filter(e=>e.periode===`${jahr}-${String(j+1).padStart(2,'0')}`).reduce((s,e)=>s+e.betrag,0)),1)
            const pct = Math.round((sum/max)*100)
            return (
              <div key={m} className="flex flex-col items-center gap-1">
                <div className="w-full bg-s112-bg rounded h-24 flex items-end">
                  <div className="w-full bg-s112-teal rounded transition-all" style={{height:`${pct}%`}} title={eur(sum)} />
                </div>
                <span className="text-[11px] text-s112-muted">{monate[i]}</span>
                {sum > 0 && <span className="text-[11px] font-medium text-s112-text-1">{sum >= 1000 ? `${(sum/1000).toFixed(1)}k` : Math.round(sum)}</span>}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
