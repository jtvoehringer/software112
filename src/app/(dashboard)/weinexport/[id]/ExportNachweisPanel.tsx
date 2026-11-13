'use client'
// KAN-440 Teil 2 (13.11.2026): Ausfuhr- bzw. Gelangensnachweis am Exportauftrag – Angaben zur Ausfuhranmeldung (MRN,
// Datum), Belege als Datei (mehrere je Auftrag) und der Stand der Frist. Ab „Abgeschlossen“ und bei stornierten
// Aufträgen nur noch lesbar (dieselbe Sperre in der Datenbank).
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import {
  NACHWEIS_ARTEN, NACHWEIS_ACCEPT, nachweisArtenFuer, nachweisDateiFehler, nachweisEingabeFehler, nachweisName,
  ausfuhranmeldungFehler, mrnBereinigt, type NachweisFrist, type NachweisGebiet,
} from '@/lib/export/nachweise'

export type ExportNachweis = { id: string; art: string; datum: string; dateiname: string; notiz: string | null }

type Props = {
  auftragId: string
  gebiet: NachweisGebiet
  nachweise: ExportNachweis[]
  frist: NachweisFrist
  mrn: string | null
  anmeldungDatum: string | null
  mustersendung: boolean
  /** Schreibrecht und Auftrag weder abgeschlossen noch storniert */
  darfAendern: boolean
  /** warum nichts mehr geändert werden kann (abgeschlossen, storniert) – null, wenn nur das Schreibrecht fehlt */
  gesperrtGrund: string | null
  /** heutiger Kalendertag in Wien (JJJJ-MM-TT) */
  heute: string
}

const at = (d: string) => (/^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10).split('-').reverse().join('.') : d)
const FARBE: Record<string, string> = {
  erledigt: 'bg-s112-ok-bg text-s112-ok-fg', ohne: 'bg-[#F2F3F5] text-s112-text-1', offen: 'bg-s112-blue-50 text-s112-blue-700',
  hinweis: 'bg-s112-warn-bg text-s112-warn-fg', warnung: 'bg-s112-warn-bg text-s112-warn-fg', ueberfaellig: 'bg-s112-err-bg text-s112-err-fg',
}

