// ── Bewegungsbuch je Gebinde (Ein- und Ausgangsbuch) – Seite UND CSV (24.09.2026) ──
//
// Die Ereignislogik stand bis 24.09.2026 in kellerbuch/behaelter/[id]/bewegungen/page.tsx
// und liegt jetzt hier, damit Bildschirm, Ausdruck und CSV („bewegungsbuch“) dieselben
// Zeilen zeigen. Eine Bewegung je Zu- oder Abgang (Anfangsbestand, Zukauf, Pressung,
// Umzug/Filtration, Abfüllung, Tankverkauf, Verschnitt, Schwund) bzw. je Kellerbehandlung
// (Menge 0). Mengen sind auf 2 Stellen gerundet, der Saldo summiert genau diese Werte.
//
// Kellergemeinschaft: das Gebinde selbst kommt über lade_behaelter (SECURITY DEFINER,
// auch Partner-Gebinde), die Bewegungen bleiben auf den eigenen Betrieb beschränkt –
// Wein eines Partnerbetriebs im selben Gebinde erscheint nur als Hinweis (Menge + Betrieb).
//
// belegungszeitraeume() leitet daraus ab, wann welche Charge im Gebinde lag – für
// Kellerbehandlungen ohne erfasste Charge (keller-behandlungen.ts, Weinbuch-Fallback).
//
// Storno (KAN-145 B2b, 30.09.2026): Ein stornierter Umzug bzw. Verschnitt bleibt am Buchungstag stehen (Vermerk
// „storniert am …“) und bekommt am Storno-Tag eine Gegenbuchung mit umgekehrter Menge – so stimmt der Saldo zu
// jedem Stichtag. Belegungszeiträume und Liter je Charge lassen das Paar aus.
//
// KAN-77 (03.10.2026): „Verschneidung von …“ nennt das Quellgebinde am Tag des Verschnitts (lib/kellerbuch/quellGebinde.ts,
// auch bei einer Zwischencharge im Ziel-Tank) statt des heutigen Gebindes der Quell-Charge.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { momentaufnahmeAnwenden } from '../stammdaten/momentaufnahme'
import { runden, STELLEN, type CsvSpalte } from '@/lib/csv'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { istStorniert, stornoAngaben } from '@/lib/kellerbuch/stornoFilter'
import { ladeBehaelterEinzeln, type BehaelterZeile } from '@/lib/keller/behaelter'
import { fmtNum } from '@/lib/format'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { imZeitraum, num, tag, text, type R, type Zeitraum } from './kellerbuch-hilfen'
import { eroeffnungsTag, istFlaschenEroeffnung } from '@/lib/kellerbuch/eroeffnungsStichtag'
import { VERARBEITUNG_ZWECK_LABEL, type VerarbeitungZweck } from '@/lib/kellerbuch/verarbeitung'
import { GEBINDE_REKONSTRUIERT, quellGebindeAusDaten, quellGebindeDesVerschnitts, quellGebindeSchluessel, type Quellgebinde, type UmzugGebinde, type VerschnittGebinde } from '@/lib/kellerbuch/quellGebinde'

export type BewegungsArt =
  | 'uebertrag' | 'anfangsbestand' | 'zukauf' | 'pressung' | 'umzug_ein' | 'umzug_aus' | 'filtration_ein'
  | 'filtration_aus' | 'abfuellung' | 'verkauf' | 'behandlung' | 'verschneidung_ein' | 'verschneidung_aus' | 'schwund'
  | 'verarbeitung'

export const BEWEGUNGSART_LABEL: Record<BewegungsArt, string> = {
  uebertrag:         'Übertrag',
  anfangsbestand:    'Anfangsbestand',
  zukauf:            'Zukauf',
  pressung:          'Pressung',
  umzug_ein:         'Umzug (Zugang)',
  umzug_aus:         'Umzug (Abgang)',
  filtration_ein:    'Filtration (Zugang)',
  filtration_aus:    'Filtration (Abgang)',
  abfuellung:        'Abfüllung',
  verkauf:           'Tankverkauf',
  behandlung:        'Kellerbehandlung',
  verschneidung_ein: 'Verschnitt (Zugang)',
  verschneidung_aus: 'Verschnitt (Abgang)',
  schwund:           'Schwund',
  verarbeitung:      'Verarbeitung',
}

export type Bewegung = {
  /** Kalendertag 'JJJJ-MM-TT' ('' = unbekannt, sortiert vorne) */
  datum: string
  art: BewegungsArt
  beschreibung: string
  /** Liter, auf 2 Stellen gerundet: + Zugang, − Abgang, 0 = keine Mengenbewegung */
  menge: number
  extra?: string
  fuellung_id?: string
  chargeId: string | null
  /** Charge, die sich bewegt (Name) */
  charge: string | null
  /** Herkunft bzw. Ziel (Gebinde, Charge, Lieferant, Kunde, Füllung) */
  gegenstelle: string | null
  /** Beleg: Transaktionsnummer, Rechnungs-, Prüf- oder Chargennummer */
  beleg: string | null
  /** KAN-145: Buchung später storniert (Kalendertag des Stornos, Grund, Benutzer) */
  storno?: { am: string; grund: string | null; von: string | null }
  /** KAN-145: Gegenbuchung eines Stornos – Kalendertag der stornierten Buchung */
  gegenbuchungZu?: string
  /** KAN-43 Etappe 2: id der Quellzeile (zukauf_posten, pressung_behaelter, keller_umzuege, fuellungen,
   *  verkauf_positionen, verschneidung_quellen, verschneidungen bzw. weinausbau beim Eröffnungsbestand) */
  quelleId?: string
}

export type BewegungMitSaldo = Bewegung & { saldo: number }

/** Rohdaten eines Gebindes (eigener Betrieb) – Grundlage für Bewegungen und Kennzahlen */
type Roh = {
  pressungen: R[]
  umzuegeEin: R[]
  chargen: R[]
  umzuegeAus: R[]
  fuellungen: R[]
  verkauf: R[]
  zukauf: R[]
  behandlungen: R[]
  /** KAN-41 Paket 3a: keller_verarbeitungen (Abgang durch Verarbeitung, AB_VERAR) */
  verarbeitungen: R[]
  verschnAus: R[]
  verschnEin: R[]
  quelleByBatch: Record<string, R[]>
  zielByBatch: Record<string, R[]>
  chargeNamen: Map<string, string>
  /** KAN-77: Quellgebinde je Verschnitt-Quelle (`${verschneidungId}:${quellWeinausbauId}`) */
  quellGebinde: Map<string, Quellgebinde>
}

function fehler(tabelle: string, e: { message?: string } | null): never {
  throw new Error(`Bewegungsbuch: ${tabelle} konnte nicht geladen werden (${e?.message ?? 'unbekannter Fehler'})`)
}

async function liste(query: any, tabelle: string): Promise<R[]> {
  const { data, error } = await alle<R>(query)
  if (error) fehler(tabelle, error)
  return data
}

/** wie liste(), aber für lange .in()-Listen in Blöcken (URL-Grenze ≈ 350 IDs) */
async function listeInBloecken(werte: string[], abfrage: (block: string[]) => any, tabelle: string): Promise<R[]> {
  const { data, error } = await inBloecken<R>(werte, b => alle<R>(abfrage(b)))
  if (error) fehler(tabelle, error)
  return data
}

