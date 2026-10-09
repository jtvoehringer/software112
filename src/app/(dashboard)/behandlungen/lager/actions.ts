'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { dezimal, zahlAus, ganzzahlAus } from '@/lib/format'
import { MASSNAHMEN_ARTEN, MASSNAHMEN_ART_LABEL, istMassnahmenArt } from '@/lib/behandlungen/arten'
import { eppoCodeFehler, eppoCodeNormal, registernummerFehler, registernummerNormal } from '@/lib/behandlungen/psmStamm'

// Fehler der Datenbank (z.B. RLS) werden seit 20.9.2026 geworfen statt verschluckt -
// vorher verschwanden abgelehnte Buchungen ohne Hinweis (PSM-Anfangsbestände Gebeshuber).

// Aktiv gewählten Betrieb respektieren (Cookie-basiert, s. lib/auth/roles.ts) statt einer
// beliebigen/ersten tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft
// Daten eines anderen Betriebs als des gerade ausgewählten angezeigt/verändert werden.
async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb? (Lagerbewegungen)
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  // KAN-242: Freigabe Rieden wie RLS (modul_insert/_update/_delete auf Lagerbuchungen, PSM, Düngemittel, Sätzen) – vorab
  // statt technischer RLS-Meldung.
  if (!canWrite(membership, 'rieden')) throw new AktionsFehler(RIEDEN_RECHTE_MELDUNG)
  return membership.tenantId
}

const RIEDEN_RECHTE_MELDUNG = 'Keine Berechtigung für Betriebsmittel – dafür ist die Freigabe Rieden nötig.'

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

  // KAN-88: eine gespeicherte Lagerbuchung ist fest (DB-Trigger a_freeze) – Korrektur per Storno bzw. Inventurkorrektur
  if (existingId) throw new AktionsFehler(LAGER_FEST)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('psm_lager_bewegungen') as any).insert(payload)
  if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)

  revalidatePath('/behandlungen/lager')
}

const LAGER_FEST = 'Eine gespeicherte Lagerbuchung lässt sich nicht mehr ändern – bitte stornieren und neu buchen bzw. eine Inventurkorrektur erfassen.'

type LagerTabelle = 'psm_lager_bewegungen' | 'duengemittel_lager_bewegungen'

// KAN-88 (05.10.2026): Lagerbuchungen werden storniert, nicht gelöscht (Zeitpunkt und Benutzer setzt die Datenbank,
// s112_storno_schutz; stornierte zählen nicht zum Bestand). Endgültig löschen nur stornierte über s112_storniert_loeschen
// (Rolle, Modul Rieden, Betrieb, Abo; Grund im Änderungsprotokoll) – vorher KAN-166 Löschen mit Grund.
async function lagerStornieren(tabelle: LagerTabelle, id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from(tabelle) as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (((data ?? []) as unknown[]).length !== 1) throw new AktionsFehler('Die Buchung wurde nicht gefunden oder ist schon storniert – bitte die Seite neu laden.')
  revalidatePath('/behandlungen/lager')
}

async function lagerEndgueltigLoeschen(tabelle: LagerTabelle, id: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: tabelle, p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  revalidatePath('/behandlungen/lager')
}

export async function stornoLagerBewegung(id: string, grund: string) {
  await lagerStornieren('psm_lager_bewegungen', id, grund)
}

export async function loescheLagerBewegung(id: string, grund: string) {
  await lagerEndgueltigLoeschen('psm_lager_bewegungen', id, grund)
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

  // KAN-88: eine gespeicherte Lagerbuchung ist fest (DB-Trigger a_freeze) – Korrektur per Storno bzw. Inventurkorrektur
  if (existingId) throw new AktionsFehler(LAGER_FEST)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('duengemittel_lager_bewegungen') as any).insert(payload)
  if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)

  revalidatePath('/behandlungen/lager')
}

export async function stornoDuengerBewegung(id: string, grund: string) {
  await lagerStornieren('duengemittel_lager_bewegungen', id, grund)
}

export async function loescheDuengerBewegung(id: string, grund: string) {
  await lagerEndgueltigLoeschen('duengemittel_lager_bewegungen', id, grund)
}

// ── PSM-Stammdaten (vormals /pflanzenschutz, jetzt Teil der Betriebsmittel-Lagerverwaltung) ────────

