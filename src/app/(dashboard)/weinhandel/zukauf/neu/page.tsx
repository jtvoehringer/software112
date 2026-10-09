'use client'

import { gebindeOption } from '@/lib/keller/gebindeAnzeige'
import { useState, useTransition, useEffect, useRef } from 'react'
import { zukaufLieferantFehler } from '@/lib/handel/partnerPflicht'
import { zurueckZiel } from '@/lib/navigation/zurueckBrowser'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import Link from '@/components/ui/Link'
import { createZukauf } from '../actions'
import { FLASCHEN_GROESSEN_ML, flaschenPruefnummerPflicht, istFlaschenArt, istTraubenArt } from '@/lib/zukauf/ware'
import { pruefnummerLabel } from '@/lib/zukauf/pruefnummerLabel'
import { LESE_QUALITAETEN, QUALITAET_OPTS } from '@/lib/wein/qualitaet'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { verschnittHinweis } from '@/lib/kellerbuch/verschnittHinweis'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'
import PartnerSuche from '@/components/crm/PartnerSuche'
import { fehlerText } from '@/lib/fehler'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import HerkunftCodeSelect from '@/components/weinbaugebiete/HerkunftCodeSelect'
import { herkunftOptionen } from '@/lib/herkunft'
import ZusatzErzeugnisFelder from '@/components/wein/ZusatzErzeugnisFelder'
import LandSelect, { type Land } from '@/components/wein/LandSelect'
import { ladeCustomWeinbaugebiete, type CustomWeinbaugebiet } from '@/app/(dashboard)/weinbaugebiete/actions'
import { heuteWien } from '@/lib/datum/wien'

interface Behaelter { id: string; name: string; typ: string; volumen_liter: number | null }


const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

const DEFAULT_EINHEIT: Record<string, string> = {
  wein: 'L', trauben: 'kg', most: 'L', maische: 'kg', flaschen: 'Stk',
}

// Qualitätsstufe eines Wein-/Most-Zukaufs: geht in die Zielcharge (weinausbau) – deshalb die
// zentrale Chargen-Liste QUALITAET_OPTS (KAN-73; vorher eine eigene Teilliste ohne „Wein“).
// KAN-80 Nachtrag (02.10.2026): auch Trauben haben eine Stufe – dort die Liste der Lese (LESE_QUALITAETEN).
const qualitaetsListe = (art: string) => istTraubenArt(art) ? LESE_QUALITAETEN : QUALITAET_OPTS

// KAN-80 Nachtrag: Herkunfts-Code (BKI) wie am GST – alle Weinbaugebiete Österreichs, nach Region gruppiert
const HERKUNFT_OPTIONS = herkunftOptionen()

// Lieferanten-Suche: serverseitig über components/crm/PartnerSuche (17.9.2026)

