import 'server-only'
/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */

// ── Verschnitt buchen – gemeinsamer Service (KAN-112, 03.10.2026) ──────────────────────────────────────────────
//
// Genutzt vom Verschneiden-Formular (createVerschneidung, auch Pressung und Assistent) und vom Umziehen, wenn der
// Umzug ein Verschnitt ist (Entscheidungen Jörgen 03.10.2026: keine Zwischencharge mehr – abweichende Merkmale im
// Ziel-Gebinde bzw. abweichende Quellen werden sofort als Verschnitt gebucht, bei leerem Ziel-Gebinde in eine neue
// Charge). Ablauf: alle Prüfungen vor dem Buchen (Mengen, Bestand, Weinart, Prüfnummer-Rückfrage), dann die Fachwerte
// (verschnittWerte.ts) und EIN Aufruf der RPC s112_verschnitt_buchen – sie bucht Verschnitt, Gebinde-Momentaufnahme,
// Schwund je Quelle (keller_umzuege 'schwund'), Bestände und Merkmale der Ziel-Charge in einer Transaktion.
// Der Aufrufer prüft vorher Betrieb (KAN-30), Schreibsperre (KAN-5) und das Schreibrecht im Kellerbuch.
//
// KAN-112 Nachtrag (Entscheidung Jörgen 03.10.2026, „n Zielgebinde“): Vorbereiten und Buchen sind getrennt.
// verschnittVorbereiten() macht alle Prüfungen und Fachwerte EINES Verschnitts ohne RPC (Ergebnis: Rückfrage oder
// Buchung {kopf, quellen}); verschnitteVorbereiten() bereitet mehrere Verschnitte nacheinander vor – spätere mit den
// Beständen, die die Quellen nach den früheren Buchungen desselben Aufrufs haben – und verschnitteAusfuehren() bucht
// sie in EINEM Aufruf der RPC s112_verschnitte_buchen (alle oder keiner). Ein einzelner Verschnitt bleibt bei
// s112_verschnitt_buchen.

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'
import { weinartKonflikt, weinartBekannt, weinartAusFarbe, WEINART_LABEL } from '@/lib/keller/weinart'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { mitPnNotiz } from '@/lib/kellerbuch/pruefnummer'
import { verschnittGruppen } from '@/lib/kellerbuch/verschnittSorten'
import { verschnittWerte, weinartAusQuellen, type Abstufung } from '@/lib/kellerbuch/verschnittWerte'

type R = Record<string, any>

export type VerschnittEingabe = {
  datum: string
  /** Ziel-Charge – oder eine neue Charge im (leeren) Gebinde */
  ziel: { weinausbauId: string } | { neueCharge: { behaelterId: string; name?: string | null; status?: string | null; notizen?: string | null } }
  /** menge = Liter in das Ziel (netto), schwund = Verlust aus dieser Quelle (KAN-112) */
  quellen: readonly { weinausbau_id: string; menge: number; schwund?: number }[]
  notizen: string | null
  /** KAN-83: Rückfrage „Prüfnummer gilt nicht mehr“ bestätigt */
  pnBestaetigt: boolean
}

/** KAN-112: vorbereiteter Verschnitt – Argumente der RPC und Hinweise, noch nichts gebucht */
export type VerschnittBuchung = {
  kopf: R
  quellen: R[]
  qualitaetAbgestuft: Abstufung | null
  herkunftAbgestuft: Abstufung | null
  sortenHinweise: string[]
  zielId: string | null
  zielName: string | null
}

export type VerschnittErgebnis = {
  qualitaetAbgestuft: Abstufung | null
  herkunftAbgestuft: Abstufung | null
  sortenHinweise?: string[]
  /** KAN-83: Rückfrage – nichts gebucht */
  bestaetigung?: string
  verschneidungId?: string
  zielChargeId?: string
  zielName?: string | null
}

const CHARGE_SPALTEN = 'id, name, menge_liter, aktiv, rebsorte, jahrgang, weinart, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, land_iso, kmw, oechsle, mostgewicht_einheit'

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const rund2 = (n: number): number => Math.round(n * 100) / 100

