'use server'

// ── Besondere Konten – Stoffkonto (KAN-107, 07.10.2026) ──
// Stoffe anlegen/deaktivieren und Buchungen erfassen (Anfangsbestand, Zugang, Inventur, Storno). Buchungen sind
// append-only (DB: kein UPDATE/DELETE per API); Verwendung bucht die Kellerbehandlung (speichereKellerbehandlung).

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { revalidatePath } from 'next/cache'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { zahlAus } from '@/lib/format'
import { wienHeute } from '@/lib/csv'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { buchungsMenge, inventurDifferenz, type KontoArt } from '@/lib/kellerbuch/stoffkonto'
import { ladeKontoBuchungen } from '@/lib/behoerden/besondereKonten'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function kontext() {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein Betrieb gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!canWrite(membership, 'kellerbuch')) throw new AktionsFehler('Keine Schreibberechtigung für das Kellerbuch in diesem Betrieb.')
  return { supabase: await createSupabaseServerClient(), tenantId: membership.tenantId }
}

const PFAD = '/kellerbuch/besondere-konten'
const text = (fd: FormData, k: string) => ((fd.get(k) as string | null) ?? '').trim() || null

export async function stoffAnlegen(fd: FormData): Promise<void> {
  const { supabase, tenantId } = await kontext()
  const name = text(fd, 'name')
  const einheit = text(fd, 'einheit')
  if (!name || name.length > 80) throw new AktionsFehler('Bitte einen Namen für den Stoff angeben (höchstens 80 Zeichen).')
  if (einheit !== 'kg' && einheit !== 'l') throw new AktionsFehler('Bitte als Einheit kg oder l wählen.')
  const { error } = await (supabase.from('kellermittel') as R).insert({ tenant_id: tenantId, name, einheit, notizen: text(fd, 'notizen') })
  if (error) throw new AktionsFehler((error as R).code === '23505' ? `Den Stoff „${name}“ gibt es schon.` : dbFehlerText(error, 'Stoff konnte nicht angelegt werden'))
  revalidatePath(PFAD)
}

export async function stoffAktivSetzen(id: string, aktiv: boolean): Promise<void> {
  const { supabase, tenantId } = await kontext()
  const { error } = await (supabase.from('kellermittel') as R).update({ aktiv }).eq('id', id).eq('tenant_id', tenantId)
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Stoff konnte nicht geändert werden'))
  revalidatePath(PFAD)
}

/** Anfangsbestand, Zugang oder Inventur (Ist-Bestand → Differenzbuchung zum Saldo am Datum) */
export async function kontoBuchen(fd: FormData): Promise<{ hinweis?: string }> {
  const { supabase, tenantId } = await kontext()
  const kellermittelId = text(fd, 'kellermittel_id')
  const art = text(fd, 'art') as KontoArt | null
  const datum = text(fd, 'datum')
  if (!kellermittelId) throw new AktionsFehler('Bitte einen Stoff wählen.')
  if (art !== 'anfangsbestand' && art !== 'zugang' && art !== 'inventur') throw new AktionsFehler('Unbekannte Buchungsart.')
  if (!datum || !/^\d{4}-\d{2}-\d{2}$/.test(datum)) throw new AktionsFehler('Bitte ein Datum angeben.')
  if (datum > wienHeute()) throw new AktionsFehler('Das Datum liegt in der Zukunft.')
  const eingabe = zahlAus(fd.get('menge'))
  let menge: number
  if (art === 'inventur') {
    if (eingabe === null || eingabe < 0) throw new AktionsFehler('Bitte den gezählten Ist-Bestand angeben.')
    const bisher = (await ladeKontoBuchungen(supabase, tenantId, kellermittelId)).filter(b => b.datum <= datum).reduce((s, b) => s + b.menge, 0)
    menge = inventurDifferenz(eingabe, bisher)
    if (menge === 0) return { hinweis: 'Der Ist-Bestand stimmt mit dem Saldo überein – keine Buchung nötig.' }
  } else {
    const m = buchungsMenge(art, eingabe)
    if ('fehler' in m) throw new AktionsFehler(m.fehler)
    menge = m.menge
  }
  const { error } = await (supabase.from('kellermittel_buchungen') as R).insert({
    tenant_id: tenantId, kellermittel_id: kellermittelId, datum, art, menge,
    lieferant: art === 'zugang' ? text(fd, 'lieferant') : null, beleg: text(fd, 'beleg'), los: art === 'zugang' ? text(fd, 'los') : null,
    notizen: text(fd, 'notizen'),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Buchung fehlgeschlagen'))
  revalidatePath(PFAD)
  return art === 'inventur' ? { hinweis: `Inventurdifferenz ${menge > 0 ? '+' : ''}${String(menge).replace('.', ',')} gebucht.` } : {}
}

/** Storno: Gegenbuchung mit umgekehrtem Vorzeichen am heutigen Tag (die Buchung selbst bleibt unverändert) */
export async function kontoStornieren(buchungId: string, grund: string): Promise<void> {
  const { supabase, tenantId } = await kontext()
  const f = stornoGrundFehler(grund)
  if (f) throw new AktionsFehler(f)
  const { data: b, error } = await (supabase.from('kellermittel_buchungen') as R)
    .select('id, kellermittel_id, art, menge, keller_behandlung_id, weinausbau_id, behaelter_id').eq('id', buchungId).eq('tenant_id', tenantId).maybeSingle()
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Buchung konnte nicht geladen werden'))
  if (!b) throw new AktionsFehler('Buchung nicht gefunden.')
  if (b.art === 'storno') throw new AktionsFehler('Eine Storno-Buchung kann nicht storniert werden.')
  const { error: e } = await (supabase.from('kellermittel_buchungen') as R).insert({
    tenant_id: tenantId, kellermittel_id: b.kellermittel_id, datum: wienHeute(), art: 'storno', menge: -Number(b.menge),
    storno_von_id: b.id, keller_behandlung_id: b.keller_behandlung_id, weinausbau_id: b.weinausbau_id, behaelter_id: b.behaelter_id,
    notizen: grund.trim(),
  })
  if (e) throw new AktionsFehler((e as R).code === '23505' ? 'Diese Buchung ist bereits storniert.' : dbFehlerText(e, 'Storno fehlgeschlagen'))
  revalidatePath(PFAD)
}
