// behoerdenmeldung: keller-behandlungen
'use client'

import { useEffect, useState, useTransition } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link from '@/components/ui/Link'
import { useParams } from 'next/navigation'
import { FlaskConical, BarChart3, ArrowLeftRight, Pencil } from 'lucide-react'
import StornoButton from '@/components/StornoButton'
import { fmtNum, dezimal } from '@/lib/format'
import { dbFehlerText } from '@/lib/fehler'
import { deleteKellerbehandlung, endgueltigLoeschen } from '../../../actions'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import DruckKnopf from '../../../_behoerden/DruckKnopf'

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
  // Name der beim Bearbeiten verknüpften Charge, falls sie nicht (mehr) aktiv im Behälter liegt
  const [formWeinausbauName, setFormWeinausbauName] = useState<string | null>(null)
  const [formError, setFormError]         = useState('')
  // Zeitraum für Liste, Ausdruck und CSV (Behördenmeldung „keller-behandlungen“) – leer = alles
  const [von, setVon]                     = useState('')
  const [bis, setBis]                     = useState('')

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
    // weinausbau_id mitladen: ohne sie setzte „Bearbeiten“ die Chargen-Zuordnung auf NULL (KAN-35)
    let behandlungenQuery = (supabase.from('keller_behandlungen') as any)
      .select('id, datum, typ_id, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, weinausbau_id, typ:typ_id(name), weinausbau:weinausbau_id(name), storniert_am, storno_grund, storniert_von_name')
      // storno-sichtbar: Liste zeigt stornierte Behandlungen gekennzeichnet, ohne Aktionen (KAN-145 B3)
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
    setFormWeinausbauName(null)
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
    setFormWeinausbauName((b.weinausbau as R | null)?.name ?? null)
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
    // Aktiver Betrieb aus loadData() (/api/me/active-tenant) – nicht „irgendeine“ Mitgliedschaft
    if (!tenantId) { setFormError('Aktiver Betrieb konnte nicht ermittelt werden. Bitte Seite neu laden.'); return }
    setTypSaving(true)
    const { data: neu, error: typErr } = await (supabase.from('keller_behandlungstypen') as any)
      .insert({ tenant_id: tenantId, name: neuerTypName.trim(), einheit_standard: neuerTypEinheit || null })
      .select('id, name, einheit_standard').single()
    if (typErr) {
      setFormError(dbFehlerText(typErr, 'Behandlungstyp konnte nicht angelegt werden'))
      setTypSaving(false)
      return
    }
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
      // tenantId kommt aus loadData() (state, siehe /api/me/active-tenant oben) - kein
      // eigener Fallback-Lookup mehr hier (der frühere ungefilterte tenant_memberships-
      // Fallback konnte bei Mehrfach-Mitgliedschaft eine BELIEBIGE statt der aktiven
      // Mitgliedschaft treffen). Ohne bekannten aktiven Mandanten wird bewusst NICHT
      // geschrieben, statt zu raten.
      if (!tenantId) {
        setFormError('Aktiver Betrieb konnte nicht ermittelt werden. Bitte Seite neu laden.')
        return
      }
      if (editId) {
        // KAN-35: Ergebnis prüfen – vorher blieb ein Fehler (z. B. fehlende Berechtigung) unbemerkt
        const { data: geaendert, error: e } = await (supabase.from('keller_behandlungen') as any)
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editId)
          .eq('tenant_id', tenantId)
          .select('id')
        if (e) { setFormError(dbFehlerText(e, 'Speichern fehlgeschlagen')); return }
        if (!geaendert || geaendert.length === 0) { setFormError('Speichern fehlgeschlagen: Behandlung nicht gefunden oder keine Berechtigung.'); return }
      } else {
        const { error: e } = await (supabase.from('keller_behandlungen') as any)
          .insert({ ...payload, tenant_id: tenantId })
        if (e) { setFormError(dbFehlerText(e, 'Speichern fehlgeschlagen')); return }
      }
      setShowForm(false)
      loadData()
    })
  }

  const gHl = formMenge && formVolumen && formEinheit !== '-'
    ? calcGProHl(parseFloat(dezimal(formMenge)), formEinheit, parseFloat(dezimal(formVolumen)))
    : null

  const zeitraumOk = !von || !bis || von <= bis
  const imZeitraum = (d: string) => (!von || d >= von) && (!bis || d <= bis)
  const angezeigt = zeitraumOk ? behandlungen.filter((b: R) => imZeitraum(String(b.datum ?? ''))) : behandlungen

  if (loading) return <div className="p-6 text-s112-muted text-sm">Lade…</div>
  if (!behaelter) return <div className="p-6 text-s112-err text-sm">Behälter nicht gefunden.</div>

  return (
    <div className="max-w-4xl space-y-6">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted print:hidden">
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
          className="text-xs bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg hover:bg-opacity-90 font-medium print:hidden">
          + Neue Behandlung
        </button>
      </div>
      {(von || bis) && (
        <p className="hidden print:block text-xs text-s112-text-2">
          Zeitraum: {von ? von.split('-').reverse().join('.') : 'Beginn'} – {bis ? bis.split('-').reverse().join('.') : 'heute'}
        </p>
      )}

      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto sm:overflow-visible whitespace-nowrap border-b border-s112-border print:hidden">
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

      {/* Aufzeichnung: Zeitraum, Druck und CSV (dieselben Behandlungen, Charge je Behandlung) */}
      <div className="flex items-end justify-between gap-3 flex-wrap print:hidden">
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-s112-text-2">
            <span className="block mb-0.5 font-medium">Von</span>
            <input type="date" value={von} onChange={e => setVon(e.target.value)} aria-label="Zeitraum von"
              className="border border-s112-border rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white" />
          </label>
          <label className="text-xs text-s112-text-2">
            <span className="block mb-0.5 font-medium">Bis</span>
            <input type="date" value={bis} onChange={e => setBis(e.target.value)} aria-label="Zeitraum bis"
              className="border border-s112-border rounded-lg px-2.5 py-2 sm:py-1.5 text-base sm:text-sm bg-white" />
          </label>
          {(von || bis) && (
            <button type="button" onClick={() => { setVon(''); setBis('') }} className="text-xs text-s112-muted hover:text-s112-blue-700 py-1.5">
              Gesamter Zeitraum
            </button>
          )}
          {!zeitraumOk && <span role="alert" className="text-xs text-s112-err-fg py-1.5">„Von“ liegt nach „Bis“.</span>}
        </div>
        <div className="flex items-start gap-2">
          <DruckKnopf />
          {zeitraumOk && <CsvExportKnopf href={csvPfad('keller-behandlungen', { behaelter: behaelterId, von, bis })} />}
        </div>
      </div>

      {/* Formular */}
      {showForm && (
        <div className="card p-5 border-s112-teal/30 border-2 print:hidden">
          <h2 className="font-semibold text-s112-text mb-4 text-sm">
            {editId ? 'Behandlung bearbeiten' : 'Neue Behandlung'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
                <input aria-label="Datum" type="date" value={formDatum} onChange={e => setFormDatum(e.target.value)}
                  className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Behandlungstyp *</label>
                {!showNeuerTyp ? (
                  <div className="flex gap-2">
                    <select value={formTypId} onChange={e => onTypChange(e.target.value)}
                      className="input flex-1 py-2.5 sm:py-2 text-base sm:text-sm" required>
                      <option value="">– wählen –</option>
                      {typen.map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button type="button" onClick={() => setShowNeuerTyp(true)}
                      className="text-xs text-s112-blue-700 border border-s112-teal/30 px-2 rounded-lg hover:bg-s112-teal hover:text-s112-yellow transition-colors whitespace-nowrap">
                      + Neu
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2 items-end">
                    <input type="text" value={neuerTypName} onChange={e => setNeuerTypName(e.target.value)}
                      placeholder="Typbezeichnung" className="input flex-1 basis-full sm:basis-0 py-2.5 sm:py-2 text-base sm:text-sm" autoFocus />
                    <select value={neuerTypEinheit} onChange={e => setNeuerTypEinheit(e.target.value)}
                      className="input w-20 py-2.5 sm:py-2 text-base sm:text-sm">
                      {EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
                    </select>
                    <button type="button" onClick={saveNeuerTyp} disabled={typSaving}
                      className="text-xs bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg disabled:opacity-50">
                      {typSaving ? '…' : 'Speichern'}
                    </button>
                    <button type="button" onClick={() => setShowNeuerTyp(false)}
                      className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge</label>
                <input aria-label="Menge" type="text" inputMode="decimal" value={formMenge} onChange={e => setFormMenge(e.target.value)}
                  placeholder="0,00" className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Einheit</label>
                <select aria-label="Einheit" value={formEinheit} onChange={e => setFormEinheit(e.target.value)} className="input w-full py-2.5 sm:py-2 text-base sm:text-sm">
                  {EINHEITEN.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>
              <div className="col-span-2 sm:col-span-1">
                <label className="block text-xs font-medium text-s112-text-2 mb-1">
                  Volumen Ist (L)
                  {gHl && (
                    <span className="ml-2 text-s112-blue-700 font-semibold">= {gHl} g/hl</span>
                  )}
                </label>
                <input type="text" inputMode="decimal" value={formVolumen} onChange={e => setFormVolumen(e.target.value)}
                  placeholder={aktuellerInhalt > 0 ? fmtNum(aktuellerInhalt) : '0'}
                  className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
              </div>
            </div>

            {(chargenImBehaelter.length > 0 || (formWeinausbauId && formWeinausbauName)) && (
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Kellerbuch-Charge</label>
                <select aria-label="Kellerbuch-Charge" value={formWeinausbauId} onChange={e => setFormWeinausbauId(e.target.value)}
                  className="input w-full py-2.5 sm:py-2 text-base sm:text-sm">
                  <option value="">– keine Zuordnung –</option>
                  {/* Bisher zugeordnete Charge, die nicht mehr aktiv im Behälter liegt – bleibt wählbar */}
                  {formWeinausbauId && !chargenImBehaelter.some((c: R) => c.id === formWeinausbauId) && (
                    <option value={formWeinausbauId}>{formWeinausbauName ?? 'bisherige Charge'} (nicht mehr im Behälter)</option>
                  )}
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
                rows={2} className="input w-full resize-none py-2.5 sm:py-2 text-base sm:text-sm" placeholder="Optionale Anmerkungen…" />
            </div>

            {formError && <p className="text-s112-err text-xs">{formError}</p>}

            {/* KAN-181: am Handy bleibt die Leiste beim Scrollen unten sichtbar */}
            <div className="flex justify-end gap-2 pt-1 max-sm:sticky max-sm:bottom-0 max-sm:-mx-5 max-sm:-mb-5 max-sm:px-5 max-sm:py-3 max-sm:bg-s112-bg max-sm:border-t max-sm:border-s112-line max-sm:z-10">
              <button type="button" onClick={() => setShowForm(false)}
                className="flex-1 sm:flex-none text-base sm:text-xs text-s112-muted border border-s112-line px-4 py-3 sm:py-1.5 rounded-lg hover:border-s112-line-str">
                Abbrechen
              </button>
              <button type="submit" disabled={isPending}
                className="flex-1 sm:flex-none text-base sm:text-xs bg-s112-teal text-s112-yellow px-4 py-3 sm:py-1.5 rounded-lg hover:bg-opacity-90 disabled:opacity-50">
                {isPending ? 'Speichern…' : (editId ? 'Aktualisieren' : 'Speichern')}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Liste */}
      {angezeigt.length === 0 ? (
        <div className="card text-center py-10">
          <FlaskConical size={28} strokeWidth={1.5} className="mx-auto mb-2 text-s112-tertiary" />
          <p className="text-sm text-s112-muted">{behandlungen.length === 0 ? 'Noch keine Kellerbehandlungen erfasst' : 'Keine Kellerbehandlungen in diesem Zeitraum'}</p>
          {behandlungen.length === 0 && (
            <button onClick={openNeu}
              className="mt-3 text-xs text-s112-blue-700 font-semibold hover:underline print:hidden">
              + Erste Behandlung erfassen
            </button>
          )}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full min-w-[600px] text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Behandlung</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">g/hl</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Volumen Ist</th>
                <th className="px-4 py-2.5 print:hidden" />
              </tr>
            </thead>
            <tbody>
              {angezeigt.map((b: R) => {
                const typName = (b.typ as R | null)?.name ?? b.typ_name_snapshot ?? '–'
                const menge   = b.menge != null ? parseFloat(b.menge) : null
                const vol     = b.volumen_liter_ist != null ? parseFloat(b.volumen_liter_ist) : null
                const ghl     = menge != null && vol != null && b.einheit
                  ? calcGProHl(menge, b.einheit, vol) : null
                return (
                  <tr key={b.id} className={`border-b border-s112-border/30 last:border-0 ${b.storniert_am ? 'opacity-70' : 'hover:bg-s112-bg/40'}`}>
                    <td className="px-4 py-2.5 text-xs text-s112-text-2 whitespace-nowrap">
                      {String(b.datum ?? '').split('-').reverse().join('.')}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-s112-text">{typName}</p>
                      {(b.weinausbau as R | null)?.name && <p className="text-xs text-s112-text-2">Charge: {(b.weinausbau as R).name}</p>}
                      {b.notizen && <p className="text-xs text-s112-muted">{b.notizen}</p>}
                      {b.storniert_am && (
                        <p className="text-[11px] text-s112-warn-fg">
                          storniert am {new Date(b.storniert_am).toLocaleDateString('de-AT')}{b.storniert_von_name ? ` von ${b.storniert_von_name}` : ''}{b.storno_grund ? ` – ${b.storno_grund}` : ''}
                        </p>
                      )}
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
                    <td className="px-4 py-2.5 text-right print:hidden">
                      {b.storniert_am ? (
                        // KAN-145 B4: endgültig löschen nur stornierter Buchungen, mit Grund
                        <StornoButton modus="loeschen" label="Endgültig löschen" danach={() => loadData()}
                          action={grund => endgueltigLoeschen('keller_behandlungen', b.id, grund)}
                          hinweis="Nur bei Fehlbuchungen: Die stornierte Buchung wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll." />
                      ) : (
                      <div className="flex items-start justify-end gap-3">
                        <button onClick={() => openEdit(b)}
                          title="Bearbeiten" aria-label="Bearbeiten"
                          className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={15} strokeWidth={1.75} /></button>
                        {/* KAN-145 B3: stornieren mit Grund statt löschen */}
                        <StornoButton action={grund => deleteKellerbehandlung(b.id, grund)} danach={() => loadData()}
                          hinweis="Die Kellerbehandlung bleibt als storniert im Bewegungsbuch und Weinbuch stehen und zählt in keiner Auswertung." />
                      </div>
                      )}
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
