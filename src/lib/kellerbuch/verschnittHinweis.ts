// KAN-112 (03.10.2026): Hinweis nach einem Umzug, der als Verschnitt gebucht wurde – statt der früheren Weiterleitung
// ins Verschneiden-Formular (Zwischencharge). Genutzt von UmziehenClient, UmziehenWidget und dem Assistenten.

import { HERKUNFT_LABEL } from '@/lib/herkunft'

export type VerschnittHinweisDaten = {
  zielName: string | null
  unterschiede?: readonly string[]
  qualitaetAbgestuft: { von: string; nach: string } | null
  herkunftAbgestuft: { von: string; nach: string } | null
  sortenHinweise?: readonly string[]
}

/** Zeilen des Hinweises: „Als Verschnitt in „…“ gebucht …“, Abstufungen und Sortenhinweise */
export function verschnittHinweis(v: VerschnittHinweisDaten): string[] {
  const n = v.unterschiede?.length ?? 0
  const abweichend = n > 0
    ? ` (abweichend: ${n === 1 ? v.unterschiede![0] : `${v.unterschiede!.slice(0, -1).join(', ')} und ${v.unterschiede![n - 1]}`})`
    : ''
  const zeilen = [`Als Verschnitt in ${v.zielName ? `„${v.zielName}“` : 'die Ziel-Charge'} gebucht${abweichend}.`]
  if (v.qualitaetAbgestuft) zeilen.push(`Abstufung Qualität von ${v.qualitaetAbgestuft.von} auf ${v.qualitaetAbgestuft.nach}.`)
  if (v.herkunftAbgestuft) {
    const von = HERKUNFT_LABEL[v.herkunftAbgestuft.von] ?? v.herkunftAbgestuft.von
    const nach = HERKUNFT_LABEL[v.herkunftAbgestuft.nach] ?? v.herkunftAbgestuft.nach
    zeilen.push(`Abstufung Herkunft-Code (BKI) von ${von} auf ${nach}.`)
  }
  for (const h of v.sortenHinweise ?? []) zeilen.push(h)
  return zeilen
}
