'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2, X, ChevronDown, Plus } from 'lucide-react'
import { upsertPressung, deletePressung } from '../actions'
import { fmtProzent, fmtNum, dezimal } from '@/lib/format'
import { kmwZuQualitaet, QUALITAET_LABEL } from '@/lib/weinqualitaet'
import VerschneidungForm from '@/components/kellerbuch/VerschneidungForm'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fehlerText } from '@/lib/fehler'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import { messwertText, mostgewichtAusGespeichert, type GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import type { Mostgewicht } from '@/lib/wein/mostgewicht'
import { datumText, lesedatumFehler, lesetageFuerOrt, vorbelegterLesetag, type LeseEintrag, type Lesetag } from '@/lib/wein/pressungLesedatum'

// ── Types ─────────────────────────────────────────────────────────────────────

export type PressungWG = {
  id: string; weingarten_id: string | null; weingarten_name: string
  grundstueck_id?: string | null
  // Alternative Quelle: zugekaufte Trauben (statt eigener Ernte). Genau eines
  // von weingarten_id/zukauf_posten_id ist gesetzt (siehe Migration 141).
  zukauf_posten_id?: string | null
  trauben_kg: number; rebsorte: string | null; notizen: string | null
  /** KAN-126: Lesetag und Mostgewicht der Traubenzeile */
  ernte_datum: string | null; kmw: number | null; oechsle: number | null; mostgewicht_einheit: string | null
}
// Zugekaufte Trauben (zukauf_posten, art='trauben'), die als zusätzliche Quelle
// für Pressung und Traubenverkauf zur Verfügung stehen (verfuegbar_kg = Menge
// abzüglich bereits verpresster/verkaufter Anteile dieses Zukaufs).
export type ZukaufTraubenOpt = {
  id: string; datum: string; lieferant: string
  rebsorte: string | null; herkunft: string | null
  menge_kg: number; verfuegbar_kg: number
  // °KMW, wie beim Zukauf erfasst (zukauf_posten.kmw) – soll in die Pressung übernommen
  // werden können, da zugekaufte Trauben keine eigene Lese-Parzelle mit klosterneuburger
  // haben und daher sonst nicht in den gewichteten KMW-Durchschnitt einfließen.
  kmw_grad: number | null
  // Messwert und Einheit des Zukaufs (KAN-128) – Vorbelegung beim Traubenverkauf aus dem Zukauf
  oechsle?: number | null
  mostgewicht_einheit?: string | null
}
export type PressungBeh = {
  id: string; behaelter_id: string | null; behaelter_name: string | null
  weinausbau_id: string | null; weinausbau_name: string | null
  menge_liter: number | null; notizen: string | null
}
export type Pressung = {
  id: string; datum: string; most_liter_gesamt: number | null
  weinbezeichnung: string | null; notizen: string | null; kmw_grad: number | null
  weingaerten: PressungWG[]; behaelter: PressungBeh[]
}
export type WGOption  = { id: string; name: string; rebsorte: string | null }
export type BehOption = { id: string; name: string; volumen_liter?: number | null }
export type WAOption  = { id: string; name: string; jahrgang: number | null }
export type LeseParzelle = {
  weingarten_id: string; weingarten_name: string
  grundstueck_id: string | null; grundstueck_nr: string | null; grundstueck_rebsorte: string | null
  menge_kg: number | null; rebsorte: string | null; klosterneuburger?: number | null
}

// ── Hilfsfunktionen ───────────────────────────────────────────────────────────

const ROT_REBSORTEN = new Set([
  'Zweigelt','Blaufränkisch','St. Laurent','Blauer Portugieser','Blauburger',
  'Cabernet Sauvignon','Merlot','Syrah','Shiraz','Pinot Noir','Blauburgunder',
  'Regent','Dornfelder','Lemberger','Primitivo','Sangiovese','Tempranillo',
])
function weinfarbe(rebsorte: string | null): 'rot' | 'weiß' | null {
  if (!rebsorte) return null
  if (ROT_REBSORTEN.has(rebsorte)) return 'rot'
  const l = rebsorte.toLowerCase()
  if (l.startsWith('blau') || l.includes('noir') || l.includes('schwarz')) return 'rot'
  return 'weiß'
}

const fmt = (n: number | null) =>
  n == null ? '–' : fmtNum(n, { max: 1 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

// ── Pressung-Formular ─────────────────────────────────────────────────────────

// id = ID der gespeicherten Zeile (pressung_weingaerten/pressung_behaelter), '' für neue Zeilen.
// KAN-35: Der Server ändert bestehende Zeilen gezielt statt alles neu anzulegen – die IDs
// müssen deshalb mitgeschickt werden.
// KAN-126: ernte_datum (Lesetag), mg (Mostgewicht der Zeile), mgStart (Vorbelegung für die Eingabe), mgFehler
type WGRow  = {
  id: string; weingarten_id: string; grundstueck_id: string; zukauf_posten_id: string; trauben_kg: string; rebsorte: string; notizen: string
  ernte_datum: string; mg: Mostgewicht | null; mgStart: GespeichertesMostgewicht | null; mgFehler: string | null
}
type BehRow = { id: string; behaelter_id: string; weinausbau_id: string; weinausbau_name: string; menge_liter: string; notizen: string }

const emptyWG  = (): WGRow  => ({ id: '', weingarten_id: '', grundstueck_id: '', zukauf_posten_id: '', trauben_kg: '', rebsorte: '', notizen: '', ernte_datum: '', mg: null, mgStart: null, mgFehler: null })
/** Mostgewicht eines Lesetags bzw. Zukaufs als Vorbelegung */
const mgAusTag = (t: { kmw: number | null; oechsle?: number | null; einheit?: string | null } | null): GespeichertesMostgewicht | null =>
  t && (t.kmw != null || t.oechsle != null) ? { kmw: t.kmw, oechsle: t.oechsle ?? null, einheit: t.einheit ?? null } : null
const emptyBeh = (): BehRow => ({ id: '', behaelter_id: '', weinausbau_id: '', weinausbau_name: '', menge_liter: '', notizen: '' })

function Fehlermeldung({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">
      <span className="flex-1 whitespace-pre-line">{text}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Meldung schließen" className="shrink-0 hover:opacity-70"><X size={14} /></button>
      )}
    </div>
  )
}

function PressungForm({ jahrgangId, pressung, wgOptions, behOptions, waOptions, leseParzellen, leseEintraege, verfuegbareKgByGST, zukaufTrauben, behaelterMitCharge, onDone }: {
  jahrgangId: string; pressung?: Pressung
  wgOptions: WGOption[]; behOptions: BehOption[]; waOptions: WAOption[]
  leseParzellen: LeseParzelle[]; leseEintraege: LeseEintrag[]; verfuegbareKgByGST: Record<string, number>
  zukaufTrauben: ZukaufTraubenOpt[]
  behaelterMitCharge?: Record<string, { weinausbau_id: string; name: string; rebsorte?: string | null; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]>; onDone: () => void
}) {
  const [datum, setDatum]                   = useState(pressung?.datum ?? new Date().toISOString().split('T')[0])
  const [mostLiter, setMostLiter]           = useState(pressung?.most_liter_gesamt?.toString().replace('.', ',') ?? '')
  const [weinbezeichnung, setWeinbez]       = useState(pressung?.weinbezeichnung ?? '')
  const [notizen, setNotizen]               = useState(pressung?.notizen ?? '')

  // Pre-fill aus Erntedaten: eine Zeile pro Parzelle (GST oder Ried)
  // Verfügbare kg direkt per GST-ID (kein proportionales Verteilen mehr)
  function gstVerfuegbar(gstId: string | null): number {
    return gstId ? (verfuegbareKgByGST[gstId] ?? 0) : 0
  }

  const defaultWGRows: WGRow[] = pressung
    ? pressung.weingaerten.map(w => ({
        id: w.id,
        weingarten_id: w.weingarten_id ?? '', grundstueck_id: w.grundstueck_id ?? '',
        zukauf_posten_id: w.zukauf_posten_id ?? '',
        trauben_kg: w.trauben_kg.toString().replace('.', ','),
        rebsorte: w.rebsorte ?? '', notizen: w.notizen ?? '',
        ernte_datum: w.ernte_datum ?? '',
        mg: mostgewichtAusGespeichert({ kmw: w.kmw, oechsle: w.oechsle, einheit: w.mostgewicht_einheit }),
        mgStart: mgAusTag({ kmw: w.kmw, oechsle: w.oechsle, einheit: w.mostgewicht_einheit }),
        mgFehler: null,
      }))
    // Kein Vorbelegen mehr mit allen verfügbaren GST/Zukauf-Posten (vorher: "abmelden"
    // nicht gewünschter Trauben per X). Stattdessen startet die Pressung leer - die
    // pressbaren Trauben werden aktiv über das Dropdown "angemeldet" (ausgewählt);
    // die Menge (kg) wird dabei automatisch mit der vollen verfügbaren Menge vorbefüllt
    // (siehe updateWG), kann aber vor dem Speichern reduziert werden.
    : [emptyWG()]
  const [wgRows, setWgRows] = useState<WGRow[]>(defaultWGRows)
  const [behRows, setBehRows] = useState<BehRow[]>(
    pressung?.behaelter.map(b => ({
      id: b.id,
      behaelter_id: b.behaelter_id ?? '', weinausbau_id: b.weinausbau_id ?? '',
      weinausbau_name: b.weinausbau_name ?? '',
      menge_liter: b.menge_liter?.toString().replace('.', ',') ?? '', notizen: b.notizen ?? '',
    })) ?? [emptyBeh()]
  )
  const [fehler, setFehler] = useState<string | null>(null)

  function entferneBehRow(i: number) {
    const row = behRows[i]
    // Bestehende Zeile mit Kellerbuch-Charge: die Charge wird beim Speichern mitgelöscht
    // (nur ohne Folgebuchungen möglich – sonst lehnt der Server ab)
    if (row?.id && row.weinausbau_id
      && !confirm(`Beim Speichern wird auch die daraus entstandene Kellerbuch-Charge „${row.weinausbau_name || 'ohne Namen'}“ gelöscht. Das geht nur, solange an ihr noch keine Folgebuchungen hängen. Fortfahren?`)) return
    setBehRows(r => r.filter((_, j) => j !== i))
  }

  // KMW gewichteter Durchschnitt aus den AUSGEWÄHLTEN WG-Zeilen (reaktiv zu wgRows).
  // Berücksichtigt sowohl eigene Lese-Parzellen (klosterneuburger aus leseParzellen) als
  // auch zugekaufte Trauben (kmw_grad aus zukaufTrauben, beim Zukauf erfasst) – vorher
  // wurden Zukauf-Zeilen (kein weingarten_id) hier komplett übergangen und der KMW-Wert
  // blieb bei reinen Zukauf-Pressungen immer leer, obwohl er beim Zukauf erfasst worden war.
  const kmwFromWgRows = (() => {
    let sumKg = 0, sumKmw = 0
    for (const row of wgRows) {
      const kg = parseFloat(dezimal(row.trauben_kg)) || 0
      if (kg <= 0) continue
      if (row.mg) {
        sumKg  += kg
        sumKmw += row.mg.kmw * kg
        continue
      }
      if (row.zukauf_posten_id) {
        const zukauf = zukaufTrauben.find(z => z.id === row.zukauf_posten_id)
        if (zukauf?.kmw_grad != null) {
          sumKg  += kg
          sumKmw += zukauf.kmw_grad * kg
        }
        continue
      }
      const parzelle = leseParzellen.find(p =>
        p.weingarten_id === row.weingarten_id &&
        (p.grundstueck_id ?? '') === row.grundstueck_id
      )
      if (parzelle?.klosterneuburger != null) {
        sumKg  += kg
        sumKmw += parzelle.klosterneuburger * kg
      }
    }
    if (sumKg === 0) return pressung?.kmw_grad ?? null
    return Math.round((sumKmw / sumKg) * 10) / 10
  })()
  const kmwGrad      = kmwFromWgRows?.toString().replace('.', ',') ?? ''
  const kmwNum       = parseFloat(dezimal(kmwGrad))
  // wie der Server (zahlAus → kmwZuQualitaet): jede gültige Zahl zählt, auch 0 °KMW (→ Wein)
  const kmwQualitaet = kmwGrad !== '' && Number.isFinite(kmwNum) ? kmwZuQualitaet(kmwNum) : null
  const [pending, startTransition] = useTransition()

  type VerschneidungData = {
    newCharge:       { id: string; name: string; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }
    existingChargen: { weinausbau_id: string; name: string; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]
  }
  const [verschneidung, setVerschneidung]         = useState<VerschneidungData | null>(null)
  const [verschneidungOpen, setVerschneidungOpen] = useState(false)

  const gesamtKg = wgRows.reduce((s, r) => s + (parseFloat(dezimal(r.trauben_kg)) || 0), 0)
  const mostL    = parseFloat(dezimal(mostLiter)) || 0
  const ausbeute = gesamtKg > 0 && mostL > 0 ? (mostL / gesamtKg) * 100 : null

  // GST-/Ried-Optionen aus Erntedaten. KAN-126: bei mehreren Lesetagen eine Option je Ort UND Lesetag
  // (plus „anderer Tag“), sonst eine je Ort mit dem einen Lesetag als Vorbelegung. Die verfügbaren kg
  // bleiben je Ort. compositeId = weingarten|gst|lesetag.
  type GstOption = {
    compositeId: string; ort: string; weingarten_id: string; grundstueck_id: string; label: string
    rebsorte: string; menge_kg: number; verfuegbar_kg: number; tag: Lesetag | null; mehrereTage: boolean
  }
  const tageJeOrt = new Map<string, Lesetag[]>()
  const gstOptionen: GstOption[] = leseParzellen.flatMap((p): GstOption[] => {
    const ort = `${p.weingarten_id}|${p.grundstueck_id ?? ''}`
    const tage = lesetageFuerOrt(leseEintraege, p.weingarten_id, p.grundstueck_id)
    tageJeOrt.set(ort, tage)
    const basis = {
      ort, weingarten_id: p.weingarten_id, grundstueck_id: p.grundstueck_id ?? '',
      label: p.grundstueck_nr ? `GST ${p.grundstueck_nr} · ${p.weingarten_name}` : p.weingarten_name,
      rebsorte: p.grundstueck_rebsorte ?? p.rebsorte ?? '',
      menge_kg: p.menge_kg ?? 0,
      verfuegbar_kg: gstVerfuegbar(p.grundstueck_id),
    }
    if (tage.length <= 1) return [{ ...basis, compositeId: `${ort}|`, tag: vorbelegterLesetag(tage), mehrereTage: false }]
    return [
      ...tage.map(t => ({ ...basis, compositeId: `${ort}|${t.datum}`, label: `${basis.label} · Lese ${datumText(t.datum)}`, tag: t, mehrereTage: true })),
      { ...basis, compositeId: `${ort}|`, label: `${basis.label} · anderer Lesetag`, tag: null, mehrereTage: true },
    ]
  })
  // Zukauf-Optionen: eigenes Präfix "zukauf:<id>" um Kollisionen mit compositeId zu vermeiden
  const zukaufOptionen = zukaufTrauben.map(z => ({
    compositeId: `zukauf:${z.id}`,
    zukauf_posten_id: z.id,
    datum: z.datum,
    mg: mgAusTag({ kmw: z.kmw_grad, oechsle: z.oechsle ?? null, einheit: z.mostgewicht_einheit ?? null }),
    label: `Zukauf${z.lieferant ? ' · ' + z.lieferant : ''}${z.herkunft ? ' (' + z.herkunft + ')' : ''}`,
    rebsorte: z.rebsorte ?? '',
    verfuegbar_kg: z.verfuegbar_kg,
  }))

  function updateWG(i: number, field: keyof WGRow | 'compositeId', val: string) {
    if (field === 'compositeId') {
      if (val.startsWith('zukauf:')) {
        const opt = zukaufOptionen.find(o => o.compositeId === val)
        if (opt) {
          setWgRows(rows => rows.map((r, j) => j === i ? {
            ...r,
            weingarten_id: '',
            grundstueck_id: '',
            zukauf_posten_id: opt.zukauf_posten_id,
            rebsorte: opt.rebsorte,
            // KAN-126: Zukauf-Zeilen tragen das Zukaufsdatum (setzt der Server) und das Mostgewicht des Zukaufs
            ernte_datum: opt.datum ?? '',
            mg: mostgewichtAusGespeichert(opt.mg), mgStart: opt.mg, mgFehler: null,
            // Beim "Anmelden" die volle verfügbare Menge vorbefüllen (vor dem
            // Speichern reduzierbar) - vorher wurde diese Menge nur beim
            // automatischen Vorbelegen aller Posten gesetzt.
            trauben_kg: opt.verfuegbar_kg.toString().replace('.', ','),
          } : r))
        }
        return
      }
      const opt = gstOptionen.find(o => o.compositeId === val)
      if (opt) {
        setWgRows(rows => rows.map((r, j) => j === i ? {
          ...r,
          weingarten_id: opt.weingarten_id,
          grundstueck_id: opt.grundstueck_id,
          zukauf_posten_id: '',
          rebsorte: opt.rebsorte,
          trauben_kg: opt.verfuegbar_kg.toString().replace('.', ','),
          // KAN-126: Lesetag und dessen Mostgewicht übernehmen (änderbar); ohne eindeutigen Tag leer
          ernte_datum: opt.tag?.datum ?? '',
          mg: mostgewichtAusGespeichert(mgAusTag(opt.tag)), mgStart: mgAusTag(opt.tag), mgFehler: null,
        } : r))
      }
    } else {
      setWgRows(rows => rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
    }
  }
  function updateBeh(i: number, field: keyof BehRow, val: string) {
    setBehRows(rows => rows.map((r, j) => j === i ? { ...r, [field]: val } : r))
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    // KAN-126: Lesedatum und Mostgewicht je Traubenzeile vorab prüfen (der Server prüft zusätzlich den Jahrgang)
    const zeilen = wgRows.filter(r => r.id || ((r.weingarten_id || r.zukauf_posten_id) && r.trauben_kg))
    for (const [i, r] of zeilen.entries()) {
      if (r.mgFehler) { setFehler(`Traubenzeile ${i + 1}: ${r.mgFehler}`); return }
      if (!r.weingarten_id) continue
      const alt = r.id ? pressung?.weingaerten.find(w => w.id === r.id) : undefined
      const ortGeaendert = !alt || (alt.weingarten_id ?? '') !== r.weingarten_id || (alt.grundstueck_id ?? '') !== r.grundstueck_id
      const fLese = lesedatumFehler(r.ernte_datum, { pressungDatum: datum, jahrgang: null, pflicht: ortGeaendert || !!alt?.ernte_datum })
      if (fLese) { setFehler(`Traubenzeile ${i + 1}: ${fLese}`); return }
    }
    const fd = new FormData()
    fd.append('jahrgang_id', jahrgangId)
    if (pressung) fd.append('existing_id', pressung.id)
    fd.append('datum', datum)
    fd.append('most_liter_gesamt', mostLiter)
    fd.append('weinbezeichnung', weinbezeichnung)
    fd.append('kmw_grad', kmwGrad)
    // Qualitätsstufe wird bewusst NICHT vom Formular mitgeschickt: der Server
    // leitet sie automatisch aus den °KMW ab (siehe upsertPressung/autoQualitaet).
    // Ein bewusstes manuelles Abstufen bleibt bei der Abfüllung möglich.
    fd.append('notizen', notizen)
    fd.append('weingaerten_json', JSON.stringify(
      // Gespeicherte Zeilen (mit id) immer mitschicken – entfernt wird nur per „×“
      zeilen.map(r => ({
        id: r.id || undefined,
        weingarten_id: r.weingarten_id || undefined,
        grundstueck_id: r.grundstueck_id || undefined,
        zukauf_posten_id: r.zukauf_posten_id || undefined,
        trauben_kg: parseFloat(dezimal(r.trauben_kg)),
        rebsorte: r.rebsorte || undefined,
        notizen: r.notizen || undefined,
        // KAN-126: Lesetag (bei Zukauf setzt der Server das Zukaufsdatum) und Mostgewicht (Messwert + Einheit)
        ernte_datum: r.zukauf_posten_id ? undefined : (r.ernte_datum || null),
        mostgewicht_wert: r.mg ? messwertText(r.mg) : null,
        mostgewicht_einheit: r.mg?.einheit ?? null,
      }))
    ))
    fd.append('behaelter_json', JSON.stringify(
      behRows.filter(r => r.id || r.behaelter_id || r.weinausbau_id).map(r => ({
        id: r.id || undefined,
        behaelter_id: r.behaelter_id || undefined,
        weinausbau_id: r.weinausbau_id || undefined,
        menge_liter: r.menge_liter ? parseFloat(dezimal(r.menge_liter)) : undefined,
        notizen: r.notizen || undefined,
      }))
    ))
    setFehler(null)
    startTransition(async () => {
      try {
        const result = await upsertPressung(fd)
        // Teilweise gespeichert (z. B. ein Behälter konnte nicht befüllt werden): Hinweis
        // zeigen und das Formular schließen, damit die Pressung nicht doppelt angelegt wird
        if (result.warnung) alert(result.warnung)
        // Prüfen ob neue Charge in Behälter mit bestehenden Chargen gedrückt wurde
        if (!pressung && behaelterMitCharge && result.neu.length > 0) {
          // Verschnitt-Prompt immer wenn Behälter bereits Chargen hat
          const konflikt = result.neu.find(n => {
            const existing = behaelterMitCharge[n.behaelter_id] ?? []
            return existing.length > 0
          })
          if (konflikt) {
            setVerschneidung({
              newCharge: { id: konflikt.weinausbau_id, name: konflikt.name, menge_liter: konflikt.menge_liter ?? null, qualitaetsstufe: konflikt.qualitaetsstufe ?? null, herkunft_code: konflikt.herkunft_code ?? null },
              existingChargen: behaelterMitCharge[konflikt.behaelter_id],
            })
            return
          }
        }
        onDone()
      } catch (err) {
        console.error('Pressung Fehler:', err)
        // Sperrgründe (Folgebuchungen an der Charge usw.) im Formular anzeigen – die
        // Eingaben bleiben erhalten und können korrigiert werden
        setFehler('Speichern nicht möglich: ' + fehlerText(err, 'Unbekannter Fehler'))
      }
    })
  }

  const inp = "w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"

  // ── Nach dem Speichern: Verschneidungs-Prompt ─────────────────────────────
  if (verschneidung) {
    // Korrekte Richtung: bestehende Charge = Ziel (Basis), neue Pressung-Charge = Quelle
    const zielCharge = {
      id:          verschneidung.existingChargen[0].weinausbau_id,
      name:        verschneidung.existingChargen[0].name,
      menge_liter: verschneidung.existingChargen[0].menge_liter ?? null,
      qualitaetsstufe: verschneidung.existingChargen[0].qualitaetsstufe ?? null,
      herkunft_code:   verschneidung.existingChargen[0].herkunft_code ?? null,
    }
    const alleChargen = [
      zielCharge,
      {
        id: verschneidung.newCharge.id, name: verschneidung.newCharge.name, menge_liter: verschneidung.newCharge.menge_liter ?? null,
        qualitaetsstufe: verschneidung.newCharge.qualitaetsstufe ?? null, herkunft_code: verschneidung.newCharge.herkunft_code ?? null,
      },
    ]
    if (verschneidungOpen) {
      return (
        <div className="bg-s112-bg border border-s112-warn/30 rounded-xl p-4">
          <p className="text-sm font-semibold text-s112-text mb-3">Chargen verschneiden</p>
          <VerschneidungForm
            zielCharge={zielCharge}
            alleChargen={alleChargen}
            initialQuelleId={verschneidung.newCharge.id}
            initialQuelleMenge={verschneidung.newCharge.menge_liter != null ? String(verschneidung.newCharge.menge_liter) : ''}
            onDone={() => { setVerschneidung(null); setVerschneidungOpen(false); onDone() }}
          />
        </div>
      )
    }
    return (
      <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-s112-warn-fg">Pressung gespeichert</p>
        <p className="text-sm text-s112-warn-fg">
          Die neue Charge <strong>{verschneidung.newCharge.name}</strong> wurde in einen
          Behälter mit bestehenden Chargen gefüllt:
          {' '}<strong>{verschneidung.existingChargen.map(c => c.name).join(', ')}</strong>.
          Sollen die Weine jetzt verschnitten werden?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setVerschneidungOpen(true)}
            className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90"
          >
            Jetzt verschneiden
          </button>
          <button
            type="button"
            onClick={() => { setVerschneidung(null); onDone() }}
            className="px-4 py-1.5 text-sm text-s112-text-2 hover:text-s112-text"
          >
            Später / Kein Verschnitt
          </button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-semibold text-s112-text">{pressung ? 'Pressung bearbeiten' : 'Pressung erfassen'}</h3>

      {/* Datum + Most + Bezeichnung */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input aria-label="Datum" type="date" value={datum} onChange={e => setDatum(e.target.value)} required className={inp} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Mostausbeute gesamt (L) *</label>
          <input aria-label="Mostausbeute gesamt (L)" type="text" inputMode="decimal" required value={mostLiter} onChange={e => setMostLiter(e.target.value)}
            placeholder="z.B. 1.050" className={inp} />
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">KMW° & Qualitätsstufe</label>
          <div className="flex items-center gap-2">
            <div className="border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-s112-bg text-s112-text-1 cursor-not-allowed whitespace-nowrap shrink-0">
              {kmwGrad ? `${kmwGrad} °KMW` : <span className="text-s112-muted text-xs">– kein KMW</span>}
            </div>
            <div className="flex-1 flex items-center gap-2 border border-s112-border rounded-lg px-2 py-1.5 bg-s112-bg">
              <span className="shrink-0 text-xs font-semibold px-2 py-1 rounded-full bg-s112-warn-bg text-s112-warn-fg whitespace-nowrap">
                {QUALITAET_LABEL[kmwQualitaet ?? 'qualitaetswein']}
              </span>
              <span className="text-xs text-s112-muted">automatisch aus °KMW · manuelles Abstufen bei der Abfüllung möglich</span>
            </div>
          </div>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">
            Bezeichnung <span className="text-s112-muted font-normal">(z.B. Gemischter Satz – optional)</span>
          </label>
          <input aria-label="Bezeichnung (z.B. Gemischter Satz – optional)" type="text" value={weinbezeichnung} onChange={e => setWeinbez(e.target.value)}
            placeholder="Leer lassen für reinsortige Weine" className={inp} />
          {(() => {
            const rebsorten = wgRows.map(r => r.rebsorte).filter(Boolean)
            const unique = [...new Set(rebsorten)]
            const autoRebsorte = unique.length === 1 ? unique[0] : unique.length > 1 ? 'Sortenverschnitt' : null
            const preview = weinbezeichnung.trim() || autoRebsorte
              || `Pressung ${datum ? new Date(datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '…'}`
            return (
              <p className="text-xs text-s112-muted mt-1">
                → Charge: <strong className="text-s112-text-1">&ldquo;{preview}&rdquo;</strong>
              </p>
            )
          })()}
        </div>
      </div>

      {/* Live-Kalkulation */}
      {gesamtKg > 0 && (
        <div className="flex gap-4 text-xs bg-white border border-s112-border rounded-lg px-3 py-2">
          <span className="text-s112-text-2">Trauben: <strong className="text-s112-text">{fmt(gesamtKg)} kg</strong></span>
          {mostL > 0 && <>
            <span className="text-s112-tertiary">→</span>
            <span className="text-s112-text-2">Most: <strong className="text-s112-text">{fmt(mostL)} L</strong></span>
            <span className="text-s112-tertiary">→</span>
            <span className={`font-semibold ${ausbeute && ausbeute < 65 ? 'text-s112-warn-fg' : 'text-s112-ok-fg'}`}>
              {fmtProzent(ausbeute)} % Ausbeute
            </span>
            <span className="text-s112-tertiary ml-auto">Faustregel: 70 %</span>
          </>}
        </div>
      )}

      {/* Gelesene GST */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-s112-text-1">Gelesene GST</label>
          <button type="button" onClick={() => setWgRows(r => [...r, emptyWG()])}
            className="text-xs text-s112-blue-700 hover:underline">GST</button>
        </div>
        <div className="space-y-1.5">
          {wgRows.map((row, i) => {
            const ort = `${row.weingarten_id}|${row.grundstueck_id}`
            const tage = tageJeOrt.get(ort) ?? []
            // Mehrere Lesetage: Option des gewählten Tages, sonst „anderer Lesetag“; ein oder kein Tag: die Ortsoption
            const selectValue = row.weingarten_id
              ? (tage.length > 1 && tage.some(t => t.datum === row.ernte_datum) ? `${ort}|${row.ernte_datum}` : `${ort}|`)
              : row.zukauf_posten_id ? `zukauf:${row.zukauf_posten_id}` : ''
            const altZeile = row.id ? pressung?.weingaerten.find(w => w.id === row.id) : undefined
            // Unveränderte Altzeile ohne Lesedatum: nur den eindeutigen Lesetag vorschlagen (nicht still setzen)
            const vorschlag = row.weingarten_id && !row.ernte_datum && altZeile && !altZeile.ernte_datum ? vorbelegterLesetag(tage) : null
            return (
              <div key={i} className="rounded-lg border border-s112-border/60 bg-white/60 p-1.5 space-y-1.5">
              <div className="grid grid-cols-12 gap-1.5 items-center">
                <div className="col-span-5">
                  <select
                    value={selectValue}
                    onChange={e => updateWG(i, 'compositeId', e.target.value)}
                    className={inp}
                  >
                    <option value="">– GST/Ried –</option>
                    {gstOptionen.map(opt => (
                      <option key={opt.compositeId} value={opt.compositeId}>
                        {opt.label} – {fmtNum(opt.verfuegbar_kg, { max: 0 })} kg verf.
                      </option>
                    ))}
                    {zukaufOptionen.length > 0 && (
                      <optgroup label="Zugekaufte Trauben">
                        {zukaufOptionen.map(opt => (
                          <option key={opt.compositeId} value={opt.compositeId}>
                            {opt.label} – {fmtNum(opt.verfuegbar_kg, { max: 0 })} kg verf.
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </select>
                </div>
                <div className="col-span-2">
                  <input type="text" inputMode="decimal" value={row.trauben_kg}
                    onChange={e => updateWG(i, 'trauben_kg', e.target.value)}
                    placeholder="kg" className={inp} />
                </div>
                <div className="col-span-3 flex items-center px-2">
                  <span className="text-sm text-s112-text-2 truncate">
                    {row.rebsorte ? formatRebsorteMitKuerzel(row.rebsorte) : <span className="text-s112-tertiary text-xs">–</span>}
                  </span>
                </div>
                <div className="col-span-2 flex justify-end">
                  {wgRows.length > 1 && (
                    <button aria-label="Zeile entfernen" type="button" onClick={() => setWgRows(r => r.filter((_, j) => j !== i))}
                      className="text-xs text-s112-err hover:text-s112-err-fg px-1"><X size={14} /></button>
                  )}
                </div>
              </div>
              {(row.weingarten_id || row.zukauf_posten_id) && (
                <div className="grid grid-cols-12 gap-1.5 items-start">
                  <div className="col-span-4">
                    <label className="block text-[11px] text-s112-text-2 mb-0.5">
                      Lesedatum{row.weingarten_id && ' *'}{row.zukauf_posten_id && <span className="text-s112-muted"> (Zukaufsdatum)</span>}
                    </label>
                    <input aria-label={`Lesedatum Traubenzeile ${i + 1}`} type="date" value={row.ernte_datum}
                      disabled={!!row.zukauf_posten_id}
                      onChange={e => updateWG(i, 'ernte_datum', e.target.value)}
                      className={`${inp} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                    {row.weingarten_id && tage.length > 1 && !tage.some(t => t.datum === row.ernte_datum) && (
                      <p className="text-[11px] text-s112-muted mt-0.5">Lesetage laut Lese: {tage.map(t => datumText(t.datum)).join(', ')}</p>
                    )}
                    {row.weingarten_id && tage.length === 0 && !row.ernte_datum && (
                      <p className="text-[11px] text-s112-warn-fg mt-0.5">Kein Lesetag in der Lese erfasst – bitte angeben.</p>
                    )}
                    {vorschlag && (
                      <button type="button" onClick={() => setWgRows(rs => rs.map((r, j) => j === i
                          ? { ...r, ernte_datum: vorschlag.datum, ...(r.mg ? {} : { mg: mostgewichtAusGespeichert(mgAusTag(vorschlag)), mgStart: mgAusTag(vorschlag), mgFehler: null }) }
                          : r))}
                        className="text-[11px] text-s112-blue-700 hover:underline mt-0.5">Lesetag {datumText(vorschlag.datum)} laut Lese übernehmen</button>
                    )}
                  </div>
                  <div className="col-span-8">
                    <MostgewichtEingabe name={`pw_${i}_mostgewicht`} label="Mostgewicht" startwert={row.mgStart}
                      onChange={(wert, info) => setWgRows(rs => rs.map((r, j) => j === i ? { ...r, mg: info.fehler ? r.mg : wert, mgFehler: info.fehler } : r))} />
                  </div>
                </div>
              )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Befüllte Behälter/Chargen */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="text-xs font-semibold text-s112-text-1">Most in Behälter/Charge *</label>
          <button type="button" onClick={() => setBehRows(r => [...r, emptyBeh()])}
            className="text-xs text-s112-blue-700 hover:underline">Behälter</button>
        </div>
        {pressung && pressung.behaelter.some(b => b.weinausbau_id) && (
          <p className="text-xs text-s112-muted mb-1.5">
            Hängen an einer Charge schon Buchungen im Kellerbuch (Umzug, Schwund, Verschnitt, Füllung, Verkauf),
            bleiben Mostmenge und Behälter dieser Zeile fest – Korrekturen dann im Kellerbuch als eigene Buchung.
            Den Behälter sperren zusätzlich Kellerbehandlungen; Weinanalysen und DAC-Anträge sperren ihn nicht.
            Name, Sorte und Qualität bestehender Chargen werden hier nicht mehr geändert.
          </p>
        )}
        <div className="space-y-1.5">
          {behRows.map((row, i) => (
            <div key={i} className="grid grid-cols-12 gap-1.5 items-center">
              <div className="col-span-6">
                <select value={row.behaelter_id} onChange={e => updateBeh(i, 'behaelter_id', e.target.value)}
                  required={i === 0} className={inp}>
                  <option value="">– Behälter –</option>
                  {behOptions.map(b => {
                    const vol = b.volumen_liter ?? null
                    const existing = behaelterMitCharge?.[b.id] ?? []
                    const inhalt = existing.reduce((s, c) => s + (parseFloat(String(c.menge_liter ?? 0)) || 0), 0)
                    const frei = vol != null ? vol - inhalt : null
                    const kapSuffix = vol != null
                      ? ` · ${fmtNum(vol)} L · frei: ${fmtNum(frei!, { max: 0 })} L`
                      : ''
                    const inhaltSuffix = existing.length > 0
                      ? ` [${existing.map(c => c.rebsorte ? `${c.name} (${formatRebsorteMitKuerzel(c.rebsorte)})` : c.name).join(', ')}]`
                      : ' [leer]'
                    return <option key={b.id} value={b.id}>{b.name}{kapSuffix}{inhaltSuffix}</option>
                  })}
                </select>
                {row.behaelter_id && (() => {
                  const beh = behOptions.find(b => b.id === row.behaelter_id)
                  const vol = beh?.volumen_liter ?? null
                  const existing = behaelterMitCharge?.[row.behaelter_id] ?? []
                  const inhaltJetzt = existing.reduce((s, c) => s + (parseFloat(String(c.menge_liter ?? 0)) || 0), 0)
                  const eingabe = parseFloat(dezimal(row.menge_liter)) || 0
                  const restNach = vol != null ? vol - inhaltJetzt - eingabe : null
                  const ueber = restNach != null && restNach < -0.01

                  // Rebsorten- und Farbprüfung
                  const rebsortenInForm = [...new Set(wgRows.map(r => r.rebsorte).filter(Boolean))]
                  const pressungFarbe = weinfarbe(rebsortenInForm[0] ?? null)
                  const existingFarben = existing.map(e => weinfarbe(e.rebsorte ?? null)).filter(Boolean)
                  const isFarbmix = pressungFarbe != null && existingFarben.some(f => f !== pressungFarbe)
                  const isMix = existing.length > 0 && rebsortenInForm.length > 0
                    && existing.some(e => e.rebsorte && !rebsortenInForm.includes(e.rebsorte))

                  return (
                    <div className="mt-1.5 bg-s112-bg border border-s112-border rounded-lg px-3 py-2 text-xs space-y-2">
                      {/* Kapazitäts-Zahlen */}
                      <div className="grid grid-cols-3 gap-1.5">
                        <div>
                          <p className="text-s112-muted mb-0.5">Kapazität</p>
                          <p className="font-medium tabular-nums">{vol != null ? fmtNum(vol) + ' L' : '–'}</p>
                        </div>
                        <div>
                          <p className="text-s112-muted mb-0.5">Inhalt jetzt</p>
                          <p className="font-medium tabular-nums">{fmtNum(inhaltJetzt, { max: 1 })} L</p>
                        </div>
                        <div>
                          <p className="text-s112-muted mb-0.5">{eingabe > 0 ? 'Rest nach Pressung' : 'Restkapazität'}</p>
                          <p className={`font-medium tabular-nums ${ueber ? 'text-s112-err-fg' : 'text-s112-blue-700'}`}>
                            {vol != null ? fmtNum((eingabe > 0 ? restNach! : vol - inhaltJetzt), { max: 1 }) + ' L' : '–'}
                          </p>
                        </div>
                      </div>

                      {/* Bestehende Chargen */}
                      {existing.length > 0 && (
                        <div className={`rounded px-2 py-1.5 border ${isFarbmix ? 'bg-s112-err-bg border-s112-err/30' : isMix ? 'bg-s112-warn-bg border-s112-warn/30' : 'bg-white border-s112-border'}`}>
                          <p className={`font-medium mb-1 ${isFarbmix ? 'text-s112-err-fg' : isMix ? 'text-s112-warn-fg' : 'text-s112-text-2'}`}>
                            {isFarbmix ? 'Rotwein/Weißwein-Mischung nicht erlaubt!' : isMix ? 'Rebsortenverschnitt' : 'Enthält bereits'}
                          </p>
                          <ul className="space-y-0.5">
                            {existing.map((c, ci) => (
                              <li key={ci} className="flex justify-between">
                                <span className={isFarbmix ? 'text-s112-err-fg' : isMix ? 'text-s112-warn-fg' : 'text-s112-text-1'}>
                                  {c.name}{c.rebsorte ? ` · ${formatRebsorteMitKuerzel(c.rebsorte)}` : ''}
                                </span>
                                <span className="tabular-nums text-s112-text-2 ml-2">
                                  {c.menge_liter != null ? fmtNum(c.menge_liter, { max: 1 }) + ' L' : '–'}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {ueber && <p className="text-s112-err-fg font-medium">Behälter hat nicht genug Kapazität</p>}
                    </div>
                  )
                })()}
              </div>
              <div className="col-span-4">
                <input type="text" inputMode="decimal" required={i === 0} value={row.menge_liter}
                  onChange={e => updateBeh(i, 'menge_liter', e.target.value)}
                  placeholder="Liter" className={inp} />
              </div>
              <div className="col-span-2 flex justify-end">
                {behRows.length > 1 && (
                  <button aria-label="Zeile entfernen" type="button" onClick={() => entferneBehRow(i)}
                    className="text-xs text-s112-err hover:text-s112-err-fg px-1"><X size={14} /></button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Notizen */}
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
        <input aria-label="Notizen" type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
          placeholder="z.B. Nachtlese, Botrytis teilweise …" className={inp} />
      </div>

      {fehler && <Fehlermeldung text={fehler} onClose={() => setFehler(null)} />}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone} className="px-4 py-1.5 text-sm text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Hauptexport ───────────────────────────────────────────────────────────────

export default function PressungSection({ jahrgangId, pressungen, wgOptions, behOptions, waOptions, leseParzellen, leseEintraege, verfuegbareKgByGST, zukaufTrauben, behaelterMitCharge, writeOk, adminOk }: {
  jahrgangId: string; pressungen: Pressung[]
  wgOptions: WGOption[]; behOptions: BehOption[]; waOptions: WAOption[]
  /** KAN-126: alle Lese-Einträge des Jahrgangs (Lesetage und Mostgewicht je Ort) */
  leseParzellen: LeseParzelle[]; leseEintraege: LeseEintrag[]; verfuegbareKgByGST: Record<string, number>
  zukaufTrauben: ZukaufTraubenOpt[]
  behaelterMitCharge?: Record<string, { weinausbau_id: string; name: string; rebsorte?: string | null; menge_liter?: number | null; qualitaetsstufe?: string | null; herkunft_code?: string | null }[]>; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm]    = useState(false)
  const [editId, setEditId]        = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [collapsed, setCollapsed]  = useState(false)
  const [fehler, setFehler]        = useState<string | null>(null)

  const gesamtKg    = pressungen.flatMap(p => p.weingaerten).reduce((s, w) => s + w.trauben_kg, 0)
  const gesamtLiter = pressungen.reduce((s, p) => s + (p.most_liter_gesamt ?? 0), 0)
  const ausbeute    = gesamtKg > 0 && gesamtLiter > 0 ? (gesamtLiter / gesamtKg) * 100 : null
  const gesamtVerfuegbarKg = Object.values(verfuegbareKgByGST).reduce((s, v) => s + v, 0)
    + zukaufTrauben.reduce((s, z) => s + z.verfuegbar_kg, 0)

  function handleDelete(p: Pressung) {
    const chargen = p.behaelter.filter(b => b.weinausbau_id).map(b => `„${b.weinausbau_name ?? 'ohne Namen'}“`)
    const frage = chargen.length > 0
      ? `Pressung vom ${fmtDate(p.datum)} löschen? Dabei werden auch die daraus entstandenen Kellerbuch-Chargen ${chargen.join(', ')} gelöscht. Das geht nur, solange an ihnen noch keine Folgebuchungen (Umzug, Füllung, Behandlung …) hängen.`
      : `Pressung vom ${fmtDate(p.datum)} löschen?`
    if (!confirm(frage)) return
    setFehler(null)
    startTransition(async () => {
      try {
        await deletePressung(p.id, jahrgangId)
      } catch (err) {
        setFehler(fehlerText(err, 'Die Pressung konnte nicht gelöscht werden.'))
      }
    })
  }

  return (
    <div className={`card space-y-4 ${pending ? 'opacity-60 pointer-events-none' : ''}`}>
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setCollapsed(c => !c)}
          className="flex items-center gap-1.5 text-left" title={collapsed ? 'Pressungen einblenden' : 'Pressungen ausblenden'}>
          <ChevronDown size={16} className={`text-s112-muted transition-transform ${collapsed ? '-rotate-90' : ''}`} />
          <h2 className="text-base font-semibold text-s112-text">Pressungen</h2>
        </button>
        <div className="flex items-center gap-3">
          {pressungen.length > 0 && (
            <span className="text-xs text-s112-muted">
              {fmt(gesamtKg)} kg → {fmt(gesamtLiter)} L
              {ausbeute && <span className="ml-1 font-medium text-s112-text-1">({ausbeute.toFixed(1)} %)</span>}
            </span>
          )}
          {writeOk && !showForm && (
            gesamtVerfuegbarKg > 0
              ? <button onClick={() => { setShowForm(true); setEditId(null); setCollapsed(false) }}
                  className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-opacity-90 transition-colors shadow-sm">
                  <Plus size={14} strokeWidth={2.5} /> Pressung erfassen
                </button>
              : <span className="text-xs text-s112-warn-fg font-medium bg-s112-warn-bg px-3 py-1.5 rounded-lg">
                  Keine Trauben für Pressung verfügbar
                </span>
          )}
        </div>
      </div>

      {fehler && <Fehlermeldung text={fehler} onClose={() => setFehler(null)} />}

      {collapsed ? null : (
      <>
      {/* Saisonstatistik */}
      {pressungen.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-s112-bg rounded-xl p-3 text-center">
            <p className="text-lg font-semibold text-s112-text">{fmt(gesamtKg / 1000)} t</p>
            <p className="text-xs text-s112-muted">Trauben gesamt</p>
          </div>
          <div className="bg-s112-bg rounded-xl p-3 text-center">
            <p className="text-lg font-semibold text-s112-text">{fmt(gesamtLiter)} L</p>
            <p className="text-xs text-s112-muted">Most gesamt</p>
          </div>
          <div className="bg-s112-bg rounded-xl p-3 text-center">
            <p className={`text-lg font-semibold ${ausbeute && ausbeute < 65 ? 'text-s112-warn-fg' : 'text-s112-ok-fg'}`}>
              {ausbeute ? `${ausbeute.toFixed(1)} %` : '–'}
            </p>
            <p className="text-xs text-s112-muted">Ausbeute (FK 70 %)</p>
          </div>
        </div>
      )}

      {/* Neues Formular */}
      {showForm && !editId && (
        <PressungForm jahrgangId={jahrgangId} wgOptions={wgOptions} behOptions={behOptions}
          waOptions={waOptions} leseParzellen={leseParzellen} leseEintraege={leseEintraege} verfuegbareKgByGST={verfuegbareKgByGST}
          zukaufTrauben={zukaufTrauben}
          behaelterMitCharge={behaelterMitCharge} onDone={() => setShowForm(false)} />
      )}

      {/* Pressung-Liste */}
      {pressungen.length === 0 && !showForm ? (
        <div className="border border-dashed border-s112-border rounded-xl p-8 text-center text-sm text-s112-muted">
          Noch keine Pressungen erfasst.
        </div>
      ) : (
        <div className="space-y-3">
          {pressungen.map(p => {
            const pKg = p.weingaerten.reduce((s, w) => s + w.trauben_kg, 0)
            const pAusbeute = pKg > 0 && p.most_liter_gesamt ? (p.most_liter_gesamt / pKg) * 100 : null
            return (
              <div key={p.id}>
                {editId === p.id ? (
                  <PressungForm pressung={p} jahrgangId={jahrgangId} wgOptions={wgOptions}
                    behOptions={behOptions} waOptions={waOptions} leseParzellen={leseParzellen} leseEintraege={leseEintraege}
                    verfuegbareKgByGST={verfuegbareKgByGST} zukaufTrauben={zukaufTrauben}
                    behaelterMitCharge={undefined}
                    onDone={() => setEditId(null)} />
                ) : (
                  <div className="group border border-s112-border rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-s112-text text-sm">{fmtDate(p.datum)}</span>
                          {p.weinbezeichnung && (
                            <span className="bg-s112-teal/10 text-s112-blue-700 text-xs font-semibold px-2 py-0.5 rounded-full">
                              {p.weinbezeichnung}
                            </span>
                          )}
                        </div>
                        {p.notizen && <span className="text-xs text-s112-muted">{p.notizen}</span>}
                      </div>
                      <div className="flex items-center gap-3 text-xs shrink-0">
                        <span className="text-s112-text-2">{fmt(pKg)} kg</span>
                        {p.most_liter_gesamt && <>
                          <span className="text-s112-tertiary">→</span>
                          <span className="text-s112-text-2">{fmt(p.most_liter_gesamt)} L</span>
                          {pAusbeute && <span className={`font-semibold ${pAusbeute < 65 ? 'text-s112-warn-fg' : 'text-s112-ok-fg'}`}>
                            {fmtProzent(pAusbeute)} %
                          </span>}
                        </>}
                        {p.kmw_grad != null && (
                          <span className="font-semibold text-s112-warn-fg bg-s112-warn-bg px-2 py-0.5 rounded-full">
                            {p.kmw_grad.toString().replace('.', ',')} °KMW
                            {' · '}{QUALITAET_LABEL[kmwZuQualitaet(p.kmw_grad)]}
                          </span>
                        )}
                        <span className="flex items-center gap-2">
                          {writeOk && <button onClick={() => setEditId(p.id)} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={14} /></button>}
                          {adminOk && <button onClick={() => handleDelete(p)} title="Löschen" aria-label="Löschen" className="text-s112-err hover:text-s112-err-fg"><Trash2 size={14} /></button>}
                        </span>
                      </div>
                    </div>

                    {/* Weingärten */}
                    {p.weingaerten.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {p.weingaerten.map(w => (
                          <span key={w.id} className="inline-flex items-center gap-1 bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg text-xs px-2 py-0.5 rounded-full">
                            {w.weingarten_name}
                            {w.rebsorte && <span className="text-s112-ok-fg">· {formatRebsorteMitKuerzel(w.rebsorte)}</span>}
                            <span className="font-medium">· {fmt(w.trauben_kg)} kg</span>
                            {/* KAN-126 */}
                            {w.ernte_datum
                              ? <span>· Lese {datumText(w.ernte_datum)}</span>
                              : w.weingarten_id && <span className="text-s112-warn-fg" title="Ohne Lesedatum rechnet die Rückverfolgung mit einem Ersatz">· ohne Lesedatum</span>}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Behälter */}
                    {p.behaelter.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {p.behaelter.map(b => (
                          b.weinausbau_id ? (
                            <a key={b.id} href={`/kellerbuch/weinausbau/${b.weinausbau_id}/buch`}
                              className="inline-flex items-center gap-1 bg-s112-blue-50 border border-s112-blue-100 text-s112-blue-700 text-xs px-2 py-0.5 rounded-full hover:bg-s112-blue-100 transition-colors">
                              {b.behaelter_name ? `${b.behaelter_name} · ` : ''}{b.weinausbau_name ?? '–'}
                              {b.menge_liter && <span className="font-medium">· {fmt(b.menge_liter)} L</span>}
                              <span className="text-s112-blue-300">→ KB</span>
                            </a>
                          ) : (
                            <span key={b.id} className="inline-flex items-center gap-1 bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg text-xs px-2 py-0.5 rounded-full">
                              {b.behaelter_name ?? '–'}
                              {b.menge_liter && <span className="font-medium">· {fmt(b.menge_liter)} L</span>}
                              <span className="text-s112-warn-fg ml-0.5">keine Charge</span>
                            </span>
                          )
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </>
      )}
    </div>
  )
}
