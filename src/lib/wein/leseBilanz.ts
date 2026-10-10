// ── kg-Bilanz je Lese (KAN-129 Soll 3, Entscheidung Jörgen 29.09.2026: je Lese, serverseitig sperren) ─────────
//
// Je Lese und Ort (Grundstück, zusätzlich der ganze Ried): gelesen (ernte_parzellen) ≥ verpresst (pressung_weingaerten
// der Pressungen dieser Lese, ohne Zukauf-Zeilen) + als Trauben verkauft (traubenverkauf dieser Lese).
//
// Gesperrt wird nur eine VERSCHLECHTERUNG an einem Ort, den die Speicherung berührt: Eine bestehende Überdeckung
// (Altdaten) blockiert keine andere Änderung. Orte ohne Lese-Eintrag mit Menge sperren nicht (Ticket: „Orte ohne
// Eintrag oder mit menge_kg NULL sperren nicht“) – dort fehlt die Lesemenge noch, die Pressung ist die erste Angabe.
//
// Ohne '@/'-Importe und ohne JSX, damit node:test sie prüfen kann; der Lader nimmt den Supabase-Client entgegen.

/** Toleranz gegen Rundung (kg) – wie pruefeLesemengeGedeckt */
// @ts-expect-error TS5097 – Pfad mit .ts-Endung für node:test (wie lib/buchhaltung/bmd.ts)
import { alle, inBloecken } from '../supabase/alle.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { rund } from '../zahl/runden.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { zahlLokal } from '../format.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'
export const KG_TOLERANZ = 0.01

export type Mengenzeile = { weingarten_id: string | null; grundstueck_id: string | null; kg: number }

export type GelesenZeile = Omit<Mengenzeile, 'kg'> & { kg: number | null }

export type OrtName = { ried: string | null; gstNr: string | null }

export type Ueberdeckung = {
  art: 'gst' | 'ried'
  weingarten_id: string
  grundstueck_id: string | null
  gelesenKg: number
  /** verpresst + verkauft NACH der Speicherung */
  verbrauchtKg: number
}

function summe(zeilen: readonly Mengenzeile[], passt: (z: Mengenzeile) => boolean): number {
  return zeilen.reduce((s, z) => s + (passt(z) ? (Number(z.kg) || 0) : 0), 0)
}

/**
 * Überdeckungen, die eine Speicherung neu verursacht oder verschlimmert.
 * - gelesen: Lese-Einträge der Lese (kg NULL zählt als „keine Menge“, 0 kg als Menge)
 * - andere: Verbrauch der Lese OHNE den gespeicherten Vorgang (andere Pressungen, Verkäufe)
 * - vorher / nachher: Zeilen des gespeicherten Vorgangs vor und nach der Speicherung (neu: vorher leer)
 */
export function neueUeberdeckungen(p: {
  gelesen: readonly GelesenZeile[]
  andere: readonly Mengenzeile[]
  vorher: readonly Mengenzeile[]
  nachher: readonly Mengenzeile[]
}): Ueberdeckung[] {
  const mitMenge = p.gelesen.filter(z => z.kg !== null && z.kg !== undefined) as Mengenzeile[]
  const orte = new Map<string, { art: 'gst' | 'ried'; wg: string; gst: string | null }>()
  for (const z of p.nachher) {
    if (!z.weingarten_id) continue   // Zukauf-Zeilen gehören keiner Lese
    orte.set(`ried:${z.weingarten_id}`, { art: 'ried', wg: z.weingarten_id, gst: null })
    if (z.grundstueck_id) orte.set(`gst:${z.grundstueck_id}`, { art: 'gst', wg: z.weingarten_id, gst: z.grundstueck_id })
  }
  const out: Ueberdeckung[] = []
  for (const o of orte.values()) {
    const passt = (z: Mengenzeile) => (o.art === 'gst' ? z.grundstueck_id === o.gst : z.weingarten_id === o.wg)
    if (!mitMenge.some(passt)) continue   // Ort ohne Lesemenge sperrt nicht
    const gelesenKg = summe(mitMenge, passt)
    const andere = summe(p.andere, passt)
    const nachher = andere + summe(p.nachher, passt)
    const vorher = andere + summe(p.vorher, passt)
    if (nachher > gelesenKg + KG_TOLERANZ && nachher > vorher + KG_TOLERANZ) {
      out.push({ art: o.art, weingarten_id: o.wg, grundstueck_id: o.gst, gelesenKg, verbrauchtKg: nachher })
    }
  }
  // GST vor Ried – die genauere Meldung zuerst
  return out.sort((a, b) => (a.art === b.art ? 0 : a.art === 'gst' ? -1 : 1))
}

