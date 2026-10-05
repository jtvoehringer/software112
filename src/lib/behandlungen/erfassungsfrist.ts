// ── Erfassungsfrist der Pflanzenschutz- und Düngeaufzeichnung (KAN-87, 05.10.2026) ──────────────────────
//
// DVO (EU) 2023/564: elektronische Aufzeichnung spätestens 30 Tage nach der Anwendung (ab 01.01.2027); der Betrieb
// gibt sich eine engere Frist (Standard 24 h, tenant_einstellungen.psm_erfassungsfrist_h). Entscheidung Jörgen
// (05.10.2026): Sie läuft ab Tagesende des (letzten) Anwendungstags in Wiener Zeit (datum_bis, sonst datum, 24:00) –
// die Enduhrzeit zählt nicht – und gilt für Maßnahmen mit Pflanzenschutzmittel UND für Düngungen.
// Erfasst am = behandlungen.created_at (setzt die Datenbank, unveränderlich).
// Ampel: grün bis zur Frist, gelb bis 72 h, rot darüber. Der Hinweis „Nacherfassung (+n h)“ blockiert nie.
// Ohne '@/'-Importe, damit node:test sie prüfen kann.

export const PSM_FRIST_STANDARD_H = 24
export const PSM_FRIST_GELB_BIS_H = 72

export type ErfassungsAmpel = 'gruen' | 'gelb' | 'rot'

export const ART_VERWENDUNG = ['freiland', 'gewaechshaus', 'vorratsschutz', 'saatgut', 'sonstige'] as const
export type ArtVerwendung = (typeof ART_VERWENDUNG)[number]
export const ART_VERWENDUNG_LABEL: Record<ArtVerwendung, string> = {
  freiland: 'Freiland',
  gewaechshaus: 'Gewächshaus',
  vorratsschutz: 'Vorratsschutz / Lager',
  saatgut: 'Saatgut / Pflanzgut',
  sonstige: 'Sonstige',
}
export function istArtVerwendung(v: unknown): v is ArtVerwendung {
  return typeof v === 'string' && (ART_VERWENDUNG as readonly string[]).includes(v)
}

const WIEN = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** Versatz Wien gegen UTC (ms) zum Zeitpunkt t */
function wienVersatz(t: number): number {
  const f: Record<string, number> = {}
  for (const p of WIEN.formatToParts(new Date(t))) if (p.type !== 'literal') f[p.type] = Number(p.value)
  return Date.UTC(f.year, f.month - 1, f.day, f.hour === 24 ? 0 : f.hour, f.minute, f.second) - Math.floor(t / 1000) * 1000
}

/** Wiener Wandzeit ('JJJJ-MM-TT', 'HH:MM[:SS]') → Zeitpunkt (ms seit 1970); null bei ungültiger Angabe */
export function wienZeitpunkt(datum: string, zeit = '00:00'): number | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(datum ?? '')
  const z = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(zeit ?? '')
  if (!d || !z) return null
  const roh = Date.UTC(+d[1], +d[2] - 1, +d[3], +z[1], +z[2], +(z[3] ?? 0))
  // zweimal: am Tag der Zeitumstellung kann der Versatz um die gesuchte Zeit wechseln
  const t1 = roh - wienVersatz(roh)
  return roh - wienVersatz(t1)
}

/** Heute als 'JJJJ-MM-TT' in Wiener Zeit (Vorbelegung Datum im Formular – nie toISOString, das ist UTC) */
export function wienHeute(jetzt: Date = new Date()): string {
  const f: Record<string, string> = {}
  for (const p of WIEN.formatToParts(jetzt)) if (p.type !== 'literal') f[p.type] = p.value
  return `${f.year}-${f.month}-${f.day}`
}

/** Tag nach 'JJJJ-MM-TT' (stringbasiert) */
function folgetag(datum: string): string {
  const [j, m, t] = datum.slice(0, 10).split('-').map(Number)
  const d = new Date(Date.UTC(j, m - 1, t + 1))
  return d.toISOString().slice(0, 10)
}

export type AnwendungsZeit = {
  datum: string
  datumBis?: string | null
}

/** Beginn der Frist (ms): Tagesende des letzten Anwendungstags (24:00 Wiener Zeit) – die Uhrzeit zählt nicht */
export function anwendungsEnde(a: AnwendungsZeit): number | null {
  const tag = (a.datumBis || a.datum || '').slice(0, 10)
  if (!tag) return null
  return wienZeitpunkt(folgetag(tag), '00:00')
}

/** Volle Stunden zwischen Tagesende der Anwendung und Erfassung (≥ 0); null ohne Datum */
export function erfassungsverzugH(a: AnwendungsZeit, erfasstAm: Date | string | number): number | null {
  const ende = anwendungsEnde(a)
  const erfasst = typeof erfasstAm === 'number' ? erfasstAm : new Date(erfasstAm).getTime()
  if (ende === null || !Number.isFinite(erfasst)) return null
  return Math.max(0, Math.floor((erfasst - ende) / 3600000))
}

