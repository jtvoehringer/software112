import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { Metadata } from 'next'
import Link from 'next/link'
import ReportsClient from './ReportsClient'

export const metadata: Metadata = { title: 'Reports – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ReportsPage() {
  const supabase = await createSupabaseServerClient()

  const heute = new Date()
  const thisYear  = heute.getFullYear()
  const thisMonth = heute.getMonth()

  // ── Monats-Umsatz (12 Monate rückwärts) ─────────────────────────────────
  const umsatzMonate: { monat: string; umsatz: number; anzahl: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisYear, thisMonth - i, 1)
    const von = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
    const bis = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
    const { data } = await (supabase.from('verkaufsposten') as any)
      .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('storniert', false)
      .gte('datum', von).lte('datum', bis)
    const posten = (data ?? []) as R[]
    const summe = posten.reduce((s: number, p: R) =>
      s + ((p.verkauf_positionen ?? []) as R[]).reduce((ps: number, pos: R) => {
        const b = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0)
        return ps + b * (1 - (Number(pos.rabatt_pct) || 0) / 100) * (1 - (Number(pos.sonderrabatt_pct) || 0) / 100)
      }, 0), 0)
    umsatzMonate.push({
      monat: d.toLocaleDateString('de-AT', { month: 'short', year: '2-digit' }),
      umsatz: summe, anzahl: posten.length,
    })
  }

  // ── Lagerbestand ─────────────────────────────────────────────────────────
  const { data: lagerRaw } = await (supabase.from('fuellungen') as any)
    .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, aktiv')
    .eq('aktiv', true).order('bestand_flaschen', { ascending: false })
  const lager = (lagerRaw ?? []) as R[]
  const lagerWert = lager.reduce((s: number, f: R) =>
    s + (Number(f.bestand_flaschen) || 0) * (Number(f.vk_preis_brutto) || 0), 0)

  // ── Behandlungsübersicht (aktuelles Jahr) ─────────────────────────────────
  const { data: behandlungenRaw } = await (supabase.from('behandlungen') as any)
    .select('id, datum, mittel_id, menge_gesamt, einheit, art, psm:pflanzenschutzmittel(name, handelsname, cu_gehalt_pct), weingarten:weingartenId(name)')
    .gte('datum', `${thisYear}-01-01`).order('datum', { ascending: false })
  const behandlungen = (behandlungenRaw ?? []) as R[]

  // Cu-Bilanz
  const cuKgHa = behandlungen.reduce((s: number, b: R) => {
    const cu = Number((b.psm as R | null)?.cu_gehalt_pct) || 0
    if (cu === 0) return s
    const menge = Number(b.menge_gesamt) || 0
    return s + (menge * cu / 100)
  }, 0)

  // ── Lead-Pipeline ─────────────────────────────────────────────────────────
  const { data: pipelineRaw } = await (supabase.from('pipeline_eintraege') as any)
    .select('id, stufe, kategorie, erledigt, kontakt:kontakte(vorname, nachname, segment), firma:firmen(name, segment)')
    .order('erstellt_am', { ascending: false })
  const pipeline = (pipelineRaw ?? []) as R[]

  // ── Kontaktfrequenz ───────────────────────────────────────────────────────
  const { data: kontakteRaw } = await (supabase.from('kontakte') as any)
    .select('id, vorname, nachname, kundennummer, aktiv')
    .eq('aktiv', true).eq('is_lead', false).order('nachname').limit(50)
  const kontakte = (kontakteRaw ?? []) as R[]

  const kontaktFrequenz: { id: string; name: string; kundennummer: string | null; letzterKontakt: string | null; tage: number }[] = []
  if (kontakte.length > 0) {
    const { data: letzteAktsRaw } = await (supabase.from('aktivitaeten') as any)
      .select('kontakt_id, datum')
      .in('kontakt_id', kontakte.map(k => k.id))
      .eq('erledigt', true)
      .order('datum', { ascending: false })
    const letzteAkts = (letzteAktsRaw ?? []) as R[]
    const letztMap: Record<string, string> = {}
    letzteAkts.forEach((a: R) => { if (!letztMap[a.kontakt_id]) letztMap[a.kontakt_id] = a.datum })
    const heuteMs = heute.getTime()
    kontakte.forEach(k => {
      const letzt = letztMap[k.id] ?? null
      const tage = letzt ? Math.floor((heuteMs - new Date(letzt).getTime()) / 86400000) : 999
      kontaktFrequenz.push({ id: k.id, name: [k.vorname, k.nachname].filter(Boolean).join(' '), kundennummer: k.kundennummer, letzterKontakt: letzt, tage })
    })
    kontaktFrequenz.sort((a, b) => b.tage - a.tage)
  }

  // ── Offene Posten ─────────────────────────────────────────────────────────
  const { data: offeneRaw } = await (supabase.from('verkaufsposten') as any)
    .select('id, datum, rechnungsnummer, kontakt:kontakte(vorname, nachname), firma:firmen(name), verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('aktiv', true).eq('bezahlt', false).eq('storniert', false)
    .order('datum', { ascending: true })
  const offene = (offeneRaw ?? []) as R[]

  return (
    <ReportsClient
      umsatzMonate={umsatzMonate}
      lager={lager}
      lagerWert={lagerWert}
      behandlungen={behandlungen}
      cuKgHa={cuKgHa}
      pipeline={pipeline}
      kontaktFrequenz={kontaktFrequenz}
      offene={offene}
      heute={heute.toISOString().split('T')[0]}
    />
  )
}
