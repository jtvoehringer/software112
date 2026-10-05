// behoerdenmeldung: bki-traubenverkauf
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle, inBloecken } from '@/lib/supabase/alle'
import { getCurrentUserRole, getCurrentMembership, canWrite } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import TraubenverkaufClient from './TraubenverkaufClient'
import { KATALOG_ERNTE } from '@/lib/behoerden/katalog/ernte'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { leseTitel } from '@/lib/wein/lesen'

export const metadata: Metadata = { title: 'Traubenverkauf – software:112' }
export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function TraubenverkaufPage() {
  const supabase   = await createSupabaseServerClient()
  const role       = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const writeOk    = canWrite(role, 'warenwirtschaft')

  if (!membership) {
    return <div className="card p-10 text-center text-s112-muted text-sm">Nicht angemeldet.</div>
  }

  // Bestehende Verkäufe (alle() statt 1.000er-Deckel)
  // storno-sichtbar: Liste zeigt stornierte gekennzeichnet (KAN-148); verfügbare kg rechnen ohne sie
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: verkaufeRaw } = await alle<R>((supabase.from('traubenverkauf') as any)
    .select(`
      id, datum, menge_kg, storniert_am, storno_grund, storniert_von_name, preis_per_kg, kmw_grad, oechsle, mostgewicht_einheit,
      qualitaetsstufe, herkunft_code, gesundheit, liefernummer, notizen, jahrgang_id, lese_id, grundstueck_id, zukauf_posten_id, verkaufsposten_id,
      weingarten:weingarten_id(id, name, trauben_herkunft_code),
      grundstueck:grundstueck_id(id, gst_nr, rebsorte, trauben_herkunft_code),
      kontakt:kontakt_id(id, vorname, nachname),
      firma:firma_id(id, name),
      jahrgang:jahrgang_id(id, jahrgang),
      verkaufsposten:verkaufsposten_id(rechnungsnummer)
    `)
    .eq('tenant_id', membership.tenantId)
    .order('datum', { ascending: false })
    .order('id'))

  const verkaufe = (verkaufeRaw ?? []) as R[]

  // Jahrgänge des aktiven Betriebs – ernte_parzellen hat keine tenant_id; ohne diesen
  // Filter kämen bei Mitgliedschaft in mehreren Betrieben fremde Lesedaten dazu
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: jahrgaengeRaw, error: jgFehler } = await (supabase.from('weinjahrgaenge') as any)
    .select('id')
    .eq('tenant_id', membership.tenantId)
  if (jgFehler) throw new Error(`Jahrgänge konnten nicht geladen werden: ${jgFehler.message}`)
  const jahrgangIds = ((jahrgaengeRaw ?? []) as R[]).map(j => j.id as string)

  // Ernte-Parzellen als Basis für WG/GST-Optionen (alle geernteten)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ernteRaw } = jahrgangIds.length === 0 ? { data: [] as R[] } : await alle<R>((supabase.from('ernte_parzellen') as any)
    .select(`
      id, klosterneuburger, oechsle, mostgewicht_einheit, qualitaetsstufe, menge_kg, jahrgang_id, lese_id, ernte_datum,
      weingarten:weingarten_id(id, name, trauben_herkunft_code),
      grundstueck:grundstueck_id(id, gst_nr, rebsorte, trauben_herkunft_code),
      jahrgang:jahrgang_id(id, jahrgang)
    `)
    .in('jahrgang_id', jahrgangIds)
    .not('menge_kg', 'is', null)
    .is('storniert_am', null)
    .order('ernte_datum', { ascending: false, nullsFirst: false })
    .order('id'))

  const ernteOptions = (ernteRaw ?? []) as R[]

  // KAN-129: Lesen des Betriebs (neueste zuerst) und Verpresstes je Lese – Auswahl und verfügbare kg je Lese
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lesenRaw, error: leseFehler } = await (supabase.from('lesen') as any)
    .select('id, jahrgang_id, lfd_nr, art, bezeichnung, jahrgang:weinjahrgaenge!lesen_jahrgang_fkey(jahrgang)')
    .eq('tenant_id', membership.tenantId)
  if (leseFehler) throw new Error(`Lesen konnten nicht geladen werden: ${leseFehler.message}`)
  const lesen = ((lesenRaw ?? []) as R[]).map(l => {
    const jahr = Number((l.jahrgang as R | null)?.jahrgang)
    return { id: l.id as string, jahrgang_id: l.jahrgang_id as string, jahrgang: jahr, lfd_nr: Number(l.lfd_nr),
      titel: leseTitel(jahr, { lfd_nr: Number(l.lfd_nr), art: l.art, bezeichnung: l.bezeichnung ?? null }) }
  }).sort((a, b) => (b.jahrgang - a.jahrgang) || (b.lfd_nr - a.lfd_nr))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tenant-isolation-ignore: pressung_weingaerten ohne tenant_id, Filter über die Pressung
  const { data: pwRaw, error: pwFehler } = await alle<R>((supabase.from('pressung_weingaerten') as any)
    .select('id, weingarten_id, grundstueck_id, trauben_kg, pressung:pressung_id!inner(tenant_id, lese_id, storniert_am)')
    .eq('pressung.tenant_id', membership.tenantId)
    .is('storniert_am', null)
    .not('weingarten_id', 'is', null)
    .order('id'))
  if (pwFehler) throw new Error(`Pressungen konnten nicht geladen werden: ${pwFehler.message}`)
  const verpresst = ((pwRaw ?? []) as R[]).map(p => ({
    lese_id: ((p.pressung as R | null)?.lese_id as string | null) ?? null,
    weingarten_id: p.weingarten_id as string, grundstueck_id: (p.grundstueck_id as string | null) ?? null,
    kg: Number(p.trauben_kg) || 0,
  }))

  // BKI-Datenblatt (Pflichtmeldung): gleiche Zugriffsregel wie /meldungen/bki-traubenverkauf/csv
  const { module } = await betriebUndModuleLaden(supabase, membership.tenantId)
  const bkiErlaubt = zugriffsFehler(KATALOG_ERNTE['bki-traubenverkauf'], membership, module) === null

  // Kontakte + Firmen für Abnehmer-Dropdown
  const { data: kontakteRaw } = await alle((supabase.from('kontakte') as any)
    .select('id, vorname, nachname, betrieb_nr')
    .eq('tenant_id', membership.tenantId)
    .order('nachname').order('id'))

  const { data: firmenRaw } = await alle((supabase.from('firmen') as any)
    .select('id, name, betrieb_nr')
    .eq('tenant_id', membership.tenantId)
    .order('name').order('id'))

  const kontakte = (kontakteRaw ?? []) as R[]
  const firmen   = (firmenRaw   ?? []) as R[]

  // Zugekaufte Trauben (art='trauben') - stehen zusätzlich zur eigenen Ernte
  // als verkaufbare Menge zur Verfügung (siehe Migration 141).
  const { data: zukaufRaw } = await (supabase.from('zukauf_posten') as any)
    .select(`
      id, datum, menge, rebsorte, herkunft, kmw, oechsle, mostgewicht_einheit,
      lieferant_kontakt:kontakte!lieferant_kontakt_id(vorname, nachname),
      lieferant_firma:firmen!lieferant_firma_id(name)
    `)
    .eq('tenant_id', membership.tenantId)
    .eq('art', 'trauben')
    .eq('aktiv', true)
    .order('datum', { ascending: false })

  const zukaufListe = (zukaufRaw ?? []) as R[]
  const zukaufIds = zukaufListe.map(z => z.id)

  // Bereits verpresste bzw. verkaufte Menge je Zukauf-Posten (tenant-weit, über
  // alle Jahrgänge - dieses Modul ist nicht jahrgangsgebunden).
  const pressedKgByZukauf: Record<string, number> = {}
  if (zukaufIds.length > 0) {
    // inBloecken: Trauben-Zukäufe aller Jahre (URL-Grenze ≈ 350 IDs), sonst stimmten die verfügbaren kg nicht
    const { data: pressedRaw } = await inBloecken(zukaufIds, b => alle((supabase.from('pressung_weingaerten') as any)
      .select('zukauf_posten_id, trauben_kg')
      .in('zukauf_posten_id', b)
      .is('storniert_am', null)
      .order('id')))
    for (const p of (pressedRaw ?? []) as R[]) {
      pressedKgByZukauf[p.zukauf_posten_id] = (pressedKgByZukauf[p.zukauf_posten_id] ?? 0) + (parseFloat(p.trauben_kg) || 0)
    }
  }
  const soldKgByZukauf: Record<string, number> = {}
  for (const v of verkaufe.filter(x => !x.storniert_am)) {
    if (v.zukauf_posten_id) soldKgByZukauf[v.zukauf_posten_id] = (soldKgByZukauf[v.zukauf_posten_id] ?? 0) + (parseFloat(v.menge_kg) || 0)
  }

  const zukaufOptions = zukaufListe.map(z => {
    const mengeKg = parseFloat(z.menge) || 0
    const lieferant = z.lieferant_kontakt
      ? [z.lieferant_kontakt.vorname, z.lieferant_kontakt.nachname].filter(Boolean).join(' ')
      : (z.lieferant_firma?.name ?? '–')
    return {
      id: z.id,
      datum: z.datum,
      lieferant,
      rebsorte: z.rebsorte ?? null,
      herkunft: z.herkunft ?? null,
      // Mostgewicht des Zukaufs mit gemessener Einheit (KAN-128) – Vorbelegung des Traubenverkaufs
      kmw: z.kmw ?? null,
      oechsle: z.oechsle ?? null,
      mostgewicht_einheit: z.mostgewicht_einheit ?? null,
      menge_kg: mengeKg,
      verfuegbar_kg: Math.max(0, mengeKg - (pressedKgByZukauf[z.id] ?? 0) - (soldKgByZukauf[z.id] ?? 0)),
    }
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-blue-700 transition-colors">Weinhandel</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Traubenverkauf</span>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-s112-text">Traubenverkauf</h1>
        <p className="text-sm text-s112-muted mt-0.5">Verkauf von Weintrauben gem. § 3 Weingesetz-Formularverordnung</p>
      </div>

      <TraubenverkaufClient
        verkaufe={verkaufe}
        ernteOptions={ernteOptions}
        lesen={lesen}
        verpresst={verpresst}
        zukaufOptions={zukaufOptions}
        kontakte={kontakte}
        firmen={firmen}
        writeOk={writeOk}
        bkiErlaubt={bkiErlaubt}
      />
    </div>
  )
}