/** Schlüssel der Maps von verfuegbarJeLese: `<lese_id>|<weingarten_id bzw. grundstueck_id>` */
export function leseOrtSchluessel(leseId: string, ortId: string): string {
  return `${leseId}|${ortId}`
}

/**
 * Verfügbare kg je Lese und Ort (Ticket Soll 3: eine Funktion für Jahrgangsseite, Weinhandel und
 * Verkauf-Stammdaten): gelesen − verpresst − verkauft, nie negativ. Nur Orte mit Lesemenge erscheinen.
 * `ohneVerkaufId` nimmt einen Traubenverkauf heraus (Bearbeiten: seine Menge steht wieder zur Verfügung).
 */
export function verfuegbarJeLese(
  gelesen: readonly (GelesenZeile & { lese_id: string | null })[],
  verbraucht: readonly (Mengenzeile & { lese_id: string | null; verkauf_id?: string | null })[],
  ohneVerkaufId: string | null = null,
): { ried: Map<string, number>; gst: Map<string, number> } {
  const ried = new Map<string, number>()
  const gst = new Map<string, number>()
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
  for (const z of gelesen) {
    if (!z.lese_id || !z.weingarten_id || z.kg === null || z.kg === undefined) continue
    add(ried, leseOrtSchluessel(z.lese_id, z.weingarten_id), Number(z.kg) || 0)
    if (z.grundstueck_id) add(gst, leseOrtSchluessel(z.lese_id, z.grundstueck_id), Number(z.kg) || 0)
  }
  for (const z of verbraucht) {
    if (!z.lese_id || !z.weingarten_id || (ohneVerkaufId && z.verkauf_id === ohneVerkaufId)) continue
    const kr = leseOrtSchluessel(z.lese_id, z.weingarten_id)
    if (ried.has(kr)) add(ried, kr, -(Number(z.kg) || 0))
    if (z.grundstueck_id) {
      const kg = leseOrtSchluessel(z.lese_id, z.grundstueck_id)
      if (gst.has(kg)) add(gst, kg, -(Number(z.kg) || 0))
    }
  }
  for (const m of [ried, gst]) for (const [k, v] of m) m.set(k, Math.max(0, rund(v, 2)))
  return { ried, gst }
}

function kgText(n: number): string {
  return `${zahlLokal((rund(n, 1)), { maximumFractionDigits: 1 })} kg`
}

/** Klartext der ersten Überdeckung, z. B. für eine Pressung oder einen Traubenverkauf */
export function ueberdeckungText(u: Ueberdeckung, namen: Map<string, OrtName>, leseName: string | null): string {
  const n = namen.get(u.grundstueck_id ?? u.weingarten_id) ?? namen.get(u.weingarten_id)
  const ried = n?.ried ?? 'dieser Ried'
  const stelle = u.art === 'gst' ? `GST ${n?.gstNr ?? '–'} (${ried})` : `der Ried „${ried}“`
  return `Von ${stelle} sind ${leseName ? `in der Lese ${leseName} ` : ''}nur ${kgText(u.gelesenKg)} gelesen – verpresst `
    + `bzw. als Trauben verkauft wären danach ${kgText(u.verbrauchtKg)}. Bitte die Menge prüfen oder zuerst die `
    + 'Lesedaten dieser Lese ergänzen.'
}

// ── Lader (Server) ─────────────────────────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type LeseVerbrauch = {
  gelesen: GelesenZeile[]
  /** Traubenzeilen der Pressungen dieser Lese (eigene Ernte), mit pressung_id */
  pressungszeilen: (Mengenzeile & { pressung_id: string })[]
  /** Traubenverkäufe dieser Lese (eigene Ernte), mit id */
  verkaeufe: (Mengenzeile & { id: string })[]
  namen: Map<string, OrtName>
}

