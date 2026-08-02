'use client'

import { useState, useCallback, useTransition } from 'react'
import { Trash2 } from 'lucide-react'
import { saveTB } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface WeinPosition {
  menge_liter: string
  art: string          // Rot/Weiß/Rosé
  traubensorte: string
  qualitaetsstufe: string
  jahrgang: string
  herkunft: string
  fremd_sorten_pct: string
  fremd_jg_pct: string
  pruefnummer: string
  anreicherung: string // J/N
  alkohol_pct: string
  kmw: string
}

interface TBDaten {
  laufende_nr: string
  jahr: string
  datum_tag: string
  datum_monat: string
  datum_jahr: string
  uhrzeit: string
  zugmaschine: string
  anhaenger1: string
  anhaenger2: string
  // Versender
  v_betriebsnummer: string
  v_telefon: string
  v_name: string
  v_vorname: string
  v_strasse: string
  v_hausnr: string
  v_plz: string
  v_ort: string
  v_ort_versendung: string
  v_plz_versendung: string
  // Empfänger
  e_betriebsnummer: string
  e_telefon: string
  e_name: string
  e_vorname: string
  e_strasse: string
  e_hausnr: string
  e_plz: string
  e_ort: string
  e_ort_einlagerung: string
  e_plz_einlagerung: string
  // Weinpositionen
  positionen: WeinPosition[]
}

interface Props {
  verkaufspostenId: string
  initial: TBDaten
}

const inputCls = 'border border-gray-400 px-1.5 py-0.5 text-xs w-full focus:outline-none focus:border-s112-teal print:border-gray-300 bg-white'
const labelCls = 'text-[10px] text-gray-500 leading-tight block mb-0.5'

function FeldGruppe({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  )
}

