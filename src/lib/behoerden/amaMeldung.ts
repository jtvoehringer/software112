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

/** Was bei abweichenden Lesedaten zu tun ist: offen → neu berechnen, sonst → Korrekturmeldung (neue Version) */
export function amaAktualisierenText(status: string | null | undefined): string {
  return status && !AMA_OFFEN.includes(status) ? '„Korrekturmeldung anlegen“ (neue Version)' : '„Neu berechnen“'
}

export type AmaAbweichung = { rebsorte: string; gemeldetKg: number; aktuellKg: number }

/**
 * Abgleich der gemeldeten Mengen je Rebsorte mit den aktuellen Lesedaten (ohne stornierte, bis Stichtag; Schlüssel wie
 * aggregiereJeRebsorte). Liefert nur abweichende Sorten (Toleranz 0,5 kg), sortiert nach Rebsorte – leer = aktuell.
 * KAN-148 Soll 5: Lesedaten dürfen nach dem Einreichen storniert/geändert werden, die AMA-Karte zeigt die Abweichung.
 */
export function amaAbweichungen(
  gemeldet: readonly { rebsorte_name: string | null; menge_kg: number | string | null }[],
  aktuell: readonly { rebsorte: string; mengeKg: number }[],
): AmaAbweichung[] {
  const m = new Map<string, { g: number; a: number }>()
  for (const p of gemeldet) {
    const k = (p.rebsorte_name ?? '').trim() || '–'
    const e = m.get(k) ?? { g: 0, a: 0 }
    e.g += Number(p.menge_kg ?? 0) || 0
    m.set(k, e)
  }
  for (const s of aktuell) {
    const k = s.rebsorte.trim() || '–'
    const e = m.get(k) ?? { g: 0, a: 0 }
    e.a += s.mengeKg || 0
    m.set(k, e)
  }
  return [...m.entries()]
    .filter(([, v]) => Math.abs(v.g - v.a) >= 0.5)
    .map(([rebsorte, v]) => ({ rebsorte, gemeldetKg: v.g, aktuellKg: v.a }))
    .sort((x, y) => x.rebsorte.localeCompare(y.rebsorte, 'de'))
}
