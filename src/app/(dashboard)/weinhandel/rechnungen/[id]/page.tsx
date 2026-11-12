import { createSupabaseServerClient } from '@/lib/supabase/server'
import { geladen } from '@/lib/supabase/geladen'
import { momentaufnahmeAnwenden } from '@/lib/stammdaten/momentaufnahme'
import { getCurrentMembership } from '@/lib/auth/roles'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import PrintButton from '@/app/(dashboard)/kellerbuch/kellerplan/[id]/PrintButton'
import { fmtEur, fmtNum } from '@/lib/format'
import { kontaktAnzeigename } from '@/lib/crm/titel'
import { losText } from '@/lib/handel/losnummer'
import { alsBeleg, istStornobeleg, lieferscheineSelect, STORNO_FELDER } from '@/lib/verkauf/rechnungen'
import { rechnungSummen } from '@/lib/verkauf/rechnungDruck'
import { rechnungstexteFuerBeleg } from '@/lib/verkauf/rechnungstext'
import { canWrite } from '@/lib/auth/roles'
import RechnungVersandPanel from '../../verkauf/[id]/RechnungVersandPanel'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Rechnung' }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

// KAN-104 (08.10.2026): Rechnung (auch Sammelrechnung über mehrere Lieferscheine) – Positionen gruppiert je Lieferschein mit
// Nummer und Lieferdatum (Liefertag als Rechnungsmerkmal, § 11 UStG). Druck = Bildschirm ohne Knöpfe.
// KAN-379: Stornobeleg (art = 'storno') als „Stornorechnung zu Rechnung … vom …“ mit den Positionen des Originals in
// negativen Beträgen, ohne Zahlungsteil; das Original verweist auf seinen Stornobeleg.
export default async function RechnungPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  const tenantId = membership?.tenantId ?? ''

  const [rohRes, einstRes] = await Promise.all([
    // storno-sichtbar: Detailseite zeigt auch stornierte Rechnungen mit Vermerk
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('rechnungen') as any)
      .select(`id, rechnungsnummer, datum, leistung_von, leistung_bis, storniert, storniert_am, storno_grund, bezahlt, bezahlt_am,
        rechnung_versendet_am, rechnung_versendet_an,
        skonto_pct, skonto_tage, skonto_aktiv, partner_daten, notizen, storno_positionen, ${STORNO_FELDER},
        kontakt:kontakte!kontakt_id(id, titel, vorname, nachname, titel_nachgestellt, email, strasse, plz, ort, zahlungsziel_tage),
        firma:firmen!firma_id(id, name, email, strasse, plz, ort, zahlungsziel_tage),
        zh_kontakt:kontakte!zh_kontakt_id(titel, vorname, nachname, titel_nachgestellt),
        ${lieferscheineSelect('id, typ, name, menge, einheit, preis_brutto, rabatt_pct, sonderrabatt_pct, ust_satz, fuellung:fuellungen(jahrgang, flaschengroesse_ml, pruefnummer, chargennummer, datum)', 'id, lieferscheinnummer, datum, rechnungstext')}`)
      .eq('id', id).eq('tenant_id', tenantId).maybeSingle(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('tenant_einstellungen') as any)
      .select(`anzeigename, logo_url, betrieb_name, betrieb_strasse, betrieb_plz, betrieb_ort, betrieb_telefon, betrieb_email,
               betrieb_website, betrieb_uid, rechnung_iban, rechnung_bic, rechnung_fusstext`)
      .eq('tenant_id', tenantId).limit(1).maybeSingle(),
  ])
  const roh = geladen(rohRes, 'Rechnungen')
  const einst = geladen(einstRes, 'Einstellungen')
  if (!roh) notFound()
  const r = alsBeleg(momentaufnahmeAnwenden(roh as R, ['kontakt', 'firma', 'zh_kontakt']))
  const s = (einst ?? {}) as R

  const storno = istStornobeleg(r)
  const original = (r.storno_von ?? null) as R | null
  const stornoDurch = (r.storniert_durch ?? null) as R | null
  // Gruppen je Lieferschein (stornierte Rechnung: aus der Momentaufnahme; Stornobeleg: deren Positionen, negativ)
  const momentPositionen = (storno ? r.verkauf_positionen : (r.storno_positionen ?? [])) as R[]
  const gruppen: { nummer: string | null; datum: string | null; id: string | null; positionen: R[] }[] = r.lieferscheine.length
    ? r.lieferscheine.map(l => ({ nummer: l.lieferscheinnummer ?? null, datum: l.datum ?? null, id: String(l.id), positionen: (l.verkauf_positionen ?? []) as R[] }))
    : [...new Map(momentPositionen.map(p => [String(p.lieferscheinnummer ?? ''), { nummer: p.lieferscheinnummer ?? null,
        datum: p.lieferdatum ?? null, id: p.lieferschein_id ?? null, positionen: momentPositionen.filter(q => q.lieferscheinnummer === p.lieferscheinnummer) }])).values()]
  const summen = rechnungSummen(r.verkauf_positionen)

  const kunde = r.firma ? String((r.firma as R).name) : r.kontakt ? kontaktAnzeigename(r.kontakt as R) : '–'
  const anschrift = (r.kontakt ?? r.firma ?? {}) as R
  const zahlZiel = Number((r.kontakt as R | null)?.zahlungsziel_tage ?? (r.firma as R | null)?.zahlungsziel_tage ?? 14)
  const faellig = new Date(`${r.datum}T00:00:00`); faellig.setDate(faellig.getDate() + zahlZiel)
  const d = (x: string | null) => (x ? new Date(`${String(x).slice(0, 10)}T00:00:00`).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' }) : '–')
  const leistung = r.leistung_von && r.leistung_bis && r.leistung_von !== r.leistung_bis ? `${d(r.leistung_von)} – ${d(r.leistung_bis)}` : d(r.leistung_von ?? r.datum)

  return (
    <div className="space-y-6 print:space-y-3 max-w-3xl">
      <style>{`@media print { .no-print { display: none !important; } aside, nav, header { display: none !important; } }`}</style>
      <div className="flex flex-wrap gap-2 items-center justify-between no-print">
        <nav className="flex items-center gap-2 text-sm text-s112-muted">
          <Link href="/weinhandel/verkauf" className="hover:text-s112-blue-700">Verkauf</Link>
          <span>/</span>
          <span className="text-s112-text font-medium">{storno ? 'Stornobeleg' : 'Rechnung'} {r.rechnungsnummer}</span>
        </nav>
        <div className="flex items-center gap-3">
          {r.storniert && <span className="text-xs font-semibold bg-s112-err-bg text-s112-err-fg px-2.5 py-1 rounded-full">STORNIERT</span>}
          {!r.storniert && !storno && (r.bezahlt
            ? <span className="text-xs font-semibold bg-s112-ok-bg text-s112-ok-fg px-2.5 py-1 rounded-full">bezahlt</span>
            : <Link href="/weinhandel/offene-posten" className="text-xs text-s112-blue-700 hover:underline">offen – Zahlung unter Offene Posten</Link>)}
          <PrintButton />
        </div>
      </div>
      {/* KAN-105: E-Mail-Versand (PDF mit allen Lieferscheinen) über einen Lieferschein der Rechnung */}
      {!r.storniert && membership && canWrite(membership, 'warenwirtschaft') && r.verkaufsposten_ids.length > 0 && (
        <div className="no-print">
          <RechnungVersandPanel verkaufId={r.verkaufsposten_ids[0]} defaultEmail={String((r.kontakt as R | null)?.email ?? (r.firma as R | null)?.email ?? '')}
            sentAt={r.rechnung_versendet_am ?? null} sentTo={r.rechnung_versendet_an ?? null} />
        </div>
      )}
      {/* KAN-379: Stornobeleg als PDF „Stornorechnung“ per E-Mail */}
      {storno && membership && canWrite(membership, 'warenwirtschaft') && (
        <div className="no-print">
          <RechnungVersandPanel pfad={`/api/weinhandel/rechnungen/${r.id}/send`} titel="Stornorechnung"
            defaultEmail={String((r.kontakt as R | null)?.email ?? (r.firma as R | null)?.email ?? '')}
            sentAt={r.rechnung_versendet_am ?? null} sentTo={r.rechnung_versendet_an ?? null} />
        </div>
      )}
      {r.storniert && (
        <p role="note" className="text-sm text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2 no-print">
          Storniert{r.storniert_am ? ` am ${new Date(r.storniert_am).toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}` : ''}{r.storno_grund ? ` – ${r.storno_grund}` : ''}
          {stornoDurch && <> · Stornobeleg <Link href={`/weinhandel/rechnungen/${stornoDurch.id}`} className="font-mono underline">{stornoDurch.rechnungsnummer}</Link> vom {d(stornoDurch.datum)}</>}
        </p>
      )}
      {storno && original && (
        <p role="note" className="text-sm text-s112-text-2 bg-s112-bg border border-s112-line rounded-lg px-3 py-2 no-print">
          Stornobeleg zu Rechnung <Link href={`/weinhandel/rechnungen/${original.id}`} className="font-mono underline">{original.rechnungsnummer}</Link> vom {d(original.datum)} – die Beträge buchen am {d(r.datum)} gegen.
        </p>
      )}

      <div className="card p-6 print:p-3 text-sm text-s112-text">
        {/* Briefkopf */}
        <div className="flex justify-between items-start mb-8 print:mb-4 gap-4">
          <div>
            {s.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.logo_url} alt="Logo" className="h-14 mb-3 print:h-10 print:mb-1 object-contain" />
            )}
            <p className="font-semibold text-base">{s.betrieb_name ?? s.anzeigename ?? 'Weingut'}</p>
            {s.betrieb_strasse && <p>{s.betrieb_strasse}</p>}
            {(s.betrieb_plz || s.betrieb_ort) && <p>{[s.betrieb_plz, s.betrieb_ort].filter(Boolean).join(' ')}</p>}
            {s.betrieb_telefon && <p>Tel: {s.betrieb_telefon}</p>}
            {s.betrieb_email && <p>{s.betrieb_email}</p>}
            {s.betrieb_uid && <p className="mt-1 text-s112-text-2">UID: {s.betrieb_uid}</p>}
          </div>
          <div className="text-right">
            <h1 className="text-3xl font-semibold">{storno ? 'STORNORECHNUNG' : 'RECHNUNG'}</h1>
            <p className="text-base font-semibold mt-1">Nr. {r.rechnungsnummer}</p>
            <p className="text-s112-text-2 mt-0.5">Datum: {d(r.datum)}</p>
            {storno && original && <p className="text-s112-text-2">zu Rechnung {original.rechnungsnummer} vom {d(original.datum)}</p>}
            <p className="text-s112-text-2">Lieferzeitraum: {leistung}</p>
            {!storno && <p className="text-s112-text-2">{zahlZiel === 0 ? 'Zahlbar bei Erhalt' : `Zahlbar bis: ${faellig.toLocaleDateString('de-AT', { timeZone: 'Europe/Vienna' })}`}</p>}
          </div>
        </div>
        {/* Empfänger */}
        <div className="mb-8 print:mb-4 p-4 print:p-3 border border-s112-line rounded-sm inline-block min-w-[220px]">
          <p className="font-semibold text-base">{kunde}</p>
          {r.zh_kontakt && <p className="text-s112-text-1">z.H. {kontaktAnzeigename(r.zh_kontakt as R)}</p>}
          {anschrift.strasse && <p className="text-s112-text-2">{anschrift.strasse}</p>}
          {(anschrift.plz || anschrift.ort) && <p className="text-s112-text-2">{[anschrift.plz, anschrift.ort].filter(Boolean).join(' ')}</p>}
        </div>

        {/* Positionen je Lieferschein */}
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-s112-border text-left">
              <th className="py-2 font-semibold">Bezeichnung</th>
              <th className="py-2 font-semibold text-right">Menge</th>
              <th className="py-2 font-semibold text-right">Preis/Einh.</th>
              <th className="py-2 font-semibold text-right">Rabatt</th>
              <th className="py-2 font-semibold text-right">Summe</th>
            </tr>
          </thead>
          {gruppen.map(g => (
            <tbody key={g.id ?? g.nummer ?? 'ls'}>
              <tr className="bg-s112-bg">
                <td colSpan={5} className="py-1.5 px-1 text-xs font-semibold text-s112-text-2">
                  Lieferschein {g.id ? <Link href={`/weinhandel/verkauf/${g.id}?mode=lieferschein`} className="font-mono hover:underline">{g.nummer ?? '–'}</Link> : <span className="font-mono">{g.nummer ?? '–'}</span>} vom {d(g.datum)}
                </td>
              </tr>
              {g.positionen.map((p, i) => {
                const brutto = p.preis_brutto != null ? Number(p.preis_brutto) * Number(p.menge) : null
                const summe = brutto != null ? brutto * (1 - Number(p.rabatt_pct ?? 0) / 100) * (1 - Number(p.sonderrabatt_pct ?? 0) / 100) : null
                const rabatt = Number(p.rabatt_pct ?? 0) + Number(p.sonderrabatt_pct ?? 0)
                const los = losText(p.fuellung)
                return (
                  <tr key={p.id ?? i} className="border-b border-s112-line">
                    <td className="py-2 pr-2">
                      <div className="font-medium">{p.name}</div>
                      {los && <div className="text-xs text-s112-muted">{los}</div>}
                    </td>
                    <td className="py-2 text-right tabular-nums">{fmtNum(Number(p.menge))} {p.einheit ?? ''}</td>
                    <td className="py-2 text-right tabular-nums">{p.preis_brutto != null ? fmtEur(Number(p.preis_brutto)) : '–'}</td>
                    <td className="py-2 text-right tabular-nums text-s112-muted">{rabatt > 0 ? `${rabatt}%` : '–'}</td>
                    <td className="py-2 text-right tabular-nums font-semibold">{summe != null ? fmtEur(summe) : '–'}</td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
        <div className="mt-3 text-xs text-right space-y-0.5">
          <p className="text-s112-text-2">Nettobetrag: {fmtEur(summen.netto)}</p>
          {summen.ust.map(u => <p key={u.satz} className="text-s112-text-2">MwSt {u.satz}%: {fmtEur(u.betrag)}</p>)}
          <p className="text-base font-semibold text-s112-text-1">{storno ? 'Stornobetrag' : 'Rechnungsbetrag'}: {fmtEur(summen.brutto)}</p>
        </div>
        {/* KAN-416 (UAT 12.11.2026): Texte auf Rechnung der Lieferscheine – bei mehreren mit „Lieferschein LS-…:“ davor */}
        {!storno && rechnungstexteFuerBeleg(r.lieferscheine as { lieferscheinnummer?: string | null; rechnungstext?: string | null }[]).map((t, i) => (
          <p key={i} className="mt-3 text-sm text-s112-text whitespace-pre-line break-inside-avoid">{t}</p>
        ))}
        {r.notizen && <p className="mt-4 text-sm text-s112-muted italic">{storno ? `Grund: ${r.notizen}` : r.notizen}</p>}

        {/* Zahlung (nicht beim Stornobeleg) */}
        {!storno && <div className="mt-8 pt-6 print:mt-4 print:pt-3 break-inside-avoid border-t border-s112-line space-y-2">
          {r.skonto_aktiv && Number(r.skonto_pct) > 0 && (
            <p className="text-s112-warn-fg">{r.skonto_pct}% Skonto bei Zahlung binnen {r.skonto_tage ?? 0} Tagen: {fmtEur(summen.brutto * (1 - Number(r.skonto_pct) / 100))}</p>
          )}
          {(s.rechnung_iban || s.rechnung_bic) && (
            <div>
              <p className="font-semibold text-s112-text-1">Bankverbindung</p>
              {s.rechnung_iban && <p className="text-s112-text-2">IBAN: {s.rechnung_iban}</p>}
              {s.rechnung_bic && <p className="text-s112-text-2">BIC: {s.rechnung_bic}</p>}
            </div>
          )}
          {s.rechnung_fusstext && <p className="text-xs text-s112-tertiary pt-2 border-t border-s112-line">{s.rechnung_fusstext}</p>}
        </div>}
      </div>
    </div>
  )
}
