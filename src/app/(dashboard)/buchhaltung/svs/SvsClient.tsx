'use client'

import { useMemo, useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { AlertTriangle, CheckCircle2, Calculator, Table2, Upload, Settings2 } from 'lucide-react'
import { vergleiche, ZURECHNUNG_LABEL, type SvsParameter, type Zurechnung } from '@/lib/svs/berechnung'
import { speichereEinheitswerte, importiereEinheitswerte, speichereSvsOption, speichereSvsParameter } from './actions'
import { fmtNum, dezimal } from '@/lib/format'
import CsvExportKnopf from '@/components/CsvExportKnopf'

type Gst = {
  id: string; gst_nr: string; katastralgemeinde: string; kg_bezeichnung: string; einlagezahl: string
  flaeche_ha: number | null; nutzart: string; rechtsverhaeltnis: string
  einheitswert: number | null; einheitswert_bescheid: string | null; einheitswert_quelle: string | null
  svs_zurechnung: string; ried: string
}
type Option = { svs_option: 'pauschal' | 'option'; svs_option_seit: string | null; svs_einkuenfte_manuell: number | null; svs_kv_angehoerige: boolean }
type Tab = 'beitraege' | 'einheitswerte' | 'import' | 'parameter'

const eur = (n: number, d = 2) => `€ ${n.toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d })}` // CD: Tausenderpunkt, zwei Nachkommastellen
const ZUR: Zurechnung[] = ['eigen', 'pacht_fremd', 'pacht_angehoerige', 'verpachtet', 'keine']

export default function SvsClient({ grundstuecke, parameter, jahr, option, einkuenfteVorjahr, darfSchreiben, darfOption, darfParameter, doppik, csvHref }: {
  grundstuecke: Gst[]; parameter: SvsParameter[]; jahr: number; option: Option
  einkuenfteVorjahr: { jahr: number; betrag: number; buchungen: boolean }
  darfSchreiben: boolean; darfOption: boolean; darfParameter: boolean; doppik: boolean
  /** Behördenmeldung „svs-einheitswerte“ (CSV, Format wie der Import) */
  csvHref: string
}) {
  const [tab, setTab] = useState<Tab>('beitraege')
  const [gst, setGst] = useState<Gst[]>(grundstuecke)
  const [opt, setOpt] = useState<Option>(option)
  const param = parameter.find(p => p.jahr === jahr) ?? parameter[0] ?? null

  const einkuenfte = opt.svs_einkuenfte_manuell ?? (einkuenfteVorjahr.buchungen && !doppik ? einkuenfteVorjahr.betrag : null)
  const v = useMemo(() => param ? vergleiche(gst, param, { einkuenfteJahr: einkuenfte, kvAngehoerige: opt.svs_kv_angehoerige }) : null, [gst, param, einkuenfte, opt.svs_kv_angehoerige])

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/buchhaltung/uebersicht" className="hover:text-s112-blue-700 transition-colors">Finanzübersicht</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">SV-Beiträge (SVS)</span>
      </div>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-[-.01em] text-s112-text">SV-Beiträge (SVS)</h1>
        <p className="text-sm text-s112-muted mt-1">
          Bäuerliche Sozialversicherung: Beitragsgrundlage aus den Einheitswerten der Grundstücke (Pauschalsystem) oder aus den Einkünften (Beitragsgrundlagenoption) – und welche Variante für den Betrieb günstiger ist.
        </p>
      </div>

      <div className="flex gap-1 border-b border-s112-border">
        {([
          ['beitraege', 'Beiträge & Vergleich', Calculator],
          ['einheitswerte', 'Einheitswerte je Grundstück', Table2],
          ['import', 'Import', Upload],
          ...(darfParameter ? [['parameter', 'SVS-Parameter', Settings2]] : []),
        ] as [Tab, string, typeof Calculator][]).map(([key, label, Icon]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab === key ? 'border-s112-teal text-s112-blue-700' : 'border-transparent text-s112-text-2 hover:text-s112-text-1'}`}>
            <Icon size={15} />{label}
          </button>
        ))}
      </div>

      {!param && <div className="bg-white border border-s112-line rounded-xl p-[18px] text-sm text-s112-warn-fg">Für {jahr} sind noch keine SVS-Parameter hinterlegt – bitte den Plattform-Admin verständigen.</div>}

      {tab === 'beitraege' && param && v && (
        <BeitraegeTab v={v} p={param} jahr={jahr} opt={opt} setOpt={setOpt} einkuenfteVorjahr={einkuenfteVorjahr} einkuenfte={einkuenfte} darfOption={darfOption} doppik={doppik} onZuEinheitswerten={() => setTab('einheitswerte')} />
      )}
      {tab === 'einheitswerte' && <EinheitswerteTab gst={gst} setGst={setGst} darfSchreiben={darfSchreiben} csvHref={csvHref} />}
      {tab === 'import' && <ImportTab darfSchreiben={darfSchreiben} />}
      {tab === 'parameter' && darfParameter && <ParameterTab parameter={parameter} jahr={jahr} />}
    </div>
  )
}

// ── Beiträge & Vergleich ────────────────────────────────────────────────────
function BeitraegeTab({ v, p, opt, setOpt, einkuenfteVorjahr, einkuenfte, darfOption, doppik, onZuEinheitswerten }: {
  v: NonNullable<ReturnType<typeof vergleiche>>; p: SvsParameter; jahr: number; opt: Option; setOpt: (o: Option) => void
  einkuenfteVorjahr: { jahr: number; betrag: number; buchungen: boolean }; einkuenfte: number | null; darfOption: boolean; doppik: boolean; onZuEinheitswerten: () => void
}) {
  const [pending, start] = useTransition()
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)
  const [manuell, setManuell] = useState<string>(opt.svs_einkuenfte_manuell === null ? '' : String(opt.svs_einkuenfte_manuell))
  const [wahl, setWahl] = useState<'pauschal' | 'option'>(opt.svs_option)
  const [kvAng, setKvAng] = useState(opt.svs_kv_angehoerige)

  function speichern() {
    setMeldung(null)
    const m = manuell.trim() === '' ? null : parseFloat(dezimal(manuell))
    start(async () => {
      const r = await speichereSvsOption({ svs_option: wahl, svs_einkuenfte_manuell: m, svs_kv_angehoerige: kvAng, svs_option_seit: opt.svs_option_seit })
      if (r.ok) { setOpt({ ...opt, svs_option: wahl, svs_einkuenfte_manuell: m, svs_kv_angehoerige: kvAng }); setMeldung({ ok: true, text: 'Gespeichert.' }) }
      else setMeldung({ ok: false, text: r.fehler ?? 'Fehler' })
    })
  }
  const ew = v.einheitswert
  const guenstiger = v.option ? (v.ersparnisOptionJahr! > 0 ? 'option' : 'pauschal') : null

  return (
    <div className="space-y-4">
      {ew.ohneWert > 0 && (
        <p className="text-sm text-s112-warn-fg inline-flex items-start gap-1.5"><AlertTriangle size={15} className="mt-0.5 shrink-0" />
          {ew.ohneWert} {ew.ohneWert === 1 ? 'Grundstück hat' : 'Grundstücke haben'} noch keinen Einheitswert – die Beitragsgrundlage ist deshalb unvollständig. <button onClick={onZuEinheitswerten} className="underline">Einheitswerte erfassen</button>
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Pauschal */}
        <div className={`bg-white border border-s112-line rounded-xl p-[18px] space-y-3 ${opt.svs_option === 'pauschal' ? 'ring-1 ring-s112-teal' : ''}`}>
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Pauschalsystem (Einheitswert)</h2>
            {opt.svs_option === 'pauschal' && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-s112-blue-700">gewählt</span>}
          </div>
          <table className="w-full text-sm">
            <tbody>
              <Z k="Einheitswert Eigentum" v={eur(ew.eigen)} />
              <Z k="Zupachtung Angehörige (voll)" v={eur(ew.pachtAngehoerige)} />
              <Z k="Zupachtung Fremde (2/3)" v={`${eur(ew.pachtFremd)} → ${eur(ew.pachtFremd * 2 / 3)}`} />
              <Z k="Verpachtet (Abzug)" v={ew.verpachtet ? `− ${eur(ew.verpachtet)}` : '–'} />
              <Z k="Massgebender Einheitswert" v={eur(ew.massgebend)} fett />
              <Z k="Versicherungswert (Staffel)" v={`${eur(v.versicherungswert)} / Monat`} fett />
              <Z k="Beitragsgrundlage" v={`${eur(v.pauschal.beitragsgrundlage)}${v.pauschal.begrenzt === 'min' ? ' (Mindest)' : v.pauschal.begrenzt === 'max' ? ' (Höchst)' : ''}`} />
            </tbody>
          </table>
          <BeitragsZeilen b={v.pauschal} p={p} />
        </div>

        {/* Option */}
        <div className={`bg-white border border-s112-line rounded-xl p-[18px] space-y-3 ${opt.svs_option === 'option' ? 'ring-1 ring-s112-teal' : ''}`}>
          <div className="flex items-center justify-between">
            <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Beitragsgrundlagenoption (Einkünfte)</h2>
            {opt.svs_option === 'option' && <span className="text-[10.5px] font-semibold uppercase tracking-wide text-s112-blue-700">gewählt{opt.svs_option_seit ? ` seit ${opt.svs_option_seit.split('-').reverse().join('.')}` : ''}</span>}
          </div>
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Einkünfte aus Land- und Forstwirtschaft lt. Einkommensteuerbescheid {einkuenfteVorjahr.jahr} (Jahr)</label>
            <input inputMode="decimal" aria-label="Einkünfte aus Land- und Forstwirtschaft (Jahr)" value={manuell} onChange={e => setManuell(e.target.value)} disabled={!darfOption}
              placeholder={einkuenfteVorjahr.buchungen && !doppik ? `Vorschlag aus E&A ${einkuenfteVorjahr.jahr}: ${eur(einkuenfteVorjahr.betrag, 0)}` : 'z. B. 28.500'}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-hidden disabled:bg-s112-bg" />
            <p className="text-[11px] text-s112-muted mt-1">
              {doppik ? 'Bei Doppik beim Steuerberater bitte den Wert aus dem Einkommensteuerbescheid eintragen.' : `Leer = Ergebnis der E&A-Rechnung ${einkuenfteVorjahr.jahr} als Näherung. Der Bescheidwert weicht meist ab (Pauschalierung, Abschreibungen).`}
            </p>
          </div>
          {v.option ? (
            <>
              <table className="w-full text-sm">
                <tbody>
                  <Z k="Einkünfte + bezahlte KV/PV-Beiträge" v={`${eur(einkuenfte ?? 0, 0)} + ${eur((v.pauschal.pv + v.pauschal.kv) * 12, 0)}`} />
                  <Z k="Beitragsgrundlage (÷ 12)" v={`${eur(v.option.beitragsgrundlage)}${v.option.begrenzt === 'min' ? ' (Mindest)' : v.option.begrenzt === 'max' ? ' (Höchst)' : ''}`} fett />
                </tbody>
              </table>
              <BeitragsZeilen b={v.option} p={p} />
            </>
          ) : (
            <p className="text-sm text-s112-muted">Ohne Einkünfte keine Vergleichsrechnung möglich.</p>
          )}
        </div>
      </div>

      {/* meldung-ausnahme: Vergleichskachel der SVS-Option, grün = günstiger – keine Meldung */}
      {v.option && (
        <div className={`bg-white border border-s112-line rounded-xl p-[18px] flex items-start gap-3 ${guenstiger === 'option' ? 'bg-s112-ok-bg' : 'bg-s112-bg'}`}>
          <CheckCircle2 size={20} className="text-s112-blue-700 mt-0.5 shrink-0" />
          <div className="text-sm">
            <p className="font-semibold text-s112-text">
              {Math.abs(v.ersparnisOptionJahr!) < 1
                ? 'Beide Varianten liegen gleichauf.'
                : guenstiger === 'option'
                  ? `Die Beitragsgrundlagenoption wäre um ${eur(v.ersparnisOptionJahr!, 0)} pro Jahr günstiger.`
                  : `Das Pauschalsystem ist um ${eur(-v.ersparnisOptionJahr!, 0)} pro Jahr günstiger.`}
            </p>
            <p className="text-s112-muted mt-1">
              Pauschal {eur(v.pauschal.monat)} / Monat ({eur(v.pauschal.jahr, 0)} / Jahr) · Option {eur(v.option.monat)} / Monat ({eur(v.option.jahr, 0)} / Jahr).
              Der Antrag auf die Option ist bis 30. April des Folgejahres bei der SVS zu stellen; eine Rückkehr ins Pauschalsystem ist nur bei wesentlichen Änderungen möglich.
            </p>
          </div>
        </div>
      )}

      <div className="bg-white border border-s112-line rounded-xl p-[18px] space-y-3">
        <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Wahl des Betriebs</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([['pauschal', 'Pauschalsystem – Beitragsgrundlage vom Einheitswert'], ['option', 'Beitragsgrundlagenoption – Beitragsgrundlage von den Einkünften']] as const).map(([k, l]) => (
            <label key={k} className={`flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${wahl === k ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-border'} ${darfOption ? 'cursor-pointer' : 'opacity-70'}`}>
              <input type="radio" checked={wahl === k} disabled={!darfOption} onChange={() => setWahl(k)} className="mt-0.5" />
              <span>{l}</span>
            </label>
          ))}
        </div>
        <label className={`flex items-center gap-2 text-sm ${darfOption ? 'cursor-pointer' : 'opacity-70'}`}>
          <input type="checkbox" checked={kvAng} disabled={!darfOption} onChange={e => setKvAng(e.target.checked)} />
          Zusatzbeitrag Krankenversicherung für mitversicherte Angehörige ({fmtNum(p.satz_kv_zusatz)} %)
        </label>
        {darfOption ? (
          <div className="flex items-center gap-3">
            <button onClick={speichern} disabled={pending} className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">{pending ? 'Speichert…' : 'Speichern'}</button>
            {meldung && <span className={`text-sm ${meldung.ok ? 'text-s112-ok-fg' : 'text-s112-err-fg'}`}>{meldung.text}</span>}
          </div>
        ) : <p className="text-xs text-s112-muted">Die Wahl trifft der Betriebs-Manager.</p>}
        <p className="text-xs text-s112-warn-fg inline-flex items-start gap-1.5"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
          Orientierungsrechnung mit den SVS-Sätzen {p.jahr}{p.hinweis ? ` – ${p.hinweis}` : ''}. Verbindlich ist der Beitragsbescheid der SVS; Entscheidung zur Option bitte mit SVS oder Steuerberater abstimmen.
        </p>
      </div>
    </div>
  )
}

