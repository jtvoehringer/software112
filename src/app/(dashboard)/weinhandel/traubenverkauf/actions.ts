'use server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { dezimal } from '@/lib/format'
import { verkaufspostenStornieren } from '@/lib/verkauf/bestand'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

// ── Hilfs-Funktion: Bezeichnung der Trauben-Quelle ermitteln ─────────────────
// Eigener Weingarten ODER zugekaufter Posten (siehe Migration 141) - genau
// einer der beiden Parameter ist gesetzt.

// schreibsperre-ausnahme: nur lesend – interner Helfer (Name der Trauben-Quelle), schreibt nichts
export async function ermittleQuellenName(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  weingartenId: string | null,
  zukaufPostenId: string | null,
  // Optional, um bestehende Aufrufer (z.B. erntemeldung/actions.ts) nicht zu brechen –
  // wird bei Übergabe zur zusätzlichen Mandanten-Eingrenzung verwendet (RLS erlaubt
  // sonst auch Datensätze anderer Mitgliedschafts-Mandanten des Users, siehe oben).
  tenantId?: string,
): Promise<string> {
  if (weingartenId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('weingarten') as any).select('name').eq('id', weingartenId)
    if (tenantId) q = q.eq('tenant_id', tenantId)
    const { data } = await q.single()
    return (data as AR | null)?.name as string ?? 'Weingarten'
  }
  if (zukaufPostenId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (supabase.from('zukauf_posten') as any)
      .select('rebsorte, lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname), lieferant_firma:firmen!lieferant_firma_id(name)')
      .eq('id', zukaufPostenId)
    if (tenantId) q = q.eq('tenant_id', tenantId)
    const { data } = await q.single()
    const z = data as AR | null
    const lieferant = z?.lieferant_kontakt
      ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
      : (z?.lieferant_firma?.name ?? null)
    return `Zukauf${z?.rebsorte ? ' – ' + formatRebsorteMitKuerzel(z.rebsorte) : ''}${lieferant ? ' (' + lieferant + ')' : ''}` || 'Zukauf'
  }
  return 'Trauben'
}

// ── Hilfs-Funktion: Verkaufsposten + Position für Traubenverkauf anlegen ─────

// schreibsperre-ausnahme: interner Helfer mit Supabase-Client als Parameter (vom Browser nicht sinnvoll aufrufbar) – die Aufrufer (upsertTraubenverkauf, erntemeldung) prüfen Betrieb und Schreibsperre vorher
export async function createVerkaufspostenFuerTrauben(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
  opts: {
    datum: string
    kontaktId: string | null
    firmaId: string | null
    weingartenName: string
    mengeKg: number
    preisPerKg: number | null
  }
): Promise<string> {
  // Rechnungsnummer auto-generieren
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rnData } = await (supabase.rpc as any)('get_next_rechnungsnummer', { p_tenant_id: tenantId })
  const rechnungsnummer = (rnData as string | null) ?? null

  const postenId = randomUUID()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: postenErr } = await (supabase.from('verkaufsposten') as any).insert({
    id:              postenId,
    tenant_id:       tenantId,
    datum:           opts.datum,
    rechnungsnummer,
    kontakt_id:      opts.kontaktId,
    firma_id:        opts.firmaId,
    notizen:         `Traubenverkauf – ${opts.weingartenName}`,
  })
  if (postenErr) throw new AktionsFehler(dbFehlerText(postenErr, 'Speichern fehlgeschlagen (verkaufsposten)'))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: posErr } = await (supabase.from('verkauf_positionen') as any).insert({
    tenant_id:         tenantId,
    verkaufsposten_id: postenId,
    typ:               'sonstiges',
    name:              `Weintrauben – ${opts.weingartenName}`,
    menge:             opts.mengeKg,
    einheit:           'kg',
    preis_brutto:      opts.preisPerKg,
    ust_satz:          13,
    rabatt_pct:        0,
    sonderrabatt_pct:  0,
  })
  if (posErr) throw new AktionsFehler(dbFehlerText(posErr, 'Speichern fehlgeschlagen (verkauf_positionen)'))

  return postenId
}

// ── Verkaufsposten + Position aktualisieren ───────────────────────────────────

