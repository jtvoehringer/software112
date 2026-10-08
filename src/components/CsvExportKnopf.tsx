'use client'

// ── CSV-Export-Knopf für Behördenmeldungen (24.09.2026) ──────────────────────
//
// Zwei Arten:
//   <CsvExportKnopf href={csvPfad('erntemeldung', { jahrgang })} />
//       Server-CSV aus der zentralen Route /meldungen/<id>/csv (Regelfall); ebenso die
//       Datenexporte <CsvExportKnopf href="/api/export/kontakte" /> (KAN-54, keine Behördenmeldung –
//       eine leere Datei heißt dort nicht „Leermeldung“)
//   <CsvExportKnopf erzeugen={() => ({ text: csvText(zeilen, SPALTEN), dateiname: csvDateiname([...]).utf8 })} />
//       reine Client-Liste (Text mit csvText() aus lib/csv erzeugen)
//
// Der Knopf lädt per fetch (no-store), zeigt Fehler aus der JSON-Antwort { fehler },
// erkennt die Login-/Zwei-Faktor-Umleitung des Proxys, lädt die Datei als Blob herunter
// (Anker im DOM, URL erst verzögert freigeben – Safari/Firefox brechen sonst ab) und
// meldet Leermeldung (X-Zeilen: 0) und Hinweise (X-Warnungen, URI-kodiert).
// Importiert bewusst nichts aus lib/auth/roles (server-only).
// Einzige Stelle außerhalb von src/lib/csv mit Blob/'text/csv' (Ausnahme im Prüfskript).

import { useEffect, useRef, useState } from 'react'

export type CsvErzeugt = { text: string; dateiname: string; zeilen?: number; warnungen?: string[] }

type Gemeinsam = {
  label?: string
  className?: string
  /** Zugänglicher Name, wenn mehrere Knöpfe gleich heißen (z. B. „CSV exportieren: Kupfer-Bilanz“) */
  ariaLabel?: string
  /** Tooltip statt des Excel-Hinweises (z. B. BKI-Datenblatt: Maschinen-Upload) */
  hinweis?: string
}
export type CsvExportKnopfProps =
  // KAN-120: methode 'POST' für Exporte mit Protokoll (Seiteneffekt nur per POST); nachErfolg z. B. router.refresh()
  | (Gemeinsam & { href: string; erzeugen?: undefined; methode?: 'GET' | 'POST'; nachErfolg?: () => void })
  | (Gemeinsam & { erzeugen: () => CsvErzeugt | Promise<CsvErzeugt>; href?: undefined })

type Meldung = { typ: 'ok' | 'hinweis' | 'fehler'; text: string; details?: string[] }

const KNOPF = 'text-xs bg-[#F2F3F5] hover:bg-s112-line text-s112-text-2 font-medium px-3 py-1.5 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-wait'
const EXCEL_TIPP = 'CSV für Excel (Semikolon, UTF-8). Codes mit führenden Nullen (KG-Nr., BBCH) exakt übernehmen: in Excel „Daten › Aus Text/CSV“ und die Spalte als Text importieren.'

function dekodieren(wert: string | null): string {
  if (!wert) return ''
  try { return decodeURIComponent(wert) } catch { return wert }
}

