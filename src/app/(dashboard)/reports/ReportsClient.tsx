'use client'

import { useState } from 'react'
import Link from 'next/link'
import { exportCSV } from '@/lib/utils/csv'
import { BarChart3, Calculator, FileText, Droplet, Sprout } from 'lucide-react'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  umsatzMonate: { monat: string; umsatz: number; anzahl: number; von: string; bis: string }[]
  lager: R[]
  lagerWert: number
  behandlungen: R[]
  cuKgHa: number
  pipeline: R[]
  kontaktFrequenz: { id: string; name: string; kundennummer: string | null; letzterKontakt: string | null; tage: number }[]
  offene: R[]
  heute: string
  vsJahrgaenge: number[]
  vsSorten: string[]
  vsBezeichnungen: string[]
  vsKunden: { id: string; name: string }[]
  vsOrte: string[]
  vsLaender: string[]
  wbJahrgaenge: number[]
  wbSorten: string[]
  wbBezeichnungen: string[]
}

const TABS = [
  { id: 'umsatz',     label: 'Umsatz',         title: 'Monatsumsatz Warenwirtschaft (12 Monate)' },
  { id: 'lager',      label: 'Lager',           title: 'Lagerbestand' },
  { id: 'behandlung', label: 'Behandlungen',    title: 'Behandlungsübersicht ' + new Date().getFullYear() },
  { id: 'pipeline',   label: 'Pipeline',         title: 'Lead-Pipeline' },
  { id: 'kontakt',    label: 'Kontaktfrequenz',  title: 'Tage seit letztem Kontakt' },
  { id: 'offen',      label: 'Offene Posten',    title: 'Unbezahlte Rechnungen' },
  { id: 'behoerden',  label: 'Behörden',          title: 'Behörden-Dokumente' },
  { id: 'besuch',     label: 'Besuchsplanung',    title: 'Besuchsplanung – PLZ-Cluster' },
  { id: 'verkaufsstatistik', label: 'Verkaufsstatistik', title: 'Verkaufsstatistik' },
  { id: 'weinbuecher', label: 'Weinbücher', title: 'Weinbuch-Sammlung' },
] as const
type TabId = typeof TABS[number]['id']

const STUFEN_LABEL: Record<string, string> = {
  neukontakt: 'Neukontakt', interessent: 'Interessent', angebot: 'Angebot',
  verhandlung: 'Verhandlung', abschluss: 'Abschluss', stammkunde: 'Stammkunde',
  verloren: 'Verloren', pause: 'Pause',
}

const ML_LABEL: Record<number, string> = {
  187:'0,187 L',375:'0,375 L',500:'0,500 L',750:'0,75 L',1000:'1,0 L',1500:'1,5 L',3000:'3,0 L',6000:'6,0 L'
}

function eur(n: number) { return n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) }
function eur2(n: number) { return n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }) }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('de-AT') : '–' }

function posSum(p: R): number {
  return ((p.verkauf_positionen ?? []) as R[]).reduce((s: number, pos: R) => {
    const b = (Number(pos.preis_brutto)||0) * (Number(pos.menge)||0)
    return s + b * (1 - (Number(pos.rabatt_pct)||0)/100) * (1 - (Number(pos.sonderrabatt_pct)||0)/100)
  }, 0)
}

function kundenName(p: R) {
  if (p.kontakt) return [p.kontakt.vorname, p.kontakt.nachname].filter(Boolean).join(' ')
  if (p.firma)   return p.firma.name
  return '–'
}

function CsvBtn({ onClick, label = '↓ CSV' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick}
      className="flex items-center gap-1.5 text-xs border border-s112-border text-gray-500 px-2.5 py-1.5 rounded-lg hover:bg-s112-bg transition-colors print:hidden">
      {label}
    </button>
  )
}

