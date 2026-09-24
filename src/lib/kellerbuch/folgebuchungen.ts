import 'server-only'

// ── Folgebuchungen einer Charge (KAN-35, 24.09.2026) ─────────────────────────
// Übergangslösung bis zum Journal (AP3): Wo an einer Charge (weinausbau) schon
// Folgebuchungen hängen, wird gesperrt statt gelöscht/überschrieben – mit einer
// deutschen Meldung, die sagt, was hängt. Dieses Modul ist die EINE Stelle für
// „hat die Charge Folgebuchungen?“ (statt eigener Zählabfragen je Server Action).
//
// Gezählt wird, was an der Charge hängt:
//   umzug              keller_umzuege (von_ oder nach_weinausbau_id, umzug_typ ≠ 'schwund'),
//                      je Umzug einmal (umzug_batch_id, ältere Zeilen ohne Batch einzeln)
//   schwund            keller_umzuege mit umzug_typ 'schwund' (je Zeile)
//   verschnitt_quelle  verschneidung_quellen.quell_weinausbau_id (je Verschnitt)
//   verschnitt_ziel    verschneidungen.ziel_weinausbau_id
//   fuellung           fuellungen.weinausbau_id ∪ fuellung_chargen.weinausbau_id (je Füllung,
//                      nur aktive – das Löschen einer Füllung bucht ihre Liter exakt auf die
//                      Charge zurück, sie ist damit fachlich storniert; so auch schon vor KAN-35)
//   tankverkauf        verkauf_positionen typ 'tank' mit weinausbau_id, Posten nicht storniert
//                      (je Verkaufsposten; deaktivierte Posten zählen – Deaktivieren bucht nie zurück)
//   behandlung         keller_behandlungen.weinausbau_id
//   analyse            weinanalysen.weinausbau_id
//   dac                dac_antrag.weinausbau_id (auch inaktive Anträge)
//   zukauf_ziel        zukauf_posten.ziel_weinausbau_id, nur aktive Zukäufe
//
// Mandant: wird aus der Charge selbst gelesen; alle Zählabfragen filtern darauf
// (RLS allein reicht nicht, siehe scripts/check-tenant-isolation.js). Mit dem
// Benutzer-Client aufrufen – was RLS dem Benutzer nicht zeigt, wird nicht gezählt.
// Abfragefehler werden geworfen (nie still „0 Folgebuchungen“ melden). PostgREST
// liefert höchstens 1.000 Zeilen je Abfrage – bei extrem vielen Buchungen ist die
// Anzahl eine Untergrenze, die Sperre greift trotzdem.
//
// Fehler werden als AktionsFehler geworfen (erbt von Error): die Meldung kommt so
// auch in Produktion beim Client an (siehe lib/fehler.ts). Module mit Rückgabe
// { error } fangen sie ab und geben e.message weiter.

import { AktionsFehler } from '@/lib/fehler'
import { fmtNum } from '@/lib/format'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type FolgebuchungArt =
  | 'umzug'
  | 'verschnitt_quelle'
  | 'verschnitt_ziel'
  | 'fuellung'
  | 'tankverkauf'
  | 'behandlung'
  | 'analyse'
  | 'dac'
  | 'zukauf_ziel'
  | 'schwund'

export type Folgebuchung = { art: FolgebuchungArt; anzahl: number }

// Reihenfolge der Ausgabe (mengenwirksame Buchungen zuerst)
const REIHENFOLGE: FolgebuchungArt[] = [
  'umzug', 'schwund', 'verschnitt_quelle', 'verschnitt_ziel', 'fuellung',
  'tankverkauf', 'zukauf_ziel', 'behandlung', 'analyse', 'dac',
]

