'use client'

import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { createTraubenverkauf, updateTraubenverkauf, stornoTraubenverkauf, endgueltigLoeschenLese } from '../actions'
import StornoButton from '@/components/StornoButton'
import type { ZukaufTraubenOpt } from './PressungSection'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum, dezimal } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { qualitaetLabel, LESE_QUALITAETEN, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvDateiname, csvDatei, HINWEIS_BKI_UPLOAD } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { SPALTEN_TRAUBENVERKAUF_LISTE, traubenverkaufListenHinweise, type TraubenverkaufListenZeile } from '@/lib/behoerden/traubenverkauf'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'
import type { GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'

function Fehlermeldung({ text, onClose }: { text: string; onClose?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">
      <span className="flex-1">{text}</span>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Meldung schließen" className="shrink-0 font-semibold hover:opacity-70">×</button>
      )}
    </div>
  )
}

export type Traubenverkauf = {
  id: string
  // Quelle: eigener Weingarten ODER zugekaufter Posten (Migration 141) - genau
  // eines der beiden ist gesetzt. grundstueck_id ist bei einer Weingarten-
  // Quelle gesetzt, wenn die Lese GST-genau erfasst wurde (Bugfix: nötig,
  // damit ein Verkauf die verfügbare Menge im Pressungs-Vorschlag korrekt
  // reduziert, der ebenfalls auf GST-Ebene rechnet).
  weingarten_id: string | null; grundstueck_id?: string | null; grundstueck_nr?: string | null; zukauf_posten_id?: string | null; weingarten_name: string
  kontakt_id: string | null; kontakt_name: string | null
  firma_id: string | null; firma_name: string | null
  datum: string; menge_kg: number
  preis_per_kg: number | null; kmw_grad: number | null
  // Mostgewicht mit gemessener Einheit (KAN-128): kmw_grad führend, oechsle, mostgewicht_einheit
  oechsle: number | null; mostgewicht_einheit: string | null
  qualitaetsstufe: string | null; gesundheit: string
  herkunft_code: string | null; notizen: string | null
  liefernummer: string | null
  // Zugehörige Rechnung (verkaufsposten) – Stornieren storniert sie mit (KAN-35/KAN-148)
  rechnungsnummer?: string | null
  rechnung_storniert?: boolean
  /** KAN-148 C1b: storniert – Vermerk statt Aktionen, zählt in keiner Summe */
  storno?: { am: string; von: string | null; grund: string | null } | null
}
export type TVWGOption = { id: string; name: string; herkunft_code: string | null }
export type TVKontaktOption = { id: string; name: string; betrieb_nr: string | null }
export type TVFirmaOption  = { id: string; name: string; betrieb_nr: string | null }
// Quelle "eigene Ernte" – pro GST (falls die Lese GST-genau erfasst wurde) oder
// pro Weingarten (Fallback, wenn für diesen Weingarten gar keine GST-Zuordnung
// existiert). compositeId kodiert, welcher Fall vorliegt: "gst:<id>" / "wg:<id>".
export type TVQuelleOption = {
  compositeId: string
  weingarten_id: string
  grundstueck_id: string | null
  label: string
  herkunft_code: string | null
  // Mostgewicht der Lese mit gemessener Einheit (KAN-128) – Vorbelegung
  klosterneuburger: number | null
  oechsle: number | null
  mostgewicht_einheit: string | null
  qualitaetsstufe: string | null
  verfuegbar_kg: number
}

// Trauben-Qualität = Stufen der Lese (KAN-73: LESE_QUALITAETEN, jetzt auch „Wein“) – vorbelegt
// aus den Lesedaten der Ried/GST; ein gespeicherter Wert außerhalb der Liste bleibt sichtbar.

const fmt = (n: number | null) =>
  n == null ? '–' : fmtNum(n, { max: 2 })
const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })

// ── Formular ──────────────────────────────────────────────────────────────────

