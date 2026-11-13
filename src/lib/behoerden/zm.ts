// ── Behördenmeldung „zusammenfassende-meldung“ (KAN-439, 13.11.2026 – Epic KAN-431) ────────────────────────────────────
//
// Zusammenfassende Meldung (ZM) nach Art. 21 UStG: je Meldezeitraum und UID des Erwerbers die Summe der steuerfreien
// innergemeinschaftlichen Lieferungen. Grundlage sind die Rechnungen, deren Verkauf den Steuerfall „igl“ trägt (Rechnung
// aus dem Exportauftrag, KAN-436) – nach Rechnungsdatum, unabhängig von der Zahlung (Entscheidung Jörgen 13.11.2026, 2A).
// Eine Ladefunktion für Druckseite (/weinexport/zusammenfassende-meldung) und CSV (/meldungen/zusammenfassende-meldung/csv).
// Stornos wie überall seit KAN-379: Das Original zählt in seinem Zeitraum weiter (aus der Momentaufnahme), der
// Stornobeleg negativ im Zeitraum seines Datums; Altfälle ohne Stornobeleg zählen nicht.
// Keine elektronische Übermittlung – die Werte werden in FinanzOnline eingegeben (Entscheidung 4A).

import { STELLEN, runden, type CsvSpalte } from '@/lib/csv'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { AktionsFehler } from '@/lib/fehler'
import { uvaZeitraumLabel } from './uva'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type ZmZeile = {
  jahr: number
  /** 'Q1'–'Q4', '01'–'12' oder null = ganzes Jahr */
  zeitraum: string | null
  zeitraumLabel: string
  /** Länderkennzeichen der UID (die ersten zwei Zeichen) */
  land: string | null
  uid: string | null
  bemessungsgrundlage: number
  rechnungen: number
  rechnungsnummern: string
}

export const SPALTEN_ZM: CsvSpalte<ZmZeile>[] = [
  { kopf: 'Jahr', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.jahr },
  { kopf: 'Zeitraum', typ: 'text', wert: z => z.zeitraumLabel },
  { kopf: 'Länderkennzeichen', typ: 'code', wert: z => z.land },
  { kopf: 'UID des Erwerbers', typ: 'code', wert: z => z.uid },
  { kopf: 'Bemessungsgrundlage (€)', typ: 'betrag', stellen: STELLEN.betrag, wert: z => z.bemessungsgrundlage },
  { kopf: 'Anzahl Belege', typ: 'ganzzahl', stellen: STELLEN.ganzzahl, wert: z => z.rechnungen },
  { kopf: 'Belege', typ: 'text', wert: z => z.rechnungsnummern },
]

export type ZmParameter = { jahr: number; zeitraum: string | null }

