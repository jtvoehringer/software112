'use client'

// KAN-466: Tank mit Kammern anlegen bzw. die Stammdaten des Tanks bearbeiten. Befüllt werden die Kammern – jede ist ein
// eigenes Gebinde; Typ, Material und Standort pflegt man nur hier am Tank.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { hierBleiben, zielNachVorgang, zurueckZiel } from '@/lib/navigation/zurueckBrowser'
import { fehlerText } from '@/lib/fehler'
import { dezimal, fmtLiter } from '@/lib/format'
import { GEBINDE_MATERIALIEN, materialAusTyp } from '@/lib/keller/gebindeMaterial'
import { KAMMERN_MAX, KAMMERN_MIN, TANK_NAME_MAX, TANK_TYPEN, kammerVorschlag, tankEingabeFehler } from '@/lib/keller/tanks'

type TankRow = { id: string; name: string; typ: string; material: string | null; standort: string | null; notizen: string | null }
type Kammer = { name: string; volumen: string; gemeinsam: boolean; nameVonHand: boolean }

interface Props {
  /** vorhanden = Stammdaten des Tanks bearbeiten (Kammern bleiben, wie sie sind) */
  tank?: TankRow
  action: (formData: FormData) => Promise<void>
  /** Partnerbetriebe (Kellergemeinschaft) – zeigt je Kammer den Freigabe-Schalter; null = keine */
  partner?: string | null
}

const leereKammer = (): Kammer => ({ name: '', volumen: '', gemeinsam: true, nameVonHand: false })
const zahl = (s: string): number | null => { const t = dezimal(s); const n = t ? Number(t) : NaN; return Number.isFinite(n) ? n : null }

