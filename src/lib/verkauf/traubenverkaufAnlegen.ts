/**
 * KAN-476: Traubenverkauf samt Liefernummer, Verkauf und Rechnungsposition in EINER Transaktion anlegen
 * (RPC s112_traubenverkauf_anlegen, SECURITY INVOKER – Policies und Trigger der Tabellen gelten unverändert).
 *
 * Bisher legte die App den Traubenverkauf an und erst danach Verkauf und Rechnung: Scheiterte der zweite Schritt
 * (Befund Musterhof: Rechnungsnummer schon vergeben), stand der Traubenverkauf ohne Verkauf da, die Meldung
 * sagte aber „Speichern fehlgeschlagen“.
 */
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'

/** Spalten des Traubenverkaufs, die die Funktion aus den Daten übernimmt (alles andere setzt die Datenbank). */
export const TRAUBENVERKAUF_FELDER = [
  'jahrgang_id', 'lese_id', 'weingarten_id', 'zukauf_posten_id', 'grundstueck_id', 'kontakt_id', 'firma_id',
  'datum', 'menge_kg', 'preis_per_kg', 'kmw_grad', 'oechsle', 'mostgewicht_einheit',
  'qualitaetsstufe', 'gesundheit', 'herkunft_code', 'notizen',
] as const

export type TraubenverkaufNeu = { id: string; verkaufspostenId: string; liefernummer: string | null }

/** Nur die Felder der Liste weitergeben – tenant_id, Liefernummer und Verkaufsbezug vergibt die Funktion selbst. */
export function traubenverkaufDaten(payload: Record<string, unknown>): Record<string, unknown> {
  const daten: Record<string, unknown> = {}
  for (const feld of TRAUBENVERKAUF_FELDER) {
    const wert = payload[feld]
    if (wert !== undefined && wert !== null && wert !== '') daten[feld] = wert
  }
  return daten
}

type RpcClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>
}

export async function traubenverkaufAnlegen(
  supabase: unknown, tenantId: string, payload: Record<string, unknown>, quelle: string,
): Promise<TraubenverkaufNeu> {
  const { data, error } = await (supabase as RpcClient).rpc('s112_traubenverkauf_anlegen', {
    p_tenant_id: tenantId, p_daten: traubenverkaufDaten(payload), p_quelle: quelle,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Der Traubenverkauf konnte nicht gespeichert werden – es wurde nichts angelegt'))
  const r = data as { id?: string; verkaufsposten_id?: string; liefernummer?: string | null } | null
  if (!r?.id || !r.verkaufsposten_id) throw new AktionsFehler('Der Traubenverkauf konnte nicht gespeichert werden – es wurde nichts angelegt.')
  return { id: r.id, verkaufspostenId: r.verkaufsposten_id, liefernummer: r.liefernummer ?? null }
}
