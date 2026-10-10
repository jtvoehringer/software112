// ── BKI-Blätter „Betriebsdaten“ und „GebindeVerzeichnis“ (KAN-48 AP11, 09.10.2026) ──
//
// Spalten nach der BKI-Schnittstelle („SchnittstelleDatenMitDefinitionTypen“):
//   Betriebsdaten A–I: Betriebsnummer, Vorname/Firmenname, Nachname/Firmenname, Bez. Betriebsstätte, PLZ (8), Ort,
//     Straße, Hausnummer (20), Bio Betrieb (boolean)
//   GebindeVerzeichnis A–E: Bezeichnung (50), Bezeichnung lang, Material, Aufstellungsort, Nenninhalt (decimal, 3 Stellen)
// Wie Lagerstand/Lagerbewegungen (Entscheidung Jörgen 06.10.2026): nach bestem Wissen ohne BKI-Abnahme – die Annahmen
// stehen als Hinweise in der Datei bzw. auf der Seite und sind im Workshop (KAN-38, AP0) zu bestätigen:
//   A1 Betriebsnummer = Weinbau-Betriebsnummer (tenant_einstellungen.betrieb_betriebsnummer, seit 25.09.2026 Pflicht)
//   A2 Firma (keine natürliche Person bzw. Rechtsform nicht gesetzt): Firmenname in „Nachname/Firmenname“, „Vorname/
//      Firmenname“ leer; natürliche Person: Vor- und Nachname
//   A3 Betriebsstätte ohne eigene Angabe = Betriebsname
//   A4 Bio = Ja bei bio_eu und biodynamisch; konventionell, kip, nachhaltig = Nein
//   A5 Gebindeverzeichnis mit den mitbenutzten Gebinden der Kellergemeinschaft (Gebinde des Partners mit „· Betrieb“)
//   A6 Bezeichnung lang ohne eigene Angabe = Gebindetyp; Aufstellungsort = Standort des Gebindes
// Transportformat (Datei/API, Dezimalzeichen) klärt AP0/AP13 – bis dahin die Standard-CSV (PROFIL_EXCEL_AT).

/* eslint-disable @typescript-eslint/no-explicit-any -- Projektkonvention (supabase.from('…') as any), siehe CLAUDE.md */
import { runden, type CsvSpalte } from '@/lib/csv'
import { ladeBehaelter } from '@/lib/keller/behaelter'
import { strasseHausnummer } from '@/lib/adresse/strasse'
import { gebindeTypLabel } from './gebindeverzeichnis'
import { text } from './kellerbuch-hilfen'
import { istRechtsform } from '@/lib/betrieb/rechtsform'
import { AktionsFehler } from '@/lib/fehler'

/** A4: Bio-Status des Betriebs → BKI „Bio Betrieb Ja/Nein“ */
export function bioBetrieb(bioStatus: string | null | undefined): boolean {
  return bioStatus === 'bio_eu' || bioStatus === 'biodynamisch'
}

export type BetriebsdatenZeile = {
  betriebsnummer: string | null
  vorname: string | null
  nachname: string | null
  betriebsstaette: string | null
  plz: string | null
  ort: string | null
  strasse: string | null
  hausnummer: string | null
  bio: boolean
}

/** Reine Abbildung der Einstellungen auf das Blatt (für Seite, CSV und Tests) */
export function betriebsdatenZeile(e: Record<string, unknown>, bioStatus: string | null): { zeile: BetriebsdatenZeile; warnungen: string[] } {
  const w: string[] = []
  const rechtsform = istRechtsform(e.betrieb_rechtsform) ? e.betrieb_rechtsform : null
  const name = text(e.betrieb_name)
  let vorname: string | null = null
  let nachname: string | null = name
  if (rechtsform === 'natuerliche_person') {
    vorname = text(e.betrieb_vorname)
    nachname = text(e.betrieb_nachname)
    if (!vorname || !nachname) w.push('Natürliche Person: Vor- und Nachname fehlen in den Betriebseinstellungen.')
  } else if (!rechtsform) {
    w.push('Rechtsform nicht gesetzt – der Betriebsname steht als Firmenname in „Nachname/Firmenname“ (Annahme A2).')
  }
  const { strasse, hausnr } = strasseHausnummer(e.betrieb_strasse)
  if (!hausnr && strasse) w.push(`Keine Hausnummer in „${strasse}“ erkannt – bitte die Adresse als „Straße Nummer“ erfassen.`)
  if (hausnr.length > 20) w.push(`Hausnummer „${hausnr}“ ist länger als 20 Zeichen.`)
  const plz = text(e.betrieb_plz)
  if (plz && plz.length > 8) w.push(`PLZ „${plz}“ ist länger als 8 Zeichen.`)
  const betriebsnummer = text(e.betrieb_betriebsnummer)
  // KAN-261: Weinhändler haben meist keine Weinbau-Betriebsnummer – Hinweis statt Pflicht
  if (!betriebsnummer) w.push(e.betriebsart === 'weinhaendler'
    ? 'Keine Betriebsnummer eingetragen (Weinhändler) – die Weindatenbank führt Betriebe über die Betriebsnummer; hat der Betrieb eine LFBIS-Nummer, bitte unter Betrieb › Einstellungen eintragen.'
    : 'Weinbau-Betriebsnummer fehlt in den Betriebseinstellungen.')
  return {
    zeile: {
      betriebsnummer, vorname, nachname,
      betriebsstaette: text(e.betrieb_betriebsstaette) ?? name,
      plz, ort: text(e.betrieb_ort), strasse: strasse || null, hausnummer: hausnr || null,
      bio: bioBetrieb(bioStatus),
    },
    warnungen: w,
  }
}

