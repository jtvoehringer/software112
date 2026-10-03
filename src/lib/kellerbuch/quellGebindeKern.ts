// ── Quellgebinde eines Verschnitts – reiner Kern (KAN-77, 03.10.2026) ─────────────────────────────────────────
//
// BKI-Termin (R2): „Herkunft des Verschnitts nicht erkennbar (kommt aus Stahltank 03)“. Bisher nannten
// Chargen-Seite, Weinbuch und Bewegungsbuch das HEUTIGE Gebinde der Quell-Charge. Hier wird das Gebinde am Tag
// des Verschnitts bestimmt – ohne Migration, nur aus den Umzügen (keller_umzuege):
//   • gebindeAmTag(): Gebinde einer Charge am Tag D = nach_behaelter_id des letzten nicht stornierten Umzugs
//     IN die Charge mit datum ≤ D (Gleichstand: Erfassungszeit); sonst von_behaelter_id des ersten Umzugs AUS
//     der Charge nach D; sonst ihr heutiges Gebinde (weinausbau.behaelter_id).
//   • Zwischencharge: liegt die Quelle am Tag D im selben Gebinde wie das Ziel (Ticket: Zwischencharge im
//     Ziel-Tank Stahltank 04, der Wein kam aber aus Stahltank 03), ist das Quellgebinde das Herkunftsgebinde
//     des letzten Umzugs in die Quelle (von_behaelter_id; bei n:m-Umzügen das eindeutige Gebinde der Quellzeilen).
//
// Ohne '@/'-Importe (node:test). Der Lader steht in quellGebinde.ts; KAN-112 nutzt ihn später mit.

export type UmzugGebinde = {
  id: string
  datum: string | null
  erstellt_am?: string | null
  von_weinausbau_id: string | null
  nach_weinausbau_id: string | null
  von_behaelter_id: string | null
  nach_behaelter_id: string | null
  umzug_batch_id?: string | null
  zeilen_typ?: string | null
  umzug_typ?: string | null
  storniert_am?: string | null
}

export type VerschnittGebinde = {
  id: string
  datum: string | null
  ziel_weinausbau_id: string | null
  quellen: { quell_weinausbau_id: string | null }[]
}

export type Quellgebinde = { behaelterId: string; name: string | null }

const tagVon = (v: string | null | undefined) => (v ?? '').slice(0, 10)
const aktiv = (u: UmzugGebinde) => !u.storniert_am   // auch Schwundbuchungen zeigen, wo die Charge lag

