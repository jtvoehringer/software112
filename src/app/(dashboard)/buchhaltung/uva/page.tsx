// behoerdenmeldung: uva
import { redirect } from 'next/navigation'
import { geladen } from '@/lib/supabase/geladen'
import Link from '@/components/ui/Link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { berechneUndSpeichereUva, markiereUvaAlsUebermittelt } from '../actions'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import DruckenKnopf from '../anlagen/DruckenKnopf'
import { Lock } from 'lucide-react'
import { fmtNum, dezimal } from '@/lib/format'
import { wienHeute, wienZeitpunkt } from '@/lib/csv'
import { csvPfad } from '@/lib/behoerden/katalog'
import { ladeUva, uvaZeitraumLabel, UVA_MONATE, type UvaMeldung, type UvaSchluessel } from '@/lib/behoerden/uva'
import { datumText } from '@/lib/behoerden/buchhaltung-gemeinsam'
import SendenKnopf from '@/components/ui/SendenKnopf'
import { ergebnisPruefen } from '@/lib/fehler'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  return fmtNum((n ?? 0), 2)
}

const QUARTALE = ['Q1', 'Q2', 'Q3', 'Q4']

// Behördenmeldung „uva“ (24.09.2026): Kennzahlen je Zeitraum kommen aus ladeUva()
// (lib/behoerden/uva.ts) – dieselbe Ladefunktion liefert die CSV (/meldungen/uva/csv).
// Druck über „Drucken / PDF“ (Formulare und Knöpfe sind im Druck ausgeblendet).

/** Zeitpunkt (timestamptz) als „TT.MM.JJJJ, HH:MM“ in Wiener Zeit */
function zeitpunktText(ts: string | null): string | null {
  const z = wienZeitpunkt(ts)
  return z ? `${datumText(z.datum)}${z.uhrzeit ? `, ${z.uhrzeit}` : ''}` : null
}

