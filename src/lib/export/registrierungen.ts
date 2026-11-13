// ── Weinexport: Export-Registrierungen des Betriebs (KAN-437 Teil 2, 13.11.2026) ──
// Manche Zielländer verlangen eine Registrierung des Herstellers, die abläuft (FDA mit US-Agent, GACC, MFDS); dazu die
// Bewilligung als Ermächtigter Ausführer. Bisher gab es dafür keinen Platz – eine abgelaufene FDA-Registrierung fiel
// erst an der Grenze auf. Tabelle export_registrierungen; hier die Regeln für Eingabe, Ablauf und Hinweise.
//
// Entscheidungen Jörgen 13.11.2026: Erinnerung 90 Tage vor Ablauf im Dashboard und als Hinweis am Exportauftrag in
// das betreffende Land (3A); eine fehlende oder abgelaufene Registrierung blockiert nichts, sie wird nur gemeldet (4A).
// Isomorph und ohne '@/'-Importe (node:test).

export const REGISTRIERUNG_ARTEN = {
  fda: { name: 'FDA Food Facility Registration (USA)', kurz: 'FDA-Registrierung', land: 'US', zusatz: 'US-Agent' },
  gacc: { name: 'GACC-Registrierung (China)', kurz: 'GACC-Registrierung', land: 'CN', zusatz: null },
  mfds: { name: 'MFDS-Vorregistrierung (Südkorea)', kurz: 'MFDS-Vorregistrierung', land: 'KR', zusatz: null },
  ermaechtigter_ausfuehrer: { name: 'Ermächtigter Ausführer (Bewilligung des Zollamts)', kurz: 'Bewilligung Ermächtigter Ausführer', land: null, zusatz: null },
  sonstige: { name: 'Sonstige Registrierung', kurz: 'Registrierung', land: null, zusatz: null },
} as const
export type RegistrierungArt = keyof typeof REGISTRIERUNG_ARTEN

export function istRegistrierungArt(v: unknown): v is RegistrierungArt {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(REGISTRIERUNG_ARTEN, v)
}

/** Tage vor dem Ablauf, ab denen erinnert wird */
export const REGISTRIERUNG_VORWARNUNG_TAGE = 90

export type Registrierung = {
  id: string
  art: string
  bezeichnung: string | null
  nummer: string
  gueltig_bis: string | null
  zusatz: string | null
  notiz: string | null
}

const TAG = /^\d{4}-\d{2}-\d{2}$/
const at = (tag: string) => tag.split('-').reverse().join('.')
const leer = (v: unknown) => typeof v !== 'string' || v.trim() === ''

/** Anzeigename: bei „sonstige“ die eigene Bezeichnung */
export function registrierungName(r: { art: string; bezeichnung?: string | null }): string {
  if (r.art === 'sonstige' || !istRegistrierungArt(r.art)) return (r.bezeichnung ?? '').trim() || 'Registrierung'
  return REGISTRIERUNG_ARTEN[r.art].kurz
}

