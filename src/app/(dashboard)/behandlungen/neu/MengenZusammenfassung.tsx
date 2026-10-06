// Live-Zusammenfassung der Mengenfelder (KAN-133 Soll 8/9) – Anlegen- und Bearbeiten-Formular.

import { AlertTriangle } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import type { MassnahmeMengenErgebnis } from '@/lib/behandlungen/massnahmeMengen'
import { mengenTexte } from './mengenFelder'

/** Live-Zusammenfassung unter den Mengenfeldern: Mittelmenge, Spritzbrühe, Cu, Reinkupfer, Hinweise der Prüfung */
export default function MengenZusammenfassung({ art, pruefung, ha }: { art: string; pruefung: MassnahmeMengenErgebnis; ha: number | null }) {
  const t = mengenTexte(art, pruefung, ha)
  return (
    <div className="bg-s112-bg rounded-lg px-3 py-2 text-xs text-s112-text-2 space-y-1">
      {t && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {ha !== null && <span>Behandelte Fläche: <strong>{fmtNum(ha, { max: 4 })} ha</strong></span>}
          {t.mittel && (
            <span>
              {t.mittelLabel}: <strong>{t.mittel}</strong>
              {t.basis && <span className="text-s112-muted"> ({t.basis})</span>}
            </span>
          )}
          {t.jeHa && <span>≈ <strong>{t.jeHa}</strong></span>}
          {t.bruehe && <span>Spritzbrühe: <strong>{t.bruehe}</strong></span>}
          {t.cu && <span className="text-s112-blue-700">Cu-Eintrag: <strong>{t.cu}</strong></span>}
          {t.reinkupfer && <span className="text-s112-blue-700">Reinkupfer: <strong>{t.reinkupfer}</strong></span>}
        </div>
      )}
      {(pruefung.ok ? pruefung.hinweise : [pruefung.fehler]).map(h => (
        <p key={h} className="text-s112-warn-fg flex items-start gap-1">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />{h}
        </p>
      ))}
    </div>
  )
}
