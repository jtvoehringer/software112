'use server'

// KAN-418 Teil 4 (12.11.2026): Angebote. Geschrieben wird nur über die RPCs s112_angebot_anlegen, s112_angebot_aendern
// und s112_angebot_status_setzen (prüfen Rollen, Abo-Sperre und Schreibrecht Warenwirtschaft in einer Transaktion).
// Ein Angebot reserviert nichts; die Übernahme in einen Auftrag läuft über createAuftrag (auftraege/actions.ts).

import { revalidatePath } from 'next/cache'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { pruefeSeitenBetrieb } from '@/lib/auth/seitenBetrieb'
import { pruefeSchreibzugriff } from '@/lib/auth/sperren'
import { AktionsFehler, dbFehlerText } from '@/lib/fehler'
import { heuteWien } from '@/lib/datum/wien'
import { angebotFehler, angebotGrundFehler, angebotPositionenAus, angebotPositionenFuerDb } from '@/lib/auftrag/angebot'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getCtx() {
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) throw new AktionsFehler('Kein Mandant')
  await pruefeSeitenBetrieb(membership.tenantId)   // KAN-30: Seite aus einem anderen Betrieb?
  await pruefeSchreibzugriff(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (!canWrite(membership, 'warenwirtschaft')) throw new AktionsFehler('Keine Berechtigung für Angebote – dafür ist die Freigabe Warenwirtschaft nötig.')
  return { supabase, tenantId: membership.tenantId }
}

function neuLaden() {
  revalidatePath('/weinhandel/angebote')
  revalidatePath('/weinhandel/angebote/[id]', 'page')
}

/** Angebot anlegen (ohne `id`) bzw. ein offenes Angebot ändern (mit `id`) – Kopf und Positionen in einem Zug */
export async function speichereAngebot(formData: FormData): Promise<{ error?: string; id?: string; nummer?: string }> {
  try {
    const { supabase, tenantId } = await getCtx()
    const id = String(formData.get('id') ?? '')
    if (id && !UUID.test(id)) return { error: 'Angebot nicht gefunden.' }
    const kunde = String(formData.get('kunde') ?? '')   // „kontakt:<uuid>“ bzw. „firma:<uuid>“ (PartnerSuche)
    const [kundeTyp, kundeId] = kunde.split(':')
    const kopf = {
      kunde: (kundeTyp === 'kontakt' || kundeTyp === 'firma') && UUID.test(kundeId ?? '') ? kunde : '',
      datum: String(formData.get('datum') ?? ''),
      gueltig_bis: String(formData.get('gueltig_bis') ?? ''),
      notizen: (String(formData.get('notizen') ?? '').trim() || null),
    }
    const positionen = angebotPositionenAus(formData.get('positionen_json'))
    const fehler = angebotFehler(kopf, positionen, heuteWien())
    if (fehler || !positionen) return { error: fehler ?? 'Die Positionen konnten nicht gelesen werden.' }

    const p_kopf = {
      kontakt_id: kundeTyp === 'kontakt' ? kundeId : null, firma_id: kundeTyp === 'firma' ? kundeId : null,
      datum: kopf.datum, gueltig_bis: kopf.gueltig_bis, notizen: kopf.notizen,
    }
    const p_positionen = angebotPositionenFuerDb(positionen)
    const { data, error } = id
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ? await (supabase.rpc as any)('s112_angebot_aendern', { p_tenant_id: tenantId, p_angebot_id: id, p_kopf, p_positionen })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      : await (supabase.rpc as any)('s112_angebot_anlegen', { p_tenant_id: tenantId, p_kopf, p_positionen })
    if (error) return { error: dbFehlerText(error, 'Das Angebot konnte nicht gespeichert werden') }
    const erg = (Array.isArray(data) ? data[0] : data) as R | null
    if (!erg?.id) return { error: 'Unerwartete Antwort der Datenbank – bitte die Angebotsliste prüfen, bevor du erneut speicherst.' }
    neuLaden()
    return { id: String(erg.id), nummer: String(erg.nummer ?? '') }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}

/** Offenes Angebot ablehnen (Grund freiwillig) bzw. stornieren (Grund Pflicht) */
export async function setzeAngebotStatus(id: string, status: 'abgelehnt' | 'storniert', grund: string): Promise<{ error?: string }> {
  try {
    if (!UUID.test(id) || (status !== 'abgelehnt' && status !== 'storniert')) return { error: 'Angebot nicht gefunden.' }
    const grundFehler = angebotGrundFehler(status, grund)
    if (grundFehler) return { error: grundFehler }
    const { supabase, tenantId } = await getCtx()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase.rpc as any)('s112_angebot_status_setzen', { p_tenant_id: tenantId, p_angebot_id: id, p_status: status, p_grund: (grund ?? '').trim() })
    if (error) return { error: dbFehlerText(error, status === 'storniert' ? 'Das Angebot konnte nicht storniert werden' : 'Das Angebot konnte nicht abgelehnt werden') }
    neuLaden()
    return {}
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Unbekannter Fehler' }
  }
}
