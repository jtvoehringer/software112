'use client'

import { useState, useTransition } from 'react'
import Link from '@/components/ui/Link'
import { createUmbuchung, stornoUmbuchung, setzeAbgeglichen } from '../../actions'
import StornoButton from '@/components/StornoButton'
import { AlertTriangle, Lock } from 'lucide-react'
import type { Bewegung } from './page'
import { fmtEur } from '@/lib/format'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { heuteWien } from '@/lib/datum/wien'
import SendenKnopf from '@/components/ui/SendenKnopf'

type Konto = {
  id: string
  name: string
  typ: string
  iban: string | null
  eroeffnungsdatum: string
  eroeffnungssaldo: number
}

function fmt(n: number) {
  return fmtEur(n)
}

function BewegungsZeile({ b, kontoId, writeOk }: { b: Bewegung; kontoId: string; writeOk: boolean }) {
  const [pending, startTransition] = useTransition()

  return (
    <tr className={`border-b border-s112-border/50 hover:bg-s112-bg/50 ${b.storniert || b.gegenzeile ? 'text-s112-muted' : ''}`}>
      <td className="px-4 py-2.5 text-s112-text-2 whitespace-nowrap text-sm">
        {new Date(b.datum).toLocaleDateString('de-AT')}
      </td>
      <td className="px-4 py-2.5 text-sm">
        {b.beschreibung}
        {b.gesperrt && (
          <span title="Zeitraum gesperrt (Monatsabschluss oder UVA übermittelt)">
            <Lock className="inline-block w-3 h-3 text-s112-tertiary ml-1.5 -mt-0.5" />
          </span>
        )}
      </td>
      <td className={`px-4 py-2.5 text-right font-mono text-sm font-semibold ${b.betrag >= 0 ? 'text-s112-ok-fg' : 'text-s112-err'}`}>
        {fmt(b.betrag)}
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-sm text-s112-text-2 tabular-nums">
        {b.saldoNachher != null ? fmt(b.saldoNachher) : '–'}
      </td>
      <td className="px-4 py-2.5 text-center">
        <input
          type="checkbox"
          checked={b.abgeglichen}
          disabled={!writeOk || pending || !!b.gegenzeile}
          onChange={() => startTransition(async () => { const r = await setzeAbgeglichen(kontoId, b.quelle, b.id, !b.abgeglichen); if (r && 'error' in r && r.error) alert(r.error) })}
          className="rounded-sm accent-s112-teal cursor-pointer disabled:cursor-not-allowed"
          title="Gegen Kontoauszug abgeglichen"
        />
      </td>
      <td className="px-2 py-2.5">
        {/* KAN-149 D2b: stornieren statt löschen – nicht an stornierten Umbuchungen und Gegenzeilen */}
        {writeOk && (b.quelle === 'umbuchung_von' || b.quelle === 'umbuchung_nach') && !b.storniert && !b.gegenzeile && (
          <StornoButton
            label="Umbuchung stornieren"
            hinweis="Die Umbuchung bleibt auf beiden Konten gekennzeichnet stehen; am Storno-Tag steht die Gegenzeile."
            action={async grund => {
              const r = await stornoUmbuchung(b.id, kontoId, b.andereKontoId ?? kontoId, grund)
              if (r && 'error' in r && r.error) return { error: r.error }
            }}
          />
        )}
      </td>
    </tr>
  )
}

