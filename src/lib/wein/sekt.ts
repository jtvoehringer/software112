// Sekt-Stufen und Hefelagerung – KAN-190 (07.10.2026, „umsetzen wie im Vorschlag“ Jörgen 06.10.2026)
//
//  • Sekt Austria (Klassik): alle Gärmethoden, mindestens 9 Monate Hefelagerung
//  • Sekt Austria Reserve: traditionelle Flaschengärung, mindestens 18 Monate
//  • Sekt Austria Große Reserve: Flaschengärung, lagenreine Trauben (100 % eine Ried), mindestens 36 Monate
// Stichtag der Hefelagerung ist die Tirage (Beginn der Zweitgärung); gezählt bis zum Degorgieren, sonst bis heute.
// Abstufen ja, Aufwerten nein. Dieselben Regeln prüft die RPC s112_sekt_stufe_setzen. Isomorph, ohne '@/'-Importe.

export const SEKT_STUFEN = [
  { value: 'klassik', label: 'Sekt Austria', kurz: 'Klassik', monate: 9, flaschengaerung: false, lagenrein: false },
  { value: 'reserve', label: 'Sekt Austria Reserve', kurz: 'Reserve', monate: 18, flaschengaerung: true, lagenrein: false },
  { value: 'grosse_reserve', label: 'Sekt Austria Große Reserve', kurz: 'Große Reserve', monate: 36, flaschengaerung: true, lagenrein: true },
] as const
export type SektStufe = (typeof SEKT_STUFEN)[number]['value']

export const GAERMETHODEN = [
  { value: 'flaschengaerung', label: 'Traditionelle Flaschengärung' },
  { value: 'tankgaerung', label: 'Tankgärung' },
] as const
export type Gaermethode = (typeof GAERMETHODEN)[number]['value']

export function istSektStufe(x: unknown): x is SektStufe {
  return SEKT_STUFEN.some(s => s.value === x)
}
export function istGaermethode(x: unknown): x is Gaermethode {
  return GAERMETHODEN.some(g => g.value === x)
}
export function sektStufeLabel(x: string | null | undefined): string | null {
  return SEKT_STUFEN.find(s => s.value === x)?.label ?? null
}

/** Volle Monate zwischen zwei Daten (JJJJ-MM-TT), wie age() in PostgreSQL: der Monat zählt erst am selben Tag */
export function volleMonate(von: string, bis: string): number {
  const [vj, vm, vt] = von.split('-').map(Number)
  const [bj, bm, bt] = bis.split('-').map(Number)
  let m = (bj - vj) * 12 + (bm - vm)
  if (bt < vt) m -= 1
  return m
}

/**
 * Prüfung „Stufe vergeben / degorgieren“: null = in Ordnung, sonst die erste Meldung. `alt` ist die bisher vergebene
 * Stufe, `stichtag` das Degorgier-Datum bzw. heute.
 */
export function sektStufeFehler(p: {
  stufe: SektStufe | null; alt: SektStufe | null; tirage: string | null; gaermethode: string | null
  stichtag: string; lagenrein: boolean
}): string | null {
  if (!p.tirage) return 'Sekt-Stufen gibt es nur mit erfasster Tirage (Beginn der Zweitgärung).'
  const stufe = p.stufe ?? p.alt
  if (!stufe) return null
  const s = SEKT_STUFEN.find(x => x.value === stufe)!
  if (p.alt && SEKT_STUFEN.findIndex(x => x.value === stufe) > SEKT_STUFEN.findIndex(x => x.value === p.alt)) {
    return `„${sektStufeLabel(p.alt)}“ ist schon vergeben – eine Aufwertung auf „${s.label}“ ist nicht möglich (nur Abstufen).`
  }
  const monate = volleMonate(p.tirage, p.stichtag)
  if (monate < s.monate) {
    const t = p.tirage.split('-').reverse().join('.')
    return `„${s.label}“ verlangt mindestens ${s.monate} Monate Hefelagerung – seit der Tirage am ${t} sind es ${monate} Monate.`
  }
  if (s.flaschengaerung && p.gaermethode !== 'flaschengaerung') return `„${s.label}“ verlangt die traditionelle Flaschengärung.`
  if (s.lagenrein && !p.lagenrein) return `„${s.label}“ verlangt lagenreine Trauben (100 % aus einer Ried).`
  return null
}

/** Höchste Stufe, die heute (bzw. am Stichtag) möglich wäre – für den Hinweis im Formular */
export function moeglicheSektStufe(p: { tirage: string | null; gaermethode: string | null; stichtag: string; lagenrein: boolean }): SektStufe | null {
  for (const s of [...SEKT_STUFEN].reverse()) {
    if (!sektStufeFehler({ stufe: s.value, alt: null, tirage: p.tirage, gaermethode: p.gaermethode, stichtag: p.stichtag, lagenrein: p.lagenrein })) return s.value
  }
  return null
}

/** Lagenrein = die gesamte Menge stammt aus genau einer Ried (Anteile der Zusammensetzung mit Ried) */
export function istLagenrein(anteile: readonly { ried: string | null | undefined; liter: number }[]): boolean {
  const mit = anteile.filter(a => a.liter > 0)
  if (mit.length === 0) return false
  const rieden = new Set(mit.map(a => (a.ried ?? '').trim().toLocaleLowerCase('de')))
  return rieden.size === 1 && !rieden.has('')
}

/**
 * Tirage beim Anlegen einer Füllung (Formularfelder `gaermethode`, `tirage_datum`): nur bei Erzeugnis SEKTGU; mit
 * Gärmethode ist das Tirage-Datum Pflicht (Vorgabe: Datum der Füllung), nicht nach der Füllung und nicht in der Zukunft.
 * Ohne Gärmethode keine Tirage (Sekt aus Lohnversektung o. ä. ohne Hefelagerung im Betrieb).
 */
export function tirageAusFormular(
  gaermethodeRoh: unknown, tirageRoh: unknown, erzeugnis: string | null, fuellungsDatum: string, heute: string,
): { spalten: { tirage_datum: string | null; gaermethode: Gaermethode | null } } | { fehler: string } {
  const g = typeof gaermethodeRoh === 'string' ? gaermethodeRoh.trim() : ''
  const t = typeof tirageRoh === 'string' ? tirageRoh.trim().slice(0, 10) : ''
  if (!g && !t) return { spalten: { tirage_datum: null, gaermethode: null } }
  if (erzeugnis !== 'SEKTGU') return { fehler: 'Tirage und Gärmethode gibt es nur bei Erzeugnis „Sekt g.U.“.' }
  if (!istGaermethode(g)) return { fehler: 'Bitte die Gärmethode wählen (Flaschengärung oder Tankgärung).' }
  const tirage = t || fuellungsDatum
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tirage)) return { fehler: 'Bitte das Datum der Tirage (Beginn der Zweitgärung) angeben.' }
  if (tirage > heute) return { fehler: 'Das Datum der Tirage liegt in der Zukunft.' }
  if (fuellungsDatum && tirage > fuellungsDatum) return { fehler: 'Die Tirage kann nicht nach der Füllung liegen.' }
  return { spalten: { tirage_datum: tirage, gaermethode: g } }
}
