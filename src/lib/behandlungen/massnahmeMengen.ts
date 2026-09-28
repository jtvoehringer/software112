// ── Mengen einer Maßnahme prüfen und ergänzen (KAN-133 Soll 10, 26.09.2026) ──
//
// Eine Regel für Server Actions (createBehandlung/updateBehandlung), Assistent und Formulare –
// isomorph und ohne Datenbank (node:test: scripts/tests/massnahme-mengen.test.mjs). Die Aufrufer
// lesen die Zahlen selbst (zahlAus()/dezimal()), laden die Stammdaten des Mittels (Cu-Gehalt) bzw.
// die Einheit des Düngemittels und die Σ Fläche der gewählten WI-GST und übernehmen dann `werte`
// unverändert in insert/update (Spaltennamen wie in behandlungen).
//
// Spritzung: Pflanzenschutzmittel und Aufwand samt Einheit Pflicht; „Menge gesamt“ ist die
//   Spritzbrühe – nur l oder ml (gespeichert in l), kg/g werden abgelehnt; g/hl bzw. ml/hl
//   (Konzentration im Tank) nur mit Spritzbrühe oder Wasseraufwand. Fehlt eines von Spritzbrühe und
//   Wasseraufwand, wird es aus dem anderen und der Fläche ergänzt. Fehlen beide, ergibt sich der
//   Wasseraufwand bei kg/ha bzw. l/ha aus Aufwand und Konzentration (%) (KAN-155,
//   wasseraufwandAusKonzentration) und daraus über die Fläche die Spritzbrühe. reinkupfer_kg_ha = Mittelmenge ×
//   Cu-Gehalt ÷ Fläche, gerundet wie die Kupfer-Bilanz (cu.ts); über numeric(8,4) hinaus leer + Hinweis.
// Düngung: g/hl und ml/hl abgelehnt; Düngermenge in der Einheit des Düngemittels – kg (g → kg), bei
//   Düngemitteln in l nur l (ml → l); ohne Angabe gilt diese Einheit (wie duengermengeEinheit() im
//   Formular), die jeweils andere wird abgelehnt (keine Dichte-Annahme). Aufwand l/ha und l nur bei
//   Düngemitteln in l.
// Sonstiges (KAN-154): Pflanzenschutzmittel optional (z. B. Pheromon-Dispenser); Aufwand samt Einheit nur mit
//   Mittel und optional – kg/ha, l/ha, kg oder l (ohne Spritzbrühe kein g/hl, ml/hl). Mittelmenge und
//   Reinkupfer wie bei der Spritzung; ohne Mittel wird ein Aufwand verworfen.
// Andere Arten: unverändert.

import { runden, STELLEN } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import { mittelmenge, spritzbruehe, STELLEN_MENGE, type MittelmengeErgebnis } from '@/lib/behoerden/psm'
import { STELLEN_CU } from '@/lib/behoerden/cu'

/** Aufwand-Einheiten laut CHECK behandlungen_aufwandmenge_einheit_check */
export const AUFWAND_EINHEITEN = ['kg_ha', 'l_ha', 'g_hl', 'ml_hl', 'kg', 'l'] as const
/** Aufwand-Einheiten einer Düngung (ohne g/hl, ml/hl; l/ha und l nur bei Düngemitteln in l) */
export const AUFWAND_EINHEITEN_DUENGUNG = ['kg_ha', 'l_ha', 'kg', 'l'] as const
/** Aufwand-Einheiten bei Sonstiges mit Pflanzenschutzmittel (ohne Spritzbrühe kein g/hl, ml/hl; KAN-154) */
export const AUFWAND_EINHEITEN_SONSTIGES = ['kg_ha', 'l_ha', 'kg', 'l'] as const
/** Einheiten der Spritzbrühe („Menge gesamt“ einer Spritzung); gespeichert wird immer l */
export const SPRITZBRUEHE_EINHEITEN = ['l', 'ml'] as const

/** Größte speicherbare Werte (numeric(10,3), numeric(8,2) bzw. numeric(8,4)) */
const MAX_MENGE_GESAMT = 9_999_999.999
const MAX_WASSER_L_HA = 999_999.99
const MAX_REINKUPFER_KG_HA = 9_999.9999
/** Spritzbrühe weicht von Wasseraufwand × Fläche ab: ab 1 % bzw. 1 l */
const TOLERANZ_BRUEHE = 0.01

