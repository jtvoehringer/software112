import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { schreibSperre } from '@/lib/auth/sperren'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { notFound } from 'next/navigation'
import BehaelterForm from '@/components/kellerbuch/BehaelterForm'
import Schnellerfassung from '@/components/kellerbuch/Schnellerfassung'
import { updateBehaelter, kellerNotizErfassen, schwundBuchen } from '../../actions'
import { ladeBehaelterEinzeln, ladeKellergemeinschaft } from '@/lib/keller/behaelter'
import { letzteMassnahmen, type SchnellCharge } from '@/lib/keller/schnellerfassung'
import { fmtLiter } from '@/lib/format'

export const metadata: Metadata = { title: 'Gebinde' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-117 (07.10.2026): Ziel des QR-Codes am Gebinde – oben die mobile Schnellerfassung (Inhalt, Kacheln, letzte
// Maßnahmen), darunter wie bisher die Stammdaten (nur der Eigentümer bearbeitet). Gehört das Gebinde zu einem anderen
// Betrieb des Benutzers, erscheint ein Wechsel-Hinweis; sonst 404.
export default async function BehaelterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId    = membership?.tenantId ?? null

  const gebinde = tenantId ? await ladeBehaelterEinzeln(supabase, tenantId, id) : null
  if (!gebinde) {
    const anderer = await andererBetrieb(supabase, id, tenantId)
    if (!anderer) notFound()
    return (
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold text-s112-text mb-4">Gebinde aus einem anderen Betrieb</h1>
        <div className="card p-4 space-y-3">
          <p className="text-sm text-s112-text-2">
            Dieses Gebinde gehört zum Betrieb <strong>{anderer.name}</strong>. Du arbeitest gerade in einem anderen Betrieb.
          </p>
          <Link href={`/auth/betrieb?tenant_id=${anderer.tenantId}&weiter=${encodeURIComponent(`/kellerbuch/behaelter/${id}`)}`}
            className="btn-primary inline-block">Zu „{anderer.name}“ wechseln</Link>
        </div>
      </div>
    )
  }

  // Aktive Chargen im Gebinde (eigener Betrieb – auch in einem freigegebenen Gebinde)
  // alle-ausnahme: Chargen eines einzelnen Gebindes, wenige
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chargenRaw = geladen(await (supabase.from('weinausbau') as any)
    .select('id, name, menge_liter').eq('tenant_id', tenantId).eq('behaelter_id', id).eq('aktiv', true)
    .order('name').order('id').limit(50), 'Chargen')
  const chargen = ((chargenRaw ?? []) as R[]).map(c => ({ id: String(c.id), name: c.name ?? null, menge_liter: c.menge_liter })) as SchnellCharge[]
  const chargenIds = chargen.map(c => c.id)

  const [behRes, umzRes, anaRes] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('keller_behandlungen') as any)
      .select('id, datum, typ_name_snapshot, menge, einheit, notizen, typ:typ_id(name)')
      .eq('tenant_id', tenantId).eq('behaelter_id', id).is('storniert_am', null)
      .order('datum', { ascending: false }).order('id').limit(5),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('keller_umzuege') as any)
      .select('id, datum, menge_liter, brutto_liter, schwund_liter, umzug_typ, notizen, von_behaelter_id, nach_behaelter_id')
      .eq('tenant_id', tenantId).is('storniert_am', null).or(`von_behaelter_id.eq.${id},nach_behaelter_id.eq.${id}`)
      .order('datum', { ascending: false }).order('id').limit(5),
    chargenIds.length === 0 ? Promise.resolve({ data: [] }) :
      // alle-ausnahme: Chargen eines einzelnen Gebindes (höchstens 50), nur die letzten 5 Analysen
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('weinanalysen') as any)
        .select('id, analyse_datum, alkohol_vol, restzucker_gl, gesamtsaeure_gl, notizen, weinausbau_id')
        .eq('tenant_id', tenantId).in('weinausbau_id', chargenIds).is('storniert_am', null)
        .order('analyse_datum', { ascending: false }).order('id').limit(5),
  ])
  const massnahmen = letzteMassnahmen(id, (behRes.data ?? []) as R[], (umzRes.data ?? []) as R[], (anaRes.data ?? []) as R[], 5, fmtLiter)

  const darf = !!membership && canWrite(membership, 'kellerbuch')
  const gesperrt = darf ? !!(await schreibSperre(membership)) : false
  const schreiben = darf && !gesperrt && gebinde.aktiv
  const nurLesenGrund = !darf ? 'Nur lesend – für Einträge fehlt das Schreibrecht im Kellerbuch.'
    : gesperrt ? 'Nur-Lesen-Modus: Einträge sind gesperrt, solange das Abo des Betriebs gesperrt ist.'
    : !gebinde.aktiv ? 'Das Gebinde ist deaktiviert – keine neuen Einträge.' : null

  // Stammdaten bearbeitet nur der Eigentümer (freigegebene Gebinde eines Partners nicht)
  let stammdaten: R | null = null
  let partner: string | null = null
  if (!gebinde.fremd) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = geladen(await (supabase.from('behaelter') as any)
      .select('id, name, typ, volumen_liter, standort, aktiv, notizen, stapler, gemeinsam, lp_pickerl').eq('id', id).eq('tenant_id', tenantId).limit(1), 'Gebinde')
    stammdaten = ((rows ?? []) as R[])[0] ?? null
    const gemeinschaft = await ladeKellergemeinschaft(supabase, tenantId)
    partner = gemeinschaft.alsEigentuemer.length ? gemeinschaft.alsEigentuemer.map(p => p.name).join(', ') : null
  }

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-4">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium truncate">{gebinde.anzeigeName}</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-4 break-words">{gebinde.anzeigeName}</h1>
      <Schnellerfassung behaelterId={id} volumenLiter={gebinde.volumen_liter ?? null} chargen={chargen} massnahmen={massnahmen}
        schreiben={schreiben} nurLesenGrund={nurLesenGrund} notizAction={kellerNotizErfassen} schwundAction={schwundBuchen} />
      {stammdaten && (
        <>
          <h2 className="text-base font-semibold text-s112-text mb-3">Stammdaten</h2>
          <BehaelterForm behaelter={stammdaten as Parameters<typeof BehaelterForm>[0]['behaelter']} action={updateBehaelter.bind(null, id)} partner={partner} />
        </>
      )}
    </div>
  )
}

/** Gebinde in einem anderen Betrieb, in dem der Benutzer Mitglied ist (RLS zeigt nur solche) – sonst null */
async function andererBetrieb(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, id: string, aktiv: string | null,
): Promise<{ tenantId: string; name: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null
  // tenant-isolation-ignore: KAN-117 – sucht bewusst über alle Betriebe des Benutzers (RLS), nur Betriebs-ID und Name
  const data = geladen(await supabase.from('behaelter').select('tenant_id').eq('id', id).limit(1).maybeSingle(), 'Gebinde')
  const t = (data as R | null)?.tenant_id as string | undefined
  if (!t || t === aktiv) return null
  // tenant-isolation-ignore: Name des anderen Betriebs für den Wechsel-Hinweis (eigene Mitgliedschaft, RLS)
  const tn = geladen(await supabase.from('tenants').select('id, name').eq('id', t).maybeSingle(), 'Betrieb')
  if (!tn) return null
  return { tenantId: t, name: String((tn as R).name ?? 'anderer Betrieb') }
}
