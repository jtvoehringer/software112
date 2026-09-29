'use client'

import { useState, useTransition, useEffect } from 'react'
import Link from '@/components/ui/Link'
import { updateZukauf } from '../../actions'
import { QUALITAET_OPTS, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import { AlertTriangle } from 'lucide-react'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'

interface Behaelter { id: string; name: string; typ: string; volumen_liter: number | null }

interface InitialValues {
  datum:                    string
  art:                      string
  lieferant_kontakt_id:     string
  lieferant_firma_id:       string
  eingangsrechnungsnummer: string
  menge:                    string
  einheit:                  string
  preis_gesamt:             string
  einstandspreis_pro_liter: string
  rebsorte:                 string
  jahrgang:                 string
  ziel_behaelter_id:        string
  // ID der bereits bestehenden weinausbau-Charge dieses Zukauf-Postens (falls
  // vorhanden). Wird bei der Kapazitätsprüfung von "Inhalt jetzt" ausgenommen,
  // da sie beim Speichern ohnehin ersetzt wird (siehe updateZukauf) und sonst
  // die neue Menge fälschlich doppelt gezählt würde.
  ziel_weinausbau_id:       string
  notizen:                  string
  weinart:                  string
  // Transportschein-Felder
  lieferung_uhrzeit:        string
  transport_zugmaschine:    string
  transport_anhaenger1:     string
  transport_anhaenger2:     string
  herkunft:                 string
  anreicherung:             boolean
  kmw:                      string
  alkohol_pct:              string
  qualitaetsstufe:          string
  staatliche_pruefnummer:   string
}

const inputCls = 'border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 bg-white'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

// Qualitätsstufe eines Wein-/Most-Zukaufs: zentrale Chargen-Liste QUALITAET_OPTS wie beim
// Anlegen (KAN-73); ein gespeicherter Wert außerhalb der Liste bleibt sichtbar

const ART_OPTIONS: { value: 'wein' | 'most' | 'trauben'; label: string }[] = [
  { value: 'wein',    label: 'Wein' },
  { value: 'most',    label: 'Traubenmost' },
  { value: 'trauben', label: 'Trauben' },
]

export default function ZukaufEditForm({
  id,
  initial,
  hatBewegungen,
  sperrHinweis,
  traubenGebunden,
  eigeneAktuelleMenge,
  lieferantName,
}: {
  id: string
  initial: InitialValues
  // Hängen an der verknüpften Kellerbuch-Charge (initial.ziel_weinausbau_id)
  // bereits Folgebuchungen (Umzug, Schwund, Verschnitt, Füllung, Tankverkauf,
  // Behandlung, Analyse, DAC)? Dann sind Menge, Einheit, Gebinde und Art gesperrt
  // (KAN-35, updateZukauf prüft serverseitig ebenso) - bestimmt außerdem, wie
  // die Gebinde-Vorschau unten die eigene Charge simuliert.
  hatBewegungen: boolean
  // „An der Charge hängen bereits …“ (nur bei hatBewegungen)
  sperrHinweis: string | null
  // Aus diesem Zukauf bereits verpresste + verkaufte Trauben (kg) und als Text –
  // die Menge darf nicht darunter sinken, die Art nicht mehr wechseln.
  traubenGebunden: { kg: number; text: string }
  // Aktueller (live) Bestand der verknüpften Kellerbuch-Charge in Liter, wie er
  // JETZT in der DB steht - unabhängig vom unveränderlichen initial.menge.
  eigeneAktuelleMenge: number
  lieferantName: string
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError]            = useState<string | null>(null)
  const [behaelter, setBehaelter]    = useState<Behaelter[]>([])
  const [weinausbauListe, setWeinausbauListe] = useState<{ id: string; name: string; behaelter_id: string | null; rebsorte: string | null; menge_liter: number | null }[]>([])

  const [eingangsrechnungsnummer, setEingangsrechnungsnummer] = useState(initial.eingangsrechnungsnummer)
  const [datum,               setDatum]             = useState(initial.datum)
  const [uhrzeit,             setUhrzeit]           = useState(initial.lieferung_uhrzeit)
  const [art,                 setArt]               = useState<'wein' | 'trauben' | 'most'>(initial.art as any)
  const [weinart,             setWeinart]           = useState<'weiss' | 'rot' | 'rose' | 'unbekannt'>((initial.weinart as any) || 'unbekannt')
  const [rebsorte,            setRebsorte]          = useState(initial.rebsorte)
  const [qualitaet,           setQualitaet]         = useState(initial.qualitaetsstufe)
  const [jahrgang,            setJahrgang]          = useState(initial.jahrgang)
  const [herkunft,            setHerkunft]          = useState(initial.herkunft)
  const [anreicherung,        setAnreicherung]      = useState(initial.anreicherung)
  const [kmw,                 setKmw]               = useState(initial.kmw)
  const [alkohol,             setAlkohol]           = useState(initial.alkohol_pct)
  const [pruefnummer,         setPruefnummer]       = useState(initial.staatliche_pruefnummer)
  const [zugmaschine,         setZugmaschine]       = useState(initial.transport_zugmaschine)
  const [anhaenger1,          setAnhaenger1]        = useState(initial.transport_anhaenger1)
  const [anhaenger2,          setAnhaenger2]        = useState(initial.transport_anhaenger2)
  const [menge,               setMenge]             = useState(initial.menge)
  const [einheit,             setEinheit]           = useState(initial.einheit)
  const [preisGesamt,         setPreisGesamt]       = useState(initial.preis_gesamt)
  const [einstandspreisLiter, setEinstandspreisLiter] = useState(initial.einstandspreis_pro_liter)
  const [zielBehaelter,       setZielBehaelter]     = useState(initial.ziel_behaelter_id)
  const [notizen,             setNotizen]           = useState(initial.notizen)

  // Die eigene, bereits bestehende weinausbau-Charge dieses Zukauf-Postens
  // (falls vorhanden) wird aus der allgemeinen "andere Chargen in diesem
  // Gebinde"-Liste ausgenommen und stattdessen separat simuliert (siehe
  // eigeneSimulierteMenge unten) - sonst würde sie doppelt gezählt.
  const eigenWeinausbauId = initial.ziel_weinausbau_id || null
  // Ursprüngliche Zukaufsmenge (unveränderliche zukauf_posten.menge beim Laden
  // der Seite) - Basiswert für die Differenzrechnung, falls die Charge bereits
  // bewegt wurde (siehe unten).
  const alteZukaufMenge = parseFloat(initial.menge) || 0

  // KAN-35: Sperren (serverseitig in updateZukauf ebenso geprüft)
  //  - Folgebuchungen an der Charge: Menge, Einheit und Gebinde fix, Art bleibt Wein/Most
  //  - Trauben bereits verpresst/verkauft: Art fix, Menge nicht unter die gebundene Menge
  const mengeGesperrt = hatBewegungen
  const traubenArtGesperrt = initial.art === 'trauben' && traubenGebunden.kg > 0
  function artGesperrt(value: 'wein' | 'most' | 'trauben'): boolean {
    if (hatBewegungen && value === 'trauben') return true
    if (traubenArtGesperrt && value !== 'trauben') return true
    return false
  }

  // Simuliert den Bestand der EIGENEN Kellerbuch-Charge NACH dem Speichern
  // dieses Formulars, abhängig davon, wie updateZukauf sie behandeln wird:
  //  - Noch nie einem Gebinde zugeordnet (kein eigenWeinausbauId) oder ein
  //    anderes Gebinde gewählt (noch ohne Folgebuchungen): die Charge entsteht
  //    beim Speichern frisch mit der vollen Belegmenge.
  //  - Zugeordnet, noch ohne Folgebuchungen, Gebinde unverändert: updateZukauf
  //    verrechnet die DIFFERENZ zur bisherigen Zukaufsmenge auf den aktuellen
  //    Bestand der Charge.
  //  - Folgebuchungen vorhanden: Menge gesperrt, der aktuelle Bestand bleibt.
  function eigeneSimulierteMenge(neueMenge: number): number {
    if (!eigenWeinausbauId) return neueMenge
    if (hatBewegungen) return eigeneAktuelleMenge
    if (zielBehaelter === initial.ziel_behaelter_id) return eigeneAktuelleMenge + (neueMenge - alteZukaufMenge)
    return neueMenge
  }

  useEffect(() => {
    fetch('/api/zukauf-stammdaten').then(r => r.json()).then(j => {
      setBehaelter(j.behaelter ?? [])
      setWeinausbauListe(j.weinausbau ?? [])
    }).catch(() => {})
  }, [])

  const preisProEinheit = menge && preisGesamt && parseFloat(menge) > 0
    ? (parseFloat(preisGesamt) / parseFloat(menge)).toFixed(4)
    : null

  useEffect(() => {
    if (einheit === 'L' && preisProEinheit) setEinstandspreisLiter(preisProEinheit)
  }, [preisProEinheit, einheit])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!menge || parseFloat(menge) <= 0) { setError('Menge muss größer als 0 sein.'); return }
    const neueMenge = parseFloat(menge)
    if (art === 'trauben' && traubenGebunden.kg > 0 && neueMenge < alteZukaufMenge && neueMenge < traubenGebunden.kg - 0.0005) {
      setError(`Die Menge kann nicht unter die bereits gebundene Menge gesenkt werden: Aus diesem Zukauf sind bereits ${traubenGebunden.text}, zusammen ${fmtNum(traubenGebunden.kg)} kg.`)
      return
    }
    const fd = new FormData()
    fd.set('datum',                    datum)
    fd.set('lieferung_uhrzeit',        uhrzeit)
    fd.set('art',                      art)
    fd.set('lieferant_kontakt_id',     initial.lieferant_kontakt_id)
    fd.set('lieferant_firma_id',       initial.lieferant_firma_id)
    fd.set('eingangsrechnungsnummer',  eingangsrechnungsnummer)
    fd.set('transport_zugmaschine',    zugmaschine)
    fd.set('transport_anhaenger1',     anhaenger1)
    fd.set('transport_anhaenger2',     anhaenger2)
    fd.set('weinart',                  weinart)
    fd.set('rebsorte',                 rebsorte)
    fd.set('qualitaetsstufe',          qualitaet)
    fd.set('jahrgang',                 jahrgang)
    fd.set('herkunft',                 herkunft)
    fd.set('anreicherung',             anreicherung ? 'true' : 'false')
    fd.set('kmw',                      kmw)
    fd.set('alkohol_pct',              alkohol)
    fd.set('staatliche_pruefnummer',   pruefnummer)
    fd.set('menge',                    menge)
    fd.set('einheit',                  einheit)
    fd.set('preis_gesamt',             preisGesamt)
    fd.set('einstandspreis_pro_liter', einstandspreisLiter)
    fd.set('ziel_behaelter_id',        zielBehaelter)
    fd.set('notizen',                  notizen)

    startTransition(async () => {
      try { await updateZukauf(id, fd) }
      catch (err) { setError(fehlerText(err, 'Fehler beim Speichern')) }
    })
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <nav className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel/zukauf" className="hover:text-s112-blue-700">Zukäufe</Link>
        <span>/</span>
        <span className="text-s112-text font-medium">Bearbeiten</span>
      </nav>

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-s112-text">Zukauf bearbeiten</h1>
        <span className="text-xs text-s112-muted bg-s112-bg border border-s112-border rounded-full px-3 py-1">
          Transportbescheinigung gem. Weingesetz
        </span>
      </div>

      {lieferantName && (
        <p className="text-sm text-s112-muted">
          Lieferant: <span className="font-medium text-s112-text-1">{lieferantName}</span>
          <span className="ml-2 text-xs">(Lieferant-Zuordnung nur beim Neuanlegen änderbar)</span>
        </p>
      )}

      <div className="card p-5">
        <label className={labelCls}>Eingangs-Rechnungsnummer</label>
        <input aria-label="Eingangs-Rechnungsnummer" type="text" value={eingangsrechnungsnummer} onChange={e => setEingangsrechnungsnummer(e.target.value)}
          placeholder="Belegnr. lt. Rechnung des Lieferanten"
          className={inputCls + ' w-full max-w-sm'} />
      </div>

      {error && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-4 py-3 rounded-lg text-sm">{error}</div>
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
              {ART_OPTIONS.map(({ value, label }) => {
                const gesperrt = artGesperrt(value) && art !== value
                return (
                  <label key={value} className={`flex items-center gap-1.5 ${gesperrt ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}>
                    <input type="radio" name="art" value={value} checked={art === value}
                      disabled={gesperrt}
                      onChange={() => setArt(value)} className="accent-s112-teal" />
                    <span className="text-sm text-s112-text-1">{label}</span>
                  </label>
                )
              })}
            </div>
          </div>
        </div>

        {/* ── 2. Transportmittel ────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Transportmittel</h2>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>Zugmaschine (Kennzeichen)</label>
              <input aria-label="Zugmaschine (Kennzeichen)" type="text" value={zugmaschine} onChange={e => setZugmaschine(e.target.value)}
                placeholder="z.B. W-123AB" className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>1. Anhänger</label>
              <input aria-label="1. Anhänger" type="text" value={anhaenger1} onChange={e => setAnhaenger1(e.target.value)}
                placeholder="Kennzeichen" className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>2. Anhänger</label>
              <input aria-label="2. Anhänger" type="text" value={anhaenger2} onChange={e => setAnhaenger2(e.target.value)}
                placeholder="Kennzeichen" className={inputCls + ' w-full'} />
            </div>
          </div>
        </div>

        {/* ── 3. Ware ───────────────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Ware</h2>
          <div>
            <label className={labelCls}>Weinart *</label>
            <div className="flex gap-4 mt-1.5">
              {([['weiss','Weißwein','bg-s112-tertiary'],['rot','Rotwein','bg-s112-text'],['rose','Rosé','bg-s112-grey'],['unbekannt','Unbekannt','bg-s112-line']] as const).map(([val, lbl, dot]) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="weinart" value={val} checked={weinart === val}
                    onChange={() => setWeinart(val)} className="accent-s112-teal" />
                  <span className={`inline-block w-2.5 h-2.5 rounded-full border border-black/10 ${dot}`} />
                  <span className="text-sm text-s112-text-1">{lbl}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Rebsorte(n)</label>
              <input aria-label="Rebsorte(n)" type="text" value={rebsorte} onChange={e => setRebsorte(e.target.value)}
                placeholder="z.B. Grüner Veltliner" className={inputCls + ' w-full'} />
            </div>
            <div>
              <label className={labelCls}>Jahrgang{art === 'trauben' ? ' *' : ''}</label>
              <input type="number" value={jahrgang} onChange={e => setJahrgang(e.target.value)}
                min="1900" max="2100" placeholder="z.B. 2024"
                required={art === 'trauben'}
                className={inputCls + ' w-full'} />
              {art === 'trauben' && (
                <p className="text-xs text-s112-muted mt-1">
                  Wichtig für Pressungs-Vorschlag &amp; Traubenverkauf – ohne Jahrgang wird der Zukauf dort nicht angezeigt.
                </p>
              )}
            </div>
            {(art === 'wein' || art === 'most') && (
              <div>
                <label className={labelCls}>Qualitätsstufe</label>
                <select aria-label="Qualitätsstufe" value={qualitaet} onChange={e => setQualitaet(e.target.value)}
                  className={inputCls + ' w-full'}>
                  <option value="">– nicht angegeben –</option>
                  {mitGespeichertemWert(QUALITAET_OPTS, initial.qualitaetsstufe).map(q => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Herkunft</label>
              <input aria-label="Herkunft" type="text" value={herkunft} onChange={e => setHerkunft(e.target.value)}
                placeholder="z.B. Kamptal, Wachau" className={inputCls + ' w-full'} />
            </div>
            {(art === 'trauben' || art === 'most') && (
              <div>
                <label className={labelCls}>°KMW</label>
                <input aria-label="°KMW" type="number" value={kmw} onChange={e => setKmw(e.target.value)}
                  step="0.1" min="0" max="50" placeholder="z.B. 19.5" className={inputCls + ' w-full'} />
              </div>
            )}
            {art === 'wein' && (
              <div>
                <label className={labelCls}>Alkoholgehalt (%vol)</label>
                <input aria-label="Alkoholgehalt (%vol)" type="number" value={alkohol} onChange={e => setAlkohol(e.target.value)}
                  step="0.1" min="0" max="25" placeholder="z.B. 12.5" className={inputCls + ' w-full'} />
              </div>
            )}
            {art === 'wein' && (
              <div>
                <label className={labelCls}>Staatl. Prüfnummer</label>
                <input aria-label="Staatl. Prüfnummer" type="text" value={pruefnummer} onChange={e => setPruefnummer(e.target.value)}
                  placeholder="z.B. 1234/26" className={inputCls + ' w-full'} />
              </div>
            )}
          </div>
          {(art === 'trauben' || art === 'most') && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={anreicherung} onChange={e => setAnreicherung(e.target.checked)}
                className="accent-s112-teal w-4 h-4" />
              <span className="text-sm text-s112-text-1">Anreicherung (Zuckerung) erfolgt / geplant</span>
            </label>
          )}
        </div>

        {/* ── 4. Menge & Preis ──────────────────────────────────────────── */}
        <div className="card p-5 space-y-4">
          <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">Menge & Preis</h2>
          {mengeGesperrt && (
            <p className="flex items-start gap-1.5 text-xs bg-s112-bg border border-s112-border rounded-lg px-3 py-2 text-s112-text-1">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Menge, Einheit und Gebinde sind gesperrt: {sperrHinweis ?? 'An der Charge hängen bereits Folgebuchungen'}.
                Die Belegmenge bleibt als Zugang der Charge erhalten – eine Mindermenge bitte in der Charge über „Schwund buchen“,
                eine Mehrmenge als eigenen Zukauf erfassen; ein Gebindewechsel geht über „Umziehen“ im Kellerbuch.
                Rebsorte, Jahrgang, Weinart und Qualitätsstufe werden nur am Beleg geändert, nicht mehr an der Charge
                (sie kann inzwischen verschnitten oder abgestuft sein) – die Charge bitte im Kellerbuch bearbeiten.
              </span>
            </p>
          )}
          {art === 'trauben' && traubenGebunden.kg > 0 && (
            <p className="flex items-start gap-1.5 text-xs bg-s112-bg border border-s112-border rounded-lg px-3 py-2 text-s112-text-1">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              <span>
                Aus diesem Zukauf sind bereits {traubenGebunden.text} – die Menge kann nicht unter {fmtNum(traubenGebunden.kg)} kg
                gesenkt und die Art nicht mehr geändert werden.
              </span>
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className={labelCls}>Menge *</label>
              <input aria-label="Menge" type="number" value={menge} onChange={e => setMenge(e.target.value)}
                required min="0.001" step="0.001" placeholder="0"
                readOnly={mengeGesperrt} aria-readonly={mengeGesperrt}
                className={inputCls + ' w-full' + (mengeGesperrt ? ' bg-s112-bg text-s112-muted cursor-not-allowed' : '')} />
            </div>
            <div>
              <label className={labelCls}>Einheit</label>
              <select aria-label="Einheit" value={einheit} onChange={e => setEinheit(e.target.value)}
                disabled={mengeGesperrt}
                className={inputCls + ' w-full' + (mengeGesperrt ? ' bg-s112-bg text-s112-muted cursor-not-allowed' : '')}>
                <option value="kg">kg</option>
                <option value="L">L</option>
                <option value="t">t</option>
                <option value="Stk">Stk</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Gesamtpreis (€)</label>
              <input aria-label="Gesamtpreis (€)" type="number" value={preisGesamt} onChange={e => setPreisGesamt(e.target.value)}
                step="0.01" min="0" placeholder="0.00" className={inputCls + ' w-full'} />
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
                    step="0.0001" min="0" placeholder="0.0000" className={inputCls + ' w-full'} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── 5. Gebinde (nur Wein / Most) ──────────────────────────────── */}
        {(art === 'wein' || art === 'most') && (
          <div className="card p-5 space-y-3">
            <h2 className="font-semibold text-s112-text-1 text-sm uppercase tracking-wide">In Gebinde füllen</h2>
            <div>
              <label className={labelCls}>Gebinde (optional)</label>
              <select aria-label="Gebinde (optional)" value={zielBehaelter} onChange={e => setZielBehaelter(e.target.value)}
                disabled={mengeGesperrt}
                className={inputCls + ' w-full' + (mengeGesperrt ? ' bg-s112-bg text-s112-muted cursor-not-allowed' : '')}>
                <option value="">– keines –</option>
                {behaelter.map(b => {
                  const vol = b.volumen_liter
                  const chargen = weinausbauListe.filter(w => w.behaelter_id === b.id && w.id !== eigenWeinausbauId)
                  const fremdInhalt = chargen.reduce((s, w) => s + (w.menge_liter ?? 0), 0)
                  // Steht die eigene Charge bereits bewegt in GENAU diesem Behälter,
                  // zählt ihr simulierter (Live-)Bestand hier mit - sonst (noch nie
                  // zugeordnet, oder zugeordnet aber unbewegt) taucht sie in der
                  // Auswahlliste gar nicht separat auf, da sie beim Speichern ohnehin
                  // erst im gewählten Ziel-Behälter entsteht/ersetzt wird.
                  const eigeneCharge = eigenWeinausbauId ? weinausbauListe.find(w => w.id === eigenWeinausbauId) : undefined
                  const eigeneHier = (hatBewegungen && eigeneCharge?.behaelter_id === b.id)
                    ? eigeneSimulierteMenge(parseFloat(menge) || 0)
                    : 0
                  const inhalt = fremdInhalt + eigeneHier
                  const rest = vol != null ? vol - inhalt : null
                  const rebsortenListe = chargen.map(w => w.rebsorte)
                  if (eigeneHier > 0 && rebsorte) rebsortenListe.push(rebsorte)
                  const rebsorten = [...new Set(rebsortenListe.filter(Boolean))].map(r => formatRebsorteMitKuerzel(r)).join(', ')
                  const kapSuffix = vol != null ? ` · ${fmtNum(vol)} L` : ''
                  const inhaltSuffix = inhalt > 0 ? ` · Inhalt: ${fmtNum(inhalt)} L${rebsorten ? ` (${rebsorten})` : ''}` : ' · leer'
                  const restSuffix = rest != null ? ` · Rest: ${fmtNum(rest)} L` : ''
                  return (
                    <option key={b.id} value={b.id}>
                      {b.name}{kapSuffix}{inhaltSuffix}{restSuffix}
                    </option>
                  )
                })}
              </select>
            </div>

            {/* Detail-Panel für gewähltes Gebinde */}
            {zielBehaelter && (() => {
              const b = behaelter.find(x => x.id === zielBehaelter)
              const vol = b?.volumen_liter ?? null
              const chargen = weinausbauListe.filter(w => w.behaelter_id === zielBehaelter && w.id !== eigenWeinausbauId)
              const fremdInhalt = chargen.reduce((s, w) => s + (w.menge_liter ?? 0), 0)
              const mengeNum = parseFloat(menge) || 0
              const eigeneCharge = eigenWeinausbauId ? weinausbauListe.find(w => w.id === eigenWeinausbauId) : undefined
              // Bereits bewegte Charge: ihr Behälter steht fest (ein Wechsel wird
              // von updateZukauf beim Speichern verweigert) - der simulierte
              // Bestand zählt daher nur mit, wenn der gewählte Behälter auch
              // tatsächlich der ist, in dem sie aktuell liegt. Noch unbewegt (oder
              // noch nie zugeordnet): die volle eingetragene Menge entsteht/landet
              // beim Speichern im gerade GEWÄHLTEN Behälter.
              const eigeneHier = hatBewegungen
                ? (eigeneCharge?.behaelter_id === zielBehaelter ? eigeneSimulierteMenge(mengeNum) : 0)
                : eigeneSimulierteMenge(mengeNum)
              const inhalt = fremdInhalt + eigeneHier
              const restNach = vol != null ? vol - inhalt : null
              const ueber = restNach != null && restNach < -0.01
              const rebsortenListe = chargen.map(c => c.rebsorte)
              if (eigeneHier > 0 && rebsorte) rebsortenListe.push(rebsorte)
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
                        {(chargen.length > 0 || eigeneHier > 0) && (
                          <span className="ml-1 font-normal text-s112-muted">
                            ({[...new Set(rebsortenListe.filter(Boolean))].map(r => formatRebsorteMitKuerzel(r)).join(', ') || '–'})
                          </span>
                        )}
                      </p>
                    </div>
                    <div>
                      <p className="text-s112-muted mb-0.5">{mengeNum > 0 || hatBewegungen ? 'Rest nach Zukauf' : 'Restkapazität'}</p>
                      <p className={`font-semibold ${ueber ? 'text-s112-err-fg' : 'text-s112-blue-700'}`}>
                        {vol != null
                          ? fmtNum(restNach!, { max: 1 }) + ' L'
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
          </div>
        )}

        {/* ── 6. Notizen ────────────────────────────────────────────────── */}
        <div className="card p-5">
          <label className={labelCls}>Notizen</label>
          <textarea aria-label="Notizen" value={notizen} onChange={e => setNotizen(e.target.value)}
            rows={3} placeholder="Qualitätsmerkmale, Bedingungen, sonstige Anmerkungen…"
            className={inputCls + ' w-full resize-none'} />
        </div>

        {/* ── Submit ────────────────────────────────────────────────────── */}
        <div className="flex justify-end gap-3">
          <Link href="/weinhandel/zukauf"
            className="text-sm text-s112-muted hover:text-s112-text-1 px-4 py-2">
            Abbrechen
          </Link>
          <button type="submit" disabled={isPending}
            className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
            {isPending ? 'Speichern…' : 'Änderungen speichern'}
          </button>
        </div>
      </form>
    </div>
  )
}
