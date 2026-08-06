'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { randomUUID } from 'crypto'
import { syncEaEinnahmeFuerVerkauf } from '@/app/(dashboard)/buchhaltung/actions'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const supabase = await createSupabaseServerClient()
  const { data } = await (supabase.from('tenant_memberships') as any).select('tenant_id').limit(1).single()
  const id = (data as AR | null)?.tenant_id
  if (!id) throw new Error('Kein Betrieb gefunden')
  return id
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
interface PositionInput {
  typ:               'flasche' | 'tank' | 'sonstiges' | 'trauben'
  fuellung_id:       string | null
  weinausbau_id:     string | null
  zukauf_id:             string | null
  pressung_behaelter_id: string | null
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
  trauben_kmw_grad?:        number | null
  trauben_qualitaetsstufe?: string | null
  trauben_herkunft_code?:   string | null
  trauben_gesundheit?:      'G' | 'K'
}

// ── Verkauf anlegen ───────────────────────────────────────────────────────────

export async function createVerkauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  // Kopfdaten
  const datum               = (formData.get('datum') as string) || new Date().toISOString().split('T')[0]
  const rechnungsnummerInput = (formData.get('rechnungsnummer') as string).trim()
  // Wenn keine Nummer eingetragen → automatisch generieren
  const rechnungsnummer = rechnungsnummerInput || await generateRechnungsnummer(tenantId)
  const kontaktId      = (formData.get('kontakt_id') as string) || null
  const firmaId        = (formData.get('firma_id') as string) || null
  const zhKontaktId    = (formData.get('zh_kontakt_id') as string) || null
  const notizen        = (formData.get('notizen') as string) || null
  const skontoPct      = parseFloat(formData.get('skonto_pct') as string) || 0
  const skontoTage     = parseInt(formData.get('skonto_tage') as string) || 0
  const skontoAktiv    = formData.get('skonto_aktiv') === 'true'

  // Positionen als JSON aus hidden input
  const posJson = formData.get('positionen_json') as string
  let positionen: PositionInput[] = []
  try {
    positionen = JSON.parse(posJson || '[]')
  } catch {
    throw new Error('Ungültige Positions-Daten')
  }

  if (positionen.length === 0) {
    throw new Error('Mindestens eine Position erforderlich')
  }

  // ── Bestandspruefung VOR dem Anlegen ─────────────────────────────────────────
  // Bugreport 6.8.2026: eine Kellerbuch-Charge mit bereits 0 L Bestand liess sich
  // trotzdem "verkaufen" - der Bestand fiel dabei unbemerkt ins Negative, weil
  // Schritt 3 (Bestand reduzieren) das Ergebnis nur nachtraeglich bei 0 kappt
  // (Math.max(0, ...)), statt die Buchung vorher abzulehnen. Bricht die gesamte
  // Buchung jetzt VOR dem Anlegen von Verkaufsposten/Positionen ab, wenn eine
  // Position mehr verkauft als tatsaechlich verfuegbar ist (gleiche
  // Toleranz/Logik wie beim Umziehen, siehe kellerbuch/umziehen/actions.ts).
  for (const p of positionen) {
    if (p.typ === 'flasche' && p.fuellung_id) {
      const { data: f } = await (supabase.from('fuellungen') as any)
        .select('name, bestand_flaschen').eq('id', p.fuellung_id).single()
      const verfuegbar = (f as AR | null)?.bestand_flaschen ?? 0
      if (Math.round(p.menge) > verfuegbar) {
        throw new Error(
          `„${(f as AR | null)?.name ?? 'Abfüllung'}": nur noch ${verfuegbar} Flaschen verfügbar, ${Math.round(p.menge)} angefragt.`
        )
      }
    } else if (p.typ === 'tank' && p.weinausbau_id) {
      const { data: w } = await (supabase.from('weinausbau') as any)
        .select('name, menge_liter').eq('id', p.weinausbau_id).single()
      const verfuegbar = parseFloat((w as AR | null)?.menge_liter ?? '0') || 0
      if (p.menge > verfuegbar + 0.01) {
        throw new Error(
          `„${(w as AR | null)?.name ?? 'Charge'}": Menge (${p.menge.toLocaleString('de-AT')} L) überschreitet verfügbaren Bestand (${verfuegbar.toLocaleString('de-AT')} L).`
        )
      }
    } else if (p.typ === 'tank' && p.zukauf_id) {
      const { data: zk } = await (supabase.from('zukauf_posten') as any)
        .select('rebsorte, menge').eq('id', p.zukauf_id).single()
      const verfuegbar = parseFloat((zk as AR | null)?.menge ?? '0') || 0
      if (p.menge > verfuegbar + 0.01) {
        throw new Error(
          `„${(zk as AR | null)?.rebsorte ?? 'Zukauf'}": Menge (${p.menge.toLocaleString('de-AT')} L) überschreitet verfügbaren Zukauf-Bestand (${verfuegbar.toLocaleString('de-AT')} L).`
        )
      }
    } else if (p.typ === 'tank' && p.pressung_behaelter_id) {
      const { data: pb } = await (supabase.from('pressung_behaelter') as any)
        .select('menge_liter').eq('id', p.pressung_behaelter_id).single()
      const verfuegbar = parseFloat((pb as AR | null)?.menge_liter ?? '0') || 0
      if (p.menge > verfuegbar + 0.01) {
        throw new Error(
          `Pressung: Menge (${p.menge.toLocaleString('de-AT')} L) überschreitet verfügbaren Bestand (${verfuegbar.toLocaleString('de-AT')} L).`
        )
      }
    }
  }

  // Transaktionsnummer vergeben
  const { data: txnVk } = await (supabase.rpc as any)('get_next_transaktionsnr', { p_tenant_id: tenantId, p_typ: 'verkauf' })

  // 1. Verkaufsposten anlegen (UUID selbst generieren)
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

  if (postenErr) throw new Error((postenErr as AR).message)

  // 2. Positionen anlegen (bei Trauben: vorher BKI-Record anlegen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const posInserts: any[] = []
  for (const p of positionen) {
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
          kmw_grad:        p.trauben_kmw_grad         ?? null,
          qualitaetsstufe: p.trauben_qualitaetsstufe  ?? null,
          herkunft_code:   p.trauben_herkunft_code    ?? null,
          gesundheit:      p.trauben_gesundheit       ?? 'G',
          liefernummer:    (lnData as string | null)  ?? null,
          verkaufsposten_id: postenId,
        })
        .select('id')
        .single()
      if (tvErr) throw new Error((tvErr as AR).message)
      traubenverkaufId = (tv as AR).id as string
    }

    posInserts.push({
      tenant_id:             tenantId,
      verkaufsposten_id:     postenId,
      typ:                   p.typ,
      fuellung_id:           p.fuellung_id            || null,
      weinausbau_id:         p.weinausbau_id          || null,
      zukauf_id:             p.zukauf_id              || null,
      pressung_behaelter_id: p.pressung_behaelter_id  || null,
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
  if (posErr) throw new Error((posErr as AR).message)

  // 3. Bestand reduzieren
  for (const p of positionen) {
    if (p.typ === 'flasche' && p.fuellung_id) {
      // bestand_flaschen dekrementieren
      const { data: fuellung } = await (supabase.from('fuellungen') as any)
        .select('bestand_flaschen')
        .eq('id', p.fuellung_id)
        .single()
      const aktuell = (fuellung as AR | null)?.bestand_flaschen ?? 0
      const neu = Math.max(0, aktuell - Math.round(p.menge))
      await (supabase.from('fuellungen') as any)
        .update({ bestand_flaschen: neu, aktualisiert_am: new Date().toISOString() })
        .eq('id', p.fuellung_id)
    } else if (p.typ === 'tank' && p.weinausbau_id) {
      // menge_liter in Kellerbuch-Charge dekrementieren
      const { data: wein } = await (supabase.from('weinausbau') as any)
        .select('menge_liter')
        .eq('id', p.weinausbau_id)
        .single()
      const aktuell = parseFloat((wein as AR | null)?.menge_liter ?? '0') || 0
      const neu = Math.max(0, aktuell - p.menge)
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: neu })
        .eq('id', p.weinausbau_id)
    } else if (p.typ === 'tank' && p.zukauf_id) {
      // menge in Zukauf-Posten dekrementieren
      const { data: zk } = await (supabase.from('zukauf_posten') as any)
        .select('menge')
        .eq('id', p.zukauf_id)
        .single()
      const aktuell = parseFloat((zk as AR | null)?.menge ?? '0') || 0
      const neu = Math.max(0, aktuell - p.menge)
      await (supabase.from('zukauf_posten') as any)
        .update({ menge: neu })
        .eq('id', p.zukauf_id)
    } else if (p.typ === 'tank' && p.pressung_behaelter_id) {
      const { data: pb } = await (supabase.from('pressung_behaelter') as any)
        .select('menge_liter').eq('id', p.pressung_behaelter_id).single()
      const aktuell = parseFloat((pb as AR | null)?.menge_liter ?? '0') || 0
      const neu = Math.max(0, aktuell - p.menge)
      await (supabase.from('pressung_behaelter') as any)
        .update({ menge_liter: neu }).eq('id', p.pressung_behaelter_id)
    }
  }

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
          ? gesamtBetrag.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
          : null,
      ].filter(Boolean).join(' · ')

      const { data: { user } } = await supabase.auth.getUser()
      await (supabase.from('aktivitaeten') as any).insert({
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
    } catch {
      // CRM-Fehler nicht auf Verkauf durchschlagen
    }
  }

  // Lead → Kunde automatisch umstellen nach erstem Verkauf
  if (kontaktId) {
    await (supabase.from('kontakte') as any)
      .update({ is_lead: false })
      .eq('id', kontaktId)
      .eq('is_lead', true)  // nur wenn noch Lead
  }
  if (firmaId) {
    await (supabase.from('firmen') as any)
      .update({ is_lead: false })
      .eq('id', firmaId)
      .eq('is_lead', true)
  }

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/crm/kontakte')
  revalidatePath('/crm/firmen')
  return { id: postenId }
}

