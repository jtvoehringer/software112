// ── Prüfnummer je Charge sichtbar machen (KAN-200 Weinbuch, KAN-201 Rückverfolgung; 06.10.2026) ──
//
// Seit KAN-99 hält pruefnummer_chargen die Gültigkeit einer Prüfnummer (DAC-Antrag) je Charge für den Tankbestand:
// eigene Anträge ab dem Einreichen, per Umzug weitergegebene mit quelle_weinausbau_id/quelle_vorgang, Ende mit
// gueltig_bis/ende_grund (Verschnitt, Zukauf, Pressung, Zusammenführung, Behandlung, Abstufung bzw. Endstatus des Antrags).
// Hier der gemeinsame Lader und die reinen Ableitungen: Ereignisse für das Weinbuch, Prüfnummer der Charge am Tag
// (Rückverfolgung) und die aktuell gültige Nummer (Kopf des Weinbuchs). Für den Tankbestand zählt nur „Zugeteilt“
// (status genehmigt); stornierte Anträge und Anträge ohne Nummer bleiben außen vor.

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { alle, inBloecken } from '@/lib/supabase/alle'

type R = Record<string, any>

export type PnVerlauf = {
  antragId: string
  chargeId: string
  pruefnummer: string
  /** Status des Antrags (genehmigt = Zugeteilt) */
  status: string | null
  gueltigAb: string
  gueltigBis: string | null
  endeGrund: string | null
  /** per Umzug übernommen: Herkunfts-Charge */
  quelleChargeId: string | null
  quelleChargeName: string | null
  /** Vorgang der Weitergabe (z. B. 'keller_umzuege:<id>'); null = eigener Antrag der Charge */
  quelleVorgang: string | null
}

/** Ende der Gültigkeit für den Tankbestand – Vorgang bzw. Antragsstatus */
export const PN_ENDE_LABEL: Record<string, string> = {
  verschnitt: 'Verschnitt',
  zugang: 'Zusammenführung per Umzug',
  zukauf: 'Zukauf in die Charge',
  pressung: 'Pressung in die Charge',
  behandlung: 'Kellerbehandlung, die den Wein verändert',
  abstufung: 'Abstufung bzw. geänderte Bezeichnung',
  abgelehnt: 'Antrag abgelehnt',
  zurueckgezogen: 'Antrag zurückgezogen',
  erloschen: 'Prüfnummer erloschen',
  entzogen: 'Prüfnummer entzogen',
  aufgebraucht: 'Prüfnummer aufgebraucht',
  storno: 'Antrag storniert',
}

const FLASCHEN_BEHALTEN = new Set(['verschnitt', 'zugang', 'zukauf', 'pressung', 'behandlung', 'abstufung', 'erloschen', 'aufgebraucht'])
const tag = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null)
const datumDe = (d: string) => d.split('-').reverse().join('.')

/** Zeile aus pruefnummer_chargen (mit antrag, quelle eingebettet) → PnVerlauf; null ohne Nummer bzw. storniert */
export function zuPnVerlauf(r: R): PnVerlauf | null {
  const a = r.antrag as R | null
  const nummer = typeof a?.pruefnummer === 'string' ? a.pruefnummer.trim() : ''
  const ab = tag(r.gueltig_ab)
  if (!a || !nummer || a.storniert_am || !ab) return null
  return {
    antragId: String(r.dac_antrag_id),
    chargeId: String(r.weinausbau_id),
    pruefnummer: nummer,
    status: a.status ?? null,
    gueltigAb: ab,
    gueltigBis: tag(r.gueltig_bis),
    endeGrund: r.ende_grund ?? null,
    quelleChargeId: r.quelle_weinausbau_id ?? null,
    quelleChargeName: (r.quelle as R | null)?.name ?? null,
    quelleVorgang: r.quelle_vorgang ?? null,
  }
}

/** Verlauf je Charge (alle Anträge mit Nummer, auch beendete), sortiert nach gueltig_ab */
export async function ladePnVerlauf(supabase: any, tenantId: string, chargeIds: readonly (string | null | undefined)[]): Promise<Map<string, PnVerlauf[]>> {
  const out = new Map<string, PnVerlauf[]>()
  const res = await inBloecken<R>(chargeIds, block => alle<R>((supabase.from('pruefnummer_chargen') as any)
    .select('id, dac_antrag_id, weinausbau_id, gueltig_ab, gueltig_bis, ende_grund, quelle_weinausbau_id, quelle_vorgang, antrag:dac_antrag_id(pruefnummer, status, storniert_am), quelle:quelle_weinausbau_id(name)')
    .eq('tenant_id', tenantId)
    .in('weinausbau_id', block)
    .order('id')))
  if (res.error) throw new Error(`Prüfnummer je Charge konnte nicht geladen werden: ${res.error.message}`)
  for (const r of res.data) {
    const v = zuPnVerlauf(r)
    if (v) out.set(v.chargeId, [...(out.get(v.chargeId) ?? []), v])
  }
  for (const l of out.values()) l.sort((a, b) => a.gueltigAb.localeCompare(b.gueltigAb) || a.antragId.localeCompare(b.antragId))
  return out
}

