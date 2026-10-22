// ── Fehlermeldung am Formular bzw. an der Liste (KAN-359, 22.10.2026) ──
// Muster „Fehler“ aus docs/Meldungskonzept.md: der Text steht dort, wo die Aktion war – nicht in einem Browser-Dialog
// (alert) und nicht im Pop-up. role="alert" lässt ihn vorlesen; liegt er nach einer Aktion außer Sicht, zeigt
// MeldungsPopup den Hinweis „Zur Meldung“. Ohne Text rendert die Komponente nichts.

export default function FehlerMeldung({ text, className = '' }: { text: string | null | undefined | false; className?: string }) {
  if (!text) return null
  return (
    <div role="alert" className={`rounded-lg border border-s112-err/30 bg-s112-err-bg px-4 py-2.5 text-sm text-s112-err-fg whitespace-pre-line break-words ${className}`}>
      {text}
    </div>
  )
}
