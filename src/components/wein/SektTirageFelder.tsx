'use client'

// KAN-190 (07.10.2026): Füllung zur Zweitgärung (Tirage) – Gärmethode und Datum des Beginns der Zweitgärung (Stichtag der
// Hefelagerung). Leer = keine Zweitgärung im Betrieb (z. B. fertiger Sekt aus Lohnversektung). Formularfelder
// `gaermethode`, `tirage_datum`; die Server Action prüft mit tirageAusFormular() (lib/wein/sekt.ts).

import { GAERMETHODEN } from '@/lib/wein/sekt'
import { wienHeute } from '@/lib/csv'

export default function SektTirageFelder({ feldKlasse = 'form-input', labelKlasse = 'form-label' }: { feldKlasse?: string; labelKlasse?: string }) {
  return (
    <div className="sm:col-span-2 rounded-xl border border-s112-line p-3 space-y-2">
      <p className="text-xs text-s112-text-2">
        <strong>Sekt g.U. – Zweitgärung (Tirage):</strong> Gärmethode und Beginn der Zweitgärung angeben, wenn die Hefelagerung im
        Betrieb stattfindet. Ab diesem Tag zählt die Hefelagerung für Sekt Austria (9 Monate), Reserve (18) und Große Reserve (36).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label htmlFor="sekt-gaermethode" className={labelKlasse}>Gärmethode</label>
          <select id="sekt-gaermethode" name="gaermethode" defaultValue="" className={feldKlasse}>
            <option value="">– keine Zweitgärung im Betrieb –</option>
            {GAERMETHODEN.map(g => <option key={g.value} value={g.value}>{g.label}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="sekt-tirage" className={labelKlasse}>Tirage (Beginn der Zweitgärung)</label>
          {/* Sweep 120: tirageAusFormular() lehnt ein Datum in der Zukunft ab */}
          <input id="sekt-tirage" name="tirage_datum" type="date" max={wienHeute()} className={feldKlasse} />
          <p className="text-[11px] text-s112-muted mt-1">Leer = Datum der Füllung (Flaschengärung).</p>
        </div>
      </div>
    </div>
  )
}
