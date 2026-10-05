import 'server-only'

// KAN-208 (05.10.2026): Name und Betriebsnummer des Kunden bzw. Lieferanten (Firma vor Kontakt) für die Pflichtprüfung
// in Verkauf, Traubenverkauf und Zukauf (lib/handel/partnerPflicht.ts). Immer auf den Betrieb gefiltert.

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
type Client = any

export type PartnerStamm = { vorhanden: boolean; name: string | null; betriebNr: string | null }

export async function ladePartner(supabase: Client, tenantId: string, kontaktId: string | null, firmaId: string | null): Promise<PartnerStamm> {
  if (firmaId) {
    const { data, error } = await (supabase.from('firmen') as Client).select('name, betrieb_nr').eq('id', firmaId).eq('tenant_id', tenantId).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Firma konnte nicht geladen werden'))
    if (!data) throw new AktionsFehler('Die gewählte Firma wurde nicht gefunden – bitte die Seite neu laden.')
    return { vorhanden: true, name: data.name ?? null, betriebNr: data.betrieb_nr ?? null }
  }
  if (kontaktId) {
    const { data, error } = await (supabase.from('kontakte') as Client).select('vorname, nachname, betrieb_nr').eq('id', kontaktId).eq('tenant_id', tenantId).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Kontakt konnte nicht geladen werden'))
    if (!data) throw new AktionsFehler('Der gewählte Kontakt wurde nicht gefunden – bitte die Seite neu laden.')
    return { vorhanden: true, name: [data.vorname, data.nachname].filter(Boolean).join(' ') || null, betriebNr: data.betrieb_nr ?? null }
  }
  return { vorhanden: false, name: null, betriebNr: null }
}
