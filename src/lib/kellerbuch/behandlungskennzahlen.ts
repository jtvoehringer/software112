// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// ── Behandlungskennzahlen je Charge für die BKI-Schnittstelle (KAN-276, 10.10.2026) ──────────────────────────
//
// Die Blätter Lagerstand, Lagerbewegungen, RV zum Eingang und RV zum Ausgang führen je Posten die Spalten Anreicherung
// kg/hl, Süßung g/lt, Konzentrierung %, Entsäuerung g/lt, Säuerung g/lt und Alkoholkorrektur %vol. Quelle sind die
// Kellerbehandlungen der Charge samt der Verwendung im Stoffkonto (KAN-107; Art des Stoffs seit KAN-45). Kumuliert bis
// zum Datum der Zeile (Stichtag bzw. Buchungstag). Isomorph (node:test).
//
// Annahmen (am Ticket KAN-276 dokumentiert, Fragen an die BKI unter KAN-38):
//   B1 Zuordnung: Stoff der Art Zucker, RTK oder KTM → Süßung, wenn der Behandlungstyp nach Süßung klingt (süß, Dosage,
//      Süßreserve), sonst Anreicherung; Säuerungs- bzw. Entsäuerungsmittel → Säuerung bzw. Entsäuerung. Ohne Stoff
//      entscheidet der Name des Behandlungstyps (Anreicherung/Zucker, Süßung, Konzentrierung/Umkehrosmose/Kryo,
//      Säuerung, Entsäuerung, Alkohol). „Säurekorrektur“ ohne Stoff ist nicht eindeutig → Hinweis, kein Wert.
//   B2 Menge: Masse des Mittels je Volumen der Charge bei der Behandlung (Ist-Volumen der Behandlung, sonst Menge der
//      Charge heute – Hinweis). Anreicherung und Süßung als Zucker-Äquivalent (Entscheidung Jörgen 10.10.2026): Zucker und
//      RTK-Pulver 1:1, RTK flüssig und KTM mit 65 % Zucker (≈ 65 °Brix), in Litern mit 1,32 kg/l, also 0,858 kg Zucker je
//      Liter. Mengen, die
//      schon je Volumen erfasst sind (g/l, kg/hl), gehen direkt ein. Konzentrierung und Alkoholkorrektur nur aus Mengen in
//      % bzw. %vol.
//   B3 Kumuliert: Summe der Werte aller Behandlungen der Charge bis zum Datum. Behandlungen von Vorgänger-Chargen (vor
//      einem Umzug in eine neue Charge oder einem Verschnitt) werden nicht vererbt – das folgt mit der Genealogie aus dem
//      Bewegungsjournal (2027, KAN-276 Punkt 1).
//   B4 Stornierte Behandlungen und stornierte Stoffbuchungen zählen nicht.

export type KennzahlArt = 'anreicherung' | 'suessung' | 'konzentrierung' | 'entsaeuerung' | 'saeuerung' | 'alkoholkorrektur'

export const KENNZAHL_ARTEN: readonly KennzahlArt[] = ['anreicherung', 'suessung', 'konzentrierung', 'entsaeuerung', 'saeuerung', 'alkoholkorrektur']

export type Behandlungskennzahlen = Record<KennzahlArt, number | null>

/** Eine Behandlung bzw. Stoffverwendung einer Charge */
export type KennzahlBehandlung = {
  id: string
  weinausbauId: string
  datum: string
  /** Name des Behandlungstyps bzw. Zweck der Stoffbuchung */
  typName: string | null
  menge: number | null
  einheit: string | null
  /** Ist-Volumen der Charge bei der Behandlung (Liter) */
  volumenLiter: number | null
  stoffArt?: string | null
  stoffEinheit?: string | null
  /** verwendete Stoffmenge (positiv) */
  stoffMenge?: number | null
}

/** B2: Dichte für Liter-Stoffe (RTK flüssig, KTM ≈ 65 °Brix) */
export const DICHTE_KONZENTRAT_KG_JE_L = 1.32
/** B2: Zuckergehalt (Masseanteil) je Stoffart für das Zucker-Äquivalent */
export const ZUCKERGEHALT: Readonly<Record<string, number>> = { zucker: 1, rtk_pulver: 1, rtk_fluessig: 0.65, ktm: 0.65 }

const SUESS = /s(ü|ue)(ß|ss)|dosage/i
const ZUCKER_ARTEN = new Set(['zucker', 'rtk_fluessig', 'rtk_pulver', 'ktm'])

