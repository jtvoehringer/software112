// ── Regelmaschine Wetter × Betriebsdaten (Jour fixe 9.9.2026) ────────────────
// Deterministisch und nachvollziehbar - keine Infektionsmodelle (die liefern
// die Warndienste der Landwirtschaftskammern, warndienst.at), sondern die
// Verknüpfung von Wetter und eigenen Behandlungen je Ried:
//   - Niederschlag seit der letzten Pflanzenschutz-Behandlung (Belag ab
//     ~20-30 mm abgewaschen, Schwelle je Betrieb einstellbar)
//   - Spritzintervall in der Saison (Standard 14 Tage)
//   - Spritzfenster aus der Prognose (Wind ≤ 15 km/h, kein Regen, Tageszeit)
//   - Frost (Apr-Mai), Hitze, Regen vor der Lese (Sep-Okt), feuchte Witterung
// Reine Funktionen, keine Datenbank - siehe docs/Morgenbericht_Wetter.md.

import type { WetterStunde } from './geosphere'
import type { WetterDaten } from './daten'

export type Stufe = 'hoch' | 'mittel' | 'info'
export type Befund = { key: string; bereich: string; stufe: Stufe; titel: string; detail: string; href?: string }

export type RegelRied = {
  id: string; name: string; ried: string | null; punktKey: string | null
  letzteBehandlung: { datum: string; mittel: string | null; wartezeitTage: number | null } | null
  ernteFruehestens: string | null
}
export type RegelEinstellungen = { abwaschMm: number; intervallTage: number }

export type RiedAuswertung = {
  id: string; name: string; ried: string | null
  letzteBehandlung: string | null; mittel: string | null; tageSeit: number | null
  regenSeit: number | null
  schutz: 'ok' | 'nachlassend' | 'abgewaschen' | 'intervall' | 'keine' | 'unbekannt'
  wartezeitBis: string | null
  hinweis: string
}
export type Spritzfenster = { von: string; bis: string; label: string }
export type WetterAuswertung = {
  stand: string | null
  prognoseStand: string | null
  punkte: number
  jetzt: { t2m: number | null; rh2m: number | null; windKmh: number | null; zeit: string } | null
  regen24h: number; regen72h: number; regen7d: number
  prognose: { regen24h: number; regen48h: number; tmin: number | null; tmax: number | null; windMaxKmh: number | null; boeMaxKmh: number | null } | null
  spritzfenster: Spritzfenster[]
  rieden: RiedAuswertung[]
  empfehlungen: Befund[]
}

const rund = (n: number, st = 1) => Math.round(n * 10 ** st) / 10 ** st
const kmh = (ms: number | null) => ms === null ? null : rund(ms * 3.6, 0)
const tageZwischen = (von: string, bis: string) => Math.round((new Date(bis + 'T00:00:00Z').getTime() - new Date(von + 'T00:00:00Z').getTime()) / 86400000)
const summeRr = (st: WetterStunde[], ab: Date, bis?: Date) => rund(st.filter(s => new Date(s.zeit) >= ab && (!bis || new Date(s.zeit) < bis)).reduce((a, s) => a + (s.rr ?? 0), 0))

const WIEN = 'Europe/Vienna'
function lokal(zeitIso: string): { stunde: number; label: string; tag: string } {
  const d = new Date(zeitIso)
  const f = new Intl.DateTimeFormat('de-AT', { timeZone: WIEN, hour: '2-digit', hour12: false })
  const t = new Intl.DateTimeFormat('de-AT', { timeZone: WIEN, weekday: 'short', day: '2-digit', month: '2-digit' })
  const y = new Intl.DateTimeFormat('en-CA', { timeZone: WIEN, year: 'numeric', month: '2-digit', day: '2-digit' })
  return { stunde: Number(f.format(d).replace(/\D/g, '')), label: t.format(d), tag: y.format(d) }
}
function heuteLokal(heute: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: WIEN, year: 'numeric', month: '2-digit', day: '2-digit' }).format(heute)
}

