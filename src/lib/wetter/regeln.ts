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
//
// KAN-202 (Entscheidung Jörgen 05.10.2026): Liegen die Rieden an mehreren Rasterpunkten, wertet der Betrieb ALLE Punkte
// aus und nimmt den ungünstigsten Wert (meister Regen, tiefste/höchste Temperatur, stärkste Böe, feuchteste
// Bedingungen) – vorher nur der Punkt mit den meisten Rieden. Warnungen nennen dann die betroffenen Rieden, die
// Kopfwerte zeigen bei deutlich verschiedenen Punkten die Spanne; ein Spritzfenster gilt nur, wenn es an allen Punkten
// passt, sonst steht es je Ried im Hinweis. Mit einem Punkt bleiben Verhalten und Texte wie bisher.

import type { WetterStunde } from './geosphere'
import type { WetterDaten } from './daten'
import { rund as rundKfm } from '@/lib/zahl/runden'

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
  /** KAN-202: Spanne über die Punkte [min, max] bei deutlich verschiedenen Werten (≥ 3 mm), sonst fehlt der Eintrag */
  regenSpanne?: { regen24h?: [number, number]; regen72h?: [number, number]; regen7d?: [number, number] }
  prognose: { regen24h: number; regen48h: number; tmin: number | null; tmax: number | null; windMaxKmh: number | null; boeMaxKmh: number | null } | null
  spritzfenster: Spritzfenster[]
  rieden: RiedAuswertung[]
  empfehlungen: Befund[]
}

const rund = (n: number, st = 1) => rundKfm(n, st)
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

type Prognose = NonNullable<WetterAuswertung['prognose']>

/** Prognose-Kennzahlen eines Punkts (48 h) */
function prognoseAus(prog: WetterStunde[], heute: Date): Prognose | null {
  if (!prog.length) return null
  const p24 = prog.filter(s => new Date(s.zeit) <= new Date(heute.getTime() + 24 * 3600000))
  const p48 = prog.filter(s => new Date(s.zeit) <= new Date(heute.getTime() + 48 * 3600000))
  const temps = p48.map(s => s.t2m).filter((t): t is number => t !== null)
  const winde = p48.map(s => s.wind_ms).filter((t): t is number => t !== null)
  const boen = p48.map(s => s.boe_ms).filter((t): t is number => t !== null)
  return {
    regen24h: rund(p24.reduce((a, s) => a + (s.rr ?? 0), 0)), regen48h: rund(p48.reduce((a, s) => a + (s.rr ?? 0), 0)),
    tmin: temps.length ? rund(Math.min(...temps)) : null, tmax: temps.length ? rund(Math.max(...temps)) : null,
    windMaxKmh: winde.length ? kmh(Math.max(...winde)) : null, boeMaxKmh: boen.length ? kmh(Math.max(...boen)) : null,
  }
}

/** KAN-202: ungünstigster Wert über die Punkte (null zählt nicht) */
const extrem = (werte: (number | null)[], art: 'min' | 'max'): number | null => {
  const z = werte.filter((x): x is number => x !== null)
  return z.length ? (art === 'min' ? Math.min(...z) : Math.max(...z)) : null
}

/** KAN-202: Stunden, die es an ALLEN Punkten gibt, mit dem ungünstigsten Wind, Böe und Regen – Spritzfenster gilt nur dort */
export function schlechtesteStunden(reihen: readonly WetterStunde[][]): WetterStunde[] {
  if (reihen.length <= 1) return [...(reihen[0] ?? [])]
  const je = reihen.map(r => new Map(r.map(s => [s.zeit, s])))
  return reihen[0].filter(s => je.every(m => m.has(s.zeit))).map(s => {
    const alle = je.map(m => m.get(s.zeit) as WetterStunde)
    return {
      ...s,
      rr: extrem(alle.map(x => x.rr), 'max'), wind_ms: extrem(alle.map(x => x.wind_ms), 'max'), boe_ms: extrem(alle.map(x => x.boe_ms), 'max'),
      t2m: extrem(alle.map(x => x.t2m), 'min'), rh2m: extrem(alle.map(x => x.rh2m), 'max'),
    }
  })
}

