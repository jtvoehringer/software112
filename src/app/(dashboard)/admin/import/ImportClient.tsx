'use client'
import { useState, useRef } from 'react'
import { Upload } from 'lucide-react'
import { createEroeffnungsbestandVonImport } from '@/app/(dashboard)/kellerbuch/gebinde-actions'
import { exportCSV } from '@/lib/utils/csv'

type ImportTyp = 'kontakte' | 'firmen' | 'fuellungen' | 'rieden_details' | 'grundstuecke' | 'gebinde'

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

// Rückmeldung 2.9.2026 ("besser lesbar machen, ohne Details anzeigen"): die
// Wertelisten (z.B. alle Segment-Werte) standen bisher direkt im Label und
// haben das Zuordnungs-Raster gesprengt. Jetzt kurzes Label + optionaler
// `hinweis`, der nur als Tooltip (ⓘ) erscheint.
const FELDER: Record<ImportTyp, { key: string; label: string; pflicht?: boolean; hinweis?: string }[]> = {
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
    { key: 'segment',    label: 'Segment', hinweis: 'Erlaubte Werte: privat, gastronomie, handel, export – unbekannte Werte werden zu „privat"' },
    { key: 'firma',      label: 'Firma', hinweis: 'Firmenname – der Kontakt wird einer bestehenden Firma dieses Betriebs zugeordnet (Namensabgleich, Groß-/Kleinschreibung egal). Firmen daher zuerst importieren; nicht gefundene Firmen landen als Vermerk in den Notizen.' },
    { key: 'notizen',    label: 'Notizen' },
  ],
  firmen: [
    { key: 'name',               label: 'Firmenname', pflicht: true },
    { key: 'email',              label: 'E-Mail' },
    { key: 'telefon',            label: 'Telefon' },
    { key: 'mobil',              label: 'Mobil' },
    { key: 'strasse',            label: 'Straße' },
    { key: 'plz',                label: 'PLZ' },
    { key: 'ort',                label: 'Ort' },
    { key: 'land',               label: 'Land' },
    { key: 'segment',            label: 'Segment', hinweis: 'Erlaubte Werte: gastronomie, handel, export, grosshandel, firmenkunde, vinothek, ab hof, restaurant, tourismus, medien, importeur, sonstige – unbekannte Werte werden zu „gastronomie"' },
    { key: 'uid_nummer',         label: 'UID-Nummer' },
    { key: 'betrieb_nr',         label: 'Betriebsnummer (BKI)' },
    { key: 'debitor_nr',         label: 'DebitorNr. (BMD-Konto)' },
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
  rieden_details: [
    { key: 'name',       label: 'Bezeichnung', pflicht: true },
    { key: 'ried',       label: 'Ried', hinweis: 'Zuordnung zu einer Ried-Bezeichnung – wird bei Bedarf automatisch angelegt' },
    { key: 'rebsorte',   label: 'Rebsorte' },
    { key: 'pflanzjahr', label: 'Pflanzjahr' },
    { key: 'weinart',    label: 'Weinart', hinweis: 'weiss, rot oder rose – leer = unbekannt' },
    { key: 'flaeche_ha', label: 'Fläche (ha)' },
  ],
  grundstuecke: [
    { key: 'gst_nr',              label: 'GST-Nummer', pflicht: true },
    { key: 'ried_flaeche',        label: 'Ried – Bezeichnung', pflicht: true, hinweis: 'Muss einer Ried aus dem Tab „Rieden (Details)" entsprechen' },
    { key: 'katastralgemeinde',   label: 'KGNr.' },
    { key: 'flaeche_ha',          label: 'Fläche lt. AMA (ha)' },
    { key: 'flaeche_ha_kataster', label: 'Fläche lt. Kataster (ha)' },
    { key: 'rebsorte',            label: 'Rebsorte' },
    { key: 'weinart',             label: 'Weinart', hinweis: 'weiss, rot oder rose – leer = unbekannt' },
    { key: 'pflanzjahr',          label: 'Pflanzjahr' },
    { key: 'ama_feldnummer',      label: 'AMA-Schlagnr.' },
    { key: 'boden',               label: 'Boden' },
    { key: 'bewirtschaftung',     label: 'Bewirtschaftung', hinweis: 'biodynamisch, biologisch, in_umstellung, nachhaltig, kip oder konventionell' },
    { key: 'nutzart',             label: 'Nutzart', hinweis: 'A = Grünbrache · G = Grünlandbrache · WI = Wein · GL1 = GLÖZ Rain/Böschung/Trockensteinmauer · GL2 = GLÖZ Hecke/Ufergehölz · GL3 = GLÖZ Feldgehölz/Baum/Gebüschgruppe · LSE = LSE Bäume/Büsche' },
  ],
  gebinde: [
    { key: 'name',           label: 'Bezeichnung', pflicht: true },
    { key: 'typ',            label: 'Typ', hinweis: 'lagertank, immervolltank, holzfass, betonei, amphore, bottich, gaerstaender, zisterne, presse, barrique, doppelbarrique oder sonstiges' },
    { key: 'volumen_liter',  label: 'Fassungsvermögen (Liter)' },
    { key: 'standort',       label: 'Standort' },
  ],
}

