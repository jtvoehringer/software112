'use client'

import { zielNachVorgang } from '@/lib/navigation/zurueckBrowser'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import AnwendungFelder, { type MitgliedAuswahl } from '../../neu/AnwendungFelder'
import { PSM_FRIST_STANDARD_H } from '@/lib/behandlungen/erfassungsfrist'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBehandlung } from '../../actions'
import type { KostenartOption, WeingartenOption, GSTOption } from '../../neu/page'
import RiedAuswahlListe from '../../neu/RiedAuswahlListe'
import { Hourglass, Ban, AlertTriangle } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'
import { runden } from '@/lib/csv'
import { STELLEN_MENGE } from '@/lib/behoerden/psm'
import { pruefeMassnahmeMengen } from '@/lib/behandlungen/massnahmeMengen'
import {
  LAUBARBEIT_OPTIONEN, LAUBSCHNEIDEN_HINWEIS, artMitDuengemittel, artMitPsm, laubarbeitAltwert, type MassnahmenArt,
} from '@/lib/behandlungen/arten'
import {
  MENGEN_SICHT, alsFeld, aufwandEinheitText, duengerEinheitWechsel, duengermengeEinheit, eingabeZahl,
  mengeVorbelegung, mengenFelder, mengenInFormData, mengenSicht, eingabeFolge, type MengenGroesse,
} from '../../neu/mengenFelder'
import {
  BBCH_OPTIONS, FELD_MATRIX, SCHADERREGER_OPTIONEN, WITTERUNG_OPTIONEN, bbchAltwert, feldPflicht, felderBeimBearbeiten,
  schaderregerFeld, EINARBEITUNG_GESENDET, einarbeitungBeimBearbeiten, pflichtBeimBearbeiten,
} from '../../neu/feldMatrix'
import { ART_OPTIONS } from '../../neu/artOptionen'
import MengenZusammenfassung from '../../neu/MengenZusammenfassung'
import BetriebsmittelFeld, { bmStandardAufwand, type BmMassnahmeOption } from '../../neu/BetriebsmittelFeld'
import { artMitBetriebsmittel } from '@/lib/behandlungen/betriebsmittel'
import BienenschutzHinweis from '@/components/behandlungen/BienenschutzHinweis'
import { rund } from '@/lib/zahl/runden'

// Welche Mengen-Felder pro Art sichtbar/pflicht sind, kommt aus MENGEN_SICHT (neu/mengenFelder.ts) -
// identisch zum Anlegen-Formular, damit Anlegen und Bearbeiten konsistent sind (siehe "Analyse
// Maßnahmen.docx", Tabelle 2; KAN-133). BBCH, Schaderreger bzw. Grund / Anlass, Witterung und Temperatur:
// felderBeimBearbeiten (neu/feldMatrix.ts, KAN-143 und KAN-152) – sichtbar laut Feld-Matrix, sonst bei
// unveränderter Art der gespeicherte Wert unsichtbar, nach einem Artwechsel nichts. KAN-154: Einarbeitung nach
// demselben Muster (einarbeitungBeimBearbeiten), Pflichtfelder wie beim Anlegen – Altdaten ohne Wert bleiben
// speicherbar (pflichtBeimBearbeiten) –, Pflanzenschutzmittel bei Sonstiges optional und Bio-Sperre wie KAN-153.
type Art = MassnahmenArt

const BIO_SPERRE = new Set(['bio_eu', 'biodynamisch'])
const BIO_WARNUNG = new Set(['kip', 'nachhaltig'])

export type BehandlungEdit = {
  id: string
  datum: string
  datum_bis: string | null
  art: string
  psm_id: string | null
  duengemittel_id: string | null
  /** KAN-167: Weinbehandlungs- bzw. Produktionsmittel (Sonstiges, Laubarbeit); Aufwand dann in aufwandmenge */
  betriebsmittel_id: string | null
  aufwandmenge: number | null
  aufwandmenge_einheit: string | null
  menge_gesamt: number | null
  menge_einheit: string | null
  konzentration: number | null
  wasseraufwand_l_ha: number | null
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
  /** KAN-87 */
  uhrzeit_von?: string | null
  uhrzeit_bis?: string | null
  durchgefuehrt_von?: string | null
  anwender_name?: string | null
  art_verwendung?: string | null
  /** KAN-325: gespeicherte Bienenschutz-Bestätigung (Zeitpunkt und Name setzt die Datenbank) */
  bienenschutz_bestaetigt_am?: string | null
  bienenschutz_bestaetigt_von_name?: string | null
}

export type PSMOption = {
  id: string
  name: string
  handelsname: string | null
  oeko_zugelassen: boolean
  cu_gehalt_pct: number | null
  /** Ersatz für den Cu-Gehalt bei Kupfer-Wirkstoffen (wie die Kupfer-Bilanz) */
  wirkstoff: string | null
  wirkstoffgehalt_pct: number | null
  wartezeit_tage: number | null
  /** KAN-87: Startuhrzeit Pflicht */
  bienengefaehrlich?: boolean | null
}

export type DuengemittelOption = {
  id: string
  name: string
  handelsname: string | null
  typ: string | null
  wartezeit_tage: number | null
  oeko_zugelassen: boolean
  /** 'kg' | 'l' – Düngermenge in l nur bei Düngemitteln in l (KAN-133) */
  einheit: string | null
}

export type BestehenderKostenEintrag = {
  kostenart_id: string | null
  betrag: number
  beschreibung: string | null
}

// KAN-181: am Handy 16 px (kein iOS-Zoom) und höhere Felder
const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
const labelCls = 'block text-sm font-medium text-s112-text-1 mb-1'

