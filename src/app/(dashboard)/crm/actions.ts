'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { absenderIndexVerwerfen } from '@/lib/crm/absender'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { ladeBezuege, istBezugsSperre } from '@/lib/stammdaten/bezuege'
import { bezugsMeldung, hatBezug } from '@/lib/stammdaten/bezugText'
import { pruefeEmailFelder, einzelneEmail } from '@/lib/crm/email'
import { dezimal } from '@/lib/format'
import { POSITION_MAX, QUELLE_MAX, bereinigterText } from '@/lib/crm/liste'
import { normalisiereLand } from '@/lib/katalog/laender'
import { nurGesendeteFelder } from '@/lib/crm/formFelder'   // Bearbeiten: nur gesendete Felder ändern (02.10.2026)
import { ladeMandantMitglieder } from '@/lib/aufgaben/mitglieder'
import { benachrichtigeAktivitaet } from '@/lib/benachrichtigungen/server'
import { ladeMailAusPostfach } from '@/lib/email/mailLaden'
import { titelAusFormular, titelNachgestelltAusFormular } from '@/lib/crm/titel'
import { lieferadresseAus, lieferadresseFehler } from '@/lib/crm/lieferadressen'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AR = Record<string, any>

async function getTenantId(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb? (Kundennummernkreis)
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership.tenantId
}

// KAN-150 F1: Löschen und Deaktivieren von Kontakten/Firmen – mit Schreibrecht CRM (bisher prüfte nur die RLS)
async function crmSchreibTenant(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership.role, 'crm')) throw new AktionsFehler('Keine Berechtigung: Kontakte und Firmen bearbeiten Betriebs-Manager und Mitarbeiter mit Modulrecht CRM.')
  return membership.tenantId
}

type LoeschErgebnis = { error?: string; deaktivierbar?: boolean }

/** Stammdatum mit Bezug (Verkäufe, Zukäufe, Export, E/A, Traubenverkäufe) nur deaktivieren – sonst löschen */
async function crmLoeschen(tabelle: 'kontakte' | 'firmen', id: string, name: (r: AR) => string): Promise<LoeschErgebnis> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await crmSchreibTenant()
    const bezug = await ladeBezuege(supabase, tenantId, tabelle, id)
    if (hatBezug(bezug)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase.from(tabelle) as any).select('*').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
      return { error: bezugsMeldung(name((data ?? {}) as AR), bezug, tabelle === 'kontakte' ? 'der Kontakt' : 'die Firma'), deaktivierbar: true }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(tabelle) as any).delete().eq('id', id).eq('tenant_id', tenantId).select('id')   // storno-ausnahme: Stammdaten (Kontakt/Firma) ohne Bezug – Bezug vorher geprüft, die DB sperrt sonst (KAN-150)
    if (error) {
      if (istBezugsSperre(error)) return { error: (error as AR).message, deaktivierbar: true }
      return { error: dbFehlerText(error, 'Löschen fehlgeschlagen') }
    }
    if (((data ?? []) as AR[]).length !== 1) return { error: 'Nicht gelöscht – keine Berechtigung oder bereits entfernt. Bitte die Seite neu laden.' }
    revalidatePath(tabelle === 'kontakte' ? '/crm/kontakte' : '/crm/firmen')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

async function crmAktivSetzen(tabelle: 'kontakte' | 'firmen', id: string, aktiv: boolean): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await crmSchreibTenant()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from(tabelle) as any).update({ aktiv }).eq('id', id).eq('tenant_id', tenantId).select('id')
    if (error) return { error: dbFehlerText(error, aktiv ? 'Reaktivieren fehlgeschlagen' : 'Deaktivieren fehlgeschlagen') }
    if (((data ?? []) as AR[]).length !== 1) return { error: 'Nicht geändert – keine Berechtigung oder Datensatz nicht gefunden. Bitte die Seite neu laden.' }
    const basis = tabelle === 'kontakte' ? '/crm/kontakte' : '/crm/firmen'
    revalidatePath(basis)
    revalidatePath(`${basis}/${id}`)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function setzeKontaktAktiv(id: string, aktiv: boolean): Promise<{ error?: string }> {
  return crmAktivSetzen('kontakte', id, aktiv)
}

export async function setzeFirmaAktiv(id: string, aktiv: boolean): Promise<{ error?: string }> {
  return crmAktivSetzen('firmen', id, aktiv)
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
  const n = parseInt(dezimal(formData.get('zahlungsziel_tage') as string), 10)
  if (isNaN(n) || n < 0) {
    throw new AktionsFehler('Zahlungsziel (Tage) ist ein Pflichtfeld und muss 0 oder größer sein.')
  }
  return n
}

// ── Kontakte ──────────────────────────────────────────────────────────────────

// E-Mail-Felder: Prüfung/Bereinigung in lib/crm/email.ts (20.9.2026) – Anzeigenamen,
// Mehrfachadressen im Standardfeld und ungültige Eingaben werden dort behandelt.
function emailFelder(formData: FormData) {
  return pruefeEmailFelder(formData.get('email') as string | null, formData.get('email_weitere') as string | null)
}

// Position und Quelle (02.10.2026): optionaler Freitext – getrimmt, leer → null,
// zu lang → verständlicher Fehler (die Datenbank begrenzt ebenfalls per CHECK).
function optionalerText(formData: FormData, feld: string, bezeichnung: string, max: number): string | null {
  const wert = bereinigterText(formData.get(feld))   // gleiche Bereinigung wie der Datenimport (lib/crm/liste.ts)
  if (!wert) return null
  if (wert.length > max) throw new AktionsFehler(`${bezeichnung} ist zu lang (höchstens ${max} Zeichen, eingegeben ${wert.length}).`)
  return wert
}

