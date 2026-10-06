// ── Kellerbehandlung: Pflichtangaben und Sperre (KAN-206, 05.10.2026; Matrix KAN-85) ───────────────────────────────
//
// Pflicht: Datum, Gebinde, Typ (wie bisher) – dazu die Charge, sobald im Gebinde Wein liegt (eine Charge wird
// automatisch zugeordnet, bei mehreren muss gewählt werden; leeres Gebinde = Behälterpflege ohne Charge), und die Menge,
// außer die Einheit ist „-“ (Behandlung ohne Mengenangabe). Neue Behandlungstypen müssen für die Prüfnummer eingestuft
// sein (Pflege/Veränderung) – „nicht eingestuft“ bleibt nur für Alttypen.
// Sperre (DB-Trigger a_freeze auf keller_behandlungen, dieselbe Bedingung hier): Lag die Charge am Tag der Behandlung
// unter einer gültigen Prüfnummer (pruefnummer_chargen), sind nach dem Speichern nur noch Notizen änderbar; Storno
// bleibt möglich. Dazu die Kellerbuch-Periodensperre (a_periodensperre) wie bei allen Kellerbuch-Bewegungen.
// Isomorph, ohne '@/'-Importe (node:test).

/** Grund der Sperre – derselbe Text steht im Trigger (Migration kan206) */
export const BEHANDLUNG_FREEZE_GRUND = 'Behandlung einer Charge mit Prüfnummer'

/** Spalten, die trotz Sperre änderbar bleiben (Positivliste des Triggers) */
export const BEHANDLUNG_FREEZE_ERLAUBT = ['notizen', 'updated_at', 'storniert_am', 'storniert_von', 'storniert_von_name', 'storno_grund'] as const

/** Anzeigenamen der Spalten für Meldungen */
export const BEHANDLUNG_FELDNAMEN: Record<string, string> = {
  notizen: 'Notizen', datum: 'Datum', typ_id: 'Behandlungstyp', typ_name_snapshot: 'Behandlungstyp', menge: 'Menge',
  einheit: 'Einheit', volumen_liter_ist: 'Volumen Ist', zugang_liter: 'Volumenzugang', weinausbau_id: 'Charge', behaelter_id: 'Gebinde',
  updated_at: 'Änderungszeit', storniert_am: 'Storno', storniert_von: 'Storno', storniert_von_name: 'Storno', storno_grund: 'Storno',
}

export type PnGueltigkeit = { weinausbau_id: string; gueltig_ab: string; gueltig_bis: string | null }

/** true, wenn die Behandlung gesperrt ist: nicht storniert, Charge am Behandlungstag mit gültiger Prüfnummer */
export function behandlungPnGesperrt(
  b: { weinausbau_id: string | null; datum: string | null; storniert_am?: string | null },
  pn: PnGueltigkeit[],
): boolean {
  if (b.storniert_am || !b.weinausbau_id || !b.datum) return false
  const d = b.datum.slice(0, 10)
  return pn.some(p => p.weinausbau_id === b.weinausbau_id && p.gueltig_ab <= d && (p.gueltig_bis == null || p.gueltig_bis >= d))
}

/** Charge der Behandlung: gewählt, sonst die einzige Charge im Gebinde; Fehlertext bei mehreren Chargen ohne Auswahl */
export function behandlungCharge(gewaehlt: string | null, chargenImGebinde: string[]): { chargeId: string | null; fehler: string | null } {
  if (gewaehlt) return { chargeId: gewaehlt, fehler: null }
  if (chargenImGebinde.length === 1) return { chargeId: chargenImGebinde[0], fehler: null }
  if (chargenImGebinde.length > 1) {
    return { chargeId: null, fehler: 'Im Gebinde liegen mehrere Chargen – bitte die behandelte Charge wählen.' }
  }
  return { chargeId: null, fehler: null }   // leeres Gebinde: Behälterpflege ohne Charge
}

/** Menge Pflicht, außer die Einheit ist „-“ (ohne Mengenangabe); null = in Ordnung */
export function behandlungMengeFehler(menge: number | null, einheit: string | null): string | null {
  if (einheit === '-') return null
  if (menge == null || !Number.isFinite(menge)) return 'Bitte die Menge angeben (bei Behandlungen ohne Mengenangabe die Einheit „-“ wählen).'
  if (menge < 0) return 'Die Menge darf nicht negativ sein.'
  return null
}

/**
 * Volumenzugang durch die Behandlung (KAN-41 Paket 3b, BSM ZU_BEH) – optional; wenn angegeben, größer als 0 und nur mit
 * Charge (der Zugang erhöht ihren Bestand, CHECK keller_behandlungen_zugang_chk). null = in Ordnung.
 */
export function behandlungZugangFehler(zugang: number | null, weinausbauId: string | null): string | null {
  if (zugang == null) return null
  if (!Number.isFinite(zugang) || zugang <= 0) return 'Der Volumenzugang muss größer als 0 L sein (oder leer bleiben).'
  if (!weinausbauId) return 'Ein Volumenzugang braucht die Charge, deren Bestand er erhöht.'
  return null
}

/** Neuer Behandlungstyp: Einstufung für die Prüfnummer Pflicht; null = in Ordnung */
export function neuerTypWirkungFehler(wirkung: unknown): string | null {
  return wirkung === 'pflege' || wirkung === 'veraenderung'
    ? null
    : 'Bitte angeben, ob der neue Behandlungstyp den Wein nur pflegt oder verändert (wichtig für die Prüfnummer).'
}
