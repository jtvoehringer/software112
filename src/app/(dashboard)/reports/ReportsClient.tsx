'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

// ── Typen ─────────────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  umsatzMonate: { monat: string; umsatz: number; anzahl: number }[]
  lager: R[]
  lagerWert: number
  behandlungen: R[]
  cuKgHa: number
  pipeline: R[]
  kontaktFrequenz: { id: string; name: string; kundennummer: string | null; letzterKontakt: string | null; tage: number }[]
  offene: R[]
  heute: string
}

const TABS = [
  { id: 'umsatz',      label: '📈 Umsatz',        title: 'Monatsumsatz Weinhandel (12 Monate)' },
  { id: 'lager',       label: '🍾 Lager',          title: 'Lagerbestand' },
  { id: 'behandlung',  label: '🌿 Behandlungen',   title: 'Behandlungsübersicht ' + new Date().getFullYear() },
  { id: 'pipeline',    label: '💼 Pipeline',        title: 'Lead-Pipeline' },
  { id: 'kontakt',     label: '🤝 Kontaktfrequenz', title: 'Tage seit letztem Kontakt' },
  { id: 'offen',       label: '💶 Offene Posten',   title: 'Unbezahlte Rechnungen' },
  { id: 'smart',       label: '🤖 Frag dein Weingut', title: 'KI-Abfrage – Frag dein Weingut' },
  { id: 'besuch',      label: '🗺 Besuchsplanung',     title: 'Besuchsplanung – PLZ-Cluster' },
] as const
type TabId = typeof TABS[number]['id']

const STUFEN_LABEL: Record<string, string> = {
  neukontakt: 'Neukontakt', interessent: 'Interessent', angebot: 'Angebot',
  verhandlung: 'Verhandlung', abschluss: 'Abschluss', stammkunde: 'Stammkunde',
  verloren: 'Verloren', pause: 'Pause',
}

const ML_LABEL: Record<number, string> = { 187:'0,187 L',375:'0,375 L',500:'0,500 L',750:'0,75 L',1000:'1,0 L',1500:'1,5 L',3000:'3,0 L',6000:'6,0 L' }

function eur(n: number) { return n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }) }
function fmtDate(d: string | null) { return d ? new Date(d).toLocaleDateString('de-AT') : '–' }

function posSum(p: R): number {
  return ((p.verkauf_positionen ?? []) as R[]).reduce((s: number, pos: R) => {
    const b = (Number(pos.preis_brutto)||0) * (Number(pos.menge)||0)
    return s + b * (1 - (Number(pos.rabatt_pct)||0)/100) * (1 - (Number(pos.sonderrabatt_pct)||0)/100)
  }, 0)
}

function kundenName(p: R) {
  if (p.kontakt) return [p.kontakt.vorname, p.kontakt.nachname].filter(Boolean).join(' ')
  if (p.firma) return p.firma.name
  return '–'
}

