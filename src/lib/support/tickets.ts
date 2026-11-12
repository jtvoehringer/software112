// ── Support-Anfragen eines Betriebs (KAN-438, 12.11.2026) ─────────────────────────────────────────────────
//
// Bisher zeigte die Support-Seite nur die EIGENEN Anfragen (Nummer, Betreff, Status, Datum). Jetzt: alle Anfragen
// der Betriebe, in denen der Benutzer Mitglied ist, in der Darstellung der Hohenstein Suite (Typ, Betrieb und Melder,
// Status nach Phase, Priorität, Bearbeiter, Erstellt, Fällig laut SLA) – auch als Karte auf der Übersicht.
// Entscheidungen Jörgen 12.11.2026: Karte auf dem Dashboard + volle Tabelle unter Hilfe › Support (1A); ALLE
// Mitglieder eines Betriebs sehen alle seine Anfragen (2B, „Wir wollen transparent sein“); alle Betriebe des
// Benutzers (3A); fremde Anfragen lesen und beantworten (4A); Priorität, Bearbeiter und SLA sichtbar (5A).
//
// Mandantentrennung: Ob eine Anfrage zu einem Betrieb gehört, entscheidet die MANDANTEN-ID im Kontextblock der
// Beschreibung („Betrieb: <Name> (<uuid>)“, lib/support/anfrage.ts) – nie der Name der JSM-Organisation (zwei Betriebe
// können gleich heißen; Submandanten laufen unter der Organisation des Hauptmandanten). Anfragen ohne Mandanten-ID
// (z. B. per E-Mail oder Telefon angelegt) sieht nur der Melder. Dieselbe Prüfung für Liste, Verlauf und Antwort.
// Isomorph, ohne Importe (node:test).

export type StatusKategorie = 'new' | 'indeterminate' | 'done'

/** Wo liegt der Ball? Jira führt „Wartet auf Support“ technisch als „In Arbeit“ – Einordnung über den Statusnamen. */
export type Phase = 'wartet_support' | 'in_arbeit' | 'wartet_kunde' | 'erledigt'

export type SlaStand = { faellig: string; verletzt: boolean; pausiert: boolean }

