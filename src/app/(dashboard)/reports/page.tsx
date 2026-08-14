import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from 'next/link'
import ReportsClient from './ReportsClient'

export const metadata: Metadata = { title: 'Reports – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function ReportsPage() {
  const supabase = await createSupabaseServerClient()
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  const heute = new Date()
  const thisYear  = heute.getFullYear()
  const thisMonth = heute.getMonth()

  // ── Monats-Umsatz (12 Monate rückwärts) ─────────────────────────────────
  const umsatzMonate: { monat: string; umsatz: number; anzahl: number; von: string; bis: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisYear, thisMonth - i, 1)
    const von = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
    const bis = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
    const { data } = await tf((supabase.from('verkaufsposten') as any)
      .select('id, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('storniert', false)
      .gte('datum', von).lte('datum', bis))
    const posten = (data ?? []) as R[]
    const summe = posten.reduce((s: number, p: R) =>
      s + ((p.verkauf_positionen ?? []) as R[]).reduce((ps: number, pos: R) => {
        const b = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0)
        return ps + b * (1 - (Number(pos.rabatt_pct) || 0) / 100) * (1 - (Number(pos.sonderrabatt_pct) || 0) / 100)
      }, 0), 0)
    umsatzMonate.push({
      monat: d.toLocaleDateString('de-AT', { month: 'short', year: '2-digit' }),
      umsatz: summe, anzahl: posten.length, von, bis,
    })
  }

  // ── Lagerbestand ─────────────────────────────────────────────────────────
  const { data: lagerRaw } = await tf((supabase.from('fuellungen') as any)
    .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, einstandspreis, aktiv')
    .eq('aktiv', true).order('bestand_flaschen', { ascending: false }))
  const lager = (lagerRaw ?? []) as R[]
  // Lagerwert nach Einstandspreis (konsistent mit /weinhandel)
  const lagerWert = lager.reduce((s: number, f: R) =>
    s + (Number(f.bestand_flaschen) || 0) * (Number(f.einstandspreis) || 0), 0)

  // ── Behandlungsübersicht (aktuelles Jahr) ─────────────────────────────────
  const { data: behandlungenRaw } = await tf((supabase.from('behandlungen') as any)
    .select('id, datum, menge_gesamt, menge_einheit, art, psm:psm_id(name, cu_gehalt_pct)')
    .gte('datum', `${thisYear}-01-01`).order('datum', { ascending: false }))
  const behandlungen = (behandlungenRaw ?? []) as R[]

  // Cu-Bilanz: kg Kupfer gesamt DURCH die bewirtschaftete Fläche teilen, sonst wird eine
  // absolute Gesamtmenge gegen den EU-Grenzwert (4 kg/ha/Jahr) verglichen (wie in
  // reports/cu-bilanz/page.tsx bereits korrekt gemacht).
  const totalCuKg = behandlungen.reduce((s: number, b: R) => {
    const cu = Number((b.psm as R | null)?.cu_gehalt_pct) || 0
    if (cu === 0) return s
    const menge = Number(b.menge_gesamt) || 0
    return s + (menge * cu / 100)
  }, 0)
  const { data: flaecheRaw } = await tf((supabase.from('weingarten') as any).select('flaeche_ha').eq('aktiv', true))
  const gesamtHaFuerCu = ((flaecheRaw ?? []) as R[]).reduce((s: number, w: R) => s + (Number(w.flaeche_ha) || 0), 0)
  const cuKgHa = gesamtHaFuerCu > 0 ? totalCuKg / gesamtHaFuerCu : 0

  // ── Lead-Pipeline ─────────────────────────────────────────────────────────
  const { data: pipelineRaw } = await tf((supabase.from('pipeline_eintraege') as any)
    .select('id, stufe, kategorie, erledigt, kontakt:kontakte!kontakt_id(vorname, nachname, segment), firma:firmen(name, segment)')
    .order('erstellt_am', { ascending: false }))
  const pipeline = (pipelineRaw ?? []) as R[]

  // ── Kontaktfrequenz ───────────────────────────────────────────────────────
  const { data: kontakteRaw } = await tf((supabase.from('kontakte') as any)
    .select('id, vorname, nachname, kundennummer, aktiv')
    .eq('aktiv', true).eq('is_lead', false).order('nachname').limit(50))
  const kontakte = (kontakteRaw ?? []) as R[]

  const kontaktFrequenz: { id: string; name: string; kundennummer: string | null; letzterKontakt: string | null; tage: number }[] = []
  if (kontakte.length > 0) {
    const { data: letzteAktsRaw } = await tf((supabase.from('aktivitaeten') as any)
      .select('kontakt_id, datum')
      .in('kontakt_id', kontakte.map(k => k.id))
      .eq('erledigt', true)
      .order('datum', { ascending: false }))
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
  const { data: offeneRaw } = await tf((supabase.from('verkaufsposten') as any)
    .select('id, datum, rechnungsnummer, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('aktiv', true).eq('bezahlt', false).eq('storniert', false)
    .order('datum', { ascending: true }))
  const offene = (offeneRaw ?? []) as R[]

  // ── Verkaufsstatistik: Filteroptionen ───────────────────────────────────
  // Bewusst NICHT auf aktiv=true eingeschränkt, damit auch historische
  // (inzwischen inaktive/ausverkaufte) Füllungen filterbar bleiben.
  const { data: vsFuellungenRaw } = await tf((supabase.from('fuellungen') as any)
    .select('jahrgang, rebsorte, bezeichnung'))
  const vsFuellungen = (vsFuellungenRaw ?? []) as R[]
  const vsJahrgaenge = Array.from(
    new Set(vsFuellungen.map(f => f.jahrgang).filter((j): j is number => j != null))
  ).sort((a, b) => b - a)
  const vsSorten = Array.from(
    new Set(vsFuellungen.map(f => f.rebsorte).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))
  const vsBezeichnungen = Array.from(
    new Set(vsFuellungen.map(f => f.bezeichnung).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))

  const [{ data: vsKontakteRaw }, { data: vsFirmenRaw }] = await Promise.all([
    tf((supabase.from('kontakte') as any).select('id, vorname, nachname, ort, land').order('nachname')),
    tf((supabase.from('firmen') as any).select('id, name, ort, land').order('name')),
  ])
  const vsKontakte = (vsKontakteRaw ?? []) as R[]
  const vsFirmen   = (vsFirmenRaw ?? []) as R[]
  const vsKunden = [
    ...vsKontakte.map(k => ({ id: `kontakt:${k.id}`, name: [k.vorname, k.nachname].filter(Boolean).join(' ') })),
    ...vsFirmen.map(f => ({ id: `firma:${f.id}`, name: f.name as string })),
  ].sort((a, b) => a.name.localeCompare(b.name, 'de-AT'))
  const vsOrte = Array.from(
    new Set([...vsKontakte.map(k => k.ort), ...vsFirmen.map(f => f.ort)].filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))
  const vsLaender = Array.from(
    new Set([...vsKontakte.map(k => k.land), ...vsFirmen.map(f => f.land)].filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))

  // ── Weinbuch-Sammlung: Filteroptionen ────────────────────────────────────
  // Bewusst über ALLE Weinausbau-Chargen (aktiv + abgeschlossen), da die
  // Sammlung gerade für Prüfungen (BKI) auch historische/abgeschlossene
  // Chargen auffindbar machen soll.
  const { data: wbChargenRaw } = await tf((supabase.from('weinausbau') as any)
    .select('jahrgang, rebsorte, name'))
  const wbChargen = (wbChargenRaw ?? []) as R[]
  const wbJahrgaenge = Array.from(
    new Set(wbChargen.map(c => c.jahrgang).filter((j): j is number => j != null))
  ).sort((a, b) => b - a)
  const wbSorten = Array.from(
    new Set(wbChargen.map(c => c.rebsorte).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))
  const wbBezeichnungen = Array.from(
    new Set(wbChargen.map(c => c.name).filter((s): s is string => !!s))
  ).sort((a, b) => a.localeCompare(b, 'de-AT'))

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
      vsJahrgaenge={vsJahrgaenge}
      vsSorten={vsSorten}
      vsBezeichnungen={vsBezeichnungen}
      vsKunden={vsKunden}
      vsOrte={vsOrte}
      vsLaender={vsLaender}
      wbJahrgaenge={wbJahrgaenge}
      wbSorten={wbSorten}
      wbBezeichnungen={wbBezeichnungen}
    />
  )
}