/** Spritzfenster: zusammenhängende Stunden 5-20 Uhr mit Wind ≤ 4 m/s (15 km/h), Böen ≤ 8 m/s, ≤ 0,1 mm Regen und kein Regen ≥ 1 mm in den folgenden 3 h */
export function spritzfensterAus(prognose: WetterStunde[], heute: Date): Spritzfenster[] {
  const heuteTag = heuteLokal(heute)
  const morgen = heuteLokal(new Date(heute.getTime() + 86400000))
  const ok = prognose.map((s, i) => {
    const { stunde, tag } = lokal(s.zeit)
    const folgend = prognose.slice(i + 1, i + 4).reduce((a, x) => a + (x.rr ?? 0), 0)
    const gut = stunde >= 5 && stunde < 20 && (s.wind_ms ?? 99) <= 4 && (s.boe_ms ?? 0) <= 8 && (s.rr ?? 0) <= 0.1 && folgend < 1
    return { s, gut, stunde, tag }
  })
  const fenster: Spritzfenster[] = []
  let start: typeof ok[number] | null = null, letzte: typeof ok[number] | null = null
  const abschliessen = () => {
    if (start && letzte && letzte.stunde - start.stunde >= 2) {
      const tagLabel = start.tag === heuteTag ? 'Heute' : start.tag === morgen ? 'Morgen' : lokal(start.s.zeit).label
      fenster.push({ von: start.s.zeit, bis: letzte.s.zeit, label: `${tagLabel} ${String(start.stunde).padStart(2, '0')}–${String(letzte.stunde + 1).padStart(2, '0')} Uhr` })
    }
    start = null; letzte = null
  }
  for (const h of ok) {
    if (h.gut && (!letzte || (h.tag === letzte.tag && h.stunde === letzte.stunde + 1))) { if (!start) start = h; letzte = h }
    else { abschliessen(); if (h.gut) { start = h; letzte = h } }
  }
  abschliessen()
  return fenster.slice(0, 4)
}

