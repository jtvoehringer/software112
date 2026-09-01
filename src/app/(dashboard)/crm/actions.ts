'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentMembership } from '@/lib/auth/roles'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new Error('Kein aktiver Mandant gefunden')
  return membership.tenantId
}

async function generateAccountnummer(tenantId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await (supabase.rpc as any)('get_next_accountnummer', {
    p_tenant_id: tenantId,
  })
  if (error) { console.error('generateAccountnummer:', error.message); return null }
  return data as string | null
}

// Zahlungsziel ist seit 6.8.2026 ein Pflichtfeld pro Kontakt/Firma (ersetzt das
// frühere, betriebsweite tenant_einstellungen.rechnung_zahlungsziel). 0 ist ein
// gültiger, bewusster Wert ("bei Erhalt" auf der Rechnung, siehe
// verkaufRechnungPdf.tsx) - deshalb hier bewusst NICHT mit `|| 14`/`|| 30`
// arbeiten, das würde eine eingetragene 0 stillschweigend überschreiben.
function parseZahlungszielTage(formData: FormData): number {
  const n = parseInt(formData.get('zahlungsziel_tage') as string, 10)
  if (isNaN(n) || n < 0) {
    throw new Error('Zahlungsziel (Tage) ist ein Pflichtfeld und muss 0 oder größer sein.')
  }
  return n
}

// ── Kontakte ──────────────────────────────────────────────────────────────────

