// behoerdenmeldung: bki-verkauf, bki-einkauf, bki-tbs
// druckknopf-ausnahme: Seite zeigt nur eine Vorschau (je Blatt höchstens 50 Zeilen) – die Meldung ist die CSV-Datei für den Import in die BKI-Weindatenbank
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership } from '@/lib/auth/roles'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { csvPfad } from '@/lib/behoerden/katalog'
import { istParameterFehler } from '@/lib/behoerden/typen'
import { betriebUndModuleLaden } from '@/lib/behoerden/zugriff'
import { ladeEinkaufImZeitraum, ladeTbsAufstellung, ladeVerkaufImZeitraum, zeitraumStufeAus } from '@/lib/behoerden/bki-verkauf-einkauf'
import { KAT_QUALITAETSSTUFE } from '@/lib/katalog/bki'
import { wienHeute } from '@/lib/csv'
import { fmtNum } from '@/lib/format'
import LagerTabs from '../_behoerden/LagerTabs'

// KAN-49: BKI-Blätter „Verkauf im Zeitraum“, „Einkauf im Zeitraum“ und „TBS-Aufstellung“ – dieselben Ladefunktionen
// liefern die CSV (/meldungen/bki-verkauf|bki-einkauf|bki-tbs/csv) und die Blätter des Gesamtexports (KAN-50).

export const metadata: Metadata = { title: 'Verkauf, Einkauf, TBS (BKI)' }
export const dynamic = 'force-dynamic'

const datumAT = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('.') : '')

function Kopf({ titel, anzahl, href, aria }: { titel: string; anzahl: number; href: string; aria: string }) {
  return (
    <div className="flex items-center justify-between gap-2 flex-wrap">
      <h2 className="text-base font-semibold text-s112-text">{titel} <span className="text-xs font-normal text-s112-muted">({anzahl} Zeilen)</span></h2>
      <CsvExportKnopf href={href} ariaLabel={aria} />
    </div>
  )
}

