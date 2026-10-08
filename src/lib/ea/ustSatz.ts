// ── USt-Satz aus Formularen der E&A-Rechnung (KAN-240, 08.10.2026) ────────────────────────────────────────────────
//
// Vorher: parseFloat(...) || 20 – aus dem gewählten „0 % (Export / befreit)“ wurden still 20 %, die UVA wies Umsatzsteuer
// auf steuerfreie Umsätze aus. Jetzt: leer = Standard, sonst nur die österreichischen Sätze 0, 10, 13 und 20 %.
// Isomorph und ohne '@/'-Importe (node:test).

export const UST_SAETZE_AT = [0, 10, 13, 20] as const

/** Satz aus der Formulareingabe; leer → standard; ungültig → null */
export function ustSatzAus(roh: unknown, standard = 20): number | null {
  const s = String(roh ?? '').trim()   // nur ganze Sätze – kein Dezimalkomma nötig
  if (!s) return standard
  const n = Number(s)
  return (UST_SAETZE_AT as readonly number[]).includes(n) ? n : null
}

export const UST_SATZ_FEHLER = 'Bitte einen gültigen USt-Satz wählen (0, 10, 13 oder 20 %).'
