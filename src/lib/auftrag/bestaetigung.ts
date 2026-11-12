// ── Auftragsbestätigung (KAN-418 Teil 3, 12.11.2026) ─────────────────────────────────────────────────────────────────
//
// Die Auftragsbestätigung trägt die Nummer des Auftrags (AB-JJJJ-NNNN). Entscheidungen Jörgen 12.11.2026:
//   1A keine Preise – nur Mengen und Reservierung („Es gelten die Preise zum Zeitpunkt der Lieferung.“)
//   2A fester Standardtext der Mail plus optionale Nachricht (wie bei der Rechnung)
//   3A Versand nur auf Knopfdruck
// Gedruckt werden die BESTELLTEN Mengen (auch nach einer Teillieferung). Ein stornierter Auftrag bekommt keine.
// Isomorph, ohne '@/'-Importe – dieselben Texte für PDF, Mail und Tests.

export const AB_NACHRICHT_MAX = 2000
export const AB_EMPFAENGER_MAX = 320

const FLASCHEN_LABEL: Record<number, string> = {
  187: '0,187 L', 375: '0,375 L', 500: '0,5 L', 750: '0,75 L', 1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
}

/** JJJJ-MM-TT (auch aus einem Zeitstempel) → TT.MM.JJJJ, rein auf dem Text – ohne Zeitzonenrechnung */
export function abDatum(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''))
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

/** Gibt es zu diesem Auftrag eine Auftragsbestätigung? (nicht bei storniertem Auftrag) */
export function abMoeglich(a: { status?: string | null; storniert_am?: string | null }): boolean {
  return !a.storniert_am && a.status !== 'storniert'
}

export type AbPosition = { name: string; sub: string | null; flaschen: number }

/** Positionen der Auftragsbestätigung: bestellte Flaschen je Zeile, Flaschengröße als Unterzeile */
export function abPositionen(zeilen: readonly { name?: unknown; menge?: unknown; fuellung?: { flaschengroesse_ml?: unknown } | null }[]): AbPosition[] {
  return zeilen.map(z => {
    const ml = Number(z.fuellung?.flaschengroesse_ml)
    return {
      name: String(z.name ?? '').trim() || 'Position',
      sub: Number.isFinite(ml) && ml > 0 ? (FLASCHEN_LABEL[ml] ?? `${ml} ml`) : null,
      flaschen: Math.max(0, Math.trunc(Number(z.menge) || 0)),
    }
  })
}

export function abFlaschenGesamt(positionen: readonly AbPosition[]): number {
  return positionen.reduce((s, p) => s + p.flaschen, 0)
}

/** Sätze unter den Positionen (PDF) */
export function abHinweise(reserviertBis: string | null | undefined): string[] {
  const bis = abDatum(reserviertBis)
  return [
    bis ? `Die Ware ist bis ${bis} für Sie reserviert.` : 'Die Ware ist für Sie reserviert.',
    'Es gelten die Preise zum Zeitpunkt der Lieferung.',
  ]
}

/** Dateiname des PDF – nur unkritische Zeichen */
export function abDateiname(nummer: string | null | undefined): string {
  const n = String(nummer ?? '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return `Auftragsbestaetigung-${n || 'Auftrag'}.pdf`
}

export function abBetreff(nummer: string, betrieb: string): string {
  return `Auftragsbestätigung ${nummer} von ${betrieb}`.trim()
}

/** Mailtext: Standardtext, die optionale Nachricht des Benutzers ersetzt den mittleren Absatz nicht, sondern ergänzt ihn */
export function abMailText(p: { kundenName: string | null; nummer: string; reserviertBis: string | null | undefined; nachricht?: string | null; betrieb: string }): string {
  const bis = abDatum(p.reserviertBis)
  const nachricht = (p.nachricht ?? '').trim()
  return [
    p.kundenName ? `Sehr geehrte Damen und Herren, ${p.kundenName},` : 'Sehr geehrte Damen und Herren,',
    '',
    `anbei erhalten Sie unsere Auftragsbestätigung ${p.nummer}.${bis ? ` Die Ware ist bis ${bis} für Sie reserviert.` : ''}`,
    ...(nachricht ? ['', nachricht] : []),
    '',
    'Freundliche Grüße',
    p.betrieb,
  ].join('\n')
}

/** Prüfung der Empfänger-Adresse (eine Adresse); null = in Ordnung */
export function abEmpfaengerFehler(an: unknown): string | null {
  const t = typeof an === 'string' ? an.trim() : ''
  if (!t) return 'Bitte eine Empfänger-E-Mail-Adresse angeben.'
  if (t.length > AB_EMPFAENGER_MAX || !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(t)) return 'Bitte eine gültige E-Mail-Adresse angeben (genau eine Adresse).'
  return null
}

export function abNachrichtFehler(nachricht: unknown): string | null {
  if (nachricht === null || nachricht === undefined || nachricht === '') return null
  if (typeof nachricht !== 'string') return 'Die Nachricht konnte nicht gelesen werden.'
  return nachricht.length > AB_NACHRICHT_MAX ? `Die Nachricht darf höchstens ${AB_NACHRICHT_MAX} Zeichen lang sein.` : null
}
