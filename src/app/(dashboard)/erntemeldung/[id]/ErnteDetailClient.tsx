'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { upsertErnteParzelle, deleteErnteParzelle, createOrUpdateAMAMeldung, createMultipleErnteParzellen } from '../actions'
import { qualitaetLabel, LESE_QUALITAETEN, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'
import type { ErnteParzelle, WeingartenOpt, GSTOpt, AMAMeldung, HektarhoechstertragStatus } from './page'
import PressungSection from './PressungSection'
import type { Pressung, WGOption, BehOption, WAOption, ZukaufTraubenOpt } from './PressungSection'
import { fmtHa, fmtZahl, fmtProzent, fmtNum, zahlAus } from '@/lib/format'
import { Pencil, Trash2, AlertTriangle, Plus } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fehlerText } from '@/lib/fehler'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'
import { messwertText, type GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import { ZEILE_OHNE_MOSTGEWICHT, zeileMostgewichtAendern, type EingabeZustand, type ZeilenMostgewicht } from '@/lib/wein/mostgewichtEingabe'
import { riedGruppen, istEinzelRied, weingartenZusatz } from '@/lib/wein/riedAuswahl'
import {
  alleKnopfText, bezugsflaeche, leseSuche, leseTreffer, leseZiele, trefferAusgewaehlt, trefferEntfernen, trefferHinzufuegen,
  trefferTeilweise, verteileKg, verteilungsHinweis, type LeseAuswahl, type LeseTreffer, type LeseZiel,
} from '@/lib/wein/leseErfassung'

// Qualitätsstufen der Lese: LESE_QUALITAETEN aus lib/wein/qualitaet (KAN-73) – genau die
// Stufen, die ernte_parzellen speichern kann (DAC, Reserve & Co. erst an der Charge/Füllung)
const LESEMETHODE_OPTS = [
  { value: 'handlese', label: 'Handlese' },
  { value: 'maschinenlese', label: 'Maschinenlese' },
  { value: 'selektionslese', label: 'Selektionslese' },
]
const AMA_STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  entwurf:     { label: 'Entwurf',     cls: 'bg-[#F2F3F5] text-s112-text-2' },
  bereit:      { label: 'Bereit',      cls: 'bg-s112-blue-100 text-s112-blue-700' },
  eingereicht: { label: 'Eingereicht', cls: 'bg-s112-warn-bg text-s112-warn-fg' },
  bestaetigt:  { label: 'Bestätigt',   cls: 'bg-s112-ok-bg text-s112-ok-fg' },
  abgelehnt:   { label: 'Abgelehnt',   cls: 'bg-s112-err-bg text-s112-err-fg' },
}

// Erfassung je Grundstück in der Sammelerfassung („Mengen je Grundstück einzeln erfassen“, KAN-161). Mostgewicht (KAN-128) als Messwert mit Einheit aus
// der Eingabe-Komponente – im Zustand, weil die Zeile beim Abwählen oder Umschalten verschwindet:
// zuletzt gültiger Wert, Fehler der aktuellen Eingabe und der Eingabezustand fürs Wiedereinblenden
// (lib/wein/mostgewichtEingabe.ts, ZeilenMostgewicht).
type GstEingabe = { menge_kg: string; mg: ZeilenMostgewicht; lesemethode: string; notizen: string }
const GST_LEER: GstEingabe = { menge_kg: '', mg: ZEILE_OHNE_MOSTGEWICHT, lesemethode: '', notizen: '' }

/** Mostgewicht einer Grundstückszeile: beginnt beim Einblenden mit dem zuletzt gemeldeten
 *  Eingabezustand (auch einem ungültigen Text samt Fehler) – anfangsZustand gilt nur beim ersten
 *  Rendern, sonst begänne die Eingabe bei jedem Tastendruck neu. */
function GstMostgewicht({ gstId, zeile, onChange }: {
  gstId: string
  zeile: ZeilenMostgewicht
  onChange: (zustand: EingabeZustand) => void
}) {
  return (
    <MostgewichtEingabe name={`gst_${gstId}_mostgewicht`} anfangsZustand={zeile.zustand}
      onChange={(_wert, info) => onChange(info.zustand)} />
  )
}

function formatDate(d: string | null) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Notiz einer Lese in der Tabelle (KAN-144, z. B. Grund für 0 kg) – derselbe Wert wie in der CSV
 * „Lesedaten“ (LeseZeile.notizen aus ladeLesedaten). Höchstens zwei Zeilen, voller Text als title;
 * abgeschnittene Notizen klappen per Klick bzw. Tippen auf (Touch hat keinen Tooltip). Im Druck immer vollständig.
 * Ob gekürzt wird, hängt an der Spaltenbreite, nicht an der Zeichenzahl: Auf Telefon und Tablet bleibt die
 * Spalte wegen min-w-[700px] der Tabelle bei min-w-[7rem], dort reichen schon rund 30 Zeichen für drei Zeilen.
 * Deshalb wird der Überlauf gemessen und nur eine tatsächlich abgeschnittene Notiz zum Knopf.
 * Gekürzt und gemessen wird immer dasselbe innere span; die Hülle bleibt dasselbe Element und bekommt
 * nur Rolle, Fokus und Klick dazu. Kein Wechsel span ↔ <button>: In WebKit (Safari, alle Browser auf iOS)
 * kürzt -webkit-line-clamp keinen <button> – die Messung meldete dort „passt“, der span wieder
 * „abgeschnitten“, und die Zelle sprang endlos hin und her (Review 26.09.2026).
 */
