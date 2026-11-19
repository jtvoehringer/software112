// ── Kellerbehandlungen der Ursprungscharge (KAN-475, Nebenbefund 19.11.2026) ─────────────────────────────────
//
// Kellerbehandlungen stehen an der Charge. Entsteht eine Charge durch einen (Teil-)Umzug aus einer anderen, gilt
// für ihren Wein auch, was die Ursprungscharge BIS ZUM UMZUG an Behandlungen bekam – die Einträge bleiben bei der
// Ursprungscharge, die neue Charge zeigt sie als „übernommen“ (Seite Kellerbehandlungen) bzw. „über Charge …“
// (Weinbuch: Seite, Druck, CSV). Über mehrere Umzüge hinweg (Kette), ohne Verschnitte (die stehen als eigene
// Buchung im Weinbuch) und ohne stornierte Umzüge bzw. Behandlungen.
//
// Grenze ist der ZEITPUNKT des Umzugs, nicht nur der Tag (UAT 19.11.2026: Schönung und Teilumzug am selben Tag):
// früherer Tag = vorher; am selben Tag entscheidet der Erfassungszeitpunkt (Behandlung vor bzw. gleichzeitig mit dem
// Umzug erfasst); fehlt einer der Zeitpunkte (Altdaten), zählt die Behandlung des Tages mit.
//
// Ein Umzug steht entweder in einer Zeile (von_ und nach_weinausbau_id) oder als Buchung aus Quell- und Zielzeile
// (umzug_batch_id; die Zielzeile kennt nur die neue Charge, die Quellzeile nur die alte).
//
// Ohne '@/'-Importe, damit node:test die Datei prüfen kann; läuft mit Server- und Browser-Client.

// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/wein/leseBilanz.ts)
import { alle, inBloecken } from '../supabase/alle.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

/** Umzug, durch den Wein aus `quelle` in die Charge `ziel` kam */
export type VgUmzug = { ziel: string; quelle: string; datum: string; zeitpunkt: string | null }

export type VorgeschichteZeile = {
  /** Kellerbehandlung der Ursprungscharge (Zeile aus keller_behandlungen) */
  behandlung: R
  chargeId: string
  /** Name der Ursprungscharge */
  charge: string
  /** Tag des Umzugs, bis zu dem die Behandlungen übernommen sind */
  bis: string
}

/** Wie weit die Kette der Ursprungschargen zurückverfolgt wird */
export const VORGESCHICHTE_TIEFE = 10

const tagVon = (x: unknown) => String(x ?? '').slice(0, 10)
const ms = (x: unknown) => (x ? Date.parse(String(x)) : NaN)

/** Liegt (Tag, Zeitpunkt) von a nicht nach b? Fehlt am selben Tag ein Zeitpunkt, gilt „nicht danach“. */
function nichtDanach(aTag: string, aZeit: unknown, bTag: string, bZeit: unknown): boolean {
  if (aTag !== bTag) return aTag < bTag
  const a = ms(aZeit), b = ms(bZeit)
  return Number.isNaN(a) || Number.isNaN(b) ? true : a <= b
}

/** Wurde die Behandlung vor dem Umzug (spätestens gleichzeitig) vorgenommen bzw. erfasst? */
export function vorDemUmzug(b: { datum?: unknown; created_at?: unknown }, u: Pick<VgUmzug, 'datum' | 'zeitpunkt'>): boolean {
  const bt = tagVon(b.datum)
  return bt !== '' && nichtDanach(bt, b.created_at, tagVon(u.datum), u.zeitpunkt)
}

/**
 * Übernommene Behandlungen einer Charge: je Umzug in die Charge die Behandlungen der Ursprungscharge bis zum Umzug,
 * dazu deren eigene Vorgeschichte (nur Umzüge, die nicht nach dem betrachteten Umzug liegen). Jede Behandlung einmal,
 * aufsteigend nach Tag, Erfassungszeitpunkt, id.
 */
export function vorgeschichteAus(
  chargeId: string, umzuege: readonly VgUmzug[], behandlungen: readonly R[], namen: ReadonlyMap<string, string>,
): VorgeschichteZeile[] {
  const jeZiel = new Map<string, VgUmzug[]>()
  for (const u of umzuege) if (u.quelle && u.ziel && u.quelle !== u.ziel) jeZiel.set(u.ziel, [...(jeZiel.get(u.ziel) ?? []), u])
  const jeCharge = new Map<string, R[]>()
  for (const b of behandlungen) if (b.weinausbau_id) jeCharge.set(String(b.weinausbau_id), [...(jeCharge.get(String(b.weinausbau_id)) ?? []), b])
  const gesehen = new Set<string>()
  const out: VorgeschichteZeile[] = []
  const gehe = (ziel: string, grenze: VgUmzug | null, pfad: readonly string[]) => {
    if (pfad.length > VORGESCHICHTE_TIEFE) return
    for (const u of jeZiel.get(ziel) ?? []) {
      if (pfad.includes(u.quelle)) continue   // kein Kreis (Wein, der zurück umgezogen wurde)
      if (grenze && !nichtDanach(tagVon(u.datum), u.zeitpunkt, tagVon(grenze.datum), grenze.zeitpunkt)) continue
      for (const b of jeCharge.get(u.quelle) ?? []) {
        if (gesehen.has(String(b.id)) || !vorDemUmzug(b, u)) continue
        gesehen.add(String(b.id))
        out.push({ behandlung: b, chargeId: u.quelle, charge: namen.get(u.quelle) ?? 'Ursprungscharge', bis: tagVon(u.datum) })
      }
      gehe(u.quelle, u, [...pfad, u.quelle])
    }
  }
  gehe(chargeId, null, [chargeId])
  return out.sort((a, b) => tagVon(a.behandlung.datum).localeCompare(tagVon(b.behandlung.datum))
    || String(a.behandlung.created_at ?? '').localeCompare(String(b.behandlung.created_at ?? ''))
    || String(a.behandlung.id).localeCompare(String(b.behandlung.id)))
}

