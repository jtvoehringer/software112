import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { ohneStornierteVerschnitte } from '@/lib/kellerbuch/stornoFilter'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { fmtLiter, fmtNum } from '@/lib/format'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import WeinausbauForm from '@/components/kellerbuch/WeinausbauForm'
import { updateWeinausbau, schwundBuchen } from '../../actions'
import { kmwZuQualitaet, minQualitaet } from '@/lib/weinqualitaet'
import { folgebuchungenDerCharge, folgebuchungenText } from '@/lib/kellerbuch/folgebuchungen'
import { GEBINDEWECHSEL_OHNE } from '@/lib/kellerbuch/storno'
import VerschneidungWidget from './VerschneidungWidget'
import { ladeBewegungsgraph } from '@/lib/wein/blendKomposition'
import { bestandNachEreignis, sortenAnteile, zusammensetzung } from '@/lib/wein/mischungsrechnung'
import { PN_OFFENE_ANTRAGS_STATUS, pnStatusLabel } from '@/lib/dac/workflow'
import { gebindeText, quellGebindeDesVerschnitts, quellGebindeSchluessel, verschnittQuelleText, type Quellgebinde } from '@/lib/kellerbuch/quellGebinde'
import HerkunftJournalKarte from './HerkunftJournalKarte'
import { chargePnSperre } from '@/lib/kellerbuch/chargeRegeln'
import SchwundBuchenForm from './SchwundBuchenForm'
import MostgewichtAnzeige from '@/components/wein/MostgewichtAnzeige'
import UmziehenWidget from '@/components/kellerbuch/UmziehenWidget'
import { umziehen } from '../../umziehen/actions'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { Wine, ArrowLeftRight, GitMerge, BookOpen, Microscope, Award, TrendingDown, ArrowDownWideNarrow } from 'lucide-react'

export const metadata: Metadata = { title: 'Charge bearbeiten – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  ernte:        { label: 'Ernte',         color: 'bg-s112-warn-bg text-s112-warn-fg' },
  gaerung:      { label: 'Gärung',        color: 'bg-s112-warn-bg text-s112-warn-fg' },
  ausbau:       { label: 'Ausbau',        color: 'bg-s112-blue-100 text-s112-blue-700' },
  abfuellung:   { label: 'Abfüllung',     color: 'bg-[#F2F3F5] text-s112-text-1' },
  abgeschlossen:{ label: 'Abgeschlossen', color: 'bg-s112-ok-bg text-s112-ok-fg' },
}

