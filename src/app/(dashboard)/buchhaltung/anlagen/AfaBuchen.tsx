'use client'
// AfA-Buchung am Jahresende (Migration 200): vergleicht die AfA laut
// Verzeichnis mit den gebuchten AfA-Buchungen des Jahres und bucht fehlende
// bzw. abweichende Beträge als Ausgabe „Abschreibung (AfA)“ per 31.12. -
// ohne Zahlungskonto, 0 % USt. Bei Doppik beim Steuerberater nur Anzeige.
// KAN-149 D2c: Abweichende AfA wird beim Buchen storniert (Gegenbuchung per 31.12.) und neu gebucht; Zurücknehmen
// storniert alle AfA-Buchungen des Jahres – mit Grund.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { CalendarCheck, RotateCcw } from 'lucide-react'
import type { AfaBuchungsStatus } from '@/lib/ea/anlagen'
import { fmtEur } from '@/lib/format'
import { STORNO_GRUND_MIN, stornoGrundFehler } from '@/lib/storno/grund'
import { Card, Badge, Note, Th, Td, type BadgeTone } from '@/app/(dashboard)/dashboard/_shared/ui'
import { bucheAfa, nimmAfaZurueck } from './actions'

const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  gebucht:       { label: 'gebucht',    tone: 'ok' },
  offen:         { label: 'offen',      tone: 'warn' },
  abweichend:    { label: 'abweichend', tone: 'err' },
  ueberfluessig: { label: 'zu viel',    tone: 'err' },
}

