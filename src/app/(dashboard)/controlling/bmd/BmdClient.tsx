'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { AlertTriangle, Download, FileText, History, Settings2, CheckCircle2, RotateCcw } from 'lucide-react'
import { MAPPING_FELDER, MAPPING_GRUPPEN, mappingAufloesen } from '@/lib/buchhaltung/bmd'
import { speichereKontenmapping, setzeKontenmappingZurueck } from './actions'
import { fmtEur } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
type Tab = 'uebergabe' | 'mapping' | 'protokoll'
type Art = 'ausgangsrechnungen' | 'eingangsbelege' | 'stammdaten'

const ART_LABEL: Record<Art, string> = {
  ausgangsrechnungen: 'Ausgangsrechnungen',
  eingangsbelege: 'Eingangsbelege',
  stammdaten: 'Personenkonten (Stammdaten)',
}

function eur(n: number | null | undefined) {
  return n == null ? '–' : fmtEur(Number(n))
}
function datumDe(iso: string | null | undefined) {
  if (!iso) return '–'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}.${m}.${y}`
}

export default function BmdClient({ overrides, protokoll, kategorien, offeneRechnungen, offeneAusgaben, darfMappingAendern, darfUebergeben }: {
  overrides: Record<string, string>
  protokoll: R[]
  kategorien: R[]
  offeneRechnungen: number
  offeneAusgaben: number
  darfMappingAendern: boolean
  darfUebergeben: boolean
}) {
  const [tab, setTab] = useState<Tab>('uebergabe')

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">BMD-Übergabe</span>
      </div>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-[-.01em] text-s112-text">BMD-Übergabe</h1>
        <p className="text-sm text-s112-muted mt-1">
          Ausgangsrechnungen, Eingangsbelege und Personenkonten als Buchungsstapel für BMD NTCS (Steuerberater) übergeben.
          software:112 bleibt Vorsystem - die doppelte Buchhaltung führt die Kanzlei.
        </p>
      </div>

      <div className="flex gap-1 border-b border-s112-border">
        {([
          ['uebergabe', 'Übergabe', Download],
          ['mapping', 'Konten-Mapping', Settings2],
          ['protokoll', 'Protokoll', History],
        ] as [Tab, string, typeof Download][]).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-s112-teal text-s112-blue-700' : 'border-transparent text-s112-text-2 hover:text-s112-text-1'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {tab === 'uebergabe' && <UebergabeTab offeneRechnungen={offeneRechnungen} offeneAusgaben={offeneAusgaben} darfUebergeben={darfUebergeben} />}
      {tab === 'mapping' && <MappingTab overrides={overrides} kategorien={kategorien} darfAendern={darfMappingAendern} />}
      {tab === 'protokoll' && <ProtokollTab protokoll={protokoll} />}
    </div>
  )
}

// ── Übergabe ────────────────────────────────────────────────────────────────
function UebergabeTab({ offeneRechnungen, offeneAusgaben, darfUebergeben }: { offeneRechnungen: number; offeneAusgaben: number; darfUebergeben: boolean }) {
  const heute = new Date()
  const [art, setArt] = useState<Art>('ausgangsrechnungen')
  const [von, setVon] = useState(new Date(heute.getFullYear(), heute.getMonth() - 1, 1).toISOString().slice(0, 10))
  const [bis, setBis] = useState(new Date(heute.getFullYear(), heute.getMonth(), 0).toISOString().slice(0, 10))
  const [nurNeue, setNurNeue] = useState(true)
  const [protokollieren, setProtokollieren] = useState(darfUebergeben)
  const [laden, setLaden] = useState(false)
  const [meldung, setMeldung] = useState<{ typ: 'ok' | 'fehler' | 'info'; text: string } | null>(null)

  async function starten() {
    setLaden(true); setMeldung(null)
    try {
      const p = new URLSearchParams({ art, von, bis, nurNeue: nurNeue ? '1' : '0', protokollieren: protokollieren ? '1' : '0' })
      const res = await fetch(`/api/export/bmd?${p.toString()}`)
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        setMeldung({ typ: res.status === 404 ? 'info' : 'fehler', text: j.fehler ?? `Fehler (${res.status})` })
        return
      }
      const blob = await res.blob()
      const dateiname = res.headers.get('X-BMD-Dateiname') ?? `BMD_${art}.csv`
      const anzahl = res.headers.get('X-BMD-Anzahl') ?? '?'
      const summe = Number(res.headers.get('X-BMD-Summe') ?? 0)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = dateiname; a.click(); URL.revokeObjectURL(url)
      setMeldung({
        typ: 'ok',
        text: art === 'stammdaten'
          ? `${anzahl} Personenkonten in ${dateiname} übergeben.`
          : `${anzahl} Belege (${eur(summe)} brutto) in ${dateiname} übergeben${protokollieren ? ' und im Protokoll vermerkt' : ''}.`,
      })
    } catch (e) {
      setMeldung({ typ: 'fehler', text: fehlerText(e, 'Fehler bei der Übergabe') })
    } finally {
      setLaden(false)
    }
  }

  const stammdaten = art === 'stammdaten'

  return (
    <div className="space-y-4">
      <div className="bg-white border border-s112-line rounded-xl p-[18px] space-y-5">
        <div>
          <p className="text-xs font-medium text-s112-text-2 mb-2">Was soll übergeben werden?</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(ART_LABEL) as Art[]).map(a => (
              <button key={a} onClick={() => setArt(a)}
                className={`rounded-xl border px-3 py-2.5 text-sm text-left transition-colors ${
                  art === a ? 'border-s112-teal bg-s112-teal/5 text-s112-text font-medium' : 'border-s112-border text-s112-text-2 hover:border-s112-line-str'}`}>
                {ART_LABEL[a]}
                <span className="block text-[11px] text-s112-muted font-normal mt-0.5">
                  {a === 'ausgangsrechnungen' && `Verkauf + manuelle Einnahmen · ${offeneRechnungen} Rechnungen offen`}
                  {a === 'eingangsbelege' && `Ausgaben der E&A-Rechnung · ${offeneAusgaben} offen`}
                  {a === 'stammdaten' && 'Debitoren / Kreditoren mit Adresse, UID, Zahlungsziel'}
                </span>
              </button>
            ))}
          </div>
        </div>

        {!stammdaten && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Belegdatum von</label>
              <input aria-label="Belegdatum von" type="date" value={von} onChange={e => setVon(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">bis</label>
              <input aria-label="bis" type="date" value={bis} onChange={e => setBis(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none" />
            </div>
          </div>
        )}

        {!stammdaten && (
          <div className="space-y-2 text-sm">
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={nurNeue} onChange={e => setNurNeue(e.target.checked)} className="mt-0.5" />
              <span>Nur noch nicht übergebene Belege <span className="text-s112-muted">(bereits übergebene werden übersprungen - verhindert Doppelbuchungen in BMD)</span></span>
            </label>
            <label className={`flex items-start gap-2 ${darfUebergeben ? 'cursor-pointer' : 'opacity-50'}`}>
              <input type="checkbox" checked={protokollieren} disabled={!darfUebergeben} onChange={e => setProtokollieren(e.target.checked)} className="mt-0.5" />
              <span>Übergabe protokollieren und Belege als „übergeben“ markieren <span className="text-s112-muted">(abwählen für einen Probelauf)</span></span>
            </label>
          </div>
        )}

        <button onClick={starten} disabled={laden || (!stammdaten && (!von || !bis))}
          className="w-full bg-s112-teal text-s112-yellow px-4 py-2.5 rounded-lg text-[13px] font-semibold hover:bg-s112-blue-700 disabled:opacity-40 inline-flex items-center justify-center gap-2">
          <Download size={16} />{laden ? 'Wird erstellt…' : `${ART_LABEL[art]} als BMD-CSV herunterladen`}
        </button>

        {meldung && (
          <p className={`text-sm inline-flex items-start gap-1.5 ${meldung.typ === 'ok' ? 'text-s112-ok-fg' : meldung.typ === 'info' ? 'text-s112-text-2' : 'text-s112-err-fg'}`}>
            {meldung.typ === 'ok' ? <CheckCircle2 size={15} className="mt-0.5 flex-shrink-0" /> : <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />}
            {meldung.text}
          </p>
        )}
      </div>

      <div className="bg-white border border-s112-line rounded-xl p-[18px] space-y-2 text-xs text-s112-muted">
        <p className="font-semibold text-s112-text-1 text-sm inline-flex items-center gap-1.5"><FileText size={14} />So kommt die Datei in BMD NTCS</p>
        <p>
          Die CSV ist ein Buchungsstapel im BMD-Standardformat (Strichpunkt, Dezimalkomma, Datum TT.MM.JJJJ) mit Kopfzeile
          <span className="font-mono"> satzart;konto;gkonto;belegnr;belegdatum;buchdatum;buchsymbol;buchcode;prozent;steuercode;betrag;steuer;text;…</span>.
          In BMD NTCS unter <em>FIBU → Buchen → Import → Buchungsimport (Standard)</em> einlesen; die Kanzlei kann die Spalten dort ihrem Import-Schema zuordnen.
        </p>
        <ul className="list-disc ml-4 space-y-1">
          <li>Ausgangsrechnungen: je Rechnung eine Zeile pro Erlöskonto/Steuersatz (Debitor an Erlös, Buchcode 1, Bruttobetrag + USt, Fälligkeit aus dem Zahlungsziel, Skonto-%).</li>
          <li>Eingangsbelege: Ausgaben aus der E&amp;A-Rechnung (Kreditor an Aufwandskonto der Kategorie, Buchcode 2, Vorsteuer; Belegdatei als Dokumentname).</li>
          <li>Personenkonten: Debitoren-/Kreditorennummern werden bei der ersten Übergabe automatisch vergeben und am Kunden/Lieferanten gespeichert - die Stammdaten-Datei liefert Name, Adresse, UID und Zahlungsziel dazu.</li>
          <li>Stornierte Rechnungen werden nicht übergeben.</li>
        </ul>
        <p className="text-s112-warn-fg font-medium mt-2 inline-flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          Konten und Steuercodes sind eine Vorbelegung nach dem Österreichischen Einheitskontenrahmen - bitte vor der ersten Übergabe mit dem Steuerberater abstimmen (Reiter „Konten-Mapping“).
        </p>
      </div>
    </div>
  )
}

// ── Konten-Mapping ──────────────────────────────────────────────────────────
function MappingTab({ overrides, kategorien, darfAendern }: { overrides: Record<string, string>; kategorien: R[]; darfAendern: boolean }) {
  const aufgeloest = useMemo(() => mappingAufloesen(overrides), [overrides])
  const [werte, setWerte] = useState<Record<string, string>>(() => ({ ...aufgeloest }))
  const [pending, startTransition] = useTransition()
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)

  const geaendert = MAPPING_FELDER.some(f => (werte[f.schluessel] ?? '') !== aufgeloest[f.schluessel])
  const abweichungen = MAPPING_FELDER.filter(f => (werte[f.schluessel] ?? '') !== f.standard).length

  function speichern() {
    setMeldung(null)
    startTransition(async () => {
      const r = await speichereKontenmapping(werte)
      setMeldung(r.ok ? { ok: true, text: 'Konten-Mapping gespeichert.' } : { ok: false, text: r.fehler ?? 'Fehler beim Speichern' })
    })
  }
  function zuruecksetzen() {
    if (!confirm('Alle Abweichungen löschen und die Vorbelegung wiederherstellen?')) return
    setMeldung(null)
    startTransition(async () => {
      const r = await setzeKontenmappingZurueck()
      if (r.ok) setWerte(mappingAufloesen({}))
      setMeldung(r.ok ? { ok: true, text: 'Vorbelegung wiederhergestellt.' } : { ok: false, text: r.fehler ?? 'Fehler' })
    })
  }

  const aufwand = kategorien.filter(k => k.typ !== 'einnahme')
  const ertrag  = kategorien.filter(k => k.typ !== 'ausgabe')

  return (
    <div className="space-y-4">
      <div className="bg-white border border-s112-line rounded-xl p-[18px] text-xs text-s112-muted space-y-1">
        <p className="text-s112-warn-fg font-medium inline-flex items-start gap-1.5">
          <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
          Vorbelegung nach dem Österreichischen Einheitskontenrahmen und den BMD-Standard-Steuercodes. Die Kanzlei des Mandanten kann abweichende Konten und Steuercodes führen - bitte vor der ersten Übergabe vom Steuerberater prüfen lassen.
        </p>
        <p>Es werden nur Abweichungen von der Vorbelegung gespeichert ({abweichungen} {abweichungen === 1 ? 'Abweichung' : 'Abweichungen'}). Abweichende Werte sind hervorgehoben.</p>
        {!darfAendern && <p className="text-s112-text-2">Änderungen sind Mandanten-Administratoren vorbehalten.</p>}
      </div>

      {MAPPING_GRUPPEN.map(g => (
        <div key={g.key} className="bg-white border border-s112-line rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-s112-border bg-[#F7F8FA]">
            <p className="font-display text-sm font-semibold text-s112-text">{g.label}</p>
          </div>
          <table className="w-full text-sm">
            <tbody>
              {MAPPING_FELDER.filter(f => f.gruppe === g.key).map(f => {
                const wert = werte[f.schluessel] ?? ''
                const weicht = wert !== f.standard
                return (
                  <tr key={f.schluessel} className="border-b border-s112-border last:border-0">
                    <td className="px-5 py-2.5 align-top">
                      <span className="text-s112-text">{f.label}</span>
                      {f.hinweis && <span className="block text-[11px] text-s112-muted">{f.hinweis}</span>}
                    </td>
                    <td className="px-3 py-2 w-40 align-top">
                      <input value={wert} disabled={!darfAendern}
                        onChange={e => setWerte(w => ({ ...w, [f.schluessel]: e.target.value }))}
                        placeholder={f.standard || '(leer)'}
                        className={`w-full border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none disabled:bg-s112-bg ${
                          weicht ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-border'}`} />
                    </td>
                    <td className="px-3 py-2.5 w-28 text-[11px] text-s112-muted align-top whitespace-nowrap">
                      {weicht ? <>Vorbelegung: <span className="font-mono">{f.standard || '(leer)'}</span></> : ''}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}

      {darfAendern && (
        <div className="flex items-center gap-3">
          <button onClick={speichern} disabled={pending || !geaendert}
            className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-lg text-[13px] font-semibold hover:bg-s112-blue-700 disabled:opacity-40">
            {pending ? 'Speichert…' : 'Konten-Mapping speichern'}
          </button>
          <button onClick={zuruecksetzen} disabled={pending || abweichungen === 0}
            className="inline-flex items-center gap-1.5 text-sm text-s112-text-2 hover:text-s112-text disabled:opacity-40">
            <RotateCcw size={14} />Auf Vorbelegung zurücksetzen
          </button>
          {meldung && <span className={`text-sm ${meldung.ok ? 'text-s112-ok-fg' : 'text-s112-err-fg'}`}>{meldung.text}</span>}
        </div>
      )}

      <div className="bg-white border border-s112-line rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-s112-border bg-[#F7F8FA] flex items-center justify-between">
          <p className="font-display text-sm font-semibold text-s112-text">Aufwands- und Ertragskonten der E&amp;A-Kategorien</p>
          <Link href="/buchhaltung/kategorien" className="text-xs text-s112-blue-700 hover:underline">Kategorien verwalten →</Link>
        </div>
        <div className="px-5 py-3 text-xs text-s112-muted">
          Eingangsbelege werden auf die Kontonummer ihrer E&amp;A-Kategorie gebucht, manuelle Einnahmen auf das Konto ihrer Einnahmen-Kategorie.
          Kategorien ohne Kontonummer landen auf dem Fallback-Konto (siehe „Sonstiges“).
        </div>
        <div className="grid grid-cols-2 gap-x-6 px-5 pb-4 text-xs">
          <div>
            <p className="font-medium text-s112-text-1 mb-1">Ausgaben</p>
            {aufwand.map(k => (
              <div key={k.id} className="flex justify-between py-0.5 border-b border-dashed border-s112-border last:border-0">
                <span className="text-s112-text-1 truncate">{k.name}</span>
                <span className={`font-mono ${k.konto_nr ? 'text-s112-text' : 'text-s112-warn-fg'}`}>{k.konto_nr ?? 'Fallback'}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="font-medium text-s112-text-1 mb-1">Einnahmen</p>
            {ertrag.map(k => (
              <div key={k.id} className="flex justify-between py-0.5 border-b border-dashed border-s112-border last:border-0">
                <span className="text-s112-text-1 truncate">{k.name}</span>
                <span className={`font-mono ${k.konto_nr ? 'text-s112-text' : 'text-s112-warn-fg'}`}>{k.konto_nr ?? 'Fallback'}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Protokoll ───────────────────────────────────────────────────────────────
function ProtokollTab({ protokoll }: { protokoll: R[] }) {
  if (protokoll.length === 0) {
    return <div className="bg-white border border-s112-line rounded-xl p-[18px] text-sm text-s112-muted">Noch keine Übergabe protokolliert. Übergaben mit aktivem „protokollieren“ erscheinen hier.</div>
  }
  return (
    <div className="bg-white border border-s112-line rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-[#F7F8FA] text-xs text-s112-text-2">
          <tr>
            <th className="text-left px-4 py-2 font-medium">Übergeben am</th>
            <th className="text-left px-4 py-2 font-medium">Art</th>
            <th className="text-left px-4 py-2 font-medium">Zeitraum</th>
            <th className="text-right px-4 py-2 font-medium">Belege</th>
            <th className="text-right px-4 py-2 font-medium">Brutto</th>
            <th className="text-left px-4 py-2 font-medium">Datei</th>
          </tr>
        </thead>
        <tbody>
          {protokoll.map(p => (
            <tr key={p.id} className="border-t border-s112-border">
              <td className="px-4 py-2 whitespace-nowrap">{new Date(p.erstellt_am).toLocaleString('de-AT', { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td className="px-4 py-2">{ART_LABEL[p.art as Art] ?? p.art}{p.nur_neue === false && <span className="ml-1 text-[11px] text-s112-muted">(alle)</span>}</td>
              <td className="px-4 py-2 whitespace-nowrap">{p.zeitraum_von ? `${datumDe(p.zeitraum_von)} – ${datumDe(p.zeitraum_bis)}` : '–'}</td>
              <td className="px-4 py-2 text-right">{p.anzahl}</td>
              <td className="px-4 py-2 text-right">{eur(p.summe_brutto)}</td>
              <td className="px-4 py-2 font-mono text-[12px] text-s112-text-2">{p.dateiname}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
