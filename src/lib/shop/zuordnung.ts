// Weinshop-Anbindung (KAN-461, 15.11.2026): Zuordnung Füllung ↔ Shop-Produkt – SKU und Vorschlagslogik.
// Rein (ohne Datenbank, ohne Importe), damit Seite, Server Action und Tests dieselbe Rechnung verwenden.
//
// Entscheidungen Jörgen 15.11.2026 (Plan KAN-461): Vorschlag zuerst über die SKU, sonst über den Namen – gleicher
// Jahrgang ist Pflicht, vorgeschlagen wird nur ein eindeutiger bester Treffer; nichts wird von selbst gespeichert.
// SKU: `S112-<Chargennummer>`, ohne Chargennummer `S112-<erste 8 Zeichen der Füllungs-ID>`.

export type ShopProdukt = { id: number; name: string; sku: string | null; status?: string | null; typ?: string | null }

export type FuellungKurz = {
  id: string
  name: string
  jahrgang: number | null
  rebsorte: string | null
  zusatzbezeichnung: string | null
  chargennummer: string | null
}

export type Zuordnung = { fuellung_id: string; woo_produkt_id: number }

export type Vorschlag = { produktId: number; fuellungId: string; grund: 'sku' | 'name' }

export const SKU_PRAEFIX = 'S112-'
export const SKU_MAX = 100

/** SKU, die software:112 für eine Füllung in den Shop schreibt */
export function skuFuerFuellung(f: Pick<FuellungKurz, 'id' | 'chargennummer'>): string {
  const charge = (f.chargennummer ?? '').trim().replace(/[^A-Za-z0-9._/-]+/g, '-').replace(/^-+|-+$/g, '')
  const rest = charge || f.id.replace(/-/g, '').slice(0, 8).toUpperCase()
  return (SKU_PRAEFIX + rest).slice(0, SKU_MAX)
}

const gleich = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase()

// Wörter, die in fast jedem Produkttitel stehen und nichts unterscheiden
const FUELLWOERTER = new Set(['bio', 'demeter', 'dac', 'wein', 'weingut', 'und', 'der', 'die', 'das', 'vom', 'von', 'aus', 'trocken', 'oetw'])

/** Wörter eines Texts: klein, Umlaute aufgelöst, ohne Sonderzeichen, ohne Füllwörter und Jahreszahlen */
export function woerter(text: string | null | undefined): string[] {
  const t = (text ?? '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
  const aus = new Set<string>()
  for (const w of t.split(/[^a-z0-9]+/)) {
    if (w.length < 3 || FUELLWOERTER.has(w) || /^\d+$/.test(w)) continue
    aus.add(w)
  }
  return [...aus]
}

/** Jahrgänge (1900–2099), die in einem Text vorkommen */
export function jahreIm(text: string | null | undefined): number[] {
  return [...new Set([...(text ?? '').matchAll(/(?<!\d)(19\d{2}|20\d{2})(?!\d)/g)].map(m => Number(m[1])))]
}

/** Ähnlichkeit 0…1 zwischen Produkttitel und Füllung; 0, wenn der Jahrgang nicht passt */
export function aehnlichkeit(produkt: Pick<ShopProdukt, 'name'>, f: FuellungKurz): number {
  const jahre = jahreIm(produkt.name)
  if (f.jahrgang !== null ? !jahre.includes(f.jahrgang) : jahre.length > 0) return 0
  const titel = new Set(woerter(produkt.name))
  const eigene = new Set([...woerter(f.name), ...woerter(f.rebsorte), ...woerter(f.zusatzbezeichnung)])
  if (titel.size === 0 || eigene.size === 0) return 0
  let gemeinsam = 0
  for (const w of eigene) if (titel.has(w)) gemeinsam++
  if (gemeinsam === 0) return 0
  // Anteil der gemeinsamen Wörter an allen Wörtern beider Seiten (Jaccard)
  return gemeinsam / (titel.size + eigene.size - gemeinsam)
}

export const MIN_AEHNLICHKEIT = 0.34

/**
 * Vorschläge für noch nicht zugeordnete Produkte und Füllungen. Erst SKU (die von software:112 vergebene SKU oder die
 * Chargennummer), dann Name – nur, wenn der beste Treffer auf beiden Seiten eindeutig ist.
 */
export function vorschlaege(produkte: ShopProdukt[], fuellungen: FuellungKurz[], zuordnungen: Zuordnung[]): Vorschlag[] {
  const vergebenP = new Set(zuordnungen.map(z => z.woo_produkt_id))
  const vergebenF = new Set(zuordnungen.map(z => z.fuellung_id))
  const freieP = produkte.filter(p => !vergebenP.has(p.id))
  const freieF = fuellungen.filter(f => !vergebenF.has(f.id))
  const aus: Vorschlag[] = []

  for (const p of freieP) {
    if (!p.sku) continue
    const treffer = freieF.filter(f => !vergebenF.has(f.id) && (gleich(p.sku, skuFuerFuellung(f)) || gleich(p.sku, f.chargennummer)))
    if (treffer.length === 1) {
      aus.push({ produktId: p.id, fuellungId: treffer[0].id, grund: 'sku' })
      vergebenP.add(p.id); vergebenF.add(treffer[0].id)
    }
  }

  const paare: { p: number; f: string; wert: number }[] = []
  for (const p of freieP) {
    if (vergebenP.has(p.id)) continue
    for (const f of freieF) {
      if (vergebenF.has(f.id)) continue
      const wert = aehnlichkeit(p, f)
      if (wert >= MIN_AEHNLICHKEIT) paare.push({ p: p.id, f: f.id, wert })
    }
  }
  const besterJeP = new Map<number, number>(), besterJeF = new Map<string, number>()
  const anzahlJeP = new Map<string, number>(), anzahlJeF = new Map<string, number>()
  for (const x of paare) {
    besterJeP.set(x.p, Math.max(besterJeP.get(x.p) ?? 0, x.wert))
    besterJeF.set(x.f, Math.max(besterJeF.get(x.f) ?? 0, x.wert))
  }
  for (const x of paare) {
    if (x.wert === besterJeP.get(x.p)) anzahlJeP.set(String(x.p), (anzahlJeP.get(String(x.p)) ?? 0) + 1)
    if (x.wert === besterJeF.get(x.f)) anzahlJeF.set(x.f, (anzahlJeF.get(x.f) ?? 0) + 1)
  }
  for (const x of paare) {
    // bester Treffer für das Produkt UND für die Füllung, auf beiden Seiten ohne Gleichstand
    if (x.wert === besterJeP.get(x.p) && x.wert === besterJeF.get(x.f) && anzahlJeP.get(String(x.p)) === 1 && anzahlJeF.get(x.f) === 1) {
      aus.push({ produktId: x.p, fuellungId: x.f, grund: 'name' })
    }
  }
  return aus.sort((a, b) => a.produktId - b.produktId)
}

/** Anzeige einer Füllung in Auswahlliste und Tabelle: „Name 2025 · Charge“ */
export function fuellungText(f: Pick<FuellungKurz, 'name' | 'jahrgang' | 'chargennummer'>): string {
  const kopf = [f.name, f.jahrgang].filter(v => v !== null && v !== '').join(' ')
  return f.chargennummer ? `${kopf} · ${f.chargennummer}` : kopf
}
