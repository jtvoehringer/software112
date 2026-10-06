// KAN-18 (06.10.2026): „Super-Admin einladen“ = Plattform-Admin (Entscheidung Jörgen). Ein Plattform-Admin ist in jedem
// Betrieb system_admin – neue Betriebe trägt der Trigger tenants_plattform_admins ein, bestehende die Einladung.
// Isomorph und ohne @/-Importe (node:test).

export type Mitgliedschaft = { id: string; tenant_id: string; role: string }

/** Welche Betriebe brauchen eine neue Mitgliedschaft, welche Mitgliedschaften werden auf system_admin hochgestuft? */
export function plattformAdminMitgliedschaften(tenantIds: string[], vorhanden: Mitgliedschaft[]): { neu: string[]; hochstufen: string[] } {
  const jeBetrieb = new Map(vorhanden.map(m => [m.tenant_id, m]))
  const neu: string[] = []
  const hochstufen: string[] = []
  for (const t of new Set(tenantIds)) {
    const m = jeBetrieb.get(t)
    if (!m) neu.push(t)
    else if (m.role !== 'system_admin') hochstufen.push(m.id)
  }
  return { neu, hochstufen }
}