/** Gelesenes und Verbrauchtes einer Lese laden (Betrieb über tenant_id, ernte_parzellen über die Lese) */
export async function ladeLeseVerbrauch(supabase: Client, tenantId: string, jahrgangId: string, leseId: string): Promise<LeseVerbrauch> {
  const [ep, pr, tv] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('ernte_parzellen') as any)
      .select('weingarten_id, grundstueck_id, menge_kg, weingarten:weingarten_id(name), grundstueck:grundstueck_id(gst_nr)')
      .eq('jahrgang_id', jahrgangId).eq('lese_id', leseId).is('storniert_am', null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pressungen') as any)
      .select('id').eq('jahrgang_id', jahrgangId).eq('lese_id', leseId).eq('tenant_id', tenantId).is('storniert_am', null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('traubenverkauf') as any)
      .select('id, weingarten_id, grundstueck_id, menge_kg')
      .eq('jahrgang_id', jahrgangId).eq('lese_id', leseId).eq('tenant_id', tenantId).is('storniert_am', null),
  ])
  for (const [tabelle, res] of [['ernte_parzellen', ep], ['pressungen', pr], ['traubenverkauf', tv]] as const) {
    if (res.error) throw new AktionsFehler(`Lesemenge konnte nicht geprüft werden (${tabelle}): ${res.error.message}`)
  }
  const pressIds = ((pr.data ?? []) as R[]).map(p => p.id as string)
  let pw: R[] = []
  if (pressIds.length > 0) {
    // inBloecken + alle(): Pressungen eines Jahrgangs, Summe der verpressten kg (URL-Grenze ≈ 350 IDs)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await inBloecken<R>(pressIds, b => alle<R>((supabase.from('pressung_weingaerten') as any)
      .select('pressung_id, weingarten_id, grundstueck_id, trauben_kg').in('pressung_id', b).not('weingarten_id', 'is', null).is('storniert_am', null).order('id')))
    if (error) throw new AktionsFehler(`Lesemenge konnte nicht geprüft werden (pressung_weingaerten): ${error.message}`)
    pw = (data ?? []) as R[]
  }
  const namen = new Map<string, OrtName>()
  const gelesen = ((ep.data ?? []) as R[]).map(z => {
    const ried = (z.weingarten as R | null)?.name ?? null
    namen.set(z.weingarten_id, { ried, gstNr: null })
    if (z.grundstueck_id) namen.set(z.grundstueck_id, { ried, gstNr: (z.grundstueck as R | null)?.gst_nr ?? null })
    return {
      weingarten_id: z.weingarten_id ?? null, grundstueck_id: z.grundstueck_id ?? null,
      kg: z.menge_kg === null || z.menge_kg === undefined ? null : Number(z.menge_kg),
    }
  })
  return {
    gelesen,
    pressungszeilen: pw.map(z => ({ pressung_id: z.pressung_id, weingarten_id: z.weingarten_id, grundstueck_id: z.grundstueck_id ?? null, kg: Number(z.trauben_kg) || 0 })),
    verkaeufe: ((tv.data ?? []) as R[]).filter(v => v.weingarten_id)
      .map(v => ({ id: v.id, weingarten_id: v.weingarten_id, grundstueck_id: v.grundstueck_id ?? null, kg: Number(v.menge_kg) || 0 })),
    namen,
  }
}

/**
 * Lese, der die Datenbank eine Zeile ohne lese_id zuordnen würde (Trigger a_lese_zuordnen): eine Lese → diese;
 * sonst die mit dem spätesten Beginn ≤ Datum (Beginn leer = 01.01. des Jahrgangs, bei Gleichstand die höhere Nr.);
 * sonst null (die Datenbank verlangt dann „bitte die Lese wählen“).
 */
export function leseFuerDatum<L extends { id: string; lfd_nr: number; beginn: string | null }>(
  lesen: readonly L[], jahrgang: number, datum: string | null,
): L | null {
  if (lesen.length === 1) return lesen[0]
  if (!datum) return null
  const tag = datum.slice(0, 10)
  const ab = (l: L) => (l.beginn ?? `${jahrgang}-01-01`).slice(0, 10)
  const kandidaten = lesen.filter(l => ab(l) <= tag)
    .sort((a, b) => (ab(b).localeCompare(ab(a))) || b.lfd_nr - a.lfd_nr)
  return kandidaten[0] ?? null
}

export type LeseKurz = { id: string; lfd_nr: number; beginn: string | null; art?: string | null }

/** Lesen eines Jahrgangs des Betriebs (Nummer und Beginn – für Zuordnung und Meldungen) */
export async function ladeLesenDesJahrgangs(supabase: Client, tenantId: string, jahrgangId: string): Promise<LeseKurz[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('lesen') as any)
    .select('id, lfd_nr, beginn, art').eq('jahrgang_id', jahrgangId).eq('tenant_id', tenantId).order('lfd_nr')
  if (error) throw new AktionsFehler(`Lesen konnten nicht geladen werden: ${error.message}`)
  return ((data ?? []) as R[]).map(l => ({ id: l.id as string, lfd_nr: Number(l.lfd_nr), beginn: (l.beginn as string | null) ?? null, art: (l.art as string | null) ?? null }))
}

