'use client'

// KAN-176 (07.10.2026): Lieferadressen eines Kontakts bzw. einer Firma – Liste, anlegen, bearbeiten, (de)aktivieren.
// Verwendet auf den CRM-Detailseiten; Auswahl beim Verkauf siehe weinhandel/verkauf/neu.

import { useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { MapPin, Pencil } from 'lucide-react'
import { lieferadresseAktivSetzen, lieferadresseSpeichern } from '@/app/(dashboard)/crm/actions'
import { lieferadresseKurz } from '@/lib/crm/lieferadressen'

export type LieferadresseZeile = {
  id: string; bezeichnung: string | null; empfaenger: string | null; strasse: string; plz: string; ort: string; land: string
  notizen: string | null; aktiv: boolean
}

const inp = 'input w-full py-2.5 sm:py-2 text-base sm:text-sm'

export default function LieferadressenKarte({ adressen, kontaktId, firmaId, writeOk }: {
  adressen: LieferadresseZeile[]
  kontaktId?: string | null
  firmaId?: string | null
  writeOk: boolean
}) {
  const router = useRouter()
  const pfad = usePathname()
  const [laeuft, starte] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [bearbeiten, setBearbeiten] = useState<LieferadresseZeile | 'neu' | null>(null)
  const a = bearbeiten !== null && bearbeiten !== 'neu' ? bearbeiten : null
  const sortiert = [...adressen].sort((x, y) => Number(y.aktiv) - Number(x.aktiv))

  function speichern(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setFehler(null)
    starte(async () => {
      const r = await lieferadresseSpeichern(fd)
      if (r.error) { setFehler(r.error); return }
      setBearbeiten(null)
      router.refresh()
    })
  }
  function umschalten(z: LieferadresseZeile) {
    setFehler(null)
    starte(async () => {
      const r = await lieferadresseAktivSetzen(z.id, !z.aktiv, pfad)
      if (r.error) setFehler(r.error)
      else router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-s112-text flex items-center gap-1.5"><MapPin className="w-4 h-4" aria-hidden /> Lieferadressen</h3>
        {writeOk && bearbeiten === null && (
          <button type="button" onClick={() => { setFehler(null); setBearbeiten('neu') }} className="text-xs text-s112-blue-700 hover:underline">+ Lieferadresse</button>
        )}
      </div>
      {fehler && <p role="alert" className="text-xs bg-s112-err-bg text-s112-err-fg rounded-lg px-2 py-1.5">{fehler}</p>}
      {sortiert.length === 0 && bearbeiten === null && (
        <p className="text-xs text-s112-muted">Keine weiteren Lieferadressen – geliefert wird an die Rechnungsadresse.</p>
      )}
      <ul className="space-y-1.5">
        {sortiert.map(z => (
          <li key={z.id} className={`text-sm flex items-start justify-between gap-2 ${z.aktiv ? '' : 'opacity-50'}`}>
            <span className="min-w-0">
              {lieferadresseKurz(z)}
              {z.empfaenger && <span className="block text-xs text-s112-muted">z. H. {z.empfaenger}</span>}
              {!z.aktiv && <span className="text-xs text-s112-muted"> (deaktiviert)</span>}
            </span>
            {writeOk && (
              <span className="flex items-center gap-1 shrink-0">
                <button type="button" aria-label={`Lieferadresse ${lieferadresseKurz(z)} bearbeiten`} disabled={laeuft}
                  onClick={() => { setFehler(null); setBearbeiten(z) }} className="text-s112-muted hover:text-s112-blue-700 p-1">
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button type="button" disabled={laeuft} onClick={() => umschalten(z)} className="text-xs text-s112-muted hover:text-s112-text-2 px-1">
                  {z.aktiv ? 'Deaktivieren' : 'Aktivieren'}
                </button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {writeOk && bearbeiten !== null && (
        <form key={a?.id ?? 'neu'} onSubmit={speichern} className="rounded-xl border border-s112-line p-3 space-y-2">
          {a && <input type="hidden" name="id" value={a.id} />}
          {!a && kontaktId && <input type="hidden" name="kontakt_id" value={kontaktId} />}
          {!a && firmaId && <input type="hidden" name="firma_id" value={firmaId} />}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div><label htmlFor="la-bez" className="block text-xs text-s112-text-2 mb-0.5">Bezeichnung</label>
              <input id="la-bez" name="bezeichnung" defaultValue={a?.bezeichnung ?? ''} placeholder="z. B. Lager, Filiale Wien" className={inp} /></div>
            <div><label htmlFor="la-empf" className="block text-xs text-s112-text-2 mb-0.5">Empfänger (z. H.)</label>
              <input id="la-empf" name="empfaenger" defaultValue={a?.empfaenger ?? ''} className={inp} /></div>
            <div className="sm:col-span-2"><label htmlFor="la-str" className="block text-xs text-s112-text-2 mb-0.5">Straße und Hausnummer *</label>
              <input id="la-str" name="strasse" required defaultValue={a?.strasse ?? ''} className={inp} /></div>
            <div><label htmlFor="la-plz" className="block text-xs text-s112-text-2 mb-0.5">PLZ *</label>
              <input id="la-plz" name="plz" required defaultValue={a?.plz ?? ''} className={inp} /></div>
            <div><label htmlFor="la-ort" className="block text-xs text-s112-text-2 mb-0.5">Ort *</label>
              <input id="la-ort" name="ort" required defaultValue={a?.ort ?? ''} className={inp} /></div>
            <div><label htmlFor="la-land" className="block text-xs text-s112-text-2 mb-0.5">Land (ISO, z. B. AT, DE)</label>
              <input id="la-land" name="land" defaultValue={a?.land ?? 'AT'} className={inp} /></div>
          </div>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={laeuft} className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50">Speichern</button>
            <button type="button" onClick={() => setBearbeiten(null)} className="text-sm text-s112-muted hover:text-s112-text-1">Abbrechen</button>
          </div>
        </form>
      )}
    </div>
  )
}
