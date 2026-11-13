import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { darfDatenexport } from '@/lib/auth/modul'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { csvDateiname } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { analyseWerte, datenblattCsv, type DatenblattExportZeile } from '@/lib/handel/datenblatt'
import { herkunftText } from '@/lib/handel/datenblattLaden'
import { flaschengroesseText } from '@/lib/export/datenexporte'
import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'
import { elabelUrl } from '@/lib/elabel/oeffentlich'
import { appBasisUrl } from '@/lib/qr'
import { leseKonflikt } from '@/lib/api/lesebereich'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-220 (07.10.2026): Händler-Sammelexport der Produktdatenblätter (alle aktiven, nicht stornierten Füllungen) –
// dieselben Werte wie das PDF: Analysewerte aus dem freigegebenen E-Label, sonst der jüngsten Analyse der Charge.
// Rechte wie die übrigen Datenexporte (KAN-54): Modul Controlling + Recht „Auswertungen“.
export async function GET() {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const membership = await getCurrentMembership()
  const leseSperre = leseKonflikt(membership, 'lager')   // KAN-455: Lesebereich je Profil
  if (leseSperre) return leseSperre
  const tenantId = membership?.tenantId
  if (!tenantId) return fehlerAntwort(401, 'Kein Betrieb')
  if (!(await darfDatenexport(membership)))
    return fehlerAntwort(403, 'Datenexport nicht freigeschaltet (Modul Controlling und Recht „Auswertungen“ nötig)')

  const supabase = await createSupabaseServerClient()
  const [fRes, eRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle((supabase.from('fuellungen') as any)
      .select('id, name, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis, sekt_stufe, anbaugebiet, herkunft_code, flaschengroesse_ml, pruefnummer, chargennummer, weinausbau_id')
      .eq('tenant_id', tenantId).eq('aktiv', true).is('storniert_am', null).order('name').order('id')),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    alle((supabase.from('elabels') as any)
      .select('fuellung_id, status, code, alkohol_vol, restzucker_gl, gesamtsaeure_gl')
      .eq('tenant_id', tenantId).order('id')),
  ])
  if (fRes.error || eRes.error) return fehlerAntwort(500, 'Export fehlgeschlagen')
  const fuellungen = (fRes.data ?? []) as R[]
  const elabels = new Map(((eRes.data ?? []) as R[]).map(e => [String(e.fuellung_id), e]))

  const chargen = [...new Set(fuellungen.map(f => f.weinausbau_id).filter(Boolean))] as string[]
  const aRes = await inBloecken<R>(chargen, b => (supabase.from('weinanalysen') as R)
    .select('id, weinausbau_id, analyse_datum, alkohol_vol, restzucker_gl, gesamtsaeure_gl, storniert_am')
    .eq('tenant_id', tenantId).in('weinausbau_id', b).is('storniert_am', null).order('id'))
  if (aRes.error) return fehlerAntwort(500, 'Export fehlgeschlagen')
  const analysen = new Map<string, R[]>()
  for (const a of aRes.data) {
    const k = String(a.weinausbau_id)
    analysen.set(k, [...(analysen.get(k) ?? []), a])
  }

  const basis = appBasisUrl()
  const zeilen: DatenblattExportZeile[] = fuellungen.map(f => {
    const el = elabels.get(String(f.id)) ?? null
    const w = analyseWerte(el, f.weinausbau_id ? analysen.get(String(f.weinausbau_id)) ?? [] : [])
    return {
      name: f.name ?? null,
      jahrgang: f.jahrgang == null ? null : Number(f.jahrgang),
      rebsorte: f.rebsorte ?? null,
      qualitaet: qualitaetAnzeigeOderNull(f),
      herkunft: herkunftText(f),
      flaschengroesse: flaschengroesseText(f.flaschengroesse_ml),
      alkohol: w.alkohol,
      restzucker: w.restzucker,
      saeure: w.saeure,
      pruefnummer: f.pruefnummer ?? null,
      chargennummer: f.chargennummer ?? null,
      elabel: el?.status === 'freigegeben' && el.code ? elabelUrl(String(el.code), basis) : null,
    }
  })
  const csv = datenblattCsv(zeilen)
  return csvAntwort(csv.text, csvDateiname(['produktdatenblaetter']), csv.zeilen, csv.warnungen)
}
