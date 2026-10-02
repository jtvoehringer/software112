'use client'

// ── Datenimport „Eröffnungsbestand Tank“ / „Eröffnungsbestand Flaschen“ (KAN-42 Etappe 1, 02.10.2026) ────
//
// Ablauf: Stichtag wählen → CSV-Vorlage laden → ausfüllen → Datei wählen → Vorschau (Server prüft jede Zeile) →
// „Importieren“ (Server prüft erneut und legt nur gültige Zeilen an – Tank über insertEroeffnungsbestand,
// Flaschen über fuellungAnlegen, also dieselbe Logik wie die Einzelformulare).

import { useRef, useState } from 'react'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { fehlerText } from '@/lib/fehler'
import { wienHeute } from '@/lib/csv'
import { parseCsv, csvDekodieren } from '@/lib/import/csvLesen'
import { felderFuer, vorlageCsv, type DateiBefund, type EroeffnungsArt } from '@/lib/import/eroeffnungsbestand'
import { standardEroeffnungsStichtag, stichtagText } from '@/lib/kellerbuch/eroeffnungsStichtag'
import { pruefeEroeffnungTank, importiereEroeffnungTank } from '@/app/(dashboard)/kellerbuch/gebinde-actions'
import { pruefeEroeffnungFlaschen, importiereEroeffnungFlaschen } from '@/app/(dashboard)/weinhandel/actions'

/** Zeilen je Server-Aufruf (Laufzeitlimit; die Server-Actions nehmen höchstens 500) */
const BLOCK = 100

type Datei = { name: string; kopf: string[]; zeilen: Record<string, string>[] }
type Ergebnis = { importiert: number; fehler: { zeile: number; titel: string; meldungen: string[] }[] }

const ART_TEXT: Record<EroeffnungsArt, { titel: string; was: string; menge: string; spalteTitel: string }> = {
  tank: { titel: 'Eröffnungsbestand Tank', was: 'je Zeile ein Gebinde mit seiner Charge', menge: 'Menge', spalteTitel: 'Gebinde · Charge' },
  flaschen: { titel: 'Eröffnungsbestand Flaschen', was: 'je Zeile ein Flaschenwein (Füllung ohne Charge)', menge: 'Flaschen', spalteTitel: 'Wein' },
}

