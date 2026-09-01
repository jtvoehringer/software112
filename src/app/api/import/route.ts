import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'
export const dynamic = 'force-dynamic'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

// Der Ziel-Enum "kundensegment" in der DB kennt: privat, gastronomie, handel,
// export, grosshandel, produzent, weinhauer - NICHT "gastro". SEGMENT_MAP
// mappte CSV-Werte bisher auf genau dieses ungültige "gastro" (sowohl hier
// als auch als Fallback unten bei typ === 'firmen') - jede Firmen-Zeile schlug
// dadurch mit "invalid input value for enum kundensegment" fehl, auch wenn
// die Spaltenzuordnung selbst gepasst hätte (Rückmeldung 1.9.2026: "gastro
// wird gar nicht angeführt" - stimmt, im Enum heißt es "gastronomie").
// Migration 185 (1.9.2026): kundensegment-Enum um die "Kundengruppe"-Werte des
// DKB-Altsystem-Exports (Kontakte_Firmen_DKB.csv) ergänzt, damit diese direkt
// übernommen werden statt pauschal auf einen Standardwert zu fallen.
const SEGMENT_MAP: Record<string, string> = {
  'privat': 'privat', 'private': 'privat',
  'gastro': 'gastronomie', 'gastronomie': 'gastronomie', 'restaurant': 'restaurant',
  'handel': 'handel', 'trade': 'handel',
  'export': 'export',
  'grosshandel': 'grosshandel', 'großhandel': 'grosshandel', 'wholesale': 'grosshandel',
  'produzent': 'produzent',
  'weinhauer': 'weinhauer', 'winzer': 'weinhauer', 'weingut': 'weinhauer',
  // DKB-Kundengruppe-Werte:
  'firmenkunde': 'firmenkunde',
  'vinothek': 'vinothek',
  'ab hof': 'abhof', 'ab-hof': 'abhof', 'abhof': 'abhof',
  'tourismus': 'tourismus',
  'medien': 'medien', 'presse': 'medien',
  'importeur': 'importeur', 'import': 'importeur',
  'sonstige': 'sonstige', 'sonstiges': 'sonstige', 'other': 'sonstige',
}

function mapVal(row: R, csvKey: string | undefined, transform?: (v: string) => unknown): unknown {
  if (!csvKey) return undefined
  const raw = (row[csvKey] ?? '').toString().trim()
  if (!raw) return null
  return transform ? transform(raw) : raw
}

