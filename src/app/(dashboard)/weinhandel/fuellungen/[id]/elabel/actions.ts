'use server'

// ── KAN-216 (06.10.2026): E-Label je Füllung – Zutatenliste, Nährwerte, Freigabe ─────────────────────────────
// Nährwerte rechnet der Server aus den Eingangswerten (lib/elabel/eingabe), außer bei „von Hand“ mit Grund.
// Freigegeben ist gesperrt (DB: a_freeze auf elabels); Kennung und Freigabe-Stempel setzt die Datenbank.

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite, type Membership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { freezeSperreAus, sperrMeldung } from '@/lib/freeze/sperre'
import { elabelZeile, freigabeFehler, type ElabelEingabe, type ElabelZeile } from '@/lib/elabel/eingabe'
import { umleitungGrundFehler } from '@/lib/elabel/oeffentlich'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const FELD_LABEL: Record<string, string> = {
  zutaten_ids: 'Zutatenliste', analyse_id: 'Analyse', alkohol_vol: 'Alkohol', restzucker_gl: 'Restzucker',
  gesamtsaeure_gl: 'Gesamtsäure', glycerin_gl: 'Glycerin', energie_kj: 'Brennwert (kJ)', energie_kcal: 'Brennwert (kcal)',
  kohlenhydrate_g: 'Kohlenhydrate', zucker_g: 'Zucker', manuell: 'von Hand', manuell_grund: 'Grund', status: 'Status',
}

async function kontext(): Promise<Membership> {
  const membership = await getCurrentMembership()
  if (!membership) throw new AktionsFehler('Kein aktiver Mandant gefunden')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30
  await pruefeSchreibzugriff(membership)   // KAN-5
  if (!(canWrite(membership, 'kellerbuch') || canWrite(membership, 'warenwirtschaft'))) {
    throw new AktionsFehler('Keine Berechtigung für E-Labels – dafür ist das Modul Kellerbuch oder Warenwirtschaft nötig.')
  }
  return membership
}

function dbFehler(error: unknown, text: string): never {
  const sperre = freezeSperreAus(error)
  throw new AktionsFehler(sperre ? sperrMeldung(sperre, x => FELD_LABEL[x] ?? x) : dbFehlerText(error, text))
}

/** Entwurf anlegen bzw. speichern. */
export async function speichereElabel(fuellungId: string, e: ElabelEingabe): Promise<void> {
  const m = await kontext()
  if (!UUID_RE.test(fuellungId)) throw new AktionsFehler('Ungültige Füllung.')
  const erg = elabelZeile(e)
  if ('fehler' in erg) throw new AktionsFehler(erg.fehler)
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: fuellung } = await (supabase.from('fuellungen') as any)
    .select('id').eq('id', fuellungId).eq('tenant_id', m.tenantId).is('storniert_am', null).maybeSingle()
  if (!fuellung) throw new AktionsFehler('Füllung nicht gefunden oder storniert.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: vorhanden } = await (supabase.from('elabels') as any)
    .select('id').eq('fuellung_id', fuellungId).eq('tenant_id', m.tenantId).maybeSingle()
  if (vorhanden) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('elabels') as any)
      .update(erg.zeile).eq('id', (vorhanden as R).id).eq('tenant_id', m.tenantId).select('id')
    if (error) dbFehler(error, 'E-Label konnte nicht gespeichert werden')
    if (!data || (data as R[]).length === 0) throw new AktionsFehler('E-Label nicht gefunden oder keine Berechtigung.')
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.from('elabels') as any)
      .insert({ ...erg.zeile, tenant_id: m.tenantId, fuellung_id: fuellungId })
    if (error) dbFehler(error, 'E-Label konnte nicht angelegt werden')
  }
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/elabel`)
}

/** Gespeicherten Entwurf freigeben – danach unveränderlich. */
export async function elabelFreigeben(fuellungId: string): Promise<void> {
  const m = await kontext()
  if (!UUID_RE.test(fuellungId)) throw new AktionsFehler('Ungültige Füllung.')
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: raw } = await (supabase.from('elabels') as any)
    .select('id, status, zutaten_ids, energie_kj, energie_kcal, kohlenhydrate_g, zucker_g, manuell, alkohol_vol, restzucker_gl, gesamtsaeure_gl')
    .eq('fuellung_id', fuellungId).eq('tenant_id', m.tenantId).maybeSingle()
  if (!raw) throw new AktionsFehler('Bitte das E-Label zuerst speichern.')
  const z = raw as R
  if (z.status === 'freigegeben') return
  const offen = freigabeFehler(z as ElabelZeile)
  if (offen.length > 0) throw new AktionsFehler(`Für die Freigabe fehlt: ${offen.join(', ')}.`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('elabels') as any)
    .update({ status: 'freigegeben' }).eq('id', z.id).eq('tenant_id', m.tenantId).select('id')
  if (error) dbFehler(error, 'Freigabe fehlgeschlagen')
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('E-Label nicht gefunden oder keine Berechtigung.')
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/elabel`)
}

/** Behandlungstyp einem Katalogeintrag zuordnen (Vorschlag der Zutatenliste); null hebt die Zuordnung auf. */
export async function setzeBehandlungstypZutat(fuellungId: string, typId: string, zutatId: string | null): Promise<void> {
  const m = await kontext()
  if (!canWrite(m, 'kellerbuch')) throw new AktionsFehler('Die Zuordnung der Behandlungstypen braucht das Modul Kellerbuch.')
  if (!UUID_RE.test(typId) || (zutatId != null && !UUID_RE.test(zutatId))) throw new AktionsFehler('Ungültige Auswahl.')
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.from('keller_behandlungstypen') as any)
    .update({ elabel_zutat_id: zutatId }).eq('id', typId).eq('tenant_id', m.tenantId).select('id')
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Zuordnung konnte nicht gespeichert werden'))
  if (!data || (data as R[]).length === 0) throw new AktionsFehler('Behandlungstyp nicht gefunden oder keine Berechtigung.')
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/elabel`)
}

/**
 * KAN-219: QR-Code eines freigegebenen E-Labels auf ein anderes freigegebenes E-Label des Betriebs umleiten (z. B. die
 * Nachfolgefüllung); zielId null hebt die Umleitung auf. Regeln und Protokoll in der RPC s112_elabel_umleiten.
 */
export async function elabelUmleiten(fuellungId: string, zielId: string | null, grund: string): Promise<void> {
  const m = await kontext()
  if (!UUID_RE.test(fuellungId) || (zielId !== null && !UUID_RE.test(zielId))) throw new AktionsFehler('Ungültige Auswahl.')
  const gf = umleitungGrundFehler(grund ?? '')
  if (gf) throw new AktionsFehler(gf)
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: e } = await (supabase.from('elabels') as any)
    .select('id').eq('fuellung_id', fuellungId).eq('tenant_id', m.tenantId).maybeSingle()
  if (!e) throw new AktionsFehler('E-Label nicht gefunden.')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.rpc as any)('s112_elabel_umleiten', {
    p_tenant_id: m.tenantId, p_elabel_id: (e as R).id, p_ziel_id: zielId, p_grund: grund.trim(),
  })
  if (error) throw new AktionsFehler(dbFehlerText(error, 'Umleitung konnte nicht gespeichert werden'))
  revalidatePath(`/weinhandel/fuellungen/${fuellungId}/elabel`)
}
