'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { KN_CODES } from '@/lib/wein/zolltarif'
import { HERKUNFT_ORDER, HERKUNFT_LABEL } from '@/lib/herkunft'
import { QUALITAET_LABEL } from '@/lib/weinqualitaet'

type Charge = {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  menge_liter: number | null
  status: string
  qualitaetsstufe?: string | null
  herkunft_code?: string | null
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

const QUALITAETEN = [
  { value: 'qualitaetswein',        label: 'Qualitätswein' },
  { value: 'kabinett',              label: 'Kabinett' },
  { value: 'spaetlese',             label: 'Spätlese' },
  { value: 'auslese',               label: 'Auslese' },
  { value: 'beerenauslese',         label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese',  label: 'Trockenbeerenauslese (TBA)' },
  { value: 'eiswein',               label: 'Eiswein' },
  { value: 'strohwein',             label: 'Strohwein / Schilfwein' },
  { value: 'dac',                   label: 'DAC (Districtus Austriae Controllatus)' },
  { value: 'reserve',               label: 'Reservé / Reserve' },
  { value: 'erste_lage',            label: 'Erste Lage (ÖTW)' },
  { value: 'grosses_gewachs',       label: 'Großes Gewächs' },
  { value: 'landwein',              label: 'Landwein' },
  { value: 'sekt',                  label: 'Sekt b.A.' },
  { value: 'perlwein',              label: 'Perlwein' },
  { value: 'sonstiges',             label: 'Sonstiges' },
]

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
  return n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' L'
}

export default function FuellungFormClient({
  chargen,
  dacAntraege,
  action,
  defaultChargeId,
}: {
  chargen: Charge[]
  dacAntraege: DacAntrag[]
  action: (fd: FormData) => Promise<void>
  defaultChargeId?: string
}) {
  const defaultCharge = chargen.find(c => c.id === defaultChargeId) ?? null

  const [selectedChargeId, setSelectedChargeId] = useState(defaultChargeId ?? '')
  const [anzahl, setAnzahl]       = useState('')
  const [groesse, setGroesse]     = useState('750')
  const [nameVal, setNameVal]     = useState(defaultCharge?.name ?? '')
  const [jahrgangVal, setJahrgangVal] = useState(
    String(defaultCharge?.jahrgang ?? new Date().getFullYear())
  )
  const [rebsorteVal, setRebsorteVal] = useState(defaultCharge?.rebsorte ?? '')
  const [qualitaetVal, setQualitaetVal] = useState(defaultCharge?.qualitaetsstufe ?? 'qualitaetswein')
  const [herkunftCodeVal, setHerkunftCodeVal] = useState(defaultCharge?.herkunft_code ?? '')
  const [abschliessen, setAbschliessen] = useState(true)
  const [selectedDacId, setSelectedDacId] = useState('')
  const [pruefnummerVal, setPruefnummerVal] = useState('')

  const selectedCharge = chargen.find(c => c.id === selectedChargeId) ?? null
  const verfuegbar     = parseFloat(String(selectedCharge?.menge_liter ?? 0)) || 0

  // Auto-Berechnung: Flaschen × Flaschengröße
  const berechneteLiter = useMemo(() => {
    const n = parseInt(anzahl)
    const g = parseInt(groesse)
    if (n > 0 && g > 0) return Math.round(n * g) / 1000
    return null
  }, [anzahl, groesse])

  const schwund = berechneteLiter !== null && verfuegbar > 0
    ? verfuegbar - berechneteLiter
    : null

  // Toleranz = eine Flaschengröße (Rundungstoleranz beim Abfüllen)
  const bottleL = parseInt(groesse) / 1000
  const schwundWarning = schwund !== null && (schwund < -bottleL || schwund > verfuegbar * 0.2)

  const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  function handleChargeChange(id: string) {
    setSelectedChargeId(id)
    const c = chargen.find(ch => ch.id === id)
    if (c) {
      setNameVal(c.name)
      setJahrgangVal(String(c.jahrgang ?? new Date().getFullYear()))
      setRebsorteVal(c.rebsorte ?? '')
      setQualitaetVal(c.qualitaetsstufe ?? 'qualitaetswein')
      setHerkunftCodeVal(c.herkunft_code ?? '')
    }
    const dac = dacAntraege.find(d => d.weinausbau_id === id && d.status === 'genehmigt')
    if (dac) { setSelectedDacId(dac.id); setPruefnummerVal(dac.pruefnummer ?? '') }
    else { setSelectedDacId('') }
  }

  function handleDacChange(dacId: string) {
    setSelectedDacId(dacId)
    const dac = dacAntraege.find(d => d.id === dacId)
    setPruefnummerVal(dac?.pruefnummer ?? '')
  }

  return (
    <form action={action} className="space-y-6">

      {/* Charge */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 text-sm">Kellerbuch-Charge</h2>
        <div>
          <label className={labelCls}>Weinausbau-Charge</label>
          <select
            name="weinausbau_id"
            value={selectedChargeId}
            onChange={e => handleChargeChange(e.target.value)}
            className={inputCls}
          >
            <option value="">– keine Verknüpfung –</option>
            {chargen.map(c => (
              <option key={c.id} value={c.id}>
                {c.name}{c.jahrgang ? ` (${c.jahrgang})` : ''}{c.menge_liter ? ` · ${parseFloat(String(c.menge_liter)).toLocaleString('de-AT')} L` : ''}
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
        <h2 className="font-semibold text-gray-800 text-sm">Produktbezeichnung</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className={labelCls}>Produktname *</label>
            <input
              name="name"
              value={nameVal}
              onChange={e => setNameVal(e.target.value)}
              placeholder="z.B. Grüner Veltliner Ried Hohenberg"
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Jahrgang</label>
            <input
              name="jahrgang"
              type="number"
              min={1900} max={2100}
              value={jahrgangVal}
              onChange={e => setJahrgangVal(e.target.value)}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Rebsorte</label>
            <input
              name="rebsorte"
              value={rebsorteVal}
              onChange={e => setRebsorteVal(e.target.value)}
              placeholder="z.B. Grüner Veltliner"
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Qualitätsbezeichnung *</label>
            <select name="qualitaet" value={qualitaetVal} onChange={e => setQualitaetVal(e.target.value)} required className={inputCls}>
              {QUALITAETEN.map(q => (
                <option key={q.value} value={q.value}>{q.label}</option>
              ))}
            </select>
            {selectedCharge?.qualitaetsstufe && (
              <p className="text-xs text-s112-muted mt-1">
                Charge aktuell: <strong>{QUALITAET_LABEL[selectedCharge.qualitaetsstufe] ?? selectedCharge.qualitaetsstufe}</strong> – nur Abstufung möglich, keine Aufstufung
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Herkunft-Code (BKI)</label>
            <select name="herkunft_code" value={herkunftCodeVal} onChange={e => setHerkunftCodeVal(e.target.value)} className={inputCls}>
              <option value="">– keine Angabe –</option>
              {HERKUNFT_ORDER.map(code => (
                <option key={code} value={code}>{HERKUNFT_LABEL[code]}</option>
              ))}
            </select>
            {selectedCharge?.herkunft_code && (
              <p className="text-xs text-s112-muted mt-1">
                Charge aktuell: <strong>{HERKUNFT_LABEL[selectedCharge.herkunft_code] ?? selectedCharge.herkunft_code}</strong> – nur Abstufung möglich, keine Aufstufung
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Anbaugebiet</label>
            <input
              name="anbaugebiet"
              placeholder="z.B. Traisental, Wachau, Kamptal …"
              className={inputCls}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Subbezeichnung / Ried (optional)</label>
            <input
              name="bezeichnung"
              placeholder="z.B. Ried Hohenberg · Reserve · Alte Reben"
              className={inputCls}
            />
          </div>
        </div>
      </div>

      {/* Abfüllung */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 text-sm">Abfüllung</h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>DAC-Antrag / Prüfnummer</label>
            {selectedChargeId && dacAntraege.filter(d => d.weinausbau_id === selectedChargeId).length > 0 ? (
              <div className="space-y-2">
                <select value={selectedDacId} onChange={e => handleDacChange(e.target.value)} className={inputCls}>
                  <option value="">– kein DAC-Antrag –</option>
                  {dacAntraege.filter(d => d.weinausbau_id === selectedChargeId).map(d => (
                    <option key={d.id} value={d.id}>
                      {d.bezeichnung} · {d.pruefnummer ?? 'keine Prüfnr.'} ({d.status})
                    </option>
                  ))}
                </select>
                {selectedDacId && dacAntraege.find(d => d.id === selectedDacId)?.status !== 'genehmigt' && (
                  <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                    ⚠ DAC-Antrag noch nicht genehmigt – Abfüllung möglich, aber Prüfnummer fehlt.
                  </p>
                )}
              </div>
            ) : (
              <input name="pruefnummer_freitext" value={pruefnummerVal}
                onChange={e => setPruefnummerVal(e.target.value)}
                placeholder="z.B. AT 1234/2025" className={inputCls} />
            )}
            <input type="hidden" name="dac_antrag_id" value={selectedDacId} />
            <input type="hidden" name="pruefnummer" value={pruefnummerVal} />
          </div>
          <div>
            <label className={labelCls}>Chargennummer</label>
            <input
              name="chargennummer"
              placeholder="Leer lassen = wird automatisch vergeben"
              className={inputCls}
            />
            <p className="text-xs text-s112-muted mt-1">Leer lassen → automatisch z.B. CH-2025-001</p>
          </div>
          <div>
            <label className={labelCls}>Abfülldatum *</label>
            <input
              name="datum"
              type="date"
              defaultValue={new Date().toISOString().split('T')[0]}
              required
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Flaschengröße *</label>
            <select
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
            <input
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
            <div className={`${inputCls} bg-gray-50 text-gray-700 font-medium`}>
              {berechneteLiter !== null ? fmtL(berechneteLiter) : '–'}
            </div>
            {berechneteLiter !== null && (
              <input type="hidden" name="menge_liter_gefuellt" value={berechneteLiter} />
            )}
            <p className="text-xs text-s112-muted mt-1">
              {anzahl && groesse
                ? `${parseInt(anzahl).toLocaleString('de-AT')} Fl. × ${parseInt(groesse)} ml`
                : 'Wird aus Flaschen × Größe berechnet'}
            </p>
          </div>
        </div>

        {/* Schwund-Box */}
        {schwund !== null && berechneteLiter !== null && (
          <div className={`rounded-lg px-4 py-3 text-sm ${
            schwund < -bottleL
              ? 'bg-red-50 border border-red-200 text-red-700'
              : schwundWarning
              ? 'bg-amber-50 border border-amber-200 text-amber-700'
              : 'bg-green-50 border border-green-200 text-green-700'
          }`}>
            {schwund < -bottleL ? (
              <>⚠️ <strong>Überabfüllung:</strong> Abgefüllte Menge ({fmtL(berechneteLiter)}) übersteigt verfügbaren Bestand ({fmtL(verfuegbar)}) um {fmtL(Math.abs(schwund))}.</>
            ) : schwund < bottleL ? (
              <>✅ Charge wird vollständig abgefüllt. Kein/minimaler Schwund.</>
            ) : (
              <>🍶 <strong>Restwein / Schwund:</strong> {fmtL(schwund)} verbleiben nach der Abfüllung im Tank.</>
            )}
          </div>
        )}

        {/* Charge abschließen */}
        {schwund !== null && schwund > 0.01 && (
          <label className="flex items-start gap-3 cursor-pointer select-none">
            <input
              type="checkbox"
              name="abschliessen"
              value="true"
              checked={abschliessen}
              onChange={e => setAbschliessen(e.target.checked)}
              className="mt-0.5 w-4 h-4 accent-s112-teal"
            />
            <span className="text-sm text-gray-700">
              <strong>Charge nach dieser Füllung abschließen</strong>
              <span className="text-s112-muted ml-1">
                – {fmtL(schwund)} Restwein als Schwund ausbuchen, Status → Abgeschlossen
              </span>
            </span>
          </label>
        )}
      </div>

      {/* Preise */}
      <div className="card p-5 space-y-4">
        <h2 className="font-semibold text-gray-800 text-sm">Preise</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>VK-Preis brutto pro Flasche (€)</label>
            <input
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
            <input
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
        <h2 className="font-semibold text-gray-800 text-sm">Export (intern)</h2>
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
        <textarea
          name="notizen"
          rows={3}
          placeholder="Abfüllungsprotokoll, Besonderheiten …"
          className={inputCls + ' resize-none'}
        />
      </div>

      <div className="flex gap-3">
        <button
          type="submit"
          className="bg-s112-teal text-white px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
          Füllung anlegen
        </button>
        <Link href="/weinhandel" className="px-6 py-2 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800 transition-colors">
          Abbrechen
        </Link>
      </div>
    </form>
  )
}
