'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Info, AlertTriangle } from 'lucide-react'
import { QUALITAET_OPTS, mitGespeichertemWert } from '@/lib/wein/qualitaet'
import { normalisiereQualitaet, zusaetzeOhneAufwertung } from '@/lib/wein/qualitaetsrang'
import ZusatzErzeugnisFelder from '@/components/wein/ZusatzErzeugnisFelder'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum, dezimal } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import MostgewichtEingabe from '@/components/wein/MostgewichtEingabe'

const REBSORTEN = [
  'Grüner Veltliner','Riesling','Welschriesling','Müller-Thurgau',
  'Chardonnay','Sauvignon Blanc','Weißburgunder','Grauburgunder',
  'Zweigelt','Blaufränkisch','St. Laurent','Pinot Noir','Merlot',
]

type Row = { id: string; name: string }
type WeinausbauRow = {
  id: string; name: string; jahrgang: number | null; rebsorte: string | null
  weingarten_id: string | null; behaelter_id: string | null
  menge_liter: number | null; status: string; qualitaetsstufe: string | null
  /** KAN-186: Zusatzbezeichnung und Erzeugnis (Altwerte im Qualitätsfeld werden normalisiert) */
  zusatzbezeichnung?: string | null; erzeugnis?: string | null
  weinart?: string | null
  notizen: string | null; aktiv: boolean; einstandspreis_pro_liter: number | null
  /** KAN-130 Etappe 3: gespeichertes Mostgewicht (Messwert und Einheit) */
  kmw?: number | string | null; oechsle?: number | string | null; mostgewicht_einheit?: string | null
}

const WEINART_OPTS = [
  { value: 'weiss',    label: 'Weißwein' },
  { value: 'rot',      label: 'Rotwein' },
  { value: 'rose',     label: 'Rosé' },
  { value: 'unbekannt', label: 'Unbekannt' },
]

interface Props {
  weinausbau?: WeinausbauRow
  weingaerten: Row[]
  behaelter: Row[]
  selectedWeingaertenIds?: string[]
  action: (formData: FormData) => Promise<void>
  /** Maximale Qualitätsstufe (von der Lese). Upgrade über diesen Wert hinaus ist gesperrt. */
  maxQualitaetsstufe?: string | null
  /** Felder die aus der Pressung abgeleitet werden → gesperrt */
  vonPressung?: boolean
  /** KAN-35: Grund, warum das Gebinde nicht mehr direkt geändert werden kann (Folgebuchungen) → nur per Umzug */
  gebindeSperre?: string | null
  /** KAN-150 F1d: Folgebuchungen vorhanden → eine Änderung der Rieden braucht einen Grund (Text der Folgebuchungen) */
  herkunftGrundNoetig?: string | null
}

