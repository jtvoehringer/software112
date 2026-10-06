import 'server-only'

// KAN-208 (05.10.2026): Name und Betriebsnummer des Kunden bzw. Lieferanten (Firma vor Kontakt) für die Pflichtprüfung
// in Verkauf, Traubenverkauf und Zukauf (lib/handel/partnerPflicht.ts). Immer auf den Betrieb gefiltert – KAN-212: auf den
// eigenen und die Betriebe, die ihr CRM für ihn freigegeben haben (Fremdverweis-Modus 'crm' prüft dasselbe in der DB).

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { ladeCrmGemeinschaft, sichtbareBetriebe } from '@/lib/crm/gemeinschaft'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
type Client = any

export type PartnerStamm = { vorhanden: boolean; name: string | null; betriebNr: string | null }

export async function ladePartner(supabase: Client, tenantId: string, kontaktId: string | null, firmaId: string | null): Promise<PartnerStamm> {
  if (!firmaId && !kontaktId) return { vorhanden: false, name: null, betriebNr: null }
  const betriebe = sichtbareBetriebe(tenantId, await ladeCrmGemeinschaft(supabase, tenantId))
  if (firmaId) {
    // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – eigener Betrieb und freigebende Partner
    const { data, error } = await (supabase.from('firmen') as Client).select('name, betrieb_nr').eq('id', firmaId).in('tenant_id', betriebe).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Firma konnte nicht geladen werden'))
    if (!data) throw new AktionsFehler('Die gewählte Firma wurde nicht gefunden – bitte die Seite neu laden.')
    return { vorhanden: true, name: data.name ?? null, betriebNr: data.betrieb_nr ?? null }
  }
  if (kontaktId) {
    // tenant-isolation-ignore: KAN-212 CRM-Gemeinschaft – eigener Betrieb und freigebende Partner
    const { data, error } = await (supabase.from('kontakte') as Client).select('vorname, nachname, betrieb_nr').eq('id', kontaktId).in('tenant_id', betriebe).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Kontakt konnte nicht geladen werden'))
    if (!data) throw new AktionsFehler('Der gewählte Kontakt wurde nicht gefunden – bitte die Seite neu laden.')
    return { vorhanden: true, name: [data.vorname, data.nachname].filter(Boolean).join(' ') || null, betriebNr: data.betrieb_nr ?? null }
  }
  return { vorhanden: false, name: null, betriebNr: null }
}
