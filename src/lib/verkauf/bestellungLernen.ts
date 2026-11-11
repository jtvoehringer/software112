// ── Gelernte Begriffe speichern (KAN-411 Teil 2, 11.11.2026) ─────────────────────────────────────────────────────────
// Nach dem Speichern eines Verkaufs aus einer E-Mail: je Begriff des Kunden die gewählte Füllung merken
// (verkauf_ki_begriffe). Läuft über den Benutzer-Client (RLS: Schreibrecht Warenwirtschaft). Das Lernen ist Beiwerk:
// Ein Fehler hier darf den gespeicherten Verkauf nie scheitern lassen – er wird gemeldet, nicht geworfen.

import { alle } from '@/lib/supabase/alle'
import { ereignisMelden } from '@/lib/system/ereignis'
import type { LernZeile } from './bestellungKi'

type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function lerneBegriffe(supabase: any, tenantId: string, kontaktId: string | null, firmaId: string | null, zeilen: readonly LernZeile[]): Promise<void> {
  if (!zeilen.length || (!kontaktId && !firmaId)) return
  const melde = (meldung: string) => ereignisMelden({ art: 'db', quelle: 'verkauf/ki-begriffe', meldung })
  try {
    // alle-ausnahme: höchstens 30 Begriffe je Verkauf (lernZeilen) – die Liste stammt aus dem Formular, nicht aus einer Abfrage
    let q = supabase.from('verkauf_ki_begriffe').select('id, begriff, anzahl').eq('tenant_id', tenantId).in('begriff', zeilen.map(z => z.begriff))
    q = kontaktId ? q.eq('kontakt_id', kontaktId) : q.eq('firma_id', firmaId)
    const { data, error } = await alle(q.order('id'))
    if (error) { await melde(error.message); return }
    const vorhanden = new Map(((data ?? []) as R[]).map(z => [String(z.begriff), z]))
    const jetzt = new Date().toISOString()
    for (const z of zeilen) {
      const alt = vorhanden.get(z.begriff)
      if (alt) {
        const { error: e } = await supabase.from('verkauf_ki_begriffe')
          .update({ fuellung_id: z.fuellung_id, anzahl: Number(alt.anzahl ?? 1) + 1, zuletzt_am: jetzt })   // aenderung-ohne-pruefung: Lernen ist Beiwerk – 0 Zeilen (inzwischen gelöscht) ist in Ordnung
          .eq('id', alt.id).eq('tenant_id', tenantId)
        if (e) await melde(e.message)
      } else {
        const { error: e } = await supabase.from('verkauf_ki_begriffe')
          .insert({ tenant_id: tenantId, kontakt_id: kontaktId, firma_id: kontaktId ? null : firmaId, begriff: z.begriff, fuellung_id: z.fuellung_id })
        if (e) await melde(e.message)
      }
    }
  } catch (e) {
    await melde(e instanceof Error ? e.message : String(e))
  }
}
