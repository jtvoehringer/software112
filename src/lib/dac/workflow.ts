// ── Prüfnummernantrag als Workflow (KAN-97, 04.10.2026) ─────────────────────────────────────────────────
//
// Statusmodell, Übergänge und Sperren je Status – dieselben Regeln wie in der Datenbank (Migration kan97_pn_workflow:
// RPC s112_pruefnummernantrag_status_setzen, Freeze-Trigger a_freeze_* auf dac_antrag). Die App zeigt damit nur an,
// was die Datenbank ohnehin erlaubt; abgelehnt wird dort.
//
// Entscheidungen Jörgen (04.10.2026): Entwurf → Eingereicht → (In Prüfung) → Zugeteilt oder Abgelehnt;
// Eingereicht/In Prüfung → Zurückgezogen; Zugeteilt → Erloschen, Entzogen oder Aufgebraucht. Die Prüfnummer bleibt
// bis „Zugeteilt“ änderbar. Status setzen darf, wer den Antrag bearbeiten darf (Kellerbuch-Schreibrecht).
// Der DB-Wert für „Zugeteilt“ bleibt 'genehmigt' (Füllung, TBS, Blend und Weinbuch lesen ihn).
//
// Isomorph, ohne Importe (node:test: scripts/tests/kan97-pn-workflow.test.mjs).

export const PN_STATUS = [
  'entwurf', 'eingereicht', 'in_pruefung', 'genehmigt', 'abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht',
] as const
export type PnStatus = (typeof PN_STATUS)[number]

export const PN_STATUS_LABEL: Record<PnStatus, string> = {
  entwurf: 'Entwurf',
  eingereicht: 'Eingereicht',
  in_pruefung: 'In Prüfung',
  genehmigt: 'Zugeteilt',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückgezogen',
  erloschen: 'Erloschen',
  entzogen: 'Entzogen',
  aufgebraucht: 'Aufgebraucht',
}

/** Zulässige Übergänge (wie c_uebergaenge der RPC) */
export const PN_UEBERGAENGE: Record<PnStatus, readonly PnStatus[]> = {
  entwurf: ['eingereicht'],
  eingereicht: ['in_pruefung', 'genehmigt', 'abgelehnt', 'zurueckgezogen'],
  in_pruefung: ['genehmigt', 'abgelehnt', 'zurueckgezogen'],
  genehmigt: ['erloschen', 'entzogen', 'aufgebraucht'],
  abgelehnt: [],
  zurueckgezogen: [],
  erloschen: [],
  entzogen: [],
  aufgebraucht: [],
}

export const PN_ENDSTATUS: readonly PnStatus[] = ['abgelehnt', 'zurueckgezogen', 'erloschen', 'entzogen', 'aufgebraucht']

export function istPnStatus(s: unknown): s is PnStatus {
  return typeof s === 'string' && (PN_STATUS as readonly string[]).includes(s)
}

export function pnStatusLabel(s: string | null | undefined): string {
  return s && istPnStatus(s) ? PN_STATUS_LABEL[s] : (s ?? '')
}

export function pnUebergangErlaubt(von: string, nach: string): boolean {
  return istPnStatus(von) && istPnStatus(nach) && PN_UEBERGAENGE[von].includes(nach)
}

export function pnEndstatus(s: string): boolean {
  return (PN_ENDSTATUS as readonly string[]).includes(s)
}

/** Spalten des Formulars (dac_antrag), die der Benutzer selbst bearbeitet */
export const PN_FORMULAR_FELDER = [
  'bezeichnung', 'dac_region', 'weinausbau_id', 'jahrgang', 'rebsorte', 'menge_liter', 'alkohol_prozent',
  'pruefnummer', 'antragsnummer', 'untersuchungsnummer', 'notizen', 'aktiv',
] as const
export type PnFormularFeld = (typeof PN_FORMULAR_FELDER)[number]