/**
 * KAN-112: Verschnitt prüfen und die RPC-Argumente berechnen, OHNE zu buchen – siehe Dateikopf. `entnommen` = Liter
 * (Menge + Schwund), die frühere Verschnitte desselben RPC-Aufrufs den Quell-Chargen schon entnehmen: Bestandsprüfung
 * und erwartete Bestände beziehen sich auf den Stand danach. Wirft AktionsFehler mit deutscher Meldung.
 */
export async function verschnittVorbereiten(
  supabase: any,
  tenantId: string,
  e: VerschnittEingabe,
  entnommen: ReadonlyMap<string, number> = new Map(),
): Promise<{ bestaetigung: string } | { buchung: VerschnittBuchung }> {
  const zielId = 'weinausbauId' in e.ziel ? e.ziel.weinausbauId : null
  const neueCharge = 'neueCharge' in e.ziel ? e.ziel.neueCharge : null
  if (!e.datum || (!zielId && !neueCharge?.behaelterId) || e.quellen.length === 0) throw new AktionsFehler('Pflichtfelder fehlen')

  // Quellen je Charge zusammenfassen (die RPC bucht jede Charge einmal)
  const jeCharge = new Map<string, { menge: number; schwund: number }>()
  for (const q of e.quellen) {
    if (!q.weinausbau_id) throw new AktionsFehler('Bei einer Quelle des Verschnitts fehlt die Charge.')
    if (!Number.isFinite(q.menge) || q.menge < 0.01) throw new AktionsFehler('Jede Quelle eines Verschnitts braucht eine Menge von mindestens 0,01 L.')
    const schwund = q.schwund ?? 0
    if (!Number.isFinite(schwund) || schwund < 0) throw new AktionsFehler('Der Schwund einer Quelle kann nicht negativ sein.')
    if (q.weinausbau_id === zielId) throw new AktionsFehler('Die Ziel-Charge kann nicht zugleich Quelle des Verschnitts sein.')
    const b = jeCharge.get(q.weinausbau_id) ?? { menge: 0, schwund: 0 }
    jeCharge.set(q.weinausbau_id, { menge: b.menge + q.menge, schwund: b.schwund + schwund })
  }

  // Ziel-Charge (Mandant)
  let ziel: R | null = null
  if (zielId) {
    const { data, error } = await (supabase.from('weinausbau') as any)
      .select(CHARGE_SPALTEN).eq('id', zielId).eq('tenant_id', tenantId).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Ziel-Charge konnte nicht geladen werden'))
    if (!data) throw new AktionsFehler('Ziel-Charge nicht gefunden')
    ziel = data as R
  }

  // Quell-Chargen: gehören zum Betrieb, aktiv, Menge + Schwund ≤ Bestand
  const { data: qData, error: qErr } = await (supabase.from('weinausbau') as any)
    .select(CHARGE_SPALTEN).in('id', [...jeCharge.keys()]).eq('tenant_id', tenantId)
  if (qErr) throw new AktionsFehler(dbFehlerText(qErr, 'Quell-Chargen konnten nicht geladen werden'))
  const quellRows = (qData ?? []) as R[]
  for (const [qid, { menge, schwund }] of jeCharge) {
    const row = quellRows.find(r => r.id === qid)
    if (!row) throw new AktionsFehler('Quell-Charge nicht gefunden – sie gehört nicht zu diesem Betrieb.')
    const verfuegbar = num(row.menge_liter) - (entnommen.get(qid) ?? 0)
    if (menge + schwund > verfuegbar + 0.01) {
      throw new AktionsFehler(`„${row.name}“: Verschnittmenge (${fmtNum(menge + schwund, 2)} L) übersteigt den Bestand der Charge (${fmtNum(verfuegbar, 2)} L).`)
    }
  }

  // Rot- und Weißwein dürfen nicht verschnitten werden (Chargen ohne Weinart über die Rebsortenfarbe)
  const farbe = new Map<string, string>()
  {
    const sorten = [...new Set([...quellRows, ...(ziel ? [ziel] : [])].map(r => r.rebsorte).filter(Boolean))] as string[]
    // tenant-isolation-ignore: rebsorten ist eine globale Stammtabelle ohne tenant_id
    const { data: rs } = sorten.length ? await (supabase.from('rebsorten') as any).select('name_de, farbe').in('name_de', sorten) : { data: [] }
    for (const r of (rs ?? []) as R[]) farbe.set(r.name_de, r.farbe)
  }
  const artVon = (r: R): string => (weinartBekannt(r.weinart) ? r.weinart : weinartAusFarbe(farbe.get(r.rebsorte)))
  const weinart = ziel ? artVon(ziel) : weinartAusQuellen(quellRows.map(artVon))
  for (const q of quellRows) {
    if (weinartKonflikt(artVon(q), weinart)) {
      throw new AktionsFehler(`Rot- und Weißwein dürfen laut Weingesetz nicht verschnitten werden (${WEINART_LABEL[artVon(q)]} in ${WEINART_LABEL[weinart]}).`)
    }
  }

  // KAN-83: Prüfnummer der Ziel-Charge – eingereichter Antrag: Ablehnung; geltende Nummer: erst nachfragen
  let notizen = e.notizen?.trim() || null
  if (ziel) {
    const zugang = [...jeCharge.values()].reduce((s, q) => s + q.menge, 0)
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'verschnitt',
      [{ chargeId: ziel.id, name: (ziel.name as string | null) ?? null, zugangLiter: zugang }], e.datum)
    if (pn && !e.pnBestaetigt) return { bestaetigung: pn.frage }
    if (pn) notizen = mitPnNotiz(notizen, pn.notiz)
  }

  // KAN-93: Rebsorten- und Jahrgangsanteile (Ziel mit ganzem Bestand, Quellen mit der verschnittenen Menge)
  const quellen = [...jeCharge].map(([qid, m]) => ({ charge: quellRows.find(r => r.id === qid) as R, menge: m.menge, schwund: m.schwund }))
  const gruppen = await verschnittGruppen(supabase, tenantId, [
    ...(ziel ? [{ charge: ziel, liter: num(ziel.menge_liter) }] : []),
    ...quellen.map(q => ({ charge: q.charge, liter: q.menge })),
  ])

  // KAN-112: verschnittGruppen rechnet mit dem geladenen Bestand (Anteile je Liter ändern sich durchs Entnehmen nicht);
  // erwarteter Bestand je Quelle = Stand nach den früheren Buchungen desselben Aufrufs (die RPC speichert jeden Rest
  // auf 2 Stellen gerundet; ohne frühere Entnahme bleibt der geladene Wert ungerundet)
  const mitBestandDanach = quellen.map(q => {
    const weg = entnommen.get(q.charge.id as string) ?? 0
    return weg > 0 ? { ...q, charge: { ...q.charge, menge_liter: rund2(num(q.charge.menge_liter) - weg) } } : q
  })
  const w = verschnittWerte({ datum: e.datum, ziel, neueCharge, weinart, quellen: mitBestandDanach, gruppen, notizen })
  return {
    buchung: {
      kopf: w.kopf, quellen: w.quellen,
      qualitaetAbgestuft: w.qualitaetAbgestuft, herkunftAbgestuft: w.herkunftAbgestuft, sortenHinweise: w.sortenHinweise,
      zielId: (ziel?.id as string | undefined) ?? null,
      zielName: (ziel?.name as string | null | undefined) ?? (w.kopf.neue_ziel_charge?.name as string | undefined) ?? null,
    },
  }
}

