'use client'

import React, { useEffect, useRef, useState, useTransition } from 'react'
import { upsertErnteParzelle, stornoErnteParzelle, endgueltigLoeschenLese, createMultipleErnteParzellen } from '../actions'
import { qualitaetLabel, LESE_QUALITAETEN, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import { abgestuftVon, gemeinsameHerkunftOptionen, leseHerkunftObergrenze, leseHerkunftOptionen, leseObergrenze, leseStufeFehler, leseStufenOptionen } from '@/lib/wein/leseAbstufung'
import type { ErnteParzelle, WeingartenOpt, GSTOpt, AMAMeldung, HektarhoechstertragStatus } from './page'
import { HOECHSTERTRAG_RECHTSFOLGE } from '@/lib/behoerden/hoechstertragText'
import Link from '@/components/ui/Link'
import AmaMeldungKarte from './AmaMeldungKarte'
import { AMA_OFFEN } from '@/lib/behoerden/amaMeldung'
import { fmtHa, fmtZahl, fmtProzent, fmtNum, zahlAus } from '@/lib/format'
import { Pencil, AlertTriangle, Plus } from 'lucide-react'
import StornoButton from '@/components/StornoButton'
import StornierteUmschalter from '@/components/StornierteUmschalter'
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
import { heuteWien } from '@/lib/datum/wien'

// Qualitätsstufen der Lese: LESE_QUALITAETEN aus lib/wein/qualitaet (KAN-73) – genau die
// Stufen, die ernte_parzellen speichern kann (DAC, Reserve & Co. erst an der Charge/Füllung)
const LESEMETHODE_OPTS = [
  { value: 'handlese', label: 'Handlese' },
  { value: 'maschinenlese', label: 'Maschinenlese' },
  { value: 'selektionslese', label: 'Selektionslese' },
]

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
      className={`block min-w-28 max-w-40 sm:max-w-56 ${klickbar ? 'cursor-pointer hover:text-s112-text focus-visible:text-s112-text' : ''}`}>
      <span ref={setEl} className={`whitespace-pre-line wrap-anywhere ${offen ? 'line-clamp-none' : 'line-clamp-2'} print:line-clamp-none`}>
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
  jahrgangId, leseId, leseArt, weingaerten: alleWeingaerten, gstByWeingarten, onDone,
}: {
  jahrgangId: string
  /** KAN-129 Soll 2: Art der gewählten Lese – bei Eiswein Stufe Eiswein */
  leseArt: string | null
  /** KAN-129: gewählte Lese (Reiter) – die neuen Einträge landen in ihr */
  leseId: string | null
  weingaerten: WeingartenOpt[]
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
  // KAN-81 (Entscheidung 04.10.2026): gemeinsame Felder „Abstufen auf“ – jede Zeile höchstens bis zu ihrer Obergrenze.
  // Stufen: Eiswein nur bei einer Eiswein-Lese; Herkunft: nur Stufen, die für jedes gewählte Grundstück zulässig sind.
  const abstufenOptionen = LESE_QUALITAETEN.filter(o => leseArt === 'eiswein' || o.value !== 'eiswein').slice().sort((a, b) => b.rang - a.rang)
  const herkunftGemeinsam = ziele.length > 0 && ziele.every(z => z.grundstueck_id)
    ? gemeinsameHerkunftOptionen(ziele.map(z => {
        const g = (gstByWeingarten[z.weingarten_id] ?? []).find(x => x.id === z.grundstueck_id)
        return g ? leseHerkunftObergrenze(g.herkunft_code, g.rebsorte).code : null
      }))
    : []
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
    setExpandedWGs(prev => { const n = new Set(prev); if (n.has(wgId)) n.delete(wgId); else n.add(wgId); return n })
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
    if (leseId) fd.set('lese_id', leseId)
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

  // KAN-181: am Handy 16 px Schrift (sonst zoomt iOS beim Antippen hinein) und höhere Felder; ab sm wie bisher
  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
  const zeileCls = 'w-full border border-s112-border rounded-sm px-2 py-2 sm:py-1 text-base sm:text-xs focus:outline-hidden focus:ring-1 focus:ring-s112-teal/40 bg-white'
  const sichtbareGruppen = gruppen
    .map(g => ({ ...g, weingaerten: g.weingaerten.filter(w => sucheErg.weingaerten.has(w.id)) }))
    .filter(g => g.weingaerten.length > 0)

  return (
    <form data-ungespeichert onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-4">
      {leseArt === 'eiswein' && (
        <p role="note" className="rounded-lg border border-s112-blue-100 bg-s112-blue-50 px-3 py-2 text-xs text-s112-text">
          Eiswein-Lese: Die Stufe ist Eiswein (nicht aus den °KMW abgeleitet). Eiswein verlangt mindestens 25 °KMW (§ 11 Abs. 1 Z 6 WeinG).
        </p>
      )}
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
              {!einzelRied && <label className={`flex items-center gap-2 px-3 py-3 sm:py-1.5 bg-white ${keinErntebar ? 'opacity-60' : 'cursor-pointer hover:bg-s112-bg/60'}`}>
                <input type="checkbox" checked={alleGruppe} disabled={keinErntebar}
                  aria-label={`${gruppe.name}: alle ${sucheErg.aktiv ? 'Treffer' : 'erntebaren'} auswählen`}
                  ref={el => { if (el) el.indeterminate = teilGruppe && !alleGruppe }}
                  onChange={() => umschalten(gt)}
                  className="accent-s112-teal w-5 h-5 sm:w-auto sm:h-auto" />
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
                      <div className={`flex items-center gap-2 ${einzelRied ? 'px-3 bg-white' : 'px-4'} py-3 sm:py-1.5 ${w.erntebar ? 'hover:bg-s112-bg/40' : 'opacity-50'}`}>
                        <input type="checkbox"
                          aria-label={`${w.name} auswählen`}
                          checked={wgVoll}
                          disabled={!w.erntebar}
                          ref={el => { if (el) el.indeterminate = wgTeil && !wgVoll }}
                          onChange={() => umschalten(wt)}
                          className="accent-s112-teal cursor-pointer disabled:cursor-not-allowed w-5 h-5 sm:w-auto sm:h-auto shrink-0" />
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
                              <label key={g.id} className={`flex items-center gap-2 pl-10 pr-4 py-3 sm:py-1 text-xs cursor-pointer hover:bg-s112-bg/30 ${isGstSel ? 'bg-s112-teal/5' : ''}`}>
                                <input type="checkbox"
                                  checked={isGstSel}
                                  onChange={() => umschalten({ ganze: [], einzeln: [{ gst_id: g.id, weingarten_id: w.id }] })}
                                  className="accent-s112-teal w-5 h-5 sm:w-auto sm:h-auto shrink-0" />
                                <span className={`font-mono ${isGstSel ? 'text-s112-blue-700 font-medium' : 'text-s112-text-2'}`}>
                                  GST {g.gst_nr}
                                </span>
                                {g.rebsorte && <span className="text-s112-muted">· {formatRebsorteMitKuerzel(g.rebsorte)}</span>}
                                <span className="text-s112-muted ml-auto">{g.flaeche_ha ? `${fmtHa(g.flaeche_ha)} ha` : 'ohne Fläche'}</span>
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Ernte-Datum</label>
          <input aria-label="Ernte-Datum" name="ernte_datum" type="date" required defaultValue={heuteWien()} className={inputCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Lesemethode</label>
          <select aria-label="Lesemethode" name="lesemethode" className={inputCls}>
            <option value="">–</option>
            {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {!einzeln && (
          <div className="sm:col-span-2">
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
        <div className="sm:col-span-2">
          {/* Mostgewicht in °KMW oder °Oe (KAN-128) – die Qualitätsstufe folgt aus den °KMW
              (bei °Oe-Messung aus dem umgerechneten, gespeicherten °KMW; ohne Mostgewicht Qualitätswein).
              Bei Einzelerfassung gilt es für jede Zeile ohne eigenes Mostgewicht. */}
          <MostgewichtEingabe name="mostgewicht" label="Mostgewicht & Qualitätsstufe" qualitaetsVorschau />
          <p className="text-xs text-s112-muted mt-0.5">Qualitätsstufe wird automatisch aus den °KMW abgeleitet (ohne Mostgewicht: Qualitätswein).</p>
        </div>
        <div>
          <label htmlFor="lese-abstufen-auf" className="block text-xs font-medium text-s112-text-2 mb-1">Abstufen auf <span className="text-s112-muted font-normal">(optional)</span></label>
          <select id="lese-abstufen-auf" name="abstufen_auf" defaultValue="" className={inputCls}>
            <option value="">– nicht abstufen –</option>
            {abstufenOptionen.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <p className="text-xs text-s112-muted mt-0.5">Jede Fläche bekommt höchstens die Stufe aus ihrem Mostgewicht.</p>
        </div>
        {herkunftGemeinsam.length > 0 && (
          <div>
            <label htmlFor="lese-herkunft-auf" className="block text-xs font-medium text-s112-text-2 mb-1">Herkunft abstufen auf <span className="text-s112-muted font-normal">(optional)</span></label>
            <select id="lese-herkunft-auf" name="herkunft_abstufen_auf" defaultValue="" className={inputCls}>
              <option value="">– vom Grundstück –</option>
              {herkunftGemeinsam.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <p className="text-xs text-s112-muted mt-0.5">Nur Stufen, die für alle gewählten Grundstücke zulässig sind.</p>
          </div>
        )}
        <div className="sm:col-span-2">
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
            <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer py-2 sm:py-0">
              <input type="checkbox" checked={einzeln} onChange={e => setEinzeln(e.target.checked)} className="accent-s112-teal w-5 h-5 sm:w-auto sm:h-auto" />
              Mengen je Grundstück einzeln erfassen
            </label>
          </div>
          {hinweis && <p role="status" className="text-xs text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-1.5">{hinweis}</p>}
          <div className="border border-s112-border rounded-lg bg-white divide-y divide-s112-border/40 sm:max-h-96 sm:overflow-y-auto">
            {ziele.map((z, i) => {
              const gstId = zielKey(z)
              const name = zielName(z)
              const ha = bezugsflaeche(z.flaeche_ha)
              return (
                <div key={gstId} className="px-3 py-2 sm:py-1.5 text-xs">
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
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
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-1">
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
                      <div className="col-span-2 sm:col-span-4">
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

      {/* KAN-181: am Handy bleibt die Leiste beim Scrollen unten sichtbar, Knöpfe in voller Höhe */}
      <div className="flex gap-2 pt-1 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:-mb-4 max-sm:px-4 max-sm:py-3 max-sm:bg-s112-bg max-sm:border-t max-sm:border-s112-border">
        <button type="submit" disabled={pending || ziele.length === 0}
          className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-4 py-3 sm:py-1.5 rounded-lg text-base sm:text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : `${ziele.length > 0 ? `${ziele.length} × ` : ''}Speichern`}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-3 sm:py-1.5 rounded-lg text-base sm:text-sm font-medium text-s112-text-2 hover:text-s112-text">
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
  const [selWgId, setSelWgId] = useState<string>(parzelle?.weingarten_id ?? '')
  const [selGstId, setSelGstId] = useState<string>(parzelle?.grundstueck_id ?? '')
  // Stufe nur aus den °KMW von ausMessung() (onChange der Eingabe, Rechenregel 5); KAN-81: das ist die Obergrenze
  // (Eiswein-Lese: Eiswein) – wählbar sind nur niedrigere Stufen
  const derivedQualitaetEdit = leseObergrenze(parzelle?.lese_art, kmwEdit)
  const [qualitaetEdit, setQualitaetEdit] = useState<string | null>(parzelle?.qualitaetsstufe ?? null)
  const effectiveQualitaetEdit = qualitaetEdit ?? derivedQualitaetEdit
  const verfuegbareGSTs = selWgId ? (gstByWeingarten[selWgId] ?? []) : []
  // KAN-81: Herkunft bis zur Obergrenze des Grundstücks (Sortenspiegel) bzw. eine breitere Stufe; '' = Obergrenze
  const selGst = verfuegbareGSTs.find(g => g.id === selGstId) ?? null
  const herkunftGrenze = selGst ? leseHerkunftObergrenze(selGst.herkunft_code, selGst.rebsorte).code : null
  const herkunftGespeichert = parzelle && (parzelle.grundstueck_id ?? '') === selGstId ? (parzelle.herkunft_code ?? null) : null
  const [herkunftEdit, setHerkunftEdit] = useState<string>(parzelle?.herkunft_code ?? '')
  const herkunftGewaehlt = selGstId && (herkunftEdit === herkunftGespeichert || leseHerkunftOptionen(herkunftGrenze).some(o => o.value === herkunftEdit)) ? herkunftEdit : ''
  const herkunftWert = herkunftGewaehlt === herkunftGrenze ? '' : herkunftGewaehlt   // Obergrenze = leere Auswahl
  const herkunftOpts = leseHerkunftOptionen(herkunftGrenze)
  if (herkunftGespeichert && !herkunftOpts.some(o => o.value === herkunftGespeichert)) herkunftOpts.push({ value: herkunftGespeichert, label: `${herkunftGespeichert} (gespeichert)` })
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
    <form data-ungespeichert onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-s112-text">
        {parzelle ? 'Lesedaten bearbeiten' : 'Lesedaten erfassen'}
      </h3>
      {parzelle && <input type="hidden" name="existing_id" value={parzelle.id} />}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Weingarten <span className="text-s112-err">*</span></label>
          <select aria-label="Weingarten" name="weingarten_id" required value={selWgId}
            onChange={e => { setSelWgId(e.target.value); setSelGstId('') }}
            className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
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
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Grundstück (GST)</label>
            <input type="hidden" name="grundstueck_id" value={selGstId} />
            <select value={selGstId} onChange={e => setSelGstId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– kein GST –</option>
              {verfuegbareGSTs.map(g => (
                <option key={g.id} value={g.id}>
                  {g.gst_nr}{g.rebsorte ? ' · ' + formatRebsorteMitKuerzel(g.rebsorte) : ''}{g.flaeche_ha ? ' · ' + fmtHa(g.flaeche_ha) + ' ha' : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Ernte-Datum *</label>
          {/* KAN-205: Lesedatum, Menge und Mostgewicht Pflicht (auch bei Lesegut, das später verkauft wird) */}
          <input aria-label="Ernte-Datum" name="ernte_datum" type="date" required defaultValue={parzelle?.ernte_datum ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Lesemethode</label>
          <select aria-label="Lesemethode" name="lesemethode" defaultValue={parzelle?.lesemethode ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
            <option value="">–</option>
            {LESEMETHODE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (kg) *</label>
          <input aria-label="Menge (kg)" name="menge_kg" type="text" inputMode="decimal" required
            defaultValue={parzelle?.menge_kg ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        {/* Mostgewicht in °KMW oder °Oe (KAN-128): Messwert + Einheit als versteckte Felder
            mostgewicht_wert/_einheit – kein leeres Feld „oechsle“ mehr, das °Oe beim Speichern löschte.
            „Lese bearbeiten“ behält die gewählte Stufe (Rechenregel 6), höchstens ein Prüfhinweis. */}
        <div className="sm:col-span-2">
          <MostgewichtEingabe name="mostgewicht" startwert={mgStart} required
            onChange={wert => {
              setKmwEdit(wert ? wert.kmw : null)
              if (!parzelle) setQualitaetEdit(null)
            }} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Qualitätsstufe</label>
          <select aria-label="Qualitätsstufe" name="qualitaetsstufe" value={effectiveQualitaetEdit}
            onChange={e => setQualitaetEdit(e.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
            {mitGespeichertemWert(leseStufenOptionen(derivedQualitaetEdit), parzelle?.qualitaetsstufe).map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          {qualitaetEdit == null && (
            <p className="text-xs text-s112-muted mt-0.5">↑ Obergrenze aus °KMW – nur Abstufen möglich</p>
          )}
          {qualitaetEdit != null && leseStufeFehler(qualitaetEdit, derivedQualitaetEdit) && (
            <p role="status" className="text-xs text-s112-warn-fg mt-0.5">
              Über der Obergrenze aus dem Mostgewicht ({qualitaetLabel(derivedQualitaetEdit)}) – nur Abstufen ist möglich.{' '}
              <button type="button" onClick={() => setQualitaetEdit(derivedQualitaetEdit)} className="underline hover:no-underline">
                Übernehmen
              </button>
            </p>
          )}
          {qualitaetEdit != null && !leseStufeFehler(qualitaetEdit, derivedQualitaetEdit) && abgestuftVon(qualitaetEdit, derivedQualitaetEdit, 'stufe') && (
            <p className="text-xs text-s112-muted mt-0.5">{abgestuftVon(qualitaetEdit, derivedQualitaetEdit, 'stufe')}</p>
          )}
        </div>
        {selGstId && herkunftGrenze && (
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Herkunft</label>
            <select aria-label="Herkunft" name="herkunft_code" value={herkunftWert} onChange={e => setHerkunftEdit(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">{herkunftOpts[0]?.label ?? '–'} (vom Grundstück)</option>
              {herkunftOpts.slice(1).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {abgestuftVon(herkunftWert, herkunftGrenze, 'herkunft') && (
              <p className="text-xs text-s112-muted mt-0.5">{abgestuftVon(herkunftWert, herkunftGrenze, 'herkunft')}</p>
            )}
          </div>
        )}
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={parzelle?.notizen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-1.5 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>
      {error && <p role="alert" className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-4 py-3 sm:py-1.5 rounded-lg text-base sm:text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-3 sm:py-1.5 rounded-lg text-base sm:text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}


// ── Lesedaten am Handy (KAN-181): Karten statt der achtspaltigen Tabelle ───────────────────────────────
function LesedatenKarten({ zeilen, mehrereLesen, gesamtKg, writeOk, editId, setEditId, jahrgangId, weingaerten, gstByWeingarten }: {
  zeilen: ErnteParzelle[]; mehrereLesen: boolean; gesamtKg: number; writeOk: boolean
  editId: string | null; setEditId: (id: string | null) => void
  jahrgangId: string; weingaerten: WeingartenOpt[]; gstByWeingarten: Record<string, GSTOpt[]>
}) {
  return (
    <div className="md:hidden print:hidden space-y-2">
      {zeilen.map((p, i) => (
        <React.Fragment key={p.id}>
          {mehrereLesen && (i === 0 || zeilen[i - 1].lese_nr !== p.lese_nr) && (
            <p className="pt-2 text-xs font-semibold text-s112-text-2">Lese {p.lese_titel ?? '–'}</p>
          )}
          <div className={`border border-s112-border rounded-xl bg-white px-3 py-2.5 ${p.storno ? 'opacity-70' : ''}`}>
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${p.storno ? 'text-s112-muted' : 'text-s112-text'}`}>
                  {p.weingarten_name}
                  {p.grundstueck_nr && <span className="ml-1.5 font-mono text-xs font-normal text-s112-muted">GST {p.grundstueck_nr}</span>}
                </p>
                <p className="text-xs text-s112-muted">
                  {formatRebsorteMitKuerzel(p.grundstueck_rebsorte ?? p.weingarten_rebsorte)} · {formatDate(p.ernte_datum)}
                </p>
              </div>
              <p className="text-sm font-semibold tabular-nums text-s112-text whitespace-nowrap">
                {p.menge_kg == null ? '–' : `${fmtNum(p.menge_kg)} kg`}
              </p>
            </div>
            <div className="mt-1 flex items-center gap-2 flex-wrap text-xs text-s112-text-2">
              <MostgewichtAnzeige wert={{ kmw: p.klosterneuburger, oechsle: p.oechsle, einheit: p.mostgewicht_einheit }} />
              <span className="text-s112-muted">{qualitaetLabel(p.qualitaetsstufe)}</span>
            </div>
            {p.notizen && <p className="mt-1 text-xs text-s112-text-2 wrap-break-word">{p.notizen}</p>}
            {p.storno && (
              <p className="mt-1 text-[11px] text-s112-warn-fg">
                storniert am {new Date(p.storno.am).toLocaleDateString('de-AT')}{p.storno.von ? ` von ${p.storno.von}` : ''}{p.storno.grund ? ` – ${p.storno.grund}` : ''}
              </p>
            )}
            {writeOk && (
              <div className="mt-2 flex items-center justify-end gap-1 border-t border-s112-border/40 pt-1.5">
                {!p.storno && (
                  <button type="button" onClick={() => setEditId(editId === p.id ? null : p.id)} aria-label="Bearbeiten"
                    className="w-11 h-11 flex items-center justify-center rounded-lg text-s112-blue-700 hover:bg-s112-bg">
                    <Pencil size={17} />
                  </button>
                )}
                {!p.storno && (
                  <StornoButton
                    action={grund => stornoErnteParzelle(p.id, jahrgangId, grund)}
                    hinweis="Der Eintrag bleibt als storniert in den Lesedaten stehen und zählt in keiner Menge, Erntemeldung oder Verfügbarkeit – nur möglich, solange die Menge nicht schon verpresst oder als Trauben verkauft ist." />
                )}
                {p.storno && (
                  <StornoButton modus="loeschen" label="Endgültig löschen"
                    action={grund => endgueltigLoeschenLese('ernte_parzellen', p.id, jahrgangId, grund)}
                    hinweis="Nur bei einer Fehlerfassung: Der stornierte Eintrag wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll. Nach einer eingereichten Erntemeldung nicht mehr möglich." />
                )}
              </div>
            )}
            {editId === p.id && (
              <div className="mt-2">
                <ParzellForm jahrgangId={jahrgangId} weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} parzelle={p} onDone={() => setEditId(null)} />
              </div>
            )}
          </div>
        </React.Fragment>
      ))}
      <p className="pt-1 text-sm font-semibold text-s112-text-1 flex justify-between">
        <span>Gesamt</span>
        <span className="tabular-nums">{fmtNum(gesamtKg)} kg <span className="text-xs font-normal text-s112-muted">≈ {fmtProzent(gesamtKg / 130)} hl</span></span>
      </p>
    </div>
  )
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────────
export default function ErnteDetailClient({ jahrgang, leseId, leseArt, leseTitel, mehrereLesen, tabellenParzellen, stichtagHinweis, weingaerten, gstByWeingarten, amaMeldung, hektarhoechstertrag, pressungenAnzahl, pressungenHref, writeOk, adminOk, betriebName, csvErlaubt, erfassenOffen }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jahrgang: Record<string, any>; parzellen: ErnteParzelle[]
  /** KAN-129: gewählte Lese (Reiter der Seite) – neue Einträge und Pressungen landen in ihr */
  leseId: string | null
  /** KAN-129 Soll 2: Art der gewählten Lese (Eiswein → Stufe Eiswein) */
  leseArt: string | null
  /** KAN-129: „2026/2 Eiswein“ – nur bei mehreren Lesen (Überschrift der Pressungs-/Erfassungsteile) */
  leseTitel: string | null
  mehrereLesen: boolean
  /** KAN-129: Lesedaten des ganzen Jahrgangs (Tabelle und Druck), nach Lese sortiert; `parzellen` = gewählte Lese */
  tabellenParzellen: ErnteParzelle[]
  /** KAN-129 Frage 7: Lesegut nach dem Stichtag 30.11. (nicht in der Erntemeldung) oder null */
  stichtagHinweis: string | null
  weingaerten: WeingartenOpt[]; gstByWeingarten: Record<string, GSTOpt[]>; amaMeldung: AMAMeldung | null
  hektarhoechstertrag: HektarhoechstertragStatus
  /** Pilot 30.09.2026: Pressungen stehen im Kellerbuch – hier nur Anzahl (gültige, gewählte Lese) und Verweis */
  pressungenAnzahl: number; pressungenHref: string
  writeOk: boolean; adminOk: boolean
  /** Mandantenname für den Druckkopf (tenant_einstellungen.betrieb_name) */
  betriebName: string | null
  /** Pflichtmeldungen als CSV (Lesedaten, Erntemeldung) – gleiche Regel wie die CSV-Route */
  csvErlaubt: boolean
  /** KAN-181: Einstieg „Lese erfassen“ (/erntemeldung/erfassen → ?erfassen=1) – Formular gleich offen */
  erfassenOffen?: boolean
}) {
  const [showForm, setShowForm] = useState(!!erfassenOffen && writeOk)
  const formRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (erfassenOffen && writeOk) formRef.current?.scrollIntoView({ block: 'start' })
  }, [erfassenOffen, writeOk])
  const [editId, setEditId] = useState<string | null>(null)

  // KAN-148 C1b: stornierte Einträge stehen gekennzeichnet in der Tabelle, zählen aber in keiner Summe
  const gueltigeParzellen = tabellenParzellen.filter(p => !p.storno)
  const stornierteAnzahl = tabellenParzellen.length - gueltigeParzellen.length
  // KAN-148 Soll 9: stornierte ausblendbar
  const [stornierteZeigen, setStornierteZeigen] = useState(true)
  const tabellenZeilen = stornierteZeigen ? tabellenParzellen : gueltigeParzellen
  const gesamtKg = gueltigeParzellen.reduce((s, p) => s + (p.menge_kg ?? 0), 0)
  const mitAktionen = writeOk || adminOk
  // Spalten der Lesedaten-Tabelle: Ried, GST, Sorte, Datum, kg, Notizen, Mostgewicht, Qualität (+ Aktionen)
  const spaltenAnzahl = 8 + (mitAktionen ? 1 : 0)

  const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
  // KAN-37 C: abgegebene Erntemeldung sperrt Lesedaten und Lesen bis zum Stichtag (DB-Trigger s112_lese_meldesperre)
  const meldesperre = amaMeldung && !AMA_OFFEN.includes(amaMeldung.status)
    ? new Date(amaMeldung.stichtag).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' })
    : null

  return (
    <div className="space-y-6">

      {meldesperre && (
        <p role="note" className="rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-3 py-2 text-sm text-s112-warn-fg" data-print="hide">
          Die Erntemeldung {jahrgang.jahrgang} ist abgegeben – Lesedaten und Lesen bis zum Stichtag {meldesperre} sind gesperrt.
          Für Änderungen unten bei der AMA-Erntemeldung „Korrekturmeldung anlegen“. Spätere Lesen (nach dem Stichtag) bleiben frei.
        </p>
      )}

      {/* Print-Header (nur beim Drucken sichtbar) */}
      <div className="hidden print:block mb-4 pb-4 border-b-2 border-s112-line-str">
        <p className="text-xs text-s112-text-2 font-semibold tracking-widest uppercase">{betriebName ? `software:112 – ${betriebName}` : 'software:112'}</p>
        <h1 className="text-2xl font-semibold text-s112-text mt-0.5">Jahrgang {jahrgang.jahrgang}</h1>
        <p className="text-sm text-s112-tertiary mt-1">Erstellt: {heute}</p>
      </div>

      {/* Ernte-Übersicht */}
      <div className="card">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-base font-semibold text-s112-text">Lesedaten{mehrereLesen ? ' – alle Lesen des Jahrgangs' : ''}</h2>
          <div className="flex items-start gap-3 flex-wrap">
            <span className="text-sm text-s112-muted">{gueltigeParzellen.length} Parzellen · {fmtZahl(gesamtKg/1000, 2)} t{stornierteAnzahl > 0 ? ` · ${stornierteAnzahl} storniert` : ''}</span>
            <StornierteUmschalter anzahl={stornierteAnzahl} sichtbar={stornierteZeigen} onChange={setStornierteZeigen} className="mt-0.5" />
            {writeOk && !showForm && (
              <button onClick={() => { setShowForm(true); setEditId(null) }}
                data-print="hide"
                className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow font-semibold px-4 py-2.5 sm:px-3 sm:py-1.5 rounded-lg text-sm sm:text-xs hover:bg-s112-teal/90 transition-colors shadow-xs">
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

        {showForm && !editId && (
          <div ref={formRef} className="mb-4 scroll-mt-4" data-print="hide">
            <NeueParzellenForm jahrgangId={jahrgang.id} leseId={leseId} leseArt={leseArt} weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} onDone={() => setShowForm(false)} />
          </div>
        )}

        {leseTitel && writeOk && (
          <p className="mb-3 text-xs text-s112-muted" data-print="hide">Neue Einträge über „Ernte“ landen in der Lese {leseTitel}.</p>
        )}

        {tabellenParzellen.length > 0 && (
          <LesedatenKarten zeilen={tabellenZeilen} mehrereLesen={mehrereLesen} gesamtKg={gesamtKg}
            writeOk={writeOk} editId={editId} setEditId={id => { setEditId(id); setShowForm(false) }}
            jahrgangId={jahrgang.id} weingaerten={weingaerten} gstByWeingarten={gstByWeingarten} />
        )}
        {tabellenParzellen.length > 0 ? (
          <div className="hidden md:block print:block border border-s112-border rounded-xl overflow-x-auto print:overflow-visible">
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
                {tabellenZeilen.map((p, i) => (
                  <React.Fragment key={p.id}>
                    {mehrereLesen && (i === 0 || tabellenZeilen[i - 1].lese_nr !== p.lese_nr) && (
                      <tr className="bg-s112-bg/60 border-b border-s112-border">
                        <td colSpan={spaltenAnzahl} className="px-3 py-1.5 text-xs font-semibold text-s112-text-2">
                          Lese {p.lese_titel ?? '–'}
                        </td>
                      </tr>
                    )}
                    <tr className={`group border-b border-s112-border/40 last:border-0 hover:bg-s112-bg/30 ${p.storno ? 'text-s112-muted opacity-70' : ''}`}>
                      <td className="px-3 py-2 font-medium text-s112-text">
                        {p.weingarten_name}
                        {p.storno && (
                          <span className="block text-[11px] font-normal text-s112-warn-fg">
                            storniert am {new Date(p.storno.am).toLocaleDateString('de-AT')}{p.storno.von ? ` von ${p.storno.von}` : ''}{p.storno.grund ? ` – ${p.storno.grund}` : ''}
                          </span>
                        )}
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
                            {writeOk && !p.storno && (
                              <button onClick={() => { setEditId(p.id); setShowForm(false) }}
                                title="Bearbeiten" aria-label="Bearbeiten"
                                className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={14} /></button>
                            )}
                            {/* KAN-148 C1b: stornieren statt löschen – wer bearbeiten darf, darf stornieren (KAN-166) */}
                            {writeOk && !p.storno && (
                              <StornoButton
                                action={grund => stornoErnteParzelle(p.id, jahrgang.id, grund)}
                                hinweis="Der Eintrag bleibt als storniert in den Lesedaten stehen und zählt in keiner Menge, Erntemeldung oder Verfügbarkeit – nur möglich, solange die Menge nicht schon verpresst oder als Trauben verkauft ist." />
                            )}
                            {/* KAN-148 C1d: endgültig löschen nur stornierter Einträge, mit Grund */}
                            {writeOk && p.storno && (
                              <StornoButton modus="loeschen" label="Endgültig löschen"
                                action={grund => endgueltigLoeschenLese('ernte_parzellen', p.id, jahrgang.id, grund)}
                                hinweis="Nur bei einer Fehlerfassung: Der stornierte Eintrag wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll. Nach einer eingereichten Erntemeldung nicht mehr möglich." />
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

      {/* Hektarhöchstertrag-Prüfung (alle Stufen ab Landwein, betriebsweit – KAN-79) – reine Info-/Warnfunktion */}
      {hektarhoechstertrag.gesamtKg > 0 && (
        <div className={`rounded-xl px-4 py-3 text-sm border ${
          hektarhoechstertrag.ueberschritten
            ? 'bg-s112-err-bg border-s112-err/30 text-s112-err-fg'
            : 'bg-s112-bg border-s112-border text-s112-text-2'
        }`} data-print="hide">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="inline-flex items-start gap-1.5">
              {hektarhoechstertrag.ueberschritten && <AlertTriangle size={14} className="mt-0.5 shrink-0" />}
              <span>Lese betriebsweit (§ 23 WeinG): <strong>{fmtNum(hektarhoechstertrag.gesamtKg)} kg</strong>
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
          {hektarhoechstertrag.ueberschritten && (
            <p className="text-xs mt-1 font-medium">{HOECHSTERTRAG_RECHTSFOLGE}.</p>
          )}
          <p className="text-xs mt-1 opacity-75">
            Hinweis, keine rechtliche Prüfung – zählt alle Lesen des Jahrgangs (§ 23 Abs. 1 WeinG: auch Wein mit Sorte/Jahrgang); frei wäre nur Wein ohne Rebsorten- und Jahrgangsbezeichnung.
          </p>
        </div>
      )}

      {/* Pressungen: seit dem Pilottest (30.09.2026) im Kellerbuch – hier nur der Verweis */}
      <div className="card flex items-center justify-between gap-3 flex-wrap" data-print="hide">
        <div>
          <h2 className="text-base font-semibold text-s112-text">Pressungen</h2>
          <p className="text-sm text-s112-muted mt-0.5">
            {pressungenAnzahl === 0 ? 'Noch keine Pressungen' : `${pressungenAnzahl} ${pressungenAnzahl === 1 ? 'Pressung' : 'Pressungen'}`}
            {leseTitel ? ` in ${leseTitel}` : ''} – erfasst und bearbeitet im Kellerbuch.
          </p>
        </div>
        <Link href={pressungenHref} className="text-sm text-s112-blue-700 hover:underline font-medium whitespace-nowrap">
          Kellerbuch › Pressungen →
        </Link>
      </div>

      {/* AMA-Erntemeldung: Status, Einreichen, Rückmeldung, Korrekturmeldung (KAN-148 C2) */}
      {writeOk && (
        <AmaMeldungKarte jahrgangId={jahrgang.id} jahrgang={jahrgang.jahrgang} amaMeldung={amaMeldung}
          stichtagHinweis={stichtagHinweis} anzahlParzellen={gueltigeParzellen.length} csvErlaubt={csvErlaubt} />
      )}
    </div>
  )
}
