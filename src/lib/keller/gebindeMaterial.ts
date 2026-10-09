// Material eines Gebindes (KAN-48 AP11, 09.10.2026) – BKI-Blatt „GebindeVerzeichnis“, Spalte „Material (Glas, Edelstahl,
// Holz …)“. Freitext (varchar 255) mit Vorschlagsliste; ohne Angabe wird es aus dem Gebindetyp vorbelegt – dieselbe
// Zuordnung wie die Migration kan48_ap11_betriebsdaten_gebinde (nur eindeutige Typen).
// Isomorph, ohne '@/'-Importe (Formulare und node:test).

export const GEBINDE_MATERIALIEN = ['Edelstahl', 'Holz', 'Beton', 'Kunststoff', 'Glas', 'Ton', 'Stahl emailliert', 'Fiberglas'] as const

const AUS_TYP: Record<string, string> = {
  stahltank: 'Edelstahl', immervolltank: 'Edelstahl',
  holzfass: 'Holz', barrique: 'Holz', doppelbarrique: 'Holz',
  betonei: 'Beton', amphore: 'Ton',
}

export function materialAusTyp(typ: string | null | undefined): string | null {
  return typ ? AUS_TYP[typ] ?? null : null
}

/** Formularwerte → Spalten; ohne Material-Angabe die Vorbelegung aus dem Typ */
export function materialFelder(material: unknown, bezeichnungLang: unknown, typ: string | null): { material: string | null; bezeichnung_lang: string | null } {
  const m = typeof material === 'string' ? material.trim().slice(0, 255) : ''
  const b = typeof bezeichnungLang === 'string' ? bezeichnungLang.trim().slice(0, 255) : ''
  return { material: m || materialAusTyp(typ), bezeichnung_lang: b || null }
}

/** 23505 auf dem Index behaelter_name_je_betrieb (Bezeichnung je Betrieb eindeutig) */
export function gebindeNameDoppelt(error: unknown, name: string): string | null {
  const e = error as { code?: string; message?: string } | null
  if (e?.code !== '23505' || !/behaelter_name_je_betrieb/.test(String(e.message ?? ''))) return null
  return `Ein Gebinde mit der Bezeichnung „${name.trim()}“ gibt es in diesem Betrieb schon – die Bezeichnung muss eindeutig sein (Abgleich mit dem Kellerbuch).`
}
