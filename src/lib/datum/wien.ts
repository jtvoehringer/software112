// ── „Heute“ in Wiener Zeit für Dashboards und Übersichten (KAN-158, 29.09.2026) ────────────────────────
//
// Vercel läuft in UTC. Wurde „heute“ als new Date() gebildet und über toISOString() bzw. getFullYear()/getHours()
// gelesen, galt zwischen 0 und 1 Uhr (Winter) bzw. 0 und 2 Uhr (Sommer) Wiener Zeit noch der Vortag: Jahres-,
// Quartals- und Monatswechsel kamen zu spät, die Begrüßung sagte im Sommer bis 12:59 „Guten Morgen“, und lokal
// (Rechner in Wien) wurde aus dem 15. über toISOString() der 14.
//
// wienJetzt() liefert ein Date, dessen LOKALE Felder (getFullYear, getMonth, getDate, getHours …) die Wiener
// Wanduhr zeigen – unabhängig von der Zeitzone des Servers. lokalerTag() liest daraus 'JJJJ-MM-TT' über genau
// diese Felder (nie über toISOString). Differenzen in Tagen gegen ein reines Datum ('2026-08-28' → UTC-Mitternacht)
// rechnen damit auf einem UTC-Server nach Wiener Kalendertagen.
// Ohne '@/'-Importe, damit node:test sie prüfen kann.

const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

/** Jetzt als Wiener Wandzeit (lokale Felder = Wien), Millisekunden bleiben erhalten */
export function wienJetzt(jetzt: Date = new Date()): Date {
  const t: Record<string, number> = {}
  for (const p of FORMAT.formatToParts(jetzt)) if (p.type !== 'literal') t[p.type] = Number(p.value)
  return new Date(t.year, t.month - 1, t.day, t.hour === 24 ? 0 : t.hour, t.minute, t.second, jetzt.getMilliseconds())
}

/** 'JJJJ-MM-TT' aus den lokalen Feldern eines Datums (für lokal gebildete Daten wie new Date(j, m, 15)) */
export function lokalerTag(d: Date): string {
  return `${String(d.getFullYear()).padStart(4, '0')}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Volle Kalendertage von einem Datum ('JJJJ-MM-TT…') bis zum lokalen Tag von `heute` – unabhängig von Uhrzeit
 *  und Zeitzone des Servers (vorher: Millisekunden gegen UTC-Mitternacht, am Tageswechsel je nach Zone ±1) */
export function tageSeit(datum: string, heute: Date): number {
  const [j, m, t] = String(datum).slice(0, 10).split('-').map(Number)
  return Math.round((Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate()) - Date.UTC(j, m - 1, t)) / 86400000)
}
