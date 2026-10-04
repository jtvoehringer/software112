'use client'

import { useEffect, useState, useTransition } from 'react'
import { createVerschneidung, verschnittVorschau, type VerschnittVorschau } from '@/app/(dashboard)/kellerbuch/actions'
import { sortenverschnittBezeichnung, SCHWELLE } from '@/lib/wein/sortenangabe'
import { qualitaetText } from '@/lib/weinqualitaet'
import { istAbstufungQualitaet, mischeQualitaet, normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import { HERKUNFT_LABEL, istNiedrigerAls as herkunftIstNiedrigerAls, minHerkunft } from '@/lib/herkunft'
import { GitMerge, AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum, dezimal } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'

type ChargeOpt = { id: string; name: string; menge_liter: number | null; qualitaetsstufe?: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null; herkunft_code?: string | null; rebsorte?: string | null; weinart?: string | null; behaelter_id?: string | null; behaelter_volumen_liter?: number | null }

// Weinart-Kompatibilität: Rot+Weiß ist nicht zulässig
function weinartKompatibel(a: string | null | undefined, b: string | null | undefined): boolean {
  const gegensaetze: [string, string][] = [['rot', 'weiss']]
  if (!a || !b || a === 'unbekannt' || b === 'unbekannt') return true
  return !gegensaetze.some(([x, y]) => (a === x && b === y) || (a === y && b === x))
}

interface Props {
  zielCharge: ChargeOpt
  alleChargen: ChargeOpt[]
  onDone: () => void
  initialQuelleId?:    string
  initialQuelleMenge?: string
}

export default function VerschneidungForm({ zielCharge, alleChargen, onDone, initialQuelleId, initialQuelleMenge }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [qualitaetAbgestufInfo, setQualitaetAbgestufInfo] = useState<{ von: string; nach: string } | null>(null)
  const [herkunftAbgestufInfo, setHerkunftAbgestufInfo] = useState<{ von: string; nach: string } | null>(null)
  // KAN-93: Rebsorte/Jahrgang entfällt oder wechselt (vom Server aus den tatsächlichen Anteilen)
  const [sortenHinweise, setSortenHinweise] = useState<string[]>([])
  const [quellen, setQuellen] = useState<{ weinausbau_id: string; menge: string }[]>(
    initialQuelleId
      ? [{ weinausbau_id: initialQuelleId, menge: initialQuelleMenge ?? '' }]
      : [{ weinausbau_id: '', menge: '' }]
  )

  const verfuegbar = alleChargen.filter(c => c.id !== zielCharge.id)
  const [datum, setDatum] = useState(() => new Date().toISOString().split('T')[0])

  // KAN-111: Vorschau vom Server – dieselbe Rechnung wie beim Buchen (Herkunft nach § 21 WeinG aus den tatsächlichen
  // Anteilen, Qualität samt Deckel aus der Herkunft); ohne Vorschau bleibt die einfache Rechnung im Browser
  // Ergebnis je Schlüssel gemerkt – eine veraltete Vorschau (andere Quellen/Mengen) zählt nicht
  const [vorschau, setVorschau] = useState<{ schluessel: string; v: VerschnittVorschau } | null>(null)
  const vorschauSchluessel = JSON.stringify([datum, quellen
    .map(q => ({ weinausbau_id: q.weinausbau_id, menge_liter: parseFloat(dezimal(q.menge)) }))
    .filter(q => q.weinausbau_id && q.menge_liter > 0)])
  useEffect(() => {
    const [d, qs] = JSON.parse(vorschauSchluessel) as [string, unknown[]]
    if (qs.length === 0) return
    let aktuell = true
    const t = setTimeout(() => {
      const fd = new FormData()
      fd.set('datum', d)
      fd.set('ziel_weinausbau_id', zielCharge.id)
      fd.set('quellen_json', JSON.stringify(qs))
      verschnittVorschau(fd)
        .then(v => { if (aktuell) setVorschau({ schluessel: vorschauSchluessel, v }) })
        .catch(() => { if (aktuell) setVorschau(null) })
    }, 400)
    return () => { aktuell = false; clearTimeout(t) }
  }, [vorschauSchluessel, zielCharge.id])
  const vorschauOk = vorschau && vorschau.schluessel === vorschauSchluessel && !('fehler' in vorschau.v) ? vorschau.v : null

  function addQuelle() { setQuellen(q => [...q, { weinausbau_id: '', menge: '' }]) }
  function removeQuelle(i: number) { setQuellen(q => q.filter((_, idx) => idx !== i)) }
  function updateQuelle(i: number, field: 'weinausbau_id' | 'menge', val: string) {
    setQuellen(q => q.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }

  const gesamtLiter = quellen.reduce((s, q) => {
    const n = parseFloat(dezimal(q.menge))
    return s + (isNaN(n) ? 0 : n)
  }, 0)

  // ── Rebsorten-Preview (85%-Regel) ────────────────────────────────────────
  const rebsortenPreview = (() => {
    const zielMenge = parseFloat(String(zielCharge.menge_liter ?? 0)) || 0
    const total = zielMenge + gesamtLiter
    if (total === 0 || gesamtLiter === 0) return null

    // Wenn Rebsorten fehlen: Charge-Name als Fallback verwenden.
    // Viele Chargen wurden vor dem Pressung-Fix ohne rebsorte angelegt; der Name
    // (z.B. „Gelber Muskateller") entspricht aber der Rebsorte.
    // Kein Abbruch – Berechnung läuft mit bestem verfügbarem Wert weiter.
    // KAN-93: Vorschau nach den Rebsorten der Chargen; beim Buchen zählt die tatsächliche Zusammensetzung
    // (Herkunftsanteile, auch schon enthaltene andere Sorten) – Abweichungen meldet der Server danach.

    const anteile: Record<string, number> = {}
    // Ziel-Rebsorte: wie bei Quellen Fallback auf Namen wenn rebsorte fehlt
    const zielRebsorte = zielCharge.rebsorte ?? zielCharge.name
    if (zielRebsorte && zielMenge > 0) {
      anteile[zielRebsorte] = (anteile[zielRebsorte] ?? 0) + zielMenge
    }
    for (const q of quellen) {
      const src = verfuegbar.find(c => c.id === q.weinausbau_id)
      const menge = parseFloat(dezimal(q.menge))
      if (!src || isNaN(menge) || menge <= 0) continue
      // Rebsorte der Quelle – fehlt sie, Charge-Name als Näherungswert verwenden
      // (Chargen aus Pressung tragen oft den Rebsortennamen als Bezeichnung)
      const rebsorte = src.rebsorte ?? src.name
      if (rebsorte) {
        anteile[rebsorte] = (anteile[rebsorte] ?? 0) + menge
      }
    }
    const dominante = Object.entries(anteile).sort((a, b) => b[1] - a[1])[0]
    const anteilPct = dominante && total > 0 ? Math.round(dominante[1] / total * 1000) / 10 : 0
    if (anteilPct >= 100) return { typ: 'unveraendert' as const, anteilPct, rebsorte: dominante![0] }
    if (dominante && dominante[1] / total >= SCHWELLE - 1e-9)  return { typ: 'bezeichnungsunschaedlich' as const, anteilPct, rebsorte: dominante[0] }
    return { typ: 'sortenverschnitt' as const, anteilPct: null, rebsorte: null }
  })()

  // Qualitäts-Abstufungs-Check
  const selectedChargen = quellen
    .map(q => verfuegbar.find(c => c.id === q.weinausbau_id))
    .filter(Boolean) as ChargeOpt[]
  // KAN-186: Qualitätsangabe samt Zusatzbezeichnung und Erzeugnis (Altwerte normalisiert) – dieselbe Regel wie der Server
  const zielAngabe = normalisiereQualitaet(zielCharge)
  const alleQualitaeten = [zielAngabe, ...selectedChargen.map(c => normalisiereQualitaet(c))]
  // Ergebnis der Mischung aller beteiligten Chargen
  const abstufungsZiel = selectedChargen.length > 0 ? (vorschauOk ? normalisiereQualitaet(vorschauOk) : mischeQualitaet(alleQualitaeten)) : null
  // Charge liegt über dem Ergebnis → sie verliert durch die Verschneidung Stufe bzw. Zusatzbezeichnung
  const wirdAbgestuft = (c: ChargeOpt) => abstufungsZiel != null && istAbstufungQualitaet(normalisiereQualitaet(c), abstufungsZiel)
  const hatAbstufung = abstufungsZiel != null && (wirdAbgestuft(zielCharge) || selectedChargen.some(wirdAbgestuft))
  // Herkunft-Code-Abstufungs-Check (analog Qualität) – nur Abstufungen möglich, nie Aufstufungen
  const alleHerkuenfte = [
    zielCharge.herkunft_code,
    ...selectedChargen.map(c => c.herkunft_code),
  ]
  const herkunftAbstufungsZiel = selectedChargen.length > 0 ? (vorschauOk ? vorschauOk.herkunft_code : minHerkunft(alleHerkuenfte)) : null
  const hatHerkunftAbstufung = herkunftAbstufungsZiel != null && (
    herkunftIstNiedrigerAls(zielCharge.herkunft_code ?? null, herkunftAbstufungsZiel) ||
    selectedChargen.some(c => herkunftIstNiedrigerAls(c.herkunft_code ?? null, herkunftAbstufungsZiel))
  )
  const herkunftBetroffeneChargen = selectedChargen.length > 0 ? [
    ...(herkunftIstNiedrigerAls(zielCharge.herkunft_code ?? null, herkunftAbstufungsZiel ?? '') ? [zielCharge.name] : []),
    ...selectedChargen
      .filter(c => herkunftIstNiedrigerAls(c.herkunft_code ?? null, herkunftAbstufungsZiel ?? ''))
      .map(c => c.name),
  ] : []

  // Weinart-Konflikte: Rot+Weiß – KAN-193 (Entscheidung Jörgen 03.10.2026): zulässig mit Abstufung auf Wein (aus
  // Österreich); der Server fragt beim Speichern nach
  const weinartKonflikte = selectedChargen.filter(
    c => !weinartKompatibel(zielCharge.weinart, c.weinart)
  )
  const hatWeinartFehler = weinartKonflikte.length > 0

  // Welche Chargen werden abgestuft?
  const betroffeneChargen = selectedChargen.length > 0 ? [
    ...(wirdAbgestuft(zielCharge) ? [zielCharge.name] : []),
    ...selectedChargen
      .filter(wirdAbgestuft)
      .map(c => c.name),
  ] : []

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const parsed = quellen
      .map(q => ({ weinausbau_id: q.weinausbau_id, menge_liter: parseFloat(dezimal(q.menge)) }))
      .filter(q => q.weinausbau_id && !isNaN(q.menge_liter) && q.menge_liter > 0)
    if (parsed.length === 0) { setError('Mindestens eine Quell-Charge mit Menge angeben.'); return }
    const fd = new FormData(e.currentTarget)
    fd.set('quellen_json', JSON.stringify(parsed))
    fd.set('ziel_weinausbau_id', zielCharge.id)
    startTransition(async () => {
      try {
        let result = await createVerschneidung(fd)
        // KAN-83: Prüfnummer der Ziel-Charge erlischt – nur nach ausdrücklicher Bestätigung buchen
        if (result?.bestaetigung) {
          if (!window.confirm(result.bestaetigung)) return
          fd.set('pn_bestaetigt', '1')
          fd.set('rotweiss_bestaetigt', '1')   // KAN-193: Rückfrage Rot/Weiß steht in derselben Bestätigung
          result = await createVerschneidung(fd)
        }
        if (result?.qualitaetAbgestuft || result?.herkunftAbgestuft || (result?.sortenHinweise?.length ?? 0) > 0 || result?.rotWeiss) {
          setQualitaetAbgestufInfo(result.qualitaetAbgestuft ?? null)
          setHerkunftAbgestufInfo(result.herkunftAbgestuft ?? null)
          setSortenHinweise([...(result.rotWeiss ? ['Abstufung auf Wein (aus Österreich) – Verschnitt Rot/Weiß'] : []), ...(result.sortenHinweise ?? [])])
        } else {
          onDone()
        }
      } catch (err) {
        setError(fehlerText(err))
      }
    })
  }

  const inputCls = 'border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  // Qualitäts-/Herkunft-Abstufung nach erfolgreichem Speichern
  if (qualitaetAbgestufInfo || herkunftAbgestufInfo || sortenHinweise.length > 0) {
    return (
      <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl p-5 space-y-3">
        <div className="flex items-start gap-3">
          <AlertTriangle size={22} strokeWidth={1.75} className="text-s112-warn-fg shrink-0" />
          <div className="space-y-1">
            <p className="font-semibold text-s112-warn-fg text-sm">Verschneidung gespeichert – {qualitaetAbgestufInfo || herkunftAbgestufInfo ? 'Abstufung erfolgt' : 'Angaben angepasst'}</p>
            {sortenHinweise.map(h => <p key={h} className="text-sm text-s112-warn-fg">{h}.</p>)}
            {qualitaetAbgestufInfo && (
              <p className="text-sm text-s112-warn-fg">
                Qualität: von{' '}
                <strong>{qualitaetAbgestufInfo.von}</strong>
                {' '}auf{' '}
                <strong>{qualitaetAbgestufInfo.nach}</strong>
                {' '}abgestuft.
              </p>
            )}
            {herkunftAbgestufInfo && (
              <p className="text-sm text-s112-warn-fg">
                Herkunft-Code (BKI): von{' '}
                <strong>{HERKUNFT_LABEL[herkunftAbgestufInfo.von] ?? herkunftAbgestufInfo.von}</strong>
                {' '}auf{' '}
                <strong>{HERKUNFT_LABEL[herkunftAbgestufInfo.nach] ?? herkunftAbgestufInfo.nach}</strong>
                {' '}abgestuft.
              </p>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onDone}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 transition-colors"
        >
          Schließen
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-blue-50/40 border border-s112-blue-100 rounded-xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <GitMerge size={17} strokeWidth={1.75} className="text-s112-text-1" />
        <h3 className="text-sm font-semibold text-s112-text">Verschneidung in <span className="text-s112-blue-700">{zielCharge.name}</span></h3>
        {zielAngabe.stufe && (
          <span className="text-xs bg-white border border-s112-blue-100 text-s112-blue-700 px-2 py-0.5 rounded-full">
            {qualitaetText(zielAngabe)}
          </span>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
        <input aria-label="Datum" name="datum" type="date" required
          value={datum} onChange={e => setDatum(e.target.value)}
          className={`${inputCls} w-48`} />
      </div>

      {/* Quell-Chargen */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-s112-text-2">Quell-Chargen</label>
        {quellen.map((q, i) => {
          const src = verfuegbar.find(c => c.id === q.weinausbau_id)
          const menge = parseFloat(dezimal(q.menge))
          const anteil = gesamtLiter > 0 && !isNaN(menge) ? Math.round(menge / gesamtLiter * 1000) / 10 : null
          // KAN-74: dieselbe Rangfolge wie der Server (vorher Index in QUALITAET_ORDER – DAC lag dort über TBA)
          const isNiederwertig = !!src && istAbstufungQualitaet(zielAngabe, normalisiereQualitaet(src))
          return (
            <div key={i} className="flex items-center gap-2">
              <select
                value={q.weinausbau_id}
                onChange={e => updateQuelle(i, 'weinausbau_id', e.target.value)}
                className={`${inputCls} flex-1`}
              >
                <option value="">– Charge wählen –</option>
                {verfuegbar.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.name}{c.menge_liter != null ? ` (${fmtNum(c.menge_liter)} L)` : ''}
                    {c.rebsorte ? ` · ${formatRebsorteMitKuerzel(c.rebsorte)}` : ''}
                    {c.qualitaetsstufe ? ` · ${qualitaetText(c)}` : ''}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1">
                <input
                  type="text" inputMode="decimal" placeholder="Liter"
                  value={q.menge}
                  onChange={e => updateQuelle(i, 'menge', e.target.value)}
                  className={`${inputCls} w-28 ${isNiederwertig ? 'border-s112-warn/50' : ''}`}
                />
                {anteil != null && (
                  <span className="text-xs text-s112-blue-700 font-medium w-14 text-right tabular-nums">{anteil} %</span>
                )}
                {src && <span className="text-xs text-s112-muted w-10 tabular-nums">max {(src.menge_liter == null ? undefined : fmtNum(src.menge_liter))}</span>}
              </div>
              {quellen.length > 1 && (
                <button aria-label="Quelle entfernen" type="button" onClick={() => removeQuelle(i)}
                  className="text-s112-err hover:text-s112-err-fg px-1"><X size={15} strokeWidth={2} /></button>
              )}
            </div>
          )
        })}
        <button type="button" onClick={addQuelle}
          className="text-xs text-s112-blue-700 hover:underline font-medium">
          + Weitere Quelle
        </button>
      </div>

      {/* Qualitäts-Abstufungs-Warnung */}
      {hatAbstufung && abstufungsZiel && (
        <div className="flex items-start gap-2 bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2.5 text-sm">
          <AlertTriangle size={15} strokeWidth={1.75} className="text-s112-warn-fg mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-s112-warn-fg">Qualitätsabstufung auf {qualitaetText(abstufungsZiel)}</p>
            <p className="text-xs text-s112-warn-fg mt-0.5">
              {betroffeneChargen.length > 0
                ? <>Folgende Chargen verlieren ihre Qualitätsbezeichnung: <strong>{betroffeneChargen.join(', ')}</strong></>
                : <>Der Verschnitt wird auf <strong>{qualitaetText(abstufungsZiel)}</strong> abgestuft.</>
              }
            </p>
          </div>
        </div>
      )}

      {/* Herkunft-Code-Abstufungs-Warnung */}
      {hatHerkunftAbstufung && herkunftAbstufungsZiel && (
        <div className="flex items-start gap-2 bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2.5 text-sm">
          <AlertTriangle size={15} strokeWidth={1.75} className="text-s112-warn-fg mt-0.5 shrink-0" />
          <div>
            <p className="font-medium text-s112-warn-fg">Herkunft-Code-Abstufung auf {HERKUNFT_LABEL[herkunftAbstufungsZiel] ?? herkunftAbstufungsZiel}</p>
            <p className="text-xs text-s112-warn-fg mt-0.5">
              {herkunftBetroffeneChargen.length > 0
                ? <>Folgende Chargen verlieren ihren Herkunft-Code: <strong>{herkunftBetroffeneChargen.join(', ')}</strong></>
                : <>Der Verschnitt wird auf <strong>{HERKUNFT_LABEL[herkunftAbstufungsZiel] ?? herkunftAbstufungsZiel}</strong> abgestuft.</>
              }
            </p>
          </div>
        </div>
      )}

      {/* KAN-111: Hinweise der Vorschau (Herkunftsregel, Qualität aus der Herkunft, Ried im Chargennamen, Sortenangabe) */}
      {vorschauOk && vorschauOk.hinweise.length > 0 && (
        <div className="flex items-start gap-2 bg-s112-bg border border-s112-border rounded-lg px-3 py-2.5 text-sm">
          <Info size={15} strokeWidth={1.75} className="text-s112-muted mt-0.5 shrink-0" />
          <div className="space-y-0.5">
            <p className="font-medium text-s112-text">Vorschau</p>
            {vorschauOk.hinweise.map(h => <p key={h} className="text-xs text-s112-text-2">{h}</p>)}
          </div>
        </div>
      )}

      {/* Rebsortenmix-Warnung */}
      {(() => {
        const zielRebsorte = zielCharge.rebsorte
        const quellenMitAndererRebsorte = selectedChargen.filter(
          c => c.rebsorte && zielRebsorte && c.rebsorte !== zielRebsorte
        )
        if (quellenMitAndererRebsorte.length === 0) return null
        return (
          <div className="flex items-start gap-2 bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2.5 text-sm">
            <AlertTriangle size={15} strokeWidth={1.75} className="text-s112-warn-fg mt-0.5 shrink-0" />
            <div>
              <p className="font-medium text-s112-warn-fg">Rebsortenverschnitt</p>
              <p className="text-xs text-s112-warn-fg mt-0.5">
                Ziel-Charge: <strong>{formatRebsorteMitKuerzel(zielRebsorte)}</strong> –
                Quelle{quellenMitAndererRebsorte.length > 1 ? 'n' : ''}{' '}
                <strong>{quellenMitAndererRebsorte.map(c => `${c.name} (${formatRebsorteMitKuerzel(c.rebsorte)})`).join(', ')}</strong>{' '}
                {quellenMitAndererRebsorte.length > 1 ? 'haben' : 'hat'} eine andere Rebsorte.
                Die Mischung gilt als Sortenverschnitt.
              </p>
            </div>
          </div>
        )
      })()}

      {/* Gebinde-Kapazität Ziel */}
      {(() => {
        if (zielCharge.behaelter_volumen_liter == null) return null
        const vol = zielCharge.behaelter_volumen_liter
        // Alle Chargen im selben Gebinde + zielCharge selbst
        const inhaltGesamt = (alleChargen
          .filter(c => c.behaelter_id != null && c.behaelter_id === zielCharge.behaelter_id)
          .reduce((s, c) => s + (parseFloat(String(c.menge_liter)) || 0), 0))
          + (parseFloat(String(zielCharge.menge_liter ?? 0)) || 0)
        const restJetzt = vol - inhaltGesamt
        // Nur Quell-Chargen aus ANDEREN Gebinden bringen neues Volumen rein.
        // Quell-Chargen aus DEMSELBEN Gebinde werden nur zusammengeführt – kein neues Volumen.
        const neuZufluss = quellen.reduce((s, q) => {
          const src = verfuegbar.find(c => c.id === q.weinausbau_id)
          const m   = parseFloat(dezimal(q.menge))
          if (!src || isNaN(m) || m <= 0) return s
          if (src.behaelter_id != null && src.behaelter_id === zielCharge.behaelter_id) return s
          return s + m
        }, 0)
        const restNach  = vol - inhaltGesamt - neuZufluss
        const ueber     = neuZufluss > 0 && restNach < -0.01
        return (
          <div className="grid grid-cols-3 gap-2 bg-s112-bg border border-s112-border rounded-lg px-4 py-2.5 text-xs">
            <div>
              <p className="text-s112-muted mb-0.5">Kapazität Gebinde</p>
              <p className="font-medium tabular-nums">{fmtNum(vol)} L</p>
            </div>
            <div>
              <p className="text-s112-muted mb-0.5">Inhalt jetzt</p>
              <p className="font-medium tabular-nums">{fmtNum(inhaltGesamt, { max: 1 })} L</p>
            </div>
            <div>
              <p className="text-s112-muted mb-0.5">{gesamtLiter > 0 ? 'Rest nach Verschnitt' : 'Restkapazität'}</p>
              <p className={`font-medium tabular-nums ${ueber ? 'text-s112-err-fg' : 'text-s112-blue-700'}`}>
                {fmtNum((gesamtLiter > 0 ? restNach : restJetzt), { max: 1 })} L
              </p>
            </div>
            {ueber && (
              <p className="col-span-3 text-s112-err-fg font-medium inline-flex items-center gap-1">
                <AlertTriangle size={13} strokeWidth={2} />Ziel-Gebinde hat nicht genug Kapazität für diesen Verschnitt
              </p>
            )}
          </div>
        )
      })()}

      {gesamtLiter > 0 && (
        <p className="text-xs text-s112-blue-700 bg-s112-blue-50 border border-s112-blue-100 rounded-lg px-3 py-2">
          Gesamt zufließend: <strong>{fmtNum(gesamtLiter, { max: 1 })} L</strong>
          {' → '}Zielbestand: <strong>{fmtNum((parseFloat(String(zielCharge.menge_liter ?? 0)) + gesamtLiter), { max: 1 })} L</strong>
        </p>
      )}

      {/* Rebsorten-Ergebnis-Preview */}
      {rebsortenPreview && (
        <div className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm border ${
          rebsortenPreview.typ === 'unveraendert'
            ? 'bg-s112-ok-bg border-s112-ok/30 text-s112-ok-fg'
            : rebsortenPreview.typ === 'bezeichnungsunschaedlich'
            ? 'bg-s112-blue-50 border-s112-blue-100 text-s112-blue-700'
            : 'bg-s112-warn-bg border-s112-warn/30 text-s112-warn-fg'
        }`}>
          <span className="mt-0.5 shrink-0">
            {rebsortenPreview.typ === 'unveraendert'
              ? <CheckCircle2 size={16} strokeWidth={1.75} className="text-s112-ok-fg" />
              : rebsortenPreview.typ === 'bezeichnungsunschaedlich'
              ? <Info size={16} strokeWidth={1.75} className="text-s112-blue-700" />
              : <AlertTriangle size={16} strokeWidth={1.75} className="text-s112-warn-fg" />}
          </span>
          <div>
            {rebsortenPreview.typ === 'unveraendert' && (
              <p className="font-medium">Rebsorte bleibt unverändert ({formatRebsorteMitKuerzel(rebsortenPreview.rebsorte)})</p>
            )}
            {rebsortenPreview.typ === 'bezeichnungsunschaedlich' && (
              <>
                <p className="font-medium">Bezeichnungsunschädlicher Verschnitt – Rebsorte bleibt unverändert</p>
                <p className="text-xs mt-0.5">
                  <strong>{formatRebsorteMitKuerzel(rebsortenPreview.rebsorte)}</strong> macht {rebsortenPreview.anteilPct} % aus (≥ 85 %)
                </p>
              </>
            )}
            {rebsortenPreview.typ === 'sortenverschnitt' && (
              <>
                <p className="font-medium">Sortenverschnitt – Rebsorte wird auf „{sortenverschnittBezeichnung(zielCharge.weinart)}“ gesetzt</p>
                <p className="text-xs mt-0.5">Keine Rebsorte erreicht 85 % Anteil</p>
              </>
            )}
          </div>
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
        <input aria-label="Notizen" name="notizen" className={`${inputCls} w-full`} placeholder="optional" />
      </div>

      {/* Weinart: Rot+Weiß nur mit Abstufung auf Wein (aus Österreich) – KAN-193 */}
      {hatWeinartFehler && (
        <div className="flex items-start gap-2 bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2.5 text-sm">
          <AlertTriangle size={16} strokeWidth={1.75} className="text-s112-warn-fg mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-s112-warn-fg">Rot- und Weißwein – Abstufung auf Wein (aus Österreich)</p>
            <p className="text-xs text-s112-warn-fg mt-0.5">
              Das Ergebnis wird auf „Wein (aus Österreich)“ abgestuft (Farbe nach der Mehrheit der Liter); beim Speichern folgt eine Rückfrage.
              Betroffene Chargen: <strong>{weinartKonflikte.map(c => c.name).join(', ')}</strong>
            </p>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Verschneidung speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}
