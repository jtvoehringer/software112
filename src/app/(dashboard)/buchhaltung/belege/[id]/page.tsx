import { redirect, notFound } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { alle } from '@/lib/supabase/alle'
import { getCurrentMembership } from '@/lib/auth/roles'
import { belegDateiPfad } from '@/lib/buchhaltung/belegAnhang'
import { verwerfeBeleg } from '../../actions'
import BelegBuchenForm from './BelegBuchenForm'
import type { FirmaRow } from '@/lib/crm/types'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Beleg buchen' }

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export default async function BelegBuchenPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId

  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, modul_controlling, ust_satz_standard').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_ea) redirect('/dashboard')
  const ustStandard = einst?.ust_satz_standard ?? 20

  // KAN-421: Kostenstellen und Kostenarten für die Übernahme in die Kostenrechnung (nur mit Modul Controlling)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kostenstellen = einst?.modul_controlling ? geladen(await (supabase.from('kostenstellen') as any)
    .select('id, name').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id'), 'Kostenstellen') as R[] : []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const kostenarten = einst?.modul_controlling ? geladen(await (supabase.from('kostenarten') as any)
    .select('id, name').eq('tenant_id', tenantId).eq('aktiv', true).order('name').order('id'), 'Kostenarten') as R[] : []

  const belegRaw = geladen(await (supabase.from('ea_belege') as any)
    .select('id, dateiname, dateityp, status, storage_pfad, erkannte_daten, fehler_details, hochgeladen_am')
    .eq('id', id).eq('tenant_id', tenantId).maybeSingle(), 'Belege')
  if (!belegRaw) notFound()
  const beleg = belegRaw as R
  // KAN-415: ein verbuchter Beleg lässt sich nicht mehr buchen – die Datei öffnen statt zur Liste zurückzuleiten
  if (beleg.status === 'verbucht') redirect(belegDateiPfad(id))

  const signed = geladen(await supabase.storage
    .from('ea-belege')
    .createSignedUrl(beleg.storage_pfad, 3600), 'Daten')
  const previewUrl = signed?.signedUrl ?? null
  const istBild = (beleg.dateityp as string)?.startsWith('image/')

  const [kategorienRes, kontenRes, firmenRawRes] = await Promise.all([
    (supabase.from('ea_kategorien') as any)
      .select('id, name, typ, abzugsfaehig_pct')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
      .eq('aktiv', true)
      .order('sortierung'),
    (supabase.from('konten') as any)
      .select('id, name')
      .eq('tenant_id', tenantId).eq('aktiv', true)
      .order('sortierung').order('name'),
    // Für die Lieferanten-Zuordnung (Migration 167): alle Firmen des
    // Mandanten - lieferanten (ist_lieferant) für die Auswahl/Anzeige,
    // allFirmen zusätzlich für die Dublettenprüfung in FirmaForm bei
    // Neuanlage aus diesem Formular heraus. alle(): Gebeshuber hat über
    // 4.600 Firmen – ohne Paging fehlten Lieferanten ab dem 1.001. Namen.
    alle((supabase.from('firmen') as any)
      .select('id, accountnummer, name, segment, strasse, plz, ort, land, telefon, telefon_vorwahl, email, website, uid_nummer, betrieb_nr, kreditlimit, zahlungsziel_tage, skonto_pct, skonto_tage, waehrung, notizen, aktiv, is_lead, sonderrabatt_pct, rabattgruppe_id, ist_kunde, ist_lieferant, rabattgruppe:rabattgruppe_id(id, name, rabatt_pct)')
      .eq('tenant_id', tenantId).eq('aktiv', true)
      .order('name').order('id')),
  ])
  const kategorien = geladen(kategorienRes, 'Kategorien')
  const konten = geladen(kontenRes, 'Konten')
  const firmenRaw = geladen(firmenRawRes, 'Firmen')

  // Rabattgruppen (non-fatal, wie in crm/firmen/page.tsx – Tabelle existiert
  // erst nach Migration 031)
  let rabattgruppenRaw: R[] = []
  try {
    const r = geladen(await (supabase.from('rabattgruppen') as any)
      .select('id, name, rabatt_pct').eq('tenant_id', tenantId).order('rabatt_pct'), 'Rabattgruppen')
    rabattgruppenRaw = (r ?? []) as R[]
  } catch { /* Tabelle noch nicht vorhanden */ }
  const rabattgruppen = rabattgruppenRaw.map(r => ({
    id: r.id as string, name: r.name as string, rabatt_pct: Number(r.rabatt_pct),
  }))

  const allFirmen: FirmaRow[] = ((firmenRaw ?? []) as R[]).map(f => ({
    id: f.id, accountnummer: f.accountnummer ?? null, name: f.name, segment: f.segment,
    strasse: f.strasse ?? null, plz: f.plz ?? null, ort: f.ort ?? null, land: f.land ?? null,
    telefon: f.telefon ?? null, email: f.email ?? null, website: f.website ?? null,
    uid_nummer: f.uid_nummer ?? null, kreditlimit: f.kreditlimit ?? null,
    zahlungsziel_tage: f.zahlungsziel_tage ?? 30, waehrung: f.waehrung ?? null,
    notizen: f.notizen ?? null, aktiv: f.aktiv ?? true,
    rabattgruppe_id: f.rabattgruppe_id ?? null,
    rabattgruppe_name: (f.rabattgruppe as R | null)?.name ?? null,
    rabattgruppe_pct: (f.rabattgruppe as R | null)?.rabatt_pct ?? null,
    sonderrabatt_pct: parseFloat(f.sonderrabatt_pct) || 0,
    is_lead:          !!(f.is_lead as boolean),
    telefon_vorwahl:  (f.telefon_vorwahl as string | null) ?? '+43',
    ist_kunde:     f.ist_kunde !== false,
    ist_lieferant: !!f.ist_lieferant,
  }))
  const lieferanten = allFirmen.filter(f => f.ist_lieferant)

  const e = (beleg.erkannte_daten ?? {}) as R
  const kategorienListe = ((kategorien as R[]) ?? []).map(k => ({ id: k.id as string, name: k.name as string, typ: k.typ as string, abzugsfaehigPct: Number(k.abzugsfaehig_pct ?? 100) }))
  const einnahmeKat = kategorienListe.filter(k => k.typ === 'einnahme' || k.typ === 'beides')
  const ausgabeKat  = kategorienListe.filter(k => k.typ === 'ausgabe' || k.typ === 'beides')
  const kontenListe = ((konten as R[]) ?? []).map(k => ({ id: k.id as string, name: k.name as string }))

  const verwerfenWithId = verwerfeBeleg.bind(null, id)

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung/belege" className="hover:text-s112-blue-700 transition-colors">Belege</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium truncate">{beleg.dateiname}</span>
      </div>
      <h1 className="text-2xl font-semibold text-s112-text mb-6">Beleg buchen</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
        {/* Vorschau */}
        <div className="bg-white rounded-xl border border-s112-border p-4">
          {previewUrl ? (
            istBild ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={beleg.dateiname} className="w-full rounded-lg" />
            ) : (
              <iframe src={previewUrl} className="w-full h-[600px] rounded-lg border border-s112-border" title={beleg.dateiname} />
            )
          ) : (
            <p className="text-sm text-s112-muted text-center py-10">Vorschau nicht verfügbar</p>
          )}
        </div>

        {/* Formular */}
        <BelegBuchenForm
          belegId={id}
          dateiname={beleg.dateiname}
          status={beleg.status}
          fehlerDetails={beleg.fehler_details ?? null}
          erkannt={e}
          ustStandard={ustStandard}
          einnahmeKat={einnahmeKat}
          ausgabeKat={ausgabeKat}
          konten={kontenListe}
          lieferanten={lieferanten}
          allFirmen={allFirmen}
          rabattgruppen={rabattgruppen}
          verwerfenAction={verwerfenWithId}
          kostenstellen={kostenstellen.map(k => ({ id: k.id as string, name: k.name as string }))}
          kostenarten={kostenarten.map(k => ({ id: k.id as string, name: k.name as string }))}
        />
      </div>
    </div>
  )
}