export function werteWetterAus(args: { rieden: RegelRied[]; wetter: WetterDaten[]; heute: Date; einst: RegelEinstellungen }): WetterAuswertung {
  const { rieden, wetter, heute, einst } = args
  const heuteStr = heuteLokal(heute)
  const monat = Number(heuteStr.slice(5, 7))
  const empfehlungen: Befund[] = []

  // Stand und „jetzt“ aus dem Punkt mit den meisten Rieden (Repräsentant); KAN-202: Regen, Prognose und Warnungen
  // über ALLE Punkte, jeweils der ungünstigste Wert
  const haupt = [...wetter].sort((a, b) => b.punkt.riedIds.length - a.punkt.riedIds.length)[0] ?? null
  const rueck = haupt?.rueckblick ?? []
  const letzteStunde = rueck.length ? rueck[rueck.length - 1] : null
  const jetzt = letzteStunde ? { t2m: letzteStunde.t2m, rh2m: letzteStunde.rh2m, windKmh: kmh(letzteStunde.wind_ms), zeit: letzteStunde.zeit } : null
  const mehrere = wetter.length > 1
  const jePunkt = wetter.map(w => ({
    w,
    regen24h: summeRr(w.rueckblick, new Date(heute.getTime() - 24 * 3600000)),
    regen72h: summeRr(w.rueckblick, new Date(heute.getTime() - 72 * 3600000)),
    regen7d: summeRr(w.rueckblick, new Date(heute.getTime() - 7 * 86400000)),
    prognose: prognoseAus(w.prognose, heute),
  }))
  const regen24h = extrem(jePunkt.map(p => p.regen24h), 'max') ?? 0
  const regen72h = extrem(jePunkt.map(p => p.regen72h), 'max') ?? 0
  const regen7d = extrem(jePunkt.map(p => p.regen7d), 'max') ?? 0
  const spanne = (k: 'regen24h' | 'regen72h' | 'regen7d'): [number, number] | undefined => {
    const min = extrem(jePunkt.map(p => p[k]), 'min') ?? 0, max = extrem(jePunkt.map(p => p[k]), 'max') ?? 0
    return mehrere && max - min >= 3 ? [min, max] : undefined
  }
  const regenSpanne = mehrere ? { regen24h: spanne('regen24h'), regen72h: spanne('regen72h'), regen7d: spanne('regen7d') } : undefined

  const progs = jePunkt.map(p => p.prognose).filter((p): p is Prognose => p !== null)
  const prognose: WetterAuswertung['prognose'] = progs.length ? {
    regen24h: extrem(progs.map(p => p.regen24h), 'max') ?? 0, regen48h: extrem(progs.map(p => p.regen48h), 'max') ?? 0,
    tmin: extrem(progs.map(p => p.tmin), 'min'), tmax: extrem(progs.map(p => p.tmax), 'max'),
    windMaxKmh: extrem(progs.map(p => p.windMaxKmh), 'max'), boeMaxKmh: extrem(progs.map(p => p.boeMaxKmh), 'max'),
  } : null
  // Spritzfenster nur, wo es an allen Punkten passt (mit einem Punkt wie bisher)
  const spritzfenster = spritzfensterAus(schlechtesteStunden(wetter.map(w => w.prognose)), heute)
  const fensterJePunkt = new Map<string, Spritzfenster[]>()
  if (mehrere && spritzfenster.length === 0) for (const w of wetter) fensterJePunkt.set(w.punkt.key, spritzfensterAus(w.prognose, heute))
  // Rieden eines Punkts (Namen für Warnungen)
  const riedNamen = (punkte: readonly { w: WetterDaten }[]): string => {
    const ids = new Set(punkte.flatMap(p => p.w.punkt.riedIds))
    const n = rieden.filter(r => ids.has(r.id)).map(r => r.ried || r.name)
    return n.length > 4 ? `${n.length} Rieden` : n.join(', ')
  }
  const betroffen = (punkte: readonly { w: WetterDaten }[]) => (mehrere && punkte.length > 0 ? ` – ${riedNamen(punkte)}` : '')

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
  if (fensterJePunkt.size > 0) {
    for (const ra of riedenAus) {
      const pk = rieden.find(r => r.id === ra.id)?.punktKey
      const f = pk ? fensterJePunkt.get(pk)?.[0] : undefined
      if (f) ra.hinweis += ` · Spritzfenster: ${f.label}`
    }
  }
  const abgewaschen = riedenAus.filter(r => r.schutz === 'abgewaschen')
  const nachlassend = riedenAus.filter(r => r.schutz === 'nachlassend')
  const intervall = riedenAus.filter(r => r.schutz === 'intervall')
  const namen = (l: RiedAuswertung[]) => l.slice(0, 4).map(r => r.ried || r.name).join(', ') + (l.length > 4 ? ` +${l.length - 4}` : '')
  const fensterText = spritzfenster.length ? `Spritzfenster: ${spritzfenster[0].label}`
    : fensterJePunkt.size > 0 && [...fensterJePunkt.values()].some(f => f.length) ? 'kein gemeinsames Spritzfenster – je Ried siehe Tabelle'
      : 'kein Spritzfenster in den nächsten 48 h (Wind/Regen)'

  if (abgewaschen.length) empfehlungen.push({ key: 'wetter:abgewaschen', bereich: 'Weingarten', stufe: 'hoch', titel: `Spritzbelag abgewaschen: ${namen(abgewaschen)}`, detail: `≥ ${einst.abwaschMm} mm seit der letzten Behandlung · ${fensterText} · Risiko lt. Warndienst prüfen`, href: '/dashboard/morgenbericht' })
  if (nachlassend.length) empfehlungen.push({ key: 'wetter:nachlassend', bereich: 'Weingarten', stufe: 'mittel', titel: `Spritzbelag nachlassend: ${namen(nachlassend)}`, detail: `${Math.round(einst.abwaschMm * 0.6)}–${einst.abwaschMm} mm seit der letzten Behandlung · ${fensterText}`, href: '/dashboard/morgenbericht' })
  if (intervall.length) empfehlungen.push({ key: 'wetter:intervall', bereich: 'Weingarten', stufe: 'mittel', titel: `Spritzintervall abgelaufen: ${namen(intervall)}`, detail: `länger als ${einst.intervallTage} Tage ohne Behandlung · ${fensterText}`, href: '/dashboard/morgenbericht' })

  // Wartezeiten, die in den nächsten 14 Tagen enden (Lesevorbereitung)
  const wartend = riedenAus.filter(r => r.wartezeitBis && r.wartezeitBis >= heuteStr && tageZwischen(heuteStr, r.wartezeitBis) <= 14)
  if (wartend.length && monat >= 8 && monat <= 10) empfehlungen.push({ key: 'wetter:wartezeit', bereich: 'Weingarten', stufe: 'info', titel: `Wartezeit läuft: ${namen(wartend)}`, detail: `Lese frühestens ab ${wartend.map(r => r.wartezeitBis).sort()[0]!.split('-').reverse().join('.')}`, href: '/behandlungen' })

  // Feuchte Witterung: ≥ 10 mm in 72 h, Temperatur ≥ 12 °C, Feuchte ≥ 80 % → Infektionsbedingungen möglich (Warndienst)
  // KAN-202: je Punkt prüfen – eine Warnung, sobald ein Punkt die Schwelle erreicht; Wert = ungünstigster der betroffenen
  if (monat >= 4 && monat <= 9) {
    const feucht = jePunkt.map(p => {
      const letzte48 = p.w.rueckblick.filter(s => new Date(s.zeit) >= new Date(heute.getTime() - 48 * 3600000))
      const tMittel = letzte48.length ? letzte48.reduce((a, s) => a + (s.t2m ?? 0), 0) / letzte48.length : 0
      const rhMittel = letzte48.length ? letzte48.reduce((a, s) => a + (s.rh2m ?? 0), 0) / letzte48.length : 0
      return { ...p, tMittel, rhMittel }
    }).filter(p => p.w.rueckblick.length && p.regen72h >= 10 && p.tMittel >= 12 && p.rhMittel >= 80)
    if (feucht.length) {
      const f = [...feucht].sort((a, b) => b.regen72h - a.regen72h)[0]
      empfehlungen.push({ key: 'wetter:feucht', bereich: 'Weingarten', stufe: 'mittel', titel: `Feuchte Witterung – Infektionsbedingungen möglich${betroffen(feucht)}`, detail: `${f.regen72h} mm in 72 h, Ø ${rund(f.tMittel)} °C, ${Math.round(f.rhMittel)} % rF · Peronospora/Oidium-Risiko beim Warndienst prüfen`, href: 'https://warndienst.at' })
    }
  }
  if (prognose) {
    const mit = jePunkt.filter((p): p is typeof p & { prognose: Prognose } => p.prognose !== null)
    const frost = mit.filter(p => p.prognose.tmin !== null && p.prognose.tmin <= 0)
    if (frost.length && monat >= 3 && monat <= 5) empfehlungen.push({ key: 'wetter:frost', bereich: 'Weingarten', stufe: 'hoch', titel: `Frostgefahr: ${extrem(frost.map(p => p.prognose.tmin), 'min')} °C in den nächsten 48 h${betroffen(frost)}`, detail: 'Frostschutzmaßnahmen prüfen (Kerzen, Beregnung, Wind)', href: '/dashboard/morgenbericht' })
    const hitze = mit.filter(p => p.prognose.tmax !== null && p.prognose.tmax >= 33)
    if (hitze.length) empfehlungen.push({ key: 'wetter:hitze', bereich: 'Weingarten', stufe: 'info', titel: `Hitze: bis ${extrem(hitze.map(p => p.prognose.tmax), 'max')} °C erwartet${betroffen(hitze)}`, detail: 'Sonnenbrand an Trauben möglich – Laubarbeit/Entblätterung zurückhaltend, Jungpflanzen wässern', href: '/dashboard/morgenbericht' })
    const lese = mit.filter(p => p.prognose.regen48h >= 10)
    if (lese.length && monat >= 9 && monat <= 10) empfehlungen.push({ key: 'wetter:lese', bereich: 'Weingarten', stufe: 'mittel', titel: `Regen vor der Lese: ${extrem(lese.map(p => p.prognose.regen48h), 'max')} mm in 48 h${betroffen(lese)}`, detail: 'Lesetermine und Fäulnisdruck prüfen, Wartezeiten beachten', href: '/erntemeldung' })
    const sturm = mit.filter(p => p.prognose.boeMaxKmh !== null && p.prognose.boeMaxKmh >= 60)
    if (sturm.length) empfehlungen.push({ key: 'wetter:sturm', bereich: 'Weingarten', stufe: 'mittel', titel: `Sturmböen bis ${extrem(sturm.map(p => p.prognose.boeMaxKmh), 'max')} km/h${betroffen(sturm)}`, detail: 'Keine Pflanzenschutz-Ausbringung (Abdrift), Unterstützungsgerüste und Hagelnetze prüfen', href: '/dashboard/morgenbericht' })
  }

  return {
    stand: haupt?.stand ?? null, prognoseStand: haupt?.prognoseStand ?? null, punkte: wetter.length,
    jetzt, regen24h, regen72h, regen7d, ...(regenSpanne ? { regenSpanne } : {}), prognose, spritzfenster, rieden: riedenAus, empfehlungen,
  }
}
