import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { bkiDateiname, csvKopfzeilen } from '@/lib/csv'
import { fehlerAntwort } from '@/lib/csv/antwort'
import { betriebUndModuleLaden } from '@/lib/behoerden/zugriff'
import { istParameterFehler } from '@/lib/behoerden/typen'
import { bkiMappe, pruefbericht } from '@/lib/behoerden/bki-schnittstelle'
import { bkiZeitraumAus, ladeBkiSchnittstelle } from '@/lib/behoerden/bki-schnittstelle-laden'
import { XLSX_MIME } from '@/lib/xlsx'
import { SPERR_TEXT, sitzungsSperre } from '@/lib/auth/sperren'

// ── BKI-Schnittstelle als eine XLSX-Datei (KAN-50 AP13, 10.10.2026) ────────────────────────────────────────────
//
//   GET /meldungen/bki-schnittstelle/xlsx?von=JJJJ-MM-TT&bis=JJJJ-MM-TT&stichtag=JJJJ-MM-TT
//
// Ein Blatt je Spezifikationsblatt plus Prüfbericht vorne. Liegt wie die CSV-Route unter (dashboard) – Login und 2FA
// über den Proxy, Sitzungssperre hier; Zugriff und Modul prüft jedes Blatt einzeln (fehlender Zugriff → Prüfbericht).
// GET ohne Seiteneffekte. Dateiname nach dem BKI-Schema (KAN-95): <Betriebsnummer>_<Jahr>_BKI-Schnittstelle_von_…_bis_….xlsx

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest) {
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return fehlerAntwort(401, 'Nicht angemeldet – bitte neu anmelden.')
  const tenantId = membership.tenantId
  try {
    const supabase = await createSupabaseServerClient()
    const sperre = await sitzungsSperre(supabase, membership)
    if (sperre) return fehlerAntwort(403, SPERR_TEXT[sperre])
    const zeitraum = bkiZeitraumAus(req.nextUrl.searchParams)
    if (istParameterFehler(zeitraum)) return fehlerAntwort(400, zeitraum.fehler)

    const { betrieb, module } = await betriebUndModuleLaden(supabase, tenantId)
    const ergebnisse = await ladeBkiSchnittstelle({ supabase, tenantId, membership, betrieb, module }, zeitraum)
    const bytes = bkiMappe(ergebnisse, { betrieb: betrieb.name ?? '', zeitraum })
    const name = bkiDateiname({ betriebsnummer: betrieb.betriebsnummer, jahr: zeitraum.bis.slice(0, 4), bericht: 'BKI-Schnittstelle', von: zeitraum.von, bis: zeitraum.bis })
    const xlsx = (s: string) => s.replace(/\.csv$/, '.xlsx')
    const bericht = pruefbericht(ergebnisse).filter(h => h.art === 'fehler' || h.art === 'fehlt')
    const zeilen = ergebnisse.reduce((s, e) => s + (e.daten?.zeilen.length ?? 0), 0)
    const kopf = csvKopfzeilen({ ascii: xlsx(name.ascii), utf8: xlsx(name.utf8) }, zeilen, bericht.map(h => `${h.blatt}: ${h.text}`))
    return new NextResponse(bytes as BodyInit, { status: 200, headers: { ...kopf, 'Content-Type': XLSX_MIME } })
  } catch (e) {
    await ereignisMelden({
      art: 'server',
      quelle: 'meldungen/bki-schnittstelle/xlsx',
      meldung: e instanceof Error ? e.message : String(e),
      digest: (e as { digest?: string } | null)?.digest ?? null,
      tenantId,
      details: { parameter: Object.fromEntries(req.nextUrl.searchParams) },
    })
    return fehlerAntwort(500, 'Die XLSX-Datei konnte nicht erstellt werden. Der Fehler wurde protokolliert – bitte später erneut versuchen.')
  }
}
