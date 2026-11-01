// Direkt pressen aus den Lesedaten (KAN-394, Epic KAN-391): Eine Lese-Zeile mit noch nicht verpresster Menge verlinkt
// auf die Pressungsseite; dort öffnet das Formular mit der Traubenzeile dieses Orts (Ried/GST, Lesetag, verfügbare kg).
// Verfügbar = dieselben Werte wie die Optionen im Pressungs-Formular (leseKontext: verfuegbareKgByGST bzw. je Ried für
// Zeilen ohne Grundstück) – sie gelten für die gewählte Lese, darum gibt es den Link nur für Zeilen dieser Lese.

// Toleranz wie KG_TOLERANZ in leseBilanz.ts – nicht importiert, das Modul zöge Supabase-Helfer in die Client-Komponente
const KG_TOLERANZ = 0.01

export type PressenZeile = {
  weingarten_id: string; grundstueck_id: string | null; ernte_datum: string | null; menge_kg: number | null
  storno?: unknown
}

/** Verfügbare kg je Ort der gewählten Lese: `gst` je Grundstück, `wg` je Ried (Zeilen ohne Grundstück) */
export type PressenVerfuegbar = { gst: Record<string, number>; wg: Record<string, number> }

/** Link „Pressen“ für eine Lese-Zeile bzw. null (storniert, 0 kg, andere Lese, nichts mehr verfügbar) */
export function pressenHref(basis: string, z: PressenZeile, verfuegbar: PressenVerfuegbar, inGewaehlterLese: boolean): string | null {
  if (!inGewaehlterLese || z.storno || !(z.menge_kg != null && z.menge_kg > 0)) return null
  const kg = z.grundstueck_id ? verfuegbar.gst[z.grundstueck_id] : verfuegbar.wg[z.weingarten_id]
  if (!(kg != null && kg > KG_TOLERANZ)) return null
  const p = new URLSearchParams({ ried: z.weingarten_id })
  if (z.grundstueck_id) p.set('gst', z.grundstueck_id)
  if (z.ernte_datum) p.set('tag', z.ernte_datum.slice(0, 10))
  return `${basis}${basis.includes('?') ? '&' : '?'}${p.toString()}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TAG = /^\d{4}-\d{2}-\d{2}$/
const eins = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/**
 * Vorauswahl der Pressungsseite aus den Parametern ried/gst/tag: Kandidaten der Options-ID im Formular
 * („Ried|GST|Lesetag“ bei mehreren Lesetagen, sonst „Ried|GST|“), erster Treffer gewinnt. null bei ungültigen Werten.
 */
export function pressenVorauswahl(sp: { ried?: string | string[]; gst?: string | string[]; tag?: string | string[] }): string[] | null {
  const ried = eins(sp.ried), gst = eins(sp.gst), tag = eins(sp.tag)
  if (!UUID.test(ried) || (gst && !UUID.test(gst)) || (tag && !TAG.test(tag))) return null
  const ort = `${ried}|${gst}`
  return tag ? [`${ort}|${tag}`, `${ort}|`] : [`${ort}|`]
}