function Z({ k, v, fett }: { k: string; v: string; fett?: boolean }) {
  return (
    <tr className="border-b border-s112-border/60 last:border-0">
      <td className={`py-1.5 pr-2 ${fett ? 'font-medium text-s112-text' : 'text-s112-text-2'}`}>{k}</td>
      <td className={`py-1.5 text-right font-mono ${fett ? 'font-semibold text-s112-text' : 'text-s112-text'}`}>{v}</td>
    </tr>
  )
}

function BeitragsZeilen({ b, p }: { b: NonNullable<ReturnType<typeof vergleiche>>['pauschal']; p: SvsParameter }) {
  return (
    <table className="w-full text-sm border-t border-s112-border pt-2">
      <tbody>
        <Z k={`Pensionsversicherung ${fmtNum(p.satz_pv)} %`} v={eur(b.pv)} />
        <Z k={`Krankenversicherung ${fmtNum(p.satz_kv)} %`} v={eur(b.kv)} />
        <Z k={`Unfallversicherung ${fmtNum(p.satz_uv)} % (Grundlage ${eur(b.bgUv, 0)})`} v={eur(b.uv)} />
        <Z k={`Betriebshilfe ${fmtNum(p.satz_bh)} %`} v={eur(b.bh)} />
        {b.kvZusatz > 0 && <Z k={`Zusatzbeitrag KV Angehörige ${fmtNum(p.satz_kv_zusatz)} %`} v={eur(b.kvZusatz)} />}
        <Z k="Beitrag pro Monat" v={eur(b.monat)} fett />
        <Z k="Beitrag pro Jahr" v={eur(b.jahr, 0)} fett />
      </tbody>
    </table>
  )
}

