'use client'

import { zielNachVorgang } from '@/lib/navigation/zurueckBrowser'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import { useState, useTransition, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { createVerkauf, createSonstigesArtikel, SonstigesArtikelData, lieferadressenDesKunden } from '../actions'
import LieferadresseWahl, { LIEFER_LEER, lieferFormFelder, type LieferWahl } from './LieferadresseWahl'
import type { Lieferadresse } from '@/lib/crm/lieferadressen'
import { Check } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { LESE_QUALITAETEN, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import { fmtEur, fmtNum, zahlWert } from '@/lib/format'
import PartnerSuche from '@/components/crm/PartnerSuche'
import { fehlerText } from '@/lib/fehler'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import type { GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import {
  OHNE_KUNDENRABATT, rabattFuerNeuePosition, wirksamerRabatt, wirksamerSonderrabatt,
  zeilenBetrag, gesamtBetrag, type KundenKonditionen,
} from '@/lib/verkauf/rabatt'
import { heuteWien } from '@/lib/datum/wien'

// ── Typen ─────────────────────────────────────────────────────────────────────

interface Fuellung {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  flaschengroesse_ml: number | null
  bestand_flaschen: number
  vk_preis_brutto: number | null
}

interface Weinausbau {
  id: string
  name: string
  menge_liter: number | null
}

// Offener Wein (Tank) nur aus Kellerbuch-Chargen (KAN-35, 24.09.2026): Zukauf- und
// Pressungsquellen werden nicht mehr angeboten, „– manuell –“ gibt es bei Tank nicht mehr.

interface Weingarten {
  id: string
  name: string
  lage_name: string | null
  trauben_herkunft_code: string | null
  verfuegbar_kg: number
  kmw_grad: number | null
  /** Mostgewicht der neuesten Lese mit gemessener Einheit (KAN-128) */
  mostgewicht?: GespeichertesMostgewicht | null
  qualitaetsstufe: string | null
  jahrgang_id: string | null
  /** KAN-129: Standard-Lese (neueste mit Menge) und die Werte je Lese */
  lese_id: string | null
  je_lese: LeseWerte[]
}

/** KAN-129: verfügbare kg, Mostgewicht und Stufe eines Orts in einer Lese (api/verkauf-stammdaten) */
interface LeseWerte {
  lese_id: string
  jahrgang_id: string
  verfuegbar_kg: number
  mostgewicht: GespeichertesMostgewicht | null
  qualitaetsstufe: string | null
}

interface LeseOption {
  id: string
  jahrgang_id: string
  jahrgang: number
  titel: string
}

interface Grundstueck {
  id: string
  gst_nr: string
  weingarten_id: string
  rebsorte: string | null
  verfuegbar_kg: number
  kmw_grad: number | null
  /** Mostgewicht der neuesten Lese mit gemessener Einheit (KAN-128) */
  mostgewicht?: GespeichertesMostgewicht | null
  qualitaetsstufe: string | null
  jahrgang_id: string | null
  lese_id: string | null
  je_lese: LeseWerte[]
}

interface Position {
  id:            string
  typ:           'flasche' | 'tank' | 'sonstiges' | 'trauben'
  fuellung_id:   string
  weinausbau_id:         string
  name:                  string
  menge:         string
  einheit:       string
  preis_brutto:  string
  rabatt_pct:    string
  rabatt_aktiv:       boolean
  sonderrabatt:  string
  sonderrabatt_aktiv: boolean
  ust_satz:           string
  // Traubenverkauf BKI-Felder
  trauben_weingarten_id:   string
  trauben_jahrgang_id:     string
  /** KAN-129: Lese der Trauben (bestimmt den Jahrgang und die verfügbare Menge) */
  trauben_lese_id:         string
  trauben_grundstueck_id:  string
  /** Vorbelegung des Mostgewichts (Lese der Ried/GST, KAN-128) – den Messwert hält die Eingabe
   *  selbst (versteckte Felder trauben_<id>_mostgewicht_wert/_einheit, beim Absenden gelesen) */
  trauben_mostgewicht:     GespeichertesMostgewicht | null
  trauben_qualitaetsstufe: string
  trauben_herkunft_code:   string
  trauben_gesundheit:      'G' | 'K'
  /** KAN-115: gewähltes Sonstiges Produkt (mit Lagerstand mindert der Verkauf den Bestand) */
  sonstige_artikel_id?:    string
}

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
  1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
}

const inputCls = 'border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

// ── Kunden-Suche: serverseitig über components/crm/PartnerSuche (17.9.2026) ──

// ── Sonstiges-Artikel-Kombofeld ───────────────────────────────────────────────

function SonstigesKombo({ artikel, name, onNameChange, onArtikelSelect, onSpeichern, disabled }: {
  artikel: SonstigesArtikelData[]
  name: string
  onNameChange: (text: string) => void
  onArtikelSelect: (a: SonstigesArtikelData) => void
  onSpeichern: (name: string) => Promise<void>
  disabled?: boolean
}) {
  const [open, setOpen]     = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [speicherFehler, setSpeicherFehler] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  const treffer = name.length < 1
    ? artikel.slice(0, 20)
    : artikel.filter(a => a.name.toLowerCase().includes(name.toLowerCase())).slice(0, 20)

  const istGespeichert = artikel.some(a => a.name.toLowerCase() === name.toLowerCase())
  const zeigeBtn = name.trim().length >= 2 && !istGespeichert && !open

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <input
        type="text"
        value={name}
        onChange={e => { onNameChange(e.target.value); setOpen(true); setSavedOk(false) }}
        onFocus={() => setOpen(true)}
        placeholder="Bezeichnung eingeben oder auswählen…"
        className={inputCls + ' w-full pr-8'}
        required
        disabled={disabled}
        autoComplete="off"
      />
      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-s112-muted text-xs pointer-events-none">▾</span>
      {open && (
        <div className="absolute z-30 left-0 right-0 mt-1 bg-white border border-s112-border rounded-xl shadow-lg max-h-60 overflow-y-auto">
          {treffer.length > 0 ? treffer.map(a => (
            <button key={a.id} type="button"
              onMouseDown={() => { onArtikelSelect(a); setOpen(false) }}
              className="w-full text-left px-3 py-2 text-sm hover:bg-s112-teal/10 flex items-center justify-between gap-2">
              <span className="font-medium text-s112-text truncate">{a.name}</span>
              <span className="text-xs text-s112-muted shrink-0">
                {a.einheit}{a.default_preis != null ? ` · € ${fmtNum(Number(a.default_preis), 2)}` : ''}
              </span>
            </button>
          )) : (
            <div className="px-3 py-2 text-sm text-s112-muted italic">
              {name.length > 0 ? 'Kein gespeichertes Produkt gefunden' : 'Noch keine Sonstiges-Produkte angelegt'}
            </div>
          )}
        </div>
      )}
      {zeigeBtn && (
        <div className="flex items-center gap-1.5 mt-1">
          {savedOk ? (
            <span className="text-xs text-s112-ok-fg font-medium inline-flex items-center gap-1"><Check size={12} />Als Produkt gespeichert</span>
          ) : (
            <>
              <span className="text-xs text-s112-muted">Neues Produkt —</span>
              <button
                type="button"
                onClick={async () => {
                  setSaving(true)
                  setSpeicherFehler(null)
                  // Fehler anzeigen statt verschlucken (u. a. KAN-30: Betrieb in anderem Tab gewechselt)
                  try { await onSpeichern(name.trim()); setSavedOk(true) } catch (e) { setSpeicherFehler(fehlerText(e)) }
                  setSaving(false)
                }}
                disabled={saving}
                className="text-xs text-s112-blue-700 hover:underline disabled:opacity-50"
              >
                {saving ? 'Wird gespeichert…' : 'Als Produkt speichern'}
              </button>
            </>
          )}
        </div>
      )}
      {speicherFehler && <p role="alert" className="text-xs text-s112-err-fg mt-1">{speicherFehler}</p>}
    </div>
  )
}

// ── Haupt-Komponente ──────────────────────────────────────────────────────────

export default function NeuerVerkaufPage() {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  // Stammdaten vom Server
  const [fuellungen,      setFuellungen]      = useState<Fuellung[]>([])
  const [weinausbau,      setWeinausbau]      = useState<Weinausbau[]>([])
  const [sonstigeArtikel, setSonstigeArtikel] = useState<SonstigesArtikelData[]>([])
  const [weingaerten,     setWeingaerten]     = useState<Weingarten[]>([])
  const [lesen,           setLesen]           = useState<LeseOption[]>([])
  const [grundstuecke,    setGrundstuecke]    = useState<Grundstueck[]>([])
  const [loading,         setLoading]         = useState(true)
  const [ustStandard,     setUstStandard]     = useState(13)

  // Formular-State
  const [datum,           setDatum]           = useState(heuteWien())
  const [kontaktId,       setKontaktId]       = useState('')
  const [firmaId,         setFirmaId]         = useState('')
  // KAN-176: abweichende Lieferadresse (Auswahl aus den Adressen des Kunden oder neu)
  const [liefer, setLiefer] = useState<LieferWahl>(LIEFER_LEER)
  const [lieferAdressen, setLieferAdressen] = useState<(Lieferadresse & { id: string })[]>([])
  const [zhKontaktId,     setZhKontaktId]     = useState('')
  const [notizen,         setNotizen]         = useState('')
  // Konditionen des gewählten Kunden – auch für später hinzugefügte Positionen (KAN-156)
  const [kundenRabatt,    setKundenRabatt]    = useState<KundenKonditionen>(OHNE_KUNDENRABATT)
  const [skontoAktiv,     setSkontoAktiv]     = useState(false)
  // KAN-103: Standard „sofort“ (Ab-Hof-Verkauf in einem Schritt); aus = nur Lieferschein, Rechnung später (auch als Sammelrechnung)
  const [rechnungSofort,  setRechnungSofort]  = useState(true)
  const [skontoPct,       setSkontoPct]       = useState(0)
  const [skontoTage,      setSkontoTage]      = useState(10)

  // Positionen
  const [positionen, setPositionen] = useState<Position[]>([newEmptyPosition()])

  function newEmptyPosition(): Position {
    return {
      id:            crypto.randomUUID(),
      typ:           'flasche',
      fuellung_id:   '',
      weinausbau_id:         '',
      name:                  '',
      menge:         '1',
      einheit:       'Stk',
      preis_brutto:  '',
      rabatt_pct:    '0',
      rabatt_aktiv:       false,
      sonderrabatt:  '0',
      sonderrabatt_aktiv: false,
      ust_satz:           '13',
      trauben_weingarten_id:   '',
      trauben_jahrgang_id:     '',
      trauben_lese_id:         '',
      trauben_grundstueck_id:  '',
      trauben_mostgewicht:     null,
      trauben_qualitaetsstufe: '',
      trauben_herkunft_code:   '',
      trauben_gesundheit:      'G',
    }
  }

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('/api/verkauf-stammdaten')
        if (!res.ok) throw new Error('Laden fehlgeschlagen')
        const json = await res.json()
        setFuellungen(json.fuellungen ?? [])
        setWeinausbau(json.weinausbau ?? [])
        setSonstigeArtikel(json.sonstige_artikel ?? [])
        setWeingaerten(json.weingaerten ?? [])
        setLesen(json.lesen ?? [])
        setGrundstuecke(json.grundstuecke ?? [])
        const ust = json.ust_satz_standard ?? 13
        setUstStandard(ust)
        setPositionen([{ ...newEmptyPosition(), ust_satz: String(ust), rabatt_aktiv: false }])
      } catch {
        // Stammdaten-Fehler: Felder bleiben leer
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  function updatePos(idx: number, patch: Partial<Position>) {
    setPositionen(prev => {
      const next = [...prev]
      next[idx] = { ...next[idx], ...patch }

      if (patch.fuellung_id) {
        const f = fuellungen.find(x => x.id === patch.fuellung_id)
        if (f) {
          const label = [f.name, f.jahrgang, f.flaschengroesse_ml ? FLASCHEN_LABEL[f.flaschengroesse_ml] : null]
            .filter(Boolean).join(' · ')
          next[idx].name         = label
          next[idx].preis_brutto = f.vk_preis_brutto != null ? String(f.vk_preis_brutto) : ''
          next[idx].einheit      = 'Stk'
        }
      }

      if (patch.weinausbau_id) {
        const w = weinausbau.find(x => x.id === patch.weinausbau_id)
        if (w) {
          next[idx].name     = w.name
          next[idx].einheit  = 'L'
        }
      }

      return next
    })
  }

  function addPosition() {
    setPositionen(prev => [...prev, {
      ...newEmptyPosition(),
      ust_satz: String(ustStandard),
      ...rabattFuerNeuePosition(kundenRabatt),
    }])
  }

  function removePosition(idx: number) {
    setPositionen(prev => prev.filter((_, i) => i !== idx))
  }

  const gesamt = gesamtBetrag(positionen)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    // Mostgewicht der Weintrauben-Positionen: Messwert wie eingegeben + Einheit aus den versteckten
    // Feldern der Eingabe – createVerkauf rechnet beide Werte serverseitig (KAN-128)
    const formular = new FormData(e.currentTarget)
    const mgFeld = (p: Position, teil: 'wert' | 'einheit') => {
      const w = formular.get(`trauben_${p.id}_mostgewicht_${teil}`)
      return typeof w === 'string' && w !== '' ? w : null
    }

    const posForServer = positionen.map(p => ({
      typ:           p.typ,
      fuellung_id:   p.fuellung_id   || null,
      weinausbau_id: p.weinausbau_id || null,
      name:          p.name,
      menge:         parseFloat(p.menge) || 0,
      einheit:       p.einheit,
      preis_brutto:  zahlWert(p.preis_brutto),
      rabatt_pct:       wirksamerRabatt(p),
      sonderrabatt_pct: wirksamerSonderrabatt(p),
      ust_satz:         (zahlWert(p.ust_satz) ?? ustStandard),
      trauben_weingarten_id:   p.trauben_weingarten_id   || null,
      trauben_jahrgang_id:     p.trauben_jahrgang_id     || null,
      trauben_lese_id:         p.typ === 'trauben' ? (p.trauben_lese_id || null) : null,
      trauben_grundstueck_id:  p.trauben_grundstueck_id  || null,
      trauben_mostgewicht_wert:    p.typ === 'trauben' ? mgFeld(p, 'wert') : null,
      trauben_mostgewicht_einheit: p.typ === 'trauben' ? mgFeld(p, 'einheit') : null,
      trauben_qualitaetsstufe: p.trauben_qualitaetsstufe || null,
      trauben_herkunft_code:   p.trauben_herkunft_code   || null,
      trauben_gesundheit:      p.trauben_gesundheit       || 'G',
      sonstige_artikel_id:     p.typ === 'sonstiges' ? (p.sonstige_artikel_id || null) : null,
    }))

    if (!kontaktId && !firmaId) {
      setError('Bitte einen Kunden auswählen.')
      return
    }
    if (posForServer.some(p => !p.name || p.menge <= 0)) {
      setError('Alle Positionen benötigen einen Namen und eine Menge > 0.')
      return
    }
    if (posForServer.some(p => p.typ === 'tank' && !p.weinausbau_id)) {
      setError('Bitte für jede Tank-Position eine Kellerbuch-Charge auswählen – offener Wein wird nur aus Chargen verkauft.')
      return
    }
    if (posForServer.some(p => p.typ === 'trauben' && !p.trauben_weingarten_id)) {
      setError('Bitte Weingarten für alle Trauben-Positionen auswählen.')
      return
    }

    const formData = new FormData()
    formData.set('datum',            datum)
    formData.set('kontakt_id',       kontaktId)
    formData.set('firma_id',         firmaId)
    formData.set('zh_kontakt_id',    zhKontaktId)
    formData.set('notizen',          notizen)
    formData.set('skonto_pct',       String(skontoAktiv ? skontoPct : 0))
    formData.set('skonto_tage',      String(skontoAktiv ? skontoTage : 0))
    formData.set('skonto_aktiv',     skontoAktiv ? 'true' : 'false')
    formData.set('rechnung_sofort',  rechnungSofort ? 'true' : 'false')   // KAN-103
    formData.set('positionen_json',  JSON.stringify(posForServer))
    for (const [k, v] of Object.entries(lieferFormFelder(liefer, lieferAdressen))) formData.set(k, v)   // KAN-176

    startTransition(async () => {
      try {
        await createVerkauf(formData)
        router.push(zielNachVorgang('/weinhandel/verkauf', 'verkauf'))   // KAN-224: zurück, woher man kam
        router.refresh()
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Speichern'))
      }
    })
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700">Verkauf</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Neuer Verkauf</span>
      </nav>

      <h1 className="text-xl font-semibold text-s112-text">Neuer Verkauf</h1>

      {error && (
        <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-4 py-3 rounded-lg text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">

        {/* Kopfdaten */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm">Belegdaten</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Datum *</label>
              <input aria-label="Datum" type="date" value={datum} onChange={e => setDatum(e.target.value)}
                required className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Rechnungsnummer</label>
              <input aria-label="Rechnungsnummer" type="text" value="" readOnly disabled
                placeholder="Wird automatisch vergeben"
                className={inputCls + ' w-full bg-s112-bg text-s112-muted cursor-not-allowed'} />
              <p className="text-xs text-s112-muted mt-1">Vergibt das System beim Speichern (lückenloser Nummernkreis)</p>
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Kunde *</label>
              {/* Serverseitige Suche (17.9.2026): Kontakte + Firmen mit Häkchen
                  "Kunde" (Feedback 12.8.2026), Konditionen kommen mit dem Treffer. */}
              <PartnerSuche
                art="kunde"
                value={kontaktId ? `kontakt:${kontaktId}` : firmaId ? `firma:${firmaId}` : ''}
                onChange={(val, treffer) => {
                  setZhKontaktId('')
                  setLiefer(LIEFER_LEER)
                  setLieferAdressen([])
                  if (!val) {
                    setKontaktId('')
                    setFirmaId('')
                    setKundenRabatt(OHNE_KUNDENRABATT)
                    setSkontoAktiv(false)
                    setSkontoPct(0)
                    setSkontoTage(10)
                    return
                  }
                  const trennerIdx = val.indexOf(':')
                  const typ = val.slice(0, trennerIdx)
                  const id  = val.slice(trennerIdx + 1)
                  if (typ === 'kontakt') { setKontaktId(id); setFirmaId('') }
                  else                   { setFirmaId(id);   setKontaktId('') }
                  // KAN-176: gespeicherte Lieferadressen des Kunden laden
                  lieferadressenDesKunden(typ === 'kontakt' ? id : null, typ === 'firma' ? id : null)
                    .then(l => setLieferAdressen(l)).catch(() => setLieferAdressen([]))
                  const d = treffer?.daten
                  const konditionen: KundenKonditionen = {
                    rabatt_pct:       d?.rabatt_pct ?? 0,
                    sonderrabatt_pct: d?.sonderrabatt_pct ?? 0,
                  }
                  const skPct = d?.skonto_pct ?? 0, skTage = d?.skonto_tage ?? 10
                  setKundenRabatt(konditionen)
                  setSkontoAktiv(skPct > 0)
                  setSkontoPct(skPct)
                  setSkontoTage(skTage)
                  const rabattFelder = rabattFuerNeuePosition(konditionen)
                  setPositionen(prev => prev.map(p => ({ ...p, ...rabattFelder })))
                }}
                placeholder="Name oder Firma suchen…"
                disabled={loading}
              />
              <p className="text-xs text-s112-muted mt-1">Bei Firmen kann zusätzlich ein Ansprechpartner (z.H.) angegeben werden.</p>
            </div>
            {firmaId && (
              <div className="sm:col-span-2">
                <label className={labelCls}>z.H. (zu Händen) — optional</label>
                <PartnerSuche
                  key={firmaId}
                  art="kontakt"
                  firmaId={firmaId}
                  value={zhKontaktId}
                  onChange={id => setZhKontaktId(id)}
                  placeholder="Ansprechpartner suchen…"
                  disabled={loading}
                />
                <p className="text-xs text-s112-muted mt-1">Erscheint auf Rechnung/Lieferschein als „z.H. Vorname Nachname“</p>
              </div>
            )}
            {(kontaktId || firmaId) && (
              <div className="sm:col-span-2">
                <LieferadresseWahl adressen={lieferAdressen} wert={liefer} onChange={setLiefer} disabled={loading} />
              </div>
            )}
            <div className="sm:col-span-2">
              <label className={labelCls}>Notizen</label>
              <input aria-label="Notizen" type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
                placeholder="Interne Notizen zum Vorgang"
                className={inputCls + ' w-full'} />
            </div>

            {/* Skonto */}
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={skontoAktiv}
                  onChange={e => setSkontoAktiv(e.target.checked)}
                  className="rounded-sm accent-s112-teal" />
                <span className="text-sm font-medium text-s112-text-1">Skonto gewähren</span>
              </label>
              {skontoAktiv && (
                <div className="flex flex-wrap gap-3 mt-2">
                  <div className="flex items-center gap-1.5">
                    <input type="number" inputMode="decimal" value={skontoPct}
                      onChange={e => setSkontoPct(parseFloat(e.target.value) || 0)}
                      min="0" max="20" step="0.5" placeholder="2"
                      className={inputCls + ' w-20'} />
                    <span className="text-sm text-s112-text-2">%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-s112-text-2">bei Zahlung innerhalb von</span>
                    <input type="number" inputMode="numeric" value={skontoTage}
                      onChange={e => setSkontoTage(parseInt(e.target.value) || 0)}
                      min="1" max="60" step="1" placeholder="10"
                      className={inputCls + ' w-20'} />
                    <span className="text-sm text-s112-text-2">Tagen</span>
                  </div>
                  <p className="text-xs text-s112-muted self-end">
                    → {fmtEur(((gesamt * skontoPct) / 100))} Skonto-Betrag
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Positionen */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm">Produkte</h2>

          {positionen.map((pos, idx) => (
            <div key={pos.id} className="border border-s112-border rounded-lg p-4 space-y-3 relative">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-s112-text-2">Produkt {idx + 1}</span>
                {positionen.length > 1 && (
                  <button type="button" onClick={() => removePosition(idx)}
                    className="text-xs text-s112-err hover:text-s112-err-fg max-sm:py-1.5 max-sm:px-2">
                    × entfernen
                  </button>
                )}
              </div>

              {/* Typ */}
              <div className="flex gap-3 flex-wrap">
                {(['flasche', 'tank', 'sonstiges', 'trauben'] as const).map(t => (
                  <label key={t} className="flex items-center gap-1.5 cursor-pointer max-sm:py-1.5">
                    <input type="radio" name={`typ-${pos.id}`} value={t}
                      checked={pos.typ === t}
                      onChange={() => updatePos(idx, {
                        typ: t,
                        fuellung_id: '',
                        weinausbau_id: '',
                        name: '',
                        einheit: t === 'tank' ? 'L' : t === 'trauben' ? 'kg' : 'Stk',
                        ust_satz: t === 'trauben' ? '13' : pos.ust_satz,
                      })}
                      className="accent-s112-teal"
                    />
                    <span className="text-xs text-s112-text-2">
                      {t === 'flasche' ? 'Flasche' : t === 'tank' ? 'Tank / Liter' : t === 'trauben' ? 'Weintrauben (kg)' : 'Sonstiges'}
                    </span>
                  </label>
                ))}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">

                {/* Produkt-Auswahl je nach Typ */}
                {pos.typ === 'flasche' && (
                  <div className="col-span-2">
                    <label className={labelCls}>Füllung (Lager)</label>
                    <select aria-label="Füllung (Lager)" value={pos.fuellung_id}
                      onChange={e => updatePos(idx, { fuellung_id: e.target.value })}
                      className={inputCls + ' w-full'} disabled={loading}>
                      <option value="">– manuell –</option>
                      {fuellungen.map(f => (
                        <option key={f.id} value={f.id}>
                          {f.name}{f.jahrgang ? ` (${f.jahrgang})` : ''}
                          {f.flaschengroesse_ml ? ` · ${FLASCHEN_LABEL[f.flaschengroesse_ml] ?? f.flaschengroesse_ml + 'ml'}` : ''}
                          {' '}· Bestand: {f.bestand_flaschen}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {pos.typ === 'tank' && (
                  <div className="col-span-2">
                    <label className={labelCls}>Kellerbuch-Charge *</label>
                    <select aria-label="Kellerbuch-Charge"
                      value={pos.weinausbau_id}
                      onChange={e => updatePos(idx, { weinausbau_id: e.target.value })}
                      required
                      className={inputCls + ' w-full'} disabled={loading}>
                      <option value="">– Charge wählen –</option>
                      {weinausbau.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name}{w.menge_liter != null ? ` · ${fmtNum(Number(w.menge_liter))} L` : ''}
                        </option>
                      ))}
                    </select>
                    {!loading && weinausbau.length === 0 ? (
                      <p className="text-xs text-s112-warn-fg mt-1">
                        Keine Kellerbuch-Charge mit Bestand vorhanden. Zukäufe bitte zuerst über „Zukauf bearbeiten“ einem Gebinde zuordnen.
                      </p>
                    ) : (
                      <p className="text-xs text-s112-muted mt-1">
                        Offener Wein wird nur aus Kellerbuch-Chargen verkauft. Zukäufe ohne Gebinde zuerst über „Zukauf bearbeiten“ einem Gebinde zuordnen.
                      </p>
                    )}
                  </div>
                )}

                {/* Trauben-Felder */}
                {pos.typ === 'trauben' && (
                  <div className="col-span-2 sm:col-span-4 grid grid-cols-2 sm:grid-cols-3 gap-3 mb-1 p-3 bg-s112-ok-bg rounded-lg border border-s112-ok/30">
                    <div>
                      <label className={labelCls}>Ried *</label>
                      <select aria-label="Ried" value={pos.trauben_weingarten_id}
                        onChange={e => {
                          const wg = weingaerten.find(w => w.id === e.target.value)
                          updatePos(idx, {
                            trauben_weingarten_id: e.target.value,
                            trauben_grundstueck_id: '',
                            trauben_herkunft_code: wg?.trauben_herkunft_code ?? '',
                            name: wg ? `Weintrauben – ${wg.lage_name ?? wg.name}` : '',
                            trauben_mostgewicht:     wg?.mostgewicht ?? (wg?.kmw_grad != null ? { kmw: wg.kmw_grad } : null),
                            trauben_qualitaetsstufe: wg?.qualitaetsstufe ?? '',
                            trauben_jahrgang_id:     wg?.jahrgang_id ?? '',
                            trauben_lese_id:         wg?.lese_id ?? '',
                          })
                        }}
                        className={inputCls + ' w-full'} disabled={loading}>
                        <option value="">– bitte wählen –</option>
                        {weingaerten.map(wg => (
                          <option key={wg.id} value={wg.id}>
                            {wg.lage_name ?? wg.name}
                            {wg.verfuegbar_kg > 0 ? ` – ${fmtNum(wg.verfuegbar_kg)} kg verf.` : ' – 0 kg verf.'}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Grundstück</label>
                      <select aria-label="Grundstück" value={pos.trauben_grundstueck_id}
                        onChange={e => {
                          const gst = grundstuecke.find(g => g.id === e.target.value)
                          updatePos(idx, {
                            trauben_grundstueck_id: e.target.value,
                            ...(gst?.mostgewicht || gst?.kmw_grad != null
                              ? { trauben_mostgewicht: gst.mostgewicht ?? { kmw: gst.kmw_grad } }
                              : {}),
                            ...(gst?.qualitaetsstufe != null ? { trauben_qualitaetsstufe: gst.qualitaetsstufe } : {}),
                            // KAN-129: Werte der gewählten Lese an diesem GST (sonst seine Standard-Lese)
                            ...(() => {
                              const w = gst?.je_lese.find(x => x.lese_id === pos.trauben_lese_id && x.verfuegbar_kg > 0)
                                ?? gst?.je_lese.find(x => x.lese_id === gst.lese_id)
                              return w ? {
                                trauben_lese_id: w.lese_id, trauben_jahrgang_id: w.jahrgang_id,
                                ...(w.mostgewicht ? { trauben_mostgewicht: w.mostgewicht } : {}),
                                ...(w.qualitaetsstufe ? { trauben_qualitaetsstufe: w.qualitaetsstufe } : {}),
                              } : {}
                            })(),
                          })
                        }}
                        className={inputCls + ' w-full'} disabled={loading || !pos.trauben_weingarten_id}>
                        <option value="">– gesamte Ried –</option>
                        {grundstuecke
                          .filter(g => g.weingarten_id === pos.trauben_weingarten_id && (g.je_lese.find(x => x.lese_id === pos.trauben_lese_id)?.verfuegbar_kg ?? 0) > 0)
                          .map(g => (
                            <option key={g.id} value={g.id}>
                              GST {g.gst_nr}{g.rebsorte ? ` – ${formatRebsorteMitKuerzel(g.rebsorte)}` : ''} · {fmtNum(g.je_lese.find(x => x.lese_id === pos.trauben_lese_id)?.verfuegbar_kg ?? 0)} kg verf.
                            </option>
                          ))}
                      </select>
                    </div>
                    <div>
                      {/* KAN-129: Lese statt Jahrgang – der Jahrgang folgt aus der Lese, die Menge je Lese */}
                      <label className={labelCls}>Lese</label>
                      <select aria-label="Lese" value={pos.trauben_lese_id}
                        onChange={e => {
                          const lese = lesen.find(l => l.id === e.target.value)
                          const wg = weingaerten.find(w => w.id === pos.trauben_weingarten_id)
                          const w = wg?.je_lese.find(x => x.lese_id === e.target.value)
                          updatePos(idx, {
                            trauben_lese_id: e.target.value,
                            trauben_jahrgang_id: lese?.jahrgang_id ?? '',
                            trauben_grundstueck_id: '',
                            ...(w?.mostgewicht ? { trauben_mostgewicht: w.mostgewicht } : {}),
                            ...(w?.qualitaetsstufe ? { trauben_qualitaetsstufe: w.qualitaetsstufe } : {}),
                          })
                        }}
                        className={inputCls + ' w-full'} disabled={loading || !pos.trauben_weingarten_id}>
                        <option value="">–</option>
                        {(weingaerten.find(w => w.id === pos.trauben_weingarten_id)?.je_lese ?? []).map(x => (
                          <option key={x.lese_id} value={x.lese_id}>
                            {lesen.find(l => l.id === x.lese_id)?.titel ?? '–'} · {fmtNum(x.verfuegbar_kg)} kg verf.
                          </option>
                        ))}
                      </select>
                    </div>
                    {/* Mostgewicht in °KMW oder °Oe (KAN-128) – bevorzugte Einheit zuerst */}
                    <div className="col-span-2 sm:col-span-3">
                      <MostgewichtEingabe name={`trauben_${pos.id}_mostgewicht`} startwert={pos.trauben_mostgewicht} />
                    </div>
                    <div>
                      <label className={labelCls}>Qualitätsstufe</label>
                      <select aria-label="Qualitätsstufe" value={pos.trauben_qualitaetsstufe}
                        onChange={e => updatePos(idx, { trauben_qualitaetsstufe: e.target.value })}
                        className={inputCls + ' w-full'}>
                        <option value="">–</option>
                        {/* KAN-73: Trauben-Qualität = Stufen der Lese („Wein“ statt des früheren
                            Werts, Strohwein vorerst nicht – wie bei der Lese, Entscheidung nach KAN-38) */}
                        {mitGespeichertemWert(LESE_QUALITAETEN, pos.trauben_qualitaetsstufe).map(q => (
                          <option key={q.value} value={q.value}>{q.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelCls}>Gesundheit</label>
                      <select aria-label="Gesundheit" value={pos.trauben_gesundheit}
                        onChange={e => updatePos(idx, { trauben_gesundheit: e.target.value as 'G' | 'K' })}
                        className={inputCls + ' w-full'}>
                        <option value="G">G – Gesund</option>
                        <option value="K">K – Krank</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Bezeichnung */}
                <div className="col-span-2">
                  <label className={labelCls}>Bezeichnung *</label>
                  {pos.typ === 'sonstiges' ? (
                    <SonstigesKombo
                      artikel={sonstigeArtikel}
                      name={pos.name}
                      onNameChange={text => updatePos(idx, { name: text, sonstige_artikel_id: '' })}
                      onArtikelSelect={a => updatePos(idx, {
                        sonstige_artikel_id: a.id,
                        name: a.name,
                        einheit: a.einheit,
                        preis_brutto: a.default_preis != null ? String(a.default_preis) : '',
                      })}
                      onSpeichern={async (name) => {
                        const defaultPreis = zahlWert(pos.preis_brutto)
                        const neu = await createSonstigesArtikel(name, pos.einheit, defaultPreis)
                        if (neu) setSonstigeArtikel(prev => [...prev, neu])
                      }}
                      disabled={loading}
                    />
                  ) : pos.typ === 'trauben' ? (
                    <input type="text" value={pos.name}
                      onChange={e => updatePos(idx, { name: e.target.value })}
                      placeholder="Auto-befüllt aus Weingarten"
                      className={inputCls + ' w-full bg-s112-bg'} />
                  ) : (
                    <input type="text" value={pos.name}
                      onChange={e => updatePos(idx, { name: e.target.value })}
                      required placeholder="Produktbezeichnung"
                      className={inputCls + ' w-full'} />
                  )}
                </div>

                {/* Menge */}
                <div>
                  <label className={labelCls}>Menge *</label>
                  <input aria-label="Menge" type="number"
                    inputMode={pos.typ === 'flasche' ? 'numeric' : 'decimal'} value={pos.menge}
                    onChange={e => updatePos(idx, { menge: e.target.value })}
                    required
                    min={pos.typ === 'tank' || pos.typ === 'trauben' ? 0.01 : 1}
                    step={pos.typ === 'tank' || pos.typ === 'trauben' ? '0.01' : '1'}
                    className={inputCls + ' w-full'} />
                </div>

                {/* Einheit */}
                <div>
                  <label className={labelCls}>Einheit</label>
                  {pos.typ === 'trauben' ? (
                    <div className={inputCls + ' w-full bg-s112-bg text-s112-text-2'}>kg</div>
                  ) : (
                    <select value={pos.einheit}
                      onChange={e => updatePos(idx, { einheit: e.target.value })}
                      className={inputCls + ' w-full'}>
                      <option>Stk</option>
                      <option>L</option>
                      <option>Karton</option>
                      <option>Flasche</option>
                      <option>Pauschal</option>
                    </select>
                  )}
                </div>

                {/* Preis */}
                <div>
                  <label className={labelCls}>Preis/Einheit (€, brutto)</label>
                  <input aria-label="Preis/Einheit (€, brutto)" type="number" inputMode="decimal" value={pos.preis_brutto}
                    onChange={e => updatePos(idx, { preis_brutto: e.target.value })}
                    step="0.01" min={0} placeholder="0,00"
                    className={inputCls + ' w-full'} />
                </div>

                {/* Zeilen-Summe */}
                <div className="flex items-end">
                  <div className="text-right w-full">
                    <p className="text-xs text-s112-muted mb-1">Zeile</p>
                    <p className="font-semibold text-s112-blue-700 tabular-nums text-sm">
                      {/* beachtet abgewählten Kundenrabatt wie Gesamtsumme und Speichern (KAN-156) */}
                      {fmtEur(zeilenBetrag(pos))}
                    </p>
                  </div>
                </div>
              </div>

              {/* Rabatt-Zeile */}
              <div className="flex items-center gap-4 mt-2 flex-wrap">
                {parseFloat(pos.rabatt_pct) > 0 && (
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer select-none max-sm:py-1.5">
                    <input type="checkbox" checked={pos.rabatt_aktiv}
                      onChange={e => updatePos(idx, { rabatt_aktiv: e.target.checked })}
                      className="rounded-sm accent-s112-teal" />
                    <span className={pos.rabatt_aktiv ? 'text-s112-ok-fg font-medium' : 'text-s112-tertiary line-through'}>
                      {pos.rabatt_pct}% Kundenrabatt
                    </span>
                  </label>
                )}
                <label className="flex items-center gap-1.5 text-xs text-s112-text-2 cursor-pointer select-none max-sm:py-1.5">
                  <input type="checkbox" checked={pos.sonderrabatt_aktiv}
                    onChange={e => updatePos(idx, { sonderrabatt_aktiv: e.target.checked })}
                    className="rounded-sm accent-s112-teal" />
                  Sonderrabatt
                </label>
                {pos.sonderrabatt_aktiv && (
                  <div className="flex items-center gap-1.5">
                    <input type="number" inputMode="decimal" value={pos.sonderrabatt}
                      onChange={e => updatePos(idx, { sonderrabatt: e.target.value })}
                        min="0" max="100" step="0.1" placeholder="0"
                      className="w-20 border border-s112-border rounded-sm px-2 py-2 sm:py-1 text-base sm:text-xsfocus:outline-none focus:ring-1 focus:ring-s112-teal/40" />
                    <span className="text-xs text-s112-text-2">%</span>
                  </div>
                )}
                {/* USt-Satz */}
                <div className="flex items-center gap-1.5 text-xs text-s112-text-2 ml-auto">
                  <span>USt:</span>
                  <select value={pos.ust_satz}
                    onChange={e => updatePos(idx, { ust_satz: e.target.value })}
                    className="border border-s112-border rounded-sm px-1.5 py-2 sm:py-0.5 text-base sm:text-xsfocus:outline-none focus:ring-1 focus:ring-s112-teal/40">
                    <option value="0">0 %</option>
                    <option value="10">10 %</option>
                    <option value="13">13 %</option>
                    <option value="20">20 %</option>
                  </select>
                </div>
              </div>

              {/* Preis-Vorschau */}
              {pos.preis_brutto !== '' && (
                <div className="text-xs text-s112-muted text-right mt-1">
                  {(() => {
                    const total = zeilenBetrag(pos)
                    return total > 0 ? `Gesamt: ${fmtEur(total)}` : null
                  })()}
                </div>
              )}
            </div>
          ))}

          <button type="button" onClick={addPosition}
            className="w-full border-2 border-dashed border-s112-border rounded-xl py-3 text-sm text-s112-muted hover:border-s112-teal hover:text-s112-blue-700 transition-colors">
            + Produkt hinzufügen
          </button>
        </div>

        {/* ── Notizen ── */}
        <div className="card p-5">
          <label className={labelCls}>Notizen</label>
          <textarea aria-label="Notizen" value={notizen} onChange={e => setNotizen(e.target.value)}
            rows={3} placeholder="Anmerkungen zur Bestellung…"
            className={inputCls + ' w-full resize-none'} />
        </div>

        {/* ── KAN-103: Rechnung sofort oder später ── */}
        <div className="card p-5">
          <label className="flex items-start gap-2 text-sm text-s112-text">
            <input type="checkbox" checked={rechnungSofort} onChange={e => setRechnungSofort(e.target.checked)} className="mt-0.5" />
            <span>
              <span className="font-medium">Rechnung sofort erstellen</span>
              <span className="block text-xs text-s112-muted">
                {rechnungSofort
                  ? 'Lieferschein und Rechnung in einem Schritt (Ab-Hof-Verkauf, Kartenzahlung).'
                  : 'Nur Lieferschein – die Rechnung erstellst du später auf dem Lieferschein (Preise sind dann noch änderbar).'}
              </span>
            </span>
          </label>
        </div>

        {/* ── Submit ── */}
        <div className="flex justify-end gap-3 pb-8 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:px-4 max-sm:py-3 max-sm:pb-3 max-sm:bg-s112-bg max-sm:border-t max-sm:border-s112-line max-sm:z-10">
          {/* Gesamtsumme nur am Handy in der Leiste (KAN-181) */}
          <span className="sm:hidden mr-auto self-center font-semibold tabular-nums">{fmtEur(gesamt)}</span>
          <AbbrechenKnopf standard="/weinhandel/verkauf" className="text-sm text-s112-muted hover:text-s112-text-1 px-4 py-3 sm:py-2" />
          <button type="submit" disabled={isPending}
            className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-6 py-3 sm:py-2 rounded-xl text-base sm:text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50">
            {isPending ? 'Speichern…' : rechnungSofort ? 'Verkauf anlegen' : 'Lieferschein anlegen'}
          </button>
        </div>

      </form>
    </div>
  )
}
