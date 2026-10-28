// ── Morgenbericht: Lauf über alle aktiven Betriebe (Cron) ────────────────────
// Wird vom täglichen Cron (/api/cron/taeglich, 05:00 UTC) und vom manuellen
// System-Admin-Aufruf (/api/cron/morgenbericht) genutzt.
// KAN-5: Betriebe mit gesperrtem Abo (Nur-Lesen-Modus) werden übersprungen – der Bericht
// schreibt und kostet (KI-Zusammenfassung); die bisherigen Berichte bleiben lesbar.
// KAN-123 (25.09.2026), Regeln und Grenzen in zeitplan.ts:
//  - faire Reihenfolge: Betriebe ohne bzw. mit dem ältesten letzten Cron-Bericht zuerst, bei
//    Gleichstand der ältere letzte Bericht überhaupt, dann created_at (vorher immer created_at –
//    den letzten traf das Limit)
//  - höchstens BETRIEBE_PARALLEL Betriebe gleichzeitig, Ergebnis in der Reihenfolge des Laufs;
//    ein Betrieb, der seine Grenze überzieht, belegt seinen Platz bis er fertig ist (höchstens
//    bis zum Laufende) – der Pool startet dafür keinen zusätzlichen
//  - Zeitgrenze je Betrieb (nie über das Laufende), an erstelleMorgenbericht durchgereicht;
//    ein Betrieb beginnt nur mit BETRIEB_MINDESTZEIT_MS Restzeit, sonst „Zeitbudget erschöpft“
//    (zählt im Cron-Protokoll als Fehler)
//  - Demo-Musterhof: kein tägliches Update (Entscheidung Jörgen 25.09.2026, Einmaldaten reichen);
//    „Jetzt aktualisieren“ im Betrieb bleibt möglich

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { erstelleMorgenbericht } from './erstellen'
import { aboStandBerechnen, DEMO_TENANT_ID } from '@/lib/abo/regeln'
import { mitHoechstens } from '@/lib/utils/parallel'
import { BETRIEB_NACHLAUF_MS, BETRIEBE_PARALLEL, GRUND, ZeitgrenzeFehler, ausgangNachZeitgrenze, betriebsDeadline, fairReihenfolge, letzteBerichtstage, mitZeitgrenze, type LaufErgebnis } from './zeitplan'
import { AktionsFehler } from '@/lib/fehler'

export type { LaufErgebnis }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

type Betrieb = { id: string; name: string; created_at: string | null; stripe_plan: string | null; stripe_status: string | null; stripe_trial_ends_at: string | null }

/** Zeitraum für die letzten Berichte – wer länger keinen hatte, zählt wie „noch nie“ (kommt ohnehin zuerst) */
const REIHENFOLGE_TAGE = 14

export async function laufMorgenberichte(budgetMs: number): Promise<{ betriebe: number; dauerMs: number; ergebnis: LaufErgebnis[] }> {
  const start = Date.now()
  const ende = start + budgetMs
  const admin = createSupabaseAdminClient()
  const [{ data: tenants, error: tenantsErr }, { data: einstRaw, error: einstErr }, { data: letzteRaw, error: letzteErr }] = await Promise.all([
    // tenant-isolation-ignore: Cron über alle aktiven Betriebe, Verarbeitung je Betrieb in erstelleMorgenbericht
    (admin.from('tenants') as any).select('id, name, created_at, stripe_plan, stripe_status, stripe_trial_ends_at, active').eq('active', true).order('created_at'),
    // tenant-isolation-ignore: Einstellungen aller Betriebe (nur Schalter morgenbericht_aktiv)
    (admin.from('tenant_einstellungen') as any).select('tenant_id, morgenbericht_aktiv'),
    // tenant-isolation-ignore: letzte Berichte aller Betriebe für die faire Reihenfolge (nur tenant_id, datum, ausloeser; eine Zeile je Betrieb und Tag)
    (admin.from('morgenberichte') as any).select('tenant_id, datum, ausloeser')
      .gte('datum', new Date(start - REIHENFOLGE_TAGE * 86400000).toISOString().slice(0, 10)).order('datum', { ascending: false }).order('erstellt_am', { ascending: false }).order('id', { ascending: false }).limit(1000),
  ])
  // KAN-254: sonst „keine Betriebe“ – der Lauf endete still ohne Berichte (bzw. ohne Schalter/faire Reihenfolge)
  const ladeFehler = tenantsErr ?? einstErr ?? letzteErr
  if (ladeFehler) throw new AktionsFehler(`Morgenberichte: Betriebe konnten nicht geladen werden: ${ladeFehler.message}`)
  const aktiv = new Map(((einstRaw ?? []) as R[]).map(e => [e.tenant_id, e.morgenbericht_aktiv !== false]))
  const berichte = (letzteRaw ?? []) as { tenant_id: string; datum: string; ausloeser: string }[]
  const reihe = fairReihenfolge((tenants ?? []) as Betrieb[], letzteBerichtstage(berichte.filter(b => b.ausloeser === 'cron')), letzteBerichtstage(berichte))

  const ergebnis = await mitHoechstens(reihe, BETRIEBE_PARALLEL, async (t): Promise<LaufErgebnis> => {
    if (t.id === DEMO_TENANT_ID) return { tenant: t.name, uebersprungen: GRUND.demo }
    if (aktiv.get(t.id) === false) return { tenant: t.name, uebersprungen: GRUND.deaktiviert }
    if (aboStandBerechnen({ tenantId: t.id, stripeStatus: t.stripe_status, trialEndsAt: t.stripe_trial_ends_at, role: null }).gesperrt) {
      return { tenant: t.name, uebersprungen: GRUND.abo }
    }
    const t0 = Date.now()
    const deadline = betriebsDeadline(t0, ende)
    if (deadline === null) return { tenant: t.name, uebersprungen: GRUND.zeitbudget }
    const bericht = erstelleMorgenbericht({ id: t.id, name: t.name, stripe_plan: t.stripe_plan }, 'cron', new Date(), { deadline })
    try {
      const b = await mitZeitgrenze(bericht, deadline + BETRIEB_NACHLAUF_MS)
      return { tenant: t.name, befunde: b.befunde.length, hoch: b.anzahl.hoch, dauerMs: Date.now() - t0, ...(b.zeitgrenze ? { zeitgrenze: b.zeitgrenze } : {}), ...(b.wetterFehler ? { wetterFehler: b.wetterFehler } : {}) }
    } catch (e) {
      // Überzogen (hängende Abfrage): Platz erst nach dem Ende des Berichts freigeben, höchstens bis zum Laufende
      const fehler = e instanceof ZeitgrenzeFehler ? await ausgangNachZeitgrenze(bericht, ende) : (e as Error).message
      return { tenant: t.name, fehler, dauerMs: Date.now() - t0 }
    }
  })
  return { betriebe: ergebnis.length, dauerMs: Date.now() - start, ergebnis }
}