// ── Einheitswerte je Grundstück ─────────────────────────────────────────────
function EinheitswerteTab({ gst, setGst, darfSchreiben, csvHref }: { gst: Gst[]; setGst: (g: Gst[]) => void; darfSchreiben: boolean; csvHref: string }) {
  const [pending, start] = useTransition()
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState('')

  function aendere(id: string, patch: Partial<Gst>) {
    setGst(gst.map(g => g.id === id ? { ...g, ...patch } : g))
    setDirty(new Set([...dirty, id]))
  }
  function speichern() {
    setMeldung(null)
    const zeilen = gst.filter(g => dirty.has(g.id)).map(g => ({ id: g.id, einheitswert: g.einheitswert, svs_zurechnung: g.svs_zurechnung, einheitswert_bescheid: g.einheitswert_bescheid }))
    start(async () => {
      const r = await speichereEinheitswerte(zeilen)
      if (r.ok) { setDirty(new Set()); setMeldung({ ok: true, text: `${zeilen.length} Grundstücke gespeichert.` }) } else setMeldung({ ok: false, text: r.fehler ?? 'Fehler' })
    })
  }
  const sichtbar = gst.filter(g => !filter || `${g.katastralgemeinde} ${g.kg_bezeichnung} ${g.gst_nr} ${g.ried}`.toLowerCase().includes(filter.toLowerCase()))
  const summe = gst.reduce((s, g) => s + (g.einheitswert ?? 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter: KG, GST-Nr., Ried" className="border border-s112-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-hidden" />
        <div className="flex items-center gap-3 text-sm flex-wrap">
          <span className="text-s112-muted">{gst.length} Grundstücke · Summe Einheitswert {eur(summe, 0)}</span>
          <CsvExportKnopf href={csvHref} label={dirty.size > 0 ? 'CSV (gespeicherter Stand)' : 'CSV exportieren'} />
          {darfSchreiben && <button onClick={speichern} disabled={pending || dirty.size === 0} className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">{pending ? 'Speichert…' : `Speichern (${dirty.size})`}</button>}
          {meldung && <span className={meldung.ok ? 'text-s112-ok-fg' : 'text-s112-err-fg'}>{meldung.text}</span>}
        </div>
      </div>
      <div className="bg-white border border-s112-line rounded-xl overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-s112-bg text-xs text-s112-text-2">
            <tr>
              <th className="text-left px-3 py-2 font-medium">KG</th>
              <th className="text-left px-3 py-2 font-medium">GST-Nr.</th>
              <th className="text-left px-3 py-2 font-medium">Ried</th>
              <th className="text-right px-3 py-2 font-medium">ha</th>
              <th className="text-left px-3 py-2 font-medium">eAMA</th>
              <th className="text-left px-3 py-2 font-medium">SVS-Zurechnung</th>
              <th className="text-right px-3 py-2 font-medium">Einheitswert €</th>
              <th className="text-left px-3 py-2 font-medium">Bescheid</th>
            </tr>
          </thead>
          <tbody>
            {sichtbar.map(g => (
              <tr key={g.id} className={`border-t border-s112-border ${dirty.has(g.id) ? 'bg-s112-teal/5' : ''}`}>
                <td className="px-3 py-1.5 whitespace-nowrap">{g.kg_bezeichnung || g.katastralgemeinde}{g.kg_bezeichnung && g.katastralgemeinde ? <span className="text-s112-muted"> {g.katastralgemeinde}</span> : ''}</td>
                <td className="px-3 py-1.5 font-mono">{g.gst_nr}</td>
                <td className="px-3 py-1.5 text-s112-text-2">{g.ried}</td>
                <td className="px-3 py-1.5 text-right font-mono text-s112-text-2">{g.flaeche_ha === null ? '–' : fmtNum(g.flaeche_ha, { min: 2, max: 4 })}</td>
                <td className="px-3 py-1.5 text-s112-text-2 text-xs">{[g.nutzart, g.rechtsverhaeltnis].filter(Boolean).join(' · ')}</td>
                <td className="px-3 py-1.5">
                  <select value={g.svs_zurechnung} disabled={!darfSchreiben} onChange={e => aendere(g.id, { svs_zurechnung: e.target.value })}
                    className="border border-s112-border rounded-lg px-2 py-1 text-xs bg-white disabled:bg-s112-bg">
                    {ZUR.map(z => <option key={z} value={z}>{ZURECHNUNG_LABEL[z]}</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5 text-right">
                  <input type="number" step="0.01" min="0" value={g.einheitswert ?? ''} disabled={!darfSchreiben}
                    onChange={e => aendere(g.id, { einheitswert: e.target.value === '' ? null : parseFloat(e.target.value) })}
                    className="w-28 border border-s112-border rounded-lg px-2 py-1 text-sm font-mono text-right focus:outline-hidden disabled:bg-s112-bg" />
                </td>
                <td className="px-3 py-1.5">
                  <input type="date" value={g.einheitswert_bescheid ?? ''} disabled={!darfSchreiben} onChange={e => aendere(g.id, { einheitswert_bescheid: e.target.value || null })}
                    className="border border-s112-border rounded-lg px-2 py-1 text-xs focus:outline-hidden disabled:bg-s112-bg" />
                  {g.einheitswert_quelle === 'import' && <span className="ml-1 text-[11px] text-s112-muted">Import</span>}
                </td>
              </tr>
            ))}
            {sichtbar.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-s112-muted">Keine Grundstücke{filter ? ' zum Filter' : ' – bitte zuerst Rieden und Grundstücke anlegen (Weingarten)'}.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-s112-muted">
        Der Einheitswert steht im Einheitswertbescheid des Finanzamts bzw. in der SVS-Beitragsvorschreibung. Zupachtungen von Fremden zählen mit zwei Dritteln, von nahen Angehörigen voll; verpachtete Flächen werden abgezogen. Die eAMA-Spalte zeigt Nutzart und Rechtsverhältnis aus dem Import – die SVS-Zurechnung wurde daraus vorbelegt (Pacht → Zupachtung von Fremden) und ist hier zu prüfen.
      </p>
    </div>
  )
}

// ── Import ──────────────────────────────────────────────────────────────────
function ImportTab({ darfSchreiben }: { darfSchreiben: boolean }) {
  const [text, setText] = useState('')
  const [datum, setDatum] = useState('')
  const [pending, start] = useTransition()
  const [ergebnis, setErgebnis] = useState<{ ok: boolean; text: string; details?: string[] } | null>(null)

  async function datei(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setText(await f.text())
  }
  function los() {
    setErgebnis(null)
    start(async () => {
      const r = await importiereEinheitswerte(text, datum || null)
      if (!r.ok) { setErgebnis({ ok: false, text: r.fehler ?? 'Fehler' }); return }
      const details: string[] = []
      if (r.nichtGefunden?.length) details.push(`Nicht gefunden: ${r.nichtGefunden.slice(0, 20).join(', ')}${r.nichtGefunden.length > 20 ? ' …' : ''}`)
      if (r.mehrdeutig?.length) details.push(`Mehrdeutig (KG angeben): ${r.mehrdeutig.join(', ')}`)
      setErgebnis({ ok: true, text: `${r.uebernommen} Einheitswerte übernommen.`, details })
      if (r.uebernommen) setText('')
    })
  }
  return (
    <div className="space-y-4 max-w-2xl">
      <div className="bg-white border border-s112-line rounded-xl p-[18px] space-y-3 text-sm">
        <p className="text-s112-text-1">Datei aus SVS-Vorschreibung, Einheitswertbescheid oder eigener Excel-Liste: CSV mit Kopfzeile (Strichpunkt, Tab oder Komma). Erkannt werden die Spalten <span className="font-mono">KG</span> (optional), <span className="font-mono">GST</span>, <span className="font-mono">Einheitswert</span>, optional <span className="font-mono">Bescheid</span> (Datum) und <span className="font-mono">Zurechnung</span> (eigen / pacht / angehoerige / verpachtet / keine). Zuordnung über KG + GST-Nummer.</p>
        <pre className="bg-s112-bg border border-s112-border rounded-lg p-3 text-xs overflow-x-auto">KG;GST;Einheitswert;Bescheid;Zurechnung{'\n'}16108;1234/2;3.450,00;01.01.2024;eigen{'\n'}16108;1235;1.120,50;;pacht</pre>
        <div className="flex items-center gap-3 flex-wrap">
          <input type="file" accept=".csv,.txt,.tsv" onChange={datei} disabled={!darfSchreiben} className="text-sm" />
          <label className="text-xs text-s112-text-2">Bescheid-Datum (wenn nicht in der Datei) <input type="date" value={datum} onChange={e => setDatum(e.target.value)} className="ml-1 border border-s112-border rounded-lg px-2 py-1 text-xs" /></label>
        </div>
        <textarea value={text} onChange={e => setText(e.target.value)} rows={8} disabled={!darfSchreiben} placeholder="… oder Inhalt hier einfügen"
          className="w-full border border-s112-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden disabled:bg-s112-bg" />
        <div className="flex items-center gap-3">
          <button onClick={los} disabled={pending || !text.trim() || !darfSchreiben} className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">{pending ? 'Importiert…' : 'Einheitswerte importieren'}</button>
          {ergebnis && <span className={`text-sm ${ergebnis.ok ? 'text-s112-ok-fg' : 'text-s112-err-fg'}`}>{ergebnis.text}</span>}
        </div>
        {ergebnis?.details?.map((d, i) => <p key={i} className="text-xs text-s112-warn-fg">{d}</p>)}
      </div>
    </div>
  )
}

// ── SVS-Parameter (Plattform-Admin) ─────────────────────────────────────────
function ParameterTab({ parameter, jahr }: { parameter: SvsParameter[]; jahr: number }) {
  const basis = parameter.find(p => p.jahr === jahr) ?? parameter[0]
  const [form, setForm] = useState({
    jahr: String(basis?.jahr ?? jahr),
    staffel: JSON.stringify(basis?.staffel ?? [], null, 0),
    satz_pv: String(basis?.satz_pv ?? 17), satz_kv: String(basis?.satz_kv ?? 6.8), satz_uv: String(basis?.satz_uv ?? 1.9), satz_bh: String(basis?.satz_bh ?? 0.4), satz_kv_zusatz: String(basis?.satz_kv_zusatz ?? 3.4),
    min_bg_kv_pv: String(basis?.min_bg_kv_pv ?? ''), min_bg_uv: String(basis?.min_bg_uv ?? ''), hoechst_bg: String(basis?.hoechst_bg ?? ''), hinweis: basis?.hinweis ?? '',
  })
  const [pending, start] = useTransition()
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null)
  const num = (s: string) => parseFloat(dezimal(s))
  function speichern() {
    setMeldung(null)
    let staffel: { bis: number | null; prozent: number }[]
    try { staffel = JSON.parse(form.staffel) } catch { setMeldung({ ok: false, text: 'Staffel ist kein gültiges JSON' }); return }
    start(async () => {
      const r = await speichereSvsParameter({ jahr: parseInt(form.jahr), staffel, satz_pv: num(form.satz_pv), satz_kv: num(form.satz_kv), satz_uv: num(form.satz_uv), satz_bh: num(form.satz_bh), satz_kv_zusatz: num(form.satz_kv_zusatz), min_bg_kv_pv: num(form.min_bg_kv_pv), min_bg_uv: num(form.min_bg_uv), hoechst_bg: num(form.hoechst_bg), hinweis: form.hinweis || null })
      setMeldung(r.ok ? { ok: true, text: 'Parameter gespeichert.' } : { ok: false, text: r.fehler ?? 'Fehler' })
    })
  }
  const feld = (k: keyof typeof form, label: string) => (
    <div>
      <label className="block text-xs font-medium text-s112-text-2 mb-1">{label}</label>
      <input value={form[k]} onChange={e => setForm({ ...form, [k]: e.target.value })} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-hidden" />
    </div>
  )
  return (
    <div className="bg-white border border-s112-line rounded-xl p-[18px] space-y-4 max-w-3xl">
      <p className="text-sm text-s112-muted">Plattformweite Werte je Jahr aus der SVS-Beitragstabelle (gültig ab 1. Jänner). Vorhandene Jahre: {parameter.map(p => p.jahr).join(', ') || '–'}.</p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {feld('jahr', 'Jahr')}{feld('satz_pv', 'PV %')}{feld('satz_kv', 'KV %')}{feld('satz_uv', 'UV %')}
        {feld('satz_bh', 'Betriebshilfe %')}{feld('satz_kv_zusatz', 'Zusatz KV Angehörige %')}{feld('min_bg_kv_pv', 'Mindest-BG KV/PV')}{feld('min_bg_uv', 'Mindest-BG UV')}
        {feld('hoechst_bg', 'Höchst-BG')}
      </div>
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Staffel Versicherungswert (JSON: bis = obere Einheitswertgrenze, prozent = Einkommensfaktor; letzte Stufe bis null)</label>
        <textarea aria-label="Staffel Versicherungswert (JSON: bis = obere Einheitswertgrenze, prozent = Einkommensfaktor; letzte Stufe bis null)" value={form.staffel} onChange={e => setForm({ ...form, staffel: e.target.value })} rows={4} className="w-full border border-s112-border rounded-lg px-3 py-2 text-xs font-mono focus:outline-hidden" />
      </div>
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Hinweis (Quelle)</label>
        <input aria-label="Hinweis (Quelle)" value={form.hinweis} onChange={e => setForm({ ...form, hinweis: e.target.value })} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden" />
      </div>
      <div className="flex items-center gap-3">
        <button onClick={speichern} disabled={pending} className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">{pending ? 'Speichert…' : 'Parameter speichern'}</button>
        {meldung && <span className={`text-sm ${meldung.ok ? 'text-s112-ok-fg' : 'text-s112-err-fg'}`}>{meldung.text}</span>}
      </div>
    </div>
  )
}
