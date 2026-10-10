// ── KAN-87: Kontext der Anwendungsfelder (Neu/Bearbeiten einer Maßnahme, server-only) ─────────────────────
// Mitglieder für die Anwender-Auswahl (RPC s112_mandant_mitglieder, ohne E-Mail), angemeldeter Benutzer
// (Vorbelegung) und die Erfassungsfrist des Betriebs (tenant_einstellungen.psm_erfassungsfrist_h, Standard 24 h).

import { ladeMandantMitglieder } from '@/lib/aufgaben/mitglieder'
import { fristAus, PSM_FRIST_STANDARD_H } from '@/lib/behandlungen/erfassungsfrist'
import { AktionsFehler } from '@/lib/fehler'

export type AnwendungKontext = { mitglieder: { id: string; name: string }[]; ichId: string | null; psmFristH: number }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function anwendungKontext(supabase: any, tenantId: string | null | undefined): Promise<AnwendungKontext> {
  if (!tenantId) return { mitglieder: [], ichId: null, psmFristH: PSM_FRIST_STANDARD_H }
  const [mitglieder, { data: { user } }, { data: einst, error: einstErr }] = await Promise.all([
    ladeMandantMitglieder(tenantId),
    supabase.auth.getUser(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any).select('psm_erfassungsfrist_h').eq('tenant_id', tenantId).maybeSingle(),
  ])
  // KAN-254: sonst galt still die Standardfrist statt der des Betriebs
  if (einstErr) throw new AktionsFehler(`Erfassungsfrist konnte nicht geladen werden: ${einstErr.message}`)
  return {
    mitglieder: mitglieder.map(m => ({ id: m.id, name: m.name })),
    ichId: user?.id ?? null,
    psmFristH: fristAus(einst?.psm_erfassungsfrist_h),
  }
}