const TYP_LABEL: Record<ImportTyp, string> = {
  kontakte: 'Kontakte',
  firmen:   'Firmen',
  fuellungen: 'Füllungen (Weinlager)',
  rieden_details: 'Rieden',
  grundstuecke: 'Grundstücke',
  gebinde:  'Gebinde',
}

const ebInputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
const ebLabelCls = 'block text-xs font-medium text-gray-600 mb-1'

// Quote-bewusster CSV-Parser (RFC4180-artig). Ein Feld in Anführungszeichen
// darf das Trennzeichen (oder einen Zeilenumbruch) enthalten, z.B.
// "gumpoldskirchen.zierfandler thermenregion DAC;  bio-demeter" bei einer mit
// ';' getrennten Datei - der frühere naive line.split(';') hat solche Felder
// mitten im Wert aufgetrennt und dadurch ALLE nachfolgenden Spalten dieser
// Zeile um eine Position verschoben (Rückmeldung 2.9.2026: Füllungen-Import,
// "Bezeichnung"/"Gebinde" landeten dadurch vertauscht bzw. abgeschnitten in
// der falschen Spalte). Escaped-Quotes ("") innerhalb eines Feldes werden zu
// einem literalen " aufgelöst; ein führendes BOM (Excel-Export unter Windows)
// wird entfernt.
function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  const sep = firstLine.includes(';') ? ';' : ','

  const table: string[][] = []
  let field = ''
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else { inQuotes = false }
      } else {
        field += c
      }
    } else if (c === '"') {
      inQuotes = true
    } else if (c === sep) {
      row.push(field); field = ''
    } else if (c === '\r') {
      // ignorieren, das folgende '\n' beendet die Zeile
    } else if (c === '\n') {
      row.push(field); table.push(row); row = []; field = ''
    } else {
      field += c
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); table.push(row) }

  const trimmed = table.map(r => r.map(v => v.trim())).filter(r => r.some(v => v !== ''))
  if (trimmed.length < 2) return { headers: [], rows: [] }
  const headers = trimmed[0]
  const rows = trimmed.slice(1).map(vals => Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ''])))
  return { headers, rows }
}

const ALLE_TYPEN = Object.keys(TYP_LABEL) as ImportTyp[]

// Vorbelegung des Herkunftstexts; muss mit HERKUNFT_DEFAULT in api/import/route.ts
// übereinstimmen (dort Fallback, falls der Client nichts mitschickt).
const HERKUNFT_DEFAULT = 'Datenmigration aus Drittsystem'