export async function upsertPSM(fd: FormData) {
  const supabase = await createSupabaseServerClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: { user } } = await (supabase.auth as any).getUser()
  if (!user) throw new AktionsFehler('Nicht angemeldet')

  const tenantId = await getTenantId()

  const existingId = fd.get('existing_id') as string | null

  // KAN-86: Registernummer, EPPO-Code (Hauptschaderreger) und „bienengefährlich“ – von Hand gepflegt
  const regFehler = registernummerFehler(fd.get('zulassungsnr'))
  if (regFehler) throw new AktionsFehler(regFehler)
  const eppoFehler = eppoCodeFehler(fd.get('eppo_code'))
  if (eppoFehler) throw new AktionsFehler(eppoFehler)

  const payload = {
    tenant_id:          tenantId,
    name:               fd.get('name') as string,
    zulassungsnr:       registernummerNormal(fd.get('zulassungsnr')),
    eppo_code:          eppoCodeNormal(fd.get('eppo_code')),
    bienengefaehrlich:  fd.get('bienengefaehrlich') === 'true',
    handelsname:        (fd.get('handelsname') as string) || null,
    wirkstoff:          (fd.get('wirkstoff') as string) || null,
    wirkstoffgehalt_pct: zahlAus(fd.get('wirkstoffgehalt_pct')),
    cu_gehalt_pct:      zahlAus(fd.get('cu_gehalt_pct')),
    kategorie:          (fd.get('kategorie') as string) || null,
    wartezeit_tage:     ganzzahlAus(fd.get('wartezeit_tage')),
    max_aufwand_kg_ha:  zahlAus(fd.get('max_aufwand_kg_ha')),
    max_anwendungen:    ganzzahlAus(fd.get('max_anwendungen')),
    oeko_zugelassen:    fd.get('oeko_zugelassen') === 'true',
    aktiv:              true,
    notizen:            (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: geaendert, error } = await (supabase.from('pflanzenschutzmittel') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
    if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
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
  const { data: geaendert, error } = await (supabase.from('pflanzenschutzmittel') as any)
    .update({ aktiv: false }).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(`Deaktivieren fehlgeschlagen: ${error.message}`)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
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
    naehrstoff_n_pct:          zahlAus(fd.get('naehrstoff_n_pct')),
    naehrstoff_p_pct:          zahlAus(fd.get('naehrstoff_p_pct')),
    naehrstoff_k_pct:          zahlAus(fd.get('naehrstoff_k_pct')),
    wartezeit_tage:            ganzzahlAus(fd.get('wartezeit_tage')),
    oeko_zugelassen:           fd.get('oeko_zugelassen') === 'true',
    einarbeitung_erforderlich: fd.get('einarbeitung_erforderlich') === 'true',
    preis_pro_einheit:         zahlAus(fd.get('preis_pro_einheit')),
    einheit:                   (fd.get('einheit') as string) || null,
    aktiv:                     true,
    notizen:                   (fd.get('notizen') as string) || null,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: geaendert, error } = await (supabase.from('duengemittel') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
    if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
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
  const { data: geaendert, error } = await (supabase.from('duengemittel') as any)
    .update({ aktiv: false }).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(`Deaktivieren fehlgeschlagen: ${error.message}`)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
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

  // Arten wie saetze_massnahmen_art_check (lib/behandlungen/arten.ts, seit KAN-143 mit Laubschneiden)
  const art = fd.get('art')
  if (!istMassnahmenArt(art)) {
    throw new AktionsFehler(`Bitte eine Maßnahmenart wählen (${MASSNAHMEN_ARTEN.map(a => MASSNAHMEN_ART_LABEL[a]).join(', ')}).`)
  }

  const payload = {
    tenant_id:    tenantId,
    art,
    bezeichnung:  fd.get('bezeichnung') as string,
    satz_pro_ha:  parseFloat(dezimal(fd.get('satz_pro_ha') as string)) || 0,
    gueltig_ab:   (fd.get('gueltig_ab') as string) || null,
    notizen:      (fd.get('notizen') as string) || null,
    aktiv:        true,
  }

  if (existingId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: geaendert, error } = await (supabase.from('saetze_massnahmen') as any)
      .update(payload).eq('id', existingId).eq('tenant_id', tenantId).select('id')
    if (error) throw new AktionsFehler(`Speichern fehlgeschlagen: ${error.message}`)
    if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
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
  const { data: geaendert, error } = await (supabase.from('saetze_massnahmen') as any)
    .update({ aktiv: false }).eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(`Deaktivieren fehlgeschlagen: ${error.message}`)
  if (!(geaendert as unknown[] | null)?.length) throw new AktionsFehler(NICHT_GESPEICHERT)   // KAN-248: RLS bzw. fehlende Zeile ändern still 0 Zeilen
  revalidatePath('/behandlungen/lager')
}
