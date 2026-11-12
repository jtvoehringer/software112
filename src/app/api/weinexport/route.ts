import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { ereignisMelden } from '@/lib/system/ereignis'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
import { schreibSperreKonflikt } from '@/lib/auth/sperren'
import { seitenBetriebKonflikt } from '@/lib/auth/seitenBetrieb'
import { normalisiereLand } from '@/lib/katalog/laender'
import { modulKonflikt } from '@/lib/auth/modul'
import { exportauftragFehler, exportKopf, exportPositionen, verpackungWert } from '@/lib/export/auftragEingabe'
import { dbFehlerText } from '@/lib/fehler'
import { EXPORT_STANDARD_DOKUMENTE } from '@/lib/export/dokumente'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// KAN-433: + Packliste (Entscheidung 1A) – Liste in src/lib/export/dokumente.ts
const STANDARD_DOKUMENTE = EXPORT_STANDARD_DOKUMENTE

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  const ohneModul = await modulKonflikt('modul_export')   // KAN-6: Paket-Modul auch in der Route
  if (ohneModul) return ohneModul
  try {
    const body = await req.json()
    const supabase = await createSupabaseServerClient()
    const admin    = createSupabaseAdminClient()
    // Nur tenant_admin und winzer dürfen Exportaufträge anlegen
    const { data: { user: authUser } } = await supabase.auth.getUser()
    if (!authUser) return NextResponse.json({ fehler: 'Nicht angemeldet' }, { status: 401 })

    // tenant_id + Rolle IMMER aus aktivem Tenant (Cookie) – niemals aus Request-Body
    // oder einer beliebigen Membership (Sicherheit)
    const membership = await getCurrentMembership()
    const tenantId = membership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })
    // KAN-30: Formular aus einem veralteten Tab (anderer Betrieb)? Sonst Exportnummer aus dem
    // Nummernkreis des neuen Betriebs mit Kontakten/Füllungen des alten
    const konflikt = await seitenBetriebKonflikt(tenantId)
    if (konflikt) return konflikt
    const gesperrt = await schreibSperreKonflikt(membership)   // KAN-5: Nur-Lesen-Modus bei gesperrtem Abo
    if (gesperrt) return gesperrt
    if (!canWrite(membership, 'warenwirtschaft'))   // Admin-Client umgeht RLS → Modulrecht hier prüfen
      return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })

    // KAN-187: Bestimmungsland als ISO-Code aus dem Länderkatalog (vor der Referenznummer – sonst ginge eine Nummer verloren)
    const destLandRoh = typeof body.destination_land === 'string' ? body.destination_land.trim() : ''
    const destinationLand = normalisiereLand(destLandRoh)
    if (destLandRoh && !destinationLand)
      return NextResponse.json({ fehler: `Unbekanntes Land „${destLandRoh}“ – bitte ein Land aus der Liste wählen.` }, { status: 400 })

    // Sweep 98: Listenwerte und varchar-Längen prüfen – sonst roher Datenbankfehler „value too long …“
    const eingabeFehler = exportauftragFehler(body)
    if (eingabeFehler) return NextResponse.json({ fehler: eingabeFehler }, { status: 400 })

    const kopfNeu = exportKopf(body, destinationLand)   // KAN-432: bereinigte Werte der neuen Felder
    const posNeu = exportPositionen(body)

    // Referenznummer generieren
    const { data: refData, error: refDataErr } = await (admin.rpc as any)('get_next_exportnummer', { p_tenant_id: tenantId })
    if (refDataErr) return NextResponse.json({ fehler: `Daten konnten nicht geladen werden: ${dbFehlerText(refDataErr)}` }, { status: 500 })
    const referenz = refData ?? null

    const { data: auftrag, error } = await (supabase.from('exportauftraege') as any).insert({
      tenant_id:         tenantId,
      kontakt_id:        body.kontakt_id,
      firma_id:          body.firma_id,
      referenz,
      datum:             body.datum,
      lieferdatum:       body.lieferdatum,
      incoterms:         body.incoterms,
      transport_art:     body.transport_art,
      destination_land:  destinationLand,
      destination_stadt: (typeof body.destination_stadt === 'string' ? body.destination_stadt.trim() : '') || null,
      eori_kunde:        (typeof body.eori_kunde === 'string' ? body.eori_kunde.trim() : '') || null,
      versicherungswert: body.versicherungswert,
      verpackung_kg:     verpackungWert(body.verpackung_kg),   // KAN-414: Kartons/Palette für die Bruttomasse
      notizen:           body.notizen,
      // KAN-432: Grunddaten für die Dokumente (geprüft in exportauftragFehler)
      versanddatum:        kopfNeu.versanddatum,
      zahlungsbedingungen: kopfNeu.zahlungsbedingungen,
      kunde_uid:           kopfNeu.kunde_uid,
      mustersendung:       kopfNeu.mustersendung,   // KAN-433
      status:            'entwurf',
    }).select().single()

    if (error) return NextResponse.json({ fehler: dbFehlerText(error) }, { status: 500 })
    const id = (auftrag as R).id

    // Positionen
    if (body.positionen?.length > 0) {
      const posen = body.positionen.map((p: R, i: number) => ({
        exportauftrag_id: id,
        fullung_id:    p.fullung_id || null,
        beschreibung:  p.beschreibung || null,
        menge:         parseFloat(p.menge) || 0,
        einheit:       p.einheit ?? 'Fl',
        preis_eur:     parseFloat(p.preis_eur) || 0,
        taric_code:    p.taric_code ?? '2204.21',
        flaschen_je_karton: posNeu[i]?.flaschen_je_karton ?? null,   // KAN-432
        sort_order:    i,
      }))
      // KAN-246: vorher nur protokolliert – der Auftrag stand ohne Positionen da, die Antwort war ok
      { const { error: e } = await (supabase.from('exportauftrag_positionen') as any).insert(posen)
        if (e) {
          void ereignisMelden({ art: 'db', quelle: 'weinexport/exportauftrag_positionen', meldung: e.message })
          return NextResponse.json({ fehler: `Der Exportauftrag ${referenz ?? ''} ist angelegt, die Positionen konnten aber nicht gespeichert werden: ${dbFehlerText(e)}. Bitte im Auftrag ergänzen.`.replace('  ', ' '), id }, { status: 500 })
        } }
    }

    // Standard-Dokumente anlegen
    { const { error: e } = await (supabase.from('export_dokumente') as any).insert(
      STANDARD_DOKUMENTE.map(art => ({ exportauftrag_id: id, dokument_art: art, status: 'ausstehend' }))
    )
      if (e) {
        void ereignisMelden({ art: 'db', quelle: 'weinexport/export_dokumente', meldung: e.message })
        return NextResponse.json({ fehler: `Der Exportauftrag ist angelegt, die Standard-Dokumente konnten aber nicht vorbereitet werden: ${dbFehlerText(e)}.`, id }, { status: 500 })
      } }

    return NextResponse.json({ ok: true, id })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
