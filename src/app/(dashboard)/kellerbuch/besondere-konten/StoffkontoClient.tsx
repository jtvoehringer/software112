'use client'

// ── Besondere Konten – Formulare und Kontoauszug (KAN-107, 07.10.2026) ──
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'
import { fehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { KONTO_ART_LABEL, STOFF_ARTEN, type AuszugZeile, type StoffArt } from '@/lib/kellerbuch/stoffkonto'
import { kontoBuchen, kontoStornieren, stoffAktivSetzen, stoffAnlegen, stoffArtSetzen } from './actions'

const inp = 'form-input text-sm'

export function StoffAnlegen() {
  const router = useRouter()
  const [fehler, setFehler] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={e => {
      e.preventDefault()
      const fd = new FormData(e.currentTarget)
      const form = e.currentTarget
      setFehler(null)
      start(async () => {
        try { await stoffAnlegen(fd); form.reset(); router.refresh() } catch (err) { setFehler(fehlerText(err, 'Stoff konnte nicht angelegt werden')) }
      })
    }}>
      <label className="text-xs text-s112-text-2">Neuer Stoff
        <input name="name" required maxLength={80} placeholder="z. B. Saccharose, RTK, Weinsäure" className={`${inp} block`} />
      </label>
      <label className="text-xs text-s112-text-2">Einheit
        <select name="einheit" defaultValue="kg" className={`${inp} block`}><option value="kg">kg</option><option value="l">l</option></select>
      </label>
      <label className="text-xs text-s112-text-2">Art
        <select name="art" required defaultValue="" className={`${inp} block`}>
          <option value="" disabled>– bitte wählen –</option>
          {STOFF_ARTEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
        </select>
      </label>
      <button disabled={pending} className="px-3 py-2 rounded-lg text-sm font-semibold bg-s112-teal text-s112-yellow disabled:opacity-50">Anlegen</button>
      {fehler && <p role="alert" className="basis-full text-sm text-s112-err-fg">{fehler}</p>}
    </form>
  )
}

/** KAN-45: Art des Stoffs (für das BKI-Blatt und die KTM/RTK-Bestände der BSM) */
export function StoffArtWahl({ id, art, name }: { id: string; art: StoffArt; name: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)   // KAN-359: Fehler an der Auswahl statt Browser-Dialog (span – steht in einer Inline-Zeile)
  return (
    <>
      <select aria-label={`Art von ${name}`} value={art} disabled={pending} className="form-input w-auto! text-xs py-0.5"
        onChange={e => { const neu = e.target.value; setFehler(null); start(async () => { try { await stoffArtSetzen(id, neu); router.refresh() } catch (err) { setFehler(fehlerText(err, 'Art konnte nicht geändert werden')) } }) }}>
        {STOFF_ARTEN.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
      </select>
      {fehler && <span role="alert" className="text-xs text-s112-err-fg">{fehler}</span>}
    </>
  )
}

export function StoffAktiv({ id, aktiv }: { id: string; aktiv: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)   // KAN-359: Fehler am Knopf statt Browser-Dialog
  return (
    <>
      <button type="button" disabled={pending} className="text-xs text-s112-blue-700 hover:underline disabled:opacity-50"
        onClick={() => { setFehler(null); start(async () => { try { await stoffAktivSetzen(id, !aktiv); router.refresh() } catch (e) { setFehler(fehlerText(e, aktiv ? 'Deaktivieren fehlgeschlagen' : 'Aktivieren fehlgeschlagen')) } }) }}>
        {aktiv ? 'deaktivieren' : 'aktivieren'}
      </button>
      {fehler && <span role="alert" className="text-xs text-s112-err-fg">{fehler}</span>}
    </>
  )
}

export function KontoBuchen({ kellermittelId, einheit }: { kellermittelId: string; einheit: string }) {
  const router = useRouter()
  const [art, setArt] = useState<'zugang' | 'anfangsbestand' | 'inventur'>('zugang')
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [pending, start] = useTransition()
  return (
    <form className="card p-4 grid grid-cols-2 md:grid-cols-6 gap-2 items-end" onSubmit={e => {
      e.preventDefault()
      const fd = new FormData(e.currentTarget)
      const form = e.currentTarget
      fd.set('kellermittel_id', kellermittelId)
      setFehler(null); setHinweis(null)
      start(async () => {
        try { const r = await kontoBuchen(fd); setHinweis(r.hinweis ?? 'Gebucht.'); form.reset(); setArt('zugang'); router.refresh() }
        catch (err) { setFehler(fehlerText(err, 'Buchung fehlgeschlagen')) }
      })
    }}>
      <label className="text-xs text-s112-text-2">Buchung
        <select name="art" value={art} onChange={e => setArt(e.target.value as typeof art)} className={`${inp} block w-full`}>
          <option value="zugang">Zugang</option><option value="anfangsbestand">Anfangsbestand</option><option value="inventur">Inventur (Ist-Bestand)</option>
        </select>
      </label>
      <label className="text-xs text-s112-text-2">Datum
        <input name="datum" type="date" required defaultValue={wienHeute()} max={wienHeute()} className={`${inp} block w-full`} />
      </label>
      <label className="text-xs text-s112-text-2">{art === 'inventur' ? `Ist-Bestand (${einheit})` : `Menge (${einheit})`}
        <input name="menge" inputMode="decimal" required className={`${inp} block w-full`} />
      </label>
      {art === 'zugang' && (<>
        <label className="text-xs text-s112-text-2">Lieferant<input name="lieferant" className={`${inp} block w-full`} /></label>
        <label className="text-xs text-s112-text-2">Beleg<input name="beleg" className={`${inp} block w-full`} /></label>
        <label className="text-xs text-s112-text-2">Los<input name="los" className={`${inp} block w-full`} /></label>
      </>)}
      {art !== 'zugang' && <label className="text-xs text-s112-text-2 md:col-span-3">Notiz<input name="notizen" className={`${inp} block w-full`} /></label>}
      <button disabled={pending} className="px-3 py-2 rounded-lg text-sm font-semibold bg-s112-teal text-s112-yellow disabled:opacity-50">Buchen</button>
      {fehler && <p role="alert" className="col-span-full text-sm text-s112-err-fg">{fehler}</p>}
      {hinweis && <p role="status" className="col-span-full text-sm text-s112-ok-fg">{hinweis}</p>}
    </form>
  )
}

const datumDe = (d: string) => d.split('-').reverse().join('.')

export function Kontoauszug({ zeilen, einheit, schreiben }: { zeilen: AuszugZeile[]; einheit: string; schreiben: boolean }) {
  const router = useRouter()
  const th = 'px-3 py-2 text-left text-xs font-medium text-s112-text-2'
  const td = 'px-3 py-1.5 text-sm align-top'
  if (zeilen.length === 0) return <p className="text-sm text-s112-muted">Noch keine Buchungen.</p>
  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full">
        <thead><tr className="border-b border-s112-border">
          <th className={th}>Datum</th><th className={th}>Buchung</th><th className={`${th} text-right`}>Menge ({einheit})</th>
          <th className={`${th} text-right`}>Saldo</th><th className={th}>Lieferant / Beleg / Los</th><th className={th}>Charge · Behälter · Zweck</th>
          <th className={th}>Erfasst</th>{schreiben && <th className={th} />}
        </tr></thead>
        <tbody>
          {zeilen.map(z => (
            <tr key={z.id} className={`border-b border-s112-border/60 ${z.storniert ? 'opacity-60 line-through' : ''}`}>
              <td className={`${td} whitespace-nowrap`}>{datumDe(z.datum)}</td>
              <td className={td}>{KONTO_ART_LABEL[z.art]}{z.notizen ? <span className="block text-xs text-s112-muted no-underline">{z.notizen}</span> : null}</td>
              <td className={`${td} text-right tabular-nums ${z.menge < 0 ? 'text-s112-err-fg' : ''}`}>{z.menge > 0 ? '+' : ''}{fmtNum(z.menge, { max: 3 })}</td>
              <td className={`${td} text-right tabular-nums font-medium ${z.saldo < 0 ? 'text-s112-err-fg' : ''}`}>{fmtNum(z.saldo, { max: 3 })}</td>
              <td className={td}>{[z.lieferant, z.beleg, z.los ? `Los ${z.los}` : null].filter(Boolean).join(' · ') || '–'}</td>
              <td className={td}>{[z.charge, z.behaelter, z.zweck].filter(Boolean).join(' · ') || '–'}</td>
              <td className={`${td} text-xs text-s112-muted`}>{z.erstellt_von_name ?? '–'}</td>
              {schreiben && (
                <td className={`${td} text-right`}>
                  {!z.storniert && z.art !== 'storno' && (
                    <StornoButton action={async grund => { await kontoStornieren(z.id, grund); router.refresh() }}
                      hinweis="Die Buchung bleibt stehen; eine Gegenbuchung am heutigen Tag hebt sie auf (append-only)." />
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