function NotizZelle({ text }: { text: string | null }) {
  const [offen, setOffen] = useState(false)
  const [abgeschnitten, setAbgeschnitten] = useState(false)
  // Ref als State: das innere span entsteht erst, wenn es eine Notiz gibt (vorher steht nur „–“)
  const [el, setEl] = useState<HTMLSpanElement | null>(null)

  useEffect(() => {
    // Aufgeklappt ist nichts abgeschnitten – dann nicht messen, sonst verschwände der Knopf zum Zuklappen
    if (!el || offen) return
    let aktiv = true
    const pruefe = () => { if (aktiv) setAbgeschnitten(el.scrollHeight > el.clientHeight + 1) }
    pruefe()
    // Die Spaltenbreite ändert sich mit Fenster und Nachbarzellen, der Umbruch zusätzlich mit dem Nachladen der Schrift
    const beobachter = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(pruefe)
    beobachter?.observe(el)
    document.fonts?.ready.then(pruefe).catch(() => {})
    return () => { aktiv = false; beobachter?.disconnect() }
  }, [el, offen, text])

  if (!text) return <span className="text-s112-muted">–</span>
  // Aufgeklappt bleibt der Knopf zum Zuklappen, auch wenn die Messung ruht
  const klickbar = offen || abgeschnitten
  const umschalten = () => setOffen(o => !o)
  return (
    <span title={text}
      role={klickbar ? 'button' : undefined}
      tabIndex={klickbar ? 0 : undefined}
      aria-expanded={klickbar ? offen : undefined}
      onClick={klickbar ? umschalten : undefined}
      onKeyDown={klickbar ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); umschalten() } } : undefined}
      className={`block min-w-[7rem] max-w-[10rem] sm:max-w-[14rem] ${klickbar ? 'cursor-pointer hover:text-s112-text focus-visible:text-s112-text' : ''}`}>
      <span ref={setEl} className={`whitespace-pre-line [overflow-wrap:anywhere] ${offen ? 'line-clamp-none' : 'line-clamp-2'} print:line-clamp-none`}>
        {text}
      </span>
    </span>
  )
}

