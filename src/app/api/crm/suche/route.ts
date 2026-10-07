import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { NextRequest, NextResponse } from 'next/server'
import type { PartnerTreffer } from '@/components/crm/PartnerSuche'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { suchWoerter } from '@/lib/crm/liste'
import { fremderBetrieb, ladeCrmGemeinschaft, sichtbareBetriebe, type CrmGemeinschaft } from '@/lib/crm/gemeinschaft'

// Serverseitige Namenssuche für Auswahlfelder (17.9.2026):
//   /api/crm/suche?art=kontakt|firma|kunde|lieferant&q=<text>
//     kontakt / firma  → nur die eine Tabelle, id = Datensatz-ID
//     kunde            → Kontakte + Firmen mit ist_kunde, id = "kontakt:<id>" / "firma:<id>"
//     lieferant        → Kontakte + Firmen mit ist_lieferant, id wie bei kunde
//   &firma_id=<id>     → (art=kontakt) nur Ansprechpersonen dieser Firma; gibt es
//                        keine, alle Kontakte (Antwort alle:true → Hinweis im Formular)
//     email            → E-Mail-Adressen (Standard + weitere) von Kontakten und Firmen
//                        für die Empfänger-Vervollständigung im Mailfenster (18.9.2026)
//   &ids=a,b           → Datensätze zu bekannten IDs (Vorbelegung), Format wie oben
// Liefert höchstens 30 Treffer { id, label, sub, daten } - daten enthält die
// Verkaufskonditionen (Rabattgruppe, Sonderrabatt, Skonto, firma_id), damit das
// Verkaufsformular nach der Auswahl nichts nachladen muss. Ersetzt das Laden
// aller Kontakte/Firmen (Gebeshuber: 8.300 + 4.600) in den Browser.
// KAN-212: Kontakte/Firmen eines Betriebs der CRM-Gemeinschaft kommen mit (Hinweis „aus <Betrieb>“), ohne
// Konditionen des Eigentümers (Rabattgruppe, Sonderrabatt, Skonto werden im eigenen Beleg nicht vorbelegt).

export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

type SucheTreffer = PartnerTreffer

function ilikeSicher(q: string) {
  return q.replace(/[%_,()]/g, ' ').trim()
}

function konditionen(typ: 'kontakt' | 'firma', r: R, fremd: boolean) {
  // Rückmeldung Jörgen 07.10.2026: Betriebsnummer mitliefern – der Zukauf prüft sie schon bei der Auswahl des Lieferanten
  const betrieb_nr = (r.betrieb_nr as string | null) ?? null
  if (fremd) return { typ, firma_id: (r.firma_id as string | null) ?? null, rabatt_pct: null, sonderrabatt_pct: 0, skonto_pct: 0, skonto_tage: 10, betrieb_nr }
  return {
    typ,
    betrieb_nr,
    firma_id:         (r.firma_id as string | null) ?? null,
    rabatt_pct:       (r.rabattgruppe as R | null)?.rabatt_pct != null ? Number((r.rabattgruppe as R).rabatt_pct) : null,
    sonderrabatt_pct: parseFloat(r.sonderrabatt_pct) || 0,
    skonto_pct:       parseFloat(r.skonto_pct) || 0,
    skonto_tage:      parseInt(r.skonto_tage) || 10,
  }
}

const K_SPALTEN = 'id, tenant_id, vorname, nachname, ort, accountnummer, betrieb_nr, firma_id, sonderrabatt_pct, skonto_pct, skonto_tage, rabattgruppe:rabattgruppe_id(rabatt_pct)'
const F_SPALTEN = 'id, tenant_id, name, ort, accountnummer, betrieb_nr, ist_kunde, ist_lieferant, sonderrabatt_pct, skonto_pct, skonto_tage, rabattgruppe:rabattgruppe_id(rabatt_pct)'

