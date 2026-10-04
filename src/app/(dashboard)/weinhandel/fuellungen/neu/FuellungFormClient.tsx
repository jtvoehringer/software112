'use client'

import { useEffect, useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { KN_CODES } from '@/lib/wein/zolltarif'
import { HERKUNFT_ORDER, HERKUNFT_LABEL, herkunftGebietTolerant, herkunftOptionen, zulaessigeHerkuenfte } from '@/lib/herkunft'
import { qualitaetText } from '@/lib/weinqualitaet'
import { istAufwertung, normalisiereQualitaet } from '@/lib/wein/qualitaetsrang'
import ZusatzErzeugnisFelder from '@/components/wein/ZusatzErzeugnisFelder'
import { FUELLUNG_QUALITAETEN } from '@/lib/wein/qualitaet'
import { AlertTriangle, CheckCircle2, Droplet } from 'lucide-react'
import HerkunftCodeSelect from '@/components/weinbaugebiete/HerkunftCodeSelect'
import type { CustomWeinbaugebiet } from '@/app/(dashboard)/weinbaugebiete/actions'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { KORREKTUR_NACH_OBEN_HINWEIS } from '@/lib/kellerbuch/hinweise'
import { WEINART_LABEL } from '@/lib/keller/weinart'
import { landAnzeige } from '@/lib/katalog/laender'

type Charge = {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  menge_liter: number | null
  status: string
  qualitaetsstufe?: string | null
  /** KAN-186: Zusatzbezeichnung und Erzeugnis der Charge (Altwerte im Qualitätsfeld werden normalisiert) */
  zusatzbezeichnung?: string | null
  erzeugnis?: string | null
  herkunft_code?: string | null
  /** KAN-84: Weinart und Land der Charge – die Füllung übernimmt sie serverseitig (nur Anzeige) */
  weinart?: string | null
  land_iso?: string | null
}

type DacAntrag = {
  id: string
  bezeichnung: string
  dac_region: string
  jahrgang: number | null
  rebsorte: string | null
  pruefnummer: string | null
  status: string
  weinausbau_id: string | null
}

// KAN-73: zentrale Liste der Füllung (= CHECK fuellungen_qualitaet_check, alle 18 Stufen –
// jetzt auch „Wein“ und „Ausbruch“, damit jede Charge abgefüllt werden kann)
const QUALITAETEN = FUELLUNG_QUALITAETEN

const FLASCHENGROESSEN = [
  { value: 375,  label: '0,375 L – Halbflasche' },
  { value: 750,  label: '0,75 L – Normalflasche (Standard)' },
  { value: 1000, label: '1,0 L' },
  { value: 1500, label: '1,5 L – Magnum' },
  { value: 3000, label: '3,0 L – Doppelmagnum' },
  { value: 6000, label: '6,0 L – Imperiale' },
  { value: 187,  label: '0,187 L – Piccolo' },
  { value: 500,  label: '0,500 L' },
]

function fmtL(n: number) {
  return fmtNum(n, 2) + ' L'
}

export default function FuellungFormClient({
  chargen,
  dacAntraege,
  pnHinweise = {},
  customWeinbaugebiete,
  action,
  umzugsAntraegeLaden,
  defaultChargeId,
}: {
  chargen: Charge[]
  /** KAN-72: nur die für die Abfüllung wählbaren Anträge (gültige Prüfnummer bzw. offen) */
  dacAntraege: DacAntrag[]
  /** Charge → warum ihre frühere Prüfnummer nicht (mehr) gilt */
  pnHinweise?: Record<string, string>
  customWeinbaugebiete: CustomWeinbaugebiet[]
  action: (fd: FormData) => Promise<{ id: string; hinweis?: string }>
  /** KAN-84: Anträge von Vorgänger-Chargen (Charge vollständig per Umzug) – erst für die gewählte Charge geladen */
  umzugsAntraegeLaden?: (chargeId: string) => Promise<DacAntrag[]>
  defaultChargeId?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const defaultCharge = chargen.find(c => c.id === defaultChargeId) ?? null

  const [selectedChargeId, setSelectedChargeId] = useState(defaultChargeId ?? '')
  const [anzahl, setAnzahl]       = useState('')
  const [groesse, setGroesse]     = useState('750')
  const [nameVal, setNameVal]     = useState(defaultCharge?.name ?? '')
  const [qualitaetVal, setQualitaetVal] = useState(normalisiereQualitaet(defaultCharge ?? null).stufe ?? 'qualitaetswein')
  const [herkunftCodeVal, setHerkunftCodeVal] = useState(defaultCharge?.herkunft_code ?? '')
  // KAN-84: Anbaugebiet aus dem Gebiet der Herkunft der Charge vorbelegt (z. B. „Thermenregion“) – bei der Anlage änderbar
  const [anbaugebietVal, setAnbaugebietVal] = useState(herkunftGebietTolerant(defaultCharge?.herkunft_code) ?? '')
  // Bewusst NICHT vorbelegt (false) - ein versehentlich stehen gelassenes Häkchen hat
  // sonst schon unbemerkt hohe Restmengen als Schwund ausgebucht. Der User muss die
  // Schwundbuchung aktiv bestätigen (siehe Warnhinweis unten).
  const [abschliessen, setAbschliessen] = useState(false)
  // KAN-72: Vorschlag = genehmigter Antrag der Charge – die Liste enthält nur Anträge, deren
  // Prüfnummer für den heutigen Bestand gilt (nach einem Verschnitt keiner mehr). Der Server
  // prüft mit demselben Stand (Bestand, von dem die Füllung abgebucht wird), auch bei einem
  // früheren Abfülldatum.
  const vorschlag = (chargeId: string) => dacAntraege.find(d => d.weinausbau_id === chargeId && d.status === 'genehmigt') ?? null
  const [selectedDacId, setSelectedDacId] = useState(() => (defaultChargeId ? vorschlag(defaultChargeId)?.id ?? '' : ''))

  const selectedCharge = chargen.find(c => c.id === selectedChargeId) ?? null
  const verfuegbar     = parseFloat(String(selectedCharge?.menge_liter ?? 0)) || 0

  // KAN-72/KAN-84: Prüfnummer nur aus einem (gültigen bzw. offenen) DAC-Antrag der Charge – keine freie
  // Eingabe mehr (createFuellung lehnt sie mit Charge ab, nurAusAntrag)
  // KAN-84 (bis KAN-99): dazu die Anträge von Vorgänger-Chargen, aus denen die Charge vollständig per Umzug stammt –
  // erst für die gewählte Charge geladen; eine veraltete Antwort (Charge inzwischen gewechselt) wird verworfen
  const [umzug, setUmzug] = useState<{ chargeId: string; liste: DacAntrag[] } | null>(null)
  useEffect(() => {
    if (!selectedChargeId || !umzugsAntraegeLaden) return
    let aktuell = true
    const chargeId = selectedChargeId
    umzugsAntraegeLaden(chargeId)
      .then(liste => {
        if (!aktuell) return
        setUmzug({ chargeId, liste })
        // Vorschlag wie beim eigenen Antrag: der genehmigte – nur, wenn noch nichts gewählt ist
        const genehmigt = liste.find(d => d.status === 'genehmigt')
        if (genehmigt) setSelectedDacId(bisher => bisher || genehmigt.id)
      })
      .catch(() => { if (aktuell) setUmzug({ chargeId, liste: [] }) })
    return () => { aktuell = false }
  }, [selectedChargeId, umzugsAntraegeLaden])
  const umzugGeladen = !umzugsAntraegeLaden || umzug?.chargeId === selectedChargeId
  const umzugsAntraege = umzug && umzug.chargeId === selectedChargeId ? umzug.liste : []
  const antraegeDerCharge = selectedChargeId
    ? [...dacAntraege.filter(d => d.weinausbau_id === selectedChargeId), ...umzugsAntraege]
    : []
  const pnHinweis = selectedChargeId ? (pnHinweise[selectedChargeId] ?? null) : null

  // Nur Abstufung erlaubt, keine Aufstufung: Dropdowns zeigen nur noch die
  // aktuelle Stufe der Charge und alle rechtlich niedrigeren Stufen (+ "Sonstiges"
  // als generischer Fallback ohne Schutzangabe). Ist keine Charge verknüpft,
  // stehen alle Stufen zur Auswahl (kein Bezugswert zum Einschränken vorhanden).
  // KAN-186: Angabe der Charge samt Zusatzbezeichnung/Erzeugnis (Altwerte normalisiert)
  const chargeAngabe = useMemo(() => (selectedCharge ? normalisiereQualitaet({ ...selectedCharge }) : null), [selectedCharge])
  const qualitaetOptions = useMemo(() => {
    const aktuell = chargeAngabe?.stufe ?? null
    if (!aktuell) return QUALITAETEN
    return QUALITAETEN.filter(q =>
      q.value === 'sonstiges' || !istAufwertung(aktuell, q.value)   // KAN-80: wie der Server
    )
  }, [chargeAngabe])

  // KAN-111: nur die Herkunft der Charge und breitere Stufen – auch bei eigenen Weinbaugebieten (bisher ohne
  // Einschränkung): dieses selbst bzw. sein Gebiet im Baum und „Wein aus Österreich“; dieselbe Regel wie der Server
  const zulaessig = useMemo(() => zulaessigeHerkuenfte(selectedCharge?.herkunft_code), [selectedCharge])
  const herkunftOptions = useMemo(() => herkunftOptionen(zulaessig ?? HERKUNFT_ORDER), [zulaessig])
  const herkunftCustomOptions = useMemo(
    () => (zulaessig ? customWeinbaugebiete.filter(w => zulaessig.includes(w.name)) : customWeinbaugebiete),
    [zulaessig, customWeinbaugebiete],
  )

  // Auto-Berechnung: Flaschen × Flaschengröße
  const berechneteLiter = useMemo(() => {
    const n = parseInt(anzahl)
    const g = parseInt(groesse)
    if (n > 0 && g > 0) return Math.round(n * g) / 1000
    return null
  }, [anzahl, groesse])

  const schwund = berechneteLiter !== null && selectedCharge
    ? verfuegbar - berechneteLiter
    : null

  // KAN-35: keine Toleranz mehr (bisher eine Flaschengröße, danach wurde die Charge still
  // auf 0 gekappt) – der Server lehnt jede Überabfüllung über die Rundung hinaus ab.
  const ueberabfuellung = schwund !== null && schwund < -0.005
  const schwundWarning = schwund !== null && (ueberabfuellung || schwund > verfuegbar * 0.2)

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

  function handleChargeChange(id: string) {
    setSelectedChargeId(id)
    const c = chargen.find(ch => ch.id === id)
    if (c) {
      setNameVal(c.name)
      setQualitaetVal(normalisiereQualitaet(c).stufe ?? 'qualitaetswein')
      setHerkunftCodeVal(c.herkunft_code ?? '')
      setAnbaugebietVal(herkunftGebietTolerant(c.herkunft_code) ?? '')
    }
    // KAN-72: Antrag der vorigen Charge immer verwerfen – bisher blieb die Nummer von Charge A
    // stehen und wurde mit Charge B gespeichert
    setSelectedDacId('')
    const dac = vorschlag(id)
    if (dac) setSelectedDacId(dac.id)
  }

  function handleDacChange(dacId: string) {
    setSelectedDacId(dacId)
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        const r = await action(fd)
        if (r?.hinweis) {
          // Füllung ist angelegt, ein Folgeschritt (z. B. Schwundbuchung) fehlte – nicht erneut
          // absenden (sonst doppelte Füllung), sondern in der Bearbeitung nachholen
          window.alert(r.hinweis)
          router.push(`/weinhandel/fuellungen/${r.id}/edit`)
          return
        }
        router.push('/weinhandel')
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Speichern'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Charge */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-s112-text text-sm">Kellerbuch-Charge</h2>
        <div>
          <label className={labelCls}>Weinausbau-Charge *</label>
          {/* KAN-84: eine Füllung braucht immer eine Charge (ohne Charge nur Eröffnungsbestand per Import) */}
          <select aria-label="Weinausbau-Charge"
            name="weinausbau_id"
            value={selectedChargeId}
            onChange={e => handleChargeChange(e.target.value)}
            required
            className={inputCls}
          >
            <option value="" disabled>– bitte Charge wählen –</option>
            {chargen.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{c.menge_liter ? ` · ${fmtNum(parseFloat(String(c.menge_liter)))} L` : ''}
              </option>
            ))}
          </select>
          {selectedCharge && (
            <p className="text-xs text-s112-muted mt-1">
              Verfügbarer Bestand (laut DB-Snapshot): <strong>{fmtL(verfuegbar)}</strong>
            </p>
          )}
        </div>
      </div>

      {/* Produktbezeichnung */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-s112-text text-sm">Produktbezeichnung</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Produktname *</label>
            <input aria-label="Produktname"
              name="name"
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              placeholder="z.B. Grüner Veltliner Ried Hohenberg"
              required
              className={inputCls}
            />
          </div>
          {/* KAN-84: Jahrgang, Rebsorte, Weinart und Land kommen serverseitig aus der Charge – nur Anzeige, kein Formularfeld */}
          {([
            ['Jahrgang', selectedCharge?.jahrgang != null ? String(selectedCharge.jahrgang) : null],
            ['Rebsorte', selectedCharge?.rebsorte ?? null],
            ['Weinart', selectedCharge?.weinart ? (WEINART_LABEL[selectedCharge.weinart] ?? selectedCharge.weinart) : null],
            ['Land', selectedCharge ? landAnzeige(selectedCharge.land_iso ?? 'AT') : null],
          ] as const).map(([label, wert]) => (
            <div key={label}>
              <p className={labelCls}>{label} <span className="font-normal text-s112-muted">(aus der Charge)</span></p>
              <div role="textbox" aria-readonly="true" aria-label={label} className={`${inputCls} bg-s112-bg text-s112-text-1`}>
                {wert || '–'}
              </div>
            </div>
          ))}
          <div>
            <label className={labelCls}>Qualitätsbezeichnung *</label>
            <select aria-label="Qualitätsbezeichnung" name="qualitaet" value={qualitaetVal} onChange={e => setQualitaetVal(e.target.value)} required className={inputCls}>
              {qualitaetOptions.map(q => (
                <option key={q.value} value={q.value}>{q.label}</option>
              ))}
            </select>
            {chargeAngabe?.stufe && (
              <p className="text-xs text-s112-muted mt-1">
                Charge aktuell: <strong>{qualitaetText(chargeAngabe)}</strong> – nur Abstufung möglich, keine Aufstufung
              </p>
            )}
          </div>
          {/* KAN-186: Zusatzbezeichnung und Erzeugnis – aus der Charge vorbelegt, frei wählbar (keine Aufwertung) */}
          <ZusatzErzeugnisFelder key={selectedChargeId || 'ohne-charge'}
            zusatz={chargeAngabe?.zusatz ?? null} erzeugnis={chargeAngabe?.erzeugnis ?? null} stufe={qualitaetVal}
            feldKlasse={inputCls} labelKlasse={labelCls} />
          <div>
            <label className={labelCls}>Herkunft-Code (BKI)</label>
            <HerkunftCodeSelect
              name="herkunft_code"
              value={herkunftCodeVal}
              onChange={setHerkunftCodeVal}
              builtinOptions={herkunftOptions}
              customOptions={herkunftCustomOptions}
              className={inputCls}
            />
            {selectedCharge?.herkunft_code && (
              <p className="text-xs text-s112-muted mt-1">
                Charge aktuell: <strong>{HERKUNFT_LABEL[selectedCharge.herkunft_code] ?? selectedCharge.herkunft_code}</strong> – nur Abstufung möglich, keine Aufstufung
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Anbaugebiet</label>
            <input aria-label="Anbaugebiet"
              name="anbaugebiet"
              value={anbaugebietVal}
              onChange={e => setAnbaugebietVal(e.target.value)}
              placeholder="z.B. Traisental, Wachau, Kamptal …"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Subbezeichnung / Ried (optional)</label>
            <input aria-label="Subbezeichnung / Ried (optional)"
              name="bezeichnung"
              placeholder="z.B. Ried Hohenberg · Reserve · Alte Reben"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Abfüllung */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-s112-text text-sm">Abfüllung</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>DAC-Antrag / Prüfnummer</label>
            {antraegeDerCharge.length > 0 ? (
              <div className="space-y-2">
                <select aria-label="DAC-Antrag / Prüfnummer" value={selectedDacId} onChange={e => handleDacChange(e.target.value)} className={inputCls}>
                  <option value="">– kein DAC-Antrag –</option>
                  {antraegeDerCharge.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.bezeichnung} · {d.pruefnummer ?? 'keine Prüfnr.'} ({d.status})
                    </option>
                  ))}
                </select>
                {selectedDacId && antraegeDerCharge.find(d => d.id === selectedDacId)?.status !== 'genehmigt' && (
                  <p className="text-xs text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded px-2 py-1 inline-flex items-center gap-1">
                    <AlertTriangle size={12} strokeWidth={2} />DAC-Antrag noch nicht genehmigt – Abfüllung möglich, aber Prüfnummer fehlt.
                  </p>
                )}
              </div>
            ) : selectedChargeId && !umzugGeladen ? (
              <p className="text-xs text-s112-muted border border-s112-border rounded-lg px-3 py-2" aria-live="polite">
                DAC-Anträge werden geladen …
              </p>
            ) : (
              // KAN-84: keine freie Eingabe mehr – die Nummer kommt nur aus dem DAC-Antrag der Charge und lässt
              // sich später in der Füllungsbearbeitung einmal nachtragen
              <p className="text-xs text-s112-muted border border-s112-border rounded-lg px-3 py-2">
                {selectedChargeId
                  ? 'Kein DAC-Antrag mit gültiger Prüfnummer für diese Charge – die Füllung wird ohne Prüfnummer angelegt. Die Nummer lässt sich später in der Füllungsbearbeitung einmal aus dem Antrag der Charge nachtragen.'
                  : 'Die Prüfnummer kommt aus dem DAC-Antrag der gewählten Charge.'}
              </p>
            )}
            {pnHinweis && (
              <p className="text-xs text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded px-2 py-1 mt-2 flex items-start gap-1">
                <AlertTriangle size={12} strokeWidth={2} className="mt-0.5 shrink-0" /><span>{pnHinweis}</span>
              </p>
            )}
            {/* Nur der Antrag geht mit – die Nummer liest der Server aus dem Antrag (kein Feld „pruefnummer“) */}
            <input type="hidden" name="dac_antrag_id" value={selectedDacId} />
          </div>
          <div>
            <label className={labelCls}>Chargennummer</label>
            <input aria-label="Chargennummer"
              name="chargennummer"
              placeholder="Leer lassen = wird automatisch vergeben"
              className={inputCls}
            />
            <p className="text-xs text-s112-muted mt-1">Leer lassen → automatisch z.B. CH-2025-001</p>
          </div>
          <div>
            <label className={labelCls}>Abfülldatum *</label>
            <input aria-label="Abfülldatum"
              name="datum"
              type="date"
              defaultValue={new Date().toISOString().split('T')[0]}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Flaschengröße *</label>
            <select aria-label="Flaschengröße"
              name="flaschengroesse_ml"
              value={groesse}
              onChange={e => setGroesse(e.target.value)}
              required
              className={inputCls}
            >
              {FLASCHENGROESSEN.map(f => (
                <option key={f.value} value={f.value}>{f.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelCls}>Anzahl Flaschen *</label>
            <input aria-label="Anzahl Flaschen"
              name="anzahl_flaschen"
              type="number"
              min={1}
              value={anzahl}
              onChange={e => setAnzahl(e.target.value)}
              placeholder="z.B. 2400"
              required
              className={inputCls}
            />
          </div>

          {/* Berechnete Liter – read-only Anzeige + hidden input */}
          <div>
            <label className={labelCls}>Abgefüllte Menge (berechnet)</label>
            <div className={`${inputCls} bg-s112-bg text-s112-text-1 font-medium`}>
              {berechneteLiter !== null ? fmtL(berechneteLiter) : '–'}
            </div>
            {berechneteLiter !== null && (
              <input type="hidden" name="menge_liter_gefuellt" value={berechneteLiter} />
            )}
            <p className="text-xs text-s112-muted mt-1">
              {anzahl && groesse
                ? `${fmtNum(parseInt(anzahl))} Fl. × ${parseInt(groesse)} ml`
                : 'Wird aus Flaschen × Größe berechnet'}
            </p>
          </div>
        </div>

        {/* Schwund-Box */}
        {schwund !== null && berechneteLiter !== null && (
          <div className={`rounded-lg px-4 py-3 text-sm ${
            ueberabfuellung
              ? 'bg-s112-err-bg border border-s112-err/30 text-s112-err-fg'
              : schwundWarning
              ? 'bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg'
              : 'bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg'
          }`}>
            {ueberabfuellung ? (
              <span className="inline-flex items-start gap-1.5"><AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /><span><strong>Überabfüllung:</strong> Abgefüllte Menge ({fmtL(berechneteLiter)}) übersteigt den Bestand der Charge ({fmtL(verfuegbar)}) um {fmtL(Math.abs(schwund))}. So kann die Füllung nicht gespeichert werden – bitte die Flaschenzahl prüfen. Ist tatsächlich mehr Wein vorhanden: {KORREKTUR_NACH_OBEN_HINWEIS}</span></span>
            ) : schwund < 0.01 ? (
              <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={15} strokeWidth={1.75} />Charge wird vollständig abgefüllt. Kein/minimaler Schwund.</span>
            ) : (
              <span className="inline-flex items-start gap-1.5"><Droplet size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" /><span><strong>Restwein / Schwund:</strong> {fmtL(schwund)} verbleiben nach der Abfüllung im Tank.</span></span>
            )}
          </div>
        )}

        {/* Charge abschließen - bewusst als aktive Ja/Nein-Entscheidung statt eines
            vorbelegten Häkchens, damit nicht versehentlich hohe Restmengen als Schwund
            ausgebucht werden. Das Häkchen bleibt zusätzlich als schnelle Vorauswahl für
            geübtere User erhalten - beide Bedienelemente steuern denselben Zustand. */}
        {schwund !== null && schwund >= 0.01 && (
          <div className="rounded-lg border border-s112-warn/30 bg-s112-warn-bg px-4 py-3 space-y-3">
            <p className="text-sm text-s112-warn-fg inline-flex items-start gap-1.5">
              <AlertTriangle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              <span>
                <strong>Achtung, noch Rest vorhanden</strong> – {fmtL(schwund)} verbleiben nach der Abfüllung im Tank.
                Soll dafür eine Schwundbuchung vorgenommen werden (Charge wird abgeschlossen)?
              </span>
            </p>

            <div className="flex items-center gap-2 pl-6">
              <button
                type="button"
                onClick={() => setAbschliessen(true)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  abschliessen
                    ? 'bg-s112-warn-fg text-white border-s112-warn-fg'
                    : 'bg-white text-s112-warn-fg border-s112-warn/30 hover:bg-s112-warn-bg'
                }`}
              >
                Ja, Schwund buchen &amp; abschließen
              </button>
              <button
                type="button"
                onClick={() => setAbschliessen(false)}
                className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                  !abschliessen
                    ? 'bg-s112-text text-white border-s112-text'
                    : 'bg-white text-s112-text-2 border-s112-border hover:bg-s112-bg'
                }`}
              >
                Nein, Charge bleibt offen
              </button>
            </div>

            <label className="flex items-start gap-2 pl-6 cursor-pointer select-none">
              <input
                type="checkbox"
                name="abschliessen"
                value="true"
                checked={abschliessen}
                onChange={e => setAbschliessen(e.target.checked)}
                className="mt-0.5 w-3.5 h-3.5 accent-s112-teal"
              />
              <span className="text-xs text-s112-warn-fg/80">
                Charge nach dieser Füllung abschließen – {fmtL(schwund)} Restwein als Schwund ausbuchen, Status → Abgeschlossen
              </span>
            </label>
          </div>
        )}
      </div>

      {/* Preise */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-s112-text text-sm">Preise</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>VK-Preis brutto pro Flasche (€)</label>
            <input aria-label="VK-Preis brutto pro Flasche (€)"
              name="vk_preis_brutto"
              type="number"
              step="0.01"
              min={0}
              placeholder="z.B. 12.90"
              className={inputCls}
            />
            <p className="text-xs text-s112-muted mt-1">Verkaufspreis inkl. MwSt.</p>
          </div>
          <div>
            <label className={labelCls}>Einstandspreis pro Flasche (€)</label>
            <input aria-label="Einstandspreis pro Flasche (€)"
              name="einstandspreis"
              type="number"
              step="0.01"
              min={0}
              placeholder="z.B. 4.20"
              className={inputCls}
            />
            <p className="text-xs text-s112-muted mt-1">Kalkulationskosten / Lagerwert – netto, intern</p>
          </div>
        </div>
      </div>

      {/* Export */}
      <div className="card p-5 space-y-3">
        <h2 className="font-semibold text-s112-text text-sm">Export (intern)</h2>
        <div>
          <label className={labelCls}>
            KN-Code / Zolltarifnummer{' '}
            <span className="text-s112-muted font-normal">– nur für Exportdokumente, wird nicht gedruckt</span>
          </label>
          <select name="zolltarifnummer" defaultValue="" className={inputCls}>
            <option value="">– kein KN-Code –</option>
            {Array.from(new Set(KN_CODES.map(k => k.gruppe))).map(gruppe => (
              <optgroup key={gruppe} label={gruppe}>
                {KN_CODES.filter(k => k.gruppe === gruppe).map(k => (
                  <option key={k.value} value={k.value}>{k.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Notizen */}
      <div className="card p-5">
        <label className={labelCls}>Notizen (optional)</label>
        <textarea aria-label="Notizen (optional)"
          name="notizen"
          rows={3}
          placeholder="Abfüllungsprotokoll, Besonderheiten …"
          className={inputCls + ' resize-none'}
        />
      </div>

      {error && (
        <p className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-4 py-2">{error}</p>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={isPending || ueberabfuellung}
          className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
          {isPending ? 'Wird angelegt …' : 'Füllung anlegen'}
        </button>
        <Link href="/weinhandel" className="px-6 py-2 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text transition-colors">
          Abbrechen
        </Link>
      </div>
    </form>
  )
}
