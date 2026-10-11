import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { alle } from '@/lib/supabase/alle'
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
import { wienJetzt } from '@/lib/datum/wien'
import { wienDatum } from '@/lib/csv'
import { stammLager, type StammLager } from './LagerJahrSpalten'
import { StartJahrRahmen } from './AnfangsbestandHinweis'
import { riedText } from '@/lib/behandlungen/rieden'

export const metadata: Metadata = { title: 'Betriebsmittel' }
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
    /** KAN-88: stornierte Buchung (steht gekennzeichnet in der Liste, zählt nicht zum Bestand) */
    storniert_am?: string | null
    storniert_von_name?: string | null
    storno_grund?: string | null
    /** KAN-326: Einkauf mit E/A-Ausgabe (Betrag netto), sonst null */
    betrag_netto?: number | null
    mit_ausgabe?: boolean
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
    /** KAN-88: stornierte Buchung (steht gekennzeichnet in der Liste, zählt nicht zum Bestand) */
    storniert_am?: string | null
    storniert_von_name?: string | null
    storno_grund?: string | null
    /** KAN-326: Einkauf mit E/A-Ausgabe (Betrag netto), sonst null */
    betrag_netto?: number | null
    mit_ausgabe?: boolean
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
  /** KAN-86: Registernummer (Zulassungsnr.), EPPO-Code des Hauptschaderregers, bienengefährlich */
  zulassungsnr: string | null; eppo_code: string | null; bienengefaehrlich: boolean
  /** KAN-173: Lagerbewegung im laufenden Geschäftsjahr */
  lager?: StammLager | null
}