export type MassnahmeMengenEingabe = {
  /** behandlungen.art */
  art: string
  psmId?: string | null
  duengemittelId?: string | null
  /** Stammdaten des Pflanzenschutzmittels für den Cu-Gehalt (PsmMittel passt) */
  psm?: { cuGehaltPct: number | null; wirkstoff?: string | null; wirkstoffgehaltPct?: number | null } | null
  /** duengemittel.einheit ('kg' | 'l'); ohne Angabe gilt kg */
  duengemittelEinheit?: string | null
  aufwand: number | null
  aufwandEinheit: string | null
  mengeGesamt: number | null
  mengeEinheit: string | null
  wasserLHa: number | null
  /** Konzentration (%) – nur, um bei kg/ha bzw. l/ha ohne Spritzbrühe und Wasseraufwand den Wasseraufwand zu ergänzen (KAN-155) */
  konzentrationPct?: number | null
  /** Σ Fläche der gewählten WI-GST (ha); null bzw. 0 = unbekannt */
  flaecheHa: number | null
}

/** Spalten von behandlungen, wie sie gespeichert werden */
export type MassnahmeMengenWerte = {
  aufwandmenge: number | null
  aufwandmenge_einheit: string | null
  menge_gesamt: number | null
  menge_einheit: string | null
  wasseraufwand_l_ha: number | null
  reinkupfer_kg_ha: number | null
}

export type MassnahmeMengenErgebnis =
  | { ok: false; fehler: string }
  | {
      ok: true
      werte: MassnahmeMengenWerte
      /** Mittelmenge aus den normalisierten Werten (Anzeige, Materialkosten) */
      mittelmenge: MittelmengeErgebnis
      /** Spritzbrühe in l (nur Spritzung) – nie über Maßnahmen summieren */
      spritzbruehe: number | null
      /** Reinkupfer gesamt (kg, 4 Stellen); null = kein Kupfermittel bzw. keine Mittelmenge */
      cuKg: number | null
      /** Hinweise, die das Speichern nicht verhindern (z. B. Spritzbrühe ≠ Wasseraufwand × Fläche) */
      hinweise: string[]
    }

/**
 * Cu-Gehalt (%) des Mittels wie cuGehalt() in cu.ts: cu_gehalt_pct, sonst bei einem Kupfer-Wirkstoff
 * wirkstoffgehalt_pct (Näherung); null = kein Kupfermittel.
 */
export function kupferGehaltPct(p: MassnahmeMengenEingabe['psm']): number | null {
  if (!p) return null
  if (p.cuGehaltPct !== null && p.cuGehaltPct > 0) return p.cuGehaltPct
  if ((p.wirkstoff ?? '').toLowerCase().includes('kupfer') && typeof p.wirkstoffgehaltPct === 'number' && p.wirkstoffgehaltPct > 0) {
    return p.wirkstoffgehaltPct
  }
  return null
}

/**
 * Behandelte Fläche = Σ Fläche der Grundstücke (ha, je GST und gesamt 4 Stellen wie normalisiereBehandlung
 * in psm.ts); leere, ungültige und nicht positive Werte zählen nicht. null = keine Fläche. Für
 * createBehandlung/updateBehandlung und die Bearbeiten-Seite (Werte aus der DB, auch als Text).
 */
export function summeFlaecheHa(flaechen: Iterable<unknown>): number | null {
  let summe = 0
  for (const f of flaechen) {
    const n = f == null || f === '' ? NaN : Number(f)
    if (Number.isFinite(n) && n > 0) summe += runden(n, STELLEN.ha)
  }
  return summe > 0 ? runden(summe, STELLEN.ha) : null
}

/**
 * Wasseraufwand (l/ha) aus Aufwand je ha und Konzentration (%) (KAN-155): Aufwand = Wasseraufwand × Konzentration ÷ 100,
 * also Wasseraufwand = Aufwand ÷ Konzentration × 100 (1 kg bzw. l Mittel je l Brühe, wie bei g/hl ↔ %). Nur kg/ha und
 * l/ha, Aufwand > 0 und Konzentration über 0 bis 100 % – sonst null (nie durch 0 teilen); 2 Stellen wie die Spalte.
 * Beispiel: 2 l/ha bei 0,5 % → 400 l/ha. Gemeinsam für die Formulare (mengenFelder) und pruefeMassnahmeMengen.
 */
export function wasseraufwandAusKonzentration(aufwand: number | null, einheit: string | null, konzentrationPct: number | null): number | null {
  if (einheit !== 'kg_ha' && einheit !== 'l_ha') return null
  if (aufwand === null || !Number.isFinite(aufwand) || aufwand <= 0) return null
  if (konzentrationPct === null || !Number.isFinite(konzentrationPct) || konzentrationPct <= 0 || konzentrationPct > 100) return null
  const w = runden(aufwand / konzentrationPct * 100, 2)
  return w > 0 ? w : null
}

