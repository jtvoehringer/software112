'use server'

// ── Sammelmaßnahme im Kellerbuch (KAN-413, 11.11.2026) ───────────────────────────────────────────────────────────────
// Dieselbe Kellerbehandlung für mehrere Gebinde: je Charge eine Behandlungszeile mit gemeinsamer sammel_id, Menge und
// Stoff anteilig nach Litern (bzw. Dosis je hl). Gespeichert wird nur über die RPC s112_kellerbehandlung_sammel – eine
// Transaktion, alles oder nichts (Periodensperre, Modulrecht und Fremdverweise prüft die Datenbank je Zeile).
// Prüfnummer wie bei der Einzelbehandlung (KAN-100): ein Typ mit Wirkung „Veränderung“ fragt einmal für alle betroffenen
// Chargen zurück (`{ bestaetigung }`, mit pn_bestaetigt=1 erneut senden), ein eingereichter Antrag lehnt ab.

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { inBloecken } from '@/lib/supabase/alle'
import { zahlAus } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { istStoffkontoTyp } from '@/lib/kellerbuch/stoffkonto'
import { nurBelegendeChargen } from '@/lib/kellerbuch/leereGebinde'
import { pruefePruefnummernSchaden } from '@/lib/kellerbuch/pruefnummerLaden'
import { mitPnNotiz } from '@/lib/kellerbuch/pruefnummer'
import { pnWirkungUnklarHinweis } from '@/lib/kellerbuch/pnWirkung'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { sammelFehler, sammelZeilen, istSammelModus, SAMMEL_MAX, type SammelCharge } from '@/lib/kellerbuch/sammelbehandlung'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export type SammelErgebnis = { sammelId?: string; anzahl?: number; bestaetigung?: string; hinweis?: string }

/** Betrieb der Seite, Abo-Schreibsperre und Schreibrecht Kellerbuch – vor dem ersten Zugriff (KAN-30, KAN-5, KAN-244) */
async function kontext(): Promise<string> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)
  await pruefeSchreibzugriff(membership)
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return membership.tenantId
}

function aktualisiere(zeilen: { behaelterId: string | null; chargeId: string | null }[], stoff: boolean) {
  for (const b of new Set(zeilen.map(z => z.behaelterId).filter(Boolean))) {
    revalidatePath(`/kellerbuch/behaelter/${b}/behandlungen`)
    revalidatePath(`/kellerbuch/behaelter/${b}/bewegungen`)
  }
  for (const c of new Set(zeilen.map(z => z.chargeId).filter(Boolean))) {
    revalidatePath(`/kellerbuch/weinausbau/${c}`)
    revalidatePath(`/kellerbuch/weinausbau/${c}/buch`)
  }
  if (stoff) revalidatePath('/kellerbuch/besondere-konten')
  revalidatePath('/kellerbuch/sammelbehandlung')
  revalidatePath('/kellerbuch')
}

