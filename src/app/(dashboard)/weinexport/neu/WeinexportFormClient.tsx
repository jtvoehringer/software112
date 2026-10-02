'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { Trash2 } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import LandOptionen from '@/components/crm/LandOptionen'   // KAN-187: Bestimmungsland als ISO-Code aus dem Länderkatalog
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const INCOTERMS = ['EXW','FCA','FAS','FOB','CFR','CIF','CPT','CIP','DAP','DPU','DDP']
const TRANSPORT = ['LKW','Bahn','Schiff','Flugzeug','Kurier']

interface Props { kontakte: R[]; firmen: R[]; fuellungen: R[]; tenantId: string }

export default function WeinexportFormClient({ kontakte, firmen, fuellungen, tenantId }: Props) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<string|null>(null)

  // Kopfdaten
  const [empfaengerTyp, setEmpfaengerTyp] = useState<'kontakt'|'firma'>('firma')
  const [kontaktId, setKontaktId]   = useState('')
  const [firmaId, setFirmaId]       = useState('')
  const [datum, setDatum]           = useState(new Date().toISOString().split('T')[0])
  const [lieferdatum, setLieferdatum] = useState('')
  const [incoterms, setIncoterms]   = useState('EXW')
  const [transportArt, setTransportArt] = useState('LKW')
  const [destLand, setDestLand]     = useState('')
  const [destStadt, setDestStadt]   = useState('')
  const [eori, setEori]             = useState('')
  const [versicherung, setVersicherung] = useState('')
  const [notizen, setNotizen]       = useState('')

  // Positionen
  const [positionen, setPositionen] = useState<R[]>([])

  function addPosition() {
    setPositionen(p => [...p, { fullung_id: '', beschreibung: '', menge: '', einheit: 'Fl', preis_eur: '', taric_code: '2204.21' }])
  }
  function updatePos(i: number, field: string, val: string) {
    setPositionen(p => p.map((pos, idx) => idx === i ? { ...pos, [field]: val } : pos))
  }
  function removePos(i: number) {
    setPositionen(p => p.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true); setFehler(null)
    try {
      const res = await fetch('/api/weinexport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenant_id: tenantId,
          kontakt_id: empfaengerTyp === 'kontakt' ? kontaktId || null : null,
          firma_id:   empfaengerTyp === 'firma'   ? firmaId   || null : null,
          datum, lieferdatum: lieferdatum || null,
          incoterms, transport_art: transportArt,
          destination_land: destLand, destination_stadt: destStadt,
          eori_kunde: eori || null,
          versicherungswert: versicherung ? parseFloat(versicherung) : null,
          notizen: notizen || null,
          positionen,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setFehler(data.fehler ?? 'Fehler'); setSaving(false); return }
      router.push(`/weinexport/${data.id}`)
    } catch (err) { setFehler(String(err)); setSaving(false) }
  }

  const gesamtEUR = positionen.reduce((s, p) => s + (parseFloat(p.menge)||0) * (parseFloat(p.preis_eur)||0), 0)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/weinexport" className="hover:text-s112-blue-700 transition-colors">Weinexport</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Neuer Exportauftrag</span>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">Neuer Exportauftrag</h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Importeur */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <h2 className="font-semibold text-s112-text mb-4">Importeur / Empfänger</h2>
          <div className="flex gap-2 mb-4">
            <button type="button" onClick={() => setEmpfaengerTyp('firma')}
              className={`px-4 py-1.5 rounded-lg text-sm border ${empfaengerTyp==='firma'?'bg-s112-teal text-s112-yellow border-s112-teal':'border-s112-border text-s112-text-2'}`}>
              Firma
            </button>
            <button type="button" onClick={() => setEmpfaengerTyp('kontakt')}
              className={`px-4 py-1.5 rounded-lg text-sm border ${empfaengerTyp==='kontakt'?'bg-s112-teal text-s112-yellow border-s112-teal':'border-s112-border text-s112-text-2'}`}>
              Kontakt
            </button>
          </div>
          {empfaengerTyp === 'firma' ? (
            <select value={firmaId} onChange={e => setFirmaId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Firma wählen –</option>
              {firmen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ) : (
            <select value={kontaktId} onChange={e => setKontaktId(e.target.value)}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Kontakt wählen –</option>
              {kontakte.map(k => <option key={k.id} value={k.id}>{k.vorname} {k.nachname}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">EORI-Nummer Importeur</label>
              <input aria-label="EORI-Nummer Importeur" value={eori} onChange={e => setEori(e.target.value)} placeholder="z.B. AT1234567890"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Versicherungswert (EUR)</label>
              <input aria-label="Versicherungswert (EUR)" type="number" value={versicherung} onChange={e => setVersicherung(e.target.value)} placeholder="0.00"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        </div>

        {/* Logistik */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <h2 className="font-semibold text-s112-text mb-4">Logistik & Destination</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Auftragsdatum</label>
              <input aria-label="Auftragsdatum" type="date" value={datum} onChange={e => setDatum(e.target.value)} required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Lieferdatum (geplant)</label>
              <input aria-label="Lieferdatum (geplant)" type="date" value={lieferdatum} onChange={e => setLieferdatum(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Incoterms</label>
              <select aria-label="Incoterms" value={incoterms} onChange={e => setIncoterms(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                {INCOTERMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Transportart</label>
              <select aria-label="Transportart" value={transportArt} onChange={e => setTransportArt(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                {TRANSPORT.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Destination Land *</label>
              <select aria-label="Destination Land" value={destLand} onChange={e => setDestLand(e.target.value)} required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
                <option value="">– Land wählen –</option>
                <LandOptionen aktuell={destLand} />
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Destination Stadt</label>
              <input aria-label="Destination Stadt" value={destStadt} onChange={e => setDestStadt(e.target.value)} placeholder="z.B. München"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        </div>

        {/* Positionen */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-s112-text">Weinpositionen</h2>
            <button type="button" onClick={addPosition}
              className="text-xs text-s112-blue-700 border border-s112-teal px-3 py-1 rounded-lg hover:bg-s112-teal/5">
              + Position
            </button>
          </div>
          {positionen.length === 0 && (
            <p className="text-sm text-s112-muted text-center py-4">Noch keine Positionen – klick &quot;+ Position&quot;</p>
          )}
          {positionen.map((pos, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-3 items-start">
              <div className="col-span-4">
                <select value={pos.fullung_id} onChange={e => {
                  const f = fuellungen.find(f => f.id === e.target.value)
                  updatePos(i, 'fullung_id', e.target.value)
                  if (f) {
                    updatePos(i, 'beschreibung', [f.name, f.bezeichnung].filter(Boolean).join(' – '))
                    if (f.zolltarifnummer) updatePos(i, 'taric_code', f.zolltarifnummer.replace(/\s/g, '').replace(/^(\d{4})(\d+)$/, '$1.$2'))
                  }
                }} className="w-full border border-s112-border rounded px-2 py-1.5 text-xs focus:outline-none">
                  <option value="">– Füllung –</option>
                  {fuellungen.map(f => <option key={f.id} value={f.id}>{f.name}{f.bezeichnung ? ' – ' + f.bezeichnung : ''}{f.jahrgang ? ' ' + f.jahrgang : ''} ({f.bestand_flaschen} Fl.)</option>)}
                </select>
              </div>
              <div className="col-span-3">
                <input value={pos.beschreibung} onChange={e => updatePos(i, 'beschreibung', e.target.value)}
                  placeholder="Bezeichnung" className="w-full border border-s112-border rounded px-2 py-1.5 text-xs focus:outline-none" />
              </div>
              <div className="col-span-1">
                <input type="number" value={pos.menge} onChange={e => updatePos(i, 'menge', e.target.value)}
                  placeholder="Menge" className="w-full border border-s112-border rounded px-2 py-1.5 text-xs focus:outline-none" />
              </div>
              <div className="col-span-1">
                <select value={pos.einheit} onChange={e => updatePos(i, 'einheit', e.target.value)}
                  className="w-full border border-s112-border rounded px-2 py-1.5 text-xs focus:outline-none">
                  <option>Fl</option><option>Kiste</option><option>HL</option>
                </select>
              </div>
              <div className="col-span-2">
                <input type="number" step="0.01" value={pos.preis_eur} onChange={e => updatePos(i, 'preis_eur', e.target.value)}
                  placeholder="€/Einheit" className="w-full border border-s112-border rounded px-2 py-1.5 text-xs focus:outline-none" />
              </div>
              <div className="col-span-1 flex justify-center pt-1">
                <button aria-label="Entfernen" type="button" onClick={() => removePos(i)} className="text-s112-err hover:text-s112-err-fg text-xs">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {positionen.length > 0 && (
            <div className="text-right text-sm font-semibold text-s112-text border-t border-s112-border pt-3 mt-2">
              Gesamt: EUR {fmtNum(gesamtEUR, 2)}
            </div>
          )}
        </div>

        {/* Notizen */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen / Besonderheiten</label>
          <textarea aria-label="Notizen / Besonderheiten" value={notizen} onChange={e => setNotizen(e.target.value)} rows={3}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
        </div>

        {fehler && <p className="text-s112-err-fg text-sm">{fehler}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
            {saving ? 'Speichern…' : 'Exportauftrag anlegen'}
          </button>
          <Link href="/weinexport" className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-s112-text-2 hover:bg-s112-bg">
            Abbrechen
          </Link>
        </div>
      </form>
    </div>
  )
}
