// Weinshop-Anbindung (KAN-462): Weindaten einer Füllung laden – nur serverseitig.
// Quelle (Entscheidung Jörgen 15.11.2026): Analysewerte, Nährwerte, Allergene und Link aus dem FREIGEGEBENEN E-Label der
// Füllung (dieselben Spalten wie die öffentliche E-Label-Seite, lib/elabel/spalten.ts); Jahrgang, Rebsorte, Qualität und
// Herkunft aus der Füllung; die Ried aus der Herkunftsrechnung – nur, wenn die Füllung ganz aus einer Ried stammt.
import 'server-only'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { ELABEL_FUELLUNG_SPALTEN, ELABEL_INHALT_SPALTEN, ELABEL_KATALOG_SPALTEN } from '@/lib/elabel/spalten'
import { ALLERGEN_LABEL, allergeneDerListe, type KatalogEintrag } from '@/lib/elabel/katalog'
import { elabelUrl } from '@/lib/elabel/oeffentlich'
import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'
import { ladeZusammensetzungFuellung } from '@/lib/wein/blendKomposition'
import { appBasisUrl } from '@/lib/qr'
import { einzigeRied, type Weindaten } from '@/lib/shop/weindaten'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const zahl = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Katalog der Zutaten (global) – einmal je Lauf laden und an ladeWeindaten weitergeben */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeElabelKatalog(supabase: any): Promise<KatalogEintrag[]> {
  // alle-ausnahme: globaler E-Label-Katalog (Zutaten/Zusatzstoffe), wenige Dutzend Einträge
  const { data, error } = await (supabase.from('elabel_zutaten') as R).select(ELABEL_KATALOG_SPALTEN).order('sortierung').limit(500)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Zutatenkatalog konnte nicht geladen werden'))
  return (data ?? []) as KatalogEintrag[]
}

/**
 * Weindaten einer Füllung des Betriebs; null, wenn es die Füllung nicht (mehr) gibt. Wirft bei einem Datenbankfehler –
 * nie mit halben Daten übertragen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeWeindaten(supabase: any, tenantId: string, fuellungId: string, katalog: KatalogEintrag[]): Promise<Weindaten | null> {
  const [fRes, eRes] = await Promise.all([
    (supabase.from('fuellungen') as R).select(`${ELABEL_FUELLUNG_SPALTEN}, anbaugebiet`).eq('tenant_id', tenantId).eq('id', fuellungId).maybeSingle(),
    (supabase.from('elabels') as R).select(`code, restzucker_gl, gesamtsaeure_gl, ${ELABEL_INHALT_SPALTEN}`)
      .eq('tenant_id', tenantId).eq('fuellung_id', fuellungId).eq('status', 'freigegeben').order('freigegeben_am', { ascending: false }).order('id').limit(1),
  ])
  if (fRes.error) throw new AktionsFehler(dbFehlerText(fRes.error, 'Die Füllung konnte nicht geladen werden'))
  if (eRes.error) throw new AktionsFehler(dbFehlerText(eRes.error, 'Das E-Label konnte nicht geladen werden'))
  const f = fRes.data as R | null
  if (!f) return null
  const e = ((eRes.data ?? []) as R[])[0] ?? null

  const zusammensetzung = await ladeZusammensetzungFuellung(supabase, tenantId, fuellungId)
  return {
    jahrgang: zahl(f.jahrgang),
    rebsorte: text(f.rebsorte),
    ried: einzigeRied(zusammensetzung.anteile),
    herkunft: text(f.anbaugebiet),
    qualitaet: qualitaetAnzeigeOderNull(f as Parameters<typeof qualitaetAnzeigeOderNull>[0]),
    alkoholVol: e ? zahl(e.alkohol_vol) : null,
    restzuckerGl: e ? zahl(e.restzucker_gl) : null,
    saeureGl: e ? zahl(e.gesamtsaeure_gl) : null,
    allergene: e ? allergeneDerListe((e.zutaten_ids ?? []) as string[], katalog).map(a => ALLERGEN_LABEL[a].de) : [],
    energieKj: e ? zahl(e.energie_kj) : null,
    energieKcal: e ? zahl(e.energie_kcal) : null,
    elabelUrl: e && typeof e.code === 'string' ? elabelUrl(e.code, appBasisUrl()) : null,
  }
}
