'use client'

import { Fragment, useState, useCallback, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { saveTB, tbAusstellen } from './actions'
import { useRouter } from 'next/navigation'
import GesperrtHinweis from '@/components/GesperrtHinweis'
import { fehlerText } from '@/lib/fehler'
import { TB_FREEZE_GRUND } from '@/lib/behoerden/tbPflicht'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'
import { tbAlkoholGehalt, tbKmwFormblatt, tbMostgewichtFelder, tbPositionMitMostgewicht, tbPositionMostgewicht } from '@/lib/behoerden/tbMostgewicht'
import type { GespeichertesMostgewicht } from '@/lib/wein/mostgewichtFormular'
import type { Mostgewicht } from '@/lib/wein/mostgewicht'
// Nur Typen (werden beim Übersetzen entfernt) – Datenmodell samt Vorbelegung und CSV-Abflachung
// liegt in lib/behoerden/transportbescheinigung.ts (gemeinsam mit /meldungen/transportbescheinigung/csv)
import type { TBDaten, TBWeinposition as WeinPosition } from '@/lib/behoerden/transportbescheinigung'

interface Props {
  verkaufspostenId: string
  initial: TBDaten
  /** CSV derselben (gespeicherten) Transportbescheinigung: csvPfad('transportbescheinigung', …) */
  csvHref: string
  /** KAN-209: ausgestellt = fest (nur Storno); Zeitpunkt (ISO) und Name */
  ausgestellt?: boolean
  ausgestelltAm?: string | null
  ausgestelltVon?: string | null
}

const inputCls = 'border border-s112-line-str px-1.5 py-0.5 text-xs w-full focus:outline-hidden focus:border-s112-teal print:border-s112-line-str bg-white'
const labelCls = 'text-[10px] text-s112-text-2 leading-tight block mb-0.5'

function FeldGruppe({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  )
}

/** KAN-130 Etappe 3: Startwert der Mostgewicht-Eingabe einer Position (gespeichert bzw. Vorbelegung;
 *  Altformulare: °KMW aus „Alkohol % vol / °KMW“). Fest je Zeile – die Eingabe beginnt sonst bei
 *  jeder Änderung neu (siehe MostgewichtEingabe, startwert). */
function startwertAus(p: WeinPosition): GespeichertesMostgewicht | null {
  const m = tbPositionMostgewicht(p)
  return m ? { kmw: m.kmw, oechsle: m.oechsle, einheit: m.einheit } : null
}

type Zeile = { key: number; start: GespeichertesMostgewicht | null }

export default function TBFormular({ verkaufspostenId, initial, csvHref, ausgestellt = false, ausgestelltAm = null, ausgestelltVon = null }: Props) {
  const router = useRouter()
  const [fehler, setFehler] = useState<string | null>(null)
  // Altformulare: Mostgewicht aus „Alkohol % vol / °KMW“ in die Felder kmw/oechsle/mostgewicht_einheit
  const [daten, setDaten] = useState<TBDaten>(() => ({
    ...initial,
    // KAN-131: ein Mostgewicht-Text im Alkoholfeld (Altformular) wandert in die eigene °KMW-Spalte
    positionen: initial.positionen.map(p => ({ ...p, ...tbMostgewichtFelder(tbPositionMostgewicht(p)), alkohol_pct: tbAlkoholGehalt(p) })),
  }))
  // Stabile Schlüssel je Position (Löschen verschiebt sonst den Eingabezustand der Mostgewicht-Felder)
  const [zeilen, setZeilen] = useState<Zeile[]>(() => initial.positionen.map((p, i) => ({ key: i, start: startwertAus(p) })))
  // Ungültige Mostgewicht-Eingaben je Zeile – Speichern erst, wenn alle gültig sind
  const [mgFehler, setMgFehler] = useState<Record<number, string>>({})
  const mgFehlerText = Object.values(mgFehler)[0] ?? null
  const [gespeichert, setGespeichert] = useState(false)
  // Ungespeicherte Änderungen: die CSV liest den gespeicherten Stand aus der Datenbank
  const [geaendert, setGeaendert] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = useCallback((key: keyof TBDaten, value: string) => {
    setDaten(prev => ({ ...prev, [key]: value }))
    setGespeichert(false)
    setGeaendert(true)
  }, [])

  const setPos = useCallback((i: number, key: keyof WeinPosition, value: string) => {
    setDaten(prev => {
      const pos = [...prev.positionen]
      pos[i] = { ...pos[i], [key]: value }
      return { ...prev, positionen: pos }
    })
    setGespeichert(false)
    setGeaendert(true)
  }, [])

  const setMostgewicht = useCallback((i: number, key: number, wert: Mostgewicht | null, fehler: string | null) => {
    setMgFehler(prev => {
      const { [key]: _alt, ...rest } = prev
      void _alt
      return fehler ? { ...rest, [key]: fehler } : rest
    })
    if (fehler) return   // ungültige Eingabe: gespeicherten Wert stehen lassen, Speichern ist gesperrt
    setDaten(prev => {
      const pos = [...prev.positionen]
      pos[i] = tbPositionMitMostgewicht(pos[i], wert)
      return { ...prev, positionen: pos }
    })
    setGespeichert(false)
    setGeaendert(true)
  }, [])

  function addPos() {
    setZeilen(prev => [...prev, { key: prev.reduce((m, z) => Math.max(m, z.key), -1) + 1, start: null }])
    setDaten(prev => ({
      ...prev,
      positionen: [...prev.positionen, {
        menge_liter: '', einheit: 'l', art: 'Weiß', traubensorte: '', qualitaetsstufe: '',
        jahrgang: '', herkunft: '', fremd_sorten_pct: '', fremd_jg_pct: '',
        pruefnummer: '', anreicherung: 'N', alkohol_pct: '', kmw: '', oechsle: '', mostgewicht_einheit: '',
      }],
    }))
    setGespeichert(false)
    setGeaendert(true)
  }

  function removePos(i: number) {
    const key = zeilen[i]?.key
    setZeilen(prev => prev.filter((_, j) => j !== i))
    if (key !== undefined) setMgFehler(prev => { const { [key]: _alt, ...rest } = prev; void _alt; return rest })
    setDaten(prev => ({ ...prev, positionen: prev.positionen.filter((_, j) => j !== i) }))
    setGespeichert(false)
    setGeaendert(true)
  }

  function handleSave() {
    if (mgFehlerText) return
    setFehler(null)
    startTransition(async () => {
      try {
        await saveTB(verkaufspostenId, daten)
        setGespeichert(true)
        setGeaendert(false)
      } catch (e) { setFehler(fehlerText(e, 'Speichern fehlgeschlagen')) }
    })
  }

  // KAN-209: Ausstellen – Pflichtangaben prüfen, laufende Nummer vergeben, danach fest
  function handleAusstellen() {
    if (mgFehlerText) return
    if (!window.confirm('Transportbescheinigung jetzt ausstellen? Danach ist sie nicht mehr änderbar – Korrektur nur über Storno und eine neue Bescheinigung.')) return
    setFehler(null)
    startTransition(async () => {
      try {
        await tbAusstellen(verkaufspostenId, daten)
        setGeaendert(false)
        router.refresh()
      } catch (e) { setFehler(fehlerText(e, 'Ausstellen fehlgeschlagen')) }
    })
  }
  const ausgestelltText = ausgestelltAm
    ? new Date(ausgestelltAm).toLocaleString('de-AT', { timeZone: 'Europe/Vienna', dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-start justify-between gap-4 no-print">
        <div className="flex flex-wrap items-start gap-2">
          {!ausgestellt && (<>
          <button
            onClick={handleSave}
            disabled={pending || !!mgFehlerText}
            title={mgFehlerText ? `Mostgewicht prüfen: ${mgFehlerText}` : undefined}
            className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50"
          >
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          <button
            onClick={handleAusstellen}
            disabled={pending || !!mgFehlerText}
            className="border border-s112-teal text-s112-blue-700 px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-bg disabled:opacity-50"
          >
            Ausstellen
          </button>
          </>)}
          {gespeichert && <span className="text-xs text-s112-ok-fg self-center">Gespeichert</span>}
          <button
            onClick={() => window.print()}
            className="border border-s112-border px-4 py-1.5 rounded-lg text-sm hover:bg-s112-bg"
          >
            Drucken
          </button>
          <CsvExportKnopf href={csvHref} className="self-center" />
          {geaendert && (
            <span className="text-xs text-s112-warn-fg self-center max-w-xs">
              Ungespeicherte Änderungen – die CSV enthält den zuletzt gespeicherten Stand.
            </span>
          )}
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {!ausgestellt && (
          <button onClick={addPos} className="text-xs text-s112-blue-700 hover:underline no-print">
            + Weinposition hinzufügen
          </button>
          )}
          <Link href="/weinhandel/transportbescheinigungen" className="text-xs text-s112-blue-700 hover:underline">
            Alle Transportbescheinigungen eines Zeitraums
          </Link>
        </div>
      </div>

      {fehler && <div role="alert" className="no-print rounded-lg border border-s112-err/30 bg-s112-err-bg px-4 py-2.5 text-sm text-s112-err-fg">{fehler}</div>}
      {ausgestellt && (
        <div className="no-print">
          <GesperrtHinweis grund={TB_FREEZE_GRUND} seit={ausgestelltText} erlaubt={[]} />
          {ausgestelltVon && <p className="text-xs text-s112-muted mt-1">Ausgestellt von {ausgestelltVon}.</p>}
        </div>
      )}

      {/* ── Offizielles Formular ── */}
      <fieldset disabled={ausgestellt} className="contents">
      <div className="bg-white border border-s112-line-str p-6 space-y-4 font-sans text-xs" id="tb-formular">

        {/* Titel */}
        <div className="text-center border-b border-s112-text pb-2 mb-4">
          <h1 className="text-base font-semibold tracking-wide">Transportbescheinigung gemäß Weingesetz</h1>
          <p className="text-[10px] text-s112-text-2 mt-0.5">Nicht stempeln! Nicht heften!</p>
          {/* KAN-209: Entwurf sichtbar kennzeichnen – auch im Druck */}
          {!ausgestellt && <p className="mt-1 text-sm font-bold tracking-widest text-s112-err-fg">ENTWURF – noch nicht ausgestellt</p>}
        </div>

        {/* Laufende Nr + Datum + Kennzeichen */}
        <div className="grid grid-cols-12 gap-2 border-b border-s112-line-str pb-3">
          <div className="col-span-2">
            <FeldGruppe label="Laufende Nummer">
              <input className={inputCls} value={daten.laufende_nr} onChange={e => set('laufende_nr', e.target.value)} />
            </FeldGruppe>
          </div>
          <div className="col-span-1">
            <FeldGruppe label="Jahr">
              <input className={inputCls} value={daten.jahr} onChange={e => set('jahr', e.target.value)} />
            </FeldGruppe>
          </div>
          <div className="col-span-3">
            <span className={labelCls}>Datum der Lieferung</span>
            <div className="flex gap-1">
              <input className={inputCls} placeholder="TT" value={daten.datum_tag} onChange={e => set('datum_tag', e.target.value)} />
              <input className={inputCls} placeholder="MM" value={daten.datum_monat} onChange={e => set('datum_monat', e.target.value)} />
              <input className={inputCls} placeholder="JJJJ" value={daten.datum_jahr} onChange={e => set('datum_jahr', e.target.value)} />
              <input className={inputCls} placeholder="Uhrzeit" value={daten.uhrzeit} onChange={e => set('uhrzeit', e.target.value)} />
            </div>
          </div>
          <div className="col-span-6">
            <span className={labelCls}>Polizeiliches Kennzeichen des Transportmittels</span>
            <div className="grid grid-cols-3 gap-1">
              <FeldGruppe label="Zugmaschine">
                <input className={inputCls} value={daten.zugmaschine} onChange={e => set('zugmaschine', e.target.value)} />
              </FeldGruppe>
              <FeldGruppe label="1. Anhänger">
                <input className={inputCls} value={daten.anhaenger1} onChange={e => set('anhaenger1', e.target.value)} />
              </FeldGruppe>
              <FeldGruppe label="2. Anhänger">
                <input className={inputCls} value={daten.anhaenger2} onChange={e => set('anhaenger2', e.target.value)} />
              </FeldGruppe>
            </div>
          </div>
        </div>

        {/* Versender / Empfänger */}
        <div className="grid grid-cols-2 gap-6 border-b border-s112-line-str pb-3">
          {/* Versender */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm border-b border-s112-line-str pb-1">Versender</h2>
            <div className="grid grid-cols-2 gap-1">
              <FeldGruppe label="Betriebsnummer des Versenders">
                <input className={inputCls} value={daten.v_betriebsnummer} onChange={e => set('v_betriebsnummer', e.target.value)} />
              </FeldGruppe>
              <FeldGruppe label="Telefonnummer">
                <input className={inputCls} value={daten.v_telefon} onChange={e => set('v_telefon', e.target.value)} />
              </FeldGruppe>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <div className="col-span-2">
                <FeldGruppe label="Firmenname oder Familienname">
                  <input className={inputCls} value={daten.v_name} onChange={e => set('v_name', e.target.value)} />
                </FeldGruppe>
              </div>
              <FeldGruppe label="Vorname">
                <input className={inputCls} value={daten.v_vorname} onChange={e => set('v_vorname', e.target.value)} />
              </FeldGruppe>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <div className="col-span-3">
                <FeldGruppe label="Straße (Betriebsadresse)">
                  <input className={inputCls} value={daten.v_strasse} onChange={e => set('v_strasse', e.target.value)} />
                </FeldGruppe>
              </div>
              <FeldGruppe label="Nr.">
                <input className={inputCls} value={daten.v_hausnr} onChange={e => set('v_hausnr', e.target.value)} />
              </FeldGruppe>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <FeldGruppe label="Postleitzahl">
                <input className={inputCls} value={daten.v_plz} onChange={e => set('v_plz', e.target.value)} />
              </FeldGruppe>
              <div className="col-span-2">
                <FeldGruppe label="Ort (Betriebsadresse)">
                  <input className={inputCls} value={daten.v_ort} onChange={e => set('v_ort', e.target.value)} />
                </FeldGruppe>
              </div>
            </div>
            <div className="border-t border-dashed border-s112-line-str pt-2">
              <div className="grid grid-cols-3 gap-1">
                <div className="col-span-2">
                  <FeldGruppe label="Ort der Versendung">
                    <input className={inputCls} value={daten.v_ort_versendung} onChange={e => set('v_ort_versendung', e.target.value)} />
                  </FeldGruppe>
                </div>
                <FeldGruppe label="Postleitzahl">
                  <input className={inputCls} value={daten.v_plz_versendung} onChange={e => set('v_plz_versendung', e.target.value)} />
                </FeldGruppe>
              </div>
            </div>
          </div>

          {/* Empfänger */}
          <div className="space-y-2">
            <h2 className="font-semibold text-sm border-b border-s112-line-str pb-1">Empfänger</h2>
            <div className="grid grid-cols-2 gap-1">
              <FeldGruppe label="Betriebsnummer des Empfängers">
                <input className={inputCls} value={daten.e_betriebsnummer} onChange={e => set('e_betriebsnummer', e.target.value)} />
              </FeldGruppe>
              <FeldGruppe label="Telefonnummer">
                <input className={inputCls} value={daten.e_telefon} onChange={e => set('e_telefon', e.target.value)} />
              </FeldGruppe>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <div className="col-span-2">
                <FeldGruppe label="Firmenname oder Familienname">
                  <input className={inputCls} value={daten.e_name} onChange={e => set('e_name', e.target.value)} />
                </FeldGruppe>
              </div>
              <FeldGruppe label="Vorname">
                <input className={inputCls} value={daten.e_vorname} onChange={e => set('e_vorname', e.target.value)} />
              </FeldGruppe>
            </div>
            <div className="grid grid-cols-4 gap-1">
              <div className="col-span-3">
                <FeldGruppe label="Straße (Betriebsadresse)">
                  <input className={inputCls} value={daten.e_strasse} onChange={e => set('e_strasse', e.target.value)} />
                </FeldGruppe>
              </div>
              <FeldGruppe label="Nr.">
                <input className={inputCls} value={daten.e_hausnr} onChange={e => set('e_hausnr', e.target.value)} />
              </FeldGruppe>
            </div>
            <div className="grid grid-cols-3 gap-1">
              <FeldGruppe label="Postleitzahl">
                <input className={inputCls} value={daten.e_plz} onChange={e => set('e_plz', e.target.value)} />
              </FeldGruppe>
              <div className="col-span-2">
                <FeldGruppe label="Ort (Betriebsadresse)">
                  <input className={inputCls} value={daten.e_ort} onChange={e => set('e_ort', e.target.value)} />
                </FeldGruppe>
              </div>
            </div>
            <div className="border-t border-dashed border-s112-line-str pt-2">
              <div className="grid grid-cols-3 gap-1">
                <div className="col-span-2">
                  <FeldGruppe label="Ort der Einlagerung">
                    <input className={inputCls} value={daten.e_ort_einlagerung} onChange={e => set('e_ort_einlagerung', e.target.value)} />
                  </FeldGruppe>
                </div>
                <FeldGruppe label="Postleitzahl">
                  <input className={inputCls} value={daten.e_plz_einlagerung} onChange={e => set('e_plz_einlagerung', e.target.value)} />
                </FeldGruppe>
              </div>
            </div>
          </div>
        </div>

        {/* Weinpositionen */}
        <div>
          <h2 className="font-semibold text-sm mb-2">Angaben über den Wein</h2>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border border-s112-line-str bg-s112-bg">
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Menge (Liter/kg)</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Art<br/><span className="font-normal text-s112-text-2">Rot/Weiß/Rosé</span></th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Traubensorte(n)</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Qualitätsstufe</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Jahrgang</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Herkunft</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Fremdsorten-<br/>anteil %</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Fremd-JG-<br/>anteil %</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Staatl.<br/>Prüfnummer</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Ange-<br/>reichert<br/>J/N</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">Vorh. Alkohol-<br/>gehalt % vol</th>
                <th className="border border-s112-line-str px-1 py-1 text-left font-semibold">° KMW bei<br/>Trauben/Most</th>
                <th className="border border-s112-line-str px-1 py-1 no-print"></th>
              </tr>
            </thead>
            <tbody>
              {daten.positionen.map((pos, i) => {
                const zeile = zeilen[i] ?? { key: -1 - i, start: null }
                return (
                <Fragment key={zeile.key}>
                <tr className="border border-s112-line-str">
                  <td className="border border-s112-line-str p-0.5">
                    <div className="flex gap-0.5">
                      <input className={inputCls} aria-label={`Menge Position ${i + 1}`} value={pos.menge_liter} onChange={e => setPos(i, 'menge_liter', e.target.value)} />
                      <select className={`${inputCls} w-auto!`} aria-label={`Einheit Position ${i + 1}`} value={pos.einheit ?? ''} onChange={e => setPos(i, 'einheit', e.target.value)}>
                        <option value="">–</option>
                        <option value="l">l</option>
                        <option value="kg">kg</option>
                      </select>
                    </div>
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <select className={inputCls} value={pos.art} onChange={e => setPos(i, 'art', e.target.value)}>
                      <option>Weiß</option>
                      <option>Rot</option>
                      <option>Rosé</option>
                    </select>
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} value={pos.traubensorte} onChange={e => setPos(i, 'traubensorte', e.target.value)} />
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} value={pos.qualitaetsstufe} onChange={e => setPos(i, 'qualitaetsstufe', e.target.value)} />
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} value={pos.jahrgang} onChange={e => setPos(i, 'jahrgang', e.target.value)} />
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} value={pos.herkunft} onChange={e => setPos(i, 'herkunft', e.target.value)} />
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} value={pos.fremd_sorten_pct} onChange={e => setPos(i, 'fremd_sorten_pct', e.target.value)} />
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} value={pos.fremd_jg_pct} onChange={e => setPos(i, 'fremd_jg_pct', e.target.value)} />
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} value={pos.pruefnummer} onChange={e => setPos(i, 'pruefnummer', e.target.value)} />
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <select className={inputCls} value={pos.anreicherung} onChange={e => setPos(i, 'anreicherung', e.target.value)}>
                      <option>N</option>
                      <option>J</option>
                    </select>
                  </td>
                  <td className="border border-s112-line-str p-0.5">
                    <input className={inputCls} aria-label={`Alkoholgehalt Position ${i + 1}`} value={pos.alkohol_pct} placeholder="% vol" onChange={e => setPos(i, 'alkohol_pct', e.target.value)} />
                  </td>
                  {/* KAN-131: °KMW aus dem Mostgewicht unten, NN,N (1 Stelle abgerundet) – auf dem Formblatt nur °KMW */}
                  <td className="border border-s112-line-str px-1 py-0.5 tabular-nums whitespace-nowrap">{tbKmwFormblatt(pos)}</td>
                  <td className="border border-s112-line-str p-0.5 no-print">
                    {daten.positionen.length > 1 && (
                      <button onClick={() => removePos(i)} title="Löschen" aria-label="Löschen" className="text-s112-err hover:text-s112-err-fg text-xs px-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
                {/* KAN-130 Etappe 3 (02.10.2026): Mostgewicht je Position in °KMW oder °Oe (bevorzugte
                    Einheit des Betriebs zuerst) – gespeichert mit Messwert und Einheit; KAN-131: die Formblatt-Spalte
                    „° KMW bei Trauben/Most“ zeigt es (°KMW auf 1 Stelle abgerundet). Nicht im Druck. */}
                <tr className="border border-s112-line-str no-print">
                  <td colSpan={13} className="px-1.5 py-1 bg-s112-bg/40">
                    <MostgewichtEingabe
                      name={`tb_mostgewicht_${zeile.key}`}
                      label={`Mostgewicht Position ${i + 1} (bei Most und Trauben)`}
                      startwert={zeile.start}
                      grenzfallHinweis={false}
                      onChange={(wert, info) => setMostgewicht(i, zeile.key, wert, info.fehler)}
                    />
                  </td>
                </tr>
                </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Unterschriften */}
        <div className="grid grid-cols-2 gap-12 pt-6 border-t border-s112-line-str mt-4">
          <div>
            <div className="h-10 border-b border-s112-grey mb-1" />
            <p className="text-[10px] text-s112-text-2">Ort, Datum, Unterschrift des Versenders bzw. Verfügungsberechtigten</p>
          </div>
          <div>
            <div className="h-10 border-b border-s112-grey mb-1" />
            <p className="text-[10px] text-s112-text-2">Ort, Datum, Unterschrift des Empfängers bzw. Verfügungsberechtigten</p>
          </div>
        </div>

        <p className="text-[9px] text-s112-tertiary pt-1 text-center">
          Für den Empfänger zuständiger Bundeskellereiinspektor
        </p>
      </div>
      </fieldset>

      {/* Print CSS */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body > *:not(#__next) { display: none; }
          #tb-formular { margin: 0; border: none; padding: 8mm; font-size: 9pt; }
          input, select { border: 1px solid #999 !important; background: white !important; }
        }
      `}</style>
    </div>
  )
}
