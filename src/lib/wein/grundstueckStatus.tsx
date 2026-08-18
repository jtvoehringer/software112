// Gemeinsame Definition des Grundstück-Status – bisher nur lokal in
// GrundstueckePanel.tsx dupliziert, jetzt zusätzlich in der Rieden-Übersicht
// (WeingartenBaum.tsx) verwendet. Einheitliche Anzeige an beiden Stellen
// statt zweier unabhängig gepflegter Kopien.
//
// Werte entsprechen dem CHECK-Constraint auf grundstuecke.status (Migration
// 013_lagen.sql, erweitert in 116_grundstuecke_status_gruenbrache.sql):
// 'aktiv' | 'brache' | 'gruenbrache' | 'gerodet'. 'gerodet' wird hier bewusst
// mitgeführt (fällt sonst auf den 'aktiv'-Fallback zurück und würde eine
// dauerhaft entfernte Fläche fälschlich als bewirtschaftet anzeigen), auch
// wenn es aktuell in keinem Formular aktiv auswählbar ist.
export const STATUS_OPTIONS = [
  { value: 'aktiv',       label: 'Ausgepflanzt', badge: 'bg-green-100 text-green-700' },
  { value: 'brache',      label: 'Brache',       badge: 'bg-yellow-100 text-yellow-700' },
  { value: 'gruenbrache', label: 'Grünbrache',   badge: 'bg-orange-100 text-orange-600' },
  { value: 'gerodet',     label: 'Gerodet',      badge: 'bg-gray-200 text-gray-600' },
]

export function StatusBadge({ status }: { status: string }) {
  const opt = STATUS_OPTIONS.find(o => o.value === status) ?? STATUS_OPTIONS[0]
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${opt.badge}`}>
      {opt.label}
    </span>
  )
}