export default async function WeinausbauDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ form?: string; quelle?: string; menge?: string; abstufung?: string }> }) {
  const { id } = await params
  const { form: openForm, quelle: initialQuelleId, menge: initialQuelleMenge, abstufung: abstufungParam } = await searchParams
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const writeOk    = canWrite(role, 'kellerbuch')
  const membership = await getCurrentMembership()
  const tenantId   = membership?.tenantId ?? null
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb – ohne diesen Filter könnten bei
  // Mehrfach-Mitgliedschaft Daten vom falschen Betrieb angezeigt werden (inkl. Zugriff auf
  // fremde Chargen per ID-Ratespiel auf dieser [id]-Detailseite).
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const [
    { data: rows },
    { data: wgRaw },
    bhRows,
    { data: umzuegeAusRaw },
    { data: umzuegeEinRaw },
    { data: fuellungenRaw },
    { data: verkaufRaw },
    { data: pressungenRaw },
    { data: wawRaw },
    { data: alleChargenRaw },
    { data: verschnEinRaw },
    { data: zukaufRaw },
    { data: verschnAusRaw },
  ] = await Promise.all([
    tf((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, weingarten_id, behaelter_id, menge_liter, anfangsbestand_liter, ist_eroeffnungsbestand, status, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, weinart, notizen, aktiv, einstandspreis_pro_liter, kmw, oechsle, mostgewicht_einheit, behaelter:behaelter_id(name)')
      .eq('id', id).limit(1)),
    tf((supabase.from('weingarten') as any).select('id, name').eq('aktiv', true).order('name')),
    // Gebinde als Umzugsziele: eigene + freigegebene, fremd belegte ausgenommen (Migration 203).
    // Das eigene aktuelle Gebinde der Charge wird unten wieder ergänzt (Volumen-Lookup).
    ladeBehaelter(supabase, tenantId, { nurAktiv: true }),
    // Ausgehende Umzüge (von dieser Charge weg) – enthält 'transfer' und 'quelle'-Zeilen
    // sowie Schwundbuchungen (umzug_typ 'schwund')
    tf((supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, nach_behaelter:nach_behaelter_id(name), notizen, umzug_batch_id, zeilen_typ')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('von_weinausbau_id', id)
      .order('datum', { ascending: true })),
    // Eingehende Umzüge (in diese Charge rein) – enthält 'transfer' und 'ziel'-Zeilen
    tf((supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name)), notizen, umzug_batch_id, zeilen_typ')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('nach_weinausbau_id', id)
      .order('datum', { ascending: true })),
    // Abfüllungen – nur aktive: das Löschen einer Füllung bucht ihre Liter auf die Charge
    // zurück (wie im Bewegungsbuch des Gebindes), sie gehört dann nicht mehr in den Saldo
    tf((supabase.from('fuellungen') as any)
      .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, pruefnummer, chargennummer')
      .eq('weinausbau_id', id)
      .eq('aktiv', true)
      .order('datum', { ascending: true })),
    // Tank-Verkäufe
    tf((supabase.from('verkauf_positionen') as any)
      .select('id, menge, einheit, verkaufsposten:verkaufsposten_id(datum, storniert)')
      .eq('weinausbau_id', id)
      .eq('typ', 'tank')
      .order('id', { ascending: true })),
    // Pressungen / Ernte
    // storno-sichtbar: die Chargen-Seite zeigt die Herkunft auch einer stornierten Pressungs-Charge (KAN-148 C1c)
    (supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, notizen, storniert_am, pressung:pressung_id(datum, notizen, kmw_grad, storniert_am)')
      .eq('weinausbau_id', id)
      .order('id', { ascending: true }),
    // Verknüpfte Rieden / Weingärten
    tf((supabase.from('weinausbau_weingaerten') as any)
      .select('weingarten_id')
      .eq('weinausbau_id', id)),

    // Alle anderen aktiven Chargen (für Verschneidungs- und Umziehen-Formular)
    alle(tf((supabase.from('weinausbau') as any)
      .select('id, name, menge_liter, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, behaelter_id, rebsorte, weinart')
      .eq('aktiv', true)
      .neq('id', id)
      .order('name').order('id'))),

    // Verschneidungen: diese Charge als Ziel – KAN-77: mit Quell-Charge (Quellgebinde) und Qualität für das Badge
    tf((supabase.from('verschneidungen') as any)
      .select('id, datum, notizen, ziel_weinausbau_id, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter, anteil_pct, quell_behaelter_id, gebinde_rekonstruiert, quelle:quell_weinausbau_id(id, name, rebsorte, qualitaetsstufe, zusatzbezeichnung, erzeugnis))')
      .is('storniert_am', null)   // KAN-145: stornierte Buchungen zählen nicht
      .eq('ziel_weinausbau_id', id)
      .order('datum', { ascending: false })),

    // Zukauf-Eingang (Wein/Most direkt in diese Charge gekauft) – fehlte bisher komplett in
    // diesem Bewegungsbuch (siehe zukauf_ein-CTE in v_behaelter_fuellstand, Migration 127, die
    // ihn längst korrekt mitrechnet). Ohne diesen Zugang lief der hier lokal nachgerechnete
    // Saldo für jede Zukauf-basierte Charge sobald abgefüllt/verkauft wurde ins Negative – und
    // der (fehlerhafte) Saldo wurde per Auto-Sync unten sogar in weinausbau.menge_liter
    // zurückgeschrieben.
    tf((supabase.from('zukauf_posten') as any)
      .select('id, datum, menge, rebsorte, jahrgang')
      .eq('ziel_weinausbau_id', id)
      .eq('aktiv', true)
      .in('art', ['wein', 'most'])
      .order('datum', { ascending: true })),

    // Ausgehende Verschneidungen (diese Charge als Quelle) – fehlten bisher im Saldo, der
    // Auto-Sync füllte Quell-Chargen eines Verschnitts dadurch beim Öffnen wieder auf (KAN-35).
    // verschneidung_quellen hat keine tenant_id (RLS über verschneidungen); die Charge selbst
    // ist oben auf den aktiven Betrieb gefiltert.
    (supabase.from('verschneidung_quellen') as any)
      .select('menge_liter, verschneidung:verschneidung_id(datum, notizen, storniert_am, ziel:ziel_weinausbau_id(name))')
      .eq('quell_weinausbau_id', id),
  ])

  const ausRecs = (umzuegeAusRaw ?? []) as R[]
  const einRecs = (umzuegeEinRaw ?? []) as R[]

  // Sekundäre Abfragen für das neue n:n-Format
  // Für 'quelle'-Zeilen: Ziel-Gebinde-Namen laden
  const quelleAusBatchIds = [...new Set(
    ausRecs.filter(u => u.zeilen_typ === 'quelle').map(u => u.umzug_batch_id).filter(Boolean)
  )] as string[]
  // Für 'ziel'-Zeilen: Quell-Chargen-Namen laden
  const zielEinBatchIds = [...new Set(
    einRecs.filter(u => u.zeilen_typ === 'ziel').map(u => u.umzug_batch_id).filter(Boolean)
  )] as string[]

  const zielRecsByBatch:  Record<string, R[]> = {}
  const quelleRecsByBatch: Record<string, R[]> = {}

  if (quelleAusBatchIds.length > 0) {
    // alle-ausnahme: Umzüge einer einzelnen Charge, wenige
    const { data: zielRaw } = await tf((supabase.from('keller_umzuege') as any)
      // nach_weinausbau als Fallback wenn nach_behaelter_id NULL ist
      .select('umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
      .in('umzug_batch_id', quelleAusBatchIds)
      .eq('zeilen_typ', 'ziel'))
    for (const z of ((zielRaw ?? []) as R[])) {
      if (!zielRecsByBatch[z.umzug_batch_id]) zielRecsByBatch[z.umzug_batch_id] = []
      zielRecsByBatch[z.umzug_batch_id].push(z)
    }
  }

  if (zielEinBatchIds.length > 0) {
    // alle-ausnahme: Umzüge einer einzelnen Charge, wenige
    const { data: quelleRaw } = await tf((supabase.from('keller_umzuege') as any)
      // von_behaelter direkt (einstufig) als Fallback wenn doppelter Join fehlschlägt
      .select('umzug_batch_id, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name)), brutto_liter')
      .in('umzug_batch_id', zielEinBatchIds)
      .eq('zeilen_typ', 'quelle'))
    for (const q of ((quelleRaw ?? []) as R[])) {
      if (!quelleRecsByBatch[q.umzug_batch_id]) quelleRecsByBatch[q.umzug_batch_id] = []
      quelleRecsByBatch[q.umzug_batch_id].push(q)
    }
  }

  type WeinausbauRow = {
    id: string; name: string; jahrgang: number | null; rebsorte: string | null; weinart: string | null
    weingarten_id: string | null; behaelter_id: string | null; menge_liter: number | null
    anfangsbestand_liter: number | null; ist_eroeffnungsbestand: boolean | null; status: string; qualitaetsstufe: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null; herkunft_code: string | null
    notizen: string | null; aktiv: boolean; einstandspreis_pro_liter: number | null
    kmw: number | string | null; oechsle: number | string | null; mostgewicht_einheit: string | null
    behaelter: { name: string } | null
  }
  type NameRow = { id: string; name: string }

  const weinausbau = (((rows ?? []) as R[])[0] ?? null) as WeinausbauRow | null
  if (!weinausbau) notFound()

  const weingaerten = (wgRaw ?? []) as NameRow[]
  const behaelter   = bhRows.filter(b => !b.gesperrt).map(b => ({ id: b.id, name: b.anzeigeName, volumen_liter: b.volumen_liter })) as (NameRow & { volumen_liter: number | null })[]
  const selectedWeingaertenIds = ((wawRaw ?? []) as R[]).map(r => r.weingarten_id as string)

  const alleChargen = (alleChargenRaw ?? []) as { id: string; name: string; menge_liter: number | null; qualitaetsstufe: string | null; zusatzbezeichnung?: string | null; erzeugnis?: string | null; herkunft_code?: string | null; behaelter_id: string | null; rebsorte?: string | null; weinart?: string | null }[]
  const verschneidungenEin = (verschnEinRaw ?? []) as R[]
  // KAN-77: Quellgebinde je Verschnitt-Quelle am Tag des Verschnitts (nicht das heutige Gebinde der Quelle)
  const quellGebinde: Map<string, Quellgebinde> = tenantId && verschneidungenEin.length > 0
    ? await quellGebindeDesVerschnitts(supabase, tenantId, verschneidungenEin.map(v => ({
      id: v.id, datum: v.datum ?? null, ziel_weinausbau_id: v.ziel_weinausbau_id ?? id,
      // KAN-112: Momentaufnahme des Gebindes am Verschnitt (Vorrang vor der Regel)
      quellen: ((v.quellen ?? []) as R[]).map(q => ({ quell_weinausbau_id: q.quell_weinausbau_id ?? (q.quelle as R | null)?.id ?? null, quell_behaelter_id: q.quell_behaelter_id ?? null, gebinde_rekonstruiert: q.gebinde_rekonstruiert ?? null })),
    })))
    : new Map()
  const quellGebindeVon = (v: R, q: R): Quellgebinde | null => {
    const qid = q.quell_weinausbau_id ?? (q.quelle as R | null)?.id
    return qid ? quellGebinde.get(quellGebindeSchluessel(v.id, qid)) ?? null : null
  }
  // KAN-112: nachträglich ermitteltes Gebinde mit Hinweis „(Gebinde rekonstruiert)“
  const gebindeDerQuelle = (v: R, q: R): string | null => { const g = quellGebindeVon(v, q); return gebindeText(g?.name, g?.rekonstruiert) }

  const anfangsbestand    = parseFloat(String(weinausbau.anfangsbestand_liter ?? 0)) || 0
  const aktuell           = parseFloat(String(weinausbau.menge_liter ?? 0)) || 0
  // Nur bei echten Eröffnungsbestand-Chargen (ist_eroeffnungsbestand=true) als eigene
  // "Anfangsbestand"-Zeile zeigen. Chargen, die per Umzug/Zukauf neu entstanden sind, können
  // ebenfalls einen (historisch teils fälschlich gesetzten) anfangsbestand_liter-Wert tragen -
  // deren Zugang ist aber bereits als eigene Bewegung (Zukauf/Zugang aus X) im Bewegungsbuch
  // erfasst; eine zusätzliche Anfangsbestand-Zeile würde denselben Zugang doppelt zählen
  // (Bugreport 5.8.2026, Charge "Partywein Kängaru").
  const hatAnfangsbestand = anfangsbestand > 0 && weinausbau.ist_eroeffnungsbestand === true

  type Bewegung = {
    datum: string
    art: 'zukauf' | 'ernte' | 'umziehen_ein' | 'umziehen_aus' | 'verschnitt_aus' | 'schwund' | 'abfuellung' | 'verkauf'
    beschreibung: string
    menge: number
    extra?: string
  }

  const bewegungen: Bewegung[] = []

  // Maximale Qualitätsstufe aus verlinkten Pressungen (KMW-Ableitung)
  const maxQualitaetsstufe: string | null = (() => {
    const kmwWerte = ((pressungenRaw ?? []) as R[])
      .map(p => {
        const kmw = parseFloat((p.pressung as R | null)?.kmw_grad)
        return isNaN(kmw) ? null : kmwZuQualitaet(kmw)
      })
      .filter((q): q is string => q !== null)
    if (kmwWerte.length === 0) return null
    return minQualitaet(kmwWerte)
  })()

  // Zukauf (Zugänge)
  for (const z of ((zukaufRaw ?? []) as R[])) {
    const liter = parseFloat(z.menge) || 0
    if (liter <= 0) continue
    const bezeichnung = [z.rebsorte ? formatRebsorteMitKuerzel(z.rebsorte) : null, z.jahrgang].filter(Boolean).join(' ')
    bewegungen.push({
      datum: z.datum ?? '',
      art: 'zukauf',
      beschreibung: `Zukauf${bezeichnung ? `: ${bezeichnung}` : ''}`,
      menge: liter,
    })
  }

  // Pressungen / Ernte (Zugänge)
  for (const p of ((pressungenRaw ?? []) as R[])) {
    const liter = parseFloat(p.menge_liter) || 0
    const press = p.pressung as R | null
    bewegungen.push({
      datum: press?.datum ?? '',
      art: 'ernte',
      beschreibung: `Ernte / Pressung${press?.notizen ? ` – ${press.notizen}` : ''}`,
      menge: liter,
      extra: p.notizen ?? undefined,
    })
  }

  // Eingehende Verschneidungen (Zugänge)
  for (const v of verschneidungenEin) {
    const quellen = (v.quellen ?? []) as R[]
    const gesamtLiter = quellen.reduce((s: number, q: R) => s + (parseFloat(q.menge_liter) || 0), 0)
    if (gesamtLiter <= 0) continue
    // KAN-77: „Verschneidung von Grüner Veltliner Sandgrube (Stahltank 03) · 48 L“
    const quellenText = quellen.map((q: R) => { const g = quellGebindeVon(v, q); return verschnittQuelleText((q.quelle as R | null)?.name, g?.name, `${fmtNum(parseFloat(q.menge_liter) || 0)} L`, g?.rekonstruiert) }).join(', ')
    bewegungen.push({
      datum: v.datum,
      art: 'umziehen_ein',
      beschreibung: `Verschneidung von ${quellenText}`,
      menge: gesamtLiter,
      extra: v.notizen ?? undefined,
    })
  }

  // Eingehende Umzüge (Zugänge)
  for (const u of einRecs) {
    const liter = parseFloat(u.menge_liter) || 0
    let beschreibung: string

    if (u.zeilen_typ === 'ziel') {
      // Neues Format: Quell-Namen aus quelleRecsByBatch holen
      const quelleRecs = quelleRecsByBatch[u.umzug_batch_id] ?? []
      const quelleNames = quelleRecs.map((q: R) => {
        const wa         = q.von_weinausbau as R | null
        const waName     = wa?.name ?? null
        // Behälter: zuerst aus doppeltem Join, dann aus direktem FK-Join
        const tankFromWA = (wa?.behaelter as R | null)?.name ?? null
        const tankDirekt = (q.von_behaelter as R | null)?.name ?? null
        const tank       = tankFromWA ?? tankDirekt ?? null
        if (tank && waName) return `${tank} (${waName})`
        if (tank) return tank
        if (waName) return waName
        return '?'
      })
      beschreibung = `Zugang aus ${quelleNames.length > 0 ? quelleNames.join(', ') : '?'}`
    } else {
      // Altes Format (transfer / null)
      const vonCharge = u.von_weinausbau as R | null
      const vonTank   = (vonCharge?.behaelter as R | null)?.name ?? null
      const vonName   = vonCharge?.name ?? '?'
      beschreibung    = `Zugang aus ${vonTank ? `${vonTank} (${vonName})` : vonName}`
    }

    bewegungen.push({
      datum: u.datum,
      art: 'umziehen_ein',
      beschreibung,
      menge: liter,
      extra: u.notizen ?? undefined,
    })
  }

  // Ausgehende Verschneidungen (Abgänge) – diese Charge als Quelle eines Verschnitts
  for (const vq of ohneStornierteVerschnitte((verschnAusRaw ?? []) as R[])) {   // KAN-145
    const liter = parseFloat(vq.menge_liter) || 0
    if (liter <= 0) continue
    const v = vq.verschneidung as R | null
    const zielName = (v?.ziel as R | null)?.name ?? '?'
    bewegungen.push({
      datum: v?.datum ?? '',
      art: 'verschnitt_aus',
      beschreibung: `Verschneidung nach ${zielName}`,
      menge: -liter,
      extra: v?.notizen ?? undefined,
    })
  }

  // Ausgehende Umzüge (Abgänge)
  for (const u of ausRecs) {
    // 'ziel'-Zeilen gehören nicht in diese Charge als Abgang
    if (u.zeilen_typ === 'ziel') continue

    // Schwundbuchung (schwund_buchen, Abfüllschwund, Nachbuchung): brutto = schwund = Verlust
    if (u.umzug_typ === 'schwund') {
      const verlust = parseFloat(u.brutto_liter) || parseFloat(u.schwund_liter) || 0
      if (verlust <= 0) continue
      bewegungen.push({
        datum: u.datum,
        art: 'schwund',
        beschreibung: 'Schwund / Verlust',
        menge: -verlust,
        extra: u.notizen ?? undefined,
      })
      continue
    }

    let abgangLiter: number
    let beschreibung: string

    if (u.zeilen_typ === 'quelle') {
      // Neues Format: brutto_liter ist der tatsächliche Abgang
      abgangLiter = parseFloat(u.brutto_liter) || parseFloat(u.menge_liter) || 0
      const zielRecs  = zielRecsByBatch[u.umzug_batch_id] ?? []
      const zielNames = zielRecs.map((z: R) => {
        // nach_behaelter bevorzugen, nach_weinausbau als Fallback
        const behName = (z.nach_behaelter as R | null)?.name ?? null
        const waName  = (z.nach_weinausbau as R | null)?.name ?? null
        return behName ?? waName ?? '?'
      })
      const sumNetto  = zielRecs.reduce((s: number, z: R) => s + (parseFloat(z.menge_liter) || 0), 0)
      const schwund   = abgangLiter - sumNetto
      beschreibung    = `Umziehen → ${zielNames.length > 0 ? zielNames.join(', ') : '?'}${schwund > 0.01 ? ` (Schwund: ${fmtNum(schwund, 2)} L)` : ''}`
    } else {
      // Altes Format (transfer)
      const netto   = parseFloat(u.menge_liter) || 0
      const schwund = parseFloat(u.schwund_liter) || 0
      // brutto_liter bevorzugen, sonst netto + schwund
      abgangLiter   = parseFloat(u.brutto_liter) || (netto + schwund) || netto
      const destName = (u.nach_behaelter as R | null)?.name ?? '?'
      beschreibung   = `Umziehen → ${destName}${schwund > 0.01 ? ` (Schwund: ${fmtNum(schwund, 2)} L)` : ''}`
    }

    bewegungen.push({
      datum: u.datum,
      art: 'umziehen_aus',
      beschreibung,
      menge: -abgangLiter,
      extra: u.notizen ?? undefined,
    })
  }

  // Abfüllungen (Abgänge)
  for (const f of ((fuellungenRaw ?? []) as R[])) {
    const liter = parseFloat(f.menge_liter_gefuellt) || (parseInt(f.anzahl_flaschen) * parseInt(f.flaschengroesse_ml) / 1000)
    bewegungen.push({
      datum: f.datum,
      art: 'abfuellung',
      beschreibung: `Abfüllung: ${f.name}${f.pruefnummer ? ` · Prüfnr. ${f.pruefnummer}` : ''}${f.chargennummer ? ` · Ch. ${f.chargennummer}` : ''}`,
      menge: -liter,
      extra: `${fmtNum(parseInt(f.anzahl_flaschen))} Fl. à ${parseInt(f.flaschengroesse_ml)} ml`,
    })
  }

  // Tank-Verkäufe (Abgänge)
  for (const v of ((verkaufRaw ?? []) as R[])) {
    const vp = v.verkaufsposten as R | null
    if (vp?.storniert) continue
    const liter = parseFloat(v.menge) || 0
    bewegungen.push({
      datum: vp?.datum ?? '',
      art: 'verkauf',
      beschreibung: 'Tank-Verkauf',
      menge: -liter,
    })
  }

  bewegungen.sort((a, b) => a.datum.localeCompare(b.datum))

  // Saldo: startet beim Anfangsbestand (wenn vorhanden), sonst 0
  let saldo = hatAnfangsbestand ? anfangsbestand : 0
  const bewegungenMitSaldo = bewegungen.map(bew => {
    saldo += bew.menge
    return { ...bew, saldo }
  })

  // Saldo laut Bewegungsbuch (Kontrollwert). Maßgeblicher Bestand ist seit KAN-35 der
  // gebuchte Bestand der Charge (weinausbau.menge_liter) – ihn prüfen und ändern alle
  // Buchungen (Umzug, Verschnitt, Füllung, Verkauf, Schwund).
  const berechneterSaldoRoh = bewegungenMitSaldo.length > 0
    ? bewegungenMitSaldo[bewegungenMitSaldo.length - 1].saldo
    : hatAnfangsbestand ? anfangsbestand : aktuell

  // Ein negativer Saldo bedeutet, dass laut Bewegungsbuch mehr aus der Charge
  // entnommen wurde, als je vorhanden war (z.B. ein Tank-Verkauf, der trotz
  // bereits leerem Bestand durchging, siehe Bugreport 6.8.2026). Der Saldo wird
  // in der Tabelle bei 0 gekappt angezeigt und die Unstimmigkeit sichtbar gemacht.
  const bestandsUnstimmigkeit = berechneterSaldoRoh < -0.01
  const berechneterSaldo = Math.max(0, berechneterSaldoRoh)

  // KAN-35 (24.09.2026): Der frühere Auto-Sync (menge_liter = Saldo bei Abweichung > 1 L)
  // ist entfernt – ein Seitenaufruf änderte damit Mengen ohne datierte Zeile und machte
  // Ausbuchungen bzw. Verschnitt-Abgänge still rückgängig. Stattdessen nur ein Hinweis;
  // korrigiert wird über „Schwund buchen“ bzw. nach Prüfung des Bestands.
  const bestandsAbweichung = !bestandsUnstimmigkeit && Math.abs(berechneterSaldoRoh - aktuell) > 1
  const bewegungsbuchHoeher = berechneterSaldoRoh > aktuell

  // Gebindewechsel im Formular nur ohne Folgebuchungen (Server prüft dasselbe)
  const vonPressung = ((pressungenRaw ?? []) as R[]).length > 0
  let gebindeSperre: string | null = null
  // KAN-150 F1d: mit Folgebuchungen braucht eine Änderung der Rieden einen Grund (Server prüft dasselbe)
  let herkunftGrundNoetig: string | null = null
  if (writeOk) {
    try {
      const alle = await folgebuchungenDerCharge(supabase, id)
      if (alle.length > 0) {
        const einzeln = alle.length === 1 && alle[0].anzahl === 1
        herkunftGrundNoetig = `${einzeln ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(alle)}`
      }
    } catch {
      herkunftGrundNoetig = 'hängen möglicherweise Folgebuchungen (Prüfung fehlgeschlagen)'
    }
  }
  if (writeOk && !vonPressung) {
    try {
      const f = await folgebuchungenDerCharge(supabase, id, { ohne: GEBINDEWECHSEL_OHNE })
      if (f.length > 0) {
        const einzeln = f.length === 1 && f[0].anzahl === 1
        gebindeSperre = `An der Charge ${einzeln ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(f)} – einen Gebindewechsel bitte als Umzug buchen.`
      }
    } catch {
      gebindeSperre = 'Folgebuchungen konnten nicht geprüft werden – einen Gebindewechsel bitte als Umzug buchen.'
    }
  }

  const st = STATUS_LABELS[weinausbau.status] ?? { label: weinausbau.status, color: 'bg-[#F2F3F5] text-s112-text-2' }

  // KAN-98: Prüfnummernanträge der Charge (Badge, offener Antrag statt eines zweiten)
  const { data: pnRaw } = await tf((supabase.from('dac_antrag') as any)
    .select('id, bezeichnung, status, pruefnummer, status_seit')
    .eq('weinausbau_id', weinausbau.id).is('storniert_am', null)
    .order('created_at', { ascending: false }))
  const pnAntraege = (pnRaw ?? []) as R[]
  const pnOffen = pnAntraege.find(a => (PN_OFFENE_ANTRAGS_STATUS as readonly string[]).includes(a.status)) ?? null
  // KAN-99: Gültigkeit je Charge (auch per Umzug weitergegeben) – „PN … gültig“ bzw. „für Tankbestand erloschen am …“
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: pncRaw } = await tf((supabase.from('pruefnummer_chargen') as any)
    .select('id, dac_antrag_id, gueltig_ab, gueltig_bis, ende_grund, quelle_vorgang, antrag:dac_antrag_id(pruefnummer, status, storniert_am)')
    .eq('weinausbau_id', weinausbau.id)
    .order('gueltig_ab', { ascending: false }))
  const pnGueltigkeit = ((pncRaw ?? []) as R[]).filter(g => (g.antrag as R | null)?.pruefnummer && !(g.antrag as R | null)?.storniert_am)
  const pnGilt = pnGueltigkeit.find(g => !g.gueltig_bis && (g.antrag as R).status === 'genehmigt') ?? null
  const pnErloschen = pnGilt ? null : (pnGueltigkeit.find(g => g.gueltig_bis) ?? null)
  // KAN-204: Sperrstufe für das Bearbeiten (dieselbe Regel wie updateWeinausbau und der Trigger a_freeze)
  const pnSperre = chargePnSperre(pnAntraege as { status: string | null }[], (pncRaw ?? []) as { gueltig_bis: string | null }[])
  const pnZugeteilt = pnGilt
    ? { id: pnGilt.dac_antrag_id, pruefnummer: (pnGilt.antrag as R).pruefnummer, geerbt: !!pnGilt.quelle_vorgang }
    : null

  // KAN-76: „Besteht aus“ aus dem zeitrichtigen Rechenkern (Rebsorten je Liter im heutigen Bestand) statt
  // „Bestand − Summe der Verschnitte“ – nur wenn die Charge Verschnitte hat, wie bisher
  const graph = tenantId && verschneidungenEin.length > 0 ? await ladeBewegungsgraph(supabase, tenantId, [weinausbau.id]) : null
  const bestehtAus = graph
    ? sortenAnteile(zusammensetzung(graph.ereignisse, weinausbau.id, { gebuchterBestand: aktuell, name: weinausbau.name }).anteile)
    : null
  // KAN-77: Anteil jeder Quelle am ERGEBNIS des Verschnitts (Quell-Liter / Bestand der Charge unmittelbar danach,
  // Rechenkern KAN-76) statt am Verschnitt allein („48 L (100 %)“); dazu das Quellgebinde für die Anzeige
  const verschneidungenAnzeige = verschneidungenEin.map(v => {
    const ergebnis = graph ? bestandNachEreignis(graph.ereignisse, weinausbau.id, `vs:${v.id}`) : null
    return {
      ...v,
      quellen: ((v.quellen ?? []) as R[]).map(q => {
        const l = parseFloat(q.menge_liter) || 0
        return { ...q, gebinde: gebindeDerQuelle(v, q), anteil_ergebnis_pct: ergebnis && ergebnis > 0.005 ? Math.round(l / ergebnis * 1000) / 10 : null }
      }),
    }
  })

  return (
    <div className="max-w-4xl space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <Link href="/kellerbuch/weinausbau" className="hover:text-s112-blue-700 transition-colors">Weinausbau</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{weinausbau.name}</span>
      </div>

      {bestandsUnstimmigkeit && (
        <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg px-4 py-3 rounded-lg text-sm">
          <p className="font-semibold">Unstimmigkeit im Bewegungsbuch</p>
          <p className="mt-0.5">
            Laut Bewegungsbuch wurde mehr aus dieser Charge entnommen, als je vorhanden war
            (berechneter Saldo: {fmtLiter(berechneterSaldoRoh)}, gebuchter Bestand: {fmtLiter(aktuell)}).
            Der Saldo wird unten bei 0 L gekappt angezeigt – bitte die Bewegungen (insbesondere
            Tank-Verkäufe und Zugänge) prüfen. Fehlt ein Zugang, bitte den Support kontaktieren
            (Charge, Menge und Grund angeben). Bitte hier KEINEN Schwund buchen – das mindert Bestand
            und Saldo gleichermaßen und behebt die Abweichung nicht.
          </p>
        </div>
      )}

      {bestandsAbweichung && (
        <div role="status" className="bg-s112-warn-bg border border-s112-warn/30 text-s112-warn-fg px-4 py-3 rounded-lg text-sm">
          <p className="font-semibold">Bestand und Bewegungsbuch stimmen nicht überein</p>
          <p className="mt-0.5">
            Gebuchter Bestand der Charge: {fmtLiter(aktuell)} · Saldo laut Bewegungsbuch: {fmtLiter(berechneterSaldoRoh)}.{' '}
            {bewegungsbuchHoeher
              ? 'Laut Bewegungsbuch ist mehr vorhanden als gebucht – fehlt z. B. eine Schwundbuchung, kann sie im Bewegungsbuch des Gebindes nachgebucht werden (die Nachbuchung ändert den gebuchten Bestand nicht).'
              : 'Laut Bewegungsbuch ist weniger vorhanden als gebucht – vermutlich fehlt im Bewegungsbuch ein Zugang (z. B. aus der Zeit vor den datierten Buchungen). Bitte die Bewegungen prüfen und ggf. den Support kontaktieren (Charge, Menge und Grund angeben). Bitte hier KEINEN Schwund buchen – das mindert Bestand und Saldo gleichermaßen und behebt die Abweichung nicht.'}
            {' '}Der Bestand wird nicht mehr automatisch angeglichen.
          </p>
          {bewegungsbuchHoeher && writeOk && weinausbau.behaelter_id && (
            <Link href={`/kellerbuch/behaelter/${weinausbau.behaelter_id}/bewegungen`}
              className="mt-1.5 inline-block text-xs font-medium underline hover:no-underline">
              Zum Bewegungsbuch des Gebindes →
            </Link>
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">{weinausbau.name}</h1>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${st.color}`}>{st.label}</span>
            {weinausbau.jahrgang && <span className="text-xs text-s112-muted">Jahrgang {weinausbau.jahrgang}</span>}
            {weinausbau.behaelter && <span className="text-xs text-s112-muted">in {weinausbau.behaelter.name}</span>}
            {/* KAN-131: Mostgewicht der Charge (Pressung, Zukauf, Eröffnungsbestand bzw. Umzug) */}
            {(weinausbau.kmw != null || weinausbau.oechsle != null) && (
              <span className="text-xs text-s112-muted">Mostgewicht <MostgewichtAnzeige wert={{ kmw: weinausbau.kmw, oechsle: weinausbau.oechsle, einheit: weinausbau.mostgewicht_einheit }} /></span>
            )}
            {pnZugeteilt && (
              <Link href={`/dac/${pnZugeteilt.id}`} className="text-xs font-mono bg-s112-ok-bg text-s112-ok-fg px-2 py-0.5 rounded-full hover:underline"
                title={pnZugeteilt.geerbt ? 'Per Umzug aus der Antrags-Charge übernommen' : undefined}>
                PN {pnZugeteilt.pruefnummer} gültig{pnZugeteilt.geerbt ? ' (übernommen)' : ''}
              </Link>
            )}
            {pnErloschen && (
              <Link href={`/dac/${pnErloschen.dac_antrag_id}`} className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full hover:underline">
                PN {(pnErloschen.antrag as R).pruefnummer} – für Tankbestand erloschen am {new Date(pnErloschen.gueltig_bis).toLocaleDateString('de-AT')}
              </Link>
            )}
            {pnOffen && (
              <Link href={`/dac/${pnOffen.id}`} className="text-xs bg-s112-blue-100 text-s112-blue-700 px-2 py-0.5 rounded-full hover:underline">
                Prüfnummernantrag: {pnStatusLabel(pnOffen.status)}
              </Link>
            )}
          </div>
        </div>
        <div className="sm:text-right shrink-0">
          <p className="text-2xl font-semibold text-s112-blue-700 tabular-nums">{fmtLiter(aktuell)}</p>
          <p className="text-xs text-s112-muted mt-0.5">verfügbarer Bestand</p>
          {/* KAN-181: am Handy als umbrechende Knopfzeile; ab sm wie bisher (Block, mt der Knöpfe gilt) */}
          <div className="flex flex-wrap gap-2 mt-2 sm:block sm:mt-0 max-sm:*:mt-0">
          {writeOk && aktuell > 0.01 && (
            <Link href={`/weinhandel/fuellungen/neu?charge=${weinausbau.id}`}
              className="mt-2 inline-flex items-center gap-1 text-xs bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg hover:bg-s112-teal/90 transition-colors">
              <Wine size={13} strokeWidth={1.75} />Abfüllen
            </Link>
          )}
          {writeOk && aktuell > 0.01 && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}?form=umziehen`}
              className="mt-1 inline-flex items-center gap-1 text-xs bg-s112-teal text-s112-yellow px-3 py-1 rounded-lg hover:bg-s112-teal/90 transition-colors">
              <ArrowLeftRight size={13} strokeWidth={1.75} />Umziehen
            </Link>
          )}
          {writeOk && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}?form=verschneiden`}
              className="mt-1 inline-flex items-center gap-1 text-xs bg-s112-grey text-white px-3 py-1 rounded-lg hover:bg-s112-grey/90 transition-colors">
              <GitMerge size={13} strokeWidth={1.75} />Verschneiden
            </Link>
          )}
          {writeOk && aktuell > 0.01 && (
            <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/abstufen`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <ArrowDownWideNarrow size={13} strokeWidth={1.75} />Abstufen
            </Link>
          )}
          <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/buch`}
            className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
            <BookOpen size={13} strokeWidth={1.75} />Weinbuch
          </Link>
          <Link href={`/kellerbuch/weinausbau/${weinausbau.id}/analysen`}
            className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
            <Microscope size={13} strokeWidth={1.75} />Analysen
          </Link>
          {writeOk && (
            <Link href={pnOffen ? `/dac/${pnOffen.id}` : `/dac/neu?charge=${weinausbau.id}`}
              className="mt-1 inline-flex items-center gap-1 text-xs border border-s112-border text-s112-blue-700 px-3 py-1 rounded-lg hover:bg-s112-bg transition-colors">
              <Award size={13} strokeWidth={1.75} />{pnOffen ? 'Prüfnummernantrag' : 'Prüfnummer'}
            </Link>
          )}
          </div>
        </div>
      </div>

      {/* Abstufungs-Hinweis nach Umziehen */}
      {abstufungParam && (
        <div className="flex items-start gap-3 bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-sm text-s112-warn-fg">
          <TrendingDown size={18} strokeWidth={1.75} className="mt-0.5 text-s112-warn-fg shrink-0" />
          <div>
            <p className="font-semibold">Qualitätsabstufung durch Zusammenführung</p>
            <p className="text-xs mt-0.5">
              Beim Umziehen wurde die Qualitätsstufe automatisch abgestuft:
              {' '}<strong>{decodeURIComponent(abstufungParam).replace('→', ' → ')}</strong>.
              Der Hinweis wurde in den Notizen der Charge gespeichert.
            </p>
          </div>
        </div>
      )}

      {/* KAN-192 B: Herkunft laut Bewegungsjournal (nur bei eröffnetem Journal) */}
      {tenantId && <HerkunftJournalKarte supabase={supabase} tenantId={tenantId} chargeId={weinausbau.id} />}

      {/* Bewegungsbuch */}
      <section>
        <h2 className="font-semibold text-s112-text mb-3">Bewegungsbuch</h2>
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-s112-text-2">Vorgang</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Menge</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-s112-text-2">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {/* Anfangsbestand – immer zeigen wenn > 0 */}
              {hatAnfangsbestand && (
                <tr className="border-b border-s112-border/40 bg-s112-ok-bg/50">
                  <td className="px-4 py-2.5 text-xs text-s112-text-2">–</td>
                  <td className="px-4 py-2.5 font-medium text-s112-text-1">Anfangsbestand</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-s112-ok-fg font-semibold">
                    +{fmtLiter(anfangsbestand, { noUnit: false })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-s112-text">
                    {fmtLiter(anfangsbestand)}
                  </td>
                </tr>
              )}

              {bewegungenMitSaldo.length === 0 && !hatAnfangsbestand && (
                <tr>
                  <td colSpan={4} className="px-4 py-4 text-center text-xs text-s112-muted italic">
                    Noch keine Bewegungen erfasst
                  </td>
                </tr>
              )}

              {bewegungenMitSaldo.map((bew, i) => {
                const istAbgang    = bew.menge < 0
                const istZugang    = bew.menge > 0
                const colorClass   = istAbgang ? 'text-s112-err-fg' : istZugang ? 'text-s112-ok-fg' : 'text-s112-text-2'
                const isZugangsRow = bew.art === 'zukauf' || bew.art === 'ernte' || bew.art === 'umziehen_ein'
                const rowBg        = isZugangsRow ? 'bg-s112-ok-bg/50' : (i % 2 === 1 ? 'bg-s112-bg/30' : '')
                return (
                  <tr key={i} className={`border-b border-s112-border/30 last:border-0 ${rowBg}`}>
                    <td className="px-4 py-2.5 text-xs text-s112-text-2 whitespace-nowrap">
                      {bew.datum ? new Date(bew.datum).toLocaleDateString('de-AT') : '–'}
                    </td>
                    <td className="px-4 py-2.5">
                      <p className="text-s112-text-1">{bew.beschreibung}</p>
                      {bew.extra && <p className="text-xs text-s112-muted">{bew.extra}</p>}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${colorClass}`}>
                      {istAbgang ? '' : '+'}{fmtLiter(bew.menge)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-s112-text-1">
                      {fmtLiter(bew.saldo)}
                    </td>
                  </tr>
                )
              })}

              {/* Saldo-Zeile */}
              <tr className="border-t-2 border-s112-teal/30 bg-s112-teal/5">
                <td colSpan={2} className="px-4 py-2.5 font-semibold text-s112-text-1 text-sm">
                  Saldo laut Bewegungsbuch
                </td>
                <td className="px-4 py-2.5 text-right" />
                <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-s112-blue-700 text-base">
                  {fmtLiter(berechneterSaldo)}
                </td>
              </tr>
              {(bestandsAbweichung || bestandsUnstimmigkeit) && (
                <tr className="bg-s112-warn-bg/60">
                  <td colSpan={2} className="px-4 py-2 text-sm text-s112-warn-fg">
                    Gebuchter Bestand der Charge (weicht ab)
                  </td>
                  <td className="px-4 py-2 text-right" />
                  <td className="px-4 py-2 text-right tabular-nums font-semibold text-s112-warn-fg">
                    {fmtLiter(aktuell)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Schwund buchen (datierte Zeile + Bestand mindern) – Korrekturweg nach unten */}
      {writeOk && aktuell > 0.01 && (
        <SchwundBuchenForm bestandLiter={aktuell} action={schwundBuchen.bind(null, id)} />
      )}

      {/* Umziehen (wird über Header-Button mit ?form=umziehen geöffnet) */}
      {writeOk && aktuell > 0.01 && (
        <UmziehenWidget
          chargeId={weinausbau.id}
          chargeName={weinausbau.name}
          verfuegbarLiter={aktuell}
          gebinde={behaelter}
          alleChargen={alleChargen}
          action={umziehen}
          initialOpen={openForm === 'umziehen'}
          quelleRebsorte={weinausbau.rebsorte ?? null}
          quelleWeinart={weinausbau.weinart ?? null}
        />
      )}

      {/* Verschneidung (wird über Header-Button mit ?form=verschneiden geöffnet) */}
      {writeOk && (
        <VerschneidungWidget
          bestehtAus={bestehtAus}
          zielCharge={{ id: weinausbau.id, name: weinausbau.name, menge_liter: aktuell, qualitaetsstufe: weinausbau.qualitaetsstufe ?? null, zusatzbezeichnung: weinausbau.zusatzbezeichnung ?? null, erzeugnis: weinausbau.erzeugnis ?? null, herkunft_code: weinausbau.herkunft_code ?? null, rebsorte: weinausbau.rebsorte ?? null, weinart: weinausbau.weinart ?? null, behaelter_id: weinausbau.behaelter_id ?? null, behaelter_volumen_liter: bhRows.find(b => b.id === weinausbau.behaelter_id)?.volumen_liter ?? null }}
          alleChargen={alleChargen}
          verschneidungen={verschneidungenAnzeige}
          initialOpen={openForm === 'verschneiden'}
          initialQuelleId={initialQuelleId}
          initialQuelleMenge={initialQuelleMenge}
        />
      )}

      {/* Edit-Formular */}
      {writeOk && (
        <section>
          <h2 className="font-semibold text-s112-text mb-3">Charge bearbeiten</h2>
          <WeinausbauForm
            weinausbau={weinausbau}
            weingaerten={weingaerten}
            behaelter={behaelter}
            selectedWeingaertenIds={selectedWeingaertenIds}
            maxQualitaetsstufe={maxQualitaetsstufe}
            vonPressung={vonPressung}
            gebindeSperre={gebindeSperre}
            herkunftGrundNoetig={herkunftGrundNoetig}
            pnSperre={pnSperre}
            action={updateWeinausbau.bind(null, id)}
          />
        </section>
      )}
    </div>
  )
}