function herunterladen(blob: Blob, dateiname: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = dateiname
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/** meldung = Behördenmeldung über die zentrale Route (dort heißt eine leere Datei „Leermeldung“) */
function ergebnisMeldung(dateiname: string, zeilen: number | null, warnungen: string[], anzahlWarnungen: number, meldung: boolean): Meldung {
  const leer = zeilen === 0
  const basis = leer
    ? (meldung
      ? `Leermeldung erstellt: ${dateiname} – keine Datensätze, die Datei enthält nur die Kopfzeile.`
      : `Keine Datensätze – ${dateiname} enthält nur die Spaltenköpfe.`)
    : `CSV erstellt: ${dateiname}${zeilen !== null ? ` (${zeilen} ${zeilen === 1 ? 'Zeile' : 'Zeilen'})` : ''}.`
  if (anzahlWarnungen === 0) return { typ: leer ? 'hinweis' : 'ok', text: basis }
  const mehr = anzahlWarnungen - warnungen.length
  return {
    typ: 'hinweis',
    text: `${basis} ${anzahlWarnungen} ${anzahlWarnungen === 1 ? 'Hinweis' : 'Hinweise'} – bitte prüfen:`,
    details: mehr > 0 ? [...warnungen, `… und ${mehr} weitere`] : warnungen,
  }
}

export default function CsvExportKnopf(props: CsvExportKnopfProps) {
  const [laedt, setLaedt] = useState(false)
  const [meldung, setMeldung] = useState<Meldung | null>(null)
  const aktiv = useRef(true)
  useEffect(() => () => { aktiv.current = false }, [])

  async function vomServer(href: string): Promise<Meldung> {
    const res = await fetch(href, { method: (props.href !== undefined && props.methode) || 'GET', cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'text/csv, application/json' } })
    const typ = res.headers.get('Content-Type') ?? ''
    if (res.redirected && new URL(res.url, window.location.href).pathname === '/zwei-faktor') {
      return { typ: 'fehler', text: 'Bitte zuerst den Zwei-Faktor-Code bestätigen und den Export danach erneut starten.' }
    }
    if (res.redirected || (res.ok && !typ.startsWith('text/csv'))) {
      return { typ: 'fehler', text: 'Sitzung abgelaufen – bitte neu anmelden und den Export erneut starten.' }
    }
    if (!res.ok) {
      const j = (await res.json().catch(() => null)) as { fehler?: unknown } | null
      const text = typeof j?.fehler === 'string' && j.fehler.trim() ? j.fehler : `Export fehlgeschlagen (HTTP ${res.status}).`
      return { typ: 'fehler', text }
    }
    const blob = await res.blob()
    const dateiname = dekodieren(res.headers.get('X-Dateiname')) || 'Export.csv'
    const zeilenKopf = res.headers.get('X-Zeilen')
    const zeilen = zeilenKopf !== null && /^\d+$/.test(zeilenKopf) ? Number(zeilenKopf) : null
    const warnungen = dekodieren(res.headers.get('X-Warnungen')).split('\n').map(w => w.trim()).filter(Boolean)
    const anzahl = Math.max(Number(res.headers.get('X-Warnungen-Anzahl')) || 0, warnungen.length)
    herunterladen(blob, dateiname)
    if (props.href !== undefined) props.nachErfolg?.()
    return ergebnisMeldung(dateiname, zeilen, warnungen, anzahl, href.startsWith('/meldungen/'))
  }

  async function imBrowser(erzeugen: () => CsvErzeugt | Promise<CsvErzeugt>): Promise<Meldung> {
    const e = await erzeugen()
    herunterladen(new Blob([e.text], { type: 'text/csv;charset=utf-8' }), e.dateiname)
    const warnungen = e.warnungen ?? []
    return ergebnisMeldung(e.dateiname, e.zeilen ?? null, warnungen, warnungen.length, false)
  }

  async function starten() {
    if (laedt) return
    setLaedt(true)
    setMeldung(null)
    let m: Meldung
    try {
      m = props.href !== undefined ? await vomServer(props.href) : await imBrowser(props.erzeugen)
    } catch (e) {
      // fetch() wirft bei Netzwerkfehlern einen TypeError mit englischem Browsertext
      m = props.href !== undefined && e instanceof TypeError
        ? { typ: 'fehler', text: 'Keine Verbindung zum Server – bitte Internetverbindung prüfen und den Export erneut starten.' }
        : { typ: 'fehler', text: 'Die CSV-Datei konnte nicht erstellt werden – bitte erneut versuchen.' }
    }
    if (!aktiv.current) return
    setMeldung(m)
    setLaedt(false)
  }

  const farbe = meldung?.typ === 'ok' ? 'text-s112-ok-fg' : meldung?.typ === 'hinweis' ? 'text-s112-warn-fg' : 'text-s112-err-fg'

  return (
    <div className={`inline-flex flex-col items-start gap-1 print:hidden ${props.className ?? ''}`}>
      <button type="button" onClick={starten} disabled={laedt} aria-busy={laedt} aria-label={props.ariaLabel} title={props.hinweis ?? EXCEL_TIPP} className={KNOPF}>
        {laedt ? 'Wird erstellt …' : (props.label ?? 'CSV exportieren')}
      </button>
      <div role="status" aria-live="polite" className={`text-xs max-w-md ${farbe}`}>
        {meldung && meldung.typ !== 'fehler' && (
          <>
            {meldung.text}
            {meldung.details && meldung.details.length > 0 && (
              <ul className="list-disc pl-4 mt-0.5 space-y-0.5">
                {meldung.details.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            )}
          </>
        )}
      </div>
      {meldung?.typ === 'fehler' && <div role="alert" className="text-xs max-w-md text-s112-err-fg">{meldung.text}</div>}
    </div>
  )
}
