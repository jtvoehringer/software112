import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen, gezaehlt } from '@/lib/supabase/geladen'
import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { losText } from '@/lib/handel/losnummer'
import Link from '@/components/ui/Link'
import { stornoVerkauf, stornoZahlung, rechnungErstellen, rechnungStornieren, verkaufSamtRechnungStornieren } from '../actions'
import StornoButton from '@/components/StornoButton'
import PrintButton from '@/app/(dashboard)/kellerbuch/kellerplan/[id]/PrintButton'
import StornoKnopf from './StornoKnopf'
import RechnungVersandPanel from './RechnungVersandPanel'
import RechnungErstellenPanel from './RechnungErstellenPanel'
import { ersterOffenerRechnungstag } from '@/lib/verkauf/rechnungsdatum'
import RechnungStornoKnopf from './RechnungStornoKnopf'
import VerkaufSamtRechnungStornoKnopf from './VerkaufSamtRechnungStornoKnopf'
import { wienHeute } from '@/lib/csv'
import { datumText } from '@/lib/behoerden/buchhaltung-gemeinsam'
import { Mail, Phone, Info, CreditCard, FileText } from 'lucide-react'
import { fmtEur, fmtNum } from '@/lib/format'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import { lieferadresseKurz, lieferadresseZeilen, type LieferadresseMoment } from '@/lib/crm/lieferadressen'
import { landAnzeige } from '@/lib/katalog/laender'
import { tbsText } from '@/lib/handel/tbsNummer'
import { TB_POSITIONSTYPEN } from '@/lib/behoerden/transportbescheinigung'
import ZahlungErfassen from '@/components/handel/ZahlungErfassen'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data = geladen(await (supabase.from('verkaufsposten') as any)
    .select('rechnungsnummer, datum')
    .eq('id', id)
    .eq('tenant_id', membership?.tenantId ?? '')
    .maybeSingle(), 'Verkäufe')
  const d = data as R | null
  const label = d?.rechnungsnummer
    ? `Beleg ${d.rechnungsnummer}`
    : d?.datum ? `Verkauf ${new Date(d.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}` : 'Verkauf'
  return { title: `${label}` }
}

// ── Tenant-Einstellungen (Briefkopf + Rechnung) ──────────────────────────────
async function getTenantSettings(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, tenantId: string | null) {
  try {
    const data = geladen(await (supabase.from('tenant_einstellungen') as any)
      .select(`anzeigename, logo_url,
               betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort,
               betrieb_telefon, betrieb_email, betrieb_website, betrieb_uid,
               rechnung_iban, rechnung_bic, rechnung_zahlungsziel, rechnung_fusstext`)
      .eq('tenant_id', tenantId ?? '')
      .limit(1)
      .maybeSingle(), 'Einstellungen')
    return (data as R | null) ?? {}
  } catch {
    return {}
  }
}

