// ── Auswahl für den QR-Etikettenbogen der Gebinde (KAN-116, 07.10.2026) ──
// Nur eigene, aktive Gebinde (Kellergemeinschaft: fremde nicht); Filter Standort (genau) bzw. Kellerplan (Gebinde mit
// Position auf dem Plan); Reihenfolge nach Bezeichnung mit Zahlen natürlich sortiert („Tank 2“ vor „Tank 10“). Isomorph.

type Gebinde = { id: string; name: string; standort?: string | null }

export function etikettenAuswahl<G extends Gebinde>(
  gebinde: readonly G[],
  positionen: readonly { kellerplan_id?: unknown; behaelter_id?: unknown }[],
  filter: { standort: string | null; plan: string | null },
): G[] {
  const standort = (filter.standort ?? '').trim()
  const plan = (filter.plan ?? '').trim()
  const aufPlan = plan ? new Set(positionen.filter(p => String(p.kellerplan_id) === plan).map(p => String(p.behaelter_id))) : null
  return gebinde
    .filter(g => !standort || (g.standort ?? '').trim() === standort)
    .filter(g => !aufPlan || aufPlan.has(g.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }))
}