/** KAN-187: Land aus Formular/Dialog → ISO-Code aus dem Länderkatalog; leer → 'AT' (wie bisher), unbekannt → Fehler */
function landPruefen(roh: unknown): string {
  const wert = typeof roh === 'string' ? roh.trim() : ''
  if (!wert) return 'AT'
  const iso = normalisiereLand(wert)
  if (!iso) throw new AktionsFehler(`Unbekanntes Land „${wert}“ – bitte ein Land aus der Liste wählen.`)
  return iso
}

/** Hotfix 05.10.2026: Titel (Auswahl) und nachgestellter Titel (frei) – nur, wenn das Formular sie mitschickt */
function kontaktTitel(formData: FormData, bisher?: string | null): { titel?: string | null; titel_nachgestellt?: string | null } {
  const erg: { titel?: string | null; titel_nachgestellt?: string | null } = {}
  if (formData.has('titel')) {
    const t = titelAusFormular(formData.get('titel'), bisher)
    if (t.fehler) throw new AktionsFehler(t.fehler)
    erg.titel = t.wert
  }
  if (formData.has('titel_nachgestellt')) {
    const n = titelNachgestelltAusFormular(formData.get('titel_nachgestellt'))
    if (n.fehler) throw new AktionsFehler(n.fehler)
    erg.titel_nachgestellt = n.wert
  }
  return erg
}

function kontaktPositionQuelle(formData: FormData): { position: string | null; quelle: string | null } {
  return {
    position: optionalerText(formData, 'position', 'Position', POSITION_MAX),
    quelle:   optionalerText(formData, 'quelle', 'Quelle', QUELLE_MAX),
  }
}

