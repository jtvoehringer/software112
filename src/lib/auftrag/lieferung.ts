// ── Lieferung aus dem Auftrag (KAN-418 Teil 2, 12.11.2026) ──────────────────────────────────────────────────────────
//
// „Liefern“ am Auftrag öffnet das Verkaufsformular mit Kunde und offenen Mengen. Der Verkauf ist ein normaler Verkauf
// (Lieferschein bzw. Rechnung sofort, Preise von heute); die gelieferten Flaschen werden vor der Bestandsbuchung am
// Auftrag vermerkt (s112_auftrag_liefern) – so verbraucht die Lieferung ihre eigene Reservierung.
// Entscheidungen Jörgen 12.11.2026: Storno des Verkaufs öffnet den Auftrag wieder (1A); „Abschließen“ gibt den Rest
// frei (2A); je Auftragsposition höchstens die offene Menge, Mehrmenge als freie Position (3A).
// Dieselben Regeln in Formular, Server Action und Datenbank. Isomorph, ohne '@/'-Importe.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Status, in denen sich ein Auftrag liefern lässt */
export const LIEFERBAR_STATUS: readonly string[] = ['offen', 'teilgeliefert']

export type AuftragZeile = { id: string; fuellung_id: string; name: string; menge: number; geliefert?: number | null }

/** Noch nicht gelieferte Flaschen einer Auftragsposition */
export function offeneMenge(p: { menge: number; geliefert?: number | null }): number {
  return Math.max(0, (Number(p.menge) || 0) - (Number(p.geliefert) || 0))
}

export type LieferVorschlag = { position_id: string; fuellung_id: string; name: string; offen: number }

/** Vorbelegung des Verkaufsformulars: je Auftragsposition die offene Menge (ganz gelieferte fallen weg) */
export function lieferVorschlag(positionen: readonly AuftragZeile[]): LieferVorschlag[] {
  return positionen
    .map(p => ({ position_id: p.id, fuellung_id: p.fuellung_id, name: p.name, offen: offeneMenge(p) }))
    .filter(p => p.offen > 0)
}

/** Auftrags-ID aus Adresszeile bzw. Formular; '' = kein (gültiger) Bezug */
export function auftragIdAus(roh: unknown): string {
  const t = typeof roh === 'string' ? roh.trim() : ''
  return UUID.test(t) ? t.toLowerCase() : ''
}

/** Auftrags-ID aus der Adresszeile des Verkaufsformulars (?auftrag=<uuid>) */
export function auftragAusSuche(suche: string): string {
  return auftragIdAus(new URLSearchParams(suche).get('auftrag'))
}

export type LieferPosition = { position_id: string; fuellung_id: string; menge: number }

/** Die Positionen eines Verkaufs, die eine Auftragsposition liefern (nur Flaschen mit Füllung) */
export function lieferPositionenAus(positionen: readonly { typ?: unknown; fuellung_id?: unknown; menge?: unknown; auftrag_position_id?: unknown }[]): LieferPosition[] {
  const aus: LieferPosition[] = []
  for (const p of positionen) {
    const pid = auftragIdAus(p?.auftrag_position_id)
    if (!pid || p.typ !== 'flasche' || typeof p.fuellung_id !== 'string' || !p.fuellung_id) continue
    aus.push({ position_id: pid, fuellung_id: p.fuellung_id, menge: Number(p.menge) })
  }
  return aus
}

/** Prüfung der Lieferung gegen die offenen Mengen des Auftrags; null = in Ordnung */
export function lieferFehler(liefer: readonly LieferPosition[], auftrag: readonly AuftragZeile[]): string | null {
  if (liefer.length === 0) return 'Diese Lieferung enthält keine Position des Auftrags.'
  const zeilen = new Map(auftrag.map(p => [p.id.toLowerCase(), p]))
  const summe = new Map<string, number>()
  for (const l of liefer) {
    const z = zeilen.get(l.position_id)
    if (!z) return 'Eine Position gehört nicht zu diesem Auftrag – bitte die Seite neu laden.'
    if (z.fuellung_id !== l.fuellung_id) return `„${z.name}“: Die Füllung passt nicht zur Auftragsposition.`
    if (!Number.isInteger(l.menge) || l.menge < 1) return `„${z.name}“: Bitte eine ganze Zahl ab 1 Flasche liefern.`
    summe.set(l.position_id, (summe.get(l.position_id) ?? 0) + l.menge)
  }
  for (const [id, menge] of summe) {
    const z = zeilen.get(id)!
    const offen = offeneMenge(z)
    if (menge > offen) return `„${z.name}“: nur noch ${offen} Flaschen offen, ${menge} angefragt. Eine Mehrmenge bitte als eigene Position erfassen.`
  }
  return null
}

/** Darf der Kunde des Verkaufs den Auftrag beliefert bekommen? (derselbe Kontakt bzw. dieselbe Firma) */
export function gleicherKunde(auftrag: { kontakt_id?: string | null; firma_id?: string | null }, kontaktId: string | null, firmaId: string | null): boolean {
  if (auftrag.firma_id) return auftrag.firma_id === firmaId
  return !!auftrag.kontakt_id && auftrag.kontakt_id === kontaktId && !firmaId
}
