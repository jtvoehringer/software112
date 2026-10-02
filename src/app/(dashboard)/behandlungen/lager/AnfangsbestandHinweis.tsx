'use client'

// KAN-173, Nachtrag 02.10.2026 (Jörgen): ein Anfangsbestand gilt nur zum 1.1. – unterjährig ist ein Zukauf zu buchen,
// außer im Startjahr des Betriebs (Jahr von tenants.created_at), dort ist der Anfangsbestand der Startpunkt.
// Die Buchungsformulare zeigen beim Typ „Anfangsbestand“ mit einem Datum nach dem 1.1. eines Folgejahrs einen Hinweis –
// gesperrt wird nichts. page.tsx stellt das Startjahr über StartJahrKontext bereit.

import { createContext, useContext } from 'react'

export const StartJahrKontext = createContext<number | null>(null)

/** true, wenn ein Anfangsbestand mit diesem Datum in der Jahressicht unter Zukäufe fällt */
export function anfangsbestandUnterjaehrig(datum: string, startJahr: number | null): boolean {
  if (startJahr == null || !/^\d{4}-\d{2}-\d{2}/.test(datum)) return false
  return Number(datum.slice(0, 4)) > startJahr && datum.slice(5, 10) !== '01-01'
}

export function StartJahrRahmen({ startJahr, children }: { startJahr: number | null; children: React.ReactNode }) {
  return <StartJahrKontext.Provider value={startJahr}>{children}</StartJahrKontext.Provider>
}

export default function AnfangsbestandHinweis({ typ, datum }: { typ: string; datum: string }) {
  const startJahr = useContext(StartJahrKontext)
  if (typ !== 'anfangsbestand' || !anfangsbestandUnterjaehrig(datum, startJahr)) return null
  return (
    <p role="note" className="col-span-2 p-2.5 bg-s112-warn-bg border border-s112-warn/30 rounded-lg text-xs text-s112-warn-fg">
      Unterjährig bitte als Einkauf/Zukauf buchen: ein Anfangsbestand gilt nur zum 1.1. – nach dem 1.1.{datum.slice(0, 4)} zählt
      er in der Jahressicht unter Zukäufe („davon Anfangsbestand“).
    </p>
  )
}