/** Alle Rohdaten der Bewegungen eines Gebindes laden (nur eigener Betrieb) */
async function ladeRoh(supabase: any, tenantId: string, behaelterId: string): Promise<Roh> {
  const [pressungenAlle, umzuegeEin, chargen, umzuegeVon, behandlungen] = await Promise.all([
    // pressung_behaelter hat keine tenant_id – Mandant über die Pressung (Kellergemeinschaft,
    // Mehrfach-Mitgliedschaft: fremde Pressungen im selben Gebinde nicht mitzählen)
    liste((supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, weinausbau_id, notizen, storniert_am, storno_grund, storniert_von_name, pressung:pressung_id(id, datum, notizen, tenant_id, storniert_am)')
      // storno-sichtbar: das Bewegungsbuch zeigt den Pressungszugang und am Storno-Tag die Gegenbuchung (KAN-148 C1c)
      .eq('behaelter_id', behaelterId)
      .order('id', { ascending: true }), 'pressung_behaelter'),
    liste((supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, nach_weinausbau_id, transaktions_nr, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, jahrgang, behaelter:behaelter_id(name)), notizen, umzug_batch_id, zeilen_typ, storniert_am, storno_grund, storniert_von_name')
      // storno-sichtbar: das Bewegungsbuch zeigt Buchung und Gegenbuchung (KAN-145 B2b)
      .eq('tenant_id', tenantId)
      .eq('nach_behaelter_id', behaelterId)
      .order('datum', { ascending: true })
      .order('id', { ascending: true }), 'keller_umzuege'),
    liste((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, menge_liter, aktiv, ist_eroeffnungsbestand, anfangsbestand_liter, created_at, transaktions_nr, storniert_am, storno_grund, storniert_von_name')
      .eq('tenant_id', tenantId)
      .eq('behaelter_id', behaelterId)
      .order('id', { ascending: true }), 'weinausbau'),
    liste((supabase.from('keller_umzuege') as any)
      .select('id, von_weinausbau_id')
      // storno-sichtbar: das Bewegungsbuch zeigt Buchung und Gegenbuchung (KAN-145 B2b)
      .eq('tenant_id', tenantId)
      .eq('von_behaelter_id', behaelterId)
      .order('id', { ascending: true }), 'keller_umzuege'),
    liste((supabase.from('keller_behandlungen') as any)
      .select('id, datum, menge, einheit, notizen, weinausbau_id, typ_name_snapshot, zugang_liter, typ:typ_id(name), storniert_am, storno_grund, storniert_von_name')
      // storno-sichtbar: stornierte Kellerbehandlungen mit Vermerk (KAN-145 B3)
      .eq('tenant_id', tenantId)
      .eq('behaelter_id', behaelterId)
      .order('datum', { ascending: true })
      .order('id', { ascending: true }), 'keller_behandlungen'),
  ])
  const pressungen = pressungenAlle.filter(p => (p.pressung as R | null)?.tenant_id === tenantId)

  const chargeIds = new Set<string>()
  for (const c of chargen) chargeIds.add(c.id)
  for (const u of umzuegeEin) if (u.nach_weinausbau_id) chargeIds.add(u.nach_weinausbau_id)
  for (const p of pressungen) if (p.weinausbau_id) chargeIds.add(p.weinausbau_id)
  for (const u of umzuegeVon) if (u.von_weinausbau_id) chargeIds.add(u.von_weinausbau_id)
  const ids = Array.from(chargeIds)

  let umzuegeAus: R[] = [], fuellungen: R[] = [], verkauf: R[] = [], zukauf: R[] = [], verschnAus: R[] = [], verschnEin: R[] = []
  let verarbeitungen: R[] = []
  if (ids.length > 0) {
    ;[umzuegeAus, fuellungen, verkauf, zukauf, verschnAus, verschnEin, verarbeitungen] = await Promise.all([
      liste((supabase.from('keller_umzuege') as any)
        .select('id, datum, menge_liter, brutto_liter, schwund_liter, zeilen_typ, umzug_typ, transaktions_nr, nach_behaelter:nach_behaelter_id(name), von_weinausbau_id, von_weinausbau:von_weinausbau_id(name), notizen, umzug_batch_id, storniert_am, storno_grund, storniert_von_name')
        // storno-sichtbar: das Bewegungsbuch zeigt Buchung und Gegenbuchung (KAN-145 B2b)
        .eq('tenant_id', tenantId)
        .in('von_weinausbau_id', ids)
        .order('datum', { ascending: true })
        .order('id', { ascending: true }), 'keller_umzuege'),
      liste((supabase.from('fuellungen') as any)
        .select('id, datum, name, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, pruefnummer, chargennummer, weinausbau_id, storniert_am, storno_grund, storniert_von_name')
        .eq('tenant_id', tenantId)
        .in('weinausbau_id', ids)
        .or('aktiv.eq.true,storniert_am.not.is.null')   // KAN-145 B3: stornierte Füllung als Buchung + Gegenbuchung
        .order('datum', { ascending: true })
        .order('id', { ascending: true }), 'fuellungen'),
      liste((supabase.from('verkauf_positionen') as any)
        .select('id, menge, einheit, weinausbau_id, verkaufsposten:verkaufsposten_id(datum, storniert, storniert_am, storno_grund, storniert_von_name, rechnungsnummer, partner_daten, kontakt:kontakt_id(vorname, nachname), firma:firma_id(name))')
        .eq('tenant_id', tenantId)
        .in('weinausbau_id', ids)
        .eq('typ', 'tank')
        .order('id', { ascending: true }), 'verkauf_positionen'),
      // Zukauf-Eingang (Wein/Most direkt in eine Charge dieses Gebindes) – rechnet
      // v_behaelter_fuellstand (Migration 127) ebenfalls mit
      liste((supabase.from('zukauf_posten') as any)
        .select('id, datum, menge, ziel_weinausbau_id, rebsorte, jahrgang, eingangsrechnungsnummer, staatliche_pruefnummer, partner_daten, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
        .eq('tenant_id', tenantId)
        .in('ziel_weinausbau_id', ids)
        .eq('aktiv', true)
        .in('art', ['wein', 'most'])
        .order('datum', { ascending: true })
        .order('id', { ascending: true }), 'zukauf_posten'),
      // verschneidung_quellen hat keine tenant_id – Mandant über die Verschneidung
      liste((supabase.from('verschneidung_quellen') as any)
        .select('id, menge_liter, quell_weinausbau_id, verschneidung:verschneidung_id(datum, notizen, tenant_id, storniert_am, storno_grund, storniert_von_name, ziel:ziel_weinausbau_id(name, behaelter:behaelter_id(name)))')
        .in('quell_weinausbau_id', ids)
        .order('id', { ascending: true }), 'verschneidung_quellen'),
      liste((supabase.from('verschneidungen') as any)
        .select('id, datum, notizen, ziel_weinausbau_id, storniert_am, storno_grund, storniert_von_name, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter, quell_behaelter_id, gebinde_rekonstruiert, quell_behaelter:quell_behaelter_id(name), quelle:quell_weinausbau_id(name, behaelter:behaelter_id(name)))')
        // storno-sichtbar: das Bewegungsbuch zeigt Buchung und Gegenbuchung (KAN-145 B2b)
        .eq('tenant_id', tenantId)
        .in('ziel_weinausbau_id', ids)
        .order('datum', { ascending: true })
        .order('id', { ascending: true }), 'verschneidungen'),
      // KAN-41 Paket 3a: Verarbeitung (Abgang), storno-sichtbar: Buchung und Gegenbuchung
      liste((supabase.from('keller_verarbeitungen') as any)
        .select('id, datum, erstellt_am, menge_liter, zweck, notizen, weinausbau_id, storniert_am, storno_grund, storniert_von_name')
        .eq('tenant_id', tenantId)
        .in('weinausbau_id', ids)
        .order('datum', { ascending: true })
        .order('id', { ascending: true }), 'keller_verarbeitungen'),
    ])
    verschnAus = verschnAus.filter(v => (v.verschneidung as R | null)?.tenant_id === tenantId)
  }

  const einZielBatchIds = [...new Set(umzuegeEin.filter(u => u.zeilen_typ === 'ziel' && u.umzug_batch_id).map(u => u.umzug_batch_id as string))]
  const ausQuelleBatchIds = [...new Set(umzuegeAus.filter(u => u.zeilen_typ === 'quelle' && u.umzug_batch_id).map(u => u.umzug_batch_id as string))]
  const quelleByBatch: Record<string, R[]> = {}
  const zielByBatch: Record<string, R[]> = {}
  const [quelleRows, zielRows] = await Promise.all([
    einZielBatchIds.length > 0
      ? listeInBloecken(einZielBatchIds, b => (supabase.from('keller_umzuege') as any)
          .select('id, umzug_batch_id, von_behaelter:von_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, behaelter:behaelter_id(name))')
          // storno-sichtbar: nur Namen der Gegenseite (die Zeilen einer Buchung sind gemeinsam storniert)
          .eq('tenant_id', tenantId)
          .in('umzug_batch_id', b)
          .eq('zeilen_typ', 'quelle')
          .order('id', { ascending: true }), 'keller_umzuege')
      : Promise.resolve([] as R[]),
    ausQuelleBatchIds.length > 0
      ? listeInBloecken(ausQuelleBatchIds, b => (supabase.from('keller_umzuege') as any)
          .select('id, umzug_batch_id, nach_behaelter:nach_behaelter_id(name), nach_weinausbau:nach_weinausbau_id(name), menge_liter')
          // storno-sichtbar: nur Namen der Gegenseite (die Zeilen einer Buchung sind gemeinsam storniert)
          .eq('tenant_id', tenantId)
          .in('umzug_batch_id', b)
          .eq('zeilen_typ', 'ziel')
          .order('id', { ascending: true }), 'keller_umzuege')
      : Promise.resolve([] as R[]),
  ])
  for (const q of quelleRows) (quelleByBatch[q.umzug_batch_id] ??= []).push(q)
  for (const z of zielRows) (zielByBatch[z.umzug_batch_id] ??= []).push(z)

  // Chargennamen: aus dem Gebinde bzw. den eingebetteten Datensätzen, der Rest per Nachladen
  const chargeNamen = new Map<string, string>()
  for (const c of chargen) if (c.name) chargeNamen.set(c.id, c.name)
  for (const u of umzuegeAus) if (u.von_weinausbau_id && (u.von_weinausbau as R | null)?.name) chargeNamen.set(u.von_weinausbau_id, u.von_weinausbau.name)
  const fehlend = ids.filter(id => !chargeNamen.has(id))
  if (fehlend.length > 0) {
    const namen = await liste((supabase.from('weinausbau') as any)
      .select('id, name')
      .eq('tenant_id', tenantId)
      .in('id', fehlend)
      .order('id', { ascending: true }), 'weinausbau')
    for (const n of namen) if (n.name) chargeNamen.set(n.id, n.name)
  }

  // KAN-77: Quellgebinde der Verschnitte in Chargen dieses Gebindes
  const quellGebinde = verschnEin.length > 0
    ? await quellGebindeDesVerschnitts(supabase, tenantId, verschnEin.map(verschnittGebinde))
    : new Map<string, Quellgebinde>()

  return { pressungen, umzuegeEin, chargen, umzuegeAus, fuellungen, verkauf, zukauf, behandlungen, verarbeitungen, verschnAus, verschnEin, quelleByBatch, zielByBatch, chargeNamen, quellGebinde }
}

/** Verschnitt-Zeile → Eingabe für das Quellgebinde (KAN-77) */
function verschnittGebinde(v: R): VerschnittGebinde {
  return {
    id: v.id, datum: v.datum ?? null, ziel_weinausbau_id: v.ziel_weinausbau_id ?? null,
    // KAN-112: Momentaufnahme des Gebindes am Verschnitt (Vorrang vor der Regel)
    quellen: ((v.quellen ?? []) as R[]).map(q => ({ quell_weinausbau_id: q.quell_weinausbau_id ?? null, quell_behaelter_id: q.quell_behaelter_id ?? null, gebinde_rekonstruiert: q.gebinde_rekonstruiert ?? null })),
  }
}

const liter = (n: number) => runden(n, STELLEN.liter)

function personName(k: R | null | undefined): string | null {
  if (!k) return null
  return text([k.vorname, k.nachname].filter(Boolean).join(' '))
}

/** Bewegungen aus den Rohdaten – dieselbe Logik wie bisher auf der Bewegungsbuch-Seite */
function bewegungenAus(roh: Roh): Bewegung[] {
  const name = (id: string | null | undefined) => (id ? roh.chargeNamen.get(id) ?? null : null)
  const bewegungen: Bewegung[] = []

  // je Eröffnungsbestands-Charge eine Zeile (KAN-43: die Sammel-Variante enthält alle Chargen des Betriebs)
  for (const eroeffnungsCharge of roh.chargen.filter(c => c.ist_eroeffnungsbestand)) {
    const l = num(eroeffnungsCharge.anfangsbestand_liter) || num(eroeffnungsCharge.menge_liter)
    if (l > 0) {
      bewegungen.push({
        // KAN-42: Stichtag des Eröffnungsbestands = Wiener Kalendertag von created_at (bis KAN-42 immer der 01.01.)
        datum: eroeffnungsTag(eroeffnungsCharge.created_at) ?? tag(new Date()),
        art: 'anfangsbestand',
        beschreibung: `Anfangsbestand${eroeffnungsCharge.jahrgang ? ` ${eroeffnungsCharge.jahrgang}` : ''}`,
        menge: liter(l),
        chargeId: eroeffnungsCharge.id,
        charge: text(eroeffnungsCharge.name),
        gegenstelle: 'Eröffnungsbestand (Altsystem)',
        beleg: text(eroeffnungsCharge.transaktions_nr),
        quelleId: eroeffnungsCharge.id,
        ...stornoFeld(eroeffnungsCharge),   // KAN-145 B3: stornierter Eröffnungsbestand – Gegenbuchung am Storno-Tag
      })
    }
  }

  for (const z of roh.zukauf) {
    const l = num(z.menge)
    if (l <= 0) continue
    const sorte = [z.rebsorte ? formatRebsorteMitKuerzel(z.rebsorte) : null, z.jahrgang].filter(Boolean).join(' ')
    bewegungen.push({
      datum: tag(z.datum),
      art: 'zukauf',
      beschreibung: `Zukauf${sorte ? `: ${sorte}` : ''}`,
      menge: liter(l),
      chargeId: z.ziel_weinausbau_id ?? null,
      charge: name(z.ziel_weinausbau_id),
      gegenstelle: text((momentaufnahmeAnwenden(z, ['lieferant_firma', 'lieferant_kontakt']).lieferant_firma as R | null)?.name) ?? personName(z.lieferant_kontakt as R | null),
      beleg: text(z.eingangsrechnungsnummer) ?? text(z.staatliche_pruefnummer),
      quelleId: z.id,
    })
  }

  for (const p of roh.pressungen) {
    const l = num(p.menge_liter)
    if (l <= 0) continue
    const press = p.pressung as R | null
    bewegungen.push({
      datum: tag(press?.datum),
      art: 'pressung',
      beschreibung: `Ernte / Pressung${press?.notizen ? ` – ${press.notizen}` : ''}`,
      menge: liter(l),
      extra: p.notizen ?? undefined,
      chargeId: p.weinausbau_id ?? null,
      charge: name(p.weinausbau_id),
      gegenstelle: 'Pressung',
      beleg: null,
      quelleId: p.id,
      ...stornoFeld(p),   // KAN-148 C1c: stornierte Pressung – Gegenbuchung am Storno-Tag
    })
  }

  for (const u of roh.umzuegeEin) {
    const rohmenge = num(u.menge_liter)
    const schwund = num(u.schwund_liter)
    const l = u.brutto_liter != null ? rohmenge : Math.max(0, rohmenge - schwund)
    if (l <= 0) continue

    let von: string
    if (u.zeilen_typ === 'ziel' && u.umzug_batch_id && roh.quelleByBatch[u.umzug_batch_id]) {
      von = roh.quelleByBatch[u.umzug_batch_id].map((q: R) => {
        const wa = q.von_weinausbau as R | null
        const tank = (wa?.behaelter as R | null)?.name ?? (q.von_behaelter as R | null)?.name ?? null
        if (tank && wa?.name) return `${tank} (${wa.name})`
        return tank ?? wa?.name ?? '?'
      }).join(', ') || '?'
    } else {
      const vonCharge = u.von_weinausbau as R | null
      const vonTank = (vonCharge?.behaelter as R | null)?.name ?? (u.von_behaelter as R | null)?.name ?? null
      const vonName = vonCharge?.name ?? '?'
      von = vonTank ? `${vonTank} (${vonName})` : vonName
    }

    const filtration = u.umzug_typ === 'filtration'
    bewegungen.push({
      datum: tag(u.datum),
      art: filtration ? 'filtration_ein' : 'umzug_ein',
      beschreibung: filtration ? `Filtration von ${von}` : `Zugang von ${von}`,
      menge: liter(l),
      extra: schwund > 0 ? `Schwund: ${fmtNum(schwund)} L${u.notizen ? ` · ${u.notizen}` : ''}` : (u.notizen ?? undefined),
      chargeId: u.nach_weinausbau_id ?? null,
      charge: name(u.nach_weinausbau_id),
      gegenstelle: von,
      beleg: text(u.transaktions_nr),
      quelleId: u.id,
      ...stornoFeld(u),
    })
  }

  for (const u of roh.umzuegeAus) {
    const netto = num(u.menge_liter)
    const abgang = u.zeilen_typ === 'quelle' ? netto : (num(u.brutto_liter) || netto)
    if (abgang <= 0) continue

    let nach: string
    let schwund = num(u.schwund_liter)
    if (u.zeilen_typ === 'quelle' && u.umzug_batch_id && roh.zielByBatch[u.umzug_batch_id]) {
      const ziele = roh.zielByBatch[u.umzug_batch_id]
      nach = ziele.map((z: R) => (z.nach_behaelter as R | null)?.name ?? (z.nach_weinausbau as R | null)?.name ?? '?').join(', ') || '?'
      const sumNetto = ziele.reduce((s: number, z: R) => s + num(z.menge_liter), 0)
      schwund = Math.max(0, abgang - sumNetto)
    } else {
      nach = (u.nach_behaelter as R | null)?.name ?? '?'
    }

    const vonCharge = u.von_weinausbau as R | null
    const filtration = u.umzug_typ === 'filtration'
    const istSchwund = u.umzug_typ === 'schwund'
    const schwundText = schwund > 0.01 ? ` · Schwund: ${fmtNum(schwund)} L` : ''
    bewegungen.push({
      datum: tag(u.datum),
      art: istSchwund ? 'schwund' : filtration ? 'filtration_aus' : 'umzug_aus',
      beschreibung: istSchwund
        // KAN-112: Schwund beim Verschnitt (eigene Schwundbuchung der Quelle, Vermerk der RPC s112_verschnitt_buchen)
        ? `${String(u.notizen ?? '').startsWith('Schwund beim Verschnitt') ? 'Schwund beim Verschnitt' : 'Schwund / Verlust'}${vonCharge?.name ? ` (${vonCharge.name})` : ''}`
        : filtration ? `Filtration nach ${nach}${schwundText}` : `Umzug nach ${nach}${schwundText}`,
      menge: -liter(abgang),
      extra: istSchwund
        ? (u.notizen ?? undefined)
        : vonCharge?.name ? `aus Charge: ${vonCharge.name}${u.notizen ? ` · ${u.notizen}` : ''}` : (u.notizen ?? undefined),
      chargeId: u.von_weinausbau_id ?? null,
      charge: text(vonCharge?.name) ?? name(u.von_weinausbau_id),
      gegenstelle: istSchwund ? null : nach,
      beleg: text(u.transaktions_nr),
      quelleId: u.id,
      ...stornoFeld(u),
    })
  }

  for (const f of roh.fuellungen) {
    const l = num(f.menge_liter_gefuellt) || (num(f.anzahl_flaschen) * num(f.flaschengroesse_ml) / 1000)
    if (!l || l <= 0) continue
    if (istFlaschenEroeffnung(f)) {
      // KAN-42: Flaschen-Eröffnungsbestand – Zugang ins Flaschenlager am Stichtag, kein Abgang aus einem Tank
      bewegungen.push({
        datum: tag(f.datum),
        art: 'anfangsbestand',
        beschreibung: `Eröffnungsbestand Flaschen: ${f.name}${f.pruefnummer ? ` · Prüfnr. ${f.pruefnummer}` : ''}`,
        menge: 0,
        extra: num(f.anzahl_flaschen) > 0 ? `${fmtNum(Math.trunc(num(f.anzahl_flaschen)))} Fl. à ${Math.trunc(num(f.flaschengroesse_ml))} ml` : undefined,
        fuellung_id: f.id,
        chargeId: null,
        charge: null,
        gegenstelle: 'Eröffnungsbestand (Altsystem)',
        beleg: text(f.pruefnummer) ?? text(f.chargennummer),
        quelleId: f.id,
        ...stornoFeld(f),
      })
      continue
    }
    if (!f.weinausbau_id && f.zukauf_posten_id) {
      // KAN-41 Paket 2b: Flaschenzukauf (Handelsware) – Zugang ins Flaschenlager, kein Abgang aus einem Tank
      bewegungen.push({
        datum: tag(f.datum),
        art: 'zukauf',
        beschreibung: `Zukauf Flaschen (Handelsware): ${f.name}${f.pruefnummer ? ` · Prüfnr. ${f.pruefnummer}` : ''}`,
        menge: 0,
        extra: num(f.anzahl_flaschen) > 0 ? `${fmtNum(Math.trunc(num(f.anzahl_flaschen)))} Fl. à ${Math.trunc(num(f.flaschengroesse_ml))} ml` : undefined,
        fuellung_id: f.id,
        chargeId: null,
        charge: null,
        gegenstelle: 'Flaschenzukauf',
        beleg: text(f.pruefnummer) ?? text(f.chargennummer),
        quelleId: f.id,
        ...stornoFeld(f),
      })
      continue
    }
    bewegungen.push({
      datum: tag(f.datum),
      art: 'abfuellung',
      beschreibung: `Abfüllung: ${f.name}${f.pruefnummer ? ` · Prüfnr. ${f.pruefnummer}` : ''}`,
      menge: -liter(l),
      extra: num(f.anzahl_flaschen) > 0 ? `${fmtNum(Math.trunc(num(f.anzahl_flaschen)))} Fl. à ${Math.trunc(num(f.flaschengroesse_ml))} ml` : undefined,
      fuellung_id: f.id,
      chargeId: f.weinausbau_id ?? null,
      charge: name(f.weinausbau_id),
      gegenstelle: text(f.name),
      beleg: text(f.pruefnummer) ?? text(f.chargennummer),
      quelleId: f.id,
      ...stornoFeld(f),
    })
  }

  for (const v of roh.verkauf) {
    const vp = v.verkaufsposten as R | null
    // KAN-149 D1: ein stornierter Verkauf bleibt am Verkaufstag stehen und bekommt am Storno-Tag die Gegenbuchung
    // (wie Umzug, Verschnitt, Füllung, KAN-145) – nur Alt-Stornos ohne Zeitpunkt entfallen wie bisher
    if (vp?.storniert && !vp.storniert_am) continue
    const l = num(v.menge)
    if (l <= 0) continue
    bewegungen.push({
      datum: tag(vp?.datum),
      art: 'verkauf',
      beschreibung: 'Tank-Verkauf',
      menge: -liter(l),
      chargeId: v.weinausbau_id ?? null,
      charge: name(v.weinausbau_id),
      gegenstelle: text((momentaufnahmeAnwenden(vp, ['kontakt', 'firma'])?.firma as R | null)?.name) ?? personName(vp?.kontakt as R | null),
      beleg: text(vp?.rechnungsnummer),
      quelleId: v.id,
      ...(vp?.storniert ? stornoFeld(vp) : {}),
    })
  }

  for (const b of roh.behandlungen) {
    if (!b.datum) continue
    const typName = (b.typ as R | null)?.name ?? b.typ_name_snapshot ?? 'Behandlung'
    const mengeStr = b.menge && b.einheit ? `${fmtNum(num(b.menge))} ${b.einheit}` : null
    bewegungen.push({
      datum: tag(b.datum),
      art: 'behandlung',
      beschreibung: typName,
      // KAN-41 Paket 3b: Volumenzugang durch die Behandlung (ZU_BEH), sonst Menge 0
      menge: num(b.zugang_liter) > 0 ? liter(num(b.zugang_liter)) : 0,
      extra: [mengeStr, b.notizen].filter(Boolean).join(' · ') || undefined,
      chargeId: b.weinausbau_id ?? null,
      charge: name(b.weinausbau_id),
      gegenstelle: null,
      beleg: null,
      ...stornoFeld(b),
    })
  }

  for (const v of roh.verarbeitungen) {
    if (!v.datum) continue
    const zweck = VERARBEITUNG_ZWECK_LABEL[v.zweck as VerarbeitungZweck] ?? text(v.zweck) ?? 'Sonstiges'
    bewegungen.push({
      datum: tag(v.datum),
      art: 'verarbeitung',
      beschreibung: `Verarbeitung zu ${zweck}`,
      menge: -liter(num(v.menge_liter)),
      extra: text(v.notizen) ?? undefined,
      chargeId: v.weinausbau_id ?? null,
      charge: name(v.weinausbau_id),
      gegenstelle: zweck,
      beleg: null,
      quelleId: v.id,
      ...stornoFeld(v),
    })
  }

  for (const vq of roh.verschnAus) {
    const l = num(vq.menge_liter)
    if (l <= 0) continue
    const v = vq.verschneidung as R | null
    const ziel = v?.ziel as R | null
    const zielName = ziel?.name ?? '?'
    const zielBeh = (ziel?.behaelter as R | null)?.name ?? null
    bewegungen.push({
      datum: tag(v?.datum),
      art: 'verschneidung_aus',
      beschreibung: `Verschneidung nach ${zielName}`,
      menge: -liter(l),
      extra: zielBeh ?? undefined,
      chargeId: vq.quell_weinausbau_id ?? null,
      charge: name(vq.quell_weinausbau_id),
      gegenstelle: zielBeh ? `${zielBeh} (${zielName})` : zielName,
      beleg: null,
      quelleId: vq.id,
      ...stornoFeld(vq),
    })
  }

  for (const v of roh.verschnEin) {
    const quellen = (v.quellen as R[]) ?? []
    const gesamt = quellen.reduce((s: number, q: R) => s + num(q.menge_liter), 0)
    if (gesamt <= 0) continue
    const quellenNamen = quellen.map((q: R) => {
      // KAN-77: Gebinde am Tag des Verschnitts; ohne Treffer (Charge ohne Gebinde) wie bisher das heutige
      const g = q.quell_weinausbau_id ? roh.quellGebinde.get(quellGebindeSchluessel(v.id, q.quell_weinausbau_id)) : undefined
      const beh = g?.name ?? ((q.quelle as R | null)?.behaelter as R | null)?.name ?? null
      const n = (q.quelle as R | null)?.name ?? '?'
      // KAN-112: nachträglich ermitteltes Gebinde mit Hinweis
      return beh ? `${beh} (${n}${g?.name && g.rekonstruiert ? `, ${GEBINDE_REKONSTRUIERT}` : ''})` : n
    }).join(', ')
    bewegungen.push({
      datum: tag(v.datum),
      art: 'verschneidung_ein',
      beschreibung: `Verschneidung von ${quellenNamen}`,
      menge: liter(gesamt),
      chargeId: v.ziel_weinausbau_id ?? null,
      charge: name(v.ziel_weinausbau_id),
      gegenstelle: quellenNamen,
      beleg: null,
      quelleId: v.id,
      ...stornoFeld(v),
    })
  }

  // KAN-145: Gegenbuchung am Storno-Tag (umgekehrte Menge) – die Buchung selbst bleibt an ihrem Tag stehen
  for (const b of [...bewegungen]) {
    if (!b.storno || b.menge === 0) continue   // ohne Menge (Kellerbehandlung) genügt der Vermerk
    bewegungen.push({
      ...b,
      datum: b.storno.am,
      beschreibung: `Storno: ${b.beschreibung}`,
      menge: b.menge === 0 ? 0 : -b.menge,
      extra: [b.storno.grund ? `Grund: ${b.storno.grund}` : null, b.storno.von ? `storniert von ${b.storno.von}` : null].filter(Boolean).join(' · ') || undefined,
      storno: undefined,
      gegenbuchungZu: b.datum,
    })
  }

  // Stabil nach Datum (innerhalb eines Tages die Reihenfolge oben – wie bisher; Gegenbuchungen danach)
  bewegungen.sort((a, b) => a.datum.localeCompare(b.datum))
  return bewegungen
}

/** Storno-Angaben einer Zeile als Bewegungsfeld (Kalendertag in Wien) */
function stornoFeld(z: R): Pick<Bewegung, 'storno'> {
  const s = stornoAngaben(z)
  return s ? { storno: { am: tag(s.am), grund: s.grund, von: s.von } } : {}
}

/** Bewegungen ohne stornierte Buchungen und ohne deren Gegenbuchungen (Belegung, Bestand je Charge) */
export function ohneStornoPaare(bewegungen: readonly Bewegung[]): Bewegung[] {
  return bewegungen.filter(b => !b.storno && !b.gegenbuchungZu)
}

/** Laufenden Saldo anfügen – Summe der gerundeten Mengen */
export function mitSaldo(bewegungen: readonly Bewegung[]): BewegungMitSaldo[] {
  let saldo = 0
  return bewegungen.map(b => {
    saldo = runden(saldo + b.menge, STELLEN.liter)
    return { ...b, saldo }
  })
}

/** Ausschnitt für einen Zeitraum: Bewegungen vor „von“ werden zur Übertrag-Zeile (Saldo vor dem Zeitraum).
 *  Bewegungen ohne Datum stecken im laufenden Saldo: mit „von“ im Übertrag, ohne „von“ (nur „bis“)
 *  am Anfang des Ausschnitts – sonst ginge Σ Zugang − Σ Abgang nicht im ausgewiesenen Saldo auf. */
export function imZeitraumMitUebertrag(bewegungen: readonly BewegungMitSaldo[], z: Zeitraum): BewegungMitSaldo[] {
  if (!z.von && !z.bis) return [...bewegungen]
  const vorher = z.von ? bewegungen.filter(b => !b.datum || b.datum < z.von!) : []
  const drin = bewegungen.filter(b => (b.datum ? imZeitraum(b.datum, z.von, z.bis) : !z.von))
  if (!z.von || vorher.length === 0) return drin
  const saldo = vorher[vorher.length - 1].saldo
  const [j, m, t] = [z.von.slice(0, 4), z.von.slice(5, 7), z.von.slice(8, 10)]
  return [{
    datum: z.von,
    art: 'uebertrag',
    beschreibung: `Übertrag – Saldo vor dem ${t}.${m}.${j}`,
    menge: 0,
    chargeId: null,
    charge: null,
    gegenstelle: null,
    beleg: null,
    saldo,
  }, ...drin]
}

/** Belegung einer Charge im Gebinde: erster und letzter Tag mit Mengenbewegung (bis = null: liegt noch darin) */
export type Belegung = { chargeId: string; charge: string | null; von: string; bis: string | null }

/** Wann lag welche Charge im Gebinde? Aus den Mengenbewegungen; aktive Chargen im Gebinde bleiben offen. */
export function belegungszeitraeume(bewegungen: readonly Bewegung[], chargenImGebinde: readonly R[]): Belegung[] {
  const offen = new Set(chargenImGebinde.filter(c => c.aktiv).map(c => c.id as string))
  const m = new Map<string, Belegung>()
  for (const b of bewegungen) {
    if (!b.chargeId || !b.datum || b.menge === 0) continue
    const e = m.get(b.chargeId)
    if (!e) m.set(b.chargeId, { chargeId: b.chargeId, charge: b.charge, von: b.datum, bis: b.datum })
    else {
      if (b.datum < e.von) e.von = b.datum
      if (e.bis !== null && b.datum > e.bis) e.bis = b.datum
    }
  }
  for (const e of m.values()) if (offen.has(e.chargeId)) e.bis = null
  return [...m.values()]
}

/** Charge, die am Tag im Gebinde lag – nur wenn eindeutig, sonst null bzw. 'mehrdeutig' */
export function chargeAmTag(belegungen: readonly Belegung[], datum: string): Belegung | 'mehrdeutig' | null {
  if (!datum) return null
  const treffer = belegungen.filter(b => datum >= b.von && (b.bis === null || datum <= b.bis))
  if (treffer.length === 1) return treffer[0]
  return treffer.length > 1 ? 'mehrdeutig' : null
}

// ── Sammel-Variante: alle Bewegungen des Betriebs (KAN-43, Stichtagsbestand) ──────────────
//
// Dieselben Tabellen wie ladeRoh, aber einmal für den ganzen Betrieb statt je Gebinde (kein N+1).
// bewegungenAus() macht daraus dieselben Bewegungen wie im Bewegungsbuch – jede Buchung genau einmal
// mit ihrer Charge (chargeId): ein Umzug als Abgang der Quell- und Zugang der Ziel-Charge. Kellerbehandlungen
// (Menge 0) fehlen bewusst. fuellungen kommen ALLE (auch ohne Charge und deaktivierte) zurück – die
// Weinbestandsmeldung braucht sie für den Flaschenbestand; in die Bewegungen gehen nur die wie in ladeRoh.

export type BetriebsBewegungen = {
  bewegungen: Bewegung[]
  /** KAN-43 Etappe 2 (BSM): Quellzeilen der Bewegungen, über Bewegung.quelleId auffindbar */
  quellen: {
    umzuege: R[]
    zukauf: R[]
    verkauf: R[]
    verschneidungen: R[]
    verschneidungQuellen: R[]
    /** pressung_behaelter (mit pressung.id) – BSM-Nachtrag 02.10.2026: Anteil zugekaufter Trauben je Pressung */
    pressungen: R[]
  }
  /** alle Chargen des Betriebs (weinausbau), mit Stammdaten für die Bestandsmeldung */
  chargen: R[]
  /** alle Füllungen des Betriebs, mit Stammdaten für die Bestandsmeldung */
  fuellungen: R[]
}

export async function ladeBewegungenBetrieb(supabase: any, tenantId: string): Promise<BetriebsBewegungen> {
  const [chargen, umzuege, pressungen, fuellungenAlle, verkauf, zukauf, verschnAus, verschnEin, verarbeitungen, behandlungenZugang] = await Promise.all([
    liste((supabase.from('weinausbau') as any)
      .select('id, name, jahrgang, rebsorte, qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, weinart, menge_liter, status, aktiv, ist_eroeffnungsbestand, anfangsbestand_liter, created_at, transaktions_nr, storniert_am, storno_grund, storniert_von_name, behaelter_id, behaelter:behaelter_id(name)')
      .eq('tenant_id', tenantId)
      .order('id', { ascending: true }), 'weinausbau'),
    liste((supabase.from('keller_umzuege') as any)
      .select('id, datum, erstellt_am, menge_liter, brutto_liter, schwund_liter, umzug_typ, zeilen_typ, umzug_batch_id, transaktions_nr, notizen, storniert_am, storno_grund, storniert_von_name, qualitaet_vorher, qualitaet_nachher, zusatz_vorher, zusatz_nachher, erzeugnis_vorher, erzeugnis_nachher, von_behaelter_id, nach_behaelter_id, von_weinausbau_id, nach_weinausbau_id, von_behaelter:von_behaelter_id(name), nach_behaelter:nach_behaelter_id(name), von_weinausbau:von_weinausbau_id(name, jahrgang, behaelter:behaelter_id(name)), nach_weinausbau:nach_weinausbau_id(name)')
      // storno-sichtbar: Buchung und Gegenbuchung wie im Bewegungsbuch (KAN-145 B2b)
      .eq('tenant_id', tenantId)
      .order('datum', { ascending: true })
      .order('id', { ascending: true }), 'keller_umzuege'),
    // tenant-isolation-ignore: pressung_behaelter ohne tenant_id, Filter über die Pressung (!inner)
    liste((supabase.from('pressung_behaelter') as any)
      .select('id, menge_liter, weinausbau_id, behaelter_id, notizen, storniert_am, storno_grund, storniert_von_name, pressung:pressung_id!inner(id, datum, notizen, tenant_id, storniert_am)')
      // storno-sichtbar: Pressungszugang und Gegenbuchung am Storno-Tag (KAN-148 C1c)
      .eq('pressung.tenant_id', tenantId)
      .order('id', { ascending: true }), 'pressung_behaelter'),
    liste((supabase.from('fuellungen') as any)
      .select('id, datum, erstellt_am, name, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis, land_iso, aktiv, bestand_flaschen, anzahl_flaschen, menge_liter_gefuellt, flaschengroesse_ml, pruefnummer, chargennummer, weinausbau_id, storniert_am, storno_grund, storniert_von_name, import_quelle, weinart, zukauf_posten_id, weinausbau:weinausbau_id(weinart)')
      // storno-sichtbar: stornierte Füllung als Buchung + Gegenbuchung (KAN-145 B3), Flaschenbestand zum Stichtag
      .eq('tenant_id', tenantId)
      .order('name', { ascending: true })
      .order('id', { ascending: true }), 'fuellungen'),
    liste((supabase.from('verkauf_positionen') as any)
      .select('id, menge, einheit, weinausbau_id, verkaufsposten_id, verkaufsposten:verkaufsposten_id(datum, storniert, storniert_am, storno_grund, storniert_von_name, rechnungsnummer, partner_daten, kontakt:kontakt_id(vorname, nachname), firma:firma_id(name))')
      .eq('tenant_id', tenantId)
      .eq('typ', 'tank')
      .not('weinausbau_id', 'is', null)
      .order('id', { ascending: true }), 'verkauf_positionen'),
    liste((supabase.from('zukauf_posten') as any)
      .select('id, datum, art, einheit, menge, ziel_weinausbau_id, rebsorte, jahrgang, weinart, qualitaetsstufe, zusatzbezeichnung, erzeugnis, land_iso, eingangsrechnungsnummer, staatliche_pruefnummer, partner_daten, lieferant_firma:firmen!lieferant_firma_id(name), lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname)')
      .eq('tenant_id', tenantId)
      .not('ziel_weinausbau_id', 'is', null)
      .eq('aktiv', true)
      .in('art', ['wein', 'most'])
      .order('datum', { ascending: true })
      .order('id', { ascending: true }), 'zukauf_posten'),
    // tenant-isolation-ignore: verschneidung_quellen ohne tenant_id – Mandant über die Verschneidung, im Code gefiltert
    // (wie ladeRoh; stornierte Verschnitte bleiben sichtbar, bewegungenAus bucht sie per stornoFeld/istStorniert-Logik)
    liste((supabase.from('verschneidung_quellen') as any)
      .select('id, menge_liter, quell_weinausbau_id, verschneidung:verschneidung_id(datum, notizen, tenant_id, storniert_am, storno_grund, storniert_von_name, ziel:ziel_weinausbau_id(name, behaelter:behaelter_id(name)))')
      .order('id', { ascending: true }), 'verschneidung_quellen'),
    liste((supabase.from('verschneidungen') as any)
      .select('id, datum, notizen, ziel_weinausbau_id, storniert_am, storno_grund, storniert_von_name, ziel_qualitaet_vorher, ziel_zusatz_vorher, ziel_erzeugnis_vorher, ziel_rebsorte_vorher, ziel_jahrgang_vorher, quellen:verschneidung_quellen(quell_weinausbau_id, menge_liter, quell_behaelter_id, gebinde_rekonstruiert, quell_behaelter:quell_behaelter_id(name), quelle:quell_weinausbau_id(name, behaelter:behaelter_id(name)))')
      // storno-sichtbar: Buchung und Gegenbuchung wie im Bewegungsbuch (KAN-145 B2b)
      .eq('tenant_id', tenantId)
      .not('ziel_weinausbau_id', 'is', null)
      .order('datum', { ascending: true })
      .order('id', { ascending: true }), 'verschneidungen'),
    // KAN-41 Paket 3a: Verarbeitung (AB_VERAR); storno-sichtbar: Buchung und Gegenbuchung wie im Bewegungsbuch
    liste((supabase.from('keller_verarbeitungen') as any)
      .select('id, datum, erstellt_am, menge_liter, zweck, notizen, weinausbau_id, storniert_am, storno_grund, storniert_von_name')
      .eq('tenant_id', tenantId)
      .order('datum', { ascending: true })
      .order('id', { ascending: true }), 'keller_verarbeitungen'),
    // KAN-41 Paket 3b: Behandlungen mit Volumenzugang (ZU_BEH); storno-sichtbar: Buchung und Gegenbuchung
    liste((supabase.from('keller_behandlungen') as any)
      .select('id, datum, menge, einheit, notizen, weinausbau_id, typ_name_snapshot, zugang_liter, typ:typ_id(name), storniert_am, storno_grund, storniert_von_name')
      .eq('tenant_id', tenantId)
      .not('zugang_liter', 'is', null)
      .order('datum', { ascending: true })
      .order('id', { ascending: true }), 'keller_behandlungen'),
  ])

  // Zuordnung wie in ladeRoh: Zugänge über nach_behaelter_id, Abgänge über die Quell-Charge
  const umzuegeEin = umzuege.filter(u => u.nach_behaelter_id)
  const umzuegeAus = umzuege.filter(u => u.von_weinausbau_id)
  const quelleByBatch: Record<string, R[]> = {}
  const zielByBatch: Record<string, R[]> = {}
  for (const u of umzuege) {
    if (!u.umzug_batch_id) continue
    if (u.zeilen_typ === 'quelle') (quelleByBatch[u.umzug_batch_id] ??= []).push(u)
    else if (u.zeilen_typ === 'ziel') (zielByBatch[u.umzug_batch_id] ??= []).push(u)
  }
  const chargeNamen = new Map<string, string>()
  for (const c of chargen) if (c.name) chargeNamen.set(c.id, c.name)

  const roh: Roh = {
    pressungen,
    umzuegeEin,
    chargen,
    umzuegeAus,
    fuellungen: fuellungenAlle.filter(f => f.weinausbau_id && (f.aktiv || f.storniert_am)),
    verkauf,
    zukauf,
    // KAN-41 Paket 3b: nur Behandlungen mit Volumenzugang (ZU_BEH) – die übrigen haben keine Menge
    behandlungen: behandlungenZugang,
    verarbeitungen,
    verschnAus: verschnAus.filter(v => (v.verschneidung as R | null)?.tenant_id === tenantId),
    verschnEin,
    quelleByBatch,
    zielByBatch,
    chargeNamen,
    // KAN-77: Quellgebinde aus den schon geladenen Umzügen und Chargen des Betriebs (keine weitere Abfrage)
    quellGebinde: quellGebindeBetrieb(verschnEin, umzuege, chargen),
  }
  return {
    bewegungen: bewegungenAus(roh),
    chargen,
    fuellungen: fuellungenAlle,
    quellen: { umzuege, zukauf, verkauf, verschneidungen: verschnEin, verschneidungQuellen: roh.verschnAus, pressungen },
  }
}

/** KAN-77: Quellgebinde aller Verschnitte des Betriebs aus den Rohdaten (Namen aus den eingebetteten Gebinden) */
function quellGebindeBetrieb(verschnEin: readonly R[], umzuege: readonly R[], chargen: readonly R[]): Map<string, Quellgebinde> {
  const gebindeJeCharge = new Map<string, string | null>()
  const namen = new Map<string, string>()
  for (const c of chargen) {
    gebindeJeCharge.set(c.id, c.behaelter_id ?? null)
    if (c.behaelter_id && (c.behaelter as R | null)?.name) namen.set(c.behaelter_id, c.behaelter.name)
  }
  for (const u of umzuege) {
    if (u.von_behaelter_id && (u.von_behaelter as R | null)?.name) namen.set(u.von_behaelter_id, u.von_behaelter.name)
    if (u.nach_behaelter_id && (u.nach_behaelter as R | null)?.name) namen.set(u.nach_behaelter_id, u.nach_behaelter.name)
  }
  // KAN-112: Namen der Gebinde aus der Momentaufnahme am Verschnitt
  for (const v of verschnEin) {
    for (const q of (v.quellen ?? []) as R[]) if (q.quell_behaelter_id && (q.quell_behaelter as R | null)?.name) namen.set(q.quell_behaelter_id, q.quell_behaelter.name)
  }
  return quellGebindeAusDaten(verschnEin.map(verschnittGebinde), umzuege as UmzugGebinde[], gebindeJeCharge, namen)
}

/** Bewegungen und Belegungszeiträume eines Gebindes (ohne Gebinde-Stammdaten) */
export async function ladeBelegungen(supabase: any, tenantId: string, behaelterId: string): Promise<Belegung[]> {
  const roh = await ladeRoh(supabase, tenantId, behaelterId)
  return belegungszeitraeume(ohneStornoPaare(bewegungenAus(roh)), roh.chargen)
}

export type Bewegungsbuch = {
  behaelter: BehaelterZeile
  /** alle Bewegungen, chronologisch, mit laufendem Saldo */
  bewegungen: BewegungMitSaldo[]
  /** Ausschnitt für den Zeitraum (mit Übertrag-Zeile) – Bildschirm und CSV */
  zeitraum: BewegungMitSaldo[]
  /** Chargen, die aktuell diesem Gebinde zugeordnet sind (auch abgeschlossene) */
  chargen: R[]
  /** Chargen mit Bestand (für „Aktuelle Chargen“) */
  aktiveChargen: R[]
  /** Liter je Charge laut Bewegungen (korrigiert veraltetes menge_liter) */
  literByCharge: Record<string, number>
  finalSaldo: number
  gebuchterBestand: number
  nichtVerbuchterSchwund: number
  aktuell: number
  warnungen: string[]
}

/** Bewegungsbuch eines Gebindes – null, wenn das Gebinde (eigen oder freigegeben) nicht sichtbar ist */
export async function ladeBewegungsbuch(
  supabase: any,
  tenantId: string,
  p: { behaelterId: string } & Zeitraum,
): Promise<Bewegungsbuch | null> {
  const behaelter = await ladeBehaelterEinzeln(supabase, tenantId, p.behaelterId)
  if (!behaelter) return null
  const roh = await ladeRoh(supabase, tenantId, p.behaelterId)
  const bewegungen = mitSaldo(bewegungenAus(roh))
  const finalSaldo = bewegungen.length > 0 ? bewegungen[bewegungen.length - 1].saldo : 0

  // Liter je Charge aus den Bewegungen (wie bisher auf der Seite)
  const literByCharge: Record<string, number> = {}
  const plus = (id: string | null | undefined, l: number) => { if (id) literByCharge[id] = (literByCharge[id] ?? 0) + l }
  for (const z of roh.zukauf) plus(z.ziel_weinausbau_id, num(z.menge))
  for (const pb of roh.pressungen) if (!istStorniert(pb)) plus(pb.weinausbau_id, num(pb.menge_liter))
  for (const v of roh.verschnEin) if (!istStorniert(v)) plus(v.ziel_weinausbau_id, ((v.quellen ?? []) as R[]).reduce((s: number, q: R) => s + num(q.menge_liter), 0))
  for (const vq of roh.verschnAus) if (!istStorniert(vq)) plus(vq.quell_weinausbau_id, -num(vq.menge_liter))
  for (const u of roh.umzuegeEin) {
    if (istStorniert(u)) continue
    const rohmenge = num(u.menge_liter), schwund = num(u.schwund_liter)
    plus(u.nach_weinausbau_id, u.brutto_liter != null ? rohmenge : Math.max(0, rohmenge - schwund))
  }
  for (const u of roh.umzuegeAus) {
    if (istStorniert(u)) continue
    plus(u.von_weinausbau_id, -(u.zeilen_typ === 'quelle' ? num(u.menge_liter) : (num(u.brutto_liter) || num(u.menge_liter))))
  }
  for (const f of roh.fuellungen) if (!istStorniert(f)) plus(f.weinausbau_id, -(num(f.menge_liter_gefuellt) || (num(f.anzahl_flaschen) * num(f.flaschengroesse_ml) / 1000)))
  for (const v of roh.verkauf) if (!(v.verkaufsposten as R | null)?.storniert) plus(v.weinausbau_id, -num(v.menge))
  for (const v of roh.verarbeitungen) if (!istStorniert(v)) plus(v.weinausbau_id, -num(v.menge_liter))
  for (const b of roh.behandlungen) if (!istStorniert(b) && num(b.zugang_liter) > 0) plus(b.weinausbau_id, num(b.zugang_liter))

  const aktiveChargen = roh.chargen.filter(c => c.aktiv && !c.ist_eroeffnungsbestand && (literByCharge[c.id] ?? num(c.menge_liter)) > 0.001)
  const aktuellDB = aktiveChargen.reduce((s: number, c: R) => s + num(c.menge_liter), 0)
  const gebuchterBestand = runden(roh.chargen.reduce((s: number, c: R) => s + num(c.menge_liter), 0), STELLEN.liter)

  const warnungen: string[] = []
  const ohneDatum = bewegungen.filter(b => !b.datum).length
  if (ohneDatum > 0) warnungen.push(`${ohneDatum} ${ohneDatum === 1 ? 'Bewegung hat' : 'Bewegungen haben'} kein Datum – ${ohneDatum === 1 ? 'sie steht' : 'sie stehen'} am Anfang bzw. im Übertrag.`)
  if (behaelter.fremd) {
    warnungen.push(`Kellergemeinschaft: Das Gebinde gehört ${behaelter.eigentuemer_name || 'einem Partnerbetrieb'} – enthalten sind nur die Bewegungen des eigenen Betriebs.`)
  }
  if (behaelter.fremd_liter > 0) {
    warnungen.push(`Kellergemeinschaft: Im Gebinde liegen zusätzlich ${fmtNum(behaelter.fremd_liter, 2)} L von ${behaelter.fremd_betrieb ?? 'einem Partnerbetrieb'} – deren Bewegungen sind nicht enthalten.`)
  }

  return {
    behaelter,
    bewegungen,
    zeitraum: imZeitraumMitUebertrag(bewegungen, p),
    chargen: roh.chargen,
    aktiveChargen,
    literByCharge,
    finalSaldo,
    gebuchterBestand,
    nichtVerbuchterSchwund: runden(finalSaldo - gebuchterBestand, 2),
    aktuell: finalSaldo > 0 ? finalSaldo : aktuellDB,
    warnungen,
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

export type BewegungsbuchZeile = {
  datum: string
  art: string
  charge: string | null
  vorgang: string
  zugang: number | null
  abgang: number | null
  saldo: number
  gegenstelle: string | null
  beleg: string | null
  hinweis: string | null
  /** KAN-145: „storniert am …“ bzw. „Gegenbuchung zur Buchung vom …“ */
  storno: string | null
  gebinde: string
}

export function bewegungsbuchZeilen(bb: Pick<Bewegungsbuch, 'behaelter' | 'zeitraum'>): BewegungsbuchZeile[] {
  return bb.zeitraum.map(b => ({
    datum: b.datum,
    art: BEWEGUNGSART_LABEL[b.art],
    charge: b.charge,
    vorgang: b.beschreibung,
    zugang: b.menge > 0 ? b.menge : null,
    abgang: b.menge < 0 ? -b.menge : null,
    saldo: b.saldo,
    gegenstelle: b.gegenstelle,
    beleg: b.beleg,
    hinweis: b.extra ?? null,
    storno: stornoText(b),
    gebinde: bb.behaelter.anzeigeName,
  }))
}

/** Storno-Vermerk einer Bewegung (Seite und CSV) – null ohne Storno */
export function stornoText(b: Pick<Bewegung, 'storno' | 'gegenbuchungZu'>): string | null {
  const d = (t: string) => t.split('-').reverse().join('.')
  if (b.storno) return `storniert am ${d(b.storno.am)}`
  if (b.gegenbuchungZu) return `Gegenbuchung (Storno) zur Buchung vom ${d(b.gegenbuchungZu)}`
  return null
}

export const SPALTEN_BEWEGUNGSBUCH: CsvSpalte<BewegungsbuchZeile>[] = [
  { kopf: 'Datum', typ: 'datum', wert: z => z.datum },
  { kopf: 'Gebinde', typ: 'text', wert: z => z.gebinde },
  { kopf: 'Art', typ: 'text', wert: z => z.art },
  { kopf: 'Charge', typ: 'text', wert: z => z.charge },
  { kopf: 'Vorgang', typ: 'text', wert: z => z.vorgang },
  { kopf: 'Zugang (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.zugang },
  { kopf: 'Abgang (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.abgang },
  { kopf: 'Saldo (l)', typ: 'dezimal', stellen: STELLEN.liter, wert: z => z.saldo },
  { kopf: 'Gegenstelle', typ: 'text', wert: z => z.gegenstelle },
  { kopf: 'Beleg', typ: 'code', wert: z => z.beleg },
  { kopf: 'Hinweis', typ: 'text', wert: z => z.hinweis },
  { kopf: 'Storno', typ: 'text', wert: z => z.storno },
]
