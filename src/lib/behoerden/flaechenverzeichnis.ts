import 'server-only'
import { alle } from '@/lib/supabase/alle'
import { NUTZART_OPTIONS } from '@/lib/wein/nutzart'
import type { LadeErgebnis } from './typen'
import { flaechenZeilen, hektar, type FlaechenZeile, type GstStamm, type RiedStamm } from './flaechenverzeichnis-zeilen'
import { AktionsFehler } from '@/lib/fehler'

// ── Flächenverzeichnis: EINE Ladefunktion für die Rieden-Übersicht und die CSV (24.09.2026) ──
//
// /weingarten (page.tsx, Marker „behoerdenmeldung: flaechenverzeichnis“) zeigt die Rieden
// mit ladeRiedenStammdaten(); die CSV /meldungen/flaechenverzeichnis/csv baut daraus mit
// flaechenZeilen() eine Zeile je Grundstück. Beide sehen damit dieselben Datensätze mit
// denselben (auf 4 Stellen gerundeten) Flächen.
// Mandantenfilter .eq('tenant_id') auf jeder Abfrage, alle() statt 1.000er-Deckel.

export { SPALTEN_FLAECHENVERZEICHNIS } from './flaechenverzeichnis-zeilen'
export type { FlaechenZeile, GstStamm, RiedStamm } from './flaechenverzeichnis-zeilen'

const RIED_SPALTEN = 'id, name, ried, rebsorte, weinart, flaeche_ha, bewirtschaftung, aktiv, ama_feldnummer, codes, interne_bezeichnung, pflanzjahr, zentrum_lat, zentrum_lon'
const GST_SPALTEN = 'id, weingarten_id, gst_nr, rebsorte, flaeche_ha, flaeche_ha_kataster, spritzbar, katastralgemeinde, kg_bezeichnung, einlagezahl, nutzart, lse_stueckzahl, ama_feldnummer, pflanzjahr, unterlagsrebe, rechtsverhaeltnis, weinart, bewirtschaftung, aktiv, deaktiviert_am'

type Roh = Record<string, unknown>

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null
  return typeof v === 'string' ? v : String(v)
}

function zahl(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

function ganz(v: unknown): number | null {
  const n = zahl(v)
  return n !== null && Number.isInteger(n) ? n : null
}

function riedAus(r: Roh): RiedStamm {
  return {
    id: String(r.id),
    name: str(r.name) ?? '',
    ried: str(r.ried),
    rebsorte: str(r.rebsorte),
    weinart: str(r.weinart),
    flaeche_ha: hektar(r.flaeche_ha),
    bewirtschaftung: str(r.bewirtschaftung),
    aktiv: r.aktiv === true,
    ama_feldnummer: str(r.ama_feldnummer),
    codes: str(r.codes),
    interne_bezeichnung: str(r.interne_bezeichnung),
    pflanzjahr: ganz(r.pflanzjahr),
    zentrum_lat: zahl(r.zentrum_lat),
    zentrum_lon: zahl(r.zentrum_lon),
  }
}

function gstAus(r: Roh): GstStamm {
  return {
    id: String(r.id),
    weingarten_id: String(r.weingarten_id),
    gst_nr: str(r.gst_nr) ?? '',
    rebsorte: str(r.rebsorte),
    flaeche_ha: hektar(r.flaeche_ha),
    flaeche_ha_kataster: hektar(r.flaeche_ha_kataster),
    spritzbar: r.spritzbar !== false,
    katastralgemeinde: str(r.katastralgemeinde),
    kg_bezeichnung: str(r.kg_bezeichnung),
    einlagezahl: str(r.einlagezahl),
    nutzart: str(r.nutzart),
    lse_stueckzahl: ganz(r.lse_stueckzahl),
    ama_feldnummer: str(r.ama_feldnummer),
    pflanzjahr: ganz(r.pflanzjahr),
    unterlagsrebe: str(r.unterlagsrebe),
    rechtsverhaeltnis: str(r.rechtsverhaeltnis),
    weinart: str(r.weinart),
    bewirtschaftung: str(r.bewirtschaftung),
    aktiv: r.aktiv !== false,
    deaktiviert_am: str(r.deaktiviert_am),
  }
}

/**
 * Rieden (Weingarten-Datensätze) und Grundstücke des Betriebs – für die Rieden-Übersicht
 * und das Flächenverzeichnis. Wirft bei einem Datenbankfehler (statt still eine leere
 * Liste zu zeigen). Reihenfolge: Ried (leere zuletzt), Name; Grundstücke nach GST-Nr.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeRiedenStammdaten(supabase: any, tenantId: string): Promise<{ weingaerten: RiedStamm[]; grundstuecke: GstStamm[] }> {
  const [w, g] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<Roh>((supabase.from('weingarten') as any)
      .select(RIED_SPALTEN)
      .eq('tenant_id', tenantId)
      .order('ried', { nullsFirst: false })
      .order('name')
      .order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle<Roh>((supabase.from('grundstuecke') as any)
      .select(GST_SPALTEN)
      .eq('tenant_id', tenantId)
      .order('gst_nr')
      .order('id')),
  ])
  if (w.error) throw new AktionsFehler(`Rieden konnten nicht geladen werden: ${w.error.message}`)
  if (g.error) throw new AktionsFehler(`Grundstücke konnten nicht geladen werden: ${g.error.message}`)
  return { weingaerten: w.data.map(riedAus), grundstuecke: g.data.map(gstAus) }
}

function nutzungLabel(nutzart: string | null): string | null {
  return NUTZART_OPTIONS.find(o => o.value === nutzart)?.label ?? null
}

/** Flächenverzeichnis: eine Zeile je Grundstück (Weingärten ohne Grundstück mit eigener Zeile) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeFlaechenverzeichnis(supabase: any, tenantId: string): Promise<LadeErgebnis<FlaechenZeile>> {
  const { weingaerten, grundstuecke } = await ladeRiedenStammdaten(supabase, tenantId)
  return flaechenZeilen(weingaerten, grundstuecke, nutzungLabel)
}
