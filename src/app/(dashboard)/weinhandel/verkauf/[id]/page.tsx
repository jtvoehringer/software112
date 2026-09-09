import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite, getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { deactivateVerkauf, stornoVerkauf, createZahlung, deleteZahlung } from '../actions'
import PrintButton from '@/app/(dashboard)/kellerbuch/kellerplan/[id]/PrintButton'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import RechnungVersandPanel from './RechnungVersandPanel'
import { Trash2, Undo2, Mail, Phone, Info, CreditCard, FileText } from 'lucide-react'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('verkaufsposten') as any)
    .select('rechnungsnummer, datum')
    .eq('id', id)
    .eq('tenant_id', membership?.tenantId ?? '')
    .single()
  const d = data as R | null
  const label = d?.rechnungsnummer
    ? `Beleg ${d.rechnungsnummer}`
    : d?.datum ? `Verkauf ${new Date(d.datum).toLocaleDateString('de-AT')}` : 'Verkauf'
  return { title: `${label} – software:112` }
}

// ── Tenant-Einstellungen (Briefkopf + Rechnung) ──────────────────────────────
async function getTenantSettings(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>, tenantId: string | null) {
  try {
    const { data } = await (supabase.from('tenant_einstellungen') as any)
      .select(`anzeigename, logo_url,
               betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort,
               betrieb_telefon, betrieb_email, betrieb_website, betrieb_uid,
               rechnung_iban, rechnung_bic, rechnung_zahlungsziel, rechnung_fusstext`)
      .eq('tenant_id', tenantId ?? '')
      .limit(1)
      .single()
    return (data as R | null) ?? {}
  } catch {
    return {}
  }
}

