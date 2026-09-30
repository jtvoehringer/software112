'use client'

import { Fragment, useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createBehandlung } from '../actions'
import type { PSM, DuengemittelOption, WeingartenOption, GSTOption, KostenartOption, SatzOption } from './page'
import { Hourglass, Info, Ban, AlertTriangle } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { runden } from '@/lib/csv'
import { mengeInEinheit, type MittelmengeErgebnis } from '@/lib/behoerden/psm'
import { pruefeMassnahmeMengen } from '@/lib/behandlungen/massnahmeMengen'
import { LAUBARBEIT_OPTIONEN, LAUBSCHNEIDEN_HINWEIS, MASSNAHMEN_ART_LABEL, type MassnahmenArt } from '@/lib/behandlungen/arten'
import {
  aufwandEinheitText, duengerEinheitWechsel, duengermengeEinheit, eingabeFolge, mengenFelder, mengenInFormData, mengenSicht,
  mengenTexte, type MengenGroesse,
} from './mengenFelder'
import {
  BBCH_OPTIONS, FELD_MATRIX, EINARBEITUNG_GESENDET, SCHADERREGER_OPTIONEN, WITTERUNG_OPTIONEN, einarbeitungSichtbar,
  schaderregerFeld,
} from './feldMatrix'
import {
  RIED_AUSWAHL_FEHLT, absendenHindernis, alleAuswahlModus, auswahlKopf, erfassenKnopfText, riedGruppen, istEinzelRied, weingartenZusatz,
} from './absenden'
import { ART_OPTIONS } from './artOptionen'
import MengenZusammenfassung from './MengenZusammenfassung'

// Welche Felder je Maßnahmenart sichtbar/pflicht sind, steht in FELD_MATRIX (feldMatrix.ts), die
// Mengenfelder in MENGEN_SICHT (mengenFelder.ts, über mengenSicht: Aufwand bei Sonstiges nur mit Mittel) –
// gemeinsam mit dem Bearbeiten-Formular und dem Assistenten.
type Art = MassnahmenArt

/**
 * Menge für den Material-Vorschlag in der Einheit, in der der Preis gilt (Preis je kg bzw. l – beim PSM
 * die Grundeinheit des Lagers, beim Düngemittel dessen Einheit). kg ↔ l ohne Dichte nicht umrechenbar →
 * kein Vorschlag, nur ein Hinweis.
 */
function materialMenge(mm: MittelmengeErgebnis | null, einheit: string | null): { menge: number | null; hinweis: string | null } {
  if (!mm || mm.menge === null || !mm.einheit) return { menge: null, hinweis: null }
  if (!einheit) return { menge: null, hinweis: 'Kein Material-Vorschlag: Einheit des Mittels unbekannt (noch keine Lagerbewegung) – der Preis gilt je kg oder l.' }
  const menge = mengeInEinheit(mm.menge, mm.einheit, einheit)
  return menge !== null ? { menge, hinweis: null }
    : { menge: null, hinweis: `Kein Material-Vorschlag: Mittelmenge in ${mm.einheit}, Preis je ${einheit} – ohne Dichte nicht umrechenbar.` }
}

function fmtHa(n: number) {
  return fmtNum(n, { max: 4 }) + ' ha'
}

