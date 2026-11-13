// ── Rechtsverhältnis, Einheitswert und SVS-Zurechnung je Grundstück (KAN-458, 13.11.2026) ──────────────────────────
//
// Die fünf Werte liegen nicht mehr in grundstuecke, sondern in grundstueck_recht (höchstens eine Zeile je Grundstück,
// Lesebereich ea): Mitarbeiter mit Profil „Extern“ lesen die Grundstücke ihrer Rieden, aber weder Pacht/Eigentum noch
// Einheitswert und Zurechnung. Ohne Zeile – oder ohne Leserecht – gelten: kein Rechtsverhältnis, kein Einheitswert,
// Zurechnung „eigen“ (derselbe Standard wie die Spalte).
//   Lesen:     `.select(`…, ${RECHT_EINBETTUNG}`)` an einer Abfrage auf grundstuecke, danach mitRecht(zeile)
//   Schreiben: speichereGrundstueckRecht() – legt die Zeile an bzw. ändert nur die übergebenen Werte
// Isomorph, ohne '@/'-Importe (node:test).

export const RECHT_SPALTEN = ['rechtsverhaeltnis', 'einheitswert', 'einheitswert_bescheid', 'einheitswert_quelle', 'svs_zurechnung'] as const
export type RechtSpalte = typeof RECHT_SPALTEN[number]

/** Einbettung für Abfragen auf grundstuecke (1:1 über grundstueck_recht.grundstueck_id) */
export const RECHT_EINBETTUNG = `recht:grundstueck_recht(${RECHT_SPALTEN.join(', ')})`

export type GrundstueckRecht = {
  rechtsverhaeltnis: string | null
  einheitswert: number | string | null
  einheitswert_bescheid: string | null
  einheitswert_quelle: string | null
  svs_zurechnung: string
}

const OHNE: GrundstueckRecht = { rechtsverhaeltnis: null, einheitswert: null, einheitswert_bescheid: null, einheitswert_quelle: null, svs_zurechnung: 'eigen' }

/**
 * Zeile aus grundstuecke mit eingebettetem `recht` → flache Zeile mit den fünf Werten (wie vor KAN-458).
 * PostgREST liefert die Einbettung als Objekt, bei mehrdeutigem Schlüssel als Liste – beides wird gelesen.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function mitRecht<Z extends Record<string, any>>(zeile: Z): Omit<Z, 'recht'> & GrundstueckRecht {
  const { recht, ...rest } = zeile
  const r = (Array.isArray(recht) ? recht[0] : recht) as Partial<GrundstueckRecht> | null | undefined
  return {
    ...rest,
    rechtsverhaeltnis: r?.rechtsverhaeltnis ?? OHNE.rechtsverhaeltnis,
    einheitswert: r?.einheitswert ?? OHNE.einheitswert,
    einheitswert_bescheid: r?.einheitswert_bescheid ?? OHNE.einheitswert_bescheid,
    einheitswert_quelle: r?.einheitswert_quelle ?? OHNE.einheitswert_quelle,
    svs_zurechnung: r?.svs_zurechnung ?? OHNE.svs_zurechnung,
  }
}

/**
 * Werte eines Grundstücks speichern: legt die Zeile an oder ändert genau die übergebenen Spalten (die übrigen bleiben).
 * Liefert null bei Erfolg, sonst den Fehlertext – auch wenn die Datenbank 0 Zeilen geschrieben hat (RLS).
 */
export async function speichereGrundstueckRecht(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: { from: (tabelle: string) => any },
  tenantId: string,
  grundstueckId: string,
  werte: Partial<GrundstueckRecht>,
): Promise<string | null> {
  const { data, error } = await supabase.from('grundstueck_recht')
    .upsert({ tenant_id: tenantId, grundstueck_id: grundstueckId, ...werte }, { onConflict: 'grundstueck_id' })
    .select('id')
  if (error) return String(error.message ?? error)
  if (!(data as unknown[] | null)?.length) return 'Rechtsverhältnis bzw. Einheitswert konnten nicht gespeichert werden – dafür fehlt das Recht.'
  return null
}