export function werteWetterAus(args: { rieden: RegelRied[]; wetter: WetterDaten[]; heute: Date; einst: RegelEinstellungen }): WetterAuswertung {
  const { rieden, wetter, heute, einst } = args
  const heuteStr = heuteLokal(heute)
  const monat = Number(heuteStr.slice(5, 7))
  const empfehlungen: Befund[] = []

  // Betriebsweite Kennzahlen aus dem Punkt mit den meisten Rieden (Repräsentant)
  const haupt = [...wetter].sort((a, b) => b.punkt.riedIds.length - a.punkt.riedIds.length)[0] ?? null
  const rueck = haupt?.rueckblick ?? []
  const prog = haupt?.prognose ?? []
  const letzteStunde = rueck.length ? rueck[rueck.length - 1] : null
  const jetzt = letzteStunde ? { t2m: letzteStunde.t2m, rh2m: letzteStunde.rh2m, windKmh: kmh(letzteStunde.wind_ms), zeit: letzteStunde.zeit } : null
  const regen24h = summeRr(rueck, new Date(heute.getTime() - 24 * 3600000))
  const regen72h = summeRr(rueck, new Date(heute.getTime() - 72 * 3600000))
  const regen7d = summeRr(rueck, new Date(heute.getTime() - 7 * 86400000))

  let prognose: WetterAuswertung['prognose'] = null
  if (prog.length) {
    const p24 = prog.filter(s => new Date(s.zeit) <= new Date(heute.getTime() + 24 * 3600000))
    const p48 = prog.filter(s => new Date(s.zeit) <= new Date(heute.getTime() + 48 * 3600000))
    const temps = p48.map(s => s.t2m).filter((t): t is number => t !== null)
    const winde = p48.map(s => s.wind_ms).filter((t): t is number => t !== null)
    const boen = p48.map(s => s.boe_ms).filter((t): t is number => t !== null)
    prognose = {
      regen24h: rund(p24.reduce((a, s) => a + (s.rr ?? 0), 0)), regen48h: rund(p48.reduce((a, s) => a + (s.rr ?? 0), 0)),
      tmin: temps.length ? rund(Math.min(...temps)) : null, tmax: temps.length ? rund(Math.max(...temps)) : null,
      windMaxKmh: winde.length ? kmh(Math.max(...winde)) : null, boeMaxKmh: boen.length ? kmh(Math.max(...boen)) : null,
    }
  }
  const spritzfenster = spritzfensterAus(prog, heute)

  // ── Rieden ──
  const riedenAus: RiedAuswertung[] = []
  for (const r of rieden) {
    const w = r.punktKey ? wetter.find(x => x.punkt.key === r.punktKey) : null
    const b = r.letzteBehandlung
    const wartezeitBis = b && b.wartezeitTage ? new Date(new Date(b.datum + 'T00:00:00Z').getTime() + b.wartezeitTage * 86400000).toISOString().slice(0, 10) : r.ernteFruehestens
    if (!b) { riedenAus.push({ id: r.id, name: r.name, ried: r.ried, letzteBehandlung: null, mittel: null, tageSeit: null, regenSeit: null, schutz: 'keine', wartezeitBis: null, hinweis: 'keine Pflanzenschutz-Behandlung in den letzten 45 Tagen' }); continue }
    const tageSeit = tageZwischen(b.datum, heuteStr)
    if (!w) { riedenAus.push({ id: r.id, name: r.name, ried: r.ried, letzteBehandlung: b.datum, mittel: b.mittel, tageSeit, regenSeit: null, schutz: 'unbekannt', wartezeitBis, hinweis: 'keine Koordinaten – Wetter nicht zuordenbar' }); continue }
    const regenSeit = summeRr(w.rueckblick, new Date(b.datum + 'T00:00:00Z'))
    let schutz: RiedAuswertung['schutz'] = 'ok'
    let hinweis = `letzte Behandlung vor ${tageSeit} Tagen, seither ${rund(regenSeit)} mm`
    const saison = monat >= 4 && monat <= 9   // Schutzbelag nur in der Vegetationszeit relevant
    if (saison && regenSeit >= einst.abwaschMm) { schutz = 'abgewaschen'; hinweis += ' – Belag abgewaschen, Schutz nicht mehr gegeben' }
    else if (saison && regenSeit >= einst.abwaschMm * 0.6) { schutz = 'nachlassend'; hinweis += ' – Belag nachlassend' }
    else if (tageSeit > einst.intervallTage && monat >= 5 && monat <= 8) { schutz = 'intervall'; hinweis += ` – Spritzintervall (${einst.intervallTage} Tage) abgelaufen` }
    riedenAus.push({ id: r.id, name: r.name, ried: r.ried, letzteBehandlung: b.datum, mittel: b.mittel, tageSeit, regenSeit: rund(regenSeit), schutz, wartezeitBis, hinweis })
  }
  const abgewaschen = riedenAus.filter(r => r.schutz === 'abgewaschen')
  const nachlassend = riedenAus.filter(r => r.schutz === 'nachlassend')
  const intervall = riedenAus.filter(r => r.schutz === 'intervall')
  const namen = (l: RiedAuswertung[]) => l.slice(0, 4).map(r => r.ried || r.name).join(', ') + (l.length > 4 ? ` +${l.length - 4}` : '')
  const fensterText = spritzfenster.length ? `Spritzfenster: ${spritzfenster[0].label}` : 'kein Spritzfenster in den nächsten 48 h (Wind/Regen)'

  if (abgewaschen.length) empfehlungen.push({ key: 'wetter:abgewaschen', bereich: 'Weingarten', stufe: 'hoch', titel: `Spritzbelag abgewaschen: ${namen(abgewaschen)}`, detail: `≥ ${einst.abwaschMm} mm seit der letzten Behandlung · ${fensterText} · Risiko lt. Warndienst prüfen`, href: '/dashboard/morgenbericht' })
  if (nachlassend.length) empfehlungen.push({ key: 'wetter:nachlassend', bereich: 'Weingarten', stufe: 'mittel', titel: `Spritzbelag nachlassend: ${namen(nachlassend)}`, detail: `${Math.round(einst.abwaschMm * 0.6)}–${einst.abwaschMm} mm seit der letzten Behandlung · ${fensterText}`, href: '/dashboard/morgenbericht' })
  if (intervall.length) empfehlungen.push({ key: 'wetter:intervall', bereich: 'Weingarten', stufe: 'mittel', titel: `Spritzintervall abgelaufen: ${namen(intervall)}`, detail: `länger als ${einst.intervallTage} Tage ohne Behandlung · ${fensterText}`, href: '/dashboard/morgenbericht' })

  // Wartezeiten, die in den nächsten 14 Tagen enden (Lesevorbereitung)
  const wartend = riedenAus.filter(r => r.wartezeitBis && r.wartezeitBis >= heuteStr && tageZwischen(heuteStr, r.wartezeitBis) <= 14)
  if (wartend.length && monat >= 8 && monat <= 10) empfehlungen.push({ key: 'wetter:wartezeit', bereich: 'Weingarten', stufe: 'info', titel: `Wartezeit läuft: ${namen(wartend)}`, detail: `Lese frühestens ab ${wartend.map(r => r.wartezeitBis).sort()[0]!.split('-').reverse().join('.')}`, href: '/behandlungen' })

  // Feuchte Witterung: ≥ 10 mm in 72 h, Temperatur ≥ 12 °C, Feuchte ≥ 80 % → Infektionsbedingungen möglich (Warndienst)
  if (rueck.length && monat >= 4 && monat <= 9) {
    const letzte48 = rueck.filter(s => new Date(s.zeit) >= new Date(heute.getTime() - 48 * 3600000))
    const tMittel = letzte48.length ? letzte48.reduce((a, s) => a + (s.t2m ?? 0), 0) / letzte48.length : 0
    const rhMittel = letzte48.length ? letzte48.reduce((a, s) => a + (s.rh2m ?? 0), 0) / letzte48.length : 0
    if (regen72h >= 10 && tMittel >= 12 && rhMittel >= 80) empfehlungen.push({ key: 'wetter:feucht', bereich: 'Weingarten', stufe: 'mittel', titel: 'Feuchte Witterung – Infektionsbedingungen möglich', detail: `${regen72h} mm in 72 h, Ø ${rund(tMittel)} °C, ${Math.round(rhMittel)} % rF · Peronospora/Oidium-Risiko beim Warndienst prüfen`, href: 'https://warndienst.at' })
  }
  if (prognose) {
    if (prognose.tmin !== null && prognose.tmin <= 0 && monat >= 3 && monat <= 5) empfehlungen.push({ key: 'wetter:frost', bereich: 'Weingarten', stufe: 'hoch', titel: `Frostgefahr: ${prognose.tmin} °C in den nächsten 48 h`, detail: 'Frostschutzmaßnahmen prüfen (Kerzen, Beregnung, Wind)', href: '/dashboard/morgenbericht' })
    if (prognose.tmax !== null && prognose.tmax >= 33) empfehlungen.push({ key: 'wetter:hitze', bereich: 'Weingarten', stufe: 'info', titel: `Hitze: bis ${prognose.tmax} °C erwartet`, detail: 'Sonnenbrand an Trauben möglich – Laubarbeit/Entblätterung zurückhaltend, Jungpflanzen wässern', href: '/dashboard/morgenbericht' })
    if (prognose.regen48h >= 10 && monat >= 9 && monat <= 10) empfehlungen.push({ key: 'wetter:lese', bereich: 'Weingarten', stufe: 'mittel', titel: `Regen vor der Lese: ${prognose.regen48h} mm in 48 h`, detail: 'Lesetermine und Fäulnisdruck prüfen, Wartezeiten beachten', href: '/erntemeldung' })
    if (prognose.boeMaxKmh !== null && prognose.boeMaxKmh >= 60) empfehlungen.push({ key: 'wetter:sturm', bereich: 'Weingarten', stufe: 'mittel', titel: `Sturmböen bis ${prognose.boeMaxKmh} km/h`, detail: 'Keine Pflanzenschutz-Ausbringung (Abdrift), Unterstützungsgerüste und Hagelnetze prüfen', href: '/dashboard/morgenbericht' })
  }

  return {
    stand: haupt?.stand ?? null, prognoseStand: haupt?.prognoseStand ?? null, punkte: wetter.length,
    jetzt, regen24h, regen72h, regen7d, prognose, spritzfenster, rieden: riedenAus, empfehlungen,
  }
}
