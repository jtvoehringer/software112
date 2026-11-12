'use client'

// KAN-418 Teil 5 (12.11.2026): Dashboard-Hinweis „Reservierungen abgelaufen“. Eine abgelaufene Reservierung bleibt
// bestehen (Entscheidung Jörgen) – die Flaschen fehlen im verfügbaren Bestand, bis jemand verlängert, liefert,
// abschließt oder storniert. Die Karte erscheint nur, wenn es solche Aufträge gibt. Verlängern direkt hier um die
// Standardfrist des Betriebs (ab heute); Stornieren braucht einen Grund und läuft über den Auftrag.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { abgelaufenText, type AbgelaufeneReservierung } from '@/lib/auftrag/regeln'
import { setzeReservierungBis } from '@/app/(dashboard)/weinhandel/auftraege/actions'

const tag = (s: string) => s.split('-').reverse().join('.')
const MAX_ZEILEN = 8

export default function ReservierungenAbgelaufenKarte({ auftraege, verlaengernBis, fristTage, schreiben, className = '' }: {
  auftraege: AbgelaufeneReservierung[]
  /** heute + Standardfrist des Betriebs (JJJJ-MM-TT) */
  verlaengernBis: string
  fristTage: number
  schreiben: boolean
  className?: string
}) {
  const router = useRouter()
  const [laeuft, setLaeuft] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  if (auftraege.length === 0) return null

  async function verlaengern(a: AbgelaufeneReservierung) {
    setFehler(null)
    setLaeuft(a.id)
    try {
      const r = await setzeReservierungBis(a.id, verlaengernBis)
      if (r.error) { setFehler(`${a.nummer}: ${r.error}`); return }
      zeigeErfolg(`Reservierung ${a.nummer} bis ${tag(verlaengernBis)} verlängert.`)
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e, 'Die Frist wurde nicht gespeichert'))
    } finally {
      setLaeuft(null)
    }
  }

  const zeilen = auftraege.slice(0, MAX_ZEILEN)
  return (
    <div className={`bg-white border border-s112-line rounded-xl overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-3 px-[18px] pt-4 pb-1">
        <h2 className="font-display font-semibold text-[14px] text-s112-text">{abgelaufenText(auftraege.length)}</h2>
        <Link href="/weinhandel/auftraege" className="text-[11.5px] text-s112-blue-700 hover:underline">Aufträge →</Link>
      </div>
      <p className="text-xs text-s112-text-2 px-[18px] pb-3">
        Die Flaschen bleiben reserviert und fehlen im verfügbaren Bestand, bis du verlängerst, lieferst oder den Auftrag stornierst.
      </p>
      {fehler && <p role="alert" className="text-xs text-s112-err-fg px-[18px] pb-2">{fehler}</p>}
      <ul>
        {zeilen.map(a => (
          <li key={a.id} className="flex items-center gap-3 flex-wrap px-[18px] py-[11px] border-t border-[#F2F3F5] text-[13px]">
            <Link href={`/weinhandel/auftraege/${a.id}`} className="font-mono text-s112-blue-700 hover:underline">{a.nummer}</Link>
            <span className="text-s112-text truncate flex-1 min-w-[8rem]">{a.kunde}</span>
            <span className="text-s112-text-2 tabular-nums">{a.offen} Fl. offen</span>
            <span className="text-s112-err-fg tabular-nums" title={`Reserviert bis ${tag(a.reserviertBis)}`}>
              seit {a.tage === 1 ? '1 Tag' : `${a.tage} Tagen`}
            </span>
            {schreiben && (
              <span className="flex items-center gap-2">
                <button type="button" onClick={() => verlaengern(a)} disabled={laeuft !== null}
                  title={`Reservierung bis ${tag(verlaengernBis)} verlängern (${fristTage} Tage ab heute)`}
                  className="border border-s112-border rounded-lg px-2.5 py-1 text-xs hover:bg-s112-bg disabled:opacity-40">
                  {laeuft === a.id ? 'Speichert…' : `Verlängern bis ${tag(verlaengernBis)}`}
                </button>
                <Link href={`/weinhandel/auftraege/${a.id}`} className="text-xs text-s112-blue-700 hover:underline">Stornieren …</Link>
              </span>
            )}
          </li>
        ))}
      </ul>
      {auftraege.length > zeilen.length && (
        <p className="text-xs text-s112-text-2 px-[18px] py-3 border-t border-[#F2F3F5]">
          und {auftraege.length - zeilen.length} weitere – <Link href="/weinhandel/auftraege" className="text-s112-blue-700 hover:underline">alle Aufträge ansehen</Link>
        </p>
      )}
    </div>
  )
}
