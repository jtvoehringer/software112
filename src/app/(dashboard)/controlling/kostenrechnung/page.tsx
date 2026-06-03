'use client'
import { useState, useEffect } from 'react'

type KS = { id: string; name: string }
type KA = { id: string; name: string; kategorie?: string }
type WG = { id: string; name: string }
type BH = { id: string; name: string; typ?: string }
type WgSplit = { weingarten_id: string; anteil_pct?: number; wg?: { name: string }; betrag_anteil?: number }
type Eintrag = {
  id: string; datum: string; betrag: number; beschreibung: string | null
  objekt_typ: string | null; periode: string | null
  kostenstelle: { name: string } | null; kostenart: { name: string } | null
  wg: { name: string } | null; behaelter: { name: string } | null
  wg_splits?: WgSplit[]
}
type Tab = 'buchungen' | 'kostenstellen' | 'kostenarten'

function eur(n: number) { return n.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' }) }
function sumBy<T>(arr: T[], key: (t: T) => string, val: (t: T) => number) {
  const m: Record<string, number> = {}
  arr.forEach(t => { const k = key(t); m[k] = (m[k] || 0) + val(t) })
  return Object.entries(m).sort((a, b) => b[1] - a[1])
}

export default function KostenrechnungPage() {
  const [tab, setTab] = useState<Tab>('buchungen')
  const [eintraege, setEintraege] = useState<Eintrag[]>([])
  const [ks, setKs] = useState<KS[]>([])
  const [ka, setKa] = useState<KA[]>([])
  const [wgs, setWgs] = useState<WG[]>([])
  const [bhs, setBhs] = useState<BH[]>([])
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<string | null>(null)
  const [erfolg, setErfolg] = useState(false)

  // Formular
  const [editId, setEditId] = useState<string | null>(null)
  const [ksId, setKsId] = useState('')
  const [kaId, setKaId] = useState('')
  const [datum, setDatum] = useState(new Date().toISOString().split('T')[0])
  const [betrag, setBetrag] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [objektTyp, setObjektTyp] = useState('')
  const [behId, setBehId] = useState('')
  // WG Multi-Select
  const [selectedWgs, setSelectedWgs] = useState<string[]>([]) // leer = alle
  const [splitModus, setSplitModus] = useState<'gleich' | 'prozent'>('gleich')
  const [anteile, setAnteile] = useState<Record<string, number>>({}) // wg_id → %

  // Auswertung

  const ladeDaten = async () => {
    const [e, k, a, w, b] = await Promise.all([
      fetch('/api/kostenrechnung?action=eintraege').then(r => r.json()),
      fetch('/api/kostenrechnung?action=kostenstellen').then(r => r.json()),
      fetch('/api/kostenrechnung?action=kostenarten').then(r => r.json()),
      fetch('/api/kostenrechnung?action=weingaerten').then(r => r.json()),
      fetch('/api/kostenrechnung?action=behaelter').then(r => r.json()),
    ])
    setEintraege(e.eintraege ?? [])
    setKs(k.kostenstellen ?? [])
    setKa(a.kostenarten ?? [])
    setWgs(w.weingaerten ?? [])
    setBhs(b.behaelter ?? [])
  }

  useEffect(() => { ladeDaten() }, [])


  function toggleWg(id: string) {
    setSelectedWgs(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function resetForm() {
    setEditId(null); setKsId(''); setKaId('')
    setDatum(new Date().toISOString().split('T')[0])
    setBetrag(''); setBeschreibung(''); setObjektTyp(''); setBehId('')
    setSelectedWgs([]); setSplitModus('gleich'); setAnteile({})
  }

  function startEdit(e: Eintrag) {
    setEditId(e.id); setDatum(e.datum); setBetrag(String(e.betrag))
    setBeschreibung(e.beschreibung ?? ''); setObjektTyp(e.objekt_typ ?? '')
    setKsId(ks.find(k => k.name === e.kostenstelle?.name)?.id ?? '')
    setKaId(ka.find(k => k.name === e.kostenart?.name)?.id ?? '')
    setBehId(bhs.find(b => b.name === e.behaelter?.name)?.id ?? '')
    if (e.wg_splits && e.wg_splits.length > 0) {
      setSelectedWgs(e.wg_splits.map(s => s.weingarten_id))
      const allGleich = e.wg_splits.every(s => !s.anteil_pct || Math.abs((s.anteil_pct ?? 0) - 100 / e.wg_splits!.length) < 0.5)
      setSplitModus(allGleich ? 'gleich' : 'prozent')
      const a: Record<string, number> = {}
      e.wg_splits.forEach(s => { a[s.weingarten_id] = s.anteil_pct ?? 0 })
      setAnteile(a)
    } else { setSelectedWgs([]); setSplitModus('gleich'); setAnteile({}) }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function loeschen(id: string) {
    if (!confirm('Buchung wirklich löschen?')) return
    await fetch('/api/kostenrechnung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'loeschen', id }) })
    await ladeDaten()
  }

  async function buchen(e: React.FormEvent) {
    e.preventDefault()
    const b = parseFloat(betrag)
    // WG-Split vorbereiten
    let wgSplit: { weingarten_id: string; anteil_pct?: number }[] = []
    if (objektTyp === 'weingarten' && selectedWgs.length > 0) {
      if (splitModus === 'gleich') {
        wgSplit = selectedWgs.map(id => ({ weingarten_id: id }))
      } else {
        const total = Object.values(anteile).reduce((s, v) => s + v, 0)
        if (Math.abs(total - 100) > 0.5) { setFehler(`Summe der Anteile muss 100% ergeben (aktuell ${total.toFixed(1)}%)`); return }
        wgSplit = selectedWgs.map(id => ({ weingarten_id: id, anteil_pct: anteile[id] ?? 0 }))
      }
    }
    setSaving(true); setFehler(null); setErfolg(false)
    const res = await fetch('/api/kostenrechnung', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: editId ? 'aktualisieren' : 'eintrag', id: editId,
        kostenstelle_id: ksId || null, kostenart_id: kaId || null,
        datum, betrag: b, beschreibung: beschreibung || null,
        objekt_typ: objektTyp || null, behaelter_id: objektTyp === 'keller' && behId ? behId : null,
        wg_split: wgSplit,
      }),
    })
    const data = await res.json()
    if (data.fehler) { setFehler(data.fehler); setSaving(false); return }
    setErfolg(true); resetForm(); await ladeDaten()
    setSaving(false); setTimeout(() => setErfolg(false), 3000)
  }

  const gesamtJahr = eintraege.filter(e => e.datum?.startsWith(new Date().getFullYear().toString())).reduce((s, e) => s + e.betrag, 0)

  const wgLabel = (e: Eintrag) => {
    if (!e.objekt_typ || e.objekt_typ !== 'weingarten') return null
    if (!e.wg_splits || e.wg_splits.length === 0) return 'Alle WG'
    if (e.wg_splits.length === 1) return e.wg_splits[0].wg?.name ?? '?'
    return `${e.wg_splits.length} Weingärten`
  }

  const anteilSumme = selectedWgs.reduce((s, id) => s + (anteile[id] ?? 0), 0)

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Kostenrechnung</h1>
        <p className="text-sm text-s112-muted mt-0.5">{new Date().getFullYear()}: <strong className="text-gray-800">{eur(gesamtJahr)}</strong></p>
      </div>

      {/* Formular */}
      <div className={`bg-white rounded-2xl border p-5 ${editId ? 'border-s112-teal ring-2 ring-s112-teal/20' : 'border-s112-border'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">{editId ? '✏ Buchung bearbeiten' : 'Neue Buchung'}</h2>
          {editId && <button onClick={resetForm} className="text-xs text-s112-muted hover:text-gray-700">✕ Abbrechen</button>}
        </div>
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
              {ks.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Kostenart</label>
            <select value={kaId} onChange={e => setKaId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Kostenart –</option>
              {ka.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Zuordnung</label>
            <select value={objektTyp} onChange={e => { setObjektTyp(e.target.value); setSelectedWgs([]); setBehId('') }}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– keine –</option>
              <option value="weingarten">Weingarten</option>
              <option value="keller">Keller / Behälter</option>
            </select>
          </div>
          {objektTyp === 'keller' && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Behälter (leer = alle)</label>
              <select value={behId} onChange={e => setBehId(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="">Alle Behälter</option>
                {bhs.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
          {objektTyp !== 'keller' && <div />}

          {/* Weingarten Multi-Select */}
          {objektTyp === 'weingarten' && (
            <div className="col-span-2 border border-s112-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-gray-700">Weingärten auswählen <span className="text-s112-muted font-normal">(leer = alle)</span></p>
                {selectedWgs.length > 1 && (
                  <div className="flex gap-1">
                    <button type="button" onClick={() => setSplitModus('gleich')}
                      className={`text-xs px-2 py-1 rounded ${splitModus==='gleich' ? 'bg-s112-teal text-white' : 'border border-s112-border text-gray-600'}`}>
                      Gleichmäßig
                    </button>
                    <button type="button" onClick={() => setSplitModus('prozent')}
                      className={`text-xs px-2 py-1 rounded ${splitModus==='prozent' ? 'bg-s112-teal text-white' : 'border border-s112-border text-gray-600'}`}>
                      Gewichtet %
                    </button>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                {wgs.map(w => {
                  const checked = selectedWgs.includes(w.id)
                  const b = parseFloat(betrag) || 0
                  const anteilEur = checked && b > 0
                    ? splitModus === 'gleich'
                      ? b / selectedWgs.length
                      : b * (anteile[w.id] ?? 0) / 100
                    : 0
                  return (
                    <div key={w.id} className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors
                      ${checked ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-border hover:border-s112-teal/40'}`}
                      onClick={() => toggleWg(w.id)}>
                      <input type="checkbox" checked={checked} onChange={() => toggleWg(w.id)} className="accent-s112-teal" />
                      <span className="text-sm flex-1">{w.name}</span>
                      {checked && splitModus === 'prozent' && (
                        <input type="number" min="0" max="100" step="0.1"
                          value={anteile[w.id] ?? ''}
                          onChange={e => { e.stopPropagation(); setAnteile(prev => ({ ...prev, [w.id]: parseFloat(e.target.value) || 0 })) }}
                          onClick={e => e.stopPropagation()}
                          className="w-16 border border-s112-border rounded px-1.5 py-0.5 text-xs text-right focus:outline-none"
                          placeholder="%" />
                      )}
                      {checked && b > 0 && (
                        <span className="text-xs text-s112-teal font-medium flex-shrink-0">{eur(anteilEur)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
              {selectedWgs.length > 1 && splitModus === 'prozent' && (
                <p className={`text-xs mt-2 ${Math.abs(anteilSumme - 100) < 0.5 ? 'text-green-600' : 'text-red-500'}`}>
                  Summe: {anteilSumme.toFixed(1)}% {Math.abs(anteilSumme - 100) < 0.5 ? '✓' : '(muss 100% ergeben)'}
                </p>
              )}
              {selectedWgs.length === 0 && <p className="text-xs text-s112-muted mt-1">Keine Auswahl = Kosten gelten für alle Weingärten</p>}
            </div>
          )}

          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Beschreibung</label>
            <input value={beschreibung} onChange={e => setBeschreibung(e.target.value)} placeholder="z.B. Traktor-Service, Spritzarbeit…"
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div className="col-span-2 flex items-center gap-3">
            <button type="submit" disabled={saving}
              className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
              {saving ? 'Speichern…' : editId ? 'Aktualisieren' : 'Buchen'}
            </button>
            {fehler && <p className="text-sm text-red-600">{fehler}</p>}
            {erfolg && <p className="text-sm text-green-600">✓ Gespeichert</p>}
          </div>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[['buchungen','📋 Buchungen'],['kostenstellen','🏢 Kostenstellen'],['kostenarten','🏷 Kostenarten']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id as Tab)}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${tab===id ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg text-gray-600 hover:bg-s112-teal/10'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'buchungen' && (
        <div className="bg-white rounded-2xl border border-s112-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-s112-bg text-xs text-s112-muted uppercase">
              <tr>
                <th className="px-4 py-3 text-left">Datum</th>
                <th className="px-4 py-3 text-left">Beschreibung</th>
                <th className="px-4 py-3 text-left">KSt / KA</th>
                <th className="px-4 py-3 text-left">Zuordnung</th>
                <th className="px-4 py-3 text-right">Betrag</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-s112-border/40">
              {eintraege.map(e => (
                <tr key={e.id} className={`hover:bg-s112-bg/30 ${editId===e.id?'bg-s112-teal/5':''}`}>
                  <td className="px-4 py-2.5 text-s112-muted tabular-nums">{new Date(e.datum).toLocaleDateString('de-AT')}</td>
                  <td className="px-4 py-2.5">{e.beschreibung ?? '–'}</td>
                  <td className="px-4 py-2.5 text-gray-600">
                    <div>{e.kostenstelle?.name ?? '–'}</div>
                    <div className="text-xs text-s112-muted">{e.kostenart?.name ?? ''}</div>
                  </td>
                  <td className="px-4 py-2.5 text-gray-600">
                    {e.objekt_typ === 'weingarten' ? (
                      <div>
                        <span className="text-xs">{wgLabel(e)}</span>
                        {e.wg_splits && e.wg_splits.length > 1 && (
                          <div className="text-[10px] text-s112-muted">
                            {e.wg_splits.map(s => `${s.wg?.name}: ${eur(s.betrag_anteil ?? 0)}`).join(' · ')}
                          </div>
                        )}
                      </div>
                    ) : e.objekt_typ === 'keller' ? (e.behaelter?.name ?? 'Alle Behälter') : '–'}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{eur(e.betrag)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex gap-2">
                      <button onClick={() => startEdit(e)} className="text-s112-muted hover:text-s112-teal text-xs">✏</button>
                      <button onClick={() => loeschen(e.id)} className="text-s112-muted hover:text-red-500 text-xs">✕</button>
                    </div>
                  </td>
                </tr>
              ))}
              {eintraege.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-s112-muted">Noch keine Buchungen</td></tr>}
            </tbody>
          </table>
        </div>
      )}


      {tab === 'kostenstellen' && <div className="bg-white rounded-2xl border border-s112-border p-5 space-y-2">{ks.map(k=><div key={k.id} className="text-sm">{k.name}</div>)}</div>}
      {tab === 'kostenarten'  && <div className="bg-white rounded-2xl border border-s112-border p-5 space-y-2">{ka.map(k=><div key={k.id} className="flex gap-3 text-sm"><span className="text-xs bg-s112-bg px-2 py-0.5 rounded text-s112-muted">{k.kategorie}</span><span>{k.name}</span></div>)}</div>}
    </div>
  )
}