/** B1: Kennzahl einer Behandlung (null = keine bzw. nicht eindeutig) */
export function kennzahlArt(b: Pick<KennzahlBehandlung, 'typName' | 'stoffArt'>): KennzahlArt | null {
  const n = b.typName ?? ''
  if (b.stoffArt && ZUCKER_ARTEN.has(b.stoffArt)) return SUESS.test(n) ? 'suessung' : 'anreicherung'
  if (b.stoffArt === 'saeuerungsmittel') return 'saeuerung'
  if (b.stoffArt === 'entsaeuerungsmittel') return 'entsaeuerung'
  if (/entalkohol|alkohol/i.test(n)) return 'alkoholkorrektur'
  if (/konzentr|umkehrosmose|kryo/i.test(n)) return 'konzentrierung'
  if (/ents(ä|ae)uer/i.test(n)) return 'entsaeuerung'
  if (/s(ä|ae)urekorrektur/i.test(n)) return null
  if (/s(ä|ae)uer/i.test(n)) return 'saeuerung'
  if (SUESS.test(n)) return 'suessung'
  if (/anreicher|zucker|chaptal|saccharose/i.test(n)) return 'anreicherung'
  return null
}

/** Ist der Behandlungstyp eine Kennzahl, aber nicht eindeutig (B1 „Säurekorrektur“)? */
export function kennzahlUnklar(b: Pick<KennzahlBehandlung, 'typName' | 'stoffArt'>): boolean {
  return !b.stoffArt && /s(ä|ae)urekorrektur/i.test(b.typName ?? '')
}

const norm = (e: string | null | undefined) => (e ?? '').toLowerCase().replace(/\s+/g, '')

/** Masse in kg aus Menge und Einheit (null = keine Masse) */
function masseKg(menge: number, einheit: string | null | undefined, stoffArt: string | null | undefined): number | null {
  const e = norm(einheit)
  if (e === 'kg') return menge
  if (e === 'g') return menge / 1000
  if (e === 'mg') return menge / 1e6
  if ((e === 'l' || e === 'lt' || e === 'liter') && stoffArt && ZUCKER_ARTEN.has(stoffArt) && stoffArt !== 'zucker') return menge * DICHTE_KONZENTRAT_KG_JE_L
  return null
}

/** B2: Masse als Zucker-Äquivalent (Anreicherung, Süßung); andere Stoffe unverändert */
function zuckerAequivalent(kg: number, art: KennzahlArt, stoffArt: string | null | undefined): number {
  if ((art !== 'anreicherung' && art !== 'suessung') || !stoffArt) return kg
  return kg * (ZUCKERGEHALT[stoffArt] ?? 1)
}

/** B2: Wert einer Behandlung in der Einheit ihrer Kennzahl (null = nicht bestimmbar) */
export function kennzahlWert(b: KennzahlBehandlung, art: KennzahlArt): number | null {
  if (art === 'konzentrierung' || art === 'alkoholkorrektur') {
    const e = norm(b.einheit)
    return b.menge != null && (e === '%' || e === '%vol' || e === 'vol%') ? b.menge : null
  }
  // schon je Volumen erfasst
  const e = norm(b.einheit)
  if (b.menge != null && !b.stoffMenge) {
    if (e === 'kg/hl') return art === 'anreicherung' ? b.menge : b.menge * 10
    if (e === 'g/l' || e === 'g/lt') return art === 'anreicherung' ? b.menge / 10 : b.menge
  }
  const kg = b.stoffMenge != null && b.stoffMenge > 0
    ? masseKg(b.stoffMenge, b.stoffEinheit, b.stoffArt)
    : b.menge != null ? masseKg(b.menge, b.einheit, b.stoffArt) : null
  if (kg == null || !b.volumenLiter || b.volumenLiter <= 0) return null
  const z = zuckerAequivalent(kg, art, b.stoffArt)
  return art === 'anreicherung' ? z / (b.volumenLiter / 100) : z * 1000 / b.volumenLiter
}

const LEER: Behandlungskennzahlen = { anreicherung: null, suessung: null, konzentrierung: null, entsaeuerung: null, saeuerung: null, alkoholkorrektur: null }

/** B3: Kennzahlen einer Charge kumuliert bis einschließlich `bis` (null = ohne Datumsgrenze) */
export function kennzahlenBis(behandlungen: readonly KennzahlBehandlung[], weinausbauId: string | null | undefined, bis: string | null): Behandlungskennzahlen {
  if (!weinausbauId) return { ...LEER }
  const aus: Behandlungskennzahlen = { ...LEER }
  for (const b of behandlungen) {
    if (b.weinausbauId !== weinausbauId || (bis && b.datum > bis)) continue
    const art = kennzahlArt(b)
    if (!art) continue
    const w = kennzahlWert(b, art)
    if (w == null) continue
    aus[art] = rund((aus[art] ?? 0) + w, 3)
  }
  return aus
}

