'use client'

import { useEffect, useState, useTransition } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from '@/components/ui/Link'
import { useParams } from 'next/navigation'
import { FlaskConical, BarChart3, ArrowLeftRight, Pencil, Trash2 } from 'lucide-react'
import { fmtNum, dezimal } from '@/lib/format'

type R = Record<string, any>

const EINHEITEN = ['kg', 'g', 'L', 'mL', 'mg', '°C', '-']

// g/hl Berechnung: menge in Einheit → umrechnen auf g, dann / volumen_liter * 100
function calcGProHl(menge: number, einheit: string, volumenLiter: number): string | null {
  if (!menge || !volumenLiter || volumenLiter <= 0) return null
  let mengeG: number | null = null
  if (einheit === 'kg') mengeG = menge * 1000
  else if (einheit === 'g')  mengeG = menge
  else if (einheit === 'mg') mengeG = menge / 1000
  else return null
  const gHl = (mengeG / volumenLiter) * 100
  return fmtNum(gHl, { max: 1 })
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
  // Aktiver Tenant des Nutzers (client-seitig ermittelt, da diese Seite eine reine
  // Client-Komponente ist und die serverseitige getCurrentMembership()/Betrieb-Wechsler-
  // Cookie-Logik hier nicht direkt aufgerufen werden kann). Wird zusätzlich zu RLS als
  // expliziter Tenant-Filter verwendet, da RLS Zeilen aus JEDER Mitgliedschaft erlaubt.
  const [tenantId, setTenantId]         = useState<string | null>(null)

  // Formular-State
  const [chargenImBehaelter, setChargenImBehaelter] = useState<R[]>([])
  const [showForm, setShowForm]           = useState(false)
  const [editId, setEditId]               = useState<string | null>(null)
  const [formDatum, setFormDatum]         = useState(new Date().toISOString().slice(0, 10))
  const [formTypId, setFormTypId]         = useState('')
  const [formMenge, setFormMenge]         = useState('')
  const [formEinheit, setFormEinheit]     = useState('kg')
  const [formVolumen, setFormVolumen]     = useState('')
  const [formNotizen, setFormNotizen]     = useState('')
  const [formWeinausbauId, setFormWeinausbauId] = useState<string>('')
  const [formError, setFormError]         = useState('')

  // Neuer Typ inline
  const [showNeuerTyp, setShowNeuerTyp]   = useState(false)
  const [neuerTypName, setNeuerTypName]   = useState('')
  const [neuerTypEinheit, setNeuerTypEinheit] = useState('kg')
  const [typSaving, setTypSaving]         = useState(false)

  async function loadData() {
    // Aktiven Mandanten über /api/me/active-tenant ermitteln (nutzt serverseitig die
    // kanonische getCurrentMembership()-Logik inkl. Cookie-Validierung) statt einer eigenen,
    // ungefilterten tenant_memberships-Abfrage, die bei Mehrfach-Mitgliedschaft eine
    // BELIEBIGE statt der aktiv gewählten Mitgliedschaft treffen konnte.
    const activeTenantRes = await fetch('/api/me/active-tenant')
    const activeTenantJson = activeTenantRes.ok ? await activeTenantRes.json() : { tenantId: null }
    const activeTenantId = (activeTenantJson?.tenantId as string | undefined) ?? null
    setTenantId(activeTenantId)

    // Eigenes oder freigegebenes Gebinde (Kellergemeinschaft): über die RPC lade_behaelter,
    // damit auch Partner-Gebinde (Freigabe) sichtbar sind - Behandlungen selbst bleiben tenant-gefiltert.
    const behaelterQuery = activeTenantId
      ? (supabase.rpc as any)('lade_behaelter', { p_tenant_id: activeTenantId }).then((r: R) => ({ data: ((r.data ?? []) as R[]).find(b => b.id === behaelterId) ?? null }))
      : Promise.resolve({ data: null })
    let weinausbauQuery = (supabase.from('weinausbau') as any).select('id, name, menge_liter, aktiv').eq('behaelter_id', behaelterId).eq('aktiv', true)
    let behandlungenQuery = (supabase.from('keller_behandlungen') as any)
      .select('id, datum, typ_id, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
      .eq('behaelter_id', behaelterId)
      .order('datum', { ascending: false })
    let typenQuery = (supabase.from('keller_behandlungstypen') as any).select('id, name, einheit_standard').order('sort_order').order('name')
    if (activeTenantId) {
      weinausbauQuery   = weinausbauQuery.eq('tenant_id', activeTenantId)
      behandlungenQuery = behandlungenQuery.eq('tenant_id', activeTenantId)
      typenQuery        = typenQuery.eq('tenant_id', activeTenantId)
    }

    const [
      { data: bh },
      { data: bh_data },
      { data: typenData },
      { data: behandlungenData },
    ] = await Promise.all([
      behaelterQuery,
      weinausbauQuery,
      typenQuery,
      behandlungenQuery,
    ])
    setBehaelter(bh)
    const inhalt = ((bh_data ?? []) as R[]).reduce((s: number, w: R) => s + (parseFloat(w.menge_liter) || 0), 0)
    setAktuellerInhalt(inhalt)
    setChargenImBehaelter((bh_data ?? []) as R[])
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
    // Aktive Charge vorbelegen wenn genau eine im Behälter
    setFormWeinausbauId(chargenImBehaelter.length === 1 ? chargenImBehaelter[0].id : '')
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
    setFormWeinausbauId(b.weinausbau_id ?? '')
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
      menge:             formMenge ? parseFloat(dezimal(formMenge)) : null,
      einheit:           formEinheit || null,
      volumen_liter_ist: formVolumen ? parseFloat(dezimal(formVolumen)) : null,
      notizen:           formNotizen || null,
      weinausbau_id:     formWeinausbauId || null,
    }

    startTransition(async () => {
      if (editId) {
        let updateQuery = (supabase.from('keller_behandlungen') as any)
          .update({ ...payload, updated_at: new Date().toISOString() }).eq('id', editId)
        if (tenantId) updateQuery = updateQuery.eq('tenant_id', tenantId)
        await updateQuery
      } else {
        // tenantId kommt aus loadData() (state, siehe /api/me/active-tenant oben) - kein
        // eigener Fallback-Lookup mehr hier (der frühere ungefilterte tenant_memberships-
        // Fallback konnte bei Mehrfach-Mitgliedschaft eine BELIEBIGE statt der aktiven
        // Mitgliedschaft treffen). Ohne bekannten aktiven Mandanten wird bewusst NICHT
        // eingefügt, statt zu raten.
        if (!tenantId) {
          setFormError('Aktiver Betrieb konnte nicht ermittelt werden. Bitte Seite neu laden.')
          return
        }
        { const { error: e } = await (supabase.from('keller_behandlungen') as any)
          .insert({ ...payload, tenant_id: tenantId })
          if (e) console.error('[behandlungen] keller_behandlungen:', e.message) }
      }
      setShowForm(false)
      loadData()
    })
  }

  async function handleDelete(id: string) {
    if (!confirm('Behandlung löschen?')) return
    let deleteQuery = (supabase.from('keller_behandlungen') as any).delete().eq('id', id)
    if (tenantId) deleteQuery = deleteQuery.eq('tenant_id', tenantId)
    await deleteQuery
    loadData()
  }

  const gHl = formMenge && formVolumen && formEinheit !== '-'
    ? calcGProHl(parseFloat(dezimal(formMenge)), formEinheit, parseFloat(dezimal(formVolumen)))
    : null

  if (loading) return <div className="p-6 text-s112-muted text-sm">Lade…</div>
  if (!behaelter) return <div className="p-6 text-s112-err text-sm">Behälter nicht gefunden.</div>

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{behaelter.name}</span>
        <span>/</span>
        <span className="text-s112-text-2">Kellerbehandlungen</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-s112-text flex items-center gap-2">
          <FlaskConical size={20} strokeWidth={1.75} className="text-s112-blue-700" />Kellerbehandlungen – {behaelter.name}
        </h1>
        <button onClick={openNeu}
          className="text-xs bg-s112-teal text-white px-3 py-1.5 rounded-lg hover:bg-opacity-90 font-medium">
          + Neue Behandlung
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-s112-border">
        <Link href={`/kellerbuch/behaelter/${behaelterId}/bewegungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors inline-flex items-center gap-1.5">
          <BarChart3 size={14} strokeWidth={1.75} />Bewegungsbuch
        </Link>
        <Link href={`/kellerbuch/behaelter/${behaelterId}/umzuege`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors inline-flex items-center gap-1.5">
          <ArrowLeftRight size={14} strokeWidth={1.75} />Umziehen
        </Link>
        <span className="px-4 py-2 text-sm font-medium text-s112-blue-700 border-b-2 border-s112-teal -mb-px inline-flex items-center gap-1.5">
          <FlaskConical size={14} strokeWidth={1.75} />Kellerbehandlungen
        </span>
      </div>

      {/* Formular */}
      {showForm && (
        <div className="card p-5 border-s112-teal/30 border-2">
          <h2 className="font-semibold text-s112-text mb-4 text-sm">
            {editId ? 'Behandlung bearbeiten' : 'Neue Behandlung'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
                <input aria-label="Datum" type="date" value={formDatum} onChange={e => setFormDatum(e.target.value)}
                  className="input w-full" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Behandlungstyp *</label>
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
                      className="text-xs text-s112-blue-700 border border-s112-teal/30 px-2 rounded-lg hover:bg-s112-teal hover:text-white transition-colors whitespace-nowrap">
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
                      className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge</label>
                <input aria-label="Menge" type="text" value={formMenge} onChange={e => setFormMenge(e.target.value)}
                  placeholder="0,00" className="input w-full" />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Einheit</label>
                <select aria-label="Einheit" value={formEinheit} onChange={e => setFormEinheit(e.target.value)} className="input w-full">
                  {EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">
                  Volumen Ist (L)
                  {gHl && (
                    <span className="ml-2 text-s112-blue-700 font-semibold">= {gHl} g/hl</span>
                  )}
                </label>
                <input type="text" value={formVolumen} onChange={e => setFormVolumen(e.target.value)}
                  placeholder={aktuellerInhalt > 0 ? fmtNum(aktuellerInhalt) : '0'}
                  className="input w-full" />
              </div>
            </div>

            {chargenImBehaelter.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Kellerbuch-Charge</label>
                <select aria-label="Kellerbuch-Charge" value={formWeinausbauId} onChange={e => setFormWeinausbauId(e.target.value)}
                  className="input w-full">
                  <option value="">– keine Zuordnung –</option>
                  {chargenImBehaelter.map((c: R) => (
                    <option key={c.id} value={c.id}>{c.name ?? c.id}</option>
                  ))}
                </select>
                <p className="text-xs text-s112-muted mt-0.5">Für das Weinbuch (von der Rebe bis zur Flasche)</p>
              </div>
            )}
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
              <textarea aria-label="Notizen" value={formNotizen} onChange={e => setFormNotizen(e.target.value)}
                rows={2} className="input w-full resize-none" placeholder="Optionale Anmerkungen…" />
            </div>

            {formError && <p className="text-s112-err text-xs">{formError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setShowForm(false)}
                className="text-xs text-s112-muted border border-s112-line px-4 py-1.5 rounded-lg hover:border-s112-line-str">
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
          <FlaskConical size={28} strokeWidth={1.5} className="mx-auto mb-2 text-s112-tertiary" />
          <p className="text-sm text-s112-muted">Noch keine Kellerbehandlungen erfasst</p>
          <button onClick={openNeu}
            className="mt-3 text-xs text-s112-blue-700 font-semibold hover:underline">
            + Erste Behandlung erfassen
          </button>
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Behandlung</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">g/hl</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Volumen Ist</th>
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
                    <td className="px-4 py-2.5 text-xs text-s112-text-2 whitespace-nowrap">
                      {new Date(b.datum).toLocaleDateString('de-AT')}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-s112-text">{typName}</p>
                      {b.notizen && <p className="text-xs text-s112-muted">{b.notizen}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-1">
                      {menge != null && b.einheit !== '-'
                        ? `${fmtNum(menge)} ${b.einheit ?? ''}`
                        : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-medium text-s112-blue-700">
                      {ghl ? `${ghl} g/hl` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-2 text-xs">
                      {vol != null ? `${fmtNum(vol)} L` : '–'}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openEdit(b)}
                          title="Bearbeiten" aria-label="Bearbeiten"
                          className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={15} strokeWidth={1.75} /></button>
                        <button onClick={() => handleDelete(b.id)}
                          title="Löschen" aria-label="Löschen"
                          className="text-s112-err hover:text-s112-err-fg"><Trash2 size={15} strokeWidth={1.75} /></button>
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
