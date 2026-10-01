import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, canAdmin, getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { ladeBehandlungen, type PsmBehandlung } from '@/lib/behoerden/psm'
import { lagerKonto, verbrauchJeMittel, type LagerKonto } from '@/lib/behandlungen/lagerVerbrauch'
import LagerClient from './LagerClient'
import DuengerLagerClient from './DuengerLagerClient'
import PSMClient from './PSMClient'
import DuengemittelClient from './DuengemittelClient'
import SaetzeClient from './SaetzeClient'
import BetriebsmittelStammClient, { type BmStamm } from './BetriebsmittelStammClient'
import BetriebsmittelLagerClient, { type BmBewegung, type BmKarte, type BmOption } from './BetriebsmittelLagerClient'
import { BETRIEBSMITTEL_GRUPPEN, GRUPPE_LABEL, bmKonto, type BetriebsmittelGruppe, type BmVerbrauchPosten } from '@/lib/behandlungen/betriebsmittel'
import { MASSNAHMEN_ART_LABEL } from '@/lib/behandlungen/arten'
import { summeFlaecheHa } from '@/lib/behandlungen/massnahmeMengen'

export const metadata: Metadata = { title: 'Betriebsmittel – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

export type PSMLager = {
  psm_id: string
  psm_name: string
  kategorie: string | null
  bewegungen: {
    id: string
    datum: string
    typ: 'anfangsbestand' | 'einkauf' | 'korrektur'
    menge: number
    einheit: string | null
    notizen: string | null
  }[]
  /** Zugänge, Abgänge, Verbrauch aus Spritzungen und Sonstiges (KAN-154) und Bestand in der Lager-Einheit (KAN-133) */
  konto: LagerKonto
}

export type PSMOption = { id: string; name: string; einheit_default: string | null; kategorie: string | null }

// Analog PSMLager/PSMOption – volle Lagerbewegungs-Erfassung für Düngemittel
// (Migration 142), damit Anfangsbestand/Einkauf/Korrektur genauso wie bei PSM
// erfasst und der Bestand berechnet werden kann.
export type DuengerLager = {
  duengemittel_id: string
  duengemittel_name: string
  typ: string | null
  bewegungen: {
    id: string
    datum: string
    typ: 'anfangsbestand' | 'einkauf' | 'korrektur'
    menge: number
    einheit: string | null
    notizen: string | null
  }[]
  /** Zugänge, Abgänge, Verbrauch aus Düngungen und Bestand in der Lager-Einheit (KAN-133) */
  konto: LagerKonto
}

export type DuengerOption = { id: string; name: string; einheit_default: string | null; typ: string | null }

export type PSMEintrag = {
  id: string; name: string; handelsname: string | null
  kategorie: string | null; wirkstoff: string | null
  wirkstoffgehalt_pct: number | null; cu_gehalt_pct: number | null
  max_aufwand_kg_ha: number | null; max_anwendungen: number | null
  wartezeit_tage: number | null; oeko_zugelassen: boolean
  notizen: string | null
}

export type DuengemittelEintrag = {
  id: string; name: string; handelsname: string | null
  typ: string | null
  naehrstoff_n_pct: number | null; naehrstoff_p_pct: number | null; naehrstoff_k_pct: number | null
  wartezeit_tage: number | null; oeko_zugelassen: boolean
  einarbeitung_erforderlich: boolean
  preis_pro_einheit: number | null; einheit: string | null
  notizen: string | null
}

export type SatzEintrag = {
  id: string; art: string; bezeichnung: string
  satz_pro_ha: number; gueltig_ab: string | null
  notizen: string | null
}

export default async function LagerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab = 'bestand' } = await searchParams
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const writeOk = canWrite(role, 'rieden')
  const adminOk = canAdmin(role)
  // Explizite Tenant-Filterung zusätzlich zu RLS: RLS erlaubt Zeilen aus JEDER Mitgliedschaft
  // des Nutzers, nicht nur dem aktiv gewählten Betrieb.
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tf = (query: any) => tenantId ? query.eq('tenant_id', tenantId) : query

  // Alle PSM (aktiv) – Basisdaten für Bestand
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSM } = await tf((supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, kategorie')
    .eq('aktiv', true)
    .order('name'))

  // Vollständige PSM-Stammdaten (für den Stammdaten-Tab)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawPSMStamm } = await tf((supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, handelsname, kategorie, wirkstoff, wirkstoffgehalt_pct, cu_gehalt_pct, max_aufwand_kg_ha, max_anwendungen, wartezeit_tage, oeko_zugelassen, notizen')
    .eq('aktiv', true)
    .order('name'))

  const psmStammdaten: PSMEintrag[] = ((rawPSMStamm ?? []) as AR[]).map(p => ({
    id:                  p.id,
    name:                p.name,
    handelsname:         p.handelsname ?? null,
    kategorie:           p.kategorie ?? null,
    wirkstoff:           p.wirkstoff ?? null,
    wirkstoffgehalt_pct: p.wirkstoffgehalt_pct ?? null,
    cu_gehalt_pct:       p.cu_gehalt_pct ?? null,
    max_aufwand_kg_ha:   p.max_aufwand_kg_ha ?? null,
    max_anwendungen:     p.max_anwendungen ?? null,
    wartezeit_tage:      p.wartezeit_tage ?? null,
    oeko_zugelassen:     p.oeko_zugelassen ?? false,
    notizen:             p.notizen ?? null,
  }))

  // Düngemittel-Stammdaten (für den Düngemittel-Tab)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawDuengerStamm } = await tf((supabase.from('duengemittel') as any)
    .select('id, name, handelsname, typ, naehrstoff_n_pct, naehrstoff_p_pct, naehrstoff_k_pct, wartezeit_tage, oeko_zugelassen, einarbeitung_erforderlich, preis_pro_einheit, einheit, notizen')
    .eq('aktiv', true)
    .order('name'))

  const duengemittelStammdaten: DuengemittelEintrag[] = ((rawDuengerStamm ?? []) as AR[]).map(d => ({
    id:                        d.id,
    name:                      d.name,
    handelsname:               d.handelsname ?? null,
    typ:                       d.typ ?? null,
    naehrstoff_n_pct:          d.naehrstoff_n_pct ?? null,
    naehrstoff_p_pct:          d.naehrstoff_p_pct ?? null,
    naehrstoff_k_pct:          d.naehrstoff_k_pct ?? null,
    wartezeit_tage:            d.wartezeit_tage ?? null,
    oeko_zugelassen:           d.oeko_zugelassen ?? false,
    einarbeitung_erforderlich: d.einarbeitung_erforderlich ?? false,
    preis_pro_einheit:         d.preis_pro_einheit ?? null,
    einheit:                   d.einheit ?? null,
    notizen:                   d.notizen ?? null,
  }))

  // Sätze/Stundensätze je Maßnahmenart (für den Stundensätze-Tab)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawSaetze } = await tf((supabase.from('saetze_massnahmen') as any)
    .select('id, art, bezeichnung, satz_pro_ha, gueltig_ab, notizen')
    .eq('aktiv', true)
    .order('art')
    .order('bezeichnung'))

  const saetzeMassnahmen: SatzEintrag[] = ((rawSaetze ?? []) as AR[]).map(s => ({
    id:           s.id,
    art:          s.art,
    bezeichnung:  s.bezeichnung,
    satz_pro_ha:  s.satz_pro_ha,
    gueltig_ab:   s.gueltig_ab ?? null,
    notizen:      s.notizen ?? null,
  }))

  // Lagerbewegungen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBew } = await tf((supabase.from('psm_lager_bewegungen') as any)
    .select('id, psm_id, datum, typ, menge, einheit, notizen')
    .order('datum', { ascending: false }))

  // Verbrauch aus Maßnahmen (KAN-133): Mittelmenge je Maßnahme (mittelmenge()) – PSM nur aus
  // Spritzungen und Sonstiges (KAN-154; Aufwand × Fläche; „Menge gesamt“ ist bei Spritzungen die
  // Spritzbrühe und zählt nie), Düngemittel
  // nur aus Düngungen. ladeBehandlungen() filtert nach dem Betrieb und liefert die behandelte Fläche
  // (Σ GST). Nur für den Bestand-Tab; ein Ladefehler erscheint dort, statt still ohne Verbrauch zu rechnen.
  const zeigtBestand = !['stammdaten', 'duengemittel', 'saetze', 'weinbehandlung', 'produktion'].includes(tab)
  let mitPsm: PsmBehandlung[] = []
  let duengungen: PsmBehandlung[] = []
  let verbrauchFehler: string | null = null
  if (zeigtBestand && tenantId) {
    try {
      const [s, so, d] = await Promise.all([
        ladeBehandlungen(supabase, tenantId, { art: 'spritzung' }),
        ladeBehandlungen(supabase, tenantId, { art: 'sonstiges' }),
        ladeBehandlungen(supabase, tenantId, { art: 'duengung' }),
      ])
      mitPsm = [...s.behandlungen, ...so.behandlungen]
      duengungen = d.behandlungen
    } catch (e) {
      verbrauchFehler = e instanceof Error ? e.message : String(e)
    }
  }
  const verbrauchByPsm = verbrauchJeMittel(mitPsm, 'psm')

  // Bewegungen je PSM gruppieren
  const bewegungenByPsm = new Map<string, PSMLager['bewegungen']>()
  for (const b of ((rawBew ?? []) as AR[])) {
    const arr = bewegungenByPsm.get(b.psm_id) ?? []
    arr.push({
      id: b.id, datum: b.datum, typ: b.typ,
      menge: b.menge, einheit: b.einheit, notizen: b.notizen,
    })
    bewegungenByPsm.set(b.psm_id, arr)
  }

  // Nur PSM mit Bewegungen ODER Verbrauch anzeigen
  const psms = ((rawPSM ?? []) as AR[])
  const psmOptions: PSMOption[] = psms.map(p => ({
    id: p.id, name: p.name, einheit_default: null, kategorie: p.kategorie ?? null,
  }))
  // Alle PSM für Dropdown (nicht nur aktive mit Bewegungen)
  // bereits in rawPSM enthalten

  const aktivePsm = psms
    .filter(p => bewegungenByPsm.has(p.id) || verbrauchByPsm.has(p.id))
    .map(p => {
      const bewegungen = bewegungenByPsm.get(p.id) ?? []
      return {
        psm_id:              p.id,
        psm_name:            p.name,
        kategorie:           p.kategorie ?? null,
        bewegungen,
        konto:               lagerKonto(bewegungen, verbrauchByPsm.get(p.id) ?? []),
      } satisfies PSMLager
    })
    .sort((a, b) => a.psm_name.localeCompare(b.psm_name, 'de'))

  // ── Düngemittel-Lagerbewegungen (Migration 142, analog PSM oben) ────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawDuengerBew } = await tf((supabase.from('duengemittel_lager_bewegungen') as any)
    .select('id, duengemittel_id, datum, typ, menge, einheit, notizen')
    .order('datum', { ascending: false }))

  // Verbrauch aus Düngungen: Düngermenge, sonst Aufwand × Fläche (mittelmenge(), siehe oben)
  const verbrauchByDuenger = verbrauchJeMittel(duengungen, 'duenger')

  const bewegungenByDuenger = new Map<string, DuengerLager['bewegungen']>()
  for (const b of ((rawDuengerBew ?? []) as AR[])) {
    const arr = bewegungenByDuenger.get(b.duengemittel_id) ?? []
    arr.push({
      id: b.id, datum: b.datum, typ: b.typ,
      menge: b.menge, einheit: b.einheit, notizen: b.notizen,
    })
    bewegungenByDuenger.set(b.duengemittel_id, arr)
  }

  // Alle aktiven Düngemittel für das Buchungsformular-Dropdown
  const duenger = ((rawDuengerStamm ?? []) as AR[])
  const duengerOptions: DuengerOption[] = duenger.map(d => ({
    id: d.id, name: d.name, einheit_default: d.einheit ?? null, typ: d.typ ?? null,
  }))

  // Nur Düngemittel mit Bewegungen ODER Verbrauch anzeigen (analog PSM)
  const aktiveDuenger: DuengerLager[] = duenger
    .filter(d => bewegungenByDuenger.has(d.id) || verbrauchByDuenger.has(d.id))
    .map(d => {
      const bewegungen = bewegungenByDuenger.get(d.id) ?? []
      return {
        duengemittel_id:     d.id,
        duengemittel_name:   d.name,
        typ:                 d.typ ?? null,
        bewegungen,
        // Lager-Einheit ohne Buchungen: Einheit des Düngemittels (Stammdaten)
        konto:               lagerKonto(bewegungen, verbrauchByDuenger.get(d.id) ?? [], d.einheit ?? null),
      } satisfies DuengerLager
    })
    .sort((a, b) => a.duengemittel_name.localeCompare(b.duengemittel_name, 'de'))

  // ── KAN-167: Weinbehandlungs- und Produktionsmittel ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBm } = await tf((supabase.from('betriebsmittel') as any)
    .select('id, gruppe, name, einheit, preis_pro_einheit, ea_kategorie_id, notizen, aktiv')
    .order('name'))
  const bmAlle = ((rawBm ?? []) as AR[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawBmBew } = await tf((supabase.from('betriebsmittel_lager_bewegungen') as any)
    // storno-sichtbar: stornierte Buchungen stehen gekennzeichnet in der Liste, zählen aber nicht zum Bestand
    .select('id, betriebsmittel_id, datum, typ, menge, einheit, betrag_netto, ust_satz, notizen, storniert_am, storniert_von_name, storno_grund, lieferant:firmen!lieferant_firma_id(name)')
    .order('datum', { ascending: true }))
  // Verbrauch aus Maßnahmen (Sonstiges, Laubarbeit) mit Betriebsmittel – Aufwand × behandelte Fläche bzw. gesamt
  const { data: rawBmVerbrauch } = zeigtBestand
    ? await tf((supabase.from('behandlungen') as any)   // eslint-disable-line @typescript-eslint/no-explicit-any
        .select('id, datum, art, aufwandmenge, aufwandmenge_einheit, betriebsmittel_id, weingarten:weingarten_id(name), behandlung_grundstuecke(flaeche_ha, grundstueck:grundstueck_id(flaeche_ha))')
        .not('betriebsmittel_id', 'is', null))
    : { data: [] }
  const bmVerbrauch = new Map<string, BmVerbrauchPosten[]>()
  for (const b of ((rawBmVerbrauch ?? []) as AR[])) {
    const art = MASSNAHMEN_ART_LABEL[b.art as keyof typeof MASSNAHMEN_ART_LABEL] ?? b.art
    const ort = (b.weingarten as AR | null)?.name ?? null
    const liste = bmVerbrauch.get(b.betriebsmittel_id) ?? []
    liste.push({
      behandlungId: b.id, datum: b.datum, art, ort,
      kurz: `${art} am ${String(b.datum).split('-').reverse().join('.')}${ort ? ` (${ort})` : ''}`,
      aufwand: b.aufwandmenge == null ? null : Number(b.aufwandmenge),
      aufwandEinheit: b.aufwandmenge_einheit ?? null,
      // behandelte Fläche = Σ Grundstücke der Maßnahme (wie Bearbeiten und updateBehandlung)
      flaecheHa: summeFlaecheHa(((b.behandlung_grundstuecke ?? []) as AR[]).map(bg => bg.flaeche_ha ?? bg.grundstueck?.flaeche_ha)),
    })
    bmVerbrauch.set(b.betriebsmittel_id, liste)
  }
  const bmBewegungen = new Map<string, BmBewegung[]>()
  for (const b of ((rawBmBew ?? []) as AR[])) {
    const liste = bmBewegungen.get(b.betriebsmittel_id) ?? []
    liste.push({
      id: b.id, datum: b.datum, typ: b.typ, menge: Number(b.menge), einheit: b.einheit,
      betrag_netto: b.betrag_netto == null ? null : Number(b.betrag_netto), ust_satz: b.ust_satz == null ? null : Number(b.ust_satz),
      lieferant: (b.lieferant as AR | null)?.name ?? null, notizen: b.notizen ?? null,
      storniert_am: b.storniert_am ?? null, storniert_von_name: b.storniert_von_name ?? null, storno_grund: b.storno_grund ?? null,
    })
    bmBewegungen.set(b.betriebsmittel_id, liste)
  }
  // Ausgaben-Kategorien (global und eigene) und Lieferanten (Firmen mit „Lieferant“) für den Einkauf
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawKat } = await (supabase.from('ea_kategorien') as any)
    .select('id, name, tenant_id').eq('typ', 'ausgabe').eq('aktiv', true)
    .or(tenantId ? `tenant_id.is.null,tenant_id.eq.${tenantId}` : 'tenant_id.is.null')
    .order('name')
  const kategorien = ((rawKat ?? []) as AR[]).map(k => ({ id: k.id as string, name: k.name as string }))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rawLief } = await tf((supabase.from('firmen') as any)
    .select('id, name').eq('ist_lieferant', true).eq('aktiv', true).order('name').limit(500))
  const lieferanten = ((rawLief ?? []) as AR[]).map(l => ({ id: l.id as string, name: l.name as string }))
  // Einkauf (mit Pflicht-E/A-Ausgabe) nur mit E&A-Rechnung (Buchhaltungsart E/A) und Schreibrecht E&A
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: einst } = await tf((supabase.from('tenant_einstellungen') as any).select('modul_ea, buchhaltungsart')).maybeSingle()
  const einkaufSperre = !(einst as AR | null)?.modul_ea || (einst as AR | null)?.buchhaltungsart !== 'ea'
    ? 'die E&A-Rechnung ist für diesen Betrieb nicht aktiv – bitte Anfangsbestand bzw. Inventurkorrektur verwenden.'
    : !(membership && canWrite(membership, 'ea'))
    ? 'dir fehlt das Schreibrecht für die E&A-Rechnung.'
    : null
  const bmStamm = (g: BetriebsmittelGruppe): BmStamm[] => bmAlle.filter(m => m.gruppe === g).map(m => ({
    id: m.id, name: m.name, einheit: m.einheit, preis_pro_einheit: m.preis_pro_einheit == null ? null : Number(m.preis_pro_einheit),
    ea_kategorie_id: m.ea_kategorie_id ?? null, notizen: m.notizen ?? null, aktiv: m.aktiv !== false,
  }))
  const bmOptionen = (g: BetriebsmittelGruppe): BmOption[] => bmAlle.filter(m => m.gruppe === g && m.aktiv !== false).map(m => ({
    id: m.id, name: m.name, einheit: m.einheit, ea_kategorie_id: m.ea_kategorie_id ?? null,
    preis_pro_einheit: m.preis_pro_einheit == null ? null : Number(m.preis_pro_einheit),
  }))
  const bmKarten = (g: BetriebsmittelGruppe): BmKarte[] => bmAlle
    .filter(m => m.gruppe === g && (bmBewegungen.has(m.id) || bmVerbrauch.has(m.id)))
    .map(m => {
      const bewegungen = bmBewegungen.get(m.id) ?? []
      return {
        id: m.id, name: m.aktiv === false ? `${m.name} (deaktiviert)` : m.name, einheit: m.einheit, bewegungen,
        konto: bmKonto(bewegungen.map(b => ({ datum: b.datum, menge: b.menge, einheit: b.einheit, storniert: !!b.storniert_am })),
          bmVerbrauch.get(m.id) ?? [], m.einheit),
      }
    })

  const TABS = [
    { key: 'bestand',      label: 'Bestand & Bewegungen' },
    { key: 'stammdaten',   label: 'PSM-Stammdaten' },
    { key: 'duengemittel', label: 'Düngemittel' },
    { key: 'weinbehandlung', label: GRUPPE_LABEL.weinbehandlung },
    { key: 'produktion',   label: GRUPPE_LABEL.produktion },
    { key: 'saetze',       label: 'Stundensätze' },
  ]

  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-6">
        <Link href="/behandlungen" className="hover:text-s112-blue-700 transition-colors">Maßnahmen</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Betriebsmittel</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Betriebsmittel-Lagerverwaltung</h1>
          <p className="text-sm text-s112-muted mt-0.5">
            {tab === 'stammdaten'
              ? 'Pflanzenschutzmittel anlegen und pflegen · Cu-Gehalt · Grenzwerte · Bio-Zulassung'
              : tab === 'duengemittel'
              ? 'Düngemittel anlegen und pflegen · N-P-K-Gehalt · Preis · Bio-Zulassung'
              : tab === 'saetze'
              ? 'Hektarsätze je Maßnahmenart für die Kosten-Vorschlagsfunktion'
              : tab === 'weinbehandlung' || tab === 'produktion'
              ? `${GRUPPE_LABEL[tab as BetriebsmittelGruppe]} anlegen und pflegen · Einheit · Einkaufspreis · E/A-Kategorie`
              : 'Anfangsbestand · Einkauf · Verbrauch · Inventurkorrektur'}
          </p>
        </div>
      </div>

      <div className="flex gap-1 border-b border-s112-border mb-6">
        {TABS.map(t => (
          <Link
            key={t.key}
            href={`/behandlungen/lager?tab=${t.key}`}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors
              ${tab === t.key
                ? 'bg-white border border-b-white border-s112-border text-s112-blue-700 -mb-px'
                : 'text-s112-muted hover:text-s112-blue-700'}`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === 'stammdaten' ? (
        <PSMClient psm={psmStammdaten} writeOk={writeOk} adminOk={adminOk} />
      ) : tab === 'duengemittel' ? (
        <DuengemittelClient duengemittel={duengemittelStammdaten} writeOk={writeOk} adminOk={adminOk} />
      ) : tab === 'saetze' ? (
        <SaetzeClient saetze={saetzeMassnahmen} writeOk={writeOk} adminOk={adminOk} />
      ) : tab === 'weinbehandlung' || tab === 'produktion' ? (
        <BetriebsmittelStammClient gruppe={tab} mittel={bmStamm(tab)} kategorien={kategorien} writeOk={writeOk} adminOk={adminOk} />
      ) : (
        <div className="space-y-8">
          {verbrauchFehler && (
            <div role="alert" className="p-3 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">
              {verbrauchFehler} – der Verbrauch aus Maßnahmen fehlt in den Beständen unten.
            </div>
          )}
          <div>
            <h2 className="text-sm font-semibold text-s112-text-2 uppercase tracking-wide mb-3">Pflanzenschutzmittel</h2>
            <LagerClient
              psms={aktivePsm}
              allePsm={psmOptions}
              writeOk={writeOk}
              adminOk={adminOk}
            />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-s112-text-2 uppercase tracking-wide mb-3">Düngemittel</h2>
            <DuengerLagerClient
              duenger={aktiveDuenger}
              alleDuenger={duengerOptions}
              writeOk={writeOk}
              adminOk={adminOk}
            />
          </div>
          {BETRIEBSMITTEL_GRUPPEN.map(g => (
            <div key={g}>
              <h2 className="text-sm font-semibold text-s112-text-2 uppercase tracking-wide mb-3">{GRUPPE_LABEL[g]}</h2>
              <BetriebsmittelLagerClient gruppe={g} karten={bmKarten(g)} writeOk={writeOk}
                ctx={{ alle: bmOptionen(g), kategorien, lieferanten, einkaufSperre }} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