/**
 * Deckung je Lese für einen gespeicherten Vorgang (Pressung oder Traubenverkauf): Fehlertext der ersten neuen
 * Überdeckung oder null. `ausnahme` = der Vorgang selbst (seine bisherigen Zeilen stehen in `vorher`).
 */
export async function leseDeckungFehler(
  supabase: Client, tenantId: string, jahrgangId: string, lese: LeseKurz, jahrgang: number,
  ausnahme: { pressungId?: string | null; verkaufId?: string | null },
  vorher: readonly Mengenzeile[], nachher: readonly Mengenzeile[],
): Promise<string | null> {
  if (!nachher.some(z => z.weingarten_id)) return null
  const v = await ladeLeseVerbrauch(supabase, tenantId, jahrgangId, lese.id)
  const andere: Mengenzeile[] = [
    ...v.pressungszeilen.filter(z => !ausnahme.pressungId || z.pressung_id !== ausnahme.pressungId),
    ...v.verkaeufe.filter(z => !ausnahme.verkaufId || z.id !== ausnahme.verkaufId),
  ]
  const ue = neueUeberdeckungen({ gelesen: v.gelesen, andere, vorher, nachher })
  return ue.length > 0 ? ueberdeckungText(ue[0], v.namen, `${jahrgang}/${lese.lfd_nr}`) : null
}

/**
 * Traubenverkauf (KAN-129, beide Erfassungswege): Jahrgang gehört zum Betrieb (N5), Lese bestimmen (bestehender
 * Verkauf im selben Jahrgang: seine Lese; sonst gewählte Lese aus dem Formular, sonst nach Datum wie die
 * Datenbank) und kg-Bilanz je Lese prüfen. Zukauf-Trauben und Verkäufe ohne Jahrgang haben keine Lese.
 */
export async function traubenverkaufLese(supabase: Client, tenantId: string, p: {
  jahrgangId: string | null; weingartenId: string | null; grundstueckId: string | null; zukaufPostenId: string | null
  datum: string | null; mengeKg: number; leseIdFormular: string | null
  alt?: { id: string; lese_id: string | null; jahrgang_id: string | null; weingarten_id: string | null; grundstueck_id: string | null; menge_kg: unknown } | null
  leseWaehlenText: string
}): Promise<{ leseId: string | null; fehler: string | null }> {
  if (p.zukaufPostenId || !p.jahrgangId) return { leseId: null, fehler: null }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jg, error: jgErr } = await (supabase.from('weinjahrgaenge') as any)
    .select('id, jahrgang').eq('id', p.jahrgangId).eq('tenant_id', tenantId).maybeSingle()
  if (jgErr) throw new AktionsFehler(`Jahrgang konnte nicht geladen werden: ${jgErr.message}`)
  if (!jg) return { leseId: null, fehler: 'Der Jahrgang gehört nicht zu diesem Betrieb oder wurde gelöscht – bitte die Seite neu laden.' }
  const jahrgang = Number((jg as R).jahrgang)
  const lesen = await ladeLesenDesJahrgangs(supabase, tenantId, p.jahrgangId)
  const alt = p.alt ?? null
  let lese: LeseKurz | null = null
  if (alt && alt.jahrgang_id === p.jahrgangId && alt.lese_id) lese = lesen.find(l => l.id === alt.lese_id) ?? null
  else if (p.leseIdFormular) {
    lese = lesen.find(l => l.id === p.leseIdFormular) ?? null
    if (!lese) return { leseId: null, fehler: 'Die gewählte Lese gehört nicht zu diesem Jahrgang oder wurde gelöscht – bitte die Seite neu laden.' }
  } else lese = leseFuerDatum(lesen, jahrgang, p.datum)
  if (!lese) return { leseId: null, fehler: p.leseWaehlenText }
  if (!p.weingartenId) return { leseId: lese.id, fehler: null }
  const vorher: Mengenzeile[] = alt && alt.lese_id === lese.id && alt.weingarten_id
    ? [{ weingarten_id: alt.weingarten_id, grundstueck_id: alt.grundstueck_id ?? null, kg: Number(alt.menge_kg) || 0 }]
    : []
  const fehler = await leseDeckungFehler(supabase, tenantId, p.jahrgangId, lese, jahrgang, { verkaufId: alt?.id ?? null },
    vorher, [{ weingarten_id: p.weingartenId, grundstueck_id: p.grundstueckId, kg: p.mengeKg }])
  return { leseId: lese.id, fehler }
}