export default function EroeffnungImport({ art, herkunft }: { art: EroeffnungsArt; herkunft: string }) {
  const [stichtag, setStichtag] = useState(() => standardEroeffnungsStichtag(wienHeute()))
  const [datei, setDatei] = useState<Datei | null>(null)
  const [befund, setBefund] = useState<DateiBefund<unknown> | null>(null)
  const [laeuft, setLaeuft] = useState<'pruefen' | 'importieren' | null>(null)
  const [fortschritt, setFortschritt] = useState<string | null>(null)
  const [ergebnis, setErgebnis] = useState<Ergebnis | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const t = ART_TEXT[art]
  const felder = felderFuer(art)

  function zuruecksetzen() {
    setBefund(null); setErgebnis(null); setFehler(null)
  }

  async function dateiWaehlen(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    zuruecksetzen()
    try {
      const p = parseCsv(csvDekodieren(await f.arrayBuffer()))
      setDatei({ name: f.name, kopf: p.headers, zeilen: p.rows })
      if (p.rows.length === 0) setFehler('Die Datei enthält keine Datenzeilen (erste Zeile = Spaltenköpfe).')
    } catch (err) {
      setDatei(null)
      setFehler(`Die Datei konnte nicht gelesen werden: ${fehlerText(err)}`)
    }
  }

  async function bloecke<T>(aufruf: (teil: { kopf: string[]; zeilen: Record<string, string>[]; zeilenOffset: number }) => Promise<T>, text: string): Promise<T[]> {
    const aus: T[] = []
    const n = datei!.zeilen.length
    for (let start = 0; start < n; start += BLOCK) {
      setFortschritt(`${text} ${Math.min(start + BLOCK, n)} / ${n}`)
      aus.push(await aufruf({ kopf: datei!.kopf, zeilen: datei!.zeilen.slice(start, start + BLOCK), zeilenOffset: start }))
    }
    return aus
  }

  async function pruefen() {
    if (!datei) return
    setLaeuft('pruefen'); zuruecksetzen()
    try {
      const teile = await bloecke<DateiBefund<unknown>>(
        async teil => art === 'tank' ? await pruefeEroeffnungTank(stichtag, teil) : await pruefeEroeffnungFlaschen(stichtag, teil), 'Prüfe')
      setBefund({
        dateiFehler: [...new Set(teile.flatMap(b => b.dateiFehler))],
        zeilen: teile.flatMap(b => b.zeilen as DateiBefund<unknown>['zeilen']),
      })
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      setLaeuft(null); setFortschritt(null)
    }
  }

  async function importieren() {
    if (!datei || !befund) return
    setLaeuft('importieren'); setErgebnis(null); setFehler(null)
    const summe: Ergebnis = { importiert: 0, fehler: [] }
    try {
      // je Block sofort aufsummieren – bricht ein späterer Block ab, bleibt die Zahl der schon angelegten Zeilen richtig
      await bloecke(async teil => {
        const r = art === 'tank'
          ? await importiereEroeffnungTank(stichtag, teil, herkunft)
          : await importiereEroeffnungFlaschen(stichtag, teil, herkunft)
        summe.importiert += r.importiert
        summe.fehler.push(...r.fehler)
      }, 'Importiere')
      setBefund(null)   // nicht ein zweites Mal importieren
    } catch (err) {
      setBefund(null)   // vor einem neuen Versuch erneut prüfen (bereits angelegte Zeilen meldet die Prüfung)
      setFehler(`${fehlerText(err)}${summe.importiert > 0 ? ` – bereits importierte Zeilen bleiben erhalten (${summe.importiert}); vor einem neuen Versuch bitte erneut prüfen.` : ''}`)
    } finally {
      setErgebnis(summe)
      setLaeuft(null); setFortschritt(null)
    }
  }

  const gueltig = befund?.zeilen.filter(z => z.eingabe).length ?? 0
  const ungueltig = (befund?.zeilen.length ?? 0) - gueltig

  return (
    <div className="space-y-5">
      {/* Anleitung */}
      <div className="bg-s112-blue-50 border border-s112-blue-100 rounded-xl p-4 text-sm text-s112-blue-700 space-y-2">
        <p className="font-semibold">{t.titel}: {t.was}</p>
        <ol className="list-decimal pl-5 space-y-0.5">
          <li>Stichtag wählen (Standard 1.1. des laufenden Jahres).</li>
          <li>CSV-Vorlage laden und in Excel ausfüllen – je Zeile {art === 'tank' ? 'ein Gebinde' : 'ein Wein und eine Flaschengröße'}; die Beispielzeile ersetzen.</li>
          <li>Als „CSV UTF-8 (durch Trennzeichen getrennt)“ speichern und hier wählen.</li>
          <li>„Prüfen“: die Vorschau zeigt jede Zeile – fehlerhafte Zeilen werden nicht importiert.</li>
          <li>„Importieren“ legt die gültigen Zeilen an{art === 'tank' ? ' (Kellerbuch › Gebinde › Eröffnungsbestand)' : ' (Weinlager, als Füllung ohne Charge)'}.</li>
        </ol>
        <p className="text-xs">
          Hinweis: Für den Echtbetrieb ab 01.01.2027 erst nach dem Abräumen der Bewegungsdaten im Dezember verwenden
          (Stichtag 01.01.2027).{art === 'tank' ? ' Das Gebinde muss heute und am Stichtag leer sein.' : ''}
        </p>
        <details className="text-xs">
          <summary className="cursor-pointer font-medium">Spalten der Vorlage</summary>
          <ul className="mt-1 space-y-0.5">
            {felder.map(f => (
              <li key={f.key}><span className="font-medium">{f.kopf}{f.pflicht ? ' *' : ''}</span> – {f.hinweis}</li>
            ))}
          </ul>
        </details>
      </div>

      {/* 1. Stichtag und Vorlage */}
      <div className="bg-white rounded-xl border border-s112-border p-6 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor={`eb-stichtag-${art}`} className="block text-xs font-medium text-s112-text-2 mb-1">Stichtag *</label>
          <input id={`eb-stichtag-${art}`} type="date" value={stichtag} required
            onChange={e => { setStichtag(e.target.value); zuruecksetzen() }}
            className="border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <CsvExportKnopf label="CSV-Vorlage" ariaLabel={`CSV-Vorlage ${t.titel}`} erzeugen={() => vorlageCsv(art)} />
      </div>

      {/* 2. Datei */}
      <div className="bg-white rounded-xl border border-s112-border p-6">
        <h2 className="font-semibold text-s112-text mb-3">CSV-Datei wählen</h2>
        <div className="flex flex-wrap items-center gap-4">
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={dateiWaehlen} className="hidden" aria-label="CSV-Datei" />
          <button type="button" onClick={() => fileRef.current?.click()}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-medium hover:bg-opacity-90">
            CSV-Datei öffnen
          </button>
          {datei && (
            <p className="text-sm text-s112-text-2">
              {datei.name}: {datei.zeilen.length} {datei.zeilen.length === 1 ? 'Zeile' : 'Zeilen'}
            </p>
          )}
          {datei && datei.zeilen.length > 0 && (
            <button type="button" onClick={pruefen} disabled={laeuft !== null || !stichtag}
              className="border border-s112-teal text-s112-blue-700 px-4 py-2 rounded-xl text-sm font-medium hover:bg-s112-bg disabled:opacity-40">
              {laeuft === 'pruefen' ? (fortschritt ?? 'Prüfe…') : `Prüfen (Stichtag ${stichtagText(stichtag)})`}
            </button>
          )}
        </div>
      </div>

      {fehler && (
        <div role="alert" className="p-4 rounded-xl border bg-s112-err-bg border-s112-err/30 text-sm text-s112-err-fg">{fehler}</div>
      )}

      {/* 3. Vorschau */}
      {befund && (
        <div className="bg-white rounded-xl border border-s112-border p-6 space-y-4">
          <h2 className="font-semibold text-s112-text">Vorschau – Stichtag {stichtagText(stichtag)}</h2>
          {befund.dateiFehler.length > 0 ? (
            <ul role="alert" className="text-sm text-s112-err-fg list-disc pl-5">
              {befund.dateiFehler.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          ) : (
            <>
              <p className="text-sm">
                <span className="font-semibold text-s112-ok-fg">{gueltig} gültig</span>
                {ungueltig > 0 && <> · <span className="font-semibold text-s112-err-fg">{ungueltig} fehlerhaft (werden nicht importiert)</span></>}
              </p>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-s112-bg border-b border-s112-border">
                      <th className="text-left px-3 py-2 font-semibold text-s112-text-2">Zeile</th>
                      <th className="text-left px-3 py-2 font-semibold text-s112-text-2">{t.spalteTitel}</th>
                      <th className="text-right px-3 py-2 font-semibold text-s112-text-2">{t.menge}</th>
                      <th className="text-left px-3 py-2 font-semibold text-s112-text-2">Prüfung</th>
                    </tr>
                  </thead>
                  <tbody>
                    {befund.zeilen.map(z => (
                      <tr key={z.zeile} className={`border-b border-s112-border/30 align-top ${z.eingabe ? '' : 'bg-s112-err-bg/40'}`}>
                        <td className="px-3 py-2 tabular-nums text-s112-muted">{z.zeile}</td>
                        <td className="px-3 py-2 text-s112-text">{z.titel}</td>
                        <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{z.menge}</td>
                        <td className="px-3 py-2">
                          {z.eingabe ? <span className="text-s112-ok-fg font-medium">OK</span> : null}
                          {z.fehler.length > 0 && (
                            <ul className="text-s112-err-fg space-y-0.5">{z.fehler.map((f, i) => <li key={i}>{f}</li>)}</ul>
                          )}
                          {z.hinweise.length > 0 && (
                            <ul className="text-s112-warn-fg space-y-0.5 mt-0.5">{z.hinweise.map((h, i) => <li key={i}>Hinweis: {h}</li>)}</ul>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button type="button" onClick={importieren} disabled={laeuft !== null || gueltig === 0}
                className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
                {laeuft === 'importieren' ? (fortschritt ?? 'Importiere…') : `${gueltig} gültige ${gueltig === 1 ? 'Zeile' : 'Zeilen'} importieren`}
              </button>
            </>
          )}
        </div>
      )}

      {/* 4. Ergebnis */}
      {ergebnis && (
        <div role="status" className={`p-4 rounded-xl border ${ergebnis.fehler.length === 0 ? 'bg-s112-ok-bg border-s112-ok/30' : 'bg-s112-warn-bg border-s112-warn/30'}`}>
          <p className="font-semibold text-sm">
            {ergebnis.importiert} importiert{ergebnis.fehler.length > 0 ? ` · ${ergebnis.fehler.length} nicht importiert bzw. mit Hinweis` : ''}
          </p>
          {ergebnis.fehler.length > 0 && (
            <ul className="mt-2 text-xs text-s112-text-2 space-y-0.5">
              {ergebnis.fehler.map((f, i) => <li key={i}>Zeile {f.zeile} ({f.titel}): {f.meldungen.join(' ')}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