export async function speichereSammelbehandlung(formData: FormData): Promise<SammelErgebnis> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kontext()

  const datum = String(formData.get('datum') ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new AktionsFehler('Bitte ein gültiges Datum angeben.')
  const typId = String(formData.get('typ_id') ?? '')
  if (!typId) throw new AktionsFehler('Kein Behandlungstyp angegeben')
  const modus = String(formData.get('modus') ?? '')

  let ids: unknown
  try { ids = JSON.parse(String(formData.get('chargen_json') ?? '[]')) } catch { ids = null }
  if (!Array.isArray(ids) || ids.some(x => typeof x !== 'string' || !x)) throw new AktionsFehler('Ungültige Eingabe: Die gewählten Gebinde konnten nicht gelesen werden.')
  const chargeIds = [...new Set(ids as string[])]
  if (chargeIds.length !== (ids as string[]).length) throw new AktionsFehler('Eine Charge ist doppelt gewählt.')
  if (chargeIds.length > SAMMEL_MAX) throw new AktionsFehler(`Eine Sammelmaßnahme umfasst höchstens ${SAMMEL_MAX} Chargen.`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: typRaw, error: typErr } = await (supabase.from('keller_behandlungstypen') as any)
    .select('id, name, einheit_standard, pn_wirkung').eq('id', typId).eq('tenant_id', tenantId).maybeSingle()
  if (typErr) throw new AktionsFehler(dbFehlerText(typErr, 'Behandlungstyp konnte nicht geladen werden'))
  if (!typRaw) throw new AktionsFehler('Behandlungstyp nicht gefunden')
  const typ = typRaw as R

  const einheit = String(formData.get('einheit') ?? '') || (typ.einheit_standard as string | null) || null
  const mengeText = String(formData.get('menge') ?? '').trim()
  const menge = einheit === '-' ? null : (mengeText ? zahlAus(mengeText) : null)
  if (einheit !== '-' && mengeText && menge === null) throw new AktionsFehler('Die Menge ist keine gültige Zahl.')
  let notizen = String(formData.get('notizen') ?? '').trim() || null

  // Chargen aus der Datenbank: nur aktive, nicht abgeschlossene Chargen des Betriebs, die ein Gebinde belegen
  const { data: chargenRaw, error: chargenErr } = await inBloecken<R>(chargeIds, b =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    nurBelegendeChargen((supabase.from('weinausbau') as any).select('id, name, menge_liter, behaelter_id').eq('tenant_id', tenantId)).in('id', b))
  if (chargenErr) throw new AktionsFehler(dbFehlerText(chargenErr, 'Chargen konnten nicht geladen werden'))
  const jeId = new Map(chargenRaw.map(c => [String(c.id), c]))
  const fehlt = chargeIds.filter(id => !jeId.get(id)?.behaelter_id)
  if (fehlt.length) throw new AktionsFehler('Mindestens eine gewählte Charge gibt es nicht mehr, sie ist abgeschlossen oder liegt in keinem Gebinde – bitte die Seite neu laden.')
  const chargen: (SammelCharge & { name: string | null })[] = chargeIds.map(id => {
    const c = jeId.get(id) as R
    return { chargeId: id, behaelterId: String(c.behaelter_id), liter: Number(c.menge_liter) || 0, name: (c.name as string | null) ?? null }
  })

  // Stoffkonto (KAN-107): bei Zuckerung, RTK, Säuerung, Entsäuerung Pflicht, sobald der Betrieb Stoffe angelegt hat
  const stoffId = String(formData.get('kellermittel_id') ?? '').trim() || null
  const stoffText = String(formData.get('kellermittel_menge') ?? '').trim()
  const stoffGesamt = stoffId ? (stoffText ? zahlAus(stoffText) : null) : null
  if (stoffId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: km, error: kmErr } = await (supabase.from('kellermittel') as any)
      .select('id').eq('id', stoffId).eq('tenant_id', tenantId).eq('aktiv', true).maybeSingle()
    if (kmErr) throw new AktionsFehler(dbFehlerText(kmErr, 'Stoff konnte nicht geladen werden'))
    if (!km) throw new AktionsFehler('Stoff nicht gefunden oder nicht aktiv.')
  } else if (istStoffkontoTyp(typ.name as string)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count, error: kmZErr } = await (supabase.from('kellermittel') as any)
      .select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('aktiv', true)
    if (kmZErr) throw new AktionsFehler(dbFehlerText(kmZErr, 'Stoffe konnten nicht geprüft werden'))
    if ((count ?? 0) > 0) throw new AktionsFehler(`Bei „${typ.name}“ bitte den verwendeten Stoff aus dem Stoffkonto (Besondere Konten) wählen.`)
  }

  const fehler = sammelFehler({ chargen, modus, menge, einheit, stoffId, stoffGesamt })
  if (fehler) throw new AktionsFehler(fehler)
  if (!istSammelModus(modus)) throw new AktionsFehler('Bitte wählen, ob die Menge als Gesamtmenge oder als Dosis je hl gilt.')

  // KAN-100: Prüfnummer – eine Rückfrage für alle betroffenen Chargen
  let hinweis: string | undefined
  const ziele = chargen.map(c => ({ chargeId: c.chargeId, name: c.name }))
  if (typ.pn_wirkung === 'veraenderung') {
    const pn = await pruefePruefnummernSchaden(supabase, tenantId, 'behandlung', ziele, datum)   // wirft bei eingereichtem Antrag
    if (pn && formData.get('pn_bestaetigt') !== '1') return { bestaetigung: pn.frage }
    if (pn) notizen = mitPnNotiz(notizen, pn.notiz)
  } else if (typ.pn_wirkung !== 'pflege') {
    let betroffen: boolean
    try { betroffen = (await pruefePruefnummernSchaden(supabase, tenantId, 'behandlung', ziele, datum)) !== null }
    catch { betroffen = true }   // eingereichter Antrag
    if (betroffen) hinweis = pnWirkungUnklarHinweis(String(typ.name ?? ''))
  }

  const zeilen = sammelZeilen({ chargen, modus, menge, stoffGesamt })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sammelId, error } = await (supabase as any).rpc('s112_kellerbehandlung_sammel', {
    p_tenant_id: tenantId,
    p_kopf: { datum, typ_id: typId, einheit, notizen, kellermittel_id: stoffId },
    p_zeilen: zeilen.map(z => ({ weinausbau_id: z.chargeId, menge: z.menge, stoff_menge: z.stoffMenge })),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Die Sammelmaßnahme wurde nicht gespeichert'))
  if (!sammelId) throw new AktionsFehler('Die Sammelmaßnahme wurde nicht gespeichert.')

  aktualisiere(zeilen, !!stoffId)
  return hinweis ? { sammelId: String(sammelId), anzahl: zeilen.length, hinweis } : { sammelId: String(sammelId), anzahl: zeilen.length }
}

/** Ganze Sammelmaßnahme stornieren: alle noch nicht stornierten Behandlungen in einer Anweisung, Stoff zurück ins Stoffkonto */
export async function storniereSammelbehandlung(sammelId: string, grund: string): Promise<{ anzahl: number }> {
  const supabase = await createSupabaseServerClient()
  const tenantId = await kontext()
  if (!/^[0-9a-f-]{36}$/i.test(sammelId ?? '')) throw new AktionsFehler('Keine Sammelmaßnahme angegeben')
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('keller_behandlungen') as any)
    .update({ storniert_am: new Date().toISOString(), storno_grund: grund.trim() })
    .eq('tenant_id', tenantId).eq('sammel_id', sammelId).is('storniert_am', null)
    .select('id, behaelter_id, weinausbau_id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Stornieren fehlgeschlagen (Sammelmaßnahme)'))
  const zeilen = (data ?? []) as R[]
  if (zeilen.length === 0) throw new AktionsFehler('Sammelmaßnahme nicht gefunden, bereits storniert oder keine Berechtigung.')

  // KAN-107: Verwendungen im Stoffkonto per Gegenbuchung aufheben (append-only; je Buchung nur einmal)
  const { data: kb, error: kbErr } = await inBloecken<R>(zeilen.map(z => String(z.id)), b =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('kellermittel_buchungen') as any)
      .select('id, kellermittel_id, menge, weinausbau_id, behaelter_id, keller_behandlung_id')
      .eq('tenant_id', tenantId).eq('art', 'verwendung').in('keller_behandlung_id', b))
  if (kbErr) throw new AktionsFehler(dbFehlerText(kbErr, 'Storniert, aber das Stoffkonto konnte nicht geladen werden'))
  for (const b of kb) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: sErr } = await (supabase.from('kellermittel_buchungen') as any).insert({
      tenant_id: tenantId, kellermittel_id: b.kellermittel_id, datum: wienHeute(), art: 'storno', menge: -Number(b.menge),
      storno_von_id: b.id, keller_behandlung_id: b.keller_behandlung_id, weinausbau_id: b.weinausbau_id, behaelter_id: b.behaelter_id,
      notizen: `Storno der Sammelmaßnahme: ${grund.trim()}`,
    })
    if (sErr && (sErr as R).code !== '23505') throw new AktionsFehler(`Storniert, aber die Gegenbuchung im Stoffkonto fehlt: ${dbFehlerText(sErr)}`)
  }

  aktualisiere(zeilen.map(z => ({ behaelterId: z.behaelter_id ?? null, chargeId: z.weinausbau_id ?? null })), kb.length > 0)
  return { anzahl: zeilen.length }
}