/** Gültig für den Tankbestand am Tag: Zugeteilt, gueltig_ab ≤ Tag und (offen oder gueltig_bis > Tag) */
function giltAm(v: PnVerlauf, datum: string): boolean {
  return v.status === 'genehmigt' && v.gueltigAb <= datum && (!v.gueltigBis || v.gueltigBis > datum)
}

export type PnStand =
  | { art: 'gueltig'; pruefnummer: string; antragId: string; uebernommenAus: string | null }
  | { art: 'erloschen'; pruefnummer: string; antragId: string; am: string; grund: string }

/** Prüfnummer der Charge am Tag (Standard: aktuell); sonst die zuletzt erloschene; null = nie eine Nummer */
export function pnStandAm(verlauf: readonly PnVerlauf[], datum?: string | null): PnStand | null {
  const d = datum ?? '9999-12-31'
  const gilt = [...verlauf].reverse().find(v => giltAm(v, d))
  if (gilt) return { art: 'gueltig', pruefnummer: gilt.pruefnummer, antragId: gilt.antragId, uebernommenAus: gilt.quelleVorgang ? (gilt.quelleChargeName ?? 'anderer Charge') : null }
  const ende = [...verlauf].filter(v => v.gueltigBis && v.gueltigBis <= d).sort((a, b) => (a.gueltigBis ?? '').localeCompare(b.gueltigBis ?? '')).pop()
  if (ende) return { art: 'erloschen', pruefnummer: ende.pruefnummer, antragId: ende.antragId, am: ende.gueltigBis!, grund: PN_ENDE_LABEL[ende.endeGrund ?? ''] ?? (ende.endeGrund ?? 'unbekannt') }
  return null
}

/** Text für Kopf/CSV: „N 1234/26 (übernommen aus „GV Alt“)“ bzw. „N 1234/26 – für den Tankbestand erloschen am …“ */
export function pnStandText(s: PnStand | null): string | null {
  if (!s) return null
  if (s.art === 'gueltig') return s.uebernommenAus ? `${s.pruefnummer} (übernommen aus „${s.uebernommenAus}“)` : s.pruefnummer
  return `${s.pruefnummer} – für den Tankbestand erloschen am ${datumDe(s.am)} (${s.grund})`
}

export type PnEreignis = { datum: string; titel: string; details: string[]; badge: string }

/**
 * Weinbuch-Ereignisse: Übernahme per Umzug (am gueltig_ab) und Ende der Gültigkeit für den Tankbestand (am gueltig_bis).
 * Eigene Anträge erscheinen im Weinbuch schon als DAC-Eintrag – für sie nur das Ende.
 */
export function pnVerlaufEreignisse(verlauf: readonly PnVerlauf[]): PnEreignis[] {
  const out: PnEreignis[] = []
  for (const v of verlauf) {
    if (v.quelleVorgang) {
      out.push({
        datum: v.gueltigAb,
        titel: `Prüfnummer ${v.pruefnummer} übernommen aus Charge „${v.quelleChargeName ?? 'unbekannt'}“`,
        details: [`Umzug am ${datumDe(v.gueltigAb)}`, v.status === 'genehmigt' ? null : 'Antrag noch nicht zugeteilt'].filter(Boolean) as string[],
        badge: 'übernommen',
      })
    }
    if (v.gueltigBis) {
      out.push({
        datum: v.gueltigBis,
        titel: `Prüfnummer ${v.pruefnummer} für den Tankbestand erloschen`,
        details: [
          `am ${datumDe(v.gueltigBis)}`,
          `durch: ${PN_ENDE_LABEL[v.endeGrund ?? ''] ?? v.endeGrund ?? 'unbekannt'}`,
          // PN_FLASCHEN_STATUS: Flaschen behalten die Nummer, außer bei Entzug, Ablehnung, Rückzug und Storno
          FLASCHEN_BEHALTEN.has(v.endeGrund ?? '') ? 'bereits abgefüllte Flaschen behalten die Nummer' : null,
        ].filter(Boolean) as string[],
        badge: 'erloschen',
      })
    }
  }
  return out
}
