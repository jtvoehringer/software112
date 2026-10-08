'use client'

// KAN-171: Hinweis und Pflicht-Haken, wenn ein bienengefährliches Mittel in der Blüte (BBCH 60–69) erfasst wird.
// Regel und Texte: lib/behandlungen/bienenschutz.ts (dieselbe Prüfung in der Server Action).

import { BIENENSCHUTZ_BESTAETIGUNG, BIENENSCHUTZ_FELD, BIENENSCHUTZ_HINWEIS, bienenschutzRelevant } from '@/lib/behandlungen/bienenschutz'

export default function BienenschutzHinweis({ bienengefaehrlich, bbch }: { bienengefaehrlich: boolean; bbch: string | null | undefined }) {
  if (!bienenschutzRelevant({ bienengefaehrlich, bbch })) return null
  return (
    <div className="rounded-lg border border-s112-warn/30 bg-s112-warn-bg text-s112-warn-fg px-3 py-2 text-sm space-y-2" role="alert">
      <p><strong>Bienenschutz:</strong> {BIENENSCHUTZ_HINWEIS}</p>
      <label className="flex items-start gap-2">
        <input type="checkbox" name={BIENENSCHUTZ_FELD} value="1" required className="mt-1" />
        <span>{BIENENSCHUTZ_BESTAETIGUNG}</span>
      </label>
    </div>
  )
}
