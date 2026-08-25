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
export const NUTZART_OPTIONS = [
  { value: 'A',   label: 'Grünbrache',                                          badge: 'bg-yellow-100 text-yellow-700' },
  { value: 'G',   label: 'Grünlandbrache',                                      badge: 'bg-orange-100 text-orange-600' },
  { value: 'WI',  label: 'Wein',                                                badge: 'bg-green-100 text-green-700' },
  { value: 'GL1', label: 'GLÖZ Rain / Böschung / Trockensteinmauer',            badge: 'bg-teal-100 text-teal-700' },
  { value: 'GL2', label: 'GLÖZ Hecke / Ufergehölz',                             badge: 'bg-teal-100 text-teal-700' },
  { value: 'GL3', label: 'GLÖZ Feldgehölz / Baum- / Gebüschgruppe',             badge: 'bg-teal-100 text-teal-700' },
  // LSE = Landschaftselement. Einzige Nutzart mit zusätzlicher Stückzahl-
  // Erfassung (grundstuecke.lse_stueckzahl) - siehe GrundstueckePanel.tsx.
  { value: 'LSE', label: 'LSE Bäume / Büsche',                                  badge: 'bg-lime-100 text-lime-700' },
]

export function NutzungBadge({ nutzart }: { nutzart: string | null | undefined }) {
  const opt = NUTZART_OPTIONS.find(o => o.value === nutzart)
  if (!opt) {
    return (
      <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400" title="Nutzart noch nicht erfasst">
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
  { value: 'aktiv',       label: 'Ausgepflanzt', badge: 'bg-green-100 text-green-700' },
  { value: 'brache',      label: 'Brache',       badge: 'bg-yellow-100 text-yellow-700' },
  { value: 'gruenbrache', label: 'Grünbrache',   badge: 'bg-orange-100 text-orange-600' },
  { value: 'gerodet',     label: 'Gerodet',      badge: 'bg-gray-200 text-gray-600' },
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
