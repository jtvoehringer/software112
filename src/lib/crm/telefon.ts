// Telefonnummern in das Speicherformat von software:112 zerlegen:
//   telefon_vorwahl = Landesvorwahl ("+49"), telefon = nationale Nummer ohne
//   führende 0, ohne Klammern/Schrägstriche ("36041 42895").
// Anzeige überall als `${vorwahl} ${telefon}` (Kontakt-/Firmenkarten, Detail,
// Besuchsplanung, Exporte). Rückmeldung 3.9.2026 nach dem Dynamics-Import:
// Nummern kamen als "+49 (36041) 428 95" komplett ins Feld telefon, die
// Vorwahl blieb auf dem Default +43 -> Anzeige "+43 +49 (36041) 428 95".
//
// Bewusst frei von Server-Imports (wird vom Import-API und ggf. Formularen genutzt).

import { DIAL_CODES } from '@/lib/crm/types'

// Landesvorwahlen, längste zuerst (damit +420 vor +42x/+4 gewinnt). Die Liste
// deckt DIAL_CODES ab und ergänzt Vorwahlen, die im Formular nicht angeboten
// werden, aber in Importen vorkommen können.
const ALLE_VORWAHLEN: string[] = Array.from(new Set([
  ...DIAL_CODES.map(d => d.code),
  '+1', '+7', '+20', '+27', '+30', '+31', '+32', '+33', '+34', '+36', '+39', '+40', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49',
  '+51', '+52', '+53', '+54', '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63', '+64', '+65', '+66', '+81', '+82', '+84', '+86', '+90', '+91', '+92', '+94', '+95', '+98',
  '+212', '+216', '+230', '+234', '+248', '+254', '+351', '+352', '+353', '+354', '+355', '+356', '+357', '+358', '+359', '+370', '+371', '+372', '+373', '+374', '+375', '+377', '+380', '+381', '+385', '+386', '+387', '+389',
  '+420', '+421', '+423', '+506', '+507', '+598', '+673', '+852', '+853', '+855', '+856', '+880', '+886', '+960', '+965', '+966', '+968', '+971', '+972', '+973', '+974', '+977', '+994', '+995',
])).sort((a, b) => b.length - a.length)

const ISO_ZU_VORWAHL: Record<string, string> = Object.fromEntries(DIAL_CODES.map(d => [d.iso, d.code]))
ISO_ZU_VORWAHL.CA = '+1'

export const STANDARD_VORWAHL = '+43'

/** Landesvorwahl zu einem ISO-Ländercode (Fallback +43). */
export function vorwahlFuerLand(land: string | null | undefined): string {
  return ISO_ZU_VORWAHL[(land ?? '').toUpperCase()] ?? STANDARD_VORWAHL
}

/**
 * Zerlegt eine Rohnummer in Vorwahl + nationale Nummer.
 *  - "+49 (36041) 428 95"  -> { vorwahl: '+49', nummer: '36041 428 95' }
 *  - "0043 1 5121875"      -> { vorwahl: '+43', nummer: '1 5121875' }
 *  - "02236 / 61541" (Land AT) -> { vorwahl: '+43', nummer: '2236 61541' }
 *  - "+43 (0)664 123"      -> { vorwahl: '+43', nummer: '664 123' }
 * Leere/unbrauchbare Eingabe -> nummer null.
 */
export function zerlegeTelefon(roh: string | null | undefined, land?: string | null): { vorwahl: string; nummer: string | null } {
  let t = (roh ?? '').toString().trim()
  if (!t) return { vorwahl: vorwahlFuerLand(land), nummer: null }
  t = t.replace(/^\s*00/, '+').replace(/^\+\s+/, '+')

  let vorwahl = vorwahlFuerLand(land)
  if (t.startsWith('+')) {
    const kompakt = '+' + t.slice(1).replace(/[^\d]/g, '')
    const treffer = ALLE_VORWAHLEN.find(v => kompakt.startsWith(v))
    if (treffer) {
      vorwahl = treffer
      // Vorwahl-Ziffern vorne aus dem Original entfernen (Leerzeichen/Klammern dazwischen erlaubt)
      let rest = t.slice(1)
      for (const z of treffer.slice(1)) {
        const i = rest.indexOf(z)
        rest = i >= 0 ? rest.slice(i + 1) : rest
      }
      t = rest
    } else {
      t = t.slice(1)
    }
  }

  // Doppelte Vorwahl ("+43 +43 463 …") -> Rest nochmal zerlegen
  if (t.trim().startsWith('+')) {
    const nochmal = zerlegeTelefon(t.trim(), land)
    return { vorwahl: nochmal.vorwahl, nummer: nochmal.nummer }
  }

  // "(0)" als Trunk-Präfix, Klammern, Schrägstriche, Bindestriche, Punkte raus
  let n = t.replace(/\(\s*0\s*\)/g, ' ').replace(/[()\/\-.]/g, ' ').replace(/\s+/g, ' ').trim()
  // führende Null(en) der nationalen Nummer entfernen ("0" oder "00")
  n = n.replace(/^0+\s*/, '').trim()
  // Nummer ohne "+" aber mit Landesvorwahl vorne ("60126557710" bei Land MY,
  // "43552362755" bei AT): Vorwahl abtrennen, wenn die Ziffern damit beginnen
  // und die Nummer dafür lang genug ist.
  const ziffern = n.replace(/\D/g, '')
  const vwZiffern = vorwahl.slice(1)
  if (!roh?.toString().trim().startsWith('+') && ziffern.length >= 10 && ziffern.startsWith(vwZiffern)) {
    let rest = n
    for (const z of vwZiffern) { const i = rest.indexOf(z); rest = i >= 0 ? rest.slice(i + 1) : rest }
    n = rest.replace(/^[\s0]+/, '').trim()
  }
  if (!/\d/.test(n)) return { vorwahl, nummer: null }
  return { vorwahl, nummer: n }
}
