'use client'
import { useState, useRef } from 'react'
import { Upload } from 'lucide-react'
import { createEroeffnungsbestandVonImport } from '@/app/(dashboard)/kellerbuch/gebinde-actions'

type ImportTyp = 'kontakte' | 'firmen' | 'fuellungen' | 'rieden' | 'gebinde'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const QUALITAETEN = [
  { value: 'qualitaetswein',       label: 'Qualitätswein' },
  { value: 'kabinett',             label: 'Kabinett' },
  { value: 'spaetlese',            label: 'Spätlese' },
  { value: 'auslese',              label: 'Auslese' },
  { value: 'beerenauslese',        label: 'Beerenauslese' },
  { value: 'trockenbeerenauslese', label: 'Trockenbeerenauslese (TBA)' },
  { value: 'eiswein',              label: 'Eiswein' },
  { value: 'strohwein',            label: 'Strohwein / Schilfwein' },
  { value: 'dac',                  label: 'DAC' },
  { value: 'reserve',              label: 'Reservé / Reserve' },
  { value: 'erste_lage',           label: 'Erste Lage (ÖTW)' },
  { value: 'grosses_gewachs',      label: 'Großes Gewächs' },
  { value: 'landwein',             label: 'Landwein' },
  { value: 'sekt',                 label: 'Sekt b.A.' },
  { value: 'perlwein',             label: 'Perlwein' },
  { value: 'sonstiges',            label: 'Sonstiges' },
]

const FELDER: Record<ImportTyp, { key: string; label: string; pflicht?: boolean }[]> = {
  kontakte: [
    { key: 'vorname',    label: 'Vorname' },
    { key: 'nachname',   label: 'Nachname', pflicht: true },
    { key: 'email',      label: 'E-Mail' },
    { key: 'telefon',    label: 'Telefon' },
    { key: 'mobil',      label: 'Mobil' },
    { key: 'strasse',    label: 'Straße' },
    { key: 'plz',        label: 'PLZ' },
    { key: 'ort',        label: 'Ort' },
    { key: 'land',       label: 'Land' },
    { key: 'segment',    label: 'Segment (privat/gastro/handel/export)' },
    { key: 'notizen',    label: 'Notizen' },
  ],
  firmen: [
    { key: 'name',               label: 'Firmenname', pflicht: true },
    { key: 'email',              label: 'E-Mail' },
    { key: 'telefon',            label: 'Telefon' },
    { key: 'strasse',            label: 'Straße' },
    { key: 'plz',                label: 'PLZ' },
    { key: 'ort',                label: 'Ort' },
    { key: 'land',               label: 'Land' },
    { key: 'segment',            label: 'Segment (gastro/handel/export/grosshandel)' },
    { key: 'uid_nummer',         label: 'UID-Nummer' },
    { key: 'zahlungsziel_tage',  label: 'Zahlungsziel (Tage)' },
    { key: 'notizen',            label: 'Notizen' },
  ],
  fuellungen: [
    { key: 'bezeichnung',         label: 'Bezeichnung', pflicht: true },
    { key: 'jahrgang',            label: 'Jahrgang' },
    { key: 'rebsorte',            label: 'Rebsorte' },
    { key: 'flaschengroesse_ml',  label: 'Flaschengröße ml' },
    { key: 'lagerbestand_fl',     label: 'Lagerbestand (Flaschen)' },
    { key: 'vk_preis_brutto',     label: 'VK-Preis Brutto (€)' },
    { key: 'einkaufspreis',       label: 'Einkaufspreis (€)' },
    { key: 'notizen',             label: 'Notizen' },
  ],
  rieden: [
    { key: 'name',      label: 'Bezeichnung (Ried)', pflicht: true },
    { key: 'notizen',   label: 'Notizen' },
  ],
  gebinde: [
    { key: 'name',           label: 'Bezeichnung', pflicht: true },
    { key: 'typ',            label: 'Typ (lagertank/immervolltank/holzfass/betonei/amphore/sonstiges)' },
    { key: 'volumen_liter',  label: 'Fassungsvermögen (Liter)' },
    { key: 'standort',       label: 'Standort' },
  ],
}

const TYP_LABEL: Record<ImportTyp, string> = {
  kontakte: 'Kontakte',
  firmen:   'Firmen',
  fuellungen: 'Füllungen (Weinlager)',
  rieden:   'Rieden',
  gebinde:  'Gebinde',
}

const ebInputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
const ebLabelCls = 'block text-xs font-medium text-gray-600 mb-1'

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.trim().split('\n').filter(Boolean)
  if (lines.length < 2) return { headers: [], rows: [] }
  const sep = lines[0].includes(';') ? ';' : ','
  const headers = lines[0].split(sep).map(h => h.trim().replace(/^"|"$/g, ''))
  const rows = lines.slice(1).map(line => {
    const vals = line.split(sep).map(v => v.trim().replace(/^"|"$/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
  })
  return { headers, rows }
}

const ALLE_TYPEN = Object.keys(TYP_LABEL) as ImportTyp[]

export default function ImportClient({
  gebinde = [],
  initialTyp,
  ebOk = false,
  ebErr,
}: {
  gebinde?: R[]
  initialTyp?: string
  ebOk?: boolean
  ebErr?: string
}) {
  const startTyp = (ALLE_TYPEN as string[]).includes(initialTyp ?? '') ? (initialTyp as ImportTyp) : 'kontakte'
  const [typ, setTyp]               = useState<ImportTyp>(startTyp)
  const [csvText, setCsvText]       = useState('')
  const [parsed, setParsed]         = useState<{ headers: string[]; rows: Record<string, string>[] } | null>(null)
  const [mapping, setMapping]       = useState<Record<string, string>>({})
  const [importing, setImporting]   = useState(false)
  const [result, setResult]         = useState<{ ok: number; fehler: number; details: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const text = ev.target?.result as string
      setCsvText(text)
      const p = parseCsv(text)
      setParsed(p)
      // Auto-Mapping: CSV-Spalte = Feldname
      const autoMap: Record<string, string> = {}
      FELDER[typ].forEach(f => {
        const match = p.headers.find(h =>
          h.toLowerCase() === f.key.toLowerCase() ||
          h.toLowerCase() === f.label.toLowerCase()
        )
        if (match) autoMap[f.key] = match
      })
      setMapping(autoMap)
      setResult(null)
    }
    reader.readAsText(file, 'UTF-8')
  }

  async function startImport() {
    if (!parsed) return
    setImporting(true); setResult(null)
    const res = await fetch('/api/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ typ, rows: parsed.rows, mapping }),
    })
    const data = await res.json()
    setResult(data)
    setImporting(false)
  }

  const felder = FELDER[typ]
  const pflichtMapped = felder.filter(f => f.pflicht).every(f => mapping[f.key])

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <span>Administration</span>
        <span>/</span>
        <span className="text-gray-700 font-medium">Datenimport</span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2 flex items-center gap-2">
        <Upload className="w-6 h-6" /> Datenimport
      </h1>
      <p className="text-sm text-s112-muted mb-6">CSV-Datei importieren – Semikolon oder Komma als Trennzeichen</p>

      {/* Typ-Wahl */}
      <div className="flex gap-3 mb-6">
        {(Object.keys(TYP_LABEL) as ImportTyp[]).map(t => (
          <button key={t} onClick={() => { setTyp(t); setParsed(null); setMapping({}); setResult(null) }}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
              typ === t ? 'bg-s112-teal text-white border-s112-teal' : 'border-s112-border text-gray-600 hover:bg-s112-bg'
            }`}>
            {TYP_LABEL[t]}
          </button>
        ))}
      </div>

      {/* Anfangsbestandsbuchung: Charge aus Altsystem übernehmen - nur bei Gebinde, und
          bewusst nur hier im Datenimport angeboten (nicht als eigener Menüpunkt). Nutzt
          dieselbe Server-Action wie die Eröffnungsbestand-Erfassung im Kellerbuch
          ("Chargenformular recyceln"), leitet nach dem Speichern aber hierher zurück. */}
      {typ === 'gebinde' && (
        <div className="bg-white rounded-2xl border border-s112-border p-6 mb-5">
          <h2 className="font-semibold text-gray-800 mb-1">Anfangsbestandsbuchung: Charge aus Altsystem übernehmen</h2>
          <p className="text-sm text-s112-muted mb-4">
            Einzelne Charge mit Restbestand aus dem Altsystem direkt in ein Gebinde einbuchen (Bestand wird auf den 1.1. des laufenden Jahres gebucht).
          </p>

          {ebOk && (
            <div className="mb-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-700">
              Anfangsbestand wurde gespeichert.
            </div>
          )}
          {ebErr && (
            <div className="mb-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700">
              <strong>Fehler beim Speichern:</strong> {ebErr}
            </div>
          )}

          <details className="group">
            <summary className="cursor-pointer font-semibold text-sm text-gray-800 select-none">
              + Anfangsbestand erfassen
            </summary>
            <form action={createEroeffnungsbestandVonImport} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className={ebLabelCls}>Weinbezeichnung *</label>
                <input name="name" required placeholder="z.B. Grüner Veltliner Ried Hohenberg" className={ebInputCls} />
              </div>
              <div>
                <label className={ebLabelCls}>Gebinde</label>
                <select name="behaelter_id" className={ebInputCls}>
                  <option value="">– kein –</option>
                  {gebinde.map((g: R) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ebLabelCls}>Jahrgang</label>
                <input name="jahrgang" type="number" min={1900} max={2100}
                  defaultValue={new Date().getFullYear() - 1} className={ebInputCls} />
              </div>
              <div>
                <label className={ebLabelCls}>KMW (°KMW)</label>
                <input name="kmw" type="number" step="0.1" min={0} max={50}
                  placeholder="z.B. 17.5" className={ebInputCls} />
              </div>
              <div>
                <label className={ebLabelCls}>Menge (Liter) *</label>
                <input name="menge_liter" type="number" step="0.01" min={0}
                  required placeholder="z.B. 3000" className={ebInputCls} />
              </div>
              <div>
                <label className={ebLabelCls}>Einstandspreis pro Liter (€)</label>
                <input name="einstandspreis_pro_liter" type="text" inputMode="decimal"
                  placeholder="z.B. 1,50" className={ebInputCls} />
              </div>
              <div>
                <label className={ebLabelCls}>Qualitätsstufe</label>
                <select name="qualitaetsstufe" className={ebInputCls}>
                  <option value="">– keine –</option>
                  {QUALITAETEN.map(q => (
                    <option key={q.value} value={q.value}>{q.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={ebLabelCls}>Referenz Altsystem</label>
                <input name="referenz_altsystem" placeholder="z.B. Chargen-Nr. Altsystem" className={ebInputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={ebLabelCls}>Notizen</label>
                <input name="notizen" placeholder="z.B. Herkunft Altsystem …" className={ebInputCls} />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
                  Anfangsbestand speichern
                </button>
              </div>
            </form>
          </details>
        </div>
      )}

      {/* CSV-Upload */}
      <div className="bg-white rounded-2xl border border-s112-border p-6 mb-5">
        <h2 className="font-semibold text-gray-800 mb-3">1. CSV-Datei wählen</h2>
        <div className="flex items-center gap-4">
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} className="hidden" />
          <button onClick={() => fileRef.current?.click()}
            className="bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-opacity-90">
            CSV-Datei öffnen
          </button>
          {parsed && (
            <p className="text-sm text-green-600 font-medium">
              {parsed.rows.length} Zeilen geladen · {parsed.headers.length} Spalten
            </p>
          )}
        </div>

        {/* Vorschau */}
        {parsed && parsed.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <p className="text-xs text-s112-muted mb-2">Erste 3 Zeilen:</p>
            <table className="text-xs border border-s112-border rounded">
              <thead className="bg-s112-bg">
                <tr>{parsed.headers.map(h => <th key={h} className="px-2 py-1 text-left border-r border-s112-border">{h}</th>)}</tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 3).map((row, i) => (
                  <tr key={i} className="border-t border-s112-border">
                    {parsed.headers.map(h => <td key={h} className="px-2 py-1 border-r border-s112-border truncate max-w-24">{row[h] ?? ''}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Spalten-Mapping */}
      {parsed && (
        <div className="bg-white rounded-2xl border border-s112-border p-6 mb-5">
          <h2 className="font-semibold text-gray-800 mb-4">2. Spalten zuordnen</h2>
          <div className="grid grid-cols-2 gap-3">
            {felder.map(f => (
              <div key={f.key} className="flex items-center gap-3">
                <label className="text-sm text-gray-700 w-48 flex-shrink-0">
                  {f.label}{f.pflicht && <span className="text-red-500 ml-1">*</span>}
                </label>
                <select value={mapping[f.key] ?? ''} onChange={e => setMapping(m => ({ ...m, [f.key]: e.target.value }))}
                  className="flex-1 border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">– nicht importieren –</option>
                  {parsed.headers.map(h => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import starten */}
      {parsed && (
        <div className="bg-white rounded-2xl border border-s112-border p-6">
          <h2 className="font-semibold text-gray-800 mb-4">3. Import starten</h2>
          {!pflichtMapped && (
            <p className="text-sm text-amber-600 mb-3">Bitte alle Pflichtfelder (*) zuordnen</p>
          )}
          <button onClick={startImport} disabled={importing || !pflichtMapped}
            className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
            {importing ? 'Importiere…' : `${parsed.rows.length} Zeilen importieren`}
          </button>

          {result && (
            <div className={`mt-4 p-4 rounded-xl border ${result.fehler === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="font-semibold text-sm">
                {result.ok} erfolgreich · {result.fehler} Fehler
              </p>
              {result.details.length > 0 && (
                <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
                  {result.details.slice(0, 10).map((d, i) => <li key={i}>{d}</li>)}
                  {result.details.length > 10 && <li>… und {result.details.length - 10} weitere</li>}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
