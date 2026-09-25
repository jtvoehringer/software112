import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// ── Österreichische PLZ-Bundesland-Zuordnung (Österreichische Post, Mai 2026) ──
// Quellen: post.at Postlexikon + statistik.at Gemeindeverzeichnis
const BUNDESLAND_PLZ: Record<string, [string, string][]> = {
  // Wien: 1010–1239
  wien: [['1010','1239']],
  w:    [['1010','1239']],

  // Niederösterreich: 2000–3999 (Ausnahmen: einige 2xxx = Burgenland)
  niederoesterreich: [['2000','3999']],
  noe:               [['2000','3999']],
  'niederösterreich':[['2000','3999']],

  // Burgenland: 7000–7999 + grenznahe NÖ-Ausnahmen (2460, 2491 etc.)
  burgenland: [['7000','7999']],
  bgld:       [['7000','7999']],
  b:          [['7000','7999']],

  // Oberösterreich: 4000–4999
  oberoesterreich:    [['4000','4999']],
  ooe:                [['4000','4999']],
  'oberösterreich':   [['4000','4999']],

  // Salzburg: 5000–5771
  salzburg: [['5000','5771']],
  s:        [['5000','5771']],
  sbg:      [['5000','5771']],

  // Steiermark: 8000–8993
  steiermark:  [['8000','8993']],
  stmk:        [['8000','8993']],
  st:          [['8000','8993']],

  // Kärnten: 9000–9872 (ohne Osttirol 9900–9992)
  kaernten:   [['9000','9872']],
  ktn:        [['9000','9872']],
  k:          [['9000','9872']],
  'kärnten':  [['9000','9872']],

  // Tirol: 6000–6699 + Osttirol 9900–9992
  tirol: [['6000','6699'],['9900','9992']],
  t:     [['6000','6699'],['9900','9992']],
  trl:   [['6000','6699'],['9900','9992']],

  // Vorarlberg: 6700–6993
  vorarlberg: [['6700','6993']],
  v:          [['6700','6993']],
  vbg:        [['6700','6993']],
}

function findBundesland(filter: string): [string, string][] | null {
  const key = filter.trim().toLowerCase()
    .replace(/ü/g,'ue').replace(/ö/g,'oe').replace(/ä/g,'ae')
    .replace(/\s+/g,'')
  // direkter Treffer
  if (BUNDESLAND_PLZ[key]) return BUNDESLAND_PLZ[key]
  // Originalbuchstaben (mit Umlaut)
  const orig = filter.trim().toLowerCase().replace(/\s+/g,'')
  if (BUNDESLAND_PLZ[orig]) return BUNDESLAND_PLZ[orig]
  return null
}

// schreibsperre-ausnahme: nur lesend – Besuchsliste aus Kontakten, POST nur wegen des Filter-Körpers
export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Kein Betrieb' }, { status: 401 })

    const { ort_filter, segment, include_leads, include_kunden } = await req.json()
    const supabase = await createSupabaseServerClient()

    // Kontakte laden
    let kq = (supabase.from('kontakte') as any)
      .select('id, accountnummer, vorname, nachname, segment, email, telefon, telefon_vorwahl, mobil, mobil_vorwahl, plz, ort, strasse, land, is_lead, firma:firma_id(name)')
      .eq('tenant_id', tenantId)
      .eq('aktiv', true)

    const bundeslandRanges = ort_filter?.trim() ? findBundesland(ort_filter) : null
    if (bundeslandRanges) {
      // PLZ-Bereichsfilter für Bundesland
      const orParts = bundeslandRanges.map(([min, max]) => `and(plz.gte.${min},plz.lte.${max})`).join(',')
      kq = kq.or(orParts)
    } else if (ort_filter?.trim()) {
      kq = kq.ilike('ort', `%${ort_filter.trim()}%`)
    }
    if (segment) kq = kq.eq('segment', segment)

    // Lead/Kunde-Filter
    if (include_leads && !include_kunden) kq = kq.eq('is_lead', true)
    else if (!include_leads && include_kunden) kq = kq.eq('is_lead', false)
    // beide = kein Filter

    kq = kq.order('plz').order('nachname').order('id')
    const { data: kontakteRaw } = await alle(kq)
    const kontakte = (kontakteRaw ?? []) as R[]

    // Letzten Kontakt je Person laden
    const ids = kontakte.map(k => k.id)
    let letzteMap: Record<string, string> = {}
    if (ids.length > 0) {
      // Kein .in(ids) mehr: bei mehreren tausend Kontakten würde die URL zu
      // lang. Stattdessen alle erledigten Aktivitäten des Mandanten seitenweise
      // laden und im Speicher auf die geladenen Kontakte einschränken.
      const idSet = new Set(ids)
      const { data: aktsAlle } = await alle((supabase.from('aktivitaeten') as any)
        .select('kontakt_id, datum')
        .eq('tenant_id', tenantId)
        .eq('erledigt', true)
        .not('kontakt_id', 'is', null)
        .order('datum', { ascending: false }).order('id'))
      const akts = (aktsAlle as R[]).filter(a => idSet.has(a.kontakt_id))
      const seen = new Set<string>()
      ;(akts ?? []).forEach((a: R) => {
        if (!seen.has(a.kontakt_id)) {
          letzteMap[a.kontakt_id] = a.datum
          seen.add(a.kontakt_id)
        }
      })
    }

    // Telefon mit Vorwahl
    const enriched = kontakte.map(k => ({
      ...k,
      telefon: k.telefon ? `${k.telefon_vorwahl ?? '+43'} ${k.telefon}` : null,
      mobil:   k.mobil   ? `${k.mobil_vorwahl   ?? '+43'} ${k.mobil}`   : null,
      telefon_vorwahl: undefined,
      mobil_vorwahl:   undefined,
      firma_name: (k.firma as R | null)?.name ?? null,
      firma: undefined,
      letzter_kontakt: letzteMap[k.id] ?? null,
      tage_seit_kontakt: letzteMap[k.id]
        ? Math.abs(Math.floor((Date.now() - new Date(letzteMap[k.id]).getTime()) / 86400000))
        : null,
    }))  as R[]

    // Nach PLZ gruppieren
    const cluster: Record<string, R[]> = {}
    enriched.forEach(k => {
      const key = k.plz ?? 'ohne PLZ'
      if (!cluster[key]) cluster[key] = []
      cluster[key].push(k)
    })

    return NextResponse.json({
      kontakte: enriched,
      cluster,
      anzahl: enriched.length,
      plz_count: Object.keys(cluster).length,
    })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
