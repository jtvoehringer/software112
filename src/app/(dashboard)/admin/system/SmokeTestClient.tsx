'use client'

import { useState, useTransition } from 'react'
import { smokeTestAusfuehren, type SmokeZeile } from './actions'
import { fehlerText } from '@/lib/fehler'

// Schaltfläche + Ergebnis des Rechte-Smoke-Tests (Migration 223) auf /admin/system.
export default function SmokeTestClient() {
  const [zeilen, setZeilen] = useState<SmokeZeile[] | null>(null)
  const [dauer, setDauer] = useState(0)
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, start] = useTransition()

  const ausfuehren = () => start(async () => {
    setFehler(null)
    try {
      const r = await smokeTestAusfuehren()
      setZeilen(r.zeilen); setDauer(r.dauerMs)
    } catch (e) { setFehler(fehlerText(e)) }
  })

  const nok = (zeilen ?? []).filter(z => !z.ok)
  const laeufe = [...new Set((zeilen ?? []).map(z => z.lauf))]

  return (
    <section className="mb-8">
      <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
        <h2 className="text-base font-semibold text-s112-text">Smoke-Test Zugriffsrechte</h2>
        <button type="button" onClick={ausfuehren} disabled={laeuft}
          className="px-3 py-1.5 rounded-lg bg-s112-teal text-s112-yellow text-sm font-medium hover:opacity-90 disabled:opacity-50">
          {laeuft ? 'Läuft …' : 'Jetzt ausführen'}
        </button>
      </div>
      <p className="text-xs text-s112-muted mb-3">
        Prüft im Demo-Betrieb je Rolle (Betriebs-Manager, Mitarbeiter mit Vorlage „Rieden & Keller“ bzw. „Vertrieb“, Leser), ob Lesen, Schreiben je Modul, Mandantentrennung und Sperre so greifen wie im Benutzerkonzept vorgesehen. Alle Schreibvorgänge werden in der Datenbank zurückgerollt.
      </p>
      {fehler && <div role="alert" className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-xl px-4 py-3 text-sm mb-3">{fehler}</div>}
      {zeilen && (
        <div className="bg-white border border-s112-border rounded-xl overflow-hidden">
          <div role="alert" className={`px-4 py-2 text-sm font-medium ${nok.length ? 'bg-s112-err-bg text-s112-err-fg' : 'bg-s112-bg text-s112-text'}`}>
            {nok.length === 0 ? `Alle ${zeilen.length} Prüfungen bestanden` : `${nok.length} von ${zeilen.length} Prüfungen fehlgeschlagen`} · {dauer} ms
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase tracking-wide text-s112-muted">
              <tr>
                <th className="text-left px-3 py-2">Rolle</th>
                <th className="text-left px-3 py-2">Modul</th>
                <th className="text-left px-3 py-2">Prüfung</th>
                <th className="text-left px-3 py-2 w-20">Soll</th>
                <th className="text-left px-3 py-2 w-20">Ist</th>
                <th className="text-left px-3 py-2">Hinweis</th>
              </tr>
            </thead>
            <tbody>
              {laeufe.map(l => zeilen.filter(z => z.lauf === l).map((z, i) => (
                <tr key={`${l}-${i}`} className={`border-t border-s112-border ${z.ok ? '' : 'bg-s112-err-bg'}`}>
                  <td className="px-3 py-1.5 text-s112-muted">{i === 0 ? l : ''}</td>
                  <td className="px-3 py-1.5">{z.modul}</td>
                  <td className="px-3 py-1.5">{z.schritt}</td>
                  <td className="px-3 py-1.5">{z.erwartet ? 'erlaubt' : 'verboten'}</td>
                  <td className={`px-3 py-1.5 font-medium ${z.ok ? 'text-s112-text' : 'text-s112-err-fg'}`}>{z.tatsaechlich ? 'erlaubt' : 'verboten'}</td>
                  <td className="px-3 py-1.5 text-xs text-s112-muted wrap-break-word">{z.meldung}</td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
