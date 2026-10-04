// ── Verschnitt: Fachwerte und Aufruf der RPC s112_verschnitt_buchen (KAN-112, 03.10.2026) ────────────────────
//
// Reiner Teil des Verschnitt-Service (verschnittBuchen.ts) – ohne Datenbank, testbar (scripts/tests/kan112-verschnitt):
// aus Ziel-Charge (oder einer neuen Charge im leeren Gebinde), Quellen und den Rebsorten-/Jahrgangsanteilen (KAN-93)
// entstehen dieselben Werte wie bisher in createVerschneidung – Sortenangabe nach der 85-%-Regel, Qualität
// (mischeQualitaet, KAN-186), Herkunft (minHerkunft), Mostgewicht (KAN-130), Abstufungs- und Sortenhinweise in den
// Notizen – und daraus p_kopf/p_quellen für EINEN RPC-Aufruf. Die RPC sperrt die Chargen, prüft die Bestände gegen die
// erwarteten Werte (Grundlage dieser Rechnung; abweichend → 40001) und bucht alles in einer Transaktion.
//
// KAN-193 (Entscheidung Jörgen 03.10.2026): Rot- und Weißwein dürfen verschnitten werden, wenn das Ergebnis auf
// „Wein (aus Österreich)“ abgestuft wird – Stufe Wein, keine Zusatzbezeichnung, Herkunft Österreich (Code 'wein'),
// Farbe nach der Mehrheit der Liter (Rosé zählt als rot). Der Service fragt vorher nach (ROT_WEISS_FRAGE).

