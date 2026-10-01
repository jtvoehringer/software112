'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { minQualitaet, maxQualitaet, istNiedrigerAls, QUALITAET_LABEL } from '@/lib/weinqualitaet'
import { qualitaetFehler } from '@/lib/wein/qualitaet'
import { minHerkunft, maxHerkunft, istNiedrigerAls as herkunftIstNiedrigerAls, HERKUNFT_LABEL } from '@/lib/herkunft'
import { weinartKonflikt, weinartBekannt, weinartAusFarbe, WEINART_LABEL } from '@/lib/keller/weinart'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { dezimal, zahlAus, fmtNum } from '@/lib/format'
import { gebindeFehlerText } from '@/lib/keller/behaelter'
import { sperreBeiFolgebuchungen, folgebuchungenDerCharge, folgebuchungenText } from '@/lib/kellerbuch/folgebuchungen'
import { planeVerschneidungStorno, storniereVerschneidung, GEBINDEWECHSEL_OHNE } from '@/lib/kellerbuch/storno'
import { stornoGrundFehler, STORNO_GRUND_MIN } from '@/lib/storno/grund'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// Aktiv gewählten Betrieb respektieren (Cookie-basiert) statt einer beliebigen/ersten
// tenant_memberships-Zeile – sonst können bei Mehrfach-Mitgliedschaft Daten des falschen
// Betriebs gelesen/verändert werden.
async function getTenantId(): Promise<string | null> {
  const membership = await getCurrentMembership()
  await pruefeSeitenBetrieb(membership?.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  return membership?.tenantId ?? null
}

// Für Aktionen, die mehrere Tabellen zurückbuchen bzw. löschen (Storno, Kellerbehandlung
// löschen): Schreibrecht im Kellerbuch vorab prüfen, statt halb an RLS zu scheitern.
async function kellerbuchSchreibrecht(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: vor den Rechten – sonst meldet ein veralteter Tab die Rechte des neuen Betriebs
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return membership.tenantId
}

const rund2 = (n: number): number => Math.round(n * 100) / 100

/** Qualitätsstufe einer Charge aus dem Formular – KAN-73: nur Werte des CHECK weinausbau
 *  (QUALITAET_OPTS), sonst verständliche Meldung statt 23514; leer bleibt null wie bisher. */
function chargenQualitaetAusFormular(formData: FormData): string | null {
  const wert = (formData.get('qualitaetsstufe') as string) || null
  const fehler = qualitaetFehler('charge', wert)
  if (fehler) throw new AktionsFehler(fehler)
  return wert
}

// BEHAELTER
export async function createBehaelter(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const payload: R = {
    tenant_id:     tenantId,
    name:          formData.get('name') as string,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number(dezimal((formData.get('volumen_liter') as string))) : null,
    standort:      (formData.get('standort') as string) || null,
    notizen:       (formData.get('notizen') as string)?.trim() || null,
    stapler:       formData.get('stapler') === 'true',
    // Kellergemeinschaft (Migration 203): Checkbox nur im Formular, wenn Partner bestehen -
    // fehlt sie, bleibt der Default (freigegeben), sonst der gesetzte Wert.
    ...(formData.has('gemeinsam_sichtbar') ? { gemeinsam: formData.get('gemeinsam') === 'true' } : {}),
    aktiv:         true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).insert(payload)
  if (error) throw new AktionsFehler((error as R).message)
  revalidatePath('/kellerbuch')
}

// Rückmeldung 29.8.2026: "wenn eine Gebinde im lfd. Betrieb umbenannt wird,
// dann notiere das bitte in den Maßnahmen!" - die "Maßnahmen" je Behälter
// sind die Kellerbehandlungen (Tabelle keller_behandlungen, Seite
// .../behaelter/[id]/behandlungen, taucht dort UND im Bewegungsbuch als
// Eintrag mit art:'behandlung' auf, siehe bewegungen/page.tsx). Bei
// tatsächlicher Namensänderung wird hier automatisch ein solcher Eintrag mit
// Typ "Umbenennung" angelegt (Menge/Einheit bewusst leer - reine
// Protokollnotiz, keine Mengenbewegung). Der Typ "Umbenennung" wird beim
// allerersten Mal je Mandant automatisch angelegt (find-or-create per Name),
// exakt nach demselben Muster wie der Bot-Tool-Handler in
// src/lib/assistent/tools/kellerbehandlung.ts für neue Behandlungstypen.
// Schlägt das Protokollieren aus irgendeinem Grund fehl, soll das die
// eigentliche (bereits gespeicherte) Umbenennung nicht rückgängig machen -
// daher nur geloggt, nicht geworfen.
async function protokolliereGebindeUmbenennung(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  tenantId: string,
  behaelterId: string,
  alterName: string,
  neuerName: string
) {
  const TYP_NAME = 'Umbenennung'
  const { data: bestehenderTyp } = await (supabase.from('keller_behandlungstypen') as any)
    .select('id').eq('tenant_id', tenantId).ilike('name', TYP_NAME).maybeSingle()
  let typId = (bestehenderTyp as R | null)?.id ?? null
  if (!typId) {
    const { data: neuerTyp, error: typErr } = await (supabase.from('keller_behandlungstypen') as any)
      .insert({ tenant_id: tenantId, name: TYP_NAME, einheit_standard: '-' })
      .select('id').single()
    if (typErr) {
      console.error('[protokolliereGebindeUmbenennung] Typ konnte nicht angelegt werden:', (typErr as R).message)
      return
    }
    typId = (neuerTyp as R).id
  }

  const { error: behErr } = await (supabase.from('keller_behandlungen') as any).insert({
    tenant_id:         tenantId,
    behaelter_id:      behaelterId,
    datum:             new Date().toISOString().slice(0, 10),
    typ_id:            typId,
    typ_name_snapshot: TYP_NAME,
    notizen:           `Gebinde umbenannt von „${alterName}" zu „${neuerName}"`,
  })
  if (behErr) {
    console.error('[protokolliereGebindeUmbenennung] Eintrag konnte nicht gespeichert werden:', (behErr as R).message)
  }
}

export async function updateBehaelter(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const neuerName = formData.get('name') as string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: altRow } = await (supabase.from('behaelter') as any)
    .select('name').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  const alterName = (altRow as R | null)?.name ?? null

  const payload: R = {
    name:          neuerName,
    typ:           (formData.get('typ') as string) || null,
    volumen_liter: formData.get('volumen_liter') ? Number(dezimal((formData.get('volumen_liter') as string))) : null,
    standort:      (formData.get('standort') as string) || null,
    notizen:       (formData.get('notizen') as string)?.trim() || null,
    stapler:       formData.get('stapler') === 'true',
    ...(formData.has('gemeinsam_sichtbar') ? { gemeinsam: formData.get('gemeinsam') === 'true' } : {}),
    aktiv:         formData.get('aktiv') === 'true',
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler((error as R).message)

  if (alterName && neuerName && alterName.trim() !== neuerName.trim()) {
    await protokolliereGebindeUmbenennung(supabase, tenantId, id, alterName, neuerName)
  }

  revalidatePath('/kellerbuch')
}

export async function deleteBehaelter(id: string): Promise<{ error?: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) return { error: 'Kein Betrieb gefunden' }

  // KAN-35: Vorprüfung auf ALLE Chargen des Gebindes (auch inaktive/abgeschlossene – bisher
  // nur aktive, die übrigen wurden per FK still abgekoppelt) und auf Kellerbehandlungen
  // (bisher per FK-Kaskade still mitgelöscht). Seit Migration kan35_datenintegritaet sperren
  // beide FKs (NO ACTION) auch in der DB.
  const SPERRE = 'Gebinde hat Chargen-Historie bzw. Kellerbehandlungen und kann nicht gelöscht werden – bitte über „Bearbeiten“ inaktiv setzen, die Historie bleibt so erhalten.'
  const [chargenRes, behandlungenRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('weinausbau') as any)
      .select('id', { count: 'exact', head: true }).eq('behaelter_id', id).eq('tenant_id', tenantId),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('keller_behandlungen') as any)
      .select('id', { count: 'exact', head: true }).eq('behaelter_id', id).eq('tenant_id', tenantId),
      // storno-sichtbar: auch stornierte Behandlungen sind Historie des Gebindes – dann nicht löschen
  ])
  if (chargenRes.error) return { error: dbFehlerText(chargenRes.error, 'Prüfung fehlgeschlagen (weinausbau)') }
  if (behandlungenRes.error) return { error: dbFehlerText(behandlungenRes.error, 'Prüfung fehlgeschlagen (keller_behandlungen)') }
  if ((chargenRes.count ?? 0) > 0 || (behandlungenRes.count ?? 0) > 0) return { error: SPERRE }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: geloescht, error } = await (supabase.from('behaelter') as any)
    .delete().eq('id', id).eq('tenant_id', tenantId).select('id')
  if (error) {
    // 23503 = foreign_key_violation (NO ACTION) – u. a. Chargen oder Kellerbehandlungen eines
    // Partnerbetriebs (Kellergemeinschaft, per RLS unsichtbar), Umzug- oder Pressungszeilen.
    // dbFehlerText liefert je FK die passende deutsche Meldung („… inaktiv setzen“).
    return { error: dbFehlerText(error, 'Löschen fehlgeschlagen (behaelter)') }
  }
  if (!geloescht || (geloescht as R[]).length === 0) {
    return { error: 'Gebinde nicht gefunden oder keine Berechtigung zum Löschen.' }
  }
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
  return {}
}

