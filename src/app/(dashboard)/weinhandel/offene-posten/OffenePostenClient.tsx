'use client'

import { useState } from 'react'
import Link from '@/components/ui/Link'
import { createZahlung } from '../verkauf/actions'
import { fmtEur, fmtNum } from '@/lib/format'

type Posten = {
  id: string
  datum: string
  rechnungsnummer: string | null
  bezahlt: boolean
  bezahlt_am: string | null
  gesamt: number
  bereitsBezahlt: number
  kundenName: string
  kontaktId: string | null
  firmaId: string | null
  // Rückmeldung 29.8.2026: "die überfälligen bitte rot markieren" - Erkennung
  // kommt bereits aus page.tsx (gleiche 30-Tage-Zahlungsziel-Annahme wie im
  // Dashboard), hier nur noch farblich in der Tabelle sichtbar machen.
  ueberfaellig: boolean
  tageUeberfaellig: number
}

function fmt(n: number) {
  return fmtEur(n)
}

function fmtBetragInput(n: number) {
  return fmtNum(n, 2)
}

type Konto = { id: string; name: string }

function PostenZeile({ p, writeOk, konten }: { p: Posten; writeOk: boolean; konten: Konto[] }) {
  const [expanded, setExpanded] = useState(false)
  const offenerBetrag = Math.max(0, p.gesamt - p.bereitsBezahlt)
  const createZahlungBound = createZahlung.bind(null, p.id)

  return (
    <>
      <tr className={`border-b border-s112-border last:border-0 hover:bg-s112-bg/50 transition-colors ${p.bezahlt ? 'opacity-60' : ''} ${expanded ? 'bg-s112-bg/40' : ''} ${p.ueberfaellig ? 'bg-s112-err-bg/30' : ''}`}>
        <td className={`px-4 py-3 text-sm tabular-nums ${p.ueberfaellig ? 'text-s112-err-fg font-semibold' : 'text-s112-muted'}`}>
          {new Date(p.datum).toLocaleDateString('de-AT')}
        </td>
        <td className="px-4 py-3">
          <Link href={`/weinhandel/verkauf/${p.id}`}
            className="text-sm font-mono font-semibold text-s112-blue-700 hover:underline">
            {p.rechnungsnummer ?? '–'}
          </Link>
        </td>
        <td className="px-4 py-3 text-sm text-s112-text">
          {p.kontaktId ? (
            <Link href={`/crm/kontakte/${p.kontaktId}`} className="hover:text-s112-blue-700 hover:underline">
              {p.kundenName}
            </Link>
          ) : p.firmaId ? (
            <Link href={`/crm/firmen/${p.firmaId}`} className="hover:text-s112-blue-700 hover:underline">
              {p.kundenName}
            </Link>
          ) : (
            <span>{p.kundenName}</span>
          )}
        </td>
        <td className="px-4 py-3 text-right font-semibold text-s112-blue-700 tabular-nums">
          {fmt(p.gesamt)}
          {!p.bezahlt && p.bereitsBezahlt > 0 && (
            <p className="text-[11px] font-normal text-s112-muted mt-0.5">
              {fmt(p.bereitsBezahlt)} bereits erhalten
            </p>
          )}
        </td>
        <td className="px-4 py-3 text-center">
          {p.bezahlt ? (
            <div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-ok-bg text-s112-ok-fg font-medium">Bezahlt</span>
              {p.bezahlt_am && (
                <p className="text-[11px] text-s112-muted mt-0.5">
                  {new Date(p.bezahlt_am).toLocaleDateString('de-AT')}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-1">
              {p.ueberfaellig && (
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-s112-err-bg text-s112-err-fg font-semibold whitespace-nowrap">
                  {p.tageUeberfaellig} Tage überfällig
                </span>
              )}
              {writeOk ? (
                <button
                  onClick={() => setExpanded(v => !v)}
                  className="text-xs font-medium text-s112-ok-fg border border-s112-ok/30 rounded-full px-3 py-0.5 hover:bg-s112-ok hover:text-white hover:border-s112-grey transition-colors"
                >
                  {expanded ? 'Abbrechen' : 'Zahlung buchen'}
                </button>
              ) : !p.ueberfaellig ? (
                <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">Offen</span>
              ) : null}
            </div>
          )}
        </td>
      </tr>
      {expanded && writeOk && !p.bezahlt && (
        <tr className="border-b border-s112-border last:border-0 bg-s112-bg/40">
          <td colSpan={5} className="px-4 py-3">
            <form
              action={async (formData: FormData) => {
                await createZahlungBound(formData)
                setExpanded(false)
              }}
              className="border border-s112-border rounded-lg p-3 space-y-3 bg-white"
            >
              <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider">Zahlung erfassen</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Datum</label>
                  <input aria-label="Datum" name="datum" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className="form-input text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Art</label>
                  <select aria-label="Art" name="art" className="form-input text-sm w-full">
                    <option value="bar">Bar</option>
                    <option value="karte">Karte</option>
                    <option value="bank">Bank</option>
                    <option value="gutschrift">Gutschrift</option>
                    <option value="sonstig">Sonstiges</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Betrag (€)</label>
                  <input aria-label="Betrag (€)"
                    name="betrag"
                    type="text"
                    inputMode="decimal"
                    required
                    defaultValue={fmtBetragInput(offenerBetrag)}
                    placeholder="0,00"
                    className="form-input text-sm w-full"
                  />
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Notiz</label>
                  <input aria-label="Notiz" name="notizen" type="text" placeholder="Optional…" className="form-input text-sm w-full" />
                </div>
              </div>
              {konten.length > 0 && (
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Bezahlt über Konto</label>
                  <select aria-label="Bezahlt über Konto" name="konto_id" required className="form-input text-sm w-full max-w-xs">
                    {konten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:bg-s112-bg transition-colors"
                >
                  Abbrechen
                </button>
                <button type="submit" className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
                  Zahlung buchen
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  )
}

export default function OffenePostenClient({
  offene, bezahlte, summeOffen, writeOk, konten,
}: {
  offene:     Posten[]
  bezahlte:   Posten[]
  summeOffen: number
  writeOk:    boolean
  konten:     Konto[]
}) {
  const [showBezahlt, setShowBezahlt] = useState(false)
  const alle = showBezahlt ? [...offene, ...bezahlte] : offene

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/weinhandel" className="hover:text-s112-blue-700 transition-colors">Weinhandel</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Offene Posten</span>
      </div>
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Offene Posten</h1>
          <p className="text-sm text-s112-muted mt-0.5">
            {offene.length} offene {offene.length === 1 ? 'Rechnung' : 'Rechnungen'}
          </p>
        </div>
        <div className="card px-5 py-3 text-right">
          <p className="text-xs text-s112-muted">Offener Gesamtbetrag</p>
          <p className="text-2xl font-semibold text-s112-blue-700 tabular-nums">{fmt(summeOffen)}</p>
        </div>
      </div>

      {/* Toggle bezahlte anzeigen */}
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer select-none text-sm text-s112-text-2">
          <input
            type="checkbox"
            checked={showBezahlt}
            onChange={e => setShowBezahlt(e.target.checked)}
            className="rounded-sm accent-s112-teal"
          />
          Bezahlte Rechnungen anzeigen ({bezahlte.length})
        </label>
        <Link href="/weinhandel/verkauf" className="text-xs text-s112-blue-700 hover:underline">
          → Alle Verkäufe
        </Link>
      </div>

      {/* Tabelle */}
      {alle.length === 0 ? (
        <div className="card p-12 text-center text-s112-muted text-sm">
          {offene.length === 0
            ? 'Keine offenen Rechnungen – alles bezahlt!'
            : 'Keine Einträge vorhanden.'}
        </div>
      ) : (
        <div className="card p-0 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-s112-bg border-b border-s112-border">
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Datum</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Belegnr.</th>
                <th className="text-left px-4 py-3 font-semibold text-s112-text-1">Kunde</th>
                <th className="text-right px-4 py-3 font-semibold text-s112-text-1">Betrag</th>
                <th className="text-center px-4 py-3 font-semibold text-s112-text-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {alle.map(p => (
                <PostenZeile key={p.id} p={p} writeOk={writeOk} konten={konten} />
              ))}
            </tbody>
            {offene.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-s112-border bg-s112-bg">
                  <td colSpan={3} className="px-4 py-3 text-right font-semibold text-s112-text-1">
                    Offen gesamt
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-lg text-s112-blue-700 tabular-nums">
                    {fmt(summeOffen)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  )
}
