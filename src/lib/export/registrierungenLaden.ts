// ── Weinexport: Export-Registrierungen laden (KAN-437 Teil 2) ── immer im eigenen Betrieb; Regeln in registrierungen.ts
import { alle } from '@/lib/supabase/alle'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import type { Registrierung } from '@/lib/export/registrierungen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Registrierungen des Betriebs: zuerst die mit dem nächsten Ablauf, ohne Ablaufdatum am Ende */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeExportRegistrierungen(supabase: any, tenantId: string): Promise<Registrierung[]> {
  const { data, error } = await alle<R>(supabase.from('export_registrierungen')
    .select('id, art, bezeichnung, nummer, gueltig_bis, zusatz, notiz')
    .eq('tenant_id', tenantId)
    .order('gueltig_bis', { nullsFirst: false }).order('erstellt_am').order('id'))
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Export-Registrierungen konnten nicht geladen werden'))
  return data.map(r => ({
    id: String(r.id), art: String(r.art), bezeichnung: r.bezeichnung ?? null, nummer: String(r.nummer),
    gueltig_bis: r.gueltig_bis ? String(r.gueltig_bis).slice(0, 10) : null, zusatz: r.zusatz ?? null, notiz: r.notiz ?? null,
  }))
}
