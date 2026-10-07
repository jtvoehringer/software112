'use server'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { qualitaetText } from '@/lib/weinqualitaet'
import {
  gleicheQualitaet, istAufwertungQualitaet, normalisiereQualitaet, qualitaetsSpalten,
  type QualitaetsAngabe,
} from '@/lib/wein/qualitaetsrang'
import { qualitaetFehler, qualitaetsAngabeAusFormular, qualitaetsAngabeFehler } from '@/lib/wein/qualitaet'
import { getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { pickerlFehler, schwundGrundFehler } from '@/lib/keller/gebindeAnzeige'
import { istStoffkontoTyp } from '@/lib/kellerbuch/stoffkonto'
import { dezimal, zahlAus, fmtNum } from '@/lib/format'
import { gebindeFehlerText } from '@/lib/keller/behaelter'
import { sperreBeiFolgebuchungen, folgebuchungenDerCharge, folgebuchungenText } from '@/lib/kellerbuch/folgebuchungen'
import { planeVerschneidungStorno, storniereVerschneidung, GEBINDEWECHSEL_OHNE } from '@/lib/kellerbuch/storno'
import { stornoGrundFehler, STORNO_GRUND_MIN } from '@/lib/storno/grund'
import { verschnittBuchen, verschnittVorbereiten } from '@/lib/kellerbuch/verschnittBuchen'
import { mostgewichtAusFormular, mostgewichtSpalten } from '@/lib/wein/mostgewichtFormular'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { mitPnNotiz } from '@/lib/kellerbuch/pruefnummer'
import { wienHeute } from '@/lib/csv'
import { pnWirkungAus, pnWirkungUnklarHinweis, type PnWirkung } from '@/lib/kellerbuch/pnWirkung'
import { ABSTUFEN_GRUND_MIN, abstufenFehler, teilmengeFehler } from '@/lib/kellerbuch/abstufen'
import { umziehen } from './umziehen/actions'
import { chargePflichtFehler, chargePnSperre, chargePnSperreText, NUR_ABSTUFEN_MELDUNG } from '@/lib/kellerbuch/chargeRegeln'
import { behandlungCharge, behandlungMengeFehler, behandlungPnGesperrt, behandlungZugangFehler, neuerTypWirkungFehler, BEHANDLUNG_FELDNAMEN, type PnGueltigkeit } from '@/lib/kellerbuch/behandlungRegeln'
import { freezeSperreAus, sperrMeldung } from '@/lib/freeze/sperre'
import { statusDatumFehler, statusWechselBuchungsrelevant } from '@/lib/kellerbuch/chargeStatus'
import { verarbeitungFehler } from '@/lib/kellerbuch/verarbeitung'
import { zugangskorrekturFehler } from '@/lib/kellerbuch/zugangskorrektur'

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

/** Qualitätsangabe einer Charge aus dem Formular – KAN-73: nur Werte des CHECK weinausbau
 *  (QUALITAET_OPTS), sonst verständliche Meldung statt 23514; leer bleibt null wie bisher.
 *  KAN-186: dazu Zusatzbezeichnung und Erzeugnis; ein Altwert im Qualitätsfeld (reserve, sekt …) wird
 *  normalisiert – geschrieben wird nie ein Altwert. */
function chargenQualitaetAusFormular(formData: FormData): QualitaetsAngabe {
  const angabe = qualitaetsAngabeAusFormular(formData)
  const fehler = qualitaetFehler('charge', angabe.stufe)
  if (fehler) throw new AktionsFehler(fehler)
  const angabeFehler = qualitaetsAngabeFehler(angabe)
  if (angabeFehler) throw new AktionsFehler(angabeFehler)
  return angabe
}

/** KAN-174 F: LP-Pickerl aus dem Formular (Feld lp_pickerl; leer = entfernen) – nur wenn das Feld mitkommt */
function pickerlAusFormular(formData: FormData): R {
  if (!formData.has('lp_pickerl')) return {}
  const t = ((formData.get('lp_pickerl') as string | null) ?? '').trim()
  const f = pickerlFehler(t)
  if (f) throw new AktionsFehler(f)
  return { lp_pickerl: t || null }
}

/** KAN-174 F: LP-Pickerl mit einem Klick entfernen (Kellerbuch-Übersicht) */
export async function pickerlEntfernen(behaelterId: string) {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('behaelter') as any).update({ lp_pickerl: null }).eq('id', behaelterId).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Pickerl konnte nicht entfernt werden'))
  revalidatePath('/kellerbuch')
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
    ...pickerlAusFormular(formData),   // KAN-174 F
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
    ...pickerlAusFormular(formData),   // KAN-174 F
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
// Neue Chargen entstehen nur über Pressung, Verschnitt, Zukauf, Umzug bzw. als Eröffnungsbestand (KAN-204: das frühere
// createWeinausbau ohne Aufrufer ist entfallen).

// Charge bearbeiten (KAN-35, 24.09.2026)
// * menge_liter wird hier NICHT mehr geschrieben – Bestandsänderungen nur als datierte
//   Buchung (Schwund buchen, Umzug, Füllung, Verkauf). Das Formular zeigt die Menge nur an.
// * Gebindewechsel nur ohne Folgebuchungen (sonst wäre es ein Umzug ohne Bewegungszeile)
//   und nie bei Pressungs-Chargen (Zielgebinde steht in der Pressung).
// * Deaktivieren/Abschließen nur bei leerer Charge (≤ 0,01 L) – sonst verschwände Bestand
//   aus Dashboard und Listen, während die View ihn weiterzählt.
// * Merkmale (Bezeichnung, Rebsorte, Qualität, Weinart, Rieden, Preis, Notizen) bleiben
//   änderbar; bestandsrelevante Änderungen protokolliert die DB (bestandsprotokoll).
// KAN-100: bestaetigung = Rückfrage „Prüfnummer erlischt“ (Abstufung) – nichts gespeichert; mit pn_bestaetigt=1 erneut senden
export async function updateWeinausbau(id: string, formData: FormData): Promise<{ bestaetigung?: string } | void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await getTenantId()
  if (!tenantId) throw new AktionsFehler('Kein Betrieb gefunden')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: altRaw, error: altErr } = await (supabase.from('weinausbau') as any)
    .select('id, name, behaelter_id, menge_liter, aktiv, status, qualitaetsstufe, zusatzbezeichnung, erzeugnis, jahrgang, rebsorte, weinart, kmw, ist_eroeffnungsbestand')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (altErr) throw new AktionsFehler(dbFehlerText(altErr, 'Charge konnte nicht geladen werden'))
  if (!altRaw) throw new AktionsFehler('Charge nicht gefunden')
  const alt = altRaw as R
  const bestand = parseFloat(alt.menge_liter) || 0

  // KAN-204: Prüfnummer der Charge – eingereicht: alle Merkmale gesperrt (auch DB, a_freeze); gültig: Merkmale außer Qualität
  const [{ data: antraegeRaw, error: antragErr }, { data: pnRaw, error: pnErr }] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('dac_antrag') as any).select('status, storniert_am').eq('weinausbau_id', id).eq('tenant_id', tenantId).is('storniert_am', null),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('pruefnummer_chargen') as any).select('gueltig_bis').eq('weinausbau_id', id).eq('tenant_id', tenantId),
  ])
  if (antragErr || pnErr) throw new AktionsFehler(dbFehlerText(antragErr ?? pnErr, 'Prüfnummer der Charge konnte nicht geprüft werden'))
  const pnSperre = chargePnSperre((antraegeRaw ?? []) as R[] as { status: string | null; storniert_am: string | null }[], (pnRaw ?? []) as R[] as { gueltig_bis: string | null }[])

  // KAN-130 Etappe 3 (02.10.2026): Mostgewicht nur schreiben, wenn das Formular es mitschickt – ein
  // Formular ohne Feld lässt das gespeicherte stehen; leer = beide Spalten NULL (Rechenregel 4). Die
  // Qualitätsstufe kommt weiter nur aus dem Formular, nie aus dem Mostgewicht (Rechenregel 6: eine
  // DAC-Charge mit 20 °KMW bleibt 'dac').
  const mostgewicht = mostgewichtAusFormular(formData, 'mostgewicht')
  if (!mostgewicht.ok) throw new AktionsFehler(mostgewicht.fehler)

  const wgIds = formData.getAll('weingarten_ids').map(v => v.toString()).filter(Boolean)
  const neuAktiv  = formData.get('aktiv') === 'true'
  const neuStatus = (formData.get('status') as string) || (alt.status as string)
  const payload: R = {
    name:            formData.get('name') as string,
    jahrgang:        formData.get('jahrgang') ? Number(dezimal(formData.get('jahrgang'))) : null,
    rebsorte:        (formData.get('rebsorte') as string) || null,
    weingarten_id:   wgIds[0] ?? null,
    ...qualitaetsSpalten(chargenQualitaetAusFormular(formData)),
    // KAN-204: nur schreiben, wenn das Formular die Weinart mitschickt (sonst bleibt sie)
    ...(formData.has('weinart') ? { weinart: (formData.get('weinart') as string) || 'unbekannt' } : {}),
    ...(mostgewicht.uebermittelt ? mostgewichtSpalten(mostgewicht.wert, 'kmw') : {}),
    status:               neuStatus,
    notizen:              (formData.get('notizen') as string) || null,
    einstandspreis_pro_liter: formData.get('einstandspreis_pro_liter')
      ? Number(dezimal((formData.get('einstandspreis_pro_liter') as string)))
      : null,
    aktiv:           neuAktiv,
  }

  // KAN-80 (02.10.2026): „händisch downgraden, aber nicht upgraden“ – serverseitig, nicht nur im Formular. Eine
  // Rangfolge (KAN-74): höhere Stufe oder z. B. Landwein → DAC wird abgelehnt; KAN-186: ebenso eine neue bzw. höhere
  // Zusatzbezeichnung (Qualitätswein → Reserve). Die bisherige Angabe wird normalisiert (Altwerte).
  const altQualitaet = normalisiereQualitaet(alt)
  const neuQualitaet = normalisiereQualitaet(payload)
  // KAN-204: Qualität, Zusatz und Erzeugnis nur über „Abstufen“ (datiert, mit Grund) – erstmalige Angabe ausgenommen
  if (altQualitaet.stufe && !gleicheQualitaet(altQualitaet, neuQualitaet)) throw new AktionsFehler(NUR_ABSTUFEN_MELDUNG)
  if (istAufwertungQualitaet(altQualitaet, neuQualitaet)) {
    throw new AktionsFehler(
      `Die Qualitätsstufe kann nicht von „${qualitaetText(altQualitaet)}“ auf „${qualitaetText(neuQualitaet)}“ angehoben werden – nur gleich bleiben oder abstufen ist zulässig. War die bisherige Stufe falsch erfasst, bitte die zugrunde liegende Buchung (Lese, Pressung, Zukauf) korrigieren.`,
    )
  }
  // KAN-100: Abstufung bzw. andere Bezeichnung – die Prüfnummer erlischt für den Tankbestand (Entscheidung Jörgen
  // 04.10.2026; das Ende schreibt der DB-Trigger). Unveränderte Angaben gar nicht schreiben – so löst eine bloße
  // Normalisierung den Trigger nicht aus. Rückfrage wie beim Verschnitt, Ablehnung bei eingereichtem Antrag.
  let pnNotiz: string | null = null
  if (gleicheQualitaet(altQualitaet, neuQualitaet)) {
    delete payload.qualitaetsstufe; delete payload.zusatzbezeichnung; delete payload.erzeugnis
  } else {
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'abstufung', [{ chargeId: id, name: (alt.name as string | null) ?? null }], wienHeute())
    if (pn && formData.get('pn_bestaetigt') !== '1') return { bestaetigung: pn.frage }
    if (pn) pnNotiz = pn.notiz
  }
  if (pnNotiz) payload.notizen = mitPnNotiz(payload.notizen as string | null, pnNotiz)

  // KAN-80: Chargen aus Pressung oder Zukauf – Jahrgang, Rebsorte und Weinart kommen von dort und sind auch
  // serverseitig gesperrt (das Formular zeigt sie bei Pressungs-Chargen nur an). Fehlt ein Feld, bleibt der Wert.
  {
    const [{ count: pb, error: pbErr }, { count: zk, error: zkErr }] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('pressung_behaelter') as any).select('id', { count: 'exact', head: true }).eq('weinausbau_id', id).is('storniert_am', null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('zukauf_posten') as any).select('id', { count: 'exact', head: true }).eq('ziel_weinausbau_id', id).eq('tenant_id', tenantId).is('storniert_am', null),
    ])
    if (pbErr || zkErr) throw new AktionsFehler(dbFehlerText(pbErr ?? zkErr, 'Herkunft der Charge konnte nicht geprüft werden'))
    const quelle = (pb ?? 0) > 0 ? 'Pressung' : (zk ?? 0) > 0 ? 'Zukauf' : null
    if (quelle) {
      const gesperrt: [string, string][] = [['jahrgang', 'Jahrgang'], ['rebsorte', 'Rebsorte'], ['weinart', 'Weinart']]
      for (const [feld, label] of gesperrt) {
        if (!formData.has(feld)) { delete payload[feld]; continue }
        const neu = payload[feld] ?? null
        const bisher = alt[feld] ?? null
        const gleich = feld === 'weinart' ? (neu ?? 'unbekannt') === (bisher ?? 'unbekannt') : String(neu ?? '') === String(bisher ?? '')
        if (!gleich) {
          throw new AktionsFehler(`${label} einer Charge aus ${quelle === 'Pressung' ? 'einer Pressung' : 'einem Zukauf'} kann hier nicht geändert werden – bitte in der ${quelle === 'Pressung' ? 'Erntemeldung (Pressung)' : 'Zukauf-Erfassung'} korrigieren.`)
        }
        delete payload[feld]
      }
    }
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

  // KAN-204: Merkmale unter Prüfnummer gesperrt (dieselbe Bedingung wie der Trigger a_freeze bzw. das Formular)
  if (pnSperre) {
    const geaendert: string[] = []
    const gleich = (x: unknown, y: unknown) => String(x ?? '') === String(y ?? '')
    if ('jahrgang' in payload && !gleich(payload.jahrgang, alt.jahrgang)) geaendert.push('Jahrgang')
    if ('rebsorte' in payload && !gleich(payload.rebsorte, alt.rebsorte)) geaendert.push('Rebsorte')
    if ('weinart' in payload && !gleich(payload.weinart ?? 'unbekannt', alt.weinart ?? 'unbekannt')) geaendert.push('Weinart')
    if ('kmw' in payload && Math.abs((Number(payload.kmw) || 0) - (Number(alt.kmw) || 0)) > 0.005) geaendert.push('Mostgewicht')
    if (herkunftGeaendert) geaendert.push('Rieden')
    if (geaendert.length > 0) throw new AktionsFehler(`${chargePnSperreText(pnSperre)} (geändert: ${geaendert.join(', ')})`)
    delete payload.jahrgang; delete payload.rebsorte; delete payload.weinart
    delete payload.kmw; delete payload.oechsle; delete payload.mostgewicht_einheit
  }

  // KAN-204: Pflichtangaben – nur, was hier änderbar ist (Pressung/Zukauf/Prüfnummer: gesperrt, bleibt wie es ist)
  {
    const neuesGebinde = formData.has('behaelter_id') ? ((formData.get('behaelter_id') as string) || null) : ((alt.behaelter_id as string | null) ?? null)
    const pflicht = chargePflichtFehler({
      jahrgang: 'jahrgang' in payload ? (payload.jahrgang as number | null) : (alt.jahrgang as number | null),
      rebsorte: 'rebsorte' in payload ? (payload.rebsorte as string | null) : (alt.rebsorte as string | null),
      weinart: 'weinart' in payload ? (payload.weinart as string | null) : (alt.weinart as string | null),
      qualitaetsstufe: neuQualitaet.stufe ?? altQualitaet.stufe ?? null,
      behaelterId: neuesGebinde,
      mitBestand: neuAktiv && bestand > 0.01,
    }, {
      eroeffnungsbestand: alt.ist_eroeffnungsbestand === true,
      geprueft: { jahrgang: 'jahrgang' in payload, rebsorte: 'rebsorte' in payload, weinart: 'weinart' in payload },
    })
    if (pflicht) throw new AktionsFehler(pflicht)
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

  // KAN-41: Wechsel Most ↔ Wein datiert über die RPC (Journal-Umstufungspaar an diesem Tag); andere Statuswechsel
  // bleiben eine einfache Änderung ohne Buchung
  if (statusWechselBuchungsrelevant(alt.status as string | null, neuStatus)) {
    const statusDatum = ((formData.get('status_datum') as string | null) ?? '').trim()
    const datumFehler = statusDatumFehler(statusDatum, wienHeute())
    if (datumFehler) throw new AktionsFehler(datumFehler)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: stErr } = await (supabase as any).rpc('s112_charge_status_setzen', {
      p_tenant_id: tenantId, p_weinausbau_id: id, p_status: neuStatus, p_datum: statusDatum || wienHeute(),
    })
    if (stErr) throw new AktionsFehler(dbFehlerText(stErr, 'Statuswechsel konnte nicht gebucht werden'))
    delete payload.status
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

// VERARBEITUNG (KAN-41 Paket 3a, 06.10.2026) – Abgang einer Menge aus der Charge durch Verarbeitung (BSM AB_VERAR) über
// die RPC s112_verarbeitung_buchen (Datum, Menge, Zweck; ganze Menge schließt die Charge ab). Dieselbe Prüfung im Formular
// (verarbeitungFehler); Storno mit Pflichtgrund über s112_verarbeitung_stornieren (Gegenbuchung am Storno-Tag).
export async function verarbeitungBuchen(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  const id = String(formData.get('weinausbau_id') ?? '')
  const datum = String(formData.get('datum') ?? '').slice(0, 10) || wienHeute()
  const zweck = String(formData.get('zweck') ?? '')
  const menge = zahlAus(formData.get('menge'))
  const notizen = String(formData.get('notizen') ?? '').trim() || null
  // KAN-115: optional Zugang beim Sonstigen Produkt (Traubensaft, Essig, Destillat) – Menge in seiner Einheit
  const artikelId = String(formData.get('artikel_id') ?? '').trim() || null
  const stueck = artikelId ? zahlAus(formData.get('stueck')) : null
  if (artikelId && (stueck == null || !(stueck > 0))) throw new AktionsFehler('Bitte die erzeugte Menge des Produkts angeben (größer als 0).')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chargeRaw, error: chargeErr } = await (supabase.from('weinausbau') as any)
    .select('id, menge_liter, aktiv, storniert_am').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (chargeErr) throw new AktionsFehler(dbFehlerText(chargeErr, 'Charge konnte nicht geladen werden'))
  if (!chargeRaw) throw new AktionsFehler('Charge nicht gefunden')
  const charge = chargeRaw as R
  if (charge.storniert_am || charge.aktiv === false) throw new AktionsFehler('Die Charge ist storniert bzw. nicht mehr aktiv.')
  const fehler = verarbeitungFehler({ zweck, menge, bestand: Number(charge.menge_liter) || 0, datum, heute: wienHeute() })
  if (fehler) throw new AktionsFehler(fehler)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_verarbeitung_buchen', {
    p_tenant_id: tenantId, p_weinausbau_id: id, p_datum: datum, p_menge: menge, p_zweck: zweck, p_notizen: notizen,
    ...(artikelId ? { p_artikel_id: artikelId, p_stueck: stueck } : {}),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Verarbeitung konnte nicht gebucht werden'))
  if (artikelId) revalidatePath(`/weinhandel/sonstige-artikel/${artikelId}`)
  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
}

