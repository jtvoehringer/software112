// ── Abstufen bei der Lese (KAN-81, 04.10.2026) ──────────────────────────────────────────────────────────────
//
// R8 „händisch downgraden (bei ernte schon – also nicht fix hinterlegen) aber nicht upgraden“: An der Lese sind
// Qualitätsstufe und Herkunft eine Auswahl bis zur Obergrenze – vorbelegt mit der Obergrenze, höher wird abgelehnt.
//   - Stufe: Obergrenze aus den °KMW (ohne Mostgewicht Qualitätswein), bei einer Eiswein-Lese Eiswein (KAN-129)
//   - Herkunft: Code des Grundstücks, nach dem Sortenspiegel abgestuft (findePassendeHerkunftsstufe); wählbar ist
//     er selbst und jede breitere Stufe im Baum (zulaessigeHerkuenfte, wie bei der Füllung – kein Astwechsel)
// Die Pressung übernimmt höchstens die niedrigste Stufe der verpressten Lese-Einträge (leseStufeFuerZeile).
// Entscheidungen Jörgen (04.10.2026): Die abgestufte Stufe geht so in die Erntemeldung (Meldung = Aufzeichnung);
// die Sammelerfassung hat gemeinsame Felder „Abstufen auf“ – jede Zeile bekommt höchstens ihre Obergrenze.
// Formular und Server nutzen dieselben Funktionen.

import { abstufungFehler, abstufungsOptionen, qualitaetLabel, type QualitaetsOption } from '@/lib/wein/qualitaet'
import { niedrigsteQualitaet } from '@/lib/wein/qualitaetsrang'
import { kmwZuQualitaet } from '@/lib/weinqualitaet'
import { leseStufe } from '@/lib/wein/lesen'
import { findePassendeHerkunftsstufe, herkunftZulaessig, HERKUNFT_LABEL, zulaessigeHerkuenfte } from '@/lib/herkunft'

/** Obergrenze der Stufe einer Lese: aus den °KMW (ohne gültiges Mostgewicht Qualitätswein), Eiswein-Lese = Eiswein */
export function leseObergrenze(leseArt: string | null | undefined, kmw: number | null | undefined): string {
  return leseStufe(leseArt, kmw != null && Number.isFinite(kmw) ? kmwZuQualitaet(kmw) : 'qualitaetswein')
}

/** Auswahl der Stufe an der Lese: Lese-Stufen bis zur Obergrenze, Obergrenze zuerst */
export function leseStufenOptionen(obergrenze: string): readonly QualitaetsOption[] {
  return abstufungsOptionen(obergrenze)
}

/** Serverprüfung: Meldung, wenn `wahl` über der Obergrenze liegt, sonst null (leer = Obergrenze) */
export function leseStufeFehler(wahl: string | null | undefined, obergrenze: string): string | null {
  return abstufungFehler(wahl, obergrenze)
}

/** Sammelerfassung: „Abstufen auf“ gilt höchstens bis zur Obergrenze der Zeile (leer = Obergrenze) */
export function leseStufeGedeckelt(obergrenze: string, abstufenAuf: string | null | undefined): string {
  if (!abstufenAuf) return obergrenze
  return abstufungFehler(abstufenAuf, obergrenze) ? obergrenze : abstufenAuf
}

/**
 * KAN-393: Auswahl „Abstufen auf“ der Sammelerfassung – nur Stufen UNTER der höchsten Obergrenze der Zeilen
 * (°KMW je Zeile, null = ohne Mostgewicht; ohne Zeilen zählt das gemeinsame Mostgewicht als eine Zeile).
 * Eiswein nur bei einer Eiswein-Lese. Jede Zeile wird beim Speichern zusätzlich auf ihre Obergrenze gedeckelt.
 * `liste` = Stufenliste der Zieltabelle (LESE_QUALITAETEN, vom Formular übergeben – Wächter qualitaet.test.mjs).
 */
export function sammelAbstufenOptionen(liste: readonly QualitaetsOption[], leseArt: string | null | undefined, kmwJeZeile: readonly (number | null | undefined)[]): readonly QualitaetsOption[] {
  const grenzen = (kmwJeZeile.length > 0 ? kmwJeZeile : [null]).map(k => leseObergrenze(leseArt, k))
  const hoechste = grenzen.reduce((a, b) => (abstufungFehler(b, a) ? b : a))
  const max = liste.find(o => o.value === hoechste)?.rang ?? 2
  return liste.filter(o => o.rang < max && (leseArt === 'eiswein' || o.value !== 'eiswein'))
    .slice().sort((a, b) => b.rang - a.rang)
}