// Vor dem Bearbeiten (KAN-35, vor jedem Schreibzugriff): Rechnung darf nicht storniert
// sein, und die Position dieses Traubenverkaufs muss eindeutig sein – Verkaufsformular →
// Position 'trauben' mit Verweis; Traubenverkauf/Erntemeldung → einzige Position
// 'sonstiges'. Früher wurde die erste beliebige Position der Rechnung überschrieben –
// bei einer Mischrechnung ggf. eine Flaschen- oder Tankposition. Liefert die Positions-ID
// (null: Rechnung ohne Positionen).
async function pruefeRechnungFuerTrauben(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  postenId: string,
  tenantId: string,
  traubenverkaufId: string,
): Promise<string | null> {
  const [postenRes, posRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('verkaufsposten') as any)
      .select('storniert')
      .eq('id', postenId)
      .eq('tenant_id', tenantId)
      .maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('verkauf_positionen') as any)
      .select('id, typ, traubenverkauf_id')
      .eq('verkaufsposten_id', postenId)
      .eq('tenant_id', tenantId),
  ])
  if (postenRes.error) throw new AktionsFehler(dbFehlerText(postenRes.error, 'Rechnung zum Traubenverkauf konnte nicht geladen werden'))
  if (posRes.error) throw new AktionsFehler(dbFehlerText(posRes.error, 'Rechnungspositionen konnten nicht geladen werden'))
  if ((postenRes.data as AR | null)?.storniert) {
    throw new AktionsFehler('Die Rechnung zu diesem Traubenverkauf ist storniert und kann nicht mehr geändert werden. Bitte den Traubenverkauf löschen und neu erfassen.')
  }
  const positionen = (posRes.data ?? []) as AR[]
  const pos = positionen.find(p => p.traubenverkauf_id === traubenverkaufId)
    ?? (positionen.length === 1 && positionen[0].typ === 'sonstiges' ? positionen[0] : null)
  if (!pos && positionen.length > 0) {
    throw new AktionsFehler('Die Rechnungsposition zu diesem Traubenverkauf ist nicht eindeutig – bitte den Verkauf unter Weinhandel › Verkauf stornieren und neu erfassen.')
  }
  return (pos?.id as string | undefined) ?? null
}

async function updateVerkaufspostenFuerTrauben(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  postenId: string,
  tenantId: string,
  posId: string | null,
  opts: {
    datum: string
    kontaktId: string | null
    firmaId: string | null
    weingartenName: string
    mengeKg: number
    preisPerKg: number | null
  }
) {
  // Zeilen zählen: ein per RLS still gefiltertes Update (ohne Freigabe Warenwirtschaft) ließe
  // die Rechnung sonst unbemerkt auf dem alten Stand
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { const { data: d, error: e } = await (supabase.from('verkaufsposten') as any)
    .update({ datum: opts.datum, kontakt_id: opts.kontaktId, firma_id: opts.firmaId })
    .eq('id', postenId)
    .eq('tenant_id', tenantId)
    .select('id')
    if (e) throw new AktionsFehler(dbFehlerText(e, 'Speichern fehlgeschlagen (verkaufsposten)'))
    if (!(d as AR[] | null)?.length) throw new AktionsFehler('Der Traubenverkauf ist gespeichert, die Rechnung konnte aber nicht angepasst werden – keine Berechtigung für Verkäufe. Bitte die Rechnung unter Weinhandel › Verkauf prüfen.') }

  if (posId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { data: d, error: e } = await (supabase.from('verkauf_positionen') as any)
      .update({
        name:         `Weintrauben – ${opts.weingartenName}`,
        menge:        opts.mengeKg,
        preis_brutto: opts.preisPerKg,
      })
      .eq('id', posId)
      .eq('tenant_id', tenantId)
      .select('id')
      if (e) throw new AktionsFehler(dbFehlerText(e, 'Speichern fehlgeschlagen (verkauf_positionen)'))
      if (!(d as AR[] | null)?.length) throw new AktionsFehler('Der Traubenverkauf ist gespeichert, die Rechnungsposition konnte aber nicht angepasst werden – keine Berechtigung für Verkäufe. Bitte die Rechnung unter Weinhandel › Verkauf prüfen.') }
  }
}

// ── upsertTraubenverkauf ──────────────────────────────────────────────────────