export default async function UvaPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string }>
}) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const adminOk  = canAdmin(membership.role)

  const einst = geladen(await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, ea_uva_zeitraum, buchhaltungsart, betrieb_name, betrieb_uid').eq('tenant_id', tenantId).maybeSingle(), 'Einstellungen')
  if (!einst?.modul_ea) redirect('/dashboard')
  // Migration 197: bei doppelter Buchhaltung beim Steuerberater ist die UVA hier
  // nur eine Kontroll-Vorschau - die Meldung macht die Kanzlei aus BMD. Deshalb
  // kein "Als übermittelt markieren" (das würde die Buchungen sperren und
  // suggerieren, die UVA sei abgegeben).
  const doppik = einst?.buchhaltungsart === 'doppik'

  const sp   = await searchParams
  const heute = wienHeute()
  const aktJahr = Number(heute.slice(0, 4))
  const jahr = parseInt(sp.jahr ?? '') || aktJahr   // null-vorgabe-ok: Jahr 0 aus der URL ist ungültig – aktuelles Jahr
  const uvaZeitraum = einst?.ea_uva_zeitraum ?? 'quartalsweise'

  // Gespeicherte UVA-Meldungen für dieses Jahr – Kennzahlen wie in der CSV
  const { meldungen } = await ladeUva(supabase, tenantId, { jahr, zeitraum: null }, { doppik })

  // Abgeschlossene Monate dieses Jahres – Voraussetzung für UVA-Übermittlung
  // (siehe Migration 165: sperre_ea_uva prüft das serverseitig ohnehin, hier
  // nur zur besseren UX vorab angezeigt statt erst nach einem Fehlversuch).
  const abschluesseRaw = geladen(await (supabase.from('ea_monatsabschluss') as any)
    .select('monat').eq('tenant_id', tenantId).eq('jahr', jahr), 'Monatsabschlüsse')
  const abgeschlosseneMonate = new Set(((abschluesseRaw ?? []) as R[]).map(a => a.monat as number))

  const benoetigteMonate = (z: string): number[] =>
    z.startsWith('Q')
      ? [1, 2, 3].map(i => (parseInt(z[1]) - 1) * 3 + i)
      : [parseInt(z)]

  const jahre = Array.from({ length: 5 }, (_, i) => aktJahr - i)
  const alleZeitraeume = uvaZeitraum === 'monatlich'
    ? Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
    : QUARTALE
  const gesperrteZeitraeume = new Set(meldungen.filter(u => u.gesperrt).map(u => u.zeitraum))
  const zeitraeume = alleZeitraeume.filter(z => !gesperrteZeitraeume.has(z))

  const zeitraumLabel = (z: string) => uvaZeitraumLabel(z, jahr)

  async function handleBerechnen(formData: FormData) {
    'use server'
    const j = parseInt(dezimal(formData.get('jahr') as string))
    const z = formData.get('zeitraum') as string
    ergebnisPruefen(await berechneUndSpeichereUva(j, z))   // Sweep 107: z. B. „bereits übermittelt (gesperrt)“ nicht verwerfen
  }

  async function handleUebermitteln(uvaId: string) {
    'use server'
    ergebnisPruefen(await markiereUvaAlsUebermittelt(uvaId))
  }

  return (
    <div className="p-6 max-w-4xl mx-auto print:p-0 print:max-w-none">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2" data-print="hide">
        <Link href="/buchhaltung" className="hover:text-s112-blue-700 transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{doppik ? 'UVA (Vorschau)' : 'UVA-Meldung'}</span>
      </div>
      <div className="flex items-start justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">{doppik ? 'UVA (Vorschau)' : 'UVA-Meldung'} {jahr}</h1>
          <p className="hidden print:block text-xs text-s112-text-2 mt-1">
            {einst?.betrieb_name ?? ''}{einst?.betrieb_uid ? ` · UID ${einst.betrieb_uid}` : ''} · erstellt am {datumText(heute)} · software:112
          </p>
        </div>
        <div className="flex items-start gap-2 print:hidden" data-print="hide">
          <DruckenKnopf />
          <CsvExportKnopf href={csvPfad('uva', { jahr })} label={`Jahr ${jahr} als CSV`} />
        </div>
      </div>

      {doppik && (
        <div className="bg-s112-blue-50 border border-s112-blue-100 text-s112-blue-700 rounded-xl px-5 py-4 mb-6 text-sm">
          <p className="font-semibold mb-1">Die UVA meldet dein Steuerberater aus BMD.</p>
          <p>
            Dieser Betrieb führt die doppelte Buchhaltung beim Steuerberater. Die Zahlen hier sind eine Kontroll-Vorschau:
            Umsätze aus den Rechnungen nach Rechnungsdatum, Vorsteuer aus den in software:112 erfassten Belegen – bitte
            nicht zusätzlich in FinanzOnline eingeben. Entscheidend ist,
            dass alle Belege des Zeitraums übergeben sind:{' '}
            <Link href="/controlling/bmd" className="underline font-medium">zur BMD-Übergabe →</Link>
          </p>
        </div>
      )}

      {/* Jahr-Wahl */}
      <form method="GET" className="flex gap-3 mb-6 items-end" data-print="hide">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Geschäftsjahr</label>
          <select aria-label="Geschäftsjahr" name="jahr" defaultValue={String(jahr)}
            className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
            {jahre.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <button type="submit" className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm">Anzeigen</button>
      </form>

      {/* Berechnen */}
      <div className="bg-white rounded-xl border border-s112-border p-5 mb-6" data-print="hide">
        <h2 className="font-semibold text-s112-text mb-3">Zeitraum berechnen</h2>
        {zeitraeume.length > 0 ? (
          <>
            <form action={handleBerechnen} className="flex gap-3 items-end">
              <input type="hidden" name="jahr" value={jahr} />
              <div>
                <label className="block text-xs font-medium text-s112-text-2 mb-1">Zeitraum *</label>
                <select aria-label="Zeitraum" name="zeitraum" required
                  className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden">
                  {zeitraeume.map(z => <option key={z} value={z}>{zeitraumLabel(z)}</option>)}
                </select>
              </div>
              <SendenKnopf
                className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
                Berechnen & Speichern
              </SendenKnopf>
            </form>
            <p className="text-xs text-s112-muted mt-2">
              Berechnet USt und VSt aus den Buchungen und speichert die Meldung (kann beliebig oft wiederholt werden,
              solange die Meldung noch nicht als übermittelt markiert ist).{' '}
              {doppik
                ? 'Umsätze nach Rechnungsdatum (Rechnungen), Vorsteuer aus den Belegen.'
                : 'Umsätze aus Verkäufen nach Zahlungseingang (Ist-Versteuerung), je Zahlung am Zahlungstag.'}
            </p>
          </>
        ) : (
          <p className="text-sm text-s112-muted">Alle Zeiträume für {jahr} sind bereits als übermittelt markiert.</p>
        )}
      </div>

      {/* UVA-Liste */}
      {meldungen.length === 0 ? (
        <div className="bg-white rounded-xl border border-s112-border p-8 text-center text-s112-muted">
          Noch keine UVA-Meldungen für {jahr}. Zeitraum berechnen →
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-s112-muted italic">
            Nachbildung des amtlichen Formulars U30 (Kennzahlen lt. BMF) zur Kontrolle vor der Eingabe in FinanzOnline –
            keine elektronische Übermittlung.
          </p>
          {meldungen.map(uva => (
            <UvaKarte key={uva.id} uva={uva} jahr={jahr} doppik={doppik} adminOk={adminOk}
              fehlendeMonate={uva.gesperrt ? [] : benoetigteMonate(uva.zeitraum).filter(m => !abgeschlosseneMonate.has(m))}
              uebermitteln={handleUebermitteln.bind(null, uva.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function UvaKarte({ uva, jahr, doppik, adminOk, fehlendeMonate, uebermitteln }: {
  uva: UvaMeldung; jahr: number; doppik: boolean; adminOk: boolean; fehlendeMonate: number[]
  uebermitteln: () => Promise<void>
}) {
  const k = (s: UvaSchluessel) => uva.kennzahlen.find(x => x.schluessel === s)
  const zahllast = k('kz095')?.steuer ?? 0
  const uebermitteltAm = zeitpunktText(uva.gesperrtAm)

  return (
    <div className="bg-white rounded-xl border border-s112-border overflow-hidden break-inside-avoid">
      <div className="bg-s112-bg px-5 py-3 border-b border-s112-border flex items-center justify-between gap-3 flex-wrap">
        <h3 className="font-semibold text-s112-text">{uva.label}</h3>
        <div className="flex items-center gap-2">
          {uva.gesperrt ? (
            <span className="inline-flex items-center gap-1 text-xs bg-[#F2F3F5] text-s112-text-2 px-2 py-0.5 rounded-full">
              <Lock className="w-3 h-3" />
              Übermittelt{uebermitteltAm ? ` am ${uebermitteltAm}` : ''}
            </span>
          ) : (
            <>
              <span className="text-xs bg-s112-warn-bg text-s112-warn-fg px-2 py-0.5 rounded-full">{doppik ? 'Kontroll-Vorschau' : 'Entwurf'}</span>
              {adminOk && !doppik && (
                fehlendeMonate.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-xs bg-s112-warn-bg text-s112-warn-fg border border-s112-warn/30 px-2.5 py-1 rounded-full print:hidden"
                    title="UVA kann erst übermittelt werden, wenn alle Monate dieser Periode abgeschlossen sind">
                    Monatsabschluss fehlt: {fehlendeMonate.map(m => UVA_MONATE[m - 1]).join(', ')}
                    <Link href="/buchhaltung/monatsabschluss" className="underline font-medium hover:text-s112-warn-fg">
                      jetzt abschließen →
                    </Link>
                  </span>
                ) : (
                  <span className="print:hidden">
                    <ConfirmDeleteForm
                      action={uebermitteln}
                      message={`Diese UVA-Meldung (${uva.label}) als übermittelt markieren? Dies ist nicht rückgängig zu machen und sperrt alle Buchungen dieses Zeitraums gegen weitere Änderungen.`}
                      label="Als übermittelt markieren"
                      title="Als übermittelt markieren"
                      className="text-xs bg-s112-teal text-s112-yellow px-2.5 py-1 rounded-full font-medium hover:bg-s112-teal/90"
                    />
                  </span>
                )
              )}
            </>
          )}
          <CsvExportKnopf href={csvPfad('uva', { jahr, zeitraum: uva.zeitraum })} label="CSV exportieren" ariaLabel={`CSV exportieren: UVA ${uva.label}`} />
        </div>
      </div>

      <div className="p-5 space-y-5 text-sm">
        {/* 1. Umsätze */}
        <div>
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wide mb-2">1. Umsätze</p>
          <div className="flex items-center justify-between py-1">
            <span className="text-s112-text-1">
              {k('kz000')?.bezeichnung}{' '}
              <span className="text-s112-tertiary">(Kz 000)</span>
            </span>
            <span className="font-semibold tabular-nums">€ {fmt(k('kz000')?.bemessungsgrundlage)}</span>
          </div>

          <p className="text-xs font-medium text-s112-text-2 mt-3 mb-1">Davon steuerpflichtig:</p>
          <table className="w-full">
            <tbody>
              {(['kz022', 'kz029', 'kz006'] as const).map(s => {
                const row = k(s)
                if (!row) return null
                return (
                  <tr key={s}>
                    <td className="py-1 text-s112-text-2">{row.bezeichnung} <span className="text-s112-tertiary text-xs">(Kz {row.kz})</span></td>
                    <td className="py-1 text-right text-s112-text-2 tabular-nums">€ {fmt(row.bemessungsgrundlage)}</td>
                    <td className="py-1 text-right font-medium tabular-nums text-s112-warn-fg">USt € {fmt(row.steuer)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <div className="flex items-center justify-between py-1 mt-2 pt-2 border-t border-s112-border/60">
            <span className="text-s112-text-2">
              {k('ust0')?.bezeichnung}{' '}
              <span className="text-s112-tertiary text-xs">(Kz 011/017/016/020)</span>
            </span>
            <span className="tabular-nums">€ {fmt(k('ust0')?.bemessungsgrundlage)}</span>
          </div>
        </div>

        {/* 2. Vorsteuer */}
        <div className="pt-4 border-t border-s112-border">
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wide mb-2">2. Vorsteuer</p>
          <table className="w-full text-xs text-s112-text-2 mb-1">
            <tbody>
              {(['vst20', 'vst10', 'vst13'] as const).map(s => {
                const row = k(s)
                if (!row) return null
                return (
                  <tr key={s}>
                    <td className="py-0.5">{row.bezeichnung}</td>
                    <td className="py-0.5 text-right tabular-nums">€ {fmt(row.steuer)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="flex items-center justify-between py-1">
            <span className="text-s112-text-1">
              {k('kz060')?.bezeichnung} <span className="text-s112-tertiary">(Kz 060)</span>
            </span>
            <span className="font-semibold tabular-nums text-s112-blue-700">€ {fmt(k('kz060')?.steuer)}</span>
          </div>
        </div>

        {/* Ergebnis */}
        <div className="pt-4 border-t-2 border-s112-border flex items-center justify-between">
          <span className="font-semibold text-s112-text-1">
            {zahllast >= 0 ? '7.1 Vorauszahlung (Zahllast)' : '7.2 Überschuss (Gutschrift)'}{' '}
            <span className="text-s112-tertiary font-normal text-xs">(Kz 095)</span>
          </span>
          <span className={`text-xl font-semibold tabular-nums ${zahllast >= 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>
            € {fmt(Math.abs(zahllast))}
          </span>
        </div>
      </div>
    </div>
  )
}