/** Obergrenze der Herkunft: Code des Grundstücks, nach dem Sortenspiegel abgestuft */
export function leseHerkunftObergrenze(gstHerkunft: string | null | undefined, rebsorte: string | null | undefined): { code: string | null; sortenspiegel: boolean } {
  const p = findePassendeHerkunftsstufe(gstHerkunft ?? null, rebsorte ?? null)
  return { code: p.code, sortenspiegel: p.abgestuft }
}

/** Wählbare Herkünfte: die Obergrenze und alle breiteren Stufen (leer, wenn das Grundstück keinen Code hat) */
export function leseHerkunftOptionen(obergrenze: string | null | undefined): { value: string; label: string }[] {
  return (zulaessigeHerkuenfte(obergrenze) ?? []).map(c => ({ value: c, label: HERKUNFT_LABEL[c] ?? c }))
}

/** Gemeinsame Herkunfts-Auswahl der Sammelerfassung: nur Stufen, die für JEDE gewählte Fläche zulässig sind */
export function gemeinsameHerkunftOptionen(obergrenzen: readonly (string | null | undefined)[]): { value: string; label: string }[] {
  const listen = obergrenzen.map(o => zulaessigeHerkuenfte(o))
  if (listen.length === 0 || listen.some(l => !l)) return []
  const [erste, ...rest] = listen as string[][]
  return erste.filter(c => rest.every(l => l.includes(c))).map(c => ({ value: c, label: HERKUNFT_LABEL[c] ?? c }))
}

/** Serverprüfung der Herkunft: null = zulässig (leer = Obergrenze), sonst die Meldung */
export function leseHerkunftFehler(wahl: string | null | undefined, obergrenze: string | null | undefined, ort?: string): string | null {
  if (!wahl) return null
  if (!obergrenze) return `Die Herkunft kann ${ort ? `für ${ort} ` : ''}nicht gewählt werden – am Grundstück ist kein Herkunfts-Code hinterlegt.`
  if (herkunftZulaessig(obergrenze, wahl)) return null
  return `Die Herkunft „${HERKUNFT_LABEL[wahl] ?? wahl}“ ist ${ort ? `für ${ort} ` : ''}nicht zulässig – höchstens „${HERKUNFT_LABEL[obergrenze] ?? obergrenze}“ bzw. eine breitere Stufe (nur Abstufen ist möglich).`
}

/** Hinweis unter dem Feld: „abgestuft von Spätlese“ bzw. null, wenn die Obergrenze gewählt ist */
export function abgestuftVon(wahl: string | null | undefined, obergrenze: string | null | undefined, art: 'stufe' | 'herkunft'): string | null {
  if (!wahl || !obergrenze || wahl === obergrenze) return null
  return `abgestuft von ${art === 'stufe' ? qualitaetLabel(obergrenze) : (HERKUNFT_LABEL[obergrenze] ?? obergrenze)}`
}

/** Eintrag der Lese mit Stufe (für die Obergrenze der Pressung) */
export type LeseStufenEintrag = {
  weingarten_id: string; grundstueck_id: string | null; ernte_datum: string | null; qualitaetsstufe: string | null
}

/**
 * Stufe der Lese für eine Traubenzeile der Pressung: die Einträge desselben Orts (Ortsregel wie die Lesetage) und –
 * wenn die Zeile einen Lesetag hat und es Einträge dieses Tages gibt – nur dieses Tages; davon die niedrigste.
 * null, wenn keiner eine Stufe trägt.
 */
export function leseStufeFuerZeile(eintraege: readonly LeseStufenEintrag[], zeile: { weingarten_id?: string | null; grundstueck_id?: string | null; ernte_datum?: string | null }): string | null {
  if (!zeile.weingarten_id) return null
  const amOrt = eintraege.filter(e => zeile.grundstueck_id
    ? e.grundstueck_id === zeile.grundstueck_id || (!e.grundstueck_id && e.weingarten_id === zeile.weingarten_id)
    : e.weingarten_id === zeile.weingarten_id)
  const tag = (zeile.ernte_datum ?? '').slice(0, 10)
  const amTag = tag ? amOrt.filter(e => (e.ernte_datum ?? '').slice(0, 10) === tag) : []
  return niedrigsteQualitaet((amTag.length > 0 ? amTag : amOrt).map(e => e.qualitaetsstufe).filter((s): s is string => !!s)) ?? null
}

/** Obergrenze der Pressung aus der Lese: die niedrigste Stufe der Zeilen (ohne Stufe zählen nicht), sonst null */
export function pressungLeseGrenze(eintraege: readonly LeseStufenEintrag[], zeilen: readonly { weingarten_id?: string | null; grundstueck_id?: string | null; ernte_datum?: string | null }[]): string | null {
  const stufen = zeilen.map(z => leseStufeFuerZeile(eintraege, z)).filter((s): s is string => !!s)
  return stufen.length > 0 ? niedrigsteQualitaet(stufen) ?? null : null
}
