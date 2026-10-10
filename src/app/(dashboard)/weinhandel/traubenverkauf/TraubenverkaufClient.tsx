'use client'

import React, { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { upsertTraubenverkauf, stornoTraubenverkauf, endgueltigLoeschenTraubenverkauf } from './actions'
import StornoButton from '@/components/StornoButton'
import PartnerSuche from '@/components/crm/PartnerSuche'
import StornierteUmschalter from '@/components/StornierteUmschalter'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { qualitaetLabel, LESE_QUALITAETEN, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvDatei, csvDateiname, HINWEIS_BKI_UPLOAD } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { SPALTEN_TRAUBENVERKAUF_LISTE, traubenverkaufListenHinweise, type TraubenverkaufListenZeile } from '@/lib/behoerden/traubenverkauf'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'
import type { GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import { leseOrtSchluessel, verfuegbarJeLese } from '@/lib/wein/leseBilanz'
import { herkunftAnzeige } from '@/lib/zukauf/ware'   // KAN-80 Nachtrag: Code → Bezeichnung, Altwert unverändert
import { heuteWien } from '@/lib/datum/wien'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Props {
  verkaufe:     R[]
  ernteOptions: R[]   // ernte_parzellen mit weingarten, grundstueck, jahrgang joins (und lese_id)
  /** KAN-129: Lesen des Betriebs, neueste zuerst */
  lesen: { id: string; jahrgang_id: string; jahrgang: number; lfd_nr: number; titel: string }[]
  /** KAN-129: verpresste kg je Lese und Ort (eigene Ernte) */
  verpresst: { lese_id: string | null; weingarten_id: string; grundstueck_id: string | null; kg: number }[]
  zukaufOptions: R[]  // zugekaufte Trauben (zukauf_posten, art='trauben') mit verfuegbar_kg
  writeOk:      boolean
  /** BKI-Datenblatt (Pflichtmeldung) – gleiche Regel wie die CSV-Route */
  bkiErlaubt:   boolean
}

// Trauben-Qualität = Stufen der Lese (KAN-73: LESE_QUALITAETEN). „DAC“ ist keine Stufe der
// Trauben – es gibt sie nur an Charge bzw. Füllung – und steht deshalb nicht mehr zur
// Wahl; ein bereits gespeicherter Wert außerhalb der Liste bleibt beim Bearbeiten sichtbar.

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
/** Mostgewicht einer Zeile (ernte_parzellen, traubenverkauf, zukauf_posten) mit gemessener Einheit */
function mostgewichtVon(kmw: unknown, oechsle: unknown, einheit: unknown): GespeichertesMostgewicht | null {
  if (kmw == null && oechsle == null) return null
  return { kmw: kmw as number | string | null, oechsle: oechsle as number | string | null, einheit: (einheit as string | null) ?? null }
}

function fmt(n: number | null | undefined, digits = 2) {
  if (n == null) return '–'
  return fmtNum(n, digits)
}

export default function TraubenverkaufClient({ verkaufe, ernteOptions: alleErnteOptions, lesen, verpresst, zukaufOptions, writeOk, bkiErlaubt }: Props) {
  const [showForm, setShowForm]      = useState(false)
  const [editRow, setEditRow]        = useState<R | null>(null)
  const [error, setError]            = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Formular-State
  // Quelle: eigene Ernte (Ried/GST) oder zugekaufte Trauben (siehe Migration 141)
  const [quelle, setQuelle]         = useState<'ernte' | 'zukauf'>('ernte')
  const [zukaufId, setZukaufId]     = useState('')
  const [wgId, setWgId]             = useState('')
  const [gstId, setGstId]           = useState('')
  const [jahrgangId, setJahrgangId] = useState('')
  const [jahrgangNr, setJahrgangNr] = useState<number | null>(null)
  // KAN-129: Lese der Trauben – Ried/GST und verfügbare kg nur aus dieser Lese
  const [leseId, setLeseId]         = useState('')
  const lesenMitErnte = lesen.filter(l => alleErnteOptions.some(e => e.lese_id === l.id))
  const ernteOptions = alleErnteOptions.filter(e => e.lese_id === leseId)
  // gelesen − verpresst − verkauft je Lese und Ort (dieselbe Funktion wie Verkauf-Stammdaten); beim
  // Bearbeiten ohne die eigene Menge
  const verfuegbar = verfuegbarJeLese(
    alleErnteOptions.map(e => ({ lese_id: e.lese_id ?? null, weingarten_id: (e.weingarten as R | null)?.id ?? null, grundstueck_id: (e.grundstueck as R | null)?.id ?? null, kg: e.menge_kg == null ? null : Number(e.menge_kg) })),
    [
      ...verpresst,
      // KAN-148: stornierte Traubenverkäufe binden keine kg
      ...verkaufe.filter(v => !v.storniert_am).map(v => ({ lese_id: v.lese_id ?? null, weingarten_id: v.weingarten_id ?? (v.weingarten as R | null)?.id ?? null, grundstueck_id: v.grundstueck_id ?? null, kg: Number(v.menge_kg ?? 0), verkauf_id: v.id as string })),
    ],
    editRow?.id ?? null,
  )
  // Mostgewicht (KAN-128): Vorbelegung bzw. gespeicherter Wert – die Eingabe schickt Messwert und
  // Einheit als versteckte Felder mostgewicht_wert/_einheit (vorher Feld „klosterneuburger“, das die
  // Action nie las: jede Bearbeitung löschte das Mostgewicht)
  const [mgStart, setMgStart]       = useState<GespeichertesMostgewicht | null>(null)
  const [qualitaet, setQualitaet]   = useState('')
  const [herkunft, setHerkunft]     = useState('')
  const [kaeuferTyp, setKaeuferTyp] = useState<'firma' | 'kontakt'>('firma')
  // Käufer per Suche (05.10.2026) statt Auswahlliste aller Kontakte/Firmen
  const [firmaId, setFirmaId]       = useState('')
  const [kontaktId, setKontaktId]   = useState('')
  // Jahrgang des BKI-Datenblatts ('' = alle Jahrgänge)
  const [bkiJahrgang, setBkiJahrgang] = useState('')

  // Verfügbare kg je Zukauf-Posten, während einer Bearbeitung um die eigene
  // Zeile bereinigt (analog verfuegbareKgByWG/GST unten).
  const verfuegbarZukauf = (zId: string) => {
    const opt = zukaufOptions.find(z => z.id === zId)
    if (!opt) return 0
    const eigenerAnteil = editRow && editRow.zukauf_posten_id === zId ? Number(editRow.menge_kg ?? 0) : 0
    return Math.max(0, Number(opt.verfuegbar_kg ?? 0) + eigenerAnteil)
  }

  // Distinct Weingärten aus ernteOptions
  const wgMap = new Map<string, R>()
  for (const e of ernteOptions) {
    const wg = e.weingarten as R | null
    if (wg && !wgMap.has(wg.id)) wgMap.set(wg.id, wg)
  }
  const wgList = Array.from(wgMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'de'))

  const verfuegbareKgByWG = (wId: string) => verfuegbar.ried.get(leseOrtSchluessel(leseId, wId)) ?? 0
  const verfuegbareKgByGST = (gId: string) => verfuegbar.gst.get(leseOrtSchluessel(leseId, gId)) ?? 0

  // GSTs für gewählte Ried
  const gstList: R[] = []
  const seenGst = new Set<string>()
  for (const e of ernteOptions) {
    const wg  = e.weingarten as R | null
    const gst = e.grundstueck as R | null
    if (wg?.id === wgId && gst && !seenGst.has(gst.id)) {
      seenGst.add(gst.id)
      gstList.push(gst)
    }
  }
  gstList.sort((a, b) => (a.gst_nr ?? '').localeCompare(b.gst_nr ?? '', 'de', { numeric: true }))

  function fillFromErnte(newWgId: string, newGstId: string) {
    const match = ernteOptions.find(e => {
      const wg  = e.weingarten as R | null
      const gst = e.grundstueck as R | null
      if (wg?.id !== newWgId) return false
      if (newGstId && gst?.id !== newGstId) return false
      if (!newGstId && gst != null) return false
      return true
    }) ?? ernteOptions.find(e => (e.weingarten as R | null)?.id === newWgId)
    if (match) {
      const mg = mostgewichtVon(match.klosterneuburger, match.oechsle, match.mostgewicht_einheit)
      if (mg) setMgStart(mg)
      if (match.qualitaetsstufe) setQualitaet(match.qualitaetsstufe)
      const wg  = match.weingarten as R | null
      const gst = match.grundstueck as R | null
      setHerkunft((gst as R | null)?.trauben_herkunft_code ?? wg?.trauben_herkunft_code ?? '')
    }
  }

  function handleWgChange(newWgId: string) {
    setWgId(newWgId); setGstId('')
    if (newWgId) fillFromErnte(newWgId, '')
    else { setMgStart(null); setQualitaet(''); setHerkunft('') }
  }

  /** KAN-129: Lese wählen – bestimmt den Jahrgang; Ried/GST werden neu gewählt */
  function handleLeseChange(neu: string) {
    setLeseId(neu); setWgId(''); setGstId(''); setMgStart(null); setQualitaet(''); setHerkunft('')
    const l = lesen.find(x => x.id === neu)
    setJahrgangId(l?.jahrgang_id ?? ''); setJahrgangNr(l?.jahrgang ?? null)
  }

  function handleGstChange(newGstId: string) {
    setGstId(newGstId)
    if (wgId) fillFromErnte(wgId, newGstId)
  }

  function openNew() {
    setEditRow(null); setQuelle('ernte'); setZukaufId('')
    setWgId(''); setGstId('')
    // KAN-129: neueste Lese mit Lese-Einträgen vorbelegen
    const l = lesenMitErnte[0]
    setLeseId(l?.id ?? ''); setJahrgangId(l?.jahrgang_id ?? ''); setJahrgangNr(l?.jahrgang ?? null)
    setMgStart(null); setQualitaet(''); setHerkunft(''); setKaeuferTyp('firma')
    setFirmaId(''); setKontaktId('')
    setError(null); setShowForm(true)
  }

  function openEdit(v: R) {
    setEditRow(v)
    const wg  = v.weingarten as R | null
    const gst = v.grundstueck as R | null
    const jg  = v.jahrgang as R | null
    setQuelle(v.zukauf_posten_id ? 'zukauf' : 'ernte')
    setZukaufId(v.zukauf_posten_id ?? '')
    setWgId(wg?.id ?? ''); setGstId(gst?.id ?? '')
    setJahrgangId(jg?.id ?? ''); setJahrgangNr(jg?.jahrgang ?? null)
    setLeseId(v.lese_id ?? '')
    setMgStart(mostgewichtVon(v.kmw_grad, v.oechsle, v.mostgewicht_einheit))
    setQualitaet(v.qualitaetsstufe ?? ''); setHerkunft(v.herkunft_code ?? '')
    setKaeuferTyp(v.firma_id ? 'firma' : 'kontakt')
    setFirmaId(v.firma_id ?? ''); setKontaktId(v.kontakt_id ?? '')
    setError(null); setShowForm(true)
  }

  function handleZukaufChange(newZukaufId: string) {
    setZukaufId(newZukaufId)
    const opt = zukaufOptions.find(z => z.id === newZukaufId)
    if (opt) {
      setHerkunft(opt.herkunft ?? '')
      // KAN-128: Mostgewicht des Zukaufs (Messwert und Einheit) vorbelegen
      const mg = mostgewichtVon(opt.kmw, opt.oechsle, opt.mostgewicht_einheit)
      if (mg) setMgStart(mg)
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setError(null)
    const fd = new FormData(e.currentTarget)
    fd.set('herkunft_code', herkunft)
    fd.set('jahrgang_id', jahrgangId)
    if (quelle === 'zukauf') {
      fd.set('weingarten_id', '')
      fd.set('grundstueck_id', '')
      fd.set('zukauf_posten_id', zukaufId)
    } else {
      fd.set('weingarten_id', wgId)
      fd.set('grundstueck_id', gstId)
      fd.set('zukauf_posten_id', '')
      fd.set('lese_id', leseId)
    }
    fd.set('firma_id', kaeuferTyp === 'firma' ? firmaId : '')
    fd.set('kontakt_id', kaeuferTyp === 'kontakt' ? kontaktId : '')
    startTransition(async () => {
      try {
        await upsertTraubenverkauf(fd)
        setShowForm(false); setEditRow(null)
      } catch (err) {
        setError(fehlerText(err, 'Unbekannter Fehler'))
      }
    })
  }

  // Interne Traubenverkauf-Liste (Excel) über den Baustein lib/csv – Umlaute im Kopf,
  // Semikolon, BOM, Formelschutz. Das amtliche Format ist das BKI-Datenblatt.
  function listeErzeugen() {
    const zahl = (x: unknown) => (x === null || x === undefined || x === '' ? null : Number(x))
    const zeilen: TraubenverkaufListenZeile[] = verkaufe.map(v => {
      const wg  = v.weingarten as R | null
      const gst = v.grundstueck as R | null
      const jg  = v.jahrgang as R | null
      const zukaufPosten = v.zukauf_posten_id ? zukaufOptions.find(z => z.id === v.zukauf_posten_id) : null
      const kaeufer = (v.firma as R | null)?.name ??
        ([(v.kontakt as R | null)?.vorname, (v.kontakt as R | null)?.nachname].filter(Boolean).join(' ') || null)
      const zukaufText = [zukaufPosten?.rebsorte, zukaufPosten?.lieferant ? `(${zukaufPosten.lieferant})` : null].filter(Boolean).join(' ')
      return {
        liefernummer: v.liefernummer ?? null,
        datum: v.datum ?? null,
        jahrgang: jg?.jahrgang ?? null,
        quelle: wg?.name ?? (v.zukauf_posten_id ? (zukaufText ? `Zukauf – ${zukaufText}` : 'Zukauf') : null),
        gstNr: gst?.gst_nr ?? null,
        mengeKg: zahl(v.menge_kg),
        preisProKg: zahl(v.preis_per_kg),
        kmw: zahl(v.kmw_grad),
        oechsle: zahl(v.oechsle),
        mostgewichtEinheit: v.mostgewicht_einheit ?? null,
        qualitaet: v.qualitaetsstufe ? qualitaetLabel(v.qualitaetsstufe) : null,
        gesundheit: v.gesundheit ?? null,
        herkunftscode: v.herkunft_code ?? null,
        kaeufer,
        rechnungsnummer: (v.verkaufsposten as R | null)?.rechnungsnummer ?? null,
        notizen: v.notizen ?? null,
        storniertAm: v.storniert_am ?? null,
        stornoGrund: v.storno_grund ?? null,
      }
    })
    const datei = csvDatei(zeilen, SPALTEN_TRAUBENVERKAUF_LISTE)
    return { text: datei.text, zeilen: datei.zeilen, warnungen: [...datei.warnungen, ...traubenverkaufListenHinweise(zeilen)], dateiname: csvDateiname(['Traubenverkauf-Liste']).utf8 }
  }

  // Jahrgänge mit Traubenverkäufen (Auswahl für das BKI-Datenblatt), neueste zuerst
  const bkiJahrgaenge = [...new Set(verkaufe.map(v => (v.jahrgang as R | null)?.jahrgang).filter((j): j is number => typeof j === 'number'))].sort((a, b) => b - a)

  // KAN-148 C1b: stornierte Traubenverkäufe zählen in keiner Summe
  // KAN-148 Soll 9: stornierte ausblendbar
  const [stornierteZeigen, setStornierteZeigen] = useState(true)
  const anzahlStorniert = verkaufe.filter(v => v.storniert_am).length
  const sichtbare = stornierteZeigen ? verkaufe : verkaufe.filter(v => !v.storniert_am)
  const sumKg  = verkaufe.filter(v => !v.storniert_am).reduce((s, v) => s + Number(v.menge_kg ?? 0), 0)
  const sumEur = verkaufe.filter(v => !v.storniert_am).reduce((s, v) => v.preis_per_kg != null ? s + Number(v.menge_kg) * Number(v.preis_per_kg) : s, 0)
  const inp = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
  const btnToggle = (active: boolean) => `px-3 py-1 text-xs rounded-lg font-medium transition-colors ${active ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg border border-s112-border text-s112-text-2 hover:border-s112-teal'}`

  return (
    <div className={`space-y-6 ${isPending ? 'opacity-60 pointer-events-none' : ''}`}>

      {/* Aktions-Leiste */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {verkaufe.length > 0 && (
            <>
              <span className="text-sm text-s112-muted">{fmtNum(sumKg)} kg gesamt</span>
              {sumEur > 0 && (
                <span className="text-sm font-semibold text-s112-text">
                  {'·'} {'€'} {fmtNum(sumEur, 2)}
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-start gap-3 flex-wrap justify-end">
          {verkaufe.length > 0 && (
            <CsvExportKnopf label="Liste als CSV" erzeugen={listeErzeugen} />
          )}
          {bkiErlaubt && verkaufe.length > 0 && (
            <div className="flex items-start gap-1.5">
              <select aria-label="Jahrgang für das BKI-Datenblatt" value={bkiJahrgang} onChange={e => setBkiJahrgang(e.target.value)}
                className="text-xs border border-s112-border rounded-lg px-2 py-1.5 bg-white">
                <option value="">alle Jahrgänge</option>
                {bkiJahrgaenge.map(j => <option key={j} value={j}>{j}</option>)}
              </select>
              <CsvExportKnopf label="BKI-Datenblatt als CSV" hinweis={HINWEIS_BKI_UPLOAD} href={csvPfad('bki-traubenverkauf', { jahrgang: bkiJahrgang })} />
            </div>
          )}
          {writeOk && !showForm && (
            <button onClick={openNew} className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
              + Traubenverkauf
            </button>
          )}
        </div>
      </div>

      {/* Fehler aus der Liste (z. B. Löschen) – im Formular steht er dort */}
      {error && !showForm && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-sm flex items-start justify-between gap-3">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-xs underline shrink-0">Schließen</button>
        </div>
      )}

      {/* Formular */}
      {showForm && writeOk && (
        <div className="card border-2 border-s112-teal/30">
          <h2 className="text-sm font-semibold text-s112-text mb-4">
            {editRow ? 'Traubenverkauf bearbeiten' : 'Neuer Traubenverkauf'}
          </h2>
          {error && (
            <div className="mb-3 bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-xs">
              {error}
            </div>
          )}

          <form data-ungespeichert onSubmit={handleSubmit} className="space-y-4">
            {editRow && <input type="hidden" name="existing_id" value={editRow.id} />}
            <input type="hidden" name="weingarten_id" value={wgId} />
            <input type="hidden" name="zukauf_posten_id" value={zukaufId} />

            {/* Quelle */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-2">Quelle</label>
              <div className="flex gap-2">
                <button type="button" onClick={() => setQuelle('ernte')} className={btnToggle(quelle === 'ernte')}>
                  Eigene Ernte
                </button>
                <button type="button" onClick={() => setQuelle('zukauf')} className={btnToggle(quelle === 'zukauf')}>
                  Zukauf
                </button>
              </div>
            </div>

            {quelle === 'zukauf' ? (
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Zukauf-Posten *</label>
                <select aria-label="Zukauf-Posten" value={zukaufId} onChange={e => handleZukaufChange(e.target.value)} required className={inp}>
                  <option value="">– Zukauf wählen –</option>
                  {zukaufOptions.map(z => (
                    <option key={z.id} value={z.id}>
                      {fmtDate(z.datum)}{z.rebsorte ? ' · ' + formatRebsorteMitKuerzel(z.rebsorte) : ''}{' · '}{z.lieferant}
                      {' – '}{fmtNum(verfuegbarZukauf(z.id), { max: 0 })} kg verf.
                    </option>
                  ))}
                </select>
                {zukaufOptions.length === 0 && (
                  <p className="text-xs text-s112-warn-fg mt-1">Keine zugekauften Trauben vorhanden.</p>
                )}
                {zukaufId && (
                  <p className="text-xs text-s112-muted mt-1">
                    Verfügbar: <span className="font-medium text-s112-text-1">{fmtNum(verfuegbarZukauf(zukaufId), { max: 0 })} kg</span>
                  </p>
                )}
              </div>
            ) : (
            <div className="grid grid-cols-2 gap-3">

              {/* KAN-129: Lese – Ried/GST und verfügbare kg nur aus dieser Lese */}
              <div className="col-span-2">
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Lese *</label>
                <select aria-label="Lese" value={leseId} onChange={e => handleLeseChange(e.target.value)} required
                  disabled={!!editRow && !!editRow.lese_id} className={inp}>
                  <option value="">– Lese wählen –</option>
                  {lesenMitErnte.map(l => <option key={l.id} value={l.id}>{l.titel}</option>)}
                </select>
                {editRow?.lese_id && (
                  <p className="text-xs text-s112-muted mt-1">Die Lese eines gespeicherten Verkaufs bleibt unverändert.</p>
                )}
              </div>

              {/* Ried */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Ried *</label>
                <select aria-label="Ried" value={wgId} onChange={e => handleWgChange(e.target.value)} required disabled={!leseId} className={inp}>
                  <option value="">– Ried wählen –</option>
                  {wgList.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
                {alleErnteOptions.length === 0 && (
                  <p className="text-xs text-s112-warn-fg mt-1">Noch keine Ernte vorhanden.</p>
                )}
                {wgId && (
                  <p className="text-xs text-s112-muted mt-1">
                    Verfügbar: <span className="font-medium text-s112-text-1">{fmtNum(verfuegbareKgByWG(wgId), { max: 0 })} kg</span>
                  </p>
                )}
              </div>

              {/* GST */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Grundstück (GST)</label>
                <select aria-label="Grundstück (GST)" value={gstId} onChange={e => handleGstChange(e.target.value)} disabled={!wgId || gstList.length === 0} className={inp}>
                  <option value="">– gesamt (alle GST) –</option>
                  {gstList.map(g => (
                    <option key={g.id} value={g.id}>
                      {'GST ' + g.gst_nr + (g.rebsorte ? ' – ' + formatRebsorteMitKuerzel(g.rebsorte) : '')}
                    </option>
                  ))}
                </select>
                {gstId && (
                  <p className="text-xs text-s112-muted mt-1">
                    Verfügbar: <span className="font-medium text-s112-text-1">{fmtNum(verfuegbareKgByGST(gstId), { max: 0 })} kg</span>
                  </p>
                )}
              </div>
            </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* Jahrgang (abgeleitet) */}
              {jahrgangNr && (
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Jahrgang (abgeleitet)</label>
                  <div className={inp + ' bg-s112-bg text-s112-text-2 cursor-not-allowed'}>{jahrgangNr}</div>
                </div>
              )}

              {/* Lieferdatum */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Lieferdatum *</label>
                <input aria-label="Lieferdatum" name="datum" type="date" required
                  defaultValue={editRow?.datum ?? heuteWien()}
                  className={inp} />
              </div>

              {/* Menge */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (kg) *</label>
                <input aria-label="Menge (kg)" name="menge_kg" type="text" inputMode="decimal" required
                  defaultValue={editRow?.menge_kg ?? ''} placeholder="z.B. 1.250" className={inp} />
              </div>

              {/* Preis */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Preis (EUR/kg)</label>
                <input aria-label="Preis (EUR/kg)" name="preis_per_kg" type="text" inputMode="decimal"
                  defaultValue={editRow?.preis_per_kg ?? ''} placeholder="z.B. 0,65" className={inp} />
              </div>

              {/* Mostgewicht in °KMW oder °Oe (KAN-128) – bevorzugte Einheit des Betriebs zuerst */}
              <div className="col-span-2">
                <MostgewichtEingabe key={editRow?.id ?? 'neu'} name="mostgewicht" startwert={mgStart} />
              </div>

              {/* Qualität */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Qualitätsstufe</label>
                <select aria-label="Qualitätsstufe" name="qualitaetsstufe" value={qualitaet} onChange={e => setQualitaet(e.target.value)} className={inp}>
                  <option value="">– keine –</option>
                  {/* gespeicherter Wert (nicht der Formularzustand): bleibt nach einem Wechsel wieder wählbar;
                      die Vorbelegung bei der Neuanlage kommt aus ernte_parzellen (CHECK = Lese-Liste) */}
                  {mitGespeichertemWert(LESE_QUALITAETEN, editRow?.qualitaetsstufe).map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
                </select>
              </div>

              {/* Gesundheit */}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Traubengesundheit</label>
                <select aria-label="Traubengesundheit" name="gesundheit" defaultValue={editRow?.gesundheit ?? 'G'} className={inp}>
                  <option value="G">G – Gut (Standard)</option>
                  <option value="K">K – Krank / beschädigt</option>
                </select>
              </div>

              {/* Herkunft-Code */}
              {herkunft && (
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Herkunft-Code (BKI)</label>
                  <div className={inp + ' bg-s112-bg text-s112-text-2 cursor-not-allowed'}>{herkunftAnzeige(herkunft)}</div>
                </div>
              )}

            </div>

            {/* Käufer */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-2">Käufer</label>
              <div className="flex gap-2 mb-2">
                <button type="button" onClick={() => setKaeuferTyp('firma')} className={btnToggle(kaeuferTyp === 'firma')}>
                  Firma
                </button>
                <button type="button" onClick={() => setKaeuferTyp('kontakt')} className={btnToggle(kaeuferTyp === 'kontakt')}>
                  Privatperson
                </button>
              </div>
              {/* Suche statt Auswahlliste (05.10.2026): Gebeshuber hat 8.290 Kontakte und 4.652 Firmen */}
              {kaeuferTyp === 'firma' ? (
                <PartnerSuche art="firma" value={firmaId} onChange={id => setFirmaId(id)} placeholder="Firma suchen (Name, Ort, Kundennr.) …" />
              ) : (
                <PartnerSuche art="kontakt" value={kontaktId} onChange={id => setKontaktId(id)} placeholder="Person suchen (Name, Ort, Kundennr.) …" />
              )}
            </div>

            {/* Notizen */}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
              <input aria-label="Notizen" name="notizen" type="text" defaultValue={editRow?.notizen ?? ''} placeholder="optional" className={inp} />
            </div>

            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={isPending || (quelle === 'ernte' ? !wgId : !zukaufId)}
                className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50 transition-colors">
                {isPending ? 'Speichert…' : 'Speichern'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditRow(null); setError(null) }}
                className="px-4 py-1.5 text-sm text-s112-text-2 hover:text-s112-text">
                Abbrechen
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste */}
      {verkaufe.length === 0 && !showForm ? (
        <div className="card text-center py-10 text-s112-muted text-sm">
          Noch keine Traubenverkäufe erfasst.
        </div>
      ) : (
        <div className="space-y-2">
          <StornierteUmschalter anzahl={anzahlStorniert} sichtbar={stornierteZeigen} onChange={setStornierteZeigen} />
          {sichtbare.map(v => {
            const wg     = v.weingarten as R | null
            const gst    = v.grundstueck as R | null
            const jg     = v.jahrgang as R | null
            const firma  = v.firma as R | null
            const kontkt = v.kontakt as R | null
            const kaeufer = firma?.name ?? ([kontkt?.vorname, kontkt?.nachname].filter(Boolean).join(' ') || '–')
            // Quelle-Label: eigener Weingarten ODER zugekaufter Posten (Migration 141)
            const zukaufPosten = v.zukauf_posten_id
              ? zukaufOptions.find(z => z.id === v.zukauf_posten_id)
              : null
            const quelleLabel = wg?.name
              ?? (zukaufPosten
                    ? `Zukauf – ${zukaufPosten.rebsorte ? formatRebsorteMitKuerzel(zukaufPosten.rebsorte) : '–'}${zukaufPosten.lieferant ? ' (' + zukaufPosten.lieferant + ')' : ''}`
                    : (v.zukauf_posten_id ? 'Zukauf' : '–'))
            return (
              <div key={v.id} className={`group card ${v.storniert_am ? 'text-s112-muted opacity-70' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.liefernummer && (
                          <span className="font-mono text-xs bg-s112-teal/10 text-s112-blue-700 px-2 py-0.5 rounded-full font-semibold">
                            {v.liefernummer}
                          </span>
                        )}
                        <span className="font-medium text-s112-text text-sm">{fmtDate(v.datum)}</span>
                        <span className="text-sm text-s112-text-1">{'·'} {quelleLabel}</span>
                        {gst && (
                          <span className="text-xs font-mono text-s112-muted bg-s112-bg px-1.5 py-0.5 rounded-sm">
                            GST {gst.gst_nr}
                          </span>
                        )}
                        {jg && <span className="text-xs text-s112-muted">{v.lese_id && lesen.find(l => l.id === v.lese_id) ? `Lese ${lesen.find(l => l.id === v.lese_id)!.titel}` : `JG ${jg.jahrgang}`}</span>}
                        {v.gesundheit === 'K' && (
                          <span className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full font-medium">
                            K {'–'} Krank
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-s112-muted flex-wrap">
                        <span className="font-semibold text-s112-text-1">{fmt(v.menge_kg, 0)} kg</span>
                        {v.preis_per_kg != null && (
                          <span>
                            {'·'} EUR {fmt(v.preis_per_kg)}/kg{' '}
                            <span className="font-medium text-s112-text-1">
                              = EUR {fmt(Number(v.menge_kg) * Number(v.preis_per_kg), 2)}
                            </span>
                          </span>
                        )}
                        {(v.kmw_grad != null || v.oechsle != null) && (
                          <span>{'·'} <MostgewichtAnzeige wert={mostgewichtVon(v.kmw_grad, v.oechsle, v.mostgewicht_einheit)} /></span>
                        )}
                        {v.qualitaetsstufe && <span>{'·'} {qualitaetLabel(v.qualitaetsstufe)}</span>}
                        {v.herkunft_code && <span className="font-mono">{'·'} {v.herkunft_code}</span>}
                        <span>{'·'} {kaeufer}</span>
                        {v.notizen && <span className="italic">{'·'} {v.notizen}</span>}
                      </div>
                      {v.storniert_am && (
                        <p className="text-[11px] text-s112-warn-fg">
                          storniert am {new Date(v.storniert_am).toLocaleDateString('de-AT')}{v.storniert_von_name ? ` von ${v.storniert_von_name}` : ''}{v.storno_grund ? ` – ${v.storno_grund}` : ''}
                        </p>
                      )}
                    </div>
                    {writeOk && !v.storniert_am && (
                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <button onClick={() => openEdit(v)} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-blue-700 hover:text-s112-blue-700/70">
                          <Pencil className="w-4 h-4" />
                        </button>
                        {/* KAN-148 C1b: stornieren statt löschen (Liefernummer und Rechnungsbezug bleiben) */}
                        <StornoButton
                          action={grund => stornoTraubenverkauf(v.id, grund)}
                          hinweis={`Der Traubenverkauf bleibt samt Liefernummer als storniert stehen, die kg werden wieder frei.${v.verkaufsposten_id ? ' Eine offene Rechnung, die nur diesen Traubenverkauf enthält, wird dabei storniert – sie bleibt als stornierter Beleg erhalten.' : ''}`} />
                      </div>
                    )}
                    {/* KAN-148 C1d: endgültig löschen nur stornierter Traubenverkäufe ohne Rechnung */}
                    {writeOk && v.storniert_am && !v.verkaufsposten_id && (
                      <div className="flex items-center gap-2 shrink-0 text-xs">
                        <StornoButton modus="loeschen" label="Endgültig löschen"
                          action={grund => endgueltigLoeschenTraubenverkauf(v.id, grund)}
                          hinweis="Nur bei einer Fehlerfassung: Der stornierte Eintrag wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll. Nach einer eingereichten Erntemeldung nicht mehr möglich." />
                      </div>
                    )}
                  </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
