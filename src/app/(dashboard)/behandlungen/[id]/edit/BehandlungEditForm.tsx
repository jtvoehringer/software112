'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBehandlung } from '../../actions'
import type { KostenartOption } from '../../neu/page'
import { SprayCan, Sprout, Layers, Scissors, Leaf, MoreHorizontal, Hourglass, Ban, AlertTriangle } from 'lucide-react'

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
const SCHADERREGER_OPTIONEN = ['Oidium', 'Peronospora', 'Botrytis']
const LAUBARBEIT_OPTIONEN = [
  { value: 'entblaettern', label: 'Entblättern' },
  { value: 'ausgeizen',    label: 'Ausgeizen' },
  { value: 'gipfeln',      label: 'Gipfeln' },
  { value: 'heften',       label: 'Heften' },
  { value: 'sonstige',     label: 'Sonstige' },
]

// ─── Feld-Matrix je Maßnahmenart ──────────────────────────────────────────
// Steuert, welche Mengen-Felder pro Art sichtbar/pflicht sind - identisch zur
// Matrix im Anlegen-Formular (NeueBehandlungForm.tsx), damit Anlegen und
// Bearbeiten konsistent sind (siehe "Analyse Maßnahmen.docx", Tabelle 2).
type Sicht = 'pflicht' | 'bedingt' | 'optional' | 'hidden'
type Art = 'spritzung' | 'duengung' | 'bodenbearbeitung' | 'schnitt' | 'laubarbeit' | 'sonstiges'