function positiv(n: number | null): number | null {
  return n !== null && Number.isFinite(n) && n > 0 ? n : null
}

const zahlText = (n: number, stellen = 3) => fmtNum(n, { max: stellen })

/**
 * Prüft die Mengenangaben einer Maßnahme und ergänzt sie (Regeln im Dateikopf).
 * `bruehePflicht`: Spritzbrühe gesamt oder Wasseraufwand verlangen (Formular, Assistent) –
 * die Server Action verlangt sie nur bei g/hl bzw. ml/hl.
 */
export function pruefeMassnahmeMengen(e: MassnahmeMengenEingabe, opt: { bruehePflicht?: boolean } = {}): MassnahmeMengenErgebnis {
  const fehler = (text: string): MassnahmeMengenErgebnis => ({ ok: false, fehler: text })
  const ha = positiv(e.flaecheHa)

  if (e.art === 'sonstiges') {
    // Aufwand nur mit Pflanzenschutzmittel (Formular: Feld erst nach der Mittelwahl), optional
    const aufwand = e.psmId ? e.aufwand : null
    const ae = aufwand !== null ? e.aufwandEinheit : null
    if (aufwand !== null) {
      if (!Number.isFinite(aufwand)) return fehler('„Aufwandmenge“ ist keine gültige Zahl.')
      if (aufwand <= 0) return fehler('„Aufwandmenge“ muss größer als 0 sein.')
      if (!ae) return fehler('Bitte die Einheit der Aufwandmenge angeben.')
      if (!(AUFWAND_EINHEITEN_SONSTIGES as readonly string[]).includes(ae)) {
        return fehler(`Aufwand-Einheit „${ae}“ ist bei Sonstiges nicht zulässig (kg/ha, l/ha, kg oder l – g/hl und ml/hl nur bei einer Spritzung).`)
      }
    }
    const werte: MassnahmeMengenWerte = {
      aufwandmenge: aufwand, aufwandmenge_einheit: ae,
      menge_gesamt: e.mengeGesamt, menge_einheit: e.mengeEinheit,
      wasseraufwand_l_ha: e.wasserLHa, reinkupfer_kg_ha: null,
    }
    const hinweise: string[] = []
    const mm = mittelmenge({ ...eingabe(e, werte), flaecheHa: ha })
    if (aufwand !== null && mm.menge === null && mm.warnung) hinweise.push(`Mittelmenge nicht berechenbar (${mm.warnung}).`)
    const cuKg = reinkupfer(e, mm, ha, werte, hinweise)
    return { ok: true, werte, mittelmenge: mm, spritzbruehe: null, cuKg, hinweise }
  }

  if (e.art !== 'spritzung' && e.art !== 'duengung') {
    const werte: MassnahmeMengenWerte = {
      aufwandmenge: e.aufwand, aufwandmenge_einheit: e.aufwandEinheit,
      menge_gesamt: e.mengeGesamt, menge_einheit: e.mengeEinheit,
      wasseraufwand_l_ha: e.wasserLHa, reinkupfer_kg_ha: null,
    }
    return { ok: true, werte, mittelmenge: mittelmenge({ ...eingabe(e, werte), flaecheHa: ha }), spritzbruehe: null, cuKg: null, hinweise: [] }
  }

  for (const [wert, name] of [[e.aufwand, 'Aufwandmenge'], [e.mengeGesamt, e.art === 'spritzung' ? 'Spritzbrühe gesamt' : 'Düngermenge gesamt'], [e.wasserLHa, 'Wasseraufwand']] as const) {
    if (wert === null) continue
    if (!Number.isFinite(wert)) return fehler(`„${name}“ ist keine gültige Zahl.`)
    if (wert <= 0) return fehler(`„${name}“ muss größer als 0 sein.`)
  }
  // Einheit ohne Aufwand (Vorgabe im Formular) zählt nicht
  const ae = e.aufwand !== null ? e.aufwandEinheit : null
  if (e.aufwand !== null && !ae) return fehler('Bitte die Einheit der Aufwandmenge angeben.')
  if (ae && !(AUFWAND_EINHEITEN as readonly string[]).includes(ae)) {
    return fehler(`Aufwand-Einheit „${ae}“ ist nicht zulässig (kg/ha, l/ha, g/hl, ml/hl, kg oder l).`)
  }
  const hinweise: string[] = []

  if (e.art === 'duengung') {
    const inLiter = e.duengemittelEinheit === 'l'
    if (ae === 'g_hl' || ae === 'ml_hl') {
      return fehler('Bei einer Düngung sind g/hl und ml/hl nicht zulässig – bitte kg/ha oder kg angeben.')
    }
    if ((ae === 'l_ha' || ae === 'l') && !inLiter) {
      return fehler('Aufwand in l/ha bzw. l nur bei Düngemitteln, die in Litern geführt werden – bitte kg/ha oder kg angeben.')
    }
    let menge: number | null = null
    let einheit: string | null = null
    if (e.mengeGesamt !== null) {
      // ohne Einheit gilt die Einheit des Düngemittels (Assistent: menge_einheit ist optional)
      const me = e.mengeEinheit ?? (inLiter ? 'l' : 'kg')
      if (me === 'kg' || me === 'g') {
        if (inLiter) return fehler('Das Düngemittel wird in Litern geführt – bitte die Düngermenge in l angeben (keine Umrechnung aus kg ohne Dichte).')
        menge = me === 'g' ? e.mengeGesamt / 1000 : e.mengeGesamt; einheit = 'kg'
      } else if (me === 'l' || me === 'ml') {
        if (!inLiter) return fehler('Die Düngermenge in Litern ist nur bei Düngemitteln möglich, die in Litern geführt werden – bitte in kg angeben.')
        menge = me === 'ml' ? e.mengeGesamt / 1000 : e.mengeGesamt; einheit = 'l'
      } else return fehler(`Mengeneinheit „${me}“ ist nicht zulässig (kg oder l).`)
      menge = runden(menge, STELLEN_MENGE)
      if (menge <= 0) return fehler('„Düngermenge gesamt“ ist nach der Umrechnung in kg bzw. l zu klein.')
      if (menge > MAX_MENGE_GESAMT) return fehler('„Düngermenge gesamt“ ist zu groß.')
    }
    const werte: MassnahmeMengenWerte = {
      aufwandmenge: e.aufwand, aufwandmenge_einheit: ae,
      menge_gesamt: menge, menge_einheit: einheit,
      wasseraufwand_l_ha: e.wasserLHa, reinkupfer_kg_ha: null,
    }
    const mm = mittelmenge({ ...eingabe(e, werte), flaecheHa: ha, duengemittel: { einheit: e.duengemittelEinheit ?? null } })
    if (mm.menge === null && mm.warnung) hinweise.push(`Düngermenge nicht berechenbar (${mm.warnung}).`)
    return { ok: true, werte, mittelmenge: mm, spritzbruehe: null, cuKg: null, hinweise }
  }

  // ── Spritzung ──
  if (!e.psmId) return fehler('Bei einer Spritzung ist ein Pflanzenschutzmittel Pflicht.')
  if (e.aufwand === null || !ae) {
    return fehler('Bei einer Spritzung sind Aufwandmenge und Einheit Pflicht – die Mittelmenge ergibt sich nur aus dem Aufwand.')
  }
  let bruehe: number | null = null
  if (e.mengeGesamt !== null) {
    const me = e.mengeEinheit ?? 'l'
    if (!(SPRITZBRUEHE_EINHEITEN as readonly string[]).includes(me)) {
      return fehler(`Bei einer Spritzung ist „Menge gesamt“ die Spritzbrühe in Litern – ${me} ist nicht zulässig. Die Mittelmenge ergibt sich aus der Aufwandmenge.`)
    }
    bruehe = runden(me === 'ml' ? e.mengeGesamt / 1000 : e.mengeGesamt, STELLEN_MENGE)
    if (bruehe <= 0) return fehler('„Spritzbrühe gesamt“ ist nach der Umrechnung in l zu klein.')
    if (bruehe > MAX_MENGE_GESAMT) return fehler('„Spritzbrühe gesamt“ ist zu groß.')
  }
  let wasser = e.wasserLHa
  if (wasser !== null && wasser > MAX_WASSER_L_HA) return fehler('„Wasseraufwand“ ist zu groß.')
  // KAN-155: weder Spritzbrühe noch Wasseraufwand – bei kg/ha bzw. l/ha aus Aufwand und Konzentration (%)
  if (bruehe === null && wasser === null) {
    const w = wasseraufwandAusKonzentration(e.aufwand, ae, e.konzentrationPct ?? null)
    if (w !== null && w <= MAX_WASSER_L_HA) wasser = w
    else if (w !== null) hinweise.push(`Wasseraufwand nicht ergänzt: ${zahlText(w, 2)} l/ha aus Aufwand und Konzentration wären zu groß – bitte prüfen.`)
  }
  const jeHl = ae === 'g_hl' || ae === 'ml_hl'
  if (jeHl && bruehe === null && wasser === null) {
    return fehler('Bei g/hl bzw. ml/hl (Konzentration im Tank) ist die Spritzbrühe gesamt (l) oder der Wasseraufwand (l/ha) Pflicht.')
  }
  if (opt.bruehePflicht && bruehe === null && wasser === null) {
    return fehler('Bei einer Spritzung bitte die Spritzbrühe gesamt (l) oder den Wasseraufwand (l/ha) angeben – bei kg/ha bzw. l/ha genügt auch die Konzentration (%).')
  }

  // Spritzbrühe ↔ Wasseraufwand über die Fläche ergänzen bzw. abgleichen
  if (ha !== null) {
    if (bruehe === null && wasser !== null) {
      const l = runden(wasser * ha, STELLEN_MENGE)
      if (l > 0 && l <= MAX_MENGE_GESAMT) bruehe = l
    } else if (bruehe !== null && wasser === null) {
      const w = runden(bruehe / ha, 2)
      if (w > 0 && w <= MAX_WASSER_L_HA) wasser = w
      else hinweise.push(`Wasseraufwand nicht ergänzt: ${zahlText(bruehe)} l auf ${zahlText(ha, 4)} ha wären ${zahlText(bruehe / ha, 2)} l/ha – bitte Spritzbrühe und Fläche prüfen.`)
    } else if (bruehe !== null && wasser !== null) {
      const soll = wasser * ha
      if (Math.abs(bruehe - soll) > Math.max(1, soll * TOLERANZ_BRUEHE)) {
        hinweise.push(`Spritzbrühe ${zahlText(bruehe)} l weicht von Wasseraufwand × Fläche ab (${zahlText(wasser, 2)} l/ha × ${zahlText(ha, 4)} ha = ${zahlText(soll)} l).`)
      }
    }
  }

  const werte: MassnahmeMengenWerte = {
    aufwandmenge: e.aufwand, aufwandmenge_einheit: ae,
    menge_gesamt: bruehe, menge_einheit: bruehe !== null ? 'l' : null,
    wasseraufwand_l_ha: wasser, reinkupfer_kg_ha: null,
  }
  const normal = { ...eingabe(e, werte), flaecheHa: ha }
  const mm = mittelmenge(normal)
  if (mm.menge === null && mm.warnung) hinweise.push(`Mittelmenge nicht berechenbar (${mm.warnung}).`)
  const cuKg = reinkupfer(e, mm, ha, werte, hinweise)
  return { ok: true, werte, mittelmenge: mm, spritzbruehe: spritzbruehe(normal), cuKg, hinweise }
}

