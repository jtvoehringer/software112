import 'server-only'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
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
//
// KAN-193 (03.10.2026): „virtuelle Quelle“ – beim Zukauf in ein Gebinde mit abweichendem Wein gibt es die Quell-Charge
// noch nicht (die RPC s112_zukauf_buchen legt sie erst in derselben Transaktion an). verschnittVorbereiten() rechnet
// dann mit den Merkmalen und Litern des Zukaufs (`virtuelleQuelle`) statt mit einer geladenen Charge; die Ziel-Charge
// (Anker) ist echt. Die Prüfnummer-Rückfrage stellt dort der Zukauf selbst (Art 'zukauf') – hier entfällt sie.
//
// KAN-193 (Entscheidung Jörgen 03.10.2026): Rot- und Weißwein dürfen verschnitten werden, wenn das Ergebnis auf
// „Wein (aus Österreich)“ abgestuft wird. Statt der bisherigen Ablehnung stellt verschnittVorbereiten() die Rückfrage
// ROT_WEISS_FRAGE (zusammen mit einer Prüfnummer-Rückfrage in EINER `bestaetigung`); nach der Bestätigung
// (`rotWeissBestaetigt`, Formularfeld rotweiss_bestaetigt=1) rechnet verschnittWerte die Abstufung und die Farbe nach
// der Mehrheit der Liter. Gilt für Umziehen, Verschneiden-Formular, Pressung, Assistent und Zukauf gleichermaßen.
//
// KAN-111 (04.10.2026): Lässt die Herkunft nur noch Landwein bzw. Wein zu (ermittleHerkunft), steht die Rückfrage
// herkunftQualitaetFrage in derselben `bestaetigung` – bestätigt über dasselbe Formularfeld rotweiss_bestaetigt=1
// (alle Clients setzen es nach der Bestätigung im Rückfrage-Dialog, serverRueckfrage – KAN-359). Die Rückfragen stehen
// deshalb erst nach der Berechnung fest.

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'
import { weinartBekannt, weinartAusFarbe } from '@/lib/keller/weinart'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { mitPnNotiz } from '@/lib/kellerbuch/pruefnummer'
import { verschnittGruppen } from '@/lib/kellerbuch/verschnittSorten'
import { verschnittWerte, weinartAusQuellen, rotWeissMischung, herkunftQualitaetFrage, herkunftQualitaetVermerk, ROT_WEISS_FRAGE, type Abstufung } from '@/lib/kellerbuch/verschnittWerte'
import type { GruppenMenge } from '@/lib/wein/sortenangabe'
import { bkiFarbe } from '@/lib/wein/bki_kuerzel'

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
  /** KAN-193: Rückfrage „Rot- und Weißwein werden verschnitten …“ bestätigt */
  rotWeissBestaetigt?: boolean
  /** KAN-193: Quelle ohne Datenbankzeile (Zukauf) – Merkmale wie eine Charge (rebsorte, jahrgang, weinart, herkunft_code,
   *  Qualität, Mostgewicht, land_iso, name) und die Liter; nur mit einer Ziel-Charge, `quellen` bleibt dann leer */
  virtuelleQuelle?: VirtuelleQuelle | null
}

/** KAN-193: Quelle eines Verschnitts, die erst die RPC anlegt (Zukauf) */
export type VirtuelleQuelle = { charge: R; menge: number }

/** KAN-112: vorbereiteter Verschnitt – Argumente der RPC und Hinweise, noch nichts gebucht */
export type VerschnittBuchung = {
  kopf: R
  quellen: R[]
  qualitaetAbgestuft: Abstufung | null
  herkunftAbgestuft: Abstufung | null
  sortenHinweise: string[]
  /** KAN-193: auf Wein (aus Österreich) abgestuft (Rot/Weiß) */
  rotWeiss: boolean
  zielId: string | null
  zielName: string | null
}