export default function BehandlungEditForm({
  behandlung, psm, duengemittel, bioStatus, kostenarten, bestehenderKostenEintrag, flaecheHa,
  weingaerten, gstByWeingarten, startWGs, startGSTs, betriebsmittel = [], kostenModul = true,
  mitglieder = [], ichId = null, psmFristH = PSM_FRIST_STANDARD_H,
}: {
  /** KAN-87: Anwender-Auswahl, angemeldeter Benutzer, Erfassungsfrist (h) */
  mitglieder?: MitgliedAuswahl[]
  ichId?: string | null
  psmFristH?: number
  /** KAN-167: Betriebsmittel (aktiv bzw. das gespeicherte) */
  betriebsmittel?: BmMassnahmeOption[]
  behandlung: BehandlungEdit
  psm: PSMOption[]
  duengemittel: DuengemittelOption[]
  bioStatus: string
  kostenarten: KostenartOption[]
  /** KAN-195: Kostenrechnung nur mit Paket-Modul Controlling */
  kostenModul?: boolean
  bestehenderKostenEintrag: BestehenderKostenEintrag | null
  /** Σ Fläche der Grundstücke dieser Maßnahme (ha); null = keine Grundstücke zugeordnet */
  flaecheHa: number | null
  /** Rückmeldung 30.09.2026: Rieden beim Bearbeiten änderbar – Optionen und bisherige Auswahl */
  weingaerten: WeingartenOption[]
  gstByWeingarten: Record<string, GSTOption[]>
  startWGs: string[]
  startGSTs: [string, string][]
}) {
  const [selectedWGs, setSelectedWGs] = useState<Set<string>>(() => new Set(startWGs))
  const [selectedGSTs, setSelectedGSTs] = useState<Map<string, string>>(() => new Map(startGSTs))
  const [riedenOffen, setRiedenOffen] = useState(false)
  // behandelte Fläche aus der aktuellen Auswahl (ganze Rieden = Σ WI-GST, sonst Σ gewählte GST); ohne Grundstücks-
  // zuordnung (Altdaten) die bisherige Fläche
  const gstFlaeche = new Map<string, number>()
  for (const gsts of Object.values(gstByWeingarten)) for (const g of gsts) gstFlaeche.set(g.id, g.flaeche_ha ?? 0)
  const auswahlHa = weingaerten.filter(w => selectedWGs.has(w.id)).reduce((s, w) => s + w.gst_ha_aktiv, 0)
    + [...selectedGSTs.keys()].reduce((s, id) => s + (gstFlaeche.get(id) ?? 0), 0)
  const auswahlLeer = selectedWGs.size === 0 && selectedGSTs.size === 0
  const flaecheAktuell = auswahlLeer ? flaecheHa : (auswahlHa > 0 ? rund(auswahlHa, 4) : null)
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const startArt = (behandlung.art as Art) ?? 'spritzung'
  const [art, setArt] = useState<Art>(startArt)
  // ältere Freitext-Unterart einer Laubarbeit (nicht in LAUBARBEIT_OPTIONEN) – eigene Option in der Auswahl
  const laubarbeitBisher = laubarbeitAltwert(behandlung.laubarbeit_art)
  // gespeichertes BBCH-Stadium außerhalb von BBCH_OPTIONS (z. B. „68“) – eigene Option in der BBCH-Auswahl
  const bbchBisher = bbchAltwert(behandlung.bbch_stadium)
  // BBCH-Auswahl (Spritzung, Laubarbeit, Laubschneiden) als gesteuerter Wert: Das Stadium bleibt zwischen Arten
  // mit Auswahl – unabhängig vom Weg und samt eigener Eingabe – erhalten wie im Anlegen-Formular.
  const [bbch, setBbch] = useState(behandlung.bbch_stadium ?? '')
  // Je Feld (BBCH, Schaderreger bzw. Grund / Anlass, Witterung, Temperatur) genau ein Modus aus der Feld-Matrix:
  // 'sichtbar' – Eingabefeld; 'behalten' – ausgeblendet bei unveränderter Art: der gespeicherte Wert geht
  // unsichtbar mit (nicht der State – eine Änderung auf einem Umweg über eine Art mit Eingabefeld wäre dort
  // weder sichtbar noch korrigierbar); 'keine' – nach einem Wechsel auf eine Art ohne das Feld: nichts senden,
  // Speichern leert es wie beim Anlegen
  const modus = felderBeimBearbeiten(art, startArt)
  const schaderreger = schaderregerFeld(art)
  const [selectedPsmId, setSelectedPsmId] = useState(behandlung.psm_id ?? '')
  const [datum, setDatum] = useState(behandlung.datum)
  const [datumBis, setDatumBis] = useState(behandlung.datum_bis ?? '')
  const [selectedDuengemittelId, setSelectedDuengemittelId] = useState(behandlung.duengemittel_id ?? '')
  // KAN-167: Betriebsmittel samt Aufwand (gespeichert in aufwandmenge/aufwandmenge_einheit)
  const bmStart = {
    id: behandlung.betriebsmittel_id ?? '',
    aufwand: behandlung.betriebsmittel_id ? alsFeld(behandlung.aufwandmenge) : '',
    einheit: behandlung.betriebsmittel_id && behandlung.aufwandmenge_einheit
      ? behandlung.aufwandmenge_einheit
      : bmStandardAufwand(betriebsmittel.find(o => o.id === behandlung.betriebsmittel_id)?.einheit),
  }
  const [selectedBmId, setSelectedBmId] = useState(bmStart.id)
  const [bmAufwand, setBmAufwand] = useState(bmStart.aufwand)
  const [bmAufwandEinheit, setBmAufwandEinheit] = useState(bmStart.einheit)
  // Gespeicherte Mengen als Formularwerte (Dezimalkomma, siehe alsFeld)
  const [start] = useState(() => ({
    aufwand: alsFeld(behandlung.aufwandmenge),
    aufwandEinheit: behandlung.aufwandmenge_einheit ?? 'kg_ha',
    konzentration: alsFeld(behandlung.konzentration),
  }))
  // Gespeicherte „Menge gesamt“ in der Einheit des Felds – gegen das aktuell gewählte Düngemittel, damit ein
  // Wechsel kg ↔ l wie beim Laden geprüft wird; ein Altwert (Spritzung in kg/g, Düngermenge in der anderen
  // Einheit) bleibt draußen (KAN-133 Soll 9)
  const duengerEinheitVon = (id: string) => duengermengeEinheit(duengemittel.find(d => d.id === id)?.einheit)
  // Einheit des gespeicherten Düngemittels: gilt für eine gespeicherte Düngermenge ohne Einheit
  const gespeichertEinheit = duengerEinheitVon(behandlung.duengemittel_id ?? '')
  const vorbelegung = mengeVorbelegung(behandlung, duengerEinheitVon(selectedDuengemittelId), gespeichertEinheit)
  const [mengeGesamt, setMengeGesamt] = useState(vorbelegung.text)
  // Hinweis, wenn ein anderes Düngemittel die Einheit einer eigenen Eingabe wechselt (duengerEinheitWechsel)
  const [einheitHinweis, setEinheitHinweis] = useState<string | null>(null)
  const [wasseraufwand, setWasseraufwand] = useState(alsFeld(behandlung.wasseraufwand_l_ha))
  // Analog zum Anlegen-Formular (NeueBehandlungForm.tsx, Punkte 1 und 2 der Anforderung): Spritzbrühe
  // gesamt ↔ Wasseraufwand (über die Fläche der Maßnahme); Aufwandmenge, Konzentration und Wasseraufwand – je
  // zwei bestimmen die dritte (KAN-155, folge) –, sobald eines der Felder geändert wird. Gespeicherte Werte
  // bleiben bis dahin frei editierbar und zählen dann als ältere Eingaben (berechneteGroesse).
  const [mengeQuelle, setMengeQuelle] = useState<'gesamt' | 'wasser' | null>(null)
  const [aufwandmenge, setAufwandmenge] = useState(start.aufwand)
  const [aufwandmengeEinheit, setAufwandmengeEinheit] = useState(start.aufwandEinheit)
  const [konzentration, setKonzentration] = useState(start.konzentration)
  const [folge, setFolge] = useState<MengenGroesse[]>([])
  const [error, setError] = useState<string | null>(null)
  // Einarbeitung (nur sichtbar bei organischem Dünger): null = keine Angabe – dann geht einarbeitung_gesendet
  // nicht mit und Speichern lässt null stehen; ein Klick macht daraus ja bzw. nein (KAN-154)
  const [einarbeitung, setEinarbeitung] = useState<boolean | null>(behandlung.einarbeitung)
  // KAN-153/154: „Änderungen speichern“ ist nur beim Speichern gesperrt – ein Klick bei Bio-Sperre zählt hoch,
  // fokussiert das Mittel und lässt den Grund (role="alert") neu vorlesen
  const [bioSprung, setBioSprung] = useState(0)
  const psmRef = useRef<HTMLSelectElement>(null)
  const duengemittelRef = useRef<HTMLSelectElement>(null)

  // Mengenfelder wie beim Anlegen (Aufwand bei Sonstiges nur mit gewähltem Mittel); unbekannte Art wie Spritzung
  const felder = mengenSicht(art, !!selectedPsmId) ?? MENGEN_SICHT.spritzung

  // Kosten (Punkte 6, 9: beim Bearbeiten sichtbar + editierbar, analog Neu-Formular)
  const [kostenAktiv, setKostenAktiv] = useState(!!bestehenderKostenEintrag)
  const [kostenKostenartId, setKostenKostenartId] = useState(bestehenderKostenEintrag?.kostenart_id ?? '')
  const [kostenBetrag, setKostenBetrag] = useState(bestehenderKostenEintrag ? String(bestehenderKostenEintrag.betrag) : '')
  const [kostenBeschreibung, setKostenBeschreibung] = useState(bestehenderKostenEintrag?.beschreibung ?? '')

  const selectedPsm = psm.find(p => p.id === selectedPsmId)
  const selectedDuengemittel = duengemittel.find(d => d.id === selectedDuengemittelId)

  // nur das Mittel, dessen Feld die Art zeigt (beim Artwechsel wird ein ausgeblendetes Mittel geleert)
  const gewaehltesMittelOeko =
    artMitPsm(art)          ? selectedPsm?.oeko_zugelassen :
    artMitDuengemittel(art) ? selectedDuengemittel?.oeko_zugelassen :
    undefined
  const mittelNichtOeko = gewaehltesMittelOeko === false
  const bioSperre  = BIO_SPERRE.has(bioStatus) && mittelNichtOeko
  const bioWarnung = !bioSperre && BIO_WARNUNG.has(bioStatus) && mittelNichtOeko
  // Einarbeitung je Modus (wie felderBeimBearbeiten): Checkbox, gespeicherter Wert unsichtbar oder nichts
  const einarbeitungModus = einarbeitungBeimBearbeiten(art, startArt, selectedDuengemittel?.typ)
  // Pflicht (Stern und required) wie beim Anlegen – aber nur nach einem Artwechsel oder wenn schon ein Wert
  // gespeichert ist: Altdaten ohne Wert bleiben unverändert speicherbar (KAN-154)
  const pflicht = {
    bbch:               pflichtBeimBearbeiten('bbch', art, startArt, behandlung.bbch_stadium),
    schaderreger:       pflichtBeimBearbeiten('schaderreger', art, startArt, behandlung.schaderreger),
    bearbeitungstiefe:  pflichtBeimBearbeiten('bearbeitungstiefe', art, startArt, behandlung.bearbeitungstiefe_cm),
    bearbeitungsgeraet: pflichtBeimBearbeiten('bearbeitungsgeraet', art, startArt, behandlung.bearbeitungsgeraet),
    schnittart:         pflichtBeimBearbeiten('schnittart', art, startArt, behandlung.schnittart),
  }

  // Nach dem Klick bei Bio-Sperre: zum Mittel scrollen und es fokussieren – der Grund steht direkt darunter
  useEffect(() => {
    if (bioSprung === 0) return
    const mittel = psmRef.current ?? duengemittelRef.current
    mittel?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    mittel?.focus({ preventScroll: true })
  }, [bioSprung])

  // Menge und Aufwand bedeuten je Art etwas anderes (Spritzbrühe bzw. Düngermenge, Mittel bzw. Dünger) –
  // beim Wechsel leeren, bei Rückkehr zur gespeicherten Art die gespeicherten Werte wieder zeigen
  function artWechseln(neu: Art) {
    if (neu === art) return
    const zurueck = neu === startArt
    setArt(neu)
    // Mittel, das die neue Art nicht zeigt, leeren (wie im Anlegen-Formular) – sonst ginge seine Wartezeit mit;
    // bei Rückkehr zur gespeicherten Art das gespeicherte Mittel wieder wählen
    if (!artMitPsm(neu)) setSelectedPsmId('')
    else if (zurueck) setSelectedPsmId(behandlung.psm_id ?? '')
    if (!artMitDuengemittel(neu)) setSelectedDuengemittelId('')
    else if (zurueck) setSelectedDuengemittelId(behandlung.duengemittel_id ?? '')
    if (!artMitBetriebsmittel(neu)) { setSelectedBmId(''); setBmAufwand('') }
    else if (zurueck) { setSelectedBmId(bmStart.id); setBmAufwand(bmStart.aufwand); setBmAufwandEinheit(bmStart.einheit) }
    // Vorbelegung zum gespeicherten Düngemittel (die Auswahl ist beim Zurückwechseln erst im nächsten Render gesetzt)
    setMengeGesamt(zurueck ? mengeVorbelegung(behandlung, gespeichertEinheit, gespeichertEinheit).text : '')
    setEinheitHinweis(null)
    setAufwandmenge(zurueck ? start.aufwand : '')
    setAufwandmengeEinheit(zurueck ? start.aufwandEinheit : 'kg_ha')
    setKonzentration(zurueck ? start.konzentration : '')
    setMengeQuelle(null)
    setFolge([])
  }

  // Die Düngermenge gilt in der Einheit des Düngemittels (kg bzw. l, ohne Dichte-Annahme). Wechselt ein
  // anderes Düngemittel die Einheit, wird die unveränderte Vorbelegung wie beim Laden neu geprüft (950 kg bei
  // einem Düngemittel in l → Altwert, Feld leer); eine eigene Eingabe bleibt stehen, mit Hinweis
  function duengemittelWechseln(id: string) {
    const von = duengerEinheitVon(selectedDuengemittelId)
    const nach = duengerEinheitVon(id)
    if (art === startArt && mengeGesamt === vorbelegung.text) {
      setMengeGesamt(mengeVorbelegung(behandlung, nach, gespeichertEinheit).text)
      setEinheitHinweis(null)
    } else {
      const hinweis = duengerEinheitWechsel(von, nach, mengeGesamt)
      if (hinweis) setEinheitHinweis(hinweis)
    }
    setSelectedDuengemittelId(id)
  }

  // ─── Mengen: Kopplungen, Mittelmenge, Cu, Reinkupfer – Rechnung und Prüfung wie in updateBehandlung ──
  const m = mengenFelder({
    art, felder,
    mengeGesamt, wasseraufwand, mengeQuelle,
    aufwandmenge, aufwandmengeEinheit, konzentration, folge,
    flaecheHa: flaecheAktuell,
    psmId: selectedPsmId || null,
    psm: selectedPsm
      ? { cuGehaltPct: selectedPsm.cu_gehalt_pct, wirkstoff: selectedPsm.wirkstoff, wirkstoffgehaltPct: selectedPsm.wirkstoffgehalt_pct }
      : null,
    duengemittelId: selectedDuengemittelId || null,
    duengemittelEinheit: selectedDuengemittel?.einheit ?? null,
    formular: 'bearbeiten',
  })
  const wasserGesperrt = m.gesperrt.wasser
  const mengeGesamtGesperrt = m.gesperrt.mengeGesamt
  const konzentrationGesperrt = m.gesperrt.konzentration
  const aufwandmengeGesperrt = m.gesperrt.aufwandmenge

  // Altwert (gespeicherte Menge passt nicht zur Einheit des Felds, auch nach einem Wechsel des Düngemittels):
  // Speichern erst, wenn die Spritzbrühe bzw. Düngermenge neu angegeben ist – direkt oder über den
  // Wasseraufwand × Fläche
  const altwertSichtbar = vorbelegung.altwert !== null && art === startArt && felder.mengeGesamt !== 'hidden'
  const altwertOffen = altwertSichtbar && m.eingabe.mengeGesamt === null
  const wasserZahl = eingabeZahl(wasseraufwand)
  const brueheAusWasser = art === 'spritzung' && m.ha !== null && wasserZahl !== null && wasserZahl > 0
    ? runden(wasserZahl * m.ha, STELLEN_MENGE) : null
  const altwertFehler = art === 'spritzung'
    ? `Bitte die Spritzbrühe gesamt (l) neu eingeben – der bisherige Wert (${vorbelegung.altwert}) ist keine Spritzbrühe und wird nicht übernommen.`
    : `Bitte die Düngermenge gesamt (${m.mengeEinheit}) neu eingeben – der bisherige Wert (${vorbelegung.altwert}) passt nicht zur Einheit des Düngemittels.`

  const updateWithId = updateBehandlung.bind(null, behandlung.id)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    // KAN-154 wie KAN-153: statt eines gesperrten Knopfs zeigt der Klick den Grund am Mittel – nichts wird gesendet
    if (bioSperre) { setBioSprung(n => n + 1); return }
    if (altwertOffen) { setError(altwertFehler); return }
    if (auswahlLeer && startWGs.length + startGSTs.length > 0) { setRiedenOffen(true); setError('Bitte mindestens eine Ried oder ein Grundstück auswählen.'); return }
    // Dieselbe Prüfung wie updateBehandlung, im Formular zusätzlich mit Pflicht Spritzbrühe gesamt oder
    // Wasseraufwand (KAN-133)
    const mengen = pruefeMassnahmeMengen(m.eingabe, { bruehePflicht: true })
    if (!mengen.ok) { setError(mengen.fehler); return }
    if (m.konzentrationFehler) { setError(m.konzentrationFehler); return }
    const fd = new FormData(e.currentTarget)
    // wartezeit_tage nur aus dem Mittel, das die Art zeigt (psm_id bzw. duengemittel_id gehen nur dann mit)
    const wartezeit = artMitPsm(art) ? selectedPsm?.wartezeit_tage
      : artMitDuengemittel(art) ? selectedDuengemittel?.wartezeit_tage
      : null
    if (wartezeit != null) {
      fd.set('wartezeit_tage', String(wartezeit))
    }
    // Mengen so, wie die Prüfung sie normalisiert hat; gesperrte (berechnete) Felder sind disabled und
    // würden sonst fehlen. reinkupfer_kg_ha rechnet updateBehandlung selbst.
    mengenInFormData(fd, felder, mengen.werte, m.konzentrationNum)
    // Ried-Auswahl (Rückmeldung 30.09.2026) – der Server ersetzt die Grundstücke der Maßnahme nur, wenn sie sich ändern
    if (!auswahlLeer) {
      fd.set('ried_auswahl', '1')
      selectedWGs.forEach(id => fd.append('weingarten_ids', id))
      selectedGSTs.forEach((_wgId, gstId) => fd.append('grundstueck_ids', gstId))
    }
    startTransition(async () => {
      try {
        await updateWithId(fd)
        router.push(zielNachVorgang('/behandlungen', 'gespeichert'))   // KAN-224: zurück, woher man kam
        router.refresh()
      } catch (err) {
        setError(fehlerText(err))
      }
    })
  }

  return (
    <form data-ungespeichert onSubmit={handleSubmit} className="space-y-6">

      {/* Ried(en) – seit 30.09.2026 änderbar (Rückmeldung Jörgen); dieselbe Auswahl wie „Neue Maßnahme“ */}
      <div className="card">
        <button type="button" onClick={() => setRiedenOffen(v => !v)} aria-expanded={riedenOffen}
          className="flex items-center gap-2 text-left w-full">
          <svg className={`w-3.5 h-3.5 text-s112-muted transition-transform shrink-0 ${riedenOffen ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
          <h2 className="text-base font-semibold text-s112-text">
            Ried(en)
            <span className="ml-2 text-sm font-normal text-s112-blue-700">
              {auswahlLeer ? 'keine Auswahl' : `${selectedWGs.size} Ried/Rieden${selectedGSTs.size > 0 ? ` · ${selectedGSTs.size} GST` : ''}${flaecheAktuell !== null ? ` · ${fmtNum(flaecheAktuell, { max: 4 })} ha` : ''}`}
            </span>
          </h2>
        </button>
        {m.ha !== null && (
          <p className="text-xs text-s112-muted mt-1 ml-5">
            Behandelte Fläche: {fmtNum(m.ha, { max: 4 })} ha (Σ der ausgewählten Grundstücke – Spritzbrühe, Wasseraufwand
            und Kosten rechnen damit)
          </p>
        )}
        {auswahlLeer && behandlung.weingarten_name && (
          <p className="text-xs text-s112-muted mt-1 ml-5">
            Bisher ohne Grundstücke erfasst: {behandlung.weingarten_name} – eine Auswahl ordnet die Maßnahme Grundstücken zu.
          </p>
        )}
        {riedenOffen && (
          <div className="mt-3">
            <RiedAuswahlListe weingaerten={weingaerten} gstByWeingarten={gstByWeingarten}
              selectedWGs={selectedWGs} setSelectedWGs={setSelectedWGs} selectedGSTs={selectedGSTs} setSelectedGSTs={setSelectedGSTs}
              riedHinweis={false} riedMeldung={undefined} />
            <p className="text-xs text-s112-muted mt-2">
              Eine geänderte Auswahl ersetzt die Grundstücke der Maßnahme; die Fläche bisher behandelter Grundstücke bleibt
              wie erfasst, neu gewählte Grundstücke übernehmen ihre heutige Fläche. Mengen, Anteile und Kosten rechnen danach neu.
            </p>
          </div>
        )}
      </div>

      {/* Art & Datum */}
      <div className="card space-y-4">
        <h2 className="text-base font-semibold text-s112-text">Maßnahme</h2>

        <div>
          <label className={labelCls}>Art</label>
          <div className="flex flex-wrap gap-2">
            {ART_OPTIONS.map(o => (
              <label key={o.value} className={`flex items-center gap-1.5 px-3 py-2.5 sm:py-1.5 rounded-lg border text-sm cursor-pointer transition-colors
                ${art === o.value
                  ? 'bg-s112-teal text-s112-yellow border-s112-teal'
                  : 'bg-white text-s112-text-1 border-s112-border hover:border-s112-teal/50'}`}>
                <input type="radio" name="art" value={o.value} checked={art === o.value}
                  onChange={() => artWechseln(o.value)} className="sr-only" />
                <o.icon size={14} />{o.label}
              </label>
            ))}
          </div>
          {art === 'laubschneiden' && <p className="text-xs text-s112-muted mt-1">{LAUBSCHNEIDEN_HINWEIS}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Datum von <span className="text-s112-err">*</span></label>
            <input aria-label="Datum von" name="datum" type="date" required value={datum} onChange={e => setDatum(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Datum bis</label>
            <input aria-label="Datum bis" name="datum_bis" type="date" value={datumBis} onChange={e => setDatumBis(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* KAN-87: Uhrzeit, Anwender, Art der Verwendung – erfasst am/von bleibt unverändert */}
        <AnwendungFelder mitglieder={mitglieder} ichId={ichId} mitPsm={artMitPsm(art) && !!selectedPsmId}
          bienengefaehrlich={artMitPsm(art) && !!psm.find(p => p.id === selectedPsmId)?.bienengefaehrlich}
          datum={datum} datumBis={datumBis} fristH={psmFristH} vorschau={false}
          start={{ uhrzeitVon: behandlung.uhrzeit_von, uhrzeitBis: behandlung.uhrzeit_bis, durchgefuehrtVon: behandlung.durchgefuehrt_von,
            anwenderName: behandlung.anwender_name, artVerwendung: behandlung.art_verwendung }} />

        {/* PSM laut Feld-Matrix wie beim Anlegen: Pflicht bei Spritzung, optional bei Sonstiges (KAN-154) */}
        {artMitPsm(art) && (
          <div>
            <label className={labelCls}>
              Spritzmittel / Mittel (PSM)
              {feldPflicht('psm', art) && <span className="text-s112-err"> *</span>}
            </label>
            <select ref={psmRef} aria-label="Spritzmittel / Mittel (PSM)" name="psm_id" value={selectedPsmId}
              required={feldPflicht('psm', art)} disabled={art === 'sonstiges' && !!selectedBmId}
              aria-invalid={bioSperre || undefined} aria-describedby={bioSperre ? 'bio-sperre-grund' : undefined}
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

        {/* KAN-167: Betriebsmittel bei Sonstiges und Laubarbeit */}
        {artMitBetriebsmittel(art) && betriebsmittel.length > 0 && (
          <BetriebsmittelFeld optionen={betriebsmittel} wert={selectedBmId} aufwand={bmAufwand} aufwandEinheit={bmAufwandEinheit}
            flaecheHa={flaecheAktuell ?? 0} gesperrtDurchPsm={art === 'sonstiges' && !!selectedPsmId}
            onWert={setSelectedBmId} onAufwand={setBmAufwand} onAufwandEinheit={setBmAufwandEinheit} />
        )}

        {/* Düngemittel */}
        {artMitDuengemittel(art) && (
          <div>
            <label className={labelCls}>Düngemittel</label>
            <select ref={duengemittelRef} aria-label="Düngemittel" name="duengemittel_id" value={selectedDuengemittelId}
              aria-invalid={bioSperre || undefined} aria-describedby={bioSperre ? 'bio-sperre-grund' : undefined}
              onChange={e => duengemittelWechseln(e.target.value)}
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

        {/* Bio-Sperre direkt am Mittel (wie KAN-153 beim Anlegen): role="alert" liest sie beim Wählen des Mittels vor;
            ein Klick auf „Änderungen speichern“ fokussiert das Mittel und zeigt die Meldung neu (key) */}
        {bioSperre && (
          <div key={bioSprung} id="bio-sperre-grund" role="alert"
            className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <Ban size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – passt nicht zum Bio-Status des Betriebs
            ({bioStatus === 'bio_eu' ? 'Bio-EU' : 'Biodynamisch'}). Speichern ist so nicht möglich, bitte ein zugelassenes Mittel wählen.</span>
          </div>
        )}
        {bioWarnung && (
          <div className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <span>Das gewählte Mittel ist nicht öko-zugelassen – bitte prüfen, ob das beabsichtigt ist.</span>
          </div>
        )}

        {/* Altwert: gespeicherte „Menge gesamt“ passt nicht zur Einheit des Felds (Spritzung in kg/g) */}
        {altwertSichtbar && (altwertOffen ? (
          <div className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div className="space-y-1.5">
              {art === 'spritzung' ? (
                <p>
                  „Menge gesamt“ ist noch als <strong>{vorbelegung.altwert}</strong> gespeichert – früher die Mittelmenge. Bei
                  Spritzungen ist das Feld jetzt die Spritzbrühe in Litern, die Mittelmenge ergibt sich aus der
                  Aufwandmenge. Der bisherige Wert wird nicht übernommen: bitte die Spritzbrühe gesamt (l) neu eingeben.
                </p>
              ) : (
                <p>
                  „Düngermenge gesamt“ ist als <strong>{vorbelegung.altwert}</strong> gespeichert und passt nicht zur Einheit des
                  Düngemittels ({m.mengeEinheit}) – bitte neu eingeben.
                </p>
              )}
              {brueheAusWasser !== null && (
                <button type="button" onClick={() => { setMengeGesamt(''); setMengeQuelle('wasser'); setFolge(f => eingabeFolge(f, 'wasser', wasseraufwand)) }}
                  className="text-xs font-medium underline hover:no-underline">
                  Spritzbrühe aus Wasseraufwand × Fläche übernehmen ({fmtNum(brueheAusWasser, { max: 3 })} l)
                </button>
              )}
            </div>
          </div>
        ) : (
          <p className="text-xs text-s112-muted">Bisher gespeichert: {vorbelegung.altwert} – wird durch die neue Angabe ersetzt.</p>
        ))}

        {/* Düngermenge gesamt (kg; l nur bei Düngemitteln in l) */}
        {art === 'duengung' && felder.mengeGesamt !== 'hidden' && (
          <div>
            <label className={labelCls}>
              Düngermenge gesamt ({m.mengeEinheit})
              {felder.mengeGesamt === 'pflicht' && <span className="text-s112-err"> *</span>}
            </label>
            <input aria-label={`Düngermenge gesamt (${m.mengeEinheit})`} name="menge_gesamt" type="text" inputMode="decimal"
              required={felder.mengeGesamt === 'pflicht'}
              value={mengeGesamt}
              onChange={e => { setMengeGesamt(e.target.value); setEinheitHinweis(null) }}
              className={inputCls} />
            {einheitHinweis && (
              <p className="text-xs text-s112-warn-fg mt-1 flex items-start gap-1">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" />{einheitHinweis}
              </p>
            )}
          </div>
        )}

        {/* Aufwandmenge bzw. Konzentration im Tank – einzige Grundlage der Mittelmenge einer Spritzung */}
        {(felder.aufwandmenge !== 'hidden' || felder.konzentration !== 'hidden') && (
          <div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {felder.aufwandmenge !== 'hidden' && (
                <>
                  <div>
                    <label className={labelCls}>
                      {m.jeHl ? 'Konzentration im Tank' : 'Aufwandmenge'}
                      {felder.aufwandmenge === 'pflicht' && <span className="text-s112-err"> *</span>}
                    </label>
                    <input aria-label={m.jeHl ? 'Konzentration im Tank' : 'Aufwandmenge'} name="aufwandmenge" type="text" inputMode="decimal"
                      required={felder.aufwandmenge === 'pflicht' && !aufwandmengeGesperrt}
                      value={m.aufwandmengeBerechnet !== null ? fmtNum(m.aufwandmengeBerechnet, { max: 3 }) : aufwandmenge}
                      disabled={aufwandmengeGesperrt}
                      onChange={e => { const v = e.target.value; setAufwandmenge(v); setFolge(f => eingabeFolge(f, 'aufwand', v)) }}
                      className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                    {m.berechnetHinweis.aufwandmenge && (
                      <p className="text-xs text-s112-muted mt-1">{m.berechnetHinweis.aufwandmenge}</p>
                    )}
                  </div>
                  <div>
                    <label className={labelCls}>Einheit</label>
                    <select aria-label="Einheit" name="aufwandmenge_einheit" value={m.aufwandEinheit}
                      onChange={e => setAufwandmengeEinheit(e.target.value)}
                      className={inputCls}>
                      {m.einheiten.map(e => <option key={e} value={e}>{aufwandEinheitText(e, m.zulaessig)}</option>)}
                    </select>
                  </div>
                </>
              )}
              {felder.konzentration !== 'hidden' && (
                <div>
                  <label className={labelCls}>Konzentration (%)</label>
                  <input aria-label="Konzentration (%)" name="konzentration" type="text" inputMode="decimal"
                    value={m.konzentrationBerechnet !== null ? fmtNum(m.konzentrationBerechnet, { max: 3 }) : konzentration}
                    disabled={konzentrationGesperrt}
                    onChange={e => { const v = e.target.value; setKonzentration(v); setFolge(f => eingabeFolge(f, 'konzentration', v)) }}
                    className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
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

        {/* Spritzbrühe gesamt (l) ↔ Wasseraufwand (l/ha) über die Fläche der Maßnahme; die Brühe ist nie die Mittelmenge */}
        {art === 'spritzung' && (felder.mengeGesamt !== 'hidden' || felder.wasseraufwand !== 'hidden') && (
          <div>
            <div className="grid grid-cols-2 gap-3">
              {felder.mengeGesamt !== 'hidden' && (
                <div>
                  <label className={labelCls}>
                    Spritzbrühe gesamt (l)
                    {felder.mengeGesamt !== 'optional' && <span className="text-s112-err"> *</span>}
                  </label>
                  <input aria-required={felder.mengeGesamt !== 'optional'} aria-label="Spritzbrühe gesamt (l)" name="menge_gesamt" type="text" inputMode="decimal"
                    value={m.mengeGesamtBerechnet !== null ? fmtNum(m.mengeGesamtBerechnet, { max: 3 }) : mengeGesamtGesperrt ? '' : mengeGesamt}
                    disabled={mengeGesamtGesperrt}
                    onChange={e => { const v = e.target.value; setMengeGesamt(v); setMengeQuelle(v.trim() === '' ? null : 'gesamt'); setFolge(f => eingabeFolge(f, 'wasser', v)) }}
                    className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                  {m.berechnetHinweis.mengeGesamt && (
                    <p className="text-xs text-s112-muted mt-1">{m.berechnetHinweis.mengeGesamt}</p>
                  )}
                </div>
              )}
              {felder.wasseraufwand !== 'hidden' && (
                <div>
                  <label className={labelCls}>
                    Wasseraufwand (l/ha)
                    {felder.wasseraufwand !== 'optional' && <span className="text-s112-err"> *</span>}
                  </label>
                  <input aria-required={felder.wasseraufwand !== 'optional'} aria-label="Wasseraufwand (l/ha)" name="wasseraufwand_l_ha" type="text" inputMode="decimal"
                    value={m.wasserBerechnet !== null ? fmtNum(m.wasserBerechnet, { max: 2 }) : wasseraufwand}
                    disabled={wasserGesperrt}
                    onChange={e => { const v = e.target.value; setWasseraufwand(v); setMengeQuelle(v.trim() === '' ? null : 'wasser'); setFolge(f => eingabeFolge(f, 'wasser', v)) }}
                    className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                  {m.berechnetHinweis.wasser && (
                    <p className="text-xs text-s112-muted mt-1">{m.berechnetHinweis.wasser}</p>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-s112-muted mt-1">
              {m.ha !== null
                ? 'Spritzbrühe = Mittel + Wasser. Eines der beiden Felder ist Pflicht, das andere ergibt sich über die Fläche.'
                : 'Spritzbrühe = Mittel + Wasser. Eines der beiden Felder ist Pflicht; ohne zugeordnete Grundstücke werden sie nicht über die Fläche abgeglichen.'}
              {' '}Aufwandmenge (kg/ha, l/ha bzw. kg, l gesamt über die Fläche), Konzentration (%) und Wasseraufwand: je zwei ergeben die dritte (Aufwand je ha = Wasseraufwand × Konzentration ÷ 100). Bei g/hl bzw. ml/hl (im Tank) ist die Aufwandmenge schon die Konzentration – dann Spritzbrühe oder Wasseraufwand angeben.
            </p>
          </div>
        )}

        {/* Live-Zusammenfassung: Mittelmenge, Spritzbrühe, Cu, Reinkupfer, Hinweis bei Spritzbrühe ≠ Wasseraufwand × Fläche */}
        {(art === 'spritzung' || art === 'duengung' || (art === 'sonstiges' && felder.aufwandmenge !== 'hidden')) && (
          <MengenZusammenfassung art={art} pruefung={m.pruefung} ha={m.ha} />
        )}

        {/* BBCH und Schaderreger bzw. Grund / Anlass laut Feld-Matrix wie beim Anlegen: BBCH bei Spritzung (optional, KAN-155),
            Laubarbeit und Laubschneiden (optional) – ein Code außerhalb von BBCH_OPTIONS als eigene Option;
            Schaderreger bei Spritzung (optional, KAN-155), bei Sonstiges als „Grund / Anlass“ (optional, ohne Vorschläge) */}
        {(modus.bbch === 'sichtbar' || modus.schaderreger === 'sichtbar') && (
          <div className="grid grid-cols-2 gap-3">
            {modus.bbch === 'sichtbar' && (
              <div>
                <label className={labelCls}>
                  BBCH-Stadium
                  {pflicht.bbch && <span className="text-s112-err"> *</span>}
                </label>
                <select aria-label="BBCH-Stadium" name="bbch_stadium" value={bbch} onChange={e => setBbch(e.target.value)}
                  required={pflicht.bbch} className={inputCls}>
                  <option value="">– Auswählen –</option>
                  {bbchBisher && <option value={bbchBisher}>{bbchBisher} (bisherige Angabe)</option>}
                  {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {modus.schaderreger === 'sichtbar' && (
              <div>
                <label className={labelCls}>
                  {schaderreger.label}
                  {pflicht.schaderreger && <span className="text-s112-err"> *</span>}
                </label>
                <input aria-label={schaderreger.label} name="schaderreger" type="text"
                  required={pflicht.schaderreger}
                  defaultValue={behandlung.schaderreger ?? ''} className={inputCls}
                  placeholder={schaderreger.placeholder} list={schaderreger.vorschlaege ? 'schaderreger-kb' : undefined} />
                {schaderreger.vorschlaege && (
                  <datalist id="schaderreger-kb">
                    {SCHADERREGER_OPTIONEN.map(s => <option key={s} value={s} />)}
                  </datalist>
                )}
              </div>
            )}
          </div>
        )}

        {/* Laut Feld-Matrix ausgeblendet (z. B. BBCH bei Düngung, Schaderreger bei Laubarbeit): Bei unveränderter
            Art geht der gespeicherte Wert unsichtbar mit – auch nach einem Umweg über eine andere Art (wie Mittel und
            Mengen bei der Rückkehr zur gespeicherten Art), denn eine dort geänderte Eingabe wäre hier weder sichtbar
            noch korrigierbar –, damit Speichern ihn nicht leert; nach einem Wechsel auf eine Art ohne das Feld wird
            nichts gesendet (Speichern setzt null wie beim Anlegen) */}
        {modus.bbch === 'behalten' && <input type="hidden" name="bbch_stadium" value={behandlung.bbch_stadium ?? ''} />}
        {/* KAN-171: Bienenschutz – derselbe BBCH-Wert, den das Speichern sendet */}
        <BienenschutzHinweis bienengefaehrlich={artMitPsm(art) && !!psm.find(p => p.id === selectedPsmId)?.bienengefaehrlich}
          bbch={modus.bbch === 'sichtbar' ? bbch : modus.bbch === 'behalten' ? behandlung.bbch_stadium : null}
          bestaetigung={behandlung.bienenschutz_bestaetigt_am ? { am: behandlung.bienenschutz_bestaetigt_am, von: behandlung.bienenschutz_bestaetigt_von_name ?? null } : null} />
        {modus.schaderreger === 'behalten' && <input type="hidden" name="schaderreger" value={behandlung.schaderreger ?? ''} />}

        {/* Düngung: Einarbeitung wie beim Anlegen nur bei organischem Dünger (KAN-154). einarbeitung_gesendet
            unterscheidet „nein“ (false) von „keine Angabe“ (null): bei 'sichtbar' sobald ja/nein feststeht, bei
            'behalten' mit dem gespeicherten Wert (unsichtbar, auch das gespeicherte „nein“ eines mineralischen
            Düngers), nach einem Artwechsel ('keine') nichts – Speichern leert beide Felder wie beim Anlegen */}
        {einarbeitungModus === 'sichtbar' && (
          <div className="grid grid-cols-2 gap-3 items-end">
            {einarbeitung !== null && <input type="hidden" name={EINARBEITUNG_GESENDET} value="1" />}
            <label className="flex items-center gap-2 text-sm text-s112-text-1">
              <input type="checkbox" name="einarbeitung" checked={!!einarbeitung}
                onChange={e => setEinarbeitung(e.target.checked)} className="accent-s112-teal" />
              Eingearbeitet
            </label>
            <div>
              <label className={labelCls}>Zeitpunkt Einarbeitung</label>
              <input aria-label="Zeitpunkt Einarbeitung" name="einarbeitung_zeitpunkt" type="date"
                defaultValue={behandlung.einarbeitung_zeitpunkt ?? ''} className={inputCls} />
            </div>
          </div>
        )}
        {einarbeitungModus === 'behalten' && (
          <>
            {behandlung.einarbeitung !== null && <input type="hidden" name={EINARBEITUNG_GESENDET} value="1" />}
            {behandlung.einarbeitung && <input type="hidden" name="einarbeitung" value="on" />}
            <input type="hidden" name="einarbeitung_zeitpunkt" value={behandlung.einarbeitung_zeitpunkt ?? ''} />
          </>
        )}

        {/* Bodenbearbeitung – Tiefe optional, Gerät Pflicht wie beim Anlegen (pflicht: Altdaten ohne Wert ausgenommen) */}
        {art === 'bodenbearbeitung' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>
                Bearbeitungstiefe (cm)
                {pflicht.bearbeitungstiefe && <span className="text-s112-err"> *</span>}
              </label>
              <input aria-label="Bearbeitungstiefe (cm)" name="bearbeitungstiefe_cm" type="number" step="1" min="0"
                required={pflicht.bearbeitungstiefe}
                defaultValue={behandlung.bearbeitungstiefe_cm ?? ''} className={inputCls} placeholder="z.B. 10" />
            </div>
            <div>
              <label className={labelCls}>
                Gerät
                {pflicht.bearbeitungsgeraet && <span className="text-s112-err"> *</span>}
              </label>
              <input aria-label="Gerät" name="bearbeitungsgeraet" type="text"
                required={pflicht.bearbeitungsgeraet}
                defaultValue={behandlung.bearbeitungsgeraet ?? ''} className={inputCls} placeholder="z.B. Grubber" />
            </div>
          </div>
        )}

        {/* Schnitt – Schnittart Pflicht wie beim Anlegen (Altdaten ohne Wert ausgenommen) */}
        {art === 'schnitt' && (
          <div>
            <label className={labelCls}>
              Schnittart
              {pflicht.schnittart && <span className="text-s112-err"> *</span>}
            </label>
            <input aria-label="Schnittart" name="schnittart" type="text" required={pflicht.schnittart}
              defaultValue={behandlung.schnittart ?? ''} className={inputCls} placeholder="z.B. Guyot, Kordon" />
          </div>
        )}

        {/* Laubarbeit – Unterart Pflicht wie beim Anlegen, auch nach einem Artwechsel (z. B. Laubschneiden → Laubarbeit).
            Eine ältere Freitext-Unterart bleibt als eigene Option vorausgewählt – Speichern deutet sie nicht um */}
        {art === 'laubarbeit' && (
          <div>
            <label className={labelCls}>
              Art der Laubarbeit
              {FELD_MATRIX.laubarbeit.laubarbeitArt === 'pflicht' && <span className="text-s112-err"> *</span>}
            </label>
            <select aria-label="Art der Laubarbeit" name="laubarbeit_art" defaultValue={behandlung.laubarbeit_art ?? ''}
              required={FELD_MATRIX.laubarbeit.laubarbeitArt === 'pflicht'} className={inputCls}>
              <option value="">– Auswählen –</option>
              {art === startArt && laubarbeitBisher && (
                <option value={laubarbeitBisher}>{laubarbeitBisher} (bisherige Angabe)</option>
              )}
              {LAUBARBEIT_OPTIONEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        {/* Witterung (Spritzung, Düngung, Bodenbearbeitung) und Temperatur (Spritzung) laut Feld-Matrix wie beim
            Anlegen; ausgeblendet gehen gespeicherte Werte bei unveränderter Art unsichtbar mit (siehe oben) */}
        {(modus.witterung === 'sichtbar' || modus.temperatur === 'sichtbar') && (
          <div className="grid grid-cols-2 gap-3">
            {modus.witterung === 'sichtbar' && (
              <div>
                <label className={labelCls}>Witterung</label>
                <select aria-label="Witterung" name="witterung" defaultValue={behandlung.witterung ?? ''} className={inputCls}>
                  <option value="">–</option>
                  {WITTERUNG_OPTIONEN.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {modus.temperatur === 'sichtbar' && (
              <div>
                <label className={labelCls}>Temperatur (°C)</label>
                <input aria-label="Temperatur (°C)" name="temperatur_c" type="number" step="0.1"
                  defaultValue={behandlung.temperatur_c ?? ''} className={inputCls} />
              </div>
            )}
          </div>
        )}
        {modus.witterung === 'behalten' && <input type="hidden" name="witterung" value={behandlung.witterung ?? ''} />}
        {modus.temperatur === 'behalten' && <input type="hidden" name="temperatur_c" value={behandlung.temperatur_c ?? ''} />}

        <div>
          <label className={labelCls}>Notizen</label>
          <textarea aria-label="Notizen" name="notizen" rows={2} defaultValue={behandlung.notizen ?? ''}
            className={inputCls.replace('w-full', 'w-full')} />
        </div>
      </div>

      {/* Kosten (Punkte 6, 9) – nur mit Modul Controlling (KAN-195) */}
      <div className={kostenModul ? 'card space-y-3' : 'hidden'}>
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
                <select aria-label="Kostenart" name="kosten_kostenart_id" value={kostenKostenartId}
                  onChange={e => setKostenKostenartId(e.target.value)}
                  className={inputCls}>
                  <option value="">– Auswählen –</option>
                  {kostenarten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Betrag (€)</label>
                <input aria-label="Betrag (€)" name="kosten_betrag" type="number" step="0.01" min="0"
                  value={kostenBetrag}
                  onChange={e => setKostenBetrag(e.target.value)}
                  className={inputCls} />
              </div>
            </div>
            <div>
              <label className={labelCls}>Beschreibung</label>
              <input aria-label="Beschreibung" name="kosten_beschreibung" type="text" value={kostenBeschreibung}
                onChange={e => setKostenBeschreibung(e.target.value)}
                className={inputCls} />
            </div>
          </div>
        )}
      </div>

      {error && (
        <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm">{error}</div>
      )}

      {/* KAN-181: am Handy bleibt die Leiste beim Scrollen unten sichtbar */}
      <div className="flex gap-3 max-sm:sticky max-sm:bottom-0 max-sm:-mx-4 max-sm:px-4 max-sm:py-3 max-sm:bg-s112-bg max-sm:border-t max-sm:border-s112-line max-sm:z-10">
        {/* nur beim Speichern gesperrt – eine Bio-Sperre zeigt der Klick am Mittel (KAN-154 wie KAN-153) */}
        <button type="submit" disabled={pending}
          className="flex-1 sm:flex-none bg-s112-teal text-s112-yellow px-6 py-3 sm:py-2.5 rounded-xl text-base sm:text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Änderungen speichern'}
        </button>
        <AbbrechenKnopf standard="/behandlungen" className="px-5 py-2.5 rounded-xl text-sm font-medium text-s112-text-2 hover:text-s112-text" />
      </div>
    </form>
  )
}