function fmtEuro(n: number) {
  return fmtNum(n, 2)
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
  // KAN-153: „Maßnahme erfassen“ ist nur beim Speichern gesperrt. Ein Klick ohne Auswahl bzw. bei Bio-Sperre
  // zählt hoch – jeder Klick scrollt erneut hin, fokussiert und lässt die Meldung (role="alert") neu vorlesen
  const [riedSprung, setRiedSprung] = useState(0)
  const [bioSprung, setBioSprung] = useState(0)
  const riedenRef = useRef<HTMLDivElement>(null)
  const riedenKopfRef = useRef<HTMLButtonElement>(null)
  const psmRef = useRef<HTMLSelectElement>(null)
  const duengemittelRef = useRef<HTMLSelectElement>(null)
  const [art, setArt] = useState<Art>('spritzung')
  // Spritzung: Spritzbrühe gesamt (l) – nie die Mittelmenge; Düngung: Düngermenge (KAN-133)
  const [mengeGesamt, setMengeGesamt] = useState<string>('')
  // Hinweis, wenn ein anderes Düngemittel die Einheit der eingegebenen Düngermenge wechselt (kg ↔ l)
  const [einheitHinweis, setEinheitHinweis] = useState<string | null>(null)
  const [wasseraufwand, setWasseraufwand] = useState<string>('')
  // Welches der beiden Felder Spritzbrühe gesamt/Wasseraufwand (l/ha) der Nutzer zuletzt befüllt hat -
  // dieses treibt die Berechnung, das jeweils andere wird gesperrt (Punkt 1 der Anforderung)
  const [mengeQuelle, setMengeQuelle] = useState<'gesamt' | 'wasser' | null>(null)
  const [aufwandmenge, setAufwandmenge] = useState<string>('')
  const [aufwandmengeEinheit, setAufwandmengeEinheit] = useState('kg_ha')
  const [konzentration, setKonzentration] = useState<string>('')
  // Reihenfolge der Eingaben in Aufwandmenge, Konzentration und Spritzbrühe/Wasseraufwand – je zwei bestimmen
  // die dritte (KAN-155, eingabeFolge/berechneteGroesse in mengenFelder.ts)
  const [folge, setFolge] = useState<MengenGroesse[]>([])
  const [error, setError] = useState<string | null>(null)

  // Kosten-Vorschlagsfunktion
  const [kostenAktiv, setKostenAktiv] = useState(false)
  const [kostenKostenartId, setKostenKostenartId] = useState('')
  const [selectedSatzId, setSelectedSatzId] = useState('')
  const [kostenBetrag, setKostenBetrag] = useState('')
  const [kostenBeschreibung, setKostenBeschreibung] = useState('')
  const betragManuellGeaendert = useRef(false)

  const felder = { ...FELD_MATRIX[art], ...mengenSicht(art, !!selectedPsmId) }
  const schaderreger = schaderregerFeld(art)

  // Beim Wechsel der Art eine Mittel-Auswahl zurücksetzen, deren Feld die neue Art laut Feld-Matrix nicht zeigt –
  // auch das Spritzmittel bei Sonstiges: Sonst sperrte ein nicht öko-zugelassenes Mittel aus der Spritzung das
  // Speichern, ohne dass es im Formular zu sehen ist (KAN-153)
  useEffect(() => {
    if (FELD_MATRIX[art].psm === 'hidden') setSelectedPsmId('')
    if (FELD_MATRIX[art].duengemittel === 'hidden') setSelectedDuengemittelId('')
    setSelectedSatzId('')
    // Menge und Aufwand bedeuten je Art etwas anderes (Spritzbrühe in l bzw. Düngermenge, Mittel bzw.
    // Dünger; g/hl nur bei Spritzungen) – nicht in die neue Art übernehmen
    setMengeGesamt('')
    setEinheitHinweis(null)
    setAufwandmenge('')
    setAufwandmengeEinheit('kg_ha')
    setKonzentration('')
    // Sperr-Zustände der verknüpften Felder zurücksetzen, da sich je nach Art
    // sichtbare Felder ändern (Feld-Matrix)
    setMengeQuelle(null)
    setFolge([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [art])

  // Gewähltes PSM / Düngemittel
  const selectedPsm = psm.find(p => p.id === selectedPsmId)
  const selectedDuengemittel = duengemittel.find(d => d.id === selectedDuengemittelId)

  // Bio-Status: harte Sperre bei Bio-EU/biodynamisch + nicht-öko-zugelassenem Mittel,
  // sonst nur Warnung bei KIP/nachhaltig (siehe "Analyse Maßnahmen.docx", 4.3)
  // nur das Mittel, dessen Feld die Art zeigt – die Sperre muss sich am Mittel zeigen und beheben lassen
  const gewaehltesMittelOeko =
    felder.psm !== 'hidden'          ? selectedPsm?.oeko_zugelassen :
    felder.duengemittel !== 'hidden' ? selectedDuengemittel?.oeko_zugelassen :
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

  // KAN-153: Kopfzeile der Ried-Auswahl und Meldung nach einem Klick ohne Auswahl (verschwindet mit der Auswahl)
  const riedKopf = auswahlKopf(totalSelCount, totalHaAktiv)
  const riedHinweis = riedSprung > 0 && totalSelCount === 0
  // Checkboxen und Kopfzeile verweisen auf die Meldung (aria-describedby) – das Fokusziel nach dem Klick liest sie
  // so sicher mit, auch wenn der Fokuswechsel die role="alert"-Ansage unterbricht (wie bei der Bio-Sperre)
  const riedMeldung = riedHinweis ? 'ried-auswahl-fehlt' : undefined

  // Nach dem Klick ohne Auswahl: zum (jetzt aufgeklappten) Abschnitt scrollen und die erste Checkbox fokussieren –
  // erst nach dem Rendern, beim Klick war die Auswahl womöglich noch eingeklappt
  useEffect(() => {
    if (riedSprung === 0) return
    riedenRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    const erste = riedenRef.current?.querySelector<HTMLInputElement>('input[type="checkbox"]:not(:disabled)')
    ;(erste ?? riedenKopfRef.current)?.focus({ preventScroll: true })
  }, [riedSprung])

  // Nach dem Klick bei Bio-Sperre: zum Mittel scrollen und es fokussieren – der Grund steht direkt darunter
  // (aria-describedby) und wird als Meldung neu vorgelesen
  useEffect(() => {
    if (bioSprung === 0) return
    const mittel = psmRef.current ?? duengemittelRef.current
    mittel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    mittel?.focus({ preventScroll: true })
  }, [bioSprung])

  // ─── Punkt 1 + 2: Spritzbrühe gesamt ↔ Wasseraufwand (l/ha), Aufwandmenge ↔ Konzentration (%) ──
  // Spritzbrühe gesamt ↔ Wasseraufwand: das zuletzt befüllte Feld treibt das andere (mengeQuelle, über die
  // ausgewählte Fläche). Aufwandmenge, Konzentration und Wasseraufwand: je zwei bestimmen die dritte, berechnet
  // wird die nicht unter den zwei zuletzt eingegebenen (folge, KAN-155); berechnete Felder sind gesperrt. Die
  // Spritzbrühe ist immer in Litern, die Mittelmenge kommt nur aus der Aufwandmenge (KAN-133); Rechnung und
  // Prüfung wie in der Server Action (mengenFelder → pruefeMassnahmeMengen).
  const m = mengenFelder({
    art, felder,
    mengeGesamt, wasseraufwand, mengeQuelle,
    aufwandmenge, aufwandmengeEinheit, konzentration, folge,
    flaecheHa: totalHaAktiv,
    psmId: selectedPsmId || null,
    psm: selectedPsm
      ? { cuGehaltPct: selectedPsm.cu_gehalt_pct, wirkstoff: selectedPsm.wirkstoff, wirkstoffgehaltPct: selectedPsm.wirkstoffgehalt_pct }
      : null,
    duengemittelId: selectedDuengemittelId || null,
    duengemittelEinheit: selectedDuengemittel?.einheit ?? null,
    formular: 'neu',
  })
  const wasserGesperrt = m.gesperrt.wasser
  const mengeGesamtGesperrt = m.gesperrt.mengeGesamt
  const konzentrationGesperrt = m.gesperrt.konzentration
  const aufwandmengeGesperrt = m.gesperrt.aufwandmenge
  const mengenTexteAktiv = mengenTexte(art, m.pruefung, m.ha)
  const mengenSichtbar = (art === 'spritzung' || art === 'duengung' || felder.aufwandmenge !== 'hidden')
    && [aufwandmenge, mengeGesamt, wasseraufwand, konzentration].some(s => s.trim() !== '')

  // ─── Kosten-Vorschlag: passende Hektarsätze für die aktuelle Art + Vorschlagssumme ──
  const passendeSaetze = saetzeMassnahmen.filter(s => s.art === art)
  const gewaehlterSatz = passendeSaetze.find(s => s.id === selectedSatzId) ?? passendeSaetze[0]

  // Material = Preis je kg bzw. l × Mittelmenge (nie × Spritzbrühe); der Preis gilt beim PSM je kg bzw. l
  // (Grundeinheit des Lagers, auch bei Buchungen in g bzw. ml), beim Düngemittel je dessen Einheit; das PSM
  // auch bei Sonstiges (KAN-154)
  const materialpreisProEinheit =
    felder.psm !== 'hidden' ? selectedPsm?.preis_pro_einheit :
    art === 'duengung'      ? selectedDuengemittel?.preis_pro_einheit :
    undefined
  const materialEinheit =
    felder.psm !== 'hidden' ? selectedPsm?.einheit ?? null :
    art === 'duengung'      ? selectedDuengemittel?.einheit ?? 'kg' :
    null
  const material = materialpreisProEinheit
    ? materialMenge(m.pruefung.ok ? m.pruefung.mittelmenge : null, materialEinheit)
    : { menge: null, hinweis: null }
  const materialkosten = materialpreisProEinheit && material.menge !== null
    ? runden(materialpreisProEinheit * material.menge, 2)
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
    const artLabel = MASSNAHMEN_ART_LABEL[art] ?? art
    setKostenBeschreibung(`${artLabel}${gewaehlterSatz ? ` – ${gewaehlterSatz.bezeichnung}` : ''}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kostenAktiv, art])

  // Weingärten nach Ried gruppieren – Rieden alphabetisch, „Ohne Ried-Zuordnung“ zuletzt (KAN-155)
  const lagen = riedGruppen(weingaerten)
  // „Alle auswählen“ bzw. „Alle abwählen“, sobald alle spritzbaren ausgewählt sind (KAN-155)
  const spritzbareIds = weingaerten.filter(w => w.spritzbar).map(w => w.id)
  const alleModus = alleAuswahlModus(spritzbareIds, selectedWGs)

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
    // Bug 30.09.2026 (Gebeshuber): Ist die ganze Ried gewählt, sind alle ihre WI-GST angehakt. Ein Klick auf ein
    // GST nimmt nur dieses heraus – die Ried wird zur Einzelauswahl aller übrigen GST (bisher war danach gar
    // nichts mehr gewählt bzw. die GST standen trotz Ried-Auswahl leer da).
    const riedGewaehlt = selectedWGs.has(wgId)
    const wasSelected = riedGewaehlt || selectedGSTs.has(gstId)
    setSelectedWGs(prev => { const n = new Set(prev); n.delete(wgId); return n })
    setSelectedGSTs(prev => {
      const n = new Map(prev)
      if (riedGewaehlt) for (const g of gstByWeingarten[wgId] ?? []) n.set(g.id, wgId)
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
    setSelectedWGs(alleModus === 'abwaehlen' ? new Set() : new Set(spritzbareIds))
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    // KAN-153: statt eines gesperrten Knopfs zeigt der Klick den Grund an Ort und Stelle – nichts wird gesendet
    const hindernis = absendenHindernis(totalSelCount, bioSperre)
    if (hindernis === 'bio') { setBioSprung(n => n + 1); return }
    if (hindernis === 'ried') { setRiedenExpanded(true); setRiedSprung(n => n + 1); return }
    // Dieselbe Prüfung wie die Server Action, im Formular zusätzlich mit Pflicht Spritzbrühe gesamt oder
    // Wasseraufwand (KAN-133)
    const mengen = pruefeMassnahmeMengen(m.eingabe, { bruehePflicht: true })
    if (!mengen.ok) { setError(mengen.fehler); return }
    if (m.konzentrationFehler) { setError(m.konzentrationFehler); return }
    const fd = new FormData(e.currentTarget)
    selectedWGs.forEach(id => fd.append('weingarten_ids', id))
    selectedGSTs.forEach((_wgId, gstId) => fd.append('grundstueck_ids', gstId))
    // Mengen so, wie die Prüfung sie normalisiert hat; gesperrte (berechnete) Felder sind disabled und
    // würden sonst fehlen. reinkupfer_kg_ha rechnet die Server Action selbst.
    mengenInFormData(fd, felder, mengen.werte, m.konzentrationNum)
    startTransition(async () => {
      try {
        await createBehandlung(fd)
        router.push('/behandlungen')
        router.refresh()
      } catch (err) {
        setError(fehlerText(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Art & Datum */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-s112-text">Maßnahme</h2>

        {/* Art der Maßnahme */}
        <div>
          <label className="block text-sm font-medium text-s112-text-1 mb-1">Art <span className="text-s112-err">*</span></label>
          <div className="flex flex-wrap gap-2">
            {ART_OPTIONS.map(o => (
              <label key={o.value} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm cursor-pointer transition-colors
                ${art === o.value
                  ? 'bg-s112-teal text-s112-yellow border-s112-teal'
                  : 'bg-white text-s112-text-1 border-s112-border hover:border-s112-teal/50'}`}>
                <input type="radio" name="art" value={o.value} checked={art === o.value}
                  onChange={() => setArt(o.value)} className="sr-only" />
                <o.icon size={14} />{o.label}
              </label>
            ))}
          </div>
          {art === 'laubschneiden' && <p className="text-xs text-s112-muted mt-1">{LAUBSCHNEIDEN_HINWEIS}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Datum von <span className="text-s112-err">*</span>
            </label>
            <input aria-label="Datum von" name="datum" type="date" required
              defaultValue={new Date().toISOString().split('T')[0]}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">Datum bis</label>
            <input aria-label="Datum bis" name="datum_bis" type="date"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        </div>

        {/* PSM */}
        {felder.psm !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Spritzmittel / Mittel (PSM)
              {felder.psm === 'pflicht' && <span className="text-s112-err"> *</span>}
            </label>
            <select ref={psmRef} aria-label="Spritzmittel / Mittel (PSM)" name="psm_id" value={selectedPsmId} required={felder.psm === 'pflicht'}
              aria-invalid={bioSperre || undefined} aria-describedby={bioSperre ? 'bio-sperre-grund' : undefined}
              onChange={e => setSelectedPsmId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">{felder.psm === 'pflicht' ? '– Auswählen –' : '– keines –'}</option>
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
            {selectedPsm?.cu_gehalt_pct ? (
              <p className="text-xs text-s112-blue-700 mt-1 inline-flex items-center gap-1">
                <Info size={12} />Kupferhaltiges Mittel – Cu-Anteil: {selectedPsm.cu_gehalt_pct} %
              </p>
            ) : null}
            <input type="hidden" name="wartezeit_tage" value={selectedPsm?.wartezeit_tage ?? ''} />
          </div>
        )}

        {/* Düngemittel */}
        {felder.duengemittel !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Düngemittel
              {felder.duengemittel === 'pflicht' && <span className="text-s112-err"> *</span>}
            </label>
            <select ref={duengemittelRef} aria-label="Düngemittel" name="duengemittel_id" value={selectedDuengemittelId}
              required={felder.duengemittel === 'pflicht'}
              aria-invalid={bioSperre || undefined} aria-describedby={bioSperre ? 'bio-sperre-grund' : undefined}
              onChange={e => {
                // Düngermenge in der Einheit des Düngemittels (kg bzw. l): eine Eingabe wird beim Wechsel nie
                // umgerechnet, nur mit Hinweis versehen (keine Dichte-Annahme)
                const hinweis = duengerEinheitWechsel(duengermengeEinheit(selectedDuengemittel?.einheit),
                  duengermengeEinheit(duengemittel.find(d => d.id === e.target.value)?.einheit), mengeGesamt)
                if (hinweis) setEinheitHinweis(hinweis)
                setSelectedDuengemittelId(e.target.value)
              }}
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
              <p className="text-xs text-s112-warn-fg mt-1 inline-flex items-center gap-1">
                <Hourglass size={12} />Wartezeit: {selectedDuengemittel.wartezeit_tage} Tage vor Ernte
              </p>
            )}
            <input type="hidden" name="wartezeit_tage" value={selectedDuengemittel?.wartezeit_tage ?? ''} />
          </div>
        )}

        {/* Bio-Sperre direkt am Mittel (KAN-153): role="alert" liest sie beim Wählen des Mittels vor; ein Klick auf
            „Maßnahme erfassen“ fokussiert das Mittel und zeigt die Meldung neu (key) */}
        {bioSperre && (
          <div key={bioSprung} id="bio-sperre-grund" role="alert"
            className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <Ban size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – passt nicht zum Bio-Status des Betriebs
            ({bioStatus === 'bio_eu' ? 'Bio-EU' : 'Biodynamisch'}). Speichern ist so nicht möglich, bitte ein zugelassenes Mittel wählen.</span>
          </div>
        )}
        {bioWarnung && (
          <div className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – der Betrieb ist als {bioStatus === 'kip' ? 'KIP' : 'nachhaltig'} eingestuft. Bitte prüfen, ob das beabsichtigt ist.</span>
          </div>
        )}

        {/* Düngermenge gesamt (kg; l nur bei Düngemitteln in l) */}
        {art === 'duengung' && felder.mengeGesamt !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Düngermenge gesamt ({m.mengeEinheit})
              {felder.mengeGesamt === 'pflicht' && <span className="text-s112-err"> *</span>}
            </label>
            <input aria-label={`Düngermenge gesamt (${m.mengeEinheit})`} name="menge_gesamt" type="text" inputMode="decimal"
              required={felder.mengeGesamt === 'pflicht'}
              placeholder="z.B. 950"
              value={mengeGesamt}
              onChange={e => { setMengeGesamt(e.target.value); setEinheitHinweis(null) }}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            {einheitHinweis && (
              <p className="text-xs text-s112-warn-fg mt-1 flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{einheitHinweis}
              </p>
            )}
          </div>
        )}

        {/* Aufwandmenge bzw. Konzentration im Tank – einzige Grundlage der Mittelmenge einer Spritzung */}
        {(felder.aufwandmenge !== 'hidden' || felder.konzentration !== 'hidden') && (
          <div>
            <div className="grid grid-cols-3 gap-3">
              {felder.aufwandmenge !== 'hidden' && (
                <>
                  <div>
                    <label className="block text-sm font-medium text-s112-text-1 mb-1">
                      {m.jeHl ? 'Konzentration im Tank' : 'Aufwandmenge'}
                      {felder.aufwandmenge === 'pflicht' && <span className="text-s112-err"> *</span>}
                    </label>
                    <input aria-label={m.jeHl ? 'Konzentration im Tank' : 'Aufwandmenge'} name="aufwandmenge" type="text" inputMode="decimal"
                      placeholder={m.jeHl ? 'z.B. 25' : 'z.B. 0,6'}
                      required={felder.aufwandmenge === 'pflicht' && !aufwandmengeGesperrt}
                      value={m.aufwandmengeBerechnet !== null ? fmtNum(m.aufwandmengeBerechnet, { max: 3 }) : aufwandmenge}
                      disabled={aufwandmengeGesperrt}
                      onChange={e => { const v = e.target.value; setAufwandmenge(v); setFolge(f => eingabeFolge(f, 'aufwand', v)) }}
                      className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 disabled:bg-s112-bg disabled:text-s112-text-2" />
                    {m.berechnetHinweis.aufwandmenge && (
                      <p className="text-xs text-s112-muted mt-1">{m.berechnetHinweis.aufwandmenge}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-s112-text-1 mb-1">Einheit</label>
                    <select aria-label="Einheit" name="aufwandmenge_einheit" value={m.aufwandEinheit}
                      onChange={e => setAufwandmengeEinheit(e.target.value)}
                      className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                      {m.einheiten.map(e => <option key={e} value={e}>{aufwandEinheitText(e, m.zulaessig)}</option>)}
                    </select>
                  </div>
                </>
              )}
              {felder.konzentration !== 'hidden' && (
                <div>
                  <label className="block text-sm font-medium text-s112-text-1 mb-1">Konzentration (%)</label>
                  <input aria-label="Konzentration (%)" name="konzentration" type="text" inputMode="decimal"
                    placeholder="z.B. 0,5"
                    value={m.konzentrationBerechnet !== null ? fmtNum(m.konzentrationBerechnet, { max: 3 }) : konzentration}
                    disabled={konzentrationGesperrt}
                    onChange={e => { const v = e.target.value; setKonzentration(v); setFolge(f => eingabeFolge(f, 'konzentration', v)) }}
                    className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 disabled:bg-s112-bg disabled:text-s112-text-2" />
                  {(m.berechnetHinweis.konzentration ?? m.konzentrationHinweis) && (
                    <p className="text-xs text-s112-muted mt-1">{m.berechnetHinweis.konzentration ?? m.konzentrationHinweis}</p>
                  )}
                </div>
              )}
            </div>
            {felder.aufwandmenge !== 'hidden' && (
              <p className="text-xs text-s112-muted mt-1">
                {art === 'duengung'
                  ? 'Optional – maßgeblich für Lager und Nährstoffbilanz ist die Düngermenge gesamt.'
                  : art === 'sonstiges'
                    ? 'Optional – nur mit Aufwandmenge zieht das Lager das Mittel ab (Mittelmenge = je ha × Fläche bzw. gesamt).'
                  : m.jeHl
                    ? 'Tatsächliche Konzentration im Tank: Mittelmenge = Konzentration × Spritzbrühe. Etikettwerte je Hektar bitte als kg/ha bzw. l/ha erfassen.'
                    : 'Die Mittelmenge ergibt sich aus der Aufwandmenge (je ha × Fläche bzw. gesamt).'}
              </p>
            )}
          </div>
        )}

        {/* Spritzbrühe gesamt (l) ↔ Wasseraufwand (l/ha) – Punkt 1 der Anforderung; die Brühe ist nie die Mittelmenge */}
        {art === 'spritzung' && (felder.mengeGesamt !== 'hidden' || felder.wasseraufwand !== 'hidden') && (
          <div>
            <div className="grid grid-cols-2 gap-3">
              {felder.mengeGesamt !== 'hidden' && (
                <div>
                  <label className="block text-sm font-medium text-s112-text-1 mb-1">
                    Spritzbrühe gesamt (l)
                    {felder.mengeGesamt !== 'optional' && <span className="text-s112-err"> *</span>}
                  </label>
                  <input aria-label="Spritzbrühe gesamt (l)" name="menge_gesamt" type="text" inputMode="decimal"
                    placeholder="z.B. 800"
                    value={m.mengeGesamtBerechnet !== null ? fmtNum(m.mengeGesamtBerechnet, { max: 3 }) : mengeGesamtGesperrt ? '' : mengeGesamt}
                    disabled={mengeGesamtGesperrt}
                    onChange={e => { const v = e.target.value; setMengeGesamt(v); setMengeQuelle(v.trim() === '' ? null : 'gesamt'); setFolge(f => eingabeFolge(f, 'wasser', v)) }}
                    className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 disabled:bg-s112-bg disabled:text-s112-text-2" />
                  {m.berechnetHinweis.mengeGesamt && (
                    <p className="text-xs text-s112-muted mt-1">{m.berechnetHinweis.mengeGesamt}</p>
                  )}
                </div>
              )}
              {felder.wasseraufwand !== 'hidden' && (
                <div>
                  <label className="block text-sm font-medium text-s112-text-1 mb-1">
                    Wasseraufwand (l/ha)
                    {felder.wasseraufwand !== 'optional' && <span className="text-s112-err"> *</span>}
                  </label>
                  <input aria-label="Wasseraufwand (l/ha)" name="wasseraufwand_l_ha" type="text" inputMode="decimal"
                    placeholder="z.B. 400"
                    value={m.wasserBerechnet !== null ? fmtNum(m.wasserBerechnet, { max: 2 }) : wasseraufwand}
                    disabled={wasserGesperrt}
                    onChange={e => { const v = e.target.value; setWasseraufwand(v); setMengeQuelle(v.trim() === '' ? null : 'wasser'); setFolge(f => eingabeFolge(f, 'wasser', v)) }}
                    className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 disabled:bg-s112-bg disabled:text-s112-text-2" />
                  {m.berechnetHinweis.wasser && (
                    <p className="text-xs text-s112-muted mt-1">{m.berechnetHinweis.wasser}</p>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-s112-muted mt-1">
              Spritzbrühe = Mittel + Wasser. Eines der beiden Felder ist Pflicht, das andere ergibt sich über die Fläche.
              Aufwandmenge (kg/ha, l/ha bzw. kg, l gesamt über die Fläche), Konzentration (%) und Wasseraufwand: je zwei ergeben die dritte (Aufwand je ha = Wasseraufwand × Konzentration ÷ 100). Bei g/hl bzw. ml/hl (im Tank) ist die Aufwandmenge schon die Konzentration – dann Spritzbrühe oder Wasseraufwand angeben.
            </p>
          </div>
        )}

        {/* Live-Zusammenfassung: Mittelmenge, Spritzbrühe, Cu, Reinkupfer – gerechnet wie in der Server Action */}
        {mengenSichtbar && <MengenZusammenfassung art={art} pruefung={m.pruefung} ha={m.ha} />}

        {(felder.bbch !== 'hidden' || felder.schaderreger !== 'hidden') && (
          <div className="grid grid-cols-2 gap-3">
            {felder.bbch !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-s112-text-1 mb-1">
                  BBCH-Stadium
                  {felder.bbch === 'pflicht' && <span className="text-s112-err"> *</span>}
                </label>
                <select name="bbch_stadium" required={felder.bbch === 'pflicht'}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">– Auswählen –</option>
                  {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {felder.schaderreger !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-s112-text-1 mb-1">
                  {schaderreger.label}
                  {felder.schaderreger === 'pflicht' && <span className="text-s112-err"> *</span>}
                </label>
                <input aria-label={schaderreger.label} name="schaderreger" type="text" required={felder.schaderreger === 'pflicht'}
                  placeholder={schaderreger.placeholder}
                  list={schaderreger.vorschlaege ? 'schaderreger-kb' : undefined}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
                {schaderreger.vorschlaege && (
                  <datalist id="schaderreger-kb">
                    {SCHADERREGER_OPTIONEN.map(s => <option key={s} value={s} />)}
                  </datalist>
                )}
              </div>
            )}
          </div>
        )}

        {/* Düngung: Einarbeitung (nur bei organischem Dünger relevant) – einarbeitung_gesendet: nicht angehakt = „nein“
            (false), nicht „keine Angabe“ (KAN-154, einarbeitungAus) */}
        {einarbeitungSichtbar(art, selectedDuengemittel?.typ) && (
          <div className="grid grid-cols-2 gap-3 items-end">
            <input type="hidden" name={EINARBEITUNG_GESENDET} value="1" />
            <label className="flex items-center gap-2 text-sm text-s112-text-1">
              <input type="checkbox" name="einarbeitung" className="accent-s112-teal" />
              Eingearbeitet
            </label>
            <div>
              <label className="block text-sm font-medium text-s112-text-1 mb-1">Zeitpunkt Einarbeitung</label>
              <input aria-label="Zeitpunkt Einarbeitung" name="einarbeitung_zeitpunkt" type="date"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        )}

        {/* Bodenbearbeitung – Tiefe optional (Mulchen, Mähen), Gerät Pflicht (KAN-154) */}
        {(felder.bearbeitungstiefe !== 'hidden' || felder.bearbeitungsgeraet !== 'hidden') && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-s112-text-1 mb-1">
                Bearbeitungstiefe (cm)
                {felder.bearbeitungstiefe === 'pflicht' && <span className="text-s112-err"> *</span>}
              </label>
              <input aria-label="Bearbeitungstiefe (cm)" name="bearbeitungstiefe_cm" type="number" step="1" min="0" placeholder="z.B. 10"
                required={felder.bearbeitungstiefe === 'pflicht'}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-sm font-medium text-s112-text-1 mb-1">
                Gerät
                {felder.bearbeitungsgeraet === 'pflicht' && <span className="text-s112-err"> *</span>}
              </label>
              <input aria-label="Gerät" name="bearbeitungsgeraet" type="text" placeholder="z.B. Grubber"
                required={felder.bearbeitungsgeraet === 'pflicht'}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        )}

        {/* Schnitt */}
        {felder.schnittart !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Schnittart
              {felder.schnittart === 'pflicht' && <span className="text-s112-err"> *</span>}
            </label>
            <input name="schnittart" type="text" placeholder="z.B. Guyot, Kordon"
              required={felder.schnittart === 'pflicht'}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
        )}

        {/* Laubarbeit */}
        {felder.laubarbeitArt !== 'hidden' && (
          <div>
            <label className="block text-sm font-medium text-s112-text-1 mb-1">
              Art der Laubarbeit
              {felder.laubarbeitArt === 'pflicht' && <span className="text-s112-err"> *</span>}
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
                <label className="block text-sm font-medium text-s112-text-1 mb-1">Witterung</label>
                <select aria-label="Witterung" name="witterung"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">–</option>
                  {WITTERUNG_OPTIONEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {felder.temperatur !== 'hidden' && (
              <div>
                <label className="block text-sm font-medium text-s112-text-1 mb-1">Temperatur (°C)</label>
                <input aria-label="Temperatur (°C)" name="temperatur_c" type="number" step="0.1" placeholder="z.B. 18.5"
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
            )}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-s112-text-1 mb-1">Notizen</label>
          <textarea aria-label="Notizen" name="notizen" rows={2}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      {/* Ried(en)-Auswahl – Pflicht (KAN-153): standardmäßig eingeklappt, damit „Kosten erfassen“ sichtbar ist; ohne
          Auswahl springt „Maßnahme erfassen“ hierher (aufklappen, hinscrollen, erste Checkbox, Meldung) */}
      <div ref={riedenRef} className="card">
        <div className="flex items-center justify-between mb-3">
          <button type="button" ref={riedenKopfRef}
            onClick={() => setRiedenExpanded(v => !v)}
            aria-expanded={riedenExpanded} aria-describedby={riedMeldung}
            className="flex items-center gap-2 text-left">
            <svg className={`w-3.5 h-3.5 text-s112-muted transition-transform shrink-0 ${riedenExpanded ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <h2 className="text-base font-semibold text-s112-text">
              Ried(en) auswählen<span className="text-s112-err"> *</span>
              <span className={`ml-2 text-sm font-normal ${riedKopf.warnung ? 'text-s112-warn-fg' : 'text-s112-blue-700'}`}>
                {riedKopf.text}
              </span>
            </h2>
          </button>
          {riedenExpanded && (
            <button type="button"
              onClick={selectAll}
              className="text-xs text-s112-blue-700 hover:underline">
              {alleModus === 'abwaehlen' ? 'Alle abwählen' : 'Alle auswählen'}
            </button>
          )}
        </div>

        {/* Meldung nach „Maßnahme erfassen“ ohne Auswahl – key: jeder weitere Klick liest sie neu vor; die id ist das
            Ziel von aria-describedby an Checkboxen und Kopfzeile */}
        {riedHinweis && (
          <p key={riedSprung} id="ried-auswahl-fehlt" role="alert"
            className="mb-3 bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-2.5 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
            <span>{RIED_AUSWAHL_FEHLT}</span>
          </p>
        )}

        {riedenExpanded && (
        <div className="space-y-3">
          {lagen.map((gruppe) => {
            const { schluessel, name: lageName, weingaerten: wgs } = gruppe
            // Bug 30.09.2026 / wie die Ernte (KAN-160): Lage mit genau einer Ried (bei Gebeshuber der Regelfall,
            // gleicher Name) als EINE Zeile statt Lage-Kopf und Ried darunter
            const einzelRied = istEinzelRied(gruppe)
            const spritzbare = wgs.filter(w => w.spritzbar)
            const allSelected = spritzbare.length > 0 && spritzbare.every(w => selectedWGs.has(w.id))
            const someSelected = spritzbare.some(w => selectedWGs.has(w.id) || [...selectedGSTs.values()].includes(w.id))
            const lageHa = spritzbare.reduce((s, w) => {
              if (selectedWGs.has(w.id)) return s + w.gst_ha_aktiv
              const gsts = gstByWeingarten[w.id] ?? []
              return s + gsts.filter(g => selectedGSTs.has(g.id)).reduce((s2, g) => s2 + (g.flaeche_ha ?? 0), 0)
            }, 0)

            return (
              <div key={schluessel} className="border border-s112-border rounded-xl overflow-hidden">
                {/* Lage-Header (nicht bei einer Lage mit nur einer Ried) */}
                {!einzelRied && <div
                  className="flex items-center gap-3 px-3 py-2 bg-s112-bg cursor-pointer hover:bg-s112-bg/80 transition-colors"
                  onClick={() => toggleLage(wgs)}
                >
                  <input
                    type="checkbox"
                    readOnly
                    aria-label={`${lageName}: alle spritzbaren auswählen`}
                    aria-invalid={riedHinweis || undefined} aria-describedby={riedMeldung}
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected && !allSelected }}
                    className="accent-s112-teal"
                  />
                  <span className="text-sm font-semibold text-s112-text">{lageName}</span>
                  <span className="text-xs text-s112-muted">{spritzbare.length} spritzbar</span>
                  {lageHa > 0 && (
                    <span className="ml-auto text-xs text-s112-blue-700">{fmtHa(lageHa)}</span>
                  )}
                </div>}
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
                      <div key={w.id} className={!w.spritzbar ? 'bg-s112-bg' : ''}>
                        <div className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors
                          ${w.spritzbar ? 'hover:bg-s112-bg/40' : 'opacity-40'}`}>
                          <input
                            type="checkbox"
                            aria-label={w.name}
                            aria-invalid={riedHinweis || undefined} aria-describedby={riedMeldung}
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
                              <span className={`font-medium ${isActive ? 'text-s112-blue-700' : 'text-s112-text'}`}>
                                {einzelRied ? lageName : w.name}
                                {einzelRied && weingartenZusatz(lageName, w.name) && <span className="font-normal text-s112-text-1"> · {w.name}</span>}
                              </span>
                              <span className="text-xs text-s112-muted">{gsts.length} GST</span>
                              {w.gst_ha_aktiv > 0 && (
                                <span className="text-xs text-s112-muted ml-auto">{fmtHa(w.gst_ha_aktiv)}</span>
                              )}
                            </button>
                          ) : (
                            <span className={`font-medium flex-1 ${isActive ? 'text-s112-blue-700' : 'text-s112-text'}`}>
                              {einzelRied ? lageName : w.name}
                              {einzelRied && weingartenZusatz(lageName, w.name) && <span className="font-normal text-s112-text-1"> · {w.name}</span>}
                            </span>
                          )}
                          {!w.spritzbar && (
                            <span className="text-xs bg-[#F2F3F5] text-s112-text-2 px-1.5 py-0.5 rounded-full">
                              Brache / Gerodet
                            </span>
                          )}
                        </div>
                        {isExpanded && gsts.length > 0 && w.spritzbar && (
                          <div className="bg-white border-t border-s112-border/20">
                            {gsts.map(g => {
                              // ganze Ried gewählt = alle ihre WI-GST gewählt (so rechnet auch der Server)
                              const isGstSel = wgSel || selectedGSTs.has(g.id)
                              return (
                                <Fragment key={g.id}>
                                  <label className={`flex items-center gap-2 pl-10 pr-4 py-1.5 text-xs cursor-pointer hover:bg-s112-bg/30 ${isGstSel ? 'bg-s112-teal/5' : ''}`}>
                                    <input type="checkbox"
                                      aria-invalid={riedHinweis || undefined} aria-describedby={riedMeldung}
                                      checked={isGstSel}
                                      onChange={() => toggleGST(g.id, w.id)}
                                      className="accent-s112-teal" />
                                    <span className={`font-mono ${isGstSel ? 'text-s112-blue-700 font-medium' : 'text-s112-text-2'}`}>
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
          <div className="mt-3 bg-s112-teal/5 border border-s112-teal/20 rounded-xl px-4 py-2.5 text-sm text-s112-text-1">
            <span className="font-semibold text-s112-blue-700">{selectedWGs.size}</span> Ried/Rieden
            {selectedGSTs.size > 0 && <> · <span className="font-semibold text-s112-blue-700">{selectedGSTs.size}</span> GST</>} ·{' '}
            <span className="font-semibold">{fmtHa(totalHaAktiv)}</span> aktive Fläche
            {mengenTexteAktiv?.mittel && <> · <span className="text-s112-text-2">{mengenTexteAktiv.mittelLabel} {mengenTexteAktiv.mittel}</span></>}
            {mengenTexteAktiv?.bruehe && <> · <span className="text-s112-text-2">Spritzbrühe {mengenTexteAktiv.bruehe}</span></>}
            {mengenTexteAktiv?.cu && <> · <span className="text-s112-blue-700 font-medium">Cu: {mengenTexteAktiv.cu}</span></>}
            {mengenTexteAktiv?.reinkupfer && <> · <span className="text-s112-blue-700 font-medium">Reinkupfer: {mengenTexteAktiv.reinkupfer}</span></>}
          </div>
        )}
      </div>

      {/* Kosten-Vorschlagsfunktion (optional) */}
      <div className="card space-y-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" name="kosten_aktiv" checked={kostenAktiv}
            onChange={e => { setKostenAktiv(e.target.checked); betragManuellGeaendert.current = false }}
            className="accent-s112-teal" />
          <h2 className="text-base font-semibold text-s112-text">Kosten erfassen</h2>
        </label>
        <p className="text-xs text-s112-muted -mt-2">
          Optional: Material- und Personalkosten dieser Maßnahme automatisch vorschlagen (Material = Preis je
          kg bzw. l × Mittelmenge, Personal/Maschinen = Hektarsatz × Fläche) und als Kosteneintrag in der
          Kostenrechnung anlegen.
        </p>

        {kostenAktiv && (
          <div className="space-y-3 pt-1">
            {(materialkosten > 0 || personalkosten > 0) && (
              <div className="bg-s112-bg rounded-lg px-3 py-2 text-xs text-s112-text-2 flex flex-wrap gap-x-4 gap-y-1">
                {materialkosten > 0 && (
                  <span>
                    Material: <strong>{fmtEuro(materialkosten)} €</strong>
                    {material.menge !== null && materialpreisProEinheit && (
                      <> ({fmtNum(material.menge, { max: 3 })} {materialEinheit} × {fmtNum(materialpreisProEinheit, { min: 2, max: 4 })} €/{materialEinheit})</>
                    )}
                  </span>
                )}
                {personalkosten > 0 && (
                  <span>
                    Personal/Maschinen: <strong>{fmtEuro(personalkosten)} €</strong>
                    {gewaehlterSatz && <> ({fmtEuro(gewaehlterSatz.satz_pro_ha)} €/ha × {fmtHa(totalHaAktiv)})</>}
                  </span>
                )}
                <span>Vorschlag gesamt: <strong className="text-s112-blue-700">{fmtEuro(kostenVorschlag)} €</strong></span>
              </div>
            )}
            {material.hinweis && (
              <p className="text-xs text-s112-warn-fg flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />{material.hinweis}
              </p>
            )}

            {passendeSaetze.length > 0 && (
              <div>
                <label className="block text-sm font-medium text-s112-text-1 mb-1">Hektarsatz</label>
                <select aria-label="Hektarsatz" value={selectedSatzId || passendeSaetze[0].id}
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
                <label className="block text-sm font-medium text-s112-text-1 mb-1">Kostenart</label>
                <select aria-label="Kostenart" name="kosten_kostenart_id" value={kostenKostenartId}
                  onChange={e => setKostenKostenartId(e.target.value)}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                  <option value="">– Auswählen –</option>
                  {kostenarten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-s112-text-1 mb-1">Betrag (€)</label>
                <input aria-label="Betrag (€)" name="kosten_betrag" type="number" step="0.01" min="0"
                  value={kostenBetrag}
                  onChange={e => { setKostenBetrag(e.target.value); betragManuellGeaendert.current = true }}
                  className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-s112-text-1 mb-1">Beschreibung</label>
              <input aria-label="Beschreibung" name="kosten_beschreibung" type="text" value={kostenBeschreibung}
                onChange={e => setKostenBeschreibung(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        {/* nur beim Speichern gesperrt – fehlende Auswahl bzw. Bio-Sperre zeigt der Klick (absendenHindernis, KAN-153) */}
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {erfassenKnopfText(pending, totalSelCount)}
        </button>
        <a href="/behandlungen" className="px-5 py-2.5 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </a>
      </div>
    </form>
  )
}