export type VerschnittErgebnis = {
  qualitaetAbgestuft: Abstufung | null
  herkunftAbgestuft: Abstufung | null
  sortenHinweise?: string[]
  /** KAN-193: auf Wein (aus Österreich) abgestuft (Rot/Weiß) */
  rotWeiss?: boolean
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

const rund2 = (n: number): number => rund(n, 2)

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
  const virtuell = e.virtuelleQuelle ?? null
  if (!e.datum || (!zielId && !neueCharge?.behaelterId) || (e.quellen.length === 0 && !virtuell)) throw new AktionsFehler('Pflichtfelder fehlen')
  // KAN-193: die virtuelle Quelle (Zukauf) nur allein und nur in eine vorhandene Ziel-Charge
  if (virtuell && (!zielId || e.quellen.length > 0)) throw new AktionsFehler('Ein Zukauf wird nur allein in eine vorhandene Charge verschnitten.')
  if (virtuell && (!Number.isFinite(virtuell.menge) || virtuell.menge < 0.01)) throw new AktionsFehler('Der Zukauf braucht eine Menge von mindestens 0,01 L.')

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
  let quellRows: R[] = []
  if (jeCharge.size > 0) {
    const { data: qData, error: qErr } = await (supabase.from('weinausbau') as any)
      .select(CHARGE_SPALTEN).in('id', [...jeCharge.keys()]).eq('tenant_id', tenantId)
    if (qErr) throw new AktionsFehler(dbFehlerText(qErr, 'Quell-Chargen konnten nicht geladen werden'))
    quellRows = (qData ?? []) as R[]
  }
  // KAN-193: virtuelle Quelle wie eine Charge mit genau der Zukaufsmenge als Bestand (ohne id – sie gibt es noch nicht)
  const virtuelleRow: R | null = virtuell ? { ...virtuell.charge, id: null, menge_liter: virtuell.menge } : null
  for (const [qid, { menge, schwund }] of jeCharge) {
    const row = quellRows.find(r => r.id === qid)
    if (!row) throw new AktionsFehler('Quell-Charge nicht gefunden – sie gehört nicht zu diesem Betrieb.')
    const verfuegbar = num(row.menge_liter) - (entnommen.get(qid) ?? 0)
    if (menge + schwund > verfuegbar + 0.01) {
      throw new AktionsFehler(`„${row.name}“: Verschnittmenge (${fmtNum(menge + schwund, 2)} L) übersteigt den Bestand der Charge (${fmtNum(verfuegbar, 2)} L).`)
    }
  }

  // Weinart der Beteiligten (Chargen ohne Weinart über die Rebsortenfarbe)
  const farbe = new Map<string, string>()
  {
    const sorten = [...new Set([...quellRows, ...(virtuelleRow ? [virtuelleRow] : []), ...(ziel ? [ziel] : [])].map(r => r.rebsorte).filter(Boolean))] as string[]
    // tenant-isolation-ignore: rebsorten ist eine globale Stammtabelle ohne tenant_id
    const { data: rs } = sorten.length ? await (supabase.from('rebsorten') as any).select('name_de, farbe').in('name_de', sorten) : { data: [] }
    for (const r of (rs ?? []) as R[]) farbe.set(r.name_de, r.farbe)
  }
  const artVon = (r: R): string => (weinartBekannt(r.weinart) ? r.weinart : weinartAusFarbe(farbe.get(r.rebsorte) ?? bkiFarbe(r.rebsorte) ?? undefined))
  // KAN-193: Rot und Weiß → Rückfrage, nach Bestätigung Abstufung auf Wein (aus Österreich) und Farbe nach der Mehrheit
  // der Liter (Ziel mit seinem Bestand, Quellen mit ihrer Menge) – früher eine harte Ablehnung
  const mischung = rotWeissMischung([
    ...(ziel ? [{ weinart: artVon(ziel), liter: num(ziel.menge_liter) }] : []),
    ...quellRows.map(q => ({ weinart: artVon(q), liter: jeCharge.get(q.id as string)?.menge ?? 0 })),
    ...(virtuelleRow && virtuell ? [{ weinart: artVon(virtuelleRow), liter: virtuell.menge }] : []),
  ])
  const weinart = mischung.rotWeiss && mischung.weinart
    ? mischung.weinart
    : ziel ? artVon(ziel) : weinartAusQuellen([...quellRows, ...(virtuelleRow ? [virtuelleRow] : [])].map(artVon))
  // Rückfragen (Rot/Weiß, Prüfnummer) gesammelt in EINER bestaetigung – nichts gebucht
  const fragen: string[] = []

  // KAN-83: Prüfnummer der Ziel-Charge – eingereichter Antrag: Ablehnung; geltende Nummer: erst nachfragen
  // (KAN-193: bei der virtuellen Quelle fragt der Zukauf selbst – Art 'zukauf' –, samt Vermerk in den Notizen)
  let notizen = e.notizen?.trim() || null
  if (ziel && !virtuell) {
    const zugang = [...jeCharge.values()].reduce((s, q) => s + q.menge, 0)
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'verschnitt',
      [{ chargeId: ziel.id, name: (ziel.name as string | null) ?? null, zugangLiter: zugang }], e.datum)
    if (pn && !e.pnBestaetigt) fragen.push(pn.frage)
    if (pn) notizen = mitPnNotiz(notizen, pn.notiz)
  }

  // KAN-93: Rebsorten- und Jahrgangsanteile (Ziel mit ganzem Bestand, Quellen mit der verschnittenen Menge)
  const quellen = [...jeCharge].map(([qid, m]) => ({ charge: quellRows.find(r => r.id === qid) as R, menge: m.menge, schwund: m.schwund }))
  const gruppen = await verschnittGruppen(supabase, tenantId, [
    ...(ziel ? [{ charge: ziel, liter: num(ziel.menge_liter) }] : []),
    ...quellen.map(q => ({ charge: q.charge, liter: q.menge })),
  ])
  // KAN-193: die virtuelle Quelle hat keine Herkunftsanteile – sie zählt mit ihrer Rebsorte und ihrem Jahrgang
  if (virtuelleRow && virtuell) {
    const dazu = (liste: GruppenMenge[], wert: string) => {
      const g = liste.find(x => x.wert === wert)
      if (g) g.liter += virtuell.menge
      else liste.push({ wert, liter: virtuell.menge })
    }
    dazu(gruppen.sorten, (virtuelleRow.rebsorte as string | null)?.trim() || 'unbekannt')
    dazu(gruppen.jahrgaenge, virtuelleRow.jahrgang != null && virtuelleRow.jahrgang !== '' ? String(virtuelleRow.jahrgang) : 'unbekannt')
    // KAN-110: Zukauf ohne Ursprung – Ried und Gemeinde unbekannt
    gruppen.herkunft.push({ liter: virtuell.menge, code: (virtuelleRow.herkunft_code as string | null) ?? null, ried: null, ort: null })
    quellen.push({ charge: virtuelleRow, menge: virtuell.menge, schwund: 0 })
  }

  // KAN-112: verschnittGruppen rechnet mit dem geladenen Bestand (Anteile je Liter ändern sich durchs Entnehmen nicht);
  // erwarteter Bestand je Quelle = Stand nach den früheren Buchungen desselben Aufrufs (die RPC speichert jeden Rest
  // auf 2 Stellen gerundet; ohne frühere Entnahme bleibt der geladene Wert ungerundet)
  const mitBestandDanach = quellen.map(q => {
    const weg = entnommen.get(q.charge.id as string) ?? 0
    return weg > 0 ? { ...q, charge: { ...q.charge, menge_liter: rund2(num(q.charge.menge_liter) - weg) } } : q
  })
  const w = verschnittWerte({ datum: e.datum, ziel, neueCharge, weinart, quellen: mitBestandDanach, gruppen, notizen, rotWeiss: mischung.rotWeiss })
  // KAN-193/KAN-170: Rot/Weiß – Rückfrage nur, wenn tatsächlich abgestuft wird (alle schon „Wein (ohne Herkunft)“:
  // ohne Rückfrage, nur Vermerk); als erste Frage wie bisher
  if (w.rotWeissAbstufung && !e.rotWeissBestaetigt) fragen.unshift(ROT_WEISS_FRAGE)
  // KAN-111: Qualitätsabstufung wegen der Herkunft – Rückfrage zusammen mit Rot/Weiß und Prüfnummer
  if (w.herkunftQualitaet && !e.rotWeissBestaetigt) fragen.push(herkunftQualitaetFrage(w.herkunftQualitaet))
  if (fragen.length > 0) return { bestaetigung: fragen.join('\n') }
  return {
    buchung: {
      // KAN-193: die virtuelle Quelle (ohne id) bucht die RPC des Zukaufs selbst – nicht in p_quellen
      kopf: w.kopf, quellen: w.quellen.filter(q => q.weinausbau_id),
      qualitaetAbgestuft: w.qualitaetAbgestuft, herkunftAbgestuft: w.herkunftAbgestuft,
      // KAN-111: Vermerk und Hinweise der Herkunftsregel mit den Sortenhinweisen an die Oberfläche
      sortenHinweise: [...(w.herkunftQualitaet ? [herkunftQualitaetVermerk(w.herkunftQualitaet)] : []), ...w.herkunftHinweise, ...w.sortenHinweise],
      rotWeiss: w.rotWeiss,
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
    rotWeiss: b.rotWeiss,
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
