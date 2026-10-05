// ── Akademische und Berufstitel eines Kontakts (Hotfix 05.10.2026) ──────────────────────────────────────────────────
//
// „Titel“ (vorangestellt) wählt man aus den in Österreich gängigen Titeln; der „nachgestellte Titel“ ist frei
// (BSc, MSc, MBA, PhD, LL.M. …, mehrere mit Komma). Anzeige: „Mag. Maria Muster, MSc“. Formular und Server Action
// prüfen mit denselben Funktionen; die Datenbank begrenzt die Länge (CHECK). Isomorph, ohne '@/'-Importe.

/** Gängige vorangestellte Titel in Österreich (Reihenfolge = Auswahlliste) */
export const TITEL_OPTS = [
  'Dr.', 'DDr.', 'Mag.', 'Mag. (FH)', 'MMag.', 'Dipl.-Ing.', 'DI', 'DI (FH)', 'Ing.', 'Bakk.',
  'Dkfm.', 'Dipl.-Kfm.', 'Dipl.-Päd.', 'Dr. med.', 'Dr. med. univ.', 'Dr. med. dent.', 'Dr. med. vet.', 'Dr. iur.',
  'Prof.', 'Univ.-Prof.', 'Ao. Univ.-Prof.', 'Priv.-Doz.',
  'KR', 'ÖkR', 'HR', 'MR', 'RgR', 'Dir.', 'BM',
] as const

export const TITEL_NACHGESTELLT_MAX = 60
const NACHGESTELLT_RE = /^[\p{L}\p{N} .,()&/-]+$/u

/** Titel aus dem Formular: leer → null; nur Werte der Liste (ein gespeicherter Altwert bleibt erlaubt) */
export function titelAusFormular(roh: unknown, bisher?: string | null): { wert: string | null; fehler: string | null } {
  const t = typeof roh === 'string' ? roh.trim() : ''
  if (!t) return { wert: null, fehler: null }
  if ((TITEL_OPTS as readonly string[]).includes(t) || (bisher && t === bisher)) return { wert: t, fehler: null }
  return { wert: null, fehler: `Der Titel „${t}“ ist nicht in der Auswahl – bitte aus der Liste wählen bzw. als nachgestellten Titel eintragen.` }
}

/** Nachgestellter Titel: frei, Buchstaben, Ziffern, Leerzeichen und . , ( ) & / - – leer → null */
export function titelNachgestelltAusFormular(roh: unknown): { wert: string | null; fehler: string | null } {
  const t = typeof roh === 'string' ? roh.trim().replace(/\s+/g, ' ') : ''
  if (!t) return { wert: null, fehler: null }
  if (t.length > TITEL_NACHGESTELLT_MAX) return { wert: null, fehler: `Der nachgestellte Titel ist zu lang (höchstens ${TITEL_NACHGESTELLT_MAX} Zeichen).` }
  if (!NACHGESTELLT_RE.test(t)) return { wert: null, fehler: `Der nachgestellte Titel „${t}“ enthält unzulässige Zeichen – erlaubt sind Buchstaben, Ziffern, Leerzeichen sowie . , ( ) & / -` }
  return { wert: t, fehler: null }
}

type NameTeile = { titel?: string | null; vorname?: string | null; nachname?: string | null; titel_nachgestellt?: string | null }

/** „Mag. Maria Muster, MSc“ bzw. nach Nachname sortiert „Muster Maria (Mag., MSc)“ */
export function kontaktAnzeigename(k: NameTeile, reihenfolge: 'vorname' | 'nachname' = 'vorname'): string {
  if (reihenfolge === 'nachname') {
    const name = [k.nachname, k.vorname].filter(Boolean).join(' ')
    const titel = [k.titel, k.titel_nachgestellt].filter(Boolean).join(', ')
    return titel ? `${name} (${titel})` : name
  }
  const name = [k.titel, k.vorname, k.nachname].filter(Boolean).join(' ')
  return k.titel_nachgestellt ? `${name}, ${k.titel_nachgestellt}` : name
}
