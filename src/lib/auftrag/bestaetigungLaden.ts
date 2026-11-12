import 'server-only'

// KAN-418 Teil 3: Daten der Auftragsbestätigung laden – dieselbe Ladefunktion für PDF-Download und Mailversand.
// Alles mit dem Benutzer-Client (RLS) und zusätzlich auf den aktiven Betrieb gefiltert.

import { alle } from '@/lib/supabase/alle'
import { dbFehlerText } from '@/lib/fehler'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import type { AuftragsbestaetigungPdfProps } from '@/lib/pdf/auftragsbestaetigungPdf'
import { abDatum, abFlaschenGesamt, abHinweise, abMoeglich, abPositionen } from './bestaetigung'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type AuftragsbestaetigungDaten = {
  pdf: AuftragsbestaetigungPdfProps
  nummer: string
  reserviertBis: string | null
  betriebName: string
  kundenName: string
  kundeEmail: string | null
  kontaktId: string | null
  firmaId: string | null
}

export type AbLadeErgebnis = { ok: true; daten: AuftragsbestaetigungDaten } | { ok: false; status: number; fehler: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAuftragsbestaetigung(supabase: any, tenantId: string, auftragId: string): Promise<AbLadeErgebnis> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auftragId)) return { ok: false, status: 404, fehler: 'Auftrag nicht gefunden' }
  const [aRes, eRes, pRes] = await Promise.all([
    (supabase.from('auftraege') as R)
      .select('id, nummer, datum, status, reserviert_bis, storniert_am, kontakt_id, firma_id').eq('id', auftragId).eq('tenant_id', tenantId).eq('art', 'auftrag').maybeSingle(),
    (supabase.from('tenant_einstellungen') as R)
      .select('anzeigename, logo_url, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_email, betrieb_website, betrieb_uid')
      .eq('tenant_id', tenantId).maybeSingle(),
    alle<R>((supabase.from('auftrag_positionen') as R)
      .select('id, name, menge, fuellung:fuellungen!fuellung_id(flaschengroesse_ml)').eq('tenant_id', tenantId).eq('auftrag_id', auftragId).order('erstellt_am').order('id')),
  ])
  const ladeFehler = [aRes.error, eRes.error, pRes.error].find(Boolean)
  if (ladeFehler) return { ok: false, status: 500, fehler: dbFehlerText(ladeFehler, 'Der Auftrag konnte nicht geladen werden') }
  const a = aRes.data as R | null
  if (!a) return { ok: false, status: 404, fehler: 'Auftrag nicht gefunden' }
  if (!abMoeglich(a)) return { ok: false, status: 400, fehler: `Der Auftrag ${a.nummer} ist storniert – eine Auftragsbestätigung gibt es dazu nicht.` }

  const [kRes, fRes] = await Promise.all([
    a.kontakt_id
      ? (supabase.from('kontakte') as R).select('id, titel, vorname, nachname, titel_nachgestellt, email, strasse, plz, ort').eq('id', a.kontakt_id).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    a.firma_id
      ? (supabase.from('firmen') as R).select('id, name, email, strasse, plz, ort').eq('id', a.firma_id).eq('tenant_id', tenantId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  const kundeFehler = [kRes.error, fRes.error].find(Boolean)
  if (kundeFehler) return { ok: false, status: 500, fehler: dbFehlerText(kundeFehler, 'Der Kunde konnte nicht geladen werden') }
  const kontakt = kRes.data as R | null
  const firma = fRes.data as R | null
  const kunde = firma ?? kontakt
  const kundenName = firma ? String(firma.name ?? '') : kontakt ? kontaktAnzeigename(kontakt) : ''

  const einst = (eRes.data ?? {}) as R
  const betriebName = String(einst.betrieb_name ?? einst.anzeigename ?? 'Weingut')
  const positionen = abPositionen((pRes.data ?? []) as R[])
  if (positionen.length === 0) return { ok: false, status: 400, fehler: `Der Auftrag ${a.nummer} hat keine Positionen.` }

  return {
    ok: true,
    daten: {
      nummer: String(a.nummer),
      reserviertBis: (a.reserviert_bis as string | null) ?? null,
      betriebName,
      kundenName,
      kundeEmail: (kunde?.email as string | null | undefined)?.trim() || null,
      kontaktId: (a.kontakt_id as string | null) ?? null,
      firmaId: (a.firma_id as string | null) ?? null,
      pdf: {
        betrieb: {
          name: betriebName,
          strasse: einst.betrieb_strasse ?? null,
          plzOrt: [einst.betrieb_plz, einst.betrieb_ort].filter(Boolean).join(' ') || null,
          telefon: einst.betrieb_telefon ?? null,
          email: einst.betrieb_email ?? null,
          website: einst.betrieb_website ?? null,
          uid: einst.betrieb_uid ?? null,
          logoUrl: einst.logo_url ?? null,
        },
        auftrag: { nummer: String(a.nummer), datum: abDatum(a.datum) },
        kunde: {
          name: kundenName || 'Kunde',
          strasse: (kunde?.strasse as string | null | undefined) ?? null,
          plzOrt: kunde ? [kunde.plz, kunde.ort].filter(Boolean).join(' ') || null : null,
        },
        positionen,
        flaschenGesamt: abFlaschenGesamt(positionen),
        hinweise: abHinweise(a.reserviert_bis),
      },
    },
  }
}
