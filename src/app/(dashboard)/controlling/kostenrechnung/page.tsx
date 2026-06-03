'use client'
import { useState, useEffect } from 'react'

type KS  = { id: string; name: string; kuerzel?: string }
type KA  = { id: string; name: string; kategorie?: string }
type RL  = { id: string; name: string }
type BH  = { id: string; name: string; typ?: string }
type Eintrag = {
  id: string; datum: string; betrag: number; beschreibung: string | null
  objekt_typ: string | null; periode: string | null
  kostenstelle: { name: string } | null
  kostenart:    { name: string } | null
  ried:         { name: string } | null
  behaelter:    { name: string } | null
}

type Tab = 'buchungen' | 'kostenstellen' | 'kostenarten' | 'auswertung'

function sumBy<T>(arr: T[], key: (t: T) => string, val: (t: T) => number) {
  const m: Record<string, number> = {}
  arr.forEach(t => { const k = key(t); m[k] = (m[k] || 0) + val(t) })
  return Object.entries(m).sort((a,b) => b[1]-a[1])
}

export default function KostenrechnungPage() {
  const [tab, setTab]               = useState<Tab>('buchungen')
  const [eintraege, setEintraege]   = useState<Eintrag[]>([])
  const [kostenstellen, setKs]      = useState<KS[]>([])
  const [kostenarten, setKa]        = useState<KA[]>([])
  const [rieden, setRieden]         = useState<RL[]>([])
  const [behaelter, setBehaelter]   = useState<BH[]>([])
  const [laden, setLaden]           = useState(false)
  const [saving, setSaving]         = useState(false)
  const [fehler, setFehler]         = useState<string | null>(null)
  const [erfolg, setErfolg]         = useState(false)

  // Formular
  const [ksId, setKsId]             = useState('')
  const [kaId, setKaId]             = useState('')
  const [datum, setDatum]           = useState(new Date().toISOString().split('T')[0])
  const [betrag, setBetrag]         = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [objektTyp, setObjektTyp]   = useState('')
  const [riedId, setRiedId]         = useState('') // '' = alle
  const [behId, setBehId]           = useState('') // '' = alle

  // Auswertung
  const [awJahr, setAwJahr]         = useState(new Date().getFullYear().toString())
  const [awDaten, setAwDaten]       = useState<Eintrag[]>([])

  useEffect(() => {
    setLaden(true)
    Promise.all([
      fetch('/api/kostenrechnung?action=eintraege').then(r => r.json()),
      fetch('/api/kostenrechnung?action=kostenstellen').then(r => r.json()),
      fetch('/api/kostenrechnung?action=kostenarten').then(r => r.json()),
      fetch('/api/kostenrechnung?action=rieden').then(r => r.json()),
      fetch('/api/kostenrechnung?action=behaelter').then(r => r.json()),
    ]).then(([e, ks, ka, rl, bh]) => {
      setEintraege(e.eintraege ?? [])
      setKs(ks.kostenstellen ?? [])
      setKa(ka.kostenarten ?? [])
      setRieden(rl.rieden ?? [])
      setBehaelter(bh.behaelter ?? [])
    }).finally(() => setLaden(false))
  }, [])

  useEffect(() => {
    if (tab === 'auswertung') ladeAuswertung(awJahr)
  }, [tab])

  async function ladeAuswertung(jahr: string) {
    const d = await fetch(`/api/kostenrechnung?action=auswertung&jahr=${jahr}`).then(r => r.json())
    setAwDaten(d.eintraege ?? [])
  }

  async function buchen(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setFehler(null); setErfolg(false)
    const res = await fetch('/api/kostenrechnung', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'eintrag', kostenstelle_id: ksId || null, kostenart_id: kaId || null,
        datum, betrag: parseFloat(betrag), beschreibung: beschreibung || null,
        objekt_typ: objektTyp || null,
        ried_id:     objektTyp === 'weingarten' && riedId ? riedId : null,
        behaelter_id: objektTyp === 'keller' && behId ? behId : null,
      }),
    })
    const data = await res.json()
    if (data.fehler) { setFehler(data.fehler); setSaving(false); return }
    setErfolg(true); setBetrag(''); setBeschreibung(''); setObjektTyp(''); setRiedId(''); setBehId('')
    const upd = await fetch('/api/kostenrechnung?action=eintraege').then(r => r.json())
    setEintraege(upd.eintraege ?? [])
    setSaving(false)
    setTimeout(() => setErfolg(false), 3000)
  }

  const gesamtJahr = eintraege.filter(e => e.datum?.startsWith(new Date().getFullYear().toString())).reduce((s,e) => s+e.betrag, 0)

  const objektLabel = (e: Eintrag) => {
    if (!e.objekt_typ) return '–'
    if (e.objekt_typ === 'weingarten') return e.ried ? e.ried.name : 'Alle Rieden'
    if (e.objekt_typ === 'keller')     return e.behaelter ? e.behaelter.name : 'Alle Behälter'
    return '–'
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kostenrechnung</h1>
          <p className="text-sm text-s112-muted mt-0.5">Kosten {new Date().getFullYear()}: <strong className="text-gray-800">{gesamtJahr.toLocaleString('de-AT',{style:'currency',currency:'EUR'})}</strong></p>
        </div>
      </div>

      {/* Neue Buchung */}
      <div className="bg-white rounded-2xl border border-s112-border p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Neue Buchung</h2>
        <form onSubmit={buchen} className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Datum</label>
            <input type="date" value={datum} onChange={e => setDatum(e.target.value)} required
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Betrag (€)</label>
            <input type="number" step="0.01" value={betrag} onChange={e => setBetrag(e.target.value)} required placeholder="0,00"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kostenstelle</label>
            <select value={ksId} onChange={e => setKsId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Kostenstelle –</option>
              {kostenstellen.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kostenart</label>
            <select value={kaId} onChange={e => setKaId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Kostenart –</option>
              {kostenarten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>

          {/* Objektzuordnung */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Zuordnung</label>
            <select value={objektTyp} onChange={e => { setObjektTyp(e.target.value); setRiedId(''); setBehId('') }}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– keine Zuordnung –</option>
              <option value="weingarten">Weingarten / Rieden</option>
              <option value="keller">Keller / Behälter</option>
            </select>
          </div>

          {objektTyp === 'weingarten' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Riede (leer = alle)</label>
              <select value={riedId} onChange={e => setRiedId(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="">Alle Rieden</option>
                {rieden.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </div>
          )}

          {objektTyp === 'keller' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Behälter (leer = alle)</label>
              <select value={behId} onChange={e => setBehId(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="">Alle Behälter</option>
                {behaelter.map(b => <option key={b.id} value={b.id}>{b.name}{b.typ ? ` (${b.typ})` : ''}</option>)}
              </select>
            </div>
          )}

          {objektTyp === '' && <div />}

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
            <input value={beschreibung} onChange={e => setBeschreibung(e.target.value)} placeholder="z.B. Traktor-Service, Spritzarbeit, Holzfass-Kauf…"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>

          <div className="col-span-2 flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
              {saving ? 'Speichern…' : 'Buchen'}
            </button>
            {fehler  && <p className="text-sm text-red-600">{fehler}</p>}
            {erfolg  && <p className="text-sm text-green-600">✓ Buchung gespeichert</p>}
          </div>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 flex-wrap">
        {[['buchungen','📋 Buchungen'],['auswertung','📊 Auswertung'],['kostenstellen','🏢 Kostenstellen'],['kostenarten','🏷 Kostenarten']] .map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${tab===id ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg text-gray-600 hover:bg-s112-teal/10'}`}>
            {label}
          </button>
        ))}
      </div>

      {/* Buchungen */}
      {tab === 'buchungen' && (
        <div className="bg-white rounded-2xl border border-s112-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-s112-bg text-xs text-s112-muted uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Datum</th>
                <th className="px-4 py-3 text-left">Beschreibung</th>
                <th className="px-4 py-3 text-left">Kostenstelle</th>
                <th className="px-4 py-3 text-left">Kostenart</th>
                <th className="px-4 py-3 text-left">Zuordnung</th>
                <th className="px-4 py-3 text-right">Betrag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border/40">
              {eintraege.map(e => (
                <tr key={e.id} className="hover:bg-s112-bg/30">
                  <td className="px-4 py-2.5 text-s112-muted tabular-nums">{new Date(e.datum).toLocaleDateString('de-AT')}</td>
                  <td className="px-4 py-2.5">{e.beschreibung ?? '–'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{e.kostenstelle?.name ?? '–'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{e.kostenart?.name ?? '–'}</td>
                  <td className="px-4 py-2.5 text-gray-600">{objektLabel(e)}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">
                    {e.betrag.toLocaleString('de-AT',{style:'currency',currency:'EUR'})}
                  </td>
                </tr>
              ))}
              {eintraege.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-s112-muted">Noch keine Buchungen</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* Auswertung */}
      {tab === 'auswertung' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700">Jahr:</label>
            <select value={awJahr} onChange={e => { setAwJahr(e.target.value); ladeAuswertung(e.target.value) }}
              className="border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none">
              {[2026,2025,2024,2023].map(y => <option key={y}>{y}</option>)}
            </select>
            <span className="text-sm text-s112-muted ml-2">
              Gesamt: <strong className="text-gray-800">{awDaten.reduce((s,e)=>s+e.betrag,0).toLocaleString('de-AT',{style:'currency',currency:'EUR'})}</strong>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-4">
            {/* Nach Kostenstelle */}
            <div className="bg-white rounded-2xl border border-s112-border p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Nach Kostenstelle</h3>
              <div className="space-y-2">
                {sumBy(awDaten, e => e.kostenstelle?.name ?? '(keine)', e => e.betrag).map(([name, sum]) => (
                  <div key={name} className="flex justify-between text-sm">
                    <span className="text-gray-600 truncate mr-2">{name}</span>
                    <span className="font-medium tabular-nums flex-shrink-0">{sum.toLocaleString('de-AT',{style:'currency',currency:'EUR'})}</span>
                  </div>
                ))}
                {awDaten.length === 0 && <p className="text-xs text-s112-muted">Keine Daten</p>}
              </div>
            </div>

            {/* Nach Kostenart */}
            <div className="bg-white rounded-2xl border border-s112-border p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Nach Kostenart</h3>
              <div className="space-y-2">
                {sumBy(awDaten, e => e.kostenart?.name ?? '(keine)', e => e.betrag).map(([name, sum]) => (
                  <div key={name} className="flex justify-between text-sm">
                    <span className="text-gray-600 truncate mr-2">{name}</span>
                    <span className="font-medium tabular-nums flex-shrink-0">{sum.toLocaleString('de-AT',{style:'currency',currency:'EUR'})}</span>
                  </div>
                ))}
                {awDaten.length === 0 && <p className="text-xs text-s112-muted">Keine Daten</p>}
              </div>
            </div>

            {/* Nach Zuordnung */}
            <div className="bg-white rounded-2xl border border-s112-border p-4">
              <h3 className="text-sm font-semibold text-gray-800 mb-3">Nach Zuordnung</h3>
              <div className="space-y-2">
                {sumBy(awDaten, e => {
                  if (!e.objekt_typ) return 'Allgemein'
                  if (e.objekt_typ === 'weingarten') return e.ried ? `Riede: ${e.ried.name}` : 'Alle Rieden'
                  return e.behaelter ? `Tank: ${e.behaelter.name}` : 'Alle Behälter'
                }, e => e.betrag).map(([name, sum]) => (
                  <div key={name} className="flex justify-between text-sm">
                    <span className="text-gray-600 truncate mr-2">{name}</span>
                    <span className="font-medium tabular-nums flex-shrink-0">{sum.toLocaleString('de-AT',{style:'currency',currency:'EUR'})}</span>
                  </div>
                ))}
                {awDaten.length === 0 && <p className="text-xs text-s112-muted">Keine Daten</p>}
              </div>
            </div>
          </div>

          {/* Monatsverlauf */}
          <div className="bg-white rounded-2xl border border-s112-border p-4">
            <h3 className="text-sm font-semibold text-gray-800 mb-3">Monatsverlauf {awJahr}</h3>
            <div className="grid grid-cols-12 gap-1">
              {Array.from({length:12},(_,i)=>{
                const m = String(i+1).padStart(2,'0')
                const per = `${awJahr}-${m}`
                const sum = awDaten.filter(e=>e.periode===per).reduce((s,e)=>s+e.betrag,0)
                const max = Math.max(...Array.from({length:12},(_,j)=>{
                  const mm=String(j+1).padStart(2,'0')
                  return awDaten.filter(e=>e.periode===`${awJahr}-${mm}`).reduce((s,e)=>s+e.betrag,0)
                }),1)
                const pct = Math.round((sum/max)*100)
                const monate = ['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
                return (
                  <div key={m} className="flex flex-col items-center gap-1">
                    <div className="w-full bg-s112-bg rounded h-20 flex items-end">
                      <div className="w-full bg-s112-teal rounded transition-all" style={{height:`${pct}%`}} title={sum.toLocaleString('de-AT',{style:'currency',currency:'EUR'})} />
                    </div>
                    <span className="text-[9px] text-s112-muted">{monate[i]}</span>
                    {sum > 0 && <span className="text-[9px] font-medium text-gray-700">{Math.round(sum/1000)}k</span>}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {tab === 'kostenstellen' && (
        <div className="bg-white rounded-2xl border border-s112-border p-5">
          <p className="text-sm text-s112-muted mb-3">Kostenstellen werden in Admin → Stammdaten oder direkt per SQL angelegt.</p>
          <div className="space-y-2">
            {kostenstellen.map(k => <div key={k.id} className="flex items-center gap-3 text-sm"><span className="font-mono text-xs text-s112-muted w-16">{k.kuerzel}</span><span>{k.name}</span></div>)}
          </div>
        </div>
      )}

      {tab === 'kostenarten' && (
        <div className="bg-white rounded-2xl border border-s112-border p-5">
          <p className="text-sm text-s112-muted mb-3">Kostenarten werden in Admin → Stammdaten oder direkt per SQL angelegt.</p>
          <div className="space-y-2">
            {kostenarten.map(k => <div key={k.id} className="flex items-center gap-3 text-sm"><span className="text-xs bg-s112-bg px-2 py-0.5 rounded text-s112-muted">{k.kategorie}</span><span>{k.name}</span></div>)}
          </div>
        </div>
      )}
    </div>
  )
}
