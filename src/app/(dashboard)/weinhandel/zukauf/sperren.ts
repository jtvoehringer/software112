import 'server-only'

// ── Sperren beim Bearbeiten und Löschen eines Zukaufs (KAN-35, 24.09.2026) ─────
// Ein Zukauf ist Beleg (Transportbescheinigung, Eingangsrechnung) und – bei Wein
// oder Most mit Gebinde – der Zugang seiner Zielcharge. Belegmenge, Einheit,
// Gebinde und Art bleiben deshalb gesperrt, sobald an der Zielcharge Folgebuchungen
// hängen oder Trauben aus dem Zukauf verpresst bzw. verkauft wurden; Löschen ist
// dann ebenfalls gesperrt. Genutzt von actions.ts (Prüfung vor dem Schreiben) und
// [id]/edit/page.tsx (Hinweis im Formular).

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'
import { folgebuchungenDerCharge, folgebuchungenText, type Folgebuchung } from '@/lib/kellerbuch/folgebuchungen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/**
 * Folgebuchungen der Zielcharge eines AKTIVEN Zukaufs – ohne den Zukauf selbst:
 * Er ist der Zugang der Charge und zählt im Helper als 'zukauf_ziel' mit. Nur
 * weitere aktive Zukäufe auf dieselbe Charge bleiben als Folgebuchung stehen.
 * @throws AktionsFehler bei Abfragefehlern oder unbekannter Charge (siehe Helper)
 */
export async function folgebuchungenDerZielcharge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  weinausbauId: string,
): Promise<Folgebuchung[]> {
  const f = await folgebuchungenDerCharge(supabase, weinausbauId)
  return f
    .map(x => (x.art === 'zukauf_ziel' ? { ...x, anzahl: x.anzahl - 1 } : x))
    .filter(x => x.anzahl > 0)
}

/** „An der Charge hängen bereits 2 Umzüge und 1 Füllung“ (bei genau einer Buchung „hängt“) */
export function zielchargeText(f: Folgebuchung[]): string {
  const einzeln = f.length === 1 && f[0].anzahl === 1
  return `An der Charge ${einzeln ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(f)}`
}

export type ZukaufVerweise = {
  verpresstKg: number
  pressungen: number
  verkauftKg: number
  traubenverkaeufe: number
  /** Alt-Tankverkäufe direkt aus dem Zukauf (verkauf_positionen.zukauf_id) */
  verkaufspositionen: number
}

function summe(werte: unknown[]): number {
  return werte.reduce<number>((s, w) => s + (Number(w) || 0), 0)
}

function anzahlText(n: number, einzahl: string, mehrzahl: string): string {
  return `${fmtNum(n, 0)} ${n === 1 ? einzahl : mehrzahl}`
}

/**
 * Was außerhalb der Zielcharge auf den Zukauf verweist: Pressungen
 * (pressung_weingaerten.zukauf_posten_id), Traubenverkäufe (traubenverkauf.zukauf_posten_id)
 * und Alt-Tankverkäufe direkt aus dem Zukauf (verkauf_positionen.zukauf_id).
 * @throws AktionsFehler bei Abfragefehlern (nie still „keine Verweise“ melden)
 */
export async function zukaufVerweise(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  zukaufId: string,
  tenantId: string,
): Promise<ZukaufVerweise> {
  const [pw, tv, vp] = await Promise.all([
    // pressung_weingaerten hat keine tenant_id (RLS über pressungen). Der Zukauf selbst ist
    // bereits mandantengeprüft – ein Verweis aus einem anderen Betrieb zählt mit (sichere Richtung).
    (supabase.from('pressung_weingaerten') as any)
      .select('pressung_id, trauben_kg')
      .eq('zukauf_posten_id', zukaufId),
    (supabase.from('traubenverkauf') as any)
      .select('id, menge_kg')
      .eq('zukauf_posten_id', zukaufId)
      .eq('tenant_id', tenantId)
      .is('storniert_am', null),   // KAN-148: ein stornierter Traubenverkauf bindet keine kg mehr
    (supabase.from('verkauf_positionen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('zukauf_id', zukaufId)
      .eq('tenant_id', tenantId),
  ])
  const kontext = (tabelle: string) => `Verweise auf den Zukauf konnten nicht geprüft werden (${tabelle})`
  if (pw.error) throw new AktionsFehler(dbFehlerText(pw.error, kontext('pressung_weingaerten')))
  if (tv.error) throw new AktionsFehler(dbFehlerText(tv.error, kontext('traubenverkauf')))
  if (vp.error) throw new AktionsFehler(dbFehlerText(vp.error, kontext('verkauf_positionen')))

  const pwZeilen = (pw.data ?? []) as R[]
  const tvZeilen = (tv.data ?? []) as R[]
  return {
    verpresstKg:        summe(pwZeilen.map(z => z.trauben_kg)),
    pressungen:         new Set(pwZeilen.map(z => z.pressung_id)).size,
    verkauftKg:         summe(tvZeilen.map(z => z.menge_kg)),
    traubenverkaeufe:   tvZeilen.length,
    verkaufspositionen: (vp.count as number | null) ?? 0,
  }
}

/** „1.200 kg verpresst (2 Pressungen) und 300 kg verkauft (1 Traubenverkauf)“ – leer, wenn nichts gebunden ist */
export function traubenGebundenText(v: ZukaufVerweise): string {
  const teile: string[] = []
  if (v.pressungen > 0) teile.push(`${fmtNum(v.verpresstKg)} kg verpresst (${anzahlText(v.pressungen, 'Pressung', 'Pressungen')})`)
  if (v.traubenverkaeufe > 0) teile.push(`${fmtNum(v.verkauftKg)} kg verkauft (${anzahlText(v.traubenverkaeufe, 'Traubenverkauf', 'Traubenverkäufe')})`)
  return teile.join(' und ')
}

/** Meldung der Lösch-Sperre wegen Verweisen auf den Zukauf – null, wenn nichts auf ihn verweist */
export function loeschSperreText(v: ZukaufVerweise): string | null {
  const saetze: string[] = []
  const trauben = traubenGebundenText(v)
  if (trauben) {
    saetze.push(`Aus diesem Zukauf sind bereits ${trauben} – bitte zuerst die Pressung in der Erntemeldung bzw. den Traubenverkauf ändern.`)
  }
  if (v.verkaufspositionen > 0) {
    saetze.push(`Der Zukauf ist als Tankquelle in ${anzahlText(v.verkaufspositionen, 'Verkaufsposition', 'Verkaufspositionen')} eingetragen.`)
  }
  if (saetze.length === 0) return null
  return `Löschen des Zukaufs ist nicht möglich: ${saetze.join(' ')} Der Zukauf bleibt als Beleg erhalten.`
}
