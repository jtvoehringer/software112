'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, type Membership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { syncEaEinnahmeFuerVerkauf } from '@/app/(dashboard)/buchhaltung/actions'
import { fmtEur, fmtNum, dezimal } from '@/lib/format'
import { AktionsFehler, dbFehlerText, fehlerText } from '@/lib/fehler'
import { qualitaetFehler } from '@/lib/wein/qualitaet'
import { mostgewichtAusWert, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import type { Mostgewicht } from '@/lib/wein/mostgewicht'
import {
  bestandBuchenAllesOderNichts,
  bestandsBuchungenZuruecknehmen,
  pruefeVerkaufsRechte,
  verkaufspostenStornieren,
  LITER_TOLERANZ,
  type BestandsBuchung,
} from '@/lib/verkauf/bestand'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getMembership(): Promise<Membership> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership
}

async function getTenantId(): Promise<string> {
  return (await getMembership()).tenantId
}

// Atomisch: Rechnungsnummer generieren (Zähler +1 in einer DB-Transaktion)
async function generateRechnungsnummer(tenantId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await (supabase.rpc as any)('get_next_rechnungsnummer', {
    p_tenant_id: tenantId,
  })
  if (error) {
    console.error('generateRechnungsnummer:', error.message)
    return null
  }
  return data as string | null
}

// Positions-Typ aus der Form
const POSITIONS_TYPEN = ['flasche', 'tank', 'sonstiges', 'trauben'] as const
interface PositionInput {
  typ:               typeof POSITIONS_TYPEN[number]
  fuellung_id:       string | null
  weinausbau_id:     string | null
  // KAN-35: Tankverkauf nur noch aus Kellerbuch-Chargen – gesetzte Werte werden abgelehnt
  // (Felder bleiben nur, damit ältere Formulare/Aufrufer eine klare Meldung bekommen)
  zukauf_id?:             string | null
  pressung_behaelter_id?: string | null
  name:                  string
  menge:             number
  einheit:           string
  preis_brutto:      number | null
  rabatt_pct?:       number
  sonderrabatt_pct?: number
  ust_satz?:         number
  // Traubenverkauf-spezifische BKI-Felder
  trauben_weingarten_id?:   string | null
  trauben_jahrgang_id?:     string | null
  trauben_grundstueck_id?:  string | null
  /** Mostgewicht (KAN-128): Messwert wie eingegeben und gemessene Einheit – beide Werte rechnet der Server */
  trauben_mostgewicht_wert?:    string | number | null
  trauben_mostgewicht_einheit?: string | null
  /** älteres Format (vor KAN-128): °KMW als Zahl – gilt als °KMW-Messung */
  trauben_kmw_grad?:        number | null
  trauben_qualitaetsstufe?: string | null
  trauben_herkunft_code?:   string | null
  trauben_gesundheit?:      'G' | 'K'
}

const NUR_CHARGE_HINWEIS =
  'Offener Wein (Tank) kann nur aus einer Kellerbuch-Charge verkauft werden. ' +
  'Zukäufe bitte zuerst über „Zukauf bearbeiten“ einem Gebinde zuordnen – dabei entsteht die Charge –, dann die Charge verkaufen.'

// ── Prüfung aller Positionen VOR dem ersten Schreibzugriff (KAN-35) ───────────
// Bugreport 6.8.2026: eine Kellerbuch-Charge mit bereits 0 L Bestand liess sich
// trotzdem "verkaufen" – der Bestand wurde nachträglich bei 0 gekappt (Math.max(0, …)).
// Seit KAN-35 wird VOR dem Anlegen von Rechnungsnummer, Verkaufsposten und Positionen
// geprüft und abgelehnt: Schreibrechte (Tank braucht zusätzlich Kellerbuch/Rieden),
// Menge > 0, Tank nur aus Charge, Verfügbarkeit je Charge bzw. Füllung – über ALLE
// Positionen summiert (zwei Positionen derselben Charge zählen zusammen). Die Abbuchung
// selbst kappt nicht mehr; die DB-CHECKs sind das Sicherheitsnetz.