import { qualitaetText } from '@/lib/weinqualitaet'
import { hoechsteQualitaetsAngabe, istAbstufungQualitaet, mischeQualitaet, normalisiereQualitaet, qualitaetsSpalten, type QualitaetsAngabe } from '@/lib/wein/qualitaetsrang'
import { sortenBezeichnung, type GruppenMenge } from '@/lib/wein/sortenangabe'
import { ermittleHerkunft, type HerkunftsTeil } from '@/lib/wein/herkunftRegel'
import { minHerkunft, maxHerkunft, istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { mostgewichtNeu, mostgewichtZusammenfuehren, teilweiseVermerk } from '@/lib/kellerbuch/mostgewichtKette'
import { weinartKonflikt } from '@/lib/keller/weinart'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type Abstufung = { von: string; nach: string }

/** Eine Quelle: geladene Charge, Menge in das Ziel (netto) und Schwund aus dieser Quelle */
export type VerschnittQuelle = { charge: R; menge: number; schwund: number }

export type VerschnittWerteEingabe = {
  datum: string
  /** Ziel-Charge wie geladen – null: neue Charge im leeren Gebinde `neueCharge.behaelterId` */
  ziel: R | null
  neueCharge?: { behaelterId: string; name?: string | null; status?: string | null; notizen?: string | null } | null
  /** Weinart des Ergebnisses (Ziel bzw. aus den Quellen) – Farbe des Sortenverschnitts */
  weinart: string
  quellen: readonly VerschnittQuelle[]
  /** Rebsorten- und Jahrgangsanteile (verschnittGruppen, KAN-93) */
  gruppen: { sorten: readonly GruppenMenge[]; jahrgaenge: readonly GruppenMenge[]; herkunft?: readonly HerkunftsTeil[] }
  /** Notizen des Benutzers (samt Prüfnummer-Vermerk) */
  notizen: string | null
  /** KAN-193: Rot und Weiß werden verschnitten (bestätigt) – Abstufung auf Wein (aus Österreich), `weinart` = Mehrheit */
  rotWeiss?: boolean
}

/** KAN-193: Rückfrage vor einem Verschnitt von Rot- und Weißwein */
export const ROT_WEISS_FRAGE = 'Rot- und Weißwein werden verschnitten – das Ergebnis wird auf ‚Wein (aus Österreich)‘ abgestuft. Fortfahren?'
/** KAN-193: Vermerk in den Notizen des Verschnitts und Zeile im Hinweis */
export const ROT_WEISS_VERMERK = 'Abstufung auf Wein (aus Österreich) – Verschnitt Rot/Weiß'
/** KAN-193: Stufe „Wein“ (QUALITAET_OPTS) und Herkunfts-Code „Wein aus Österreich“ (breiteste Stufe im Herkunftsbaum) */
export const ROT_WEISS_STUFE = 'wein'
export const ROT_WEISS_HERKUNFT = 'wein'

/**
 * KAN-193: Werden Rot- und Weißwein gemischt (Weinarten der Beteiligten, Ziel mit seinem Bestand, Quellen mit ihrer
 * Menge)? Dann die Farbe des Ergebnisses nach der Mehrheit der Liter – mehr Rot (Rosé zählt als rot) → 'rot', sonst 'weiss'.
 * Unbekannte Weinarten zählen nicht.
 */
export function rotWeissMischung(teile: readonly { weinart: string | null | undefined; liter: number }[]): { rotWeiss: boolean; weinart: 'rot' | 'weiss' | null } {
  let rotWeiss = false
  for (let i = 0; i < teile.length && !rotWeiss; i++) {
    for (let j = i + 1; j < teile.length; j++) if (weinartKonflikt(teile[i].weinart, teile[j].weinart)) { rotWeiss = true; break }
  }
  if (!rotWeiss) return { rotWeiss: false, weinart: null }
  let rot = 0
  let weiss = 0
  for (const t of teile) {
    const l = Number.isFinite(t.liter) && t.liter > 0 ? t.liter : 0
    if (t.weinart === 'rot' || t.weinart === 'rose') rot += l
    else if (t.weinart === 'weiss') weiss += l
  }
  return { rotWeiss: true, weinart: rot > weiss ? 'rot' : 'weiss' }
}

export type VerschnittWerte = {
  kopf: R
  quellen: R[]
  qualitaetAbgestuft: Abstufung | null
  herkunftAbgestuft: Abstufung | null
  sortenHinweise: string[]
  /** KAN-193: auf Wein (aus Österreich) abgestuft (Rot/Weiß) */
  rotWeiss: boolean
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}
const rund2 = (n: number): number => Math.round(n * 100) / 100

/** Weinart einer neuen Verschnitt-Charge aus den Quellen (Rosé + Rot → Rot; sonst die erste bekannte) */
export function weinartAusQuellen(arten: readonly string[]): string {
  const bekannt = arten.filter(a => a === 'rot' || a === 'weiss' || a === 'rose')
  if (bekannt.length === 0) return 'unbekannt'
  if (bekannt.includes('rot')) return 'rot'
  return bekannt[0]
}

/** Werte und RPC-Argumente eines Verschnitts (KAN-112) */
export function verschnittWerte(e: VerschnittWerteEingabe): VerschnittWerte {
  const ziel = e.ziel
  const zielBestand = ziel ? num(ziel.menge_liter) : 0
  const quellRows = e.quellen.map(q => q.charge)

  // Sortenangabe (KAN-93): bisherige Angaben der Ziel-Charge; neue Charge: die der größten Quelle (85-%-Regel entscheidet)
  const groesste = [...e.quellen].sort((a, b) => b.menge - a.menge)[0]?.charge ?? null
  const bisher = ziel ?? groesste
  const angabe = sortenBezeichnung(e.gruppen.sorten, e.gruppen.jahrgaenge, {
    rebsorte: (bisher?.rebsorte as string | null) ?? null,
    jahrgang: bisher?.jahrgang == null ? null : Number(bisher.jahrgang),
    weinart: e.weinart,
  })

  // Qualität (KAN-186) und Herkunft – niedrigste bzw. weiteste Angabe aller Beteiligten
  const zielQualitaet = ziel ? normalisiereQualitaet(ziel) : null
  const alleQualitaeten: QualitaetsAngabe[] = [...(zielQualitaet ? [zielQualitaet] : []), ...quellRows.map(q => normalisiereQualitaet(q))]
  const gemischt = mischeQualitaet(alleQualitaeten)
  const alleHerkuenfte = [...(ziel ? [(ziel.herkunft_code as string | null) ?? null] : []), ...quellRows.map(q => (q.herkunft_code as string | null) ?? null)]
  // KAN-193: Rot/Weiß → Stufe Wein ohne Zusatzbezeichnung (Erzeugnis bleibt), Herkunft Österreich
  const rotWeiss = e.rotWeiss === true
  const neueQualitaet: QualitaetsAngabe | null = rotWeiss
    ? { stufe: ROT_WEISS_STUFE, zusatz: null, erzeugnis: gemischt?.erzeugnis ?? null }
    : gemischt
  // KAN-110: mit Herkunftsteilen (Liter je Ried/Gemeinde) nach § 21 WeinG, sonst der gemeinsame Oberbegriff
  const regel = !rotWeiss && e.gruppen.herkunft ? ermittleHerkunft(e.gruppen.herkunft) : null
  const neueHerkunft = rotWeiss ? ROT_WEISS_HERKUNFT : regel ? regel.code : minHerkunft(alleHerkuenfte)

  // Mostgewicht (KAN-130 Etappe 2): gewichteter Mittelwert über Ziel und Quellen
  const anteile = e.quellen.map(q => ({ liter: q.menge, charge: q.charge }))
  let mgWerte: R | null
  let mgVermerk: string | null
  if (ziel) {
    const mg = mostgewichtZusammenfuehren(ziel, zielBestand, anteile)
    mgWerte = mg.werte
    mgVermerk = mg.werte ? teilweiseVermerk(mg) : null
  } else {
    const mg = mostgewichtNeu(anteile)
    mgWerte = mg.spalten
    mgVermerk = mg.spalten ? teilweiseVermerk(mg) : null
  }

  // Abstufungen gegen die HÖCHSTE Qualität bzw. ENGSTE Herkunft aller Beteiligten
  const hoechste = hoechsteQualitaetsAngabe(alleQualitaeten)
  const qualitaetAbgestuft: Abstufung | null = neueQualitaet && hoechste && istAbstufungQualitaet(hoechste, neueQualitaet)
    ? { von: qualitaetText(hoechste), nach: qualitaetText(neueQualitaet) }
    : null
  const engste = maxHerkunft(alleHerkuenfte)
  const herkunftAbgestuft: Abstufung | null = neueHerkunft && engste && herkunftIstNiedrigerAls(neueHerkunft, engste)
    ? { von: engste, nach: neueHerkunft }
    : null

  // Vermerke in die Notizen des Verschnitts – vor dem Buchen, damit es EIN Aufruf bleibt
  const texte: string[] = []
  if (rotWeiss) texte.push(ROT_WEISS_VERMERK)
  if (qualitaetAbgestuft) texte.push(`Abstufung Qualität von ${qualitaetAbgestuft.von} auf ${qualitaetAbgestuft.nach}`)
  if (herkunftAbgestuft) {
    texte.push(`Abstufung Herkunft-Code (BKI) von ${HERKUNFT_LABEL[herkunftAbgestuft.von] ?? herkunftAbgestuft.von} auf ${HERKUNFT_LABEL[herkunftAbgestuft.nach] ?? herkunftAbgestuft.nach}`)
  }
  if (regel) texte.push(...regel.hinweise)
  if (mgVermerk) texte.push(mgVermerk)
  texte.push(...angabe.hinweise)
  const notizen = [e.notizen?.trim() || null, ...texte].filter(Boolean).join('\n') || null

  const zielFelder: R = {
    rebsorte: angabe.rebsorte,
    jahrgang: angabe.jahrgang,
    ...qualitaetsSpalten(neueQualitaet),
    herkunft_code: neueHerkunft,
    ...(mgWerte ?? {}),
    // KAN-193: Farbe nur mitschicken, wenn ein Rot/Weiß-Verschnitt sie ändert (die RPC kennt das Feld erst ab kan112c)
    ...(rotWeiss && ziel && ziel.weinart !== e.weinart ? { weinart: e.weinart } : {}),
  }

  const kopf: R = { datum: e.datum, ...(notizen ? { notizen } : {}), ziel: zielFelder }
  if (ziel) {
    kopf.ziel_weinausbau_id = ziel.id
    kopf.ziel_menge_erwartet = zielBestand   // ungerundet: die RPC vergleicht auf 0,005 L
  } else {
    const n = e.neueCharge
    if (!n?.behaelterId) throw new Error('verschnittWerte: Ziel-Charge oder Gebinde der neuen Charge fehlt')
    const laender = [...new Set(quellRows.map(q => (q.land_iso as string | null) ?? null).filter(Boolean))]
    kopf.neue_ziel_charge = {
      name: n.name?.trim() || [angabe.rebsorte ?? 'Verschnitt', angabe.jahrgang].filter(x => x != null && x !== '').join(' '),
      behaelter_id: n.behaelterId,
      weinart: e.weinart,
      rebsorte: angabe.rebsorte,
      jahrgang: angabe.jahrgang,
      herkunft_code: neueHerkunft,
      ...qualitaetsSpalten(neueQualitaet),
      ...(laender.length === 1 ? { land_iso: laender[0] } : {}),
      ...(n.status ? { status: n.status } : {}),
      ...(n.notizen ? { notizen: n.notizen } : {}),
    }
  }

  const quellen = e.quellen.map(q => ({
    weinausbau_id: q.charge.id as string,
    menge_liter: rund2(q.menge),
    ...(q.schwund >= 0.01 ? { schwund_liter: rund2(q.schwund) } : {}),
    menge_erwartet: num(q.charge.menge_liter),
  }))

  return { kopf, quellen, qualitaetAbgestuft, herkunftAbgestuft, sortenHinweise: angabe.hinweise, rotWeiss }
}
