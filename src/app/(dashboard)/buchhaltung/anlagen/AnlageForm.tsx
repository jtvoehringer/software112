'use client'
// Anlage erfassen / bearbeiten (Migration 200). Zeigt beim Tippen den
// AfA-Plan, damit man sieht, was die Eingaben bedeuten.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { afaPlan, type AfaMethode, type Anlage } from '@/lib/ea/anlagen'
import { fmtEur, fmtNum, dezimal } from '@/lib/format'
import { Th, Td, Note } from '@/app/(dashboard)/dashboard/_shared/ui'
import { speichereAnlage, loescheAnlage } from './actions'
import type { BuchungsKandidat } from './daten'

export type AnlageInput = {
  id?: string
  transaktion_id: string
  name: string
  gruppe: string
  konto_nr: string
  anschaffung_am: string
  ak_netto: string
  nutzungsdauer_jahre: string
  methode: AfaMethode
  degressiv_satz: string
  restwert: string
  abgang_am: string
  veraeusserungserloes: string
  notizen: string
}

export const LEER: AnlageInput = {
  transaktion_id: '', name: '', gruppe: '', konto_nr: '', anschaffung_am: new Date().toLocaleDateString('en-CA'),
  ak_netto: '', nutzungsdauer_jahre: '5', methode: 'linear', degressiv_satz: '30', restwert: '0',
  abgang_am: '', veraeusserungserloes: '', notizen: '',
}

// Übliche Gruppen eines Weinbaubetriebs mit Konto (EKR Klasse 0) und typischer Nutzungsdauer
const GRUPPEN: { name: string; konto: string; nd: number }[] = [
  { name: 'Traktor / Weingartenmaschinen',        konto: '0400', nd: 8 },
  { name: 'Kellereimaschinen (Presse, Filter, Abfüllung)', konto: '0400', nd: 10 },
  { name: 'Tanks und Behälter',                   konto: '0400', nd: 15 },
  { name: 'Fässer / Barriques',                   konto: '0400', nd: 4 },
  { name: 'Rebanlagen (Neuauspflanzung)',         konto: '',     nd: 25 },
  { name: 'Betriebs- und Geschäftsausstattung',   konto: '0660', nd: 5 },
  { name: 'EDV / Computer',                       konto: '0620', nd: 3 },
  { name: 'Fahrzeuge (PKW)',                      konto: '0630', nd: 8 },
  { name: 'Fahrzeuge (LKW, Transporter)',         konto: '0640', nd: 5 },
  { name: 'Gebäude / Investitionen in Gebäude',   konto: '0300', nd: 40 },
  { name: 'Software / Lizenzen',                  konto: '0100', nd: 3 },
]

/** „2.490,00“ / „2490.5“ → Zahl */
export function parseBetrag(s: string): number | null {
  const t = s.trim().replace(/[€\s]/g, '')
  if (!t) return null
  const norm = dezimal(t)
  const n = parseFloat(norm)
  return Number.isNaN(n) ? null : n
}
const betragText = (n: number) => fmtNum(n, 2)
const datumText = (iso: string) => new Date(iso + 'T00:00:00').toLocaleDateString('de-AT')