export type DuengemittelEintrag = {
  id: string; name: string; handelsname: string | null
  typ: string | null
  naehrstoff_n_pct: number | null; naehrstoff_p_pct: number | null; naehrstoff_k_pct: number | null
  wartezeit_tage: number | null; oeko_zugelassen: boolean
  einarbeitung_erforderlich: boolean
  preis_pro_einheit: number | null; einheit: string | null
  notizen: string | null
  /** KAN-173: Lagerbewegung im laufenden Geschäftsjahr */
  lager?: StammLager | null
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
  const rawPSM = geladen(await tf((supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, kategorie')
    .eq('aktiv', true)
    .order('name')), 'Pflanzenschutzmittel')

  // Vollständige PSM-Stammdaten (für den Stammdaten-Tab)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawPSMStamm = geladen(await tf((supabase.from('pflanzenschutzmittel') as any)
    .select('id, name, handelsname, kategorie, wirkstoff, wirkstoffgehalt_pct, cu_gehalt_pct, max_aufwand_kg_ha, max_anwendungen, wartezeit_tage, oeko_zugelassen, zulassungsnr, eppo_code, bienengefaehrlich, notizen')
    .eq('aktiv', true)
    .order('name')), 'Pflanzenschutzmittel')

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
    zulassungsnr:        p.zulassungsnr ?? null,
    eppo_code:           p.eppo_code ?? null,
    bienengefaehrlich:   p.bienengefaehrlich ?? false,
  }))

  // Düngemittel-Stammdaten (für den Düngemittel-Tab)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDuengerStamm = geladen(await tf((supabase.from('duengemittel') as any)
    .select('id, name, handelsname, typ, naehrstoff_n_pct, naehrstoff_p_pct, naehrstoff_k_pct, wartezeit_tage, oeko_zugelassen, einarbeitung_erforderlich, preis_pro_einheit, einheit, notizen')
    .eq('aktiv', true)
    .order('name')), 'Düngemittel')

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
  const rawSaetze = geladen(await tf((supabase.from('saetze_massnahmen') as any)
    .select('id, art, bezeichnung, satz_pro_ha, gueltig_ab, notizen')
    .eq('aktiv', true)
    .order('art')
    .order('bezeichnung')), 'Stundensätze')

  const saetzeMassnahmen: SatzEintrag[] = ((rawSaetze ?? []) as AR[]).map(s => ({
    id:           s.id,
    art:          s.art,
    bezeichnung:  s.bezeichnung,
    satz_pro_ha:  s.satz_pro_ha,
    gueltig_ab:   s.gueltig_ab ?? null,
    notizen:      s.notizen ?? null,
  }))

  // Lagerbewegungen
  // alle(): Lagerbestand = Summe ALLER Bewegungen – PostgREST kappt sonst still bei 1.000 (gilt für alle drei Lager)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBew = geladen(await alle<AR>(tf((supabase.from('psm_lager_bewegungen') as any)
    // storno-sichtbar: stornierte Buchungen stehen gekennzeichnet in der Liste, zählen aber nicht zum Bestand (KAN-88)
    .select('id, psm_id, datum, typ, menge, einheit, notizen, storniert_am, storniert_von_name, storno_grund, betrag_netto, ea_transaktion_id')
    .order('datum', { ascending: false }).order('id'))), 'PSM-Lagerbewegungen')

  // Verbrauch aus Maßnahmen (KAN-133): Mittelmenge je Maßnahme (mittelmenge()) – PSM nur aus
  // Spritzungen und Sonstiges (KAN-154; Aufwand × Fläche; „Menge gesamt“ ist bei Spritzungen die
  // Spritzbrühe und zählt nie), Düngemittel
  // nur aus Düngungen. ladeBehandlungen() filtert nach dem Betrieb und liefert die behandelte Fläche
  // (Σ GST). Nur für den Bestand-Tab; ein Ladefehler erscheint dort, statt still ohne Verbrauch zu rechnen.
  const zeigtBestand = !['stammdaten', 'duengemittel', 'saetze', 'weinbehandlung', 'produktion'].includes(tab)
  // KAN-173 (01.10.2026): die Stammdaten-Tabellen zeigen je Mittel Anfangsbestand | Zukäufe | Verbräuche | Saldo des
  // laufenden Geschäftsjahrs (Kalenderjahr, Wiener Zeit) – dafür braucht auch der jeweilige Stammdaten-Tab den Verbrauch.
  const jahr = wienJetzt().getFullYear()
  // Nachtrag 02.10.2026 (Jörgen): unterjährige Anfangsbestände zählen nur im Startjahr des Betriebs (Jahr von
  // tenants.created_at, Wiener Zeit) zum Anfangsbestand, sonst zu den Zukäufen – nur lesen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tenantStart } = tenantId ? await (supabase.from('tenants') as any)
    .select('created_at').eq('id', tenantId).maybeSingle() : { data: null }
  const startDatum = wienDatum(tenantStart?.created_at)
  const startJahr = startDatum ? Number(startDatum.slice(0, 4)) : null
  const brauchtPsm = zeigtBestand || tab === 'stammdaten'
  const brauchtDuenger = zeigtBestand || tab === 'duengemittel'
  const brauchtBm = zeigtBestand || tab === 'weinbehandlung' || tab === 'produktion'
  let mitPsm: PsmBehandlung[] = []
  let duengungen: PsmBehandlung[] = []
  let verbrauchFehler: string | null = null
  if ((brauchtPsm || brauchtDuenger) && tenantId) {
    try {
      const leer = { behandlungen: [] as PsmBehandlung[] }
      const [s, so, d] = await Promise.all([
        brauchtPsm ? ladeBehandlungen(supabase, tenantId, { art: 'spritzung' }) : leer,
        brauchtPsm ? ladeBehandlungen(supabase, tenantId, { art: 'sonstiges' }) : leer,
        brauchtDuenger ? ladeBehandlungen(supabase, tenantId, { art: 'duengung' }) : leer,
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
      storniert_am: b.storniert_am ?? null, storniert_von_name: b.storniert_von_name ?? null, storno_grund: b.storno_grund ?? null,
      betrag_netto: b.betrag_netto == null ? null : Number(b.betrag_netto), mit_ausgabe: b.ea_transaktion_id != null,   // KAN-326
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

  // Lagerkonto je PSM (mit Jahressicht, KAN-173); null ohne Buchung und Verbrauch
  const psmKonto = (id: string): LagerKonto | null => bewegungenByPsm.has(id) || verbrauchByPsm.has(id)
    ? lagerKonto((bewegungenByPsm.get(id) ?? []).filter(b => !b.storniert_am), verbrauchByPsm.get(id) ?? [], undefined, jahr, startJahr)
    : null

  const aktivePsm = psms
    .filter(p => bewegungenByPsm.has(p.id) || verbrauchByPsm.has(p.id))
    .map(p => ({
      psm_id:              p.id,
      psm_name:            p.name,
      kategorie:           p.kategorie ?? null,
      bewegungen:          bewegungenByPsm.get(p.id) ?? [],
      konto:               psmKonto(p.id) as LagerKonto,
    } satisfies PSMLager))
    .sort((a, b) => a.psm_name.localeCompare(b.psm_name, 'de'))
  const psmMitLager: PSMEintrag[] = psmStammdaten.map(p => ({ ...p, lager: stammLager(psmKonto(p.id)) }))

  // ── Düngemittel-Lagerbewegungen (Migration 142, analog PSM oben) ────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawDuengerBew = geladen(await alle<AR>(tf((supabase.from('duengemittel_lager_bewegungen') as any)
    // storno-sichtbar: stornierte Buchungen stehen gekennzeichnet in der Liste, zählen aber nicht zum Bestand (KAN-88)
    .select('id, duengemittel_id, datum, typ, menge, einheit, notizen, storniert_am, storniert_von_name, storno_grund, betrag_netto, ea_transaktion_id')
    .order('datum', { ascending: false }).order('id'))), 'Düngemittel-Lagerbewegungen')

  // Verbrauch aus Düngungen: Düngermenge, sonst Aufwand × Fläche (mittelmenge(), siehe oben)
  const verbrauchByDuenger = verbrauchJeMittel(duengungen, 'duenger')

  const bewegungenByDuenger = new Map<string, DuengerLager['bewegungen']>()
  for (const b of ((rawDuengerBew ?? []) as AR[])) {
    const arr = bewegungenByDuenger.get(b.duengemittel_id) ?? []
    arr.push({
      id: b.id, datum: b.datum, typ: b.typ,
      menge: b.menge, einheit: b.einheit, notizen: b.notizen,
      storniert_am: b.storniert_am ?? null, storniert_von_name: b.storniert_von_name ?? null, storno_grund: b.storno_grund ?? null,
      betrag_netto: b.betrag_netto == null ? null : Number(b.betrag_netto), mit_ausgabe: b.ea_transaktion_id != null,   // KAN-326
    })
    bewegungenByDuenger.set(b.duengemittel_id, arr)
  }

  // Alle aktiven Düngemittel für das Buchungsformular-Dropdown
  const duenger = ((rawDuengerStamm ?? []) as AR[])
  const duengerOptions: DuengerOption[] = duenger.map(d => ({
    id: d.id, name: d.name, einheit_default: d.einheit ?? null, typ: d.typ ?? null,
  }))

  // Lagerkonto je Düngemittel (mit Jahressicht, KAN-173); Lager-Einheit ohne Buchungen: Einheit des Düngemittels
  const duengerKonto = (d: AR): LagerKonto | null => bewegungenByDuenger.has(d.id) || verbrauchByDuenger.has(d.id)
    ? lagerKonto((bewegungenByDuenger.get(d.id) ?? []).filter(b => !b.storniert_am), verbrauchByDuenger.get(d.id) ?? [], d.einheit ?? null, jahr, startJahr)
    : null

  // Nur Düngemittel mit Bewegungen ODER Verbrauch anzeigen (analog PSM)
  const aktiveDuenger: DuengerLager[] = duenger
    .filter(d => bewegungenByDuenger.has(d.id) || verbrauchByDuenger.has(d.id))
    .map(d => ({
      duengemittel_id:     d.id,
      duengemittel_name:   d.name,
      typ:                 d.typ ?? null,
      bewegungen:          bewegungenByDuenger.get(d.id) ?? [],
      konto:               duengerKonto(d) as LagerKonto,
    } satisfies DuengerLager))
    .sort((a, b) => a.duengemittel_name.localeCompare(b.duengemittel_name, 'de'))
  const duengerById = new Map(duenger.map(d => [d.id as string, d]))
  const duengemittelMitLager: DuengemittelEintrag[] = duengemittelStammdaten.map(d => {
    const roh = duengerById.get(d.id)
    return { ...d, lager: stammLager(roh ? duengerKonto(roh) : null) }
  })

  // ── KAN-167: Weinbehandlungs- und Produktionsmittel ──────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBm = geladen(await tf((supabase.from('betriebsmittel') as any)
    .select('id, gruppe, name, einheit, preis_pro_einheit, ea_kategorie_id, notizen, aktiv')
    .order('name')), 'Betriebsmittel')
  const bmAlle = ((rawBm ?? []) as AR[])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawBmBew = geladen(await alle<AR>(tf((supabase.from('betriebsmittel_lager_bewegungen') as any)
    // storno-sichtbar: stornierte Buchungen stehen gekennzeichnet in der Liste, zählen aber nicht zum Bestand
    // Lieferant über den Namen des Fremdschlüssels: (lieferant_firma_id, tenant_id) ist ein Verbund-FK, der Spalten-
    // Hinweis „firmen!lieferant_firma_id“ findet ihn nicht (PGRST200 – Seite 500, gefunden im ersten E2E-Lauf 10.10.2026)
    .select('id, betriebsmittel_id, datum, typ, menge, einheit, betrag_netto, ust_satz, notizen, storniert_am, storniert_von_name, storno_grund, lieferant:firmen!betriebsmittel_lager_bewegungen_lieferant_fkey(name)')
    .order('datum', { ascending: true }).order('id'))), 'Betriebsmittel-Lagerbewegungen')
  // Verbrauch aus Maßnahmen (Sonstiges, Laubarbeit) mit Betriebsmittel – Aufwand × behandelte Fläche bzw. gesamt
  const { data: rawBmVerbrauch } = brauchtBm
    ? await alle<AR>(tf((supabase.from('behandlungen') as any)   // eslint-disable-line @typescript-eslint/no-explicit-any
        .select('id, datum, art, aufwandmenge, aufwandmenge_einheit, betriebsmittel_id, weingarten_id, weingarten:weingarten_id(id, name, ried), behandlung_grundstuecke(flaeche_ha, grundstueck:grundstueck_id(flaeche_ha, weingarten_id, weingarten:weingarten_id(id, name, ried)))')
        .not('betriebsmittel_id', 'is', null)
        .is('storniert_am', null)   // KAN-88: stornierte Maßnahmen verbrauchen nichts
        .order('id')))   // alle(): Verbrauch über alle Jahre, nicht nur die ersten 1.000 Maßnahmen
    : { data: [] }
  const bmVerbrauch = new Map<string, BmVerbrauchPosten[]>()
  for (const b of ((rawBmVerbrauch ?? []) as AR[])) {
    const art = MASSNAHMEN_ART_LABEL[b.art as keyof typeof MASSNAHMEN_ART_LABEL] ?? b.art
    const ort = riedText(b, { leer: '' }) || null   // KAN-121 (01.10.2026): Rieden auch über die Grundstücke
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
  const rawKat = geladen(await (supabase.from('ea_kategorien') as any)
    .select('id, name, tenant_id').eq('typ', 'ausgabe').eq('aktiv', true)
    .or(tenantId ? `tenant_id.is.null,tenant_id.eq.${tenantId}` : 'tenant_id.is.null')
    .order('name'), 'Kategorien')
  const kategorien = ((rawKat ?? []) as AR[]).map(k => ({ id: k.id as string, name: k.name as string }))
  // Sweep 93 (KAN-288): Lieferanten-Auswahl vollständig – vorher .limit(500), weitere Lieferanten fehlten still
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawLief = geladen(await alle<AR>(tf((supabase.from('firmen') as any)
    .select('id, name').eq('ist_lieferant', true).eq('aktiv', true)).order('name').order('id')), 'Firmen')
  const lieferanten = ((rawLief ?? []) as AR[]).map(l => ({ id: l.id as string, name: l.name as string }))
  // Einkauf (mit Pflicht-E/A-Ausgabe) nur mit Modul E&A bzw. Belege und Schreibrecht E&A – KAN-223 (Entscheidung 07.10.2026):
  // auch Doppik-Betriebe (Belege & BMD-Übergabe), dieselbe Regel wie s112_betriebsmittel_einkauf
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const einst = geladen(await tf((supabase.from('tenant_einstellungen') as any).select('modul_ea, buchhaltungsart')).maybeSingle(), 'Einstellungen')
  const einkaufSperre = !(einst as AR | null)?.modul_ea
    ? 'das Modul E&A bzw. Belege ist für diesen Betrieb nicht aktiv – bitte Anfangsbestand bzw. Inventurkorrektur verwenden.'
    : !(membership && canWrite(membership, 'ea'))
    ? 'dir fehlt das Schreibrecht für die E&A-Rechnung.'
    : null
  // Lagerkonto je Betriebsmittel (mit Jahressicht, KAN-173); null ohne Buchung und Verbrauch
  const bmKontoVon = (m: AR): LagerKonto | null => {
    if (!bmBewegungen.has(m.id) && !bmVerbrauch.has(m.id)) return null
    const bewegungen = bmBewegungen.get(m.id) ?? []
    return bmKonto(bewegungen.map(b => ({ datum: b.datum, menge: b.menge, einheit: b.einheit, storniert: !!b.storniert_am, typ: b.typ })),
      bmVerbrauch.get(m.id) ?? [], m.einheit, jahr, startJahr)
  }
  const bmStamm = (g: BetriebsmittelGruppe): BmStamm[] => bmAlle.filter(m => m.gruppe === g).map(m => ({
    id: m.id, name: m.name, einheit: m.einheit, preis_pro_einheit: m.preis_pro_einheit == null ? null : Number(m.preis_pro_einheit),
    ea_kategorie_id: m.ea_kategorie_id ?? null, notizen: m.notizen ?? null, aktiv: m.aktiv !== false,
    lager: stammLager(bmKontoVon(m)),
  }))
  const bmOptionen = (g: BetriebsmittelGruppe): BmOption[] => bmAlle.filter(m => m.gruppe === g && m.aktiv !== false).map(m => ({
    id: m.id, name: m.name, einheit: m.einheit, ea_kategorie_id: m.ea_kategorie_id ?? null,
    preis_pro_einheit: m.preis_pro_einheit == null ? null : Number(m.preis_pro_einheit),
  }))
  const bmKarten = (g: BetriebsmittelGruppe): BmKarte[] => bmAlle
    .filter(m => m.gruppe === g && (bmBewegungen.has(m.id) || bmVerbrauch.has(m.id)))
    .map(m => ({
      id: m.id, name: m.aktiv === false ? `${m.name} (deaktiviert)` : m.name, einheit: m.einheit,
      bewegungen: bmBewegungen.get(m.id) ?? [],
      konto: bmKontoVon(m) as LagerKonto,
    }))

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

      {verbrauchFehler && (
        <div role="alert" className="mb-6 p-3 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">
          {verbrauchFehler} – der Verbrauch aus Maßnahmen fehlt in den Beständen unten.
        </div>
      )}

      {tab === 'stammdaten' ? (
        <PSMClient psm={psmMitLager} jahr={jahr} writeOk={writeOk} adminOk={adminOk} />
      ) : tab === 'duengemittel' ? (
        <DuengemittelClient duengemittel={duengemittelMitLager} jahr={jahr} writeOk={writeOk} adminOk={adminOk} />
      ) : tab === 'saetze' ? (
        <SaetzeClient saetze={saetzeMassnahmen} writeOk={writeOk} adminOk={adminOk} />
      ) : tab === 'weinbehandlung' || tab === 'produktion' ? (
        <BetriebsmittelStammClient gruppe={tab} mittel={bmStamm(tab)} jahr={jahr} kategorien={kategorien} writeOk={writeOk} adminOk={adminOk} />
      ) : (
        <StartJahrRahmen startJahr={startJahr}>
        <div className="space-y-8">
          <div>
            <h2 className="text-sm font-semibold text-s112-text-2 uppercase tracking-wide mb-3">Pflanzenschutzmittel</h2>
            <LagerClient
              psms={aktivePsm}
              allePsm={psmOptions}
              writeOk={writeOk}
              adminOk={adminOk}
              einkauf={{ kategorien, lieferanten, einkaufSperre }}
            />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-s112-text-2 uppercase tracking-wide mb-3">Düngemittel</h2>
            <DuengerLagerClient
              duenger={aktiveDuenger}
              alleDuenger={duengerOptions}
              writeOk={writeOk}
              adminOk={adminOk}
              einkauf={{ kategorien, lieferanten, einkaufSperre }}
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
        </StartJahrRahmen>
      )}
    </div>
  )
}
