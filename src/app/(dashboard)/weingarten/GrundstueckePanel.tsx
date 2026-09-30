'use client'

import React, { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { createGrundstueck, updateGrundstueck, deleteGrundstueck, fetchBevFlaeche, type BevNutzung } from './actions'
import { fmtHa } from '@/lib/format'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'
import { HERKUNFT_ORDER, HERKUNFT_LABEL } from '@/lib/herkunft'
import HerkunftCodeSelect from '@/components/weinbaugebiete/HerkunftCodeSelect'
import type { CustomWeinbaugebiet } from '../weinbaugebiete/actions'
import { NUTZART_OPTIONS, NutzungBadge } from '@/lib/wein/grundstueckStatus'
import { fehlerText } from '@/lib/fehler'
import { MASSNAHMEN_ART_LABEL } from '@/lib/behandlungen/arten'

const HERKUNFT_OPTIONS = HERKUNFT_ORDER.map(code => ({ value: code, label: HERKUNFT_LABEL[code] }))

export type GST = {
  id: string; weingarten_id: string; gst_nr: string
  katastralgemeinde: string | null; einlagezahl: string | null
  rebsorte: string | null; pflanzjahr: number | null
  weinart: string | null; bewirtschaftung: string | null; bewirtschaftung_seit: string | null
  flaeche_ha: number | null; flaeche_ha_kataster: number | null
  trauben_herkunft_code: string | null
  ama_feldnummer: string | null; kg_bezeichnung: string | null
  boden: string | null; rechtsverhaeltnis: string | null; unterlagsrebe: string | null
  status: string; nutzart: string | null; notizen: string | null
  lse_stueckzahl: number | null
}

export type MassnahmeHistorie = {
  id: string; datum: string; art: string
  psm_name: string | null
  aufwandmenge: number | null; aufwandmenge_einheit: string | null
  /** KAN-132: Mittel- bzw. Düngermenge und Spritzbrühe anteilig auf dieses GST (verteileMassnahme) */
  menge?: number | null; menge_einheit?: string | null
  bruehe?: number | null
  /** Fläche dieses GST bei der Maßnahme (ha) und Anteil an der Maßnahme (%) */
  flaeche_ha?: number | null; anteil_pct?: number | null
  vermerk?: string | null
  /** Kosten der Maßnahme anteilig auf dieses GST (€, laufend gerechnet) */
  kosten_eur?: number | null
}

/** Aufwand je ha bzw. je hl gilt für jedes GST gleich; „kg/l (gesamt)“ ist ein Wert der ganzen Maßnahme (KAN-132) */
const AUFWAND_JE_FLAECHE = new Set(['kg_ha', 'l_ha', 'g_hl', 'ml_hl'])

function zahlDe(n: number, stellen = 3) {
  return n.toLocaleString('de-AT', { maximumFractionDigits: stellen })
}

// Bezeichnungen der Maßnahmenarten (lib/behandlungen/arten.ts, seit KAN-143 mit Laubschneiden)
const MASSNAHME_ART_LABEL: Record<string, string> = MASSNAHMEN_ART_LABEL
const MASSNAHME_EINHEIT_LABEL: Record<string, string> = {
  kg_ha: 'kg/ha', l_ha: 'l/ha', g_hl: 'g/hl', ml_hl: 'ml/hl', kg: 'kg', l: 'l',
}

const BEWIRTSCHAFTUNG_OPTIONS = [
  { value: 'biodynamisch',  label: 'Biodynamisch' },
  { value: 'biologisch',    label: 'Biologisch/Organisch' },
  { value: 'in_umstellung', label: 'In Umstellung' },
  { value: 'nachhaltig',    label: 'Nachhaltig' },
  { value: 'kip',           label: 'KIP' },
  { value: 'konventionell', label: 'Konventionell' },
]

const BEWIRTSCHAFTUNG_BADGE: Record<string, string> = {
  biodynamisch:  'bg-s112-ok-bg text-s112-ok-fg',
  biologisch:    'bg-s112-ok-bg text-s112-ok-fg',
  in_umstellung: 'bg-s112-warn-bg text-s112-warn-fg',
  nachhaltig:    'bg-[#F2F3F5] text-s112-text-1',
  kip:           'bg-s112-blue-100 text-s112-blue-700',
  konventionell: 'bg-[#F2F3F5] text-s112-text-2',
  bio:           'bg-s112-ok-bg text-s112-ok-fg',
  demeter:       'bg-s112-ok-bg text-s112-ok-fg',
}
const BEWIRTSCHAFTUNG_LABEL: Record<string, string> = {
  biodynamisch:  'Biodynamisch',
  biologisch:    'Bio/Organisch',
  in_umstellung: 'In Umstellung',
  nachhaltig:    'Nachhaltig',
  kip:           'KIP',
  konventionell: 'Konventionell',
  bio:           'Bio',
  demeter:       'Biodynamisch',
}

const inputCls = "w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40"
const labelCls = "block text-xs font-medium text-s112-text-2 mb-1"

// ── Maßnahmen-Verlauf für ein einzelnes GST (Punkt 10) ────────────────────────
function GstMassnahmenPanel({ massnahmen }: { massnahmen: MassnahmeHistorie[] }) {
  return (
    <div className="bg-s112-bg/60 border-t border-s112-border/50 px-3 py-2">
      <p className="text-xs font-medium text-s112-text-2 mb-1">Maßnahmen-Verlauf</p>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-s112-text-2">
            <th className="text-left py-1 pr-3 font-medium">Datum</th>
            <th className="text-left py-1 pr-3 font-medium">Art</th>
            <th className="text-left py-1 pr-3 font-medium">Mittel</th>
            <th className="text-right py-1 pr-3 font-medium">Aufwand</th>
            <th className="text-right py-1 pr-3 font-medium">Menge anteilig</th>
            <th className="text-right py-1 pr-3 font-medium">Anteil</th>
            <th className="text-right py-1 font-medium">Kosten</th>
          </tr>
        </thead>
        <tbody>
          {massnahmen.map(m => (
            <tr key={m.id} className="border-t border-s112-border/30">
              <td className="py-1 pr-3 text-s112-muted">
                {new Date(m.datum).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
              </td>
              <td className="py-1 pr-3 text-s112-text-1">{MASSNAHME_ART_LABEL[m.art] ?? m.art}</td>
              <td className="py-1 pr-3 text-s112-text-1">
                {m.psm_name ?? '–'}
                {m.vermerk && <span className="block text-[10px] text-s112-muted">{m.vermerk}</span>}
              </td>
              <td className="py-1 pr-3 text-right font-mono text-s112-text-2"
                title={m.aufwandmenge != null && m.aufwandmenge_einheit && !AUFWAND_JE_FLAECHE.has(m.aufwandmenge_einheit) ? `Aufwand der ganzen Maßnahme: ${zahlDe(m.aufwandmenge)} ${MASSNAHME_EINHEIT_LABEL[m.aufwandmenge_einheit] ?? m.aufwandmenge_einheit}` : undefined}>
                {m.aufwandmenge != null && m.aufwandmenge_einheit && AUFWAND_JE_FLAECHE.has(m.aufwandmenge_einheit)
                  ? `${zahlDe(m.aufwandmenge)} ${MASSNAHME_EINHEIT_LABEL[m.aufwandmenge_einheit] ?? m.aufwandmenge_einheit}`
                  : '–'}
              </td>
              <td className="py-1 pr-3 text-right font-mono text-s112-text-1">
                {m.menge != null ? `${zahlDe(m.menge)} ${m.menge_einheit ?? ''}` : '–'}
                {m.bruehe != null && <span className="block text-[10px] text-s112-muted">Brühe {zahlDe(m.bruehe)} l</span>}
              </td>
              <td className="py-1 text-right font-mono text-s112-text-2">
                {m.flaeche_ha != null ? `${zahlDe(m.flaeche_ha, 4)} ha` : ''}
                {m.anteil_pct != null && <span className="block text-[10px] text-s112-muted">{zahlDe(m.anteil_pct, 1)} %</span>}
              </td>
              <td className="py-1 pl-3 text-right font-mono text-s112-text-2">
                {m.kosten_eur != null ? m.kosten_eur.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }) : '–'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Formular (Neu / Bearbeiten) ───────────────────────────────────────────────
function GSTForm({ weingartenId, gst, customWeinbaugebiete, onNeuesWeinbaugebiet, onDone }: {
  weingartenId: string
  gst?: GST
  customWeinbaugebiete: CustomWeinbaugebiet[]
  onNeuesWeinbaugebiet: (w: CustomWeinbaugebiet) => void
  onDone: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [bewirtschaftung, setBewirtschaftung] = useState(gst?.bewirtschaftung ?? '')
  const [weinart, setWeinart] = useState(gst?.weinart ?? 'unbekannt')
  // Rückmeldung 24.8.2026: bei Nutzart "LSE" (Landschaftselement) muss
  // zusätzlich die Stückzahl (Bäume/Büsche) erfasst werden können - Feld nur
  // sichtbar, wenn diese Nutzart gewählt ist, daher kontrolliert statt
  // defaultValue (analog "In Umstellung seit" bei Bewirtschaftung oben).
  const [nutzart, setNutzart] = useState(gst?.nutzart ?? '')
  const [lseStueck, setLseStueck] = useState<string>(gst?.lse_stueckzahl != null ? String(gst.lse_stueckzahl) : '')
  const [kgnr, setKgnr] = useState(gst?.katastralgemeinde ?? '')
  const [kgBezeichnung, setKgBezeichnung] = useState(gst?.kg_bezeichnung ?? '')
  const [katasterHa, setKatasterHa] = useState<string>(gst?.flaeche_ha_kataster != null ? String(gst.flaeche_ha_kataster) : '')
  const [bevLoading, setBevLoading] = useState(false)
  const [bevMsg, setBevMsg] = useState<string | null>(null)
  const [bevOk, setBevOk] = useState(false)
  const [bevAlleNutzungen, setBevAlleNutzungen] = useState<BevNutzung[] | null>(null)

  function handleKgnrChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value
    setKgnr(val)
    // Auto-Lookup bei 4 oder 5 Stellen (KGNr. sind offiziell 5-stellig mit führender 0,
    // werden aber oft 4-stellig eingegeben, z.B. 4023 = Pfaffstätten → padStart → 04023)
    if (val.length === 4 || val.length === 5) {
      const lookup = getKgBezeichnung(val)
      setKgBezeichnung(lookup ?? '') // leert Feld wenn kein Treffer → kein "Altbestand"
    } else {
      setKgBezeichnung('') // leert Feld bei unvollständiger Eingabe
    }
  }

  async function handleBevImport() {
    if (!kgnr) { setBevMsg('Bitte zuerst KGNr eingeben'); setBevOk(false); return }
    const gstNr = (document.querySelector('input[name="gst_nr"]') as HTMLInputElement)?.value
    if (!gstNr) { setBevMsg('Bitte zuerst GST-Nr eingeben'); setBevOk(false); return }
    setBevLoading(true)
    setBevMsg(null)
    setBevAlleNutzungen(null)
    const result = await fetchBevFlaeche(kgnr, gstNr)
    setBevLoading(false)
    if (result.ok) {
      setKatasterHa(String(result.ha))
      const detail = result.nutzungen.map(n => n.nutzung + ': ' + n.ha.toFixed(4) + ' ha').join(', ')
      setBevMsg(result.ha.toFixed(4) + ' ha (' + detail + ')')
      setBevOk(true)
    } else {
      setBevMsg(result.message)
      setBevOk(false)
      if ('alleNutzungen' in result && result.alleNutzungen) {
        setBevAlleNutzungen(result.alleNutzungen)
      }
    }
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        if (gst) await updateGrundstueck(gst.id, weingartenId, fd)
        else      await createGrundstueck(weingartenId, fd)
        onDone()
      } catch (err) {
        // Ohne try/catch riss ein Fehler aus der Server Action (z.B. ein
        // DB-Constraint-Fehler) die ganze Seite ab ("This page couldn't
        // load" statt einer Fehlermeldung im Formular) - siehe Rückmeldung
        // 24.8.2026 zum Speichern-Fehler bei Rechtsverhältnis "Nutzung".
        setError(fehlerText(err, 'Unbekannter Fehler beim Speichern'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      <h3 className="text-sm font-semibold text-s112-text">
        {gst ? 'Grundstück bearbeiten' : 'Grundstück hinzufügen'}
      </h3>
      {error && (
        <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-3 py-2 text-sm">
          <strong>Fehler:</strong> {error}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {/* Identifikation */}
        <div>
          <label className={labelCls}>GST-Nummer <span className="text-s112-err">*</span></label>
          <input aria-label="GST-Nummer" name="gst_nr" required defaultValue={gst?.gst_nr ?? ''} placeholder="z.B. 1411/1" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Nutzart <span className="text-s112-err">*</span></label>
          <select aria-label="Nutzart" name="nutzart" required value={nutzart} onChange={e => setNutzart(e.target.value)} className={inputCls}>
            <option value="" disabled>– bitte wählen –</option>
            {NUTZART_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.value} – {o.label}</option>)}
          </select>
        </div>
        {nutzart === 'LSE' && (
          <div>
            <label className={labelCls}>Stückzahl</label>
            <input aria-label="Stückzahl"
              name="lse_stueckzahl"
              type="number" min="0" step="1"
              value={lseStueck}
              onChange={e => setLseStueck(e.target.value)}
              placeholder="z.B. 5"
              className={inputCls}
            />
            <p className="text-xs text-s112-muted mt-1">Anzahl Bäume/Büsche</p>
          </div>
        )}
        <div>
          <label className={labelCls}>KGNr.</label>
          <input aria-label="KGNr."
            name="katastralgemeinde"
            value={kgnr}
            onChange={handleKgnrChange}
            placeholder="z.B. 12105"
            maxLength={5}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Katastralgemeinde</label>
          <input name="kg_bezeichnung" type="hidden" value={kgBezeichnung} />
          <div className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm bg-s112-bg text-s112-text-1 min-h-[34px]">
            {kgBezeichnung || <span className="text-s112-muted italic">wird aus KGNr. ermittelt</span>}
          </div>
        </div>

        {/* Rebsorte & Weinart */}
        <div>
          <label className={labelCls}>Rebsorte</label>
          <input aria-label="Rebsorte" name="rebsorte" defaultValue={gst?.rebsorte ?? ''} placeholder="z.B. Grüner Veltliner" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Weinart</label>
          <select aria-label="Weinart" name="weinart" value={weinart} onChange={e => setWeinart(e.target.value)} className={inputCls}>
            <option value="weiss">Weißwein</option>
            <option value="rot">Rotwein</option>
            <option value="unbekannt">– unbekannt –</option>
          </select>
        </div>

        {/* Pflanzjahr & Bewirtschaftung */}
        <div>
          <label className={labelCls}>Pflanzjahr</label>
          <input aria-label="Pflanzjahr" name="pflanzjahr" type="number" min="1900" max="2100" defaultValue={gst?.pflanzjahr ?? ''} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Bewirtschaftung</label>
          <select aria-label="Bewirtschaftung" name="bewirtschaftung" value={bewirtschaftung} onChange={e => setBewirtschaftung(e.target.value)} className={inputCls}>
            <option value="">– bitte wählen –</option>
            {BEWIRTSCHAFTUNG_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        {bewirtschaftung === 'in_umstellung' && (
          <div className="col-span-2">
            <label className={labelCls}>In Umstellung seit</label>
            <input aria-label="In Umstellung seit" name="bewirtschaftung_seit" type="date" defaultValue={gst?.bewirtschaftung_seit ?? ''} className={inputCls} />
          </div>
        )}

        {/* Flächen */}
        <div>
          <label className={labelCls}>GST-Fläche lt. AMA (ha)</label>
          <input aria-label="GST-Fläche lt. AMA (ha)" name="flaeche_ha" type="number" step="0.0001" min="0" defaultValue={gst?.flaeche_ha ?? ''} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>
            GST-Fläche lt. Kataster (ha)
          </label>
          <div className="flex gap-1.5">
            <input
              name="flaeche_ha_kataster"
              type="number" step="0.0001" min="0"
              value={katasterHa}
              onChange={e => setKatasterHa(e.target.value)}
              className={inputCls}
            />
            <button
              type="button"
              onClick={handleBevImport}
              disabled={bevLoading}
              title="Fläche aus BEV-Kataster holen"
              className="shrink-0 px-2.5 py-1.5 rounded-lg border border-s112-border text-xs font-medium text-s112-blue-700 hover:bg-s112-teal/10 disabled:opacity-40 transition-colors whitespace-nowrap"
            >
              {bevLoading ? '…' : 'BEV'}
            </button>
          </div>
          {bevMsg && (
            <p className={'text-xs mt-1 ' + (bevOk ? 'text-s112-ok-fg' : 'text-s112-warn-fg')}>
              {bevMsg}
            </p>
          )}
          {bevAlleNutzungen && bevAlleNutzungen.length > 0 && (
            <div className="mt-2 border border-s112-warn/30 rounded-lg overflow-hidden text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-s112-warn-bg text-s112-warn-fg">
                    <th className="text-left px-2 py-1 font-medium">NS</th>
                    <th className="text-left px-2 py-1 font-medium">Nutzung</th>
                    <th className="text-right px-2 py-1 font-medium">ha</th>
                  </tr>
                </thead>
                <tbody>
                  {bevAlleNutzungen.map((n, i) => (
                    <tr key={i} className="border-t border-s112-warn/30">
                      <td className="px-2 py-1 font-mono text-s112-warn-fg">{n.ns}</td>
                      <td className="px-2 py-1 text-s112-text-1">{n.nutzung}</td>
                      <td className="px-2 py-1 text-right font-mono text-s112-text-1">{n.ha.toFixed(4)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-s112-warn/30 bg-s112-warn-bg font-semibold">
                    <td className="px-2 py-1 text-s112-warn-fg" colSpan={2}>Gesamt</td>
                    <td className="px-2 py-1 text-right font-mono text-s112-warn-fg">
                      {bevAlleNutzungen.reduce((s, n) => s + n.ha, 0).toFixed(4)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* BKI */}
        <div className="col-span-2">
          <label className={labelCls}>Herkunft-Code (BKI)</label>
          <HerkunftCodeSelect
            name="trauben_herkunft_code"
            defaultValue={gst?.trauben_herkunft_code ?? ''}
            builtinOptions={HERKUNFT_OPTIONS}
            customOptions={customWeinbaugebiete}
            onNeuAngelegt={onNeuesWeinbaugebiet}
            emptyLabel="– bitte wählen –"
            className={inputCls}
          />
          <p className="text-xs text-s112-muted mt-1">Herkunftsstufe gem. Weingesetz/DAC-Verordnung – wird an Lese, Kellerbuch und Füllung weitergegeben (nur Abstufungen möglich). Fehlt ein Gebiet, kann es direkt im Dropdown über „+ Neues Weinbaugebiet hinzufügen…" ergänzt werden.</p>
        </div>

        {/* AMA-Schlagnummer (pro Grundstück - NICHT zu verwechseln mit der
            AMA-Feldstücknr. auf dem Ried/Weingarten-Datensatz, Rückmeldung
            24.8.2026: beide hießen zuvor identisch "AMA-Feldstücknr." und
            wurden in der Rieden-Übersicht in derselben Spalte angezeigt) */}
        <div>
          <label className={labelCls}>AMA-Schlagnr.</label>
          <input aria-label="AMA-Schlagnr." name="ama_feldnummer" maxLength={3} pattern="[0-9]{1,3}" defaultValue={gst?.ama_feldnummer ?? ''} placeholder="z.B. 12" className={inputCls} />
          <p className="text-xs text-s112-muted mt-1">Max. 3-stellig numerisch</p>
        </div>

        {/* Rechtsverhältnis */}
        <div>
          <label className={labelCls}>Rechtsverhältnis</label>
          <select aria-label="Rechtsverhältnis" name="rechtsverhaeltnis" defaultValue={gst?.rechtsverhaeltnis ?? ''} className={inputCls}>
            <option value="">– bitte wählen –</option>
            <option value="eigentum">Eigentum</option>
            <option value="pacht">Pacht</option>
            <option value="nutzung">Nutzung</option>
          </select>
        </div>

        {/* Unterlagsrebe */}
        <div>
          <label className={labelCls}>Unterlagsrebe</label>
          <input aria-label="Unterlagsrebe" name="unterlagsrebe" defaultValue={gst?.unterlagsrebe ?? ''} placeholder="z.B. SO4, Kober 5BB" className={inputCls} />
        </div>

        {/* Boden */}
        <div>
          <label className={labelCls}>Boden</label>
          <input aria-label="Boden" name="boden" defaultValue={gst?.boden ?? ''} placeholder="z.B. Löss, Schotter, Gneis" className={inputCls} />
        </div>

        {/* Notizen */}
        <div className="col-span-2">
          <label className={labelCls}>Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={gst?.notizen ?? ''} className={inputCls} />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50 transition-colors">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text transition-colors">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────
export default function GrundstueckePanel({
  weingartenId, grundstuecke, massnahmenByGst = {}, customWeinbaugebiete = [], writeOk, adminOk,
}: {
  weingartenId: string
  grundstuecke: GST[]
  massnahmenByGst?: Record<string, MassnahmeHistorie[]>
  customWeinbaugebiete?: CustomWeinbaugebiet[]
  // Rückmeldung 24.8.2026: dieses Panel prüfte bisher überhaupt keine
  // Berechtigungen - jeder eingeloggte Tenant-Nutzer (auch Rolle "Nur-Lesen")
  // konnte Grundstücke anlegen/bearbeiten/löschen. writeOk (alle außer
  // "leser") steuert Anlegen/Bearbeiten, adminOk (nur "Betriebsleiter" =
  // tenant_admin + system_admin, siehe canAdmin() in roles.ts) steuert
  // ausschließlich Löschen - analog zur bereits vorhandenen Gate-Logik in
  // WeingartenBaum.tsx.
  writeOk: boolean
  adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId]     = useState<string | null>(null)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()

  // Eigene Weinbaugebiete werden hier (statt in jeder GSTForm-Instanz einzeln) gehalten,
  // damit ein neu angelegtes Gebiet auch beim nächsten geöffneten GST-Formular in
  // derselben Seitenansicht sofort zur Auswahl steht.
  const [eigeneWeinbaugebiete, setEigeneWeinbaugebiete] = useState(customWeinbaugebiete)
  function handleNeuesWeinbaugebiet(w: CustomWeinbaugebiet) {
    setEigeneWeinbaugebiete(prev =>
      prev.some(x => x.id === w.id) ? prev : [...prev, w].sort((a, b) => a.name.localeCompare(b.name, 'de-AT'))
    )
  }

  const totalAma      = grundstuecke.reduce((s, g) => s + (g.flaeche_ha ?? 0), 0)
  const totalKataster = grundstuecke.reduce((s, g) => s + (g.flaeche_ha_kataster ?? 0), 0)
  const aktiv         = grundstuecke.filter(g => g.nutzart === 'WI').length

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDelete(id: string, gstNr: string) {
    if (!confirm(`GST ${gstNr} wirklich löschen?`)) return
    startTransition(() => deleteGrundstueck(id, weingartenId))
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-s112-text">Grundstücke</h2>
          <span className="text-xs text-s112-muted">
            {grundstuecke.length} GST · {aktiv} aktiv · AMA: {fmtHa(totalAma)} ha
            {totalKataster > 0 && ` · Kataster: ${fmtHa(totalKataster)} ha`}
          </span>
        </div>
        {writeOk && !showForm && (
          <button onClick={() => { setShowForm(true); setEditId(null) }}
            className="inline-flex items-center gap-1 text-xs bg-s112-teal/10 hover:bg-s112-teal/20 text-s112-blue-700 font-medium px-3 py-1.5 rounded-lg transition-colors">
            Grundstück
          </button>
        )}
      </div>

      {writeOk && showForm && !editId && (
        <div className="mb-3">
          <GSTForm weingartenId={weingartenId} customWeinbaugebiete={eigeneWeinbaugebiete} onNeuesWeinbaugebiet={handleNeuesWeinbaugebiet} onDone={() => setShowForm(false)} />
        </div>
      )}

      {grundstuecke.length > 0 ? (
        <div className="border border-s112-border rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border text-xs text-s112-text-2">
                <th className="w-6 px-2 py-2" />
                <th className="text-left px-3 py-2 font-semibold">GST-Nr</th>
                <th className="text-left px-3 py-2 font-semibold">Rebsorte</th>
                <th className="text-left px-3 py-2 font-semibold">Bewirtschaftung</th>
                <th className="text-right px-3 py-2 font-semibold leading-tight">GST-Fläche<br/>lt. AMA</th>
                <th className="text-right px-3 py-2 font-semibold leading-tight">GST-Fläche<br/>lt. Kataster</th>
                <th className="text-right px-3 py-2 font-semibold">Pflanzjahr</th>
                <th className="text-center px-3 py-2 font-semibold">Nutzart</th>
                <th className="text-center px-3 py-2 font-semibold">Nutzung</th>
                <th className="px-3 py-2 sticky right-0 bg-s112-bg border-l border-s112-border" />
              </tr>
            </thead>
            <tbody>
              {grundstuecke.map(g => {
                const massnahmen = massnahmenByGst[g.id] ?? []
                const isExpanded = expandedIds.has(g.id)
                const hasHistory = massnahmen.length > 0
                return (
                  <React.Fragment key={g.id}>
                    <tr
                      className={`group border-b border-s112-border/50 transition-colors ${writeOk ? 'cursor-pointer hover:bg-s112-bg/40' : ''} ${!isExpanded ? 'last:border-0' : ''} ${g.nutzart !== 'WI' ? 'opacity-60' : ''}`}
                      onClick={() => { if (writeOk) { setEditId(g.id); setShowForm(false) } }}
                      title={writeOk ? 'Grundstück bearbeiten' : undefined}
                    >
                      {/* Expand-Toggle */}
                      <td className="px-2 py-2 text-center" onClick={e => e.stopPropagation()}>
                        {hasHistory ? (
                          <button
                            onClick={() => toggleExpand(g.id)}
                            className="text-s112-muted hover:text-s112-blue-700 transition-colors text-xs leading-none"
                            title={isExpanded ? 'Maßnahmen-Verlauf ausblenden' : 'Maßnahmen-Verlauf einblenden'}
                          >
                            {isExpanded ? '▼' : '▶'}
                          </button>
                        ) : (
                          <span className="text-s112-tertiary text-xs">▶</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs font-medium">
                        {g.gst_nr}
                      </td>
                      <td className="px-3 py-2 text-s112-muted text-xs">
                        {g.rebsorte ?? '–'}
                        {g.weinart && g.weinart !== 'unbekannt' && (
                          <span className={`ml-1 inline-block px-1 py-0 rounded-full text-xs font-medium ${
                            g.weinart === 'rot' ? 'bg-s112-err-bg text-s112-err-fg' : 'bg-s112-warn-bg text-s112-warn-fg'
                          }`}>{g.weinart === 'rot' ? 'Rot' : 'Weiß'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {g.bewirtschaftung ? (
                          <span className={`inline-block px-1.5 py-0 rounded-full text-xs font-medium ${BEWIRTSCHAFTUNG_BADGE[g.bewirtschaftung] ?? 'bg-[#F2F3F5] text-s112-text-2'}`}>
                            {BEWIRTSCHAFTUNG_LABEL[g.bewirtschaftung] ?? g.bewirtschaftung}
                            {g.bewirtschaftung === 'in_umstellung' && g.bewirtschaftung_seit && (
                              <span className="ml-1 text-s112-text-2">seit {new Date(g.bewirtschaftung_seit).toLocaleDateString('de-AT', { month: '2-digit', year: 'numeric' })}</span>
                            )}
                          </span>
                        ) : <span className="text-s112-muted text-xs">–</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">{fmtHa(g.flaeche_ha)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs text-s112-muted">
                        {g.flaeche_ha_kataster != null ? fmtHa(g.flaeche_ha_kataster) : '–'}
                      </td>
                      <td className="px-3 py-2 text-right text-s112-muted text-xs">{g.pflanzjahr ?? '–'}</td>
                      <td className="px-3 py-2 text-center text-xs text-s112-muted" title={NUTZART_OPTIONS.find(o => o.value === g.nutzart)?.label ?? ''}>
                        {g.nutzart ?? '–'}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <NutzungBadge nutzart={g.nutzart} />
                        {g.nutzart === 'LSE' && g.lse_stueckzahl != null && (
                          <span className="block text-[11px] text-s112-muted mt-0.5">{g.lse_stueckzahl} Stk.</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right sticky right-0 bg-white border-l border-s112-border/40" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          {writeOk && (
                            <button onClick={() => { setEditId(g.id); setShowForm(false) }}
                              title="Bearbeiten" aria-label="Bearbeiten"
                              className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={14} /></button>
                          )}
                          {adminOk && (
                            <button onClick={() => handleDelete(g.id, g.gst_nr)}
                              title="Löschen" aria-label="Löschen"
                              className="text-s112-err hover:text-s112-err-fg"><Trash2 size={14} /></button>
                          )}
                        </div>
                      </td>
                    </tr>
                    {/* Maßnahmen-Verlauf aufgeklappt (Punkt 10) */}
                    {isExpanded && hasHistory && (
                      <tr className="border-b border-s112-border/50">
                        <td colSpan={10} className="p-0 divide-y divide-s112-border/50">
                          {massnahmen.length > 0 && <GstMassnahmenPanel massnahmen={massnahmen} />}
                        </td>
                      </tr>
                    )}
                    {/* Bearbeiten-Formular */}
                    {writeOk && editId === g.id && (
                      <tr>
                        <td colSpan={10} className="px-3 py-2">
                          <GSTForm weingartenId={weingartenId} gst={g} customWeinbaugebiete={eigeneWeinbaugebiete} onNeuesWeinbaugebiet={handleNeuesWeinbaugebiet} onDone={() => setEditId(null)} />
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="border border-dashed border-s112-border rounded-xl p-6 text-center text-sm text-s112-muted">
          Noch keine Grundstücke erfasst.
        </div>
      )}
    </div>
  )
}
