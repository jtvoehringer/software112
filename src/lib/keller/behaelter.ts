// ── Gebinde laden: eigene + freigegebene (Kellergemeinschaft, Migration 203) ──
// Alle Seiten und Tools, die Gebinde auflisten oder als Ziel anbieten, gehen
// über lade_behaelter(p_tenant_id) (RPC, SECURITY DEFINER). Die RPC liefert
// zu jedem Gebinde die eigenen Liter, die fremden Liter und den Namen des
// fremden Betriebs - nie dessen Chargen. Damit gilt überall dieselbe Regel:
//   * fremd      = Gebinde gehört einem Partnerbetrieb (nur lesen, befüllen ok)
//   * gesperrt   = ein anderer Betrieb hat Wein darin → kein Ziel für Umzug,
//                  Eröffnungsbestand, Pressung, Verschnitt (Trigger in der DB
//                  fängt es zusätzlich ab, hier nur die Vorauswahl)
// Anzeige-Konvention: fremde Gebinde heißen „a1 · Weingut X“ (anzeigeName).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type BehaelterZeile = {
  id: string
  tenant_id: string
  name: string
  typ: string | null
  volumen_liter: number | null
  standort: string | null
  aktiv: boolean
  gemeinsam: boolean
  stapler: boolean
  notizen: string | null
  import_quelle: string | null
  eigentuemer_name: string
  /** Gebinde gehört einem anderen Betrieb (Freigabe über keller_freigaben) */
  fremd: boolean
  eigen_liter: number
  fremd_liter: number
  fremd_betrieb: string | null
  /** Ein anderer Betrieb hat Wein darin - kein Ziel für Einlagerung/Umzug */
  gesperrt: boolean
  /** „a1“ bzw. „a1 · Weingut X“ bei fremden Gebinden */
  anzeigeName: string
  /** KAN-174 F: Hinweis Lohnproduktion („LP + …“), nur Anzeige */
  lp_pickerl: string | null
  /** KAN-48 AP11: Material (Edelstahl, Holz …) und Langbezeichnung – BKI-Gebindeverzeichnis */
  material: string | null
  bezeichnung_lang: string | null
}

const num = (v: unknown) => v === null || v === undefined ? 0 : Number(v) || 0

export function zuBehaelterZeile(r: R): BehaelterZeile {
  const fremdLiter = num(r.fremd_liter)
  const fremd = !!r.fremd
  return {
    id: r.id, tenant_id: r.tenant_id, name: r.name, typ: r.typ ?? null,
    volumen_liter: r.volumen_liter === null || r.volumen_liter === undefined ? null : Number(r.volumen_liter),
    standort: r.standort ?? null, aktiv: !!r.aktiv, gemeinsam: !!r.gemeinsam, stapler: !!r.stapler,
    notizen: r.notizen ?? null, import_quelle: r.import_quelle ?? null,
    eigentuemer_name: r.eigentuemer_name ?? '', fremd,
    eigen_liter: num(r.eigen_liter), fremd_liter: fremdLiter, fremd_betrieb: r.fremd_betrieb ?? null,
    gesperrt: fremdLiter > 0,
    anzeigeName: fremd ? `${r.name} · ${r.eigentuemer_name ?? 'Partnerbetrieb'}` : r.name,
    lp_pickerl: r.lp_pickerl ?? null,
    material: r.material ?? null, bezeichnung_lang: r.bezeichnung_lang ?? null,
  }
}

/**
 * Eigene + freigegebene Gebinde des Betriebs (sortiert nach Name).
 * @param opts.nurAktiv   nur aktive Gebinde
 * @param opts.alsZiel    nur als Ziel geeignete (aktiv, nicht fremd belegt)
 */
export async function ladeBehaelter(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  tenantId: string | null | undefined,
  opts: { nurAktiv?: boolean; alsZiel?: boolean } = {},
): Promise<BehaelterZeile[]> {
  if (!tenantId) return []
  const { data, error } = await (client.rpc as any)('lade_behaelter', { p_tenant_id: tenantId })
  if (error) throw new Error(`Gebinde konnten nicht geladen werden: ${error.message}`)
  let rows = ((data ?? []) as R[]).map(zuBehaelterZeile)
  if (opts.nurAktiv || opts.alsZiel) rows = rows.filter(b => b.aktiv)
  if (opts.alsZiel) rows = rows.filter(b => !b.gesperrt)
  return rows
}

/** Ein Gebinde (eigenes oder freigegebenes) - null, wenn nicht sichtbar */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeBehaelterEinzeln(client: any, tenantId: string | null | undefined, behaelterId: string): Promise<BehaelterZeile | null> {
  const alle = await ladeBehaelter(client, tenantId)
  return alle.find(b => b.id === behaelterId) ?? null
}

/** Partnerbetriebe des aktiven Betriebs (als Eigentümer: wer darf meine Gebinde nutzen; als Nutzer: wessen Gebinde sehe ich) */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeKellergemeinschaft(client: any, tenantId: string | null | undefined): Promise<{ alsEigentuemer: { tenant_id: string; name: string }[]; alsNutzer: { tenant_id: string; name: string }[] }> {
  if (!tenantId) return { alsEigentuemer: [], alsNutzer: [] }
  const { data } = await (client.rpc as any)('lade_kellergemeinschaft', { p_tenant_id: tenantId })
  const rows = (data ?? []) as R[]
  return {
    alsEigentuemer: rows.filter(r => r.rolle === 'eigentuemer').map(r => ({ tenant_id: r.partner_tenant_id, name: r.partner_name })),
    alsNutzer: rows.filter(r => r.rolle === 'nutzer').map(r => ({ tenant_id: r.partner_tenant_id, name: r.partner_name })),
  }
}

/** Fehlertext des DB-Triggers (P0001) lesbar durchreichen */
export function gebindeFehlerText(message: string): string {
  return message.replace(/^.*?(Gebinde „)/, '$1')
}