export default function ReportsClient({
  umsatzMonate, lager, lagerWert, behandlungen, cuKgHa, pipeline, kontaktFrequenz, offene,
  vsJahrgaenge, vsSorten, vsBezeichnungen, vsKunden, vsOrte, vsLaender,
  wbJahrgaenge, wbSorten, wbBezeichnungen,
}: Props) {
  const [tab, setTab] = useState<TabId>('umsatz')

  // Drill-down: Lager
  const [lagerExpand, setLagerExpand]   = useState<string | null>(null)
  const [lagerBV, setLagerBV]           = useState<R | null>(null)
  const [lagerBVLoading, setLagerBVLoading] = useState(false)

  // Drill-down: Umsatz-Monat
  const [umsatzExpand, setUmsatzExpand] = useState<string | null>(null)
  const [monatDetail, setMonatDetail]   = useState<R[]>([])
  const [monatLoading, setMonatLoading] = useState(false)

  // Umsatz: Zeitraum-Auswahl (Standard = die serverseitig geladenen letzten 12 Monate)
  // und Monatsvergleich (zwei frei wählbare, nicht zwingend zusammenhängende Monate).
  type UmsatzModus = 'standard' | 'benutzerdefiniert' | 'vergleich'
  const [umsatzModus, setUmsatzModus]     = useState<UmsatzModus>('standard')
  const [umsatzData, setUmsatzData]       = useState(umsatzMonate)
  const [umsatzLoading, setUmsatzLoading] = useState(false)
  const [umsatzFehler, setUmsatzFehler]   = useState<string | null>(null)
  const [vonMonat, setVonMonat]           = useState('')
  const [bisMonat, setBisMonat]           = useState('')
  const [vergleichA, setVergleichA]       = useState('')
  const [vergleichB, setVergleichB]       = useState('')
  const [vergleichData, setVergleichData] = useState<{ monat: string; umsatz: number; anzahl: number }[]>([])

  // Verkaufsstatistik
  const [vsJahrgang, setVsJahrgang]         = useState('')
  const [vsSorte, setVsSorte]               = useState('')
  const [vsBezeichnung, setVsBezeichnung]   = useState('')
  const [vsKunde, setVsKunde]               = useState('')
  const [vsPlzVon, setVsPlzVon]             = useState('')
  const [vsPlzBis, setVsPlzBis]             = useState('')
  const [vsOrt, setVsOrt]                   = useState('')
  const [vsLand, setVsLand]                 = useState('')
  const [vsLaden, setVsLaden]               = useState(false)
  const [vsFehler, setVsFehler]             = useState<string | null>(null)
  const [vsResult, setVsResult]             = useState<{ zeilen: R[]; summeMenge: number; summeBetrag: number; anzahl: number } | null>(null)

  // Weinbuch-Sammlung
  const [wbJahrgang, setWbJahrgang]         = useState('')
  const [wbSorte, setWbSorte]               = useState('')
  const [wbBezeichnung, setWbBezeichnung]   = useState('')
  const [wbLaden, setWbLaden]               = useState(false)
  const [wbFehler, setWbFehler]             = useState<string | null>(null)
  const [wbResult, setWbResult]             = useState<{ chargen: R[]; anzahl: number } | null>(null)

  // Besuchsplanung
  const [bOrt, setBOrt]         = useState('')
  const [bSegment, setBSegment] = useState('')
  const [bLeads, setBLeads]     = useState(true)
  const [bKunden, setBKunden]   = useState(true)
  const [bLaden, setBLaden]     = useState(false)
  const [bResult, setBResult]   = useState<{kontakte: R[]; cluster: Record<string, R[]>; anzahl: number; plz_count: number}|null>(null)
  const [bFehler, setBFehler]   = useState<string|null>(null)

  const current    = TABS.find(t => t.id === tab)!
  const maxUmsatz  = Math.max(...umsatzData.map(m => m.umsatz), 1)
  const pipelineAktiv = pipeline.filter(p => !p.erledigt && p.stufe !== 'verloren')
  const offeneSum  = offene.reduce((s, p) => s + posSum(p), 0)

  // ── Umsatz: Zeitraum & Vergleich ────────────────────────────────────────────
  function umsatzLetzte12() {
    setUmsatzData(umsatzMonate)
    setUmsatzModus('standard')
    setUmsatzExpand(null)
    setUmsatzFehler(null)
  }

  async function umsatzZeitraumAnwenden() {
    if (!vonMonat || !bisMonat) return
    setUmsatzLoading(true); setUmsatzFehler(null)
    try {
      const res = await fetch(`/api/reports/umsatz?von=${vonMonat}&bis=${bisMonat}`)
      const json = await res.json()
      if (!res.ok) { setUmsatzFehler(json.fehler ?? 'Fehler beim Laden.'); return }
      setUmsatzData(json.monate ?? [])
      setUmsatzModus('benutzerdefiniert')
      setUmsatzExpand(null)
    } catch { setUmsatzFehler('Fehler beim Laden.') }
    finally { setUmsatzLoading(false) }
  }

  async function umsatzVergleichen() {
    if (!vergleichA || !vergleichB) return
    setUmsatzLoading(true); setUmsatzFehler(null)
    try {
      const res = await fetch(`/api/reports/umsatz?monate=${vergleichA},${vergleichB}`)
      const json = await res.json()
      if (!res.ok) { setUmsatzFehler(json.fehler ?? 'Fehler beim Laden.'); return }
      setVergleichData(json.monate ?? [])
      setUmsatzModus('vergleich')
      setUmsatzExpand(null)
    } catch { setUmsatzFehler('Fehler beim Laden.') }
    finally { setUmsatzLoading(false) }
  }

  // ── Lager Drill-down ──────────────────────────────────────────────────────
  async function toggleLagerDrill(id: string) {
    if (lagerExpand === id) { setLagerExpand(null); setLagerBV(null); return }
    setLagerExpand(id)
    setLagerBVLoading(true)
    setLagerBV(null)
    try {
      const res = await fetch(`/api/reports/fuellung-bv?id=${id}`)
      const json = await res.json()
      setLagerBV(json)
    } catch { setLagerBV({ fehler: 'Ladefehler' }) }
    setLagerBVLoading(false)
  }

  // ── Umsatz Drill-down ─────────────────────────────────────────────────────
  async function toggleUmsatzDrill(monat: string, von: string, bis: string) {
    if (umsatzExpand === monat) { setUmsatzExpand(null); setMonatDetail([]); return }
    setUmsatzExpand(monat)
    setMonatLoading(true)
    setMonatDetail([])
    try {
      const res = await fetch(`/api/reports/umsatz-detail?von=${von}&bis=${bis}`)
      const json = await res.json()
      setMonatDetail(json.posten ?? [])
    } catch { /* silent */ }
    setMonatLoading(false)
  }

  // ── CSV-Exports ───────────────────────────────────────────────────────────
  function csvLager() {
    exportCSV(
      lager.filter(f => f.bestand_flaschen > 0).map(f => ({
        name:        f.name,
        jahrgang:    f.jahrgang ?? '',
        groesse:     ML_LABEL[f.flaschengroesse_ml] ?? `${f.flaschengroesse_ml} ml`,
        bestand:     f.bestand_flaschen,
        einstand:    f.einstandspreis ?? '',
        lagerwert:   f.einstandspreis != null ? f.bestand_flaschen * f.einstandspreis : '',
        vk_preis:    f.vk_preis_brutto ?? '',
      })),
      [
        { key: 'name',      header: 'Wein' },
        { key: 'jahrgang',  header: 'Jahrgang' },
        { key: 'groesse',   header: 'Größe' },
        { key: 'bestand',   header: 'Bestand (Fl.)' },
        { key: 'einstand',  header: 'Einstandspreis (€)' },
        { key: 'lagerwert', header: 'Lagerwert (€)' },
        { key: 'vk_preis',  header: 'VK-Preis (€)' },
      ],
      `lagerbestand_${new Date().toISOString().slice(0,10)}.csv`
    )
  }

  function csvUmsatz() {
    const quelle = umsatzModus === 'vergleich' ? vergleichData : umsatzData
    exportCSV(
      quelle.map(m => ({ monat: m.monat, umsatz: m.umsatz.toFixed(2), anzahl: m.anzahl })),
      [
        { key: 'monat',  header: 'Monat' },
        { key: 'umsatz', header: 'Umsatz (€)' },
        { key: 'anzahl', header: 'Anzahl Verkäufe' },
      ],
      `umsatz_monatsübersicht.csv`
    )
  }

  function csvOffene() {
    exportCSV(
      offene.map(p => ({
        datum:   fmtDate(p.datum),
        rechnung: p.rechnungsnummer ?? '',
        kunde:   kundenName(p),
        betrag:  posSum(p).toFixed(2),
        tage:    Math.floor((new Date().getTime()-new Date(p.datum).getTime())/86400000),
      })),
      [
        { key: 'datum',    header: 'Datum' },
        { key: 'rechnung', header: 'Rechnungsnummer' },
        { key: 'kunde',    header: 'Kunde' },
        { key: 'betrag',   header: 'Betrag (€)' },
        { key: 'tage',     header: 'Tage offen' },
      ],
      `offene_posten_${new Date().toISOString().slice(0,10)}.csv`
    )
  }

  // ── Verkaufsstatistik ─────────────────────────────────────────────────────
  async function ladeVerkaufsstatistik(e?: React.FormEvent) {
    e?.preventDefault()
    setVsLaden(true); setVsFehler(null)
    try {
      const params = new URLSearchParams()
      if (vsJahrgang)    params.set('jahrgang', vsJahrgang)
      if (vsSorte)       params.set('sorte', vsSorte)
      if (vsBezeichnung) params.set('bezeichnung', vsBezeichnung)
      if (vsKunde)       params.set('kunde', vsKunde)
      if (vsPlzVon)      params.set('plzVon', vsPlzVon)
      if (vsPlzBis)      params.set('plzBis', vsPlzBis)
      if (vsOrt)         params.set('ort', vsOrt)
      if (vsLand)        params.set('land', vsLand)
      const res = await fetch(`/api/reports/verkaufsstatistik?${params.toString()}`)
      const json = await res.json()
      if (!res.ok || json.fehler) { setVsFehler(json.fehler ?? 'Fehler beim Laden.'); return }
      setVsResult(json)
    } catch (err) { setVsFehler(String(err)) }
    finally { setVsLaden(false) }
  }

  function vsZuruecksetzen() {
    setVsJahrgang(''); setVsSorte(''); setVsBezeichnung(''); setVsKunde('')
    setVsPlzVon(''); setVsPlzBis(''); setVsOrt(''); setVsLand('')
    setVsResult(null); setVsFehler(null)
  }

  function csvVerkaufsstatistik() {
    if (!vsResult) return
    exportCSV(
      vsResult.zeilen.map(z => ({
        datum:       fmtDate(z.datum),
        rechnung:    z.rechnungsnummer ?? '',
        kunde:       z.kunde,
        ort:         z.ort ?? '',
        plz:         z.plz ?? '',
        land:        z.land ?? '',
        produkt:     z.produkt,
        jahrgang:    z.jahrgang ?? '',
        sorte:       z.sorte ?? '',
        bezeichnung: z.bezeichnung ?? '',
        stk:         z.menge,
        betrag:      z.betrag.toFixed(2),
      })),
      [
        { key: 'datum',       header: 'Datum' },
        { key: 'rechnung',    header: 'Rechnungsnummer' },
        { key: 'kunde',       header: 'Kunde' },
        { key: 'ort',         header: 'Ort' },
        { key: 'plz',         header: 'PLZ' },
        { key: 'land',        header: 'Land' },
        { key: 'produkt',     header: 'Produkt' },
        { key: 'jahrgang',    header: 'Jahrgang' },
        { key: 'sorte',       header: 'Sorte' },
        { key: 'bezeichnung', header: 'Bezeichnung' },
        { key: 'stk',         header: 'Stk' },
        { key: 'betrag',      header: 'Betrag (€)' },
      ],
      `verkaufsstatistik_${new Date().toISOString().slice(0,10)}.csv`
    )
  }

  // ── Weinbuch-Sammlung ─────────────────────────────────────────────────────
  function wbParams() {
    const params = new URLSearchParams()
    if (wbJahrgang)    params.set('jahrgang', wbJahrgang)
    if (wbSorte)       params.set('sorte', wbSorte)
    if (wbBezeichnung) params.set('bezeichnung', wbBezeichnung)
    return params
  }

  async function ladeWeinbuecher(e?: React.FormEvent) {
    e?.preventDefault()
    setWbLaden(true); setWbFehler(null)
    try {
      const res = await fetch(`/api/reports/weinbuecher?${wbParams().toString()}`)
      const json = await res.json()
      if (!res.ok || json.fehler) { setWbFehler(json.fehler ?? 'Fehler beim Laden.'); return }
      setWbResult(json)
    } catch (err) { setWbFehler(String(err)) }
    finally { setWbLaden(false) }
  }

  function wbZuruecksetzen() {
    setWbJahrgang(''); setWbSorte(''); setWbBezeichnung('')
    setWbResult(null); setWbFehler(null)
  }

  // ── Besuchsplanung ────────────────────────────────────────────────────────
  async function ladeBesuch(e: React.FormEvent) {
    e.preventDefault()
    setBLaden(true); setBFehler(null); setBResult(null)
    try {
      const res = await fetch('/api/besuchsplanung', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ort_filter: bOrt, segment: bSegment || null, include_leads: bLeads, include_kunden: bKunden }),
      })
      const json = await res.json()
      if (!res.ok || json.fehler) { setBFehler(json.fehler ?? 'Fehler'); return }
      setBResult(json)
    } catch (err) { setBFehler(String(err)) }
    finally { setBLaden(false) }
  }

  function googleMapsUrl(kontakte: R[]): string {
    const adressen = kontakte.filter(k => k.ort || k.plz).map(k => {
      const teile = [k.strasse, [k.plz, k.ort].filter(Boolean).join(' '), 'Österreich'].filter(Boolean)
      return teile.join(', ')
    }).slice(0, 10)
    if (adressen.length === 0) return ''
    const segmente = adressen.map(a => encodeURIComponent(a)).join('/')
    return `https://www.google.com/maps/dir//${segmente}`
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Auswertungen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Betriebsauswertungen · automatisch aktualisiert</p>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 border border-s112-border text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors print:hidden">
          Drucken
        </button>
      </div>

      {/* Weitere Auswertungen */}
      <div className="grid grid-cols-2 gap-4 print:hidden">
        <a href="/reports/keller"
          className="card p-5 hover:border-s112-teal hover:shadow-md transition-all group flex flex-col gap-2">
          <BarChart3 className="w-8 h-8 text-s112-teal" strokeWidth={1.75} />
          <p className="font-semibold text-gray-900 group-hover:text-s112-teal">Keller-Auswertungen</p>
          <p className="text-xs text-gray-500 leading-relaxed">Behälter-Auslastung, Chargen, Kellerbehandlungen, Umzüge & Filtrationen</p>
          <p className="text-xs text-s112-teal font-medium mt-auto">Öffnen →</p>
        </a>
        <a href="/auswertungen/kostenrechnung"
          className="card p-5 hover:border-s112-teal hover:shadow-md transition-all group flex flex-col gap-2">
          <Calculator className="w-8 h-8 text-s112-teal" strokeWidth={1.75} />
          <p className="font-semibold text-gray-900 group-hover:text-s112-teal">Kosten-Auswertung</p>
          <p className="text-xs text-gray-500 leading-relaxed">Kostenstellen, Kostenarten, Buchungsübersicht</p>
          <p className="text-xs text-s112-teal font-medium mt-auto">Öffnen →</p>
        </a>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 flex-wrap print:hidden">
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:bg-s112-teal/10'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Report-Inhalt */}
      <div className="card p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-bold text-gray-900">
            {tab === 'umsatz'
              ? (umsatzModus === 'vergleich' ? 'Umsatzvergleich' : umsatzModus === 'benutzerdefiniert' ? 'Monatsumsatz Warenwirtschaft (Zeitraum)' : current.title)
              : current.title}
          </h2>
          {tab === 'lager'  && <CsvBtn onClick={csvLager} />}
          {tab === 'umsatz' && <CsvBtn onClick={csvUmsatz} />}
          {tab === 'offen'  && <CsvBtn onClick={csvOffene} />}
          {tab === 'verkaufsstatistik' && vsResult && vsResult.zeilen.length > 0 && <CsvBtn onClick={csvVerkaufsstatistik} />}
        </div>

        {/* ── UMSATZ ────────────────────────────────────────────────────── */}
        {tab === 'umsatz' && (
          <div className="space-y-4">
            {/* Zeitraum- & Vergleichs-Steuerung */}
            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 pb-4 mb-2 border-b border-s112-border/60 print:hidden">
              <button
                onClick={umsatzLetzte12}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${umsatzModus === 'standard' ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:bg-s112-teal/10'}`}
              >
                Letzte 12 Monate
              </button>

              <div className="flex items-end gap-1.5">
                <div>
                  <label className="block text-[11px] text-s112-muted mb-0.5">Von</label>
                  <input type="month" value={vonMonat} onChange={e => setVonMonat(e.target.value)}
                    className="border border-s112-border rounded-lg px-2 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[11px] text-s112-muted mb-0.5">Bis</label>
                  <input type="month" value={bisMonat} onChange={e => setBisMonat(e.target.value)}
                    className="border border-s112-border rounded-lg px-2 py-1.5 text-xs" />
                </div>
                <button
                  onClick={umsatzZeitraumAnwenden}
                  disabled={!vonMonat || !bisMonat || umsatzLoading}
                  className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-s112-bg text-gray-600 hover:bg-s112-teal/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {umsatzLoading && umsatzModus !== 'vergleich' ? 'Lädt…' : 'Zeitraum anwenden'}
                </button>
              </div>

              <span className="text-s112-border">|</span>

              <div className="flex items-end gap-1.5">
                <div>
                  <label className="block text-[11px] text-s112-muted mb-0.5">Monat A</label>
                  <input type="month" value={vergleichA} onChange={e => setVergleichA(e.target.value)}
                    className="border border-s112-border rounded-lg px-2 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[11px] text-s112-muted mb-0.5">Monat B</label>
                  <input type="month" value={vergleichB} onChange={e => setVergleichB(e.target.value)}
                    className="border border-s112-border rounded-lg px-2 py-1.5 text-xs" />
                </div>
                <button
                  onClick={umsatzVergleichen}
                  disabled={!vergleichA || !vergleichB || umsatzLoading}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${umsatzModus === 'vergleich' ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:bg-s112-teal/10'}`}
                >
                  {umsatzLoading && umsatzModus === 'vergleich' ? 'Lädt…' : 'Vergleichen'}
                </button>
              </div>

              {umsatzFehler && <span className="text-xs text-red-500">{umsatzFehler}</span>}
            </div>

            {umsatzModus === 'vergleich' ? (
              /* ── Monatsvergleich ── */
              vergleichData.length < 2 ? (
                <p className="text-sm text-s112-muted italic py-4">Bitte Monat A und Monat B auswählen und auf „Vergleichen" klicken.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    {vergleichData.map((m, i) => (
                      <div key={i} className="bg-s112-bg rounded-xl p-4">
                        <p className="text-xs text-s112-muted">{m.monat}</p>
                        <p className="text-xl font-bold text-s112-teal tabular-nums mt-1">{eur(m.umsatz)}</p>
                        <p className="text-xs text-s112-muted mt-0.5">{m.anzahl} Verkäufe</p>
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const [a, b] = vergleichData
                    const diff = b.umsatz - a.umsatz
                    const pct = a.umsatz !== 0 ? (diff / a.umsatz) * 100 : (b.umsatz !== 0 ? 100 : 0)
                    const positiv = diff >= 0
                    return (
                      <div className="bg-s112-bg rounded-xl p-4 flex items-center justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-xs text-s112-muted">Veränderung {a.monat} → {b.monat}</p>
                          <p className={`text-lg font-bold tabular-nums mt-1 ${positiv ? 'text-green-600' : 'text-red-500'}`}>
                            {positiv ? '+' : ''}{eur(diff)} ({positiv ? '+' : ''}{pct.toFixed(1)}%)
                          </p>
                        </div>
                        <p className="text-xs text-s112-muted">{a.anzahl} → {b.anzahl} Verkäufe</p>
                      </div>
                    )
                  })()}
                </div>
              )
            ) : (
              /* ── Zeitraum-Ansicht (Standard: letzte 12 Monate, oder benutzerdefiniert) ── */
              <>
                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: umsatzModus === 'standard' ? 'Akt. Monat' : 'Letzter Monat', val: eur(umsatzData[umsatzData.length - 1]?.umsatz ?? 0), sub: `${umsatzData[umsatzData.length - 1]?.anzahl ?? 0} Verkäufe` },
                    { label: 'Vormonat',       val: eur(umsatzData[umsatzData.length - 2]?.umsatz ?? 0), sub: `${umsatzData[umsatzData.length - 2]?.anzahl ?? 0} Verkäufe` },
                    { label: umsatzModus === 'standard' ? '12-Monats-Summe' : `Summe (${umsatzData.length} Monate)`, val: eur(umsatzData.reduce((s,m)=>s+m.umsatz,0)), sub: `${umsatzData.reduce((s,m)=>s+m.anzahl,0)} Verkäufe` },
                  ].map(kpi => (
                    <div key={kpi.label} className="bg-s112-bg rounded-xl p-4">
                      <p className="text-xs text-s112-muted">{kpi.label}</p>
                      <p className="text-xl font-bold text-s112-teal tabular-nums mt-1">{kpi.val}</p>
                      <p className="text-xs text-s112-muted mt-0.5">{kpi.sub}</p>
                    </div>
                  ))}
                </div>

                {/* Balkendiagramm – klickbar für Drill-down */}
                <div className="space-y-1.5">
                  {umsatzData.map(m => (
                    <div key={`${m.monat}-${m.von}`}>
                      <button
                        onClick={() => toggleUmsatzDrill(m.monat, m.von, m.bis)}
                        className="w-full flex items-center gap-3 hover:bg-s112-bg/50 rounded-lg px-1 py-0.5 transition-colors group"
                      >
                        <span className="text-xs text-s112-muted w-12 flex-shrink-0 text-right tabular-nums">{m.monat}</span>
                        <div className="flex-1 bg-s112-bg rounded-full h-5 overflow-hidden">
                          <div className="h-full rounded-full transition-all"
                            style={{ width: `${Math.max(2, (m.umsatz / maxUmsatz) * 100)}%`, backgroundColor: 'var(--s112-yellow)' }} />
                        </div>
                        <span className="text-xs font-semibold text-gray-700 tabular-nums w-24 text-right">{eur(m.umsatz)}</span>
                        <span className="text-xs text-s112-muted w-8 text-right">{m.anzahl}</span>
                        <span className="text-xs text-s112-muted group-hover:text-s112-teal w-4">{umsatzExpand === m.monat ? '▲' : '▼'}</span>
                      </button>

                      {/* Drill-down: Verkäufe dieses Monats */}
                      {umsatzExpand === m.monat && (
                        <div className="ml-16 mt-1 mb-2 border border-s112-border/50 rounded-xl overflow-hidden">
                          {monatLoading ? (
                            <div className="px-4 py-3 text-xs text-s112-muted">Lade…</div>
                          ) : monatDetail.length === 0 ? (
                            <div className="px-4 py-3 text-xs text-s112-muted italic">Keine Verkäufe in diesem Monat.</div>
                          ) : (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-s112-bg border-b border-s112-border/50 text-gray-500">
                                  <th className="text-left px-3 py-1.5 font-medium">Datum</th>
                                  <th className="text-left px-3 py-1.5 font-medium">Rechnung</th>
                                  <th className="text-left px-3 py-1.5 font-medium">Kunde</th>
                                  <th className="text-right px-3 py-1.5 font-medium">Betrag</th>
                                  <th className="text-center px-3 py-1.5 font-medium">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {monatDetail.map((p: R, i: number) => (
                                  <tr key={p.id} className={`border-b border-s112-border/30 last:border-0 ${i%2===1?'bg-s112-bg/20':''}`}>
                                    <td className="px-3 py-1.5 text-s112-muted tabular-nums">{fmtDate(p.datum)}</td>
                                    <td className="px-3 py-1.5">
                                      <Link href={`/weinhandel/verkauf/${p.id}`} className="text-s112-teal hover:underline font-mono">{p.rechnungsnummer ?? '–'}</Link>
                                    </td>
                                    <td className="px-3 py-1.5 font-medium text-gray-800">{kundenName(p)}</td>
                                    <td className="px-3 py-1.5 text-right font-semibold text-s112-teal tabular-nums">{eur(posSum(p))}</td>
                                    <td className="px-3 py-1.5 text-center">
                                      {p.storniert ? <span className="text-red-500">Storno</span>
                                        : p.bezahlt ? <span className="text-green-600">Bezahlt</span>
                                        : <span className="text-amber-500">Offen</span>}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── LAGER ─────────────────────────────────────────────────────── */}
        {tab === 'lager' && (
          <div>
            <div className="grid grid-cols-3 gap-4 mb-5">
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Artikel mit Bestand</p>
                <p className="text-xl font-bold text-s112-teal mt-1">{lager.filter(f=>f.bestand_flaschen>0).length}</p>
              </div>
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Flaschen gesamt</p>
                <p className="text-xl font-bold text-s112-teal mt-1 tabular-nums">{lager.reduce((s,f)=>s+(f.bestand_flaschen||0),0).toLocaleString('de-AT')}</p>
              </div>
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Lagerwert (Einstandspreis)</p>
                <p className="text-xl font-bold text-s112-teal mt-1 tabular-nums">{eur(lagerWert)}</p>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="text-left px-3 py-2 font-semibold">Wein</th>
                <th className="text-right px-3 py-2 font-semibold">Jahrgang</th>
                <th className="text-right px-3 py-2 font-semibold">Größe</th>
                <th className="text-right px-3 py-2 font-semibold">Bestand</th>
                <th className="text-right px-3 py-2 font-semibold">Einstand</th>
                <th className="text-right px-3 py-2 font-semibold">Lagerwert</th>
                <th className="text-center px-3 py-2 font-semibold print:hidden">BV</th>
              </tr></thead>
              <tbody>
                {lager.filter(f=>f.bestand_flaschen>0).map((f,i) => (
                  <>
                    <tr key={f.id} className={`border-b border-s112-border/40 ${i%2===1?'bg-s112-bg/30':''} ${lagerExpand===f.id?'border-b-0':''}`}>
                      <td className="px-3 py-2 font-medium text-gray-800">{f.name}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-s112-muted">{f.jahrgang??'–'}</td>
                      <td className="px-3 py-2 text-right text-xs text-s112-muted">{ML_LABEL[f.flaschengroesse_ml]??`${f.flaschengroesse_ml} ml`}</td>
                      <td className="px-3 py-2 text-right font-bold tabular-nums">{f.bestand_flaschen}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-s112-muted">{f.einstandspreis!=null?eur2(f.einstandspreis):'–'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-s112-teal">{f.einstandspreis!=null?eur(f.bestand_flaschen*f.einstandspreis):'–'}</td>
                      <td className="px-3 py-2 text-center print:hidden">
                        <button
                          onClick={() => toggleLagerDrill(f.id)}
                          title="Bestandsveränderungen"
                          className={`text-xs px-2 py-0.5 rounded-lg border transition-colors ${lagerExpand===f.id ? 'bg-s112-teal text-white border-s112-teal' : 'border-s112-border text-s112-muted hover:border-s112-teal hover:text-s112-teal'}`}
                        >
                          {lagerExpand===f.id ? '▲' : '↓ BV'}
                        </button>
                      </td>
                    </tr>

                    {/* Drill-down: Bestandsveränderungen */}
                    {lagerExpand === f.id && (
                      <tr key={`${f.id}-bv`} className={i%2===1?'bg-s112-bg/30':''}>
                        <td colSpan={7} className="px-3 pb-3 pt-0">
                          <div className="border border-s112-border/50 rounded-xl overflow-hidden">
                            {lagerBVLoading ? (
                              <div className="px-4 py-3 text-xs text-s112-muted">Lade Bestandsveränderungen…</div>
                            ) : lagerBV?.fehler ? (
                              <div className="px-4 py-3 text-xs text-red-500">{lagerBV.fehler}</div>
                            ) : lagerBV?.bv?.length === 0 ? (
                              <div className="px-4 py-3 text-xs text-s112-muted italic">Noch keine Verkäufe für diese Füllung.</div>
                            ) : (
                              <>
                                <div className="flex items-center gap-4 px-4 py-2.5 bg-s112-bg border-b border-s112-border/50 text-xs text-gray-600">
                                  <span>Verkauft: <strong className="text-gray-800">{lagerBV?.gesamtVerkauft ?? 0} Fl.</strong></span>
                                  <span>Umsatz: <strong className="text-s112-teal">{eur(lagerBV?.gesamtUmsatz ?? 0)}</strong></span>
                                  <Link href={`/weinhandel/fuellungen/${f.id}/edit`} className="ml-auto text-s112-teal hover:underline">Füllung bearbeiten →</Link>
                                </div>
                                <table className="w-full text-xs">
                                  <thead>
                                    <tr className="bg-s112-bg/50 border-b border-s112-border/30 text-gray-500">
                                      <th className="text-left px-3 py-1.5 font-medium">Datum</th>
                                      <th className="text-left px-3 py-1.5 font-medium">Rechnung</th>
                                      <th className="text-left px-3 py-1.5 font-medium">Kunde</th>
                                      <th className="text-right px-3 py-1.5 font-medium">Menge</th>
                                      <th className="text-right px-3 py-1.5 font-medium">Preis</th>
                                      <th className="text-right px-3 py-1.5 font-medium">Umsatz</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {(lagerBV?.bv ?? []).map((bv: R, bi: number) => (
                                      <tr key={bi} className={`border-b border-s112-border/20 last:border-0 ${bv.storniert ? 'opacity-40 line-through' : ''}`}>
                                        <td className="px-3 py-1.5 text-s112-muted">{fmtDate(bv.datum)}</td>
                                        <td className="px-3 py-1.5">
                                          {bv.verkauf_id
                                            ? <Link href={`/weinhandel/verkauf/${bv.verkauf_id}`} className="text-s112-teal hover:underline font-mono">{bv.rechnungsnummer ?? '–'}</Link>
                                            : <span className="text-s112-muted">–</span>}
                                        </td>
                                        <td className="px-3 py-1.5 font-medium text-gray-800">{bv.kunde}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums">{bv.menge} {bv.einheit}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums text-s112-muted">{eur2(bv.netto_preis)}</td>
                                        <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-s112-teal">{eur(bv.umsatz)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── BEHANDLUNGEN ─────────────────────────────────────────────── */}
        {tab === 'behandlung' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Behandlungen dieses Jahr</p>
                <p className="text-xl font-bold text-s112-teal mt-1">{behandlungen.length}</p>
              </div>
              <div className={`rounded-xl p-4 ${cuKgHa>4?'bg-red-50':'bg-green-50'}`}>
                <p className="text-xs text-s112-muted">Kupfer eingesetzt (kg Wirkstoff/ha)</p>
                <p className={`text-xl font-bold mt-1 tabular-nums ${cuKgHa>4?'text-red-600':'text-green-700'}`}>
                  {cuKgHa.toFixed(2).replace('.',',')} kg/ha
                </p>
                <p className="text-xs text-s112-muted mt-0.5">{cuKgHa>4?'Über EU-Limit (4 kg/ha/Jahr)':'Im EU-Bio-Limit'}</p>
              </div>
            </div>
            {behandlungen.length === 0 ? (
              <p className="text-center text-s112-muted py-8">Keine Behandlungen dieses Jahr erfasst.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                  <th className="text-left px-3 py-2 font-semibold">Datum</th>
                  <th className="text-left px-3 py-2 font-semibold">Mittel</th>
                  <th className="text-left px-3 py-2 font-semibold">Art</th>
                  <th className="text-right px-3 py-2 font-semibold">Menge</th>
                </tr></thead>
                <tbody>
                  {behandlungen.slice(0,30).map((b,i) => (
                    <tr key={b.id} className={`border-b border-s112-border/40 ${i%2===1?'bg-s112-bg/30':''}`}>
                      <td className="px-3 py-2 tabular-nums text-s112-muted">{fmtDate(b.datum)}</td>
                      <td className="px-3 py-2 font-medium text-gray-800">{(b.psm as R|null)?.name??'–'}</td>
                      <td className="px-3 py-2 text-xs text-s112-muted capitalize">{b.art??'–'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.menge_gesamt??'–'} {b.menge_einheit??''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── PIPELINE ─────────────────────────────────────────────────── */}
        {tab === 'pipeline' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Aktive Pipeline-Einträge</p>
                <p className="text-xl font-bold text-s112-teal mt-1">{pipelineAktiv.length}</p>
              </div>
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Gesamt (inkl. abgeschlossen)</p>
                <p className="text-xl font-bold text-gray-700 mt-1">{pipeline.length}</p>
              </div>
            </div>
            <div className="space-y-3">
              {[...new Set(pipeline.map(p=>p.stufe))].map(stufe => {
                const items = pipeline.filter(p=>p.stufe===stufe)
                return (
                  <div key={stufe}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-gray-700">{STUFEN_LABEL[stufe]??stufe}</span>
                      <span className="text-xs bg-s112-bg text-s112-muted px-2 py-0.5 rounded-full">{items.length}</span>
                    </div>
                    <div className="space-y-1">
                      {items.map(p => {
                        const name = p.kontakt ? [p.kontakt.vorname,p.kontakt.nachname].filter(Boolean).join(' ') : p.firma?.name ?? '–'
                        return (
                          <div key={p.id} className={`flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg ${p.erledigt?'opacity-50':''} bg-s112-bg/50`}>
                            <span className="font-medium text-gray-800">{name}</span>
                            {p.kategorie && <span className="text-xs text-s112-muted">· {p.kategorie}</span>}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── KONTAKTFREQUENZ ──────────────────────────────────────────── */}
        {tab === 'kontakt' && (
          <div>
            <p className="text-xs text-s112-muted mb-4">Kunden (keine Leads) · sortiert nach längster Inaktivität</p>
            {kontaktFrequenz.length === 0 ? (
              <p className="text-center text-s112-muted py-8">Keine Kunden erfasst.</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                  <th className="text-left px-3 py-2 font-semibold">Kunde</th>
                  <th className="text-left px-3 py-2 font-semibold">Kd.-Nr.</th>
                  <th className="text-right px-3 py-2 font-semibold">Letzter Kontakt</th>
                  <th className="text-right px-3 py-2 font-semibold">Tage</th>
                </tr></thead>
                <tbody>
                  {kontaktFrequenz.map((k,i) => (
                    <tr key={k.id} className={`border-b border-s112-border/40 ${i%2===1?'bg-s112-bg/30':''}`}>
                      <td className="px-3 py-2">
                        <Link href={`/crm/kontakte/${k.id}`} className="font-medium text-gray-800 hover:text-s112-teal">{k.name}</Link>
                      </td>
                      <td className="px-3 py-2 text-xs text-s112-muted font-mono">{k.kundennummer??'–'}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-s112-muted">{fmtDate(k.letzterKontakt)}</td>
                      <td className="px-3 py-2 text-right">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${k.tage>180?'bg-red-100 text-red-700':k.tage>90?'bg-amber-100 text-amber-700':'bg-green-100 text-green-700'}`}>
                          {k.tage===999?'–':k.tage}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── OFFENE POSTEN ────────────────────────────────────────────── */}
        {tab === 'offen' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Anzahl offene Rechnungen</p>
                <p className="text-xl font-bold text-amber-600 mt-1">{offene.length}</p>
              </div>
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Offener Gesamtbetrag</p>
                <p className="text-xl font-bold text-amber-600 mt-1 tabular-nums">{eur(offeneSum)}</p>
              </div>
            </div>
            {offene.length === 0 ? (
              <p className="text-center text-green-600 font-medium py-8">Alle Rechnungen bezahlt!</p>
            ) : (
              <table className="w-full text-sm">
                <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                  <th className="text-left px-3 py-2 font-semibold">Datum</th>
                  <th className="text-left px-3 py-2 font-semibold">Rechnung</th>
                  <th className="text-left px-3 py-2 font-semibold">Kunde</th>
                  <th className="text-right px-3 py-2 font-semibold">Betrag</th>
                  <th className="text-right px-3 py-2 font-semibold">Tage offen</th>
                </tr></thead>
                <tbody>
                  {offene.map((p,i) => {
                    const tage = Math.floor((new Date().getTime()-new Date(p.datum).getTime())/86400000)
                    return (
                      <tr key={p.id} className={`border-b border-s112-border/40 ${i%2===1?'bg-s112-bg/30':''}`}>
                        <td className="px-3 py-2 tabular-nums text-s112-muted">{fmtDate(p.datum)}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link href={`/weinhandel/verkauf/${p.id}`} className="text-s112-teal hover:underline">{p.rechnungsnummer??'–'}</Link>
                        </td>
                        <td className="px-3 py-2 font-medium text-gray-800">{kundenName(p)}</td>
                        <td className="px-3 py-2 text-right font-semibold text-s112-teal tabular-nums">{eur(posSum(p))}</td>
                        <td className="px-3 py-2 text-right">
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full tabular-nums ${tage>30?'bg-red-100 text-red-700':tage>14?'bg-amber-100 text-amber-700':'bg-gray-100 text-gray-600'}`}>
                            {tage}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── BESUCHSPLANUNG ───────────────────────────────────────────── */}
        {tab === 'besuch' && (
          <div className="space-y-5">
            <form onSubmit={ladeBesuch} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Region / Ort</label>
                <input value={bOrt} onChange={e => setBOrt(e.target.value)} placeholder="z.B. Salzburg, Wien…"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Segment</label>
                <select value={bSegment} onChange={e => setBSegment(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle Segmente</option>
                  <option value="privat">Privat</option>
                  <option value="gastro">Gastronomie</option>
                  <option value="handel">Handel</option>
                  <option value="export">Export</option>
                  <option value="grosshandel">Großhandel</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Einschließen</label>
                <div className="flex gap-3 mt-1.5">
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={bKunden} onChange={e => setBKunden(e.target.checked)} className="accent-s112-teal" /> Kunden
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={bLeads} onChange={e => setBLeads(e.target.checked)} className="accent-s112-teal" /> Leads
                  </label>
                </div>
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={bLaden}
                  className="w-full text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: 'var(--s112-teal)' }}>
                  {bLaden ? 'Lädt…' : 'Planen'}
                </button>
              </div>
            </form>
            {bFehler && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{bFehler}</div>}
            {bResult && (
              <div className="space-y-4">
                <div className="flex items-center justify-between bg-s112-bg rounded-xl px-4 py-3">
                  <p className="text-sm font-medium text-gray-700">{bResult.anzahl} Kontakte · {bResult.plz_count} PLZ-Gebiete</p>
                </div>
                {Object.entries(bResult.cluster).sort(([a],[b])=>a.localeCompare(b)).map(([plz,kontakte]) => (
                  <div key={plz} className="border border-s112-border rounded-xl overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2.5 bg-s112-bg border-b border-s112-border">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-s112-teal text-sm">{plz}</span>
                        <span className="text-xs text-s112-muted">{kontakte[0]?.ort ?? ''}</span>
                        <span className="text-xs bg-white border border-s112-border px-2 py-0.5 rounded-full text-gray-600">{kontakte.length}</span>
                      </div>
                      {googleMapsUrl(kontakte) && (
                        <a href={googleMapsUrl(kontakte)} target="_blank" rel="noopener noreferrer"
                          className="text-xs text-s112-teal hover:underline">In Maps öffnen</a>
                      )}
                    </div>
                    <div className="divide-y divide-s112-border/40">
                      {kontakte.map(k => (
                        <div key={k.id} className="flex items-start justify-between px-4 py-2.5 hover:bg-s112-bg/40">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-gray-800">
                                {k.vorname} {k.nachname}
                                {k.firma_name && <span className="text-s112-muted font-normal"> · {k.firma_name}</span>}
                              </span>
                              {k.is_lead && <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Lead</span>}
                            </div>
                            <p className="text-xs text-s112-muted mt-0.5">
                              {k.strasse && `${k.strasse} · `}{k.telefon ?? k.mobil ?? k.email ?? '–'}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0 ml-4">
                            <p className="text-[9px] text-s112-muted uppercase tracking-wide mb-0.5">Letzter Kontakt</p>
                            {k.tage_seit_kontakt !== null ? (
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${k.tage_seit_kontakt > 180 ? 'bg-red-100 text-red-700' : k.tage_seit_kontakt > 90 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                                {k.tage_seit_kontakt} Tage
                              </span>
                            ) : (
                              <span className="text-xs text-s112-muted">kein Kontakt</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
            {bResult?.anzahl === 0 && (
              <p className="text-center text-s112-muted py-8">Keine Kontakte gefunden. Filterkriterien anpassen.</p>
            )}
          </div>
        )}

        {/* ── BEHÖRDEN-DOKUMENTE ───────────────────────────────────────── */}
        {tab === 'behoerden' && (
          <div className="space-y-4">
            <p className="text-sm text-s112-muted">Druckfertige Behördendokumente – automatisch mit Betriebsdaten und Mandantenlogo befüllt.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[
                { href: '/reports/ama', icon: FileText, title: 'AMA Erntemeldung', desc: 'Weinerntemeldung je Jahrgang · Druckfertig mit Unterschriftsfeld' },
                { href: '/reports/behandlungsprotokoll', icon: FileText, title: 'Behandlungsprotokoll', desc: 'Weinbauliches Spritzprotokoll nach Saison · für Bio-Kontrolle und Landwirtschaftskammer' },
                { href: '/reports/cu-bilanz', icon: Droplet, title: 'Cu-Bilanz Jahresbericht', desc: 'Kupfer-Nachweis gem. EU-Bio-VO 2018/848 · Ampel vs. 4 kg/ha EU-Limit' },
                { href: '/reports/naehrstoffbilanz', icon: Sprout, title: 'Nährstoffbilanz Jahresbericht', desc: 'Stickstoff/Phosphor aus Düngungen · Ampel vs. Richtwerte (NAPV 2023)' },
              ].map(doc => (
                <a key={doc.href} href={doc.href}
                  className="card p-5 hover:border-s112-teal hover:shadow-md transition-all group flex flex-col gap-2">
                  <doc.icon className="w-8 h-8 text-s112-teal" strokeWidth={1.75} />
                  <p className="font-semibold text-gray-900 group-hover:text-s112-teal">{doc.title}</p>
                  <p className="text-xs text-gray-500 leading-relaxed">{doc.desc}</p>
                  <p className="text-xs text-s112-teal font-medium mt-auto">Öffnen & Drucken →</p>
                </a>
              ))}
            </div>
          </div>
        )}

        {/* ── VERKAUFSSTATISTIK ────────────────────────────────────────── */}
        {tab === 'verkaufsstatistik' && (
          <div className="space-y-5">
            <form onSubmit={ladeVerkaufsstatistik} className="grid grid-cols-1 sm:grid-cols-4 gap-3 print:hidden">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Jahrgang</label>
                <select value={vsJahrgang} onChange={e => setVsJahrgang(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {vsJahrgaenge.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sorte</label>
                <select value={vsSorte} onChange={e => setVsSorte(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {vsSorten.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bezeichnung</label>
                <select value={vsBezeichnung} onChange={e => setVsBezeichnung(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {vsBezeichnungen.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Kunde (Kontakt/Firma)</label>
                <select value={vsKunde} onChange={e => setVsKunde(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {vsKunden.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">PLZ von</label>
                <input value={vsPlzVon} onChange={e => setVsPlzVon(e.target.value)} placeholder="z.B. 1000"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">PLZ bis</label>
                <input value={vsPlzBis} onChange={e => setVsPlzBis(e.target.value)} placeholder="z.B. 3500"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Ort</label>
                <select value={vsOrt} onChange={e => setVsOrt(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {vsOrte.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Land</label>
                <select value={vsLand} onChange={e => setVsLand(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {vsLaender.map(l => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2">
                <button type="submit" disabled={vsLaden}
                  className="flex-1 text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: 'var(--s112-teal)' }}>
                  {vsLaden ? 'Lädt…' : 'Auswerten'}
                </button>
                <button type="button" onClick={vsZuruecksetzen}
                  className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 border border-s112-border hover:bg-s112-bg transition-colors">
                  Zurücksetzen
                </button>
              </div>
            </form>

            {vsFehler && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{vsFehler}</div>}

            {vsResult && (
              vsResult.zeilen.length === 0 ? (
                <p className="text-center text-s112-muted py-8">Keine Verkäufe für diese Auswahl gefunden.</p>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-3 gap-4">
                    <div className="bg-s112-bg rounded-xl p-4">
                      <p className="text-xs text-s112-muted">Verkäufe (Positionen)</p>
                      <p className="text-xl font-bold text-s112-teal tabular-nums mt-1">{vsResult.anzahl}</p>
                    </div>
                    <div className="bg-s112-bg rounded-xl p-4">
                      <p className="text-xs text-s112-muted">Stk gesamt</p>
                      <p className="text-xl font-bold text-s112-teal tabular-nums mt-1">{vsResult.summeMenge.toLocaleString('de-AT')}</p>
                    </div>
                    <div className="bg-s112-bg rounded-xl p-4">
                      <p className="text-xs text-s112-muted">Umsatz gesamt</p>
                      <p className="text-xl font-bold text-s112-teal tabular-nums mt-1">{eur2(vsResult.summeBetrag)}</p>
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                        <th className="text-left px-3 py-2 font-semibold">Datum</th>
                        <th className="text-left px-3 py-2 font-semibold">Produkt</th>
                        <th className="text-right px-3 py-2 font-semibold">Jahrgang</th>
                        <th className="text-left px-3 py-2 font-semibold">Sorte</th>
                        <th className="text-left px-3 py-2 font-semibold">Bezeichnung</th>
                        <th className="text-left px-3 py-2 font-semibold">Kunde</th>
                        <th className="text-left px-3 py-2 font-semibold">Ort</th>
                        <th className="text-right px-3 py-2 font-semibold">Stk</th>
                        <th className="text-right px-3 py-2 font-semibold">Betrag</th>
                      </tr></thead>
                      <tbody>
                        {vsResult.zeilen.map((z, i) => (
                          <tr key={i} className={`border-b border-s112-border/40 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                            <td className="px-3 py-2 tabular-nums text-s112-muted whitespace-nowrap">{fmtDate(z.datum)}</td>
                            <td className="px-3 py-2 font-medium text-gray-800">{z.produkt}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-gray-600">{z.jahrgang ?? '–'}</td>
                            <td className="px-3 py-2 text-gray-600">{z.sorte ?? '–'}</td>
                            <td className="px-3 py-2 text-gray-600">{z.bezeichnung ?? '–'}</td>
                            <td className="px-3 py-2 text-gray-600">{z.kunde}</td>
                            <td className="px-3 py-2 text-gray-600">{[z.plz, z.ort].filter(Boolean).join(' ') || '–'}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{z.menge.toLocaleString('de-AT')}</td>
                            <td className="px-3 py-2 text-right font-semibold text-s112-teal tabular-nums">{eur2(z.betrag)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            )}

            {!vsResult && !vsFehler && (
              <p className="text-center text-s112-muted py-8">Filter wählen und auf „Auswerten" klicken.</p>
            )}
          </div>
        )}

        {/* ── WEINBUCH-SAMMLUNG ────────────────────────────────────────── */}
        {tab === 'weinbuecher' && (
          <div className="space-y-5">
            <p className="text-xs text-s112-muted">
              Für Betriebsprüfungen (z.B. BKI): alle Weinbücher (vollständige Prozesshistorie je Charge)
              gesammelt nach Jahrgang, Sorte oder Bezeichnung filtern und als ein zusammenhängendes PDF ausgeben.
            </p>
            <form onSubmit={ladeWeinbuecher} className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Jahrgang</label>
                <select value={wbJahrgang} onChange={e => setWbJahrgang(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {wbJahrgaenge.map(j => <option key={j} value={j}>{j}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Sorte</label>
                <select value={wbSorte} onChange={e => setWbSorte(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {wbSorten.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bezeichnung</label>
                <select value={wbBezeichnung} onChange={e => setWbBezeichnung(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">Alle</option>
                  {wbBezeichnungen.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              <div className="flex items-end gap-2 sm:col-span-3">
                <button type="submit" disabled={wbLaden}
                  className="text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: 'var(--s112-teal)' }}>
                  {wbLaden ? 'Lädt…' : 'Auswerten'}
                </button>
                <button type="button" onClick={wbZuruecksetzen}
                  className="px-3 py-2 rounded-xl text-sm font-medium text-gray-600 border border-s112-border hover:bg-s112-bg transition-colors">
                  Zurücksetzen
                </button>
                {wbResult && wbResult.chargen.length > 0 && (
                  <a
                    href={`/reports/weinbuecher-sammlung?${wbParams().toString()}`}
                    target="_blank" rel="noopener noreferrer"
                    className="ml-auto flex items-center gap-1.5 text-sm font-medium text-s112-teal border border-s112-teal/40 px-4 py-2 rounded-xl hover:bg-s112-teal/10 transition-colors"
                  >
                    Alle {wbResult.chargen.length} Weinbücher als PDF sammeln →
                  </a>
                )}
              </div>
            </form>

            {wbFehler && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{wbFehler}</div>}

            {wbResult && (
              wbResult.chargen.length === 0 ? (
                <p className="text-center text-s112-muted py-8">Keine Chargen für diese Auswahl gefunden.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                      <th className="text-left px-3 py-2 font-semibold">Charge</th>
                      <th className="text-right px-3 py-2 font-semibold">Jg.</th>
                      <th className="text-left px-3 py-2 font-semibold">Sorte</th>
                      <th className="text-left px-3 py-2 font-semibold">Behälter</th>
                      <th className="text-left px-3 py-2 font-semibold">Status</th>
                      <th className="text-right px-3 py-2 font-semibold">Bestand</th>
                      <th className="px-3 py-2" />
                    </tr></thead>
                    <tbody>
                      {wbResult.chargen.map((c, i) => (
                        <tr key={c.id} className={`border-b border-s112-border/40 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                          <td className="px-3 py-2 font-medium text-gray-800">{c.name}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{c.jahrgang ?? '–'}</td>
                          <td className="px-3 py-2 text-gray-600">{c.rebsorte ?? '–'}</td>
                          <td className="px-3 py-2 text-gray-600">{c.behaelter ?? '–'}</td>
                          <td className="px-3 py-2 text-gray-600">{c.status}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{Number(c.menge_liter ?? 0).toLocaleString('de-AT')} L</td>
                          <td className="px-3 py-2 text-right">
                            <Link href={`/kellerbuch/weinausbau/${c.id}/buch`}
                              className="text-xs text-s112-teal hover:underline whitespace-nowrap">
                              Weinbuch →
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {!wbResult && !wbFehler && (
              <p className="text-center text-s112-muted py-8">Filter wählen und auf „Auswerten" klicken.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