function TVForm({ jahrgangId, leseId, tv, quelleOptions, zukaufOptions, kontaktOptions, firmaOptions, onDone }: {
  jahrgangId: string
  /** KAN-129: gewählte Lese (Reiter) – ein neuer Verkauf aus eigener Ernte landet in ihr */
  leseId: string | null
  tv?: Traubenverkauf
  quelleOptions: TVQuelleOption[]
  zukaufOptions: ZukaufTraubenOpt[]
  kontaktOptions: TVKontaktOption[]
  firmaOptions: TVFirmaOption[]
  onDone: () => void
}) {
  // Quelle: eigene Ernte (Ried/GST) oder zugekaufte Trauben (siehe Migration 141)
  const [quelle, setQuelle]     = useState<'ernte' | 'zukauf'>(tv?.zukauf_posten_id ? 'zukauf' : 'ernte')
  const [zukaufId, setZukaufId] = useState(tv?.zukauf_posten_id ?? '')
  const [quelleId, setQuelleId] = useState(
    tv ? (tv.grundstueck_id ? `gst:${tv.grundstueck_id}` : (tv.weingarten_id ? `wg:${tv.weingarten_id}` : '')) : ''
  )
  // Käufer-Typ: Firma ist Standard
  const initType = tv ? (tv.firma_id ? 'firma' : 'kontakt') : 'firma'
  const [buyerType, setBuyerType] = useState<'firma' | 'kontakt'>(initType)
  const [kontaktId, setKontakt] = useState(tv?.kontakt_id ?? '')
  const [firmaId, setFirma]     = useState(tv?.firma_id ?? '')
  const [datum, setDatum]       = useState(tv?.datum ?? new Date().toISOString().split('T')[0])
  const [mengeKg, setMengeKg]   = useState(tv?.menge_kg?.toString().replace('.', ',') ?? '')
  const [preis, setPreis]       = useState(tv?.preis_per_kg?.toString().replace('.', ',') ?? '')
  // Mostgewicht (KAN-128): Vorbelegung bzw. gespeicherter Wert – die Eingabe hält den Messwert selbst
  // und schickt ihn als versteckte Felder mostgewicht_wert/_einheit; die Action rechnet beide Werte
  const [mgStart, setMgStart]   = useState<GespeichertesMostgewicht | null>(
    tv ? { kmw: tv.kmw_grad, oechsle: tv.oechsle, einheit: tv.mostgewicht_einheit } : null,
  )
  const [qualitaet, setQualitaet] = useState(tv?.qualitaetsstufe ?? '')
  const [gesundheit, setGesundheit] = useState(tv?.gesundheit ?? 'G')
  const [herkunft, setHerkunft] = useState(tv?.herkunft_code ?? '')
  const [notizen, setNotizen]   = useState(tv?.notizen ?? '')
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler]     = useState<string | null>(null)

  // Verfügbare kg je Zukauf-Posten, während einer Bearbeitung um die eigene
  // Zeile bereinigt (analog TraubenverkaufClient.tsx).
  const verfuegbarZukauf = (zId: string) => {
    const opt = zukaufOptions.find(z => z.id === zId)
    if (!opt) return 0
    const eigenerAnteil = tv && tv.zukauf_posten_id === zId ? Number(tv.menge_kg ?? 0) : 0
    return Math.max(0, Number(opt.verfuegbar_kg ?? 0) + eigenerAnteil)
  }

  // Verfügbare kg je Ried/GST-Quelle, während einer Bearbeitung um die eigene
  // Zeile bereinigt – Bugfix: vorher wurde bei "eigene Ernte" gar keine
  // verfügbare Menge berechnet/angezeigt und beim Speichern keine GST erfasst,
  // wodurch verkaufte Mengen im Pressungs-Vorschlag nie abgezogen wurden.
  const verfuegbarQuelle = (compositeId: string) => {
    const opt = quelleOptions.find(o => o.compositeId === compositeId)
    if (!opt) return 0
    const eigenerAnteil = tv && (
      (opt.grundstueck_id && tv.grundstueck_id === opt.grundstueck_id) ||
      (!opt.grundstueck_id && !tv.grundstueck_id && tv.weingarten_id === opt.weingarten_id)
    ) ? Number(tv.menge_kg ?? 0) : 0
    return Math.max(0, opt.verfuegbar_kg + eigenerAnteil)
  }

  function handleQuelleChange(newId: string) {
    setQuelleId(newId)
    const opt = quelleOptions.find(o => o.compositeId === newId)
    setHerkunft(opt?.herkunft_code ?? '')
    if (!tv && opt) {
      // Mostgewicht (Messwert und Einheit) + Qualität aus den Lesedaten dieser Ried/GST vorausfüllen
      if (opt.klosterneuburger != null || opt.oechsle != null) {
        setMgStart({ kmw: opt.klosterneuburger, oechsle: opt.oechsle, einheit: opt.mostgewicht_einheit })
      }
      if (opt.qualitaetsstufe) setQualitaet(opt.qualitaetsstufe)
    }
  }

  function handleZukaufChange(newZukaufId: string) {
    setZukaufId(newZukaufId)
    const opt = zukaufOptions.find(z => z.id === newZukaufId)
    if (opt) setHerkunft(opt.herkunft ?? '')
    // KAN-128: Mostgewicht des Zukaufs (zukauf_posten.kmw/oechsle/mostgewicht_einheit) vorbelegen
    if (!tv && opt && (opt.kmw_grad != null || opt.oechsle != null)) {
      setMgStart({ kmw: opt.kmw_grad, oechsle: opt.oechsle ?? null, einheit: opt.mostgewicht_einheit ?? null })
    }
  }

  const gesamtWert = mengeKg && preis
    ? parseFloat(dezimal(mengeKg)) * parseFloat(dezimal(preis))
    : null

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Mostgewicht aus den versteckten Feldern der Eingabe (Messwert wie eingegeben + Einheit)
    const formular = new FormData(e.currentTarget)
    const fd = new FormData()
    fd.append('jahrgang_id', jahrgangId)
    if (leseId && !tv) fd.append('lese_id', leseId)
    if (quelle === 'zukauf') {
      fd.append('zukauf_posten_id', zukaufId)
    } else {
      const opt = quelleOptions.find(o => o.compositeId === quelleId)
      fd.append('weingarten_id', opt?.weingarten_id ?? '')
      if (opt?.grundstueck_id) fd.append('grundstueck_id', opt.grundstueck_id)
    }
    if (kontaktId) fd.append('kontakt_id', kontaktId)
    if (firmaId) fd.append('firma_id', firmaId)
    fd.append('datum', datum)
    fd.append('menge_kg', mengeKg)
    if (preis) fd.append('preis_per_kg', preis)
    for (const feld of ['mostgewicht_wert', 'mostgewicht_einheit']) {
      const w = formular.get(feld)
      if (typeof w === 'string') fd.append(feld, w)
    }
    if (qualitaet) fd.append('qualitaetsstufe', qualitaet)
    fd.append('gesundheit', gesundheit)
    if (herkunft) fd.append('herkunft_code', herkunft)
    if (notizen) fd.append('notizen', notizen)
    setFehler(null)
    startTransition(async () => {
      try {
        if (tv) await updateTraubenverkauf(tv.id, fd)
        else await createTraubenverkauf(fd)
        onDone()
      } catch (err) {
        setFehler(fehlerText(err))
      }
    })
  }

  const inp = 'w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-4">
      <h3 className="text-sm font-semibold text-s112-text">{tv ? 'Traubenverkauf bearbeiten' : 'Traubenverkauf erfassen'}</h3>

      {/* Quelle */}
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-2">Quelle</label>
        <div className="flex gap-2">
          <button type="button" onClick={() => setQuelle('ernte')}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${quelle === 'ernte' ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg border border-s112-border text-s112-text-2 hover:border-s112-teal'}`}>
            Eigene Ernte
          </button>
          <button type="button" onClick={() => setQuelle('zukauf')}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${quelle === 'zukauf' ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg border border-s112-border text-s112-text-2 hover:border-s112-teal'}`}>
            Zukauf
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {quelle === 'zukauf' ? (
          <div className="col-span-2">
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
          <div className="col-span-2">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Ried / GST *</label>
            <select aria-label="Ried / GST" value={quelleId} onChange={e => handleQuelleChange(e.target.value)} required className={inp}>
              <option value="">– Ried/GST wählen –</option>
              {quelleOptions.map(o => (
                <option key={o.compositeId} value={o.compositeId}>
                  {o.label}{o.herkunft_code ? ` (${o.herkunft_code})` : ''}
                  {' – '}{fmtNum(verfuegbarQuelle(o.compositeId), { max: 0 })} kg verf.
                </option>
              ))}
            </select>
            {quelleOptions.length === 0 && (
              <p className="text-xs text-s112-warn-fg mt-1">Keine Lesedaten für diesen Jahrgang vorhanden.</p>
            )}
            {quelleId && (
              <p className="text-xs text-s112-muted mt-1">
                Verfügbar: <span className="font-medium text-s112-text-1">{fmtNum(verfuegbarQuelle(quelleId), { max: 0 })} kg</span>
              </p>
            )}
          </div>
        )}

        {/* Datum */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input aria-label="Datum" type="date" value={datum} onChange={e => setDatum(e.target.value)} required className={inp} />
        </div>

        {/* Menge kg */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge (kg) *</label>
          <input aria-label="Menge (kg)" type="text" inputMode="decimal" value={mengeKg} onChange={e => setMengeKg(e.target.value)}
            placeholder="z.B. 1.250" required className={inp} />
        </div>

        {/* Preis/kg */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Preis (€/kg)</label>
          <input aria-label="Preis (€/kg)" type="text" inputMode="decimal" value={preis} onChange={e => setPreis(e.target.value)}
            placeholder="z.B. 0,65" className={inp} />
        </div>

        {/* Gesundheit */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Gesundheit</label>
          <select aria-label="Gesundheit" value={gesundheit} onChange={e => setGesundheit(e.target.value)} className={inp}>
            <option value="G">G – Gut</option>
            <option value="K">K – Krank/beschädigt</option>
          </select>
        </div>

        {/* Mostgewicht in °KMW oder °Oe (KAN-128) – bevorzugte Einheit des Betriebs zuerst */}
        <div className="col-span-2">
          <MostgewichtEingabe name="mostgewicht" startwert={mgStart} />
        </div>

        {/* Qualitätsstufe */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Qualitätsstufe</label>
          <select aria-label="Qualitätsstufe" value={qualitaet} onChange={e => setQualitaet(e.target.value)} className={inp}>
            <option value="">– keine –</option>
            {/* gespeicherter Wert (nicht der Formularzustand): bleibt nach einem Wechsel wieder wählbar;
                die Vorbelegung bei der Neuanlage kommt aus ernte_parzellen (CHECK = Lese-Liste) */}
            {mitGespeichertemWert(LESE_QUALITAETEN, tv?.qualitaetsstufe).map(q => <option key={q.value} value={q.value}>{q.label}</option>)}
          </select>
        </div>

        {/* Herkunftscode (read-only aus WG, bzw. Freitext bei Zukauf) */}
        {herkunft && (
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Herkunftscode (BKI)</label>
            <div className={inp + ' bg-white text-s112-text-2 cursor-not-allowed'}>{herkunft}</div>
          </div>
        )}
      </div>

      {/* Abnehmer */}
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-2">Käufer</label>
        <div className="flex gap-2 mb-2">
          <button type="button"
            onClick={() => { setBuyerType('firma'); setKontakt('') }}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${buyerType === 'firma' ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg border border-s112-border text-s112-text-2 hover:border-s112-teal'}`}>
            Firma
          </button>
          <button type="button"
            onClick={() => { setBuyerType('kontakt'); setFirma('') }}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${buyerType === 'kontakt' ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg border border-s112-border text-s112-text-2 hover:border-s112-teal'}`}>
            Privatperson
          </button>
        </div>
        {buyerType === 'firma' ? (
          <select value={firmaId} onChange={e => setFirma(e.target.value)} className={inp}>
            <option value="">– Firma wählen –</option>
            {firmaOptions.map(f => (
              <option key={f.id} value={f.id}>{f.name}{f.betrieb_nr ? ` (Betr.Nr. ${f.betrieb_nr})` : ''}</option>
            ))}
          </select>
        ) : (
          <select value={kontaktId} onChange={e => setKontakt(e.target.value)} className={inp}>
            <option value="">– Kontakt wählen –</option>
            {kontaktOptions.map(k => (
              <option key={k.id} value={k.id}>{k.name}{k.betrieb_nr ? ` (Betr.Nr. ${k.betrieb_nr})` : ''}</option>
            ))}
          </select>
        )}
      </div>

      {/* Live-Kalkulation */}
      {gesamtWert != null && gesamtWert > 0 && (
        <div className="flex gap-4 text-xs bg-white border border-s112-border rounded-lg px-3 py-2">
          <span className="text-s112-text-2">
            Gesamtwert: <strong className="text-s112-text">
              € {fmtNum(gesamtWert, 2)}
            </strong>
          </span>
        </div>
      )}

      {/* Notizen */}
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
        <input aria-label="Notizen" type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
          placeholder="z.B. Abholung durch Genossenschaft …" className={inp} />
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

export default function TraubenverkaufSection({
  jahrgangId, leseId, jahrgang, bkiErlaubt, verkauefe, quelleOptions, zukaufOptions, kontaktOptions, firmaOptions, writeOk,
}: {
  jahrgangId: string
  /** KAN-129: gewählte Lese (Reiter der Jahrgangsseite) */
  leseId: string | null
  /** Jahrgang (Jahreszahl) – Parameter des BKI-Datenblatts und Teil des Dateinamens */
  jahrgang: number
  /** BKI-Datenblatt (Pflichtmeldung) – gleiche Regel wie die CSV-Route */
  bkiErlaubt: boolean
  verkauefe: Traubenverkauf[]
  quelleOptions: TVQuelleOption[]
  zukaufOptions: ZukaufTraubenOpt[]
  kontaktOptions: TVKontaktOption[]
  firmaOptions: TVFirmaOption[]
  writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)

  // KAN-148 C1b: stornierte Traubenverkäufe stehen gekennzeichnet in der Liste, zählen aber in keiner Summe
  const gueltige = verkauefe.filter(v => !v.storno)
  const gesamtKg = gueltige.reduce((s, v) => s + v.menge_kg, 0)
  const gesamtWert = gueltige.reduce((s, v) => s + (v.menge_kg * (v.preis_per_kg ?? 0)), 0)

  // Interne Traubenverkauf-Liste dieses Jahrgangs (Excel) – das amtliche Format ist das
  // BKI-Datenblatt daneben. CSV über den Baustein lib/csv (Semikolon, BOM, Formelschutz).
  function listeErzeugen() {
    const zeilen: TraubenverkaufListenZeile[] = verkauefe.map(v => ({
      liefernummer: v.liefernummer,
      datum: v.datum,
      jahrgang,
      quelle: v.weingarten_name,
      gstNr: v.grundstueck_nr ?? null,
      mengeKg: v.menge_kg,
      preisProKg: v.preis_per_kg,
      kmw: v.kmw_grad,
      oechsle: v.oechsle,
      mostgewichtEinheit: v.mostgewicht_einheit,
      qualitaet: v.qualitaetsstufe ? qualitaetLabel(v.qualitaetsstufe) : null,
      gesundheit: v.gesundheit,
      herkunftscode: v.herkunft_code,
      kaeufer: v.firma_name ?? v.kontakt_name,
      rechnungsnummer: v.rechnungsnummer ?? null,
      notizen: v.notizen,
      storniertAm: v.storno?.am ?? null,
      stornoGrund: v.storno?.grund ?? null,
    }))
    const datei = csvDatei(zeilen, SPALTEN_TRAUBENVERKAUF_LISTE)
    return { text: datei.text, zeilen: datei.zeilen, warnungen: [...datei.warnungen, ...traubenverkaufListenHinweise(zeilen)], dateiname: csvDateiname(['Traubenverkauf-Liste', jahrgang]).utf8 }
  }

  return (
    <div className="card space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-s112-text">Traubenverkauf</h2>
          <p className="text-xs text-s112-muted">Verkauf von Weintrauben gem. § 3 Weingesetz-Formularverordnung</p>
        </div>
        <div className="flex items-start gap-3 flex-wrap">
          {verkauefe.length > 0 && (
            <span className="text-xs text-s112-muted">
              {fmt(gesamtKg)} kg
              {gesamtWert > 0 && <span className="ml-1 font-medium text-s112-text-1">
                · € {fmtNum(gesamtWert, 2)}
              </span>}
            </span>
          )}
          {verkauefe.length > 0 && (
            <CsvExportKnopf label="Liste als CSV" erzeugen={listeErzeugen} />
          )}
          {bkiErlaubt && verkauefe.length > 0 && (
            <CsvExportKnopf label="BKI-Datenblatt als CSV" hinweis={HINWEIS_BKI_UPLOAD} href={csvPfad('bki-traubenverkauf', { jahrgang })} />
          )}
          {writeOk && !showForm && (
            <button onClick={() => { setShowForm(true); setEditId(null) }}
              className="text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-blue-700 font-medium px-3 py-1.5 rounded-lg transition-colors">
              Traubenverkauf
            </button>
          )}
        </div>
      </div>

      {showForm && !editId && (
        <TVForm jahrgangId={jahrgangId} leseId={leseId} quelleOptions={quelleOptions} zukaufOptions={zukaufOptions}
          kontaktOptions={kontaktOptions} firmaOptions={firmaOptions}
          onDone={() => setShowForm(false)} />
      )}

      {verkauefe.length === 0 && !showForm ? (
        <div className="border border-dashed border-s112-border rounded-xl p-8 text-center text-sm text-s112-muted">
          Noch keine Traubenverkäufe erfasst.
        </div>
      ) : (
        <div className="space-y-2">
          {verkauefe.map(v => (
            <div key={v.id}>
              {editId === v.id ? (
                <TVForm tv={v} jahrgangId={jahrgangId} leseId={leseId} quelleOptions={quelleOptions} zukaufOptions={zukaufOptions}
                  kontaktOptions={kontaktOptions} firmaOptions={firmaOptions}
                  onDone={() => setEditId(null)} />
              ) : (
                <div className={`group border border-s112-border rounded-xl p-3 ${v.storno ? 'text-s112-muted opacity-70' : ''}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        {v.liefernummer && (
                          <span className="font-mono text-xs bg-s112-teal/10 text-s112-blue-700 px-2 py-0.5 rounded-full font-semibold">
                            {v.liefernummer}
                          </span>
                        )}
                        <span className="font-medium text-s112-text text-sm">{fmtDate(v.datum)}</span>
                        <span className="text-sm text-s112-text-1">· {v.weingarten_name}</span>
                        {v.gesundheit === 'K' && (
                          <span className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full font-medium">K – Krank</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 text-xs text-s112-muted flex-wrap">
                        <span className="font-semibold text-s112-text-1">{fmt(v.menge_kg)} kg</span>
                        {v.preis_per_kg != null && (
                          <span>· € {fmtNum(v.preis_per_kg, { min: 2 })}/kg
                            <span className="ml-1 font-medium text-s112-text-1">
                              = € {fmtNum((v.menge_kg * v.preis_per_kg), 2)}
                            </span>
                          </span>
                        )}
                        {(v.kmw_grad != null || v.oechsle != null) && (
                          <span>· <MostgewichtAnzeige wert={{ kmw: v.kmw_grad, oechsle: v.oechsle, einheit: v.mostgewicht_einheit }} /></span>
                        )}
                        {v.qualitaetsstufe && <span>· {qualitaetLabel(v.qualitaetsstufe)}</span>}
                        {(v.firma_name ?? v.kontakt_name) && (
                          <span>· {v.firma_name ?? v.kontakt_name}</span>
                        )}
                        {v.notizen && <span className="italic">· {v.notizen}</span>}
                      </div>
                      {v.storno && (
                        <p className="text-[11px] text-s112-warn-fg">
                          storniert am {new Date(v.storno.am).toLocaleDateString('de-AT')}{v.storno.von ? ` von ${v.storno.von}` : ''}{v.storno.grund ? ` – ${v.storno.grund}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-xs">
                      {writeOk && !v.storno && (
                        <button onClick={() => setEditId(v.id)} title="Bearbeiten" aria-label="Bearbeiten" className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={14} /></button>
                      )}
                      {/* KAN-148 C1b: stornieren statt löschen (Liefernummer und Rechnungsbezug bleiben) */}
                      {writeOk && !v.storno && (
                        <StornoButton
                          action={grund => stornoTraubenverkauf(v.id, jahrgangId, grund)}
                          label={v.rechnungsnummer && !v.rechnung_storniert ? `Stornieren (storniert Rechnung ${v.rechnungsnummer})` : undefined}
                          hinweis={`Der Traubenverkauf bleibt samt Liefernummer als storniert stehen, die kg werden wieder frei.${v.rechnungsnummer && !v.rechnung_storniert ? ` Die zugehörige Rechnung ${v.rechnungsnummer} wird dabei storniert – sie bleibt als stornierter Beleg erhalten.` : ''}`} />
                      )}
                      {/* KAN-148 C1d: endgültig löschen nur stornierter Traubenverkäufe ohne Rechnung */}
                      {writeOk && v.storno && !v.rechnungsnummer && (
                        <StornoButton modus="loeschen" label="Endgültig löschen"
                          action={grund => endgueltigLoeschenLese('traubenverkauf', v.id, jahrgangId, grund)}
                          hinweis="Nur bei einer Fehlerfassung: Der stornierte Eintrag wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll. Nach einer eingereichten Erntemeldung nicht mehr möglich." />
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
