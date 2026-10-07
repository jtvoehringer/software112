// KAN-112 (03.10.2026): Hinweis nach einem Umzug, der als Verschnitt gebucht wurde – statt der früheren Weiterleitung
// ins Verschneiden-Formular (Zwischencharge). Genutzt von UmziehenClient, UmziehenWidget und dem Assistenten;
// KAN-193: auch nach einem Zukauf, der sofort als Verschnitt gebucht wurde (Zukauf-Formular, `vorgang` = „Zukauf“).

import { HERKUNFT_LABEL } from '@/lib/herkunft'

export type VerschnittHinweisDaten = {
  zielName: string | null
  unterschiede?: readonly string[]
  qualitaetAbgestuft: { von: string; nach: string } | null
  herkunftAbgestuft: { von: string; nach: string } | null
  sortenHinweise?: readonly string[]
  /** KAN-193: Rot/Weiß verschnitten – auf Wein (aus Österreich) abgestuft */
  rotWeiss?: boolean
}

/** Zeilen des Hinweises: „Als Verschnitt in „…“ gebucht …“ (mit `vorgang`: „Zukauf als Verschnitt …“), Abstufungen und Sortenhinweise */
export function verschnittHinweis(v: VerschnittHinweisDaten, vorgang?: string): string[] {
  const n = v.unterschiede?.length ?? 0
  const abweichend = n > 0
    ? ` (abweichend: ${n === 1 ? v.unterschiede![0] : `${v.unterschiede!.slice(0, -1).join(', ')} und ${v.unterschiede![n - 1]}`})`
    : ''
  const zeilen = [`${vorgang ? `${vorgang} als` : 'Als'} Verschnitt in ${v.zielName ? `„${v.zielName}“` : 'die Ziel-Charge'} gebucht${abweichend}.`]
  // KAN-170: ohne Abstufung (alle schon „Wein (ohne Herkunft)“) nur der Vermerk
  if (v.rotWeiss) zeilen.push(v.qualitaetAbgestuft || v.herkunftAbgestuft
    ? 'Abstufung auf Wein (aus Österreich) – Verschnitt Rot/Weiß.'
    : 'Verschnitt Rot/Weiß – bereits Wein (ohne Herkunft), keine Abstufung.')
  if (v.qualitaetAbgestuft) zeilen.push(`Abstufung Qualität von ${v.qualitaetAbgestuft.von} auf ${v.qualitaetAbgestuft.nach}.`)
  if (v.herkunftAbgestuft) {
    const von = HERKUNFT_LABEL[v.herkunftAbgestuft.von] ?? v.herkunftAbgestuft.von
    const nach = HERKUNFT_LABEL[v.herkunftAbgestuft.nach] ?? v.herkunftAbgestuft.nach
    zeilen.push(`Abstufung Herkunft-Code (BKI) von ${von} auf ${nach}.`)
  }
  for (const h of v.sortenHinweise ?? []) zeilen.push(h)
  return zeilen
}
