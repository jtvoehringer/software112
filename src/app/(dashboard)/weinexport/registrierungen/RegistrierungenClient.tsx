'use client'
// KAN-437 Teil 2: Liste und Formular der Export-Registrierungen (FDA mit US-Agent, GACC, MFDS, Ermächtigter Ausführer, sonstige)
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import {
  REGISTRIERUNG_ARTEN, istRegistrierungArt, registrierungEingabeFehler, registrierungName, registrierungStand,
  type Registrierung, type RegistrierungArt,
} from '@/lib/export/registrierungen'
import { speichereRegistrierung, entferneRegistrierung } from './actions'

const FARBE: Record<string, string> = {
  gueltig: 'bg-s112-ok-bg text-s112-ok-fg', ohne_ablauf: 'bg-[#F2F3F5] text-s112-text-1',
  laeuft_ab: 'bg-s112-warn-bg text-s112-warn-fg', abgelaufen: 'bg-s112-err-bg text-s112-err-fg',
}
const LEER = { id: null as string | null, art: 'fda' as string, bezeichnung: '', nummer: '', gueltig_bis: '', zusatz: '', notiz: '' }

export default function RegistrierungenClient({ liste, darfSchreiben, heute }: { liste: Registrierung[]; darfSchreiben: boolean; heute: string }) {
  const router = useRouter()
  const [f, setF] = useState(LEER)
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const art = istRegistrierungArt(f.art) ? REGISTRIERUNG_ARTEN[f.art as RegistrierungArt] : REGISTRIERUNG_ARTEN.sonstige
  const setze = (k: keyof typeof LEER) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF(alt => ({ ...alt, [k]: e.target.value }))

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    const ef = registrierungEingabeFehler(f)
    if (ef) { setFehler(ef); return }
    setLaeuft(true)
    try {
      setFehler(null)
      const res = await speichereRegistrierung(f)
      if (res.error) { setFehler(res.error); return }
      setF(LEER)
      zeigeErfolg('Registrierung gespeichert.')
      router.refresh()
    } catch {
      setFehler('Die Registrierung konnte nicht gespeichert werden – bitte die Verbindung prüfen.')
    } finally {
      setLaeuft(false)
    }
  }

  async function entfernen(r: Registrierung) {
    if (!(await rueckfrage({ titel: 'Registrierung entfernen?', text: `${registrierungName(r)} Nr. ${r.nummer} wird entfernt.`, bestaetigen: 'Entfernen', gefaehrlich: true }))) return
    setLaeuft(true)
    try {
      setFehler(null)
      const res = await entferneRegistrierung(r.id)
      if (res.error) { setFehler(res.error); return }
      if (f.id === r.id) setF(LEER)
      zeigeErfolg('Registrierung entfernt.')
      router.refresh()
    } catch {
      setFehler('Die Registrierung konnte nicht entfernt werden – bitte die Verbindung prüfen.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="space-y-6">
      {liste.length === 0 ? (
        <p className="text-sm text-s112-muted">Noch keine Registrierung hinterlegt.</p>
      ) : (
        <div className="bg-white rounded-xl border border-s112-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-s112-bg text-xs text-s112-muted uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Registrierung</th>
                <th className="px-4 py-3 text-left">Nummer</th>
                <th className="px-4 py-3 text-left">Gültigkeit</th>
                <th className="px-4 py-3 text-left">Zusatz / Notiz</th>
                {darfSchreiben && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border/40">
              {liste.map(r => {
                const s = registrierungStand(r, heute)
                return (
                  <tr key={r.id} data-registrierung={r.art}>
                    <td className="px-4 py-3 font-medium text-s112-text-1">{registrierungName(r)}</td>
                    <td className="px-4 py-3 font-mono text-[13px]">{r.nummer}</td>
                    <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${FARBE[s.stufe]}`} data-stufe={s.stufe}>{s.text}</span></td>
                    <td className="px-4 py-3 text-s112-text-2">{[r.zusatz, r.notiz].filter(Boolean).join(' · ') || '–'}</td>
                    {darfSchreiben && (
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <button type="button" disabled={laeuft} className="text-s112-blue-700 hover:underline mr-3 disabled:opacity-50"
                          onClick={() => { setFehler(null); setF({ id: r.id, art: r.art, bezeichnung: r.bezeichnung ?? '', nummer: r.nummer, gueltig_bis: r.gueltig_bis ?? '', zusatz: r.zusatz ?? '', notiz: r.notiz ?? '' }) }}>Bearbeiten</button>
                        <button type="button" disabled={laeuft} className="text-s112-err hover:underline disabled:opacity-50" onClick={() => void entfernen(r)}>Entfernen</button>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {darfSchreiben && (
        <form onSubmit={speichern} className="bg-white rounded-xl border border-s112-border p-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <h2 className="sm:col-span-2 font-semibold text-s112-text">{f.id ? 'Registrierung bearbeiten' : 'Registrierung hinzufügen'}</h2>
          <div>
            <label htmlFor="reg-art" className="block text-xs font-medium text-s112-text-2 mb-1">Art</label>
            <select id="reg-art" value={f.art} onChange={setze('art')} disabled={laeuft} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm">
              {(Object.keys(REGISTRIERUNG_ARTEN) as RegistrierungArt[]).map(a => <option key={a} value={a}>{REGISTRIERUNG_ARTEN[a].name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="reg-nummer" className="block text-xs font-medium text-s112-text-2 mb-1">Nummer</label>
            <input id="reg-nummer" value={f.nummer} onChange={setze('nummer')} maxLength={60} disabled={laeuft} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono" />
          </div>
          {f.art === 'sonstige' && (
            <div className="sm:col-span-2">
              <label htmlFor="reg-bezeichnung" className="block text-xs font-medium text-s112-text-2 mb-1">Bezeichnung (Behörde und Land)</label>
              <input id="reg-bezeichnung" value={f.bezeichnung} onChange={setze('bezeichnung')} maxLength={120} disabled={laeuft} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm" />
            </div>
          )}
          <div>
            <label htmlFor="reg-bis" className="block text-xs font-medium text-s112-text-2 mb-1">Gültig bis (leer = ohne Ablaufdatum)</label>
            <input id="reg-bis" type="date" value={f.gueltig_bis} onChange={setze('gueltig_bis')} disabled={laeuft} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="reg-zusatz" className="block text-xs font-medium text-s112-text-2 mb-1">{art.zusatz ?? 'Zusatz'} (optional)</label>
            <input id="reg-zusatz" value={f.zusatz} onChange={setze('zusatz')} maxLength={200} disabled={laeuft} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="reg-notiz" className="block text-xs font-medium text-s112-text-2 mb-1">Notiz (optional)</label>
            <input id="reg-notiz" value={f.notiz} onChange={setze('notiz')} maxLength={400} disabled={laeuft} className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            {f.id && <button type="button" disabled={laeuft} onClick={() => { setF(LEER); setFehler(null) }} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm">Abbrechen</button>}
            <button type="submit" disabled={laeuft} className="bg-s112-teal text-s112-yellow rounded-lg px-4 py-1.5 text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
              {laeuft ? 'Speichert …' : 'Speichern'}
            </button>
          </div>
          {fehler && <div role="alert" className="sm:col-span-2 bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 text-sm text-s112-err">{fehler}</div>}
        </form>
      )}
      {!darfSchreiben && fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 text-sm text-s112-err">{fehler}</div>}
    </div>
  )
}