export async function verarbeitungStornieren(verarbeitungId: string, chargeId: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_verarbeitung_stornieren', {
    p_tenant_id: tenantId, p_id: verarbeitungId, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Verarbeitung konnte nicht storniert werden'))
  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${chargeId}`)
}

// ZUGANGSKORREKTUR (KAN-53, 07.10.2026) – Mehrmenge, Inventur-Plus als datierte Buchung (Journal INV_PLUS), nur
// Betriebsleitung (Vorgabe Ticket; die RPC prüft die Rolle erneut). Prüfnummernschädlich (Kommentar Jörgen 25.09.2026):
// bei geltender Nummer erst Rückfrage (`{ bestaetigung }`, mit pn_bestaetigt=1 erneut senden), bei eingereichtem Antrag
// Ablehnung (pruefePruefnummernSchaden); der Vermerk landet im Grund.
async function zugangskorrekturRecht(): Promise<string> {
  const tenantId = await kellerbuchSchreibrecht()
  const membership = await getCurrentMembership()
  if (!membership || !canAdmin(membership.role)) throw new AktionsFehler('Zugangskorrekturen bucht nur die Betriebsleitung.')
  return tenantId
}

export async function zugangskorrekturBuchen(formData: FormData): Promise<{ bestaetigung?: string } | void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await zugangskorrekturRecht()
  const id = String(formData.get('weinausbau_id') ?? '')
  const datum = String(formData.get('datum') ?? '').slice(0, 10) || wienHeute()
  const art = String(formData.get('art') ?? '')
  const menge = zahlAus(formData.get('menge'))
  const grund = String(formData.get('grund') ?? '').trim()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chargeRaw, error: chargeErr } = await (supabase.from('weinausbau') as any)
    .select('id, name, aktiv, storniert_am').eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (chargeErr) throw new AktionsFehler(dbFehlerText(chargeErr, 'Charge konnte nicht geladen werden'))
  if (!chargeRaw) throw new AktionsFehler('Charge nicht gefunden')
  const charge = chargeRaw as R
  if (charge.storniert_am || charge.aktiv === false) throw new AktionsFehler('Die Charge ist storniert bzw. nicht mehr aktiv.')
  const fehler = zugangskorrekturFehler({ art, menge, grund, datum, heute: wienHeute() })
  if (fehler) throw new AktionsFehler(fehler)

  const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'korrektur', [{ chargeId: id, name: charge.name ?? null, zugangLiter: menge }], datum)
  if (pn && formData.get('pn_bestaetigt') !== '1') return { bestaetigung: pn.frage }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_zugangskorrektur_buchen', {
    p_tenant_id: tenantId, p_weinausbau_id: id, p_datum: datum, p_menge: menge, p_art: art, p_grund: mitPnNotiz(grund, pn?.notiz ?? null),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Zugangskorrektur konnte nicht gebucht werden'))
  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
}

export async function zugangskorrekturStornieren(korrekturId: string, chargeId: string, grund: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await zugangskorrekturRecht()
  const grundFehler = stornoGrundFehler(grund)
  if (grundFehler) throw new AktionsFehler(grundFehler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_zugangskorrektur_stornieren', {
    p_tenant_id: tenantId, p_id: korrekturId, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Zugangskorrektur konnte nicht storniert werden'))
  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${chargeId}`)
}