export default async function VerkaufDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ mode?: string }> }) {
  const { id }   = await params
  const { mode } = await searchParams
  const isRechnung = mode !== 'lieferschein'
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? null

  const [{ data: postenRaw }, settings, { data: zahlungenRaw }] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, notizen, erstellt_am, storniert, storniert_am,
        bezahlt, bezahlt_am, skonto_pct, skonto_tage, skonto_aktiv,
        rechnung_versendet_am, rechnung_versendet_an,
        kontakt:kontakte!kontakt_id(id, vorname, nachname, email, telefon, strasse, plz, ort, zahlungsziel_tage),
        firma:firmen(id, name, email, telefon, strasse, plz, ort, zahlungsziel_tage),
        zh_kontakt:kontakte!zh_kontakt_id(vorname, nachname),
        positionen:verkauf_positionen(
          id, typ, name, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz,
          fuellung:fuellungen(id, name, jahrgang, flaschengroesse_ml),
          weinausbau:weinausbau(id, name)
        )
      `)
      .eq('id', id)
      .eq('tenant_id', tenantId ?? '')
      .eq('aktiv', true)
      .single(),
    getTenantSettings(supabase, tenantId),
    (supabase.from('zahlungen') as any)
      .select('id, betrag, art, datum, notizen, erstellt_am')
      .eq('verkaufsposten_id', id)
      .eq('tenant_id', tenantId ?? '')
      .order('datum', { ascending: true }),
  ])

  if (!postenRaw) notFound()

  const posten    = postenRaw as R
  const positionen = (posten.positionen ?? []) as R[]
  const hasTank   = positionen.some((p: R) => p.typ === 'tank')
  const tankPos   = positionen.filter((p: R) => p.typ === 'tank')
  // Most-, Wein- und Traubenverkauf benötigen alle eine Transportbescheinigung
  // gem. Weingesetz - nicht nur der Tankverkauf.
  const brauchtTransportschein = positionen.some((p: R) => ['tank', 'flasche', 'trauben'].includes(p.typ))

  const gesamt = positionen.reduce((s: number, p: R) => {
    if (p.preis_brutto == null) return s
    const brutto  = Number(p.preis_brutto) * Number(p.menge)
    const rabatt  = (Number(p.rabatt_pct ?? 0)) / 100
    const sonder  = (Number(p.sonderrabatt_pct ?? 0)) / 100
    return s + brutto * (1 - rabatt) * (1 - sonder)
  }, 0)

  function kundenName(p: R): string {
    if (p.kontakt) {
      const k = p.kontakt as R
      return [k.vorname, k.nachname].filter(Boolean).join(' ')
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

  const deactivateWithId = deactivateVerkauf.bind(null, id)
  const stornoWithId     = stornoVerkauf.bind(null, id)
  const info = kundenInfo(posten)

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
  const gesamtUst   = gesamt - gesamtNetto

  const faelligkeitsDatum = new Date(posten.datum)
  faelligkeitsDatum.setDate(faelligkeitsDatum.getDate() + zahlZiel)

  // Skonto (Frühzahler-Rabatt) — für Anzeige auf der Rechnung
  const skontoAktiv  = !!posten.skonto_aktiv && (posten.skonto_pct ?? 0) > 0
  const skontoDatum  = skontoAktiv
    ? new Date(new Date(posten.datum).setDate(new Date(posten.datum).getDate() + (posten.skonto_tage ?? 0)))
    : null
  const skontoBetrag = skontoAktiv ? (gesamt * (posten.skonto_pct ?? 0)) / 100 : 0

  const zahlungen      = (zahlungenRaw ?? []) as R[]
  const bezahltSumme   = zahlungen.reduce((s: number, z: R) => s + Number(z.betrag ?? 0), 0)
  const offenerBetrag  = gesamt - bezahltSumme
  const vollBezahlt    = offenerBetrag <= 0.01
  const teilBezahlt    = bezahltSumme > 0.01 && !vollBezahlt

  const ART_LABELS: Record<string, string> = {
    bar: 'Bar', karte: 'Karte', bank: 'Bank',
    gutschrift: 'Gutschrift', sonstig: 'Sonstiges',
  }

  const createZahlungBound  = createZahlung.bind(null, id)

  return (
    <div className="space-y-6 max-w-3xl">
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
      <div className="flex items-center justify-between no-print">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700">Verkauf</Link>
          <span>/</span>
          <span className="text-s112-text font-medium">
            {posten.rechnungsnummer ?? new Date(posten.datum).toLocaleDateString('de-AT')}
          </span>
        </nav>
        <div className="flex items-center gap-3">
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
              <FileText size={14} /> Transportschein
            </Link>
          )}
          <PrintButton />
          {writeOk && !posten.storniert && (
            <ConfirmDeleteForm
              action={stornoWithId}
              message="Verkauf stornieren? Der Lagerbestand wird zurückgebucht."
              label={<Undo2 size={16} />}
              title="Stornieren"
              className="text-s112-warn hover:text-s112-warn-fg"
            />
          )}
          {writeOk && (
            <ConfirmDeleteForm
              action={deactivateWithId}
              message="Verkauf wirklich löschen (ohne Bestandskorrektur)?"
              label={<Trash2 size={16} />}
              title="Löschen"
              className="text-s112-err hover:text-s112-err-fg"
            />
          )}
          <div className="flex items-center border border-s112-border rounded-lg overflow-hidden text-xs">
            <a href={`/weinhandel/verkauf/${id}?mode=lieferschein`}
              className={`px-2.5 py-1.5 font-medium transition-colors ${!isRechnung ? 'bg-s112-teal text-white' : 'bg-white text-s112-text-2 hover:bg-s112-bg'}`}>
              Lieferschein
            </a>
            <a href={`/weinhandel/verkauf/${id}`}
              className={`px-2.5 py-1.5 font-medium transition-colors ${isRechnung ? 'bg-s112-teal text-white' : 'bg-white text-s112-text-2 hover:bg-s112-bg'}`}>
              Rechnung
            </a>
          </div>
        </div>
      </div>

      {/* Rechnungsversand per E-Mail */}
      {!posten.storniert && (
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
              Versendet am {new Date(posten.rechnung_versendet_am).toLocaleDateString('de-AT')}
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
            <div className="flex justify-between items-start mb-8">
              <div>
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="h-14 mb-3 object-contain" />
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
                  Datum: {new Date(posten.datum).toLocaleDateString('de-AT')}
                </p>
                <p className="text-s112-text-2">
                  {zahlZiel === 0 ? 'Zahlbar bei Erhalt' : `Zahlbar bis: ${faelligkeitsDatum.toLocaleDateString('de-AT')}`}
                </p>
              </div>
            </div>
            {/* Empfänger */}
            <div className="mb-8 p-4 border border-s112-line rounded inline-block min-w-[220px]">
              <p className="font-semibold text-base">{kundenName(posten)}</p>
              {posten.zh_kontakt && (
                <p className="text-s112-text-1">z.H. {[(posten.zh_kontakt as R).vorname, (posten.zh_kontakt as R).nachname].filter(Boolean).join(' ')}</p>
              )}
              {info.strasse && <p className="text-s112-text-2">{info.strasse}</p>}
              {info.plzOrt  && <p className="text-s112-text-2">{info.plzOrt}</p>}
            </div>
          </div>
        ) : (
          /* ── LIEFERSCHEIN ─────────────────────────────────────────────────── */
          <div className="flex justify-between items-start mb-6">
            <div>
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="Logo" className="h-12 mb-2 object-contain" />
              )}
              <p className="font-semibold text-lg">{bName}</p>
              {bStrasse && <p className="text-sm">{bStrasse}</p>}
              {bPlzOrt  && <p className="text-sm">{bPlzOrt}</p>}
              {bTel     && <p className="text-sm">Tel: {bTel}</p>}
              {bEmail   && <p className="text-sm">{bEmail}</p>}
            </div>
            <div className="text-right">
              <p className="text-2xl font-semibold">Lieferschein</p>
              {posten.rechnungsnummer && <p className="text-sm">Nr. {posten.rechnungsnummer}</p>}
              <p className="text-sm">{new Date(posten.datum).toLocaleDateString('de-AT')}</p>
            </div>
          </div>
        )}
        {/* Empfänger (Lieferschein-Modus) */}
        {!isRechnung && (
          <div className="mb-8">
            <p className="font-semibold">{kundenName(posten)}</p>
            {posten.zh_kontakt && (
              <p className="text-sm text-s112-text-1">z.H. {[(posten.zh_kontakt as R).vorname, (posten.zh_kontakt as R).nachname].filter(Boolean).join(' ')}</p>
            )}
            {info.strasse && <p className="text-sm">{info.strasse}</p>}
            {info.plzOrt  && <p className="text-sm">{info.plzOrt}</p>}
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
              {new Date(posten.datum).toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
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
          </div>
        )}
        {posten.notizen && (
          <p className="text-sm text-s112-muted mt-2 italic">{posten.notizen}</p>
        )}
      </div>

      {/* Positionen-Tabelle – Lieferschein vs Rechnung */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
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
              return (
                <tr key={pos.id} className={`border-b border-s112-border last:border-0 ${i % 2 === 1 ? 'bg-s112-bg/30' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-s112-text">{pos.name}</div>
                    {sub.length > 0 && (
                      <div className="text-xs text-s112-muted mt-0.5">{sub.join(' · ')}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{Number(pos.menge).toLocaleString('de-AT')}</td>
                  <td className="px-4 py-3 text-s112-muted">{pos.einheit}</td>
                  {isRechnung && <>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {pos.preis_brutto != null
                        ? Number(pos.preis_brutto).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
                        : <span className="text-s112-muted">–</span>}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-s112-muted">
                      {rabatt > 0 ? `${rabatt}%` : '–'}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-s112-blue-700 tabular-nums">
                      {summe != null
                        ? summe.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })
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
                  {gesamt.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* MwSt-Hinweis / Rechnung USt-Aufschlüsselung */}
        {isRechnung && (
          <div className="px-4 py-3 text-xs text-right border-t border-s112-border space-y-0.5 print-only">
            <p className="text-s112-text-2">Nettobetrag: {gesamtNetto.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}</p>
            {Object.entries(ustGruppen).map(([satz, netto]) => (
              <p key={satz} className="text-s112-text-2">
                MwSt {satz}%: {((netto as number) * Number(satz) / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
              </p>
            ))}
            <p className="font-semibold text-s112-text-1">Rechnungsbetrag: {gesamt.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}</p>
          </div>
        )}
      </div>

      {/* ── RECHNUNG-FOOTER: Bankdaten + Fußtext (nur Druck, Rechnungsmodus) ── */}
      {isRechnung && (
        <div className="print-only mt-8 pt-6 border-t border-s112-line text-sm space-y-3">
          {skontoAktiv && skontoDatum && (
            <div className="bg-s112-warn-bg border border-s112-warn/30 rounded px-3 py-2">
              <p className="font-semibold text-s112-warn-fg flex items-center gap-1.5">
                <Info size={14} /> {posten.skonto_pct}% Skonto bei Zahlung bis {skontoDatum.toLocaleDateString('de-AT')}
              </p>
              <p className="text-s112-warn-fg text-xs mt-0.5">
                Bei fristgerechter Zahlung: {(gesamt - skontoBetrag).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                {' '}(−{skontoBetrag.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })} Skonto)
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
                  : `Zahlungsziel: ${zahlZiel} Tage (${faelligkeitsDatum.toLocaleDateString('de-AT')})`}
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
              {vollBezahlt ? 'Bezahlt' : teilBezahlt ? `Teilweise (${bezahltSumme.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })} von ${gesamt.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })})` : 'Offen'}
            </span>
          </div>

          {/* Bestehende Zahlungen */}
          {zahlungen.length > 0 && (
            <div className="rounded-lg border border-s112-border overflow-hidden">
              <table className="w-full text-sm">
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
                    <tr key={z.id} className="border-b border-s112-border last:border-0">
                      <td className="px-3 py-2 text-s112-text-1">{new Date(z.datum).toLocaleDateString('de-AT')}</td>
                      <td className="px-3 py-2">{ART_LABELS[z.art] ?? z.art}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-s112-blue-700">
                        {Number(z.betrag).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {writeOk && (
                          <form action={deleteZahlung.bind(null, z.id, id)}>
                            <button type="submit" title="Löschen" aria-label="Löschen" className="text-s112-err hover:text-s112-err-fg inline-flex">
                              <Trash2 size={14} />
                            </button>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-s112-border bg-s112-bg/60">
                    <td colSpan={2} className="px-3 py-2 text-sm font-semibold text-s112-text-1">Summe eingegangen</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums text-s112-ok-fg">
                      {bezahltSumme.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                    </td>
                    <td />
                  </tr>
                  {!vollBezahlt && (
                    <tr className="border-t border-s112-border">
                      <td colSpan={2} className="px-3 py-2 text-sm text-s112-text-2">Noch offen</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-s112-err-fg">
                        {offenerBetrag.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
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
              <Info size={13} className="mt-0.5 flex-shrink-0" />
              <span>Skonto {posten.skonto_pct}% bei Zahlung bis{' '}
              {new Date(new Date(posten.datum).setDate(
                new Date(posten.datum).getDate() + (posten.skonto_tage ?? 0)
              )).toLocaleDateString('de-AT')}
              {' '}(−{((gesamt * (posten.skonto_pct ?? 0)) / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })})
              </span>
            </div>
          )}

          {/* Zahlung erfassen */}
          {writeOk && !vollBezahlt && (
            <form action={createZahlungBound} className="border border-s112-border rounded-lg p-3 space-y-3">
              <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider">Zahlung erfassen</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Datum</label>
                  <input name="datum" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="form-input text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Art</label>
                  <select name="art" className="form-input text-sm w-full">
                    <option value="bar">Bar</option>
                    <option value="karte">Karte</option>
                    <option value="bank">Bank</option>
                    <option value="gutschrift">Gutschrift</option>
                    <option value="sonstig">Sonstiges</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Betrag (€)</label>
                  <input name="betrag" type="text" inputMode="decimal" required placeholder="0,00" className="form-input text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Notiz</label>
                  <input name="notizen" type="text" placeholder="Optional…" className="form-input text-sm w-full" />
                </div>
              </div>
              <div className="flex justify-end">
                <button type="submit" className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-opacity-90 transition-colors">
                  Zahlung buchen
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  )
}
