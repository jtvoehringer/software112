'use client'
import { useState, useEffect } from 'react'
import { Check, Pencil, Trash2 } from 'lucide-react'
import { fmtEur, fmtNum } from '@/lib/format'
import { heuteWien } from '@/lib/datum/wien'

type KS = { id: string; name: string; kuerzel?: string; beschreibung?: string }
type KA = { id: string; name: string; kuerzel?: string; kategorie?: string }
type WG = { id: string; name: string }
type BH = { id: string; name: string; typ?: string }
type Split = { kosteneintrag_id?: string; weingarten_id?: string; behaelter_id?: string; anteil_pct?: number; betrag_anteil?: number; wg?: { name: string }; bh?: { name: string } }
type Eintrag = {
  id: string; datum: string; betrag: number; beschreibung: string | null
  objekt_typ: string | null; periode: string | null; transaktions_nr: string | null
  kostenstelle: { name: string } | null; kostenart: { name: string } | null
  wg_splits?: Split[]; bh_splits?: Split[]
}
type Tab = 'buchungen' | 'kostenstellen' | 'kostenarten'
const KAT = ['betriebsmittel','personal','energie','abschreibung','pacht','sonstiges']

function eur(n: number) { return fmtEur(n) }

function MultiSelect({ items, selected, onToggle, splitModus, setSplitModus, anteile, setAnteile, betrag, label }: {
  items: { id: string; name: string; typ?: string }[]
  selected: string[]; onToggle: (id: string) => void
  splitModus: 'gleich'|'prozent'; setSplitModus: (m: 'gleich'|'prozent') => void
  anteile: Record<string,number>; setAnteile: (a: Record<string,number>) => void
  betrag: number; label: string
}) {
  const total = selected.reduce((s, id) => s + (anteile[id] ?? 0), 0)
  return (
    <div className="col-span-2 border border-s112-border rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-s112-text-1">{label} <span className="text-s112-muted font-normal">(leer = alle)</span></p>
        {selected.length > 1 && (
          <div className="flex gap-1">
            {(['gleich','prozent'] as const).map(m => (
              <button key={m} type="button" onClick={() => setSplitModus(m)}
                className={`text-xs px-2 py-1 rounded-sm ${splitModus===m ? 'bg-s112-teal text-s112-yellow' : 'border border-s112-border text-s112-text-2'}`}>
                {m === 'gleich' ? 'Gleichmäßig' : 'Gewichtet %'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {items.map(w => {
          const checked = selected.includes(w.id)
          const anteilEur = checked && betrag > 0
            ? splitModus === 'gleich' ? betrag / selected.length : betrag * (anteile[w.id] ?? 0) / 100
            : 0
          return (
            <div key={w.id} onClick={() => onToggle(w.id)}
              className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors
                ${checked ? 'border-s112-teal bg-s112-teal/5' : 'border-s112-border hover:border-s112-teal/40'}`}>
              <input type="checkbox" checked={checked} onChange={() => onToggle(w.id)} className="accent-s112-teal" onClick={e => e.stopPropagation()} />
              <span className="text-sm flex-1">{w.name}{w.typ ? ` (${w.typ})` : ''}</span>
              {checked && splitModus === 'prozent' && (
                <input type="number" min="0" max="100" step="0.1" value={anteile[w.id] ?? ''}
                  onChange={e => { e.stopPropagation(); setAnteile({ ...anteile, [w.id]: parseFloat(e.target.value)||0 }) }}
                  onClick={e => e.stopPropagation()}
                  className="w-14 border border-s112-border rounded-sm px-1.5 py-0.5 text-xs text-right focus:outline-hidden" placeholder="%" />
              )}
              {checked && betrag > 0 && <span className="text-xs text-s112-blue-700 font-medium shrink-0">{eur(anteilEur)}</span>}
            </div>
          )
        })}
      </div>
      {selected.length > 1 && splitModus === 'prozent' && (
        <p className={`text-xs mt-2 inline-flex items-center gap-1 ${Math.abs(total-100)<0.5 ? 'text-s112-ok-fg' : 'text-s112-err'}`}>
          Summe: {fmtNum(total, { max: 1 })}% {Math.abs(total-100)<0.5 ? <Check size={12} /> : '(muss 100% ergeben)'}
        </p>
      )}
      {selected.length === 0 && <p className="text-xs text-s112-muted mt-1">Keine Auswahl = gilt für alle</p>}
    </div>
  )
}

function StammdatenTab({ items, onSave, onDelete, fields }: {
  items: Record<string, string|undefined>[]  // eslint-disable-line @typescript-eslint/no-explicit-any
  onSave: (item: Record<string, string|undefined>) => Promise<void>
  onDelete: (id: string) => Promise<void>
  fields: { key: string; label: string; type?: string; options?: string[] }[]
}) {
  const [editId, setEditId] = useState<string|null>(null)
  const [form, setForm] = useState<Record<string,string>>({})
  const [neu, setNeu] = useState(false)

  function startEdit(item: typeof items[0]) {
    setEditId(item.id ?? null); setNeu(false)
    setForm(Object.fromEntries(fields.map(f => [f.key, item[f.key] ?? ''])))
  }
  function startNeu() { setNeu(true); setEditId(null); setForm({}) }
  async function save() {
    await onSave({ ...(editId ? { id: editId } : {}), ...form })
    setEditId(null); setNeu(false); setForm({})
  }

  return (
    <div className="bg-white rounded-xl border border-s112-border p-5">
      <div className="flex justify-between items-center mb-4">
        <p className="text-sm text-s112-muted">{items.length} Einträge</p>
        <button onClick={startNeu} className="text-xs bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg hover:bg-s112-teal/90">+ Neu</button>
      </div>
      {(neu || editId) && (
        <div className="border border-s112-teal/30 rounded-xl p-4 mb-4 space-y-3 bg-s112-teal/5">
          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">{f.label}</label>
              {f.options ? (
                <select value={form[f.key]??''} onChange={e => setForm({...form,[f.key]:e.target.value})}
                  className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden">
                  <option value="">– wählen –</option>
                  {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                </select>
              ) : (
                <input value={form[f.key]??''} onChange={e => setForm({...form,[f.key]:e.target.value})}
                  className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-hidden" />
              )}
            </div>
          ))}
          <div className="flex gap-2">
            <button onClick={save} className="text-xs bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg hover:bg-s112-teal/90">Speichern</button>
            <button onClick={() => { setEditId(null); setNeu(false) }} className="text-xs border border-s112-border px-4 py-1.5 rounded-lg hover:bg-s112-bg">Abbrechen</button>
          </div>
        </div>
      )}
      <div className="divide-y divide-s112-border/40">
        {items.map(item => (
          <div key={item.id} className="flex items-center gap-3 py-2.5">
            {item.kuerzel && <span className="font-mono text-xs text-s112-muted w-12">{item.kuerzel}</span>}
            {item.kategorie && <span className="text-xs bg-s112-bg px-2 py-0.5 rounded-sm text-s112-muted">{item.kategorie}</span>}
            <span className="text-sm flex-1">{item.name}</span>
            <button aria-label="Bearbeiten" onClick={() => startEdit(item)} className="text-xs text-s112-muted hover:text-s112-blue-700"><Pencil size={13} /></button>
            <button onClick={() => { if(confirm(`"${item.name}" deaktivieren?`)) onDelete(item.id ?? '') }} className="text-xs text-s112-muted hover:text-s112-err"><Trash2 size={13} /></button>
          </div>
        ))}
        {items.length === 0 && <p className="text-xs text-s112-muted py-4 text-center">Noch keine Einträge</p>}
      </div>
    </div>
  )
}

export default function KostenrechnungPage() {
  const [tab, setTab] = useState<Tab>('buchungen')
  const [eintraege, setEintraege] = useState<Eintrag[]>([])
  const [ks, setKs] = useState<KS[]>([])
  const [ka, setKa] = useState<KA[]>([])
  const [wgs, setWgs] = useState<WG[]>([])
  const [bhs, setBhs] = useState<BH[]>([])
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<string|null>(null)
  const [erfolg, setErfolg] = useState(false)

  const [editId, setEditId] = useState<string|null>(null)
  const [ksId, setKsId] = useState('')
  const [kaId, setKaId] = useState('')
  const [datum, setDatum] = useState(heuteWien())
  const [betrag, setBetrag] = useState('')
  const [beschreibung, setBeschreibung] = useState('')
  const [objektTyp, setObjektTyp] = useState('')
  const [selWgs, setSelWgs] = useState<string[]>([])
  const [wgModus, setWgModus] = useState<'gleich'|'prozent'>('gleich')
  const [wgAnteile, setWgAnteile] = useState<Record<string,number>>({})
  const [selBhs, setSelBhs] = useState<string[]>([])
  const [bhModus, setBhModus] = useState<'gleich'|'prozent'>('gleich')
  const [bhAnteile, setBhAnteile] = useState<Record<string,number>>({})

  const api = (body: object) => fetch('/api/kostenrechnung', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())

  const ladeDaten = async () => {
    const [e, k, a, w, b] = await Promise.all([
      fetch('/api/kostenrechnung?action=eintraege').then(r => r.json()),
      fetch('/api/kostenrechnung?action=kostenstellen').then(r => r.json()),
      fetch('/api/kostenrechnung?action=kostenarten').then(r => r.json()),
      fetch('/api/kostenrechnung?action=weingaerten').then(r => r.json()),
      fetch('/api/kostenrechnung?action=behaelter').then(r => r.json()),
    ])
    setEintraege(e.eintraege ?? []); setKs(k.kostenstellen ?? [])
    setKa(a.kostenarten ?? []); setWgs(w.weingaerten ?? []); setBhs(b.behaelter ?? [])
  }
  useEffect(() => { ladeDaten() }, [])

  function toggle(id: string, sel: string[], setSel: (s: string[]) => void) {
    setSel(sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id])
  }

  function resetForm() {
    setEditId(null); setKsId(''); setKaId('')
    setDatum(heuteWien())
    setBetrag(''); setBeschreibung(''); setObjektTyp('')
    setSelWgs([]); setWgModus('gleich'); setWgAnteile({})
    setSelBhs([]); setBhModus('gleich'); setBhAnteile({})
  }

  function startEdit(e: Eintrag) {
    setEditId(e.id); setDatum(e.datum); setBetrag(String(e.betrag))
    setBeschreibung(e.beschreibung ?? ''); setObjektTyp(e.objekt_typ ?? '')
    setKsId(ks.find(k => k.name === e.kostenstelle?.name)?.id ?? '')
    setKaId(ka.find(k => k.name === e.kostenart?.name)?.id ?? '')
    if (e.wg_splits?.length) {
      setSelWgs(e.wg_splits.map(s => s.weingarten_id!))
      const a: Record<string,number> = {}; e.wg_splits.forEach(s => { if(s.weingarten_id) a[s.weingarten_id] = s.anteil_pct ?? 0 })
      setWgAnteile(a); setWgModus(e.wg_splits.every(s=>!s.anteil_pct) ? 'gleich' : 'prozent')
    } else { setSelWgs([]); setWgAnteile({}) }
    if (e.bh_splits?.length) {
      setSelBhs(e.bh_splits.map(s => s.behaelter_id!))
      const a: Record<string,number> = {}; e.bh_splits.forEach(s => { if(s.behaelter_id) a[s.behaelter_id] = s.anteil_pct ?? 0 })
      setBhAnteile(a); setBhModus(e.bh_splits.every(s=>!s.anteil_pct) ? 'gleich' : 'prozent')
    } else { setSelBhs([]); setBhAnteile({}) }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function buildSplit(sel: string[], modus: 'gleich'|'prozent', anteile: Record<string,number>, fk: string): Record<string,string|number>[] {
    if (!sel.length) return []
    return modus === 'gleich' ? sel.map(id => ({ [fk]: id })) : sel.map(id => ({ [fk]: id, anteil_pct: anteile[id] ?? 0 }))
  }

  async function buchen(e: React.FormEvent) {
    e.preventDefault()
    const b = parseFloat(betrag)
    if (objektTyp === 'weingarten' && selWgs.length > 1 && wgModus === 'prozent') {
      const t = selWgs.reduce((s, id) => s + (wgAnteile[id]??0), 0)
      if (Math.abs(t-100) > 0.5) { setFehler(`WG-Anteile: ${t.toFixed(1)}% ≠ 100%`); return }
    }
    if (objektTyp === 'keller' && selBhs.length > 1 && bhModus === 'prozent') {
      const t = selBhs.reduce((s, id) => s + (bhAnteile[id]??0), 0)
      if (Math.abs(t-100) > 0.5) { setFehler(`Behälter-Anteile: ${t.toFixed(1)}% ≠ 100%`); return }
    }
    setSaving(true); setFehler(null); setErfolg(false)
    const res = await api({
      action: editId ? 'aktualisieren' : 'eintrag', id: editId,
      kostenstelle_id: ksId||null, kostenart_id: kaId||null,
      datum, betrag: b, beschreibung: beschreibung||null, objekt_typ: objektTyp||null,
      wg_split: objektTyp === 'weingarten' ? buildSplit(selWgs, wgModus, wgAnteile, 'weingarten_id') : [],
      bh_split: objektTyp === 'keller'     ? buildSplit(selBhs, bhModus, bhAnteile, 'behaelter_id') : [],
    })
    if (res.fehler) { setFehler(res.fehler); setSaving(false); return }
    setErfolg(true); resetForm(); await ladeDaten()
    setSaving(false); setTimeout(() => setErfolg(false), 3000)
  }

  const gesamtJahr = eintraege.filter(e=>e.datum?.startsWith(new Date().getFullYear().toString())).reduce((s,e)=>s+e.betrag,0)

  const splitLabel = (e: Eintrag) => {
    if (e.objekt_typ === 'weingarten') {
      if (!e.wg_splits?.length) return 'Alle WG'
      return e.wg_splits.length === 1 ? (e.wg_splits[0].wg?.name ?? '?') : `${e.wg_splits.length} WG`
    }
    if (e.objekt_typ === 'keller') {
      if (!e.bh_splits?.length) return 'Alle Behälter'
      return e.bh_splits.length === 1 ? (e.bh_splits[0].bh?.name ?? '?') : `${e.bh_splits.length} Behälter`
    }
    return '–'
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <span>Controlling</span>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Kostenrechnung</span>
      </div>
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Kostenrechnung</h1>
        <p className="text-sm text-s112-muted mt-0.5">{new Date().getFullYear()}: <strong className="text-s112-text">{eur(gesamtJahr)}</strong></p>
      </div>

      {/* Formular */}
      <div className={`bg-white rounded-xl border p-5 ${editId ? 'border-s112-teal ring-2 ring-s112-teal/20' : 'border-s112-border'}`}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-s112-text">
            {editId ? <span className="inline-flex items-center gap-1.5"><Pencil size={15} />Buchung bearbeiten</span> : 'Neue Buchung'}
          </h2>
          {editId && <button onClick={resetForm} className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>}
        </div>
        <form onSubmit={buchen} className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Datum</label>
            <input aria-label="Datum" type="date" value={datum} onChange={e=>setDatum(e.target.value)} required className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" /></div>
          <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Betrag (€)</label>
            <input aria-label="Betrag (€)" type="number" step="0.01" value={betrag} onChange={e=>setBetrag(e.target.value)} required placeholder="0,00" className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" /></div>
          <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Kostenstelle</label>
            <select aria-label="Kostenstelle" value={ksId} onChange={e=>setKsId(e.target.value)} className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Kostenstelle –</option>{ks.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}</select></div>
          <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Kostenart</label>
            <select aria-label="Kostenart" value={kaId} onChange={e=>setKaId(e.target.value)} className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Kostenart –</option>{ka.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}</select></div>
          <div><label className="block text-xs font-medium text-s112-text-2 mb-1">Zuordnung</label>
            <select aria-label="Zuordnung" value={objektTyp} onChange={e=>{setObjektTyp(e.target.value);setSelWgs([]);setSelBhs([])}} className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– keine –</option><option value="weingarten">Ried</option><option value="keller">Keller / Behälter</option></select></div>
          <div />
          {objektTyp === 'weingarten' && (
            <MultiSelect items={wgs} selected={selWgs} onToggle={id=>toggle(id,selWgs,setSelWgs)}
              splitModus={wgModus} setSplitModus={setWgModus} anteile={wgAnteile} setAnteile={setWgAnteile}
              betrag={parseFloat(betrag)||0} label="Weingärten auswählen" />
          )}
          {objektTyp === 'keller' && (
            <MultiSelect items={bhs} selected={selBhs} onToggle={id=>toggle(id,selBhs,setSelBhs)}
              splitModus={bhModus} setSplitModus={setBhModus} anteile={bhAnteile} setAnteile={setBhAnteile}
              betrag={parseFloat(betrag)||0} label="Behälter auswählen" />
          )}
          <div className="col-span-2"><label className="block text-xs font-medium text-s112-text-2 mb-1">Beschreibung</label>
            <input aria-label="Beschreibung" value={beschreibung} onChange={e=>setBeschreibung(e.target.value)} placeholder="z.B. Traktor-Service, Spritzarbeit…" className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" /></div>
          <div className="col-span-2 flex items-center gap-3">
            <button type="submit" disabled={saving} className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
              {saving ? 'Speichern…' : editId ? 'Aktualisieren' : 'Buchen'}</button>
            {fehler && <p className="text-sm text-s112-err-fg">{fehler}</p>}
            {erfolg && <p className="text-sm text-s112-ok-fg inline-flex items-center gap-1"><Check size={13} />Gespeichert</p>}
          </div>
        </form>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        {[['buchungen','Buchungen'],['kostenstellen','Kostenstellen'],['kostenarten','Kostenarten']].map(([id,label])=>(
          <button key={id} onClick={()=>setTab(id as Tab)}
            className={`px-4 py-2 rounded-xl text-sm font-medium ${tab===id?'bg-s112-teal text-s112-yellow':'bg-s112-bg text-s112-text-2 hover:bg-s112-teal/10'}`}>{label}</button>
        ))}
      </div>

      {tab === 'buchungen' && (
        <div className="bg-white rounded-xl border border-s112-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-s112-bg text-xs text-s112-muted uppercase">
              <tr><th className="px-4 py-3 text-left">TXN</th><th className="px-4 py-3 text-left">Datum</th><th className="px-4 py-3 text-left">Beschreibung</th><th className="px-4 py-3 text-left">KSt / KA</th><th className="px-4 py-3 text-left">Zuordnung</th><th className="px-4 py-3 text-right">Betrag</th><th className="px-4 py-3" /></tr>
            </thead>
            <tbody className="divide-y divide-s112-border/40">
              {eintraege.map(e=>(
                <tr key={e.id} className={`hover:bg-s112-bg/30 ${editId===e.id?'bg-s112-teal/5':''}`}>
                  <td className="px-4 py-2.5 font-mono text-xs text-s112-muted whitespace-nowrap">{e.transaktions_nr??'–'}</td>
                  <td className="px-4 py-2.5 text-s112-muted tabular-nums">{new Date(e.datum).toLocaleDateString('de-AT')}</td>
                  <td className="px-4 py-2.5">{e.beschreibung??'–'}</td>
                  <td className="px-4 py-2.5 text-s112-text-2"><div>{e.kostenstelle?.name??'–'}</div><div className="text-xs text-s112-muted">{e.kostenart?.name??''}</div></td>
                  <td className="px-4 py-2.5 text-s112-text-2">
                    <div className="text-xs">{splitLabel(e)}</div>
                    {(e.wg_splits?.length??0) > 1 && <div className="text-[11px] text-s112-muted">{e.wg_splits!.map(s=>`${s.wg?.name}: ${eur(s.betrag_anteil??0)}`).join(' · ')}</div>}
                    {(e.bh_splits?.length??0) > 1 && <div className="text-[11px] text-s112-muted">{e.bh_splits!.map(s=>`${s.bh?.name}: ${eur(s.betrag_anteil??0)}`).join(' · ')}</div>}
                  </td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums">{eur(e.betrag)}</td>
                  <td className="px-4 py-2.5"><div className="flex gap-2">
                    <button aria-label="Bearbeiten" onClick={()=>startEdit(e)} className="text-s112-muted hover:text-s112-blue-700 text-xs"><Pencil size={13} /></button>
                    <button onClick={()=>{if(confirm('Löschen?'))api({action:'loeschen',id:e.id}).then(ladeDaten)}} className="text-s112-muted hover:text-s112-err text-xs"><Trash2 size={13} /></button>
                  </div></td>
                </tr>
              ))}
              {eintraege.length===0 && <tr><td colSpan={6} className="text-center py-8 text-s112-muted">Noch keine Buchungen</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'kostenstellen' && (
        <StammdatenTab items={ks as Record<string,string|undefined>[]} onDelete={async id=>{await api({action:'ks_delete',id});ladeDaten()}}
          onSave={async item=>{await api({action:'ks_save',...item});ladeDaten()}}
          fields={[{key:'name',label:'Name *'},{key:'kuerzel',label:'Kürzel'},{key:'beschreibung',label:'Beschreibung'}]} />
      )}
      {tab === 'kostenarten' && (
        <StammdatenTab items={ka as Record<string,string|undefined>[]} onDelete={async id=>{await api({action:'ka_delete',id});ladeDaten()}}
          onSave={async item=>{await api({action:'ka_save',...item});ladeDaten()}}
          fields={[{key:'name',label:'Name *'},{key:'kuerzel',label:'Kürzel'},{key:'kategorie',label:'Kategorie',options:KAT}]} />
      )}
    </div>
  )
}