// CHARGE ABSTUFEN (KAN-82, 05.10.2026) – Qualität, Zusatzbezeichnung bzw. Herkunft nur niedriger, mit Datum und Pflichtgrund
// über die RPC s112_charge_abstufen (Protokoll charge_umstufungen, Änderungsprotokoll mit Grund, Journal und Prüfnummer am
// Datum der Abstufung). Ganze Charge: an Ort und Stelle, bei geltender Prüfnummer erst Rückfrage (KAN-100, `{ bestaetigung }`,
// mit pn_bestaetigt=1 erneut senden). Teilmenge (Entscheidung Jörgen 05.10.2026): nur mit Umzug in ein leeres Gebinde – erst
// der Umzug (wie Kellerbuch › Umziehen), dann wird die neue Charge dort abgestuft. Scheitert der zweite Schritt, ist der Wein
// umgezogen, aber nicht abgestuft – die Meldung nennt die neue Charge, die Abstufung lässt sich dort wiederholen.
export async function chargeAbstufen(formData: FormData): Promise<{ bestaetigung?: string; chargeId?: string }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()

  const id = String(formData.get('weinausbau_id') ?? '')
  const datum = String(formData.get('datum') ?? '').slice(0, 10) || wienHeute()
  const grund = String(formData.get('grund') ?? '').trim()
  if (grund.length < ABSTUFEN_GRUND_MIN) throw new AktionsFehler(`Bitte einen Grund für die Abstufung angeben (mindestens ${ABSTUFEN_GRUND_MIN} Zeichen).`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chargeRaw, error: chargeErr } = await (supabase.from('weinausbau') as any)
    .select('id, name, menge_liter, behaelter_id, qualitaetsstufe, zusatzbezeichnung, erzeugnis, herkunft_code, aktiv, storniert_am')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle()
  if (chargeErr) throw new AktionsFehler(dbFehlerText(chargeErr, 'Charge konnte nicht geladen werden'))
  if (!chargeRaw) throw new AktionsFehler('Charge nicht gefunden')
  const charge = chargeRaw as R
  if (charge.storniert_am || charge.aktiv === false) throw new AktionsFehler('Die Charge ist storniert bzw. nicht mehr aktiv.')

  const altQ = normalisiereQualitaet(charge)
  const alt = { ...altQ, herkunft: (charge.herkunft_code as string | null) ?? null }
  const feld = (name: string, bisher: string | null) => formData.has(name) ? (String(formData.get(name) ?? '').trim() || null) : bisher
  const neu = {
    stufe: feld('qualitaetsstufe', alt.stufe),
    zusatz: feld('zusatzbezeichnung', alt.zusatz) as typeof alt.zusatz,
    erzeugnis: alt.erzeugnis,
    herkunft: feld('herkunft_code', alt.herkunft),
  }
  const fehler = abstufenFehler(alt, neu)
  if (fehler) throw new AktionsFehler(fehler)
  const p_neu = { ...qualitaetsSpalten(neu), herkunft_code: neu.herkunft }
  const bestand = Number(charge.menge_liter) || 0

  let zielId = id
  let quelleId: string | null = null
  if (formData.get('umfang') === 'teil') {
    const menge = zahlAus(formData.get('menge'))
    const mengeFehler = teilmengeFehler(menge, bestand)
    if (mengeFehler) throw new AktionsFehler(mengeFehler)
    const zielBehaelter = String(formData.get('ziel_behaelter_id') ?? '')
    if (!zielBehaelter) throw new AktionsFehler('Bitte das leere Gebinde für die Teilmenge wählen.')
    if (zielBehaelter === charge.behaelter_id) throw new AktionsFehler('Die Teilmenge muss in ein anderes, leeres Gebinde.')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error: belegtErr } = await (supabase.from('weinausbau') as any)
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('behaelter_id', zielBehaelter).eq('aktiv', true).is('storniert_am', null)
    if (belegtErr) throw new AktionsFehler(dbFehlerText(belegtErr, 'Gebinde konnte nicht geprüft werden'))
    if ((count ?? 0) > 0) throw new AktionsFehler('Das gewählte Gebinde ist nicht leer – die Teilmenge braucht ein leeres Gebinde.')

    const fd = new FormData()
    fd.set('datum', datum)
    fd.set('quellen_json', JSON.stringify([{ weinausbau_id: id, menge }]))
    fd.set('ziele_json', JSON.stringify([{ behaelter_id: zielBehaelter, menge }]))
    fd.set('notizen', `Teilmenge zur Abstufung: ${grund}`)
    const r = await umziehen(fd)
    if (r && 'bestaetigung' in r && r.bestaetigung) throw new AktionsFehler(r.bestaetigung)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: neuRaw, error: neuErr } = await (supabase.from('weinausbau') as any)
      .select('id').eq('tenant_id', tenantId).eq('behaelter_id', zielBehaelter).eq('aktiv', true).is('storniert_am', null)
      .order('created_at', { ascending: false }).limit(1)
    if (neuErr || !(neuRaw as R[] | null)?.[0]) throw new AktionsFehler('Der Umzug ist gebucht, die neue Charge wurde aber nicht gefunden – bitte im Gebinde prüfen und dort abstufen.')
    zielId = String((neuRaw as R[])[0].id)
    quelleId = id
  } else {
    // ganze Charge: Prüfnummer erlischt für den Tankbestand (KAN-100) – vorher fragen, eingereicht = Ablehnung
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'abstufung', [{ chargeId: id, name: (charge.name as string | null) ?? null }], datum)
    if (pn && formData.get('pn_bestaetigt') !== '1') return { bestaetigung: pn.frage }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc('s112_charge_abstufen', {
    p_tenant_id: tenantId, p_weinausbau_id: zielId, p_datum: datum, p_neu, p_grund: grund, p_quelle_weinausbau_id: quelleId,
  })
  if (error) {
    const text = dbFehlerText(error, 'Abstufen fehlgeschlagen')
    throw new AktionsFehler(quelleId ? `Die Teilmenge ist umgezogen, die Abstufung der neuen Charge aber gescheitert: ${text} – bitte an der neuen Charge erneut abstufen.` : text)
  }

  revalidatePath('/kellerbuch')
  revalidatePath(`/kellerbuch/weinausbau/${id}`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
  return { chargeId: zielId }
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
  // KAN-203: Mostgewicht im Gärverlauf (optional) – Messwert und Einheit, beide Werte serverseitig gerechnet
  const mg = mostgewichtAusFormular(formData, 'mostgewicht')
  if (!mg.ok) throw new AktionsFehler(mg.fehler)
  if (mg.uebermittelt) Object.assign(payload, mostgewichtSpalten(mg.wert, 'kmw'))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('weinanalysen') as any).insert(payload)
  if (error) throw new AktionsFehler((error as R).message)

  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/analysen`)
  revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/buch`)
}

