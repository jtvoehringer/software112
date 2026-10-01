// Löschen mit Rückfall auf Deaktivieren (KAN-150 F1) – für Client-Komponenten: Die Lösch-Action meldet bei Bezug
// { error, deaktivierbar: true }; dann wird „Stattdessen deaktivieren?“ angeboten.

export type LoeschErgebnis = { error?: string; deaktivierbar?: boolean } | void | undefined

export async function loeschenOderDeaktivieren(
  loeschen: () => Promise<LoeschErgebnis>,
  deaktivieren: () => Promise<{ error?: string } | void>,
): Promise<'geloescht' | 'deaktiviert' | 'abgebrochen' | 'fehler'> {
  let r: LoeschErgebnis
  try {
    r = await loeschen()
  } catch (err) {
    alert(`Fehler beim Löschen: ${err instanceof Error ? err.message : String(err)}`)
    return 'fehler'
  }
  if (!r || !r.error) return 'geloescht'
  if (!r.deaktivierbar) {
    alert(`Fehler beim Löschen: ${r.error}`)
    return 'fehler'
  }
  if (!confirm(`${r.error}\n\nStattdessen deaktivieren?`)) return 'abgebrochen'
  const d = await deaktivieren()
  if (d && d.error) {
    alert(d.error)
    return 'fehler'
  }
  return 'deaktiviert'
}