export default function ZukaufNeuPage() {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)
  // KAN-193: Zukauf sofort als Verschnitt in die Charge im Gebinde gebucht – Hinweis statt Weiterleitung
  const [verschnitt, setVerschnitt]  = useState<{ zeilen: string[]; chargeId: string | null } | null>(null)

  const [behaelter,       setBehaelter]       = useState<Behaelter[]>([])
  const [weinausbauListe, setWeinausbauListe] = useState<{ id: string; name: string; behaelter_id: string | null; rebsorte: string | null; menge_liter: number | null }[]>([])
  const [loading,         setLoading]         = useState(true)

  // ── Grunddaten ────────────────────────────────────────────────────────────
  const [datum,           setDatum]           = useState(heuteWien())
  const [uhrzeit,         setUhrzeit]         = useState('')
  const [art,             setArt]             = useState<'wein' | 'trauben' | 'most' | 'maische' | 'flaschen'>('wein')

  // ── Lieferant / Versender ─────────────────────────────────────────────────
  const [lieferantKontakt, setLieferantKontakt] = useState('')
  const [lieferantFirma,   setLieferantFirma]   = useState('')
  const [lieferantZh,      setLieferantZh]      = useState('')
  // Rückmeldung Jörgen 07.10.2026: Betriebsnummer schon bei der Auswahl prüfen (undefined = noch nicht bekannt)
  const [lieferantInfo, setLieferantInfo] = useState<{ name: string; betriebNr: string | null; href: string } | null>(null)
  const [eingangsrechnungsnummer, setEingangsrechnungsnummer] = useState('')

  // ── Transportmittel ───────────────────────────────────────────────────────
  const [zugmaschine,  setZugmaschine]  = useState('')
  const [tbsNummer,    setTbsNummer]    = useState('')
  const [tbsJahr,      setTbsJahr]      = useState(String(new Date().getFullYear()))
  const [anhaenger1,   setAnhaenger1]   = useState('')
  const [anhaenger2,   setAnhaenger2]   = useState('')

  // ── Ware ──────────────────────────────────────────────────────────────────
  // KAN-80 Nachtrag (02.10.2026): Weinart ist Pflicht – keine Vorauswahl „Unbekannt“ mehr
  const [weinart,       setWeinart]       = useState<'weiss' | 'rot' | 'rose' | ''>('')
  const [rebsorte,      setRebsorte]      = useState('')
  const [qualitaet,     setQualitaet]     = useState('')
  const [jahrgang,      setJahrgang]      = useState('')
  const [herkunft,      setHerkunft]      = useState('')
  // KAN-186: Ursprungsland (kat_land), Österreich vorbelegt
  const [landIso,       setLandIso]       = useState('AT')
  const [laender,       setLaender]       = useState<Land[]>([])
  // Eigene Weinbaugebiete des Betriebs (wie am GST, ladeCustomWeinbaugebiete) – null = noch nicht geladen
  const [eigeneGebiete, setEigeneGebiete] = useState<CustomWeinbaugebiet[] | null>(null)
  const [anreicherung,  setAnreicherung]  = useState(false)
  const [alkohol,       setAlkohol]       = useState('')
  const [pruefnummer,   setPruefnummer]   = useState('')

  // ── Menge & Preis ─────────────────────────────────────────────────────────
  const [menge,               setMenge]               = useState('')
  const [einheit,             setEinheit]             = useState('L')
  const [preisGesamt,         setPreisGesamt]         = useState('')
  const [einstandspreisLiter, setEinstandspreisLiter] = useState('')

  // ── Gebinde ───────────────────────────────────────────────────────────────
  const [zielBehaelter, setZielBehaelter] = useState('')

  // ── Weinlager-Artikel (KAN-41 Paket 2b: nur bei zugekauften Flaschen) ─────
  const [fuellungName,     setFuellungName]     = useState('')
  const [flaschengroesse,  setFlaschengroesse]  = useState('750')
  const [vkPreis,          setVkPreis]          = useState('')
  const [mwst,             setMwst]             = useState('')

  // ── Notizen ───────────────────────────────────────────────────────────────
  const [notizen, setNotizen] = useState('')

  // Rebsortenmix-Warnung
  const andereChargenImZiel = zielBehaelter && rebsorte
    ? weinausbauListe.filter(w => w.behaelter_id === zielBehaelter && w.rebsorte && w.rebsorte !== rebsorte)
    : []
  const hatRebsortenmixZukauf = andereChargenImZiel.length > 0

  function handleArtChange(a: 'wein' | 'trauben' | 'most' | 'maische' | 'flaschen') {
    setArt(a)
    // Stufe aus der anderen Liste (Charge ↔ Lese) nicht still mitnehmen
    if (qualitaet && !qualitaetsListe(a).some(q => q.value === qualitaet)) setQualitaet('')
    setEinheit(DEFAULT_EINHEIT[a] ?? 'kg')
    if (istTraubenArt(a) || istFlaschenArt(a)) setZielBehaelter('')
  }

  useEffect(() => {
    ladeCustomWeinbaugebiete().then(setEigeneGebiete).catch(() => setEigeneGebiete([]))
  }, [])

  useEffect(() => {
    async function load() {
      try {
        // Lieferanten (Kontakte + Firmen mit Häkchen "Lieferant", Feedback 12.8.2026)
        // werden seit 17.9.2026 serverseitig gesucht (PartnerSuche) - hier nur noch
        // Behälter/Chargen laden.
        const r2 = await fetch('/api/zukauf-stammdaten')
        if (r2.ok) { const j2 = await r2.json(); setBehaelter(j2.behaelter ?? []); setWeinausbauListe(j2.weinausbau ?? []); setLaender(j2.laender ?? []) }
      } catch { /* ignore */ } finally { setLoading(false) }
    }
    load()
  }, [])

  const preisProEinheit = menge && preisGesamt && parseFloat(menge) > 0
    ? (parseFloat(preisGesamt) / parseFloat(menge)).toFixed(4)
    : null

  // Einstandspreis je Liter aus dem Preis vorbelegen, sobald sich Preis oder Einheit ändern – beim Rendern statt im
  // Effekt; Startwert null, damit es wie bisher auch beim ersten Anzeigen greift
  const preisAnlass = `${einheit}|${preisProEinheit ?? ''}`
  const [preisAnlassVorher, setPreisAnlassVorher] = useState<string | null>(null)
  if (preisAnlass !== preisAnlassVorher) {
    setPreisAnlassVorher(preisAnlass)
    if (einheit === 'L' && preisProEinheit) setEinstandspreisLiter(preisProEinheit)
  }

  // Rückmeldung Jörgen 07.10.2026: dieselbe Regel wie der Server (zukaufLieferantFehler), sofort bei der Auswahl
  const lieferantHinweis = lieferantInfo
    ? zukaufLieferantFehler({ art, lieferant: true, betriebNr: lieferantInfo.betriebNr, landIso, lieferantName: lieferantInfo.name })
    : null
  const fehlerRef = useRef<HTMLDivElement>(null)
  // Fehler beim Speichern stehen oben – sichtbar machen, auch wenn man unten am Knopf ist
  useEffect(() => { if (error) fehlerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [error])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!menge || parseFloat(menge) <= 0) { setError('Menge muss größer als 0 sein.'); return }
    // KAN-80 Nachtrag: die Herkunftsauswahl hat nur ein verstecktes Feld – Pflicht hier prüfen (Server prüft ebenso)
    if (!herkunft) { setError('Bitte den Herkunfts-Code (BKI) wählen.'); return }
    if (lieferantHinweis) { setError(lieferantHinweis); return }
    if (istFlaschenArt(art) && !fuellungName.trim()) { setError('Bitte den Produktnamen für das Weinlager angeben.'); return }
    const fd = new FormData()
    fd.set('datum',                   datum)
    fd.set('lieferung_uhrzeit',       uhrzeit)
    fd.set('art',                     art)
    fd.set('lieferant_kontakt_id',    lieferantKontakt)
    fd.set('lieferant_firma_id',      lieferantFirma)
    fd.set('zh_kontakt_id',           lieferantZh)
    fd.set('eingangsrechnungsnummer', eingangsrechnungsnummer)
    fd.set('transport_zugmaschine',   zugmaschine)
    fd.set('tbs_nummer_lieferant',    tbsNummer)
    fd.set('tbs_jahr_lieferant',      tbsNummer.trim() ? tbsJahr : '')
    fd.set('transport_anhaenger1',    anhaenger1)
    fd.set('transport_anhaenger2',    anhaenger2)
    fd.set('weinart',                 weinart)
    fd.set('rebsorte',                rebsorte)
    fd.set('qualitaetsstufe',         qualitaet)
    fd.set('jahrgang',                jahrgang)
    fd.set('herkunft',                herkunft)
    fd.set('land_iso',                landIso)
    fd.set('anreicherung',            anreicherung ? 'true' : 'false')
    // KAN-130 Etappe 3 (01.10.2026): Mostgewicht = versteckte Felder der Eingabe (Messwert und
    // Einheit); fehlen sie (Art Wein, kein Feld), schickt das Formular kein Mostgewicht
    const formular = new FormData(e.currentTarget as HTMLFormElement)
    // KAN-186: Zusatzbezeichnung und Erzeugnis (ZusatzErzeugnisFelder, nur bei Wein/Most)
    for (const feld of ['mostgewicht_wert', 'mostgewicht_einheit', 'zusatzbezeichnung', 'erzeugnis']) {
      const wert = formular.get(feld)
      if (wert !== null) fd.set(feld, wert)
    }
    fd.set('alkohol_pct',             alkohol)
    fd.set('staatliche_pruefnummer',  pruefnummer)
    fd.set('menge',                   menge)
    fd.set('einheit',                 einheit)
    fd.set('preis_gesamt',            preisGesamt)
    fd.set('einstandspreis_pro_liter', einstandspreisLiter)
    fd.set('ziel_behaelter_id',       zielBehaelter)
    fd.set('notizen',                 notizen)
    fd.set('zurueck',                 zurueckZiel('/weinhandel/zukauf'))   // KAN-224: nach dem Speichern zurück zur Übersicht bzw. woher man kam
    if (istFlaschenArt(art)) {
      fd.set('fuellung_name',         fuellungName)
      fd.set('flaschengroesse_ml',    flaschengroesse)
      fd.set('vk_preis_brutto',       vkPreis)
      fd.set('mwst_pct',              mwst)
    }
    startTransition(async () => {
      try {
        let result = await createZukauf(fd)
        // KAN-83: Prüfnummer einer Charge im Ziel-Gebinde erlischt – nur nach Bestätigung buchen
        if (result?.bestaetigung) {
          if (!window.confirm(result.bestaetigung)) return
          fd.set('pn_bestaetigt', '1')
          fd.set('rotweiss_bestaetigt', '1')   // KAN-193: Rückfrage Rot/Weiß steht in derselben Bestätigung
          result = await createZukauf(fd)
        }
        // KAN-193: abweichender Wein im Gebinde – der Server hat den Zukauf sofort als Verschnitt gebucht (keine
        // Weiterleitung ins Verschneiden-Formular mehr): Hinweis zeigen wie beim Umziehen
        if (result?.verschnitt) {
          setVerschnitt({ zeilen: verschnittHinweis(result.verschnitt, 'Zukauf'), chargeId: result.verschnitt.zielChargeId })
          window.scrollTo({ top: 0, behavior: 'smooth' })
        }
      }
      catch (err) { setError(fehlerText(err, 'Fehler beim Speichern')) }
    })
  }

  const ART_OPTIONS: { value: 'wein' | 'most' | 'trauben' | 'maische' | 'flaschen'; label: string }[] = [
    { value: 'wein',    label: 'Wein' },
    { value: 'most',    label: 'Traubenmost' },
    { value: 'trauben', label: 'Trauben' },
    { value: 'maische', label: 'Maische' },   // KAN-41: wird bei der Pressung als Zukauf Maische gebucht
    { value: 'flaschen', label: 'Flaschen (Handelsware)' },   // KAN-41 Paket 2b: eigener Weinlager-Artikel, Journal ZK_FLA
  ]

  return (
    <div className="space-y-6 max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/zukauf" className="hover:text-s112-blue-700">Zukäufe</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Neuer Zukauf</span>
      </nav>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-s112-text">Neuer Zukauf</h1>
        <span className="text-xs text-s112-muted bg-s112-bg border border-s112-border rounded-full px-3 py-1">
          Transportbescheinigung gem. Weingesetz
        </span>
      </div>

      {error && (
        <div ref={fehlerRef} role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-4 py-3 rounded-lg text-sm">{error}</div>
      )}

      {verschnitt && (
        <div role="status" className="bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg rounded-xl px-5 py-3 text-sm space-y-1">
          {verschnitt.zeilen.map((z, i) => (
            <p key={i} className={i === 0 ? 'font-semibold flex items-center gap-2' : 'text-xs'}>
              {i === 0 && <CheckCircle2 size={16} strokeWidth={1.75} />}{z}
            </p>
          ))}
          <p className="text-xs pt-1 flex gap-4">
            {verschnitt.chargeId && <Link href={`/kellerbuch/weinausbau/${verschnitt.chargeId}`} className="underline">Zur Charge</Link>}
            <Link href="/weinhandel/zukauf" className="underline">Zu den Zukäufen</Link>
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">

        {/* ── 1. Lieferung ──────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Lieferung</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Datum *</label>
              <input aria-label="Datum" type="date" value={datum} onChange={e => setDatum(e.target.value)}
                required className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Uhrzeit</label>
              <input aria-label="Uhrzeit" type="time" value={uhrzeit} onChange={e => setUhrzeit(e.target.value)}
                className={inputCls + ' w-full'} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Art *</label>
            <div className="flex gap-4 mt-1.5">
              {ART_OPTIONS.map(({ value, label }) => (
                <label key={value} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="art" value={value} checked={art === value}
                    onChange={() => handleArtChange(value)} className="accent-s112-teal" />
                  <span className="text-sm text-s112-text-1">{label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* ── 2. Versender ──────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Versender</h2>
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Lieferant *</label>
              <PartnerSuche
                art="lieferant"
                value={lieferantKontakt ? `kontakt:${lieferantKontakt}` : lieferantFirma ? `firma:${lieferantFirma}` : ''}
                onChange={(val, treffer) => {
                  setLieferantZh('')
                  if (!val) { setLieferantKontakt(''); setLieferantFirma(''); setLieferantInfo(null); return }
                  const trennerIdx = val.indexOf(':')
                  const typ = val.slice(0, trennerIdx)
                  const id  = val.slice(trennerIdx + 1)
                  if (typ === 'kontakt') { setLieferantKontakt(id); setLieferantFirma('') }
                  else                   { setLieferantFirma(id);   setLieferantKontakt('') }
                  setLieferantInfo(treffer ? {
                    name: treffer.label, betriebNr: treffer.daten?.betrieb_nr ?? null,
                    href: typ === 'kontakt' ? `/crm/kontakte/${id}` : `/crm/firmen/${id}`,
                  } : null)
                }}
                placeholder="Name oder Firma suchen…"
                disabled={loading}
              />
              <p className="text-xs text-s112-muted mt-1">Bei Firmen kann zusätzlich ein Ansprechpartner (z.H.) angegeben werden.</p>
              {lieferantHinweis && lieferantInfo && (
                <p role="alert" className="mt-2 text-sm bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-lg px-3 py-2">
                  {lieferantHinweis}{' '}
                  <Link href={lieferantInfo.href} target="_blank" className="underline font-medium">Im CRM öffnen ↗</Link>
                  <span className="block text-xs mt-0.5">Nach dem Ergänzen den Lieferanten hier über „Ändern“ neu wählen.</span>
                </p>
              )}
            </div>
            {lieferantFirma && (
              <div className="col-span-2">
                <label className={labelCls}>z.H. (zu Händen) — optional</label>
                <PartnerSuche
                  key={lieferantFirma}
                  art="kontakt"
                  firmaId={lieferantFirma}
                  value={lieferantZh}
                  onChange={id => setLieferantZh(id)}
                  placeholder="Ansprechpartner suchen…"
                  disabled={loading}
                />
              </div>
            )}
            <div className="col-span-2">
              <label className={labelCls}>Eingangs-Rechnungsnummer</label>
              <input aria-label="Eingangs-Rechnungsnummer" type="text" value={eingangsrechnungsnummer} onChange={e => setEingangsrechnungsnummer(e.target.value)}
                placeholder="Belegnr. lt. Rechnung des Lieferanten"
                className={inputCls + ' w-full'} />
            </div>
          </div>
        </div>

        {/* ── 3. Transportmittel ────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Transportmittel</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Zugmaschine (Kennzeichen)</label>
              <input aria-label="Zugmaschine (Kennzeichen)" type="text" value={zugmaschine} onChange={e => setZugmaschine(e.target.value)}
                placeholder="z.B. W-123AB"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>1. Anhänger</label>
              <input aria-label="1. Anhänger" type="text" value={anhaenger1} onChange={e => setAnhaenger1(e.target.value)}
                placeholder="Kennzeichen"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>2. Anhänger</label>
              <input aria-label="2. Anhänger" type="text" value={anhaenger2} onChange={e => setAnhaenger2(e.target.value)}
                placeholder="Kennzeichen"
                className={inputCls + ' w-full'} />
            </div>
          </div>
          {/* KAN-90: Transportschein-Nr. des Lieferanten – erscheint in Liste, Suche und im Weinbuch der Ziel-Charge */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className={labelCls}>Transportschein-Nr. (TBS) des Lieferanten</label>
              <input aria-label="Transportschein-Nr. des Lieferanten" type="text" value={tbsNummer} onChange={e => setTbsNummer(e.target.value)}
                maxLength={30} placeholder="laufende Nummer lt. Transportbescheinigung" className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Jahr</label>
              <input aria-label="Jahr der Transportschein-Nr." type="text" inputMode="numeric" value={tbsJahr} onChange={e => setTbsJahr(e.target.value)}
                maxLength={4} placeholder="JJJJ" className={inputCls + ' w-full'} />
            </div>
          </div>
        </div>

        {/* ── 4. Ware ───────────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Ware</h2>

          {/* Weinart */}
          <div>
            <label className={labelCls}>Weinart *</label>
            <div className="flex gap-4 mt-1.5">
              {([['weiss','Weißwein','bg-s112-tertiary'],['rot','Rotwein','bg-s112-text'],['rose','Rosé','bg-s112-grey']] as const).map(([val, lbl, dot]) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="weinart" value={val} checked={weinart === val} required
                    onChange={() => setWeinart(val)} className="accent-s112-teal" />
                  <span className={`inline-block w-2.5 h-2.5 rounded-full border border-black/10 ${dot}`} />
                  <span className="text-sm text-s112-text-1">{lbl}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Rebsorte(n) *</label>
              <input aria-label="Rebsorte(n)" type="text" value={rebsorte} onChange={e => setRebsorte(e.target.value)}
                placeholder="z.B. Grüner Veltliner" required
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Jahrgang *</label>
              <input aria-label="Jahrgang" type="number" value={jahrgang} onChange={e => setJahrgang(e.target.value)}
                min="1900" max="2100" placeholder="z.B. 2024"
                required
                className={inputCls + ' w-full'} />
              {istTraubenArt(art) && (
                <p className="text-xs text-s112-muted mt-1">
                  Wichtig für Pressungs-Vorschlag{art === 'trauben' ? ' & Traubenverkauf' : ''} – ohne Jahrgang wird der Zukauf dort nicht angezeigt.
                </p>
              )}
            </div>

            {/* Qualitätsstufe – Pflicht für alle Arten (KAN-80 Nachtrag); Trauben: Stufen der Lese */}
            <div>
              <label className={labelCls}>Qualitätsstufe *</label>
              <select aria-label="Qualitätsstufe" value={qualitaet} onChange={e => setQualitaet(e.target.value)}
                required className={inputCls + ' w-full'}>
                <option value="">– bitte wählen –</option>
                {qualitaetsListe(art).map(q => (
                  <option key={q.value} value={q.value}>{q.label}</option>
                ))}
              </select>
            </div>

            {/* KAN-186: Ursprungsland (EU-Wein, Drittland) */}
            <div>
              <label className={labelCls}>Ursprungsland *</label>
              <LandSelect laender={laender} value={landIso} onChange={setLandIso} className={inputCls + ' w-full'} />
            </div>

            {/* KAN-186: Zusatzbezeichnung (Reserve …) und Erzeugnis (Sekt g.U., Perlwein …) – nicht bei Trauben */}
            {!istTraubenArt(art) && (
              <ZusatzErzeugnisFelder key={art} stufe={qualitaet} feldKlasse={inputCls + ' w-full'} labelKlasse={labelCls} />
            )}

            {/* Herkunfts-Code (BKI) – dieselbe Auswahl wie am GST, samt eigener Weinbaugebiete (KAN-80 Nachtrag) */}
            <div className="col-span-2">
              <label className={labelCls}>Herkunfts-Code (BKI) *</label>
              {eigeneGebiete === null ? (
                <div className={inputCls + ' w-full text-s112-muted'}>Lädt …</div>
              ) : (
                <HerkunftCodeSelect
                  name="herkunft"
                  value={herkunft}
                  onChange={setHerkunft}
                  builtinOptions={HERKUNFT_OPTIONS}
                  customOptions={eigeneGebiete}
                  emptyLabel="– bitte wählen –"
                  className={inputCls + ' w-full'}
                />
              )}
              <p className="text-xs text-s112-muted mt-1">Herkunftsstufe gem. Weingesetz/DAC-Verordnung – geht an die Charge bzw. die Pressung (dort nur Abstufungen). Fehlt ein Gebiet, kann es im Dropdown über „+ Neues Weinbaugebiet hinzufügen…“ ergänzt werden.</p>
            </div>

            {/* Mostgewicht in °KMW oder °Oe – bei Trauben und Traubenmost (KAN-130 Etappe 3);
                bevorzugte Einheit des Betriebs zuerst */}
            {(istTraubenArt(art) || art === 'most') && (
              <div className="col-span-2">
                <MostgewichtEingabe name="mostgewicht" required />
              </div>
            )}

            {/* Alkohol – bei Wein und zugekauften Flaschen */}
            {(art === 'wein' || istFlaschenArt(art)) && (
              <div>
                <label className={labelCls}>Alkoholgehalt (%vol) *</label>
                <input aria-label="Alkoholgehalt (%vol)" type="number" value={alkohol} onChange={e => setAlkohol(e.target.value)}
                  step="0.1" min="0.1" max="25" placeholder="z.B. 12.5" required
                  className={inputCls + ' w-full'} />
              </div>
            )}

            {/* Staatl. Prüfnummer – bei Wein optional (Entscheidung Jörgen 02.10.2026, ersetzt KAN-80 Regel a); bei
                zugekauften Flaschen die Nummer des Erzeugers, ab Qualitätswein Pflicht (KAN-41 Paket 2b, E2) */}
            {(art === 'wein' || istFlaschenArt(art)) && (
              <div>
                {/* KAN-225: Pflicht ab Qualitätswein (DAC, Reserve, Sekt g.U. prüft die Server Action mit), Wein/Landwein ohne */}
                <label className={labelCls}>{pruefnummerLabel(art, qualitaet)}</label>
                <input aria-label="Staatl. Prüfnummer" type="text" value={pruefnummer} onChange={e => setPruefnummer(e.target.value)}
                  placeholder="z.B. 1234/26" required={istFlaschenArt(art) && flaschenPruefnummerPflicht({ qualitaetsstufe: qualitaet || null })}
                  className={inputCls + ' w-full'} />
              </div>
            )}
          </div>

          {/* Anreicherung – bei Trauben und Most */}
          {(istTraubenArt(art) || art === 'most') && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={anreicherung} onChange={e => setAnreicherung(e.target.checked)}
                className="accent-s112-teal w-4 h-4" />
              <span className="text-sm text-s112-text-1">Anreicherung (Zuckerung) erfolgt / geplant</span>
            </label>
          )}
        </div>

        {/* ── 5. Menge & Preis ──────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Menge & Preis</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>{istFlaschenArt(art) ? 'Anzahl Flaschen *' : 'Menge *'}</label>
              <input aria-label="Menge" type="number" value={menge} onChange={e => setMenge(e.target.value)}
                required min={istFlaschenArt(art) ? '1' : '0.001'} step={istFlaschenArt(art) ? '1' : '0.001'} placeholder="0"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Einheit</label>
              <select aria-label="Einheit" value={einheit} onChange={e => setEinheit(e.target.value)}
                disabled={istFlaschenArt(art)} className={inputCls + ' w-full'}>
                <option value="kg">kg</option>
                <option value="L">L</option>
                <option value="t">t</option>
                <option value="Stk">Stk</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Gesamtpreis (€)</label>
              <input aria-label="Gesamtpreis (€)" type="number" value={preisGesamt} onChange={e => setPreisGesamt(e.target.value)}
                step="0.01" min="0" placeholder="0.00"
                className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Preis / {einheit}</label>
              <div className={inputCls + ' w-full bg-s112-bg text-s112-muted cursor-not-allowed text-right tabular-nums'}>
                {preisProEinheit != null
                  ? `€ ${fmtNum(Number(preisProEinheit), { min: 2, max: 4 })}`
                  : '–'}
              </div>
            </div>
            {(art === 'wein' || art === 'most') && (
              <div>
                <label className={labelCls}>Einstandspreis / L (€)</label>
                {einheit === 'L' ? (
                  <>
                    <div className={inputCls + ' w-full bg-s112-bg text-s112-muted cursor-not-allowed text-right tabular-nums'}>
                      {einstandspreisLiter
                        ? `€ ${fmtNum(Number(einstandspreisLiter), { min: 2, max: 4 })}`
                        : '–'}
                    </div>
                    <p className="text-xs text-s112-muted mt-1">Automatisch aus Gesamtpreis ÷ Menge</p>
                  </>
                ) : (
                  <input type="number" value={einstandspreisLiter} onChange={e => setEinstandspreisLiter(e.target.value)}
                    step="0.0001" min="0" placeholder="0.0000"
                    className={inputCls + ' w-full'} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 5b. Weinlager-Artikel (nur zugekaufte Flaschen, KAN-41 Paket 2b) ── */}
        {istFlaschenArt(art) && (
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Ins Weinlager</h2>
            <p className="text-xs text-s112-muted">
              Die Flaschen werden als eigener Weinlager-Artikel (Handelsware) angelegt – Merkmale, Anzahl, Prüfnummer und
              Einstandspreis je Flasche (Gesamtpreis ÷ Anzahl) kommen aus diesem Zukauf. Im Kellerbuch als Zukauf Flaschen (ZK_FLA) gebucht.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="col-span-2">
                <label className={labelCls}>Produktname *</label>
                <input aria-label="Produktname" type="text" value={fuellungName} onChange={e => setFuellungName(e.target.value)}
                  required placeholder="z.B. Grüner Veltliner Kamptal DAC (Weingut X)"
                  className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>Flaschengröße *</label>
                <select aria-label="Flaschengröße" value={flaschengroesse} onChange={e => setFlaschengroesse(e.target.value)}
                  className={inputCls + ' w-full'}>
                  {FLASCHEN_GROESSEN_ML.map(ml => <option key={ml} value={String(ml)}>{fmtNum(ml / 1000, { min: 3, max: 3 })} l</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>VK-Preis brutto (€)</label>
                <input aria-label="VK-Preis brutto (€)" type="number" value={vkPreis} onChange={e => setVkPreis(e.target.value)}
                  step="0.01" min="0" placeholder="0.00"
                  className={inputCls + ' w-full'} />
              </div>
              <div>
                <label className={labelCls}>MwSt. (%)</label>
                <input aria-label="MwSt. (%)" type="number" value={mwst} onChange={e => setMwst(e.target.value)}
                  step="1" min="0" max="30" placeholder="Standard"
                  className={inputCls + ' w-full'} />
              </div>
            </div>
          </div>
        )}

        {/* ── 6. Gebinde (nur Wein / Most) ──────────────────────────────── */}
        {(art === 'wein' || art === 'most') && (
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">In Gebinde füllen</h2>
            <div>
              <label className={labelCls}>Gebinde (optional)</label>
              <select aria-label="Gebinde (optional)" value={zielBehaelter} onChange={e => setZielBehaelter(e.target.value)}
                className={inputCls + ' w-full'} disabled={loading}>
                <option value="">– keines –</option>
                {behaelter.map(b => {
                  // KAN-174 C: „Name · Inhalt – Charge | frei“ statt Kapazität
                  const chargen = weinausbauListe.filter(w => w.behaelter_id === b.id)
                  const inhalt = chargen.reduce((s, w) => s + (w.menge_liter ?? 0), 0)
                  return (
                    <option key={b.id} value={b.id}>
                      {gebindeOption({ name: b.name, inhaltLiter: inhalt, volumenLiter: b.volumen_liter, chargen: chargen.map(w => w.rebsorte ? `${w.name} (${formatRebsorteMitKuerzel(w.rebsorte)})` : w.name) })}
                    </option>
                  )
                })}
              </select>
            </div>

            {/* Detail-Panel für gewähltes Gebinde */}
            {zielBehaelter && (() => {
              const b = behaelter.find(x => x.id === zielBehaelter)
              const vol = b?.volumen_liter ?? null
              const chargen = weinausbauListe.filter(w => w.behaelter_id === zielBehaelter)
              const inhalt = chargen.reduce((s, w) => s + (w.menge_liter ?? 0), 0)
              const mengeNum = parseFloat(menge) || 0
              const restNach = vol != null ? vol - inhalt - mengeNum : null
              const ueber = restNach != null && restNach < -0.01
              return (
                <div className="bg-s112-bg border border-s112-border rounded-xl px-4 py-3 space-y-2 text-xs">
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="text-s112-muted mb-0.5">Kapazität</p>
                      <p className="font-semibold text-s112-text">{vol != null ? fmtNum(vol) + ' L' : '–'}</p>
                    </div>
                    <div>
                      <p className="text-s112-muted mb-0.5">Inhalt jetzt</p>
                      <p className="font-semibold text-s112-text">
                        {fmtNum(inhalt, { max: 1 })} L
                        {chargen.length > 0 && (
                          <span className="ml-1 font-normal text-s112-muted">
                            ({[...new Set(chargen.map(c => c.rebsorte).filter(Boolean))].map(r => formatRebsorteMitKuerzel(r)).join(', ') || '–'})
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-s112-muted mb-0.5">{mengeNum > 0 ? 'Rest nach Zukauf' : 'Restkapazität'}</p>
                      <p className={`font-semibold ${ueber ? 'text-s112-err-fg' : 'text-s112-blue-700'}`}>
                        {vol != null
                          ? fmtNum((mengeNum > 0 ? restNach! : vol - inhalt), { max: 1 }) + ' L'
                          : '–'}
                      </p>
                    </div>
                  </div>
                  {ueber && (
                    <p className="text-s112-err-fg font-semibold flex items-center gap-1.5">
                      <AlertTriangle size={14} /> Behälter hat nicht genug Kapazität
                    </p>
                  )}
                </div>
              )
            })()}

            {hatRebsortenmixZukauf && (
              <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2.5 text-sm text-s112-warn-fg">
                <span className="font-semibold inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Rebsortenverschnitt:</span>{' '}
                Das gewählte Gebinde enthält bereits Chargen mit anderer Rebsorte:{' '}
                <strong>{andereChargenImZiel.map(c => `${c.name} (${formatRebsorteMitKuerzel(c.rebsorte)})`).join(', ')}</strong>.
                Der Zukauf wird beim Speichern sofort als Verschnitt in die Charge im Gebinde gebucht.
              </div>
            )}
          </div>
        )}

        {/* ── 7. Notizen ────────────────────────────────────────────────── */}
        <div className="card p-5">
          <label className={labelCls}>Notizen</label>
          <textarea aria-label="Notizen" value={notizen} onChange={e => setNotizen(e.target.value)}
            rows={3} placeholder="Qualitätsmerkmale, Bedingungen, sonstige Anmerkungen…"
            className={inputCls + ' w-full resize-none'} />
        </div>

        {/* ── Submit ────────────────────────────────────────────────────── */}
        {error && <p role="status" className="text-sm text-s112-err-fg text-right">{error}</p>}
        <div className="flex justify-end gap-3">
          <AbbrechenKnopf standard="/weinhandel/zukauf" className="text-sm text-s112-muted hover:text-s112-text-1 px-4 py-2" />
          <button type="submit" disabled={isPending || !!verschnitt}
            className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50">
            {isPending ? 'Speichern…' : 'Zukauf speichern'}
          </button>
        </div>
      </form>
    </div>
  )
}