export async function upsertTraubenverkauf(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Nicht angemeldet')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo

  const existing_id = formData.get('existing_id') as string | null
  const tenantId    = membership.tenantId

  function getNum(key: string): number | null {
    const val = formData.get(key) as string | null
    if (!val || val.trim() === '') return null
    return Number(dezimal(val))
  }

  const weingartenId  = (formData.get('weingarten_id') as string) || null
  const zukaufPostenId = (formData.get('zukauf_posten_id') as string) || null
  const kontaktId    = (formData.get('kontakt_id') as string) || null
  const firmaId      = (formData.get('firma_id') as string) || null
  const datum        = formData.get('datum') as string
  const mengeKg      = Number(dezimal((formData.get('menge_kg') as string)))
  const preisPerKg   = getNum('preis_per_kg')

  // Vor dem ersten Schreibzugriff prüfen (KAN-35): keine 0-/Negativ-Mengen
  if (!Number.isFinite(mengeKg) || mengeKg <= 0) {
    throw new AktionsFehler('Bitte eine Menge in kg größer als 0 angeben.')
  }

  // Bezeichnung der Quelle (eigener Weingarten ODER zugekaufter Posten) für die
  // Positionsbezeichnung im Verkaufsposten laden.
  const weingartenName = await ermittleQuellenName(supabase, weingartenId, zukaufPostenId, tenantId)

  const verkaufsOpts = { datum, kontaktId, firmaId, weingartenName, mengeKg, preisPerKg }

  const payload: AR = {
    tenant_id:       tenantId,
    weingarten_id:   weingartenId,
    zukauf_posten_id: zukaufPostenId,
    jahrgang_id:     (formData.get('jahrgang_id') as string) || null,
    grundstueck_id:  (formData.get('grundstueck_id') as string) || null,
    kontakt_id:      kontaktId,
    firma_id:        firmaId,
    datum,
    menge_kg:        mengeKg,
    preis_per_kg:    preisPerKg,
    kmw_grad:        getNum('kmw_grad'),
    qualitaetsstufe: (formData.get('qualitaetsstufe') as string) || null,
    herkunft_code:   (formData.get('herkunft_code') as string) || null,
    gesundheit:      (formData.get('gesundheit') as string) || 'G',
    notizen:         (formData.get('notizen') as string) || null,
    updated_at:      new Date().toISOString(),
  }

  if (existing_id) {
    // Bestehenden Traubenverkauf laden (für verkaufsposten_id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: tvAlt, error: tvAltErr } = await (supabase.from('traubenverkauf') as any)
      .select('verkaufsposten_id')
      .eq('id', existing_id)
      .eq('tenant_id', tenantId)
      .maybeSingle()
    if (tvAltErr) throw new AktionsFehler(dbFehlerText(tvAltErr, 'Traubenverkauf konnte nicht geladen werden'))
    if (!tvAlt) throw new AktionsFehler('Traubenverkauf nicht gefunden – bitte Seite neu laden.')
    const altPostenId = (tvAlt as AR | null)?.verkaufsposten_id as string | null

    // Stornierte Rechnung und nicht eindeutige Position vor jedem Schreibzugriff ablehnen
    const altPosId = altPostenId
      ? await pruefeRechnungFuerTrauben(supabase, altPostenId, tenantId, existing_id)
      : null
    // Die Rechnung wird mitgezogen (verkaufsposten/verkauf_positionen: Freigabe Warenwirtschaft) –
    // ohne diese Freigabe vorab ablehnen, sonst liefen Traubenverkauf und Rechnung still auseinander
    if (!canWrite(membership, 'warenwirtschaft')) {
      throw new AktionsFehler('Beim Ändern eines Traubenverkaufs wird die zugehörige Rechnung (Menge, Preis, Kunde) mit angepasst bzw. angelegt – das dürfen nur Betriebs-Manager und Mitarbeiter mit Freigabe Warenwirtschaft. Es wurde nichts geändert.')
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('traubenverkauf') as any)
      .update(payload)
      .eq('id', existing_id)
      .eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (traubenverkauf)'))

    if (altPostenId) {
      await updateVerkaufspostenFuerTrauben(supabase, altPostenId, tenantId, altPosId, verkaufsOpts)
    } else {
      const postenId = await createVerkaufspostenFuerTrauben(supabase, tenantId, verkaufsOpts)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { const { error: e } = await (supabase.from('traubenverkauf') as any)
        .update({ verkaufsposten_id: postenId })
        .eq('id', existing_id)
        .eq('tenant_id', tenantId)
        if (e) throw new AktionsFehler(dbFehlerText(e, 'Speichern fehlgeschlagen (traubenverkauf)')) }
    }
  } else {
    // Liefernummer bei Neuanlage auto-generieren
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: lnData } = await (supabase.rpc as any)('get_next_liefernummer', { p_tenant_id: tenantId })
    if (lnData) payload.liefernummer = lnData

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (supabase.from('traubenverkauf') as any)
      .insert(payload)
      .select('id')
      .single()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen (traubenverkauf)'))

    const newId    = (inserted as AR).id as string
    const postenId = await createVerkaufspostenFuerTrauben(supabase, tenantId, verkaufsOpts)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('traubenverkauf') as any)
      .update({ verkaufsposten_id: postenId })
      .eq('id', newId)
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(dbFehlerText(e, 'Speichern fehlgeschlagen (traubenverkauf)')) }
  }

  revalidatePath('/weinhandel/traubenverkauf')
  revalidatePath('/weinhandel/verkauf')
}

