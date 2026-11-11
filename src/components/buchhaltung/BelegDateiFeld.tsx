'use client'

// KAN-415: Dateifeld „Belege“ im Formular „Neue Buchung“ (Server Action). Prüft Typ, Anzahl und Gesamtgröße schon im
// Browser und meldet den Fehler am Feld (setCustomValidity) – das Formular wird dann nicht abgesendet. Die Server Action
// prüft dasselbe noch einmal (belegDateienFehler).

import { useId, useState } from 'react'
import { BELEG_ACCEPT, belegDateienFehler } from '@/lib/buchhaltung/belegAnhang'

export default function BelegDateiFeld({ name = 'belege' }: { name?: string }) {
  const id = useId()
  const [fehler, setFehler] = useState<string | null>(null)
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-medium text-s112-text-2 mb-1">Belege (optional)</label>
      <input id={id} type="file" name={name} multiple accept={BELEG_ACCEPT} aria-describedby={`${id}-hilfe`}
        onChange={e => {
          const f = belegDateienFehler([...(e.currentTarget.files ?? [])])
          e.currentTarget.setCustomValidity(f ?? '')
          setFehler(f)
        }}
        className="block w-full text-sm border border-s112-border rounded-lg px-3 py-2" />
      <p id={`${id}-hilfe`} className={`text-xs mt-1 ${fehler ? 'text-s112-err-fg' : 'text-s112-muted'}`}>
        {fehler ?? 'PDF, JPEG, PNG oder WebP, zusammen bis 4 MB. Weitere Belege lassen sich später an der Buchung anhängen.'}
      </p>
    </div>
  )
}