export const PN_FELD_LABEL: Record<string, string> = {
  bezeichnung: 'Bezeichnung', dac_region: 'DAC-Region', weinausbau_id: 'Charge', jahrgang: 'Jahrgang',
  rebsorte: 'Rebsorte', menge_liter: 'Menge', alkohol_prozent: 'Alkohol', pruefnummer: 'Prüfnummer',
  antragsnummer: 'Antragsnummer', untersuchungsnummer: 'Untersuchungsnummer', notizen: 'Notizen', aktiv: 'Aktiv',
  status: 'Status', eingereicht_am: 'Eingereicht am', bescheid_am: 'Bescheid am',
}

/**
 * Felder, die im Status noch änderbar sind (Positivliste wie die Freeze-Trigger):
 * Entwurf alles; Eingereicht/In Prüfung nur Prüf-, Antrags-, Untersuchungsnummer, Notizen, aktiv;
 * Zugeteilt nur Notizen, aktiv; Endstatus nur aktiv.
 */
export function pnAenderbareFelder(status: string): readonly PnFormularFeld[] {
  if (status === 'entwurf') return PN_FORMULAR_FELDER
  if (status === 'eingereicht' || status === 'in_pruefung') return ['pruefnummer', 'antragsnummer', 'untersuchungsnummer', 'notizen', 'aktiv']
  if (status === 'genehmigt') return ['notizen', 'aktiv']
  return ['aktiv']
}

/** Grund der Sperre (wie die Freeze-Trigger) samt Datumsfeld; null = Entwurf, nichts gesperrt */
export function pnSperre(a: { status: string; eingereicht_am?: string | null; bescheid_am?: string | null; status_seit?: string | null }):
  { grund: string; seit: string | null } | null {
  if (a.status === 'entwurf') return null
  if (a.status === 'eingereicht' || a.status === 'in_pruefung') return { grund: 'Prüfnummernantrag eingereicht', seit: a.eingereicht_am ?? null }
  if (a.status === 'genehmigt') return { grund: 'Prüfnummer zugeteilt', seit: a.bescheid_am ?? null }
  return { grund: 'Prüfnummernantrag abgeschlossen', seit: a.status_seit ?? null }
}

/** Was der Statuswechsel braucht: Datum (Bezeichnung), Prüfnummer, Grund Pflicht? */
export function pnUebergangAngaben(nach: PnStatus): { datumLabel: string; pruefnummer: 'pflicht' | 'optional' | 'nein'; grundPflicht: boolean } {
  switch (nach) {
    case 'eingereicht': return { datumLabel: 'Eingereicht am', pruefnummer: 'optional', grundPflicht: false }
    case 'in_pruefung': return { datumLabel: 'In Prüfung seit', pruefnummer: 'optional', grundPflicht: false }
    case 'genehmigt': return { datumLabel: 'Bescheid am', pruefnummer: 'pflicht', grundPflicht: false }
    case 'abgelehnt': return { datumLabel: 'Bescheid am', pruefnummer: 'nein', grundPflicht: false }
    case 'zurueckgezogen': return { datumLabel: 'Zurückgezogen am', pruefnummer: 'nein', grundPflicht: false }
    case 'erloschen': return { datumLabel: 'Erloschen am', pruefnummer: 'nein', grundPflicht: false }
    case 'entzogen': return { datumLabel: 'Entzogen am', pruefnummer: 'nein', grundPflicht: true }
    case 'aufgebraucht': return { datumLabel: 'Aufgebraucht am', pruefnummer: 'nein', grundPflicht: false }
    default: return { datumLabel: 'Datum', pruefnummer: 'nein', grundPflicht: false }
  }
}

/** Beschriftung der Knöpfe für den Wechsel */
export const PN_UEBERGANG_KNOPF: Record<PnStatus, string> = {
  entwurf: 'Entwurf',
  eingereicht: 'Einreichen',
  in_pruefung: 'In Prüfung',
  genehmigt: 'Prüfnummer zugeteilt',
  abgelehnt: 'Abgelehnt',
  zurueckgezogen: 'Zurückziehen',
  erloschen: 'Erloschen',
  entzogen: 'Entzogen',
  aufgebraucht: 'Aufgebraucht',
}