export async function createKontakt(formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const em = emailFelder(formData)
    if (em.fehler) return { error: em.fehler }
    const payload: AR = {
      ...kontaktPositionQuelle(formData),
      ...kontaktTitel(formData),
      tenant_id:   tenantId,
      vorname:     (formData.get('vorname') as string) || null,
      nachname:    formData.get('nachname') as string,
      segment:     formData.get('segment') as string,
      firma_id:    (formData.get('firma_id') as string) || null,
      email:       em.email,
      email_weitere: em.email_weitere,
      telefon:          (formData.get('telefon')          as string) || null,
      telefon_vorwahl:  (formData.get('telefon_vorwahl') as string) || '+43',
      mobil:            (formData.get('mobil')            as string) || null,
      mobil_vorwahl:    (formData.get('mobil_vorwahl')    as string) || '+43',
      strasse:     (formData.get('strasse') as string) || null,
      plz:         (formData.get('plz')     as string) || null,
      ort:         (formData.get('ort')     as string) || null,
      land:        landPruefen(formData.get('land')),
      betrieb_nr:  (formData.get('betrieb_nr') as string) || null,
      stammkunde:  formData.get('stammkunde') === 'true',
      notizen:         (formData.get('notizen')         as string) || null,
      ...(formData.get('rabattgruppe_id') ? { rabattgruppe_id: formData.get('rabattgruppe_id') as string } : {}),
      sonderrabatt_pct: parseFloat(dezimal(formData.get('sonderrabatt_pct') as string)) || 0,
      skonto_pct:       parseFloat(dezimal(formData.get('skonto_pct') as string)) || 0,
      skonto_tage:      parseInt(dezimal(formData.get('skonto_tage') as string)) || 10,
      zahlungsziel_tage: parseZahlungszielTage(formData),
      is_lead: formData.get('is_lead') === 'true',
    }
    payload.accountnummer = await generateAccountnummer(tenantId)
    const { error } = await (supabase.from('kontakte') as any).insert(payload).eq('tenant_id', tenantId)
    if (error) return { error: (error as AR).message }
    absenderIndexVerwerfen(tenantId)
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
    const em = emailFelder(formData)
    if (em.fehler) return { error: em.fehler }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Supabase-Typen ohne Tabellenschema (Konvention)
    const { data: titelAlt } = await (supabase.from('kontakte') as any).select('titel').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    const payload: AR = nurGesendeteFelder(formData, {
      ...kontaktPositionQuelle(formData),
      ...kontaktTitel(formData, (titelAlt as AR | null)?.titel ?? null),
      vorname:    (formData.get('vorname') as string) || null,
      nachname:   formData.get('nachname') as string,
      segment:    formData.get('segment') as string,
      firma_id:   (formData.get('firma_id') as string) || null,
      email:      em.email,
      email_weitere: em.email_weitere,
      telefon:          (formData.get('telefon')          as string) || null,
      telefon_vorwahl:  (formData.get('telefon_vorwahl') as string) || '+43',
      mobil:            (formData.get('mobil')            as string) || null,
      mobil_vorwahl:    (formData.get('mobil_vorwahl')    as string) || '+43',
      strasse:    (formData.get('strasse') as string) || null,
      plz:        (formData.get('plz')     as string) || null,
      ort:        (formData.get('ort')     as string) || null,
      land:       landPruefen(formData.get('land')),
      betrieb_nr: (formData.get('betrieb_nr') as string) || null,   // fehlte bis 02.10.2026 (Änderung ging verloren)
      stammkunde: formData.get('stammkunde') === 'true',
      notizen:         (formData.get('notizen')         as string) || null,
      rabattgruppe_id: (formData.get('rabattgruppe_id') as string) || null,
      sonderrabatt_pct: parseFloat(dezimal(formData.get('sonderrabatt_pct') as string)) || 0,
      skonto_pct:       parseFloat(dezimal(formData.get('skonto_pct') as string)) || 0,
      skonto_tage:      parseInt(dezimal(formData.get('skonto_tage') as string)) || 10,
      ...(formData.has('zahlungsziel_tage') ? { zahlungsziel_tage: parseZahlungszielTage(formData) } : {}),
      is_lead: formData.get('is_lead') === 'true',
    })
    payload.aktualisiert_am = new Date().toISOString()
    const { error } = await (supabase.from('kontakte') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { error: (error as AR).message }
    absenderIndexVerwerfen(tenantId)
    revalidatePath('/crm/kontakte')
    revalidatePath('/crm/kontakte/[id]', 'page')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function deleteKontakt(id: string): Promise<LoeschErgebnis> {
  return crmLoeschen('kontakte', id, r => [r.vorname, r.nachname].filter(Boolean).join(' ') || 'Kontakt')
}

// ── Kontakt → Firma umwandeln (Rückmeldung 2.9.2026) ──────────────────────────
//
// Ein als Person erfasster Kunde stellt sich als Betrieb heraus (Gasthaus,
// Vinothek, Händler ...). Statt die Firma händisch neu anzulegen und alles
// umzuhängen: Firma aus den Stammdaten des Kontakts erzeugen, den Kontakt als
// Ansprechperson daran hängen (kontakte.firma_id) und die komplette Historie
// (Aktivitäten, Pipeline, Verkäufe, Bestellungen, Exportaufträge,
// Traubenverkauf) auf die Firma umhängen - der Kontakt bleibt dort als Person
// (kontakt_id) erhalten, Umsatzauswertungen laufen ab jetzt über die Firma.
// Entscheidungen 2.9.2026: Kontakt bleibt bestehen (nicht deaktivieren),
// Historie wandert vollständig mit, nur diese Richtung (keine Firma → Kontakt).
// Historie (aktivitaeten, pipeline_eintraege, verkaufsposten, bestellungen, exportauftraege, traubenverkauf) hängt die
// RPC s112_kontakt_historie_zu_firma um (KAN-150 F1c): in einem Schritt, Belege behalten ihre Momentaufnahme des
// Käufers, auch stornierte Verkäufe lassen sich umhängen.

export async function kontaktZuFirmaUmwandeln(
  kontaktId: string,
  eingabe: { name: string; segment: string },
): Promise<{ error?: string; firmaId?: string; verschoben?: Record<string, number> }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()

    const name = eingabe.name.trim()
    if (!name) return { error: 'Bitte einen Firmennamen angeben.' }

    const { data: kRaw, error: kErr } = await (supabase.from('kontakte') as any)
      .select('*').eq('id', kontaktId).eq('tenant_id', tenantId).maybeSingle()
    if (kErr) return { error: (kErr as AR).message }
    const k = kRaw as AR | null
    if (!k) return { error: 'Kontakt nicht gefunden.' }
    if (k.firma_id) return { error: 'Dieser Kontakt ist bereits einer Firma zugeordnet – bitte dort weiterarbeiten.' }

    const personName = [k.vorname, k.nachname].filter(Boolean).join(' ')
    const heute = new Date().toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
    const hinweis = `Umgewandelt aus Kontakt „${personName}" am ${heute}`
    const notizen = k.notizen ? `${hinweis}\n${k.notizen}` : hinweis

    const payload: AR = {
      tenant_id:         tenantId,
      name,
      segment:           eingabe.segment || k.segment || 'gastronomie',
      strasse:           k.strasse ?? null,
      plz:               k.plz ?? null,
      ort:               k.ort ?? null,
      land:              k.land ?? 'AT',
      telefon:           k.telefon ?? null,
      telefon_vorwahl:   k.telefon_vorwahl ?? '+43',
      mobil:             k.mobil ?? null,
      mobil_vorwahl:     k.mobil_vorwahl ?? '+43',
      email:             k.email ?? null,
      betrieb_nr:        k.betrieb_nr ?? null,
      zahlungsziel_tage: typeof k.zahlungsziel_tage === 'number' ? k.zahlungsziel_tage : 30,
      waehrung:          'EUR',
      notizen,
      rabattgruppe_id:   k.rabattgruppe_id ?? null,
      sonderrabatt_pct:  k.sonderrabatt_pct ?? 0,
      skonto_pct:        k.skonto_pct ?? 0,
      skonto_tage:       k.skonto_tage ?? 10,
      is_lead:           !!k.is_lead,
      ist_kunde:         true,
      ist_lieferant:     false,
      aktiv:             true,
      // Herkunftskennzeichnung (Migration 192) mitnehmen, damit ein
      // importierter Kontakt auch als Firma als Import erkennbar bleibt.
      import_quelle:     k.import_quelle ?? null,
      importiert_am:     k.importiert_am ?? null,
    }
    payload.accountnummer = await generateAccountnummer(tenantId)

    const { data: fRaw, error: fErr } = await (supabase.from('firmen') as any)
      .insert(payload).select('id').single()
    if (fErr) return { error: (fErr as AR).message }
    const firmaId = (fRaw as AR).id as string

    // Kontakt als Ansprechperson an die neue Firma hängen
    const { error: linkErr } = await (supabase.from('kontakte') as any)
      .update({ firma_id: firmaId, aktualisiert_am: new Date().toISOString() })
      .eq('id', kontaktId).eq('tenant_id', tenantId)
    if (linkErr) return { error: `Firma angelegt, Kontakt konnte aber nicht zugeordnet werden: ${(linkErr as AR).message}` }

    // Historie umhängen: firma_id setzen, kontakt_id bleibt (Person an der Firma) – KAN-150 F1c per RPC
    const { data: umRaw, error: umErr } = await (supabase.rpc as any)('s112_kontakt_historie_zu_firma', {
      p_tenant_id: tenantId, p_kontakt_id: kontaktId, p_firma_id: firmaId,
    })
    if (umErr) return { error: `Firma angelegt und Kontakt zugeordnet, die Historie konnte aber nicht umgehängt werden: ${dbFehlerText(umErr)}`, firmaId }
    const verschoben = (umRaw ?? {}) as Record<string, number>

    revalidatePath('/crm/kontakte')
    revalidatePath(`/crm/kontakte/${kontaktId}`)
    revalidatePath('/crm/firmen')
    revalidatePath(`/crm/firmen/${firmaId}`)
    return { firmaId, verschoben }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

// ── Firmen ────────────────────────────────────────────────────────────────────

export async function createFirma(formData: FormData): Promise<{ error?: string; id?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const em = emailFelder(formData)
    if (em.fehler) return { error: em.fehler }
    const payload: AR = {
      tenant_id:          tenantId,
      name:               formData.get('name') as string,
      segment:            formData.get('segment') as string,
      strasse:            (formData.get('strasse') as string) || null,
      plz:                (formData.get('plz') as string) || null,
      ort:                (formData.get('ort') as string) || null,
      land:               landPruefen(formData.get('land')),
      telefon:            (formData.get('telefon')          as string) || null,
      telefon_vorwahl:    (formData.get('telefon_vorwahl') as string) || '+43',
      mobil:              (formData.get('mobil')          as string) || null,
      mobil_vorwahl:      (formData.get('mobil_vorwahl') as string) || '+43',
      email:              em.email,
      email_weitere:      em.email_weitere,
      website:            (formData.get('website') as string) || null,
      uid_nummer:         (formData.get('uid_nummer') as string) || null,
      betrieb_nr:         (formData.get('betrieb_nr') as string) || null,
      debitor_nr:         (formData.get('debitor_nr') as string) || null,
      zahlungsziel_tage:  parseZahlungszielTage(formData),
      waehrung:           (formData.get('waehrung') as string) || 'EUR',
      notizen:            (formData.get('notizen')         as string) || null,
      ...(formData.get('rabattgruppe_id') ? { rabattgruppe_id: formData.get('rabattgruppe_id') as string } : {}),
      sonderrabatt_pct: parseFloat(dezimal(formData.get('sonderrabatt_pct') as string)) || 0,
      skonto_pct:       parseFloat(dezimal(formData.get('skonto_pct') as string)) || 0,
      skonto_tage:      parseInt(dezimal(formData.get('skonto_tage') as string)) || 10,
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
    absenderIndexVerwerfen(tenantId)
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
    const em = emailFelder(formData)
    if (em.fehler) return { error: em.fehler }
    const payload: AR = nurGesendeteFelder(formData, {
      name:               formData.get('name') as string,
      segment:            formData.get('segment') as string,
      strasse:            (formData.get('strasse') as string) || null,
      plz:                (formData.get('plz') as string) || null,
      ort:                (formData.get('ort') as string) || null,
      land:               landPruefen(formData.get('land')),
      telefon:            (formData.get('telefon')          as string) || null,
      telefon_vorwahl:    (formData.get('telefon_vorwahl') as string) || '+43',
      mobil:              (formData.get('mobil')          as string) || null,
      mobil_vorwahl:      (formData.get('mobil_vorwahl') as string) || '+43',
      email:              em.email,
      email_weitere:      em.email_weitere,
      website:            (formData.get('website') as string) || null,
      uid_nummer:         (formData.get('uid_nummer') as string) || null,
      betrieb_nr:         (formData.get('betrieb_nr') as string) || null,
      debitor_nr:         (formData.get('debitor_nr') as string) || null,
      ...(formData.has('zahlungsziel_tage') ? { zahlungsziel_tage: parseZahlungszielTage(formData) } : {}),
      waehrung:           (formData.get('waehrung') as string) || 'EUR',
      notizen:            (formData.get('notizen')         as string) || null,
      rabattgruppe_id:    (formData.get('rabattgruppe_id') as string) || null,
      sonderrabatt_pct: parseFloat(dezimal(formData.get('sonderrabatt_pct') as string)) || 0,
      skonto_pct:       parseFloat(dezimal(formData.get('skonto_pct') as string)) || 0,
      skonto_tage:      parseInt(dezimal(formData.get('skonto_tage') as string)) || 10,
      is_lead: formData.get('is_lead') === 'true',
      ist_kunde:     formData.get('ist_kunde')     !== 'false',
      ist_lieferant: formData.get('ist_lieferant') === 'true',
    })
    payload.aktualisiert_am = new Date().toISOString()
    const { error } = await (supabase.from('firmen') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { error: (error as AR).message }
    absenderIndexVerwerfen(tenantId)
    revalidatePath('/crm/firmen')
    revalidatePath('/crm/firmen/[id]', 'page')
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function deleteFirma(id: string): Promise<LoeschErgebnis> {
  return crmLoeschen('firmen', id, r => String(r.name ?? 'Firma'))
}

// ── Aktivitäten ───────────────────────────────────────────────────────────────

export async function moveAktivitaet(id: string, datum: string, uhrzeit_von: string, uhrzeit_bis: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('aktivitaeten') as any)
    .update({ datum, ganztags: !uhrzeit_von && !uhrzeit_bis, uhrzeit_von: uhrzeit_von || null, uhrzeit_bis: uhrzeit_bis || null })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
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
    // Ohne Auswahlfeld (Detailseiten) gehört die Aktivität dem Ersteller; „Betrieb“ nur bei bewusster Wahl
    ...(formData.has('verantwortlich') ? zuweisung(formData) : { verantwortlich_id: user?.id ?? null, fuer_alle: false }),
  }
  const { data: neu, error } = await (supabase.from('aktivitaeten') as any).insert(payload).eq('tenant_id', tenantId).select('id').single()
  if (error) {
    console.error('[createAktivitaet] DB-Fehler:', error.message, error.details, error.hint)
    throw new AktionsFehler(`Aktivität konnte nicht gespeichert werden: ${error.message}`)
  }
  if (user && neu?.id) {
    await benachrichtigeAktivitaet({
      tenantId, userId: user.id, id: neu.id as string, betreff: payload.betreff ?? payload.art, art: payload.art, datum: payload.datum,
      beschreibung: payload.beschreibung, verantwortlichId: payload.verantwortlich_id, fuerAlle: payload.fuer_alle,
      vorher: null, mitglieder: await ladeMandantMitglieder(tenantId),
    })
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
    datum:        formData.get('datum') as string,
    bis_datum:    (formData.get('bis_datum') as string) || null,
    erledigt:     formData.get('erledigt') === 'true',
    ganztags,
    uhrzeit_von:  ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:  ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
  }
  // Beschreibung nur übernehmen, wenn das Formular das Feld mitschickt (sonst würde sie gelöscht)
  if (formData.has('beschreibung')) payload.beschreibung = (formData.get('beschreibung') as string) || null
  // Zuweisung nur übernehmen, wenn das Formular sie mitschickt (Detailseiten-Formulare kennen sie nicht)
  if (formData.has('verantwortlich')) Object.assign(payload, zuweisung(formData))
  const { data: vorher } = await (supabase.from('aktivitaeten') as any)
    .select('verantwortlich_id, fuer_alle, beschreibung').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  const { error } = await (supabase.from('aktivitaeten') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  const { data: { user } } = await supabase.auth.getUser()
  if (user && vorher) {
    await benachrichtigeAktivitaet({
      tenantId, userId: user.id, id, betreff: payload.betreff ?? payload.art, art: payload.art, datum: payload.datum,
      beschreibung: 'beschreibung' in payload ? payload.beschreibung : (vorher.beschreibung ?? null),
      verantwortlichId: 'verantwortlich_id' in payload ? payload.verantwortlich_id : (vorher.verantwortlich_id ?? null),
      fuerAlle: 'fuer_alle' in payload ? payload.fuer_alle : !!vorher.fuer_alle,
      vorher: { verantwortlich_id: vorher.verantwortlich_id ?? null, fuer_alle: !!vorher.fuer_alle, beschreibung: vorher.beschreibung ?? null },
      mitglieder: await ladeMandantMitglieder(tenantId),
    })
  }
  revalidatePath('/crm')
  revalidatePath('/crm/kontakte/[id]', 'page')
  revalidatePath('/crm/firmen/[id]', 'page')
}

/** Formularfeld „verantwortlich“: '' = Betrieb (niemand), 'alle' = für alle, sonst user_id */
function zuweisung(formData: FormData): { verantwortlich_id: string | null; fuer_alle: boolean } {
  const v = ((formData.get('verantwortlich') as string) || '').trim()
  if (v === 'alle') return { verantwortlich_id: null, fuer_alle: true }
  return { verantwortlich_id: v || null, fuer_alle: false }
}

export async function deleteAktivitaet(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { data: weg, error } = await (supabase.from('aktivitaeten') as any).delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler((error as AR).message)
  if (((weg ?? []) as unknown[]).length === 0) throw new AktionsFehler('Die Aktivität wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.')   // KAN-243
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
  if (error) throw new AktionsFehler((error as AR).message)
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
    wert_euro:           parseFloat(dezimal(formData.get('wert_euro') as string)) || null,
    wahrscheinlichkeit:  parseInt(dezimal(formData.get('wahrscheinlichkeit') as string)) || null,
    erwartetes_datum:    (formData.get('erwartetes_datum') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
    ganztags,
    uhrzeit_von:         ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:         ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
    aktualisiert_am:     new Date().toISOString(),
  }
  const { error } = await (supabase.from('pipeline_eintraege') as any).insert(payload).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/crm/pipeline')
}

export async function updatePipelineEintrag(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const ganztags = formData.get('ganztags') !== 'false'
  const titel = (formData.get('titel') as string)?.trim()
  const payload: AR = {
    ...(titel ? { titel } : {}),
    wert_euro:           parseFloat(dezimal(formData.get('wert_euro') as string)) || null,
    wahrscheinlichkeit:  parseInt(dezimal(formData.get('wahrscheinlichkeit') as string)) || null,
    erwartetes_datum:    (formData.get('erwartetes_datum') as string) || null,
    notizen:             (formData.get('notizen') as string) || null,
    ganztags,
    uhrzeit_von:         ganztags ? null : ((formData.get('uhrzeit_von') as string) || null),
    uhrzeit_bis:         ganztags ? null : ((formData.get('uhrzeit_bis') as string) || null),
    aktualisiert_am:     new Date().toISOString(),
  }
  const { error } = await (supabase.from('pipeline_eintraege') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/crm/pipeline')
}


export async function updatePipelineStufe(id: string, stufe: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { error } = await (supabase.from('pipeline_eintraege') as any)
    .update({ stufe, aktualisiert_am: new Date().toISOString() })
    .eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as AR).message)
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
  if (error) throw new AktionsFehler((error as AR).message)
  revalidatePath('/crm/pipeline')
}

export async function deletePipelineEintrag(id: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  const { data: weg, error } = await (supabase.from('pipeline_eintraege') as any).delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler((error as AR).message)
  if (((weg ?? []) as unknown[]).length === 0) throw new AktionsFehler('Der Eintrag wurde nicht gelöscht (nicht gefunden oder keine Berechtigung) – bitte die Seite neu laden.')   // KAN-243
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
        strasse: kontakt.strasse, plz: kontakt.plz, ort: kontakt.ort, land: normalisiereLand(kontakt.land) ?? 'AT',
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
      land: normalisiereLand(kontakt.land) ?? 'AT',
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

// ── E-Mail → Lead (Rückmeldung 15.9.2026) ─────────────────────────────────────
// Gegenstück zum Dialog „Soll ein Lead angelegt werden?“ unter Nachrichten
// (LeadDialog.tsx). Legt den Kontakt als Lead an - wahlweise mit neuer Firma
// (ebenfalls Lead) oder an eine bestehende Firma gehängt - und verknüpft die
// auslösende E-Mail als Aktivität, damit sie in der Kontakt-Historie steht.
// Die Segment-Wahl u. dgl. kommt aus dem Dialog; Accountnummer wie bei
// createKontakt/createFirma über get_next_accountnummer.
export type LeadAusEmailDaten = {
  anrede?: string | null
  vorname: string | null
  nachname: string
  email: string | null
  telefon: string | null
  mobil: string | null
  position: string | null
  strasse: string | null
  plz: string | null
  ort: string | null
  land: string | null
  segment: string
  rabattgruppe_id: string | null
  zahlungsziel_tage: number | null
  notizen: string | null
  firma: { modus: 'keine' | 'neu' | 'bestehend'; id: string | null; name: string | null; website: string | null; segment: string | null }
  // KAN-137: bewusst OHNE bodyHtml – das HTML lädt die Action selbst aus dem Postfach
  // (ladeMailAusPostfach); ein vom Browser geschicktes HTML wird nie gespeichert.
  // mailbox: aus welchem Postfach die Mail stammt (eigenes/geteiltes, wie unter Nachrichten)
  mail: { id: string; conversationId: string | null; betreff: string; von: string; vonName: string; an: string; datum: string; bodyText: string; mailbox?: 'own' | 'shared' } | null
}

export async function createLeadAusEmail(d: LeadAusEmailDaten): Promise<{ kontaktId?: string; firmaId?: string | null; error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const { data: { user } } = await supabase.auth.getUser()
    const nachname = (d.nachname ?? '').trim()
    if (!nachname) return { error: 'Nachname fehlt' }
    const land = landPruefen(d.land)   // KAN-187: Auswahl aus dem Länderkatalog

    // Firma: neu (als Lead) oder bestehende
    let firmaId: string | null = null
    if (d.firma.modus === 'bestehend' && d.firma.id) {
      const { data: f } = await (supabase.from('firmen') as any).select('id').eq('tenant_id', tenantId).eq('id', d.firma.id).maybeSingle()
      if (!f) return { error: 'Gewählte Firma nicht gefunden' }
      firmaId = (f as AR).id
    } else if (d.firma.modus === 'neu' && d.firma.name?.trim()) {
      const website = d.firma.website?.trim() || null
      const { data: f, error: fe } = await (supabase.from('firmen') as any).insert({
        tenant_id: tenantId, name: d.firma.name.trim(), aktiv: true, is_lead: true,
        segment: d.firma.segment && d.firma.segment !== 'privat' ? d.firma.segment : (d.segment !== 'privat' ? d.segment : 'firmenkunde'),
        strasse: d.strasse || null, plz: d.plz || null, ort: d.ort || null, land,
        website: website ? (website.startsWith('http') ? website : `https://${website}`) : null,
        telefon: d.telefon || null,
        accountnummer: await generateAccountnummer(tenantId),
        notizen: d.mail ? `Lead aus E-Mail vom ${d.mail.datum.slice(0, 10)} („${d.mail.betreff}“)` : null,
      }).eq('tenant_id', tenantId).select('id').single()
      if (fe) return { error: (fe as AR).message }
      firmaId = (f as AR | null)?.id ?? null
    }

    // Kontakt als Lead
    const notizenTeile = [d.position ? `Position: ${d.position}` : null, d.notizen?.trim() || null].filter(Boolean)
    // Absenderadresse IMMER mitspeichern (18.9.2026): die KI belegt "E-Mail" aus
    // der Signatur vor - weicht die vom tatsächlichen Absender ab (z.B. Signatur
    // judi_liu@hotmail.com, gesendet von einer anderen Adresse), wurde der Lead
    // beim nächsten Öffnen derselben Mail nicht erkannt und erneut vorgeschlagen.
    const emailStd = einzelneEmail(d.email)
    const absender = einzelneEmail(d.mail?.von) ?? ''
    const emailWeitere = absender && absender !== emailStd ? [absender] : []
    const payload: AR = {
      tenant_id: tenantId,
      vorname: d.vorname?.trim() || null,
      nachname,
      segment: d.segment || 'privat',
      firma_id: firmaId,
      email: emailStd ?? (absender || null),
      email_weitere: emailStd ? emailWeitere : [],
      telefon: d.telefon?.trim() || null,
      mobil: d.mobil?.trim() || null,
      strasse: d.strasse?.trim() || null, plz: d.plz?.trim() || null, ort: d.ort?.trim() || null, land,
      notizen: notizenTeile.join('\n') || null,
      aktiv: true, stammkunde: false, newsletter: false, newsletter_bestaetigt: false, is_lead: true,
      ...(d.rabattgruppe_id ? { rabattgruppe_id: d.rabattgruppe_id } : {}),
      ...(d.zahlungsziel_tage !== null && d.zahlungsziel_tage !== undefined && d.zahlungsziel_tage >= 0 ? { zahlungsziel_tage: d.zahlungsziel_tage } : {}),
      accountnummer: await generateAccountnummer(tenantId),
    }
    const { data: k, error: ke } = await (supabase.from('kontakte') as any).insert(payload).eq('tenant_id', tenantId).select('id').single()
    if (ke) return { error: (ke as AR).message }
    const kontaktId = (k as AR | null)?.id as string | undefined
    if (!kontaktId) return { error: 'Kontakt konnte nicht gespeichert werden' }
    absenderIndexVerwerfen(tenantId)

    // Auslösende E-Mail als Aktivität an den Kontakt hängen (wie /api/nachrichten/message bei bekannten Absendern)
    if (d.mail?.id) {
      // KAN-137: Inhalt und Kopfdaten serverseitig aus dem Postfach laden (Graph) statt
      // dem Browser zu glauben – sonst ließe sich beliebiges HTML als email_body_html
      // speichern. Ist die Mail nicht ladbar (Postfach getrennt, Token abgelaufen …),
      // wird die Aktivität mit den Angaben aus dem Dialog, aber OHNE HTML angelegt
      // (der Klartext wird in der CRM-Ansicht nur als Text dargestellt).
      const mailbox = d.mail.mailbox === 'shared' ? 'shared' : 'own'
      let geladen: Awaited<ReturnType<typeof ladeMailAusPostfach>> = null
      try {
        geladen = await ladeMailAusPostfach(tenantId, user?.id ?? '', d.mail.id, mailbox)
      } catch (e) {
        console.error('[createLeadAusEmail] Mail nicht aus dem Postfach ladbar:', e)
      }
      const bodyText = (geladen?.bodyText ?? (d.mail.bodyText ?? '').replace(/<[^>]*>/g, '')).trim()
      { const { error: e } = await (supabase.from('aktivitaeten') as any).upsert({
        tenant_id: tenantId, kontakt_id: kontaktId, firma_id: null,
        art: 'email', erledigt: false, ganztags: true,
        betreff: geladen?.betreff || d.mail.betreff || '(kein Betreff)',
        datum: (geladen?.datum || d.mail.datum || new Date().toISOString()).split('T')[0],
        email_id: d.mail.id, email_conversation_id: geladen ? geladen.conversationId : d.mail.conversationId,
        email_von: (geladen ? geladen.von : d.mail.von) || null,
        email_von_name: (geladen ? geladen.vonName : d.mail.vonName) || null,
        email_an: (geladen ? geladen.an : d.mail.an) || null,
        email_body: bodyText || null, email_body_html: geladen?.bodyHtml ?? null,
        beschreibung: bodyText.slice(0, 500),
        erstellt_von: user?.id ?? null,
      }, { onConflict: 'tenant_id,email_id', ignoreDuplicates: true })
        if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (aktivitaeten): ${e.message}`) }
    }

    revalidatePath('/crm/kontakte')
    if (firmaId) revalidatePath('/crm/firmen')
    return { kontaktId, firmaId }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

/** „Nein, nicht mehr fragen“: Absender je Betrieb merken (email_lead_ignoriert, Migration 202) */
export async function ignoriereAbsender(email: string, grund?: string | null): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const { data: { user } } = await supabase.auth.getUser()
    const e = (email ?? '').trim().toLowerCase()
    if (!e.includes('@')) return { error: 'Keine gültige Adresse' }
    const { error } = await (supabase.from('email_lead_ignoriert') as any)
      .upsert({ tenant_id: tenantId, email: e, grund: grund?.trim() || null, erstellt_von: user?.id ?? null }, { onConflict: 'tenant_id,email' })
    if (error) return { error: (error as AR).message }
    absenderIndexVerwerfen(tenantId)
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

// ── Dublettenprüfung serverseitig (17.9.2026) ─────────────────────────────────
// Die Kontakt-/Firmenlisten laden nicht mehr alle Datensätze in den Browser,
// deshalb prüft das Formular Dubletten über diese Aktion (Name bzw. Adresse,
// Groß-/Kleinschreibung egal) statt über die Liste im Client.
export async function pruefeKontaktDublette(d: { vorname: string; nachname: string; strasse: string; plz: string; ort: string }): Promise<{ name?: string; adresse?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const out: { name?: string; adresse?: string } = {}
    const nachname = d.nachname.trim(), vorname = d.vorname.trim()
    if (nachname) {
      let q = (supabase.from('kontakte') as any).select('vorname, nachname').eq('tenant_id', tenantId).eq('aktiv', true).ilike('nachname', nachname)
      q = vorname ? q.ilike('vorname', vorname) : q.or('vorname.is.null,vorname.eq.')
      const { data } = await q.limit(1)
      const k = ((data ?? []) as AR[])[0]
      if (k) out.name = `${k.vorname ? k.vorname + ' ' : ''}${k.nachname}`
    }
    if (d.strasse.trim() && d.plz.trim() && d.ort.trim()) {
      const { data } = await (supabase.from('kontakte') as any).select('vorname, nachname, strasse, plz, ort').eq('tenant_id', tenantId).eq('aktiv', true)
        .ilike('strasse', d.strasse.trim()).ilike('plz', d.plz.trim()).ilike('ort', d.ort.trim()).limit(1)
      const k = ((data ?? []) as AR[])[0]
      if (k) out.adresse = `${k.strasse}, ${k.plz} ${k.ort} – „${k.vorname ? k.vorname + ' ' : ''}${k.nachname}“`
    }
    return out
  } catch { return {} }
}

export async function pruefeFirmaDublette(d: { name: string; strasse: string; plz: string; ort: string }): Promise<{ name?: string; adresse?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const out: { name?: string; adresse?: string } = {}
    if (d.name.trim()) {
      const { data } = await (supabase.from('firmen') as any).select('name').eq('tenant_id', tenantId).eq('aktiv', true).ilike('name', d.name.trim()).limit(1)
      const f = ((data ?? []) as AR[])[0]
      if (f) out.name = f.name
    }
    if (d.strasse.trim() && d.plz.trim() && d.ort.trim()) {
      const { data } = await (supabase.from('firmen') as any).select('name, strasse, plz, ort').eq('tenant_id', tenantId).eq('aktiv', true)
        .ilike('strasse', d.strasse.trim()).ilike('plz', d.plz.trim()).ilike('ort', d.ort.trim()).limit(1)
      const f = ((data ?? []) as AR[])[0]
      if (f) out.adresse = `${f.strasse}, ${f.plz} ${f.ort} – „${f.name}“`
    }
    return out
  } catch { return {} }
}

// E-Mail-Adresse einem bestehenden Kontakt/einer Firma hinzufügen (Rückmeldung
// 18.9.2026: Absender ist unter anderer Adresse bereits im CRM). Ohne
// Standardadresse wird sie zur Standardadresse, sonst zu den weiteren
// (Migration 211). Danach gilt der Absender als bekannt.
export async function emailHinzufuegen(typ: 'kontakt' | 'firma', id: string, email: string): Promise<{ error?: string; alsStandard?: boolean }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const e = einzelneEmail(email)
    if (!e) return { error: `„${(email ?? '').trim()}“ ist keine gültige E-Mail-Adresse.` }
    const tabelle = typ === 'firma' ? 'firmen' : 'kontakte'
    const { data: row, error: e1 } = await (supabase.from(tabelle) as any).select('id, email, email_weitere').eq('tenant_id', tenantId).eq('id', id).maybeSingle()
    if (e1) return { error: (e1 as AR).message }
    if (!row) return { error: 'Datensatz nicht gefunden' }
    const std = String((row as AR).email ?? '').trim().toLowerCase()
    const weitere: string[] = ((row as AR).email_weitere ?? []) as string[]
    if (std === e || weitere.includes(e)) return {}
    const patch: AR = std ? { email_weitere: [...weitere, e] } : { email: e }
    const { error } = await (supabase.from(tabelle) as any).update(patch).eq('tenant_id', tenantId).eq('id', id)
    if (error) return { error: (error as AR).message }
    absenderIndexVerwerfen(tenantId)
    revalidatePath(typ === 'firma' ? `/crm/firmen/${id}` : `/crm/kontakte/${id}`)
    return { alsStandard: !std }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

// ── Dubletten (Migration 213) ─────────────────────────────────────────────────

// Zusammenführen über RPC kontakte_zusammenfuehren: Verweise umhängen, leere
// Felder ergänzen, E-Mails sammeln, zusammengeführte Kontakte deaktivieren.
export async function kontakteZusammenfuehren(behalten: string, weg: string[]): Promise<{ error?: string; ergebnis?: { behalten: string; zusammengefuehrt: number; konflikte_entfernt: number; email_weitere: string[] } }> {
  try {
    if (!behalten || !weg.length) return { error: 'Behaltener Kontakt und mindestens ein zusammenzuführender Kontakt nötig' }
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const { data, error } = await (supabase.rpc as any)('kontakte_zusammenfuehren', { p_tenant_id: tenantId, p_behalten: behalten, p_weg: weg })
    if (error) return { error: error.message }
    absenderIndexVerwerfen(tenantId)
    revalidatePath('/crm/dubletten')
    revalidatePath('/crm/kontakte')
    revalidatePath(`/crm/kontakte/${behalten}`)
    for (const id of weg) revalidatePath(`/crm/kontakte/${id}`)
    return { ergebnis: data as { behalten: string; zusammengefuehrt: number; konflikte_entfernt: number; email_weitere: string[] } }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// Gruppe als "keine Dublette" markieren: erscheint weder in der Liste noch im Morgenbericht
export async function dubletteIgnorieren(schluessel: string): Promise<{ error?: string }> {
  try {
    if (!schluessel) return { error: 'Kein Schlüssel' }
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await (supabase.from('crm_dubletten_ignoriert') as any)
      .upsert({ tenant_id: tenantId, schluessel, erstellt_von: user?.id ?? null }, { onConflict: 'tenant_id,schluessel' })
    if (error) return { error: error.message }
    revalidatePath('/crm/dubletten')
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// Mehrere Gruppen auf einmal (Stufe "unwahrscheinlich") als keine Dublette markieren
export async function dublettenIgnorierenViele(schluessel: string[]): Promise<{ error?: string; anzahl?: number }> {
  try {
    const liste = [...new Set(schluessel.filter(Boolean))]
    if (!liste.length) return { error: 'Keine Gruppen' }
    const supabase = await createSupabaseServerClient()
    const tenantId = await getTenantId()
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await (supabase.from('crm_dubletten_ignoriert') as any)
      .upsert(liste.map(k => ({ tenant_id: tenantId, schluessel: k, erstellt_von: user?.id ?? null })), { onConflict: 'tenant_id,schluessel' })
    if (error) return { error: error.message }
    revalidatePath('/crm/dubletten')
    return { anzahl: liste.length }
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) }
  }
}

// ── KAN-176: Lieferadressen je Kontakt bzw. Firma ───────────────────────────────────────────────────────────────
// Anlegen und Ändern mit Schreibrecht CRM; kein Löschen (Verkäufe verweisen darauf) – nur deaktivieren.
export async function lieferadresseSpeichern(formData: FormData): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await crmSchreibTenant()
    const id = String(formData.get('id') ?? '').trim() || null
    const kontaktId = String(formData.get('kontakt_id') ?? '').trim() || null
    const firmaId = String(formData.get('firma_id') ?? '').trim() || null
    if (!id && (kontaktId ? 1 : 0) + (firmaId ? 1 : 0) !== 1) return { error: 'Lieferadresse gehört zu genau einem Kontakt oder einer Firma.' }
    const a = lieferadresseAus(Object.fromEntries(formData.entries()), landPruefen(formData.get('land')))
    const fehler = lieferadresseFehler(a)
    if (fehler) return { error: fehler }
    const werte = { bezeichnung: a.bezeichnung, empfaenger: a.empfaenger, strasse: a.strasse, plz: a.plz, ort: a.ort, land: a.land,
      notizen: String(formData.get('notizen') ?? '').trim() || null }
    const tab = supabase.from('lieferadressen') as unknown as AR
    const { error } = id
      ? await tab.update(werte).eq('id', id).eq('tenant_id', tenantId)
      : await tab.insert({ ...werte, tenant_id: tenantId, kontakt_id: kontaktId, firma_id: firmaId })
    if (error) return { error: dbFehlerText(error, 'Lieferadresse konnte nicht gespeichert werden') }
    revalidatePath(kontaktId ? `/crm/kontakte/${kontaktId}` : firmaId ? `/crm/firmen/${firmaId}` : '/crm')
    if (id) { revalidatePath('/crm/kontakte'); revalidatePath('/crm/firmen') }
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler beim Speichern der Lieferadresse' }
  }
}

export async function lieferadresseAktivSetzen(id: string, aktiv: boolean, pfad: string): Promise<{ error?: string }> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await crmSchreibTenant()
    const { error } = await (supabase.from('lieferadressen') as unknown as AR).update({ aktiv }).eq('id', id).eq('tenant_id', tenantId)
    if (error) return { error: dbFehlerText(error, 'Lieferadresse konnte nicht geändert werden') }
    if (pfad.startsWith('/crm/')) revalidatePath(pfad)
    return {}
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Unbekannter Fehler' }
  }
}
