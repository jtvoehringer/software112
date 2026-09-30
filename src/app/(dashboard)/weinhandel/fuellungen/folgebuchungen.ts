import 'server-only'

// ── Folgebuchungen einer Füllung (KAN-35, 24.09.2026) ────────────────────────
// Gegenstück zu lib/kellerbuch/folgebuchungen.ts (Charge) für den Flaschenbestand:
// Solange an einer Füllung weder Verkäufe noch Bestandsbuchungen hängen, dürfen
// Anzahl/Füllmenge noch korrigiert bzw. die Füllung gelöscht werden – danach nur
// noch datierte Bestandsbuchungen (fuellung_bewegungen über „Bestand korrigieren“).
//
//   verkaeufe         verkauf_positionen typ 'flasche' dieser Füllung, Verkaufsposten
//                     NICHT storniert (je Verkaufsposten einmal; deaktivierte Posten zählen
//                     mit – Deaktivieren bucht den Flaschenbestand nie zurück)
//   flaschenVerkauft  Summe der Stückzahlen dieser Positionen
//   bewegungen        fuellung_bewegungen (Inventur, Bruch, Korrektur …)
//
// Mit dem Benutzer-Client aufrufen; Abfragefehler werden geworfen (nie still „0“).
// PostgREST liefert höchstens 1.000 Zeilen – bei mehr Positionen ist die Summe eine
// Untergrenze, die Sperre greift trotzdem.

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type FuellungFolgebuchungen = { verkaeufe: number; flaschenVerkauft: number; bewegungen: number }

export async function folgebuchungenDerFuellung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  fuellungId: string,
): Promise<FuellungFolgebuchungen> {
  const [vk, bw] = await Promise.all([
    (supabase.from('verkauf_positionen') as any)
      .select('verkaufsposten_id, menge, verkaufsposten!inner(storniert)')
      .eq('fuellung_id', fuellungId)
      .eq('typ', 'flasche')
      .eq('tenant_id', tenantId)
      .eq('verkaufsposten.storniert', false),
    // Bestandsbuchungen ohne die Verkaufszeilen (KAN-149 D1) – Verkäufe zählen oben aus verkauf_positionen
    (supabase.from('fuellung_bewegungen') as any)
      .select('id', { count: 'exact', head: true })
      .eq('fuellung_id', fuellungId)
      .eq('tenant_id', tenantId)
      .not('art', 'in', '(verkauf,verkauf_storno)'),
  ])
  if (vk.error) throw new AktionsFehler(dbFehlerText(vk.error, 'Verkäufe der Füllung konnten nicht geprüft werden'))
  if (bw.error) throw new AktionsFehler(dbFehlerText(bw.error, 'Bestandsbuchungen der Füllung konnten nicht geprüft werden'))

  const zeilen = (vk.data ?? []) as R[]
  return {
    verkaeufe:        new Set(zeilen.map(z => z.verkaufsposten_id)).size,
    flaschenVerkauft: zeilen.reduce((s, z) => s + Math.round(Number(z.menge) || 0), 0),
    bewegungen:       bw.count ?? 0,
  }
}

/** „2 Verkäufe (36 Flaschen) und 1 Bestandsbuchung“ (leer: „keine Verkäufe oder Bestandsbuchungen“) */
export function folgebuchungenFuellungText(f: FuellungFolgebuchungen): string {
  const teile: string[] = []
  if (f.verkaeufe > 0) {
    teile.push(`${fmtNum(f.verkaeufe, 0)} ${f.verkaeufe === 1 ? 'Verkauf' : 'Verkäufe'} (${fmtNum(f.flaschenVerkauft, 0)} ${f.flaschenVerkauft === 1 ? 'Flasche' : 'Flaschen'})`)
  }
  if (f.bewegungen > 0) {
    teile.push(`${fmtNum(f.bewegungen, 0)} ${f.bewegungen === 1 ? 'Bestandsbuchung' : 'Bestandsbuchungen'}`)
  }
  return teile.length ? teile.join(' und ') : 'keine Verkäufe oder Bestandsbuchungen'
}

/** Heutiges Datum in Österreich (YYYY-MM-DD) – Server laufen in UTC */
export function heuteOrtsdatum(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

/** „2026-09-24“ → „24.09.2026“ */
export function datumDe(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (iso ?? '')
}
