'use client'

// KAN-118 (08.10.2026): Formular „Produktion“ – Art, Quell-Chargen mit Litern, Zutaten (Wasser, Saft, Aroma, CO₂, Zucker,
// Hefe …), neue Charge (Name, leeres Gebinde). Prüfung wie die RPC (lib/kellerbuch/produktion) schon im Formular.
// KAN-119 (08.10.2026): als Assistent in drei Schritten – Art → Eingänge → neue Charge und Gebinde; „Weiter“ prüft nur
// den aktuellen Schritt (produktionFehler(…, schritt)), „Produktion buchen“ alles.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { fmtNum, zahlAus } from '@/lib/format'
import {
  ERZEUGNIS_JE_ART, PRODUKTION_ARTEN, PRODUKTION_ART_LABEL, PRODUKTION_SCHRITTE, PRODUKTION_ZUTAT_LABEL, VOLUMEN_ZUTATEN,
  produktionFehler, weinanteil, zielMenge, zutatenFuer,
  type Einheit, type ProduktionArt, type ProduktionSchritt, type ZutatArt, type ZutatEingang,
} from '@/lib/kellerbuch/produktion'
import type { ProduktionEingabe } from './actions'

type Charge = { id: string; name: string; menge: number; weinart: string | null; erzeugnis: string | null; gebinde: string | null }
type Gebinde = { id: string; name: string; volumen: number | null }
type Mittel = { id: string; name: string; einheit: string }

const ERZEUGNIS_TEXT: Record<string, string> = { WEINHALT: 'Weinhaltiges Getränk', PERLWEIN: 'Perlwein', SCHAUMW: 'Schaumwein', SEKTGU: 'Sekt mit g.U.', PETNAT: 'PetNat' }
const ART_HINWEIS: Record<ProduktionArt, string> = {
  spritzer: 'Wein mit Wasser und Kohlensäure – mindestens 50 % Wein',
  mischgetraenk: 'Wein mit Saft oder Aroma – mindestens 50 % Wein',
  perlwein: 'Kohlensäure zugesetzt oder aus der Gärung',
  schaumwein: 'Zweite Gärung mit Fülldosage – auch Sekt g.U.',
  petnat: 'Flaschengärung ohne zugesetzte Kohlensäure',
}
const inp = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 bg-white'
const SCHRITTE: ProduktionSchritt[] = [1, 2, 3]

