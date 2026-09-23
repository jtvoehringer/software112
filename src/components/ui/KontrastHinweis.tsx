'use client'

import { barrierefreieAktionsfarbe, kontrast, KONTRAST_AA } from '@/lib/farbe'

// Hinweis im Branding-Dialog (Barrierefreiheit B2, 23.9.2026): Reicht der Kontrast
// zwischen Aktionsfarbe (Schaltflächen) und Schriftfarbe nicht für WCAG AA (4,5 : 1),
// verwendet die App automatisch eine abgedunkelte Variante desselben Farbtons.
export default function KontrastHinweis({ primary, secondary, onUebernehmen }: {
  primary: string; secondary: string; onUebernehmen?: (farbe: string) => void
}) {
  const k = kontrast(primary, secondary)
  if (k === null) return null
  const ok = k >= KONTRAST_AA
  const vorschlag = ok ? primary : barrierefreieAktionsfarbe(primary, secondary)
  return (
    <div className={`text-xs rounded-lg px-3 py-2 border ${ok ? 'bg-s112-ok-bg border-s112-ok/30 text-s112-ok-fg' : 'bg-s112-warn-bg border-s112-warn/30 text-s112-warn-fg'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold" style={{ background: vorschlag, color: secondary }}>Beispiel-Schaltfläche</span>
        <span>
          Kontrast Schrift auf Primärfarbe: <b>{k.toFixed(1).replace('.', ',')} : 1</b>
          {ok ? ' – gut lesbar (WCAG AA).' : ` – zu gering für kleine Schrift (mind. 4,5 : 1). Die App verwendet automatisch die dunklere Variante ${vorschlag}.`}
        </span>
        {!ok && onUebernehmen && (
          <button type="button" onClick={() => onUebernehmen(vorschlag)} className="underline font-semibold">Variante übernehmen</button>
        )}
      </div>
    </div>
  )
}