export default function AbstimmungClient({
  konto, andereKonten, bewegungen, anzahlVorEroeffnung, aktuellerSaldo, writeOk, kassabuch = null,
}: {
  konto:               Konto
  andereKonten:        { id: string; name: string }[]
  bewegungen:          Bewegung[]
  anzahlVorEroeffnung: number
  aktuellerSaldo:      number
  writeOk:             boolean
  /** Kassa-Konten: Kassabuch (Behördenmeldung) – Druckseite und CSV des laufenden Jahres */
  kassabuch?:          { druck: string; csv: string } | null
}) {
  const [umbExpanded, setUmbExpanded] = useState(false)
  const [richtung, setRichtung] = useState<'von' | 'nach'>('von')

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/konten" className="hover:text-s112-blue-700 transition-colors">Konten</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">{konto.name}</span>
      </div>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">{konto.name}</h1>
          <p className="text-sm text-s112-muted mt-0.5">
            Eröffnet {new Date(konto.eroeffnungsdatum).toLocaleDateString('de-AT')} mit {fmt(konto.eroeffnungssaldo)}
            {konto.iban ? ` · ${konto.iban}` : ''}
          </p>
        </div>
        <div className="bg-white rounded-xl border border-s112-border px-5 py-3 text-right">
          <p className="text-xs text-s112-muted">Aktueller Saldo</p>
          <p className={`text-2xl font-semibold tabular-nums ${aktuellerSaldo >= 0 ? 'text-s112-blue-700' : 'text-s112-err-fg'}`}>
            {fmt(aktuellerSaldo)}
          </p>
        </div>
      </div>

      {kassabuch && (
        <div className="flex items-start gap-2 flex-wrap">
          <Link href={kassabuch.druck}
            className="text-xs bg-[#F2F3F5] hover:bg-s112-line text-s112-text-2 font-medium px-3 py-1.5 rounded-lg transition-colors">
            Kassabuch drucken
          </Link>
          <CsvExportKnopf href={kassabuch.csv} label="Kassabuch als CSV" />
        </div>
      )}

      {anzahlVorEroeffnung > 0 && (
        <div className="flex items-start gap-2 bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-sm text-s112-warn-fg">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            {anzahlVorEroeffnung} {anzahlVorEroeffnung === 1 ? 'Bewegung liegt' : 'Bewegungen liegen'} am oder vor dem
            Eröffnungsdatum ({new Date(konto.eroeffnungsdatum).toLocaleDateString('de-AT')}) und {anzahlVorEroeffnung === 1 ? 'steckt' : 'stecken'} bereits
            im Eröffnungssaldo – sie werden hier nicht separat aufgeführt.
          </span>
        </div>
      )}

      {writeOk && andereKonten.length > 0 && (
        <div className="bg-white rounded-xl border border-s112-border p-4">
          {!umbExpanded ? (
            <button
              onClick={() => setUmbExpanded(true)}
              className="text-sm font-medium text-s112-blue-700 hover:underline"
            >
              + Umbuchung erfassen
            </button>
          ) : (
            <form
              action={async (formData: FormData) => {
                const ziel = formData.get('ziel_konto_id') as string
                formData.set(richtung === 'von' ? 'von_konto_id' : 'nach_konto_id', konto.id)
                formData.set(richtung === 'von' ? 'nach_konto_id' : 'von_konto_id', ziel)
                const result = await createUmbuchung(formData)
                if (!result?.error) setUmbExpanded(false)
                else alert(result.error)
              }}
              className="space-y-3"
            >
              <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider">Umbuchung erfassen</p>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="richtung" checked={richtung === 'von'} onChange={() => setRichtung('von')} className="accent-s112-teal" />
                  Von {konto.name} an …
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" name="richtung" checked={richtung === 'nach'} onChange={() => setRichtung('nach')} className="accent-s112-teal" />
                  Auf {konto.name} von …
                </label>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">{richtung === 'von' ? 'Ziel-Konto' : 'Quell-Konto'}</label>
                  <select name="ziel_konto_id" required className="form-input text-sm w-full">
                    {andereKonten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Datum</label>
                  <input aria-label="Datum" name="datum" type="date" defaultValue={heuteWien()} className="form-input text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Betrag (€)</label>
                  <input aria-label="Betrag (€)" name="betrag" type="text" inputMode="decimal" required placeholder="0,00" className="form-input text-sm w-full" />
                </div>
                <div>
                  <label className="block text-xs text-s112-text-2 mb-1">Notiz</label>
                  <input aria-label="Notiz" name="beschreibung" type="text" placeholder="Optional…" className="form-input text-sm w-full" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setUmbExpanded(false)}
                  className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:bg-s112-bg transition-colors">
                  Abbrechen
                </button>
                <SendenKnopf className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 transition-colors">
                  Umbuchung buchen
                </SendenKnopf>
              </div>
            </form>
          )}
        </div>
      )}

      {bewegungen.length === 0 ? (
        <div className="bg-white rounded-xl border border-s112-border p-10 text-center text-s112-muted">
          Noch keine Bewegungen auf diesem Konto seit dem Eröffnungsdatum.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-s112-border overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-s112-border bg-s112-bg">
                <th className="text-left px-4 py-3 text-xs font-medium text-s112-text-2">Datum</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-s112-text-2">Beschreibung</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-s112-text-2">Betrag</th>
                <th className="text-right px-4 py-3 text-xs font-medium text-s112-text-2">Saldo</th>
                <th className="text-center px-4 py-3 text-xs font-medium text-s112-text-2">Abgeglichen</th>
                <th className="px-2 py-3" />
              </tr>
            </thead>
            <tbody>
              {bewegungen.map(b => (
                <BewegungsZeile key={`${b.quelle}-${b.id}`} b={b} kontoId={konto.id} writeOk={writeOk} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