export async function createKontakt(formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const payload: AR = {
      tenant_id:   tenantId,
      vorname:     (formData.get('vorname') as string) || null,
      nachname:    formData.get('nachname') as string,
      segment:     formData.get('segment') as string,
      firma_id:    (formData.get('firma_id') as string) || null,
      email:       (formData.get('email') as string) || null,
      telefon:          (formData.get('telefon')          as string) || null,
      telefon_vorwahl:  (formData.get('telefon_vorwahl') as string) || '+43',
      mobil:            (formData.get('mobil')            as string) || null,
      mobil_vorwahl:    (formData.get('mobil_vorwahl')    as string) || '+43',
      strasse:     (formData.get('strasse') as string) || null,
      plz:         (formData.get('plz')     as string) || null,
      ort:         (formData.get('ort')     as string) || null,
      land:        (formData.get('land') as string) || 'AT',
      betrieb_nr:  (formData.get('betrieb_nr') as string) || null,
      stammkunde:  formData.get('stammkunde') === 'true',
      notizen:         (formData.get('notizen')         as string) || null,
      ...(formData.get('rabattgruppe_id') ? { rabattgruppe_id: formData.get('rabattgruppe_id') as string } : {}),
      sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
      skonto_pct:       parseFloat(formData.get('skonto_pct') as string) || 0,
      skonto_tage:      parseInt(formData.get('skonto_tage') as string) || 10,
      zahlungsziel_tage: parseZahlungszielTage(formData),
      is_lead: formData.get('is_lead') === 'true',
    }
    payload.accountnummer = await generateAccountnummer(tenantId)
    const { error } = await (supabase.from('kontakte') as any).insert(payload).eq('tenant_id', tenantId)
    if (error) return { error: (error as AR).message }
    revalidatePath('/crm/kontakte')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function updateKontakt(id: string, formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const payload: AR = {
      vorname:    (formData.get('vorname') as string) || null,
      nachname:   formData.get('nachname') as string,
      segment:    formData.get('segment') as string,
      firma_id:   (formData.get('firma_id') as string) || null,
      email:      (formData.get('email') as string) || null,
      telefon:          (formData.get('telefon')          as string) || null,
      telefon_vorwahl:  (formData.get('telefon_vorwahl') as string) || '+43',
      mobil:            (formData.get('mobil')            as string) || null,
      mobil_vorwahl:    (formData.get('mobil_vorwahl')    as string) || '+43',
      strasse:    (formData.get('strasse') as string) || null,
      plz:        (formData.get('plz')     as string) || null,
      ort:        (formData.get('ort')     as string) || null,
      land:       (formData.get('land') as string) || 'AT',
      stammkunde: formData.get('stammkunde') === 'true',
      notizen:         (formData.get('notizen')         as string) || null,
      ...(formData.get('rabattgruppe_id') !== undefined ? { rabattgruppe_id: (formData.get('rabattgruppe_id') as string) || null } : {}),
      sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
      skonto_pct:       parseFloat(formData.get('skonto_pct') as string) || 0,
      skonto_tage:      parseInt(formData.get('skonto_tage') as string) || 10,
      zahlungsziel_tage: parseZahlungszielTage(formData),
      is_lead: formData.get('is_lead') === 'true',
      aktualisiert_am: new Date().toISOString(),
    }
    const { error } = await (supabase.from('kontakte') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { error: (error as AR).message }
    revalidatePath('/crm/kontakte')
    revalidatePath('/crm/kontakte/[id]', 'page')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function deleteKontakt(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('kontakte') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/kontakte')
}

// ── Firmen ────────────────────────────────────────────────────────────────────

export async function createFirma(formData: FormData): Promise<{ error?: string; id?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const payload: AR = {
      tenant_id:          tenantId,
      name:               formData.get('name') as string,
      segment:            formData.get('segment') as string,
      strasse:            (formData.get('strasse') as string) || null,
      plz:                (formData.get('plz') as string) || null,
      ort:                (formData.get('ort') as string) || null,
      land:               (formData.get('land') as string) || 'AT',
      telefon:            (formData.get('telefon')          as string) || null,
      telefon_vorwahl:    (formData.get('telefon_vorwahl') as string) || '+43',
      email:              (formData.get('email') as string) || null,
      website:            (formData.get('website') as string) || null,
      uid_nummer:         (formData.get('uid_nummer') as string) || null,
      betrieb_nr:         (formData.get('betrieb_nr') as string) || null,
      zahlungsziel_tage:  parseZahlungszielTage(formData),
      waehrung:           (formData.get('waehrung') as string) || 'EUR',
      notizen:            (formData.get('notizen')         as string) || null,
      ...(formData.get('rabattgruppe_id') ? { rabattgruppe_id: formData.get('rabattgruppe_id') as string } : {}),
      sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
      skonto_pct:       parseFloat(formData.get('skonto_pct') as string) || 0,
      skonto_tage:      parseInt(formData.get('skonto_tage') as string) || 10,
      is_lead: formData.get('is_lead') === 'true',
      // Migration 167 - Default ist_kunde=true/ist_lieferant=false, außer das
      // Formular sendet explizit einen anderen Wert (z.B. Lieferanten-
      // Schnellanlage aus der Belege-OCR, siehe buchhaltung/belege/[id]).
      ist_kunde:     formData.get('ist_kunde')     !== 'false',
      ist_lieferant: formData.get('ist_lieferant') === 'true',
    }
    payload.accountnummer = await generateAccountnummer(tenantId)
    const { data, error } = await (supabase.from('firmen') as any)
      .insert(payload).eq('tenant_id', tenantId)
      .select('id').single()
    if (error) return { error: (error as AR).message }
    revalidatePath('/crm/firmen')
    return { id: (data as AR)?.id as string | undefined }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function updateFirma(id: string, formData: FormData): Promise<{ error?: string; id?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const payload: AR = {
      name:               formData.get('name') as string,
      segment:            formData.get('segment') as string,
      strasse:            (formData.get('strasse') as string) || null,
      plz:                (formData.get('plz') as string) || null,
      ort:                (formData.get('ort') as string) || null,
      land:               (formData.get('land') as string) || 'AT',
      telefon:            (formData.get('telefon')          as string) || null,
      telefon_vorwahl:    (formData.get('telefon_vorwahl') as string) || '+43',
      email:              (formData.get('email') as string) || null,
      website:            (formData.get('website') as string) || null,
      uid_nummer:         (formData.get('uid_nummer') as string) || null,
      betrieb_nr:         (formData.get('betrieb_nr') as string) || null,
      zahlungsziel_tage:  parseZahlungszielTage(formData),
      waehrung:           (formData.get('waehrung') as string) || 'EUR',
      notizen:            (formData.get('notizen')         as string) || null,
      ...(formData.get('rabattgruppe_id') !== undefined ? { rabattgruppe_id: (formData.get('rabattgruppe_id') as string) || null } : {}),
      sonderrabatt_pct: parseFloat(formData.get('sonderrabatt_pct') as string) || 0,
      skonto_pct:       parseFloat(formData.get('skonto_pct') as string) || 0,
      skonto_tage:      parseInt(formData.get('skonto_tage') as string) || 10,
      is_lead: formData.get('is_lead') === 'true',
      ist_kunde:     formData.get('ist_kunde')     !== 'false',
      ist_lieferant: formData.get('ist_lieferant') === 'true',
      aktualisiert_am:    new Date().toISOString(),
    }
    const { error } = await (supabase.from('firmen') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { error: (error as AR).message }
    revalidatePath('/crm/firmen')
    revalidatePath('/crm/firmen/[id]', 'page')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function deleteFirma(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('firmen') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/firmen')
}

// ── Aktivitäten ───────────────────────────────────────────────────────────────

export async function moveAktivitaet(id: string, datum: string, uhrzeit_von: string, uhrzeit_bis: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('aktivitaeten') as any)
    .update({ datum, ganztags: !uhrzeit_von && !uhrzeit_bis, uhrzeit_von: uhrzeit_von || null, uhrzeit_bis: uhrzeit_bis || null })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}


export async function createAktivitaet(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { data: { user } } = await supabase.auth.getUser()
  const ganztags = formData.get('ganztags') !== 'false'
  const payload: AR = {
    tenant_id:    tenantId,
    kontakt_id:   (formData.get('kontakt_id') as string) || null,
    firma_id:     (formData.get('firma_id') as string) || null,
    art:          formData.get('art') as string,
    betreff:      (formData.get('betreff') as string) || null,
    beschreibung: (formData.get('beschreibung') as string) || null,
    datum:        formData.get('datum') as string,
    bis_datum:    (formData.get('bis_datum') as string) || null,
    erledigt:     formData.get('erledigt') === 'true',
    ganztags,
    uhrzeit_von:  ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:  ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
    ist_privat:   formData.get('ist_privat') === 'true',
    erstellt_von: user?.id ?? null,
  }
  const { error } = await (supabase.from('aktivitaeten') as any).insert(payload).eq('tenant_id', tenantId)
  if (error) {
    console.error('[createAktivitaet] DB-Fehler:', error.message, error.details, error.hint)
    throw new Error(`Aktivität konnte nicht gespeichert werden: ${error.message}`)
  }
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte')
  revalidatePath('/crm/firmen')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function updateAktivitaet(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const ganztags = formData.get('ganztags') !== 'false'
  const payload: AR = {
    art:          formData.get('art') as string,
    betreff:      (formData.get('betreff') as string) || null,
    beschreibung: (formData.get('beschreibung') as string) || null,
    datum:        formData.get('datum') as string,
    bis_datum:    (formData.get('bis_datum') as string) || null,
    erledigt:     formData.get('erledigt') === 'true',
    ganztags,
    uhrzeit_von:  ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:  ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
  }
  const { error } = await (supabase.from('aktivitaeten') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function deleteAktivitaet(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('aktivitaeten') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

export async function toggleAktivitaetErledigt(id: string, erledigt: boolean) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('aktivitaeten') as any)
    .update({ erledigt })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

// ── Pipeline ──────────────────────────────────────────────────────────────────

export async function createPipelineEintrag(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const ganztags = formData.get('ganztags') !== 'false'
  const payload: AR = {
    tenant_id:           tenantId,
    titel:               formData.get('titel') as string,
    stufe:               formData.get('stufe') as string,
    kontakt_id:          (formData.get('kontakt_id') as string) || null,
    firma_id:            (formData.get('firma_id') as string) || null,
    kategorie:           (formData.get('kategorie') as string) || null,
    wert_euro:           parseFloat(formData.get('wert_euro') as string) || null,
    wahrscheinlichkeit:  parseInt(formData.get('wahrscheinlichkeit') as string) || null,
    erwartetes_datum:    (formData.get('erwartetes_datum') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
    ganztags,
    uhrzeit_von:         ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:         ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
    aktualisiert_am:     new Date().toISOString(),
  }
  const { error } = await (supabase.from('pipeline_eintraege') as any).insert(payload).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}

export async function updatePipelineEintrag(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const ganztags = formData.get('ganztags') !== 'false'
  const titel = (formData.get('titel') as string)?.trim()
  const payload: AR = {
    ...(titel ? { titel } : {}),
    wert_euro:           parseFloat(formData.get('wert_euro') as string) || null,
    wahrscheinlichkeit:  parseInt(formData.get('wahrscheinlichkeit') as string) || null,
    erwartetes_datum:    (formData.get('erwartetes_datum') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
    ganztags,
    uhrzeit_von:         ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:         ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
    aktualisiert_am:     new Date().toISOString(),
  }
  const { error } = await (supabase.from('pipeline_eintraege') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}


export async function updatePipelineStufe(id: string, stufe: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('pipeline_eintraege') as any)
    .update({ stufe, aktualisiert_am: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}

export async function togglePipelineErledigt(id: string, erledigt: boolean) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('pipeline_eintraege') as any)
    .update({
      erledigt,
      erledigt_am:     erledigt ? new Date().toISOString() : null,
      aktualisiert_am: new Date().toISOString(),
    })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}

export async function deletePipelineEintrag(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('pipeline_eintraege') as any).delete().eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new Error((error as AR).message)
  revalidatePath('/crm/pipeline')
}

// ── Visitenkarten-Scanner ────────────────────────────────────────────────────
// Serverseitige Gegenstelle zu crm/kontakte/visitkarte/page.tsx: Der Scanner ist
// eine 'use client'-Seite, die den aktiven Tenant NICHT über getCurrentMembership()
// (next/headers-Cookie, nur serverseitig verfügbar) ermitteln kann. Früher wurde
// dafür direkt im Browser eine tenant_memberships-Zeile abgefragt (irgendeine
// Mitgliedschaft, nicht zwingend der aktive Betrieb) - das führte bei Usern mit
// mehreren Mandanten zu Leads im falschen Betrieb. Fix: Anlage läuft jetzt über
// diese Server Action, die getTenantId() (→ getCurrentMembership()) nutzt.
export async function createLeadFromVisitkarte(kontakt: {
  vorname: string | null
  nachname: string | null
  firma: string | null
  position: string | null
  email: string | null
  telefon: string | null
  mobil: string | null
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
}): Promise<{ kontaktId?: string; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()

    // Firma anlegen falls vorhanden
    let firmaId: string | null = null
    if (kontakt.firma) {
      const { data: f, error: firmaError } = await (supabase.from('firmen') as any).insert({
        tenant_id: tenantId, name: kontakt.firma, aktiv: true, is_lead: true,
        strasse: kontakt.strasse, plz: kontakt.plz, ort: kontakt.ort, land: kontakt.land ?? 'AT',
      }).eq('tenant_id', tenantId).select().single()
      if (firmaError) return { error: (firmaError as AR).message }
      firmaId = (f as AR | null)?.id ?? null
    }

    // Kontakt als Lead anlegen
    const { data: k, error: kontaktError } = await (supabase.from('kontakte') as any).insert({
      tenant_id: tenantId,
      vorname: kontakt.vorname || null,
      nachname: kontakt.nachname || '(unbekannt)',
      email: kontakt.email || null,
      telefon: kontakt.telefon || null,
      mobil: kontakt.mobil || null,
      strasse: kontakt.strasse || null,
      plz: kontakt.plz || null,
      ort: kontakt.ort || null,
      land: kontakt.land ?? 'AT',
      firma_id: firmaId,
      notizen: kontakt.position ? `Position: ${kontakt.position}` : null,
      aktiv: true, stammkunde: false, newsletter: false,
      newsletter_bestaetigt: false, is_lead: true,
      segment: 'privat',
    }).eq('tenant_id', tenantId).select().single()
    if (kontaktError) return { error: (kontaktError as AR).message }

    const kontaktId = (k as AR | null)?.id
    if (!kontaktId) return { error: 'Kontakt konnte nicht gespeichert werden' }
    revalidatePath('/crm/kontakte')
    return { kontaktId }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}