// ── deleteTraubenverkauf ──────────────────────────────────────────────────────
// KAN-35 (24.09.2026): Rechnung (verkaufsposten) und Positionen werden NIE mehr hart
// gelöscht – vorher blieb bei einem winzer (RLS: DELETE auf Verkäufe nur für Admins)
// still eine verwaiste, aktive Rechnung zurück. Hat der Traubenverkauf eine Rechnung,
// wird sie über den normalen Verkaufsstorno storniert (Beleg bleibt als storniert
// sichtbar, Rechnungsnummer lückenlos, E&A wie beim Storno); der Storno entfernt dabei
// auch die Traubenverkauf-Datensätze der Rechnung. Ohne Rechnung bzw. bei bereits
// stornierter Rechnung wird nur der Traubenverkauf gelöscht. Gehört der Traubenverkauf zu
// einer Rechnung mit weiteren Positionen (Verkaufsformular), wird abgelehnt – die wird nur
// als Ganzes unter Weinhandel › Verkauf storniert (gleiche Regel wie erntemeldung/actions.ts).
// Jede Löschung landet im bestandsprotokoll.

export async function deleteTraubenverkauf(id: string) {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Nicht angemeldet')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  const tenantId = membership.tenantId

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: tv, error: tvErr } = await (supabase.from('traubenverkauf') as any)
    .select('id, verkaufsposten_id')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (tvErr) throw new AktionsFehler(dbFehlerText(tvErr, 'Traubenverkauf konnte nicht geladen werden'))
  if (!tv) throw new AktionsFehler('Traubenverkauf nicht gefunden – bitte Seite neu laden.')
  const postenId = (tv as AR).verkaufsposten_id as string | null

  try {
    if (postenId) {
      const [postenRes, posRes] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('verkaufsposten') as any)
          .select('rechnungsnummer, storniert')
          .eq('id', postenId)
          .eq('tenant_id', tenantId)
          .maybeSingle(),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('verkauf_positionen') as any)
          .select('id, typ, traubenverkauf_id')
          .eq('verkaufsposten_id', postenId)
          .eq('tenant_id', tenantId),
      ])
      if (postenRes.error) throw new AktionsFehler(dbFehlerText(postenRes.error, 'Rechnung zum Traubenverkauf konnte nicht geladen werden'))
      if (posRes.error) throw new AktionsFehler(dbFehlerText(posRes.error, 'Rechnungspositionen konnten nicht geladen werden'))
      const posten = postenRes.data as AR | null
      if (posten && !posten.storniert) {
        // Nur stornieren, wenn die Rechnung ausschließlich diesen Traubenverkauf enthält
        // (Traubenverkauf/Erntemeldung: Position 'sonstiges' ohne Verweis; Verkaufsformular:
        // Position 'trauben' mit Verweis) – eine Mischrechnung wird nur als Ganzes storniert.
        const positionen = (posRes.data ?? []) as AR[]
        const nurDieserVerkauf = positionen.length <= 1 && positionen.every(p =>
          (p.typ === 'trauben' && p.traubenverkauf_id === id) || (p.typ === 'sonstiges' && !p.traubenverkauf_id))
        if (!nurDieserVerkauf) {
          throw new AktionsFehler(`Der Traubenverkauf gehört zur Rechnung ${posten.rechnungsnummer ?? '(ohne Nummer)'} mit weiteren Positionen und kann hier nicht gelöscht werden. Bitte den Verkauf unter Weinhandel › Verkauf stornieren.`)
        }
        // Storno der Rechnung – entfernt dabei auch diesen Traubenverkauf
        await verkaufspostenStornieren(supabase, tenantId, postenId)
      }
    }

    // Traubenverkauf löschen, falls der Storno ihn nicht schon entfernt hat
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: geloescht, error: delErr } = await (supabase.from('traubenverkauf') as any)
      .delete()
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .select('id')
    if (delErr) throw new AktionsFehler(dbFehlerText(delErr, 'Traubenverkauf konnte nicht gelöscht werden'))
    if (!((geloescht ?? []) as AR[]).length) {
      // 0 Zeilen: entweder schon durch den Storno gelöscht (gut) oder RLS hat still nichts gelöscht
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: noch, error: nochErr } = await (supabase.from('traubenverkauf') as any)
        .select('id')
        .eq('id', id)
        .eq('tenant_id', tenantId)
        .maybeSingle()
      if (nochErr) throw new AktionsFehler(dbFehlerText(nochErr, 'Traubenverkauf konnte nicht geprüft werden'))
      if (noch) {
        throw new AktionsFehler('Der Traubenverkauf konnte nicht gelöscht werden – keine Löschberechtigung (Schreibrecht Warenwirtschaft bzw. Rieden)?')
      }
    }
  } finally {
    revalidatePath('/weinhandel/traubenverkauf')
    revalidatePath('/weinhandel/verkauf')
    if (postenId) revalidatePath(`/weinhandel/verkauf/${postenId}`)
    revalidatePath('/weinhandel')
    revalidatePath('/buchhaltung')
    revalidatePath('/erntemeldung/[id]', 'page')
  }
}
