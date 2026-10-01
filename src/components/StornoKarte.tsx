'use client'

// KAN-150 F2 (01.10.2026): Storno-Abschnitt für Detailseiten (DAC-Antrag, Exportauftrag, Transportbescheinigung,
// Prüfnummernantrag). Nicht storniert: „Stornieren“ (und für Entwürfe ohne Bezug „Entwurf löschen“, nur Betriebsleitung);
// storniert: Vermerk mit Zeitpunkt, Benutzer und Grund sowie „Endgültig löschen“. Die Regeln selbst prüfen Server Action
// und Datenbank – die Karte zeigt nur die passenden Knöpfe.

import { useRouter } from 'next/navigation'
import StornoButton from '@/components/StornoButton'

export type StornoStand = {
  storniert_am: string | null
  storniert_von_name?: string | null
  storno_grund?: string | null
}

interface Props {
  /** z. B. „der Antrag“, „die Transportbescheinigung“ */
  was: string
  stand: StornoStand
  stornieren?: (grund: string) => Promise<void>
  /** Endgültig löschen (storniert) bzw. Entwurf löschen (nicht storniert, nur wenn `entwurfLoeschbar`) */
  loeschen?: (grund: string) => Promise<void>
  entwurfLoeschbar?: boolean
  /** Hinweistext zum Stornieren (was danach gilt) */
  hinweis: string
  /** Ziel nach dem Löschen (sonst router.refresh) */
  nachLoeschen?: string
}

export function stornoVermerk(s: StornoStand): string {
  if (!s.storniert_am) return ''
  return `storniert am ${new Date(s.storniert_am).toLocaleDateString('de-AT')}${s.storniert_von_name ? ` von ${s.storniert_von_name}` : ''}${s.storno_grund ? ` – ${s.storno_grund}` : ''}`
}

export default function StornoKarte({ was, stand, stornieren, loeschen, entwurfLoeschbar, hinweis, nachLoeschen }: Props) {
  const router = useRouter()
  const nachLoeschenGehen = () => { if (nachLoeschen) router.push(nachLoeschen); else router.refresh() }

  if (stand.storniert_am) {
    return (
      <div className="card border-s112-warn/40 bg-s112-warn-bg/40 flex items-start justify-between gap-4 print:hidden">
        <div>
          <p className="text-sm font-semibold text-s112-warn-fg">Storniert</p>
          <p className="text-xs text-s112-text-2 mt-0.5">{stornoVermerk(stand)}</p>
          <p className="text-xs text-s112-muted mt-1">Der Eintrag bleibt als Nachweis stehen und kann nicht mehr geändert werden.</p>
        </div>
        {loeschen && (
          <span className="inline-flex items-center gap-2 text-xs text-s112-muted">
            Endgültig löschen
            <StornoButton modus="loeschen" label="Endgültig löschen" schwebend action={grund => loeschen(grund)} danach={nachLoeschenGehen}
              hinweis="Nur bei Fehleinträgen: Der stornierte Eintrag wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll." />
          </span>
        )}
      </div>
    )
  }

  if (!stornieren && !(loeschen && entwurfLoeschbar)) return null
  return (
    <div className="card flex flex-wrap items-start justify-between gap-4 print:hidden">
      <p className="text-xs text-s112-muted max-w-md">
        Falls {was} zurückgezogen wurde oder fehlerhaft ist: stornieren (mit Grund). Der Eintrag bleibt gekennzeichnet stehen.
      </p>
      <div className="flex items-center gap-4">
        {stornieren && (
          <span className="inline-flex items-center gap-2 text-xs text-s112-muted">
            Stornieren
            <StornoButton schwebend action={grund => stornieren(grund)} danach={() => router.refresh()} hinweis={hinweis} />
          </span>
        )}
        {loeschen && entwurfLoeschbar && (
          <span className="inline-flex items-center gap-2 text-xs text-s112-muted">
            Entwurf löschen
            <StornoButton modus="loeschen" label="Entwurf löschen" schwebend action={grund => loeschen(grund)} danach={nachLoeschenGehen}
              hinweis="Nur für Entwürfe ohne Bezug: Der Entwurf wird entfernt – Grund und Benutzer stehen im Änderungsprotokoll." />
          </span>
        )}
      </div>
    </div>
  )
}
