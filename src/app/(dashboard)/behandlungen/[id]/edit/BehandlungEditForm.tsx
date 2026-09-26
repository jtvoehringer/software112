'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateBehandlung } from '../../actions'
import type { KostenartOption } from '../../neu/page'
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
  mengeVorbelegung, mengenFelder, mengenInFormData,
} from '../../neu/mengenFelder'
import { BBCH_OPTIONS, FELD_MATRIX, bbchAltwert, bbchBeimBearbeiten, wetterBeimBearbeiten } from '../../neu/feldMatrix'
import { ART_OPTIONS } from '../../neu/artOptionen'
import MengenZusammenfassung from '../../neu/MengenZusammenfassung'

const WITTERUNG = ['sonnig', 'bewoelkt', 'regnerisch', 'wind']
const SCHADERREGER_OPTIONEN = ['Oidium', 'Peronospora', 'Botrytis']

// Welche Mengen-Felder pro Art sichtbar/pflicht sind, kommt aus MENGEN_SICHT (neu/mengenFelder.ts) -
// identisch zum Anlegen-Formular, damit Anlegen und Bearbeiten konsistent sind (siehe "Analyse
// Maßnahmen.docx", Tabelle 2; KAN-133). BBCH, Witterung und Temperatur: bbchBeimBearbeiten bzw.
// wetterBeimBearbeiten (neu/feldMatrix.ts, KAN-143).
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

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
const labelCls = 'block text-sm font-medium text-s112-text-1 mb-1'

