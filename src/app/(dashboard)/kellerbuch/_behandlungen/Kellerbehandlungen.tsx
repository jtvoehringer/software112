'use client'

// KAN-475 (16.11.2026): Kellerbehandlungen gehören zur Charge. Diese Komponente läuft in zwei Formen:
//   modus 'charge'  – Liste und Erfassung der Behandlungen EINER Charge (Seite /kellerbuch/weinausbau/[id]/behandlungen);
//                     das Gebinde ist nur die Angabe „liegt in …“ und kommt von der Charge.
//   modus 'gebinde' – Gebindepflege ohne Charge (Reinigen, Konservieren, Umbenennung, Notiz) an der alten Adresse
//                     /kellerbuch/behaelter/[id]/behandlungen; liegt genau eine Charge im Gebinde, leitet die Seite dorthin um.

import { useEffect, useRef, useState, useTransition } from 'react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import Link, { BrotkrumenLink } from '@/components/ui/Link'
import { useRouter } from 'next/navigation'
import { FlaskConical, BarChart3, ArrowLeftRight, Pencil } from 'lucide-react'
import StornoButton from '@/components/StornoButton'
import { fmtNum, dezimal } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { deleteKellerbehandlung, endgueltigLoeschen, speichereKellerbehandlung, legeBehandlungstypAn, setzeBehandlungstypWirkung } from '../actions'
import { PN_WIRKUNGEN, PN_WIRKUNG_TEXT, pnWirkungAus } from '@/lib/kellerbuch/pnWirkung'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import DruckKnopf from '../_behoerden/DruckKnopf'
import GesperrtHinweis from '@/components/GesperrtHinweis'
import { istStoffkontoTyp } from '@/lib/kellerbuch/stoffkonto'
import FreezeKorrektur from '@/components/FreezeKorrektur'
import { KORREKTUR_FELDER } from '@/lib/freeze/korrektur'
import { korrekturErlaubt } from '../../freeze-korrektur-actions'
import { behandlungPnGesperrt, BEHANDLUNG_FREEZE_GRUND, type PnGueltigkeit } from '@/lib/kellerbuch/behandlungRegeln'
import { heuteWien } from '@/lib/datum/wien'
import { serverRueckfrage } from '@/lib/ui/rueckfrage'
import ZukunftsDatum from '@/components/ui/ZukunftsDatum'

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

