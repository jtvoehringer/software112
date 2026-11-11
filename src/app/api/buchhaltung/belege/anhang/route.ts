// POST /api/buchhaltung/belege/anhang – Beleg(e) an eine bestehende E&A-Buchung hängen (KAN-415)
//
// Formularfelder: transaktion_id (Pflicht) und entweder
//   • file (eine oder mehrere Dateien: PDF, JPEG, PNG, WebP; zusammen höchstens 4 MB) – ohne KI-Erkennung, oder
//   • beleg_id – ein per Belegscan erfasster, noch nicht verbuchter Beleg wird dieser Buchung zugeordnet
//     (statt eine zweite Buchung zu erzeugen).
// Der Beleg ist danach „verbucht“ und unveränderlich (Trigger a_ea_abschluss_schutz). Die Buchung selbst ändert sich
// nicht – deshalb auch in abgeschlossenen Monaten erlaubt.

import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { dbFehlerText } from '@/lib/fehler'
import { formBody, ungueltigeAnfrage } from '@/lib/api/body'
import { buchungFuerAnhangFehler, dateienAus, haengeDateienAn } from '@/lib/buchhaltung/belegSpeichern'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const supabase = await createSupabaseServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Nicht angemeldet' }, { status: 401 })

  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId
  if (!tenantId) return NextResponse.json({ error: 'Kein Betrieb' }, { status: 403 })
  const konflikt = await seitenBetriebKonflikt(tenantId, 'error')   // KAN-30: Anfrage aus einem veralteten Tab?
  if (konflikt) return konflikt
  const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
  if (gesperrt) return gesperrt
  if (!canWrite(membership, 'ea')) return NextResponse.json({ error: 'Keine Berechtigung – dafür ist die Freigabe E&A nötig.' }, { status: 403 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: einst, error: einstErr } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea').eq('tenant_id', tenantId).maybeSingle()
  if (einstErr) return NextResponse.json({ error: `Betriebseinstellungen konnten nicht geladen werden: ${dbFehlerText(einstErr)}` }, { status: 500 })
  if (!(einst as R | null)?.modul_ea) return NextResponse.json({ error: 'E&A-Modul für diesen Betrieb nicht aktiv' }, { status: 403 })

  const formData = await formBody(req)
  if (!formData) return ungueltigeAnfrage('error')
  const transaktionId = String(formData.get('transaktion_id') ?? '')
  if (!UUID.test(transaktionId)) return NextResponse.json({ error: 'Keine Buchung angegeben' }, { status: 400 })
  const buchungFehler = await buchungFuerAnhangFehler(supabase, tenantId, transaktionId)
  if (buchungFehler) return NextResponse.json({ error: buchungFehler }, { status: 400 })

  const belegId = String(formData.get('beleg_id') ?? '')
  if (belegId) {
    if (!UUID.test(belegId)) return NextResponse.json({ error: 'Ungültiger Beleg' }, { status: 400 })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase.from('ea_belege') as any)
      .update({ ea_transaktion_id: transaktionId, status: 'verbucht', verbucht_am: new Date().toISOString() })
      .eq('id', belegId).eq('tenant_id', tenantId).in('status', ['erkannt', 'fehler'])
      .select('id')
    if (error) return NextResponse.json({ error: dbFehlerText(error, 'Der Beleg wurde nicht zugeordnet') }, { status: 500 })
    if (!((data ?? []) as unknown[]).length) {
      return NextResponse.json({ error: 'Der Beleg wurde nicht zugeordnet: nicht gefunden, bereits verbucht oder keine Berechtigung.' }, { status: 409 })
    }
    return NextResponse.json({ ok: true, anzahl: 1 })
  }

  const dateien = dateienAus(formData, 'file')
  if (dateien.length === 0) return NextResponse.json({ error: 'Keine Datei' }, { status: 400 })
  const erg = await haengeDateienAn(supabase, tenantId, user.id, transaktionId, dateien)
  if (erg.error) {
    return NextResponse.json({ error: erg.anzahl > 0 ? `${erg.anzahl} Beleg(e) angehängt, dann: ${erg.error}` : erg.error, anzahl: erg.anzahl }, { status: 400 })
  }
  return NextResponse.json({ ok: true, anzahl: erg.anzahl })
}