export default function TankForm({ tank, action, partner = null }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState(tank?.name ?? '')
  const [typ, setTyp] = useState(tank?.typ ?? 'stahltank')
  const [material, setMaterial] = useState(tank?.material ?? '')
  const [kammern, setKammern] = useState<Kammer[]>(() => [leereKammer(), leereKammer(), leereKammer()])

  // Namen der Kammern folgen dem Tank-Namen, solange sie nicht von Hand geändert wurden
  const kammerName = (k: Kammer, i: number) => k.nameVonHand ? k.name : kammerVorschlag(name, i + 1)
  const setzeAnzahl = (n: number) => setKammern(alt => n > alt.length ? [...alt, ...Array.from({ length: n - alt.length }, leereKammer)] : alt.slice(0, n))
  const aendere = (i: number, teil: Partial<Kammer>) => setKammern(alt => alt.map((k, j) => j === i ? { ...k, ...teil } : k))
  const summe = kammern.reduce((s, k) => s + (zahl(k.volumen) ?? 0), 0)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    if (!tank) {
      const f = tankEingabeFehler({ name, typ, kammern: kammern.map((k, i) => ({ name: kammerName(k, i), volumen_liter: zahl(k.volumen) })) })
      if (f) { setError(f); return }
    }
    setSaving(true)
    try {
      await action(new FormData(e.currentTarget))
      if (tank) router.replace(hierBleiben(), { scroll: false })
      else router.push(zielNachVorgang('/kellerbuch', 'gespeichert'))
      router.refresh()
    } catch (err) {
      setError(fehlerText(err, 'Fehler beim Speichern'))
    } finally {
      setSaving(false)
    }
  }

  // Reihenfolge am Bildschirm wie im Keller: oberste Kammer oben, Kammer 1 unten
  const reihenfolge = kammern.map((_, i) => i).reverse()

  return (
    <form data-ungespeichert onSubmit={handleSubmit} className="space-y-6">
      {error && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm"><strong>Fehler:</strong> {error}</div>}

      <div className="card space-y-4">
        <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Geteilter Tank</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="form-label" htmlFor="tank-name">Name *</label>
            <input id="tank-name" name="name" type="text" required maxLength={TANK_NAME_MAX} value={name} onChange={e => setName(e.target.value)} className="form-input" placeholder="z.B. A10" />
          </div>
          <div>
            <label className="form-label" htmlFor="tank-typ">Typ *</label>
            <select id="tank-typ" name="typ" required value={typ} onChange={e => setTyp(e.target.value)} className="form-input">
              {TANK_TYPEN.map(t => <option key={t.wert} value={t.wert}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label" htmlFor="tank-material">Material</label>
            <input id="tank-material" name="material" type="text" list="tank-materialien" maxLength={255} value={material} onChange={e => setMaterial(e.target.value)}
              className="form-input" placeholder={materialAusTyp(typ) ?? 'z.B. Edelstahl'} />
            <datalist id="tank-materialien">{GEBINDE_MATERIALIEN.map(m => <option key={m} value={m} />)}</datalist>
            <p className="text-xs text-s112-muted mt-1">Ohne Angabe gilt das Material des Typs{materialAusTyp(typ) ? ` (${materialAusTyp(typ)})` : ''}.</p>
          </div>
          <div>
            <label className="form-label" htmlFor="tank-standort">Standort</label>
            <input id="tank-standort" name="standort" type="text" maxLength={255} defaultValue={tank?.standort ?? ''} className="form-input" placeholder="z.B. Keller Süd" />
          </div>
          <div className="sm:col-span-2">
            <label className="form-label" htmlFor="tank-notizen">Notizen</label>
            <input id="tank-notizen" name="notizen" type="text" maxLength={2000} defaultValue={tank?.notizen ?? ''} className="form-input" />
          </div>
        </div>
        <p className="text-xs text-s112-muted">Typ, Material und Standort gelten für alle Kammern und werden nur hier am geteilten Tank geändert.</p>
      </div>

      {!tank && (
        <div className="card space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-s112-muted uppercase tracking-wider">Kammern</h2>
              <p className="text-xs text-s112-muted mt-1">Jede Kammer wird getrennt befüllt und ist ein eigenes Gebinde – auch im Gebindeverzeichnis.</p>
            </div>
            <div>
              <label className="form-label" htmlFor="tank-anzahl">Anzahl</label>
              <select id="tank-anzahl" name="kammern" value={kammern.length} onChange={e => setzeAnzahl(Number(e.target.value))} className="form-input w-24">
                {Array.from({ length: KAMMERN_MAX - KAMMERN_MIN + 1 }, (_, i) => i + KAMMERN_MIN).map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          {partner && <input type="hidden" name="gemeinsam_sichtbar" value="1" />}
          <div className="rounded-lg border border-s112-line divide-y divide-s112-line">
            {reihenfolge.map(i => {
              const k = kammern[i]
              const nr = i + 1
              return (
                <div key={i} className="flex flex-wrap items-end gap-3 px-3 py-3">
                  <span className="w-24 shrink-0 text-sm font-semibold text-s112-text pb-2">
                    Kammer {nr}
                    {nr === 1 && <span className="block text-[10.5px] font-normal text-s112-muted">unterste</span>}
                    {nr === kammern.length && <span className="block text-[10.5px] font-normal text-s112-muted">oberste</span>}
                  </span>
                  <div className="flex-1 min-w-40">
                    <label className="form-label" htmlFor={`kammer-${nr}-name`}>Name *</label>
                    <input id={`kammer-${nr}-name`} name={`kammer_${nr}_name`} type="text" required maxLength={TANK_NAME_MAX} value={kammerName(k, i)}
                      onChange={e => aendere(i, { name: e.target.value, nameVonHand: true })} className="form-input" />
                  </div>
                  <div className="w-36">
                    <label className="form-label" htmlFor={`kammer-${nr}-volumen`}>Volumen (Liter) *</label>
                    <input id={`kammer-${nr}-volumen`} name={`kammer_${nr}_volumen`} type="text" required inputMode="decimal" value={k.volumen}
                      onChange={e => aendere(i, { volumen: e.target.value })} className="form-input" placeholder="z.B. 2.000" />
                  </div>
                  {partner && (
                    <label className="flex items-center gap-2 cursor-pointer pb-2">
                      <input type="checkbox" name={`kammer_${nr}_gemeinsam`} value="true" checked={k.gemeinsam} onChange={e => aendere(i, { gemeinsam: e.target.checked })} className="w-4 h-4 accent-s112-teal" />
                      <span className="text-sm text-s112-text-1">für Partner freigegeben</span>
                    </label>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-sm text-s112-text-2">Fassungsvermögen des geteilten Tanks: <strong className="tabular-nums">{fmtLiter(summe)}</strong>{partner ? <span className="text-xs text-s112-muted"> · Partnerbetriebe: {partner}</span> : null}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className="bg-s112-teal text-s112-yellow px-6 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 transition-colors disabled:opacity-50">
          {saving ? 'Wird gespeichert …' : tank ? 'Speichern' : 'Geteilten Tank anlegen'}
        </button>
        <button type="button" onClick={() => router.push(zurueckZiel('/kellerbuch'))} className="text-sm text-s112-muted hover:text-s112-text-1 transition-colors">Abbrechen</button>
      </div>
    </form>
  )
}