/** RPC-Fehler → AktionsFehler; 40001 (Bestand seit der Berechnung geändert): Meldung der RPC („bitte erneut buchen“) unverändert */
function rpcFehler(error: unknown): AktionsFehler {
  const f = error as R
  return new AktionsFehler(f?.code === '40001' && f?.message ? String(f.message) : dbFehlerText(error, 'Verschnitt konnte nicht gebucht werden'))
}

function ergebnisAus(b: VerschnittBuchung, roh: unknown): VerschnittErgebnis {
  const ergebnis = (roh ?? {}) as R
  return {
    qualitaetAbgestuft: b.qualitaetAbgestuft,
    herkunftAbgestuft: b.herkunftAbgestuft,
    sortenHinweise: b.sortenHinweise,
    verschneidungId: (ergebnis.verschneidung_id as string | undefined) ?? undefined,
    zielChargeId: (ergebnis.ziel_weinausbau_id as string | undefined) ?? b.zielId ?? undefined,
    zielName: b.zielName,
  }
}

/**
 * KAN-112: vorbereitete Verschnitte buchen – einer über s112_verschnitt_buchen, mehrere in EINER Transaktion über
 * s112_verschnitte_buchen (scheitert einer, wird keiner gebucht). Ergebnisse in derselben Reihenfolge.
 */