// WEINAUSBAU
export async function createWeinausbau(formData: FormData) {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const payload: R = {
    tenant_id:       tenantId,
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(dezimal(formData.get('jahrgang'))) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    behaelter_id:    (formData.get('behaelter_id') as string) || null,
    menge_liter:          formData.get('menge_liter') ? Number(dezimal((formData.get('menge_liter') as string))) : null,
    anfangsbestand_liter: formData.get('menge_liter') ? Number(dezimal((formData.get('menge_liter') as string))) : null,
    qualitaetsstufe:      chargenQualitaetAusFormular(formData),
    status:               (formData.get('status') as string) || 'ernte',
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number(dezimal((formData.get('einstandspreis_pro_liter') as string)))
      : null,
    aktiv:           true,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: newWA, error } = await (supabase.from('weinausbau') as any).insert(payload).select('id').single()
  if (error) throw new AktionsFehler((error as R).message)
  // Junction-Tabelle: Rieden/Weingärten verknüpfen
  if (wgIds.length > 0 && (newWA as R)?.id) {
    const waId = (newWA as R).id as string
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('weinausbau_weingaerten') as any).insert(
      wgIds.map(wgId => ({ tenant_id: tenantId, weinausbau_id: waId, weingarten_id: wgId }))
    )
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau_weingaerten): ${e.message}`) }
  }
  revalidatePath('/kellerbuch')
}

// Charge bearbeiten (KAN-35, 24.09.2026)
// * menge_liter wird hier NICHT mehr geschrieben – Bestandsänderungen nur als datierte
//   Buchung (Schwund buchen, Umzug, Füllung, Verkauf). Das Formular zeigt die Menge nur an.
// * Gebindewechsel nur ohne Folgebuchungen (sonst wäre es ein Umzug ohne Bewegungszeile)
//   und nie bei Pressungs-Chargen (Zielgebinde steht in der Pressung).
// * Deaktivieren/Abschließen nur bei leerer Charge (≤ 0,01 L) – sonst verschwände Bestand
//   aus Dashboard und Listen, während die View ihn weiterzählt.
// * Merkmale (Bezeichnung, Rebsorte, Qualität, Weinart, Rieden, Preis, Notizen) bleiben
//   änderbar; bestandsrelevante Änderungen protokolliert die DB (bestandsprotokoll).
export async function updateWeinausbau(id: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: altRaw, error: altErr } = await (supabase.from('weinausbau') as any)
    .select('id, behaelter_id, menge_liter, aktiv, status')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (altErr) throw new AktionsFehler(dbFehlerText(altErr, 'Charge konnte nicht geladen werden'))
  if (!altRaw) throw new AktionsFehler('Charge nicht gefunden')
  const alt = altRaw as R
  const bestand = parseFloat(alt.menge_liter) || 0

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const neuAktiv  = formData.get('aktiv') === 'true'
  const neuStatus = (formData.get('status') as string) || (alt.status as string)
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(dezimal(formData.get('jahrgang'))) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    qualitaetsstufe:      chargenQualitaetAusFormular(formData),
    weinart:              (formData.get('weinart') as string) || 'unbekannt',
    status:               neuStatus,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number(dezimal((formData.get('einstandspreis_pro_liter') as string)))
      : null,
    aktiv:           neuAktiv,
  }

  // Deaktivieren/Abschließen nur ohne Bestand
  const wirdDeaktiviert   = alt.aktiv && !neuAktiv
  const wirdAbgeschlossen = alt.status !== 'abgeschlossen' && neuStatus === 'abgeschlossen'
  if (bestand > 0.01 && (wirdDeaktiviert || wirdAbgeschlossen)) {
    throw new AktionsFehler(
      `Die Charge hat noch ${fmtNum(bestand, 2)} L Bestand und kann deshalb nicht ${wirdDeaktiviert ? 'deaktiviert' : 'abgeschlossen'} werden. Bitte den Wein zuerst abfüllen, umziehen, verkaufen oder als Schwund buchen – bei 0 L wird die Charge automatisch abgeschlossen.`,
    )
  }

  // KAN-150 F1d: Herkunft geändert? Ab der ersten Folgebuchung nur mit Grund (vor dem Speichern prüfen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: wgAltRaw, error: wgAltErr } = await (supabase.from('weinausbau_weingaerten') as any)
    .select('weingarten_id')
    .eq('weinausbau_id', id)
    .eq('tenant_id', tenantId)
  if (wgAltErr) throw new AktionsFehler(dbFehlerText(wgAltErr, 'Herkunft der Charge konnte nicht geladen werden'))
  const wgAlt = new Set(((wgAltRaw ?? []) as R[]).map(r => r.weingarten_id as string))
  const wgNeu = new Set(wgIds)
  const herkunftGeaendert = wgAlt.size !== wgNeu.size || [...wgNeu].some(x => !wgAlt.has(x))
  const herkunftGrund = ((formData.get('herkunft_grund') as string | null) ?? '').trim()
  if (herkunftGeaendert && herkunftGrund.length < STORNO_GRUND_MIN) {
    const f = await folgebuchungenDerCharge(supabase, id)
    if (f.length > 0) {
      throw new AktionsFehler(
        `An der Charge ${f.length === 1 && f[0].anzahl === 1 ? 'hängt' : 'hängen'} bereits ${folgebuchungenText(f)} – bitte einen Grund für die Änderung der Herkunft angeben (mindestens ${STORNO_GRUND_MIN} Zeichen).`,
      )
    }
  }

  // Gebindewechsel nur ohne Folgebuchungen
  if (formData.has('behaelter_id')) {
    const neuesGebinde = (formData.get('behaelter_id') as string) || null
    if (neuesGebinde !== ((alt.behaelter_id as string | null) ?? null)) {
      // Pressungs-Chargen: das Gebinde steht in pressung_behaelter (Tabelle ohne tenant_id, RLS über pressungen)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count: pbAnzahl, error: pbErr } = await (supabase.from('pressung_behaelter') as any)
        .select('id', { count: 'exact', head: true })
        .eq('weinausbau_id', id)
        .is('storniert_am', null)
      if (pbErr) throw new AktionsFehler(dbFehlerText(pbErr, 'Pressung der Charge konnte nicht geprüft werden'))
      if ((pbAnzahl ?? 0) > 0) {
        throw new AktionsFehler('Der Gebindewechsel ist nicht möglich: Die Charge stammt aus einer Pressung. Bitte das Gebinde in der Erntemeldung ändern bzw. den Wechsel als Umzug buchen (Kellerbuch › Umziehen).')
      }
      await sperreBeiFolgebuchungen(supabase, id, 'Der Gebindewechsel', {
        ohne: GEBINDEWECHSEL_OHNE,
        hinweis: 'Bitte den Wechsel als Umzug buchen (Kellerbuch › Umziehen) – so bleibt das Bewegungsbuch beider Gebinde stimmig.',
      })
      payload.behaelter_id = neuesGebinde
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinausbau') as any).update(payload).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(gebindeFehlerText(dbFehlerText(error, 'Speichern fehlgeschlagen (weinausbau)')))

  // KAN-150 F1d: Herkunft (Rieden) nur als Differenz ändern – die RPC protokolliert alte und neue Rieden samt Grund.
  // Ab der ersten Folgebuchung ist der Grund Pflicht (dann steht die Charge schon in Weinbuch bzw. Meldungen).
  if (herkunftGeaendert) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: e } = await (supabase as any).rpc('s112_herkunft_setzen', {
      p_tenant_id: tenantId, p_weinausbau_id: id, p_weingarten_ids: wgIds, p_grund: herkunftGrund || null,
    })
    if (e) throw new AktionsFehler(dbFehlerText(e, 'Herkunft der Charge konnte nicht gespeichert werden'))
  }

  // KEIN Sync auf pressung_behaelter.menge_liter – das ist der historische Pressbetrag
  // und darf nicht mit dem laufenden Bestand überschrieben werden.

  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
}

// ANALYSEN
export async function createAnalyse(formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const weinausbauId = formData.get('weinausbau_id') as string
  if (!weinausbauId) throw new AktionsFehler('Keine Charge angegeben')

  function numOrNull(key: string): number | null {
    const v = dezimal(formData.get(key) as string).trim()
    if (!v) return null
    const n = parseFloat(v)
    return isNaN(n) ? null : n
  }

  const payload: R = {
    tenant_id:            tenantId,
    weinausbau_id:        weinausbauId,
    analyse_datum:        formData.get('analyse_datum') as string,
    labor:                (formData.get('labor') as string) || null,
    probe_nr:             (formData.get('probe_nr') as string) || null,
    alkohol_vol:          numOrNull('alkohol_vol'),
    restzucker_gl:        numOrNull('restzucker_gl'),
    gesamtsaeure_gl:      numOrNull('gesamtsaeure_gl'),
    ph_wert:              numOrNull('ph_wert'),
    // Spaltenname im DB hat Umlaut – via Alias im Formular (fluechtige_saeure_gl)
    'flüchtige_saeure_gl': numOrNull('fluechtige_saeure_gl'),
    freie_so2_mgl:        numOrNull('freie_so2_mgl'),
    gesamt_so2_mgl:       numOrNull('gesamt_so2_mgl'),
    bewertung:            (formData.get('bewertung') as string) || null,
    notizen:              (formData.get('notizen') as string) || null,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinanalysen') as any).insert(payload)
  if (error) throw new AktionsFehler((error as R).message)

  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/analysen`)
  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/buch`)
}

// VERSCHNEIDUNG
// KAN-35 (24.09.2026): Alle Prüfungen laufen serverseitig VOR der ersten Buchung – jede Quelle
// braucht eine Menge ≥ 0,01 L, gehört zum Betrieb und hat genug Bestand (je Charge summiert);
// die Weinart-Sperre greift ebenfalls vorher (bisher erst nach dem Anlegen des Verschnitts).
// Die Quellen werden nicht mehr mit Math.max(0, …) gekappt, sondern bei Rest ≤ 0,01 L
// abgeschlossen – ein Mehr als der Bestand wird vorher abgelehnt.
export async function createVerschneidung(formData: FormData): Promise<{ qualitaetAbgestuft: { von: string; nach: string } | null; herkunftAbgestuft: { von: string; nach: string } | null }> {
  const supabase  = await createSupabaseServerClient()
  const tenantId  = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const datum        = formData.get('datum') as string
  const zielId       = formData.get('ziel_weinausbau_id') as string
  const notizen      = (formData.get('notizen') as string) || null
  const quellenJson  = formData.get('quellen_json') as string
  let quellenRoh: unknown
  try {
    quellenRoh = JSON.parse(quellenJson || '[]')
  } catch {
    throw new AktionsFehler('Ungültige Eingabe: Quellen konnten nicht gelesen werden.')
  }
  if (!Array.isArray(quellenRoh)) throw new AktionsFehler('Ungültige Eingabe: Quellen fehlen.')
  // JSON-Zahlen direkt übernehmen (zahlAus würde „1.234“ als Tausenderpunkt lesen)
  const quellen: { weinausbau_id: string; menge_liter: number }[] = (quellenRoh as R[]).map(q => ({
    weinausbau_id: typeof q?.weinausbau_id === 'string' ? q.weinausbau_id : '',
    menge_liter:   typeof q?.menge_liter === 'number' ? q.menge_liter : (zahlAus(q?.menge_liter) ?? NaN),
  }))

  if (!datum || !zielId || quellen.length === 0) throw new AktionsFehler('Pflichtfelder fehlen')
  for (const q of quellen) {
    if (!q.weinausbau_id) throw new AktionsFehler('Bei einer Quelle des Verschnitts fehlt die Charge.')
    if (!Number.isFinite(q.menge_liter) || q.menge_liter < 0.01) {
      throw new AktionsFehler('Jede Quelle eines Verschnitts braucht eine Menge von mindestens 0,01 L.')
    }
    if (q.weinausbau_id === zielId) throw new AktionsFehler('Die Ziel-Charge kann nicht zugleich Quelle des Verschnitts sein.')
  }

  // Ziel-Charge laden (Mandant) – Qualitätsstufe + Herkunft-Code vor der Verschneidung sichern
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: zielRaw, error: zielErr } = await (supabase.from('weinausbau') as any)
    .select('id, menge_liter, rebsorte, weinart, qualitaetsstufe, herkunft_code')
    .eq('id', zielId).eq('tenant_id', tenantId).maybeSingle()
  if (zielErr) throw new AktionsFehler(dbFehlerText(zielErr, 'Ziel-Charge konnte nicht geladen werden'))
  if (!zielRaw) throw new AktionsFehler('Ziel-Charge nicht gefunden')
  const zielVorher = zielRaw as R
  const zielQualitaetVorher = (zielVorher.qualitaetsstufe as string | null) ?? null
  const zielHerkunftVorher  = (zielVorher.herkunft_code as string | null) ?? null

  // Quell-Chargen: gehören zum Betrieb, Menge ≤ Bestand (je Charge summiert)
  const bedarf = new Map<string, number>()
  for (const q of quellen) bedarf.set(q.weinausbau_id, (bedarf.get(q.weinausbau_id) ?? 0) + q.menge_liter)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: quellenData, error: quellenErr } = await (supabase.from('weinausbau') as any)
    .select('id, name, menge_liter, qualitaetsstufe, rebsorte, weinart, herkunft_code')
    .in('id', [...bedarf.keys()])
    .eq('tenant_id', tenantId)
  if (quellenErr) throw new AktionsFehler(dbFehlerText(quellenErr, 'Quell-Chargen konnten nicht geladen werden'))
  const quellenRows = (quellenData ?? []) as R[]
  for (const [qid, menge] of bedarf) {
    const row = quellenRows.find(r => r.id === qid)
    if (!row) throw new AktionsFehler('Quell-Charge nicht gefunden – sie gehört nicht zu diesem Betrieb.')
    const verfuegbar = parseFloat(row.menge_liter) || 0
    if (menge > verfuegbar + 0.01) {
      throw new AktionsFehler(`„${row.name}“: Verschnittmenge (${fmtNum(menge, 2)} L) übersteigt den Bestand der Charge (${fmtNum(verfuegbar, 2)} L).`)
    }
  }

  // Guard: Rotwein + Weißwein darf nicht verschnitten werden (lib/keller/weinart.ts; Chargen
  // ohne Weinart werden über die Rebsortenfarbe eingeordnet, 21.9.2026) – vor der ersten Buchung
  const farbe = new Map<string, string>()
  {
    const sorten = [...new Set([...quellenRows, zielVorher].map((r: R) => r.rebsorte).filter(Boolean))] as string[]
    // tenant-isolation-ignore: rebsorten ist eine globale Stammtabelle ohne tenant_id
    const { data: rs } = sorten.length ? await (supabase.from('rebsorten') as any).select('name_de, farbe').in('name_de', sorten) : { data: [] }
    for (const r of (rs ?? []) as R[]) farbe.set(r.name_de, r.farbe)
  }
  const artVon = (r: R | null): string => r ? (weinartBekannt(r.weinart) ? r.weinart : weinartAusFarbe(farbe.get(r.rebsorte))) : 'unbekannt'
  const zielWeinart = artVon(zielVorher)
  const quelleKonflikt = quellenRows.find((q: R) => weinartKonflikt(artVon(q), zielWeinart))
  if (quelleKonflikt) throw new AktionsFehler(`Rot- und Weißwein dürfen laut Weingesetz nicht verschnitten werden (${WEINART_LABEL[artVon(quelleKonflikt)]} in ${WEINART_LABEL[zielWeinart]}).`)

  // Verschneidungs-Datensatz anlegen
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: neu, error: ve } = await (supabase.from('verschneidungen') as any)
    .insert({ tenant_id: tenantId, datum, ziel_weinausbau_id: zielId, notizen, ziel_qualitaet_vorher: zielQualitaetVorher, ziel_herkunft_code_vorher: zielHerkunftVorher,
      ziel_rebsorte_vorher: (zielVorher.rebsorte as string | null) ?? null })   // KAN-145: Storno stellt die Rebsorte wieder her
    .select('id').single()
  if (ve) throw new AktionsFehler(dbFehlerText(ve, 'Speichern fehlgeschlagen (verschneidungen)'))
  const vId = (neu as R).id as string

  // Quellen anlegen + anteil_pct berechnen
  const gesamtLiter = quellen.reduce((s, q) => s + q.menge_liter, 0)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  { const { error: e } = await (supabase.from('verschneidung_quellen') as any).insert(
    quellen.map(q => ({
      verschneidung_id:    vId,
      quell_weinausbau_id: q.weinausbau_id,
      menge_liter:         q.menge_liter,
      anteil_pct:          gesamtLiter > 0 ? Math.round((q.menge_liter / gesamtLiter) * 1000) / 10 : null,
    }))
  )
    if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (verschneidung_quellen): ${dbFehlerText(e)}`) }

  // Niedrigste Qualitaetsstufe aus Quellen + Ziel bestimmen
  const alleQualitaeten = [zielQualitaetVorher, ...quellenRows.map((q: R) => q.qualitaetsstufe as string | null)]
  const neueQualitaet = minQualitaet(alleQualitaeten)
  // Niedrigsten (breitesten) Herkunft-Code aus Quellen + Ziel bestimmen – kann durch Verschneiden
  // rechnerisch nie aufgestuft werden (dieselbe Logik wie bei der Qualität).
  const alleHerkuenfte = [zielHerkunftVorher, ...quellenRows.map((q: R) => q.herkunft_code as string | null)]
  const neueHerkunft = minHerkunft(alleHerkuenfte)

  // Ziel-Charge: Bestand erhöhen + Rebsorte nach 85%-Regel + Qualität anpassen
  const aktuell = parseFloat(zielVorher.menge_liter ?? '0') || 0
  const zielRebsorteJetzt = (zielVorher.rebsorte as string | null) ?? null
  // Rebsorten-Anteile über alle beteiligten Mengen berechnen
  const total = aktuell + gesamtLiter
  const anteile: Record<string, number> = {}
  if (zielRebsorteJetzt && aktuell > 0) {
    anteile[zielRebsorteJetzt] = (anteile[zielRebsorteJetzt] ?? 0) + aktuell
  }
  for (const q of quellen) {
    const qRebsorte = (quellenRows.find((r: R) => r.id === q.weinausbau_id) as R | undefined)?.rebsorte as string | null ?? null
    if (qRebsorte) anteile[qRebsorte] = (anteile[qRebsorte] ?? 0) + q.menge_liter
  }
  const dominante = Object.entries(anteile).sort((a, b) => b[1] - a[1])[0]
  const dominanterAnteil = dominante && total > 0 ? dominante[1] / total : 0
  // ≥ 85 %: Rebsorte bleibt; < 85 %: Sortenverschnitt
  // Dominante Rebsorte verwenden (nicht zielRebsorteJetzt, da Quelle dominieren kann)
  const neueRebsorte = dominanterAnteil >= 0.85 ? (dominante[0] ?? zielRebsorteJetzt) : 'Sortenverschnitt'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: zielUpdateErr } = await (supabase.from('weinausbau') as any)
    .update({
      menge_liter: rund2(aktuell + gesamtLiter),
      rebsorte: neueRebsorte,
      qualitaetsstufe: neueQualitaet,
      herkunft_code: neueHerkunft,
    })
    .eq('id', zielId)
    .eq('tenant_id', tenantId)
  if (zielUpdateErr) throw new AktionsFehler(`Ziel-Charge konnte nicht aktualisiert werden: ${dbFehlerText(zielUpdateErr)}`)

  // Quell-Chargen: Bestand reduzieren (je Charge einmal, oben gegen den Bestand geprüft);
  // Rest ≤ 0,01 L wird mit ausgebucht und die Charge abgeschlossen
  for (const [qid, menge] of bedarf) {
    const row = quellenRows.find(r => r.id === qid)!
    const rest = rund2((parseFloat(row.menge_liter) || 0) - menge)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('weinausbau') as any)
      .update(rest <= 0.01
        ? { menge_liter: 0, aktiv: false, status: 'abgeschlossen' }
        : { menge_liter: rest })
      .eq('id', qid)
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (weinausbau): ${dbFehlerText(e)}`) }
  }

  // Qualitäts-Abstufung: Vergleich gegen HÖCHSTE Qualität aller Beteiligten (Ziel + Quellen).
  // Beispiel: Ziel Kabinett + Quelle Auslese → Ergebnis Kabinett → Abstufung von Auslese auf Kabinett.
  const alleQualitaetenBeteiligt = [zielQualitaetVorher, ...quellenRows.map((q: R) => q.qualitaetsstufe as string | null)]
  const hoechsteQualitaet = maxQualitaet(alleQualitaetenBeteiligt)
  const qualitaetAbgestuft: { von: string; nach: string } | null =
    (neueQualitaet && hoechsteQualitaet && istNiedrigerAls(neueQualitaet, hoechsteQualitaet))
      ? { von: hoechsteQualitaet, nach: neueQualitaet }
      : null

  // Herkunft-Abstufung: Vergleich gegen die ENGSTE Herkunftsstufe aller Beteiligten (Ziel + Quellen).
  const alleHerkuenfteBeteiligt = [zielHerkunftVorher, ...quellenRows.map((q: R) => q.herkunft_code as string | null)]
  const engsteHerkunft = maxHerkunft(alleHerkuenfteBeteiligt)
  const herkunftAbgestuft: { von: string; nach: string } | null =
    (neueHerkunft && engsteHerkunft && herkunftIstNiedrigerAls(neueHerkunft, engsteHerkunft))
      ? { von: engsteHerkunft, nach: neueHerkunft }
      : null

  // Abstufungs-Info automatisch in Notizen speichern
  const abstufTexte: string[] = []
  if (qualitaetAbgestuft) {
    const vonLabel  = QUALITAET_LABEL[qualitaetAbgestuft.von]  ?? qualitaetAbgestuft.von
    const nachLabel = QUALITAET_LABEL[qualitaetAbgestuft.nach] ?? qualitaetAbgestuft.nach
    abstufTexte.push(`Abstufung Qualität von ${vonLabel} auf ${nachLabel}`)
  }
  if (herkunftAbgestuft) {
    const vonLabel  = HERKUNFT_LABEL[herkunftAbgestuft.von]  ?? herkunftAbgestuft.von
    const nachLabel = HERKUNFT_LABEL[herkunftAbgestuft.nach] ?? herkunftAbgestuft.nach
    abstufTexte.push(`Abstufung Herkunft-Code (BKI) von ${vonLabel} auf ${nachLabel}`)
  }
  if (abstufTexte.length > 0) {
    const neueNotizen = notizen ? `${notizen}\n${abstufTexte.join('\n')}` : abstufTexte.join('\n')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { const { error: e } = await (supabase.from('verschneidungen') as any)
      .update({ notizen: neueNotizen })
      .eq('id', vId)
      .eq('tenant_id', tenantId)
      if (e) throw new AktionsFehler(`Speichern fehlgeschlagen (verschneidungen): ${dbFehlerText(e)}`) }
  }

  revalidatePath('/kellerbuch')
  quellen.forEach(q => revalidatePath(`/kellerbuch/weinausbau/${q.weinausbau_id}/buch`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)

  return { qualitaetAbgestuft, herkunftAbgestuft }
}

// VERSCHNEIDUNG STORNIEREN (KAN-35, 24.09.2026)
// Nur solange die Ziel-Charge seit dem Verschnitt nicht weiterbewegt wurde (keine später
// erfasste Mengenbewegung – dadurch ist es immer der jüngste Verschnitt auf das Ziel, und der
// Qualitäts-/Herkunfts-Snapshot stimmt) und die Ziel-Charge die Menge noch vollständig hat
// (kein Kappen bei 0 mehr). Quellen, die durch den Verschnitt abgeschlossen wurden, werden
// wieder aktiv. Seit KAN-145 bleibt der Verschnitt stehen und wird mit Grund als storniert gekennzeichnet
// (Protokoll); die Rebsorte der Ziel-Charge kommt aus ziel_rebsorte_vorher zurück (Verschnitte ab 30.09.2026).
export async function deleteVerschneidung(verschneidungId: string, grund: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId  = await kellerbuchSchreibrecht()

  const plan = await planeVerschneidungStorno(supabase, tenantId, verschneidungId)
  const v = plan.verschneidung
  const zielId = v.ziel_weinausbau_id as string
  const quellen = (v.quellen ?? []) as R[]

  // Quellen gutschreiben (ggf. wieder aktiv), Ziel reduzieren (ggf. abschließen) samt
  // Qualitätsstufe/Herkunft-Code/Rebsorte aus dem Snapshot, danach den Verschnitt als storniert
  // kennzeichnen (bleibt samt Quellen stehen, Protokoll). Alles oder nichts: scheitert
  // ein Schritt, werden die bereits ausgeführten Rückbuchungen zurückgenommen.
  await storniereVerschneidung(supabase, tenantId, plan, grund)

  revalidatePath('/kellerbuch')
  quellen.forEach((q: R) => revalidatePath(`/kellerbuch/weinausbau/${q.quell_weinausbau_id}`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
}

// SCHWUND BUCHEN (Chargen-Seite, KAN-35)
// Echter Schwund einer Charge (Verdunstung, Verlust beim Ausbau): datierte Zeile im
// Bewegungsbuch UND Bestand mindern – atomar über die RPC schwund_buchen (p_bestand_mindern).
// Bleiben ≤ 0,01 L, bucht die RPC den Rest mit aus und schließt die Charge ab.
// Das ist der Korrekturweg nach unten, seit menge_liter im Formular nicht mehr änderbar ist.
export async function schwundBuchen(weinausbauId: string, formData: FormData) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const liter = zahlAus(formData.get('menge'))
  const datum = ((formData.get('datum') as string) || '').trim()
  const notiz = ((formData.get('notiz') as string) || '').trim() || null
  if (liter == null || liter < 0.01) throw new AktionsFehler('Bitte eine Schwundmenge von mindestens 0,01 L angeben.')
  if (!datum) throw new AktionsFehler('Bitte ein Datum für den Schwund angeben.')

  // Mit dem Benutzer-Client und Parameternamen – sonst fehlt der Benutzer im Protokoll
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('schwund_buchen', {
    p_tenant_id:       tenantId,
    p_weinausbau_id:   weinausbauId,
    p_liter:           rund2(liter),
    p_datum:           datum,
    p_notiz:           notiz,
    p_bestand_mindern: true,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Schwund konnte nicht gebucht werden'))

  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}`)
  revalidatePath('/kellerbuch/behaelter', 'layout')
}