export async function ladeBetriebsdaten(supabase: any, tenantId: string): Promise<{ zeilen: BetriebsdatenZeile[]; warnungen: string[] }> {
  const [eRes, tRes] = await Promise.all([
    (supabase.from('tenant_einstellungen') as any)
      .select('betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_betriebsnummer, betriebsart, betrieb_rechtsform, betrieb_vorname, betrieb_nachname, betrieb_betriebsstaette')
      .eq('tenant_id', tenantId).maybeSingle(),
    (supabase.from('tenants') as any).select('bio_status').eq('id', tenantId).maybeSingle(),
  ])
  if (eRes.error) throw new AktionsFehler(`Betriebsdaten konnten nicht geladen werden: ${eRes.error.message}`)
  if (tRes.error) throw new AktionsFehler(`Bio-Status konnte nicht geladen werden: ${tRes.error.message}`)
  if (!eRes.data) return { zeilen: [], warnungen: ['Für den Betrieb sind noch keine Betriebsdaten erfasst.'] }
  const { zeile, warnungen } = betriebsdatenZeile(eRes.data, tRes.data?.bio_status ?? null)
  return { zeilen: [zeile], warnungen }
}

export const SPALTEN_BETRIEBSDATEN: CsvSpalte<BetriebsdatenZeile>[] = [
  { kopf: 'Betriebsnummer', typ: 'code', wert: z => z.betriebsnummer },
  { kopf: 'Vorname/Firmenname', typ: 'text', wert: z => z.vorname },
  { kopf: 'Nachname/Firmenname', typ: 'text', wert: z => z.nachname },
  { kopf: 'Bez. Betriebsstätte', typ: 'text', wert: z => z.betriebsstaette },
  { kopf: 'PLZ', typ: 'code', wert: z => z.plz },
  { kopf: 'Ort', typ: 'text', wert: z => z.ort },
  { kopf: 'Straße', typ: 'text', wert: z => z.strasse },
  { kopf: 'Hausnummer', typ: 'code', wert: z => z.hausnummer },
  { kopf: 'Bio Betrieb', typ: 'janein', wert: z => z.bio },
]

export type BkiGebindeZeile = {
  bezeichnung: string
  bezeichnungLang: string | null
  material: string | null
  aufstellungsort: string | null
  nenninhalt: number | null
  aktiv: boolean
  /** Partnerbetrieb (Kellergemeinschaft) – null bei eigenen Gebinden */
  eigentuemer: string | null
}

export async function ladeBkiGebindeverzeichnis(
  supabase: any, tenantId: string, p: { nurAktiv?: boolean } = {},
): Promise<{ zeilen: BkiGebindeZeile[]; warnungen: string[] }> {
  const gebinde = await ladeBehaelter(supabase, tenantId, { nurAktiv: p.nurAktiv })
  const w: string[] = []
  const ohneMaterial = gebinde.filter(g => !g.material).length
  if (ohneMaterial) w.push(`${ohneMaterial} Gebinde ohne Material – bitte unter Kellerbuch › Gebinde ergänzen.`)
  const zuLang = gebinde.filter(g => g.name.length > 50).map(g => g.name)
  if (zuLang.length) w.push(`Bezeichnung länger als 50 Zeichen: ${zuLang.join(', ')}`)
  const ohneVolumen = gebinde.filter(g => g.volumen_liter == null).length
  if (ohneVolumen) w.push(`${ohneVolumen} Gebinde ohne Nenninhalt.`)
  return {
    zeilen: gebinde.map(g => ({
      bezeichnung: g.name,
      bezeichnungLang: g.bezeichnung_lang ?? gebindeTypLabel(g.typ),   // A6
      material: g.material,
      aufstellungsort: g.standort,
      nenninhalt: g.volumen_liter == null ? null : runden(g.volumen_liter, 3),
      aktiv: g.aktiv,
      eigentuemer: g.fremd ? g.eigentuemer_name || 'Partnerbetrieb' : null,   // A5
    })),
    warnungen: w,
  }
}

export const SPALTEN_BKI_GEBINDE: CsvSpalte<BkiGebindeZeile>[] = [
  { kopf: 'Bezeichnung', typ: 'code', wert: z => z.bezeichnung },
  { kopf: 'Bezeichnung lang', typ: 'text', wert: z => z.bezeichnungLang },
  { kopf: 'Material', typ: 'text', wert: z => z.material },
  { kopf: 'Aufstellungsort', typ: 'text', wert: z => z.aufstellungsort },
  { kopf: 'Nenninhalt (l)', typ: 'dezimal', stellen: 3, wert: z => z.nenninhalt },
  { kopf: 'Eigentümer (Kellergemeinschaft)', typ: 'text', wert: z => z.eigentuemer },
]
