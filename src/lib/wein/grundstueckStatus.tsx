// ──────────────────────────────────────────────────────────────────────────
// Rückmeldung 24.8.2026: "Status" wurde durch "Nutzart"/"Nutzung" abgelöst.
//
// STATUS_OPTIONS/StatusBadge (unten) sind DEPRECATED und werden nirgends
// mehr verwendet - grundstuecke.status wird nicht mehr gepflegt (bestehende
// Werte wurden per Migration 171 gelöscht/auf NULL gesetzt), die Spalte
// bleibt aber in der DB bestehen (kein Breaking Change für evtl. externe
// Auswertungen). Bewusst nicht gelöscht, nur nicht mehr verdrahtet, falls
// doch noch irgendwo referenziert.
//
// NUTZART_OPTIONS/NutzungBadge (neu) sind die einzige Quelle für die
// "Nutzung"-Anzeige (vormals "Status") UND für die zugehörige
// Geschäftslogik (Ernte-Meldung, Behandlungsplanung/Spritzbar, KI-Assistent,
// Zukauf-Flächensumme - alle umgestellt von status==='aktiv' auf
// nutzart==='WI'). Werte entsprechen dem CHECK-Constraint auf
// grundstuecke.nutzart (Migration 170_ried_ama_codes_gst_nutzart.sql,
// erweitert um GL1/GL2/GL3 in Migration 176_nutzart_gloez_codes.sql und um
// LSE in Migration 177_nutzart_lse.sql):
// 'A' | 'G' | 'WI' | 'GL1' | 'GL2' | 'GL3' | 'LSE'.
import { NUTZART_OPTIONS } from './nutzart'
export { NUTZART_OPTIONS }

export function NutzungBadge({ nutzart }: { nutzart: string | null | undefined }) {
  const opt = NUTZART_OPTIONS.find(o => o.value === nutzart)
  if (!opt) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-[#F2F3F5] text-s112-tertiary" title="Nutzart noch nicht erfasst">
        – offen –
      </span>
    )
  }
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${opt.badge}`}>
      {opt.label}
    </span>
  )
}

/** @deprecated Ersetzt durch NUTZART_OPTIONS/NutzungBadge, siehe Kommentar oben. */
export const STATUS_OPTIONS = [
  { value: 'aktiv',       label: 'Ausgepflanzt', badge: 'bg-s112-ok-bg text-s112-ok-fg' },
  { value: 'brache',      label: 'Brache',       badge: 'bg-s112-warn-bg text-s112-warn-fg' },
  { value: 'gruenbrache', label: 'Grünbrache',   badge: 'bg-s112-warn-bg text-s112-warn-fg' },
  { value: 'gerodet',     label: 'Gerodet',      badge: 'bg-s112-line text-s112-text-2' },
]

/** @deprecated Ersetzt durch NutzungBadge, siehe Kommentar oben. */
export function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0]
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${opt.badge}`}>
      {opt.label}
    </span>
  )
}