/** Umzüge (beide Schreibweisen) in die Form Ziel ← Quelle bringen */
export function umzuegeAus(zielZeilen: readonly R[], quellZeilen: readonly R[]): VgUmzug[] {
  const quellenJeBuchung = new Map<string, string[]>()
  for (const q of quellZeilen) {
    if (!q.umzug_batch_id || !q.von_weinausbau_id) continue
    quellenJeBuchung.set(String(q.umzug_batch_id), [...(quellenJeBuchung.get(String(q.umzug_batch_id)) ?? []), String(q.von_weinausbau_id)])
  }
  const out: VgUmzug[] = []
  for (const z of zielZeilen) {
    if (!z.nach_weinausbau_id) continue
    const quellen = z.von_weinausbau_id ? [String(z.von_weinausbau_id)] : (z.umzug_batch_id ? quellenJeBuchung.get(String(z.umzug_batch_id)) ?? [] : [])
    for (const quelle of new Set(quellen)) {
      if (quelle !== String(z.nach_weinausbau_id)) out.push({ ziel: String(z.nach_weinausbau_id), quelle, datum: tagVon(z.datum), zeitpunkt: (z.erstellt_am as string | null) ?? null })
    }
  }
  return out
}

type Ergebnis<T> = { data: T; error: null } | { data: null; error: string }

/** Übernommene Kellerbehandlungen je Charge laden (Kette der Ursprungschargen, ohne Verschnitte und Stornierte) */
export async function ladeBehandlungVorgeschichte(
  supabase: Client, tenantId: string, chargeIds: readonly string[],
): Promise<Ergebnis<Map<string, VorgeschichteZeile[]>>> {
  const umzuege: VgUmzug[] = []
  const bekannt = new Set<string>(chargeIds)
  let offen = [...new Set(chargeIds)]
  for (let stufe = 0; stufe < VORGESCHICHTE_TIEFE && offen.length > 0; stufe++) {
    // inBloecken + alle(): Umzüge in die Chargen vollständig – sonst fehlte ein Teil der Vorgeschichte
    const ziel = await inBloecken<R>(offen, b => alle<R>(supabase.from('keller_umzuege')
      .select('id, datum, erstellt_am, umzug_batch_id, von_weinausbau_id, nach_weinausbau_id')
      .eq('tenant_id', tenantId).in('nach_weinausbau_id', b).eq('verschnitt', false).is('storniert_am', null).order('id')))
    if (ziel.error) return { data: null, error: `Die Umzüge der Charge konnten nicht geladen werden (${ziel.error.message}) – übernommene Kellerbehandlungen fehlen` }
    const zielZeilen = (ziel.data ?? []) as R[]
    const buchungen = [...new Set(zielZeilen.filter(z => !z.von_weinausbau_id && z.umzug_batch_id).map(z => String(z.umzug_batch_id)))]
    let quellZeilen: R[] = []
    if (buchungen.length > 0) {
      const quelle = await inBloecken<R>(buchungen, b => alle<R>(supabase.from('keller_umzuege')
        .select('id, umzug_batch_id, von_weinausbau_id')
        .eq('tenant_id', tenantId).in('umzug_batch_id', b).eq('zeilen_typ', 'quelle').is('storniert_am', null).order('id')))
      if (quelle.error) return { data: null, error: `Die Umzüge der Charge konnten nicht geladen werden (${quelle.error.message}) – übernommene Kellerbehandlungen fehlen` }
      quellZeilen = (quelle.data ?? []) as R[]
    }
    const neu = umzuegeAus(zielZeilen, quellZeilen)
    umzuege.push(...neu)
    offen = [...new Set(neu.map(u => u.quelle))].filter(id => !bekannt.has(id))
    for (const id of offen) bekannt.add(id)
  }
  const leer = new Map<string, VorgeschichteZeile[]>(chargeIds.map(id => [id, []]))
  const quellen = [...new Set(umzuege.map(u => u.quelle))]
  if (quellen.length === 0) return { data: leer, error: null }

  const [beh, wa] = await Promise.all([
    // inBloecken + alle(): Behandlungen der Ursprungschargen vollständig (Aufzeichnung für die Behörde)
    inBloecken<R>(quellen, b => alle<R>(supabase.from('keller_behandlungen')
      .select('id, weinausbau_id, datum, created_at, typ_name_snapshot, menge, einheit, volumen_liter_ist, notizen, typ:typ_id(name)')
      .eq('tenant_id', tenantId).in('weinausbau_id', b).is('pressung_id', null).is('storniert_am', null).order('id'))),
    inBloecken<R>(quellen, b => alle<R>(supabase.from('weinausbau').select('id, name').eq('tenant_id', tenantId).in('id', b).order('id'))),
  ])
  if (beh.error) return { data: null, error: `Die Kellerbehandlungen der Ursprungscharge konnten nicht geladen werden (${beh.error.message})` }
  if (wa.error) return { data: null, error: `Die Ursprungscharge konnte nicht geladen werden (${wa.error.message})` }
  const namen = new Map<string, string>(((wa.data ?? []) as R[]).map(c => [String(c.id), String(c.name ?? 'Ursprungscharge')]))
  for (const id of chargeIds) leer.set(id, vorgeschichteAus(id, umzuege, (beh.data ?? []) as R[], namen))
  return { data: leer, error: null }
}
