import type { NextRequest } from 'next/server'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { csvDatei, PROFIL_EXCEL_AT } from '@/lib/csv'
import { csvAntwort, fehlerAntwort } from '@/lib/csv/antwort'
import { meldungFinden } from '@/lib/behoerden/register'
import { meldungsDateiname } from '@/lib/behoerden/dateiname'
import { betriebUndModuleLaden, zugriffsFehler } from '@/lib/behoerden/zugriff'
import { istParameterFehler, MeldungsFehler } from '@/lib/behoerden/typen'
import { SPERR_TEXT, sitzungsSperre } from '@/lib/auth/sperren'
import { AktionsFehler } from '@/lib/fehler'

// ── Zentrale CSV-Ausgabe aller Behördenmeldungen (24.09.2026) ─────────────────
//
//   GET /meldungen/<id>/csv?<Parameter der Druckseite>
//
// Liegt bewusst unter (dashboard) und NICHT unter /api: so greift der Login des Proxys
// (src/proxy.ts), der zusätzlich aal2 verlangt – aber nur von Konten, die bereits einen
// Faktor eingerichtet haben. layout.tsx-Guards laufen für Route-Handler NICHT: die
// 2FA-Einrichtungspflicht (Super-Admin/Betriebs-Manager ab 15.10.2026) prüft die Route
// deshalb selbst über lib/auth/sperren.ts (dieselbe Regel wie das Dashboard-Layout), ebenso
// Modul und Rolle. Ein gesperrtes Abo sperrt den Export seit KAN-5 NICHT mehr: Im
// Nur-Lesen-Modus bleiben Ansehen, Drucken und Exportieren ausdrücklich erlaubt
// (Aufbewahrungspflicht, DSGVO) – die Route schreibt nichts.
// Ablauf: 404 unbekannte Meldung → 401 ohne Mitgliedschaft → 403 Sitzungssperre (2FA)
// → 403 Modul/Zugriff → 400 Parameter → laden (dieselbe Ladefunktion wie die Druckseite) → CSV.
// GET ohne Seiteneffekte (kein Export-Protokoll – das bräuchte eine Migration).
// Leermeldung: 0 Datensätze → Datei nur mit Kopfzeile, HTTP 200, X-Zeilen: 0.
// KAN-37 Etappe B (02.10.2026): ?abgabe=<id> liefert die beim Einreichen gespeicherte Datei (meldung_abgaben) byte-gleich
// aus – statt sie neu zu erzeugen; Zugriff wie die Meldung selbst, die Warnung nennt Datum und SHA-256.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: NextRequest, { params }: { params: Promise<{ meldung: string }> }) {
  const { meldung: id } = await params
  const meldung = meldungFinden(id)
  if (!meldung) return fehlerAntwort(404, 'Diese Behördenmeldung gibt es nicht.')

  const membership = await getCurrentMembership()
  if (!membership?.tenantId) return fehlerAntwort(401, 'Nicht angemeldet – bitte neu anmelden.')
  const tenantId = membership.tenantId

  try {
    const supabase = await createSupabaseServerClient()
    const sperre = await sitzungsSperre(supabase, membership)
    if (sperre) return fehlerAntwort(403, SPERR_TEXT[sperre])

    const { betrieb, module } = await betriebUndModuleLaden(supabase, tenantId)

    const verboten = zugriffsFehler(meldung, membership, module)
    if (verboten) return fehlerAntwort(403, verboten)

    const abgabeId = req.nextUrl.searchParams.get('abgabe')
    if (abgabeId !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(abgabeId)) return fehlerAntwort(400, 'Ungültige Abgabe.')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: abgabe, error } = await (supabase.from('meldung_abgaben') as any)
        .select('csv_text, csv_sha256, dateiname, zeilen_anzahl, eingereicht_am')
        .eq('tenant_id', tenantId).eq('meldung', id).eq('id', abgabeId).maybeSingle()
      if (error) throw new AktionsFehler(`Laden fehlgeschlagen (meldung_abgaben): ${error.message}`)
      if (!abgabe) return fehlerAntwort(404, 'Diese abgegebene Meldung gibt es nicht (mehr).')
      const am = String(abgabe.eingereicht_am).split('-').reverse().join('.')
      return csvAntwort(abgabe.csv_text, abgabe.dateiname, Number(abgabe.zeilen_anzahl) || 0,
        [`Abgegebene Fassung vom ${am} – unverändert gespeichert (SHA-256 ${abgabe.csv_sha256}).`])
    }

    const p = meldung.parameter(req.nextUrl.searchParams)
    if (istParameterFehler(p)) return fehlerAntwort(400, p.fehler)

    const ergebnis = await meldung.laden({ supabase, tenantId, membership, betrieb }, p)
    const datei = csvDatei(ergebnis.zeilen, meldung.spalten, meldung.profil ?? PROFIL_EXCEL_AT)
    // KAN-95: BKI-Berichte heißen <Betriebsnummer>_<Jahr>_<Bericht>[_von_…_bis_…].csv
    const { dateiname, warnungen: namensWarnungen } = meldungsDateiname(meldung, p, betrieb)
    return csvAntwort(datei.text, dateiname, datei.zeilen, [...namensWarnungen, ...(ergebnis.warnungen ?? []), ...datei.warnungen])
  } catch (e) {
    if (e instanceof MeldungsFehler) return fehlerAntwort(e.status, e.message)
    await ereignisMelden({
      art: 'server',
      quelle: `meldungen/${id}/csv`,
      meldung: e instanceof Error ? e.message : String(e),
      digest: (e as { digest?: string } | null)?.digest ?? null,
      tenantId,
      details: { parameter: Object.fromEntries(req.nextUrl.searchParams) },
    })
    return fehlerAntwort(500, 'Die CSV-Datei konnte nicht erstellt werden. Der Fehler wurde protokolliert – bitte später erneut versuchen.')
  }
}