export default function AfaBuchen({ status, dezemberGesperrt, laufend, doppik, darfSchreiben }: {
  status: AfaBuchungsStatus
  /** Dezember des Jahres ist abgeschlossen – keine Buchung möglich */
  dezemberGesperrt: boolean
  /** Jahr läuft noch (AfA üblicherweise erst nach Jahresende buchen) */
  laufend: boolean
  doppik: boolean
  darfSchreiben: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [alleZeigen, setAlleZeigen] = useState(false)
  const [rueckOffen, setRueckOffen] = useState(false)
  const [grund, setGrund] = useState('')
  const { jahr, zeilen } = status

  const zuBuchen = zeilen.filter(z => z.status !== 'gebucht' && !z.gesperrt)
  const gebuchte = zeilen.filter(z => z.buchungId && !z.gesperrt)
  const blockiert = dezemberGesperrt || doppik || !darfSchreiben

  function buchen() {
    if (zuBuchen.length === 0) return
    const text = zuBuchen.length === 1
      ? `AfA ${jahr} für „${zuBuchen[0].anlage.name}“ (${fmtEur(zuBuchen[0].soll)}) per 31.12.${jahr} buchen?`
      : `AfA ${jahr} für ${zuBuchen.length} Anlagen (${fmtEur(zuBuchen.reduce((s, z) => s + z.soll, 0))}) per 31.12.${jahr} buchen?`
    const ersetzt = zuBuchen.filter(z => z.buchungId).length
    if (!confirm(ersetzt ? `${text}

${ersetzt === 1 ? 'Die abweichende AfA-Buchung wird' : `${ersetzt} abweichende AfA-Buchungen werden`} dabei storniert (Gegenbuchung per 31.12.${jahr}).` : text)) return
    setFehler(null)
    start(async () => {
      const r = await bucheAfa(jahr, zuBuchen.map(z => ({ anlageId: z.anlage.id, name: z.anlage.name, soll: z.soll, buchungId: z.buchungId })))
      if (!r.ok) { setFehler(r.fehler ?? 'Buchen fehlgeschlagen'); return }
      router.refresh()
    })
  }
  function zuruecknehmen() {
    if (gebuchte.length === 0) return
    const f = stornoGrundFehler(grund)
    if (f) { setFehler(f); return }
    setFehler(null)
    start(async () => {
      const r = await nimmAfaZurueck(jahr, gebuchte.map(z => z.buchungId as string), grund.trim())
      if (!r.ok) { setFehler(r.fehler ?? 'Zurücknehmen fehlgeschlagen'); router.refresh(); return }
      setRueckOffen(false)
      setGrund('')
      router.refresh()
    })
  }

  if (zeilen.length === 0) return null
  const sichtbar = alleZeigen || zeilen.length <= 8 ? zeilen : zeilen.filter(z => z.status !== 'gebucht')

  return (
    <Card title={`AfA ${jahr} buchen`} right={status.komplett
      ? <Badge tone="ok">gebucht · {fmtEur(status.ist)}</Badge>
      : <Badge tone="warn">{status.offen} {status.offen === 1 ? 'Position' : 'Positionen'} offen</Badge>}>

      <p className="text-[13px] text-s112-text-2 mb-3">
        AfA laut Verzeichnis <b className="font-mono text-s112-text">{fmtEur(status.soll)}</b>, davon gebucht{' '}
        <b className="font-mono text-s112-text">{fmtEur(status.ist)}</b>. Gebucht wird je Anlage eine Ausgabe „Abschreibung (AfA)“
        per 31.12.{jahr} – ohne Zahlungskonto und ohne Umsatzsteuer, damit Kontostände und UVA unberührt bleiben.
        In der Finanzübersicht und in der BMD-Übergabe erscheint sie als Betriebsausgabe (Konto 7010).
      </p>

      {doppik && (
        <Note className="mb-3">Doppelte Buchhaltung beim Steuerberater: die Abschreibung bucht der Steuerberater in BMD. Das Verzeichnis dient als Beilage – der Anlagenspiegel lässt sich drucken und mitschicken.</Note>
      )}
      {dezemberGesperrt && !doppik && (
        <p className="mb-3 text-[12.5px] text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2">
          Dezember {jahr} ist abgeschlossen. Zum Buchen oder Zurücknehmen der AfA bitte den Monat im{' '}
          <Link href="/buchhaltung/monatsabschluss" className="underline">Monatsabschluss</Link> öffnen.
        </p>
      )}
      {laufend && !status.komplett && !dezemberGesperrt && !doppik && (
        <Note className="mb-3">{jahr} läuft noch. Die AfA wird üblicherweise nach dem Jahresende gebucht, sobald alle Anschaffungen und Abgänge erfasst sind – buchen ist trotzdem jederzeit möglich, Abweichungen zeigt diese Karte später an.</Note>
      )}
      {fehler && <p className="mb-3 text-[12.5px] text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{fehler}</p>}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><Th>Anlage</Th><Th right>AfA laut Verzeichnis</Th><Th right>gebucht</Th><Th>Status</Th></tr></thead>
          <tbody>
            {sichtbar.map(z => (
              <tr key={z.anlage.id}>
                <Td><Link href={`/buchhaltung/anlagen/${z.anlage.id}`} className="hover:text-s112-blue-700">{z.anlage.name}</Link></Td>
                <Td right mono>{z.soll > 0 ? fmtEur(z.soll) : '–'}</Td>
                <Td right mono className="text-s112-text-2">{z.buchungId ? fmtEur(z.ist) : '–'}</Td>
                <Td><Badge tone={STATUS[z.status].tone}>{STATUS[z.status].label}</Badge>{z.gesperrt && <span className="ml-1"><Badge tone="gray">gesperrt</Badge></span>}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-s112-line-str">
              <td className="px-2.5 pt-2.5 text-[13px] font-semibold text-s112-text">Summe</td>
              <td className="px-2.5 pt-2.5 text-right font-mono text-[12.5px] font-semibold text-s112-text tabular-nums">{fmtEur(status.soll)}</td>
              <td className="px-2.5 pt-2.5 text-right font-mono text-[12.5px] font-semibold text-s112-text-2 tabular-nums">{fmtEur(status.ist)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
      {zeilen.length > 8 && !alleZeigen && zeilen.some(z => z.status === 'gebucht') && (
        <button type="button" onClick={() => setAlleZeigen(true)} className="mt-2 text-[12.5px] text-s112-blue-700 hover:underline">Alle {zeilen.length} Positionen anzeigen</button>
      )}

      {!doppik && darfSchreiben && (
        <div className="flex flex-wrap items-center gap-2 mt-4">
          <button type="button" onClick={buchen} disabled={pending || blockiert || zuBuchen.length === 0}
            className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-[13px] font-semibold hover:opacity-90 disabled:opacity-40">
            <CalendarCheck size={15} strokeWidth={2} />
            {zuBuchen.length === 0 ? `AfA ${jahr} gebucht` : `AfA ${jahr} buchen (${zuBuchen.length})`}
          </button>
          {gebuchte.length > 0 && !rueckOffen && (
            <button type="button" onClick={() => { setRueckOffen(true); setFehler(null) }} disabled={pending || blockiert}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-s112-err-fg border border-s112-err/30 bg-white hover:bg-s112-err-bg disabled:opacity-40">
              <RotateCcw size={14} strokeWidth={2} />AfA-Buchungen {jahr} zurücknehmen
            </button>
          )}
          {gebuchte.length > 0 && rueckOffen && (
            <div className="w-full max-w-md flex flex-col gap-1.5 rounded-lg border border-s112-err/30 bg-s112-err-bg/40 p-3">
              <p className="text-[12.5px] text-s112-text-2">
                {gebuchte.length === 1 ? 'Die AfA-Buchung' : `Alle ${gebuchte.length} AfA-Buchungen`} {jahr} werden storniert – je eine Gegenbuchung per 31.12.{jahr}, die Buchungen bleiben gekennzeichnet in der E&A. Das Anlagenverzeichnis bleibt unverändert.
              </p>
              <label htmlFor="afa-rueck-grund" className="text-[12px] font-medium text-s112-text-1">Grund des Stornos <span className="text-s112-err">*</span></label>
              <textarea id="afa-rueck-grund" value={grund} onChange={ev => setGrund(ev.target.value)} rows={2} autoFocus minLength={STORNO_GRUND_MIN}
                placeholder="z. B. Nutzungsdauer falsch erfasst"
                className="w-full border border-s112-border rounded px-2 py-1 text-[12.5px] bg-white focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => { setRueckOffen(false); setFehler(null) }} disabled={pending} className="text-[12.5px] text-s112-text-2 hover:text-s112-text-1 px-1">Abbrechen</button>
                <button type="button" onClick={zuruecknehmen} disabled={pending}
                  className="text-[12.5px] bg-s112-err text-white px-3 py-1 rounded font-medium disabled:opacity-50">{pending ? '…' : 'Stornieren'}</button>
              </div>
            </div>
          )}
          {status.komplett && (
            <Link href={`/buchhaltung?jahr=${jahr}&q=AfA`} className="text-[12.5px] text-s112-blue-700 hover:underline ml-auto">Buchungen {jahr} ansehen →</Link>
          )}
        </div>
      )}
    </Card>
  )
}