/**
 * Reinkupfer wie die Kupfer-Bilanz: Mittelmenge (l mit 1 kg/l) × Cu-Gehalt, je ha der Maßnahme – setzt
 * werte.reinkupfer_kg_ha, liefert Reinkupfer gesamt (kg) bzw. null (Spritzung und Sonstiges)
 */
function reinkupfer(e: MassnahmeMengenEingabe, mm: MittelmengeErgebnis, ha: number | null, werte: MassnahmeMengenWerte, hinweise: string[]): number | null {
  const pct = kupferGehaltPct(e.psm)
  if (pct === null || mm.menge === null) return null
  const cuKg = runden(mm.menge * pct / 100, STELLEN_CU)
  if (mm.einheit === 'l') hinweise.push('Kupfermittel in Litern – für Reinkupfer Dichte 1 kg/l angenommen (wie Kupfer-Bilanz).')
  if (ha !== null) {
    const jeHa = runden(cuKg / ha, STELLEN_CU)
    if (jeHa <= MAX_REINKUPFER_KG_HA) werte.reinkupfer_kg_ha = jeHa
    else hinweise.push(`Reinkupfer je ha nicht gespeichert: ${zahlText(cuKg, STELLEN_CU)} kg Cu auf ${zahlText(ha, 4)} ha wären ${zahlText(jeHa, 2)} kg/ha – bitte Aufwand und Fläche prüfen.`)
  }
  return cuKg
}

/** Werte → Eingabe für mittelmenge() (ohne Fläche und Düngemittel) */
function eingabe(e: MassnahmeMengenEingabe, w: MassnahmeMengenWerte) {
  return {
    art: e.art,
    aufwand: w.aufwandmenge, aufwandEinheit: w.aufwandmenge_einheit,
    mengeGesamt: w.menge_gesamt, mengeEinheit: w.menge_einheit,
    wasserLHa: w.wasseraufwand_l_ha,
  }
}
