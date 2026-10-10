import { redirect } from 'next/navigation'
import { geladen, gezaehlt } from '@/lib/supabase/geladen'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin, canWrite } from '@/lib/auth/roles'
import { hatModul } from '@/lib/auth/modul'
import { schreibSperre } from '@/lib/auth/sperren'
import BmdClient from './BmdClient'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// BMD-Übergabe (Migration 196, Rückmeldung 3.9.2026): software:112 als
// Vorsystem für Mandanten, deren Steuerberater die doppelte Buchhaltung in
// BMD NTCS führt. Drei Reiter: Übergabe (Buchungsstapel/Stammdaten erzeugen),
// Konten-Mapping (Vorbelegung Einheitskontenrahmen, pro Mandant editierbar),
// Protokoll (welche Belege wann übergeben wurden). Teil des Moduls E&A.
export default async function BmdPage() {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  if (!(await hatModul('modul_ea'))) redirect('/dashboard')
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const [overridesRes, protokollRes, kategorienRes, offeneRechnungenRes] = await Promise.all([
    (supabase.from('buchhaltung_kontenmapping') as any).select('schluessel, wert').eq('tenant_id', tenantId),
    (supabase.from('buchhaltung_export_protokoll') as any)
      .select('id, art, zeitraum_von, zeitraum_bis, anzahl, summe_brutto, dateiname, nur_neue, erstellt_am')
      .eq('tenant_id', tenantId).order('erstellt_am', { ascending: false }).limit(100),
    (supabase.from('ea_kategorien') as any)
      .select('id, name, typ, konto_nr, tenant_id')
      .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`).eq('aktiv', true).order('typ').order('sortierung'),
    // Anzahl noch nicht übergebener Belege (für den Hinweis im Übergabe-Reiter)
    (supabase.from('verkaufsposten') as any)
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).eq('aktiv', true).eq('storniert', false).is('bmd_export_id', null),
  ])
  const overrides = geladen(overridesRes, 'Kontenzuordnung')
  const protokoll = geladen(protokollRes, 'BMD-Übergaben')
  const kategorien = geladen(kategorienRes, 'Kategorien')

  // KAN-5: im Nur-Lesen-Modus wird exportiert, aber nichts protokolliert/markiert (api/export/bmd)
  const nurLesen = (await schreibSperre(membership)) !== null

  const offeneRechnungen = gezaehlt(offeneRechnungenRes, 'Offene Rechnungen')
  const offeneAusgaben = gezaehlt(await (supabase.from('ea_transaktionen') as any)
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', tenantId).eq('typ', 'ausgabe').is('bmd_export_id', null), 'Offene Ausgaben')

  return (
    <BmdClient
      overrides={Object.fromEntries(((overrides ?? []) as R[]).map(o => [o.schluessel, o.wert]))}
      protokoll={(protokoll ?? []) as R[]}
      kategorien={(kategorien ?? []) as R[]}
      offeneRechnungen={offeneRechnungen ?? 0}
      offeneAusgaben={offeneAusgaben ?? 0}
      darfMappingAendern={canAdmin(membership.role)}
      darfUebergeben={canWrite(membership.role, 'ea') && !nurLesen}
      nurLesen={nurLesen}
    />
  )
}