// ── Verkauf deaktivieren ──────────────────────────────────────────────────────

export async function deactivateVerkauf(id: string) {
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('verkaufsposten') as any)
    .update({ aktiv: false, aktualisiert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)

  // Verknüpfte, nicht gesperrte E&A-Einnahmebuchungen entfernen
  await (supabase.from('ea_transaktionen') as any)
    .delete()
    .eq('verkaufsposten_id', id)
    .eq('is_locked', false)

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/buchhaltung')
  redirect('/weinhandel/verkauf')
}

// ── Verkauf stornieren (mit Bestandsrückbuchung) ──────────────────────────────

export async function stornoVerkauf(id: string) {
  const supabase = await createSupabaseServerClient()

  // Positionen laden für Rückbuchung
  const { data: posRaw } = await (supabase.from('verkauf_positionen') as any)
    .select('typ, fuellung_id, weinausbau_id, zukauf_id, pressung_behaelter_id, menge, traubenverkauf_id')
    .eq('verkaufsposten_id', id)

  const positionen = (posRaw ?? []) as AR[]

  // Bestand zurückbuchen
  for (const p of positionen) {
    if (p.typ === 'flasche' && p.fuellung_id) {
      const { data: f } = await (supabase.from('fuellungen') as any)
        .select('bestand_flaschen').eq('id', p.fuellung_id).single()
      const aktuell = (f as AR | null)?.bestand_flaschen ?? 0
      await (supabase.from('fuellungen') as any)
        .update({ bestand_flaschen: aktuell + Math.round(p.menge), aktualisiert_am: new Date().toISOString() })
        .eq('id', p.fuellung_id)
    } else if (p.typ === 'tank' && p.weinausbau_id) {
      const { data: w } = await (supabase.from('weinausbau') as any)
        .select('menge_liter').eq('id', p.weinausbau_id).single()
      const aktuell = parseFloat((w as AR | null)?.menge_liter ?? '0') || 0
      await (supabase.from('weinausbau') as any)
        .update({ menge_liter: aktuell + p.menge })
        .eq('id', p.weinausbau_id)
    } else if (p.typ === 'tank' && p.zukauf_id) {
      const { data: zk } = await (supabase.from('zukauf_posten') as any)
        .select('menge').eq('id', p.zukauf_id).single()
      const aktuell = parseFloat((zk as AR | null)?.menge ?? '0') || 0
      await (supabase.from('zukauf_posten') as any)
        .update({ menge: aktuell + p.menge })
        .eq('id', p.zukauf_id)
    } else if (p.typ === 'tank' && p.pressung_behaelter_id) {
      const { data: pb } = await (supabase.from('pressung_behaelter') as any)
        .select('menge_liter').eq('id', p.pressung_behaelter_id).single()
      const aktuell = parseFloat((pb as AR | null)?.menge_liter ?? '0') || 0
      await (supabase.from('pressung_behaelter') as any)
        .update({ menge_liter: aktuell + p.menge }).eq('id', p.pressung_behaelter_id)
    }
  }

  // Traubenverkauf-Einträge löschen → gibt verfügbare kg wieder frei
  for (const p of positionen) {
    if (p.typ === 'trauben' && p.traubenverkauf_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase.from('traubenverkauf') as any)
        .delete()
        .eq('id', p.traubenverkauf_id)
    }
  }

  // Rechnungsnummer vorab lesen
  const { data: vorabStorno } = await (supabase.from('verkaufsposten') as any)
    .select('rechnungsnummer').eq('id', id).single()

  // Posten als storniert markieren
  const { error } = await (supabase.from('verkaufsposten') as any)
    .update({ storniert: true, storniert_am: new Date().toISOString() })
    .eq('id', id)
  if (error) throw new Error((error as AR).message)

  // Verknüpfte, nicht gesperrte E&A-Einnahmebuchungen entfernen – ein Storno
  // macht den zugehörigen Zahlungseingang ungültig.
  await (supabase.from('ea_transaktionen') as any)
    .delete()
    .eq('verkaufsposten_id', id)
    .eq('is_locked', false)

  // CRM-Aktivität auf STORNIERT setzen
  try {
    const re = (vorabStorno as AR | null)?.rechnungsnummer
    await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${re ?? ''} · STORNIERT` })
      .eq('beschreibung', `Verkaufsposten: ${id}`)
  } catch { /* nicht kritisch */ }

  revalidatePath('/weinhandel/verkauf')
  revalidatePath(`/weinhandel/verkauf/${id}`)
  revalidatePath('/buchhaltung')
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

// ── Verkauf als bezahlt markieren ─────────────────────────────────────────────
//
// Erfasst den noch offenen Restbetrag als Zahlung in der zahlungen-Tabelle
// (statt bezahlt direkt zu setzen) – dadurch bleibt die Zahlungsübersicht auf
// der Verkaufs-Detailseite konsistent, der bestehende DB-Trigger
// sync_verkaufsposten_bezahlt() setzt bezahlt/bezahlt_am automatisch, und die
// E&A-Synchronisierung (Punkt 7) greift wie bei jeder anderen Zahlung.

export async function markiereAlsBezahlt(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()

  const { data: postenRaw } = await (supabase.from('verkaufsposten') as any)
    .select('rechnungsnummer, positionen:verkauf_positionen(preis_brutto, menge, rabatt_pct, sonderrabatt_pct)')
    .eq('id', id)
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
    if (error) throw new Error((error as AR).message)
  }

  // CRM-Aktivität aktualisieren
  try {
    const re = posten?.rechnungsnummer
    await (supabase.from('aktivitaeten') as any)
      .update({ betreff: `Verkauf ${re ?? ''} · Bezahlt` })
      .eq('beschreibung', `Verkaufsposten: ${id}`)
  } catch { /* nicht kritisch */ }

  await syncEaEinnahmeFuerVerkauf(id)

  revalidatePath('/weinhandel/verkauf')
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath(`/weinhandel/verkauf/${id}`)
  revalidatePath('/buchhaltung')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
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

  if (error) throw new Error((error as AR).message)
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
  const betrag  = parseFloat((formData.get('betrag') as string || '').replace(',', '.'))
  const art     = formData.get('art') as string
  const datum   = formData.get('datum') as string
  const notizen = (formData.get('notizen') as string) || null
  if (isNaN(betrag) || betrag <= 0) throw new Error('Ungültiger Betrag')
  const { error } = await (supabase.from('zahlungen') as any).insert({
    tenant_id: tenantId,
    verkaufsposten_id: verkaufspostenId,
    betrag,
    art,
    datum: datum || new Date().toISOString().slice(0, 10),
    notizen,
  })
  if (error) throw new Error((error as AR).message)

  await syncEaEinnahmeFuerVerkauf(verkaufspostenId)

  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}`)
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath('/buchhaltung')
}

export async function deleteZahlung(
  zahlungId: string,
  verkaufspostenId: string
): Promise<void> {
  'use server'
  const supabase = await createSupabaseServerClient()
  const { error } = await (supabase.from('zahlungen') as any).delete().eq('id', zahlungId)
  if (error) throw new Error((error as AR).message)

  await syncEaEinnahmeFuerVerkauf(verkaufspostenId)

  revalidatePath(`/weinhandel/verkauf/${verkaufspostenId}`)
  revalidatePath('/weinhandel/offene-posten')
  revalidatePath('/buchhaltung')
}