/** Ampel zum Verzug: grün bis zur Frist, gelb bis 72 h (bzw. bis zur Frist, wenn sie länger ist), rot darüber */
export function erfassungsAmpel(verzugH: number | null, fristH: number = PSM_FRIST_STANDARD_H): ErfassungsAmpel {
  if (verzugH === null || verzugH <= fristH) return 'gruen'
  return verzugH <= Math.max(PSM_FRIST_GELB_BIS_H, fristH) ? 'gelb' : 'rot'
}

/** „nacherfasst (+n h)“ über der Frist, sonst null – dieselbe Markierung in Liste, Formular und Assistent */
export function nacherfasstText(verzugH: number | null, fristH: number = PSM_FRIST_STANDARD_H): string | null {
  return verzugH !== null && verzugH > fristH ? `nacherfasst (+${verzugH} h)` : null
}

/** Hinweis beim Speichern (blockiert nicht) */
export function nacherfassungHinweis(verzugH: number | null, fristH: number = PSM_FRIST_STANDARD_H): string | null {
  if (verzugH === null || verzugH <= fristH) return null
  return `Nacherfassung (+${verzugH} h): Die Aufzeichnung liegt über der Erfassungsfrist von ${fristH} h ab Ende des Anwendungstags – gespeichert und als „nacherfasst“ markiert.`
}

/** Frist gilt für Maßnahmen mit Pflanzenschutzmittel und für Düngungen (Entscheidung 05.10.2026) */
export function fristRelevant(b: { art?: string | null; psmId?: string | null; psm_id?: string | null }): boolean {
  return !!(b.psmId ?? b.psm_id) || b.art === 'duengung'
}

/** Frist aus den Einstellungen (1–720 h), sonst Standard */
export function fristAus(wert: unknown): number {
  const n = Number(wert)
  return Number.isInteger(n) && n >= 1 && n <= 720 ? n : PSM_FRIST_STANDARD_H
}

const ZEIT_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

/** Uhrzeit aus dem Formular ('HH:MM'); leer → null, ungültig → undefined */
export function uhrzeitAus(v: unknown): string | null | undefined {
  const s = typeof v === 'string' ? v.trim() : ''
  if (!s) return null
  return ZEIT_RE.test(s) ? s.slice(0, 5) : undefined
}

export type UhrzeitEingabe = {
  datum: string
  datumBis?: string | null
  uhrzeitVon: string | null
  uhrzeitBis: string | null
  bienengefaehrlich: boolean
}

/** Pflicht- und Plausibilitätsprüfung der Uhrzeiten (Formular, Bearbeiten, Assistent); null = ok */
export function uhrzeitFehler(e: UhrzeitEingabe): string | null {
  if (e.bienengefaehrlich && !e.uhrzeitVon) {
    return 'Das Mittel ist bienengefährlich – bitte die Startuhrzeit der Anwendung angeben.'
  }
  const mehrtaegig = !!e.datumBis && e.datumBis.slice(0, 10) > e.datum.slice(0, 10)
  if (e.uhrzeitVon && e.uhrzeitBis && !mehrtaegig && e.uhrzeitBis < e.uhrzeitVon) {
    return 'Die Enduhrzeit liegt vor der Startuhrzeit.'
  }
  return null
}

/** Endzeitpunkt der Anwendung liegt in der Zukunft? (Aufzeichnung vor der Anwendung – nur Hinweis) */
export function anwendungInZukunft(a: AnwendungsZeit & { uhrzeitVon?: string | null }, jetzt: number = Date.now()): boolean {
  const beginn = wienZeitpunkt(a.datum, a.uhrzeitVon || '00:00')
  return beginn !== null && beginn > jetzt
}

// ── Anwender (KAN-87) ────────────────────────────────────────────────────────────────────────────────────
// Formularfeld „anwender“: leer = angemeldeter Benutzer, '<user-id>' = Mitglied, ANWENDER_FREMD + „anwender_name“ =
// Fremdanwender (Lohnunternehmer, Nachbar …). In der Datenbank genau eines von durchgefuehrt_von / anwender_name.
export const ANWENDER_FREMD = '__fremd__'

export type AnwenderWahl = { durchgefuehrtVon: string | null; anwenderName: string | null }

