// ── Mittel für Mitarbeiter ohne Lesebereich „betriebsmittel“ (KAN-456, 13.11.2026) ─────────────────────────────────
//
// Das Profil „Extern“ erfasst Maßnahmen, liest aber Lager, Einkauf und Preise der Mittel nicht – die Tabellen
// pflanzenschutzmittel, duengemittel und betriebsmittel sind für ihn leer (Policy „lesebereich“). Damit Formular,
// Bearbeiten und die Prüfungen der Server Action unverändert bleiben, liefert profilClient() für solche Mitglieder
// einen Client, dessen `.from('<mittel-tabelle>')` auf die Funktion ohne Preis zeigt (s112_psm_ohne_preis usw.,
// Migration kan412d_extern_mittel). Die Funktionen liefern alle Spalten außer dem Preis; ein `.select()` mit einer
// ausgelassenen Spalte wird um sie gekürzt (sonst lehnt die Datenbank die Abfrage ab) – das Feld fehlt dann im Ergebnis.
// Nur für LESENDE Stellen verwenden: Schreiben auf die Mittel-Tabellen geht über diesen Client nicht.
// Für alle anderen Mitglieder (ohne Profil, Betriebsleitung, Vertrieb …) kommt der Client unverändert zurück.
// Isomorph, ohne '@/'-Importe (node:test).

// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { canRead } from './lesebereiche.ts'
// @ts-expect-error TS5097 – Pfad mit .ts-Endung, damit Node die Datei in den Tests ohne Bundler lädt
import { AktionsFehler } from '../fehler.ts'

type Mitglied = { role?: unknown; profil?: unknown; tenantId?: string | null } | null | undefined

/** Mittel-Tabelle → Funktion ohne Preis und die dort ausgelassenen Spalten */
export const MITTEL_FUNKTIONEN: Record<string, { fn: string; ohne: readonly string[] }> = {
  pflanzenschutzmittel: { fn: 's112_psm_ohne_preis', ohne: ['preis_pro_einheit'] },
  duengemittel: { fn: 's112_duengemittel_ohne_preis', ohne: ['preis_pro_einheit'] },
  betriebsmittel: { fn: 's112_betriebsmittel_ohne_preis', ohne: ['preis_pro_einheit', 'ea_kategorie_id'] },
}

/** true, wenn das Mitglied Maßnahmen erfasst, die Mittel-Tabellen aber nicht lesen darf */
export function brauchtMittelOhnePreis(m: Mitglied): boolean {
  return !!m && !!m.tenantId && !canRead(m, 'betriebsmittel') && canRead(m, 'massnahmen')
}

/** Spaltenliste eines select() ohne die ausgelassenen Spalten ('*' bleibt) */
export function spaltenOhne(spalten: string, ohne: readonly string[]): string {
  return spalten.split(',').map(s => s.trim()).filter(s => s && !ohne.includes(s)).join(', ')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function profilClient<T extends { from: (tabelle: string) => any; rpc: (...a: any[]) => any }>(supabase: T, m: Mitglied): T {
  if (!brauchtMittelOhnePreis(m)) return supabase
  const tenantId = m!.tenantId
  return new Proxy(supabase, {
    get(ziel, name) {
      if (name === 'from') {
        return (tabelle: string) => {
          const mittel = MITTEL_FUNKTIONEN[tabelle]
          if (!mittel) return ziel.from(tabelle)
          const abfrage = ziel.rpc(mittel.fn, { p_tenant_id: tenantId })
          const select = abfrage.select.bind(abfrage)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          abfrage.select = (spalten?: string, ...rest: any[]) => select(typeof spalten === 'string' ? spaltenOhne(spalten, mittel.ohne) : spalten, ...rest)
          return abfrage
        }
      }
      const wert = Reflect.get(ziel, name)
      return typeof wert === 'function' ? wert.bind(ziel) : wert
    },
  })
}

/**
 * Eingebettete Mittel nachtragen: `psm:psm_id(name, wartezeit_tage)` liefert für Mitglieder ohne Lesebereich
 * „betriebsmittel“ null. Trägt für Zeilen mit psm_id ohne `psm` Name und Wartezeit aus der Funktion ohne Preis nach.
 * Für alle anderen Mitglieder unverändert. Wirft bei einem Lesefehler der Funktion.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function psmNachtragen<Z extends Record<string, any>>(supabase: { rpc: (...a: any[]) => any }, m: Mitglied, zeilen: Z[]): Promise<Z[]> {
  if (!brauchtMittelOhnePreis(m) || !zeilen.some(z => z.psm_id && !z.psm)) return zeilen
  const { data, error } = await supabase.rpc(MITTEL_FUNKTIONEN.pflanzenschutzmittel.fn, { p_tenant_id: m!.tenantId }).select('id, name, wartezeit_tage')
  if (error) throw new AktionsFehler(`Pflanzenschutzmittel konnten nicht geladen werden: ${error.message}`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nachId = new Map<string, any>(((data ?? []) as any[]).map(p => [String(p.id), p]))
  return zeilen.map(z => (z.psm_id && !z.psm && nachId.has(String(z.psm_id))
    ? { ...z, psm: { name: nachId.get(String(z.psm_id)).name, wartezeit_tage: nachId.get(String(z.psm_id)).wartezeit_tage } }
    : z))
}