// VERSCHNEIDUNG

/** Quellen aus dem Formularfeld quellen_json (Verschneiden-Formular) */
function verschnittQuellenAus(formData: FormData): { weinausbau_id: string; menge: number }[] {
  let roh: unknown
  try {
    roh = JSON.parse((formData.get('quellen_json') as string) || '[]')
  } catch {
    throw new AktionsFehler('Ungültige Eingabe: Quellen konnten nicht gelesen werden.')
  }
  if (!Array.isArray(roh)) throw new AktionsFehler('Ungültige Eingabe: Quellen fehlen.')
  // JSON-Zahlen direkt übernehmen (zahlAus würde „1.234“ als Tausenderpunkt lesen)
  return (roh as R[]).map(q => ({
    weinausbau_id: typeof q?.weinausbau_id === 'string' ? q.weinausbau_id : '',
    menge:         typeof q?.menge_liter === 'number' ? q.menge_liter : (zahlAus(q?.menge_liter) ?? NaN),
  }))
}

export type VerschnittVorschau =
  | { herkunft_code: string | null; qualitaetsstufe: string | null; zusatzbezeichnung: string | null; erzeugnis: string | null; hinweise: string[] }
  | { fehler: string }

/**
 * KAN-111 (04.10.2026): Vorschau des Verschneiden-Formulars – dieselbe Rechnung wie beim Buchen (verschnittVorbereiten:
 * Herkunft nach § 21 WeinG aus den tatsächlichen Anteilen, Qualität samt Deckel aus der Herkunft), OHNE zu buchen und
 * ohne Rückfragen. Nur lesend; Fehler kommen als { fehler } zurück (die Vorschau zeigt sie nicht als Ausnahme).
 */