/** Erster und letzter Tag des Meldezeitraums (Monat, Quartal oder ganzes Jahr) – reine Datumsrechnung */
export function zmZeitraum(jahr: number, zeitraum: string | null): { von: string; bis: string } {
  const z2 = (n: number) => String(n).padStart(2, '0')
  const letzter = (monat: number) => new Date(Date.UTC(jahr, monat, 0)).getUTCDate()
  if (!zeitraum) return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` }
  if (zeitraum.startsWith('Q')) {
    const start = (Number(zeitraum.slice(1)) - 1) * 3 + 1
    return { von: `${jahr}-${z2(start)}-01`, bis: `${jahr}-${z2(start + 2)}-${z2(letzter(start + 2))}` }
  }
  const m = Number(zeitraum)
  return { von: `${jahr}-${z2(m)}-01`, bis: `${jahr}-${z2(m)}-${z2(letzter(m))}` }
}

export function zmZeitraumLabel(jahr: number, zeitraum: string | null): string {
  return zeitraum ? uvaZeitraumLabel(zeitraum, jahr) : `Jahr ${jahr}`
}

/** Formale Prüfung der UID eines Erwerbers aus einem anderen Mitgliedstaat; null = in Ordnung */
export function zmUidFehler(uid: string | null): string | null {
  if (!uid) return 'UID fehlt'
  if (!/^[A-Z]{2}[A-Z0-9+*.]{2,12}$/.test(uid)) return 'UID hat kein gültiges Format'
  if (uid.startsWith('AT')) return 'österreichische UID – keine innergemeinschaftliche Lieferung'
  return null
}

const zahl = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
/** Wert der Positionen (Preis × Menge abzüglich Rabatten), auf Cent */
function wert(positionen: readonly R[]): number {
  return runden(positionen.reduce((s, p) => p?.preis_brutto == null ? s
    : s + zahl(p.preis_brutto) * zahl(p.menge) * (1 - zahl(p.rabatt_pct) / 100) * (1 - zahl(p.sonderrabatt_pct) / 100), 0), STELLEN.betrag)
}

type Beleg = { uid: string | null; betrag: number; nummer: string }

/** Steuerfall und UID je Verkauf (Lieferschein) */
export type ZmVerkauf = { steuerfall: string | null; kunde_uid: string | null }

type Einordnung = { igl: boolean; gemischt: boolean; uid: string | null }

function einordnen(faelle: readonly (ZmVerkauf | undefined)[]): Einordnung {
  const igl = faelle.filter(f => f?.steuerfall === 'igl')
  return { igl: faelle.length > 0 && igl.length === faelle.length, gemischt: igl.length > 0 && igl.length < faelle.length, uid: igl[0]?.kunde_uid ?? null }
}

/** Laufende Rechnung: Steuerfall aus ihren Lieferscheinen – 'igl' nur, wenn ALLE Lieferscheine igl sind */
function steuerfallDer(r: R): Einordnung {
  return einordnen(((r.lieferscheine ?? []) as R[]).map(l => ({ steuerfall: l.steuerfall ?? null, kunde_uid: l.kunde_uid ?? null })))
}

/**
 * Stornierte Rechnung bzw. Stornobeleg: Steuerfall aus der Momentaufnahme. Sie nennt je Position den Lieferschein
 * (`lieferschein_id`) – auch dann, wenn nur die Rechnung storniert wurde und der Lieferschein wieder „nicht berechnet“
 * ist (dann hängt er nicht mehr an der Rechnung).
 */
function steuerfallDerMomentaufnahme(positionen: readonly R[], verkaeufe: ReadonlyMap<string, ZmVerkauf>): Einordnung {
  const ids = [...new Set(positionen.map(p => String(p?.lieferschein_id ?? '')).filter(Boolean))]
  return einordnen(ids.map(id => verkaeufe.get(id)))
}

/** Lieferscheine, deren Steuerfall für die Momentaufnahmen gebraucht wird (stornierte Originale und Stornobelege) */
export function zmLieferscheinIds(rechnungen: readonly R[], originale: ReadonlyMap<string, R>): string[] {
  const ids = new Set<string>()
  for (const r of rechnungen) {
    const quelle = r.art === 'storno' ? originale.get(String(r.storno_von_id ?? '')) : r.storniert === true ? r : null
    for (const p of ((quelle?.storno_positionen ?? []) as R[])) if (p?.lieferschein_id) ids.add(String(p.lieferschein_id))
  }
  return [...ids]
}

/**
 * Belege der Meldung aus den Rechnungen des Zeitraums (ohne Datenbank – für Tests). `originale` = die Rechnungen, auf
 * die sich die Stornobelege des Zeitraums beziehen (id → Rechnung mit storno_positionen); `verkaeufe` = Steuerfall und
 * UID der Lieferscheine aus den Momentaufnahmen (zmLieferscheinIds).
 */
export function zmBelege(rechnungen: readonly R[], originale: ReadonlyMap<string, R>, verkaeufe: ReadonlyMap<string, ZmVerkauf>, warnungen: string[]): Beleg[] {
  const aus: Beleg[] = []
  const gemischt = (was: string) => warnungen.push(`${was}: enthält Lieferscheine mit und ohne innergemeinschaftliche Lieferung – bitte von Hand aufteilen.`)
  for (const r of rechnungen) {
    if (r.aktiv === false) continue
    const nummer = String(r.rechnungsnummer ?? '')
    if (r.art === 'storno') {
      const o = originale.get(String(r.storno_von_id ?? ''))
      if (!o) continue
      const pos = (o.storno_positionen ?? []) as R[]
      const f = steuerfallDerMomentaufnahme(pos, verkaeufe)
      if (f.gemischt) gemischt(`Stornobeleg ${nummer}`)
      if (f.igl) aus.push({ uid: f.uid, betrag: -wert(pos), nummer })
      continue
    }
    if (r.storniert === true) {
      // KAN-379: mit Stornobeleg zählt das Original in seinem Zeitraum weiter; Altfälle ohne Stornobeleg nicht
      if (!r.storniert_durch_id) continue
      const pos = (r.storno_positionen ?? []) as R[]
      const f = steuerfallDerMomentaufnahme(pos, verkaeufe)
      if (f.gemischt) gemischt(`Rechnung ${nummer}`)
      if (f.igl) aus.push({ uid: f.uid, betrag: wert(pos), nummer })
      continue
    }
    const f = steuerfallDer(r)
    if (f.gemischt) gemischt(`Rechnung ${nummer}`)
    if (f.igl) aus.push({ uid: f.uid, betrag: wert(((r.lieferscheine ?? []) as R[]).flatMap(l => (l.verkauf_positionen ?? []) as R[])), nummer })
  }
  return aus
}

/** Eine Zeile je UID, nach UID sortiert; Summe = Summe der auf Cent gerundeten Belege */
export function zmZeilen(belege: readonly Beleg[], p: ZmParameter, warnungen: string[]): ZmZeile[] {
  const jeUid = new Map<string, Beleg[]>()
  for (const b of belege) jeUid.set(b.uid ?? '', [...(jeUid.get(b.uid ?? '') ?? []), b])
  const zeilen = [...jeUid.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([uid, liste]): ZmZeile => ({
    jahr: p.jahr, zeitraum: p.zeitraum, zeitraumLabel: zmZeitraumLabel(p.jahr, p.zeitraum),
    land: uid ? uid.slice(0, 2) : null, uid: uid || null,
    bemessungsgrundlage: runden(liste.reduce((s, b) => s + b.betrag, 0), STELLEN.betrag),
    rechnungen: liste.length,
    rechnungsnummern: liste.map(b => b.nummer).filter(Boolean).join(', '),
  }))
  for (const z of zeilen) {
    const f = zmUidFehler(z.uid)
    if (f) warnungen.push(`${z.uid ?? 'Ohne UID'}: ${f} (${z.rechnungsnummern || 'ohne Nummer'}).`)
  }
  return zeilen
}

/** Zusammenfassende Meldung eines Zeitraums: Zeilen je UID, Summe und Hinweise */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeZm(supabase: any, tenantId: string, p: ZmParameter): Promise<{ zeilen: ZmZeile[]; warnungen: string[]; summe: number; von: string; bis: string }> {
  const { von, bis } = zmZeitraum(p.jahr, p.zeitraum)
  // storno-sichtbar: stornierte Rechnungen mit Stornobeleg zählen in ihrem Zeitraum weiter (KAN-379)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rechnungen, error } = await alle<R>((supabase.from('rechnungen') as any)
    .select(`id, datum, rechnungsnummer, art, aktiv, storniert, storniert_durch_id, storno_von_id, storno_positionen,
      lieferscheine:verkaufsposten!rechnung_id(steuerfall, kunde_uid, verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct))`)
    .eq('tenant_id', tenantId)
    .gte('datum', von)
    .lte('datum', bis)
    .order('datum').order('id'))
  if (error) throw new AktionsFehler(`Laden fehlgeschlagen (rechnungen): ${error.message}`)

  // Originale zu den Stornobelegen des Zeitraums (ihr Datum kann in einem früheren Zeitraum liegen)
  const stornoVon = [...new Set(rechnungen.filter(r => r.art === 'storno' && r.storno_von_id).map(r => String(r.storno_von_id)))]
  // storno-sichtbar: gesucht sind genau die stornierten Originale der Stornobelege (Momentaufnahme der Positionen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orig = await inBloecken<R>(stornoVon, b => alle<R>((supabase.from('rechnungen') as any)
    .select('id, storno_positionen')
    .eq('tenant_id', tenantId).in('id', b).order('id')))
  if (orig.error) throw new AktionsFehler(`Laden fehlgeschlagen (stornierte Rechnungen): ${orig.error.message}`)
  const originale = new Map(orig.data.map(o => [String(o.id), o]))

  // Steuerfall und UID der Lieferscheine aus den Momentaufnahmen – unabhängig davon, ob der Lieferschein noch an der
  // Rechnung hängt (Storno nur der Rechnung) oder selbst storniert ist (Storno des Verkaufs)
  // storno-sichtbar: auch stornierte Verkäufe – ihr Steuerfall gehört zur stornierten Rechnung
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vk = await inBloecken<R>(zmLieferscheinIds(rechnungen, originale), b => alle<R>((supabase.from('verkaufsposten') as any)
    .select('id, steuerfall, kunde_uid')
    .eq('tenant_id', tenantId).in('id', b).order('id')))
  if (vk.error) throw new AktionsFehler(`Laden fehlgeschlagen (Lieferscheine der stornierten Rechnungen): ${vk.error.message}`)
  const verkaeufe = new Map<string, ZmVerkauf>(vk.data.map(v => [String(v.id), { steuerfall: v.steuerfall ?? null, kunde_uid: v.kunde_uid ?? null }]))

  const warnungen: string[] = []
  const zeilen = zmZeilen(zmBelege(rechnungen, originale, verkaeufe, warnungen), p, warnungen)
  if (zeilen.length === 0) {
    warnungen.push(`In ${zmZeitraumLabel(p.jahr, p.zeitraum)} gibt es keine Rechnung mit innergemeinschaftlicher Lieferung – gezählt werden Rechnungen aus dem Exportauftrag an EU-Kunden mit UID.`)
  }
  return { zeilen, warnungen, summe: runden(zeilen.reduce((s, z) => s + z.bemessungsgrundlage, 0), STELLEN.betrag), von, bis }
}