export default function ExportNachweisPanel({ auftragId, gebiet, nachweise, frist, mrn, anmeldungDatum, mustersendung, darfAendern, gesperrtGrund, heute }: Props) {
  const router = useRouter()
  const arten = nachweisArtenFuer(gebiet)
  const [art, setArt] = useState<string>(arten[0])
  const [datum, setDatum] = useState(heute)
  const [notiz, setNotiz] = useState('')
  const [mrnWert, setMrnWert] = useState(mrn ?? '')
  const [anmWert, setAnmWert] = useState(anmeldungDatum ?? '')
  const [laeuft, setLaeuft] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const dateiFeld = useRef<HTMLInputElement>(null)
  const name = nachweisName(gebiet)

  async function hochladen(e: React.FormEvent) {
    e.preventDefault()
    const datei = dateiFeld.current?.files?.[0] ?? null
    const f = nachweisEingabeFehler({ art, datum, notiz }, heute) ?? nachweisDateiFehler(datei)
    if (f || !datei) { setFehler(f ?? 'Bitte den Beleg als Datei wählen.'); return }
    setLaeuft(true)
    try {
      setFehler(null)
      const form = new FormData()
      form.set('datei', datei); form.set('art', art); form.set('datum', datum); form.set('notiz', notiz)
      const res = await fetch(`/api/weinexport/${auftragId}/nachweis`, { method: 'POST', body: form })
      if (!res.ok) { setFehler((await res.json().catch(() => null))?.fehler ?? `Der Beleg konnte nicht gespeichert werden (Status ${res.status}).`); return }
      setNotiz('')
      if (dateiFeld.current) dateiFeld.current.value = ''
      zeigeErfolg('Nachweis gespeichert.')
      router.refresh()
    } catch {
      setFehler('Der Beleg konnte nicht gespeichert werden – bitte die Verbindung prüfen.')
    } finally {
      setLaeuft(false)
    }
  }

  async function entfernen(n: ExportNachweis) {
    if (!(await rueckfrage({ titel: 'Nachweis entfernen?', text: `${NACHWEIS_ARTEN[n.art as keyof typeof NACHWEIS_ARTEN] ?? n.art} vom ${at(n.datum)} („${n.dateiname}“) wird samt Datei entfernt.`, bestaetigen: 'Entfernen', gefaehrlich: true }))) return
    setLaeuft(true)
    try {
      setFehler(null)
      const res = await fetch(`/api/weinexport/${auftragId}/nachweis/${n.id}`, { method: 'DELETE' })
      if (!res.ok) { setFehler((await res.json().catch(() => null))?.fehler ?? `Der Nachweis konnte nicht entfernt werden (Status ${res.status}).`); return }
      zeigeErfolg('Nachweis entfernt.')
      router.refresh()
    } catch {
      setFehler('Der Nachweis konnte nicht entfernt werden – bitte die Verbindung prüfen.')
    } finally {
      setLaeuft(false)
    }
  }

  async function anmeldungSpeichern(e: React.FormEvent) {
    e.preventDefault()
    const f = ausfuhranmeldungFehler({ mrn: mrnWert, datum: anmWert }, heute)
    if (f) { setFehler(f); return }
    setLaeuft(true)
    try {
      setFehler(null)
      const res = await fetch(`/api/weinexport/${auftragId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ausfuhr_mrn: mrnBereinigt(mrnWert) || null, ausfuhr_anmeldung_datum: anmWert || null }),
      })
      if (!res.ok) { setFehler((await res.json().catch(() => null))?.fehler ?? `Die Angaben konnten nicht gespeichert werden (Status ${res.status}).`); return }
      zeigeErfolg('Ausfuhranmeldung gespeichert.')
      router.refresh()
    } catch {
      setFehler('Die Angaben konnten nicht gespeichert werden – bitte die Verbindung prüfen.')
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <section className="bg-white rounded-xl border border-s112-border p-5 mt-6" data-export-nachweis>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <h2 className="font-semibold text-s112-text">{name}</h2>
        {frist.stufe !== 'keine' && (
          <span role={frist.stufe === 'ueberfaellig' || frist.stufe === 'warnung' ? 'alert' : 'status'} data-nachweis-stufe={frist.stufe}
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${FARBE[frist.stufe] ?? ''}`}>{frist.text}</span>
        )}
      </div>
      <p className="text-sm text-s112-muted mt-1">
        {mustersendung
          ? 'Mustersendung: Ein Nachweis kann abgelegt werden, eine Frist läuft nicht.'
          : gebiet === 'eu'
            ? 'Beleg dafür, dass die Ware beim Abnehmer im anderen Mitgliedstaat angekommen ist – Voraussetzung der steuerfreien innergemeinschaftlichen Lieferung.'
            : gebiet === 'drittland'
              ? 'Beleg dafür, dass die Ware die EU verlassen hat – Voraussetzung der steuerfreien Ausfuhrlieferung (Nachweis binnen 6 Monaten).'
              : 'Belege zum Versand der Ware.'}
      </p>
      {gesperrtGrund && <p className="text-sm text-s112-muted mt-2">{gesperrtGrund}</p>}

      {gebiet !== 'eu' && (
        <form onSubmit={anmeldungSpeichern} className="mt-4 grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 items-end">
          <div>
            <label htmlFor="export-mrn" className="block text-xs font-medium text-s112-text-2 mb-1">MRN der Ausfuhranmeldung</label>
            <input id="export-mrn" value={mrnWert} onChange={e => setMrnWert(e.target.value)} disabled={!darfAendern || laeuft} maxLength={24}
              placeholder="18 Zeichen, z. B. 26AT100000ABCDEFG1" className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm font-mono disabled:bg-s112-bg" />
          </div>
          <div>
            <label htmlFor="export-anmeldung-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum der Ausfuhranmeldung</label>
            <input id="export-anmeldung-datum" type="date" value={anmWert} max={heute} onChange={e => setAnmWert(e.target.value)} disabled={!darfAendern || laeuft}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm disabled:bg-s112-bg" />
          </div>
          {darfAendern && (
            <button type="submit" disabled={laeuft} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm text-s112-text-1 hover:bg-s112-bg disabled:opacity-50">Speichern</button>
          )}
        </form>
      )}

      <h3 className="text-sm font-medium text-s112-text-1 mt-5 mb-2">Belege</h3>
      {nachweise.length === 0 ? (
        <p className="text-sm text-s112-muted">Noch kein Nachweis abgelegt.</p>
      ) : (
        <ul className="divide-y divide-s112-border/40 border border-s112-border/60 rounded-lg">
          {nachweise.map(n => (
            <li key={n.id} className="px-3 py-2 flex items-center justify-between gap-3 text-sm flex-wrap">
              <div className="min-w-0">
                <span className="font-medium text-s112-text-1">{NACHWEIS_ARTEN[n.art as keyof typeof NACHWEIS_ARTEN] ?? n.art}</span>
                <span className="text-s112-muted"> · {at(n.datum)}</span>
                {n.notiz && <span className="text-s112-muted"> · {n.notiz}</span>}
              </div>
              <div className="flex items-center gap-3">
                <a href={`/api/weinexport/${auftragId}/nachweis/${n.id}`} target="_blank" rel="noopener noreferrer"
                  className="text-s112-blue-700 hover:underline break-all">{n.dateiname}</a>
                {darfAendern && (
                  <button type="button" onClick={() => void entfernen(n)} disabled={laeuft} className="text-s112-err hover:underline disabled:opacity-50">Entfernen</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {darfAendern && (
        <form onSubmit={hochladen} className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="export-nachweis-art" className="block text-xs font-medium text-s112-text-2 mb-1">Art des Nachweises</label>
            <select id="export-nachweis-art" value={art} onChange={e => setArt(e.target.value)} disabled={laeuft}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm">
              {arten.map(a => <option key={a} value={a}>{NACHWEIS_ARTEN[a]}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="export-nachweis-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum des Nachweises</label>
            <input id="export-nachweis-datum" type="date" value={datum} max={heute} onChange={e => setDatum(e.target.value)} disabled={laeuft}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div>
            <label htmlFor="export-nachweis-datei" className="block text-xs font-medium text-s112-text-2 mb-1">Beleg (PDF, JPEG, PNG oder WebP, höchstens 4 MB)</label>
            <input id="export-nachweis-datei" ref={dateiFeld} type="file" accept={NACHWEIS_ACCEPT} disabled={laeuft} className="w-full text-sm" />
          </div>
          <div>
            <label htmlFor="export-nachweis-notiz" className="block text-xs font-medium text-s112-text-2 mb-1">Notiz (optional)</label>
            <input id="export-nachweis-notiz" value={notiz} onChange={e => setNotiz(e.target.value)} maxLength={400} disabled={laeuft}
              className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm" />
          </div>
          <div className="sm:col-span-2 flex justify-end">
            <button type="submit" disabled={laeuft} className="bg-s112-teal text-s112-yellow rounded-lg px-4 py-1.5 text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
              {laeuft ? 'Speichert …' : 'Nachweis speichern'}
            </button>
          </div>
        </form>
      )}
      {fehler && <div role="alert" className="mt-3 bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 text-sm text-s112-err">{fehler}</div>}
    </section>
  )
}
