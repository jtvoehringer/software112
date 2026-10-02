// KAN-187: <option>-Liste für Land-Auswahlfelder aus dem Länderkatalog („Österreich (AT)“), häufige Länder oben.
// aktuell = gespeicherter Wert; steht er nicht im Katalog (Altdaten), erscheint er als „<Wert> (ungültig)“,
// damit das Feld ihn nicht leer anzeigt und beim Speichern unbemerkt überschreibt.
import { landOptionen } from '@/lib/katalog/laender'

export default function LandOptionen({ aktuell }: { aktuell?: string | null }) {
  return (
    <>
      {landOptionen(aktuell).map((o, i) => o.trenner
        ? <option key={`trenner-${i}`} value="" disabled>{o.label}</option>
        : <option key={o.wert} value={o.wert}>{o.label}</option>)}
    </>
  )
}
