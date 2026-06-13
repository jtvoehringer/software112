'use client'

import { useState, useTransition } from 'react'
import { savePNA } from './actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

interface Mostcharge {
  betriebsnummer: string
  laufende_nr: string
  jahr: string
  teilmenge: string
}

interface PNADaten {
  antragsnummer: string
  untersuchungsnummer: string
  eingangsdatum: string
  // Antragsteller
  betriebsnummer: string
  name: string
  vorname: string
  plz: string
  ort: string
  strasse: string
  hausnr: string
  telefon: string
  telefax: string
  email: string
  // Bevollmächtigter
  bevo_name: string
  bevo_vorname: string
  // Aufbewahrungsort
  aufbew_plz: string
  aufbew_ort: string
  aufbew_strasse: string
  aufbew_hausnr: string
  // Weinangaben
  farbe: 'Weiß' | 'Rot' | 'Rosé' | 'Gleichgepresst'
  jahrgangsverschnitt: boolean
  jahrgang: string
  lesegradation: string
  angereichert: boolean
  gesuesst: boolean
  einreichmenge: string
  rebsorte: string
  abgefuellt: '' | 'Ja' | 'Teilweise'
  teilmenge_pn: string
  // Bezeichnung
  bez_rebsorte: string
  qualitaetsstufe: string
  weinbaugebiet: string
  bez_jahrgang: string
  reserve: boolean
  grosse_reserve: boolean
  premium: boolean
  barrique: boolean
  ried: string
  gemeinde: string
  schilcher: boolean
  schilcher_klassik: boolean
  bio_wein: boolean
  sonstiges: string
  // Checkboxen
  naechste_qualitaet: boolean
  versiegelungsverzicht: boolean
  mostchargen: Mostcharge[]
}

interface Props {
  dacAntragId: string
  initial: PNADaten
}

const inputCls = 'border border-gray-400 px-1.5 py-0.5 text-xs w-full focus:outline-none focus:border-s112-teal bg-white'
const labelCls = 'text-[10px] text-gray-500 leading-tight block mb-0.5'

function Feld({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <span className={labelCls}>{label}</span>
      {children}
    </div>
  )
}

function CB({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-1 text-[10px] cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)}
        className="w-3 h-3 accent-s112-teal" />
      {label}
    </label>
  )
}