/** Index je Charge (für viele Zeilen) */
export function kennzahlenIndex(behandlungen: readonly KennzahlBehandlung[]): (weinausbauId: string | null | undefined, bis: string | null) => Behandlungskennzahlen {
  const je = new Map<string, KennzahlBehandlung[]>()
  for (const b of behandlungen) (je.get(b.weinausbauId) ?? je.set(b.weinausbauId, []).get(b.weinausbauId)!).push(b)
  return (id, bis) => (id ? kennzahlenBis(je.get(id) ?? [], id, bis) : { ...LEER })
}

/** Hinweise zu Behandlungen, die eine Kennzahl wären, aber keinen Wert ergeben */
export function kennzahlHinweise(behandlungen: readonly KennzahlBehandlung[], mitSchaetzvolumen = 0): string[] {
  const unklar = behandlungen.filter(kennzahlUnklar).length
  const ohneWert = behandlungen.filter(b => { const a = kennzahlArt(b); return a !== null && kennzahlWert(b, a) == null }).length
  const h: string[] = []
  if (unklar > 0) h.push(`${unklar} Behandlung(en) „Säurekorrektur“ ohne Stoff aus dem Stoffkonto – nicht als Säuerung oder Entsäuerung zuordenbar, bitte Stoff angeben.`)
  if (ohneWert > 0) h.push(`${ohneWert} Behandlung(en) ohne verwertbare Menge bzw. Einheit (kg, g, l bei RTK/KTM, g/l, kg/hl, %, %vol) oder ohne Volumen – in den Kennzahlen nicht enthalten.`)
  if (mitSchaetzvolumen > 0) h.push(`${mitSchaetzvolumen} Behandlung(en) ohne Ist-Volumen – Kennzahl auf die heutige Menge der Charge bezogen.`)
  return h
}

/** Behandlungen aus geladenen Zeilen (keller_behandlungen samt Typ, kellermittel_buchungen samt Stoff) zusammenführen */
export function kennzahlBehandlungen(
  behandlungen: readonly Record<string, unknown>[], stoffbuchungen: readonly Record<string, unknown>[], chargenLiter: ReadonlyMap<string, number>,
): { liste: KennzahlBehandlung[]; mitSchaetzvolumen: number } {
  const zahl = (v: unknown) => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)
  const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const storniert = new Set(stoffbuchungen.map(s => str(s.storno_von_id)).filter(Boolean) as string[])
  const verwendung = stoffbuchungen.filter(s => s.art === 'verwendung' && !s.storno_von_id && !storniert.has(String(s.id)))
  const jeBehandlung = new Map<string, Record<string, unknown>>()
  for (const s of verwendung) if (s.keller_behandlung_id) jeBehandlung.set(String(s.keller_behandlung_id), s)
  let mitSchaetzvolumen = 0
  const volumen = (ist: unknown, charge: string) => {
    const v = zahl(ist)
    if (v && v > 0) return v
    const heute = chargenLiter.get(charge) ?? null
    return heute
  }
  const liste: KennzahlBehandlung[] = []
  for (const b of behandlungen) {
    const charge = str(b.weinausbau_id)
    if (!charge || b.storniert_am) continue
    const s = jeBehandlung.get(String(b.id))
    const stoff = (s?.kellermittel ?? null) as Record<string, unknown> | null
    const k: KennzahlBehandlung = {
      id: String(b.id), weinausbauId: charge, datum: String(b.datum ?? '').slice(0, 10),
      typName: str((b.typ as Record<string, unknown> | null)?.name) ?? str(b.typ_name_snapshot),
      menge: zahl(b.menge), einheit: str(b.einheit), volumenLiter: volumen(b.volumen_liter_ist, charge),
      stoffArt: str(stoff?.art), stoffEinheit: str(stoff?.einheit), stoffMenge: s ? Math.abs(zahl(s.menge) ?? 0) : null,
    }
    if (!(zahl(b.volumen_liter_ist) ?? 0) && kennzahlArt(k)) mitSchaetzvolumen++
    liste.push(k)
  }
  // Stoffverwendungen ohne Behandlung (direkt im Stoffkonto gebucht)
  for (const s of verwendung) {
    const charge = str(s.weinausbau_id)
    if (s.keller_behandlung_id || !charge) continue
    const stoff = (s.kellermittel ?? null) as Record<string, unknown> | null
    const k: KennzahlBehandlung = {
      id: `stoff:${s.id}`, weinausbauId: charge, datum: String(s.datum ?? '').slice(0, 10), typName: str(s.zweck),
      menge: null, einheit: null, volumenLiter: chargenLiter.get(charge) ?? null,
      stoffArt: str(stoff?.art), stoffEinheit: str(stoff?.einheit), stoffMenge: Math.abs(zahl(s.menge) ?? 0),
    }
    if (kennzahlArt(k)) mitSchaetzvolumen++
    liste.push(k)
  }
  return { liste, mitSchaetzvolumen }
}
