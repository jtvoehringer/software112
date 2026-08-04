'use client'

import { Fragment, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBehandlung } from '../actions'
import type { PSM, DuengemittelOption, WeingartenOption, GSTOption, KostenartOption, SatzOption } from './page'
import { SprayCan, Sprout, Layers, Scissors, Leaf, MoreHorizontal, Hourglass, Info, Ban, AlertTriangle } from 'lucide-react'

const BBCH_OPTIONS = [
  { value: '09', label: '09 – Knospenaufbruch' },
  { value: '11', label: '11 – 1. Blatt entfaltet' },
  { value: '53', label: '53 – Traubenanlage sichtbar' },
  { value: '55', label: '55 – Einzelblüten sichtbar' },
  { value: '57', label: '57 – Blütenstand gestreckt' },
  { value: '61', label: '61 – Beginn Blüte (10%)' },
  { value: '65', label: '65 – Vollblüte (50%)' },
  { value: '69', label: '69 – Ende Blüte' },
  { value: '71', label: '71 – Fruchtansatz' },
  { value: '73', label: '73 – Erbsengröße' },
  { value: '75', label: '75 – Haselnussgröße' },
  { value: '77', label: '77 – Trauben schließen sich' },
  { value: '81', label: '81 – Beginn Reife' },
  { value: '85', label: '85 – Weichwerden' },
  { value: '89', label: '89 – Vollreife' },
]
const WITTERUNG = ['sonnig', 'bewoelkt', 'regnerisch', 'wind']
const EINHEITEN_AUFWAND = ['kg_ha', 'l_ha', 'g_hl', 'ml_hl', 'kg', 'l']
const EINHEITEN_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl', ml_hl: 'ml/hl', kg: 'kg', l: 'l',
}
const ART_OPTIONS = [
  { value: 'spritzung',        label: 'Spritzung',        icon: SprayCan },
  { value: 'duengung',         label: 'Düngung',          icon: Sprout },
  { value: 'bodenbearbeitung', label: 'Bodenbearbeitung', icon: Layers },
  { value: 'schnitt',          label: 'Schnitt',          icon: Scissors },
  { value: 'laubarbeit',       label: 'Laubarbeit',       icon: Leaf },
  { value: 'sonstiges',        label: 'Sonstiges',        icon: MoreHorizontal },
]
const MENGE_EINHEITEN = ['kg', 'l', 'g', 'ml']
const LAUBARBEIT_OPTIONEN = [
  { value: 'entblaettern', label: 'Entblättern' },
  { value: 'ausgeizen',    label: 'Ausgeizen' },
  { value: 'gipfeln',      label: 'Gipfeln' },
  { value: 'heften',       label: 'Heften' },
  { value: 'sonstige',     label: 'Sonstige' },
]

// ─── Feld-Matrix je Maßnahmenart ──────────────────────────────────────────
// Steuert, welche Felder pro Art sichtbar/pflicht sind (siehe "Analyse Maßnahmen.docx", Tabelle 2).
// 'pflicht' | 'bedingt' | 'optional' | 'hidden'
type Sicht = 'pflicht' | 'bedingt' | 'optional' | 'hidden'
type Art = 'spritzung' | 'duengung' | 'bodenbearbeitung' | 'schnitt' | 'laubarbeit' | 'sonstiges'

