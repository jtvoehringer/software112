'use client'

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { useEffect, useState } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import StornoButton from '@/components/StornoButton'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'
import { createKellerbehandlung, deleteKellerbehandlung } from '../../kellerbuch/actions'
import { ladeMassnahmenDerMaische } from '@/lib/kellerbuch/maischeMassnahmen'
import { maischeMassnahmeFehler } from '@/lib/wein/maischeAnteile'
import { heuteWien } from '@/lib/datum/wien'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'

type R = Record<string, any>

// KAN-481 (BKI-Sitzung 16.11.2026): Maßnahmen an der Maische – dieselben Behandlungstypen wie die Kellerbehandlung, samt
// Stoffkonto. Erfasst wird bei der Maische (Lese › Pressungen); die Chargen, die beim Abpressen entstehen, zeigen die
// Maßnahmen anteilig nach Litern (Behandlungsliste, Weinbuch, Meldung „Kellerbehandlungen“).
export default function MaischeMassnahmen({ pressungId, nummer, beginn, offen, pressdatum, schreiben }: {
  pressungId: string; nummer: string | null; beginn: string; offen: boolean; pressdatum: string; schreiben: boolean
}) {
  const supabase = createSupabaseBrowserClient()
  const [auf, setAuf] = useState(false)
  const [laedt, setLaedt] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [zeilen, setZeilen] = useState<R[] | null>(null)
  const [typen, setTypen] = useState<R[]>([])
  const [stoffe, setStoffe] = useState<R[]>([])
  const [form, setForm] = useState(false)
  const [speichert, setSpeichert] = useState(false)
  // Formular
  const [datum, setDatum] = useState(offen ? heuteWien() : pressdatum)
  const [typId, setTypId] = useState('')
  const [menge, setMenge] = useState('')
  const [einheit, setEinheit] = useState('')
  const [stoffId, setStoffId] = useState('')
  const [stoffMenge, setStoffMenge] = useState('')
  const [notizen, setNotizen] = useState('')

  async function laden() {
    setLaedt(true)
    setFehler(null)
    try {
      const res = await fetch('/api/me/active-tenant')
      if (!res.ok) { setFehler('Der aktive Betrieb konnte nicht ermittelt werden – bitte die Seite neu laden.'); return }
      const tenantId = ((await res.json())?.tenantId as string | undefined) ?? null
      if (!tenantId) { setFehler('Kein aktiver Betrieb.'); return }
      const [liste, t, s] = await Promise.all([
        ladeMassnahmenDerMaische(supabase, tenantId, pressungId),
        // alle-ausnahme: Stammdaten-Auswahl der Behandlungstypen des Betriebs, wenige
        (supabase.from('keller_behandlungstypen') as any).select('id, name, einheit_standard, gebindepflege').eq('tenant_id', tenantId).order('sort_order').order('name').order('id'),
        // alle-ausnahme: Stammdaten-Auswahl der aktiven Stoffe des Betriebs, wenige
        (supabase.from('kellermittel') as any).select('id, name, einheit').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id'),
      ])
      if (liste.error !== null) { setFehler(liste.error); return }
      if (t.error) { setFehler(fehlerText(t.error, 'Behandlungstypen konnten nicht geladen werden')); return }
      if (s.error) { setFehler(fehlerText(s.error, 'Stoffe konnten nicht geladen werden')); return }
      setZeilen(liste.data)
      // an der Maische wird der Wein behandelt – die Typen der Gebindepflege (Reinigen, Notiz …) gehören ans Gebinde
      setTypen(((t.data ?? []) as R[]).filter(x => x.gebindepflege !== true))
      setStoffe((s.data ?? []) as R[])
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaedt(false)
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- laden beim Aufklappen bzw. Wechsel der Maische
  useEffect(() => { if (auf) laden() }, [auf, pressungId])

  function typGewaehlt(id: string) {
    setTypId(id)
    const t = typen.find(x => x.id === id)
    setEinheit((t?.einheit_standard as string | null) ?? '')
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    const f = maischeMassnahmeFehler({ beginn, offen, pressdatum, storniert: false, datum })
    if (f) { setFehler(f); return }
    if (!typId) { setFehler('Bitte eine Behandlung wählen.'); return }
    setSpeichert(true)
    setFehler(null)
    try {
      const fd = new FormData()
      fd.set('pressung_id', pressungId)
      fd.set('datum', datum)
      fd.set('typ_id', typId)
      if (menge) fd.set('menge', menge)
      if (einheit) fd.set('einheit', einheit)
      if (stoffId) { fd.set('kellermittel_id', stoffId); fd.set('kellermittel_menge', stoffMenge) }
      if (notizen) fd.set('notizen', notizen)
      await createKellerbehandlung(fd)
      zeigeErfolg(`Maßnahme an der Maische${nummer ? ` ${nummer}` : ''} gespeichert.`)
      setForm(false); setTypId(''); setMenge(''); setEinheit(''); setStoffId(''); setStoffMenge(''); setNotizen('')
      await laden()
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      setSpeichert(false)
    }
  }

  const inp = 'w-full border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-hidden'
  const tt = (d: string) => String(d ?? '').slice(0, 10).split('-').reverse().join('.')
  const anzahl = zeilen?.filter(z => !z.storniert_am).length

  return (
    <div className="mt-2 rounded-lg border border-s112-border bg-white">
      <button type="button" onClick={() => setAuf(a => !a)} aria-expanded={auf}
        className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-xs font-semibold text-s112-text-1 hover:bg-s112-bg/60 rounded-lg">
        <span>Maßnahmen an der Maische{anzahl != null ? ` (${anzahl})` : ''}</span>
        <span aria-hidden="true">{auf ? '▾' : '▸'}</span>
      </button>
      {auf && (
        <div className="px-3 pb-3 space-y-2">
          <p className="text-[11px] text-s112-muted">
            SO₂, Enzyme, Hefe, Anreicherung … während der Maischezeit ({tt(beginn)} bis {offen ? 'zum Abpressen' : tt(pressdatum)}). Die Chargen, die beim Abpressen
            entstehen, führen diese Maßnahmen anteilig nach Litern – in der Behandlungsliste, im Weinbuch und in der Meldung „Kellerbehandlungen“.
          </p>
          {fehler && <p role="alert" className="text-xs text-s112-err-fg">{fehler}</p>}
          {laedt && zeilen === null && <p className="text-xs text-s112-muted">Lädt …</p>}
          {zeilen !== null && zeilen.length === 0 && <p className="text-xs text-s112-muted italic">Noch keine Maßnahme erfasst.</p>}
          {zeilen !== null && zeilen.length > 0 && (
            <ul className="divide-y divide-s112-line text-sm">
              {zeilen.map(b => (
                <li key={b.id} className={`py-1.5 flex flex-wrap items-baseline gap-x-3 ${b.storniert_am ? 'text-s112-muted opacity-70' : ''}`}>
                  <span className="text-xs text-s112-text-2 tabular-nums whitespace-nowrap">{tt(b.datum)}</span>
                  <span className="font-medium text-s112-text">{(b.typ as R | null)?.name ?? b.typ_name_snapshot ?? '–'}</span>
                  {b.menge != null && b.einheit !== '-' && <span className="tabular-nums text-s112-text-1">{fmtNum(parseFloat(b.menge))} {b.einheit ?? ''}</span>}
                  {b.notizen && <span className="text-xs text-s112-muted">{b.notizen}</span>}
                  {b.storniert_am && <span className="text-[11px] text-s112-warn-fg">storniert{b.storno_grund ? ` – ${b.storno_grund}` : ''}</span>}
                  {schreiben && !b.storniert_am && (
                    <span className="ml-auto">
                      <StornoButton action={grund => deleteKellerbehandlung(b.id, grund)} danach={() => laden()}
                        hinweis="Die Maßnahme bleibt als storniert stehen und zählt bei den Chargen der Maische nicht mehr; eine Verwendung im Stoffkonto wird aufgehoben." />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {schreiben && !form && (
            <button type="button" onClick={() => setForm(true)} className="text-xs font-medium border border-s112-teal text-s112-blue-700 px-2 py-1 rounded-lg hover:bg-s112-teal/5">
              + Maßnahme erfassen
            </button>
          )}
          {schreiben && form && (
            <form data-ungespeichert onSubmit={speichern} className="rounded-lg border border-s112-border bg-s112-bg p-3 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
                  <ZukunftsDatum aria-label="Datum der Maßnahme" value={datum} onChange={e => setDatum(e.target.value)} required className={inp} />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Behandlung *</label>
                  <select aria-label="Behandlung" value={typId} onChange={e => typGewaehlt(e.target.value)} required className={inp}>
                    <option value="">– bitte wählen –</option>
                    {typen.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge</label>
                  <input aria-label="Menge" type="text" inputMode="decimal" value={menge} onChange={e => setMenge(e.target.value)} className={inp} />
                </div>
                <div>
                  <label className="block text-xs font-medium text-s112-text-2 mb-1">Einheit</label>
                  <input aria-label="Einheit" type="text" maxLength={20} value={einheit} onChange={e => setEinheit(e.target.value)} placeholder="g, kg, ml …" className={inp} />
                </div>
              </div>
              {stoffe.length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium text-s112-text-2 mb-1">Stoff aus dem Stoffkonto</label>
                    <select aria-label="Stoff aus dem Stoffkonto" value={stoffId} onChange={e => setStoffId(e.target.value)} className={inp}>
                      <option value="">– keiner –</option>
                      {stoffe.map(s => <option key={s.id} value={s.id}>{s.name} ({s.einheit})</option>)}
                    </select>
                  </div>
                  {stoffId && (
                    <div>
                      <label className="block text-xs font-medium text-s112-text-2 mb-1">Verwendete Menge *</label>
                      <input aria-label="Verwendete Menge des Stoffs" type="text" inputMode="decimal" required value={stoffMenge} onChange={e => setStoffMenge(e.target.value)} className={inp} />
                    </div>
                  )}
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
                <input aria-label="Notizen zur Maßnahme" type="text" maxLength={500} value={notizen} onChange={e => setNotizen(e.target.value)} className={inp} />
              </div>
              <div className="flex gap-2">
                <button type="submit" disabled={speichert} className="bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50">
                  {speichert ? 'Speichert…' : 'Speichern'}
                </button>
                <button type="button" onClick={() => setForm(false)} className="px-3 py-1.5 text-xs text-s112-text-2 hover:text-s112-text">Abbrechen</button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
