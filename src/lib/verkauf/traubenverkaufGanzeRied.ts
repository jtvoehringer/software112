import 'server-only'

// ── Traubenverkauf der ganzen Ried (KAN-476 Nebenbefund, 19.11.2026) ─────────────────────────────────────────
// Gemeinsam für weinhandel/traubenverkauf/actions.ts und erntemeldung/actions.ts. An einer Ried mit Grundstücken
// wird je GST verkauft (KAN-394). „Ganze Ried“ schickt je Grundstück eine Zeile mit Menge (Feld `zeilen`, JSON):
// je Zeile entsteht ein Traubenverkauf mit eigener Liefernummer, alle zusammen sind EIN Verkauf mit einer Rechnung
// (RPC s112_traubenverkauf_anlegen_zeilen, alles oder nichts). Alle Prüfungen laufen vor dem ersten Schreiben –
// dieselben wie beim einzelnen Traubenverkauf. Die Aufrufer prüfen Betrieb der Seite und Schreibsperre vorher.

import { AktionsFehler, dbFehlerText, LESE_WAEHLEN_MELDUNG } from '@/lib/fehler'
import { canWrite, type Membership } from '@/lib/auth/roles'
import { dezimal } from '@/lib/format'
import { heuteWien } from '@/lib/datum/wien'
import { qualitaetFehler } from '@/lib/wein/qualitaet'
import { mostgewichtAusFormular, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import { traubenverkaufLeseZeilen, verkaufZeilenAus } from '@/lib/wein/leseBilanz'
import { rechnungsdatumFehler } from '@/lib/verkauf/rechnungsdatum'
import { traubenverkaufZeilenAnlegen } from '@/lib/verkauf/traubenverkaufAnlegen'
import { verkaufKundeFehler } from '@/lib/handel/partnerPflicht'
import { ladePartner } from '@/lib/handel/partnerLaden'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

/** Schickt das Formular die Zeilen „ganze Ried“ mit? (nur neue Verkäufe aus eigener Ernte) */
export function istGanzeRied(fd: FormData): boolean {
  const z = fd.get('zeilen')
  return typeof z === 'string' && z.trim() !== '' && !fd.get('existing_id') && !fd.get('zukauf_posten_id')
}

/** Bezeichnung der Rechnungsposition einer Zeile: „<Ried>, GST <Nr.>“ */
export function zeilenBezeichnung(ried: string, gstNr: string | null): string {
  return gstNr ? `${ried}, GST ${gstNr}` : ried
}

export async function ganzeRiedVerkaufen(
  supabase: SB, membership: Membership, fd: FormData,
): Promise<{ verkaufspostenId: string; anzahl: number }> {
  const tenantId = membership.tenantId
  // Mit dem Traubenverkauf entstehen Verkauf und Rechnung (Freigabe Warenwirtschaft) – ohne sie vorab ablehnen
  if (!canWrite(membership, 'warenwirtschaft')) {
    throw new AktionsFehler('Mit einem Traubenverkauf werden Verkauf und Rechnung angelegt – das dürfen nur Betriebs-Manager und Mitarbeiter mit Freigabe Warenwirtschaft. Es wurde nichts gespeichert.')
  }
  const text = (name: string) => ((fd.get(name) as string | null) || null)
  const z = verkaufZeilenAus(fd.get('zeilen'), x => Number(dezimal(String(x))))
  if (z.fehler) throw new AktionsFehler(z.fehler)

  const qualitaetsstufe = text('qualitaetsstufe')
  const qualitaetUnzulaessig = qualitaetFehler('lese', qualitaetsstufe)
  if (qualitaetUnzulaessig) throw new AktionsFehler(qualitaetUnzulaessig)
  const mostgewicht = mostgewichtAusFormular(fd, 'mostgewicht', { altesFeld: 'kmw_grad' })
  if (!mostgewicht.ok) throw new AktionsFehler(mostgewicht.fehler)

  const jahrgangId = text('jahrgang_id')
  const weingartenId = text('weingarten_id')
  const kontaktId = text('kontakt_id')
  const firmaId = text('firma_id')
  const datum = text('datum')
  if (!datum) throw new AktionsFehler('Bitte ein Datum für den Traubenverkauf angeben.')
  const preisText = text('preis_per_kg')
  const preisPerKg = preisText && preisText.trim() !== '' ? Number(dezimal(preisText)) : null
  if (preisPerKg !== null && !Number.isFinite(preisPerKg)) throw new AktionsFehler('Bitte den Preis je kg als Zahl angeben.')

  // KAN-208: Abnehmer samt Betriebsnummer Pflicht (Empfänger der Transportbescheinigung)
  { const partner = await ladePartner(supabase, tenantId, kontaktId, firmaId)
    const f = verkaufKundeFehler({ typen: ['trauben'], kunde: partner.vorhanden, betriebNr: partner.betriebNr, kundeName: partner.name })
    if (f) throw new AktionsFehler(f) }

  // Lese, Grundstücke der Ried und kg-Bilanz je Lese über alle Zeilen gemeinsam
  const lese = await traubenverkaufLeseZeilen(supabase, tenantId, {
    jahrgangId, weingartenId, zeilen: z.zeilen, datum, leseIdFormular: text('lese_id'), leseWaehlenText: LESE_WAEHLEN_MELDUNG,
  })
  if (lese.fehler) throw new AktionsFehler(lese.fehler)
  // KAN-355: Die Rechnung trägt das Datum des Verkaufs – im abgeschlossenen Zeitraum vorab ablehnen
  { const sperre = await rechnungsdatumFehler(supabase, tenantId, datum, heuteWien())
    if (sperre) throw new AktionsFehler(sperre) }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wg, error: wgErr } = await (supabase.from('weingarten') as any)
    .select('name').eq('id', weingartenId).eq('tenant_id', tenantId).maybeSingle()
  if (wgErr) throw new AktionsFehler(dbFehlerText(wgErr, 'Ried konnte nicht geladen werden'))
  if (!wg) throw new AktionsFehler('Die Ried gehört nicht zu diesem Betrieb oder wurde gelöscht – bitte die Seite neu laden.')
  const ried = ((wg as { name?: string | null }).name ?? 'Weingarten') as string

  const kopf = {
    jahrgang_id: jahrgangId, lese_id: lese.leseId, weingarten_id: weingartenId,
    kontakt_id: kontaktId, firma_id: firmaId, datum, preis_per_kg: preisPerKg,
    ...mostgewichtSpalten(mostgewicht.wert, 'kmw_grad'),
    qualitaetsstufe, gesundheit: text('gesundheit') || 'G', herkunft_code: text('herkunft_code'), notizen: text('notizen'),
  }
  const neu = await traubenverkaufZeilenAnlegen(supabase, tenantId, kopf,
    z.zeilen.map(x => ({ grundstueck_id: x.grundstueckId, menge_kg: x.mengeKg, bezeichnung: zeilenBezeichnung(ried, lese.gst.get(x.grundstueckId)?.gstNr ?? null) })),
    ried)
  return { verkaufspostenId: neu.verkaufspostenId, anzahl: neu.zeilen.length }
}
