import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { getCurrentMembership, canAdmin } from '@/lib/auth/roles'
import { berechneUndSpeichereUva, markiereUvaAlsUebermittelt } from '../actions'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'
import { Lock } from 'lucide-react'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

function fmt(n: number | null | undefined) {
  return (n ?? 0).toLocaleString('de-AT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const QUARTALE = ['Q1', 'Q2', 'Q3', 'Q4']

export default async function UvaPage({
  searchParams,
}: {
  searchParams: { jahr?: string }
}) {
  const supabase   = await createSupabaseServerClient()
  const membership = await getCurrentMembership()
  if (!membership?.tenantId) redirect('/login')
  const tenantId = membership.tenantId
  const adminOk  = canAdmin(membership.role)

  const { data: einst } = await (supabase.from('tenant_einstellungen') as any)
    .select('modul_ea, ea_uva_zeitraum, buchhaltungsart').eq('tenant_id', tenantId).maybeSingle()
  if (!einst?.modul_ea) redirect('/dashboard')
  // Migration 197: bei doppelter Buchhaltung beim Steuerberater ist die UVA hier
  // nur eine Kontroll-Vorschau - die Meldung macht die Kanzlei aus BMD. Deshalb
  // kein "Als übermittelt markieren" (das würde die Buchungen sperren und
  // suggerieren, die UVA sei abgegeben).
  const doppik = einst?.buchhaltungsart === 'doppik'

  const sp   = await searchParams
  const jahr = parseInt(sp.jahr ?? '') || new Date().getFullYear()
  const uvaZeitraum = einst?.ea_uva_zeitraum ?? 'quartalsweise'

  // Gespeicherte UVA-Meldungen für dieses Jahr laden
  const { data: uvaListe } = await (supabase.from('ea_uva') as any)
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('jahr', jahr)
    .order('zeitraum')

  // Abgeschlossene Monate dieses Jahres – Voraussetzung für UVA-Übermittlung
  // (siehe Migration 165: sperre_ea_uva prüft das serverseitig ohnehin, hier
  // nur zur besseren UX vorab angezeigt statt erst nach einem Fehlversuch).
  const { data: abschluesseRaw } = await (supabase.from('ea_monatsabschluss') as any)
    .select('monat').eq('tenant_id', tenantId).eq('jahr', jahr)
  const abgeschlosseneMonate = new Set(((abschluesseRaw ?? []) as R[]).map(a => a.monat as number))

  const MONATSNAMEN = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
  const benoetigteMonate = (z: string): number[] =>
    z.startsWith('Q')
      ? [1, 2, 3].map(i => (parseInt(z[1]) - 1) * 3 + i)
      : [parseInt(z)]

  const jahre = Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i)
  const alleZeitraeume = uvaZeitraum === 'monatlich'
    ? Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
    : QUARTALE
  const gesperrteZeitraeume = new Set(((uvaListe ?? []) as R[]).filter(u => u.gesperrt).map(u => u.zeitraum))
  const zeitraeume = alleZeitraeume.filter(z => !gesperrteZeitraeume.has(z))

  const zeitraumLabel = (z: string) => {
    if (z.startsWith('Q')) return `${z} ${jahr}`
    const mon = ['Jän','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez']
    return `${mon[parseInt(z) - 1]} ${jahr}`
  }

  const fmtDateTime = (ts: string | null) =>
    ts ? new Date(ts).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

  async function handleBerechnen(formData: FormData) {
    'use server'
    const j = parseInt(formData.get('jahr') as string)
    const z = formData.get('zeitraum') as string
    await berechneUndSpeichereUva(j, z)
  }

  async function handleUebermitteln(uvaId: string) {
    'use server'
    await markiereUvaAlsUebermittelt(uvaId)
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/buchhaltung" className="hover:text-s112-teal transition-colors">E&amp;A-Rechnung</Link>
        <span>/</span>
        <span className="text-gray-700 font-medium">{doppik ? 'UVA (Vorschau)' : 'UVA-Meldung'}</span>
      </div>
      <div className="flex items-center gap-3 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{doppik ? 'UVA (Vorschau)' : 'UVA-Meldung'}</h1>
      </div>

      {doppik && (
        <div className="bg-s112-blue-50 border border-s112-blue-100 text-s112-blue-700 rounded-2xl px-5 py-4 mb-6 text-sm">
          <p className="font-semibold mb-1">Die UVA meldet dein Steuerberater aus BMD.</p>
          <p>
            Dieser Betrieb führt die doppelte Buchhaltung beim Steuerberater. Die Zahlen hier sind eine Kontroll-Vorschau
            aus den in software:112 erfassten Belegen – bitte nicht zusätzlich in FinanzOnline eingeben. Entscheidend ist,
            dass alle Belege des Zeitraums übergeben sind:{' '}
            <Link href="/controlling/bmd" className="underline font-medium">zur BMD-Übergabe →</Link>
          </p>
        </div>
      )}

      {/* Jahr-Wahl */}
      <form method="GET" className="flex gap-3 mb-6 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Geschäftsjahr</label>
          <select name="jahr" defaultValue={String(jahr)}
            className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
            {jahre.map(j => <option key={j} value={j}>{j}</option>)}
          </select>
        </div>
        <button type="submit" className="bg-s112-teal text-white px-4 py-2 rounded-lg text-sm">Anzeigen</button>
      </form>

      {/* Berechnen */}
      <div className="bg-white rounded-2xl border border-s112-border p-5 mb-6">
        <h2 className="font-semibold text-gray-800 mb-3">Zeitraum berechnen</h2>
        {zeitraeume.length > 0 ? (
          <>
            <form action={handleBerechnen} className="flex gap-3 items-end">
              <input type="hidden" name="jahr" value={jahr} />
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Zeitraum *</label>
                <select name="zeitraum" required
                  className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none">
                  {zeitraeume.map(z => <option key={z} value={z}>{zeitraumLabel(z)}</option>)}
                </select>
              </div>
              <button type="submit"
                className="bg-s112-teal text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
                Berechnen & Speichern
              </button>
            </form>
            <p className="text-xs text-s112-muted mt-2">
              Berechnet USt und VSt aus den Buchungen und speichert die Meldung (kann beliebig oft wiederholt werden,
              solange die Meldung noch nicht als übermittelt markiert ist).
            </p>
          </>
        ) : (
          <p className="text-sm text-s112-muted">Alle Zeiträume für {jahr} sind bereits als übermittelt markiert.</p>
        )}
      </div>

      {/* UVA-Liste */}
      {(!uvaListe || uvaListe.length === 0) ? (
        <div className="bg-white rounded-2xl border border-s112-border p-8 text-center text-s112-muted">
          Noch keine UVA-Meldungen für {jahr}. Zeitraum berechnen →
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-s112-muted italic">
            Nachbildung des amtlichen Formulars U30 (Kennzahlen lt. BMF) zur Kontrolle vor der Eingabe in FinanzOnline –
            keine elektronische Übermittlung.
          </p>
          {(uvaListe as R[]).map((uva: R) => {
            const kz000 = (uva.bmgl_ust_0 ?? 0) + (uva.bmgl_ust_10 ?? 0) + (uva.bmgl_ust_13 ?? 0) + (uva.bmgl_ust_20 ?? 0)
            const zahllast = uva.zahllast ?? 0
            const fehlendeMonate = uva.gesperrt ? [] : benoetigteMonate(uva.zeitraum).filter(m => !abgeschlosseneMonate.has(m))
            return (
              <div key={uva.id} className="bg-white rounded-2xl border border-s112-border overflow-hidden">
                <div className="bg-s112-bg px-5 py-3 border-b border-s112-border flex items-center justify-between gap-3 flex-wrap">
                  <h3 className="font-semibold text-gray-800">{zeitraumLabel(uva.zeitraum)}</h3>
                  <div className="flex items-center gap-2">
                    {uva.gesperrt ? (
                      <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                        <Lock className="w-3 h-3" />
                        Übermittelt{fmtDateTime(uva.gesperrt_am) ? ` am ${fmtDateTime(uva.gesperrt_am)}` : ''}
                      </span>
                    ) : (
                      <>
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">Entwurf</span>
                        {adminOk && !doppik && (
                          fehlendeMonate.length > 0 ? (
                            <span className="inline-flex items-center gap-1.5 text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-1 rounded-full"
                              title="UVA kann erst übermittelt werden, wenn alle Monate dieser Periode abgeschlossen sind">
                              Monatsabschluss fehlt: {fehlendeMonate.map(m => MONATSNAMEN[m - 1]).join(', ')}
                              <Link href="/buchhaltung/monatsabschluss" className="underline font-medium hover:text-amber-900">
                                jetzt abschließen →
                              </Link>
                            </span>
                          ) : (
                            <ConfirmDeleteForm
                              action={handleUebermitteln.bind(null, uva.id)}
                              message={`Diese UVA-Meldung (${zeitraumLabel(uva.zeitraum)}) als übermittelt markieren? Dies ist nicht rückgängig zu machen und sperrt alle Buchungen dieses Zeitraums gegen weitere Änderungen.`}
                              label="Als übermittelt markieren"
                              title="Als übermittelt markieren"
                              className="text-xs bg-s112-teal text-white px-2.5 py-1 rounded-full font-medium hover:bg-opacity-90"
                            />
                          )
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="p-5 space-y-5 text-sm">
                  {/* 1. Umsätze */}
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">1. Umsätze</p>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-gray-700">
                        Gesamtbetrag der Bemessungsgrundlagen für Lieferungen und sonstige Leistungen{' '}
                        <span className="text-gray-400">(Kz 000)</span>
                      </span>
                      <span className="font-semibold tabular-nums">€ {fmt(kz000)}</span>
                    </div>

                    <p className="text-xs font-medium text-gray-500 mt-3 mb-1">Davon steuerpflichtig:</p>
                    <table className="w-full">
                      <tbody>
                        {[
                          { label: '20% Normalsteuersatz', kz: 'Kz 022', bmgl: uva.bmgl_ust_20, ust: uva.ust_20 },
                          { label: '10% ermäßigter Steuersatz', kz: 'Kz 029', bmgl: uva.bmgl_ust_10, ust: uva.ust_10 },
                          { label: '13% ermäßigter Steuersatz', kz: 'Kz 006', bmgl: uva.bmgl_ust_13, ust: uva.ust_13 },
                        ].map(row => (
                          <tr key={row.kz}>
                            <td className="py-1 text-gray-600">{row.label} <span className="text-gray-400 text-xs">({row.kz})</span></td>
                            <td className="py-1 text-right text-gray-500 tabular-nums">€ {fmt(row.bmgl)}</td>
                            <td className="py-1 text-right font-medium tabular-nums text-orange-600">USt € {fmt(row.ust)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="flex items-center justify-between py-1 mt-2 pt-2 border-t border-s112-border/60">
                      <span className="text-gray-600">
                        Steuerfreie Umsätze mit Vorsteuerabzug (z. B. Ausfuhrlieferungen){' '}
                        <span className="text-gray-400 text-xs">(Kz 011)</span>
                      </span>
                      <span className="tabular-nums">€ {fmt(uva.bmgl_ust_0)}</span>
                    </div>
                  </div>

                  {/* 2. Vorsteuer */}
                  <div className="pt-4 border-t border-s112-border">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">2. Vorsteuer</p>
                    <table className="w-full text-xs text-gray-500 mb-1">
                      <tbody>
                        {[
                          { label: 'VSt 20%', vst: uva.vst_20 },
                          { label: 'VSt 10%', vst: uva.vst_10 },
                          { label: 'VSt 13%', vst: uva.vst_13 },
                        ].map(row => (
                          <tr key={row.label}>
                            <td className="py-0.5">{row.label}</td>
                            <td className="py-0.5 text-right tabular-nums">€ {fmt(row.vst)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-between py-1">
                      <span className="text-gray-700">
                        Gesamtbetrag der abziehbaren Vorsteuer <span className="text-gray-400">(Kz 060)</span>
                      </span>
                      <span className="font-semibold tabular-nums text-blue-600">€ {fmt(uva.vst_gesamt)}</span>
                    </div>
                  </div>

                  {/* Ergebnis */}
                  <div className="pt-4 border-t-2 border-s112-border flex items-center justify-between">
                    <span className="font-semibold text-gray-700">
                      {zahllast >= 0 ? '7.1 Vorauszahlung (Zahllast)' : '7.2 Überschuss (Gutschrift)'}{' '}
                      <span className="text-gray-400 font-normal text-xs">(Kz 095)</span>
                    </span>
                    <span className={`text-xl font-bold tabular-nums ${zahllast >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                      € {fmt(Math.abs(zahllast))}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