async function pruefePositionen(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  membership: Membership,
  positionen: PositionInput[],
): Promise<{ literJeCharge: Map<string, number>; stueckJeFuellung: Map<string, number>; mostgewichtJePosition: (Mostgewicht | null)[] }> {
  const tenantId = membership.tenantId
  const literJeCharge   = new Map<string, number>()
  const stueckJeFuellung = new Map<string, number>()
  const mostgewichtJePosition: (Mostgewicht | null)[] = []

  positionen.forEach((p, i) => {
    const nr = `Position ${i + 1}${p?.name ? ` („${String(p.name).trim()}“)` : ''}`
    if (!p || !POSITIONS_TYPEN.includes(p.typ)) throw new AktionsFehler(`${nr}: unbekannter Positionstyp`)
    if (!String(p.name ?? '').trim()) throw new AktionsFehler(`${nr}: Bitte eine Bezeichnung angeben.`)
    const menge = Number(p.menge)
    if (!Number.isFinite(menge)) throw new AktionsFehler(`${nr}: ungültige Menge`)
    if (p.typ !== 'sonstiges' && !(menge > 0)) {
      throw new AktionsFehler(`${nr}: Die Menge muss größer als 0 sein. Rücknahmen bitte als Storno des Verkaufs buchen.`)
    }
    if (p.zukauf_id || p.pressung_behaelter_id) throw new AktionsFehler(`${nr}: ${NUR_CHARGE_HINWEIS}`)

    if (p.typ === 'tank') {
      if (!p.weinausbau_id) throw new AktionsFehler(`${nr}: Bitte eine Kellerbuch-Charge auswählen. ${NUR_CHARGE_HINWEIS}`)
      literJeCharge.set(p.weinausbau_id, (literJeCharge.get(p.weinausbau_id) ?? 0) + menge)
    } else if (p.typ === 'flasche' && p.fuellung_id) {
      if (!Number.isInteger(menge)) throw new AktionsFehler(`${nr}: Flaschen bitte in ganzen Stück angeben.`)
      stueckJeFuellung.set(p.fuellung_id, (stueckJeFuellung.get(p.fuellung_id) ?? 0) + menge)
    } else if (p.typ === 'trauben' && !p.trauben_weingarten_id) {
      throw new AktionsFehler(`${nr}: Bitte den Weingarten (Ried) für den Traubenverkauf auswählen.`)
    }
    if (p.typ === 'trauben') {
      // KAN-73: Trauben-Qualität = Stufen der Lese (traubenverkauf hat keinen CHECK)
      const qualitaetUnzulaessig = qualitaetFehler('lese', p.trauben_qualitaetsstufe ?? null)
      if (qualitaetUnzulaessig) throw new AktionsFehler(`${nr}: ${qualitaetUnzulaessig}`)
      // KAN-128: Mostgewicht aus Messwert und Einheit (älteres Format: trauben_kmw_grad als °KMW) –
      // beide Werte serverseitig gerechnet; die Stufe bleibt, wie gewählt (Rechenregel 6)
      const mg = p.trauben_mostgewicht_wert !== null && p.trauben_mostgewicht_wert !== undefined && p.trauben_mostgewicht_wert !== ''
        ? mostgewichtAusWert(p.trauben_mostgewicht_wert, p.trauben_mostgewicht_einheit, nr)
        : mostgewichtAusWert(p.trauben_kmw_grad ?? null, 'kmw', nr)
      if (!mg.ok) throw new AktionsFehler(mg.fehler)
      mostgewichtJePosition[i] = mg.wert
    } else {
      mostgewichtJePosition[i] = null
    }
  })

  // Rechte wie RLS (Migration 218) – vorab, sonst bliebe ein Beleg ohne Abbuchung zurück
  pruefeVerkaufsRechte(membership, {
    tank: literJeCharge.size > 0,
    flasche: stueckJeFuellung.size > 0,
    vorgang: 'verkauf',
  })

  if (literJeCharge.size > 0) {
    const ids = [...literJeCharge.keys()]
    const { data, error } = await (supabase.from('weinausbau') as any)
      .select('id, name, menge_liter')
      .in('id', ids)
      .eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Bestand der Chargen konnte nicht geprüft werden'))
    const chargen = new Map(((data ?? []) as AR[]).map(w => [w.id as string, w]))
    for (const [id, bedarf] of literJeCharge) {
      const w = chargen.get(id)
      if (!w) throw new AktionsFehler('Eine ausgewählte Kellerbuch-Charge wurde nicht gefunden – bitte Seite neu laden.')
      const verfuegbar = Number(w.menge_liter ?? 0) || 0
      if (bedarf - verfuegbar >= LITER_TOLERANZ) {
        throw new AktionsFehler(
          `„${w.name}“: Menge (${fmtNum(bedarf)} L) überschreitet den verfügbaren Bestand (${fmtNum(verfuegbar)} L).`,
        )
      }
    }
  }

  if (stueckJeFuellung.size > 0) {
    const ids = [...stueckJeFuellung.keys()]
    const { data, error } = await (supabase.from('fuellungen') as any)
      .select('id, name, bestand_flaschen')
      .in('id', ids)
      .eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Flaschenbestand konnte nicht geprüft werden'))
    const fuellungen = new Map(((data ?? []) as AR[]).map(f => [f.id as string, f]))
    for (const [id, bedarf] of stueckJeFuellung) {
      const f = fuellungen.get(id)
      if (!f) throw new AktionsFehler('Eine ausgewählte Füllung wurde nicht gefunden – bitte Seite neu laden.')
      const verfuegbar = Number(f.bestand_flaschen ?? 0) || 0
      if (bedarf > verfuegbar) {
        throw new AktionsFehler(`„${f.name ?? 'Abfüllung'}“: nur noch ${fmtNum(verfuegbar)} Flaschen verfügbar, ${fmtNum(bedarf)} angefragt.`)
      }
    }
  }
  return { literJeCharge, stueckJeFuellung, mostgewichtJePosition }
}

