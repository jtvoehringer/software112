import 'server-only'

// KAN-418 Teil 4: Daten des Angebots laden – dieselbe Ladefunktion für PDF-Download und Mailversand.
// Alles mit dem Benutzer-Client (RLS) und zusätzlich auf den aktiven Betrieb gefiltert; nur art = 'angebot'.

import { alle } from '@/lib/supabase/alle'
import { dbFehlerText } from '@/lib/fehler'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import type { AngebotPdfProps } from '@/lib/pdf/angebotPdf'
import { abPositionen } from './bestaetigung'
import { angebotDatum, angebotEinzelpreis, angebotHinweise, angebotRabattText, angebotSummen, angebotVersendbar, angebotZeileBrutto } from './angebot'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type AngebotDaten = {
  pdf: AngebotPdfProps
  nummer: string
  gueltigBis: string | null
  betriebName: string
  kundenName: string
  kundeEmail: string | null
  kontaktId: string | null
  firmaId: string | null
}

export type AngebotLadeErgebnis = { ok: true; daten: AngebotDaten } | { ok: false; status: number; fehler: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function ladeAngebot(supabase: any, tenantId: string, angebotId: string): Promise<AngebotLadeErgebnis> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(angebotId)) return { ok: false, status: 404, fehler: 'Angebot nicht gefunden' }
  const [aRes, eRes, pRes] = await Promise.all([
    (supabase.from('auftraege') as R)
      .select('id, nummer, datum, status, gueltig_bis, storniert_am, kontakt_id, firma_id')
      .eq('id', angebotId).eq('tenant_id', tenantId).eq('art', 'angebot').maybeSingle(),
    (supabase.from('tenant_einstellungen') as R)
      .select('anzeigename, logo_url, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_email, betrieb_website, betrieb_uid')
      .eq('tenant_id', tenantId).maybeSingle(),
    alle<R>((supabase.from('auftrag_positionen') as R)
      .select('id, name, menge, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz, fuellung:fuellungen!fuellung_id(flaschengroesse_ml)')
      .eq('tenant_id', tenantId).eq('auftrag_id', angebotId).order('erstellt_am').order('id')),
  ])
  const ladeFehler = [aRes.error, eRes.error, pRes.error].find(Boolean)
  if (ladeFehler) return { ok: false, status: 500, fehler: dbFehlerText(ladeFehler, 'Das Angebot konnte nicht geladen werden') }
  const a = aRes.data as R | null
  if (!a) return { ok: false, status: 404, fehler: 'Angebot nicht gefunden' }
  if (!angebotVersendbar(a)) return { ok: false, status: 400, fehler: `Das Angebot ${a.nummer} ist storniert.` }

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
  const zeilen = (pRes.data ?? []) as R[]
  if (zeilen.length === 0) return { ok: false, status: 400, fehler: `Das Angebot ${a.nummer} hat keine Positionen.` }
  const texte = abPositionen(zeilen)   // Name, Flaschengröße als Unterzeile, Flaschen
  const positionen = zeilen.map((z, i) => ({
    name: texte[i].name, sub: texte[i].sub, flaschen: texte[i].flaschen,
    preis: angebotEinzelpreis({ ...z, rabatt_pct: 0, sonderrabatt_pct: 0 }),
    rabatt: angebotRabattText(z),
    betrag: angebotZeileBrutto(z),
  }))

  return {
    ok: true,
    daten: {
      nummer: String(a.nummer),
      gueltigBis: (a.gueltig_bis as string | null) ?? null,
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
        angebot: { nummer: String(a.nummer), datum: angebotDatum(a.datum), gueltigBis: angebotDatum(a.gueltig_bis) },
        kunde: {
          name: kundenName || 'Kunde',
          strasse: (kunde?.strasse as string | null | undefined) ?? null,
          plzOrt: kunde ? [kunde.plz, kunde.ort].filter(Boolean).join(' ') || null : null,
        },
        positionen,
        summen: angebotSummen(zeilen),
        hinweise: angebotHinweise(a.gueltig_bis),
      },
    },
  }
}
