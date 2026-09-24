import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import ReportsClient from '../ReportsClient'
import { behoerdenUebersicht } from '@/lib/behoerden/uebersicht'

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

  // Performance (17.9.2026, Rückmeldung "Controlling dauert 4 s"): vorher zwölf
  // Monatsabfragen nacheinander, dann acht weitere Abfragen nacheinander und
  // zuletzt ALLE Kontakte/Firmen (13.000 Zeilen) nur für die Filterliste der
  // Verkaufsstatistik. Jetzt: eine Umsatzabfrage über zwölf Monate, alles
  // parallel, Orte/Länder per RPC crm_filterwerte (Migration 210), Kunde als
  // serverseitige Suche im Client (PartnerSuche).
  const monatStart = new Date(thisYear, thisMonth - 11, 1)
  const von12 = monatStart.toISOString().split('T')[0]
  const bis12 = new Date(thisYear, thisMonth + 1, 0).toISOString().split('T')[0]

  // Tab „Behörden“: Katalog der Behördenmeldungen, nach Rolle/Modulen gefiltert (parallel zu den Abfragen)
  // wirft nicht: bei einem Datenbankfehler null (protokolliert) – der Tab „Behörden“ zeigt dann einen Hinweis
  const behoerdenP = behoerdenUebersicht()

  const [
    { data: umsatzRaw },
    { data: lagerRaw },
    { data: behandlungenRaw },
    { data: flaecheRaw },
    { data: pipelineRaw },
    { data: kontakteRaw },
    { data: offeneRaw },
    { data: vsFuellungenRaw },
    { data: filterwerteRaw },
    { data: wbChargenRaw },
  ] = await Promise.all([
    alle(tf((supabase.from('verkaufsposten') as any)
      .select('id, datum, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('storniert', false)
      .gte('datum', von12).lte('datum', bis12).order('datum').order('id'))),
    tf((supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, rebsorte, flaschengroesse_ml, bestand_flaschen, vk_preis_brutto, einstandspreis, aktiv')
      .eq('aktiv', true).order('bestand_flaschen', { ascending: false })),
    tf((supabase.from('behandlungen') as any)
      .select('id, datum, menge_gesamt, menge_einheit, art, psm:psm_id(name, cu_gehalt_pct)')
      .gte('datum', `${thisYear}-01-01`).order('datum', { ascending: false })),
    tf((supabase.from('weingarten') as any).select('flaeche_ha').eq('aktiv', true)),
    tf((supabase.from('pipeline_eintraege') as any)
      .select('id, stufe, kategorie, erledigt, kontakt:kontakte!kontakt_id(vorname, nachname, segment), firma:firmen(name, segment)')
      .order('erstellt_am', { ascending: false })),
    tf((supabase.from('kontakte') as any)
      .select('id, vorname, nachname, accountnummer, aktiv')
      .eq('aktiv', true).eq('is_lead', false).order('nachname').limit(50)),
    tf((supabase.from('verkaufsposten') as any)
      .select('id, datum, rechnungsnummer, kontakt:kontakte!kontakt_id(vorname, nachname), firma:firmen(name), verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
      .eq('aktiv', true).eq('bezahlt', false).eq('storniert', false)
      .order('datum', { ascending: true })),
    // Bewusst NICHT auf aktiv=true eingeschränkt, damit auch historische
    // (inzwischen inaktive/ausverkaufte) Füllungen filterbar bleiben.
    tf((supabase.from('fuellungen') as any).select('jahrgang, rebsorte, bezeichnung')),
    tenantId ? (supabase as any).rpc('crm_filterwerte', { p_tenant_id: tenantId }) : Promise.resolve({ data: [] }),
    // Weinbuch-Sammlung: über ALLE Weinausbau-Chargen (aktiv + abgeschlossen),
    // da die Sammlung gerade für Prüfungen (BKI) auch historische Chargen
    // auffindbar machen soll.
    tf((supabase.from('weinausbau') as any).select('jahrgang, rebsorte, name')),
  ])

  // ── Monats-Umsatz (12 Monate rückwärts) ─────────────────────────────────
  const brutto = (p: R) => ((p.verkauf_positionen ?? []) as R[]).reduce((ps: number, pos: R) => {
    const b = (Number(pos.preis_brutto) || 0) * (Number(pos.menge) || 0)
    return ps + b * (1 - (Number(pos.rabatt_pct) || 0) / 100) * (1 - (Number(pos.sonderrabatt_pct) || 0) / 100)
  }, 0)
  const umsatzProMonat: Record<string, { umsatz: number; anzahl: number }> = {}
  for (const p of (umsatzRaw ?? []) as R[]) {
    const k = String(p.datum ?? '').slice(0, 7)
    if (!umsatzProMonat[k]) umsatzProMonat[k] = { umsatz: 0, anzahl: 0 }
    umsatzProMonat[k].umsatz += brutto(p)
    umsatzProMonat[k].anzahl += 1
  }
  const umsatzMonate: { monat: string; umsatz: number; anzahl: number; von: string; bis: string }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(thisYear, thisMonth - i, 1)
    const von = new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0]
    const bis = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0]
    const m = umsatzProMonat[von.slice(0, 7)] ?? { umsatz: 0, anzahl: 0 }
    umsatzMonate.push({
      monat: d.toLocaleDateString('de-AT', { month: 'short', year: '2-digit' }),
      umsatz: m.umsatz, anzahl: m.anzahl, von, bis,
    })
  }

  // ── Lagerbestand ─────────────────────────────────────────────────────────
  const lager = (lagerRaw ?? []) as R[]
  // Lagerwert nach Einstandspreis (konsistent mit /weinhandel)
  const lagerWert = lager.reduce((s: number, f: R) =>
    s + (Number(f.bestand_flaschen) || 0) * (Number(f.einstandspreis) || 0), 0)

  // ── Behandlungsübersicht (aktuelles Jahr) ─────────────────────────────────
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
  const gesamtHaFuerCu = ((flaecheRaw ?? []) as R[]).reduce((s: number, w: R) => s + (Number(w.flaeche_ha) || 0), 0)
  const cuKgHa = gesamtHaFuerCu > 0 ? totalCuKg / gesamtHaFuerCu : 0

  // ── Lead-Pipeline ─────────────────────────────────────────────────────────
  const pipeline = (pipelineRaw ?? []) as R[]

  // ── Kontaktfrequenz ───────────────────────────────────────────────────────
  const kontakte = (kontakteRaw ?? []) as R[]

  const kontaktFrequenz: { id: string; name: string; accountnummer: string | null; letzterKontakt: string | null; tage: number }[] = []
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
      kontaktFrequenz.push({ id: k.id, name: [k.vorname, k.nachname].filter(Boolean).join(' '), accountnummer: k.accountnummer, letzterKontakt: letzt, tage })
    })
    kontaktFrequenz.sort((a, b) => b.tage - a.tage)
  }

  // ── Offene Posten ─────────────────────────────────────────────────────────
  const offene = (offeneRaw ?? []) as R[]

  // ── Verkaufsstatistik: Filteroptionen ───────────────────────────────────
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
  const filterwerte = (filterwerteRaw ?? []) as { art: string; wert: string }[]
  const vsOrte    = filterwerte.filter(w => w.art === 'ort').map(w => w.wert)
  const vsLaender = filterwerte.filter(w => w.art === 'land').map(w => w.wert)

  // ── Weinbuch-Sammlung: Filteroptionen ────────────────────────────────────
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
      vsOrte={vsOrte}
      vsLaender={vsLaender}
      wbJahrgaenge={wbJahrgaenge}
      wbSorten={wbSorten}
      wbBezeichnungen={wbBezeichnungen}
      behoerden={await behoerdenP}
    />
  )
}
