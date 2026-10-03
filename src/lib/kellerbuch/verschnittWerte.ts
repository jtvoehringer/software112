// ── Verschnitt: Fachwerte und Aufruf der RPC s112_verschnitt_buchen (KAN-112, 03.10.2026) ────────────────────
//
// Reiner Teil des Verschnitt-Service (verschnittBuchen.ts) – ohne Datenbank, testbar (scripts/tests/kan112-verschnitt):
// aus Ziel-Charge (oder einer neuen Charge im leeren Gebinde), Quellen und den Rebsorten-/Jahrgangsanteilen (KAN-93)
// entstehen dieselben Werte wie bisher in createVerschneidung – Sortenangabe nach der 85-%-Regel, Qualität
// (mischeQualitaet, KAN-186), Herkunft (minHerkunft), Mostgewicht (KAN-130), Abstufungs- und Sortenhinweise in den
// Notizen – und daraus p_kopf/p_quellen für EINEN RPC-Aufruf. Die RPC sperrt die Chargen, prüft die Bestände gegen die
// erwarteten Werte (Grundlage dieser Rechnung; abweichend → 40001) und bucht alles in einer Transaktion.

import { qualitaetText } from '@/lib/weinqualitaet'
import { hoechsteQualitaetsAngabe, istAbstufungQualitaet, mischeQualitaet, normalisiereQualitaet, qualitaetsSpalten, type QualitaetsAngabe } from '@/lib/wein/qualitaetsrang'
import { sortenBezeichnung, type GruppenMenge } from '@/lib/wein/sortenangabe'
import { minHerkunft, maxHerkunft, istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { mostgewichtNeu, mostgewichtZusammenfuehren, teilweiseVermerk } from '@/lib/kellerbuch/mostgewichtKette'

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
  gruppen: { sorten: readonly GruppenMenge[]; jahrgaenge: readonly GruppenMenge[] }
  /** Notizen des Benutzers (samt Prüfnummer-Vermerk) */
  notizen: string | null
}

export type VerschnittWerte = {
  kopf: R
  quellen: R[]
  qualitaetAbgestuft: Abstufung | null
  herkunftAbgestuft: Abstufung | null
  sortenHinweise: string[]
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
  const neueQualitaet = mischeQualitaet(alleQualitaeten)
  const alleHerkuenfte = [...(ziel ? [(ziel.herkunft_code as string | null) ?? null] : []), ...quellRows.map(q => (q.herkunft_code as string | null) ?? null)]
  const neueHerkunft = minHerkunft(alleHerkuenfte)

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
  if (qualitaetAbgestuft) texte.push(`Abstufung Qualität von ${qualitaetAbgestuft.von} auf ${qualitaetAbgestuft.nach}`)
  if (herkunftAbgestuft) {
    texte.push(`Abstufung Herkunft-Code (BKI) von ${HERKUNFT_LABEL[herkunftAbgestuft.von] ?? herkunftAbgestuft.von} auf ${HERKUNFT_LABEL[herkunftAbgestuft.nach] ?? herkunftAbgestuft.nach}`)
  }
  if (mgVermerk) texte.push(mgVermerk)
  texte.push(...angabe.hinweise)
  const notizen = [e.notizen?.trim() || null, ...texte].filter(Boolean).join('\n') || null

  const zielFelder: R = {
    rebsorte: angabe.rebsorte,
    jahrgang: angabe.jahrgang,
    ...qualitaetsSpalten(neueQualitaet),
    herkunft_code: neueHerkunft,
    ...(mgWerte ?? {}),
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

  return { kopf, quellen, qualitaetAbgestuft, herkunftAbgestuft, sortenHinweise: angabe.hinweise }
}