export async function verschnittVorschau(formData: FormData): Promise<VerschnittVorschau> {
  try {
    const supabase = await createSupabaseServerClient()
    const tenantId = await kellerbuchSchreibrecht()
    const zielId = formData.get('ziel_weinausbau_id') as string
    const quellen = verschnittQuellenAus(formData).filter(q => q.weinausbau_id && q.menge >= 0.01)
    if (!zielId || quellen.length === 0) return { fehler: 'Noch keine Quelle mit Menge.' }
    const r = await verschnittVorbereiten(supabase, tenantId, {
      datum: (formData.get('datum') as string) || new Date().toISOString().slice(0, 10),
      ziel: { weinausbauId: zielId }, quellen, notizen: null, pnBestaetigt: true, rotWeissBestaetigt: true,
    })
    if (!('buchung' in r)) return { fehler: 'Vorschau nicht möglich.' }
    const z = (r.buchung.kopf.ziel ?? {}) as R
    return {
      herkunft_code: z.herkunft_code ?? null,
      qualitaetsstufe: z.qualitaetsstufe ?? null, zusatzbezeichnung: z.zusatzbezeichnung ?? null, erzeugnis: z.erzeugnis ?? null,
      hinweise: r.buchung.sortenHinweise,
    }
  } catch (err) {
    return { fehler: err instanceof Error ? err.message : 'Vorschau nicht möglich.' }
  }
}
// KAN-35 (24.09.2026): Alle Prüfungen laufen serverseitig VOR der ersten Buchung – jede Quelle
// braucht eine Menge ≥ 0,01 L, gehört zum Betrieb und hat genug Bestand (je Charge summiert);
// die Weinart-Sperre greift ebenfalls vorher (bisher erst nach dem Anlegen des Verschnitts).
// Die Quellen werden nicht mehr mit Math.max(0, …) gekappt, sondern bei Rest ≤ 0,01 L
// abgeschlossen – ein Mehr als der Bestand wird vorher abgelehnt.
// KAN-83: bestaetigung = Rückfrage „Prüfnummer gilt nicht mehr“ – nichts gebucht; mit pn_bestaetigt=1 erneut senden
// KAN-193: ebenso die Rückfrage Rot/Weiß (Abstufung auf Wein aus Österreich) – mit rotweiss_bestaetigt=1 erneut senden
export async function createVerschneidung(formData: FormData): Promise<{ qualitaetAbgestuft: { von: string; nach: string } | null; herkunftAbgestuft: { von: string; nach: string } | null; sortenHinweise?: string[]; rotWeiss?: boolean; bestaetigung?: string }> {
  const supabase  = await createSupabaseServerClient()
  // KAN-112: Schreibrecht im Kellerbuch wie beim Storno (vorher nur Betrieb und Schreibsperre)
  const tenantId  = await kellerbuchSchreibrecht()

  const datum        = formData.get('datum') as string
  const zielId       = formData.get('ziel_weinausbau_id') as string
  const notizen      = (formData.get('notizen') as string) || null
  const quellen = verschnittQuellenAus(formData)
  if (!datum || !zielId || quellen.length === 0) throw new AktionsFehler('Pflichtfelder fehlen')

  // KAN-112: Prüfungen, Fachwerte (85-%-Regel, Qualität, Herkunft, Mostgewicht, Vermerke) und EIN RPC-Aufruf
  // im gemeinsamen Service – derselbe Weg wie beim Umzug in ein Gebinde mit anderem Wein
  const r = await verschnittBuchen(supabase, tenantId, {
    datum, ziel: { weinausbauId: zielId }, quellen, notizen, pnBestaetigt: formData.get('pn_bestaetigt') === '1',
    rotWeissBestaetigt: formData.get('rotweiss_bestaetigt') === '1',   // KAN-193
  })
  if (r.bestaetigung) return { qualitaetAbgestuft: null, herkunftAbgestuft: null, bestaetigung: r.bestaetigung }

  revalidatePath('/kellerbuch')
  quellen.forEach(q => revalidatePath(`/kellerbuch/weinausbau/${q.weinausbau_id}/buch`))
  revalidatePath(`/kellerbuch/weinausbau/${zielId}/buch`)
  revalidatePath(`/kellerbuch/weinausbau/${zielId}`)

  return { qualitaetAbgestuft: r.qualitaetAbgestuft, herkunftAbgestuft: r.herkunftAbgestuft, sortenHinweise: r.sortenHinweise ?? [], rotWeiss: r.rotWeiss === true }
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
  const gf = schwundGrundFehler(notiz)   // KAN-174 D: Begründung Pflicht
  if (gf) throw new AktionsFehler(gf)

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
// KELLERBEHANDLUNG ANLEGEN / BEARBEITEN – ein Weg für Seite und Prozess-Assistent (KAN-100, 04.10.2026; vorher schrieb
// die Seite per Browser-Client). Prüfnummer: Ein Behandlungstyp mit pn_wirkung 'veraenderung' (z. B. Säurekorrektur)
// beendet die Gültigkeit für den Tankbestand der Charge – wie beim Verschnitt erst Rückfrage (`{ bestaetigung }`, mit
// pn_bestaetigt=1 erneut senden), bei eingereichtem Antrag Ablehnung; das Ende schreibt der DB-Trigger. Ein nicht
// eingestufter Typ ('unklar') warnt nur (`hinweis`), die Nummer bleibt (Entscheidung Jörgen 04.10.2026).
export type KellerbehandlungErgebnis = { id?: string; bestaetigung?: string; hinweis?: string }

export async function speichereKellerbehandlung(formData: FormData): Promise<KellerbehandlungErgebnis> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()

  const id = (formData.get('id') as string) || null
  const behaelterId = formData.get('behaelter_id') as string
  if (!behaelterId) throw new AktionsFehler('Kein Behälter angegeben')
  const datum = formData.get('datum') as string
  if (!datum) throw new AktionsFehler('Kein Datum angegeben')
  const typId = formData.get('typ_id') as string
  if (!typId) throw new AktionsFehler('Kein Behandlungstyp angegeben')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: typRaw } = await (supabase.from('keller_behandlungstypen') as any)
    .select('id, name, einheit_standard, pn_wirkung').eq('id', typId).eq('tenant_id', tenantId).maybeSingle()
  if (!typRaw) throw new AktionsFehler('Behandlungstyp nicht gefunden')
  const typ = typRaw as R

  const menge   = formData.get('menge') ? parseFloat(dezimal((formData.get('menge') as string))) : null
  const einheit = (formData.get('einheit') as string) || (typ.einheit_standard as string | null) || null
  // KAN-206: Menge Pflicht, außer Einheit „-“
  const mengeFehler = behandlungMengeFehler(menge, einheit)
  if (mengeFehler) throw new AktionsFehler(mengeFehler)

  // Aktive Chargen im Gebinde: Volumen-Vorschlag und Charge (KAN-206)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: chargenImBehaelter } = await (supabase.from('weinausbau') as any)
    .select('id, menge_liter').eq('behaelter_id', behaelterId).eq('aktiv', true).eq('tenant_id', tenantId)
  const chargenListe = (chargenImBehaelter ?? []) as R[]

  // Volumen Ist: beim Anlegen ohne Angabe der aktuelle Gesamtinhalt des Behälters (Summe aktiver Chargen)
  let volumenLiterIst = formData.get('volumen_liter_ist')
    ? parseFloat(dezimal((formData.get('volumen_liter_ist') as string)))
    : null
  if (volumenLiterIst == null && !id) {
    const summe = chargenListe.reduce((s, w) => s + (parseFloat(w.menge_liter) || 0), 0)
    volumenLiterIst = summe > 0 ? summe : null
  }

  let notizen = (formData.get('notizen') as string) || null
  // KAN-206: Charge Pflicht, sobald Wein im Gebinde liegt – beim Anlegen die einzige Charge automatisch
  const gewaehlt = (formData.get('weinausbau_id') as string) || null
  let weinausbauId = gewaehlt
  if (!id) {
    const c = behandlungCharge(gewaehlt, chargenListe.map(w => String(w.id)))
    if (c.fehler) throw new AktionsFehler(c.fehler)
    weinausbauId = c.chargeId
  }

  // KAN-41 Paket 3b: Volumenzugang (ZU_BEH) – erhöht den Bestand der Charge (Trigger z_zugang_bestand)
  const zugangText = String(formData.get('zugang_liter') ?? '').trim()
  const zugangLiter = zugangText ? zahlAus(zugangText) : null
  const zugangFehler = behandlungZugangFehler(zugangText && zugangLiter == null ? NaN : zugangLiter, weinausbauId)
  if (zugangFehler) throw new AktionsFehler(zugangFehler)

  // KAN-100: Prüfnummer der Charge
  let hinweis: string | undefined
  if (weinausbauId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: charge } = await (supabase.from('weinausbau') as any)
      .select('id, name').eq('id', weinausbauId).eq('tenant_id', tenantId).maybeSingle()
    if (!charge) throw new AktionsFehler('Charge nicht gefunden')
    const ziel = [{ chargeId: weinausbauId, name: (charge as R).name ?? null }]
    if (typ.pn_wirkung === 'veraenderung') {
      const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'behandlung', ziel, datum)   // wirft bei eingereichtem Antrag
      if (pn && formData.get('pn_bestaetigt') !== '1') return { bestaetigung: pn.frage }
      if (pn) notizen = mitPnNotiz(notizen, pn.notiz)
    } else if (typ.pn_wirkung !== 'pflege') {
      let betroffen: boolean
      try { betroffen = (await pruefePruefnummernSchaden(supabase, tenantId, 'behandlung', ziel, datum)) !== null }
      catch { betroffen = true }   // eingereichter Antrag
      if (betroffen) hinweis = pnWirkungUnklarHinweis(String(typ.name ?? ''))
    }
  }

  // KAN-107: Stoffkonto – Verwendung eines Stoffs (nur beim Anlegen); bei Zuckerung, RTK, Säuerung, Entsäuerung Pflicht,
  // sobald der Betrieb Stoffe angelegt hat. Geprüft VOR dem Anlegen der Behandlung.
  let stoff: { id: string; name: string; einheit: string; menge: number } | null = null
  if (!id) {
    const stoffId = ((formData.get('kellermittel_id') as string | null) ?? '').trim()
    if (stoffId) {
      const m = zahlAus(formData.get('kellermittel_menge'))
      if (m === null || !(m > 0)) throw new AktionsFehler('Bitte die verwendete Menge des Stoffs angeben.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: km } = await (supabase.from('kellermittel') as any)
        .select('id, name, einheit').eq('id', stoffId).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle()
      if (!km) throw new AktionsFehler('Stoff nicht gefunden oder nicht aktiv.')
      stoff = { id: String((km as R).id), name: String((km as R).name), einheit: String((km as R).einheit), menge: m }
    } else if (istStoffkontoTyp(typ.name as string)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (supabase.from('kellermittel') as any)
        .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('aktiv', true)
      if ((count ?? 0) > 0) throw new AktionsFehler(`Bei „${typ.name}“ bitte den verwendeten Stoff aus dem Stoffkonto (Besondere Konten) wählen.`)
    }
  }

  const payload: R = {
    behaelter_id:       behaelterId,
    datum,
    typ_id:             typId,
    typ_name_snapshot:  typ.name as string,
    menge,
    einheit,
    volumen_liter_ist:  volumenLiterIst,
    // KAN-41 Paket 3b: nur, wenn das Formular das Feld schickt (Prozess-Assistent u. a. lassen einen Zugang unverändert)
    ...(formData.has('zugang_liter') ? { zugang_liter: zugangLiter } : {}),
    notizen,
    weinausbau_id:      weinausbauId,
  }

  let neueId: string
  if (id) {
    // KAN-206: Behandlung einer Charge mit Prüfnummer – nach dem Speichern nur noch Notizen (dieselbe Bedingung wie a_freeze)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: alt } = await (supabase.from('keller_behandlungen') as any)
      .select('id, datum, typ_id, menge, einheit, volumen_liter_ist, zugang_liter, weinausbau_id, behaelter_id, storniert_am')
      .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null).maybeSingle()
    if (alt && (alt as R).weinausbau_id) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: pn } = await (supabase.from('pruefnummer_chargen') as any)
        .select('weinausbau_id, gueltig_ab, gueltig_bis').eq('weinausbau_id', (alt as R).weinausbau_id).eq('tenant_id', tenantId)
      if (behandlungPnGesperrt(alt as R as { weinausbau_id: string; datum: string }, (pn ?? []) as PnGueltigkeit[])) {
        const a = alt as R
        const gleich = (x: unknown, y: unknown) => (x == null ? null : String(x)) === (y == null ? null : String(y))
        const zahlGleich = (x: unknown, y: unknown) => (x == null || y == null) ? x == y : Number(x) === Number(y)
        const geaendert = !gleich(String(a.datum).slice(0, 10), payload.datum) || !gleich(a.typ_id, payload.typ_id)
          || !zahlGleich(a.menge, payload.menge) || !gleich(a.einheit, payload.einheit)
          || !zahlGleich(a.volumen_liter_ist, payload.volumen_liter_ist) || !zahlGleich(a.zugang_liter, payload.zugang_liter)
          || !gleich(a.weinausbau_id, payload.weinausbau_id)
          || !gleich(a.behaelter_id, payload.behaelter_id)
        if (geaendert) {
          throw new AktionsFehler('Gesperrt: Die Charge hatte am Tag der Behandlung eine gültige Prüfnummer – änderbar sind nur noch die Notizen. '
            + 'Berichtigung: Behandlung stornieren und neu erfassen; weitere Korrekturen nur durch die Betriebsleitung.')
        }
        // nur Notizen schreiben – der Trigger lässt sonst nichts durch
        for (const k of Object.keys(payload)) if (k !== 'notizen') delete payload[k]
      }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('keller_behandlungen') as any)
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
      .select('id')
    if (error) {
      const sperre = freezeSperreAus(error)
      throw new AktionsFehler(sperre ? sperrMeldung(sperre, sp => BEHANDLUNG_FELDNAMEN[sp] ?? sp) : dbFehlerText(error, 'Speichern fehlgeschlagen'))
    }
    if (!data || (data as R[]).length === 0) throw new AktionsFehler('Speichern fehlgeschlagen: Behandlung nicht gefunden, storniert oder keine Berechtigung.')
    neueId = id
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('keller_behandlungen') as any)
      .insert({ ...payload, tenant_id: tenantId }).select('id').single()
    if (error) throw new AktionsFehler(dbFehlerText(error, 'Speichern fehlgeschlagen'))
    neueId = (data as R).id as string
    if (stoff) {
      // KAN-107: Verwendung im Stoffkonto (append-only, Menge negativ)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: kErr } = await (supabase.from('kellermittel_buchungen') as any).insert({
        tenant_id: tenantId, kellermittel_id: stoff.id, datum, art: 'verwendung', menge: -Math.round(stoff.menge * 1000) / 1000,
        keller_behandlung_id: neueId, weinausbau_id: weinausbauId, behaelter_id: behaelterId, zweck: typ.name as string,
      })
      if (kErr) throw new AktionsFehler(`Die Behandlung ist gespeichert, aber die Verwendung von „${stoff.name}“ konnte nicht ins Stoffkonto gebucht werden: ${dbFehlerText(kErr)} – bitte unter Besondere Konten nachbuchen.`)
      revalidatePath('/kellerbuch/besondere-konten')
    }
  }

  revalidatePath(`/kellerbuch/behaelter/${behaelterId}/behandlungen`)
  revalidatePath(`/kellerbuch/behaelter/${behaelterId}/bewegungen`)
  if (weinausbauId) {
    revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}`)
    revalidatePath(`/kellerbuch/weinausbau/${weinausbauId}/buch`)
  }
  revalidatePath('/kellerbuch')
  return hinweis ? { id: neueId, hinweis } : { id: neueId }
}

/** Prozess-Assistent: anlegen über denselben Weg wie die Seite (KAN-100) */
export async function createKellerbehandlung(formData: FormData): Promise<KellerbehandlungErgebnis> {
  const neu = new FormData()   // nur anlegen: eine mitgeschickte id fällt weg
  formData.forEach((wert, feld) => { if (feld !== 'id') neu.append(feld, wert) })
  return speichereKellerbehandlung(neu)
}

/** Neuer Behandlungstyp mit Einstufung für die Prüfnummer (KAN-100) */
export async function legeBehandlungstypAn(name: string, einheit: string | null, wirkung: string): Promise<{ id: string; name: string; einheit_standard: string | null; pn_wirkung: PnWirkung }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  const n = (name ?? '').trim()
  if (!n) throw new AktionsFehler('Bitte eine Typbezeichnung angeben.')
  const wirkungFehler = neuerTypWirkungFehler(wirkung)   // KAN-206: neue Typen immer eingestuft
  if (wirkungFehler) throw new AktionsFehler(wirkungFehler)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('keller_behandlungstypen') as any)
    .insert({ tenant_id: tenantId, name: n, einheit_standard: einheit || null, pn_wirkung: pnWirkungAus(wirkung) })
    .select('id, name, einheit_standard, pn_wirkung').single()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Behandlungstyp konnte nicht angelegt werden'))
  return data as { id: string; name: string; einheit_standard: string | null; pn_wirkung: PnWirkung }
}

/** Einstufung eines Typs ändern – die Datenbank sperrt das, sobald der Typ in einer Charge mit Prüfnummer verwendet wurde */
export async function setzeBehandlungstypWirkung(typId: string, wirkung: string): Promise<void> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kellerbuchSchreibrecht()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('keller_behandlungstypen') as any)
    .update({ pn_wirkung: pnWirkungAus(wirkung) }).eq('id', typId).eq('tenant_id', tenantId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Einstufung konnte nicht gespeichert werden'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Behandlungstyp nicht gefunden oder keine Berechtigung.')
  revalidatePath('/kellerbuch')
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

  // KAN-107: Verwendung im Stoffkonto per Gegenbuchung aufheben (append-only; je Buchung nur einmal)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: kb, error: kbErr } = await (supabase.from('kellermittel_buchungen') as any)
    .select('id, kellermittel_id, menge, weinausbau_id, behaelter_id').eq('tenant_id', tenantId).eq('keller_behandlung_id', id).eq('art', 'verwendung')
  if (kbErr) throw new AktionsFehler(dbFehlerText(kbErr, 'Storniert, aber das Stoffkonto konnte nicht geladen werden'))
  for (const b of (kb ?? []) as R[]) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: sErr } = await (supabase.from('kellermittel_buchungen') as any).insert({
      tenant_id: tenantId, kellermittel_id: b.kellermittel_id, datum: wienHeute(), art: 'storno', menge: -Number(b.menge),
      storno_von_id: b.id, keller_behandlung_id: id, weinausbau_id: b.weinausbau_id, behaelter_id: b.behaelter_id,
      notizen: `Storno der Kellerbehandlung: ${grund.trim()}`,
    })
    if (sErr && (sErr as R).code !== '23505') throw new AktionsFehler(`Storniert, aber die Gegenbuchung im Stoffkonto fehlt: ${dbFehlerText(sErr)}`)
  }
  if ((kb ?? []).length) revalidatePath('/kellerbuch/besondere-konten')

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
