// Stornierte Zahlungen und Umbuchungen in Kassabuch und Kontoabstimmung (KAN-149 D2b, Ticket Soll 6): Die Bewegung
// bleibt an ihrem Tag stehen, am Storno-Tag (Wien) kommt eine Gegenzeile mit umgekehrtem Betrag – so stimmt der
// laufende Saldo an jedem Stichtag, und der ursprüngliche Inhalt bleibt ersichtlich (§ 131 BAO). Reine Summen
// (aktueller Kontosaldo, offene Posten, Liquidität) lassen stornierte Bewegungen einfach weg.
// Isomorph (Client- und Server-Code).

const TAG = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Vienna', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Kalendertag (JJJJ-MM-TT) in Wien zu einem Zeitpunkt (timestamptz) */
export function wienTag(zeitpunkt: string): string {
  return TAG.format(new Date(zeitpunkt))
}

function datumDe(tag: string): string {
  const [j, m, t] = tag.split('-')
  return `${t}.${m}.${j}`
}

export type StornoAngaben = { storniertAm: string | null | undefined; grund?: string | null }

/**
 * Bewegung plus – bei Storno – Gegenzeile am Storno-Tag. `text` ist der Name des Textfelds; die Bewegung bekommt den
 * Vermerk „(storniert am …)“, die Gegenzeile „Storno: … – Grund“, eine eigene id (`<id>:storno`) und den umgekehrten
 * Betrag. `zusatz` setzt Felder der Gegenzeile (z. B. abgeglichen: false, gesperrt: true).
 */
export function mitStornoGegenzeile<T extends { id: string; datum: string; betrag: number }>(
  b: T, storno: StornoAngaben, text: keyof T, zusatz: Partial<T> = {},
): T[] {
  if (!storno.storniertAm) return [b]
  const tag = wienTag(storno.storniertAm)
  const t = String(b[text] ?? '')
  return [
    { ...b, [text]: `${t} (storniert am ${datumDe(tag)})` },
    {
      ...b,
      ...zusatz,
      id: `${b.id}:storno`,
      datum: tag,
      betrag: -b.betrag,
      [text]: `Storno: ${t}${storno.grund ? ` – ${storno.grund}` : ''}`,
    },
  ]
}