export default function ReportsClient({ umsatzMonate, lager, lagerWert, behandlungen, cuKgHa, pipeline, kontaktFrequenz, offene }: Props) {
  const [tab, setTab] = useState<TabId>('umsatz')
  const [frage, setFrage] = useState('')
  const [verlauf, setVerlauf] = useState<string[]>([])
  // Besuchsplanung
  const [bOrt, setBOrt]         = useState('')
  const [bSegment, setBSegment] = useState('')
  const [bLeads, setBLeads]     = useState(true)
  const [bKunden, setBKunden]   = useState(true)
  const [bLaden, setBLaden]     = useState(false)
  const [bResult, setBResult]   = useState<{kontakte: R[]; cluster: Record<string, R[]>; anzahl: number; plz_count: number}|null>(null)
  const [bFehler, setBFehler]   = useState<string|null>(null)

  useEffect(() => {
    try {
      const saved = localStorage.getItem('ki_abfragen_verlauf')
      if (saved) setVerlauf(JSON.parse(saved))
    } catch { /* ignore */ }
  }, [])
  const [kiLaden, setKiLaden] = useState(false)
  const [kiErgebnis, setKiErgebnis] = useState<{ergebnisse: R[]; anzahl: number; zusammenfassung: string|null; empfehlung: string|null; tabelle: string; verbraucht: number}|null>(null)
  const [kiFehler, setKiFehler] = useState<string|null>(null)
  const current = TABS.find(t => t.id === tab)!

  // KI-Abfrage senden
  async function sendeKiAbfrage(e: React.FormEvent) {
    e.preventDefault()
    if (!frage.trim()) return
    setKiLaden(true); setKiFehler(null); setKiErgebnis(null)
    try {
      const res = await fetch('/api/ki-abfrage', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frage }),
      })
      const json = await res.json()
      if (!res.ok || json.fehler) { setKiFehler(json.fehler ?? 'Fehler'); return }
      setKiErgebnis(json)
      // Verlauf aktualisieren (max 6 Einträge, neueste zuerst, keine Duplikate)
      setVerlauf(prev => {
        const neu = [frage, ...prev.filter(q => q !== frage)].slice(0, 6)
        try { localStorage.setItem('ki_abfragen_verlauf', JSON.stringify(neu)) } catch { /* ignore */ }
        return neu
      })
    } catch (err) {
      setKiFehler(String(err))
    } finally {
      setKiLaden(false)
    }
  }

  // Besuchsplanung laden
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
    // Vollständige Adressen mit PLZ + Ort + Österreich für korrekte Geocodierung
    const adressen = kontakte
      .filter(k => k.ort || k.plz)
      .map(k => {
        const teile = [
          k.strasse,
          [k.plz, k.ort].filter(Boolean).join(' '),
          'Österreich',
        ].filter(Boolean)
        return teile.join(', ')
      })
      .slice(0, 10)
    if (adressen.length === 0) return ''
    // /dir/-Format: kein API-Key nötig, zeigt Route direkt
    const segmente = adressen.map(a => encodeURIComponent(a)).join('/')
    return `https://www.google.com/maps/dir/${segmente}`
  }

  // Balken-Max für Umsatzdiagramm
  const maxUmsatz = Math.max(...umsatzMonate.map(m => m.umsatz), 1)

  // Pipeline gruppiert
  const stufen = [...new Set(pipeline.map(p => p.stufe))]
  const pipelineAktiv = pipeline.filter(p => !p.erledigt && p.stufe !== 'verloren')
  const offeneSum = offene.reduce((s, p) => s + posSum(p), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-s112-muted mt-0.5">Betriebsauswertungen · automatisch aktualisiert</p>
        </div>
        <button onClick={() => window.print()}
          className="flex items-center gap-2 border border-s112-border text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors print:hidden">
          🖨 Drucken
        </button>
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
        <h2 className="text-base font-bold text-gray-900 mb-5">{current.title}</h2>

        {/* ── UMSATZ ─────────────────────────────────────────────────────── */}
        {tab === 'umsatz' && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4 mb-6">
              {[
                { label: 'Akt. Monat', val: eur(umsatzMonate[11].umsatz), sub: `${umsatzMonate[11].anzahl} Verkäufe` },
                { label: 'Vormonat', val: eur(umsatzMonate[10].umsatz), sub: `${umsatzMonate[10].anzahl} Verkäufe` },
                { label: '12-Monats-Summe', val: eur(umsatzMonate.reduce((s,m)=>s+m.umsatz,0)), sub: `${umsatzMonate.reduce((s,m)=>s+m.anzahl,0)} Verkäufe` },
              ].map(kpi => (
                <div key={kpi.label} className="bg-s112-bg rounded-xl p-4">
                  <p className="text-xs text-s112-muted">{kpi.label}</p>
                  <p className="text-xl font-bold text-s112-teal tabular-nums mt-1">{kpi.val}</p>
                  <p className="text-xs text-s112-muted mt-0.5">{kpi.sub}</p>
                </div>
              ))}
            </div>
            {/* Balkendiagramm */}
            <div className="space-y-1.5">
              {umsatzMonate.map(m => (
                <div key={m.monat} className="flex items-center gap-3">
                  <span className="text-xs text-s112-muted w-12 flex-shrink-0 text-right tabular-nums">{m.monat}</span>
                  <div className="flex-1 bg-s112-bg rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.max(2, (m.umsatz / maxUmsatz) * 100)}%`, backgroundColor: 'var(--s112-yellow)' }} />
                  </div>
                  <span className="text-xs font-semibold text-gray-700 tabular-nums w-24 text-right">{eur(m.umsatz)}</span>
                  <span className="text-xs text-s112-muted w-8 text-right">{m.anzahl}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── LAGER ──────────────────────────────────────────────────────── */}
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
                <p className="text-xs text-s112-muted">Lagerwert (VK-Preis)</p>
                <p className="text-xl font-bold text-s112-teal mt-1 tabular-nums">{eur(lagerWert)}</p>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                <th className="text-left px-3 py-2 font-semibold">Wein</th>
                <th className="text-right px-3 py-2 font-semibold">Jahrgang</th>
                <th className="text-right px-3 py-2 font-semibold">Größe</th>
                <th className="text-right px-3 py-2 font-semibold">Bestand</th>
                <th className="text-right px-3 py-2 font-semibold">VK/Fl.</th>
                <th className="text-right px-3 py-2 font-semibold">Wert</th>
              </tr></thead>
              <tbody>
                {lager.filter(f=>f.bestand_flaschen>0).map((f,i) => (
                  <tr key={f.id} className={`border-b border-s112-border/40 ${i%2===1?'bg-s112-bg/30':''}`}>
                    <td className="px-3 py-2 font-medium text-gray-800">{f.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-s112-muted">{f.jahrgang??'–'}</td>
                    <td className="px-3 py-2 text-right text-xs text-s112-muted">{ML_LABEL[f.flaschengroesse_ml]??`${f.flaschengroesse_ml} ml`}</td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{f.bestand_flaschen}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-s112-muted">{f.vk_preis_brutto!=null?eur(f.vk_preis_brutto):'–'}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-s112-teal">{f.vk_preis_brutto!=null?eur(f.bestand_flaschen*f.vk_preis_brutto):'–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ── BEHANDLUNGEN ────────────────────────────────────────────────── */}
        {tab === 'behandlung' && (
          <div>
            <div className="grid grid-cols-2 gap-4 mb-5">
              <div className="bg-s112-bg rounded-xl p-4">
                <p className="text-xs text-s112-muted">Behandlungen dieses Jahr</p>
                <p className="text-xl font-bold text-s112-teal mt-1">{behandlungen.length}</p>
              </div>
              <div className={`rounded-xl p-4 ${cuKgHa>4?'bg-red-50':'bg-green-50'}`}>
                <p className="text-xs text-s112-muted">Kupfer eingesetzt (kg Wirkstoff)</p>
                <p className={`text-xl font-bold mt-1 tabular-nums ${cuKgHa>4?'text-red-600':'text-green-700'}`}>
                  {cuKgHa.toFixed(2).replace('.',',')} kg
                </p>
                <p className="text-xs text-s112-muted mt-0.5">{cuKgHa>4?'⚠ Über EU-Limit (4 kg/ha/Jahr)':'✓ Im EU-Bio-Limit'}</p>
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

        {/* ── PIPELINE ────────────────────────────────────────────────────── */}
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
                            {p.erledigt && <span className="text-green-500 text-xs">✓</span>}
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

        {/* ── KONTAKTFREQUENZ ─────────────────────────────────────────────── */}
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

        {/* ── OFFENE POSTEN ───────────────────────────────────────────────── */}
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
              <p className="text-center text-green-600 font-medium py-8">✓ Alle Rechnungen bezahlt!</p>
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

        {/* ── SMART QUERY ─────────────────────────────────────────────────────── */}
        {tab === 'smart' && (
          <div className="space-y-5">
            <div className="bg-s112-bg border border-s112-border rounded-xl p-4 text-sm text-gray-600">
              <p className="font-semibold text-s112-teal mb-1">🤖 Frag dein Weingut</p>
              <p>Stelle eine Frage in normalem Deutsch – die KI sucht die passenden Daten heraus.</p>
              <p className="mt-1 text-xs text-s112-muted">Beispiele: „Gastronomie-Kunden in Salzburg" · „Offene Rechnungen diese Woche" · „Welcher Wein hat den höchsten Bestand?"</p>
            </div>

            <form onSubmit={sendeKiAbfrage} className="flex gap-2">
              <input
                value={frage}
                onChange={e => setFrage(e.target.value)}
                placeholder="Deine Frage an den Betrieb…"
                className="flex-1 border border-s112-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
              />
              <button type="submit" disabled={kiLaden || !frage.trim()}
                className="bg-s112-teal text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40 flex items-center gap-2">
                {kiLaden ? <><span className="animate-spin">⏳</span> Denkt…</> : '🔍 Abfragen'}
              </button>
            </form>

            {/* Verlauf-Chips */}
            {verlauf.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="text-xs text-s112-muted self-center">Zuletzt:</span>
                {verlauf.map((q, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setFrage(q)}
                    className="text-xs px-3 py-1 rounded-full border border-s112-border text-gray-600 hover:border-s112-teal hover:text-s112-teal hover:bg-s112-teal/5 transition-colors text-left max-w-[280px] truncate"
                    title={q}
                  >
                    {q}
                  </button>
                ))}
              </div>
            )}

            {kiFehler && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{kiFehler}</div>
            )}

            {kiErgebnis && (
              <div className="space-y-4">
                {/* Zusammenfassung */}
                <div className="bg-s112-teal/5 border border-s112-teal/20 rounded-xl px-4 py-3">
                  <p className="text-sm font-semibold text-s112-teal">{kiErgebnis.zusammenfassung}</p>
                  {kiErgebnis.empfehlung && <p className="text-xs text-gray-600 mt-1">{kiErgebnis.empfehlung}</p>}
                  <p className="text-xs text-s112-muted mt-2">{kiErgebnis.anzahl} Ergebnis{kiErgebnis.anzahl !== 1 ? 'se' : ''} · Tabelle: {kiErgebnis.tabelle} · Abfrage {kiErgebnis.verbraucht} diesen Monat</p>
                </div>

                {/* Ergebnistabelle */}
                {kiErgebnis.ergebnisse.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-s112-bg border-b border-s112-border text-xs text-gray-600">
                          {Object.keys(kiErgebnis.ergebnisse[0])
                            .filter(k => !['id','tenant_id','erstellt_am','updated_at','aktualisiert_am','firma_id','kontakt_id','psm_id','weingarten_id','weinausbau_id'].includes(k))
                            .slice(0, 11)
                            .map(k => (
                              <th key={k} className="text-left px-3 py-2 font-semibold capitalize">
                                {k.replace(/_/g,' ')}
                              </th>
                            ))}
                        </tr>
                      </thead>
                      <tbody>
                        {kiErgebnis.ergebnisse.map((row, i) => (
                          <tr key={i} className={`border-b border-s112-border/40 ${i%2===1?'bg-s112-bg/30':''}`}>
                            {Object.entries(row)
                              .filter(([k]) => !['id','tenant_id','erstellt_am','updated_at','aktualisiert_am','firma_id','kontakt_id','psm_id','weingarten_id','weinausbau_id'].includes(k))
                              .slice(0, 11)
                              .map(([k, v]) => (
                                <td key={k} className="px-3 py-2 text-gray-700">
                                  {v == null ? '–'
                                    : typeof v === 'boolean' ? (v ? 'Ja' : 'Nein')
                                    : typeof v === 'object' && v !== null && 'name' in (v as object)
                                      ? String((v as Record<string,unknown>).name ?? '–')
                                      : typeof v === 'object' && v !== null
                                        ? [Object.values(v as object).filter(Boolean)].flat().join(' ').slice(0, 50)
                                        : String(v).slice(0, 50)
                                  }
                                </td>
                              ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {kiErgebnis.ergebnisse.length === 0 && (
                  <p className="text-center text-s112-muted py-6">Keine Einträge gefunden.</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── BESUCHSPLANUNG ──────────────────────────────────────────────────── */}
        {tab === 'besuch' && (
          <div className="space-y-5">
            {/* Filter-Formular */}
            <form onSubmit={ladeBesuch} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Region / Ort</label>
                <input value={bOrt} onChange={e => setBOrt(e.target.value)}
                  placeholder="z.B. Salzburg, Wien…"
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
                    <input type="checkbox" checked={bKunden} onChange={e => setBKunden(e.target.checked)} className="accent-s112-teal" />
                    Kunden
                  </label>
                  <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={bLeads} onChange={e => setBLeads(e.target.checked)} className="accent-s112-teal" />
                    Leads
                  </label>
                </div>
              </div>
              <div className="flex items-end">
                <button type="submit" disabled={bLaden}
                  className="w-full text-white px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-40" style={{ backgroundColor: 'var(--s112-teal)' }}>
                  {bLaden ? '⏳ Lädt…' : '🗺 Planen'}
                </button>
              </div>
            </form>

            {bFehler && <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700">{bFehler}</div>}

            {bResult && (
              <div className="space-y-4">
                {/* Zusammenfassung + Route-Button */}
                <div className="flex items-center justify-between bg-s112-bg rounded-xl px-4 py-3">
                  <p className="text-sm font-medium text-gray-700">
                    {bResult.anzahl} Kontakte · {bResult.plz_count} PLZ-Gebiete
                  </p>
                  {googleMapsUrl(bResult.kontakte) && (
                    <a href={googleMapsUrl(bResult.kontakte)} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1.5 text-white px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ backgroundColor: 'var(--s112-teal)' }}>
                      📍 Route in Google Maps öffnen
                    </a>
                  )}
                </div>

                {/* PLZ-Cluster */}
                {Object.entries(bResult.cluster)
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([plz, kontakte]) => (
                    <div key={plz} className="border border-s112-border rounded-xl overflow-hidden">
                      <div className="flex items-center justify-between px-4 py-2.5 bg-s112-bg border-b border-s112-border">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-s112-teal text-sm">{plz}</span>
                          <span className="text-xs text-s112-muted">{kontakte[0]?.ort ?? ''}</span>
                          <span className="text-xs bg-white border border-s112-border px-2 py-0.5 rounded-full text-gray-600">{kontakte.length}</span>
                        </div>
                        {googleMapsUrl(kontakte) && (
                          <a href={googleMapsUrl(kontakte)} target="_blank" rel="noopener noreferrer"
                            className="text-xs text-s112-teal hover:underline">
                            📍 In Maps öffnen
                          </a>
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
      </div>
    </div>
  )
}