// Betriebsnummer (BKI-Empfänger beim Traubenverkauf) – stand bis 05.10.2026 in der Auswahlliste der Abnehmer
const betrNr = (r: R) => (r.betrieb_nr ? `Betr.Nr. ${r.betrieb_nr}` : null)

type Herkunft = { tenantId: string; g: CrmGemeinschaft }

function kontaktTreffer(k: R, h: Herkunft, praefix = ''): SucheTreffer {
  const aus = fremderBetrieb(k.tenant_id, h.tenantId, h.g)
  return {
    id: praefix + k.id,
    label: [k.vorname, k.nachname].filter(Boolean).join(' '),
    sub: [praefix ? 'Person' : null, aus ? `aus ${aus}` : null, k.accountnummer, k.ort, betrNr(k)].filter(Boolean).join(' · ') || undefined,
    daten: konditionen('kontakt', k, !!aus),
  }
}
function firmaTreffer(f: R, h: Herkunft, praefix = ''): SucheTreffer {
  const aus = fremderBetrieb(f.tenant_id, h.tenantId, h.g)
  return {
    id: praefix + f.id,
    label: f.name,
    sub: [praefix ? 'Firma' : null, aus ? `aus ${aus}` : null, f.accountnummer, f.ort, betrNr(f)].filter(Boolean).join(' · ') || undefined,
    daten: konditionen('firma', f, !!aus),
  }
}

