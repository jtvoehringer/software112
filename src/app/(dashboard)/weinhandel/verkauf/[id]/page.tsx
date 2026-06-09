import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentUserRole, canWrite } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from 'next/link'
import { deactivateVerkauf, stornoVerkauf } from '../actions'
import PrintButton from '@/app/(dashboard)/kellerbuch/kellerplan/[id]/PrintButton'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('verkaufsposten') as any)
    .select('rechnungsnummer, datum')
    .eq('id', id)
    .single()
  const d = data as R | null
  const label = d?.rechnungsnummer
    ? `Beleg ${d.rechnungsnummer}`
    : d?.datum ? `Verkauf ${new Date(d.datum).toLocaleDateString('de-AT')}` : 'Verkauf'
  return { title: `${label} – software:112` }
}

// ── Tenant-Einstellungen (Briefkopf + Rechnung) ──────────────────────────────
async function getTenantSettings(supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>) {
  try {
    const { data } = await (supabase.from('tenant_einstellungen') as any)
      .select(`anzeigename, logo_url,
               betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort,
               betrieb_telefon, betrieb_email, betrieb_website, betrieb_uid,
               rechnung_iban, rechnung_bic, rechnung_zahlungsziel, rechnung_fusstext`)
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
  const isRechnung = mode === 'rechnung'
  const supabase = await createSupabaseServerClient()
  const role     = await getCurrentUserRole()
  const writeOk  = canWrite(role)

  const [{ data: postenRaw }, settings] = await Promise.all([
    (supabase.from('verkaufsposten') as any)
      .select(`
        id, datum, rechnungsnummer, notizen, erstellt_am, storniert, storniert_am,
        kontakt:kontakte!kontakt_id(id, vorname, nachname, email, telefon),
        firma:firmen(id, name, email, telefon),
        zh_kontakt:kontakte!zh_kontakt_id(vorname, nachname),
        positionen:verkauf_positionen(
          id, typ, name, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct,
          fuellung:fuellungen(id, name, jahrgang, flaschengroesse_ml),
          weinausbau:weinausbau(id, name)
        )
      `)
      .eq('id', id)
      .eq('aktiv', true)
      .single(),
    getTenantSettings(supabase),
  ])

  if (!postenRaw) notFound()

  const posten    = postenRaw as R
  const positionen = (posten.positionen ?? []) as R[]
  const hasTank   = positionen.some((p: R) => p.typ === 'tank')
  const tankPos   = positionen.filter((p: R) => p.typ === 'tank')

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

  function kundenInfo(p: R): { email?: string; telefon?: string } {
    if (p.kontakt) return { email: p.kontakt.email, telefon: p.kontakt.telefon }
    if (p.firma)   return { email: p.firma.email,   telefon: p.firma.telefon }
    return {}
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
  const zahlZiel = s.rechnung_zahlungsziel ?? 14
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
          <Link href="/weinhandel/verkauf" className="hover:text-s112-teal">Verkauf</Link>
          <span>/</span>
          <span className="text-gray-800 font-medium">
            {posten.rechnungsnummer ?? new Date(posten.datum).toLocaleDateString('de-AT')}
          </span>
        </nav>
        <div className="flex items-center gap-3">
          {posten.storniert && (
            <span className="text-xs font-semibold bg-red-100 text-red-700 px-2.5 py-1 rounded-full">
              STORNIERT
            </span>
          )}
          <PrintButton />
          {writeOk && !posten.storniert && (
            <ConfirmDeleteForm
              action={stornoWithId}
              message="Verkauf stornieren? Der Lagerbestand wird zurückgebucht."
              label="Stornieren"
              className="text-xs text-orange-500 hover:text-orange-700 hover:underline"
            />
          )}
          {writeOk && (
            <ConfirmDeleteForm
              action={deactivateWithId}
              message="Verkauf wirklich löschen (ohne Bestandskorrektur)?"
              label="Löschen"
              className="text-xs text-red-400 hover:text-red-600 hover:underline"
            />
          )}
          <div className="flex items-center border border-s112-border rounded-lg overflow-hidden text-xs">
            <a href={`/weinhandel/verkauf/${id}`}
              className={`px-2.5 py-1.5 font-medium transition-colors ${!isRechnung ? 'bg-s112-teal text-white' : 'bg-white text-gray-600 hover:bg-s112-bg'}`}>
              Lieferschein
            </a>
            <a href={`/weinhandel/verkauf/${id}?mode=rechnung`}
              className={`px-2.5 py-1.5 font-medium transition-colors ${isRechnung ? 'bg-s112-teal text-white' : 'bg-white text-gray-600 hover:bg-s112-bg'}`}>
              Rechnung
            </a>
          </div>
        </div>
      </div>

      {/* ── RECHNUNG / LIEFERSCHEIN ─────────────────────────────────────────── */}

      {/* ── DRUCK-LAYOUT: Rechnung ODER Lieferschein ──────────────────────── */}
      <div className="print-only px-0 pt-0">
        {isRechnung ? (
          /* ── RECHNUNG ─────────────────────────────────────────────────────── */
          <div className="font-sans text-sm text-gray-900">
            {/* Briefkopf */}
            <div className="flex justify-between items-start mb-8">
              <div>
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt="Logo" className="h-14 mb-3 object-contain" />
                )}
                <p className="font-bold text-base">{bName}</p>
                {bStrasse && <p>{bStrasse}</p>}
                {bPlzOrt  && <p>{bPlzOrt}</p>}
                {bTel     && <p>Tel: {bTel}</p>}
                {bEmail   && <p>{bEmail}</p>}
                {bWeb     && <p>{bWeb}</p>}
                {bUID     && <p className="mt-1 text-gray-500">UID: {bUID}</p>}
              </div>
              <div className="text-right">
                <p className="text-3xl font-bold text-gray-900">RECHNUNG</p>
                {posten.rechnungsnummer && (
                  <p className="text-base font-semibold mt-1">Nr. {posten.rechnungsnummer}</p>
                )}
                <p className="text-gray-600 mt-0.5">
                  Datum: {new Date(posten.datum).toLocaleDateString('de-AT')}
                </p>
                <p className="text-gray-600">
                  Zahlbar bis: {faelligkeitsDatum.toLocaleDateString('de-AT')}
                </p>
              </div>
            </div>
            {/* Empfänger */}
            <div className="mb-8 p-4 border border-gray-200 rounded inline-block min-w-[220px]">
              <p className="font-semibold text-base">{kundenName(posten)}</p>
              {posten.zh_kontakt && (
                <p className="text-gray-700">z.H. {[(posten.zh_kontakt as R).vorname, (posten.zh_kontakt as R).nachname].filter(Boolean).join(' ')}</p>
              )}
              {info.email   && <p className="text-gray-600">{info.email}</p>}
              {info.telefon && <p className="text-gray-600">{info.telefon}</p>}
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
              <p className="font-bold text-lg">{bName}</p>
              {bStrasse && <p className="text-sm">{bStrasse}</p>}
              {bPlzOrt  && <p className="text-sm">{bPlzOrt}</p>}
              {bTel     && <p className="text-sm">Tel: {bTel}</p>}
              {bEmail   && <p className="text-sm">{bEmail}</p>}
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold">Lieferschein</p>
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
              <p className="text-sm text-gray-700">z.H. {[(posten.zh_kontakt as R).vorname, (posten.zh_kontakt as R).nachname].filter(Boolean).join(' ')}</p>
            )}
            {info.email   && <p className="text-sm">{info.email}</p>}
            {info.telefon && <p className="text-sm">{info.telefon}</p>}
          </div>
        )}
      </div>

      {/* Kopfkarte (Screen) */}
      <div className="card p-5 no-print">
        <div className="flex items-start justify-between mb-1">
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {posten.rechnungsnummer
                ? <>Beleg <span className="font-mono">{posten.rechnungsnummer}</span></>
                : 'Verkauf'}
            </h1>
            <p className="text-sm text-s112-muted mt-0.5">
              {new Date(posten.datum).toLocaleDateString('de-AT', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </p>
          </div>
          {hasTank && (
            <span className="bg-blue-100 text-blue-700 text-xs px-2 py-1 rounded-full font-medium">
              Enthält Tankverkauf
            </span>
          )}
        </div>
        {kundenName(posten) !== '–' && (
          <div className="mt-3 pt-3 border-t border-s112-border text-sm">
            <span className="text-s112-muted">Kunde:</span>{' '}
            <span className="font-medium text-gray-800">{kundenName(posten)}</span>
            {info.email   && <span className="text-s112-muted ml-3">✉ {info.email}</span>}
            {info.telefon && <span className="text-s112-muted ml-3">📞 {info.telefon}</span>}
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
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Bezeichnung</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700">Menge</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700">Einheit</th>
              {isRechnung && <>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Preis/Einh.</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Rabatt</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-700">Summe</th>
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
                    <div className="font-medium text-gray-900">{pos.name}</div>
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
                    <td className="px-4 py-3 text-right font-semibold text-s112-teal tabular-nums">
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
                <td colSpan={5} className="px-4 py-3 text-right font-semibold text-gray-700">Gesamt brutto</td>
                <td className="px-4 py-3 text-right font-bold text-lg text-s112-teal tabular-nums">
                  {gesamt.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
                </td>
              </tr>
            </tfoot>
          )}
        </table>

        {/* MwSt-Hinweis / Rechnung USt-Aufschlüsselung */}
        {isRechnung && (
          <div className="px-4 py-3 text-xs text-right border-t border-s112-border space-y-0.5 print-only">
            <p className="text-gray-500">Nettobetrag: {gesamtNetto.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}</p>
            {Object.entries(ustGruppen).map(([satz, netto]) => (
              <p key={satz} className="text-gray-500">
                MwSt {satz}%: {((netto as number) * Number(satz) / 100).toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}
              </p>
            ))}
            <p className="font-semibold text-gray-700">Rechnungsbetrag: {gesamt.toLocaleString('de-AT', { style: 'currency', currency: 'EUR' })}</p>
          </div>
        )}
      </div>

      {/* ── RECHNUNG-FOOTER: Bankdaten + Fußtext (nur Druck, Rechnungsmodus) ── */}
      {isRechnung && (
        <div className="print-only mt-8 pt-6 border-t border-gray-200 text-sm space-y-3">
          {(iban || bic) && (
            <div>
              <p className="font-semibold text-gray-700 mb-1">Bankverbindung</p>
              {iban && <p className="text-gray-600">IBAN: {iban}</p>}
              {bic  && <p className="text-gray-600">BIC: {bic}</p>}
              <p className="text-gray-600 mt-0.5">Zahlungsziel: {zahlZiel} Tage ({faelligkeitsDatum.toLocaleDateString('de-AT')})</p>
            </div>
          )}
          {fusstext && (
            <p className="text-xs text-gray-400 pt-2 border-t border-gray-100">{fusstext}</p>
          )}
          {bName && (
            <p className="text-xs text-gray-400">{bName}{bUID ? ` · UID: ${bUID}` : ''}</p>
          )}
        </div>
      )}

      {/* ── TRANSPORTSCHEIN (nur bei Tank-Positionen) ─────────────────────── */}
      {hasTank && (
        <div className="card p-5 border-2 border-blue-200 space-y-4">
          {/* Print-Seitenumbruch */}
          <div className="print-page-break print-only" />

          {/* Screen-Header */}
          <div className="flex items-center justify-between no-print">
            <h2 className="font-semibold text-gray-700">
              🚛 Transportschein (Tankverkauf)
            </h2>
            <span className="text-xs text-s112-muted">Wird beim Drucken ausgegeben</span>
          </div>

          {/* Print-Header */}
          <div className="print-only">
            <div className="flex justify-between items-start mb-4">
              <div>
                <p className="font-bold text-lg">{bName}</p>
                {bStrasse && <p className="text-sm">{bStrasse}</p>}
                {bPlzOrt  && <p className="text-sm">{bPlzOrt}</p>}
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold">Transportschein</p>
                {posten.rechnungsnummer && <p className="text-sm">Beleg Nr. {posten.rechnungsnummer}</p>}
                <p className="text-sm">{new Date(posten.datum).toLocaleDateString('de-AT')}</p>
              </div>
            </div>
          </div>

          {/* Inhalt */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-s112-muted mb-0.5">Absender</p>
                <p className="font-medium">{bName}</p>
                {bStrasse && <p className="text-xs text-gray-600">{bStrasse}</p>}
                {bPlzOrt  && <p className="text-xs text-gray-600">{bPlzOrt}</p>}
              </div>
              <div>
                <p className="text-xs text-s112-muted mb-0.5">Empfänger</p>
                <p className="font-medium">{kundenName(posten)}</p>
                {info.email   && <p className="text-xs text-gray-600">{info.email}</p>}
                {info.telefon && <p className="text-xs text-gray-600">{info.telefon}</p>}
              </div>
            </div>

            {/* Transportierte Ware */}
            <table className="w-full text-sm border border-s112-border rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-blue-50 border-b border-s112-border">
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Produkt</th>
                  <th className="text-right px-3 py-2 font-semibold text-gray-700">Menge (L)</th>
                  <th className="text-left px-3 py-2 font-semibold text-gray-700">Behälter</th>
                </tr>
              </thead>
              <tbody>
                {tankPos.map((pos: R) => (
                  <tr key={pos.id} className="border-b border-s112-border last:border-0">
                    <td className="px-3 py-2 font-medium">{pos.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{Number(pos.menge).toLocaleString('de-AT')} L</td>
                    <td className="px-3 py-2 text-s112-muted text-xs">{pos.weinausbau?.name ?? '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Unterschriften */}
            <div className="grid grid-cols-2 gap-8 pt-4 mt-4 border-t border-dashed border-gray-300">
              <div>
                <div className="h-12 border-b border-gray-400" />
                <p className="text-xs text-gray-500 mt-1">Unterschrift Absender / Datum</p>
              </div>
              <div>
                <div className="h-12 border-b border-gray-400" />
                <p className="text-xs text-gray-500 mt-1">Unterschrift Empfänger / Datum</p>
              </div>
            </div>

            <p className="text-xs text-gray-400 pt-1">
              Begleitdokument gemäß Weingesetz. Der Empfänger bestätigt den einwandfreien Erhalt der oben angeführten Ware.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
