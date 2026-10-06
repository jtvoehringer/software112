// Zugangskorrektur einer Charge (KAN-53, 07.10.2026) – Journal-Buchungsart INV_PLUS „Inventurdifferenz Mehrmenge“.
//
// Gegenstück zu „Schwund buchen“: eine Mehrmenge (z. B. Pressungs-Mehrmenge nach ersten Folgebuchungen), ein
// Inventur-Plus oder ein Tippfehler bei einem Eröffnungsbestand mit Bewegungen erhöht die Charge als datierte Buchung –
// bisher nur über den Support. Gebucht wird nur über die RPC s112_zugangskorrektur_buchen (Datum, Menge, Art, Grund ≥ 10
// Zeichen; nur Betriebsleitung), korrigiert über s112_zugangskorrektur_stornieren (Gegenbuchung am Storno-Tag). INV_PLUS
// ist keine BSM-Buchungsart – die Bestandsmeldung warnt. Eine Korrektur beendet eine geltende Prüfnummer für den
// Tankbestand (Kommentar Jörgen 25.09.2026, R3 BKI): die App fragt vorher zurück (pruefePruefnummernSchaden 'korrektur').
// Gemeinsam für Formular und Server Action.

export const ZUGANGSKORREKTUR_ARTEN = [
  { value: 'mehrmenge', label: 'Mehrmenge' },
  { value: 'inventur', label: 'Inventur-Plus' },
  { value: 'sonstiges', label: 'Sonstiges (z. B. Tippfehler im Eröffnungsbestand)' },
] as const

export type ZugangskorrekturArt = (typeof ZUGANGSKORREKTUR_ARTEN)[number]['value']

export const ZUGANGSKORREKTUR_ART_LABEL: Record<ZugangskorrekturArt, string> = {
  mehrmenge: 'Mehrmenge', inventur: 'Inventur-Plus', sonstiges: 'Sonstiges',
}

export function istZugangskorrekturArt(a: unknown): a is ZugangskorrekturArt {
  return ZUGANGSKORREKTUR_ARTEN.some(o => o.value === a)
}

/**
 * Prüfung vor dem Buchen (dieselbe Regel wie die RPC): Art aus der Liste, Menge über 0, Grund mit mindestens 10 Zeichen,
 * Datum gültig und nicht in der Zukunft. null = in Ordnung.
 */
export function zugangskorrekturFehler(p: { art: unknown; menge: number | null; grund: string | null; datum: string; heute: string }): string | null {
  if (!istZugangskorrekturArt(p.art)) return 'Bitte die Art der Zugangskorrektur wählen.'
  if (p.menge == null || !Number.isFinite(p.menge) || p.menge <= 0) return 'Bitte die zusätzliche Menge in Litern angeben (größer als 0).'
  if ((p.grund ?? '').trim().length < 10) return 'Bitte einen Grund angeben (mindestens 10 Zeichen) – er steht im Kellerbuch.'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.datum)) return 'Bitte ein gültiges Datum angeben.'
  if (p.datum > p.heute) return 'Das Datum der Zugangskorrektur liegt in der Zukunft.'
  return null
}