/** Abgänge als negative Deltas (für bestandBuchenAllesOderNichts) */
function alsAbgang(m: Map<string, number>): Map<string, number> {
  return new Map([...m].map(([k, v]) => [k, -v]))
}

// ── Verkauf anlegen ───────────────────────────────────────────────────────────

// Reihenfolge (KAN-35): prüfen → Bestand abbuchen (alles oder nichts) → Rechnungsnummer →
// Posten → Positionen. Scheitert ein Schritt nach der Abbuchung, wird sie zurückgenommen;
// ein bereits angelegter Posten (Rechnungsnummer vergeben) wird sofort storniert. So bleibt
// weder ein Beleg ohne Abbuchung noch eine Abbuchung ohne Beleg zurück.
export async function createVerkauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const membership = await getMembership()
  const tenantId = membership.tenantId

  // Kopfdaten
  const datum               = (formData.get('datum') as string) || new Date().toISOString().split('T')[0]
  const rechnungsnummerInput = ((formData.get('rechnungsnummer') as string | null) ?? '').trim()
  const kontaktId      = (formData.get('kontakt_id') as string) || null
  const firmaId        = (formData.get('firma_id') as string) || null
  const zhKontaktId    = (formData.get('zh_kontakt_id') as string) || null
  const notizen        = (formData.get('notizen') as string) || null
  const skontoPct      = parseFloat(dezimal(formData.get('skonto_pct') as string)) || 0
  const skontoTage     = parseInt(dezimal(formData.get('skonto_tage') as string)) || 0
  const skontoAktiv    = formData.get('skonto_aktiv') === 'true'

  // Positionen als JSON aus hidden input
  const posJson = formData.get('positionen_json') as string
  let positionen: PositionInput[] = []
  try {
    positionen = JSON.parse(posJson || '[]')
  } catch {
    throw new AktionsFehler('Ungültige Positions-Daten')
  }

  if (!Array.isArray(positionen) || positionen.length === 0) {
    throw new AktionsFehler('Mindestens eine Position erforderlich')
  }

  // ── Prüfung VOR dem ersten Schreibzugriff (auch vor der Rechnungsnummer –
  //    eine Ablehnung hinterlässt so keine Lücke im Nummernkreis)
  const { literJeCharge, stueckJeFuellung, mostgewichtJePosition } = await pruefePositionen(supabase, membership, positionen)

  // ── 1. Bestand abbuchen – alles oder nichts (vor Rechnungsnummer und Beleg; eine
  //    gleichzeitige Buchung wird per Vergleichen und Setzen erkannt, dann nichts geändert)
  let abbuchungen: BestandsBuchung[]
  try {
    abbuchungen = await bestandBuchenAllesOderNichts(supabase, tenantId, alsAbgang(literJeCharge), alsAbgang(stueckJeFuellung))
  } catch (e) {
    throw new AktionsFehler(`Der Verkauf wurde nicht gespeichert: ${fehlerText(e).replace(/[.\s]+$/, '')}.`)
  }

  // Wenn keine Nummer eingetragen → automatisch generieren
  const rechnungsnummer = rechnungsnummerInput || await generateRechnungsnummer(tenantId)

  /** Abbuchung zurücknehmen und mit Hinweis werfen (Beleg konnte nicht angelegt werden) */
  const abbruch = async (meldung: string, postenStornieren: string | null): Promise<never> => {
    const teile: string[] = [meldung.replace(/[.\s]+$/, '')]
    if (postenStornieren) {
      try {
        await verkaufspostenStornieren(supabase, tenantId, postenStornieren)
        teile.push(`Der angelegte Beleg${rechnungsnummer ? ` ${rechnungsnummer}` : ''} wurde sofort storniert`)
      } catch (e) {
        teile.push(`Achtung: Der angelegte Beleg${rechnungsnummer ? ` ${rechnungsnummer}` : ''} konnte nicht storniert werden (${fehlerText(e).replace(/[.\s]+$/, '')}) – bitte unter Verkauf stornieren`)
      }
    }
    const rueckFehler = await bestandsBuchungenZuruecknehmen(supabase, tenantId, abbuchungen)
    teile.push(rueckFehler.length
      ? `Achtung: Der bereits abgebuchte Bestand konnte nicht zurückgesetzt werden (${rueckFehler.join(' · ')}) – bitte Bestand prüfen und Support kontaktieren`
      : 'Der Bestand ist unverändert')
    throw new AktionsFehler(`${teile.join('. ')}.`)
  }

  // Transaktionsnummer vergeben
  const { data: txnVk } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'verkauf' })

  // 2. Verkaufsposten anlegen (UUID selbst generieren)
  const postenId = randomUUID()
  const { error: postenErr } = await (supabase.from('verkaufsposten') as any).insert({
    id:              postenId,
    tenant_id:       tenantId,
    datum,
    rechnungsnummer,
    transaktions_nr: txnVk ?? null,
    kontakt_id:      kontaktId  || null,
    firma_id:        firmaId    || null,
    zh_kontakt_id:   zhKontaktId || null,
    notizen,
    skonto_pct:      skontoAktiv ? skontoPct : 0,
    skonto_tage:     skontoAktiv ? skontoTage : 0,
    skonto_aktiv:    skontoAktiv,
  })

  if (postenErr) await abbruch(dbFehlerText(postenErr, 'Speichern fehlgeschlagen (verkaufsposten)'), null)

  // 3. Positionen anlegen (bei Trauben: vorher BKI-Record anlegen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posInserts: any[] = []
  for (const [i, p] of positionen.entries()) {
    let traubenverkaufId: string | null = null

    if (p.typ === 'trauben') {
      // Liefernummer auto-generieren
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: lnData } = await (supabase.rpc as any)('get_next_liefernummer', { p_tenant_id: tenantId })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: tv, error: tvErr } = await (supabase.from('traubenverkauf') as any)
        .insert({
          tenant_id:       tenantId,
          weingarten_id:   p.trauben_weingarten_id   ?? null,
          jahrgang_id:     p.trauben_jahrgang_id      ?? null,
          grundstueck_id:  p.trauben_grundstueck_id   ?? null,
          kontakt_id:      kontaktId,
          firma_id:        firmaId,
          datum,
          menge_kg:        p.menge,
          preis_per_kg:    p.preis_brutto,
          ...mostgewichtSpalten(mostgewichtJePosition[i] ?? null, 'kmw_grad'),
          qualitaetsstufe: p.trauben_qualitaetsstufe  ?? null,
          herkunft_code:   p.trauben_herkunft_code    ?? null,
          gesundheit:      p.trauben_gesundheit       ?? 'G',
          liefernummer:    (lnData as string | null)  ?? null,
          verkaufsposten_id: postenId,
        })
        .select('id')
        .single()
      if (tvErr || !(tv as AR | null)?.id) {
        await abbruch(dbFehlerText(tvErr, 'Speichern fehlgeschlagen (traubenverkauf)'), postenId)
      }
      traubenverkaufId = (tv as AR).id as string
    }

    // Bezug je Typ: Flasche → Füllung, Tank → Charge. zukauf_id/pressung_behaelter_id
    // werden nicht mehr geschrieben (KAN-35, Tankverkauf nur aus Chargen).
    posInserts.push({
      tenant_id:             tenantId,
      verkaufsposten_id:     postenId,
      typ:                   p.typ,
      fuellung_id:           p.typ === 'flasche' ? (p.fuellung_id   || null) : null,
      weinausbau_id:         p.typ === 'tank'    ? (p.weinausbau_id || null) : null,
      traubenverkauf_id:     traubenverkaufId,
      name:                  p.name,
      menge:                 p.menge,
      einheit:               p.einheit || 'Stk',
      preis_brutto:          p.preis_brutto ?? null,
      rabatt_pct:            p.rabatt_pct ?? 0,
      sonderrabatt_pct:      p.sonderrabatt_pct ?? 0,
      ust_satz:              p.ust_satz ?? 13,
    })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: posErr } = await (supabase.from('verkauf_positionen') as any).insert(posInserts)
  // Insert mehrerer Zeilen ist eine Anweisung: entweder alle Positionen oder keine
  if (posErr) await abbruch(dbFehlerText(posErr, 'Speichern fehlgeschlagen (verkauf_positionen)'), postenId)

  // Ab hier ist der Verkauf vollständig gebucht – Folgeschritte (CRM, Lead-Status) dürfen
  // nicht mehr als Fehler zurückkommen, sonst speichert ein erneutes Absenden doppelt.

  // 4. CRM Aktivität auto-loggen (wenn Kontakt oder Firma angegeben)
  if (kontaktId || firmaId) {
    try {
      const gesamtBetrag = positionen.reduce((s, p) => {
        const brutto = (p.preis_brutto ?? 0) * p.menge
        const rabatt = (p.rabatt_pct ?? 0) / 100
        const sonder = (p.sonderrabatt_pct ?? 0) / 100
        return s + brutto * (1 - rabatt) * (1 - sonder)
      }, 0)
      const betreff = [
        rechnungsnummer ? `Verkauf ${rechnungsnummer}` : 'Verkauf',
        gesamtBetrag > 0
          ? fmtEur(gesamtBetrag)
          : null,
      ].filter(Boolean).join(' · ')

      const { data: { user } } = await supabase.auth.getUser()
      { const { error: e } = await (supabase.from('aktivitaeten') as any).insert({
        tenant_id:    tenantId,
        kontakt_id:   kontaktId  || null,
        firma_id:     firmaId    || null,
        art:          'verkauf',
        betreff,
        beschreibung: `Verkaufsposten: ${postenId}`,
        datum:        datum,
        erledigt:     true,
        erstellt_von: user?.id ?? null,
      })
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (aktivitaeten): ${e.message}`) }
    } catch {
      // CRM-Fehler nicht auf Verkauf durchschlagen
    }
  }

  // Lead → Kunde automatisch umstellen nach erstem Verkauf (nicht kritisch: der Verkauf
  // ist gespeichert; ohne CRM-Freigabe filtert RLS das Update ohnehin still)
  if (kontaktId) {
    { const { error: e } = await (supabase.from('kontakte') as any)
      .update({ is_lead: false })
      .eq('id', kontaktId)
      .eq('tenant_id', tenantId)
      .eq('is_lead', true)  // nur wenn noch Lead
      if (e) console.error('createVerkauf – Lead-Status (kontakte):', dbFehlerText(e)) }
  }
  if (firmaId) {
    { const { error: e } = await (supabase.from('firmen') as any)
      .update({ is_lead: false })
      .eq('id', firmaId)
      .eq('tenant_id', tenantId)
      .eq('is_lead', true)
      if (e) console.error('createVerkauf – Lead-Status (firmen):', dbFehlerText(e)) }
  }

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel')
  revalidatePath('/kellerbuch')
  revalidatePath('/crm/kontakte')
  revalidatePath('/crm/firmen')

  return { id: postenId }
}

// ── Verkauf deaktivieren – abgeschafft (KAN-35) ───────────────────────────────
// „Löschen ohne Bestandskorrektur“ ließ die Ware als abgegangen stehen, während der
// Beleg aus allen Listen, Umsätzen und der E&A verschwand. Verkäufe werden seit
// KAN-35 nur noch storniert (stornoVerkauf: Bestand zurück, Beleg bleibt als storniert
// sichtbar). Die Action bleibt als harte Ablehnung bestehen, damit ältere, noch
// geöffnete Seiten eine verständliche Meldung statt „Server Action not found“ bekommen.

// schreibsperre-ausnahme: lehnt immer ab (Verkäufe werden storniert, nicht gelöscht) – schreibt nichts
export async function deactivateVerkauf(id: string): Promise<never> {
  void id
  throw new AktionsFehler(
    'Verkäufe werden storniert, nicht gelöscht: Bitte „Stornieren“ verwenden – der Bestand wird dabei zurückgebucht und der Beleg bleibt als storniert erhalten.',
  )
}

// ── Verkauf stornieren (mit Bestandsrückbuchung) ──────────────────────────────
// Logik in lib/verkauf/bestand.ts (auch vom Traubenverkauf genutzt): Rechte vorab
// (Tank braucht Kellerbuch/Rieden), zuerst Rückbuchung (alles oder nichts, abgeschlossene
// Chargen werden wieder aktiv), dann Kennzeichen nur bei storniert = false (sonst wird die
// Rückbuchung zurückgenommen). Zukauf-/Pressungsmengen bleiben unverändert.

export async function stornoVerkauf(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  try {
    await verkaufspostenStornieren(supabase, tenantId, id)
  } finally {
    revalidatePath('/weinhandel/verkauf')
    revalidatePath(`/weinhandel/verkauf/${id}`)
    revalidatePath('/weinhandel')
    revalidatePath('/weinhandel/traubenverkauf')
    revalidatePath('/buchhaltung')
    revalidatePath('/crm')
    revalidatePath('/crm/kontakte/[id]', 'page')
    revalidatePath('/crm/firmen/[id]', 'page')
  }
}

// ── Verkauf als bezahlt markieren ─────────────────────────────────────────────
//
// Erfasst den noch offenen Restbetrag als Zahlung in der zahlungen-Tabelle
// (statt bezahlt direkt zu setzen) – dadurch bleibt die Zahlungsübersicht auf
// der Verkaufs-Detailseite konsistent, der bestehende DB-Trigger
// sync_verkaufsposten_bezahlt() setzt bezahlt/bezahlt_am automatisch, und die
// E&A-Synchronisierung (Punkt 7) greift wie bei jeder anderen Zahlung.

// KAN-149 Nebenbefund 2: Die Zahlung ist zu diesem Zeitpunkt schon gespeichert. Scheitert die
// abgeleitete E&A-Einnahme, muss das sichtbar sein – bisher wurde das Ergebnis ignoriert und die
// Einnahme fehlte still in der E&A-Rechnung und der UVA.
function eaErgebnisPruefen(ea: { ok: boolean; error?: string }): void {
  if (!ea.ok) {
    const grund = (ea.error ?? 'unbekannter Fehler').replace(/[.\s]+$/, '')
    throw new AktionsFehler(`Die Zahlung ist gespeichert, die Einnahme in der E&A-Rechnung aber nicht aktualisiert: ${grund}. Bitte erneut speichern oder in der E&A-Rechnung prüfen.`)
  }
}

export async function markiereAlsBezahlt(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const { data: postenRaw } = await (supabase.from('verkaufsposten') as any)
    .select('rechnungsnummer, positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .single()
  const posten = postenRaw as AR | null
  const positionen = (posten?.positionen ?? []) as AR[]
  const gesamt = positionen.reduce((s: number, p: AR) => {
    if (p.preis_brutto == null) return s
    const brutto = Number(p.preis_brutto) * Number(p.menge)
    const rabatt = Number(p.rabatt_pct ?? 0) / 100
    const sonder = Number(p.sonderrabatt_pct ?? 0) / 100
    return s + brutto * (1 - rabatt) * (1 - sonder)
  }, 0)

  const { data: zahlungenRaw } = await (supabase.from('zahlungen') as any)
    .select('betrag')
    .eq('verkaufsposten_id', id)
    .eq('tenant_id', tenantId)
  const bereitsBezahlt = ((zahlungenRaw ?? []) as AR[]).reduce((s, z) => s + Number(z.betrag ?? 0), 0)
  const offen = gesamt - bereitsBezahlt

  if (offen > 0.01) {
    const { error } = await (supabase.from('zahlungen') as any).insert({
      tenant_id: tenantId,
      verkaufsposten_id: id,
      betrag: Math.round(offen * 100) / 100,
      art: 'sonstig',
      datum: new Date().toISOString().slice(0, 10),
      notizen: 'Als bezahlt markiert',
    })
    if (error) throw new AktionsFehler(dbFehlerText(error))
  }

  // CRM-Aktivität aktualisieren
  try {
    const re = posten?.rechnungsnummer
    { const { error: e } = await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${re ?? ''} · Bezahlt` })
      .eq('beschreibung', `Verkaufsposten: ${id}`)
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (aktivitaeten): ${e.message}`) }
  } catch { /* nicht kritisch */ }

  const ea = await syncEaEinnahmeFuerVerkauf(id)

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath(`/weinhandel/verkauf/${id}`)
  revalidatePath('/buchhaltung')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
  eaErgebnisPruefen(ea)
}

// ── Sonstiges-Artikel speichern ───────────────────────────────────────────────

export interface SonstigesArtikelData {
  id: string
  name: string
  einheit: string
  default_preis: number | null
}

export async function createSonstigesArtikel(
  name: string,
  einheit: string,
  defaultPreis: number | null,
): Promise<SonstigesArtikelData | null> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const { data, error } = await (supabase.from('sonstige_artikel') as any)
    .insert({ tenant_id: tenantId, name: name.trim(), einheit, default_preis: defaultPreis ?? null })
    .select('id, name, einheit, default_preis')
    .single()

  if (error) throw new AktionsFehler(dbFehlerText(error))
  return data as SonstigesArtikelData
}

// ── Zahlungen ─────────────────────────────────────────────────────────────────
export async function createZahlung(
  verkaufspostenId: string,
  formData: FormData
): Promise<void> {
  'use server'
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const betrag   = parseFloat(dezimal((formData.get('betrag') as string || '')))
  const art      = formData.get('art') as string
  const datum    = formData.get('datum') as string
  const notizen  = (formData.get('notizen') as string) || null
  const konto_id = (formData.get('konto_id') as string) || null
  if (isNaN(betrag) || betrag <= 0) throw new AktionsFehler('Ungültiger Betrag')
  const { error } = await (supabase.from('zahlungen') as any).insert({
    tenant_id: tenantId,
    verkaufsposten_id: verkaufspostenId,
    betrag,
    art,
    datum: datum || new Date().toISOString().slice(0, 10),
    notizen, konto_id,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error))

  const ea = await syncEaEinnahmeFuerVerkauf(verkaufspostenId)

  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}`)
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath('/buchhaltung')
  eaErgebnisPruefen(ea)
}

export async function deleteZahlung(
  zahlungId: string,
  verkaufspostenId: string
): Promise<void> {
  'use server'
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('zahlungen') as any).delete().eq('id', zahlungId).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(dbFehlerText(error))

  const ea = await syncEaEinnahmeFuerVerkauf(verkaufspostenId)

  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}`)
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath('/buchhaltung')
  eaErgebnisPruefen(ea)
}
