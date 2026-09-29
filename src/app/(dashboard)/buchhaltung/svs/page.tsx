// behoerdenmeldung: svs-einheitswerte
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { canAdmin, canWrite, isSystemAdmin } from '@/lib/auth/roles'
import { getCtx, ladeEinstellungen, type R } from '@/app/(dashboard)/dashboard/_shared/data'
import { ladeFinanzen } from '@/lib/finanzen/uebersicht'
import type { SvsParameter } from '@/lib/svs/berechnung'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeSvsEinheitswerte } from '@/lib/behoerden/svs'
import SvsClient from './SvsClient'

export const metadata: Metadata = { title: 'SV-Beiträge (SVS) – software:112' }
export const dynamic = 'force-dynamic'

// ── SV-Beiträge (SVS) – Rückmeldung 8.9.2026 ─────────────────────────────────
// Einheitswerte je Grundstück (manuell + Import), Versicherungswert lt.
// SVS-Staffel, Beiträge im Pauschalsystem und in der Beitragsgrundlagenoption
// (Einkünfte aus der E&A-Rechnung des Vorjahres als Vorschlag), Wahl der Option.
// Behördenmeldung „svs-einheitswerte“ (24.09.2026): Die Grundstücke kommen aus
// ladeSvsEinheitswerte() (lib/behoerden/svs.ts) – dieselbe Ladefunktion liefert die CSV
// (Reiter „Einheitswerte je Grundstück“, Format wie der Import).

export default async function SvsPage() {
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  if (!einst.modulEa) redirect('/dashboard')
  const jahr = ctx.heute.getFullYear()

  const [{ zeilen: gstZeilen }, { data: paramRaw }, { data: einstRaw }, finanzen] = await Promise.all([
    ladeSvsEinheitswerte(ctx.supabase, ctx.tenantId),
    ctx.q('svs_parameter').select('*').order('jahr', { ascending: false }).limit(5),
    ctx.tf(ctx.q('tenant_einstellungen').select('svs_option, svs_option_seit, svs_einkuenfte_manuell, svs_kv_angehoerige')).maybeSingle(),
    // Einkünfte-Vorschlag: Ergebnis der E&A des Vorjahres (Gesamtjahr), steuerlich
    // vereinfacht: Anlagenkäufe herausgerechnet, AfA lt. Anlagenverzeichnis abgezogen (Migration 200)
    ladeFinanzen(ctx, { art: einst.doppik ? 'doppik' : 'ea', uvaZeitraum: einst.uvaZeitraum, jahr }),
  ])

  const parameter = ((paramRaw ?? []) as R[]).map(p => ({
    jahr: Number(p.jahr), staffel: p.staffel, satz_pv: Number(p.satz_pv), satz_kv: Number(p.satz_kv), satz_uv: Number(p.satz_uv), satz_bh: Number(p.satz_bh),
    satz_kv_zusatz: Number(p.satz_kv_zusatz), min_bg_kv_pv: Number(p.min_bg_kv_pv), min_bg_uv: Number(p.min_bg_uv), hoechst_bg: Number(p.hoechst_bg), hinweis: p.hinweis ?? null,
  })) as SvsParameter[]
  const e = (einstRaw ?? {}) as R

  return (
    <SvsClient
      grundstuecke={gstZeilen.map(g => ({
        id: g.id, gst_nr: g.gstNr, katastralgemeinde: g.katastralgemeinde, kg_bezeichnung: g.kgBezeichnung, einlagezahl: g.einlagezahl,
        flaeche_ha: g.flaecheHa, nutzart: g.nutzart, rechtsverhaeltnis: g.rechtsverhaeltnis,
        einheitswert: g.einheitswert,
        einheitswert_bescheid: g.bescheid, einheitswert_quelle: g.quelleRoh,
        svs_zurechnung: g.zurechnung, ried: g.ried,
      }))}
      csvHref={csvPfad('svs-einheitswerte')}
      parameter={parameter}
      jahr={jahr}
      option={{ svs_option: e.svs_option === 'option' ? 'option' : 'pauschal', svs_option_seit: e.svs_option_seit ?? null, svs_einkuenfte_manuell: e.svs_einkuenfte_manuell === null || e.svs_einkuenfte_manuell === undefined ? null : Number(e.svs_einkuenfte_manuell), svs_kv_angehoerige: !!e.svs_kv_angehoerige }}
      einkuenfteVorjahr={{ jahr: jahr - 1, betrag: finanzen.anlagen.ergebnisNachAfaVjGesamt, buchungen: finanzen.unvollstaendig.length === 0 && (finanzen.gesamtVj.einnahmen !== 0 || finanzen.gesamtVj.ausgaben !== 0) /* KAN-158: bei Datenbankfehler kein falscher Vorschlag */ }}
      darfSchreiben={canWrite(ctx.role, 'ea')}
      darfOption={canAdmin(ctx.role)}
      darfParameter={isSystemAdmin(ctx.role)}
      doppik={einst.doppik}
    />
  )
}