// Altsystem-Exporte liefern Zahlen oft im deutschen Format mit Tausender-
// leerzeichen/-punkt statt reinem Dezimalkomma, z.B. "4 000" oder "3.625,00".
// parseFloat() bricht am ersten nicht-numerischen Zeichen ab - "4 000" wurde
// dadurch bisher stillschweigend zu 4 statt 4000 (Rückmeldung 1.9.2026:
// "aus den Volumina wird 4, 15 bzw. 90 L - die Tsd. werden abgeschnitten").
// Entfernt zuerst alle Leerzeichen (auch geschützte), macht danach - falls ein
// Komma vorkommt - jeden Punkt davor zum Tausendertrennzeichen (wird entfernt)
// und das Komma selbst zum Dezimalpunkt.
function parseDeZahl(v: string): number | null {
  let s = v.trim().replace(/[\s ]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function normalizeWeinart(v: string): string {
  const s = v.trim().toLowerCase()
  if (s === 'weiss' || s === 'weiß' || s === 'weißwein' || s === 'weisswein') return 'weiss'
  if (s === 'rot' || s === 'rotwein') return 'rot'
  if (s === 'rose' || s === 'rosé' || s === 'roséwein') return 'rose'
  return 'unbekannt'
}

// behaelter_typ_check (Migration 169) erlaubt nur exakt diese Kleinschreibung
// ('stahltank', 'lagertank', 'immervolltank', 'holzfass', 'betonei', 'amphore',
// 'bottich', 'gaerstaender', 'zisterne', 'presse', 'barrique', 'doppelbarrique',
// 'sonstiges'). Altsystem-Exporte (z.B. Weingut Gebeshuber) liefern "Lagertank",
// "Presse" etc. mit Großbuchstaben - das ließ jede Gebinde-Import-Zeile mit
// einem für die Anwenderin kaum verständlichen DB-Constraint-Fehler abbrechen,
// obwohl der Typ eigentlich gültig war (Rückmeldung 1.9.2026: "verstehe den
// Fehler nicht"). Unbekannte Werte werden bewusst unverändert durchgereicht
// statt verworfen - der DB-Constraint fängt die weiterhin ab, aber ein
// bekannter Typ (nur andere Groß-/Kleinschreibung oder Umlaute) schlägt jetzt
// nicht mehr grundlos fehl.
function normalizeBehaelterTyp(v: string): string {
  return v.trim().toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
}

export async function POST(req: NextRequest) {
  try {
    const { typ, rows, mapping } = await req.json() as {
      typ: 'kontakte' | 'firmen' | 'fuellungen' | 'rieden_details' | 'grundstuecke' | 'gebinde'
      rows: R[]
      mapping: Record<string, string>
    }

    const supabase = await createSupabaseServerClient()
    const activeMembership = await getCurrentMembership()
    const tenantId = activeMembership?.tenantId
    if (!tenantId) return NextResponse.json({ fehler: 'Nicht autorisiert' }, { status: 401 })

    // Nur Rollen mit Schreibrecht dürfen importieren (system_admin/tenant_admin/winzer,
    // nicht leser) - einheitlich über canWrite() statt einer eigenen, unvollständigen
    // Rollenliste (die frühere Liste ['tenant_admin','winzer'] vergaß system_admin, was
    // z.B. beim Ersteller eines neuen Mandanten - immer system_admin - zu einem
    // faelschlichen 403 fuehrte).
    if (!canWrite(activeMembership.role))
      return NextResponse.json({ fehler: 'Keine Berechtigung' }, { status: 403 })

    let ok = 0
    const details: string[] = []

    // Caches für "Rieden (Details)" (Ried-Name → lagen.id, legt bei Bedarf neu an)
    // und "Grundstücke" (Weingarten-Name → weingarten.id), damit derselbe Name
    // innerhalb eines Imports nicht mehrfach abgefragt/angelegt wird.
    const lageCache: Map<string, string> = new Map()
    const weingartenCache: Map<string, string> = new Map()

    async function findOrCreateLageId(name: string): Promise<string> {
      const key = name.trim().toLowerCase()
      const cached = lageCache.get(key)
      if (cached) return cached
      const { data: bestehend } = await (supabase.from('lagen') as any)
        .select('id').eq('tenant_id', tenantId).ilike('name', name.trim()).maybeSingle()
      if ((bestehend as R | null)?.id) {
        lageCache.set(key, (bestehend as R).id)
        return (bestehend as R).id
      }
      const { data: neu, error } = await (supabase.from('lagen') as any)
        .insert({ tenant_id: tenantId, name: name.trim() })
        .select('id').single()
      if (error) throw new Error(`Ried "${name}" konnte nicht angelegt werden: ${error.message}`)
      lageCache.set(key, (neu as R).id)
      return (neu as R).id
    }

    async function findWeingartenId(name: string): Promise<string | null> {
      const key = name.trim().toLowerCase()
      const cached = weingartenCache.get(key)
      if (cached) return cached
      const { data } = await (supabase.from('weingarten') as any)
        .select('id').eq('tenant_id', tenantId).ilike('name', name.trim()).maybeSingle()
      const id = (data as R | null)?.id ?? null
      if (id) weingartenCache.set(key, id)
      return id
    }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      try {
        if (typ === 'kontakte') {
          const nachname = mapVal(row, mapping.nachname)
          if (!nachname) { details.push(`Zeile ${i+2}: Nachname fehlt – übersprungen`); continue }
          const segment = SEGMENT_MAP[(mapVal(row, mapping.segment) as string)?.toLowerCase() ?? ''] ?? 'privat'
          const { error } = await (supabase.from('kontakte') as any).insert({
            tenant_id: tenantId,
            vorname:   mapVal(row, mapping.vorname) ?? null,
            nachname,
            email:     mapVal(row, mapping.email) ?? null,
            telefon:   mapVal(row, mapping.telefon) ?? null,
            mobil:     mapVal(row, mapping.mobil) ?? null,
            strasse:   mapVal(row, mapping.strasse) ?? null,
            plz:       mapVal(row, mapping.plz) ?? null,
            ort:       mapVal(row, mapping.ort) ?? null,
            land:      mapVal(row, mapping.land) || 'AT',
            segment,
            notizen:   mapVal(row, mapping.notizen) ?? null,
            aktiv: true, stammkunde: false, newsletter: false,
            newsletter_bestaetigt: false, is_lead: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'firmen') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+2}: Name fehlt – übersprungen`); continue }
          const segment = SEGMENT_MAP[(mapVal(row, mapping.segment) as string)?.toLowerCase() ?? ''] ?? 'gastronomie'
          const { error } = await (supabase.from('firmen') as any).insert({
            tenant_id: tenantId,
            name,
            email:              mapVal(row, mapping.email) ?? null,
            telefon:            mapVal(row, mapping.telefon) ?? null,
            strasse:            mapVal(row, mapping.strasse) ?? null,
            plz:                mapVal(row, mapping.plz) ?? null,
            ort:                mapVal(row, mapping.ort) ?? null,
            land:               mapVal(row, mapping.land) || 'AT',
            segment,
            uid_nummer:         mapVal(row, mapping.uid_nummer) ?? null,
            zahlungsziel_tage:  mapVal(row, mapping.zahlungsziel_tage, v => parseInt(v) || null) ?? null,
            notizen:            mapVal(row, mapping.notizen) ?? null,
            aktiv: true, is_lead: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'fuellungen') {
          const bezeichnung = mapVal(row, mapping.bezeichnung)
          if (!bezeichnung) { details.push(`Zeile ${i+2}: Bezeichnung fehlt – übersprungen`); continue }
          const { error } = await (supabase.from('fuellungen') as any).insert({
            tenant_id:          tenantId,
            bezeichnung,
            jahrgang:           mapVal(row, mapping.jahrgang, v => parseInt(v) || null) ?? null,
            rebsorte:           mapVal(row, mapping.rebsorte) ?? null,
            flaschengroesse_ml: mapVal(row, mapping.flaschengroesse_ml, v => parseInt(v) || 750) ?? 750,
            bestand_flaschen:   mapVal(row, mapping.lagerbestand_fl, v => parseInt(v) || 0) ?? 0,
            vk_preis_brutto:    mapVal(row, mapping.vk_preis_brutto, parseDeZahl) ?? null,
            einstandspreis:     mapVal(row, mapping.einkaufspreis, parseDeZahl) ?? null,
            notizen:            mapVal(row, mapping.notizen) ?? null,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'rieden_details') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+2}: Bezeichnung fehlt – übersprungen`); continue }
          const riedName = mapVal(row, mapping.ried) as string | null
          let lageId: string | null = null
          let riedText: string | null = null
          if (riedName) {
            lageId = await findOrCreateLageId(riedName)
            riedText = riedName.trim()
          }
          const { error } = await (supabase.from('weingarten') as any).insert({
            tenant_id:  tenantId,
            name,
            lage_id:    lageId,
            ried:       riedText,
            rebsorte:   mapVal(row, mapping.rebsorte) ?? null,
            pflanzjahr: mapVal(row, mapping.pflanzjahr, v => parseInt(v) || null) ?? null,
            weinart:    (mapVal(row, mapping.weinart) as string) || 'unbekannt',
            flaeche_ha: mapVal(row, mapping.flaeche_ha, parseDeZahl) ?? null,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'grundstuecke') {
          const gstNr = mapVal(row, mapping.gst_nr)
          if (!gstNr) { details.push(`Zeile ${i+2}: GST-Nummer fehlt – übersprungen`); continue }
          const riedFlaeche = mapVal(row, mapping.ried_flaeche) as string | null
          if (!riedFlaeche) { details.push(`Zeile ${i+2}: Ried-Zuordnung fehlt – übersprungen`); continue }
          const weingartenId = await findWeingartenId(riedFlaeche)
          if (!weingartenId) {
            details.push(`Zeile ${i+2}: Ried "${riedFlaeche}" nicht gefunden (zuerst über Tab "Rieden (Details)" anlegen) – übersprungen`)
            continue
          }
          const kgnr = mapVal(row, mapping.katastralgemeinde) as string | null
          const { error } = await (supabase.from('grundstuecke') as any).insert({
            tenant_id:            tenantId,
            weingarten_id:        weingartenId,
            gst_nr:               gstNr,
            katastralgemeinde:    kgnr ?? null,
            kg_bezeichnung:       kgnr ? (getKgBezeichnung(kgnr) ?? null) : null,
            flaeche_ha:           mapVal(row, mapping.flaeche_ha, parseDeZahl) ?? null,
            flaeche_ha_kataster:  mapVal(row, mapping.flaeche_ha_kataster, parseDeZahl) ?? null,
            rebsorte:             mapVal(row, mapping.rebsorte) ?? null,
            weinart:              mapVal(row, mapping.weinart, normalizeWeinart) ?? null,
            pflanzjahr:           mapVal(row, mapping.pflanzjahr, v => parseInt(v) || null) ?? null,
            ama_feldnummer:       mapVal(row, mapping.ama_feldnummer) ?? null,
            boden:                mapVal(row, mapping.boden) ?? null,
            bewirtschaftung:      mapVal(row, mapping.bewirtschaftung) ?? null,
            // Rückmeldung 24.8.2026: "status" abgelöst durch "nutzart"
            // (A/G/WI) - steuert jetzt Ernte-/Behandlungs-/Zukauf-Logik.
            nutzart:              (mapVal(row, mapping.nutzart) as string)?.toUpperCase() || null,
            spritzbar:            (mapVal(row, mapping.nutzart) as string)?.toUpperCase() === 'WI',
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }

        } else if (typ === 'gebinde') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+2}: Bezeichnung fehlt – übersprungen`); continue }
          const { error } = await (supabase.from('behaelter') as any).insert({
            tenant_id:     tenantId,
            name,
            typ:           mapVal(row, mapping.typ, normalizeBehaelterTyp) ?? null,
            volumen_liter: mapVal(row, mapping.volumen_liter, parseDeZahl) ?? null,
            standort:      mapVal(row, mapping.standort) ?? null,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+2}: ${error.message}`); continue }
        }
        ok++
      } catch (err) {
        details.push(`Zeile ${i+2}: ${String(err)}`)
      }
    }

    return NextResponse.json({ ok, fehler: rows.length - ok, details })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