export default async function VerkaufDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string }> }) {
  const { id }   = await params
  const { mode } = await searchParams
  const modusRechnung = mode !== 'lieferschein'
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role, 'warenwirtschaft')
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const [postenRawRes, settings, zahlungenRawRes, traubenverkaufRes, tbRawRes, stornierteRechnungenRes] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, lieferscheinnummer, notizen, erstellt_am, storniert, storniert_am, storniert_von_name, storno_grund,
        bezahlt, bezahlt_am, skonto_pct, skonto_tage, skonto_aktiv,
        rechnung_versendet_am, rechnung_versendet_an, partner_daten, lieferadresse,
        rechnung:rechnungen!rechnung_id(id, rechnungsnummer, datum, spiegel, storniert, bmd_export_id, lieferscheine:verkaufsposten!rechnung_id(id)),
        kontakt:kontakte!kontakt_id(id, titel, vorname, nachname, titel_nachgestellt, email, telefon, strasse, plz, ort, zahlungsziel_tage),
        firma:firmen(id, name, email, telefon, strasse, plz, ort, zahlungsziel_tage),
        zh_kontakt:kontakte!zh_kontakt_id(titel, vorname, nachname, titel_nachgestellt),
        positionen:verkauf_positionen(
          id, typ, name, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz,
          fuellung:fuellungen(id, name, jahrgang, flaschengroesse_ml, pruefnummer, chargennummer, datum),
          weinausbau:weinausbau(id, name)
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId ?? '')
      .eq('aktiv', true)
      .maybeSingle(),
    getTenantSettings(supabase, tenantId),
    // storno-sichtbar: Liste/Druck zeigt stornierte Buchungen gekennzeichnet (storniert_am wird mitgeladen) – Zahlungen des Belegs
    (supabase.from('zahlungen') as any)
      .select('id, betrag, art, datum, notizen, erstellt_am, storniert_am, storniert_von_name, storno_grund')
      .eq('verkaufsposten_id', id)
      .eq('tenant_id', tenantId ?? '')
      .order('datum', { ascending: true }).order('erstellt_am').order('id'),
    // Traubenverkäufe (BKI) zu diesem Beleg – ein Storno storniert sie mit (Hinweis im Storno-Dialog)
    (supabase.from('traubenverkauf') as any)
      .select('id', { count: 'exact', head: true })
      .eq('verkaufsposten_id', id)
      .eq('tenant_id', tenantId ?? '')
      .is('storniert_am', null),
    // KAN-90: TBS-Nr. der gültigen Transportbescheinigung (Anzeige am Knopf)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('transportbescheinigungen') as any)
      .select('tbs_nummer, tbs_jahr, status')
      .eq('verkaufsposten_id', id)
      .eq('tenant_id', tenantId ?? '')
      .is('storniert_am', null)
      .maybeSingle(),
    // KAN-379 Nachtrag: stornierte Rechnungen dieses Lieferscheins (nach dem Storno ist er wieder „nicht berechnet“ – die
    // Verbindung steht nur noch in der Momentaufnahme storno_positionen) samt Stornobeleg
    // storno-sichtbar: gerade die stornierten Rechnungen, als Hinweis mit Link auf Rechnung und Stornobeleg
    // alle-ausnahme: stornierte Rechnungen eines einzelnen Lieferscheins – fachlich nur wenige Zeilen
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('rechnungen') as any)
      .select('id, rechnungsnummer, datum, storniert_am, storniert_durch:rechnungen!storniert_durch_id(id, rechnungsnummer, datum)')
      .eq('tenant_id', tenantId ?? '')
      .eq('storniert', true)
      .contains('storno_positionen', [{ lieferschein_id: id }])
      .order('storniert_am', { ascending: true })
      .order('id'),
  ])
  const postenRaw = geladen(postenRawRes, 'Verkäufe')
  const zahlungenRaw = geladen(zahlungenRawRes, 'Zahlungen')
  const tbRaw = geladen(tbRawRes, 'Transportbescheinigungen')
  const stornierteRechnungen = (geladen(stornierteRechnungenRes, 'Stornierte Rechnungen') ?? []) as R[]
  const traubenverkaufAnzahl = gezaehlt(traubenverkaufRes, 'Traubenverkäufe')
  const tbsNr = tbsText((tbRaw as R | null)?.tbs_nummer, (tbRaw as R | null)?.tbs_jahr)

  if (!postenRaw) notFound()

  // KAN-150 F1c: Käufer, Anschrift und z. H. wie beim Anlegen der Rechnung (id/E-Mail weiter aus den Stammdaten)
  const posten    = momentaufnahmeAnwenden(postenRaw as R, ['kontakt', 'firma', 'zh_kontakt'])
  const positionen = (posten.positionen ?? []) as R[]
  const hasTank   = positionen.some((p: R) => p.typ === 'tank')
  // Most-/Wein- (lose) und Traubenverkauf benötigen eine Transportbescheinigung gem. Weingesetz;
  // Flaschenwein nicht (KAN-90, Entscheidung 06.10.2026 – TB_POSITIONSTYPEN)
  const brauchtTransportschein = positionen.some((p: R) => (TB_POSITIONSTYPEN as readonly string[]).includes(p.typ))

  const gesamt = positionen.reduce((s: number, p: R) => {
    if (p.preis_brutto == null) return s
    const brutto  = Number(p.preis_brutto) * Number(p.menge)
    const rabatt  = (Number(p.rabatt_pct ?? 0)) / 100
    const sonder  = (Number(p.sonderrabatt_pct ?? 0)) / 100
    return s + brutto * (1 - rabatt) * (1 - sonder)
  }, 0)

  function kundenName(p: R): string {
    if (p.kontakt) {
      return kontaktAnzeigename(p.kontakt as R)   // Hotfix 05.10.2026: mit Titeln in der Anschrift
    }
    if (p.firma) return (p.firma as R).name
    return '–'
  }

  function kundenInfo(p: R): { email?: string; telefon?: string; strasse?: string; plzOrt?: string } {
    const src = p.kontakt ?? p.firma
    if (!src) return {}
    return {
      email:   src.email   ?? undefined,
      telefon: src.telefon ?? undefined,
      strasse: src.strasse ?? undefined,
      plzOrt:  [src.plz, src.ort].filter(Boolean).join(' ') || undefined,
    }
  }

  // Verkäufe werden nur storniert, nie gelöscht/deaktiviert (KAN-35)
  const stornoWithId     = stornoVerkauf.bind(null, id)
  // KAN-103: Rechnung des Lieferscheins (fehlt = „nicht berechnet“); eigene Rechnung (nicht 1:1-Spiegel) storniert man getrennt
  const rechnung         = (posten.rechnung ?? null) as R | null
  const berechnet        = !!rechnung && !rechnung.storniert
  const eigeneRechnung   = berechnet && !rechnung?.spiegel
  // KAN-104: Sammelrechnung (mehrere Lieferscheine) – Druck und Versand auf der Rechnungsseite, nicht je Lieferschein
  const sammelrechnung   = berechnet && ((rechnung?.lieferscheine ?? []) as R[]).length > 1
  const isRechnung       = modusRechnung && berechnet && !sammelrechnung
  const rechnungsDatum   = String(rechnung?.datum ?? posten.datum)
  const rechnungErstellenAction = rechnungErstellen.bind(null, [id])
  // KAN-355: erster offener Tag für das Rechnungsdatum (nur Hinweis – die Action prüft das Datum ohnehin)
  let rechnungOffenAb: string | null = null
  if (!posten.storniert && !berechnet && tenantId) {
    try { rechnungOffenAb = await ersterOffenerRechnungstag(supabase, tenantId, wienHeute()) } catch { rechnungOffenAb = null }
  }
  const rechnungStornoAction    = rechnung ? rechnungStornieren.bind(null, String(rechnung.id), id) : null
  // KAN-356: Verkauf samt Rechnung in einem Schritt – nur eigene Rechnung mit genau einem Lieferschein, ohne ausgestellte
  // Transportbescheinigung (die Datenbank prüft dasselbe; Zahlungen, BMD und Zeitraum meldet sie am Knopf)
  const tbAusgestellt = (tbRaw as R | null)?.status === 'ausgestellt'
  const samtStornoAction = eigeneRechnung && !sammelrechnung && !posten.storniert && !tbAusgestellt
    ? verkaufSamtRechnungStornieren.bind(null, id) : null
  const hatTraubenverkauf = (traubenverkaufAnzahl ?? 0) > 0 || positionen.some((p: R) => p.typ === 'trauben')
  const stornoMeldung =
    'Der Lagerbestand wird zurückgebucht, der Beleg bleibt mit Datum, Benutzer und Grund als storniert erhalten.' +
    (hatTraubenverkauf ? ' Die zugehörigen Traubenverkäufe (BKI) werden mitstorniert, die Menge wird wieder frei.' : '') +
    // KAN-149 D2b (Ticket Frage 1): Einnahmen bleiben, solange nicht erstattet
    (((zahlungenRaw ?? []) as R[]).some(z => !z.storniert_am)
      ? ' Bezahlte Beträge bleiben als Einnahme stehen – mit „Erstattet am“ werden die Zahlungen an diesem Tag storniert und in der E&A gegengebucht.'
      : '') +
    // KAN-379: 1:1-Rechnung → Stornobeleg mit heutigem Datum (der Datenbank-Trigger legt ihn an)
    (berechnet ? ` Zur Rechnung ${rechnung?.rechnungsnummer ?? ''} entsteht ein Stornobeleg (ST-…) mit heutigem Datum.` : '')
  // KAN-379: Storno-Datum (Rückbuchung des Bestands) wählbar, solange keine Rechnung dranhängt – sonst trägt der Stornobeleg
  // das Datum (eigene Rechnung: Feld im Rechnungsstorno; 1:1-Rechnung: heute)
  const heute = wienHeute()
  const stornoDatumVerkauf = berechnet ? undefined : { heute, ab: String(posten.datum ?? '') || null }
  const stornoDatumRechnung = { heute, ab: rechnung?.datum ? String(rechnung.datum) : null }
  const info = kundenInfo(posten)
  // KAN-176: abweichende Lieferadresse (Momentaufnahme am Verkauf)
  const liefer = (posten.lieferadresse ?? null) as LieferadresseMoment | null
  const lieferZeilen = lieferadresseZeilen(liefer, iso => landAnzeige(iso))

  const FLASCHEN_LABEL: Record<number, string> = {
    187: '0,187 L', 375: '0,375 L', 500: '0,500 L', 750: '0,75 L',
    1000: '1,0 L', 1500: '1,5 L', 3000: '3,0 L', 6000: '6,0 L',
  }

  // ── Betriebsdaten aufbereiten ──────────────────────────────────────────────
  const s = settings as R
  const bName    = s.betrieb_name    ?? s.anzeigename ?? 'Weingut'
  const bStrasse = s.betrieb_strasse ?? null
  const bPlzOrt  = [s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ') || null
  const bTel     = s.betrieb_telefon ?? null
  const bEmail   = s.betrieb_email   ?? null
  const bWeb     = s.betrieb_website ?? null
  const bUID     = s.betrieb_uid     ?? null
  const logoUrl  = s.logo_url        ?? null
  const iban     = s.rechnung_iban   ?? null
  const bic      = s.rechnung_bic    ?? null
  // Zahlungsziel kommt seit 6.8.2026 vom Kunden (Kontakt/Firma), nicht mehr vom
  // Betrieb (s.rechnung_zahlungsziel ist nur noch träge Altdaten). 0 ist ein
  // gültiger, bewusster Wert ("bei Erhalt") - deshalb bewusst `??` statt `||`.
  const kontaktZahlungsziel = (posten.kontakt as R | null)?.zahlungsziel_tage
  const firmaZahlungsziel   = (posten.firma   as R | null)?.zahlungsziel_tage
  const zahlZiel = kontaktZahlungsziel ?? firmaZahlungsziel ?? 14
  const fusstext = s.rechnung_fusstext    ?? null

  // USt-Aufschlüsselung (gruppiert nach Steuersatz)
  const ustGruppen = positionen.reduce((acc: Record<string, number>, pos: R) => {
    const satz = Number(pos.ust_satz ?? 13)
    if (pos.preis_brutto == null) return acc
    const brutto  = Number(pos.preis_brutto) * Number(pos.menge)
    const rabatt  = (Number(pos.rabatt_pct ?? 0)) / 100
    const sonder  = (Number(pos.sonderrabatt_pct ?? 0)) / 100
    const effektiv = brutto * (1 - rabatt) * (1 - sonder)
    const netto = effektiv / (1 + satz / 100)
    const key = String(satz)
    acc[key] = (acc[key] ?? 0) + netto
    return acc
  }, {})
  const gesamtNetto = Object.values(ustGruppen).reduce((s: number, n) => s + (n as number), 0)

  const faelligkeitsDatum = new Date(rechnungsDatum)
  faelligkeitsDatum.setDate(faelligkeitsDatum.getDate() + zahlZiel)

  // Skonto (Frühzahler-Rabatt) — für Anzeige auf der Rechnung
  const skontoAktiv  = !!posten.skonto_aktiv && (posten.skonto_pct ?? 0) > 0
  const skontoDatum  = skontoAktiv
    ? new Date(new Date(rechnungsDatum).setDate(new Date(rechnungsDatum).getDate() + (posten.skonto_tage ?? 0)))
    : null
  const skontoBetrag = skontoAktiv ? (gesamt * (posten.skonto_pct ?? 0)) / 100 : 0

  // storno-sichtbar: stornierte Zahlungen stehen gekennzeichnet in der Liste, zählen aber nicht (KAN-149 D2b)
  const zahlungen      = (zahlungenRaw ?? []) as R[]
  const gueltigeZahlungen = zahlungen.filter((z: R) => !z.storniert_am)
  const bezahltSumme   = gueltigeZahlungen.reduce((s: number, z: R) => s + Number(z.betrag ?? 0), 0)
  const offenerBetrag  = gesamt - bezahltSumme
  const vollBezahlt    = offenerBetrag <= 0.01
  const teilBezahlt    = bezahltSumme > 0.01 && !vollBezahlt

  const ART_LABELS: Record<string, string> = {
    bar: 'Bar', karte: 'Karte', bank: 'Bank',
    gutschrift: 'Gutschrift', sonstig: 'Sonstiges',
  }


  return (
    <div className="space-y-6 print:space-y-3 max-w-3xl">
      {/* Print-Styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          aside, nav, header { display: none !important; }
          .print-only { display: block !important; }
          .print-page-break { page-break-before: always; }
        }
        @media screen { .print-only { display: none !important; } }
      `}</style>

      {/* Breadcrumb */}
      <div className="flex flex-wrap gap-2 items-center justify-between no-print">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700">Verkauf</Link>
          <span>/</span>
          <span className="text-s112-text font-medium">
            {posten.rechnungsnummer ?? new Date(posten.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
          </span>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          {posten.storniert && (
            <span className="text-xs font-semibold bg-s112-err-bg text-s112-err-fg px-2.5 py-1 rounded-full">
              STORNIERT
            </span>
          )}
          {brauchtTransportschein && (
            <Link
              href={`/weinhandel/verkauf/${id}/transportbescheinigung`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-s112-warn-fg bg-s112-warn-bg hover:bg-s112-warn/25 px-2.5 py-1.5 rounded-lg transition-colors"
              title="Transportbescheinigung gemäß Weingesetz"
            >
              <FileText size={14} /> Transportschein{tbsNr ? ` ${tbsNr}` : ''}
              {tbRaw && (tbRaw as R).status !== 'ausgestellt' && <span className="font-normal opacity-75">(Entwurf)</span>}
            </Link>
          )}
          <PrintButton />
          {writeOk && !posten.storniert && !eigeneRechnung && (
            <StornoKnopf action={stornoWithId} meldung={stornoMeldung} erstattung={gueltigeZahlungen.length > 0} stornoDatum={stornoDatumVerkauf} />
          )}
          {writeOk && eigeneRechnung && rechnungStornoAction && <RechnungStornoKnopf action={rechnungStornoAction} stornoDatum={stornoDatumRechnung} />}
          {writeOk && samtStornoAction && <VerkaufSamtRechnungStornoKnopf action={samtStornoAction} stornoDatum={stornoDatumRechnung} />}
          <div className="flex items-center border border-s112-border rounded-lg overflow-hidden text-xs">
            <a href={`/weinhandel/verkauf/${id}?mode=lieferschein`}
              className={`px-2.5 py-1.5 font-medium transition-colors ${!isRechnung ? 'bg-s112-teal text-s112-yellow' : 'bg-white text-s112-text-2 hover:bg-s112-bg'}`}>
              Lieferschein
            </a>
            {berechnet && !sammelrechnung && (
              <a href={`/weinhandel/verkauf/${id}`}
                className={`px-2.5 py-1.5 font-medium transition-colors ${isRechnung ? 'bg-s112-teal text-s112-yellow' : 'bg-white text-s112-text-2 hover:bg-s112-bg'}`}>
                Rechnung
              </a>
            )}
          </div>
        </div>
      </div>

      {/* KAN-149 D1: Storno mit Datum, Benutzer und Grund (ältere Stornos ohne Grund) */}
      {posten.storniert && (
        <p role="note" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">
          Storniert{posten.storniert_am ? ` am ${new Date(posten.storniert_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}` : ''}
          {posten.storniert_von_name ? ` von ${posten.storniert_von_name}` : ''}
          {posten.storno_grund ? ` – ${posten.storno_grund}` : ''}
        </p>
      )}

      {/* KAN-379 Nachtrag: stornierte Rechnung(en) dieses Lieferscheins mit Link auf den Stornobeleg */}
      {stornierteRechnungen.length > 0 && (
        <div role="note" className="text-sm text-s112-text-2 bg-s112-bg border border-s112-border rounded-lg px-3 py-2 space-y-0.5">
          {stornierteRechnungen.map(sr => {
            const st = (sr.storniert_durch ?? null) as R | null
            return (
              <p key={String(sr.id)}>
                Rechnung <Link href={`/weinhandel/rechnungen/${sr.id}`} className="font-mono text-s112-blue-700 hover:underline">{sr.rechnungsnummer}</Link> vom {datumText(sr.datum)} storniert
                {st
                  ? <> durch Stornobeleg <Link href={`/weinhandel/rechnungen/${st.id}`} className="font-mono text-s112-blue-700 hover:underline">{st.rechnungsnummer}</Link> vom {datumText(st.datum)}</>
                  : sr.storniert_am ? <> am {new Date(sr.storniert_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}</> : null}
                {st && ' – dort drucken oder per E-Mail senden.'}
              </p>
            )
          })}
        </div>
      )}

      {/* KAN-103: Lieferschein ohne Rechnung – Rechnung erstellen */}
      {writeOk && !posten.storniert && !berechnet && (
        <RechnungErstellenPanel heute={wienHeute()} lieferdatum={String(posten.datum)} offenAb={rechnungOffenAb} action={rechnungErstellenAction}
          positionen={((posten.positionen ?? []) as R[]).map(p => ({ id: String(p.id), name: String(p.name ?? ''), menge: Number(p.menge) || 0,
            einheit: p.einheit ?? null, preis_brutto: p.preis_brutto == null ? null : Number(p.preis_brutto), rabatt_pct: p.rabatt_pct == null ? null : Number(p.rabatt_pct) }))} />
      )}
      {eigeneRechnung && (
        <p className="text-sm text-s112-text-2 no-print">
          {sammelrechnung ? 'Teil der Sammelrechnung ' : 'Berechnet mit Rechnung '}
          <Link href={`/weinhandel/rechnungen/${rechnung?.id}`} className="font-mono text-s112-blue-700 hover:underline">{rechnung?.rechnungsnummer}</Link> vom {new Date(rechnungsDatum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
          {' '}– zum Stornieren des Lieferscheins zuerst die Rechnung stornieren.
        </p>
      )}

      {/* Rechnungsversand per E-Mail */}
      {!posten.storniert && berechnet && !sammelrechnung && (
        <div className="flex flex-col items-start gap-3 no-print">
          {writeOk ? (
            <RechnungVersandPanel
              verkaufId={id}
              defaultEmail={info.email ?? ''}
              sentAt={posten.rechnung_versendet_am ?? null}
              sentTo={posten.rechnung_versendet_an ?? null}
            />
          ) : posten.rechnung_versendet_am ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium bg-s112-bg text-s112-blue-700 px-2.5 py-1 rounded-full">
              <Mail size={12} />
              Versendet am {new Date(posten.rechnung_versendet_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
              {posten.rechnung_versendet_an ? ` an ${posten.rechnung_versendet_an}` : ''}
            </span>
          ) : null}
        </div>
      )}

      {/* ── RECHNUNG / LIEFERSCHEIN ─────────────────────────────────────────── */}

      {/* ── DRUCK-LAYOUT: Rechnung ODER Lieferschein ──────────────────────── */}
      <div className="print-only px-0 pt-0">
        {isRechnung ? (
          /* ── RECHNUNG ─────────────────────────────────────────────────────── */
          <div className="font-sans text-sm text-s112-text">
            {/* Briefkopf */}
            <div className="flex justify-between items-start mb-8 print:mb-4">
              <div>
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="h-14 mb-3 print:h-10 print:mb-1 object-contain" />
                )}
                <p className="font-semibold text-base">{bName}</p>
                {bStrasse && <p>{bStrasse}</p>}
                {bPlzOrt  && <p>{bPlzOrt}</p>}
                {bTel     && <p>Tel: {bTel}</p>}
                {bEmail   && <p>{bEmail}</p>}
                {bWeb     && <p>{bWeb}</p>}
                {bUID     && <p className="mt-1 text-s112-text-2">UID: {bUID}</p>}
              </div>
              <div className="text-right">
                <p className="text-3xl font-semibold text-s112-text">RECHNUNG</p>
                {posten.rechnungsnummer && (
                  <p className="text-base font-semibold mt-1">Nr. {posten.rechnungsnummer}</p>
                )}
                <p className="text-s112-text-2 mt-0.5">
                  Datum: {new Date(rechnungsDatum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
                </p>
                <p className="text-s112-text-2">
                  {zahlZiel === 0 ? 'Zahlbar bei Erhalt' : `Zahlbar bis: ${faelligkeitsDatum.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}`}
                </p>
              </div>
            </div>
            {/* Empfänger */}
            <div className="mb-8 print:mb-4 p-4 print:p-3 border border-s112-line rounded-sm inline-block min-w-[220px]">
              <p className="font-semibold text-base">{kundenName(posten)}</p>
              {posten.zh_kontakt && (
                <p className="text-s112-text-1">z.H. {kontaktAnzeigename(posten.zh_kontakt as R)}</p>
              )}
              {info.strasse && <p className="text-s112-text-2">{info.strasse}</p>}
              {info.plzOrt  && <p className="text-s112-text-2">{info.plzOrt}</p>}
            </div>
            {/* KAN-176: abweichende Lieferadresse */}
            {lieferZeilen.length > 0 && (
              <div className="mb-8 print:mb-4 ml-4 p-4 print:p-3 border border-s112-line rounded-sm inline-block min-w-[220px] align-top">
                <p className="text-xs uppercase tracking-wide text-s112-muted mb-1">Lieferadresse</p>
                {lieferZeilen.map((z, i) => <p key={i} className="text-s112-text-2">{z}</p>)}
              </div>
            )}
          </div>
        ) : (
          /* ── LIEFERSCHEIN ─────────────────────────────────────────────────── */
          <div className="flex justify-between items-start mb-6">
            <div>
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" className="h-12 mb-2 print:h-10 object-contain" />
              )}
              <p className="font-semibold text-lg">{bName}</p>
              {bStrasse && <p className="text-sm">{bStrasse}</p>}
              {bPlzOrt  && <p className="text-sm">{bPlzOrt}</p>}
              {bTel     && <p className="text-sm">Tel: {bTel}</p>}
              {bEmail   && <p className="text-sm">{bEmail}</p>}
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold">Lieferschein</p>
              {/* KAN-102: eigener Lieferschein-Nummernkreis; die Rechnung steht als Bezug darunter */}
              {posten.lieferscheinnummer && <p className="text-sm">Nr. {posten.lieferscheinnummer}</p>}
              {posten.rechnungsnummer && <p className="text-xs text-s112-muted">zu Rechnung {posten.rechnungsnummer}</p>}
              <p className="text-sm">{new Date(posten.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}</p>
            </div>
          </div>
        )}
        {/* Empfänger (Lieferschein-Modus) – KAN-176: mit abweichender Lieferadresse geht die Ware dorthin */}
        {!isRechnung && (
          <div className="mb-8 print:mb-4">
            <p className="font-semibold">{kundenName(posten)}</p>
            {lieferZeilen.length > 0 ? (
              <>
                {lieferZeilen.map((z, i) => <p key={i} className="text-sm">{z}</p>)}
                <p className="text-xs text-s112-muted mt-2">Rechnungsadresse: {[info.strasse, info.plzOrt].filter(Boolean).join(', ')}</p>
              </>
            ) : (
              <>
                {posten.zh_kontakt && (
                  <p className="text-sm text-s112-text-1">z.H. {kontaktAnzeigename(posten.zh_kontakt as R)}</p>
                )}
                {info.strasse && <p className="text-sm">{info.strasse}</p>}
                {info.plzOrt  && <p className="text-sm">{info.plzOrt}</p>}
              </>
            )}
          </div>
        )}
      </div>

      {/* Kopfkarte (Screen) */}
      <div className="card p-5 no-print">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="text-xl font-semibold text-s112-text">
              {posten.rechnungsnummer
                ? <>Beleg <span className="font-mono">{posten.rechnungsnummer}</span></>
                : 'Verkauf'}
            </h1>
            <p className="text-sm text-s112-muted mt-0.5">
              {new Date(posten.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              {posten.lieferscheinnummer && <> · Lieferschein <span className="font-mono">{posten.lieferscheinnummer}</span></>}
            </p>
          </div>
          {hasTank && (
            <span className="bg-s112-blue-100 text-s112-blue-700 text-xs px-2 py-1 rounded-full font-medium">
              Enthält Tankverkauf
            </span>
          )}
        </div>
        {kundenName(posten) !== '–' && (
          <div className="mt-3 pt-3 border-t border-s112-border text-sm">
            <span className="text-s112-muted">Kunde:</span>{' '}
            <span className="font-medium text-s112-text">{kundenName(posten)}</span>
            {info.email   && <span className="text-s112-muted ml-3 inline-flex items-center gap-1"><Mail size={13} /> {info.email}</span>}
            {info.telefon && <span className="text-s112-muted ml-3 inline-flex items-center gap-1"><Phone size={13} /> {info.telefon}</span>}
            {liefer?.strasse && <div className="mt-1"><span className="text-s112-muted">Lieferadresse:</span> {lieferadresseKurz(liefer)}{liefer.empfaenger ? ` (z. H. ${liefer.empfaenger})` : ''}</div>}
          </div>
        )}
        {posten.notizen && (
          <p className="text-sm text-s112-muted mt-2 italic">{posten.notizen}</p>
        )}
      </div>

      {/* Positionen-Tabelle – Lieferschein vs Rechnung */}
      <div className="card p-0 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="bg-s112-bg border-b border-s112-border">
              <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Bezeichnung</th>
              <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Menge</th>
              <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Einheit</th>
              {isRechnung && <>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Preis/Einh.</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Rabatt</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Summe</th>
              </>}
            </tr>
          </thead>
          <tbody>
            {positionen.map((pos: R, i: number) => {
              const brutto   = pos.preis_brutto != null ? Number(pos.preis_brutto) * Number(pos.menge) : null
              const rabatt   = (Number(pos.rabatt_pct ?? 0) + Number(pos.sonderrabatt_pct ?? 0))
              const summe    = brutto != null
                ? brutto * (1 - Number(pos.rabatt_pct ?? 0) / 100) * (1 - Number(pos.sonderrabatt_pct ?? 0) / 100)
                : null
              const sub: string[] = []
              if (pos.fuellung?.jahrgang) sub.push(String(pos.fuellung.jahrgang))
              if (pos.fuellung?.flaschengroesse_ml) {
                sub.push(FLASCHEN_LABEL[pos.fuellung.flaschengroesse_ml] ?? `${pos.fuellung.flaschengroesse_ml} ml`)
              }
              if (pos.typ === 'tank') sub.push('Tankverkauf')
              // KAN-92: Prüfnummer, Los und Abfülldatum je Flaschenposition (Lieferschein und Rechnung)
              const los = losText(pos.fuellung)
              if (los) sub.push(los)
              return (
                <tr key={pos.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-s112-text">{pos.name}</div>
                    {sub.length > 0 && (
                      <div className="text-xs text-s112-muted mt-0.5">{sub.join(' · ')}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtNum(Number(pos.menge))}</td>
                  <td className="px-4 py-3 text-s112-muted">{pos.einheit}</td>
                  {isRechnung && <>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {pos.preis_brutto != null
                        ? fmtEur(Number(pos.preis_brutto))
                        : <span className="text-s112-muted">–</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-s112-muted">
                      {rabatt > 0 ? `${rabatt}%` : '–'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-s112-blue-700 tabular-nums">
                      {summe != null
                        ? fmtEur(summe)
                        : <span className="text-s112-muted font-normal">–</span>}
                    </td>
                  </>}
                </tr>
              )
            })}
          </tbody>
          {isRechnung && (
            <tfoot>
              <tr className="border-t-2 border-s112-border bg-s112-bg">
                <td colSpan={5} className="px-4 py-3 text-right font-semibold text-s112-text-1">Gesamt brutto</td>
                <td className="px-4 py-3 text-right font-semibold text-lg text-s112-blue-700 tabular-nums">
                  {fmtEur(gesamt)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* MwSt-Hinweis / Rechnung USt-Aufschlüsselung */}
        {isRechnung && (
          <div className="px-4 py-3 text-xs text-right border-t border-s112-border space-y-0.5 print-only">
            <p className="text-s112-text-2">Nettobetrag: {fmtEur(gesamtNetto)}</p>
            {Object.entries(ustGruppen).map(([satz, netto]) => (
              <p key={satz} className="text-s112-text-2">
                MwSt {satz}%: {fmtEur(((netto as number) * Number(satz) / 100))}
              </p>
            ))}
            <p className="font-semibold text-s112-text-1">Rechnungsbetrag: {fmtEur(gesamt)}</p>
          </div>
        )}
      </div>

      {/* ── RECHNUNG-FOOTER: Bankdaten + Fußtext (nur Druck, Rechnungsmodus) ── */}
      {isRechnung && (
        <div className="print-only mt-8 pt-6 print:mt-4 print:pt-3 break-inside-avoid border-t border-s112-line text-sm space-y-3">
          {skontoAktiv && skontoDatum && (
            <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-sm px-3 py-2">
              <p className="font-semibold text-s112-warn-fg flex items-center gap-1.5">
                <Info size={14} /> {posten.skonto_pct}% Skonto bei Zahlung bis {skontoDatum.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
              </p>
              <p className="text-s112-warn-fg text-xs mt-0.5">
                Bei fristgerechter Zahlung: {fmtEur((gesamt - skontoBetrag))}
                {' '}(−{fmtEur(skontoBetrag)} Skonto)
              </p>
            </div>
          )}
          {(iban || bic) && (
            <div>
              <p className="font-semibold text-s112-text-1 mb-1">Bankverbindung</p>
              {iban && <p className="text-s112-text-2">IBAN: {iban}</p>}
              {bic  && <p className="text-s112-text-2">BIC: {bic}</p>}
              <p className="text-s112-text-2 mt-0.5">
                {zahlZiel === 0
                  ? 'Zahlungsziel: bei Erhalt'
                  : `Zahlungsziel: ${zahlZiel} Tage (${faelligkeitsDatum.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })})`}
              </p>
            </div>
          )}
          {fusstext && (
            <p className="text-xs text-s112-tertiary pt-2 border-t border-s112-line">{fusstext}</p>
          )}
          {bName && (
            <p className="text-xs text-s112-tertiary">{bName}{bUID ? ` · UID: ${bUID}` : ''}</p>
          )}
        </div>
      )}

      {/* ── ZAHLUNGSEINGANG ──────────────────────────────────────────────────── */}
      {!posten.storniert && (
        <div className="card p-5 no-print space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-s112-text-1 flex items-center gap-1.5"><CreditCard size={16} /> Zahlungseingang</h2>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              vollBezahlt ? 'bg-s112-ok-bg text-s112-ok-fg' :
              teilBezahlt ? 'bg-s112-warn-bg text-s112-warn-fg' :
              'bg-s112-err-bg text-s112-err-fg'
            }`}>
              {vollBezahlt ? 'Bezahlt' : teilBezahlt ? `Teilweise (${fmtEur(bezahltSumme)} von ${fmtEur(gesamt)})` : 'Offen'}
            </span>
          </div>

          {/* Bestehende Zahlungen */}
          {zahlungen.length > 0 && (
            <div className="rounded-lg border border-s112-border overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="bg-s112-bg border-b border-s112-border">
                    <th className="text-left px-3 py-2 font-medium text-s112-text-2">Datum</th>
                    <th className="text-left px-3 py-2 font-medium text-s112-text-2">Art</th>
                    <th className="text-right px-3 py-2 font-medium text-s112-text-2">Betrag</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {zahlungen.map((z: R) => (
                    <tr key={z.id} className={`border-b border-s112-border last:border-0 ${z.storniert_am ? 'text-s112-muted' : ''}`}>
                      <td className="px-3 py-2 text-s112-text-1">{new Date(z.datum).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}</td>
                      <td className="px-3 py-2">
                        {ART_LABELS[z.art] ?? z.art}
                        {/* KAN-149 D2b: stornierte Zahlung mit Datum, Benutzer und Grund */}
                        {z.storniert_am && (
                          <span className="block text-[11px] text-s112-err-fg">
                            storniert am {new Date(z.storniert_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
                            {z.storniert_von_name ? ` von ${z.storniert_von_name}` : ''}{z.storno_grund ? ` – ${z.storno_grund}` : ''}
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2 text-right font-semibold tabular-nums ${z.storniert_am ? 'line-through' : 'text-s112-blue-700'}`}>
                        {fmtEur(Number(z.betrag))}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {writeOk && !z.storniert_am && (
                          <StornoButton action={stornoZahlung.bind(null, z.id, id)} label="Zahlung stornieren"
                            hinweis="Die Zahlung bleibt gekennzeichnet stehen und zählt nicht mehr; ihre E&A-Einnahme wird gegengebucht."
                            datumFeld={{ label: 'Erstattet am (optional)', hilfe: 'Leer: Gegenbuchung am Tag der Einnahme (offener Zeitraum), sonst heute.' }} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-s112-border bg-s112-bg/60">
                    <td colSpan={2} className="px-3 py-2 text-sm font-semibold text-s112-text-1">Summe eingegangen</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-s112-ok-fg">
                      {fmtEur(bezahltSumme)}
                    </td>
                    <td />
                  </tr>
                  {!vollBezahlt && (
                    <tr className="border-t border-s112-border">
                      <td colSpan={2} className="px-3 py-2 text-sm text-s112-text-2">Noch offen</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-s112-err-fg">
                        {fmtEur(offenerBetrag)}
                      </td>
                      <td />
                    </tr>
                  )}
                </tfoot>
              </table>

            </div>
          )}

          {/* Skonto-Hinweis */}
          {posten.skonto_aktiv && (posten.skonto_pct ?? 0) > 0 && !vollBezahlt && (
            <div className="text-xs text-s112-warn-fg bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>Skonto {posten.skonto_pct}% bei Zahlung bis{' '}
              {new Date(new Date(rechnungsDatum).setDate(
                new Date(rechnungsDatum).getDate() + (posten.skonto_tage ?? 0)
              )).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}
              {' '}(−{fmtEur(((gesamt * (posten.skonto_pct ?? 0)) / 100))})
              </span>
            </div>
          )}

          {/* Zahlung erfassen */}
          {writeOk && !vollBezahlt && (
            // KAN-355: Client-Formular – Ablehnungen (z. B. Monat abgeschlossen) als Meldung statt Fehlerseite
            <ZahlungErfassen verkaufspostenId={id} />
          )}
        </div>
      )}
    </div>
  )
}