// MANUELLER SCHWUND (Nachbuchung im Behälter-Bewegungsbuch)
// Bucht eine Schwund-Zeile (umzug_typ 'schwund') über die RPC schwund_buchen mit
// p_bestand_mindern = false: nur die datierte Zeile im Bewegungsbuch, menge_liter der Charge
// bleibt unverändert – für Restmengen, die im Bewegungsbuch stehen, im Bestand der Charge
// aber schon fehlen (z. B. abgeschlossene 0-L-Chargen). Seit KAN-35 gleicht kein Seitenaufruf
// den Bestand mehr nachträglich an; echter Schwund läuft über schwundBuchen (Chargen-Seite).
// Die Zeile landet im aktuellen Gebinde der Charge (nach_behaelter_id).

export async function manuellSchwundBuchen(formData: FormData) {
  const supabase     = await createSupabaseServerClient()
  const tenantId     = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const behaelterId  = formData.get('behaelter_id')  as string
  const weinausbauId = formData.get('weinausbau_id') as string
  const menge        = zahlAus(formData.get('menge')) ?? 0
  const datum        = formData.get('datum') as string

  if (!behaelterId || !weinausbauId || menge < 0.01 || !datum) {
    throw new AktionsFehler('Ungültige Eingabe: alle Felder sind erforderlich, die Menge muss mindestens 0,01 L betragen')
  }

  // Mit dem Benutzer-Client und Parameternamen – sonst fehlt der Benutzer im Protokoll
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('schwund_buchen', {
    p_tenant_id:       tenantId,
    p_weinausbau_id:   weinausbauId,
    p_liter:           rund2(menge),
    p_datum:           datum,
    p_notiz:           'Manueller Schwund (Nachbuchung)',
    p_bestand_mindern: false,
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Schwund konnte nicht gebucht werden'))

  revalidatePath(`/kellerbuch/behaelter/${behaelterId}/bewegungen`)
  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}`)
  revalidatePath('/kellerbuch')
}

// KELLERBEHANDLUNG
//
// Server-Action-Kapselung für keller_behandlungen – dieser Prozess lief bisher
// ausschließlich über direkte Client-seitige Schreibzugriffe (createSupabaseBrowserClient
// in der Kellerbehandlungen-Seite). Damit der Prozess-Assistent (Bot) denselben
// Tool-Handler-Ansatz wie bei den übrigen Prozessen nutzen kann, kapselt diese neue Action
// exakt dieselbe Insert-Logik in einer Server Action (siehe Konzeptdokument Abschnitt 3b).
// Die Seite legt an und bearbeitet weiterhin über den Browser-Client; gelöscht wird seit
// KAN-35 nur noch über deleteKellerbehandlung (unten).
export async function createKellerbehandlung(formData: FormData): Promise<{ id: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  const behaelterId = formData.get('behaelter_id') as string
  if (!behaelterId) throw new AktionsFehler('Kein Behälter angegeben')
  const datum = formData.get('datum') as string
  if (!datum) throw new AktionsFehler('Kein Datum angegeben')
  const typId = formData.get('typ_id') as string
  if (!typId) throw new AktionsFehler('Kein Behandlungstyp angegeben')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: typRaw } = await (supabase.from('keller_behandlungstypen') as any)
    .select('id, name, einheit_standard').eq('id', typId).eq('tenant_id', tenantId).maybeSingle()
  if (!typRaw) throw new AktionsFehler('Behandlungstyp nicht gefunden')
  const typ = typRaw as R

  const menge   = formData.get('menge') ? parseFloat(dezimal((formData.get('menge') as string))) : null
  const einheit = (formData.get('einheit') as string) || (typ.einheit_standard as string | null) || null

  // Volumen Ist: falls nicht angegeben, aktuellen Gesamtinhalt des Behälters (Summe aktiver
  // Chargen) als sinnvollen Default nachladen – wie in der bestehenden Seite vorbelegt.
  let volumenLiterIst = formData.get('volumen_liter_ist')
    ? parseFloat(dezimal((formData.get('volumen_liter_ist') as string)))
    : null
  if (volumenLiterIst == null) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: chargenImBehaelter } = await (supabase.from('weinausbau') as any)
      .select('menge_liter').eq('behaelter_id', behaelterId).eq('aktiv', true).eq('tenant_id', tenantId)
    const summe = ((chargenImBehaelter ?? []) as R[]).reduce((s, w) => s + (parseFloat(w.menge_liter) || 0), 0)
    volumenLiterIst = summe > 0 ? summe : null
  }

  const notizen      = (formData.get('notizen') as string) || null
  const weinausbauId = (formData.get('weinausbau_id') as string) || null

  const payload: R = {
    tenant_id:          tenantId,
    behaelter_id:       behaelterId,
    datum,
    typ_id:             typId,
    typ_name_snapshot:  typ.name as string,
    menge,
    einheit,
    volumen_liter_ist:  volumenLiterIst,
    notizen,
    weinausbau_id:      weinausbauId,
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('keller_behandlungen') as any)
    .insert(payload).select('id').single()
  if (error) throw new AktionsFehler((error as R).message)

  revalidatePath(`/kellerbuch/behaelter/${behaelterId}/behandlungen`)
  revalidatePath('/kellerbuch')
  return { id: (data as R).id as string }
}

// ENDGÜLTIG LÖSCHEN (KAN-145 B4, 30.09.2026) – nur stornierte Buchungen, mit Grund, über die RPC
// s112_storniert_loeschen (Rolle inkl. Mitarbeiter, Schreibmodul, Abo; Grund ins Änderungsprotokoll). Ein Umzug
// besteht aus mehreren Zeilen (Batch) – alle stornierten Zeilen der Buchung werden gelöscht.
export async function endgueltigLoeschen(
  tabelle: 'keller_umzuege' | 'keller_behandlungen' | 'verschneidungen',
  id: string,
  grund: string,
): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  let ids = [id]
  if (tabelle === 'keller_umzuege') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: rec, error } = await (supabase.from('keller_umzuege') as any)
      .select('id, umzug_batch_id')
      // storno-sichtbar: endgültig gelöscht werden nur stornierte Zeilen (Filter unten)
      .eq('id', id).eq('tenant_id', tenantId).maybeSingle()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Buchung konnte nicht geladen werden'))
    if (!rec) throw new AktionsFehler('Buchung nicht gefunden.')
    if ((rec as R).umzug_batch_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: batch, error: e2 } = await (supabase.from('keller_umzuege') as any)
        .select('id')
        // storno-sichtbar: alle stornierten Zeilen derselben Buchung
        .eq('umzug_batch_id', (rec as R).umzug_batch_id).eq('tenant_id', tenantId).not('storniert_am', 'is', null)
      if (e2) throw new AktionsFehler(dbFehlerText(e2, 'Buchung konnte nicht geladen werden'))
      ids = ((batch ?? []) as R[]).map(r => r.id as string)
    }
  }
  for (const zeile of ids) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
      p_tenant_id: tenantId, p_tabelle: tabelle, p_id: zeile, p_grund: grund.trim(),
    })
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  }
  revalidatePath('/kellerbuch')
  revalidatePath('/kellerbuch/gebinde')
  revalidatePath('/kellerbuch/umziehen')
  revalidatePath('/kellerbuch/behaelter', 'layout')
}

// KELLERBEHANDLUNG STORNIEREN (KAN-35, 24.09.2026; KAN-145 B3, 30.09.2026)
// Server Action mit Schreibrecht im Kellerbuch, Mandantenfilter und Trefferprüfung. Seit KAN-145 bleibt die
// Behandlung stehen und wird mit Grund als storniert gekennzeichnet (Zeitpunkt und Benutzer setzt die DB,
// Änderungsprotokoll); Bewegungsbuch und Weinbuch zeigen sie mit Vermerk, die Auswertungen zählen sie nicht.
export async function deleteKellerbehandlung(id: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  if (!id) throw new AktionsFehler('Keine Kellerbehandlung angegeben')
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('keller_behandlungen') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)
    .select('id, behaelter_id, weinausbau_id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Stornieren fehlgeschlagen (keller_behandlungen)'))
  const zeile = ((data ?? []) as R[])[0]
  if (!zeile) throw new AktionsFehler('Kellerbehandlung nicht gefunden, bereits storniert oder keine Berechtigung.')

  revalidatePath(`/kellerbuch/behaelter/${zeile.behaelter_id}/behandlungen`)
  revalidatePath(`/kellerbuch/behaelter/${zeile.behaelter_id}/bewegungen`)
  if (zeile.weinausbau_id) revalidatePath(`/kellerbuch/weinausbau/${zeile.weinausbau_id}/buch`)
  revalidatePath('/kellerbuch')
}

// ANALYSE STORNIEREN / ENDGÜLTIG LÖSCHEN (KAN-150 F2, 01.10.2026) – die Analyse bleibt mit Grund stehen (Weinbuch zeigt
// sie gekennzeichnet) und gilt nicht mehr (DAC-Vorbelegung, Dashboard, Rückverfolgung). Endgültig löschen nur
// stornierter Analysen über die RPC s112_storniert_loeschen (Grund ins Änderungsprotokoll).
export async function stornoAnalyse(id: string, chargeId: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('weinanalysen') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('id', id).eq('tenant_id', tenantId).eq('weinausbau_id', chargeId).is('storniert_am', null)
    .select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Storno fehlgeschlagen'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Analyse nicht gefunden oder bereits storniert.')
  revalidatePath(`/kellerbuch/weinausbau/${chargeId}`)
  revalidatePath(`/kellerbuch/weinausbau/${chargeId}/analysen`)
}

export async function endgueltigLoeschenAnalyse(id: string, chargeId: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f.replace('den Storno', 'das endgültige Löschen'))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_storniert_loeschen', {
    p_tenant_id: tenantId, p_tabelle: 'weinanalysen', p_id: id, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Endgültig löschen fehlgeschlagen'))
  revalidatePath(`/kellerbuch/weinausbau/${chargeId}`)
  revalidatePath(`/kellerbuch/weinausbau/${chargeId}/analysen`)
}