export default function BehandlungEditForm({
  behandlung, psm, duengemittel, bioStatus, kostenarten, bestehenderKostenEintrag, flaecheHa,
}: {
  behandlung: BehandlungEdit
  psm: PSMOption[]
  duengemittel: DuengemittelOption[]
  bioStatus: string
  kostenarten: KostenartOption[]
  bestehenderKostenEintrag: BestehenderKostenEintrag | null
  /** Σ Fläche der Grundstücke dieser Maßnahme (ha); null = keine Grundstücke zugeordnet */
  flaecheHa: number | null
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const startArt = (behandlung.art as Art) ?? 'spritzung'
  const [art, setArt] = useState<Art>(startArt)
  // ältere Freitext-Unterart einer Laubarbeit (nicht in LAUBARBEIT_OPTIONEN) – eigene Option in der Auswahl
  const laubarbeitBisher = laubarbeitAltwert(behandlung.laubarbeit_art)
  // gespeichertes BBCH-Stadium außerhalb von BBCH_OPTIONS (z. B. „68“) – eigene Option in beiden BBCH-Auswahlen
  const bbchBisher = bbchAltwert(behandlung.bbch_stadium)
  const [selectedPsmId, setSelectedPsmId] = useState(behandlung.psm_id ?? '')
  const [selectedDuengemittelId, setSelectedDuengemittelId] = useState(behandlung.duengemittel_id ?? '')
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
  // gesamt ↔ Wasseraufwand (über die Fläche der Maßnahme) und Aufwandmenge ↔ Konzentration berechnen sich
  // gegenseitig, sobald eines der Felder geändert wird. Gespeicherte Werte bleiben bis dahin frei editierbar.
  const [mengeQuelle, setMengeQuelle] = useState<'gesamt' | 'wasser' | null>(null)
  const [aufwandmenge, setAufwandmenge] = useState(start.aufwand)
  const [aufwandmengeEinheit, setAufwandmengeEinheit] = useState(start.aufwandEinheit)
  const [konzentration, setKonzentration] = useState(start.konzentration)
  const [aufwandQuelle, setAufwandQuelle] = useState<'aufwand' | 'konzentration' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const felder = MENGEN_SICHT[art] ?? MENGEN_SICHT.spritzung

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
    // Vorbelegung zum gespeicherten Düngemittel (die Auswahl ist beim Zurückwechseln erst im nächsten Render gesetzt)
    setMengeGesamt(zurueck ? mengeVorbelegung(behandlung, gespeichertEinheit, gespeichertEinheit).text : '')
    setEinheitHinweis(null)
    setAufwandmenge(zurueck ? start.aufwand : '')
    setAufwandmengeEinheit(zurueck ? start.aufwandEinheit : 'kg_ha')
    setKonzentration(zurueck ? start.konzentration : '')
    setMengeQuelle(null)
    setAufwandQuelle(null)
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
    aufwandmenge, aufwandmengeEinheit, konzentration, aufwandQuelle,
    flaecheHa,
    psmId: selectedPsmId || null,
    psm: selectedPsm
      ? { cuGehaltPct: selectedPsm.cu_gehalt_pct, wirkstoff: selectedPsm.wirkstoff, wirkstoffgehaltPct: selectedPsm.wirkstoffgehalt_pct }
      : null,
    duengemittelId: selectedDuengemittelId || null,
    duengemittelEinheit: selectedDuengemittel?.einheit ?? null,
    formular: 'bearbeiten',
  })
  const wasserGesperrt = m.wasserBerechnet !== null
  const mengeGesamtGesperrt = m.mengeGesamtBerechnet !== null
  const konzentrationGesperrt = m.konzentrationBerechnet !== null
  const aufwandmengeGesperrt = m.aufwandmengeBerechnet !== null

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
    if (bioSperre) {
      setError('Dieses Mittel ist nicht öko-zugelassen und passt nicht zum Bio-Status des Betriebs. Bitte ein zugelassenes Mittel wählen.')
      return
    }
    if (altwertOffen) { setError(altwertFehler); return }
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
    startTransition(async () => {
      try {
        await updateWithId(fd)
        router.push('/behandlungen')
        router.refresh()
      } catch (err) {
        setError(fehlerText(err))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* Weingarten und behandelte Fläche (readonly) – weingarten_id setzen nur Altdaten/Seed; die Fläche
          (Σ Grundstücke, koppelt Spritzbrühe und Wasseraufwand) steht auch bei Maßnahmen aus Formular und Assistent */}
      {(behandlung.weingarten_name || m.ha !== null) && (
        <div className="card bg-s112-bg/50 p-4">
          {behandlung.weingarten_name && (
            <>
              <p className="text-xs text-s112-muted">Weingarten (nicht änderbar)</p>
              <p className="font-semibold text-s112-text">{behandlung.weingarten_name}</p>
            </>
          )}
          {m.ha !== null && (
            <p className={`text-xs text-s112-muted${behandlung.weingarten_name ? ' mt-0.5' : ''}`}>
              Behandelte Fläche: {fmtNum(m.ha, { max: 4 })} ha (Σ Grundstücke der Maßnahme{behandlung.weingarten_name ? '' : ', nicht änderbar'})
            </p>
          )}
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
            <input aria-label="Datum von" name="datum" type="date" required defaultValue={behandlung.datum} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Datum bis</label>
            <input aria-label="Datum bis" name="datum_bis" type="date" defaultValue={behandlung.datum_bis ?? ''} className={inputCls} />
          </div>
        </div>

        {/* PSM */}
        {(art === 'spritzung' || art === 'sonstiges') && (
          <div>
            <label className={labelCls}>
              Spritzmittel / Mittel (PSM)
              {art === 'spritzung' && <span className="text-s112-err"> *</span>}
            </label>
            <select aria-label="Spritzmittel / Mittel (PSM)" name="psm_id" value={selectedPsmId}
              required={art === 'spritzung'}
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
            <select aria-label="Düngemittel" name="duengemittel_id" value={selectedDuengemittelId}
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

        {/* Altwert: gespeicherte „Menge gesamt“ passt nicht zur Einheit des Felds (Spritzung in kg/g) */}
        {altwertSichtbar && (altwertOffen ? (
          <div className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg rounded-xl px-4 py-3 text-sm flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
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
                <button type="button" onClick={() => { setMengeGesamt(''); setMengeQuelle('wasser') }}
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
                    <label className={labelCls}>
                      {m.jeHl ? 'Konzentration im Tank' : 'Aufwandmenge'}
                      {felder.aufwandmenge === 'pflicht' && <span className="text-s112-err"> *</span>}
                    </label>
                    <input aria-label={m.jeHl ? 'Konzentration im Tank' : 'Aufwandmenge'} name="aufwandmenge" type="text" inputMode="decimal"
                      required={felder.aufwandmenge === 'pflicht' && !aufwandmengeGesperrt}
                      value={m.aufwandmengeBerechnet !== null ? fmtNum(m.aufwandmengeBerechnet, { max: 3 }) : aufwandmenge}
                      disabled={aufwandmengeGesperrt}
                      onChange={e => { setAufwandmenge(e.target.value); setAufwandQuelle(e.target.value.trim() === '' ? null : 'aufwand') }}
                      className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
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
                    onChange={e => { setKonzentration(e.target.value); setAufwandQuelle(e.target.value.trim() === '' ? null : 'konzentration') }}
                    className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                  {m.konzentrationHinweis && (
                    <p className="text-xs text-s112-muted mt-1">{m.konzentrationHinweis}</p>
                  )}
                </div>
              )}
            </div>
            {felder.aufwandmenge !== 'hidden' && (
              <p className="text-xs text-s112-muted mt-1">
                {art === 'duengung'
                  ? 'Optional – maßgeblich für Lager und Nährstoffbilanz ist die Düngermenge gesamt.'
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
                  <input aria-label="Spritzbrühe gesamt (l)" name="menge_gesamt" type="text" inputMode="decimal"
                    value={m.mengeGesamtBerechnet !== null ? fmtNum(m.mengeGesamtBerechnet, { max: 3 }) : mengeGesamt}
                    disabled={mengeGesamtGesperrt}
                    onChange={e => { setMengeGesamt(e.target.value); setMengeQuelle(e.target.value.trim() === '' ? null : 'gesamt') }}
                    className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                  {mengeGesamtGesperrt && (
                    <p className="text-xs text-s112-muted mt-1">Automatisch berechnet aus Wasseraufwand (l/ha) × Fläche.</p>
                  )}
                </div>
              )}
              {felder.wasseraufwand !== 'hidden' && (
                <div>
                  <label className={labelCls}>
                    Wasseraufwand (l/ha)
                    {felder.wasseraufwand !== 'optional' && <span className="text-s112-err"> *</span>}
                  </label>
                  <input aria-label="Wasseraufwand (l/ha)" name="wasseraufwand_l_ha" type="text" inputMode="decimal"
                    value={m.wasserBerechnet !== null ? fmtNum(m.wasserBerechnet, { max: 2 }) : wasseraufwand}
                    disabled={wasserGesperrt}
                    onChange={e => { setWasseraufwand(e.target.value); setMengeQuelle(e.target.value.trim() === '' ? null : 'wasser') }}
                    className={`${inputCls} disabled:bg-s112-bg disabled:text-s112-text-2`} />
                  {wasserGesperrt && (
                    <p className="text-xs text-s112-muted mt-1">Automatisch berechnet aus Spritzbrühe gesamt ÷ Fläche.</p>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-s112-muted mt-1">
              {m.ha !== null
                ? 'Spritzbrühe = Mittel + Wasser. Eines der beiden Felder ist Pflicht, das andere ergibt sich über die Fläche.'
                : 'Spritzbrühe = Mittel + Wasser. Eines der beiden Felder ist Pflicht; ohne zugeordnete Grundstücke werden sie nicht über die Fläche abgeglichen.'}
            </p>
          </div>
        )}

        {/* Live-Zusammenfassung: Mittelmenge, Spritzbrühe, Cu, Reinkupfer, Hinweis bei Spritzbrühe ≠ Wasseraufwand × Fläche */}
        {(art === 'spritzung' || art === 'duengung') && <MengenZusammenfassung art={art} pruefung={m.pruefung} ha={m.ha} />}

        {art === 'spritzung' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>BBCH-Stadium</label>
              <select aria-label="BBCH-Stadium" name="bbch_stadium" defaultValue={behandlung.bbch_stadium ?? ''} className={inputCls}>
                <option value="">– Auswählen –</option>
                {bbchBisher && <option value={bbchBisher}>{bbchBisher} (bisherige Angabe)</option>}
                {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Schaderreger</label>
              <input aria-label="Schaderreger" name="schaderreger" type="text"
                defaultValue={behandlung.schaderreger ?? ''} className={inputCls}
                placeholder="z.B. Peronospora" list="schaderreger-kb" />
              <datalist id="schaderreger-kb">
                {SCHADERREGER_OPTIONEN.map(s => <option key={s} value={s} />)}
              </datalist>
            </div>
          </div>
        )}

        {/* Düngung: Einarbeitung */}
        {art === 'duengung' && (
          <div className="grid grid-cols-2 gap-3 items-end">
            <label className="flex items-center gap-2 text-sm text-s112-text-1">
              <input type="checkbox" name="einarbeitung" defaultChecked={!!behandlung.einarbeitung} className="accent-s112-teal" />
              Eingearbeitet
            </label>
            <div>
              <label className={labelCls}>Zeitpunkt Einarbeitung</label>
              <input aria-label="Zeitpunkt Einarbeitung" name="einarbeitung_zeitpunkt" type="date"
                defaultValue={behandlung.einarbeitung_zeitpunkt ?? ''} className={inputCls} />
            </div>
          </div>
        )}

        {/* Bodenbearbeitung */}
        {art === 'bodenbearbeitung' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Bearbeitungstiefe (cm)</label>
              <input aria-label="Bearbeitungstiefe (cm)" name="bearbeitungstiefe_cm" type="number" step="1" min="0"
                defaultValue={behandlung.bearbeitungstiefe_cm ?? ''} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Gerät</label>
              <input aria-label="Gerät" name="bearbeitungsgeraet" type="text"
                defaultValue={behandlung.bearbeitungsgeraet ?? ''} className={inputCls} placeholder="z.B. Grubber" />
            </div>
          </div>
        )}

        {/* Schnitt */}
        {art === 'schnitt' && (
          <div>
            <label className={labelCls}>Schnittart</label>
            <input aria-label="Schnittart" name="schnittart" type="text"
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

        {/* BBCH außerhalb der Spritzung (Laubarbeit, Laubschneiden – optional laut Feld-Matrix); ein
            gespeichertes Stadium bleibt sichtbar, damit Speichern es nicht leert – ein Code außerhalb von
            BBCH_OPTIONS als eigene Option. Die bleibt auch nach einem Artwechsel stehen (das Stadium hängt nicht
            an der Art): Wechselt z. B. Laubarbeit → Laubschneiden, bleibt die Auswahl erhalten wie bei „75“ */}
        {art !== 'spritzung' && bbchBeimBearbeiten(art, art === startArt ? behandlung.bbch_stadium : null) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>BBCH-Stadium</label>
              <select aria-label="BBCH-Stadium" name="bbch_stadium" defaultValue={art === startArt ? behandlung.bbch_stadium ?? '' : ''} className={inputCls}>
                <option value="">– Auswählen –</option>
                {bbchBisher && <option value={bbchBisher}>{bbchBisher} (bisherige Angabe)</option>}
                {BBCH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          </div>
        )}

        {wetterBeimBearbeiten(art, art === startArt ? behandlung : null) && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Witterung</label>
              <select aria-label="Witterung" name="witterung" defaultValue={behandlung.witterung ?? ''} className={inputCls}>
                <option value="">–</option>
                {WITTERUNG.map(w => <option key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Temperatur (°C)</label>
              <input aria-label="Temperatur (°C)" name="temperatur_c" type="number" step="0.1"
                defaultValue={behandlung.temperatur_c ?? ''} className={inputCls} />
            </div>
          </div>
        )}

        <div>
          <label className={labelCls}>Notizen</label>
          <textarea aria-label="Notizen" name="notizen" rows={2} defaultValue={behandlung.notizen ?? ''}
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
