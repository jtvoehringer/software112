import { createSupabaseServerClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { getCurrentMembership, canWrite } from '@/lib/auth/roles'
import { getKgBezeichnung } from '@/lib/wein/katastralgemeinden'
import { zerlegeTelefon } from '@/lib/crm/telefon'
import { pruefeEmailFelder } from '@/lib/crm/email'
import { dezimal } from '@/lib/format'
import { pruefeZweiFaktor } from '@/lib/api/zweiFaktor'
export const dynamic = 'force-dynamic'
// Große Importe (Dynamics-Leads 3.9.2026: 4.200 Firmen / 7.900 Kontakte) kommen
// vom Client in Blöcken (siehe ImportClient.tsx, IMPORT_BLOCKGROESSE) - ein
// Block muss sicher innerhalb des Funktions-Limits fertig werden.
export const maxDuration = 60
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
  if (s.includes(',')) s = dezimal(s)
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

// Ganzzahl-Variante von parseDeZahl - für Felder wie Jahrgang/Lagerbestand/
// Zahlungsziel, die ebenfalls im deutschen Tausender-Format geliefert werden
// können (z.B. "1 474" Flaschen oder "2 025" als Jahrgang). Reines parseInt(v)
// bricht wie parseFloat am ersten Leerzeichen ab und lieferte hier bisher
// stillschweigend 1 bzw. 2 statt 1474/2025 (Rückmeldung 2.9.2026,
// Füllungen-Import).
function parseDeInt(v: string): number | null {
  const n = parseDeZahl(v)
  return n != null ? Math.round(n) : null
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

// Für den Duplikat-Abgleich (Lead-Import gegen bestehende aktive Kunden):
// trim + lowercase + Mehrfach-Leerzeichen zusammenfassen, damit z.B.
// "Karl  Grill" und "karl grill" als derselbe Name erkannt werden.
// Muss mit HERKUNFT_DEFAULT in admin/import/ImportClient.tsx übereinstimmen.
const HERKUNFT_DEFAULT = 'Datenmigration aus Drittsystem'

function normName(v: string | null | undefined): string {
  return (v ?? '').toString().trim().toLowerCase().replace(/\s+/g, ' ')
}

// Identische RPC wie beim manuellen Anlegen einer Firma/eines Kontakts über das
// Formular (src/app/(dashboard)/crm/actions.ts) - atomischer, pro Mandant
// fortlaufender Zähler mit Prefix (z.B. "K-00042"), damit importierte
// Datensätze dieselbe Nummernvergabe erhalten wie manuell angelegte
// (Rückmeldung 1.9.2026: importierte Kunden/Kontakte brauchen eine
// Accountnummer - vorher blieb das Feld beim Import leer).
async function generateAccountnummer(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  tenantId: string,
): Promise<string | null> {
  const { data, error } = await (supabase.rpc as any)('get_next_accountnummer', { p_tenant_id: tenantId })
  if (error) { console.error('generateAccountnummer:', error.message); return null }
  return data as string | null
}

export async function POST(req: NextRequest) {
  const zweiFaktor = await pruefeZweiFaktor()
  if (zweiFaktor) return zweiFaktor
  try {
    const { typ, rows, mapping, istLead, herkunft, zeilenOffset } = await req.json() as {
      typ: 'kontakte' | 'firmen' | 'fuellungen' | 'rieden_details' | 'grundstuecke' | 'gebinde'
      rows: R[]
      mapping: Record<string, string>
      istLead?: boolean
      herkunft?: string
      /** Zeilenversatz des Blocks (0-basiert) für die Zeilennummern in den Meldungen */
      zeilenOffset?: number
    }
    const zeilenBasis = 2 + (Number.isFinite(zeilenOffset) && (zeilenOffset ?? 0) > 0 ? Number(zeilenOffset) : 0)
    // Kunden und Leads werden laut Rückmeldung (1.9.2026) bewusst aus getrennten
    // Dateien importiert - Default true entspricht dem bisherigen (fest
    // verdrahteten) Verhalten, falls das Frontend nichts mitschickt.
    const leadImport = istLead ?? true

    // Herkunftskennzeichnung (Rückmeldung 2.9.2026: "allen Einträgen einen Text
    // 'Datenmigration aus Drittsystem' hinzufügen"). Zweigleisig:
    //  - sichtbar: Text wird im Notizen-Feld vorangestellt (bestehende Notiz
    //    aus der CSV bleibt darunter erhalten),
    //  - strukturiert: import_quelle + importiert_am (Migration 192) auf allen
    //    Import-Zieltabellen, damit importierte Datensätze später filter-,
    //    auswert- und gesammelt bereinigbar sind - auch bei Gebinde, die gar
    //    kein Notizen-Feld haben.
    // Der Text kommt aus dem Import-Dialog (dort vorbelegt und anpassbar, z.B.
    // auf den Namen des Altsystems); leer/fehlend -> Default.
    const importQuelle = (typeof herkunft === 'string' && herkunft.trim()) ? herkunft.trim().slice(0, 120) : HERKUNFT_DEFAULT
    const importiertAm = new Date()
    const importDatumDe = importiertAm.toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Vienna' })
    const herkunftZeile = `${importQuelle} – importiert am ${importDatumDe}`
    const mitHerkunft = (notiz: unknown): string => {
      const n = (notiz ?? '').toString().trim()
      return n ? `${herkunftZeile}\n${n}` : herkunftZeile
    }
    const herkunftFelder = { import_quelle: importQuelle, importiert_am: importiertAm.toISOString() }

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
    const duplikate: { zeile: number; name: string; email: string | null; grund: string }[] = []

    // Lead-Import (Rückmeldung 1.9.2026): Kunden und Leads kommen aus getrennten
    // Altsystem-Exporten. Kommt ein Datensatz später nochmal als Lead herein, der
    // hier bereits als aktiver Kunde (is_lead=false, aktiv=true) existiert, soll er
    // NICHT dupliziert, sondern übersprungen und im Report ausgewiesen werden.
    // Abgleich über Name (normalisiert) ODER E-Mail - bewusst kein Fuzzy-Matching,
    // Altsystem-Exporte sind schon unzuverlässig genug (siehe SEGMENT_MAP-Historie
    // oben), ein zu aggressiver Abgleich würde sonst echte Neuanlagen verschlucken.
    const kundenNameSet = new Set<string>()
    const kundenEmailSet = new Set<string>()
    if (leadImport && (typ === 'kontakte' || typ === 'firmen')) {
      if (typ === 'kontakte') {
        const { data: bestehende } = await (supabase.from('kontakte') as any)
          .select('vorname, nachname, email')
          .eq('tenant_id', tenantId).eq('aktiv', true).eq('is_lead', false)
        for (const k of (bestehende ?? []) as R[]) {
          kundenNameSet.add(normName([k.vorname, k.nachname].filter(Boolean).join(' ')))
          if (k.email) kundenEmailSet.add(normName(k.email))
        }
      } else {
        const { data: bestehende } = await (supabase.from('firmen') as any)
          .select('name, email')
          .eq('tenant_id', tenantId).eq('aktiv', true).eq('is_lead', false)
        for (const f of (bestehende ?? []) as R[]) {
          kundenNameSet.add(normName(f.name))
          if (f.email) kundenEmailSet.add(normName(f.email))
        }
      }
    }

    // Caches für "Rieden (Details)" (Ried-Name → lagen.id, legt bei Bedarf neu an)
    // und "Grundstücke" (Weingarten-Name → weingarten.id), damit derselbe Name
    // innerhalb eines Imports nicht mehrfach abgefragt/angelegt wird.
    const lageCache: Map<string, string> = new Map()
    const weingartenCache: Map<string, string> = new Map()

    // Kontakte → Firma per Namensabgleich (Rückmeldung 3.9.2026, Dynamics-
    // Leads: 5.000+ Kontakte tragen ihren Firmennamen). Alle Firmen des
    // Mandanten einmal laden statt pro Zeile abzufragen; Schlüssel = Name
    // normalisiert (trim, lowercase, Mehrfach-Leerzeichen).
    let firmenIndex: Map<string, string> | null = null
    async function findFirmaId(name: string): Promise<string | null> {
      if (!firmenIndex) {
        firmenIndex = new Map()
        const { data } = await (supabase.from('firmen') as any)
          .select('id, name').eq('tenant_id', tenantId)
        for (const f of (data ?? []) as R[]) {
          const key = normName(f.name)
          if (key && !firmenIndex.has(key)) firmenIndex.set(key, f.id as string)
        }
      }
      return firmenIndex.get(normName(name)) ?? null
    }

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
        .insert({ tenant_id: tenantId, name: name.trim(), notizen: mitHerkunft(null), ...herkunftFelder })
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
          const vorname = mapVal(row, mapping.vorname) as string | null | undefined
          const nachname = mapVal(row, mapping.nachname)
          if (!nachname) { details.push(`Zeile ${i+zeilenBasis}: Nachname fehlt – übersprungen`); continue }
          // E-Mail bereinigen (lib/crm/email.ts): Anzeigename weg, Mehrfachadressen aufteilen, Unbrauchbares in die Notiz
          const emailRoh = ((mapVal(row, mapping.email) as string | null | undefined) ?? null)
          const emK = pruefeEmailFelder(emailRoh, null)
          const email = emK.email
          const vollname = [vorname, nachname].filter(Boolean).join(' ')
          if (leadImport) {
            const emailKey = email ? normName(email) : null
            if ((emailKey && kundenEmailSet.has(emailKey)) || kundenNameSet.has(normName(vollname))) {
              duplikate.push({ zeile: i+zeilenBasis, name: vollname, email, grund: 'bereits aktiver Kunde' })
              continue
            }
          }
          const segment = SEGMENT_MAP[(mapVal(row, mapping.segment) as string)?.toLowerCase() ?? ''] ?? 'privat'
          // Firmenzuordnung: gefunden -> firma_id; nicht gefunden -> Vermerk in
          // den Notizen, damit die Information nicht verloren geht.
          const firmaName = (mapVal(row, mapping.firma) as string | null | undefined)?.trim() || null
          const firmaId = firmaName ? await findFirmaId(firmaName) : null
          let notizKontakt = (mapVal(row, mapping.notizen) as string | null | undefined) ?? null
          if (emK.fehler) notizKontakt = [notizKontakt, `Import: E-Mail-Feld unbrauchbar: „${emailRoh}“`].filter(Boolean).join('\n')
          if (firmaName && !firmaId) {
            const vermerk = `Firma lt. Import: ${firmaName} (nicht zugeordnet)`
            notizKontakt = notizKontakt ? `${vermerk}\n${notizKontakt}` : vermerk
          }
          // Telefon/Mobil in Vorwahl + nationale Nummer zerlegen (Rückmeldung
          // 3.9.2026: "+49 (36041) 428 95" landete komplett im Feld telefon,
          // Vorwahl blieb +43 -> Anzeige "+43 +49 ..."). Siehe lib/crm/telefon.ts.
          const landK = ((mapVal(row, mapping.land) as string | null | undefined) || 'AT').toUpperCase()
          const telK = zerlegeTelefon(mapVal(row, mapping.telefon) as string | null | undefined, landK)
          const mobK = zerlegeTelefon(mapVal(row, mapping.mobil) as string | null | undefined, landK)
          const { error } = await (supabase.from('kontakte') as any).insert({
            tenant_id: tenantId,
            accountnummer: await generateAccountnummer(supabase, tenantId),
            vorname:   vorname ?? null,
            nachname,
            firma_id:  firmaId,
            email,
            email_weitere: emK.email_weitere,
            telefon:   telK.nummer,
            telefon_vorwahl: telK.vorwahl,
            mobil:     mobK.nummer,
            mobil_vorwahl: mobK.vorwahl,
            strasse:   mapVal(row, mapping.strasse) ?? null,
            plz:       mapVal(row, mapping.plz) ?? null,
            ort:       mapVal(row, mapping.ort) ?? null,
            land:      landK,
            segment,
            notizen:   mitHerkunft(notizKontakt),
            ...herkunftFelder,
            aktiv: true, stammkunde: false, newsletter: false,
            newsletter_bestaetigt: false, is_lead: leadImport,
          })
          if (error) { details.push(`Zeile ${i+zeilenBasis}: ${error.message}`); continue }

        } else if (typ === 'firmen') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+zeilenBasis}: Name fehlt – übersprungen`); continue }
          const emailRoh = ((mapVal(row, mapping.email) as string | null | undefined) ?? null)
          const emF = pruefeEmailFelder(emailRoh, null)
          const email = emF.email
          if (leadImport) {
            const emailKey = email ? normName(email) : null
            if ((emailKey && kundenEmailSet.has(emailKey)) || kundenNameSet.has(normName(name as string))) {
              duplikate.push({ zeile: i+zeilenBasis, name: name as string, email, grund: 'bereits aktiver Kunde' })
              continue
            }
          }
          const segment = SEGMENT_MAP[(mapVal(row, mapping.segment) as string)?.toLowerCase() ?? ''] ?? 'gastronomie'
          const landF = ((mapVal(row, mapping.land) as string | null | undefined) || 'AT').toUpperCase()
          const telF = zerlegeTelefon(mapVal(row, mapping.telefon) as string | null | undefined, landF)
          const mobF = zerlegeTelefon(mapVal(row, mapping.mobil) as string | null | undefined, landF)
          const { error } = await (supabase.from('firmen') as any).insert({
            tenant_id: tenantId,
            accountnummer: await generateAccountnummer(supabase, tenantId),
            name,
            email,
            email_weitere:      emF.email_weitere,
            telefon:            telF.nummer,
            telefon_vorwahl:    telF.vorwahl,
            mobil:              mobF.nummer,
            mobil_vorwahl:      mobF.vorwahl,
            strasse:            mapVal(row, mapping.strasse) ?? null,
            plz:                mapVal(row, mapping.plz) ?? null,
            ort:                mapVal(row, mapping.ort) ?? null,
            land:               landF,
            segment,
            uid_nummer:         mapVal(row, mapping.uid_nummer) ?? null,
            betrieb_nr:         mapVal(row, mapping.betrieb_nr) ?? null,
            debitor_nr:         mapVal(row, mapping.debitor_nr) ?? null,
            // zahlungsziel_tage ist seit Migration 150 NOT NULL (DB-Default 30). Ein
            // explizites "null" (z.B. bei "– nicht importieren –" oder einem leeren/
            // ungültigen Wert) überschreibt den Spalten-Default und lässt den Insert
            // mit "violates not-null constraint" scheitern - deshalb hier hart auf 30
            // fallen statt auf null (Rückmeldung 1.9.2026: alle 6 Zeilen fehlgeschlagen,
            // obwohl "Zahlungsziel" bewusst nicht zugeordnet war).
            zahlungsziel_tage:  mapVal(row, mapping.zahlungsziel_tage, v => parseDeInt(v) || 30) ?? 30,
            notizen:            mitHerkunft([mapVal(row, mapping.notizen), emF.fehler ? `Import: E-Mail-Feld unbrauchbar: „${emailRoh}“` : null].filter(Boolean).join('\n') || null),
            ...herkunftFelder,
            aktiv: true, is_lead: leadImport,
          })
          if (error) { details.push(`Zeile ${i+zeilenBasis}: ${error.message}`); continue }

        } else if (typ === 'fuellungen') {
          const bezeichnung = mapVal(row, mapping.bezeichnung)
          if (!bezeichnung) { details.push(`Zeile ${i+zeilenBasis}: Bezeichnung fehlt – übersprungen`); continue }
          const bestand = (mapVal(row, mapping.lagerbestand_fl, v => parseDeInt(v) || 0) as number | null) ?? 0
          const { error } = await (supabase.from('fuellungen') as any).insert({
            tenant_id:          tenantId,
            // "fuellungen.name" ist NOT NULL ohne Default und wurde hier bisher
            // gar nicht gesetzt (nur "bezeichnung", ein separates, nullable
            // Zusatzfeld) - jede Zeile scheiterte dadurch an der NOT-NULL-
            // Constraint, unabhängig vom Spalten-Mapping (Rückmeldung 2.9.2026,
            // "null value in column name"). Die importierte Verkaufsbezeichnung
            // dient hier zugleich als Name; bezeichnung bleibt für Importe leer,
            // um keinen doppelten Text ("X – X") in der Übersicht anzuzeigen.
            name: bezeichnung,
            jahrgang:           mapVal(row, mapping.jahrgang, v => parseDeInt(v)) ?? null,
            rebsorte:           mapVal(row, mapping.rebsorte) ?? null,
            flaschengroesse_ml: mapVal(row, mapping.flaschengroesse_ml, v => parseDeInt(v) || 750) ?? 750,
            // "anzahl_flaschen" (ursprünglich abgefüllte Menge) ist ebenfalls
            // NOT NULL ohne Default und wurde bisher gar nicht gesetzt. Die
            // tatsächliche Füllmenge kennen wir beim Import nicht mehr - wie bei
            // einer manuellen Neuanlage (siehe weinhandel/actions.ts) auf den
            // importierten Lagerbestand setzen.
            anzahl_flaschen:    bestand,
            bestand_flaschen:   bestand,
            vk_preis_brutto:    mapVal(row, mapping.vk_preis_brutto, parseDeZahl) ?? null,
            einstandspreis:     mapVal(row, mapping.einkaufspreis, parseDeZahl) ?? null,
            notizen:            mitHerkunft(mapVal(row, mapping.notizen)),
            ...herkunftFelder,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+zeilenBasis}: ${error.message}`); continue }

        } else if (typ === 'rieden_details') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+zeilenBasis}: Bezeichnung fehlt – übersprungen`); continue }
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
            pflanzjahr: mapVal(row, mapping.pflanzjahr, v => parseDeInt(v)) ?? null,
            weinart:    (mapVal(row, mapping.weinart) as string) || 'unbekannt',
            flaeche_ha: mapVal(row, mapping.flaeche_ha, parseDeZahl) ?? null,
            notizen:    mitHerkunft(null),
            ...herkunftFelder,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+zeilenBasis}: ${error.message}`); continue }

        } else if (typ === 'grundstuecke') {
          const gstNr = mapVal(row, mapping.gst_nr)
          if (!gstNr) { details.push(`Zeile ${i+zeilenBasis}: GST-Nummer fehlt – übersprungen`); continue }
          const riedFlaeche = mapVal(row, mapping.ried_flaeche) as string | null
          if (!riedFlaeche) { details.push(`Zeile ${i+zeilenBasis}: Ried-Zuordnung fehlt – übersprungen`); continue }
          const weingartenId = await findWeingartenId(riedFlaeche)
          if (!weingartenId) {
            details.push(`Zeile ${i+zeilenBasis}: Ried "${riedFlaeche}" nicht gefunden (zuerst über Tab "Rieden (Details)" anlegen) – übersprungen`)
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
            pflanzjahr:           mapVal(row, mapping.pflanzjahr, v => parseDeInt(v)) ?? null,
            ama_feldnummer:       mapVal(row, mapping.ama_feldnummer) ?? null,
            boden:                mapVal(row, mapping.boden) ?? null,
            bewirtschaftung:      mapVal(row, mapping.bewirtschaftung) ?? null,
            // Rückmeldung 24.8.2026: "status" abgelöst durch "nutzart"
            // (A/G/WI) - steuert jetzt Ernte-/Behandlungs-/Zukauf-Logik.
            nutzart:              (mapVal(row, mapping.nutzart) as string)?.toUpperCase() || null,
            spritzbar:            (mapVal(row, mapping.nutzart) as string)?.toUpperCase() === 'WI',
            notizen:              mitHerkunft(null),
            ...herkunftFelder,
          })
          if (error) { details.push(`Zeile ${i+zeilenBasis}: ${error.message}`); continue }

        } else if (typ === 'gebinde') {
          const name = mapVal(row, mapping.name)
          if (!name) { details.push(`Zeile ${i+zeilenBasis}: Bezeichnung fehlt – übersprungen`); continue }
          const { error } = await (supabase.from('behaelter') as any).insert({
            tenant_id:     tenantId,
            name,
            typ:           mapVal(row, mapping.typ, normalizeBehaelterTyp) ?? null,
            volumen_liter: mapVal(row, mapping.volumen_liter, parseDeZahl) ?? null,
            standort:      mapVal(row, mapping.standort) ?? null,
            // behaelter hat kein Notizen-Feld - Kennzeichnung nur strukturiert.
            ...herkunftFelder,
            aktiv: true,
          })
          if (error) { details.push(`Zeile ${i+zeilenBasis}: ${error.message}`); continue }
        }
        ok++
      } catch (err) {
        details.push(`Zeile ${i+zeilenBasis}: ${String(err)}`)
      }
    }

    return NextResponse.json({ ok, fehler: rows.length - ok - duplikate.length, duplikate, details })
  } catch (err) {
    return NextResponse.json({ fehler: String(err) }, { status: 500 })
  }
}