export default function PNAFormular({ dacAntragId, initial }: Props) {
  const [d, setD] = useState<PNADaten>(initial)
  const [gespeichert, setGespeichert] = useState(false)
  const [pending, startTransition] = useTransition()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function set<K extends keyof PNADaten>(key: K, value: PNADaten[K]) {
    setD(prev => ({ ...prev, [key]: value }))
    setGespeichert(false)
  }

  function setMC(i: number, key: keyof Mostcharge, value: string) {
    setD(prev => {
      const mc = [...prev.mostchargen]
      mc[i] = { ...mc[i], [key]: value }
      return { ...prev, mostchargen: mc }
    })
    setGespeichert(false)
  }

  function handleSave() {
    startTransition(async () => {
      await savePNA(dacAntragId, d as unknown as R)
      setGespeichert(true)
    })
  }

  return (
    <div className="space-y-6">
      {/* Toolbar */}
      <div className="flex items-center gap-3 no-print">
        <button onClick={handleSave} disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-opacity-90 disabled:opacity-50">
          {pending ? '⏳ Speichern…' : '💾 Speichern'}
        </button>
        {gespeichert && <span className="text-xs text-green-600">✓ Gespeichert</span>}
        <button onClick={() => window.print()}
          className="border border-s112-border px-4 py-1.5 rounded-lg text-sm hover:bg-gray-50">
          🖨 Drucken
        </button>
      </div>

      {/* ── Offizielles Formular ── */}
      <div className="bg-white border border-gray-300 p-6 space-y-4 font-sans text-xs" id="pna-formular">

        {/* Titel + Antragsnummer */}
        <div className="flex justify-between items-start border-b border-gray-800 pb-3 mb-2">
          <div>
            <h1 className="text-base font-bold">Antrag auf Erteilung einer staatlichen Prüfnummer</h1>
            <p className="text-[10px] text-gray-600">gemäß § 25 des Weingesetzes 2009</p>
            <p className="text-[10px] text-gray-500 mt-1">Füllen Sie bitte diesen Antrag in BLOCKSCHRIFT aus. Zutreffendes bitte ankreuzen!</p>
          </div>
          <div className="text-right space-y-1 min-w-[160px]">
            <Feld label="ANTRAGSNUMMER">
              <input className={inputCls} value={d.antragsnummer} onChange={e => set('antragsnummer', e.target.value)} />
            </Feld>
            <Feld label="Untersuchungsnummer">
              <input className={inputCls} value={d.untersuchungsnummer} onChange={e => set('untersuchungsnummer', e.target.value)} />
            </Feld>
            <Feld label="Eingangsdatum TT/MM/JJJJ">
              <input className={inputCls} value={d.eingangsdatum} onChange={e => set('eingangsdatum', e.target.value)} />
            </Feld>
          </div>
        </div>

        {/* Antragsteller */}
        <div className="space-y-2 border-b border-gray-300 pb-3">
          <h2 className="font-bold text-xs">Antragsteller</h2>
          <div className="grid grid-cols-4 gap-1">
            <Feld label="Betriebsnummer">
              <input className={inputCls} value={d.betriebsnummer} onChange={e => set('betriebsnummer', e.target.value)} />
            </Feld>
            <div className="col-span-2">
              <Feld label="Firmenname oder Familienname des Antragstellers">
                <input className={inputCls} value={d.name} onChange={e => set('name', e.target.value)} />
              </Feld>
            </div>
            <Feld label="Vorname">
              <input className={inputCls} value={d.vorname} onChange={e => set('vorname', e.target.value)} />
            </Feld>
          </div>
          <div className="grid grid-cols-5 gap-1">
            <Feld label="Postleitzahl">
              <input className={inputCls} value={d.plz} onChange={e => set('plz', e.target.value)} />
            </Feld>
            <div className="col-span-2">
              <Feld label="Ort">
                <input className={inputCls} value={d.ort} onChange={e => set('ort', e.target.value)} />
              </Feld>
            </div>
            <div className="col-span-2">
              <Feld label="Straße">
                <input className={inputCls} value={d.strasse} onChange={e => set('strasse', e.target.value)} />
              </Feld>
            </div>
          </div>
          <div className="grid grid-cols-5 gap-1">
            <Feld label="Hausnr.">
              <input className={inputCls} value={d.hausnr} onChange={e => set('hausnr', e.target.value)} />
            </Feld>
            <div className="col-span-2">
              <Feld label="Telefon">
                <input className={inputCls} value={d.telefon} onChange={e => set('telefon', e.target.value)} />
              </Feld>
            </div>
            <Feld label="Telefax">
              <input className={inputCls} value={d.telefax} onChange={e => set('telefax', e.target.value)} />
            </Feld>
            <Feld label="E-Mail">
              <input className={inputCls} value={d.email} onChange={e => set('email', e.target.value)} />
            </Feld>
          </div>
          <div className="grid grid-cols-3 gap-1 pt-1">
            <div className="col-span-2">
              <Feld label="Bevollmächtigter – Familienname (wenn nicht wie oben)">
                <input className={inputCls} value={d.bevo_name} onChange={e => set('bevo_name', e.target.value)} />
              </Feld>
            </div>
            <Feld label="Vorname">
              <input className={inputCls} value={d.bevo_vorname} onChange={e => set('bevo_vorname', e.target.value)} />
            </Feld>
          </div>
        </div>

        {/* Aufbewahrungsort */}
        <div className="space-y-2 border-b border-gray-300 pb-3">
          <h2 className="font-bold text-xs">Aufbewahrungsort des Weines (wenn nicht wie oben)</h2>
          <div className="grid grid-cols-5 gap-1">
            <Feld label="Postleitzahl">
              <input className={inputCls} value={d.aufbew_plz} onChange={e => set('aufbew_plz', e.target.value)} />
            </Feld>
            <div className="col-span-2">
              <Feld label="Ort">
                <input className={inputCls} value={d.aufbew_ort} onChange={e => set('aufbew_ort', e.target.value)} />
              </Feld>
            </div>
            <div className="col-span-2">
              <Feld label="Straße">
                <input className={inputCls} value={d.aufbew_strasse} onChange={e => set('aufbew_strasse', e.target.value)} />
              </Feld>
            </div>
          </div>
        </div>

        {/* Angaben über den Wein */}
        <div className="space-y-2 border-b border-gray-300 pb-3">
          <h2 className="font-bold text-xs">Angaben über den Wein</h2>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <span className={labelCls}>Farbe</span>
              <div className="flex gap-3 mt-0.5">
                {(['Weiß', 'Rot', 'Rosé', 'Gleichgepresst'] as const).map(f => (
                  <label key={f} className="flex items-center gap-1 text-[10px] cursor-pointer">
                    <input type="radio" name="farbe" value={f} checked={d.farbe === f}
                      onChange={() => set('farbe', f)} className="w-3 h-3 accent-s112-teal" />
                    {f}
                  </label>
                ))}
              </div>
            </div>
            <CB checked={d.jahrgangsverschnitt} onChange={v => set('jahrgangsverschnitt', v)} label="Jahrgangsverschnitt" />
          </div>
          <div className="grid grid-cols-6 gap-2">
            <Feld label="Jahrgang">
              <input className={inputCls} value={d.jahrgang} onChange={e => set('jahrgang', e.target.value)} />
            </Feld>
            <Feld label="Lesegradation">
              <input className={inputCls} value={d.lesegradation} onChange={e => set('lesegradation', e.target.value)} />
            </Feld>
            <div className="flex items-end gap-2">
              <CB checked={d.angereichert} onChange={v => set('angereichert', v)} label="Angereichert" />
            </div>
            <div className="flex items-end gap-2">
              <CB checked={d.gesuesst} onChange={v => set('gesuesst', v)} label="Gesüßt" />
            </div>
            <Feld label="Einreichmenge in Liter">
              <input className={inputCls} value={d.einreichmenge} onChange={e => set('einreichmenge', e.target.value)} />
            </Feld>
            <Feld label="Qualitätsweinrebsorte(n)">
              <input className={inputCls} value={d.rebsorte} onChange={e => set('rebsorte', e.target.value)} />
            </Feld>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Feld label="Abgefüllt">
              <select className={inputCls} value={d.abgefuellt} onChange={e => set('abgefuellt', e.target.value as PNADaten['abgefuellt'])}>
                <option value="">–</option>
                <option>Ja</option>
                <option>Teilweise</option>
              </select>
            </Feld>
            <div className="col-span-3">
              <Feld label="Teilmenge mit bereits vorhandenen Prüfnummern in Liter">
                <input className={inputCls} value={d.teilmenge_pn} onChange={e => set('teilmenge_pn', e.target.value)} />
              </Feld>
            </div>
          </div>
        </div>

        {/* Bezeichnung des Weines */}
        <div className="space-y-2 border-b border-gray-300 pb-3">
          <h2 className="font-bold text-xs">Bezeichnung des Weines</h2>
          <div className="grid grid-cols-5 gap-2">
            <Feld label="Qualitätsweinrebsorte(n)">
              <input className={inputCls} value={d.bez_rebsorte} onChange={e => set('bez_rebsorte', e.target.value)} />
            </Feld>
            <Feld label="Qualitätsstufe">
              <input className={inputCls} value={d.qualitaetsstufe} onChange={e => set('qualitaetsstufe', e.target.value)} />
            </Feld>
            <Feld label="Weinbaugebiet">
              <input className={inputCls} value={d.weinbaugebiet} onChange={e => set('weinbaugebiet', e.target.value)} />
            </Feld>
            <Feld label="Jahrgang">
              <input className={inputCls} value={d.bez_jahrgang} onChange={e => set('bez_jahrgang', e.target.value)} />
            </Feld>
          </div>
          <div className="flex flex-wrap gap-4">
            <CB checked={d.reserve} onChange={v => set('reserve', v)} label="Reserve" />
            <CB checked={d.grosse_reserve} onChange={v => set('grosse_reserve', v)} label="Große Reserve" />
            <CB checked={d.premium} onChange={v => set('premium', v)} label="Premium" />
            <CB checked={d.barrique} onChange={v => set('barrique', v)} label="Barrique" />
            <CB checked={d.schilcher} onChange={v => set('schilcher', v)} label="Schilcher" />
            <CB checked={d.schilcher_klassik} onChange={v => set('schilcher_klassik', v)} label="Schilcher Klassik" />
            <CB checked={d.bio_wein} onChange={v => set('bio_wein', v)} label="Bio-Wein" />
          </div>
          <div className="grid grid-cols-4 gap-2">
            <Feld label="Ried">
              <input className={inputCls} value={d.ried} onChange={e => set('ried', e.target.value)} />
            </Feld>
            <Feld label="Gemeinde">
              <input className={inputCls} value={d.gemeinde} onChange={e => set('gemeinde', e.target.value)} />
            </Feld>
            <div className="col-span-2">
              <Feld label="Sonstiges">
                <input className={inputCls} value={d.sonstiges} onChange={e => set('sonstiges', e.target.value)} />
              </Feld>
            </div>
          </div>
          <label className="flex items-start gap-2 text-[10px] cursor-pointer mt-2">
            <input type="checkbox" checked={d.naechste_qualitaet} onChange={e => set('naechste_qualitaet', e.target.checked)}
              className="w-3 h-3 mt-0.5 accent-s112-teal flex-shrink-0" />
            <span>Bei Nichterreichen der beantragten Qualitätsstufe ändere ich meinen Antrag auf die nächstmögliche niedrigere Qualitätsstufe.</span>
          </label>
        </div>

        {/* Mostchargennummern */}
        <div className="space-y-2 border-b border-gray-300 pb-3">
          <h2 className="font-bold text-xs">Zugrundeliegende Mostchargennummern <span className="font-normal text-gray-500">(aus der Mostwägerbestätigung – nur bei Prädikatsweinen)</span></h2>
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="bg-gray-50 border border-gray-300">
                <th className="border border-gray-300 px-2 py-1 text-left font-semibold">Betriebsnummer</th>
                <th className="border border-gray-300 px-2 py-1 text-left font-semibold">Laufende Nummer</th>
                <th className="border border-gray-300 px-2 py-1 text-left font-semibold">Jahr</th>
                <th className="border border-gray-300 px-2 py-1 text-left font-semibold">Teilmengen in Liter</th>
              </tr>
            </thead>
            <tbody>
              {d.mostchargen.map((mc, i) => (
                <tr key={i} className="border border-gray-200">
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={mc.betriebsnummer} onChange={e => setMC(i, 'betriebsnummer', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={mc.laufende_nr} onChange={e => setMC(i, 'laufende_nr', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={mc.jahr} onChange={e => setMC(i, 'jahr', e.target.value)} />
                  </td>
                  <td className="border border-gray-300 p-0.5">
                    <input className={inputCls} value={mc.teilmenge} onChange={e => setMC(i, 'teilmenge', e.target.value)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Versiegelungsverzicht + Unterschrift */}
        <div className="flex justify-between items-end pt-2">
          <CB checked={d.versiegelungsverzicht} onChange={v => set('versiegelungsverzicht', v)} label="Versiegelungsverzicht 4. Probe" />
          <div className="w-80">
            <div className="h-10 border-b border-gray-500 mb-1" />
            <p className="text-[10px] text-gray-500 text-right">Datum, Unterschrift des Antragstellers (Verfügungsberechtigten)</p>
          </div>
        </div>

        <p className="text-[9px] text-gray-400 text-center pt-1">
          Erstellt mittels software:112 (IC&amp;P Consultants) · Unrichtige Angaben ziehen den Verlust der Prüfnummer gemäß § 25 (9) Z. 1 nach sich!
        </p>
      </div>

      <style>{`
        @media print {
          .no-print { display: none !important; }
          #pna-formular { margin: 0; border: none; padding: 8mm; font-size: 9pt; }
          input, select { border: 1px solid #999 !important; background: white !important; }
        }
      `}</style>
    </div>
  )
}