export default function WeinausbauForm({ weinausbau, weingaerten, behaelter, selectedWeingaertenIds = [], action, maxQualitaetsstufe, vonPressung = false, gebindeSperre = null, herkunftGrundNoetig = null }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [selWg, setSelWg] = useState<Set<string>>(new Set(selectedWeingaertenIds))
  const [wgOpen, setWgOpen] = useState(false)
  const herkunftGeaendert = selWg.size !== selectedWeingaertenIds.length || selectedWeingaertenIds.some(x => !selWg.has(x))

  function toggleWg(id: string) {
    setSelWg(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setSaving(true)
    const raw = new FormData(e.currentTarget)
    const normalized = new FormData()
    raw.forEach((value, key) => {
      if (key === 'einstandspreis_pro_liter' && typeof value === 'string') {
        normalized.append(key, dezimal(value))
      } else {
        normalized.append(key, value)
      }
    })
    try {
      await action(normalized)
      router.push('/kellerbuch')
      router.refresh()
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Speichern'))
      setSaving(false)
    }
  }

  const rdOnly = "form-input bg-s112-bg text-s112-text-2 cursor-not-allowed select-none"
  // KAN-186: Altwerte (reserve, sekt …) im Qualitätsfeld → Stufe + Zusatzbezeichnung/Erzeugnis
  const angabe = normalisiereQualitaet(weinausbau ?? null)
  const [stufe, setStufe] = useState<string>(angabe.stufe ?? maxQualitaetsstufe ?? '')

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {error}</div>}

      {vonPressung && (
        <div className="bg-s112-blue-50 border border-s112-blue-100 text-s112-blue-700 rounded-xl px-4 py-2.5 text-xs flex items-start gap-1.5">
          <Info size={14} strokeWidth={1.75} className="mt-0.5 shrink-0" />
          <span>Grau hinterlegte Felder werden aus der Pressung abgeleitet und können hier nicht geändert werden.</span>
        </div>
      )}

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Charge</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Bezeichnung *</label>
            <input aria-label="Bezeichnung" name="name" type="text" required defaultValue={weinausbau?.name ?? ''} className="form-input" placeholder="z.B. GV Kremser Schmidt 2025" />
          </div>
          <div>
            <label className="form-label">Jahrgang</label>
            {vonPressung ? (
              <>
                <input type="hidden" name="jahrgang" value={weinausbau?.jahrgang ?? ''} />
                <div className={rdOnly}>{weinausbau?.jahrgang ?? '–'}</div>
              </>
            ) : (
              <input name="jahrgang" type="number" min="1900" max="2100" defaultValue={weinausbau?.jahrgang ?? new Date().getFullYear()} className="form-input" />
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Rebsorte</label>
            {vonPressung ? (
              <>
                <input type="hidden" name="rebsorte" value={weinausbau?.rebsorte ?? ''} />
                <div className={rdOnly}>{formatRebsorteMitKuerzel(weinausbau?.rebsorte)}</div>
              </>
            ) : (
              <>
                <input name="rebsorte" type="text" list="rebsorten-kb" defaultValue={weinausbau?.rebsorte ?? ''} className="form-input" placeholder="Rebsorte" />
                <datalist id="rebsorten-kb">{REBSORTEN.map(r => <option key={r} value={r} />)}</datalist>
              </>
            )}
          </div>
          <div>
            <label className="form-label">Menge (Liter)</label>
            {/* KAN-35: Bestand nur anzeigen – geändert wird er ausschließlich über datierte
                Buchungen (Schwund buchen, Umzug, Füllung, Verkauf); das Formular sendet keine Menge. */}
            <div className={rdOnly}>
              {weinausbau?.menge_liter != null
                ? fmtNum(Number(weinausbau.menge_liter), { max: 2 })
                : '–'}
            </div>
            <p className="text-xs text-s112-muted mt-1">Korrektur über „Schwund buchen“ (datierte Buchung)</p>
          </div>
        </div>

        {/* Qualitätsstufe */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Qualitätsstufe</label>
            {vonPressung ? (
              <>
                <input type="hidden" name="qualitaetsstufe" value={angabe.stufe ?? ''} />
                <div className={rdOnly}>
                  {angabe.stufe
                    ? (QUALITAET_OPTS.find(o => o.value === angabe.stufe)?.label ?? angabe.stufe)
                    : '– noch nicht festgelegt –'}
                </div>
                <p className="text-xs text-s112-muted mt-1">Wird aus dem KMW-Wert der Pressung abgeleitet</p>
              </>
            ) : (
              (() => {
                const basisQ = angabe.stufe ?? maxQualitaetsstufe ?? null
                const maxRang = basisQ ? (QUALITAET_OPTS.find(o => o.value === basisQ)?.rang ?? 99) : 99
                // KAN-73: Charge = QUALITAET_OPTS (CHECK weinausbau); „Wein“ (Rang 0) lässt nur Wein
                // und Sonstiges zu. Ein gespeicherter Wert außerhalb der Liste bleibt sichtbar.
                const erlaubteOptionen = mitGespeichertemWert(
                  basisQ ? QUALITAET_OPTS.filter(o => o.rang <= maxRang) : QUALITAET_OPTS,
                  angabe.stufe,
                )
                return (
                  <>
                    <select name="qualitaetsstufe" value={stufe} onChange={e => setStufe(e.target.value)} className="form-input">
                      <option value="">– noch nicht festgelegt –</option>
                      {erlaubteOptionen.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                    {basisQ && (
                      <p className="text-xs text-s112-warn-fg mt-1 inline-flex items-center gap-1">
                        <AlertTriangle size={12} strokeWidth={2} />
                        Downgrade möglich · kein Upgrade über {QUALITAET_OPTS.find(o => o.value === basisQ)?.label ?? basisQ} hinaus
                      </p>
                    )}
                  </>
                )
              })()
            )}
          </div>
          <div>
            <label className="form-label">Status</label>
            <select aria-label="Status" name="status" defaultValue={weinausbau?.status ?? 'ernte'} className="form-input">
              <option value="ernte">Ernte</option>
              <option value="gaerung">Gärung</option>
              <option value="ausbau">Ausbau</option>
              <option value="abfuellung">Abfüllung</option>
              <option value="abgeschlossen">Abgeschlossen</option>
            </select>
          </div>
        </div>

        {/* KAN-186: Zusatzbezeichnung (Reserve …) und Erzeugnis (Sekt g.U., Perlwein …) – bestehende Charge: keine neue
            bzw. höhere Zusatzbezeichnung (Aufwertung, der Server lehnt sie ab) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <ZusatzErzeugnisFelder
            zusatz={angabe.zusatz}
            erzeugnis={angabe.erzeugnis}
            stufe={vonPressung ? angabe.stufe : stufe}
            erlaubteZusaetze={weinausbau && angabe.stufe ? zusaetzeOhneAufwertung(angabe.zusatz) : undefined}
          />
        </div>

        {/* Weinart */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Weinart</label>
            {vonPressung ? (
              <>
                <input type="hidden" name="weinart" value={weinausbau?.weinart ?? 'unbekannt'} />
                <div className={rdOnly}>
                  {WEINART_OPTS.find(o => o.value === (weinausbau?.weinart ?? 'unbekannt'))?.label ?? 'Unbekannt'}
                </div>
                <p className="text-xs text-s112-muted mt-1">Wird aus den Weingärten abgeleitet</p>
              </>
            ) : (
              <select name="weinart" defaultValue={weinausbau?.weinart ?? 'unbekannt'} className="form-input">
                {WEINART_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            )}
          </div>
          {/* KAN-130 Etappe 3 (02.10.2026, Entscheidung 3): optionales Mostgewicht in °KMW oder °Oe –
              bevorzugte Einheit des Betriebs zuerst, leer erlaubt. Auch bei Pressungs-Chargen änderbar
              (Entscheidung 2: Korrektur an der Charge im Kellerbuch). Die Qualitätsstufe bleibt davon
              unberührt (Rechenregel 6). */}
          <div>
            <MostgewichtEingabe
              key={weinausbau?.id ?? 'neu'}
              name="mostgewicht"
              label="Mostgewicht (optional)"
              startwert={weinausbau ? { kmw: weinausbau.kmw, oechsle: weinausbau.oechsle, einheit: weinausbau.mostgewicht_einheit } : null}
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label">Rieden / Weingärten</label>
            {vonPressung ? (
              <>
                {Array.from(selWg).map(id => (
                  <input key={id} type="hidden" name="weingarten_ids" value={id} />
                ))}
                <div className={rdOnly}>
                  {selWg.size === 0
                    ? '–'
                    : selWg.size === 1
                      ? weingaerten.find(w => selWg.has(w.id))?.name ?? '1 ausgewählt'
                      : `${selWg.size} ausgewählt`}
                </div>
              </>
            ) : (
              <>
                {Array.from(selWg).map(id => (
                  <input key={id} type="hidden" name="weingarten_ids" value={id} />
                ))}
                {weingaerten.length === 0 ? (
                  <p className="text-xs text-s112-muted italic mt-1">Keine Weingärten angelegt</p>
                ) : (
                  <div className="mt-1">
                    <button
                      type="button"
                      onClick={() => setWgOpen(o => !o)}
                      className="form-input w-full text-left flex items-center justify-between"
                    >
                      <span className="text-sm text-s112-text-1">
                        {selWg.size === 0
                          ? '– keine Auswahl –'
                          : selWg.size === 1
                            ? weingaerten.find(w => selWg.has(w.id))?.name ?? '1 ausgewählt'
                            : `${selWg.size} ausgewählt`}
                      </span>
                      <span className="text-s112-muted text-xs">{wgOpen ? '▲' : '▼'}</span>
                    </button>
                    {wgOpen && (
                      <div className="border border-s112-border border-t-0 rounded-b-xl divide-y divide-s112-border/40 max-h-48 overflow-y-auto shadow-sm">
                        {weingaerten.map(w => (
                          <label key={w.id} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-s112-bg/60 transition-colors">
                            <input
                              type="checkbox"
                              checked={selWg.has(w.id)}
                              onChange={() => toggleWg(w.id)}
                              className="w-4 h-4 accent-s112-teal shrink-0"
                            />
                            <span className="text-sm text-s112-text-1">{w.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {weinausbau && herkunftGeaendert && herkunftGrundNoetig && (
                  <div className="mt-2">
                    <label className="form-label" htmlFor="herkunft_grund">Grund der Herkunftsänderung *</label>
                    <textarea id="herkunft_grund" name="herkunft_grund" rows={2} required minLength={10}
                      className="form-input resize-none" placeholder="z. B. Ried bei der Lese falsch zugeordnet" />
                    <p className="text-xs text-s112-muted mt-1">
                      An der Charge {herkunftGrundNoetig} – die Änderung kommt mit Grund ins Änderungsprotokoll.
                    </p>
                  </div>
                )}
              </>
            )}
          </div>
          <div>
            <label className="form-label">Behälter</label>
            {vonPressung || gebindeSperre ? (
              <>
                <input type="hidden" name="behaelter_id" value={weinausbau?.behaelter_id ?? ''} />
                <div className={rdOnly}>
                  {behaelter.find(b => b.id === weinausbau?.behaelter_id)?.name ?? '–'}
                </div>
                {gebindeSperre && !vonPressung && (
                  <p className="text-xs text-s112-muted mt-1">{gebindeSperre}</p>
                )}
              </>
            ) : (
              <select name="behaelter_id" defaultValue={weinausbau?.behaelter_id ?? ''} className="form-input">
                <option value="">– kein Behälter –</option>
                {behaelter.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Lagerwert</h2>
        <div>
          <label className="form-label">Einstandspreis pro Liter (€)</label>
          <input aria-label="Einstandspreis pro Liter (€)" name="einstandspreis_pro_liter" type="text" inputMode="decimal"
            defaultValue={weinausbau?.einstandspreis_pro_liter?.toString().replace('.', ',') ?? ''}
            className="form-input" placeholder="z.B. 1,50" />
          <p className="text-xs text-s112-muted mt-1">Basis für die Lagerwert-Berechnung bei Tankware</p>
        </div>
      </div>

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Notizen</h2>
        <textarea name="notizen" rows={3} defaultValue={weinausbau?.notizen ?? ''} className="form-input resize-none" placeholder="Kellermeister-Notizen, Massnahmen …" />
      </div>

      {weinausbau && (
        <div className="card">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" name="aktiv" value="true" defaultChecked={weinausbau.aktiv} className="w-4 h-4 accent-s112-teal" />
            <span className="text-sm font-medium text-s112-text-1">Charge aktiv</span>
          </label>
          {weinausbau.aktiv && Number(weinausbau.menge_liter ?? 0) > 0.01 && (
            <p className="text-xs text-s112-muted mt-1.5">
              Deaktivieren bzw. „Abgeschlossen“ ist erst bei leerer Charge möglich – den Wein zuerst abfüllen,
              umziehen, verkaufen oder als Schwund buchen (bei 0 L wird die Charge automatisch abgeschlossen).
            </p>
          )}
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors disabled:opacity-50">
          {saving ? 'Wird gespeichert …' : 'Speichern'}
        </button>
        <button type="button" onClick={() => router.push('/kellerbuch')} className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors">Abbrechen</button>
      </div>
    </form>
  )
}
