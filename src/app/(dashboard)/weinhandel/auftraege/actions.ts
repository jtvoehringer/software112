'use server'

// KAN-418 Teil 1 (12.11.2026): Aufträge mit Bestandsreservierung. Geschrieben wird über die RPCs s112_auftrag_anlegen und
// s112_auftrag_stornieren (prüfen Rollen, Abo-Sperre, Schreibrecht Warenwirtschaft und den verfügbaren Bestand in einer
// Transaktion); nur die Reservierungsfrist ändert die Action direkt (die Datenbank lässt an einem Auftrag sonst nichts zu).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText, NICHT_GESPEICHERT } from '@/lib/fehler'
import { heuteWien } from '@/lib/datum/wien'
import { auftragFehler, auftragPositionenAus, fristFehler, stornoGrundFehlerAuftrag } from '@/lib/auftrag/regeln'
import { alle } from '@/lib/supabase/alle'
import { auftragIdAus, LIEFERBAR_STATUS, lieferVorschlag, type AuftragZeile, type LieferVorschlag } from '@/lib/auftrag/lieferung'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

async function getCtx() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Kein Mandant')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Berechtigung für Aufträge – dafür ist die Freigabe Warenwirtschaft nötig.')
  return { supabase, tenantId: membership.tenantId }
}

function neuLaden() {
  revalidatePath('/weinhandel/auftraege')
  revalidatePath('/weinhandel/auftraege/[id]', 'page')
  revalidatePath('/weinhandel')
}

export async function createAuftrag(formData: FormData): Promise<{ error?: string; id?: string; nummer?: string }> {
  try {
    const { supabase, tenantId } = await getCtx()
    const kunde = String(formData.get('kunde') ?? '')   // „kontakt:<uuid>“ bzw. „firma:<uuid>“ (PartnerSuche)
    const [kundeTyp, kundeId] = kunde.split(':')
    const kopf = {
      kunde: (kundeTyp === 'kontakt' || kundeTyp === 'firma') && /^[0-9a-f-]{36}$/i.test(kundeId ?? '') ? kunde : '',
      datum: String(formData.get('datum') ?? ''),
      reserviert_bis: String(formData.get('reserviert_bis') ?? ''),
      notizen: (String(formData.get('notizen') ?? '').trim() || null),
    }
    const positionen = auftragPositionenAus(formData.get('positionen_json'))
    const fehler = auftragFehler(kopf, positionen, heuteWien())
    if (fehler || !positionen) return { error: fehler ?? 'Die Positionen konnten nicht gelesen werden.' }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.rpc as any)('s112_auftrag_anlegen', {
      p_tenant_id: tenantId,
      p_kopf: {
        kontakt_id: kundeTyp === 'kontakt' ? kundeId : null, firma_id: kundeTyp === 'firma' ? kundeId : null,
        datum: kopf.datum, reserviert_bis: kopf.reserviert_bis, notizen: kopf.notizen,
      },
      p_positionen: positionen,
    })
    if (error) return { error: dbFehlerText(error, 'Der Auftrag konnte nicht angelegt werden') }
    const erg = (Array.isArray(data) ? data[0] : data) as R | null
    if (!erg?.id) return { error: 'Unerwartete Antwort der Datenbank – bitte die Auftragsliste prüfen, bevor du erneut speicherst.' }
    neuLaden()
    return { id: String(erg.id), nummer: String(erg.nummer ?? '') }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

export async function stornoAuftrag(id: string, grund: string): Promise<{ error?: string }> {
  try {
    const grundFehler = stornoGrundFehlerAuftrag(grund)
    if (grundFehler) return { error: grundFehler }
    const { supabase, tenantId } = await getCtx()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('s112_auftrag_stornieren', { p_tenant_id: tenantId, p_auftrag_id: id, p_grund: grund.trim() })
    if (error) return { error: dbFehlerText(error, 'Der Auftrag konnte nicht storniert werden') }
    neuLaden()
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

/** KAN-418 Teil 2: Vorbelegung des Verkaufsformulars – Kunde und offene Mengen eines lieferbaren Auftrags */
export async function ladeAuftragFuerLieferung(id: string): Promise<{ error: string } | { id: string; nummer: string; kunde: string; positionen: LieferVorschlag[] }> {
  try {
    const auftragId = auftragIdAus(id)
    if (!auftragId) return { error: 'Auftrag nicht gefunden.' }
    const { supabase, tenantId } = await getCtx()
    const { data: aRaw, error: aErr } = await (supabase.from('auftraege') as R)
      .select('id, nummer, status, kontakt_id, firma_id').eq('id', auftragId).eq('tenant_id', tenantId).maybeSingle()
    if (aErr) return { error: dbFehlerText(aErr, 'Der Auftrag konnte nicht geladen werden') }
    const a = aRaw as R | null
    if (!a) return { error: 'Auftrag nicht gefunden.' }
    if (!LIEFERBAR_STATUS.includes(String(a.status))) return { error: `Der Auftrag ${a.nummer} lässt sich nicht mehr liefern.` }
    const { data: zeilen, error: zErr } = await alle<R>((supabase.from('auftrag_positionen') as R)
      .select('id, fuellung_id, name, menge, geliefert').eq('tenant_id', tenantId).eq('auftrag_id', auftragId).order('erstellt_am').order('id'))
    if (zErr) return { error: dbFehlerText(zErr, 'Die Positionen des Auftrags konnten nicht geladen werden') }
    return {
      id: String(a.id), nummer: String(a.nummer),
      kunde: a.firma_id ? `firma:${a.firma_id}` : `kontakt:${a.kontakt_id}`,
      positionen: lieferVorschlag((zeilen ?? []) as unknown as AuftragZeile[]),
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

/** KAN-418 Teil 2: teilgelieferten Auftrag abschließen – der Rest wird nicht mehr geliefert, die Reservierung fällt weg */
export async function auftragAbschliessen(id: string): Promise<{ error?: string }> {
  try {
    const { supabase, tenantId } = await getCtx()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('s112_auftrag_abschliessen', { p_tenant_id: tenantId, p_auftrag_id: id })
    if (error) return { error: dbFehlerText(error, 'Der Auftrag konnte nicht abgeschlossen werden') }
    neuLaden()
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

/** Reservierung verlängern bzw. verkürzen (nicht vor heute) */
export async function setzeReservierungBis(id: string, bis: string): Promise<{ error?: string }> {
  try {
    const fehler = fristFehler(bis, heuteWien())
    if (fehler) return { error: fehler }
    const { supabase, tenantId } = await getCtx()
    const { data, error } = await (supabase.from('auftraege') as R)
      .update({ reserviert_bis: bis })
      .eq('id', id).eq('tenant_id', tenantId).is('storniert_am', null)
      .select('id')
    if (error) return { error: dbFehlerText(error) }
    if (!(data as unknown[] | null)?.length) return { error: NICHT_GESPEICHERT }
    neuLaden()
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}