/** Reihenfolge Datum, dann Erfassungszeit, dann ID */
function frueher(a: UmzugGebinde, b: UmzugGebinde): number {
  const da = tagVon(a.datum), db = tagVon(b.datum)
  if (da !== db) return da < db ? -1 : 1
  const ea = a.erstellt_am ?? '', eb = b.erstellt_am ?? ''
  if (ea !== eb) return ea < eb ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Letzter nicht stornierter Umzug IN die Charge mit datum ≤ D (oder null) */
export function letzterUmzugIn(chargeId: string, datum: string, umzuege: readonly UmzugGebinde[]): UmzugGebinde | null {
  const d = tagVon(datum)
  const treffer = umzuege.filter(u => aktiv(u) && u.nach_weinausbau_id === chargeId && tagVon(u.datum) <= d).sort(frueher)
  return treffer[treffer.length - 1] ?? null
}

/** Gebinde (behaelter_id) einer Charge am Tag `datum` – siehe Dateikopf */
export function gebindeAmTag(
  chargeId: string, datum: string, umzuege: readonly UmzugGebinde[], aktuellesGebinde: string | null,
): string | null {
  const ein = letzterUmzugIn(chargeId, datum, umzuege)
  if (ein?.nach_behaelter_id) return ein.nach_behaelter_id
  const d = tagVon(datum)
  const aus = umzuege.filter(u => aktiv(u) && u.von_weinausbau_id === chargeId && tagVon(u.datum) > d && u.von_behaelter_id).sort(frueher)
  if (aus.length > 0) return aus[0].von_behaelter_id
  return aktuellesGebinde
}

/** Herkunftsgebinde eines Umzugs: von_behaelter_id, bei n:m-Zielzeilen das eindeutige Gebinde der Quellzeilen */
export function herkunftsGebinde(u: UmzugGebinde, umzuege: readonly UmzugGebinde[]): string | null {
  if (u.von_behaelter_id) return u.von_behaelter_id
  if (!u.umzug_batch_id) return null
  const quellen = new Set(umzuege
    .filter(q => q.umzug_batch_id === u.umzug_batch_id && q.zeilen_typ === 'quelle' && !q.storniert_am && q.von_behaelter_id)
    .map(q => q.von_behaelter_id as string))
  return quellen.size === 1 ? [...quellen][0] : null
}

/** Quellgebinde (behaelter_id) einer Quell-Charge im Verschnitt am Tag `datum` in die Ziel-Charge */
export function quellGebindeId(
  quellId: string, zielId: string | null, datum: string, umzuege: readonly UmzugGebinde[],
  aktuellesGebinde: (chargeId: string) => string | null,
): string | null {
  const quelle = gebindeAmTag(quellId, datum, umzuege, aktuellesGebinde(quellId))
  if (!zielId) return quelle
  const ziel = gebindeAmTag(zielId, datum, umzuege, aktuellesGebinde(zielId))
  if (quelle && ziel && quelle === ziel) {
    // Zwischencharge im Ziel-Gebinde: der Wein kam mit dem letzten Umzug in die Quelle
    const ein = letzterUmzugIn(quellId, datum, umzuege)
    // Altdaten ohne von_behaelter_id: Gebinde der Vorgänger-Charge an jenem Tag
    const herkunft = !ein ? null : herkunftsGebinde(ein, umzuege)
      ?? (ein.von_weinausbau_id ? gebindeAmTag(ein.von_weinausbau_id, tagVon(ein.datum), umzuege, aktuellesGebinde(ein.von_weinausbau_id)) : null)
    if (herkunft) return herkunft
  }
  return quelle
}

export const quellGebindeSchluessel = (verschneidungId: string, quellWeinausbauId: string) => `${verschneidungId}:${quellWeinausbauId}`

/**
 * Quellgebinde aller Quellen der Verschnitte – Schlüssel `${verschneidungId}:${quellWeinausbauId}`.
 * `gebindeJeCharge` = heutiges Gebinde je Charge, `behaelterNamen` = Name je Gebinde.
 */
export function quellGebindeAusDaten(
  verschneidungen: readonly VerschnittGebinde[], umzuege: readonly UmzugGebinde[],
  gebindeJeCharge: ReadonlyMap<string, string | null>, behaelterNamen: ReadonlyMap<string, string>,
): Map<string, Quellgebinde> {
  const out = new Map<string, Quellgebinde>()
  const aktuell = (id: string) => gebindeJeCharge.get(id) ?? null
  for (const v of verschneidungen) {
    const datum = tagVon(v.datum)
    for (const q of v.quellen ?? []) {
      if (!q.quell_weinausbau_id) continue
      const id = quellGebindeId(q.quell_weinausbau_id, v.ziel_weinausbau_id, datum, umzuege, aktuell)
      if (id) out.set(quellGebindeSchluessel(v.id, q.quell_weinausbau_id), { behaelterId: id, name: behaelterNamen.get(id) ?? null })
    }
  }
  return out
}

/** „Grüner Veltliner Sandgrube (Stahltank 03) · 48 L“ – Anzeige einer Verschnitt-Quelle (KAN-77) */
export function verschnittQuelleText(name: string | null | undefined, gebinde: string | null | undefined, liter: string | null): string {
  return `${name ?? '?'}${gebinde ? ` (${gebinde})` : ''}${liter ? ` · ${liter}` : ''}`
}