const FELD_MATRIX: Record<Art, { mengeGesamt: Sicht; aufwandmenge: Sicht; konzentration: Sicht; wasseraufwand: Sicht }> = {
  spritzung:        { mengeGesamt: 'pflicht', aufwandmenge: 'pflicht',  konzentration: 'optional', wasseraufwand: 'optional' },
  duengung:         { mengeGesamt: 'pflicht', aufwandmenge: 'optional', konzentration: 'hidden',   wasseraufwand: 'hidden'   },
  bodenbearbeitung: { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'   },
  schnitt:          { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'   },
  laubarbeit:       { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'   },
  sonstiges:        { mengeGesamt: 'hidden',  aufwandmenge: 'hidden',   konzentration: 'hidden',   wasseraufwand: 'hidden'   },
}

const BIO_SPERRE = new Set(['bio_eu', 'biodynamisch'])
const BIO_WARNUNG = new Set(['kip', 'nachhaltig'])

export type BehandlungEdit = {
  id: string
  datum: string
  datum_bis: string | null
  art: string
  psm_id: string | null
  duengemittel_id: string | null
  aufwandmenge: number | null
  aufwandmenge_einheit: string | null
  menge_gesamt: number | null
  menge_einheit: string | null
  konzentration: number | null
  wasseraufwand_l_ha: number | null
  reinkupfer_kg_ha: number | null
  bbch_stadium: string | null
  schaderreger: string | null
  witterung: string | null
  temperatur_c: number | null
  notizen: string | null
  bearbeitungstiefe_cm: number | null
  bearbeitungsgeraet: string | null
  schnittart: string | null
  laubarbeit_art: string | null
  einarbeitung: boolean | null
  einarbeitung_zeitpunkt: string | null
  wartezeit_tage: number | null
  weingarten_name: string | null
}

export type PSMOption = {
  id: string
  name: string
  handelsname: string | null
  oeko_zugelassen: boolean
  cu_gehalt_pct: number | null
  wartezeit_tage: number | null
}

export type DuengemittelOption = {
  id: string
  name: string
  handelsname: string | null
  typ: string | null
  wartezeit_tage: number | null
  oeko_zugelassen: boolean
}

export type BestehenderKostenEintrag = {
  kostenart_id: string | null
  betrag: number
  beschreibung: string | null
}

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
const labelCls = 'block text-sm font-medium text-s112-text-1 mb-1'

export default function BehandlungEditForm({
  behandlung, psm, duengemittel, bioStatus, kostenarten, bestehenderKostenEintrag,
}: {
  behandlung: BehandlungEdit
  psm: PSMOption[]
  duengemittel: DuengemittelOption[]
  bioStatus: string
  kostenarten: KostenartOption[]
  bestehenderKostenEintrag: BestehenderKostenEintrag | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [art, setArt] = useState<Art>((behandlung.art as Art) ?? 'spritzung')
  const [selectedPsmId, setSelectedPsmId] = useState(behandlung.psm_id ?? '')
  const [selectedDuengemittelId, setSelectedDuengemittelId] = useState(behandlung.duengemittel_id ?? '')
  const [aufwandmenge, setAufwandmenge] = useState(behandlung.aufwandmenge != null ? String(behandlung.aufwandmenge) : '')
  const [aufwandmengeEinheit, setAufwandmengeEinheit] = useState(behandlung.aufwandmenge_einheit ?? 'l_ha')
  const [konzentration, setKonzentration] = useState(behandlung.konzentration != null ? String(behandlung.konzentration) : '')
  const [wasseraufwand, setWasseraufwand] = useState(behandlung.wasseraufwand_l_ha != null ? String(behandlung.wasseraufwand_l_ha) : '')
  // Analog zum Anlegen-Formular (NeueBehandlungForm.tsx, Punkt 2 der Anforderung): Aufwandmenge
  // und Konzentration berechnen sich gegenseitig. Die Gesamtmenge/Spritzbrühe-Kopplung (Punkt 1)
  // wird hier bewusst NICHT nachgebildet, da die Flächendaten der Maßnahme beim Bearbeiten nicht
  // zur Verfügung stehen (Ried-Auswahl ist nicht änderbar) - Gesamtmenge bleibt daher frei editierbar.
  const [aufwandQuelle, setAufwandQuelle] = useState<'aufwand' | 'konzentration' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const felder = FELD_MATRIX[art] ?? FELD_MATRIX.spritzung

  // Kosten (Punkte 6, 9: beim Bearbeiten sichtbar + editierbar, analog Neu-Formular)
  const [kostenAktiv, setKostenAktiv] = useState(!!bestehenderKostenEintrag)
  const [kostenKostenartId, setKostenKostenartId] = useState(bestehenderKostenEintrag?.kostenart_id ?? '')
  const [kostenBetrag, setKostenBetrag] = useState(bestehenderKostenEintrag ? String(bestehenderKostenEintrag.betrag) : '')
  const [kostenBeschreibung, setKostenBeschreibung] = useState(bestehenderKostenEintrag?.beschreibung ?? '')

  const selectedPsm = psm.find(p => p.id === selectedPsmId)
  const selectedDuengemittel = duengemittel.find(d => d.id === selectedDuengemittelId)

  const gewaehltesMittelOeko =
    art === 'spritzung' || art === 'sonstiges' ? selectedPsm?.oeko_zugelassen :
    art === 'duengung'  ? selectedDuengemittel?.oeko_zugelassen :
    undefined
  const mittelNichtOeko = gewaehltesMittelOeko === false
  const bioSperre  = BIO_SPERRE.has(bioStatus) && mittelNichtOeko
  const bioWarnung = !bioSperre && BIO_WARNUNG.has(bioStatus) && mittelNichtOeko

  // ─── Punkt 2: Aufwandmenge (Etikett) ↔ Konzentration (%) - gegenseitige Sperre + Berechnung ──
  // Formel identisch zum Anlegen-Formular; effektivesWasserLHa kommt hier direkt aus dem frei
  // editierbaren Spritzbrühe-Feld (keine Fläche nötig für diese Formel).
  const effektivesWasserLHa = wasseraufwand ? parseFloat(wasseraufwand) : null

  function konzentrationAusAufwand(wertStr: string, einheit: string): number | null {
    const wert = parseFloat(wertStr)
    if (isNaN(wert)) return null
    if (einheit === 'g_hl' || einheit === 'ml_hl') return wert / 1000
    if ((einheit === 'kg_ha' || einheit === 'l_ha') && effektivesWasserLHa && effektivesWasserLHa > 0) {
      return (wert / effektivesWasserLHa) * 100
    }
    return null
  }
  function aufwandAusKonzentration(konzStr: string, einheit: string): number | null {
    const konz = parseFloat(konzStr)
    if (isNaN(konz)) return null
    if (einheit === 'g_hl' || einheit === 'ml_hl') return konz * 1000
    if ((einheit === 'kg_ha' || einheit === 'l_ha') && effektivesWasserLHa && effektivesWasserLHa > 0) {
      return (konz / 100) * effektivesWasserLHa
    }
    return null
  }

  const konzentrationBerechnet = aufwandQuelle === 'aufwand'
    ? konzentrationAusAufwand(aufwandmenge, aufwandmengeEinheit) : null
  const aufwandmengeBerechnet = aufwandQuelle === 'konzentration'
    ? aufwandAusKonzentration(konzentration, aufwandmengeEinheit) : null
  const konzentrationGesperrt = aufwandQuelle === 'aufwand' && konzentrationBerechnet != null
  const aufwandmengeGesperrt = aufwandQuelle === 'konzentration' && aufwandmengeBerechnet != null

  const updateWithId = updateBehandlung.bind(null, behandlung.id)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (bioSperre) {
      setError('Dieses Mittel ist nicht öko-zugelassen und passt nicht zum Bio-Status des Betriebs. Bitte ein zugelassenes Mittel wählen.')
      return
    }
    const fd = new FormData(e.currentTarget)
    // wartezeit_tage aus dem gewählten PSM/Düngemittel
    const wartezeit = selectedPsm?.wartezeit_tage ?? selectedDuengemittel?.wartezeit_tage
    if (wartezeit != null) {
      fd.set('wartezeit_tage', String(wartezeit))
    }
    // Gesperrte (berechnete) Felder werden als disabled gerendert und daher NICHT automatisch
    // in die FormData übernommen - hier explizit mit dem berechneten Wert nachtragen.
    if (felder.aufwandmenge !== 'hidden') {
      fd.set('aufwandmenge', aufwandmengeGesperrt && aufwandmengeBerechnet != null ? String(aufwandmengeBerechnet) : aufwandmenge)
      fd.set('aufwandmenge_einheit', aufwandmengeEinheit)
    }
    if (felder.konzentration !== 'hidden') {
      fd.set('konzentration', konzentrationGesperrt && konzentrationBerechnet != null ? String(konzentrationBerechnet) : konzentration)
    }
    if (felder.wasseraufwand !== 'hidden') {
      fd.set('wasseraufwand_l_ha', wasseraufwand)
    }
    startTransition(async () => {
      try {
        await updateWithId(fd)
        router.push('/behandlungen')
        router.refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Weingarten-Info (readonly) */}
      {behandlung.weingarten_name && (
        <div className="card bg-s112-bg/50 p-4">
          <p className="text-xs text-s112-muted">Weingarten (nicht änderbar)</p>
          <p className="font-semibold text-s112-text">{behandlung.weingarten_name}</p>
        </div>
      )}

      {/* Art & Datum */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-s112-text">Maßnahme</h2>

        <div>
          <label className={labelCls}>Art</label>
          <div className="flex flex-wrap gap-2">
            {ART_OPTIONS.map(o => (
              <label key={o.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors
                ${art === o.value
                  ? 'bg-s112-teal text-white border-s112-teal'
                  : 'bg-white text-s112-text-1 border-s112-border hover:border-s112-teal/50'}`}>
                <input type="radio" name="art" value={o.value} checked={art === o.value}
                  onChange={() => setArt(o.value as Art)} className="sr-only" />
                <o.icon size={14} />{o.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Datum von <span className="text-s112-err">*</span></label>
            <input name="datum" type="date" required defaultValue={behandlung.datum} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Datum bis</label>
            <input name="datum_bis" type="date" defaultValue={behandlung.datum_bis ?? ''} className={inputCls} />
          </div>
        </div>

        {/* PSM */}
        {(art === 'spritzung' || art === 'sonstiges') && (
          <div>
            <label className={labelCls}>Spritzmittel / Mittel (PSM)</label>
            <select name="psm_id" value={selectedPsmId}
              onChange={e => setSelectedPsmId(e.target.value)}
              className={inputCls}>
              <option value="">– keines –</option>
              {psm.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name}{p.handelsname ? ` (${p.handelsname})` : ''}
                  {p.oeko_zugelassen ? ' · Bio' : ''}
                  {p.cu_gehalt_pct ? ` · Cu ${p.cu_gehalt_pct}%` : ''}
                </option>
              ))}
            </select>
            {selectedPsm?.wartezeit_tage != null && (
              <p className="text-xs text-s112-warn-fg mt-1 inline-flex items-center gap-1">
                <Hourglass size={12} />Wartezeit: {selectedPsm.wartezeit_tage} Tage vor Ernte
              </p>
            )}
          </div>
        )}

        {/* Düngemittel */}
        {art === 'duengung' && (
          <div>
            <label className={labelCls}>Düngemittel</label>
            <select name="duengemittel_id" value={selectedDuengemittelId}
              onChange={e => setSelectedDuengemittelId(e.target.value)}
              className={inputCls}>
              <option value="">– keines –</option>
              {duengemittel.map(d => (
                <option key={d.id} value={d.id}>
                  {d.name}{d.handelsname ? ` (${d.handelsname})` : ''}
                  {d.typ ? ` · ${d.typ}` : ''}
                  {d.oeko_zugelassen ? ' · Bio' : ''}
                </option>
              ))}
            </select>
            {selectedDuengemittel?.wartezeit_tage != null && (
              <p className="text-xs text-s112-warn-fg mt-1 inline-flex items-center gap-1">
                <Hourglass size={12} />Wartezeit: {selectedDuengemittel.wartezeit_tage} Tage vor Ernte
              </p>
            )}
          </div>
        )}

        {bioSperre && (
          <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <Ban size={16} className="mt-0.5 flex-shrink-0" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – passt nicht zum Bio-Status des Betriebs. Speichern ist gesperrt.</span>
          </div>
        )}
        {bioWarnung && (
          <div className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – bitte prüfen, ob das beabsichtigt ist.</span>
          </div>
        )}

        {/* Mengen */}
        {(felder.mengeGesamt !== 'hidden' || felder.konzentration !== 'hidden') && (
          <div className="grid grid-cols-2 gap-3">
            {felder.mengeGesamt !== 'hidden' && (
              <div>
                <label className={labelCls}>
                  Gesamtmenge eingesetzt
                  {felder.mengeGesamt === 'pflicht' && <span className="text-s112-err"> *</span>}
                </label>
                <div className="flex gap-2">
                  <input name="menge_gesamt" type="number" step="0.001" min="0"
                    required={felder.mengeGesamt === 'pflicht'}
                    defaultValue={behandlung.menge_gesamt ?? ''}
                    className="flex-1 border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
                  <select name="menge_einheit" defaultValue={behandlung.menge_einheit ?? 'kg'}
                    className="w-20 border border-s112-border rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                    {MENGE_EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                </div>
              </div>
            )}
            {felder.konzentration !== 'hidden' && (
              <div>
                <label className={labelCls}>Konzentration (%)</label>
                <input name="konzentration" type="number" step="0.01" min="0" max="100"
                  value={konzentrationGesperrt ? (konzentrationBerechnet != null ? konzentrationBerechnet.toFixed(3) : '') : konzentration}
                  disabled={konzentrationGesperrt}
                  onChange={e => { setKonzentration(e.target.value); setAufwandQuelle(e.target.value === '' ? null : 'konzentration') }}
                  className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                {aufwandQuelle != null && !konzentrationGesperrt && !aufwandmengeGesperrt && effektivesWasserLHa == null
                  && (aufwandmengeEinheit === 'kg_ha' || aufwandmengeEinheit === 'l_ha') && (
                  <p className="text-xs text-s112-muted mt-1">Für die automatische Berechnung bitte Spritzbrühe (l/ha) angeben.</p>
                )}
              </div>
            )}
          </div>
        )}

        {(felder.aufwandmenge !== 'hidden' || felder.wasseraufwand !== 'hidden') && (
          <div className="grid grid-cols-3 gap-3">
            {felder.aufwandmenge !== 'hidden' && (
              <>
                <div>
                  <label className={labelCls}>
                    Aufwandmenge (Etikett)
                    {felder.aufwandmenge === 'pflicht' && <span className="text-s112-err"> *</span>}
                  </label>
                  <input name="aufwandmenge" type="number" step="0.001" min="0"
                    required={felder.aufwandmenge === 'pflicht' && !aufwandmengeGesperrt}
                    value={aufwandmengeGesperrt ? (aufwandmengeBerechnet != null ? aufwandmengeBerechnet.toFixed(3) : '') : aufwandmenge}
                    disabled={aufwandmengeGesperrt}
                    onChange={e => { setAufwandmenge(e.target.value); setAufwandQuelle(e.target.value === '' ? null : 'aufwand') }}
                    className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                </div>
                <div>
                  <label className={labelCls}>Einheit</label>
                  <select name="aufwandmenge_einheit" value={aufwandmengeEinheit}
                    onChange={e => setAufwandmengeEinheit(e.target.value)}
                    className={inputCls}>
                    {EINHEITEN_AUFWAND.map(e => <option key={e} value={e}>{EINHEITEN_LABEL[e]}</option>)}
                  </select>
                </div>
              </>
            )}
            {felder.wasseraufwand !== 'hidden' && (
              <div>
                <label className={labelCls}>Spritzbrühe (l/ha)</label>
                <input name="wasseraufwand_l_ha" type="number" step="1" min="0"
                  value={wasseraufwand}
                  onChange={e => setWasseraufwand(e.target.value)}
                  className={inputCls} />
              </div>
            )}
          </div>
        )}

        {art === 'spritzung' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>BBCH-Stadium</label>
              <select name="bbch_stadium" defaultValue={behandlung.bbch_stadium ?? ''} className={inputCls}>
                <option value="">– Auswählen –</option>
                {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Schaderreger</label>
              <input name="schaderreger" type="text"
                defaultValue={behandlung.schaderreger ?? ''} className={inputCls}
                placeholder="z.B. Peronospora" list="schaderreger-kb" />
              <datalist id="schaderreger-kb">
                {SCHADERREGER_OPTIONEN.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>
        )}
        <input type="hidden" name="reinkupfer_kg_ha" defaultValue={behandlung.reinkupfer_kg_ha ?? ''} />

        {/* Düngung: Einarbeitung */}
        {art === 'duengung' && (
          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="flex items-center gap-2 text-sm text-s112-text-1">
              <input type="checkbox" name="einarbeitung" defaultChecked={!!behandlung.einarbeitung} className="accent-s112-teal" />
              Eingearbeitet
            </label>
            <div>
              <label className={labelCls}>Zeitpunkt Einarbeitung</label>
              <input name="einarbeitung_zeitpunkt" type="date"
                defaultValue={behandlung.einarbeitung_zeitpunkt ?? ''} className={inputCls} />
            </div>
          </div>
        )}

        {/* Bodenbearbeitung */}
        {art === 'bodenbearbeitung' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Bearbeitungstiefe (cm)</label>
              <input name="bearbeitungstiefe_cm" type="number" step="1" min="0"
                defaultValue={behandlung.bearbeitungstiefe_cm ?? ''} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Gerät</label>
              <input name="bearbeitungsgeraet" type="text"
                defaultValue={behandlung.bearbeitungsgeraet ?? ''} className={inputCls} placeholder="z.B. Grubber" />
            </div>
          </div>
        )}

        {/* Schnitt */}
        {art === 'schnitt' && (
          <div>
            <label className={labelCls}>Schnittart</label>
            <input name="schnittart" type="text"
              defaultValue={behandlung.schnittart ?? ''} className={inputCls} placeholder="z.B. Guyot, Kordon" />
          </div>
        )}

        {/* Laubarbeit */}
        {art === 'laubarbeit' && (
          <div>
            <label className={labelCls}>Art der Laubarbeit</label>
            <select name="laubarbeit_art" defaultValue={behandlung.laubarbeit_art ?? ''} className={inputCls}>
              <option value="">– Auswählen –</option>
              {LAUBARBEIT_OPTIONEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Witterung</label>
            <select name="witterung" defaultValue={behandlung.witterung ?? ''} className={inputCls}>
              <option value="">–</option>
              {WITTERUNG.map(w => <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls}>Temperatur (°C)</label>
            <input name="temperatur_c" type="number" step="0.1"
              defaultValue={behandlung.temperatur_c ?? ''} className={inputCls} />
          </div>
        </div>

        <div>
          <label className={labelCls}>Notizen</label>
          <textarea name="notizen" rows={2} defaultValue={behandlung.notizen ?? ''}
            className={inputCls.replace('w-full', 'w-full')} />
        </div>
      </div>

      {/* Kosten (Punkte 6, 9) */}
      <div className="card space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name="kosten_aktiv" checked={kostenAktiv}
            onChange={e => setKostenAktiv(e.target.checked)}
            className="accent-s112-teal" />
          <h2 className="text-base font-semibold text-s112-text">Kosten erfassen</h2>
        </label>
        <p className="text-xs text-s112-muted -mt-2">
          {bestehenderKostenEintrag
            ? 'Zu dieser Maßnahme wurde beim Anlegen ein Kosteneintrag angelegt. Änderungen hier werden in der Kostenrechnung übernommen.'
            : 'Optional: Kosten dieser Maßnahme als Kosteneintrag in der Kostenrechnung anlegen.'}
        </p>

        {kostenAktiv && (
          <div className="space-y-3 pt-1">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Kostenart</label>
                <select name="kosten_kostenart_id" value={kostenKostenartId}
                  onChange={e => setKostenKostenartId(e.target.value)}
                  className={inputCls}>
                  <option value="">– Auswählen –</option>
                  {kostenarten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Betrag (€)</label>
                <input name="kosten_betrag" type="number" step="0.01" min="0"
                  value={kostenBetrag}
                  onChange={e => setKostenBetrag(e.target.value)}
                  className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Beschreibung</label>
              <input name="kosten_beschreibung" type="text" value={kostenBeschreibung}
                onChange={e => setKostenBeschreibung(e.target.value)}
                className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      <div className="flex gap-3">
        <button type="submit" disabled={pending || bioSperre}
          className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Änderungen speichern'}
        </button>
        <a href="/behandlungen" className="px-5 py-2.5 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