// ── Neu-Formular: Mehrfacherfassung (Checkboxen nach Ried + GST) ──────────────
// KAN-160: Gruppen aus riedGruppen („Ohne Ried-Zuordnung“ am Ende), „Alle auswählen“ ↔ „Alle abwählen“, nur
// erntebare Weingärten (mind. ein WI-Grundstück oder gar keine Grundstücke) wählbar.
// KAN-161: EINE Gesamtmenge für die ganze Auswahl, nach Fläche auf alle gewählten Grundstücke verteilt (Vorschau
// unten, die Action rechnet mit derselben Funktion und den Flächen aus der Datenbank); wahlweise Mengen je Grundstück.
// KAN-162: Suche nach Ried, Lage, AMA-Feldstücknummer und GST-Nummer; „Alle Treffer auswählen“ wirkt nur auf Treffer.
// Pilot-Rückmeldung 29.09.2026: nicht erntebare Weingärten (nur Acker, Grünland, Brache …) gar nicht anbieten;
// eine Ried mit genau einem Weingarten als EINE Zeile (statt Ried-Kopf und gleichnamigem Weingarten darunter).
function NeueParzellenForm({
  jahrgangId, weingaerten: alleWeingaerten, gstByWeingarten, onDone,
}: {
  jahrgangId: string; weingaerten: WeingartenOpt[]
  gstByWeingarten: Record<string, GSTOpt[]>; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [selectedWGs, setSelectedWGs] = useState<Set<string>>(new Set())
  const [selectedGSTs, setSelectedGSTs] = useState<Map<string, string>>(new Map())
  const [expandedWGs, setExpandedWGs] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [suche, setSuche] = useState('')
  // Umschalter „Mengen je Grundstück einzeln erfassen“ (KAN-161) – sonst eine Gesamtmenge für die ganze Auswahl
  const [einzeln, setEinzeln] = useState(false)
  const [mengeGesamt, setMengeGesamt] = useState('')
  // Eingaben je Zeile (nur bei Einzelerfassung) – Schlüssel: Grundstück bzw. „wg:<id>“ für einen Weingarten ohne GST
  const [gstData, setGstData] = useState<Map<string, GstEingabe>>(new Map())
  function gstAendern(gstId: string, patch: Partial<GstEingabe>) {
    setGstData(prev => { const n = new Map(prev); n.set(gstId, { ...(n.get(gstId) ?? GST_LEER), ...patch }); return n })
  }
  // Mostgewicht: ein gültiger Wert ersetzt den letzten und löscht den Fehler, ein ungültiger setzt
  // nur den Fehler (der zuletzt gültige Wert bleibt) – immer mit dem aktuellen Eingabezustand
  function gstMostgewichtAendern(gstId: string, zustand: EingabeZustand) {
    setGstData(prev => {
      const n = new Map(prev)
      const alt = n.get(gstId) ?? GST_LEER
      n.set(gstId, { ...alt, mg: zeileMostgewichtAendern(alt.mg, zustand) })
      return n
    })
  }

  const weingaerten = alleWeingaerten.filter(w => w.erntebar)
  const ausgeblendet = alleWeingaerten.length - weingaerten.length
  const gruppen = riedGruppen(weingaerten)
  const wgById = new Map(weingaerten.map(w => [w.id, w]))
  const sucheErg = leseSuche(suche, weingaerten, gstByWeingarten)
  const auswahl: LeseAuswahl = { weingaerten: selectedWGs, gst: selectedGSTs }
  const erntebar = (wgs: readonly WeingartenOpt[]) => wgs.filter(w => w.erntebar).map(w => w.id)
  const alleTreffer = leseTreffer(erntebar(weingaerten), sucheErg)
  const alleAbwaehlen = trefferAusgewaehlt(alleTreffer, auswahl, gstByWeingarten)

  // Zielflächen und Verteilung – dieselben Funktionen wie createMultipleErnteParzellen
  const wgFlaeche: Record<string, number | null> = {}
  for (const w of weingaerten) wgFlaeche[w.id] = w.flaeche_ha
  const ziele = leseZiele([...selectedWGs], [...selectedGSTs].map(([gst_id, weingarten_id]) => ({ gst_id, weingarten_id })), gstByWeingarten, wgFlaeche)
  const zielKey = (z: LeseZiel) => z.grundstueck_id ?? `wg:${z.weingarten_id}`
  const zielName = (z: LeseZiel) => {
    const w = wgById.get(z.weingarten_id)
    const g = z.grundstueck_id ? (gstByWeingarten[z.weingarten_id] ?? []).find(x => x.id === z.grundstueck_id) : null
    return { ried: w?.name ?? '–', gst: g ? `GST ${g.gst_nr}` : 'ohne GST' }
  }
  const mengeZahl = zahlAus(mengeGesamt)
  const mengeUngueltig = mengeGesamt.trim() !== '' && (mengeZahl == null || mengeZahl < 0)
  const vorschau = verteileKg(mengeUngueltig ? null : mengeZahl, ziele.map(z => z.flaeche_ha))
  const hinweis = einzeln ? null : verteilungsHinweis(ziele.map(z => z.flaeche_ha))
  const summeHa = ziele.reduce((s, z) => s + (bezugsflaeche(z.flaeche_ha) ?? 0), 0)

  function umschalten(t: LeseTreffer) {
    const neu = trefferAusgewaehlt(t, auswahl, gstByWeingarten)
      ? trefferEntfernen(t, auswahl, gstByWeingarten)
      : trefferHinzufuegen(t, auswahl)
    setSelectedWGs(neu.weingaerten)
    setSelectedGSTs(neu.gst)
  }
  function alleUmschalten() {
    // ohne Suche leert „Alle abwählen“ die ganze Auswahl (wie bei den Maßnahmen, KAN-155)
    if (!sucheErg.aktiv && alleAbwaehlen) { setSelectedGSTs(new Map()); setSelectedWGs(new Set()); return }
    umschalten(alleTreffer)
  }
  function toggleExpand(wgId: string) {
    setExpandedWGs(prev => { const n = new Set(prev); n.has(wgId) ? n.delete(wgId) : n.add(wgId); return n })
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (ziele.length === 0) { setError('Bitte mindestens eine Ried oder ein Grundstück auswählen.'); return }
    if (!einzeln && mengeUngueltig) { setError('Die Menge ist keine gültige Zahl (≥ 0).'); return }
    // Ungültiges Mostgewicht bzw. ungültige Menge einer Zeile – sonst ginge es still verloren
    if (einzeln) {
      for (const z of ziele) {
        const gstId = zielKey(z)
        const f = gstData.get(gstId)?.mg.fehler
        const m = gstData.get(gstId)?.menge_kg ?? ''
        const name = zielName(z)
        if (f) { setError(`${name.ried} · ${name.gst}: ${f}`); return }
        if (m.trim() !== '' && !((zahlAus(m) ?? -1) >= 0)) { setError(`${name.ried} · ${name.gst}: Die Menge ist keine gültige Zahl (≥ 0).`); return }
      }
    }
    setError(null)
    const fd = new FormData(e.currentTarget)
    if (einzeln) {
      // jede Zeile mit eigener Menge; ohne Eingabe gelten die gemeinsamen Felder
      fd.append('grundstueck_json', JSON.stringify(ziele.map(z => {
        const data = gstData.get(zielKey(z))
        const mg = data?.mg.wert ?? null   // ohne Fehler (oben geprüft) = aktuelle Eingabe
        return {
          gst_id: z.grundstueck_id, weingarten_id: z.weingarten_id,
          menge_kg: data?.menge_kg?.trim() ? data.menge_kg : null,
          // Messwert und Einheit – die Action rechnet beide Werte selbst (KAN-128)
          mostgewicht_wert: mg ? messwertText(mg) : null,
          mostgewicht_einheit: mg?.einheit ?? null,
          lesemethode: data?.lesemethode || null,
          notizen: data?.notizen || null,
        }
      })))
    } else {
      // Gesamtmenge (Feld menge_kg) – die Action verteilt sie selbst nach den Flächen aus der Datenbank
      selectedWGs.forEach(id => fd.append('weingarten_ids', id))
      fd.append('grundstueck_json', JSON.stringify(
        Array.from(selectedGSTs.entries()).map(([gst_id, weingarten_id]) => ({ gst_id, weingarten_id })),
      ))
    }
    startTransition(async () => {
      try { await createMultipleErnteParzellen(jahrgangId, fd); onDone() }
      catch (err) { setError(fehlerText(err)) }
    })
  }

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const zeileCls = 'w-full border border-s112-border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-s112-teal/40 bg-white'
  const sichtbareGruppen = gruppen
    .map(g => ({ ...g, weingaerten: g.weingaerten.filter(w => sucheErg.weingaerten.has(w.id)) }))
    .filter(g => g.weingaerten.length > 0)

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-s112-text">Lesedaten erfassen</h3>
        {ziele.length > 0 && (
          <span className="text-xs text-s112-blue-700 font-medium">
            {ziele.length} {ziele.length === 1 ? 'Fläche' : 'Flächen'} · {fmtNum(summeHa, { max: 4 })} ha
          </span>
        )}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="block text-xs font-medium text-s112-text-2">Rieden <span className="text-s112-err">*</span></span>
          <button type="button" onClick={alleUmschalten} className="text-xs text-s112-blue-700 hover:underline">
            {alleKnopfText(alleAbwaehlen, sucheErg.aktiv)}
          </button>
        </div>
        <input aria-label="Rieden durchsuchen" type="search" value={suche} onChange={e => setSuche(e.target.value)}
          placeholder="Suchen: Ried, Lage, AMA-Feldstück-Nr. oder GST-Nr."
          className={inputCls} />
        {sucheErg.aktiv && sichtbareGruppen.length === 0 && (
          <p className="text-xs text-s112-muted px-1">Keine Treffer für „{suche.trim()}“.</p>
        )}
        {ausgeblendet > 0 && (
          <p className="text-[11px] text-s112-muted px-1">
            {ausgeblendet} {ausgeblendet === 1 ? 'Weingarten' : 'Weingärten'} ohne Weingarten-Grundstück (nur Acker, Grünland, Brache …) {ausgeblendet === 1 ? 'ist' : 'sind'} ausgeblendet.
          </p>
        )}
        {sichtbareGruppen.map(gruppe => {
          const wgs = gruppe.weingaerten
          const gt = leseTreffer(erntebar(wgs), sucheErg)
          const alleGruppe = trefferAusgewaehlt(gt, auswahl, gstByWeingarten)
          const teilGruppe = trefferTeilweise(gt, auswahl)
          const keinErntebar = gt.ganze.length === 0 && gt.einzeln.length === 0
          const einzelRied = istEinzelRied(gruppe)
          return (
            <div key={gruppe.schluessel} className="border border-s112-border rounded-lg overflow-hidden">
              {!einzelRied && <label className={`flex items-center gap-2 px-3 py-1.5 bg-white ${keinErntebar ? 'opacity-60' : 'cursor-pointer hover:bg-s112-bg/60'}`}>
                <input type="checkbox" checked={alleGruppe} disabled={keinErntebar}
                  aria-label={`${gruppe.name}: alle ${sucheErg.aktiv ? 'Treffer' : 'erntebaren'} auswählen`}
                  ref={el => { if (el) el.indeterminate = teilGruppe && !alleGruppe }}
                  onChange={() => umschalten(gt)}
                  className="accent-s112-teal" />
                <span className={`text-xs font-semibold ${gruppe.ohneRied ? 'text-s112-text-2 italic' : 'text-s112-text'}`}>{gruppe.name}</span>
                <span className="text-xs text-s112-muted ml-1">{wgs.length} {wgs.length === 1 ? 'Ried' : 'Rieden'}</span>
              </label>}
              <div className={`divide-y divide-s112-border/40 ${einzelRied ? '' : 'border-t border-s112-border/40'}`}>
                {wgs.map(w => {
                  const alleGsts = gstByWeingarten[w.id] ?? []
                  const gstFilter = sucheErg.gstTreffer.get(w.id)
                  const gsts = gstFilter ? alleGsts.filter(g => gstFilter.has(g.id)) : alleGsts
                  const isExpanded = !!gstFilter || expandedWGs.has(w.id)
                  const wt = leseTreffer([w.id], sucheErg)
                  const wgVoll = w.erntebar && trefferAusgewaehlt(wt, auswahl, gstByWeingarten)
                  const wgTeil = w.erntebar && trefferTeilweise(wt, auswahl)
                  const isActive = wgVoll || wgTeil
                  const fs = w.ama_feldnummer ? `FS ${w.ama_feldnummer}` : null
                  // Einzel-Ried: Ried-Name fett, Weingarten nur als Zusatz, wenn er anders heißt
                  const zusatz = einzelRied ? weingartenZusatz(gruppe.name, w.name) : null
                  const nameEl = einzelRied
                    ? <span className={`text-xs font-semibold ${isActive ? 'text-s112-blue-700' : 'text-s112-text'}`}>{gruppe.name}{zusatz && <span className="font-normal text-s112-text-1"> · {zusatz}</span>}</span>
                    : <span className={`text-xs ${isActive ? 'font-medium text-s112-blue-700' : 'text-s112-text-1'}`}>{w.name}</span>
                  return (
                    <div key={w.id} className={!w.erntebar ? 'bg-s112-bg' : ''}>
                      <div className={`flex items-center gap-2 ${einzelRied ? 'px-3 bg-white' : 'px-4'} py-1.5 ${w.erntebar ? 'hover:bg-s112-bg/40' : 'opacity-50'}`}>
                        <input type="checkbox"
                          aria-label={`${w.name} auswählen`}
                          checked={wgVoll}
                          disabled={!w.erntebar}
                          ref={el => { if (el) el.indeterminate = wgTeil && !wgVoll }}
                          onChange={() => umschalten(wt)}
                          className="accent-s112-teal cursor-pointer disabled:cursor-not-allowed" />
                        {alleGsts.length > 0 && w.erntebar ? (
                          <button type="button" onClick={() => toggleExpand(w.id)} aria-expanded={isExpanded}
                            className="flex items-center gap-1.5 flex-1 text-left">
                            <svg className={`w-3 h-3 text-s112-muted transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            {nameEl}
                            {fs && <span className="text-xs text-s112-muted">· {fs}</span>}
                            <span className="text-xs text-s112-muted ml-auto">
                              {gstFilter ? `${gsts.length} von ${alleGsts.length} GST` : `${alleGsts.length} GST`}
                            </span>
                          </button>
                        ) : (
                          <span className="flex items-center gap-1.5 flex-1">
                            {nameEl}
                            {fs && <span className="text-xs text-s112-muted">· {fs}</span>}
                            {!w.erntebar && <span className="text-xs text-s112-muted ml-auto">nicht erntebar (kein Grundstück der Nutzart WI)</span>}
                          </span>
                        )}
                      </div>
                      {isExpanded && w.erntebar && gsts.length > 0 && (
                        <div className="bg-white border-t border-s112-border/20">
                          {gsts.map(g => {
                            const isGstSel = selectedGSTs.has(g.id) || selectedWGs.has(w.id)
                            return (
                              <label key={g.id} className={`flex items-center gap-2 pl-10 pr-4 py-1 text-xs cursor-pointer hover:bg-s112-bg/30 ${isGstSel ? 'bg-s112-teal/5' : ''}`}>
                                <input type="checkbox"
                                  checked={isGstSel}
                                  onChange={() => umschalten({ ganze: [], einzeln: [{ gst_id: g.id, weingarten_id: w.id }] })}
                                  className="accent-s112-teal" />
                                <span className={`font-mono ${isGstSel ? 'text-s112-blue-700 font-medium' : 'text-s112-text-2'}`}>
                                  GST {g.gst_nr}
                                </span>
                                {g.rebsorte && <span className="text-s112-muted">· {formatRebsorteMitKuerzel(g.rebsorte)}</span>}
                                <span className="text-s112-muted ml-auto">{g.flaeche_ha ? `${g.flaeche_ha.toFixed(4)} ha` : 'ohne Fläche'}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Ernte-Datum</label>
          <input aria-label="Ernte-Datum" name="ernte_datum" type="date" defaultValue={new Date().toISOString().split('T')[0]} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Lesemethode</label>
          <select aria-label="Lesemethode" name="lesemethode" className={inputCls}>
            <option value="">–</option>
            {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {!einzeln && (
          <div className="col-span-2">
            <label htmlFor="lese-menge-gesamt" className="block text-xs font-medium text-s112-text-2 mb-1">
              Menge kg gesamt <span className="text-s112-muted font-normal">(nach Fläche auf alle gewählten Grundstücke aufgeteilt)</span>
            </label>
            <input id="lese-menge-gesamt" name="menge_kg" type="text" inputMode="decimal" placeholder="–"
              value={mengeGesamt} onChange={e => setMengeGesamt(e.target.value)}
              aria-invalid={mengeUngueltig || undefined}
              className={inputCls} />
            {mengeUngueltig && <p className="text-xs text-s112-err-fg mt-0.5">Bitte eine Zahl ≥ 0 eingeben.</p>}
          </div>
        )}
        <div className="col-span-2">
          {/* Mostgewicht in °KMW oder °Oe (KAN-128) – die Qualitätsstufe folgt aus den °KMW
              (bei °Oe-Messung aus dem umgerechneten, gespeicherten °KMW; ohne Mostgewicht Qualitätswein).
              Bei Einzelerfassung gilt es für jede Zeile ohne eigenes Mostgewicht. */}
          <MostgewichtEingabe name="mostgewicht" label="Mostgewicht & Qualitätsstufe" qualitaetsVorschau />
          <p className="text-xs text-s112-muted mt-0.5">Qualitätsstufe wird automatisch aus den °KMW abgeleitet (ohne Mostgewicht: Qualitätswein).</p>
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input aria-label="Notizen" name="notizen" className={inputCls} placeholder="optional" />
        </div>
      </div>

      {/* Verteilung (KAN-161): Vorschau je Grundstück bzw. Eingabe je Grundstück */}
      {ziele.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-medium text-s112-text-2">
              {einzeln ? 'Mengen je Grundstück' : 'Verteilung der Menge'}
            </p>
            <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer">
              <input type="checkbox" checked={einzeln} onChange={e => setEinzeln(e.target.checked)} className="accent-s112-teal" />
              Mengen je Grundstück einzeln erfassen
            </label>
          </div>
          {hinweis && <p role="status" className="text-xs text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-1.5">{hinweis}</p>}
          <div className="border border-s112-border rounded-lg bg-white divide-y divide-s112-border/40 max-h-96 overflow-y-auto">
            {ziele.map((z, i) => {
              const gstId = zielKey(z)
              const name = zielName(z)
              const ha = bezugsflaeche(z.flaeche_ha)
              return (
                <div key={gstId} className="px-3 py-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="text-s112-text-1 truncate">{name.ried}</span>
                    <span className="font-mono text-s112-text-2">{name.gst}</span>
                    <span className="text-s112-muted">{ha != null ? `${fmtNum(ha, { max: 4 })} ha` : 'ohne Fläche'}</span>
                    {!einzeln && (
                      <span className="ml-auto tabular-nums font-medium text-s112-text">
                        {vorschau[i] == null ? '–' : `${fmtNum(vorschau[i] as number, { max: 2 })} kg`}
                      </span>
                    )}
                  </div>
                  {einzeln && (
                    <div className="grid grid-cols-4 gap-2 mt-1">
                      <div>
                        <label className="block text-xs text-s112-text-2 mb-0.5">Menge kg</label>
                        <input aria-label={`Menge kg ${name.ried} ${name.gst}`} type="text" inputMode="decimal" placeholder="–"
                          value={gstData.get(gstId)?.menge_kg ?? ''}
                          onChange={e => gstAendern(gstId, { menge_kg: e.target.value })}
                          className={zeileCls} />
                      </div>
                      <div>
                        <label className="block text-xs text-s112-text-2 mb-0.5">Lesemethode</label>
                        <select aria-label={`Lesemethode ${name.ried} ${name.gst}`}
                          value={gstData.get(gstId)?.lesemethode ?? ''}
                          onChange={e => gstAendern(gstId, { lesemethode: e.target.value })}
                          className={zeileCls}>
                          <option value="">wie oben</option>
                          {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="col-span-2">
                        <label className="block text-xs text-s112-text-2 mb-0.5">Notizen</label>
                        <input aria-label={`Notizen ${name.ried} ${name.gst}`} type="text" placeholder="wie oben"
                          value={gstData.get(gstId)?.notizen ?? ''}
                          onChange={e => gstAendern(gstId, { notizen: e.target.value })}
                          className={zeileCls} />
                      </div>
                      {/* Mostgewicht in °KMW oder °Oe (KAN-128); leer = gemeinsames Mostgewicht */}
                      <div className="col-span-4">
                        <GstMostgewicht gstId={gstId} zeile={gstData.get(gstId)?.mg ?? ZEILE_OHNE_MOSTGEWICHT}
                          onChange={zustand => gstMostgewichtAendern(gstId, zustand)} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {!einzeln && mengeZahl != null && !mengeUngueltig && (
            <p className="text-xs text-s112-muted">
              Summe {fmtNum(vorschau.reduce<number>((s, v) => s + (v ?? 0), 0), { max: 2 })} kg – Rundungsrest auf die größte Fläche.
            </p>
          )}
        </div>
      )}

      {error && <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending || ziele.length === 0}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : `${ziele.length > 0 ? `${ziele.length} × ` : ''}Speichern`}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}
// ── Edit-Formular: Einzelerfassung (bestehende Parzelle bearbeiten) ─────────────
function ParzellForm({
  jahrgangId, weingaerten, gstByWeingarten, parzelle, onDone,
}: {
  jahrgangId: string; weingaerten: WeingartenOpt[]
  gstByWeingarten: Record<string, GSTOpt[]>
  parzelle?: ErnteParzelle; onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  // Mostgewicht wie gespeichert (Messwert + Einheit, KAN-128) – beim Öffnen nichts neu rechnen
  const [mgStart] = useState<GespeichertesMostgewicht | null>(() => (parzelle
    ? { kmw: parzelle.klosterneuburger, oechsle: parzelle.oechsle, einheit: parzelle.mostgewicht_einheit }
    : null))
  const [kmwEdit, setKmwEdit] = useState<number | null>(
    parzelle?.klosterneuburger != null ? Number(parzelle.klosterneuburger) : null
  )
  const [mgGeaendert, setMgGeaendert] = useState(false)
  const [selWgId, setSelWgId] = useState<string>(parzelle?.weingarten_id ?? '')
  const [selGstId, setSelGstId] = useState<string>(parzelle?.grundstueck_id ?? '')
  // Stufe nur aus den °KMW von ausMessung() (onChange der Eingabe, Rechenregel 5)
  const derivedQualitaetEdit = kmwEdit != null && Number.isFinite(kmwEdit) ? kmwZuQualitaet(kmwEdit) : 'qualitaetswein'
  const [qualitaetEdit, setQualitaetEdit] = useState<string | null>(parzelle?.qualitaetsstufe ?? null)
  const effectiveQualitaetEdit = qualitaetEdit ?? derivedQualitaetEdit
  const verfuegbareGSTs = selWgId ? (gstByWeingarten[selWgId] ?? []) : []
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setError(null)
    startTransition(async () => {
      try {
        await upsertErnteParzelle(jahrgangId, fd)
        onDone()
      } catch (err) {
        // z. B. KAN-35-Sperre: Lesemenge schon verpresst/verkauft
        setError(fehlerText(err))
      }
    })
  }

  // Gruppen wie in der Erfassung (KAN-160): Rieden alphabetisch, „Ohne Ried-Zuordnung“ am Ende; nur erntebare
  // Weingärten (der schon gespeicherte bleibt wählbar), Ried mit genau einem Weingarten ohne eigene Gruppe
  const lagen = riedGruppen(weingaerten.filter(w => w.erntebar || w.id === parzelle?.weingarten_id))

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-s112-text">
        {parzelle ? 'Lesedaten bearbeiten' : 'Lesedaten erfassen'}
      </h3>
      {parzelle && <input type="hidden" name="existing_id" value={parzelle.id} />}
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Weingarten <span className="text-s112-err">*</span></label>
          <select aria-label="Weingarten" name="weingarten_id" required value={selWgId}
            onChange={e => { setSelWgId(e.target.value); setSelGstId('') }}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– Auswählen –</option>
            {lagen.map(g => istEinzelRied(g) ? (
              <option key={g.weingaerten[0].id} value={g.weingaerten[0].id}>
                {g.name}{weingartenZusatz(g.name, g.weingaerten[0].name) ? ` · ${g.weingaerten[0].name}` : ''}{g.weingaerten[0].rebsorte ? ` (${formatRebsorteMitKuerzel(g.weingaerten[0].rebsorte)})` : ''}
              </option>
            ) : (
              <optgroup key={g.schluessel} label={g.name}>
                {g.weingaerten.map(w => (
                  <option key={w.id} value={w.id}>{w.name}{w.rebsorte ? ` (${formatRebsorteMitKuerzel(w.rebsorte)})` : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        {verfuegbareGSTs.length > 0 && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Grundstück (GST)</label>
            <input type="hidden" name="grundstueck_id" value={selGstId} />
            <select value={selGstId} onChange={e => setSelGstId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– kein GST –</option>
              {verfuegbareGSTs.map(g => (
                <option key={g.id} value={g.id}>
                  {g.gst_nr}{g.rebsorte ? ' · ' + formatRebsorteMitKuerzel(g.rebsorte) : ''}{g.flaeche_ha ? ' · ' + g.flaeche_ha.toFixed(4) + ' ha' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Ernte-Datum</label>
          <input aria-label="Ernte-Datum" name="ernte_datum" type="date" defaultValue={parzelle?.ernte_datum ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Lesemethode</label>
          <select aria-label="Lesemethode" name="lesemethode" defaultValue={parzelle?.lesemethode ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">–</option>
            {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (kg)</label>
          <input aria-label="Menge (kg)" name="menge_kg" type="text" inputMode="decimal"
            defaultValue={parzelle?.menge_kg ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        {/* Mostgewicht in °KMW oder °Oe (KAN-128): Messwert + Einheit als versteckte Felder
            mostgewicht_wert/_einheit – kein leeres Feld „oechsle“ mehr, das °Oe beim Speichern löschte.
            „Lese bearbeiten“ behält die gewählte Stufe (Rechenregel 6), höchstens ein Prüfhinweis. */}
        <div className="col-span-2">
          <MostgewichtEingabe name="mostgewicht" startwert={mgStart}
            onChange={wert => {
              setKmwEdit(wert ? wert.kmw : null)
              setMgGeaendert(true)
              if (!parzelle) setQualitaetEdit(null)
            }} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Qualitätsstufe</label>
          <select aria-label="Qualitätsstufe" name="qualitaetsstufe" value={effectiveQualitaetEdit}
            onChange={e => setQualitaetEdit(e.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            {mitGespeichertemWert(LESE_QUALITAETEN, parzelle?.qualitaetsstufe).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {qualitaetEdit == null && (
            <p className="text-xs text-s112-muted mt-0.5">↑ Wird aus °KMW abgeleitet – bei Bedarf anpassen</p>
          )}
          {qualitaetEdit != null && mgGeaendert && kmwEdit != null && derivedQualitaetEdit !== qualitaetEdit && (
            <p role="status" className="text-xs text-s112-warn-fg mt-0.5">
              Rechnerisch aus dem Mostgewicht: {qualitaetLabel(derivedQualitaetEdit)} – die gewählte Stufe bleibt.{' '}
              <button type="button" onClick={() => setQualitaetEdit(derivedQualitaetEdit)} className="underline hover:no-underline">
                Übernehmen
              </button>
            </p>
          )}
        </div>
        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={parzelle?.notizen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}


// ── Hauptkomponente ─────────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function ErnteDetailClient({ jahrgang, parzellen, weingaerten, gstByWeingarten, amaMeldung, hektarhoechstertrag, pressungen, wgOptions, behOptions, waOptions, verfuegbareKg, verfuegbareKgByGST, zukaufTrauben, behaelterMitCharge, writeOk, adminOk, betriebName, csvErlaubt }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jahrgang: Record<string, any>; parzellen: ErnteParzelle[]
  weingaerten: WeingartenOpt[]; gstByWeingarten: Record<string, GSTOpt[]>; amaMeldung: AMAMeldung | null
  hektarhoechstertrag: HektarhoechstertragStatus
  pressungen: Pressung[]; wgOptions: WGOption[]; behOptions: BehOption[]; waOptions: WAOption[]
  verfuegbareKg: Record<string, number>; verfuegbareKgByGST: Record<string, number>
  zukaufTrauben: ZukaufTraubenOpt[]
  behaelterMitCharge: Record<string, { weinausbau_id: string; name: string; rebsorte?: string | null; menge_liter?: number | null }[]>; writeOk: boolean; adminOk: boolean
  /** Mandantenname für den Druckkopf (tenant_einstellungen.betrieb_name) */
  betriebName: string | null
  /** Pflichtmeldungen als CSV (Lesedaten, Erntemeldung) – gleiche Regel wie die CSV-Route */
  csvErlaubt: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const [leseFehler, setLeseFehler] = useState<string | null>(null)
  const [amaFehler, setAmaFehler]   = useState<string | null>(null)

  const gesamtKg = parzellen.reduce((s, p) => s + (p.menge_kg ?? 0), 0)
  const mitAktionen = writeOk || adminOk
  // Spalten der Lesedaten-Tabelle: Ried, GST, Sorte, Datum, kg, Notizen, Mostgewicht, Qualität (+ Aktionen)
  const spaltenAnzahl = 8 + (mitAktionen ? 1 : 0)

  function handleDelete(id: string) {
    if (!confirm('Lesedaten löschen?')) return
    setLeseFehler(null)
    startTransition(async () => {
      try {
        await deleteErnteParzelle(id, jahrgang.id)
      } catch (err) {
        // z. B. KAN-35-Sperre: Lesemenge schon verpresst/verkauft
        setLeseFehler(fehlerText(err, 'Die Lesedaten konnten nicht gelöscht werden.'))
      }
    })
  }

  function handleAMA() {
    if (!confirm('AMA-Meldung aus aktuellen Lesedaten aufbauen?')) return
    setAmaFehler(null)
    startTransition(async () => {
      try {
        await createOrUpdateAMAMeldung(jahrgang.id)
      } catch (err) {
        setAmaFehler(fehlerText(err, 'Die AMA-Meldung konnte nicht aufgebaut werden.'))
      }
    })
  }

  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

  return (
    <div className={`space-y-6 ${pending ? 'opacity-60 pointer-events-none' : ''}`}>

      {/* Print-Header (nur beim Drucken sichtbar) */}
      <div className="hidden print:block mb-4 pb-4 border-b-2 border-s112-line-str">
        <p className="text-xs text-s112-text-2 font-semibold tracking-widest uppercase">{betriebName ? `software:112 – ${betriebName}` : 'software:112'}</p>
        <h1 className="text-2xl font-semibold text-s112-text mt-0.5">Jahrgang {jahrgang.jahrgang}</h1>
        <p className="text-sm text-s112-tertiary mt-1">Erstellt: {heute}</p>
      </div>

      {/* Ernte-Übersicht */}
      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-base font-semibold text-s112-text">Lesedaten</h2>
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-sm text-s112-muted">{parzellen.length} Parzellen · {fmtZahl(gesamtKg/1000, 2)} t</span>
            {writeOk && !showForm && (
              <button onClick={() => { setShowForm(true); setEditId(null) }}
                data-print="hide"
                className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow font-semibold px-3 py-1.5 rounded-lg text-xs hover:bg-opacity-90 transition-colors shadow-sm">
                <Plus size={14} strokeWidth={2.5} /> Ernte
              </button>
            )}
            <button
              onClick={() => window.print()}
              data-print="hide"
              className="inline-flex items-center gap-1.5 border border-s112-border text-s112-text-2 px-3 py-1.5 rounded-lg text-xs hover:bg-s112-bg transition-colors"
              title="Als PDF speichern oder drucken"
            >
              Drucken / PDF
            </button>
            {csvErlaubt && (
              <CsvExportKnopf label="Lesedaten als CSV" href={csvPfad('lesedaten', { jahrgang: jahrgang.jahrgang })} />
            )}
          </div>
        </div>

        {leseFehler && (
          <div role="alert" className="mb-4 flex items-start gap-2 text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2" data-print="hide">
            <span className="flex-1">{leseFehler}</span>
            <button type="button" onClick={() => setLeseFehler(null)} aria-label="Meldung schließen" className="shrink-0 font-semibold hover:opacity-70">×</button>
          </div>
        )}

        {showForm && !editId && (
          <div className="mb-4" data-print="hide">
            <NeueParzellenForm jahrgangId={jahrgang.id} weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} onDone={() => setShowForm(false)} />
          </div>
        )}

        {parzellen.length > 0 ? (
          <div className="border border-s112-border rounded-xl overflow-x-auto print:overflow-visible">
            <table className="w-full text-sm min-w-[700px] print:min-w-0">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border text-xs text-s112-text-2">
                  <th className="text-left px-3 py-2 font-semibold">Ried</th>
                  <th className="text-left px-3 py-2 font-semibold">GST</th>
                  <th className="text-left px-3 py-2 font-semibold">Sorte</th>
                  <th className="text-left px-3 py-2 font-semibold">Datum</th>
                  <th className="text-right px-3 py-2 font-semibold">kg</th>
                  <th className="text-left px-3 py-2 font-semibold">Notizen</th>
                  <th className="text-right px-3 py-2 font-semibold">Mostgewicht</th>
                  <th className="text-left px-3 py-2 font-semibold whitespace-nowrap">Qualität</th>
                  {mitAktionen && (
                    <th className="px-3 py-2 sticky right-0 bg-s112-bg border-l border-s112-border" data-print="hide" />
                  )}
                </tr>
              </thead>
              <tbody>
                {parzellen.map(p => (
                  <React.Fragment key={p.id}>
                    <tr className="group border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30">
                      <td className="px-3 py-2 font-medium text-s112-text">
                        {p.weingarten_name}
                      </td>
                      <td className="px-3 py-2 text-xs text-s112-muted font-mono">{p.grundstueck_nr ?? '–'}</td>
                      <td className="px-3 py-2 text-xs text-s112-muted">{formatRebsorteMitKuerzel(p.grundstueck_rebsorte ?? p.weingarten_rebsorte)}</td>
                      <td className="px-3 py-2 text-s112-muted whitespace-nowrap">{formatDate(p.ernte_datum)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{(p.menge_kg == null ? undefined : fmtNum(p.menge_kg)) ?? '–'}</td>
                      <td className="px-3 py-2 text-xs text-s112-text-2">
                        <NotizZelle text={p.notizen} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <MostgewichtAnzeige wert={{ kmw: p.klosterneuburger, oechsle: p.oechsle, einheit: p.mostgewicht_einheit }} />
                      </td>
                      <td className="px-3 py-2 text-xs text-s112-muted whitespace-nowrap">{qualitaetLabel(p.qualitaetsstufe)}</td>
                      {mitAktionen && (
                        <td className="px-3 py-2 text-right sticky right-0 bg-white border-l border-s112-border/40" data-print="hide">
                          <div className="flex items-center justify-end gap-2">
                            {writeOk && (
                              <button onClick={() => { setEditId(p.id); setShowForm(false) }}
                                title="Bearbeiten" aria-label="Bearbeiten"
                                className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={14} /></button>
                            )}
                            {adminOk && (
                              <button onClick={() => handleDelete(p.id)}
                                title="Löschen" aria-label="Löschen"
                                className="text-s112-err hover:text-s112-err-fg"><Trash2 size={14} /></button>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                    {editId === p.id && (
                      <tr>
                        <td colSpan={spaltenAnzahl} className="px-3 py-2">
                          <ParzellForm jahrgangId={jahrgang.id} weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} parzelle={p} onDone={() => setEditId(null)} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-s112-bg border-t-2 border-s112-border font-semibold text-sm">
                  {/* Summe unter der Spalte „kg“ (Ried, GST, Sorte, Datum davor), hl ab „Notizen“ */}
                  <td className="px-3 py-2 text-s112-text-1" colSpan={4}>Gesamt</td>
                  <td className="px-3 py-2 text-right tabular-nums text-s112-text whitespace-nowrap">{fmtNum(gesamtKg)} kg</td>
                  <td colSpan={3} className="px-3 py-2 text-xs text-s112-muted">
                    ≈ {fmtProzent(gesamtKg / 130)} hl
                  </td>
                  {mitAktionen && (
                    <td className="sticky right-0 bg-s112-bg border-l border-s112-border" data-print="hide" />
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        ) : (
          <div className="border border-dashed border-s112-border rounded-xl p-8 text-center text-sm text-s112-muted">
            Noch keine Lesedaten erfasst.
          </div>
        )}
      </div>

      {/* Hektarhöchstertrag-Prüfung (Qualitätswein, betriebsweit) – reine Info-/Warnfunktion */}
      {hektarhoechstertrag.gesamtKgQualitaetswein > 0 && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          hektarhoechstertrag.ueberschritten
            ? 'bg-s112-err-bg border-s112-err/30 text-s112-err-fg'
            : 'bg-s112-bg border-s112-border text-s112-text-2'
        }`} data-print="hide">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="inline-flex items-start gap-1.5">
              {hektarhoechstertrag.ueberschritten && <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />}
              <span>Qualitätswein betriebsweit: <strong>{fmtNum(hektarhoechstertrag.gesamtKgQualitaetswein)} kg</strong>
              {' '}von max. <strong>{fmtNum(hektarhoechstertrag.maxKg)} kg</strong>
              {' '}(10.000 kg/ha × {fmtHa(hektarhoechstertrag.gesamtFlaecheHaBetrieb)} Gesamtfläche lt. AMA)
              </span>
            </span>
            {hektarhoechstertrag.ueberschritten && (
              <span className="font-semibold">
                Überschreitung: {fmtNum(hektarhoechstertrag.ueberschreitungKg)} kg
              </span>
            )}
          </div>
          <p className="text-xs mt-1 opacity-75">
            Hinweis, keine rechtliche Prüfung – betrifft nur als „Qualitätswein" erfasste Lesedaten.
          </p>
        </div>
      )}

      {/* Pressungen / Lese */}
      <PressungSection
        jahrgangId={jahrgang.id}
        pressungen={pressungen}
        wgOptions={wgOptions}
        behOptions={behOptions}
        waOptions={waOptions}
        verfuegbareKgByGST={verfuegbareKgByGST}
        zukaufTrauben={zukaufTrauben}
        behaelterMitCharge={behaelterMitCharge}
        leseParzellen={(() => {
          // Deduplizieren: eine Zeile pro (weingarten_id, grundstueck_id) für Pressung-Formular.
          // Ein GST kann mehrere ernte_parzellen-Einträge haben (z.B. Kabinett + Spätlese).
          // Wenn mehrere Einträge vorhanden: denjenigen wählen, dessen menge_kg am nächsten
          // zur verfügbaren Restmenge liegt – das ist der noch nicht verpresste Anteil.
          const bestByKey = new Map<string, typeof parzellen[0]>()
          for (const p of parzellen) {
            const key = `${p.weingarten_id}|${p.grundstueck_id ?? ''}`
            const verfuegbar = p.grundstueck_id ? (verfuegbareKgByGST[p.grundstueck_id] ?? 0) : 0
            const existing = bestByKey.get(key)
            if (!existing) {
              bestByKey.set(key, p)
            } else {
              const existingDiff = Math.abs((existing.menge_kg ?? 0) - verfuegbar)
              const newDiff      = Math.abs((p.menge_kg ?? 0) - verfuegbar)
              if (newDiff < existingDiff) bestByKey.set(key, p)
            }
          }
          return Array.from(bestByKey.values()).map(p => ({
            weingarten_id: p.weingarten_id,
            weingarten_name: p.weingarten_name,
            grundstueck_id: p.grundstueck_id,
            grundstueck_nr: p.grundstueck_nr,
            grundstueck_rebsorte: p.grundstueck_rebsorte,
            menge_kg: p.menge_kg,
            rebsorte: p.weingarten_rebsorte,
            klosterneuburger: p.klosterneuburger,
          }))
        })()}
        writeOk={writeOk}
        adminOk={adminOk}
      />

      {/* AMA Meldung */}
      {writeOk && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-s112-text">AMA Erntemeldung</h2>
            {amaMeldung && (
              <span className={`text-xs px-2 py-1 rounded-full font-medium ${AMA_STATUS_BADGE[amaMeldung.status]?.cls ?? 'bg-[#F2F3F5] text-s112-text-2'}`}>
                {AMA_STATUS_BADGE[amaMeldung.status]?.label ?? amaMeldung.status}
              </span>
            )}
          </div>

          {amaMeldung ? (
            <div>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-s112-bg rounded-xl p-3">
                  <p className="text-lg font-semibold text-s112-text">{(amaMeldung.gesamtmenge_kg == null ? undefined : fmtNum(amaMeldung.gesamtmenge_kg))} kg</p>
                  <p className="text-xs text-s112-muted">Gesamtmenge</p>
                </div>
                <div className="bg-s112-bg rounded-xl p-3">
                  <p className="text-lg font-semibold text-s112-text">{fmtProzent(amaMeldung.gesamtmenge_hl)} hl</p>
                  <p className="text-xs text-s112-muted">Most (≈)</p>
                </div>
              </div>

              {amaMeldung.positionen.length > 0 && (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="border-b border-s112-border text-xs text-s112-text-2">
                      <th className="text-left pb-1 font-semibold">Rebsorte</th>
                      <th className="text-right pb-1 font-semibold">Fläche (ha)</th>
                      <th className="text-right pb-1 font-semibold">Menge (kg)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {amaMeldung.positionen.map((pos, i) => (
                      <tr key={i} className="border-b border-s112-border/40 last:border-0">
                        <td className="py-1.5">{formatRebsorteMitKuerzel(pos.rebsorte_name)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmtHa(pos.flaeche_ha)}</td>
                        <td className="py-1.5 text-right tabular-nums">{(pos.menge_kg == null ? undefined : fmtNum(pos.menge_kg)) ?? '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {amaFehler && (
                <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-xs mb-3" data-print="hide">
                  {amaFehler}
                </div>
              )}

              {amaMeldung.n8n_fehler && (
                <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-xs mb-3">
                  Fehler: {amaMeldung.n8n_fehler}
                </div>
              )}

              <div className="flex items-start gap-2 flex-wrap" data-print="hide">
                <button onClick={handleAMA}
                  className="text-sm bg-s112-bg border border-s112-border hover:border-s112-teal text-s112-text-1 hover:text-s112-blue-700 px-4 py-2 rounded-lg transition-colors">
                  Neu berechnen
                </button>
                {csvErlaubt && (
                  <CsvExportKnopf label="Erntemeldung als CSV" href={csvPfad('erntemeldung', { jahrgang: jahrgang.jahrgang })} />
                )}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-sm text-s112-muted mb-4" data-print="hide">
                Lesedaten aus {parzellen.length} Parzellen zu AMA-Meldung aggregieren.
              </p>
              {amaFehler && (
                <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-xs mb-3" data-print="hide">
                  {amaFehler}
                </div>
              )}
              <button onClick={handleAMA} disabled={parzellen.length === 0}
                data-print="hide"
                className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
                AMA-Meldung erstellen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