export function anwenderAus(
  wahl: unknown, fremdName: unknown, angemeldet: string | null, mitglieder: readonly string[],
): AnwenderWahl | { fehler: string } {
  const w = typeof wahl === 'string' ? wahl.trim() : ''
  if (w === ANWENDER_FREMD) {
    const name = typeof fremdName === 'string' ? fremdName.trim().replace(/\s+/g, ' ') : ''
    if (!name) return { fehler: 'Bitte den Namen des Fremdanwenders angeben.' }
    if (name.length > 120) return { fehler: 'Der Name des Anwenders ist zu lang (höchstens 120 Zeichen).' }
    return { durchgefuehrtVon: null, anwenderName: name }
  }
  // ohne Auswahl der angemeldete Benutzer – Mitglied über die aktive Mitgliedschaft (die Datenbank prüft ohnehin)
  if (!w) return { durchgefuehrtVon: angemeldet, anwenderName: null }
  const id = w
  if (!mitglieder.includes(id)) return { fehler: 'Der gewählte Anwender ist kein Mitglied dieses Betriebs – Fremdanwender bitte als Namen erfassen.' }
  return { durchgefuehrtVon: id, anwenderName: null }
}

/** Anzeigename des Anwenders: Fremdanwender-Name, sonst Name des Mitglieds */
export function anwenderText(durchgefuehrtVon: string | null | undefined, anwenderName: string | null | undefined, namen?: ReadonlyMap<string, string>): string | null {
  if (anwenderName && anwenderName.trim()) return anwenderName.trim()
  return durchgefuehrtVon ? (namen?.get(durchgefuehrtVon) ?? null) : null
}

/**
 * Assistent: Anwender als Text → Formularwerte. Leer, „ich“, „selbst“ = angemeldeter Benutzer; ein Mitglied über den
 * Namen (ohne Groß-/Kleinschreibung, auch nur Vor- oder Nachname, wenn eindeutig); sonst Fremdanwender.
 */
export function anwenderZuordnen(text: unknown, mitglieder: readonly { id: string; name: string }[]): { anwender: string; anwenderName?: string } {
  const t = typeof text === 'string' ? text.trim().replace(/\s+/g, ' ') : ''
  if (!t || /^(ich|mich|mir|selbst|selber)$/i.test(t)) return { anwender: '' }
  const klein = t.toLocaleLowerCase('de')
  const genau = mitglieder.filter(m => m.name.toLocaleLowerCase('de') === klein)
  if (genau.length === 1) return { anwender: genau[0].id }
  const teil = mitglieder.filter(m => m.name.toLocaleLowerCase('de').split(' ').includes(klein))
  if (teil.length === 1) return { anwender: teil[0].id }
  return { anwender: ANWENDER_FREMD, anwenderName: t }
}

// ── Fristen-Dashboard (KAN-87) ───────────────────────────────────────────────────────────────────────────
export type PsmErfassungZeile = { datum: string; datum_bis?: string | null; created_at: string }

/**
 * Eintrag „Aufzeichnung Pflanzenschutz & Düngung (24 h)“: Ampel der Saison (schlechteste Erfassung: grün = alle in der Frist, gelb = bis
 * 72 h, rot = darüber) und Zahl der Nacherfassungen. Status wie die übrigen Fristen: laufend / faellig / ueberfaellig.
 */
export function psmErfassungFrist(zeilen: readonly PsmErfassungZeile[], fristH: number = PSM_FRIST_STANDARD_H, jahr: number) {
  let nach = 0
  let max = 0
  let ampel: ErfassungsAmpel = 'gruen'
  for (const z of zeilen) {
    const v = erfassungsverzugH({ datum: z.datum, datumBis: z.datum_bis ?? null }, z.created_at)
    if (v === null || v <= fristH) continue
    nach++
    max = Math.max(max, v)
    const a = erfassungsAmpel(v, fristH)
    if (a === 'rot' || ampel === 'gruen') ampel = a
  }
  const status = ampel === 'rot' ? 'ueberfaellig' as const : ampel === 'gelb' ? 'faellig' as const : 'laufend' as const
  return {
    key: 'psm-erfassung',
    bezeichnung: `Aufzeichnung Pflanzenschutz & Düngung (${fristH} h)`,
    kategorie: 'weinrecht',
    hinweis: `Pflanzenschutz und Düngung innerhalb von ${fristH} h ab Ende des Anwendungstags erfassen (DVO (EU) 2023/564: elektronisch, spätestens 30 Tage) · Ampel ${ampel === 'gruen' ? 'grün' : ampel}`,
    faelligAm: null as string | null,
    status,
    ampel,
    nacherfassungen: nach,
    statusText: zeilen.length === 0
      ? `keine Anwendungen ${jahr}`
      : nach === 0
        ? `${zeilen.length} ${zeilen.length === 1 ? 'Anwendung' : 'Anwendungen'} ${jahr} · alle rechtzeitig`
        : `${nach} ${nach === 1 ? 'Nacherfassung' : 'Nacherfassungen'} ${jahr} · max. +${max} h`,
  }
}
