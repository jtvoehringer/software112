'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { revalidatePath } from 'next/cache'
import { AktionsFehler } from '@/lib/fehler'
import { dezimal } from '@/lib/format'

// Fehler der Datenbank (z.B. RLS) werden seit 20.9.2026 geworfen statt verschluckt -
// vorher verschwanden abgelehnte Buchungen ohne Hinweis (PSM-Anfangsbestände Gebeshuber).

// Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
// beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
// Daten eines anderen Betriebs als des gerade ausgewählten angezeigt/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

export async function upsertLagerBewegung(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const tenantId = await getTenantId()

  const existingId = fd.get('existing_id') as string | null
  const mengeRaw = parseFloat(dezimal((fd.get('menge') as string) ?? '0'))
  const richtung = fd.get('richtung') as string // 'eingang' | 'ausgang'
  const menge = richtung === 'ausgang' ? -Math.abs(mengeRaw) : Math.abs(mengeRaw)

  const payload = {
    tenant_id: tenantId,
    psm_id:    fd.get('psm_id') as string,
    datum:     fd.get('datum') as string,
    typ:       fd.get('typ') as string,
    menge,
    einheit:   fd.get('einheit') as string || null,
    notizen:   (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('psm_lager_bewegungen') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('psm_lager_bewegungen') as any).insert(payload)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  }

  revalidatePath('/behandlungen/lager')
}

export async function deleteLagerBewegung(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('psm_lager_bewegungen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(`Löschen fehlgeschlagen: ${error.message}`)
  revalidatePath('/behandlungen/lager')
}

// ── Düngemittel-Lagerbewegungen (Migration 142, analog PSM-Lager oben) ────────

export async function upsertDuengerBewegung(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const tenantId = await getTenantId()

  const existingId = fd.get('existing_id') as string | null
  const mengeRaw = parseFloat(dezimal((fd.get('menge') as string) ?? '0'))
  const richtung = fd.get('richtung') as string // 'eingang' | 'ausgang'
  const menge = richtung === 'ausgang' ? -Math.abs(mengeRaw) : Math.abs(mengeRaw)

  const payload = {
    tenant_id:       tenantId,
    duengemittel_id: fd.get('duengemittel_id') as string,
    datum:           fd.get('datum') as string,
    typ:             fd.get('typ') as string,
    menge,
    einheit:         fd.get('einheit') as string || null,
    notizen:         (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('duengemittel_lager_bewegungen') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('duengemittel_lager_bewegungen') as any).insert(payload)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  }

  revalidatePath('/behandlungen/lager')
}

export async function deleteDuengerBewegung(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('duengemittel_lager_bewegungen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(`Löschen fehlgeschlagen: ${error.message}`)
  revalidatePath('/behandlungen/lager')
}

// ── PSM-Stammdaten (vormals /pflanzenschutz, jetzt Teil der Betriebsmittel-Lagerverwaltung) ────────

export async function upsertPSM(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const tenantId = await getTenantId()

  const existingId = fd.get('existing_id') as string | null

  const payload = {
    tenant_id:          tenantId,
    name:               fd.get('name') as string,
    handelsname:        (fd.get('handelsname') as string) || null,
    wirkstoff:          (fd.get('wirkstoff') as string) || null,
    wirkstoffgehalt_pct: parseFloat(dezimal(fd.get('wirkstoffgehalt_pct') as string)) || null,
    cu_gehalt_pct:      parseFloat(dezimal(fd.get('cu_gehalt_pct') as string)) || null,
    kategorie:          (fd.get('kategorie') as string) || null,
    wartezeit_tage:     parseInt(fd.get('wartezeit_tage') as string) || null,
    max_aufwand_kg_ha:  parseFloat(dezimal(fd.get('max_aufwand_kg_ha') as string)) || null,
    max_anwendungen:    parseInt(fd.get('max_anwendungen') as string) || null,
    oeko_zugelassen:    fd.get('oeko_zugelassen') === 'true',
    aktiv:              true,
    notizen:            (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('pflanzenschutzmittel') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('pflanzenschutzmittel') as any).insert(payload)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  }

  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
  revalidatePath('/behandlungen/berichte')
}

export async function deactivatePSM(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('pflanzenschutzmittel') as any)
    .update({ aktiv: false }).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(`Deaktivieren fehlgeschlagen: ${error.message}`)
  revalidatePath('/behandlungen/lager')
}

// ── Düngemittel-Stammdaten (Phase 2 Massnahmenformular, migration 133) ────────

export async function upsertDuengemittel(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const tenantId = await getTenantId()

  const existingId = fd.get('existing_id') as string | null

  const payload = {
    tenant_id:                 tenantId,
    name:                      fd.get('name') as string,
    handelsname:               (fd.get('handelsname') as string) || null,
    typ:                       (fd.get('typ') as string) || null,
    naehrstoff_n_pct:          parseFloat(dezimal(fd.get('naehrstoff_n_pct') as string)) || null,
    naehrstoff_p_pct:          parseFloat(dezimal(fd.get('naehrstoff_p_pct') as string)) || null,
    naehrstoff_k_pct:          parseFloat(dezimal(fd.get('naehrstoff_k_pct') as string)) || null,
    wartezeit_tage:            parseInt(fd.get('wartezeit_tage') as string) || null,
    oeko_zugelassen:           fd.get('oeko_zugelassen') === 'true',
    einarbeitung_erforderlich: fd.get('einarbeitung_erforderlich') === 'true',
    preis_pro_einheit:         parseFloat(dezimal(fd.get('preis_pro_einheit') as string)) || null,
    einheit:                   (fd.get('einheit') as string) || null,
    aktiv:                     true,
    notizen:                   (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('duengemittel') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('duengemittel') as any).insert(payload)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  }

  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
}

export async function deactivateDuengemittel(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('duengemittel') as any)
    .update({ aktiv: false }).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(`Deaktivieren fehlgeschlagen: ${error.message}`)
  revalidatePath('/behandlungen/lager')
}

// ── Sätze/Stundensätze je Maßnahmenart (Phase 2/3 Massnahmenformular, migration 133) ────────

export async function upsertSatzMassnahme(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const tenantId = await getTenantId()

  const existingId = fd.get('existing_id') as string | null

  const payload = {
    tenant_id:    tenantId,
    art:          fd.get('art') as string,
    bezeichnung:  fd.get('bezeichnung') as string,
    satz_pro_ha:  parseFloat(dezimal(fd.get('satz_pro_ha') as string)) || 0,
    gueltig_ab:   (fd.get('gueltig_ab') as string) || null,
    notizen:      (fd.get('notizen') as string) || null,
    aktiv:        true,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('saetze_massnahmen') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('saetze_massnahmen') as any).insert(payload)
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
  }

  revalidatePath('/behandlungen/lager')
  revalidatePath('/behandlungen/neu')
}

export async function deactivateSatzMassnahme(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('saetze_massnahmen') as any)
    .update({ aktiv: false }).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(`Deaktivieren fehlgeschlagen: ${error.message}`)
  revalidatePath('/behandlungen/lager')
}
