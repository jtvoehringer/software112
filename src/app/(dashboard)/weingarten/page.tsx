// behoerdenmeldung: flaechenverzeichnis
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, getCurrentMembership, canWrite, canAdmin } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import WeingartenBaum from './WeingartenBaum'
import RiedenGeoExportButton from './RiedenGeoExportButton'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeRiedenStammdaten, type GstStamm, type RiedStamm } from '@/lib/behoerden/flaechenverzeichnis'
import { fmtHa } from '@/lib/format'

export const metadata: Metadata = { title: 'Rieden – software:112' }

export default async function WeingartenPage() {
  const supabase = await createSupabaseServerClient()
  const role = await getCurrentUserRole()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null
  const writeOk = canWrite(role, 'rieden')
  const adminOk = canAdmin(role)

  // Weingärten und Grundstücke – dieselbe Ladefunktion wie die CSV „Flächenverzeichnis“
  // (/meldungen/flaechenverzeichnis/csv): Mandantenfilter, alle() statt 1.000er-Deckel,
  // Flächen auf 4 Stellen gerundet. Ohne aktive Mitgliedschaft gibt es nichts anzuzeigen.
  const { weingaerten, grundstuecke }: { weingaerten: RiedStamm[]; grundstuecke: GstStamm[] } = tenantId
    ? await ladeRiedenStammdaten(supabase, tenantId)
    : { weingaerten: [], grundstuecke: [] }

  const aktive = weingaerten.filter(w => w.aktiv)
  // Ha-Summe AMA: Grundstücks-Summe falls vorhanden, sonst Weingarten-Fläche
  const gstHaMap = new Map<string, number>()
  for (const g of grundstuecke) {
    gstHaMap.set(g.weingarten_id, (gstHaMap.get(g.weingarten_id) ?? 0) + (g.flaeche_ha ?? 0))
  }
  const gesamtHaAma = aktive.reduce((s, w) => {
    return s + (gstHaMap.get(w.id) ?? w.flaeche_ha ?? 0)
  }, 0)

  const gstKatasterMap = new Map<string, number>()
  for (const g of grundstuecke) {
    if (g.flaeche_ha_kataster) gstKatasterMap.set(g.weingarten_id, (gstKatasterMap.get(g.weingarten_id) ?? 0) + g.flaeche_ha_kataster)
  }
  const gesamtHaKataster = aktive.reduce((s, w) => s + (gstKatasterMap.get(w.id) ?? 0), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Rieden</h1>
          <p className="text-sm text-s112-muted mt-0.5">Rieden & Grundstücke</p>
        </div>
        <div className="flex items-center gap-3">
          {weingaerten.length > 0 && (
            <>
              <RiedenGeoExportButton anzahl={aktive.filter(w => w.zentrum_lat != null && w.zentrum_lon != null).length} />
              {/* Flächenverzeichnis (Grundlage Mehrfachantrag/Weinbaukataster) serverseitig über den CSV-Baustein */}
              <CsvExportKnopf href={csvPfad('flaechenverzeichnis')} />
            </>
          )}
          {writeOk && (
            <Link href="/weingarten/import-gis"
              className="inline-flex items-center gap-2 border border-s112-border bg-white text-s112-text-1 px-3 py-2 rounded-xl text-sm font-medium hover:bg-s112-bg transition-colors"
              title="Feldstück-Umrisse aus dem INVEKOS-GIS (Shapefile-Export) übernehmen">
              eAMA-GIS importieren
            </Link>
          )}
          {writeOk && (
            <Link
              href="/weingarten/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              Neue Ried
            </Link>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{aktive.length}</p>
          <p className="text-xs text-s112-muted mt-1">Rieden</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{grundstuecke.length}</p>
          <p className="text-xs text-s112-muted mt-1">Grundstücke</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{fmtHa(gesamtHaAma)}</p>
          <p className="text-xs text-s112-muted mt-1 leading-tight">GST-Fläche<br />lt. AMA</p>
        </div>
        <div className="card text-center">
          <p className="text-3xl font-semibold text-s112-blue-700">{gesamtHaKataster > 0 ? fmtHa(gesamtHaKataster) : '–'}</p>
          <p className="text-xs text-s112-muted mt-1 leading-tight">GST-Fläche<br />lt. Kataster</p>
        </div>
      </div>

      {/* Baum */}
      {weingaerten.length > 0 ? (
        <WeingartenBaum
          weingaerten={weingaerten}
          grundstuecke={grundstuecke}
          writeOk={writeOk}
          adminOk={adminOk}
        />
      ) : (
        <div className="card text-center py-16">
          <p className="text-s112-text-1 font-medium">Noch keine Rieden angelegt</p>
          <p className="text-s112-muted text-sm mt-1 mb-6">Legen Sie Ihre erste Ried an</p>
          {writeOk && (
            <Link
              href="/weingarten/neu"
              className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors"
            >
              Erste Ried anlegen
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
