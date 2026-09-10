// ── Morgenbericht erstellen und laden (Migration 201) ────────────────────────
// Ablauf je Betrieb: Einstellungen → Wetter (Cache auffrischen, Regeln) →
// deterministische Prüfungen → optionale KI-Zusammenfassung → ein Datensatz
// je Tag in morgenberichte (Upsert). Aufrufer: Cron (05:00 UTC, alle Betriebe,
// Service-Role) und die Server-Aktion „Jetzt aktualisieren“ (Betriebsleiter/
// Winzer, ebenfalls Service-Role nach Rollenprüfung).

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { ladeEinstellungen, toDateStr, type Ctx, type R } from '@/app/(dashboard)/dashboard/_shared/data'
import { paketAusPlan } from '@/lib/pakete'
import { ladeWetterAuswertung } from '@/lib/wetter/auswertung'
import type { WetterAuswertung, Befund } from '@/lib/wetter/regeln'
import { pruefeBetrieb, sortiere, zaehle } from './pruefungen'
import { fasseZusammen, fallbackText } from './ki'

export type Morgenbericht = {
  id: string
  datum: string
  erstelltAm: string
  ausloeser: 'cron' | 'manuell'
  befunde: Befund[]
  wetter: (WetterAuswertung & { ohneKoordinaten?: number; erlaubt?: boolean; grund?: string }) | null
  zusammenfassung: string | null
  kiModell: string | null
  anzahl: { hoch: number; mittel: number; info: number }
}

/** Datum des Berichts in Wiener Zeit (Cron läuft 05:00 UTC = 07:00 MESZ) */
export const berichtDatum = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

/** Dashboard-Kontext für einen Betrieb mit einem beliebigen Client (Service-Role im Cron) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function ctxFuerBetrieb(client: any, tenantId: string, tenantName: string | null, heute = new Date()): Ctx {
  return {
    supabase: client, tenantId, tenantName, userId: null, role: 'system_admin', heute, heuteStr: toDateStr(heute),
    q: (table: string) => (client.from(table) as any),
    tf: (query: any) => query.eq('tenant_id', tenantId), // eslint-disable-line @typescript-eslint/no-explicit-any
  }
}

export function wetterErlaubt(einst: { wetterAktiv: boolean; modulWeingarten: boolean }, stripePlan: string | null | undefined): { erlaubt: boolean; grund: string | null } {
  if (!einst.modulWeingarten) return { erlaubt: false, grund: 'Weingarten-Modul inaktiv' }
  if (!einst.wetterAktiv) return { erlaubt: false, grund: 'Wetter unter Mein Betrieb deaktiviert' }
  const paket = paketAusPlan(stripePlan)
  if (paket === 'basis') return { erlaubt: false, grund: 'Wetter & Empfehlungen sind Teil von Standard und Premium' }
  return { erlaubt: true, grund: null }
}

export async function erstelleMorgenbericht(tenant: { id: string; name: string | null; stripe_plan?: string | null }, ausloeser: 'cron' | 'manuell', heute = new Date()): Promise<Morgenbericht> {
  const start = Date.now()
  const admin = createSupabaseAdminClient()
  const ctx = ctxFuerBetrieb(admin, tenant.id, tenant.name, heute)
  const einst = await ladeEinstellungen(ctx)
  const paket = paketAusPlan(tenant.stripe_plan)

  // Wetter (Standard/Premium, Weingarten-Modul, Rieden mit Koordinaten)
  let wetter: Morgenbericht['wetter'] = null
  const we = wetterErlaubt(einst, tenant.stripe_plan)
  if (we.erlaubt) {
    try {
      const aus = await ladeWetterAuswertung(admin, tenant.id, heute, { abwaschMm: einst.wetterAbwaschMm, intervallTage: einst.wetterIntervallTage }, { auffrischen: true })
      wetter = { ...aus, erlaubt: true }
    } catch (e) {
      wetter = { stand: null, prognoseStand: null, punkte: 0, jetzt: null, regen24h: 0, regen72h: 0, regen7d: 0, prognose: null, spritzfenster: [], rieden: [], empfehlungen: [], erlaubt: true, grund: `Wetterabruf fehlgeschlagen: ${(e as Error).message}` }
    }
  } else {
    wetter = { stand: null, prognoseStand: null, punkte: 0, jetzt: null, regen24h: 0, regen72h: 0, regen7d: 0, prognose: null, spritzfenster: [], rieden: [], empfehlungen: [], erlaubt: false, grund: we.grund ?? undefined }
  }

  // Prüfungen + Wetter-Empfehlungen
  const befundeBetrieb = await pruefeBetrieb(ctx, einst, { istBasis: paket === 'basis' })
  const befunde = sortiere([...befundeBetrieb, ...(wetter?.empfehlungen ?? [])])
  const anzahl = zaehle(befunde)

  // KI-Zusammenfassung (zählt gegen das Kontingent)
  const ki = await fasseZusammen(admin, tenant.id, tenant.name ?? 'Betrieb', befunde, wetter?.erlaubt && wetter.punkte > 0 ? wetter : null, heute)
  const zusammenfassung = ki.text ?? fallbackText(befunde, wetter?.erlaubt && wetter.punkte > 0 ? wetter : null)

  const datum = berichtDatum(heute)
  const zeile = {
    tenant_id: tenant.id, datum, erstellt_am: new Date().toISOString(), ausloeser,
    befunde, wetter: wetter ? { ...wetter, rieden: wetter.rieden.slice(0, 80) } : null,
    zusammenfassung, ki_modell: ki.modell, anzahl_hoch: anzahl.hoch, anzahl_mittel: anzahl.mittel, anzahl_info: anzahl.info,
    dauer_ms: Date.now() - start,
  }
  const { data, error } = await (admin.from('morgenberichte') as any).upsert(zeile, { onConflict: 'tenant_id,datum' }).select('id').single()
  if (error) throw new Error(error.message)
  return { id: (data as R).id, datum, erstelltAm: zeile.erstellt_am, ausloeser, befunde, wetter, zusammenfassung, kiModell: ki.modell, anzahl }
}

/** Jüngster Bericht (heute oder der letzte vorhandene) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeMorgenbericht(client: any, tenantId: string): Promise<Morgenbericht | null> {
  const { data } = await (client.from('morgenberichte') as any).select('*').eq('tenant_id', tenantId).order('datum', { ascending: false }).limit(1).maybeSingle()
  const r = data as R | null
  if (!r) return null
  return {
    id: r.id, datum: String(r.datum).slice(0, 10), erstelltAm: r.erstellt_am, ausloeser: r.ausloeser,
    befunde: (r.befunde ?? []) as Befund[], wetter: (r.wetter ?? null) as Morgenbericht['wetter'],
    zusammenfassung: r.zusammenfassung ?? null, kiModell: r.ki_modell ?? null,
    anzahl: { hoch: Number(r.anzahl_hoch ?? 0), mittel: Number(r.anzahl_mittel ?? 0), info: Number(r.anzahl_info ?? 0) },
  }
}