export async function GET(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const sp = req.nextUrl.searchParams
  const artParam = sp.get('art')
  const art: 'kontakt' | 'firma' | 'kunde' | 'lieferant' | 'email' =
    artParam === 'firma' || artParam === 'kunde' || artParam === 'lieferant' || artParam === 'email' ? artParam : 'kontakt'
  const q = ilikeSicher(sp.get('q') ?? '')
  const idsRoh = (sp.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50)
  const firmaId = sp.get('firma_id') || null
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ treffer: [] })
  const supabase = await createSupabaseServerClient()

  if (art === 'email') {
    // Empfänger-Vervollständigung: Name ODER Adresse enthält den Suchtext;
    // je Adresse (Standard + weitere) ein Eintrag { id: email, label: Name, sub: email }
    if (q.length < 2) return NextResponse.json({ treffer: [] })
    const [{ data: kRaw }, { data: fRaw }] = await Promise.all([
      (supabase.from('kontakte') as any).select('id, vorname, nachname, email, email_weitere').eq('tenant_id', tenantId).eq('aktiv', true)
        .or(`nachname.ilike.%${q}%,vorname.ilike.%${q}%,email.ilike.%${q}%`).limit(20),
      (supabase.from('firmen') as any).select('id, name, email, email_weitere').eq('tenant_id', tenantId).eq('aktiv', true)
        .or(`name.ilike.%${q}%,email.ilike.%${q}%`).limit(20),
    ])
    const out: SucheTreffer[] = []
    const gesehen = new Set<string>()
    const push = (label: string, email: string | null, weitere: boolean) => {
      const e = (email ?? '').trim().toLowerCase()
      if (!e || !e.includes('@') || gesehen.has(e)) return
      gesehen.add(e)
      out.push({ id: e, label, sub: weitere ? `${e} · weitere` : e })
    }
    for (const k of (kRaw ?? []) as R[]) {
      const name = [k.vorname, k.nachname].filter(Boolean).join(' ')
      push(name, k.email, false)
      for (const w of ((k.email_weitere ?? []) as string[])) push(name, w, true)
    }
    for (const f of (fRaw ?? []) as R[]) {
      push(f.name, f.email, false)
      for (const w of ((f.email_weitere ?? []) as string[])) push(f.name, w, true)
    }
    out.sort((a, b) => a.label.localeCompare(b.label, 'de'))
    return NextResponse.json({ treffer: out.slice(0, 15) })
  }

  const g = await ladeCrmGemeinschaft(supabase, tenantId)
  const h: Herkunft = { tenantId, g }
  const betriebe = sichtbareBetriebe(tenantId, g)
  const kontakteAbfrage = (ids: string[], nurFirma: string | null) => {
    // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – eigener Betrieb und freigebende Partner (RLS kontakte_crm_partner)
    let query = (supabase.from('kontakte') as any).select(K_SPALTEN).in('tenant_id', betriebe) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (ids.length) query = query.in('id', ids)   // Vorbelegung: auch inaktive (gespeicherter Partner zeigt sonst nur „…“)
    else {
      query = query.eq('aktiv', true)
      if (nurFirma) query = query.eq('firma_id', nurFirma)
      // Mehrere Wörter: jedes Wort muss in Vor-/Nachname/Ort/Accountnummer/E-Mail vorkommen
      for (const w of suchWoerter(q)) {
        query = query.or(`nachname.ilike.%${w}%,vorname.ilike.%${w}%,accountnummer.ilike.%${w}%,ort.ilike.%${w}%,email.ilike.%${w}%`)
      }
    }
    return query.order('nachname').order('vorname').limit(30)
  }
  const firmenAbfrage = (ids: string[], rolle: 'kunde' | 'lieferant' | null) => {
    // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – eigener Betrieb und freigebende Partner (RLS firmen_crm_partner)
    let query = (supabase.from('firmen') as any).select(F_SPALTEN).in('tenant_id', betriebe) // eslint-disable-line @typescript-eslint/no-explicit-any
    if (ids.length) query = query.in('id', ids)   // Vorbelegung: auch inaktive, siehe kontakteAbfrage
    else {
      query = query.eq('aktiv', true)
      // ist_kunde: Altdaten vor Migration 167 können null sein → zählt als Kunde
      if (rolle === 'kunde') query = query.or('ist_kunde.is.null,ist_kunde.eq.true')
      if (rolle === 'lieferant') query = query.eq('ist_lieferant', true)
      for (const w of suchWoerter(q)) query = query.or(`name.ilike.%${w}%,accountnummer.ilike.%${w}%,ort.ilike.%${w}%`)
    }
    return query.order('name').limit(30)
  }

  if (art === 'firma') {
    const { data } = await firmenAbfrage(idsRoh, null)
    return NextResponse.json({ treffer: ((data ?? []) as R[]).map(f => firmaTreffer(f, h)) })
  }

  if (art === 'kontakt') {
    let alle = false
    let { data } = await kontakteAbfrage(idsRoh, firmaId)
    if (firmaId && !idsRoh.length && !(data ?? []).length) {
      // Firma ohne zugeordnete Ansprechpersonen → alle Kontakte anbieten
      const r = await kontakteAbfrage([], null)
      data = r.data; alle = true
    }
    return NextResponse.json({ treffer: ((data ?? []) as R[]).map(k => kontaktTreffer(k, h)), alle })
  }

  // kunde / lieferant: beide Tabellen, IDs mit Präfix
  const kIds = idsRoh.filter(i => i.startsWith('kontakt:')).map(i => i.slice(8))
  const fIds = idsRoh.filter(i => i.startsWith('firma:')).map(i => i.slice(6))
  const nurIds = idsRoh.length > 0
  const [{ data: kRaw }, { data: fRaw }] = await Promise.all([
    nurIds && !kIds.length ? Promise.resolve({ data: [] }) : kontakteAbfrage(kIds, null),
    nurIds && !fIds.length ? Promise.resolve({ data: [] }) : firmenAbfrage(fIds, art),
  ])
  const treffer: SucheTreffer[] = [
    ...((kRaw ?? []) as R[]).map(k => kontaktTreffer(k, h, 'kontakt:')),
    ...((fRaw ?? []) as R[]).map(f => firmaTreffer(f, h, 'firma:')),
  ]
  // Gemischt alphabetisch, damit „Huber“ (Person) und „Huber GmbH“ nebeneinander stehen
  treffer.sort((a, b) => a.label.localeCompare(b.label, 'de'))
  return NextResponse.json({ treffer: treffer.slice(0, 30) })
}
