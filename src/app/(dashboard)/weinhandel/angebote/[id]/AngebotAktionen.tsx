'use client'

// KAN-418 Teil 4: Aktionen am offenen Angebot – in einen Auftrag übernehmen, bearbeiten, ablehnen, stornieren.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import StornoButton from '@/components/StornoButton'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import { setzeAngebotStatus } from '../actions'

export default function AngebotAktionen({ id, nummer }: { id: string; nummer: string }) {
  const router = useRouter()
  const [fehler, setFehler] = useState<string | null>(null)
  const [laeuft, setLaeuft] = useState(false)

  async function ablehnen() {
    if (!(await rueckfrage({
      titel: `Angebot ${nummer} als abgelehnt kennzeichnen?`,
      text: 'Der Kunde hat das Angebot nicht angenommen. Es bleibt in der Liste sichtbar, lässt sich aber nicht mehr ändern oder übernehmen.',
      bestaetigen: 'Ablehnen',
    }))) return
    setFehler(null)
    setLaeuft(true)
    try {
      const r = await setzeAngebotStatus(id, 'abgelehnt', '')
      if (r.error) { setFehler(r.error); return }
      zeigeErfolg(`Angebot ${nummer} als abgelehnt gekennzeichnet.`)
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e, 'Das Angebot wurde nicht geändert'))
    } finally {
      setLaeuft(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <Link href={`/weinhandel/auftraege/neu?angebot=${id}`}
          className="bg-s112-teal text-s112-yellow px-5 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
          In Auftrag übernehmen
        </Link>
        <Link href={`/weinhandel/angebote/${id}/bearbeiten`} className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg">
          Bearbeiten
        </Link>
        <button type="button" onClick={ablehnen} disabled={laeuft}
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm hover:bg-s112-bg disabled:opacity-40">
          {laeuft ? 'Speichert…' : 'Ablehnen'}
        </button>
        <StornoButton mitText schwebend label="Angebot stornieren"
          hinweis={`Das Angebot ${nummer} wird storniert (z. B. irrtümlich angelegt). Es bleibt in der Liste sichtbar.`}
          action={async grund => { const r = await setzeAngebotStatus(id, 'storniert', grund); if (r.error) return { error: r.error }; zeigeErfolg(`Angebot ${nummer} storniert.`) }}
          danach={() => router.refresh()} />
      </div>
      {fehler && <p role="alert" className="text-xs text-s112-err-fg">{fehler}</p>}
    </div>
  )
}
