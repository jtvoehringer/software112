import 'server-only'

// ── Traubenverkauf stornieren (KAN-148 C1b, 30.09.2026) ──────────────────────
// Gemeinsam für weinhandel/traubenverkauf/actions.ts und erntemeldung/actions.ts. Stornieren statt Löschen
// (BKI, KAN-145): Die Zeile bleibt mit Datum, Benutzer und Grund stehen, Liefernummer und Rechnungsbezug
// (verkauf_positionen.traubenverkauf_id) bleiben, die kg werden wieder frei. Hat der Traubenverkauf eine
// offene Rechnung, die nur ihn enthält, wird sie über den normalen Verkaufsstorno storniert (der storniert
// dabei auch den Traubenverkauf, mit diesem Grund). Eine Mischrechnung wird nur als Ganzes unter
// Weinhandel › Verkauf storniert.

import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { canWrite, type Membership } from '@/lib/auth/roles'
import { stornoGrundFehler } from '@/lib/storno/grund'
import { verkaufspostenStornieren } from '@/lib/verkauf/bestand'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

/** Storniert den Traubenverkauf; liefert die Rechnung (verkaufsposten_id), falls vorhanden – für revalidatePath */
export async function traubenverkaufStornieren(
  supabase: SB, membership: Membership, id: string, grund: string,
): Promise<{ postenId: string | null }> {
  const fehler = stornoGrundFehler(grund)
  if (fehler) throw new AktionsFehler(fehler)
  if (!canWrite(membership, 'rieden') && !canWrite(membership, 'warenwirtschaft')) {
    throw new AktionsFehler('Traubenverkäufe stornieren dürfen Betriebs-Manager und Mitarbeiter mit Freigabe Rieden oder Warenwirtschaft.')
  }
  const tenantId = membership.tenantId
  const text = grund.trim()

  // storno-sichtbar: der Traubenverkauf selbst – bereits stornierte lehnt die Prüfung darunter verständlich ab
  const { data: tv, error: tvErr } = await supabase.from('traubenverkauf')
    .select('id, verkaufsposten_id, storniert_am')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (tvErr) throw new AktionsFehler(dbFehlerText(tvErr, 'Traubenverkauf konnte nicht geladen werden'))
  if (!tv) throw new AktionsFehler('Traubenverkauf nicht gefunden – bitte Seite neu laden.')
  if ((tv as R).storniert_am) throw new AktionsFehler('Dieser Traubenverkauf ist bereits storniert – bitte Seite neu laden.')
  const postenId = (tv as R).verkaufsposten_id as string | null

  if (postenId) {
    const [postenRes, posRes] = await Promise.all([
      supabase.from('verkaufsposten')
        .select('rechnungsnummer, storniert')
        .eq('id', postenId)
        .eq('tenant_id', tenantId)
        .maybeSingle(),
      supabase.from('verkauf_positionen')
        .select('id, typ, traubenverkauf_id')
        .eq('verkaufsposten_id', postenId)
        .eq('tenant_id', tenantId),
    ])
    if (postenRes.error) throw new AktionsFehler(dbFehlerText(postenRes.error, 'Rechnung zum Traubenverkauf konnte nicht geladen werden'))
    if (posRes.error) throw new AktionsFehler(dbFehlerText(posRes.error, 'Rechnungspositionen konnten nicht geladen werden'))
    const posten = postenRes.data as R | null
    if (posten && !posten.storniert) {
      // Nur stornieren, wenn die Rechnung ausschließlich diesen Traubenverkauf enthält
      // (Traubenverkauf/Erntemeldung: Position 'sonstiges' ohne Verweis; Verkaufsformular:
      // Position 'trauben' mit Verweis) – eine Mischrechnung wird nur als Ganzes storniert.
      const positionen = (posRes.data ?? []) as R[]
      const nurDieserVerkauf = positionen.length <= 1 && positionen.every(p =>
        (p.typ === 'trauben' && p.traubenverkauf_id === id) || (p.typ === 'sonstiges' && !p.traubenverkauf_id))
      if (!nurDieserVerkauf) {
        throw new AktionsFehler(`Der Traubenverkauf gehört zur Rechnung ${posten.rechnungsnummer ?? '(ohne Nummer)'} mit weiteren Positionen und kann hier nicht storniert werden. Bitte den Verkauf unter Weinhandel › Verkauf stornieren.`)
      }
      // Storno der Rechnung – storniert dabei auch diesen Traubenverkauf (mit diesem Grund)
      await verkaufspostenStornieren(supabase, tenantId, postenId, text)
    }
  }

  // Traubenverkauf stornieren, falls der Rechnungsstorno es nicht schon getan hat
  const { error: stornoErr } = await supabase.from('traubenverkauf')
    .update({ storniert_am: new Date().toISOString(), storno_grund: text })   // aenderung-ohne-pruefung: Erfolgsprüfung direkt danach (die Zeile muss jetzt storniert sein)
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .is('storniert_am', null)
  if (stornoErr) throw new AktionsFehler(dbFehlerText(stornoErr, 'Traubenverkauf konnte nicht storniert werden'))
  // storno-sichtbar: Erfolgsprüfung – die Zeile muss jetzt storniert sein (RLS ändert ohne Recht still 0 Zeilen)
  const { data: jetzt, error: jetztErr } = await supabase.from('traubenverkauf')
    .select('storniert_am')
    .eq('id', id)
    .eq('tenant_id', tenantId)
    .maybeSingle()
  if (jetztErr) throw new AktionsFehler(dbFehlerText(jetztErr, 'Traubenverkauf konnte nicht geprüft werden'))
  if (jetzt && !(jetzt as R).storniert_am) {
    throw new AktionsFehler('Der Traubenverkauf konnte nicht storniert werden – keine Schreibberechtigung (Rieden bzw. Warenwirtschaft)?')
  }
  return { postenId }
}