export type SupportTicket = {
  key: string
  betreff: string
  /** Anfragetyp aus dem Portal (z. B. „Wunsch/Idee“), sonst der Vorgangstyp */
  typ: string
  status: string
  phase: Phase
  erledigt: boolean
  prioritaet: string | null
  bearbeiter: string | null
  melder: string | null
  /** Betrieb der Anfrage (Name aus software:112); null = ohne Mandanten-ID, nur für den Melder sichtbar */
  betrieb: string | null
  tenantId: string | null
  /** vom angemeldeten Benutzer gemeldet */
  eigene: boolean
  erstellt: string
  /** SLA „Time to resolution“ (laufender Zyklus) – null, wenn kein SLA läuft bzw. erledigt */
  sla: SlaStand | null
  /** manuelles Fälligkeitsdatum (selten gepflegt) */
  faellig: string | null
  erledigtAm: string | null
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Mandanten-ID aus der Beschreibung der Anfrage (Text oder Atlassian Document Format); null = keine */
export function tenantAusBeschreibung(beschreibung: unknown): string | null {
  if (!beschreibung) return null
  const text = typeof beschreibung === 'string' ? beschreibung : JSON.stringify(beschreibung)
  const m = text.match(new RegExp(`Betrieb: [^\\n"]*?\\((${UUID})\\)`, 'i'))
  return m ? m[1].toLowerCase() : null
}

export function phaseAus(statusName: string, kategorie: StatusKategorie): Phase {
  if (kategorie === 'done') return 'erledigt'
  const n = statusName.toLowerCase()
  if (/kunde|customer|pending|ausstehend|rückmeldung/.test(n)) return 'wartet_kunde'
  if (kategorie === 'new' || /wartet auf support|waiting for support|offen|^open|neu|^new|eskaliert|escalated/.test(n)) return 'wartet_support'
  return 'in_arbeit'
}

/** Farben der Status-Marke nach Phase: wartet auf Support = gelb, in Arbeit = blau, wartet auf Kunde = grau, erledigt = grün */
export const PHASE_KLASSE: Record<Phase, string> = {
  wartet_support: 'bg-s112-warn-bg text-s112-warn-fg',
  in_arbeit: 'bg-s112-blue-100 text-s112-blue-700',
  wartet_kunde: 'bg-s112-bg text-s112-text-2',
  erledigt: 'bg-s112-ok-bg text-s112-ok-fg',
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** SLA-Stand aus dem JSM-Feld „Time to resolution“ (laufender Zyklus) */
export function slaAus(v: unknown): SlaStand | null {
  const z = (v as R | null | undefined)?.ongoingCycle as R | undefined
  const faellig = z?.breachTime?.iso8601 as string | undefined
  if (!z || !faellig) return null
  return { faellig, verletzt: !!z.breached, pausiert: !!z.paused }
}

/** Wer fragt: Konto in Jira (Melder-Vergleich) und die Betriebe des Benutzers (id → Name) */
export type TicketZugriff = { accountId: string | null; betriebe: ReadonlyMap<string, string> }

/**
 * Darf der Benutzer die Anfrage sehen (und beantworten)? Eigene Anfragen immer; sonst nur, wenn die Mandanten-ID der
 * Anfrage einer seiner Betriebe ist. Ohne Mandanten-ID gibt es keine Zuordnung – nur der Melder sieht sie.
 */
export function darfSehen(a: { melderAccountId?: string | null; tenantId?: string | null }, z: TicketZugriff): boolean {
  if (z.accountId && a.melderAccountId && a.melderAccountId === z.accountId) return true
  return !!a.tenantId && z.betriebe.has(a.tenantId.toLowerCase())
}

export type TicketFelder = { sla: string; anfragetyp: string }

/** Jira-Vorgang (Suche bzw. Einzelabruf mit `fields`) → Ticket; null, wenn der Benutzer ihn nicht sehen darf */
export function ticketAus(i: R, z: TicketZugriff, felder: TicketFelder): SupportTicket | null {
  const f = (i?.fields ?? {}) as R
  const tenantId = tenantAusBeschreibung(f.description)
  const melderAccountId = (f.reporter?.accountId as string | undefined) ?? null
  if (!darfSehen({ melderAccountId, tenantId }, z)) return null
  const kat = f.status?.statusCategory?.key as string | undefined
  const kategorie: StatusKategorie = kat === 'done' ? 'done' : kat === 'indeterminate' ? 'indeterminate' : 'new'
  const status = String(f.status?.name ?? '–')
  const eigenerBetrieb = tenantId && z.betriebe.has(tenantId) ? tenantId : null
  return {
    key: String(i.key),
    betreff: String(f.summary ?? '(ohne Betreff)'),
    typ: (f[felder.anfragetyp]?.requestType?.name as string | undefined) || String(f.issuetype?.name ?? '').replace(/^\[System\]\s*/, ''),
    status,
    phase: phaseAus(status, kategorie),
    erledigt: kategorie === 'done',
    prioritaet: (f.priority?.name as string | undefined) ?? null,
    bearbeiter: (f.assignee?.displayName as string | undefined) ?? null,
    melder: (f.reporter?.displayName as string | undefined) ?? null,
    // der Name kommt aus software:112, nie aus dem Text der Anfrage
    betrieb: eigenerBetrieb ? z.betriebe.get(eigenerBetrieb) ?? null : null,
    tenantId: eigenerBetrieb,
    eigene: !!z.accountId && melderAccountId === z.accountId,
    erstellt: String(f.created ?? ''),
    sla: kategorie === 'done' ? null : slaAus(f[felder.sla]),
    faellig: (f.duedate as string | undefined) ?? null,
    erledigtAm: (f.resolutiondate as string | undefined) ?? null,
  }
}

/** SLA verletzt bzw. überschritten (oder – ohne SLA – das manuelle Fälligkeitsdatum vorbei); `heute` als JJJJ-MM-TT (Wien) */
export function istUeberfaellig(t: Pick<SupportTicket, 'erledigt' | 'sla' | 'faellig'>, jetzt: Date, heute: string): boolean {
  if (t.erledigt) return false
  if (t.sla) return t.sla.verletzt || (!t.sla.pausiert && new Date(t.sla.faellig).getTime() < jetzt.getTime())
  return !!t.faellig && t.faellig.slice(0, 10) < heute
}

/** „heute“ / „gestern“ / „vor 3 Tagen“ – auf Kalendertagen (beide als JJJJ-MM-TT in Wiener Zeit) */
export function alterText(erstelltTag: string, heute: string): string {
  const tage = Math.round((Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${erstelltTag}T00:00:00Z`)) / 86_400_000)
  if (!Number.isFinite(tage) || tage <= 0) return 'heute'
  return tage === 1 ? 'gestern' : `vor ${tage} Tagen`
}

/** Priorität hervorheben? */
export function prioritaetHoch(p: string | null | undefined): boolean {
  return !!p && /highest|high|hoch|kritisch|critical|blocker/i.test(p)
}

/** Offene Anfragen für die Karte auf der Übersicht – in der Reihenfolge der Liste (neueste zuerst), höchstens `max` */
export function offeneAnfragen(tickets: readonly SupportTicket[], max = 5): { zeilen: SupportTicket[]; offen: number } {
  const offen = tickets.filter(t => !t.erledigt)
  return { zeilen: offen.slice(0, max), offen: offen.length }
}