export default function ProduktionForm({ chargen, gebinde, mittel, heute, quelle, buchen }: {
  chargen: Charge[]; gebinde: Gebinde[]; mittel: Mittel[]; heute: string; quelle: string | null
  buchen: (e: ProduktionEingabe) => Promise<{ zielId: string }>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [schritt, setSchritt] = useState<ProduktionSchritt>(1)
  const [art, setArt] = useState<ProduktionArt>('spritzer')
  const [erzeugnis, setErzeugnis] = useState('')
  const [datum, setDatum] = useState(heute)
  const [name, setName] = useState('')
  const [behaelterId, setBehaelterId] = useState('')
  const [notizen, setNotizen] = useState('')
  const [wein, setWein] = useState<{ id: string; menge: string }[]>(() => {
    const q = quelle ? chargen.find(c => c.id === quelle) : undefined
    return [{ id: q?.id ?? '', menge: q ? String(q.menge).replace('.', ',') : '' }]
  })
  const [zutaten, setZutaten] = useState<{ art: ZutatArt; menge: string; einheit: Einheit; kellermittelId: string; bezeichnung: string }[]>([])
  const [fehler, setFehler] = useState<string[]>([])

  const jeId = useMemo(() => new Map(chargen.map(c => [c.id, c])), [chargen])
  const weinEingaenge = wein.filter(w => w.id).map(w => {
    const c = jeId.get(w.id)
    return { weinausbauId: w.id, menge: zahlAus(w.menge) ?? 0, bestand: c?.menge ?? 0, weinart: c?.weinart ?? null, name: c?.name ?? null }
  })
  const zutatEingaenge: ZutatEingang[] = zutaten.map(z => ({ art: z.art, menge: zahlAus(z.menge) ?? 0, einheit: z.einheit, kellermittelId: z.kellermittelId || null, bezeichnung: z.bezeichnung || null }))
  const m = zielMenge(weinEingaenge, zutatEingaenge)
  const erlaubt = zutatenFuer(art)
  const erzeugnisse = ERZEUGNIS_JE_ART[art]
  const eingabe = { art, erzeugnis: erzeugnis || null, name, behaelterId, datum, heute, wein: weinEingaenge, zutaten: zutatEingaenge }

  function setzeArt(a: ProduktionArt) {
    setArt(a)
    setErzeugnis('')
    setZutaten(z => z.filter(x => zutatenFuer(a).includes(x.art)))
  }

  function weiter() {
    const f = produktionFehler(eingabe, schritt)
    setFehler(f)
    if (f.length === 0 && schritt < 3) setSchritt((schritt + 1) as ProduktionSchritt)
  }
  function zurueck() {
    setFehler([])
    if (schritt > 1) setSchritt((schritt - 1) as ProduktionSchritt)
  }

  function senden(e: React.FormEvent) {
    e.preventDefault()
    if (schritt < 3) { weiter(); return }
    const f = produktionFehler(eingabe)
    setFehler(f)
    if (f.length) return
    startTransition(async () => {
      try {
        const { zielId } = await buchen({ art, erzeugnis: erzeugnis || null, datum, name, behaelterId, notizen,
          wein: weinEingaenge.map(w => ({ weinausbauId: w.weinausbauId, menge: w.menge })), zutaten: zutatEingaenge })
        router.push(`/kellerbuch/weinausbau/${zielId}`)
      } catch (err) {
        setFehler([fehlerText(err, 'Produktion konnte nicht gebucht werden')])
      }
    })
  }

  const mengeText = (
    <p className="text-sm text-s112-text-2">
      Neue Charge: <strong>{fmtNum(m.ziel, { max: 2 })} L</strong> ({fmtNum(m.wein, { max: 2 })} L Wein
      {m.zusatz > 0 ? ` + ${fmtNum(m.zusatz, { max: 2 })} L Zusatz – Weinanteil ${weinanteil(m.wein, m.zusatz).toLocaleString('de-DE')} %` : ''})
    </p>
  )

  return (
    <form onSubmit={senden} className="card p-4 space-y-4">
      {/* Schrittanzeige */}
      <ol className="flex flex-wrap gap-2 text-xs" aria-label="Schritte">
        {SCHRITTE.map(s => (
          <li key={s} aria-current={s === schritt ? 'step' : undefined}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 border ${s === schritt ? 'border-s112-teal bg-s112-teal/10 text-s112-text font-semibold' : s < schritt ? 'border-s112-line text-s112-text-2' : 'border-s112-line text-s112-muted'}`}>
            {s < schritt ? <Check size={12} aria-hidden /> : <span className="tabular-nums">{s}</span>}
            {PRODUKTION_SCHRITTE[s]}
          </li>
        ))}
      </ol>

      {schritt === 1 && (
        <div className="space-y-4">
          <fieldset>
            <legend className="text-sm font-semibold text-s112-text mb-2">Was wird produziert?</legend>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {PRODUKTION_ARTEN.map(a => (
                <label key={a} className={`cursor-pointer rounded-lg border p-3 text-sm ${a === art ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-line hover:border-s112-teal/60'}`}>
                  <input type="radio" name="prod-art" value={a} checked={a === art} onChange={() => setzeArt(a)} className="sr-only" />
                  <span className="block font-medium text-s112-text">{PRODUKTION_ART_LABEL[a]}</span>
                  <span className="block text-xs text-s112-muted mt-0.5">{ART_HINWEIS[a]}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="prod-erz" className="block text-xs font-medium text-s112-text-2 mb-1">Erzeugnis</label>
              <select id="prod-erz" value={erzeugnis || erzeugnisse[0]} onChange={e => setErzeugnis(e.target.value)} className={inp} disabled={erzeugnisse.length < 2}>
                {erzeugnisse.map(c => <option key={c} value={c}>{ERZEUGNIS_TEXT[c] ?? c}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="prod-datum" className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
              <input required id="prod-datum" type="date" value={datum} max={heute} onChange={e => setDatum(e.target.value)} className={inp} />
            </div>
          </div>
        </div>
      )}

      {schritt === 2 && (
        <div className="space-y-4">
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-s112-text">Quell-Chargen (Wein)</legend>
            {wein.map((w, i) => (
              <div key={i} className="grid gap-2 grid-cols-[1fr_8rem_auto] items-end">
                <div>
                  <label htmlFor={`prod-q-${i}`} className="sr-only">Quell-Charge {i + 1}</label>
                  <select id={`prod-q-${i}`} value={w.id} onChange={e => setWein(l => l.map((x, j) => j === i ? { ...x, id: e.target.value } : x))} className={inp}>
                    <option value="">– Charge wählen –</option>
                    {chargen.map(c => <option key={c.id} value={c.id}>{c.name}{c.gebinde ? ` · ${c.gebinde}` : ''} ({fmtNum(c.menge, { max: 2 })} L)</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`prod-ql-${i}`} className="sr-only">Liter aus Charge {i + 1}</label>
                  <input id={`prod-ql-${i}`} inputMode="decimal" placeholder="Liter" value={w.menge}
                    onChange={e => setWein(l => l.map((x, j) => j === i ? { ...x, menge: e.target.value } : x))} className={inp} />
                </div>
                <button type="button" aria-label={`Quell-Charge ${i + 1} entfernen`} disabled={wein.length === 1}
                  onClick={() => setWein(l => l.filter((_, j) => j !== i))} className="p-2 text-s112-muted disabled:opacity-30"><Trash2 size={15} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setWein(l => [...l, { id: '', menge: '' }])} className="text-sm text-s112-blue-700 inline-flex items-center gap-1">
              <Plus size={14} aria-hidden /> weitere Quell-Charge
            </button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-s112-text">Zutaten</legend>
            {zutaten.map((z, i) => (
              <div key={i} className="grid gap-2 grid-cols-2 sm:grid-cols-[10rem_7rem_5rem_1fr_auto] items-end">
                <div>
                  <label htmlFor={`prod-z-${i}`} className="sr-only">Zutat {i + 1}</label>
                  <select id={`prod-z-${i}`} value={z.art} className={inp}
                    onChange={e => { const a = e.target.value as ZutatArt; setZutaten(l => l.map((x, j) => j === i ? { ...x, art: a, einheit: VOLUMEN_ZUTATEN.includes(a) ? 'l' : x.einheit } : x)) }}>
                    {erlaubt.map(a => <option key={a} value={a}>{PRODUKTION_ZUTAT_LABEL[a]}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor={`prod-zm-${i}`} className="sr-only">Menge Zutat {i + 1}</label>
                  <input id={`prod-zm-${i}`} inputMode="decimal" placeholder="Menge" value={z.menge} className={inp}
                    onChange={e => setZutaten(l => l.map((x, j) => j === i ? { ...x, menge: e.target.value } : x))} />
                </div>
                <div>
                  <label htmlFor={`prod-ze-${i}`} className="sr-only">Einheit Zutat {i + 1}</label>
                  <select id={`prod-ze-${i}`} value={z.einheit} disabled={VOLUMEN_ZUTATEN.includes(z.art)} className={inp}
                    onChange={e => setZutaten(l => l.map((x, j) => j === i ? { ...x, einheit: e.target.value as Einheit } : x))}>
                    <option value="l">L</option><option value="kg">kg</option><option value="g">g</option>
                  </select>
                </div>
                <div>
                  <label htmlFor={`prod-zk-${i}`} className="sr-only">Stoff aus dem Stoffkonto (Zutat {i + 1})</label>
                  <select id={`prod-zk-${i}`} value={z.kellermittelId} className={inp}
                    onChange={e => setZutaten(l => l.map((x, j) => j === i ? { ...x, kellermittelId: e.target.value } : x))}>
                    <option value="">– ohne Stoffkonto –</option>
                    {mittel.map(k => <option key={k.id} value={k.id}>{k.name} ({k.einheit})</option>)}
                  </select>
                </div>
                <button type="button" aria-label={`Zutat ${i + 1} entfernen`} onClick={() => setZutaten(l => l.filter((_, j) => j !== i))}
                  className="p-2 text-s112-muted"><Trash2 size={15} /></button>
              </div>
            ))}
            <button type="button" onClick={() => setZutaten(l => [...l, { art: erlaubt[0], menge: '', einheit: VOLUMEN_ZUTATEN.includes(erlaubt[0]) ? 'l' : 'kg', kellermittelId: '', bezeichnung: '' }])}
              className="text-sm text-s112-blue-700 inline-flex items-center gap-1">
              <Plus size={14} aria-hidden /> Zutat
            </button>
          </fieldset>
          {mengeText}
        </div>
      )}

      {schritt === 3 && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="prod-name" className="block text-xs font-medium text-s112-text-2 mb-1">Name der neuen Charge *</label>
              <input required id="prod-name" value={name} onChange={e => setName(e.target.value)} placeholder={`z. B. ${PRODUKTION_ART_LABEL[art]} ${heute.slice(0, 4)}`} className={inp} />
            </div>
            <div>
              <label htmlFor="prod-geb" className="block text-xs font-medium text-s112-text-2 mb-1">Gebinde (leer) *</label>
              <select required id="prod-geb" value={behaelterId} onChange={e => setBehaelterId(e.target.value)} className={inp}>
                <option value="">– Gebinde wählen –</option>
                {gebinde.map(g => <option key={g.id} value={g.id}>{g.name}{g.volumen ? ` (${fmtNum(g.volumen, { max: 0 })} L)` : ''}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="prod-notiz" className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
              <input id="prod-notiz" value={notizen} onChange={e => setNotizen(e.target.value)} className={inp} />
            </div>
          </div>
          {/* Zusammenfassung vor dem Buchen */}
          <dl className="rounded-lg bg-s112-bg p-3 text-sm grid gap-1 sm:grid-cols-[9rem_1fr]">
            <dt className="text-s112-muted">Art</dt>
            <dd>{PRODUKTION_ART_LABEL[art]} · {ERZEUGNIS_TEXT[erzeugnis || erzeugnisse[0]] ?? erzeugnis} · {new Date(`${datum}T00:00:00`).toLocaleDateString('de-DE')}</dd>
            <dt className="text-s112-muted">Wein</dt>
            <dd>{weinEingaenge.map(w => `${w.name ?? 'Charge'} ${fmtNum(w.menge, { max: 2 })} L`).join(', ') || '–'}</dd>
            <dt className="text-s112-muted">Zutaten</dt>
            <dd>{zutatEingaenge.map(z => `${PRODUKTION_ZUTAT_LABEL[z.art]} ${fmtNum(z.menge, { max: 3 })} ${z.einheit === 'l' ? 'L' : z.einheit}`).join(', ') || '–'}</dd>
          </dl>
          {mengeText}
        </div>
      )}

      {fehler.length > 0 && <ul role="alert" className="text-sm text-s112-err list-disc pl-5">{fehler.map(f => <li key={f}>{f}</li>)}</ul>}
      <div className="flex flex-wrap items-center gap-2">
        {schritt > 1 && (
          <button type="button" onClick={zurueck} className="btn-secondary inline-flex items-center gap-1"><ChevronLeft size={15} aria-hidden /> Zurück</button>
        )}
        {schritt < 3
          ? <button type="submit" disabled={pending} className="btn-primary inline-flex items-center gap-1">Weiter <ChevronRight size={15} aria-hidden /></button>
          : <button type="submit" disabled={pending} className="btn-primary">{pending ? 'Bucht …' : 'Produktion buchen'}</button>}
      </div>
    </form>
  )
}