export async function verschnitteAusfuehren(
  supabase: any,
  tenantId: string,
  buchungen: readonly VerschnittBuchung[],
): Promise<VerschnittErgebnis[]> {
  if (buchungen.length === 0) return []
  if (buchungen.length === 1) {
    const b = buchungen[0]
    const { data, error } = await (supabase.rpc as any)('s112_verschnitt_buchen', { p_tenant_id: tenantId, p_kopf: b.kopf, p_quellen: b.quellen })
    if (error) throw rpcFehler(error)
    return [ergebnisAus(b, data)]
  }
  // Eine Charge darf nicht Ziel des einen und Quelle eines anderen Verschnitts sein (die Reihenfolge wäre fachlich offen)
  const quellIds = new Set(buchungen.flatMap(b => b.quellen.map(q => q.weinausbau_id as string)))
  if (buchungen.some(b => b.zielId && quellIds.has(b.zielId))) {
    throw new AktionsFehler('Eine Charge kann nicht zugleich Ziel des einen und Quelle eines anderen Verschnitts sein.')
  }
  const { data, error } = await (supabase.rpc as any)('s112_verschnitte_buchen', {
    p_tenant_id: tenantId,
    p_buchungen: buchungen.map(b => ({ kopf: b.kopf, quellen: b.quellen })),
  })
  if (error) throw rpcFehler(error)
  const liste = Array.isArray(data) ? data : []
  return buchungen.map((b, i) => ergebnisAus(b, liste[i]))
}

/**
 * KAN-112: mehrere Verschnitte vorbereiten, alle Prüfnummer-Rückfragen gesammelt – spätere mit den Beständen nach
 * den früheren. `fragen` nicht leer: nichts buchen, Rückfrage stellen (`buchungen` ist dann unvollständig).
 */
export async function verschnitteVorbereiten(
  supabase: any,
  tenantId: string,
  eingaben: readonly VerschnittEingabe[],
): Promise<{ fragen: string[]; buchungen: VerschnittBuchung[] }> {
  const entnommen = new Map<string, number>()
  const fragen: string[] = []
  const buchungen: VerschnittBuchung[] = []
  for (const e of eingaben) {
    const v = await verschnittVorbereiten(supabase, tenantId, e, entnommen)
    if ('bestaetigung' in v) fragen.push(v.bestaetigung)
    else buchungen.push(v.buchung)
    for (const q of e.quellen) {
      entnommen.set(q.weinausbau_id, rund2((entnommen.get(q.weinausbau_id) ?? 0) + rund2(q.menge) + rund2(q.schwund ?? 0)))
    }
  }
  return { fragen, buchungen }
}

/** Verschnitt prüfen und buchen (ein Ziel; Formular, Pressung, Assistent) – siehe Dateikopf. */
export async function verschnittBuchen(
  supabase: any,
  tenantId: string,
  e: VerschnittEingabe,
): Promise<VerschnittErgebnis> {
  const v = await verschnittVorbereiten(supabase, tenantId, e)
  if ('bestaetigung' in v) return { qualitaetAbgestuft: null, herkunftAbgestuft: null, bestaetigung: v.bestaetigung }
  return (await verschnitteAusfuehren(supabase, tenantId, [v.buchung]))[0]
}