const BEZEICHNUNG: Record<FolgebuchungArt, [einzahl: string, mehrzahl: string]> = {
  umzug:             ['Umzug', 'Umzüge'],
  schwund:           ['Schwundbuchung', 'Schwundbuchungen'],
  verschnitt_quelle: ['Verschnitt (als Quelle)', 'Verschnitte (als Quelle)'],
  verschnitt_ziel:   ['Verschnitt (als Ziel)', 'Verschnitte (als Ziel)'],
  fuellung:          ['Füllung', 'Füllungen'],
  tankverkauf:       ['Tankverkauf', 'Tankverkäufe'],
  zukauf_ziel:       ['Zukauf', 'Zukäufe'],
  behandlung:        ['Kellerbehandlung', 'Kellerbehandlungen'],
  analyse:           ['Weinanalyse', 'Weinanalysen'],
  dac:               ['DAC-Antrag', 'DAC-Anträge'],
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function abfrageFehler(tabelle: string, error: R): never {
  throw new AktionsFehler(`Folgebuchungen der Charge konnten nicht geprüft werden (${tabelle}): ${error?.message ?? 'unbekannter Fehler'}`)
}

/** Ergebnis einer Zeilen-Abfrage prüfen und die Zeilen liefern */
function zeilen(tabelle: string, res: { data?: unknown; error?: unknown }): R[] {
  if (res.error) abfrageFehler(tabelle, res.error as R)
  return (res.data ?? []) as R[]
}

/** Ergebnis einer count-Abfrage (head: true) prüfen und die Anzahl liefern */
function anzahl(tabelle: string, res: { count?: number | null; error?: unknown }): number {
  if (res.error) abfrageFehler(tabelle, res.error as R)
  return res.count ?? 0
}

const leer = Promise.resolve({ data: [], count: 0, error: null })

/**
 * Alle Buchungen, die an der Charge hängen – nur Arten mit anzahl > 0, in fester Reihenfolge.
 * @param supabase     Benutzer-Client (createSupabaseServerClient)
 * @param weinausbauId Charge (weinausbau.id)
 * @param opts.ohne    Arten, die nicht zählen sollen (z. B. ['zukauf_ziel'] beim Bearbeiten des Zukaufs selbst)
 * @throws AktionsFehler bei ungültiger ID, unbekannter Charge oder Abfragefehler
 */
export async function folgebuchungenDerCharge(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  weinausbauId: string,
  opts?: { ohne?: FolgebuchungArt[] },
): Promise<Folgebuchung[]> {
  if (typeof weinausbauId !== 'string' || !UUID_RE.test(weinausbauId)) {
    throw new AktionsFehler('Folgebuchungen können nicht geprüft werden: ungültige Chargen-ID')
  }
  const ohne = new Set<FolgebuchungArt>(opts?.ohne ?? [])
  const mit = (art: FolgebuchungArt) => !ohne.has(art)

  // Mandant der Charge (RLS begrenzt auf die eigenen Betriebe)
  const chargeRes = await (supabase.from('weinausbau') as any) // tenant-isolation-ignore: Mandant wird hier erst aus der Charge gelesen, alle Folgeabfragen filtern auf ihn
    .select('id, tenant_id')
    .eq('id', weinausbauId)
    .maybeSingle()
  if (chargeRes.error) abfrageFehler('weinausbau', chargeRes.error)
  if (!chargeRes.data) throw new AktionsFehler('Folgebuchungen können nicht geprüft werden: Charge nicht gefunden')
  const tenantId: string = (chargeRes.data as R).tenant_id
  const id = weinausbauId

  const [umzuege, vQuellen, vZiel, fChargen, fDirekt, tank, behandlungen, analysen, dac, zukauf] = await Promise.all([
    mit('umzug') || mit('schwund')
      ? (supabase.from('keller_umzuege') as any)
          .select('id, umzug_batch_id, umzug_typ')
          .or(`von_weinausbau_id.eq.${id},nach_weinausbau_id.eq.${id}`)
          .eq('tenant_id', tenantId)
      : leer,
    mit('verschnitt_quelle')
      ? (supabase.from('verschneidung_quellen') as any)   // ohne tenant_id-Spalte, RLS über verschneidungen
          .select('verschneidung_id')
          .eq('quell_weinausbau_id', id)
      : leer,
    mit('verschnitt_ziel')
      ? (supabase.from('verschneidungen') as any)
          .select('id', { count: 'exact', head: true })
          .eq('ziel_weinausbau_id', id)
          .eq('tenant_id', tenantId)
      : leer,
    mit('fuellung')
      ? (supabase.from('fuellung_chargen') as any)
          .select('fuellung_id, fuellungen!inner(aktiv)')
          .eq('weinausbau_id', id)
          .eq('tenant_id', tenantId)
          .eq('fuellungen.aktiv', true)
      : leer,
    mit('fuellung')
      ? (supabase.from('fuellungen') as any)
          .select('id')
          .eq('weinausbau_id', id)
          .eq('aktiv', true)
          .eq('tenant_id', tenantId)
      : leer,
    mit('tankverkauf')
      ? (supabase.from('verkauf_positionen') as any)
          .select('verkaufsposten_id, verkaufsposten!inner(storniert)')
          .eq('weinausbau_id', id)
          .eq('typ', 'tank')
          .eq('tenant_id', tenantId)
          .eq('verkaufsposten.storniert', false)
      : leer,
    mit('behandlung')
      ? (supabase.from('keller_behandlungen') as any)
          .select('id', { count: 'exact', head: true })
          .eq('weinausbau_id', id)
          .eq('tenant_id', tenantId)
      : leer,
    mit('analyse')
      ? (supabase.from('weinanalysen') as any)
          .select('id', { count: 'exact', head: true })
          .eq('weinausbau_id', id)
          .eq('tenant_id', tenantId)
      : leer,
    mit('dac')
      ? (supabase.from('dac_antrag') as any)
          .select('id', { count: 'exact', head: true })
          .eq('weinausbau_id', id)
          .eq('tenant_id', tenantId)
      : leer,
    mit('zukauf_ziel')
      ? (supabase.from('zukauf_posten') as any)
          .select('id', { count: 'exact', head: true })
          .eq('ziel_weinausbau_id', id)
          .eq('aktiv', true)
          .eq('tenant_id', tenantId)
      : leer,
  ])

  const umzugZeilen = zeilen('keller_umzuege', umzuege)
  const umzugKeys = new Set<string>()
  let schwund = 0
  for (const z of umzugZeilen) {
    if (z.umzug_typ === 'schwund') schwund++
    else umzugKeys.add(z.umzug_batch_id ?? z.id)
  }

  const fuellungIds = new Set<string>([
    ...zeilen('fuellung_chargen', fChargen).map(z => z.fuellung_id as string),
    ...zeilen('fuellungen', fDirekt).map(z => z.id as string),
  ])

  const werte: Record<FolgebuchungArt, number> = {
    umzug:             umzugKeys.size,
    schwund,
    verschnitt_quelle: new Set(zeilen('verschneidung_quellen', vQuellen).map(z => z.verschneidung_id)).size,
    verschnitt_ziel:   anzahl('verschneidungen', vZiel),
    fuellung:          fuellungIds.size,
    tankverkauf:       new Set(zeilen('verkauf_positionen', tank).map(z => z.verkaufsposten_id)).size,
    zukauf_ziel:       anzahl('zukauf_posten', zukauf),
    behandlung:        anzahl('keller_behandlungen', behandlungen),
    analyse:           anzahl('weinanalysen', analysen),
    dac:               anzahl('dac_antrag', dac),
  }

  return REIHENFOLGE
    .filter(art => mit(art) && werte[art] > 0)
    .map(art => ({ art, anzahl: werte[art] }))
}

/** „2 Umzüge, 1 Füllung und 3 Kellerbehandlungen“ (leere Liste: „keine Folgebuchungen“) */
export function folgebuchungenText(f: Folgebuchung[]): string {
  const teile = f
    .filter(x => x.anzahl > 0)
    .map(x => `${fmtNum(x.anzahl, 0)} ${BEZEICHNUNG[x.art][x.anzahl === 1 ? 0 : 1]}`)
  if (teile.length === 0) return 'keine Folgebuchungen'
  if (teile.length === 1) return teile[0]
  return `${teile.slice(0, -1).join(', ')} und ${teile[teile.length - 1]}`
}

/**
 * Sperre: wirft einen AktionsFehler, wenn an der Charge Folgebuchungen hängen.
 * Meldung: „<aktion> ist nicht möglich: An der Charge hängen bereits 2 Umzüge und 1 Füllung.“
 * – plus opts.hinweis (was stattdessen zu tun ist), sonst ein allgemeiner Hinweis.
 * @param aktion z. B. 'Löschen der Charge', 'Ändern der Pressmenge'
 * @param opts.ohne    Arten, die nicht sperren sollen
 * @param opts.hinweis Satz, was stattdessen zu tun ist (z. B. 'Menge bitte über „Schwund buchen“ korrigieren.')
 */
export async function sperreBeiFolgebuchungen(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  weinausbauId: string,
  aktion: string,
  opts?: { ohne?: FolgebuchungArt[]; hinweis?: string },
): Promise<void> {
  const f = await folgebuchungenDerCharge(supabase, weinausbauId, { ohne: opts?.ohne })
  if (f.length === 0) return
  const einzeln = f.length === 1 && f[0].anzahl === 1
  const hinweis = opts?.hinweis?.trim()
    || 'Die Charge bleibt als Historie erhalten – Korrekturen bitte als eigene, datierte Buchung erfassen (z. B. Schwund buchen oder Umzug).'
  throw new AktionsFehler(
    `${aktion} ist nicht möglich: An der Charge ${einzeln ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(f)}. ${hinweis}`,
  )
}