export default async function BkiVerkehrPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) notFound()
  const tenantId = membership.tenantId
  const supabase = await createSupabaseServerClient()

  const heute = wienHeute()
  const roh = new URLSearchParams({ von: sp.von ?? `${heute.slice(0, 4)}-01-01`, bis: sp.bis ?? heute, ...(sp.stufe ? { stufe: sp.stufe } : {}) })
  const p = zeitraumStufeAus(roh)
  const fehler = istParameterFehler(p) ? p.fehler : null
  const z = istParameterFehler(p) ? { von: `${heute.slice(0, 4)}-01-01`, bis: heute, stufe: null } : p
  const param = { von: z.von, bis: z.bis, stufe: z.stufe }

  const { betrieb } = await betriebUndModuleLaden(supabase, tenantId)
  const [verkauf, einkauf, tbs] = await Promise.all([
    ladeVerkaufImZeitraum(supabase, tenantId, z),
    ladeEinkaufImZeitraum(supabase, tenantId, z),
    ladeTbsAufstellung(supabase, tenantId, { ...z, betriebName: betrieb.name }),
  ])
  const summeLiter = (zeilen: { buchungLiter: number }[]) => zeilen.reduce((s, x) => s + Math.abs(x.buchungLiter), 0)
  const lbl = 'text-xs text-s112-text-2'


  return (
    <div className="space-y-6">
      <LagerTabs aktiv="verkehr" />
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Verkauf, Einkauf und TBS im Zeitraum</h1>
        <p className="text-xs text-s112-muted mt-0.5">Blätter der BKI-Schnittstelle – Verkauf und Einkauf aus dem Bewegungsjournal (Merkmale zum Buchungszeitpunkt), TBS aus den ausgestellten Transportbescheinigungen und den TBS-Nummern der Lieferanten.</p>
      </div>

      <form method="get" className="card flex flex-wrap items-end gap-3 print:hidden">
        <label className={lbl}>Von<input type="date" name="von" defaultValue={z.von ?? ''} className="form-input block mt-1" /></label>
        <label className={lbl}>Bis<input type="date" name="bis" defaultValue={z.bis ?? ''} className="form-input block mt-1" /></label>
        <label className={lbl}>Qualitätsstufe
          <select name="stufe" defaultValue={z.stufe ?? ''} className="form-input block mt-1">
            <option value="">alle</option>
            {KAT_QUALITAETSSTUFE.map(q => <option key={q.code} value={q.code}>{q.code} – {q.bezeichnung}</option>)}
          </select>
        </label>
        <button type="submit" className="btn-primary text-sm">Anzeigen</button>
      </form>
      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}

      <section className="space-y-2">
        <Kopf titel="Verkauf im Zeitraum" anzahl={verkauf.zeilen.length} href={csvPfad('bki-verkauf', param)} aria="CSV exportieren: Verkauf im Zeitraum" />
        <p className="text-xs text-s112-muted">Summe {fmtNum(summeLiter(verkauf.zeilen), { max: 2 })} l</p>
        {verkauf.zeilen.slice(0, 50).map((v, i) => (
          <div key={i} className="text-xs border-b border-s112-border py-1 flex flex-wrap gap-x-3">
            <span>{datumAT(v.datum)}</span><span className="font-mono">{v.beleg}</span><span>{v.produkt}</span><span className="font-mono">{v.buchungsartBsm}</span>
            <span className="tabular-nums">{fmtNum(Math.abs(v.buchungLiter), { max: 2 })} l</span><span>{v.kaeufer ?? '–'}</span>
          </div>
        ))}
        {verkauf.zeilen.length > 50 && <p className="text-xs text-s112-muted">… weitere in der CSV</p>}
      </section>

      <section className="space-y-2">
        <Kopf titel="Einkauf im Zeitraum" anzahl={einkauf.zeilen.length} href={csvPfad('bki-einkauf', param)} aria="CSV exportieren: Einkauf im Zeitraum" />
        <p className="text-xs text-s112-muted">Summe {fmtNum(summeLiter(einkauf.zeilen), { max: 2 })} l</p>
        {einkauf.zeilen.slice(0, 50).map((v, i) => (
          <div key={i} className="text-xs border-b border-s112-border py-1 flex flex-wrap gap-x-3">
            <span>{datumAT(v.datum)}</span><span className="font-mono">{v.beleg}</span><span>{v.produkt}</span><span className="font-mono">{v.buchungsartBsm}</span>
            <span className="tabular-nums">{fmtNum(Math.abs(v.buchungLiter), { max: 2 })} l</span><span>{v.verkaeufer ?? '–'}</span>
          </div>
        ))}
        {einkauf.zeilen.length > 50 && <p className="text-xs text-s112-muted">… weitere in der CSV</p>}
      </section>

      <section className="space-y-2">
        <Kopf titel="TBS-Aufstellung" anzahl={tbs.zeilen.length} href={csvPfad('bki-tbs', param)} aria="CSV exportieren: TBS-Aufstellung" />
        {tbs.warnungen.length > 0 && <ul className="text-xs text-s112-warn-fg list-disc pl-4">{tbs.warnungen.map((w, i) => <li key={i}>{w}</li>)}</ul>}
        {tbs.zeilen.slice(0, 50).map((t, i) => (
          <div key={i} className="text-xs border-b border-s112-border py-1 flex flex-wrap gap-x-3">
            <span>{datumAT(t.datum)}</span><span>{t.richtung}</span><span className="font-mono">{t.tbsNummer ?? 'ohne TBS-Nr.'}</span>
            <span>{t.sorten.filter(Boolean).join(', ')}</span><span>{t.jahrgang ?? ''}</span>
            <span className="tabular-nums">{t.menge == null ? '' : fmtNum(t.menge, { max: 2 })} {t.einheit ?? ''}</span>
            <span>{t.versender ?? '–'} → {t.empfaenger ?? '–'}</span>
          </div>
        ))}
        {tbs.zeilen.length > 50 && <p className="text-xs text-s112-muted">… weitere in der CSV</p>}
      </section>
    </div>
  )
}
