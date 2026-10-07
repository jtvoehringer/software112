// KAN-220 (07.10.2026): Daten des Produktdatenblatts einer Füllung laden – gemeinsam für das PDF, die Karte auf der
// Füllungsseite und den Händler-Sammelexport. Alles mit .eq('tenant_id', …) und dem Benutzer-Client (RLS, auch Storage).

import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'
import { HERKUNFT_LABEL } from '@/lib/herkunft'
import { flaschengroesseText } from '@/lib/export/datenexporte'
import { elabelUrl } from '@/lib/elabel/oeffentlich'
import { appBasisUrl } from '@/lib/qr'
import { weinpassPfad } from '@/lib/handel/losnummer'
import { analyseWerte, bildArtAusName, BILD_BUCKET, type AnalyseWerte, type BildArt } from '@/lib/handel/datenblatt'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = any

export type DatenblattDaten = {
  fuellung: R
  name: string
  jahrgang: number | null
  rebsorte: string | null
  qualitaet: string | null
  herkunft: string | null
  flaschengroesse: string | null
  pruefnummer: string | null
  chargennummer: string | null
  werte: AnalyseWerte
  naehrwerte: { energieKj: number; energieKcal: number; kohlenhydrate: number | null; zucker: number | null } | null
  elabelLink: string | null
  weinpassLink: string | null
  betrieb: { name: string; adresse: string | null; kontakt: string | null; logoUrl: string | null }
  /** Signierte Adressen der Bilder (5 Minuten gültig) */
  bilder: Partial<Record<BildArt, { url: string; pfad: string }>>
}

const SPALTEN = 'id, name, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis, sekt_stufe, anbaugebiet, herkunft_code, ' +
  'flaschengroesse_ml, pruefnummer, chargennummer, weinausbau_id, weinpass_code, storniert_am'

/** Herkunft fürs Datenblatt: Katalogname des Codes, sonst das frei erfasste Anbaugebiet */
export function herkunftText(f: R): string | null {
  return (f.herkunft_code && HERKUNFT_LABEL[f.herkunft_code]) || f.anbaugebiet || null
}

/** Bilder einer Füllung (Ordner <tenant>/<fuellung>) mit signierten Adressen */
export async function ladeBilder(supabase: Client, tenantId: string, fuellungId: string, sekunden = 300): Promise<DatenblattDaten['bilder']> {
  const ordner = `${tenantId}/${fuellungId}`
  const { data } = await supabase.storage.from(BILD_BUCKET).list(ordner, { limit: 10 })
  const bilder: DatenblattDaten['bilder'] = {}
  for (const o of (data ?? []) as R[]) {
    const art = bildArtAusName(String(o.name ?? ''))
    if (!art) continue
    const pfad = `${ordner}/${o.name}`
    const { data: s } = await supabase.storage.from(BILD_BUCKET).createSignedUrl(pfad, sekunden)
    if (s?.signedUrl) bilder[art] = { url: s.signedUrl, pfad }
  }
  return bilder
}

export async function ladeDatenblatt(supabase: Client, tenantId: string, fuellungId: string): Promise<DatenblattDaten | null> {
  const { data: fRaw } = await supabase.from('fuellungen').select(SPALTEN).eq('id', fuellungId).eq('tenant_id', tenantId).maybeSingle()
  if (!fRaw) return null
  const f = fRaw as R

  // alle-ausnahme: Chargen einer einzelnen Füllung, wenige
  const { data: fc } = await supabase.from('fuellung_chargen').select('weinausbau_id').eq('tenant_id', tenantId).eq('fuellung_id', fuellungId).limit(100)
  const chargen = [...new Set([f.weinausbau_id, ...((fc ?? []) as R[]).map(c => c.weinausbau_id)].filter(Boolean))] as string[]

  const [anaRes, elRes, einstRes, bilder] = await Promise.all([
    chargen.length === 0 ? Promise.resolve({ data: [] }) :
      // alle-ausnahme: Chargen einer einzelnen Füllung (höchstens 100), nur die jüngsten Analysen
      supabase.from('weinanalysen').select('analyse_datum, alkohol_vol, restzucker_gl, gesamtsaeure_gl, storniert_am')
        .eq('tenant_id', tenantId).in('weinausbau_id', chargen).is('storniert_am', null)
        .order('analyse_datum', { ascending: false }).order('id').limit(20),
    supabase.from('elabels').select('status, code, alkohol_vol, restzucker_gl, gesamtsaeure_gl, energie_kj, energie_kcal, kohlenhydrate_g, zucker_g')
      .eq('tenant_id', tenantId).eq('fuellung_id', fuellungId).maybeSingle(),
    supabase.from('tenant_einstellungen')
      .select('anzeigename, logo_url, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_email, betrieb_website')
      .eq('tenant_id', tenantId).maybeSingle(),
    ladeBilder(supabase, tenantId, fuellungId),
  ])
  const el = (elRes.data ?? null) as R | null
  const einst = (einstRes.data ?? {}) as R
  const freigegeben = el?.status === 'freigegeben'
  const wp = weinpassPfad(f as { weinpass_code?: string | null; chargennummer?: string | null })

  return {
    fuellung: f,
    name: String(f.name ?? 'Wein'),
    jahrgang: f.jahrgang == null ? null : Number(f.jahrgang),
    rebsorte: f.rebsorte ?? null,
    qualitaet: qualitaetAnzeigeOderNull(f),
    herkunft: herkunftText(f),
    flaschengroesse: flaschengroesseText(f.flaschengroesse_ml),
    pruefnummer: f.pruefnummer ?? null,
    chargennummer: f.chargennummer ?? null,
    werte: analyseWerte(el, (anaRes.data ?? []) as R[]),
    naehrwerte: freigegeben && el?.energie_kj != null ? {
      energieKj: Number(el.energie_kj), energieKcal: Number(el.energie_kcal),
      kohlenhydrate: el.kohlenhydrate_g == null ? null : Number(el.kohlenhydrate_g), zucker: el.zucker_g == null ? null : Number(el.zucker_g),
    } : null,
    elabelLink: freigegeben && el?.code ? elabelUrl(String(el.code), appBasisUrl()) : null,
    weinpassLink: wp ? `${appBasisUrl()}${wp}` : null,
    betrieb: {
      name: String(einst.betrieb_name ?? einst.anzeigename ?? 'Weingut'),
      adresse: [einst.betrieb_strasse, [einst.betrieb_plz, einst.betrieb_ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || null,
      kontakt: [einst.betrieb_telefon, einst.betrieb_email, einst.betrieb_website].filter(Boolean).join(' · ') || null,
      logoUrl: einst.logo_url ?? null,
    },
    bilder,
  }
}
