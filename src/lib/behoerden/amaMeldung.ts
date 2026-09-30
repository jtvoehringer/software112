// AMA-Erntemeldung: Status und Versionen (KAN-148 C2, 30.09.2026). Je Jahrgang gibt es Versionen 1, 2, …
// (Korrekturmeldungen); gilt immer die neueste. Offen (neu berechenbar) sind nur Entwurf und Bereit – ab
// „eingereicht“ bleibt eine Version unverändert (Schutz-Trigger a_ama_schutz, RPCs s112_ama_*). Isomorph, ohne
// `@/`-Importe (auch in Client-Komponenten und node:test).

export const AMA_STATUS_LABEL: Record<string, string> = {
  entwurf:     'Entwurf',
  bereit:      'Bereit',
  eingereicht: 'Eingereicht',
  bestaetigt:  'Bestätigt',
  abgelehnt:   'Abgelehnt',
}

/** Status, in denen die Meldung neu berechnet werden darf */
export const AMA_OFFEN: readonly string[] = ['entwurf', 'bereit']

/** Zielstatus, die „Status setzen“ kennt (nur vorwärts: bereit → eingereicht → bestätigt/abgelehnt) */
export type AmaZielStatus = 'eingereicht' | 'bestaetigt' | 'abgelehnt'

const ZIELE: Record<string, readonly AmaZielStatus[]> = {
  bereit:      ['eingereicht'],
  eingereicht: ['bestaetigt', 'abgelehnt'],
}

/** Fehlertext, wenn der Statuswechsel nicht erlaubt ist (dieselbe Regel prüft s112_ama_status_setzen), sonst null */
export function amaStatusFehler(von: string, nach: string): string | null {
  if (!(nach in AMA_STATUS_LABEL) || AMA_OFFEN.includes(nach)) return `Unbekannter Zielstatus „${nach}“.`
  if ((ZIELE[von] ?? []).includes(nach as AmaZielStatus)) return null
  return `Der Status kann nur vorwärts gesetzt werden (Bereit → Eingereicht → Bestätigt/Abgelehnt), nicht von „${AMA_STATUS_LABEL[von] ?? von}“ auf „${AMA_STATUS_LABEL[nach]}“.`
}

/** Datum (JJJJ-MM-TT) für Einreichen/Rückmeldung prüfen – nicht leer, gültig, nicht in der Zukunft */
export function amaDatumFehler(datum: string, heute: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(`${datum}T00:00:00Z`))) return 'Bitte ein gültiges Datum angeben.'
  if (datum > heute) return 'Das Datum liegt in der Zukunft.'
  return null
}

/** Neueste Version aus allen Versionen eines Jahrgangs (höchste `version`), null bei keiner */
export function neuesteAmaVersion<T extends { version?: number | null }>(versionen: readonly T[] | null | undefined): T | null {
  let beste: T | null = null
  for (const v of versionen ?? []) {
    if (!beste || (v.version ?? 1) > (beste.version ?? 1)) beste = v
  }
  return beste
}
