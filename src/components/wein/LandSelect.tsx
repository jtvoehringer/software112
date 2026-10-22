'use client'

// KAN-186 Etappe 2b (02.10.2026): Ursprungsland eines Zukaufs (zukauf_posten.land_iso, FK kat_land) – Österreich
// vorbelegt, Österreich und die EU-Staaten zuerst. Formularfeld land_iso. Die Liste kommt aus kat_land
// (/api/zukauf-stammdaten); solange sie lädt, steht nur der aktuelle Wert zur Wahl.

export type Land = { iso2: string; name_de: string; eu?: boolean | null }

export interface LandSelectProps {
  laender: readonly Land[]
  value: string
  onChange: (iso2: string) => void
  className?: string
  /** KAN-351: nur anzeigen (z. B. Merkmale eines Zukaufs fest) */
  disabled?: boolean
}

export default function LandSelect({ laender, value, onChange, className = 'form-input', disabled = false }: LandSelectProps) {
  const sortiert = [...laender].sort((a, b) =>
    (a.iso2 === 'AT' ? -1 : b.iso2 === 'AT' ? 1 : 0)   // null-vorgabe-ok: Sortier-Vergleich: 0 heißt gleich, dann nächstes Kriterium
    || Number(!!b.eu) - Number(!!a.eu)   // null-vorgabe-ok: Sortier-Vergleich: 0 heißt gleich, dann nächstes Kriterium
    || a.name_de.localeCompare(b.name_de, 'de'))
  const liste = sortiert.some(l => l.iso2 === value) || !value ? sortiert : [{ iso2: value, name_de: value }, ...sortiert]
  return (
    <select name="land_iso" aria-label="Ursprungsland" value={value} onChange={e => onChange(e.target.value)} disabled={disabled} className={className}>
      {liste.length === 0 && <option value={value}>{value === 'AT' ? 'Österreich' : value}</option>}
      {liste.map(l => <option key={l.iso2} value={l.iso2}>{l.name_de}{l.eu && l.iso2 !== 'AT' ? ' (EU)' : ''}</option>)}
    </select>
  )
}
