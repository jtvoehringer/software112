// ── CRM-Gemeinschaft (KAN-212, 06.10.2026) ───────────────────────────────────────────────────────────────────────────
//
// Ein Eigentümer-Betrieb gibt seine Kontakte, Firmen, Aktivitäten (ohne private) und Pipeline für einen Partner frei
// (crm_freigaben, Pflege nur Plattform-Admin unter Administration › Gemeinschaften). Der Partner liest sie (RLS
// *_crm_partner) und verwendet Kontakte/Firmen in eigenen Belegen (Fremdverweis-Modus 'crm'); ändern darf nur der
// Eigentümer. Kundennummer und Rabattgruppe des Eigentümers werden beim Partner nur angezeigt, nie vorbelegt.
// Abfragen, die gemeinsame Datensätze einschließen, filtern mit .in('tenant_id', sichtbare Betriebe) statt .eq –
// darum dort der Kommentar „tenant-isolation-ignore: KAN-212 …“.

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
type Client = any
type R = Record<string, unknown>

export type CrmPartner = { tenant_id: string; name: string }
export type CrmGemeinschaft = {
  /** Betriebe, denen ich mein CRM freigebe */
  alsEigentuemer: CrmPartner[]
  /** Betriebe, deren CRM ich mitnutze */
  alsNutzer: CrmPartner[]
}

/** Partner der CRM-Gemeinschaft des aktiven Betriebs (RPC lade_crmgemeinschaft – Namen der Gegenseite) */
export async function ladeCrmGemeinschaft(client: Client, tenantId: string | null | undefined): Promise<CrmGemeinschaft> {
  if (!tenantId) return { alsEigentuemer: [], alsNutzer: [] }
  const { data, error } = await client.rpc('lade_crmgemeinschaft', { p_tenant_id: tenantId })
  if (error) return { alsEigentuemer: [], alsNutzer: [] }   // Gemeinschaft ist Zusatz – ohne sie bleibt das eigene CRM
  const rows = (data ?? []) as R[]
  const alsTyp = (r: R): CrmPartner => ({ tenant_id: String(r.partner_tenant_id), name: String(r.partner_name ?? '') })
  return {
    alsEigentuemer: rows.filter(r => r.rolle === 'eigentuemer').map(alsTyp),
    alsNutzer: rows.filter(r => r.rolle === 'nutzer').map(alsTyp),
  }
}

/** Betriebe, deren Kontakte/Firmen im aktiven Betrieb sichtbar sind: der eigene zuerst, dann die freigebenden Partner */
export function sichtbareBetriebe(tenantId: string, g: CrmGemeinschaft): string[] {
  return [tenantId, ...g.alsNutzer.map(p => p.tenant_id).filter(id => id !== tenantId)]
}

/** Name des Eigentümers eines gemeinsamen Datensatzes – null bei eigenen */
export function fremderBetrieb(tenantIdDatensatz: unknown, tenantId: string, g: CrmGemeinschaft): string | null {
  if (!tenantIdDatensatz || tenantIdDatensatz === tenantId) return null
  return g.alsNutzer.find(p => p.tenant_id === tenantIdDatensatz)?.name ?? 'anderer Betrieb'
}