const FELD_MATRIX: Record<Art, {
  psm: Sicht; duengemittel: Sicht; mengeGesamt: Sicht; aufwandmenge: Sicht; konzentration: Sicht
  bbch: Sicht; wasseraufwand: Sicht; schaderreger: Sicht; witterung: Sicht; temperatur: Sicht
  einarbeitung: Sicht; bearbeitung: Sicht; schnittart: Sicht; laubarbeitArt: Sicht
}> = {
  spritzung:        { psm: 'pflicht', duengemittel: 'hidden',  mengeGesamt: 'pflicht',  aufwandmenge: 'pflicht',  konzentration: 'optional', bbch: 'pflicht',  wasseraufwand: 'optional', schaderreger: 'pflicht',  witterung: 'optional', temperatur: 'optional', einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  duengung:         { psm: 'hidden', duengemittel: 'optional', mengeGesamt: 'pflicht',  aufwandmenge: 'optional', konzentration: 'hidden',   bbch: 'hidden',   wasseraufwand: 'hidden',   schaderreger: 'hidden',   witterung: 'optional', temperatur: 'hidden',   einarbeitung: 'bedingt', bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  bodenbearbeitung: { psm: 'hidden', duengemittel: 'hidden',   mengeGesamt: 'hidden',   aufwandmenge: 'hidden',   konzentration: 'hidden',   bbch: 'hidden',   wasseraufwand: 'hidden',   schaderreger: 'hidden',   witterung: 'optional', temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'pflicht', schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
  schnitt:          { psm: 'hidden', duengemittel: 'hidden',   mengeGesamt: 'hidden',   aufwandmenge: 'hidden',   konzentration: 'hidden',   bbch: 'hidden',   wasseraufwand: 'hidden',   schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'pflicht', laubarbeitArt: 'hidden'  },
  laubarbeit:       { psm: 'hidden', duengemittel: 'hidden',   mengeGesamt: 'hidden',   aufwandmenge: 'hidden',   konzentration: 'hidden',   bbch: 'optional', wasseraufwand: 'hidden',   schaderreger: 'hidden',   witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'pflicht' },
  sonstiges:        { psm: 'hidden', duengemittel: 'hidden', mengeGesamt: 'hidden', aufwandmenge: 'hidden',   konzentration: 'hidden',   bbch: 'hidden',   wasseraufwand: 'hidden',   schaderreger: 'optional', witterung: 'hidden',   temperatur: 'hidden',   einarbeitung: 'hidden',  bearbeitung: 'hidden',  schnittart: 'hidden',  laubarbeitArt: 'hidden'  },
}

function fmtHa(n: number) {
  return n.toLocaleString('de-AT', { maximumFractionDigits: 4 }) + ' ha'
}

function fmtEuro(n: number) {
  return n.toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const BIO_SPERRE = new Set(['bio_eu', 'biodynamisch'])
const BIO_WARNUNG = new Set(['kip', 'nachhaltig'])

export default function NeueBehandlungForm({
  psm, duengemittel, weingaerten, gstByWeingarten, bioStatus, kostenarten, saetzeMassnahmen,
}: {
  psm: PSM[]; duengemittel: DuengemittelOption[]
  weingaerten: WeingartenOption[]; gstByWeingarten: Record<string, GSTOption[]>
  bioStatus: string
  kostenarten: KostenartOption[]; saetzeMassnahmen: SatzOption[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [selectedPsmId, setSelectedPsmId] = useState('')
  const [selectedDuengemittelId, setSelectedDuengemittelId] = useState('')
  const [selectedWGs, setSelectedWGs] = useState<Set<string>>(new Set())
  const [selectedGSTs, setSelectedGSTs] = useState<Map<string, string>>(new Map())
  const [expandedWGs, setExpandedWGs] = useState<Set<string>>(new Set())
  const [riedenExpanded, setRiedenExpanded] = useState(false)
  const [art, setArt] = useState<Art>('spritzung')
  const [mengeGesamt, setMengeGesamt] = useState<string>('')
  const [mengeEinheit, setMengeEinheit] = useState('kg')
  const [error, setError] = useState<string | null>(null)

  // Kosten-Vorschlagsfunktion
  const [kostenAktiv, setKostenAktiv] = useState(false)
  const [kostenKostenartId, setKostenKostenartId] = useState('')
  const [selectedSatzId, setSelectedSatzId] = useState('')
  const [kostenBetrag, setKostenBetrag] = useState('')
  const [kostenBeschreibung, setKostenBeschreibung] = useState('')
  const betragManuellGeaendert = useRef(false)

  const felder = FELD_MATRIX[art]

  // Beim Wechsel der Art eine Mittel-Auswahl zurücksetzen, die zur neuen Art nicht mehr passt
  useEffect(() => {
    if (art !== 'spritzung' && art !== 'sonstiges') setSelectedPsmId('')
    if (art !== 'duengung') setSelectedDuengemittelId('')
    setSelectedSatzId('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art])

  // Gewähltes PSM / Düngemittel
  const selectedPsm = psm.find(p => p.id === selectedPsmId)
  const selectedDuengemittel = duengemittel.find(d => d.id === selectedDuengemittelId)

  // Bio-Status: harte Sperre bei Bio-EU/biodynamisch + nicht-öko-zugelassenem Mittel,
  // sonst nur Warnung bei KIP/nachhaltig (siehe "Analyse Maßnahmen.docx", 4.3)
  const gewaehltesMittelOeko =
    art === 'spritzung' || art === 'sonstiges' ? selectedPsm?.oeko_zugelassen :
    art === 'duengung'  ? selectedDuengemittel?.oeko_zugelassen :
    undefined
  const mittelNichtOeko = gewaehltesMittelOeko === false
  const bioSperre  = BIO_SPERRE.has(bioStatus) && mittelNichtOeko
  const bioWarnung = !bioSperre && BIO_WARNUNG.has(bioStatus) && mittelNichtOeko

  // Flache Lookup-Map für alle GST (id → GST-Objekt), für Flächenberechnung bei Einzelauswahl
  const gstLookup = new Map<string, GSTOption>()
  for (const gsts of Object.values(gstByWeingarten)) {
    for (const g of gsts) gstLookup.set(g.id, g)
  }

  const totalSelCount = selectedWGs.size + selectedGSTs.size

  // Gesamte aktive Fläche: ganze Rieden (gst_ha_aktiv) + einzeln gewählte GST
  const totalHaAktiv =
    weingaerten.filter(w => selectedWGs.has(w.id)).reduce((s, w) => s + w.gst_ha_aktiv, 0) +
    Array.from(selectedGSTs.keys()).reduce((s, gstId) => s + (gstLookup.get(gstId)?.flaeche_ha ?? 0), 0)

  // Aufwand pro ha (live berechnet)
  const aufwandProHa = mengeGesamt && totalHaAktiv > 0
    ? (parseFloat(mengeGesamt) / totalHaAktiv).toLocaleString('de-AT', { maximumFractionDigits: 3 }) + ' ' + mengeEinheit + '/ha'
    : null

  // Cu-Beitrag (live berechnet, nur für kg)
  const cuBeitragG = selectedPsm?.cu_gehalt_pct && mengeGesamt && mengeEinheit === 'kg'
    ? Math.round(parseFloat(mengeGesamt) * 1000 * ((selectedPsm.cu_gehalt_pct) / 100)).toLocaleString('de-AT') + ' g Cu'
    : null

  // ─── Kosten-Vorschlag: passende Hektarsätze für die aktuelle Art + Vorschlagssumme ──
  const passendeSaetze = saetzeMassnahmen.filter(s => s.art === art)
  const gewaehlterSatz = passendeSaetze.find(s => s.id === selectedSatzId) ?? passendeSaetze[0]

  const materialpreisProEinheit =
    art === 'spritzung' || art === 'sonstiges' ? selectedPsm?.preis_pro_einheit :
    art === 'duengung'  ? selectedDuengemittel?.preis_pro_einheit :
    undefined
  const materialkosten = materialpreisProEinheit && mengeGesamt
    ? materialpreisProEinheit * parseFloat(mengeGesamt)
    : 0
  const personalkosten = gewaehlterSatz && totalHaAktiv > 0
    ? gewaehlterSatz.satz_pro_ha * totalHaAktiv
    : 0
  const kostenVorschlag = materialkosten + personalkosten

  // Vorschlagsbetrag automatisch ins Feld übernehmen, solange der Nutzer es nicht selbst geändert hat
  useEffect(() => {
    if (!kostenAktiv) return
    if (betragManuellGeaendert.current) return
    setKostenBetrag(kostenVorschlag > 0 ? kostenVorschlag.toFixed(2) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kostenAktiv, kostenVorschlag])

  // Beschreibung automatisch vorschlagen, solange leer/unverändert
  useEffect(() => {
    if (!kostenAktiv) return
    if (kostenBeschreibung) return
    const artLabel = ART_OPTIONS.find(o => o.value === art)?.label ?? art
    setKostenBeschreibung(`${artLabel}${gewaehlterSatz ? ` – ${gewaehlterSatz.bezeichnung}` : ''}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kostenAktiv, art])

  // Weingärten nach Ried gruppieren
  const lagenMap = new Map<string, WeingartenOption[]>()
  for (const w of weingaerten) {
    const key = w.lage_name ?? '(Keine Ried)'
    const arr = lagenMap.get(key) ?? []
    arr.push(w)
    lagenMap.set(key, arr)
  }
  const lagen = Array.from(lagenMap.entries()).sort(([a], [b]) => a.localeCompare(b, 'de'))

  function toggleExpand(wgId: string) {
    setExpandedWGs(prev => { const n = new Set(prev); n.has(wgId) ? n.delete(wgId) : n.add(wgId); return n })
  }

  function toggleWG(id: string, spritzbar: boolean) {
    if (!spritzbar) return
    // Ried komplett auswählen ersetzt eine etwaige Einzel-GST-Auswahl dieser Ried
    setSelectedGSTs(prev => {
      const n = new Map(prev)
      for (const [gId, wId] of n) { if (wId === id) n.delete(gId) }
      return n
    })
    setSelectedWGs(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleGST(gstId: string, wgId: string) {
    const wasSelected = selectedGSTs.has(gstId)
    // Einzel-GST-Auswahl ersetzt eine etwaige Komplett-Auswahl der Ried
    setSelectedWGs(prev => { const n = new Set(prev); n.delete(wgId); return n })
    setSelectedGSTs(prev => {
      const n = new Map(prev)
      wasSelected ? n.delete(gstId) : n.set(gstId, wgId)
      return n
    })
  }

  function toggleLage(wgs: WeingartenOption[]) {
    const spritzbare = wgs.filter(w => w.spritzbar).map(w => w.id)
    const allSelected = spritzbare.length > 0 && spritzbare.every(id => selectedWGs.has(id))
    setSelectedGSTs(prev => {
      const n = new Map(prev)
      for (const [gId, wId] of n) { if (spritzbare.includes(wId)) n.delete(gId) }
      return n
    })
    setSelectedWGs(prev => {
      const next = new Set(prev)
      if (allSelected) {
        spritzbare.forEach(id => next.delete(id))
      } else {
        spritzbare.forEach(id => next.add(id))
      }
      return next
    })
  }

  function selectAll() {
    setSelectedGSTs(new Map())
    setSelectedWGs(new Set(weingaerten.filter(w => w.spritzbar).map(w => w.id)))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (totalSelCount === 0) { setError('Bitte mindestens eine Ried oder ein Grundstück auswählen.'); return }
    if (bioSperre) {
      setError('Dieses Mittel ist nicht öko-zugelassen und passt nicht zum Bio-Status des Betriebs. Bitte ein zugelassenes Mittel wählen.')
      return
    }
    const fd = new FormData(e.currentTarget)
    selectedWGs.forEach(id => fd.append('weingarten_ids', id))
    selectedGSTs.forEach((_wgId, gstId) => fd.append('grundstueck_ids', gstId))
    startTransition(async () => {
      try {
        await createBehandlung(fd)
        router.push('/behandlungen')
        router.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Art & Datum */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-gray-800">Maßnahme</h2>

        {/* Art der Maßnahme */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Art <span className="text-red-500">*</span></label>
          <div className="flex flex-wrap gap-2">
            {ART_OPTIONS.map(o => (
              <label key={o.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors
                ${art === o.value
                  ? 'bg-s112-teal text-white border-s112-teal'
                  : 'bg-white text-gray-700 border-s112-border hover:border-s112-teal/50'}`}>
                <input type="radio" name="art" value={o.value} checked={art === o.value}
                  onChange={() => setArt(o.value as Art)} className="sr-only" />
                <o.icon size={14} />{o.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Datum von <span className="text-red-500">*</span>
            </label>
            <input name="datum" type="date" required
              defaultValue={new Date().toISOString().split('T')[0]}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Datum bis</label>
            <input name="datum_bis" type="date"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>

        {/* PSM */}
        {felder.psm !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Spritzmittel / Mittel (PSM)
              {felder.psm === 'pflicht' && <span className="text-red-500"> *</span>}
            </label>
            <select name="psm_id" value={selectedPsmId} required={felder.psm === 'pflicht'}
              onChange={e => setSelectedPsmId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Auswählen –</option>
              {psm.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.handelsname ? ` (${p.handelsname})` : ''}
                  {p.oeko_zugelassen ? ' · Bio' : ''}
                  {p.cu_gehalt_pct ? ` · Cu ${p.cu_gehalt_pct}%` : ''}
                </option>
              ))}
            </select>
            {selectedPsm?.wartezeit_tage != null && (
              <p className="text-xs text-amber-600 mt-1 inline-flex items-center gap-1">
                <Hourglass size={12} />Wartezeit: {selectedPsm.wartezeit_tage} Tage vor Ernte
              </p>
            )}
            {selectedPsm?.cu_gehalt_pct ? (
              <p className="text-xs text-blue-600 mt-1 inline-flex items-center gap-1">
                <Info size={12} />Kupferhaltiges Mittel – Cu-Anteil: {selectedPsm.cu_gehalt_pct} %
              </p>
            ) : null}
            <input type="hidden" name="wartezeit_tage" value={selectedPsm?.wartezeit_tage ?? ''} />
          </div>
        )}

        {/* Düngemittel */}
        {felder.duengemittel !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Düngemittel
              {felder.duengemittel === 'pflicht' && <span className="text-red-500"> *</span>}
            </label>
            <select name="duengemittel_id" value={selectedDuengemittelId} required={felder.duengemittel === 'pflicht'}
              onChange={e => setSelectedDuengemittelId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Auswählen –</option>
              {duengemittel.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.handelsname ? ` (${d.handelsname})` : ''}
                  {d.typ ? ` · ${d.typ}` : ''}
                  {d.oeko_zugelassen ? ' · Bio' : ''}
                </option>
              ))}
            </select>
            {duengemittel.length === 0 && (
              <p className="text-xs text-s112-muted mt-1">
                Noch keine Düngemittel in den Stammdaten hinterlegt.
              </p>
            )}
            {selectedDuengemittel?.wartezeit_tage != null && (
              <p className="text-xs text-amber-600 mt-1 inline-flex items-center gap-1">
                <Hourglass size={12} />Wartezeit: {selectedDuengemittel.wartezeit_tage} Tage vor Ernte
              </p>
            )}
            <input type="hidden" name="wartezeit_tage" value={selectedDuengemittel?.wartezeit_tage ?? ''} />
          </div>
        )}

        {bioSperre && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <Ban size={16} className="mt-0.5 flex-shrink-0" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – passt nicht zum Bio-Status des Betriebs
            ({bioStatus === 'bio_eu' ? 'Bio-EU' : 'Biodynamisch'}). Absenden ist gesperrt, bitte ein zugelassenes Mittel wählen.</span>
          </div>
        )}
        {bioWarnung && (
          <div className="bg-amber-50 border border-amber-200 text-amber-700 rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – der Betrieb ist als {bioStatus === 'kip' ? 'KIP' : 'nachhaltig'} eingestuft. Bitte prüfen, ob das beabsichtigt ist.</span>
          </div>
        )}

        {/* Gesamtmenge */}
        {felder.mengeGesamt !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Gesamtmenge eingesetzt
              {felder.mengeGesamt === 'pflicht' && <span className="text-red-500"> *</span>}
            </label>
            <div className="flex gap-2">
              <input name="menge_gesamt" type="number" step="0.001" min="0"
                required={felder.mengeGesamt === 'pflicht'}
                placeholder="z.B. 2.4"
                value={mengeGesamt}
                onChange={e => setMengeGesamt(e.target.value)}
                className="flex-1 border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              <select name="menge_einheit" value={mengeEinheit}
                onChange={e => setMengeEinheit(e.target.value)}
                className="w-24 border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                {MENGE_EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            {/* Live-Zusammenfassung */}
            {(aufwandProHa || cuBeitragG) && (
              <div className="mt-2 bg-s112-bg rounded-lg px-3 py-2 text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                {totalHaAktiv > 0 && <span>Behandelte Fläche: <strong>{fmtHa(totalHaAktiv)}</strong></span>}
                {aufwandProHa && <span>≈ <strong>{aufwandProHa}</strong></span>}
                {cuBeitragG && <span className="text-blue-600">Cu-Eintrag: <strong>{cuBeitragG}</strong></span>}
              </div>
            )}
          </div>
        )}

        {(felder.aufwandmenge !== 'hidden' || felder.konzentration !== 'hidden') && (
          <div className="grid grid-cols-3 gap-3">
            {felder.aufwandmenge !== 'hidden' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Aufwandmenge (Etikett)
                    {felder.aufwandmenge === 'pflicht' && <span className="text-red-500"> *</span>}
                  </label>
                  <input name="aufwandmenge" type="number" step="0.001" min="0" placeholder="z.B. 3.0"
                    required={felder.aufwandmenge === 'pflicht'}
                    className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Einheit</label>
                  <select name="aufwandmenge_einheit"
                    className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                    {EINHEITEN_AUFWAND.map(e => <option key={e} value={e}>{EINHEITEN_LABEL[e]}</option>)}
                  </select>
                </div>
              </>
            )}
            {felder.konzentration !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Konzentration (%)</label>
                <input name="konzentration" type="number" step="0.01" min="0" max="100"
                  placeholder="z.B. 0.5"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
            )}
          </div>
        )}

        {(felder.bbch !== 'hidden' || felder.wasseraufwand !== 'hidden' || felder.schaderreger !== 'hidden') && (
          <div className="grid grid-cols-2 gap-3">
            {felder.bbch !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  BBCH-Stadium
                  {felder.bbch === 'pflicht' && <span className="text-red-500"> *</span>}
                </label>
                <select name="bbch_stadium" required={felder.bbch === 'pflicht'}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">– Auswählen –</option>
                  {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {felder.wasseraufwand !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Wasser (l/ha)</label>
                <input name="wasseraufwand_l_ha" type="number" step="1" min="0" placeholder="z.B. 500"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
            )}
            {felder.schaderreger !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {art === 'sonstiges' ? 'Grund / Anlass' : 'Schaderreger'}
                  {felder.schaderreger === 'pflicht' && <span className="text-red-500"> *</span>}
                </label>
                <input name="schaderreger" type="text" required={felder.schaderreger === 'pflicht'}
                  placeholder={art === 'sonstiges' ? 'z.B. Rodung' : 'z.B. Peronospora'}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
            )}
          </div>
        )}

        {/* Düngung: Einarbeitung (nur bei organischem Dünger relevant) */}
        {felder.einarbeitung !== 'hidden' && selectedDuengemittel?.typ === 'organisch' && (
          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" name="einarbeitung" className="accent-s112-teal" />
              Eingearbeitet
            </label>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Zeitpunkt Einarbeitung</label>
              <input name="einarbeitung_zeitpunkt" type="date"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        )}

        {/* Bodenbearbeitung */}
        {felder.bearbeitung !== 'hidden' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Bearbeitungstiefe (cm)
                {felder.bearbeitung === 'pflicht' && <span className="text-red-500"> *</span>}
              </label>
              <input name="bearbeitungstiefe_cm" type="number" step="1" min="0" placeholder="z.B. 10"
                required={felder.bearbeitung === 'pflicht'}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gerät
                {felder.bearbeitung === 'pflicht' && <span className="text-red-500"> *</span>}
              </label>
              <input name="bearbeitungsgeraet" type="text" placeholder="z.B. Grubber"
                required={felder.bearbeitung === 'pflicht'}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        )}

        {/* Schnitt */}
        {felder.schnittart !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Schnittart
              {felder.schnittart === 'pflicht' && <span className="text-red-500"> *</span>}
            </label>
            <input name="schnittart" type="text" placeholder="z.B. Guyot, Kordon"
              required={felder.schnittart === 'pflicht'}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        )}

        {/* Laubarbeit */}
        {felder.laubarbeitArt !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Art der Laubarbeit
              {felder.laubarbeitArt === 'pflicht' && <span className="text-red-500"> *</span>}
            </label>
            <select name="laubarbeit_art" required={felder.laubarbeitArt === 'pflicht'}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Auswählen –</option>
              {LAUBARBEIT_OPTIONEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {(felder.witterung !== 'hidden' || felder.temperatur !== 'hidden') && (
          <div className="grid grid-cols-2 gap-3">
            {felder.witterung !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Witterung</label>
                <select name="witterung"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">–</option>
                  {WITTERUNG.map(w => <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>)}
                </select>
              </div>
            )}
            {felder.temperatur !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Temperatur (°C)</label>
                <input name="temperatur_c" type="number" step="0.1" placeholder="z.B. 18.5"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Notizen</label>
          <textarea name="notizen" rows={2}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      {/* Ried(en)-Auswahl */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <button type="button"
            onClick={() => setRiedenExpanded(v => !v)}
            className="flex items-center gap-2 text-left">
            <svg className={`w-3.5 h-3.5 text-s112-muted transition-transform shrink-0 ${riedenExpanded ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <h2 className="text-base font-semibold text-gray-800">
              Ried(en) auswählen
              {totalSelCount > 0 && (
                <span className="ml-2 text-sm text-s112-teal font-normal">
                  {totalSelCount} ausgewählt · {fmtHa(totalHaAktiv)}
                </span>
              )}
            </h2>
          </button>
          {riedenExpanded && (
            <button type="button"
              onClick={selectAll}
              className="text-xs text-s112-teal hover:underline">
              Alle auswählen
            </button>
          )}
        </div>

        {riedenExpanded && (
        <div className="space-y-3">
          {lagen.map(([lageName, wgs]) => {
            const spritzbare = wgs.filter(w => w.spritzbar)
            const allSelected = spritzbare.length > 0 && spritzbare.every(w => selectedWGs.has(w.id))
            const someSelected = spritzbare.some(w => selectedWGs.has(w.id) || [...selectedGSTs.values()].includes(w.id))
            const lageHa = spritzbare.reduce((s, w) => {
              if (selectedWGs.has(w.id)) return s + w.gst_ha_aktiv
              const gsts = gstByWeingarten[w.id] ?? []
              return s + gsts.filter(g => selectedGSTs.has(g.id)).reduce((s2, g) => s2 + (g.flaeche_ha ?? 0), 0)
            }, 0)

            return (
              <div key={lageName} className="border border-s112-border rounded-xl overflow-hidden">
                {/* Lage-Header */}
                <div
                  className="flex items-center gap-3 px-3 py-2 bg-s112-bg cursor-pointer hover:bg-s112-bg/80 transition-colors"
                  onClick={() => toggleLage(wgs)}
                >
                  <input
                    type="checkbox"
                    readOnly
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    className="accent-s112-teal"
                  />
                  <span className="text-sm font-semibold text-gray-800">{lageName}</span>
                  <span className="text-xs text-s112-muted">{spritzbare.length} spritzbar</span>
                  {lageHa > 0 && (
                    <span className="ml-auto text-xs text-s112-teal">{fmtHa(lageHa)}</span>
                  )}
                </div>
                {/* Rieden mit GST-Feinauswahl */}
                <div className="divide-y divide-s112-border/40">
                  {wgs.map(w => {
                    const gsts = gstByWeingarten[w.id] ?? []
                    const isExpanded = expandedWGs.has(w.id)
                    const wgSel = selectedWGs.has(w.id)
                    const gstSelCount = gsts.filter(g => selectedGSTs.has(g.id)).length
                    const someGstSel = gstSelCount > 0
                    const allGstSel = gsts.length > 0 && gstSelCount === gsts.length
                    const isActive = wgSel || someGstSel

                    return (
                      <div key={w.id} className={!w.spritzbar ? 'bg-gray-50' : ''}>
                        <div className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors
                          ${w.spritzbar ? 'hover:bg-s112-bg/40' : 'opacity-40'}`}>
                          <input
                            type="checkbox"
                            checked={wgSel || allGstSel}
                            ref={el => { if (el) el.indeterminate = someGstSel && !allGstSel && !wgSel }}
                            onChange={() => toggleWG(w.id, w.spritzbar)}
                            disabled={!w.spritzbar}
                            className="accent-s112-teal cursor-pointer"
                          />
                          {gsts.length > 0 ? (
                            <button type="button" onClick={() => toggleExpand(w.id)}
                              className="flex items-center gap-1.5 flex-1 text-left"
                              disabled={!w.spritzbar}>
                              <svg className={`w-3 h-3 text-s112-muted transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                              <span className={`font-medium ${isActive ? 'text-s112-teal' : 'text-gray-800'}`}>{w.name}</span>
                              <span className="text-xs text-s112-muted">{gsts.length} GST</span>
                              {w.gst_ha_aktiv > 0 && (
                                <span className="text-xs text-s112-muted ml-auto">{fmtHa(w.gst_ha_aktiv)}</span>
                              )}
                            </button>
                          ) : (
                            <span className={`font-medium flex-1 ${isActive ? 'text-s112-teal' : 'text-gray-800'}`}>
                              {w.name}
                            </span>
                          )}
                          {!w.spritzbar && (
                            <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full">
                              Brache / Gerodet
                            </span>
                          )}
                        </div>
                        {isExpanded && gsts.length > 0 && w.spritzbar && (
                          <div className="bg-white border-t border-s112-border/20">
                            {gsts.map(g => {
                              const isGstSel = selectedGSTs.has(g.id)
                              return (
                                <Fragment key={g.id}>
                                  <label className={`flex items-center gap-2 pl-10 pr-4 py-1.5 text-xs cursor-pointer hover:bg-s112-bg/30 ${isGstSel ? 'bg-s112-teal/5' : ''}`}>
                                    <input type="checkbox"
                                      checked={isGstSel}
                                      onChange={() => toggleGST(g.id, w.id)}
                                      className="accent-s112-teal" />
                                    <span className={`font-mono ${isGstSel ? 'text-s112-teal font-medium' : 'text-gray-600'}`}>
                                      GST {g.gst_nr}
                                    </span>
                                    {g.rebsorte && <span className="text-s112-muted">· {g.rebsorte}</span>}
                                    {g.flaeche_ha != null && <span className="text-s112-muted ml-auto">{fmtHa(g.flaeche_ha)}</span>}
                                  </label>
                                </Fragment>
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
        )}

        {/* Zusammenfassung */}
        {totalSelCount > 0 && (
          <div className="mt-3 bg-s112-teal/5 border border-s112-teal/20 rounded-xl px-4 py-2.5 text-sm text-gray-700">
            <span className="font-semibold text-s112-teal">{selectedWGs.size}</span> Ried/Rieden
            {selectedGSTs.size > 0 && <> · <span className="font-semibold text-s112-teal">{selectedGSTs.size}</span> GST</>} ·{' '}
            <span className="font-semibold">{fmtHa(totalHaAktiv)}</span> aktive Fläche
            {aufwandProHa && <> · <span className="text-gray-500">≈ {aufwandProHa}</span></>}
            {cuBeitragG && <> · <span className="text-blue-600 font-medium">Cu: {cuBeitragG}</span></>}
          </div>
        )}
      </div>

      {/* Kosten-Vorschlagsfunktion (optional) */}
      <div className="card space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name="kosten_aktiv" checked={kostenAktiv}
            onChange={e => { setKostenAktiv(e.target.checked); betragManuellGeaendert.current = false }}
            className="accent-s112-teal" />
          <h2 className="text-base font-semibold text-gray-800">Kosten erfassen</h2>
        </label>
        <p className="text-xs text-s112-muted -mt-2">
          Optional: Material- und Personalkosten dieser Maßnahme automatisch vorschlagen (aus Mittelpreis
          und Hektarsätzen) und als Kosteneintrag in der Kostenrechnung anlegen.
        </p>

        {kostenAktiv && (
          <div className="space-y-3 pt-1">
            {(materialkosten > 0 || personalkosten > 0) && (
              <div className="bg-s112-bg rounded-lg px-3 py-2 text-xs text-gray-600 flex flex-wrap gap-x-4 gap-y-1">
                {materialkosten > 0 && <span>Material: <strong>{fmtEuro(materialkosten)} €</strong></span>}
                {personalkosten > 0 && (
                  <span>
                    Personal/Maschinen: <strong>{fmtEuro(personalkosten)} €</strong>
                    {gewaehlterSatz && <> ({fmtEuro(gewaehlterSatz.satz_pro_ha)} €/ha × {fmtHa(totalHaAktiv)})</>}
                  </span>
                )}
                <span>Vorschlag gesamt: <strong className="text-s112-teal">{fmtEuro(kostenVorschlag)} €</strong></span>
              </div>
            )}

            {passendeSaetze.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Hektarsatz</label>
                <select value={selectedSatzId || passendeSaetze[0].id}
                  onChange={e => { setSelectedSatzId(e.target.value); betragManuellGeaendert.current = false }}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  {passendeSaetze.map(s => (
                    <option key={s.id} value={s.id}>{s.bezeichnung} – {fmtEuro(s.satz_pro_ha)} €/ha</option>
                  ))}
                </select>
              </div>
            )}
            {passendeSaetze.length === 0 && (
              <p className="text-xs text-s112-muted">
                Für diese Maßnahmenart ist noch kein Hektarsatz hinterlegt (Betriebsmittel → Stundensätze).
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Kostenart</label>
                <select name="kosten_kostenart_id" value={kostenKostenartId}
                  onChange={e => setKostenKostenartId(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">– Auswählen –</option>
                  {kostenarten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Betrag (€)</label>
                <input name="kosten_betrag" type="number" step="0.01" min="0"
                  value={kostenBetrag}
                  onChange={e => { setKostenBetrag(e.target.value); betragManuellGeaendert.current = true }}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung</label>
              <input name="kosten_beschreibung" type="text" value={kostenBeschreibung}
                onChange={e => setKostenBeschreibung(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending || totalSelCount === 0 || bioSperre}
          className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : `Maßnahme erfassen (${totalSelCount} ausgewählt)`}
        </button>
        <a href="/behandlungen" className="px-5 py-2.5 rounded-xl text-sm font-medium text-gray-600 hover:text-gray-800">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
