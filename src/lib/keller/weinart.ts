// Weinart-Verträglichkeit beim Umziehen/Verschneiden (21.9.2026) – client-sicher.
//
// Anlass (Musterhof): Zweigelt Reserve ließ sich in den Stahltank mit Grünem Veltliner
// umziehen. Die Sperre „Rot + Weiß“ saß bisher nur im Verschneiden-Schritt, der
// Umzug war da schon gebucht – und die beim Umzug neu angelegte Charge kam ohne
// Weinart („unbekannt“), womit auch die Verschneiden-Sperre ins Leere lief.
//
// Regel: Rot- und Weißwein dürfen laut Weingesetz nicht vermischt werden; Rosé
// entsteht nur aus roten Trauben, also ebenfalls nicht mit Weißwein. Rot + Rosé
// ist zulässig. „unbekannt“/leer wird nicht geprüft (kein Fehlalarm).

export type Weinart = 'rot' | 'weiss' | 'rose' | 'unbekannt'

export const WEINART_LABEL: Record<string, string> = { rot: 'Rotwein', weiss: 'Weißwein', rose: 'Rosé', unbekannt: 'unbekannt' }

export function weinartBekannt(w: string | null | undefined): w is 'rot' | 'weiss' | 'rose' {
  return w === 'rot' || w === 'weiss' || w === 'rose'
}

/** true, wenn zwei Weinarten nicht in ein Gebinde dürfen. */
export function weinartKonflikt(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!weinartBekannt(a) || !weinartBekannt(b) || a === b) return false
  const paar = [a, b].sort().join('+')
  return paar !== 'rose+rot'   // einzige zulässige Mischung verschiedener Arten
}

/** Weinart aus der Rebsortenfarbe ableiten (grau = Weißwein), falls die Charge keine hat. */
export function weinartAusFarbe(farbe: string | null | undefined): Weinart {
  if (farbe === 'rot') return 'rot'
  if (farbe === 'weiss' || farbe === 'grau') return 'weiss'
  return 'unbekannt'
}

export function weinartKonfliktText(quelleName: string, quelleArt: string, zielGebinde: string, zielName: string, zielArt: string): string {
  return `${WEINART_LABEL[quelleArt] ?? quelleArt} und ${WEINART_LABEL[zielArt] ?? zielArt} dürfen laut Weingesetz nicht vermischt werden: „${quelleName}“ kann nicht in ${zielGebinde} umgezogen werden, dort liegt „${zielName}“.`
}
