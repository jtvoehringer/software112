'use client'

import { useEffect, useState, useTransition } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from 'next/link'
import { useParams } from 'next/navigation'

type R = Record<string, any>

const EINHEITEN = ['kg', 'g', 'L', 'mL', 'mg', '-']

// g/hl Berechnung: menge in Einheit → umrechnen auf g, dann / volumen_liter * 100
function calcGProHl(menge: number, einheit: string, volumenLiter: number): string | null {
  if (!menge || !volumenLiter || volumenLiter <= 0) return null
  let mengeG: number | null = null
  if (einheit === 'kg') mengeG = menge * 1000
  else if (einheit === 'g')  mengeG = menge
  else if (einheit === 'mg') mengeG = menge / 1000
  else return null
  const gHl = (mengeG / volumenLiter) * 100
  return gHl.toLocaleString('de-AT', { maximumFractionDigits: 1 })
}

export default function KellerbehandlungenPage() {
  const params = useParams()
  const behaelterId = params.id as string
  const supabase = createSupabaseBrowserClient()

  const [behaelter, setBehaelter]       = useState<R | null>(null)
  const [behandlungen, setBehandlungen] = useState<R[]>([])
  const [typen, setTypen]               = useState<R[]>([])
  const [aktuellerInhalt, setAktuellerInhalt] = useState<number>(0)
  const [loading, setLoading]           = useState(true)
  const [isPending, startTransition]    = useTransition()

  // Formular-State
  const [showForm, setShowForm]           = useState(false)
  const [editId, setEditId]               = useState<string | null>(null)
  const [formDatum, setFormDatum]         = useState(new Date().toISOString().slice(0, 10))
  const [formTypId, setFormTypId]         = useState('')
  const [formMenge, setFormMenge]         = useState('')
  const [formEinheit, setFormEinheit]     = useState('kg')
  const [formVolumen, setFormVolumen]     = useState('')
  const [formNotizen, setFormNotizen]     = useState('')
  const [formError, setFormError]         = useState('')

  // Neuer Typ inline
  const [showNeuerTyp, setShowNeuerTyp]   = useState(false)
  const [neuerTypName, setNeuerTypName]   = useState('')
  const [neuerTypEinheit, setNeuerTypEinheit] = useState('kg')
  const [typSaving, setTypSaving]         = useState(false)

  async function loadData() {
    const [
      { data: bh },
      { data: bh_data },
      { data: typenData },
      { data: behandlungenData },
    ] = await Promise.all([
      (supabase.from('behaelter') as any).select('id, name, typ, volumen_liter, standort').eq('id', behaelterId).single(),
      (supabase.from('weinausbau') as any).select('menge_liter, aktiv').eq('behaelter_id', behaelterId).eq('aktiv', true),
      (supabase.from('keller_behandlungstypen') as any).select('id, name, einheit_standard').order('sort_order').order('name'),
      (supabase.from('keller_behandlungen') as any)
        .select('id, datum, typ_id, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
        .eq('behaelter_id', behaelterId)
        .order('datum', { ascending: false }),
    ])
    setBehaelter(bh)
    const inhalt = ((bh_data ?? []) as R[]).reduce((s: number, w: R) => s + (parseFloat(w.menge_liter) || 0), 0)
    setAktuellerInhalt(inhalt)
    setTypen(typenData ?? [])
    setBehandlungen(behandlungenData ?? [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [behaelterId])

  function openNeu() {
    setEditId(null)
    setFormDatum(new Date().toISOString().slice(0, 10))
    setFormTypId(typen[0]?.id ?? '')
    setFormMenge('')
    setFormEinheit(typen[0]?.einheit_standard ?? 'kg')
    setFormVolumen(aktuellerInhalt > 0 ? aktuellerInhalt.toString() : '')
    setFormNotizen('')
    setFormError('')
    setShowNeuerTyp(false)
    setShowForm(true)
  }

  function openEdit(b: R) {
    setEditId(b.id)
    setFormDatum(b.datum)
    setFormTypId(b.typ_id ?? '')
    setFormMenge(b.menge != null ? String(b.menge) : '')
    setFormEinheit(b.einheit ?? 'kg')
    setFormVolumen(b.volumen_liter_ist != null ? String(b.volumen_liter_ist) : '')
    setFormNotizen(b.notizen ?? '')
    setFormError('')
    setShowNeuerTyp(false)
    setShowForm(true)
  }

  function onTypChange(id: string) {
    setFormTypId(id)
    const typ = typen.find(t => t.id === id)
    if (typ?.einheit_standard) setFormEinheit(typ.einheit_standard)
  }

  async function saveNeuerTyp() {
    if (!neuerTypName.trim()) return
    setTypSaving(true)
    const { data: session } = await (supabase.auth as any).getSession()
    const userId = session?.session?.user?.id
    const { data: memberRow } = await (supabase.from('tenant_memberships') as any)
      .select('tenant_id').eq('user_id', userId).single()
    const { data: neu } = await (supabase.from('keller_behandlungstypen') as any)
      .insert({ tenant_id: memberRow.tenant_id, name: neuerTypName.trim(), einheit_standard: neuerTypEinheit || null })
      .select('id, name, einheit_standard').single()
    if (neu) {
      setTypen(prev => [...prev, neu])
      setFormTypId(neu.id)
      setFormEinheit(neu.einheit_standard ?? 'kg')
    }
    setNeuerTypName('')
    setNeuerTypEinheit('kg')
    setShowNeuerTyp(false)
    setTypSaving(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!formTypId) { setFormError('Bitte einen Behandlungstyp wählen.'); return }

    const typ = typen.find(t => t.id === formTypId)
    const payload: R = {
      behaelter_id:      behaelterId,
      datum:             formDatum,
      typ_id:            formTypId,
      typ_name_snapshot: typ?.name ?? '',
      menge:             formMenge ? parseFloat(formMenge.replace(',', '.')) : null,
      einheit:           formEinheit || null,
      volumen_liter_ist: formVolumen ? parseFloat(formVolumen.replace(',', '.')) : null,
      notizen:           formNotizen || null,
    }

    startTransition(async () => {
      if (editId) {
        await (supabase.from('keller_behandlungen') as any)
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId)
      } else {
        const { data: session } = await (supabase.auth as any).getSession()
        const userId = session?.session?.user?.id
        const { data: memberRow } = await (supabase.from('tenant_memberships') as any)
          .select('tenant_id').eq('user_id', userId).single()
        await (supabase.from('keller_behandlungen') as any)
          .insert({ ...payload, tenant_id: memberRow.tenant_id })
      }
      setShowForm(false)
      loadData()
    })
  }

  async function handleDelete(id: string) {
    if (!confirm('Behandlung löschen?')) return
    await (supabase.from('keller_behandlungen') as any).delete().eq('id', id)
    loadData()
  }

  const gHl = formMenge && formVolumen && formEinheit !== '-'
    ? calcGProHl(parseFloat(formMenge.replace(',', '.')), formEinheit, parseFloat(formVolumen.replace(',', '.')))
    : null

  if (loading) return <div className="p-6 text-s112-muted text-sm">Lade…</div>
  if (!behaelter) return <div className="p-6 text-red-500 text-sm">Behälter nicht gefunden.</div>

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-teal transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{behaelter.name}</span>
        <span>/</span>
        <span className="text-gray-500">Kellerbehandlungen</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">🧪 Kellerbehandlungen – {behaelter.name}</h1>
        <button onClick={openNeu}
          className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg hover:bg-opacity-90 font-medium">
          + Neue Behandlung
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-s112-border">
        <Link href={`/kellerbuch/behaelter/${behaelterId}/bewegungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          📊 Bewegungsbuch
        </Link>
        <Link href={`/kellerbuch/behaelter/${behaelterId}/umzuege`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-gray-700 border-b-2 border-transparent hover:border-gray-300 -mb-px transition-colors">
          ↔️ Umziehen
        </Link>
        <span className="px-4 py-2 text-sm font-medium text-s112-teal border-b-2 border-s112-teal -mb-px">
          🧪 Kellerbehandlungen
        </span>
      </div>

      {/* Formular */}
      {showForm && (
        <div className="card p-5 border-s112-teal/30 border-2">
          <h2 className="font-semibold text-gray-800 mb-4 text-sm">
            {editId ? 'Behandlung bearbeiten' : 'Neue Behandlung'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
                <input type="date" value={formDatum} onChange={e => setFormDatum(e.target.value)}
                  className="input w-full" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Behandlungstyp *</label>
                {!showNeuerTyp ? (
                  <div className="flex gap-2">
                    <select value={formTypId} onChange={e => onTypChange(e.target.value)}
                      className="input flex-1" required>
                      <option value="">– wählen –</option>
                      {typen.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setShowNeuerTyp(true)}
                      className="text-xs text-s112-teal border border-s112-teal/30 px-2 rounded-lg hover:bg-s112-teal hover:text-white transition-colors whitespace-nowrap">
                      + Neu
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2 items-end">
                    <input type="text" value={neuerTypName} onChange={e => setNeuerTypName(e.target.value)}
                      placeholder="Typbezeichnung" className="input flex-1" autoFocus />
                    <select value={neuerTypEinheit} onChange={e => setNeuerTypEinheit(e.target.value)}
                      className="input w-20">
                      {EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                    <button type="button" onClick={saveNeuerTyp} disabled={typSaving}
                      className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg disabled:opacity-50">
                      {typSaving ? '…' : 'Speichern'}
                    </button>
                    <button type="button" onClick={() => setShowNeuerTyp(false)}
                      className="text-xs text-s112-muted hover:text-gray-700">Abbrechen</button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Menge</label>
                <input type="text" value={formMenge} onChange={e => setFormMenge(e.target.value)}
                  placeholder="0,00" className="input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Einheit</label>
                <select value={formEinheit} onChange={e => setFormEinheit(e.target.value)} className="input w-full">
                  {EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Volumen Ist (L)
                  {gHl && (
                    <span className="ml-2 text-s112-teal font-semibold">= {gHl} g/hl</span>
                  )}
                </label>
                <input type="text" value={formVolumen} onChange={e => setFormVolumen(e.target.value)}
                  placeholder={aktuellerInhalt > 0 ? aktuellerInhalt.toLocaleString('de-AT') : '0'}
                  className="input w-full" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
              <textarea value={formNotizen} onChange={e => setFormNotizen(e.target.value)}
                rows={2} className="input w-full resize-none" placeholder="Optionale Anmerkungen…" />
            </div>

            {formError && <p className="text-red-500 text-xs">{formError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowForm(false)}
                className="text-xs text-s112-muted border border-gray-200 px-4 py-1.5 rounded-lg hover:border-gray-400">
                Abbrechen
              </button>
              <button type="submit" disabled={isPending}
                className="text-xs bg-s112-teal text-white px-4 py-1.5 rounded-lg hover:bg-opacity-90 disabled:opacity-50">
                {isPending ? 'Speichern…' : (editId ? 'Aktualisieren' : 'Speichern')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste */}
      {behandlungen.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-2xl mb-2">🧪</p>
          <p className="text-sm text-s112-muted">Noch keine Kellerbehandlungen erfasst</p>
          <button onClick={openNeu}
            className="mt-3 text-xs text-s112-teal font-semibold hover:underline">
            + Erste Behandlung erfassen
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Behandlung</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">g/hl</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-gray-500">Volumen Ist</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {behandlungen.map((b: R) => {
                const typName = (b.typ as R | null)?.name ?? b.typ_name_snapshot ?? '–'
                const menge   = b.menge != null ? parseFloat(b.menge) : null
                const vol     = b.volumen_liter_ist != null ? parseFloat(b.volumen_liter_ist) : null
                const ghl     = menge != null && vol != null && b.einheit
                  ? calcGProHl(menge, b.einheit, vol) : null
                return (
                  <tr key={b.id} className="border-b border-s112-border/30 last:border-0 hover:bg-s112-bg/40">
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {new Date(b.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-gray-800">{typName}</p>
                      {b.notizen && <p className="text-xs text-s112-muted">{b.notizen}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700">
                      {menge != null && b.einheit !== '-'
                        ? `${menge.toLocaleString('de-AT')} ${b.einheit ?? ''}`
                        : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-teal">
                      {ghl ? `${ghl} g/hl` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500 text-xs">
                      {vol != null ? `${vol.toLocaleString('de-AT')} L` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openEdit(b)}
                          className="text-xs text-s112-teal hover:underline">Bearbeiten</button>
                        <button onClick={() => handleDelete(b.id)}
                          className="text-xs text-red-400 hover:text-red-600 hover:underline">Löschen</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
