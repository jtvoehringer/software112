'use client'

import { barrierefreieAktionsfarbe, kontrast, kopfleistenFarben, KONTRAST_AA } from '@/lib/farbe'

// Hinweis im Branding-Dialog (Barrierefreiheit B2, 23.9.2026): Reicht der Kontrast
// zwischen Aktionsfarbe (Schaltflächen) und Schriftfarbe nicht für WCAG AA (4,5 : 1),
// verwendet die App automatisch eine abgedunkelte Variante desselben Farbtons.
// KAN-164: Vorschau der Kopfleiste (Primärfarbe als Fläche, Sekundärfarbe als Schrift).
export default function KontrastHinweis({ primary, secondary, name, onUebernehmen }: {
  primary: string; secondary: string; name?: string; onUebernehmen?: (farbe: string) => void
}) {
  const k = kontrast(primary, secondary)
  if (k === null) return null
  const ok = k >= KONTRAST_AA
  const vorschlag = ok ? primary : barrierefreieAktionsfarbe(primary, secondary)
  const kopf = kopfleistenFarben(primary, secondary)
  return (
    <div className="space-y-2">
    <div className="rounded-lg overflow-hidden border border-s112-line">
      <div className="flex items-center gap-3 px-3 h-10" style={{ background: kopf.flaeche, color: kopf.schrift }}>
        <span className="font-display text-[16px] font-light tracking-[.04em]">software:112</span>
        <span className="h-5 border-l" style={{ borderColor: kopf.schrift, opacity: 0.35 }} />
        <span className="font-mono text-[10px] tracking-[.08em] uppercase" style={{ opacity: 0.85 }}>Betrieb</span>
        <span className="text-[13px] truncate">{name || 'Ihr Betrieb'}</span>
      </div>
      <p className="text-[11px] text-s112-tertiary px-3 py-1.5 bg-s112-bg/60">
        Vorschau Kopfleiste{kopf.flaeche.toUpperCase() !== primary.trim().toUpperCase() && kopf.flaeche !== '#2F63AC'
          ? ` – für die Lesbarkeit mit ${kopf.flaeche}` : ''}{kopf.schrift.toUpperCase() !== secondary.trim().toUpperCase() ? `, Schrift ${kopf.schrift === '#FFFFFF' ? 'Weiß' : 'Schwarz'}` : ''}
      </p>
    </div>
    <div role="status" className={`text-xs rounded-lg px-3 py-2 border ${ok ? 'bg-s112-ok-bg border-s112-ok/30 text-s112-ok-fg' : 'bg-s112-warn-bg border-s112-warn/30 text-s112-warn-fg'}`}>
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
    </div>
  )
}