/** Eingabeprüfung – dieselben Grenzen wie die Datenbank; null = in Ordnung */
export function registrierungEingabeFehler(e: { art: unknown; bezeichnung?: unknown; nummer: unknown; gueltig_bis?: unknown; zusatz?: unknown; notiz?: unknown }): string | null {
  if (!istRegistrierungArt(e.art)) return 'Bitte die Art der Registrierung wählen.'
  if (leer(e.nummer)) return 'Bitte die Nummer der Registrierung angeben.'
  if (String(e.nummer).trim().length > 60) return 'Die Nummer darf höchstens 60 Zeichen lang sein.'
  if (e.art === 'sonstige' && leer(e.bezeichnung)) return 'Bitte eine Bezeichnung angeben (z. B. Behörde und Land).'
  if (!leer(e.bezeichnung) && String(e.bezeichnung).trim().length > 120) return 'Die Bezeichnung darf höchstens 120 Zeichen lang sein.'
  if (!leer(e.gueltig_bis)) {
    const d = String(e.gueltig_bis).trim()
    if (!TAG.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return 'Das Ablaufdatum ist ungültig.'
  }
  if (!leer(e.zusatz) && String(e.zusatz).trim().length > 200) return 'Der Zusatz darf höchstens 200 Zeichen lang sein.'
  if (!leer(e.notiz) && String(e.notiz).trim().length > 400) return 'Die Notiz darf höchstens 400 Zeichen lang sein.'
  return null
}

function plusTage(tag: string, tage: number): string {
  const d = new Date(`${tag}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + tage)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

export type RegistrierungStufe = 'ohne_ablauf' | 'gueltig' | 'laeuft_ab' | 'abgelaufen'

/** Stand einer Registrierung zum Stichtag (JJJJ-MM-TT, Wiener Kalendertag); der letzte gültige Tag zählt noch */
export function registrierungStand(r: { gueltig_bis: string | null }, heute: string): { stufe: RegistrierungStufe; text: string } {
  const bis = r.gueltig_bis && TAG.test(r.gueltig_bis.slice(0, 10)) ? r.gueltig_bis.slice(0, 10) : null
  if (!bis) return { stufe: 'ohne_ablauf', text: 'ohne Ablaufdatum' }
  if (bis < heute) return { stufe: 'abgelaufen', text: `abgelaufen am ${at(bis)}` }
  if (bis <= plusTage(heute, REGISTRIERUNG_VORWARNUNG_TAGE)) return { stufe: 'laeuft_ab', text: `läuft am ${at(bis)} ab` }
  return { stufe: 'gueltig', text: `gültig bis ${at(bis)}` }
}

/** FDA: Erneuerung alle zwei Jahre, jeweils von Oktober bis Dezember gerader Jahre */
export function fdaErneuerungsfenster(heute: string): boolean {
  const jahr = Number(heute.slice(0, 4)), monat = Number(heute.slice(5, 7))
  return jahr % 2 === 0 && monat >= 10
}

/** Registrierungen, die ein Zielland vom Hersteller verlangt (laut Länderhinweisen; `geprueft` wie dort) */
const JE_LAND: Record<string, { art: RegistrierungArt; geprueft: boolean }[]> = {
  US: [{ art: 'fda', geprueft: true }],
  CN: [{ art: 'gacc', geprueft: false }],
  KR: [{ art: 'mfds', geprueft: false }],
}

/**
 * Hinweise am Exportauftrag: fehlt eine für das Zielland verlangte Registrierung, ist sie abgelaufen oder läuft sie
 * bald ab? Mehrere Einträge derselben Art: der mit dem spätesten Ablauf zählt (einer ohne Ablaufdatum gilt als gültig).
 */
export function registrierungHinweise(land: unknown, liste: readonly Registrierung[], heute: string): string[] {
  const iso = typeof land === 'string' ? land.trim().toUpperCase() : ''
  const aus: string[] = []
  for (const { art, geprueft } of JE_LAND[iso] ?? []) {
    const name = REGISTRIERUNG_ARTEN[art].kurz
    const vermerk = geprueft ? '' : ' (laut Länderhinweis nötig – nicht geprüft)'
    const eigene = liste.filter(r => r.art === art)
    if (eigene.length === 0) { aus.push(`${name} ist nicht hinterlegt${vermerk}.`); continue }
    const beste = [...eigene].sort((a, b) => String(b.gueltig_bis ?? '9999').localeCompare(String(a.gueltig_bis ?? '9999')))[0]
    const s = registrierungStand(beste, heute)
    if (s.stufe === 'abgelaufen') aus.push(`${name} ${beste.nummer}: ${s.text}${vermerk}.`)
    else if (s.stufe === 'laeuft_ab') aus.push(`${name} ${beste.nummer}: ${s.text}.`)
    if (art === 'fda' && fdaErneuerungsfenster(heute) && s.stufe !== 'abgelaufen' && (!beste.gueltig_bis || beste.gueltig_bis.slice(0, 4) <= heute.slice(0, 4))) {
      aus.push('FDA-Registrierung: Die Erneuerung ist jetzt fällig (Oktober bis Dezember gerader Jahre).')
    }
  }
  return aus
}

export type RegistrierungFrist = { key: string; bezeichnung: string; hinweis: string; faelligAm: string; status: 'ueberfaellig' | 'faellig'; statusText: string }

/** Fristen für das Dashboard: abgelaufene und binnen 90 Tagen ablaufende Registrierungen */
export function registrierungFristen(liste: readonly Registrierung[], heute: string): RegistrierungFrist[] {
  const aus: RegistrierungFrist[] = []
  for (const r of liste) {
    const s = registrierungStand(r, heute)
    if (s.stufe !== 'abgelaufen' && s.stufe !== 'laeuft_ab') continue
    aus.push({
      key: `exportreg:${r.id}`, bezeichnung: `${registrierungName(r)} erneuern`,
      hinweis: `Nr. ${r.nummer}${r.zusatz ? ` · ${r.zusatz}` : ''} – Weinexport › Registrierungen`,
      faelligAm: String(r.gueltig_bis).slice(0, 10), status: s.stufe === 'abgelaufen' ? 'ueberfaellig' : 'faellig', statusText: s.text,
    })
  }
  return aus
}