export default function TBFormular({ verkaufspostenId, initial }: Props) {
  const [daten, setDaten] = useState<TBDaten>(initial)
  const [gespeichert, setGespeichert] = useState(false)
  const [pending, startTransition] = useTransition()

  const set = useCallback((key: keyof TBDaten, value: string) => {
    setDaten(prev => ({ ...prev, [key]: value }))
    setGespeichert(false)
  }, [])

  const setPos = useCallback((i: number, key: keyof WeinPosition, value: string) => {
    setDaten(prev => {
      const pos = [...prev.positionen]
      pos[i] = { ...pos[i], [key]: value }
      return { ...prev, positionen: pos }
    })
    setGespeichert(false)
  }, [])

  function addPos() {
    setDaten(prev => ({
      ...prev,
      positionen: [...prev.positionen, {
        menge_liter: '', art: 'Weiß', traubensorte: '', qualitaetsstufe: '',
        jahrgang: '', herkunft: '', fremd_sorten_pct: '', fremd_jg_pct: '',
        pruefnummer: '', anreicherung: 'N', alkohol_pct: '', kmw: '',
      }],
    }))
  }

  function removePos(i: number) {
    setDaten(prev => ({ ...prev, positionen: prev.positionen.filter((_, j) => j !== i) }))
  }

  function handleSave() {
    startTransition(async () => {
      await saveTB(verkaufspostenId, daten)
      setGespeichert(true)
    })
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center justify-between no-print">
        <div className="flex items-center gap-2">
          <button
            onClick={handleSave}
            disabled={pending}
            className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50"
          >
            {pending ? 'Speichern…' : 'Speichern'}
          </button>
          {gespeichert && <span className="text-xs text-green-600">Gespeichert</span>}
          <button
            onClick={() => window.print()}
            className="border border-s112-border px-4 py-1.5 rounded-lg text-sm hover:bg-gray-50"
          >
            Drucken
          </button>
        </div>
        <button onClick={addPos} className="text-xs text-s112-teal hover:underline no-print">
          + Weinposition hinzufügen
        </button>
      </div>

      {/* ── Offizielles Formular ── */}
      <div className="bg-white border border-gray-300 p-6 space-y-4 font-sans text-xs" id="tb-formular">

        {/* Titel */}
        <div className="text-center border-b border-gray-800 pb-2 mb-4">
          <h1 className="text-base font-bold tracking-wide">Transportbescheinigung gemäß Weingesetz</h1>
          <p className="text-[10px] text-gray-500 mt-0.5">Nicht stempeln! Nicht heften!</p>
        </div>

        {/* Laufende Nr + Datum + Kennzeichen */}
        <div className="grid grid-cols-12 gap-2 border-b border-gray-300 pb-3">
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
        <div className="grid grid-cols-2 gap-6 border-b border-gray-300 pb-3">
          {/* Versender */}
          <div className="space-y-2">
            <h2 className="font-bold text-sm border-b border-gray-400 pb-1">Versender</h2>
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
            <div className="border-t border-dashed border-gray-300 pt-2">
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
            <h2 className="font-bold text-sm border-b border-gray-400 pb-1">Empfänger</h2>
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
            <div className="border-t border-dashed border-gray-300 pt-2">
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
          <h2 className="font-bold text-sm mb-2">Angaben über den Wein</h2>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border border-gray-400 bg-gray-50">
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Menge (Liter/kg)</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Art<br/><span className="font-normal text-gray-500">Rot/Weiß/Rosé</span></th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Traubensorte(n)</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Qualitätsstufe</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Jahrgang</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Herkunft</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Fremdsorten-<br/>anteil %</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Fremd-JG-<br/>anteil %</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Staatl.<br/>Prüfnummer</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Ange-<br/>reichert<br/>J/N</th>
                <th className="border border-gray-400 px-1 py-1 text-left font-semibold">Alkohol<br/>% vol / °KMW</th>
                <th className="border border-gray-400 px-1 py-1 no-print"></th>
              </tr>
            </thead>
            <tbody>
              {daten.positionen.map((pos, i) => (
                <tr key={i} className="border border-gray-300">
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.menge_liter} onChange={e => setPos(i, 'menge_liter', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <select className={inputCls} value={pos.art} onChange={e => setPos(i, 'art', e.target.value)}>
                      <option>Weiß</option>
                      <option>Rot</option>
                      <option>Rosé</option>
                    </select>
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.traubensorte} onChange={e => setPos(i, 'traubensorte', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.qualitaetsstufe} onChange={e => setPos(i, 'qualitaetsstufe', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.jahrgang} onChange={e => setPos(i, 'jahrgang', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.herkunft} onChange={e => setPos(i, 'herkunft', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.fremd_sorten_pct} onChange={e => setPos(i, 'fremd_sorten_pct', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.fremd_jg_pct} onChange={e => setPos(i, 'fremd_jg_pct', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.pruefnummer} onChange={e => setPos(i, 'pruefnummer', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <select className={inputCls} value={pos.anreicherung} onChange={e => setPos(i, 'anreicherung', e.target.value)}>
                      <option>N</option>
                      <option>J</option>
                    </select>
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={pos.alkohol_pct} placeholder="% / °KMW" onChange={e => setPos(i, 'alkohol_pct', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5 no-print">
                    {daten.positionen.length > 1 && (
                      <button onClick={() => removePos(i)} title="Löschen" aria-label="Löschen" className="text-red-400 hover:text-red-600 text-xs px-1">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Unterschriften */}
        <div className="grid grid-cols-2 gap-12 pt-6 border-t border-gray-300 mt-4">
          <div>
            <div className="h-10 border-b border-gray-500 mb-1" />
            <p className="text-[10px] text-gray-500">Ort, Datum, Unterschrift des Versenders bzw. Verfügungsberechtigten</p>
          </div>
          <div>
            <div className="h-10 border-b border-gray-500 mb-1" />
            <p className="text-[10px] text-gray-500">Ort, Datum, Unterschrift des Empfängers bzw. Verfügungsberechtigten</p>
          </div>
        </div>

        <p className="text-[9px] text-gray-400 pt-1 text-center">
          Für den Empfänger zuständiger Bundeskellereiinspektor
        </p>
      </div>

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