export default function AnlageForm({ initial, buchungen = [], darfSchreiben }: {
  initial?: AnlageInput
  /** Anschaffungsbuchungen (Kontenklasse 0), die noch keiner - oder dieser - Anlage zugeordnet sind */
  buchungen?: BuchungsKandidat[]
  darfSchreiben: boolean
}) {
  const router = useRouter()
  const [form, setForm] = useState<AnlageInput>(initial ?? LEER)
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState('')

  function set<K extends keyof AnlageInput>(k: K, v: AnlageInput[K]) { setForm(f => ({ ...f, [k]: v })) }
  function buchungWaehlen(id: string) {
    const b = buchungen.find(x => x.id === id)
    setForm(f => ({ ...f, transaktion_id: id, ...(b ? { anschaffung_am: b.datum, ak_netto: betragText(b.betrag_netto), name: f.name.trim() ? f.name : b.beschreibung } : {}) }))
  }
  function gruppeWaehlen(name: string) {
    const g = GRUPPEN.find(x => x.name === name)
    setForm(f => ({ ...f, gruppe: name, konto_nr: g && g.konto ? g.konto : f.konto_nr, nutzungsdauer_jahre: g ? String(g.nd) : f.nutzungsdauer_jahre }))
  }

  const kosten = parseBetrag(form.ak_netto) ?? 0
  const gwgMoeglich = kosten > 0 && kosten <= 1000
  const vorschau: Anlage | null = useMemo(() => {
    if (!form.anschaffung_am || kosten <= 0) return null
    return {
      id: 'neu', name: form.name, gruppe: form.gruppe || null, konto_nr: form.konto_nr ? Number(form.konto_nr) : null,
      anschaffung_am: form.anschaffung_am, ak_netto: kosten,
      nutzungsdauer_jahre: Math.max(1, Number(form.nutzungsdauer_jahre) || 1),
      methode: form.methode, degressiv_satz: form.methode === 'degressiv' ? Number(form.degressiv_satz) || 30 : null,
      restwert: parseBetrag(form.restwert) ?? 0,
      abgang_am: form.abgang_am || null, veraeusserungserloes: parseBetrag(form.veraeusserungserloes),
    }
  }, [form, kosten])
  const plan = vorschau ? afaPlan(vorschau) : []

  function speichern(e: React.FormEvent) {
    e.preventDefault()
    setFehler('')
    start(async () => {
      const r = await speichereAnlage({
        id: form.id, name: form.name, gruppe: form.gruppe || null,
        konto_nr: form.konto_nr.trim() ? Number(form.konto_nr.trim()) : null,
        anschaffung_am: form.anschaffung_am, ak_netto: kosten,
        nutzungsdauer_jahre: Number(form.nutzungsdauer_jahre) || 0, methode: form.methode,
        degressiv_satz: form.methode === 'degressiv' ? Number(form.degressiv_satz) || 30 : null,
        restwert: parseBetrag(form.restwert) ?? 0,
        abgang_am: form.abgang_am || null, veraeusserungserloes: parseBetrag(form.veraeusserungserloes),
        transaktion_id: form.transaktion_id || null, notizen: form.notizen || null,
      })
      if (!r.ok) { setFehler(r.fehler); return }
      router.push('/buchhaltung/anlagen')
      router.refresh()
    })
  }
  function loeschen() {
    if (!form.id) return
    if (!confirm('Anlage wirklich löschen? Der AfA-Plan geht damit verloren.')) return
    start(async () => {
      const r = await loescheAnlage(form.id!)
      if (!r.ok) { setFehler(r.fehler ?? 'Löschen fehlgeschlagen'); return }
      router.push('/buchhaltung/anlagen')
      router.refresh()
    })
  }

  const inp = 'w-full border border-s112-line-str rounded-lg px-3 py-2 text-sm bg-white text-s112-text focus:outline-none focus:ring-2 focus:ring-s112-teal focus:border-transparent disabled:bg-s112-bg'
  const lbl = 'block text-xs font-medium text-s112-text-1 mb-1'
  const karte = 'bg-white border border-s112-line rounded-xl p-5 space-y-4'
  const ro = !darfSchreiben

  return (
    <form onSubmit={speichern} className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5 items-start">
      <div className="space-y-4">
        <div className={karte}>
          <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Anlage</h2>
          <div>
            <label htmlFor="an-buchung" className={lbl}>Zugehörige Buchung (Anschaffung)</label>
            <select id="an-buchung" className={inp} value={form.transaktion_id} onChange={e => buchungWaehlen(e.target.value)} disabled={ro}>
              <option value="">– keine Verknüpfung –</option>
              {buchungen.map(b => (
                <option key={b.id} value={b.id}>{datumText(b.datum)} · {b.beschreibung || b.kategorie} · {fmtEur(b.betrag_netto)} netto</option>
              ))}
            </select>
            <p className="text-[11px] text-s112-tertiary mt-1">Angeboten werden Ausgaben in Kategorien der Kontenklasse 0 (z. B. „Anlagenkauf“), die noch keiner Anlage zugeordnet sind. Datum und Kosten werden übernommen.</p>
          </div>
          <div>
            <label htmlFor="an-name" className={lbl}>Bezeichnung *</label>
            <input id="an-name" className={inp} value={form.name} onChange={e => set('name', e.target.value)} placeholder="z. B. Traktor Fendt 211, Pneumatikpresse, Edelstahltank 5.000 l" required disabled={ro} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_140px] gap-4">
            <div>
              <label htmlFor="an-gruppe" className={lbl}>Anlagengruppe</label>
              <input id="an-gruppe" list="an-gruppen" className={inp} value={form.gruppe} onChange={e => gruppeWaehlen(e.target.value)} placeholder="Kellereimaschinen" disabled={ro} />
              <datalist id="an-gruppen">{GRUPPEN.map(g => <option key={g.name} value={g.name} />)}</datalist>
            </div>
            <div>
              <label htmlFor="an-konto" className={lbl}>Konto (Klasse 0)</label>
              <input id="an-konto" className={`${inp} font-mono`} value={form.konto_nr} onChange={e => set('konto_nr', e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="0400" disabled={ro} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="an-datum" className={lbl}>Anschaffung / Inbetriebnahme *</label>
              <input id="an-datum" type="date" className={inp} value={form.anschaffung_am} onChange={e => set('anschaffung_am', e.target.value)} required disabled={ro} />
            </div>
            <div>
              <label htmlFor="an-kosten" className={lbl}>Anschaffungskosten netto (€) *</label>
              <input id="an-kosten" inputMode="decimal" className={`${inp} font-mono`} value={form.ak_netto} onChange={e => set('ak_netto', e.target.value)} placeholder="z. B. 24.900,00" required disabled={ro} />
            </div>
          </div>
        </div>

        <div className={karte}>
          <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Abschreibung</h2>
          <div className="flex flex-wrap gap-2">
            {([['linear', 'Linear'], ['degressiv', 'Degressiv (max. 30 %)'], ['gwg', 'GWG – Sofortabschreibung']] as [AfaMethode, string][]).map(([m, t]) => (
              <button key={m} type="button" onClick={() => set('methode', m)} disabled={ro}
                className={`px-3 py-1.5 rounded-md text-[13px] font-medium border transition-colors ${form.methode === m ? 'bg-s112-blue-50 border-s112-blue-300 text-s112-blue-700' : 'bg-white border-s112-line-str text-s112-text-1 hover:bg-s112-bg'}`}>
                {t}
              </button>
            ))}
          </div>
          {form.methode === 'gwg' && !gwgMoeglich && kosten > 0 && (
            <p className="text-[12.5px] text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2">Geringwertige Wirtschaftsgüter sind bis 1.000 € netto möglich – bei {fmtEur(kosten)} bitte linear oder degressiv abschreiben.</p>
          )}
          {form.methode !== 'gwg' && gwgMoeglich && (
            <Note>Bis 1.000 € netto darf sofort abgeschrieben werden (GWG, § 13 EStG). Wahlrecht – über die Nutzungsdauer geht auch.</Note>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {form.methode !== 'gwg' && (
              <div>
                <label htmlFor="an-nd" className={lbl}>Nutzungsdauer (Jahre) *</label>
                <input id="an-nd" type="number" min={1} max={100} className={`${inp} font-mono`} value={form.nutzungsdauer_jahre} onChange={e => set('nutzungsdauer_jahre', e.target.value)} disabled={ro} />
              </div>
            )}
            {form.methode === 'degressiv' && (
              <div>
                <label htmlFor="an-satz" className={lbl}>Satz (% vom Buchwert)</label>
                <input id="an-satz" type="number" min={1} max={30} step={0.5} className={`${inp} font-mono`} value={form.degressiv_satz} onChange={e => set('degressiv_satz', e.target.value)} disabled={ro} />
              </div>
            )}
            {form.methode !== 'gwg' && (
              <div>
                <label htmlFor="an-rest" className={lbl}>Restwert (€)</label>
                <input id="an-rest" inputMode="decimal" className={`${inp} font-mono`} value={form.restwert} onChange={e => set('restwert', e.target.value)} placeholder="0,00" disabled={ro} />
              </div>
            )}
          </div>
        </div>

        <div className={karte}>
          <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Abgang <span className="text-s112-tertiary font-normal text-[12.5px]">(nur bei Verkauf oder Ausscheiden)</span></h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="an-abgang" className={lbl}>Abgangsdatum</label>
              <input id="an-abgang" type="date" className={inp} value={form.abgang_am} onChange={e => set('abgang_am', e.target.value)} disabled={ro} />
            </div>
            <div>
              <label htmlFor="an-erloes" className={lbl}>Veräußerungserlös netto (€)</label>
              <input id="an-erloes" inputMode="decimal" className={`${inp} font-mono`} value={form.veraeusserungserloes} onChange={e => set('veraeusserungserloes', e.target.value)} placeholder="0,00" disabled={ro || !form.abgang_am} />
            </div>
          </div>
        </div>

        <div className={karte}>
          <h2 className="font-display font-semibold text-[14.5px] text-s112-text">Notiz</h2>
          <textarea rows={3} className={`${inp} resize-none`} value={form.notizen} onChange={e => set('notizen', e.target.value)} placeholder="Seriennummer, Lieferant, Rechnungsnummer …" disabled={ro} />
        </div>

        {fehler && <p className="text-s112-err-fg text-sm bg-s112-err-bg border border-s112-err/30 px-3 py-2 rounded-lg">{fehler}</p>}

        <div className="flex flex-wrap gap-3">
          <Link href="/buchhaltung/anlagen" className="px-4 py-2 rounded-lg text-[13px] font-medium text-s112-text-1 border border-s112-line-str bg-white hover:bg-s112-bg">Abbrechen</Link>
          {darfSchreiben && (
            <button type="submit" disabled={pending} className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">
              {pending ? 'Speichern …' : form.id ? 'Änderungen speichern' : 'Anlage anlegen'}
            </button>
          )}
          {darfSchreiben && form.id && (
            <button type="button" onClick={loeschen} disabled={pending} className="ml-auto px-4 py-2 rounded-lg text-[13px] font-medium text-s112-err-fg border border-s112-err/30 bg-white hover:bg-s112-err-bg disabled:opacity-40">Löschen</button>
          )}
        </div>
      </div>

      {/* AfA-Plan live */}
      <div className="bg-white border border-s112-line rounded-xl p-5 lg:sticky lg:top-4">
        <h2 className="font-display font-semibold text-[14.5px] text-s112-text mb-3">AfA-Plan</h2>
        {plan.length === 0 ? (
          <p className="text-[13px] text-s112-tertiary">Anschaffungsdatum und -kosten eingeben – der Plan erscheint hier.</p>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead><tr><Th>Jahr</Th><Th right>AfA</Th><Th right>Buchwert 31.12.</Th></tr></thead>
              <tbody>
                {plan.map(z => (
                  <tr key={z.jahr}>
                    <Td mono>{z.jahr}{z.halb && <span className="text-s112-tertiary" title="Halbjahresregel"> ½</span>}{z.abgang && <span className="text-[11px] text-s112-tertiary"> Abgang</span>}</Td>
                    <Td right mono className="text-s112-text-2">{fmtEur(z.afa)}</Td>
                    <Td right mono className="font-semibold text-s112-text">{fmtEur(z.buchwertEnde)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11.5px] text-s112-tertiary mt-3">½ = halbe Jahres-AfA (Halbjahresregel). Summe AfA {fmtEur(plan.reduce((s, z) => s + z.afa, 0))}.</p>
          </>
        )}
      </div>
    </form>
  )
}