// Große Dateien blockweise an die API schicken (Rückmeldung 3.9.2026: Dynamics-
// Leads mit 4.200 Firmen / 7.900 Kontakten). Ein Request pro Datei würde am
// Laufzeitlimit der Serverfunktion scheitern; die API verarbeitet ohnehin Zeile
// für Zeile, ein Block ist daher fachlich gleichwertig. Zeilennummern in den
// Meldungen bleiben über zeilenOffset korrekt.
const IMPORT_BLOCKGROESSE = 100

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
  // Nur relevant für Kontakte/Firmen (Rückmeldung 1.9.2026: Kunden und Leads
  // werden bewusst getrennt importiert; bei einem Lead-Import werden bereits
  // aktive Kunden per Name/E-Mail erkannt und nicht dupliziert, siehe unten).
  const [istLead, setIstLead]       = useState(true)
  // Herkunftstext (Rückmeldung 2.9.2026): wird an jedem importierten Datensatz
  // hinterlegt - sichtbar vorangestellt im Notizen-Feld und strukturiert in
  // import_quelle/importiert_am (Migration 192), damit Import-Datensätze später
  // filter- und gesammelt bereinigbar sind. Pro Import anpassbar, z.B. auf den
  // Namen des Altsystems.
  const [herkunft, setHerkunft]     = useState(HERKUNFT_DEFAULT)
  const [importing, setImporting]   = useState(false)
  const [result, setResult]         = useState<{
    ok: number; fehler: number; details: string[]
    duplikate?: { zeile: number; name: string; email: string | null; grund: string }[]
  } | null>(null)
  // Separater State fuer echte Fehlerantworten (401/403/500). Die API liefert bei
  // Erfolg { ok, fehler: <Anzahl>, details: [...] }, bei Ablehnung/Absturz aber nur
  // { fehler: '<Text>' } OHNE details/ok - dieselbe "result"-Variable fuer beide
  // Faelle zu verwenden fuehrte dazu, dass result.details.length beim Rendern auf
  // undefined traf und die ganze Seite mit einem unbehandelten Absturz beendete,
  // noch bevor der eigentliche Fehlertext (z.B. "Keine Berechtigung") sichtbar wurde.
  const [errorMsg, setErrorMsg]     = useState<string | null>(null)
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

  const [fortschritt, setFortschritt] = useState<{ erledigt: number; gesamt: number } | null>(null)

  async function startImport() {
    if (!parsed) return
    setImporting(true); setResult(null); setErrorMsg(null)
    const gesamt = parsed.rows.length
    const summe = { ok: 0, fehler: 0, details: [] as string[], duplikate: [] as { zeile: number; name: string; email: string | null; grund: string }[] }
    try {
      for (let start = 0; start < gesamt; start += IMPORT_BLOCKGROESSE) {
        setFortschritt({ erledigt: start, gesamt })
        const block = parsed.rows.slice(start, start + IMPORT_BLOCKGROESSE)
        const res = await fetch('/api/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ typ, rows: block, mapping, istLead, herkunft: herkunft.trim() || HERKUNFT_DEFAULT, zeilenOffset: start }),
        })
        const data = await res.json()
        // Bei 401/403/500 liefert die API nur { fehler: '<Text>' } ohne ok/details -
        // als eigenen Fehlertext behandeln statt als (unvollstaendiges) Erfolgsergebnis,
        // sonst crasht die details.length-Anzeige weiter unten mit einem leeren Bildschirm.
        if (!res.ok) {
          setErrorMsg((typeof data?.fehler === 'string' ? data.fehler : `Fehler (Status ${res.status})`)
            + (start > 0 ? ` – abgebrochen nach ${start} von ${gesamt} Zeilen (bereits importierte Zeilen bleiben erhalten)` : ''))
          break
        }
        summe.ok += Number(data.ok ?? 0)
        summe.fehler += Number(data.fehler ?? 0)
        summe.details.push(...((data.details ?? []) as string[]))
        summe.duplikate.push(...((data.duplikate ?? []) as typeof summe.duplikate))
        setResult({ ...summe, details: [...summe.details], duplikate: [...summe.duplikate] })
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
      setFortschritt(null)
    }
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
          <button key={t} onClick={() => { setTyp(t); setParsed(null); setMapping({}); setResult(null); setErrorMsg(null) }}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
              typ === t ? 'bg-s112-teal text-white border-s112-teal' : 'border-s112-border text-gray-600 hover:bg-s112-bg'
            }`}>
            {TYP_LABEL[t]}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-s112-border p-4 mb-5 flex flex-wrap items-center gap-4">
        <label htmlFor="import-herkunft" className="text-sm font-medium text-gray-700">Herkunft:</label>
        <input
          id="import-herkunft"
          type="text"
          value={herkunft}
          onChange={e => setHerkunft(e.target.value)}
          maxLength={120}
          placeholder={HERKUNFT_DEFAULT}
          className="flex-1 min-w-[16rem] border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal"
        />
        <span className="text-xs text-s112-muted basis-full">
          Wird an jedem importierten Datensatz hinterlegt (im Notizen-Feld vorangestellt und als Import-Kennzeichen gespeichert),
          damit sich Import-Daten später von manuell angelegten unterscheiden lassen. Bei Bedarf anpassen, z.&nbsp;B. auf den Namen des Altsystems.
        </span>
      </div>

      {(typ === 'kontakte' || typ === 'firmen') && (
        <div className="bg-white rounded-2xl border border-s112-border p-4 mb-5 flex flex-wrap items-center gap-4">
          <span className="text-sm font-medium text-gray-700">Diese Datei enthält:</span>
          <div className="flex gap-1">
            {(['lead', 'kunde'] as const).map(v => (
              <button key={v} onClick={() => setIstLead(v === 'lead')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  (v === 'lead') === istLead ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:text-gray-900'
                }`}>
                {v === 'lead' ? 'Leads' : 'Aktive Kunden'}
              </button>
            ))}
          </div>
          {istLead && (
            <span className="text-xs text-s112-muted">
              Datensätze, die per Name oder E-Mail bereits als aktiver Kunde vorhanden sind, werden beim Import übersprungen und als Duplikat ausgewiesen.
            </span>
          )}
        </div>
      )}

      {typ === 'rieden_details' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-800">
          Legt Rieden mit vollen Detailfeldern (Rebsorte, Pflanzjahr, Fläche, …) an. Die Spalte
          &quot;Ried&quot; ordnet einer bestehenden Ried-Bezeichnung zu – gibt es noch keine passende,
          wird sie automatisch mit angelegt.
        </div>
      )}
      {typ === 'grundstuecke' && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-sm text-blue-800">
          Setzt voraus, dass die zugehörige Ried bereits über den Tab &quot;Rieden&quot;
          angelegt wurde (Zuordnung über die Spalte &quot;Ried – Bezeichnung&quot;, exakter Namensabgleich).
        </div>
      )}

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
                <label className="text-sm text-gray-700 w-48 flex-shrink-0 inline-flex items-center gap-1 min-w-0">
                  <span className="truncate" title={f.label}>{f.label}</span>
                  {f.pflicht && <span className="text-red-500">*</span>}
                  {f.hinweis && (
                    <span title={f.hinweis} aria-label={f.hinweis}
                      className="inline-flex items-center justify-center w-4 h-4 rounded-full border border-s112-border text-[10px] text-s112-muted cursor-help flex-shrink-0">
                      i
                    </span>
                  )}
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
            {importing
              ? (fortschritt ? `Importiere… ${fortschritt.erledigt} / ${fortschritt.gesamt}` : 'Importiere…')
              : `${parsed.rows.length} Zeilen importieren`}
          </button>

          {errorMsg && (
            <div className="mt-4 p-4 rounded-xl border bg-red-50 border-red-200">
              <p className="font-semibold text-sm text-red-700">Import fehlgeschlagen: {errorMsg}</p>
            </div>
          )}

          {result && (
            <div className={`mt-4 p-4 rounded-xl border ${result.fehler === 0 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}`}>
              <p className="font-semibold text-sm">
                {result.ok} erfolgreich · {result.fehler} Fehler
                {(result.duplikate?.length ?? 0) > 0 && ` · ${result.duplikate!.length} Duplikate übersprungen`}
              </p>
              {(result.details ?? []).length > 0 && (
                <ul className="mt-2 text-xs text-gray-600 space-y-0.5">
                  {result.details.slice(0, 10).map((d, i) => <li key={i}>{d}</li>)}
                  {result.details.length > 10 && <li>… und {result.details.length - 10} weitere</li>}
                </ul>
              )}
              {(result.duplikate?.length ?? 0) > 0 && (
                <div className="mt-3 pt-3 border-t border-amber-200">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold text-gray-700">Übersprungene Duplikate (bereits aktiver Kunde):</p>
                    <button
                      onClick={() => exportCSV(
                        result.duplikate!.map(d => ({ zeile: d.zeile, name: d.name, email: d.email ?? '', grund: d.grund })),
                        [
                          { key: 'zeile', header: 'Zeile' },
                          { key: 'name', header: 'Name' },
                          { key: 'email', header: 'E-Mail' },
                          { key: 'grund', header: 'Grund' },
                        ],
                        `import_duplikate_${typ}.csv`,
                      )}
                      className="text-xs text-s112-teal hover:underline font-medium">
                      Als CSV herunterladen
                    </button>
                  </div>
                  <ul className="text-xs text-gray-600 space-y-0.5">
                    {result.duplikate!.slice(0, 10).map((d, i) => (
                      <li key={i}>Zeile {d.zeile}: {d.name}{d.email ? ` (${d.email})` : ''}</li>
                    ))}
                    {result.duplikate!.length > 10 && <li>… und {result.duplikate!.length - 10} weitere (siehe CSV)</li>}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