export default function Kellerbehandlungen({ modus, id }: { modus: 'charge' | 'gebinde'; id: string }) {
  const chargeId = modus === 'charge' ? id : null
  const router = useRouter()
  const supabase = createSupabaseBrowserClient()

  // Gebinde: am Gebinde die Adresse selbst, an der Charge das Gebinde, in dem sie liegt (kann fehlen)
  const [behaelterId, setBehaelterId]   = useState<string | null>(modus === 'gebinde' ? id : null)
  const [charge, setCharge]             = useState<R | null>(null)
  // KAN-475: Vorgeschichte – Behandlungen der Ursprungscharge bis zum (Teil-)Umzug, aus dem diese Charge entstand
  const [vorgeschichte, setVorgeschichte] = useState<{ charge: string; bis: string; zeilen: R[] }[]>([])
  const [behaelter, setBehaelter]       = useState<R | null>(null)
  const [behandlungen, setBehandlungen] = useState<R[]>([])
  const [typen, setTypen]               = useState<R[]>([])
  const [aktuellerInhalt, setAktuellerInhalt] = useState<number>(0)
  const [loading, setLoading]           = useState(true)
  const [isPending, startTransition]    = useTransition()

  // Formular-State
  const [chargenImBehaelter, setChargenImBehaelter] = useState<R[]>([])
  const [showForm, setShowForm]           = useState(false)
  const [editId, setEditId]               = useState<string | null>(null)
  const [formDatum, setFormDatum]         = useState(heuteWien())
  const [formTypId, setFormTypId]         = useState('')
  const [formMenge, setFormMenge]         = useState('')
  const [formEinheit, setFormEinheit]     = useState('kg')
  const [formVolumen, setFormVolumen]     = useState('')
  const [formZugang, setFormZugang]       = useState('')   // KAN-41 Paket 3b: Volumenzugang (L)
  const [formNotizen, setFormNotizen]     = useState('')
  // KAN-107: Stoffkonto – verwendeter Stoff und Menge (nur beim Anlegen)
  const [stoffe, setStoffe]               = useState<R[]>([])
  const [formStoffId, setFormStoffId]     = useState('')
  const [formStoffMenge, setFormStoffMenge] = useState('')
  const [formWeinausbauId, setFormWeinausbauId] = useState<string>('')
  // Name der beim Bearbeiten verknüpften Charge, falls sie nicht (mehr) aktiv im Behälter liegt
  const [formWeinausbauName, setFormWeinausbauName] = useState<string | null>(null)
  const [formError, setFormError]         = useState('')
  // KAN-372: nach „+ Neue Behandlung“/„Bearbeiten“ zum Formular springen – am Handy lag es außer Sicht, der Knopf schien nichts zu tun
  const formRef = useRef<HTMLDivElement>(null)
  const [formOeffnung, setFormOeffnung]   = useState(0)
  useEffect(() => {
    if (formOeffnung) formRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [formOeffnung])
  // Sweep 91 (KAN-283): Lesefehler sichtbar statt leerer Liste bzw. gesperrter Behandlungen als bearbeitbar
  const [ladeFehler, setLadeFehler]       = useState<string | null>(null)
  // Zeitraum für Liste, Ausdruck und CSV (Behördenmeldung „keller-behandlungen“) – leer = alles
  const [von, setVon]                     = useState('')
  const [bis, setBis]                     = useState('')

  // Neuer Typ inline
  const [showNeuerTyp, setShowNeuerTyp]   = useState(false)
  const [neuerTypName, setNeuerTypName]   = useState('')
  const [neuerTypEinheit, setNeuerTypEinheit] = useState('kg')
  // KAN-100/KAN-206: Wirkung auf die Prüfnummer – neue Typen müssen eingestuft werden (Pflege/Veränderung)
  const [neuerTypWirkung, setNeuerTypWirkung] = useState('')
  // KAN-206: Gültigkeit der Prüfnummern der Chargen dieses Gebindes (Sperre wie Trigger a_freeze)
  const [pnZeilen, setPnZeilen]           = useState<PnGueltigkeit[]>([])
  const [formGesperrt, setFormGesperrt]   = useState(false)
  // KAN-222: Betriebsleitung darf gesperrte Behandlungen mit Grund korrigieren
  const [betriebsleitung, setBetriebsleitung] = useState(false)
  useEffect(() => { korrekturErlaubt().then(setBetriebsleitung).catch(() => setBetriebsleitung(false)) }, [])
  const [formHinweis, setFormHinweis]     = useState('')
  const [typSaving, setTypSaving]         = useState(false)

  async function loadData() {
    // Aktiven Mandanten über /api/me/active-tenant ermitteln (nutzt serverseitig die
    // kanonische getCurrentMembership()-Logik inkl. Cookie-Validierung) statt einer eigenen,
    // ungefilterten tenant_memberships-Abfrage, die bei Mehrfach-Mitgliedschaft eine
    // BELIEBIGE statt der aktiv gewählten Mitgliedschaft treffen konnte.
    const activeTenantRes = await fetch('/api/me/active-tenant')
    const activeTenantJson = activeTenantRes.ok ? await activeTenantRes.json() : { tenantId: null }
    const activeTenantId = (activeTenantJson?.tenantId as string | undefined) ?? null

    // KAN-475: an der Charge zuerst die Charge laden – ihr Gebinde ist nur die Angabe „liegt in …“
    let bId: string | null = modus === 'gebinde' ? id : null
    if (chargeId) {
      let chargeQuery = (supabase.from('weinausbau') as R).select('id, name, menge_liter, aktiv, behaelter_id').eq('id', chargeId)
      if (activeTenantId) chargeQuery = chargeQuery.eq('tenant_id', activeTenantId)
      const { data: c, error: cErr } = await chargeQuery.maybeSingle()
      if (cErr) { setLadeFehler(fehlerText(cErr, 'Charge konnte nicht geladen werden')); setLoading(false); return }
      setCharge((c as R | null) ?? null)
      if (!c) { setLoading(false); return }
      bId = ((c as R).behaelter_id as string | null) ?? null
      setBehaelterId(bId)
    }

    // Eigenes oder freigegebenes Gebinde (Kellergemeinschaft): über die RPC lade_behaelter,
    // damit auch Partner-Gebinde (Freigabe) sichtbar sind - Behandlungen selbst bleiben tenant-gefiltert.
    const behaelterQuery = activeTenantId && bId
      ? (supabase.rpc as any)('lade_behaelter', { p_tenant_id: activeTenantId }).then((r: R) => ({ data: ((r.data ?? []) as R[]).find(b => b.id === bId) ?? null, error: r.error ?? null }))
      : Promise.resolve({ data: null, error: null })
    // Chargen: an der Charge nur sie selbst, am Gebinde die aktiven Chargen darin (für die Weiterleitung bzw. die Auswahl)
    let weinausbauQuery = (supabase.from('weinausbau') as any).select('id, name, menge_liter, aktiv').eq('aktiv', true)
    weinausbauQuery = chargeId ? weinausbauQuery.eq('id', chargeId) : weinausbauQuery.eq('behaelter_id', bId)
    // weinausbau_id mitladen: ohne sie setzte „Bearbeiten“ die Chargen-Zuordnung auf NULL (KAN-35)
    let behandlungenQuery = (supabase.from('keller_behandlungen') as any)
      .select('id, datum, typ_id, typ_name_snapshot, menge, einheit, volumen_liter_ist, zugang_liter, notizen, weinausbau_id, sammel_id, behaelter_id, typ:typ_id(name), weinausbau:weinausbau_id(name), behaelter:behaelter_id(name), storniert_am, storno_grund, storniert_von_name')
      // storno-sichtbar: Liste zeigt stornierte Behandlungen gekennzeichnet, ohne Aktionen (KAN-145 B3)
      .order('datum', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
    // KAN-475: an der Charge ihre Behandlungen (in welchem Gebinde auch immer), am Gebinde nur die Gebindepflege ohne Charge
    behandlungenQuery = chargeId ? behandlungenQuery.eq('weinausbau_id', chargeId) : behandlungenQuery.eq('behaelter_id', bId).is('weinausbau_id', null)
    let typenQuery = (supabase.from('keller_behandlungstypen') as any).select('id, name, einheit_standard, pn_wirkung, gebindepflege').order('sort_order').order('name')
    // KAN-107: aktive Stoffe des Stoffkontos (wenige Stammdaten je Betrieb)
    // alle-ausnahme: Stammdaten-Auswahl der aktiven Stoffe des Betriebs, wenige
    let stoffeQuery = (supabase.from('kellermittel') as R).select('id, name, einheit').eq('aktiv', true).order('name').order('id')
    if (activeTenantId) {
      weinausbauQuery   = weinausbauQuery.eq('tenant_id', activeTenantId)
      behandlungenQuery = behandlungenQuery.eq('tenant_id', activeTenantId)
      typenQuery        = typenQuery.eq('tenant_id', activeTenantId)
      stoffeQuery       = stoffeQuery.eq('tenant_id', activeTenantId)
    }

    const [
      { data: bh, error: bhErr },
      { data: bh_data, error: bhDataErr },
      { data: typenData, error: typenErr },
      { data: behandlungenData, error: behandlungenErr },
      { data: stoffeData, error: stoffeErr },
    ] = await Promise.all([
      behaelterQuery,
      weinausbauQuery,
      typenQuery,
      behandlungenQuery,
      stoffeQuery,
    ])
    const ladeErr = bhErr ?? bhDataErr ?? typenErr ?? behandlungenErr ?? stoffeErr
    if (ladeErr) {
      setLadeFehler(fehlerText(ladeErr, 'Daten konnten nicht geladen werden'))
      setLoading(false)
      return
    }
    setLadeFehler(null)
    setStoffe((stoffeData ?? []) as R[])
    setBehaelter(bh)
    const inhalt = ((bh_data ?? []) as R[]).reduce((s: number, w: R) => s + (parseFloat(w.menge_liter) || 0), 0)
    setAktuellerInhalt(inhalt)
    setChargenImBehaelter((bh_data ?? []) as R[])
    // KAN-475: Liegt genau eine Charge im Gebinde, werden ihre Kellerbehandlungen an der Charge geführt – dorthin weiter
    // (die Schnellerfassung nach dem QR-Scan kommt mit ?neu=1 hier an)
    if (modus === 'gebinde' && ((bh_data ?? []) as R[]).length === 1) {
      router.replace(`/kellerbuch/weinausbau/${((bh_data ?? []) as R[])[0].id}/behandlungen${window.location.search}`)
      return
    }
    setTypen(typenData ?? [])
    setBehandlungen(behandlungenData ?? [])
    // KAN-206: Prüfnummer-Gültigkeit der behandelten Chargen – gesperrte Behandlungen nur noch in den Notizen änderbar
    const chargenIds = [...new Set(((behandlungenData ?? []) as R[]).map(b => b.weinausbau_id).filter(Boolean))]
    if (chargenIds.length > 0 && activeTenantId) {
      // alle-ausnahme: Chargen mit Behandlungen in einem einzelnen Behälter, wenige
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
      const { data: pn, error: pnErr } = await (supabase.from('pruefnummer_chargen') as any)
        .select('weinausbau_id, gueltig_ab, gueltig_bis').eq('tenant_id', activeTenantId).in('weinausbau_id', chargenIds)
      // ohne Prüfnummern erschienen gesperrte Behandlungen als bearbeitbar
      if (pnErr) setLadeFehler(fehlerText(pnErr, 'Prüfnummern der Chargen konnten nicht geladen werden – Bearbeiten ist vorerst gesperrt'))
      setPnZeilen((pn ?? []) as PnGueltigkeit[])
    } else {
      setPnZeilen([])
    }
    // KAN-475: nach einem Teilumzug in ein leeres Gebinde ist dies eine neue Charge – was die Ursprungscharge bis dahin
    // an Behandlungen bekam, gilt auch für diesen Wein (nur Anzeige, die Einträge bleiben bei der Ursprungscharge)
    if (chargeId && activeTenantId) {
      const { data: um, error: umErr } = await (supabase.from('keller_umzuege') as R)
        .select('id, datum, von_weinausbau_id, quelle:weinausbau!keller_umzuege_von_weinausbau_id_fkey(name)')
        .eq('tenant_id', activeTenantId).eq('nach_weinausbau_id', chargeId).neq('von_weinausbau_id', chargeId).eq('verschnitt', false)
        // alle-ausnahme: Umzüge, aus denen genau diese Charge entstand – in der Regel einer, neueste zuerst
        .is('storniert_am', null).order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).order('id', { ascending: false }).limit(5)
      if (umErr) { setLadeFehler(fehlerText(umErr, 'Die Vorgeschichte der Charge konnte nicht geladen werden')); setLoading(false); return }
      const vor: { charge: string; bis: string; zeilen: R[] }[] = []
      for (const u of ((um ?? []) as R[])) {
        // alle-ausnahme: Behandlungen einer einzelnen Ursprungscharge bis zum Umzug, wenige
        const { data: vb, error: vbErr } = await (supabase.from('keller_behandlungen') as R)
          .select('id, datum, typ_name_snapshot, menge, einheit, notizen, typ:typ_id(name)')
          .eq('tenant_id', activeTenantId).eq('weinausbau_id', u.von_weinausbau_id).lte('datum', u.datum).is('storniert_am', null)
          .order('datum', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false })
        if (vbErr) { setLadeFehler(fehlerText(vbErr, 'Die Vorgeschichte der Charge konnte nicht geladen werden')); setLoading(false); return }
        if (((vb ?? []) as R[]).length > 0) vor.push({ charge: String((u.quelle as R | null)?.name ?? 'Ursprungscharge'), bis: String(u.datum).slice(0, 10), zeilen: (vb ?? []) as R[] })
      }
      setVorgeschichte(vor)
    } else {
      setVorgeschichte([])
    }
    setLoading(false)
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- neu laden genau beim Wechsel der Charge bzw. des Gebindes; loadData liest nur modus und id
  useEffect(() => { loadData() }, [modus, id])

  // KAN-117: aus der Schnellerfassung (?neu=1) gleich das Formular „Neue Behandlung“ öffnen – einmal, nach dem Laden
  const neuGeoeffnet = useRef(false)
  useEffect(() => {
    if (loading || neuGeoeffnet.current) return
    neuGeoeffnet.current = true
    if (new URLSearchParams(window.location.search).get('neu') === '1') openNeu()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- openNeu liest den geladenen Stand, einmalig nach dem Laden
  }, [loading])

  // KAN-475: am Gebinde (ohne Charge) nur Typen der Gebindepflege – dieselbe Regel wie Server Action und Datenbank
  const typenWahl = modus === 'gebinde' ? typen.filter(t => t.gebindepflege === true) : typen

  function openNeu() {
    setEditId(null)
    setFormDatum(heuteWien())
    setFormTypId(typenWahl[0]?.id ?? '')
    setFormMenge('')
    setFormEinheit(typenWahl[0]?.einheit_standard ?? 'kg')
    setFormVolumen(aktuellerInhalt > 0 ? aktuellerInhalt.toString() : '')
    setFormZugang('')
    setFormNotizen('')
    setFormStoffId('')
    setFormStoffMenge('')
    setFormError('')
    setShowNeuerTyp(false)
    setFormHinweis('')
    setFormGesperrt(false)
    // an der Charge steht sie fest; am Gebinde gibt es keine (Gebindepflege)
    setFormWeinausbauId(chargeId ?? '')
    setFormWeinausbauName(null)
    setShowForm(true)
    setFormOeffnung(n => n + 1)
  }

  function openEdit(b: R) {
    setEditId(b.id)
    setFormDatum(b.datum)
    setFormTypId(b.typ_id ?? '')
    setFormMenge(b.menge != null ? String(b.menge) : '')
    setFormEinheit(b.einheit ?? 'kg')
    setFormVolumen(b.volumen_liter_ist != null ? String(b.volumen_liter_ist) : '')
    setFormZugang(b.zugang_liter != null ? String(b.zugang_liter).replace('.', ',') : '')
    setFormNotizen(b.notizen ?? '')
    setFormWeinausbauId(b.weinausbau_id ?? '')
    setFormWeinausbauName((b.weinausbau as R | null)?.name ?? null)
    setFormError('')
    setShowNeuerTyp(false)
    // Sweep 91 (KAN-283): ohne geladene Prüfnummern (Ladefehler) vorsichtshalber gesperrt
    setFormGesperrt(!!ladeFehler || behandlungPnGesperrt(b as { weinausbau_id: string | null; datum: string | null; storniert_am: string | null }, pnZeilen))
    setShowForm(true)
    setFormOeffnung(n => n + 1)
  }

  function onTypChange(id: string) {
    setFormTypId(id)
    const typ = typen.find(t => t.id === id)
    if (typ?.einheit_standard) setFormEinheit(typ.einheit_standard)
  }

  async function saveNeuerTyp() {
    if (!neuerTypName.trim()) return
    setTypSaving(true)
    try {
      const neu = await legeBehandlungstypAn(neuerTypName.trim(), neuerTypEinheit || null, neuerTypWirkung, modus === 'gebinde')
      setTypen(prev => [...prev, neu])
      setFormTypId(neu.id)
      setFormEinheit(neu.einheit_standard ?? 'kg')
      setNeuerTypName('')
      setNeuerTypEinheit('kg')
      setNeuerTypWirkung('')
      setShowNeuerTyp(false)
    } catch (err) {
      setFormError(fehlerText(err, 'Behandlungstyp konnte nicht angelegt werden'))
    }
    setTypSaving(false)
  }

  // KAN-100: Einstufung des gewählten Typs ändern (die Datenbank sperrt das nach der Verwendung in einer Charge mit Prüfnummer)
  async function wirkungAendern(wirkung: string) {
    if (!formTypId) return
    setFormError('')
    try {
      await setzeBehandlungstypWirkung(formTypId, wirkung)
      setTypen(prev => prev.map(t => (t.id === formTypId ? { ...t, pn_wirkung: wirkung } : t)))
    } catch (err) {
      setFormError(fehlerText(err, 'Einstufung konnte nicht gespeichert werden'))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError('')
    if (!formTypId) { setFormError('Bitte einen Behandlungstyp wählen.'); return }

    const fd = new FormData()
    if (editId) fd.set('id', editId)
    if (behaelterId) fd.set('behaelter_id', behaelterId)
    fd.set('datum', formDatum)
    fd.set('typ_id', formTypId)
    if (formMenge) fd.set('menge', formMenge)
    if (formEinheit) fd.set('einheit', formEinheit)
    if (formVolumen) fd.set('volumen_liter_ist', formVolumen)
    fd.set('zugang_liter', formZugang)   // KAN-41 Paket 3b: leer = kein Volumenzugang
    if (formNotizen) fd.set('notizen', formNotizen)
    if (formWeinausbauId) fd.set('weinausbau_id', formWeinausbauId)
    // KAN-107: Verwendung im Stoffkonto (nur beim Anlegen)
    if (!editId && formStoffId) { fd.set('kellermittel_id', formStoffId); fd.set('kellermittel_menge', formStoffMenge) }

    startTransition(async () => {
      // KAN-100: ein Weg für Anlegen und Bearbeiten (Server Action) – Rückfrage, wenn die Prüfnummer der Charge erlischt
      try {
        let r = await speichereKellerbehandlung(fd)
        if (r.bestaetigung) {
          if (!(await serverRueckfrage(r.bestaetigung, 'Trotzdem speichern'))) return
          fd.set('pn_bestaetigt', '1')
          r = await speichereKellerbehandlung(fd)
        }
        setFormHinweis(r.hinweis ?? '')
      } catch (err) {
        setFormError(fehlerText(err, 'Speichern fehlgeschlagen'))
        return
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
  if (ladeFehler && !(chargeId ? charge : behaelter)) return <div role="alert" className="p-6 text-sm text-s112-err-fg">{ladeFehler}</div>
  if (chargeId && !charge) return <div className="p-6 text-s112-err text-sm">Charge nicht gefunden.</div>
  if (!chargeId && !behaelter) return <div className="p-6 text-s112-err text-sm">Behälter nicht gefunden.</div>
  const titel = chargeId ? String(charge?.name ?? 'Charge') : String(behaelter?.name ?? '')
  const zurueck = chargeId ? `/kellerbuch/weinausbau/${chargeId}` : `/kellerbuch/behaelter/${behaelterId}`

  return (
    <div className="max-w-4xl space-y-6">
      {ladeFehler && <p role="alert" className="text-sm text-s112-err-fg print:hidden">{ladeFehler}</p>}
      {/* Breadcrumb */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-s112-muted print:hidden">
        <BrotkrumenLink href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</BrotkrumenLink>
        <span>/</span>
        <BrotkrumenLink href={zurueck} className="text-s112-text-1 font-medium hover:text-s112-blue-700 transition-colors">{titel}</BrotkrumenLink>
        <span>/</span>
        <span className="text-s112-text-2">{chargeId ? 'Kellerbehandlungen' : 'Gebindepflege'}</span>
      </div>

      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold text-s112-text flex items-center gap-2">
          <FlaskConical size={20} strokeWidth={1.75} className="text-s112-blue-700" />{chargeId ? 'Kellerbehandlungen' : 'Gebindepflege'} – {titel}
        </h1>
        <div className="flex flex-wrap gap-2 print:hidden">
          {/* KAN-372: die Kacheln der Schnellerfassung stehen nur auf der Gebindeseite */}
          {behaelterId && (
            <Link href={`/kellerbuch/behaelter/${behaelterId}`} data-schnellerfassung
              className="text-xs border border-s112-line text-s112-text-2 px-3 py-1.5 rounded-lg hover:border-s112-teal hover:text-s112-blue-700 font-medium">
              Schnellerfassung
            </Link>
          )}
          <button onClick={openNeu}
            className="text-xs bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg hover:bg-s112-teal/90 font-medium">
            {chargeId ? '+ Neue Behandlung' : '+ Neue Gebindepflege'}
          </button>
        </div>
      </div>
      {/* KAN-475: Behandelt wird die Charge – das Gebinde ist nur die Angabe, wo sie liegt */}
      {chargeId ? (
        <p className="text-xs text-s112-text-2 print:hidden">
          {behaelter
            ? <>Die Charge liegt in <Link href={`/kellerbuch/behaelter/${behaelterId}`} className="text-s112-blue-700 hover:underline">{String(behaelter.name)}</Link>. Die Behandlungen bleiben bei der Charge, auch nach einem Umzug.</>
            : 'Die Charge liegt derzeit in keinem Gebinde. Die Behandlungen bleiben bei der Charge.'}
        </p>
      ) : (
        <div className="text-xs text-s112-text-2 print:hidden space-y-1">
          <p>Kellerbehandlungen werden an der Charge erfasst. Hier stehen nur Arbeiten am Gebinde ohne Charge (Reinigen, Konservieren, Umbenennung, Notiz).</p>
          {chargenImBehaelter.length > 1 && (
            <p>
              Im Gebinde liegen mehrere Chargen – Kellerbehandlungen:{' '}
              {chargenImBehaelter.map((c: R, i: number) => (
                <span key={c.id}>{i > 0 && ', '}<Link href={`/kellerbuch/weinausbau/${c.id}/behandlungen`} className="text-s112-blue-700 hover:underline">{String(c.name ?? 'Charge')}</Link></span>
              ))}
            </p>
          )}
        </div>
      )}
      {(von || bis) && (
        <p className="hidden print:block text-xs text-s112-text-2">
          Zeitraum: {von ? von.split('-').reverse().join('.') : 'Beginn'} – {bis ? bis.split('-').reverse().join('.') : 'heute'}
        </p>
      )}

      {/* Tabs (nur am Gebinde) */}
      {!chargeId && <div className="flex gap-1 overflow-x-auto sm:overflow-visible whitespace-nowrap border-b border-s112-border print:hidden">
        <Link href={`/kellerbuch/behaelter/${behaelterId}/bewegungen`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors inline-flex items-center gap-1.5">
          <BarChart3 size={14} strokeWidth={1.75} />Bewegungsbuch
        </Link>
        <Link href={`/kellerbuch/behaelter/${behaelterId}/umzuege`}
          className="px-4 py-2 text-sm font-medium text-s112-muted hover:text-s112-text-1 border-b-2 border-transparent hover:border-s112-line-str -mb-px transition-colors inline-flex items-center gap-1.5">
          <ArrowLeftRight size={14} strokeWidth={1.75} />Umziehen
        </Link>
        <span className="px-4 py-2 text-sm font-medium text-s112-blue-700 border-b-2 border-s112-teal -mb-px inline-flex items-center gap-1.5">
          <FlaskConical size={14} strokeWidth={1.75} />Gebindepflege
        </span>
      </div>}

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
          {/* KAN-475: Die Behördenmeldung läuft bis KAN-479 je Gebinde – an der Charge gibt es bis dahin Druck, die CSV über „alle im Zeitraum“ */}
          {zeitraumOk && !chargeId && behaelterId && <CsvExportKnopf href={csvPfad('keller-behandlungen', { behaelter: behaelterId, von, bis })} />}
        </div>
      </div>

      {formHinweis && !showForm && (
        <div role="status" className="rounded-lg border border-s112-warn-fg/30 bg-s112-warn-bg text-s112-warn-fg text-xs px-3 py-2 print:hidden">
          {formHinweis}
        </div>
      )}

      {/* Formular */}
      {showForm && (
        <div ref={formRef} className="card p-5 border-s112-teal/30 border-2 print:hidden scroll-mt-4">
          <h2 className="font-semibold text-s112-text mb-4 text-sm">
            {editId ? 'Behandlung bearbeiten' : 'Neue Behandlung'}
          </h2>
          {formGesperrt && (
            <div className="mb-4 space-y-3">
              <GesperrtHinweis grund={BEHANDLUNG_FREEZE_GRUND} erlaubt={['Notizen']} betriebsleitung={betriebsleitung} />
              {betriebsleitung && editId && (() => {
                const zeile = behandlungen.find(x => x.id === editId)
                return zeile ? (
                  <FreezeKorrektur tabelle="keller_behandlungen" id={editId} felder={KORREKTUR_FELDER.keller_behandlungen} werte={zeile}
                    hinweis="Nur für die Betriebsleitung – z. B. Tippfehler in Datum oder Menge. Behandlungstyp falsch: stornieren und neu erfassen. Alt/Neu, Benutzer und Grund stehen im Änderungsprotokoll." />
                ) : null
              })()}
            </div>
          )}
          <form data-ungespeichert onSubmit={handleSubmit} className="space-y-4">
            <fieldset disabled={formGesperrt} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
                <ZukunftsDatum aria-label="Datum" value={formDatum} onChange={e => setFormDatum(e.target.value)}
                  className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" required />
              </div>
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Behandlungstyp *</label>
                {!showNeuerTyp ? (
                  <div className="flex gap-2">
                    <select value={formTypId} onChange={e => onTypChange(e.target.value)}
                      className="input flex-1 py-2.5 sm:py-2 text-base sm:text-sm" required>
                      <option value="">– wählen –</option>
                      {/* beim Bearbeiten bleibt der gespeicherte Typ wählbar, auch wenn er nicht (mehr) zur Auswahl gehört */}
                      {typen.filter(t => typenWahl.includes(t) || t.id === formTypId).map(t => (
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
                    <select aria-label="Wirkung auf die Prüfnummer" value={neuerTypWirkung} onChange={e => setNeuerTypWirkung(e.target.value)}
                      className="input basis-full sm:basis-auto py-2.5 sm:py-2 text-base sm:text-sm">
                      <option value="">– Prüfnummer: bitte einstufen –</option>
                      {PN_WIRKUNGEN.filter(w => w !== 'unklar').map(w => <option key={w} value={w}>{PN_WIRKUNG_TEXT[w]}</option>)}
                    </select>
                    <button type="button" onClick={saveNeuerTyp} disabled={typSaving || !neuerTypWirkung}
                      className="text-xs bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg disabled:opacity-50">
                      {typSaving ? '…' : 'Speichern'}
                    </button>
                    <button type="button" onClick={() => setShowNeuerTyp(false)}
                      className="text-xs text-s112-muted hover:text-s112-text-1">Abbrechen</button>
                  </div>
                )}
                {!showNeuerTyp && formTypId && (
                  <label className="flex items-center gap-2 mt-1 text-xs text-s112-muted">
                    <span className="whitespace-nowrap">Prüfnummer:</span>
                    <select aria-label="Wirkung des Typs auf die Prüfnummer" value={pnWirkungAus(typen.find(t => t.id === formTypId)?.pn_wirkung)}
                      onChange={e => wirkungAendern(e.target.value)}
                      className="input flex-1 py-2 sm:py-1 text-base sm:text-sm">
                      {PN_WIRKUNGEN.map(w => <option key={w} value={w}>{PN_WIRKUNG_TEXT[w]}</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>

            {/* KAN-107: Stoffkonto – bei Zuckerung, RTK, Säuerung, Entsäuerung Pflicht, sobald Stoffe angelegt sind */}
            {!editId && stoffe.length > 0 && (() => {
              const pflicht = istStoffkontoTyp(typen.find(t => t.id === formTypId)?.name)
              return (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                  <div className="col-span-2">
                    <label className="block text-xs font-medium text-s112-text-2 mb-1">Stoff aus dem Stoffkonto{pflicht ? ' *' : ''}</label>
                    <select aria-label="Stoff aus dem Stoffkonto" value={formStoffId} onChange={e => setFormStoffId(e.target.value)} required={pflicht}
                      className="input w-full py-2.5 sm:py-2 text-base sm:text-sm">
                      <option value="">{pflicht ? '– Stoff wählen –' : '– kein Stoff –'}</option>
                      {stoffe.map(st => <option key={st.id} value={st.id}>{st.name} ({st.einheit})</option>)}
                    </select>
                  </div>
                  {formStoffId && (
                    <div>
                      <label className="block text-xs font-medium text-s112-text-2 mb-1">Verwendet ({stoffe.find(st => st.id === formStoffId)?.einheit}) *</label>
                      <input aria-label="Verwendete Menge des Stoffs" type="text" inputMode="decimal" required value={formStoffMenge}
                        onChange={e => setFormStoffMenge(e.target.value)} className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
                    </div>
                  )}
                </div>
              )
            })()}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Menge{formEinheit !== '-' ? ' *' : ''}</label>
                <input aria-label="Menge" type="text" inputMode="decimal" value={formMenge} onChange={e => setFormMenge(e.target.value)}
                  placeholder="0,00" required={formEinheit !== '-'} className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
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
              {/* KAN-41 Paket 3b: Volumenzugang durch die Behandlung (BSM „Zugang durch Behandlung“) */}
              <div className="col-span-2 sm:col-span-1">
                <label htmlFor="behandlung-zugang" className="block text-xs font-medium text-s112-text-2 mb-1">Volumenzugang (L)</label>
                <input id="behandlung-zugang" type="text" inputMode="decimal" value={formZugang} onChange={e => setFormZugang(e.target.value)}
                  placeholder="leer = keiner" className="input w-full py-2.5 sm:py-2 text-base sm:text-sm" />
                <p className="text-[11px] text-s112-muted mt-0.5">z. B. Süßreserve, RTK – erhöht den Bestand der Charge</p>
              </div>
            </div>

            {modus === 'gebinde' && (chargenImBehaelter.length > 0 || (formWeinausbauId && formWeinausbauName)) && (
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Kellerbuch-Charge{chargenImBehaelter.length > 0 && !editId ? ' *' : ''}</label>
                <select aria-label="Kellerbuch-Charge" value={formWeinausbauId} onChange={e => setFormWeinausbauId(e.target.value)}
                  required={chargenImBehaelter.length > 0 && !editId}
                  className="input w-full py-2.5 sm:py-2 text-base sm:text-sm">
                  {/* KAN-206: Charge Pflicht, sobald Wein im Gebinde liegt – „keine Zuordnung“ nur für alte Behandlungen */}
                  <option value="">{chargenImBehaelter.length > 0 && !editId ? '– bitte wählen –' : '– keine Zuordnung –'}</option>
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
            </fieldset>
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
                className="flex-1 sm:flex-none text-base sm:text-xs bg-s112-teal text-s112-yellow px-4 py-3 sm:py-1.5 rounded-lg hover:bg-s112-teal/90 disabled:opacity-50">
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
          <p className="text-sm text-s112-muted">{behandlungen.length === 0 ? (chargeId ? 'Noch keine Kellerbehandlungen erfasst' : 'Keine Gebindepflege erfasst') : 'Keine Einträge in diesem Zeitraum'}</p>
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
                      {/* KAN-475: an der Charge steht statt der Charge das Gebinde, in dem sie am Tag der Behandlung lag */}
                      {chargeId
                        ? (b.behaelter as R | null)?.name && <p className="text-xs text-s112-text-2">lag in {(b.behaelter as R).name}</p>
                        : (b.weinausbau as R | null)?.name && <p className="text-xs text-s112-text-2">Charge: {(b.weinausbau as R).name}</p>}
                      {b.zugang_liter != null && <p className="text-xs text-s112-ok-fg">Volumenzugang: +{fmtNum(parseFloat(b.zugang_liter))} L</p>}
                      {b.sammel_id && <p className="text-xs text-s112-muted"><Link href="/kellerbuch/sammelbehandlung" className="hover:underline">Teil einer Sammelmaßnahme</Link></p>}
                      {b.notizen && <p className="text-xs text-s112-muted">{b.notizen}</p>}
                      {b.storniert_am && (
                        <p className="text-[11px] text-s112-warn-fg">
                          storniert am {new Date(b.storniert_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}{b.storniert_von_name ? ` von ${b.storniert_von_name}` : ''}{b.storno_grund ? ` – ${b.storno_grund}` : ''}
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

      {/* KAN-475: Vorgeschichte aus der Ursprungscharge (nur Anzeige) */}
      {vorgeschichte.map(v => (
        <section key={`${v.charge}-${v.bis}`} aria-label={`Übernommen von Charge ${v.charge}`} className="card p-4">
          <h2 className="text-sm font-semibold text-s112-text">Übernommen von Charge {v.charge}</h2>
          <p className="text-xs text-s112-text-2 mb-2">Behandlungen der Ursprungscharge bis zum Umzug am {v.bis.split('-').reverse().join('.')} – sie gelten auch für diesen Wein und werden dort geführt.</p>
          <ul className="divide-y divide-s112-line text-sm">
            {v.zeilen.map((b: R) => (
              <li key={b.id} className="py-1.5 flex flex-wrap items-baseline gap-x-3">
                <span className="text-xs text-s112-text-2 tabular-nums whitespace-nowrap">{String(b.datum ?? '').split('-').reverse().join('.')}</span>
                <span className="font-medium text-s112-text">{(b.typ as R | null)?.name ?? b.typ_name_snapshot ?? '–'}</span>
                {b.menge != null && b.einheit !== '-' && <span className="tabular-nums text-s112-text-1">{fmtNum(parseFloat(b.menge))} {b.einheit ?? ''}</span>}
                {b.notizen && <span className="text-xs text-s112-muted">{b.notizen}</span>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
