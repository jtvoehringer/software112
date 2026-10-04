// KAN-110 Nachtrag (04.10.2026): erzeugt src/lib/wein/kgGemeinde.ts aus dem Katastralgemeindenverzeichnis des BEV.
//
// Quelle: BEV – Bundesamt für Eich- und Vermessungswesen, Katastralgemeindenverzeichnis (CSV), Stichtag 24.01.2022,
//         https://doi.org/10.48677/ffaa7b22-c8b9-4e64-bcc2-1e003f52b9b0 – Lizenz CC BY 4.0.
//         Download: https://data.bev.gv.at/download/Katastralgemeindenverzeichnis/Archiv_KG_Verzeichnis/KG_Verzeichnis_20220124.zip
//         (enthält KGVZ_20220124.csv; die CSV liegt bewusst nicht im Repo – rund 1 MB).
// Aufruf:  node scripts/gen-kg-gemeinde.mjs <pfad>/KGVZ_<stichtag>.csv  → src/lib/wein/kgGemeinde.ts, Ergebnis committen.

import { readFileSync, writeFileSync } from 'node:fs'

const quelle = process.argv[2]
if (!quelle) { console.error('Aufruf: node scripts/gen-kg-gemeinde.mjs <KGVZ_<stichtag>.csv>'); process.exit(1) }
const stichtag = (quelle.match(/(\d{4})(\d{2})(\d{2})/) ?? []).slice(1).reverse().join('.')
const zeilen = readFileSync(quelle, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean)
const kopf = zeilen.shift().split(';')
const i = n => { const x = kopf.indexOf(n); if (x < 0) throw new Error(`Spalte ${n} fehlt`); return x }
const [iKg, iGkz, iName] = [i('KG_NUMMER'), i('GKZ'), i('GEMEINDENAME')]
const feld = s => s.replace(/^"|"$/g, '')

const kg = []
const gemeinden = new Map()
for (const z of zeilen) {
  const f = z.split(';').map(feld)
  const nr = f[iKg].padStart(5, '0')
  const gkz = f[iGkz].padStart(5, '0')
  if (!/^\d{5}$/.test(nr) || !/^\d{5}$/.test(gkz)) throw new Error(`Zeile unlesbar: ${z}`)
  kg.push(`${nr}${gkz}`)
  const alt = gemeinden.get(gkz)
  if (alt && alt !== f[iName]) throw new Error(`GKZ ${gkz} mit zwei Namen: ${alt} / ${f[iName]}`)
  gemeinden.set(gkz, f[iName])
}
kg.sort()

const ts = `// Katastralgemeinde → politische Gemeinde (KAN-110 Nachtrag, 04.10.2026) – ERZEUGT von scripts/gen-kg-gemeinde.mjs, nicht von Hand ändern.
//
// Quelle: BEV – Bundesamt für Eich- und Vermessungswesen, Katastralgemeindenverzeichnis, Stichtag ${stichtag},
// https://doi.org/10.48677/ffaa7b22-c8b9-4e64-bcc2-1e003f52b9b0 – Lizenz CC BY 4.0.
// ${kg.length} Katastralgemeinden, ${gemeinden.size} Gemeinden. Kompakt: je KG zehn Ziffern (KG-Nr. + Gemeindekennziffer).

export const KG_VERZEICHNIS_STICHTAG = '${stichtag}'

const KG_GKZ = '${kg.join('')}'

const GEMEINDEN: Record<string, string> = ${JSON.stringify(Object.fromEntries([...gemeinden].sort()), null, 0).replace(/","/g, '", "')}

let index: Map<string, string> | null = null

/** Gemeindekennziffer (GKZ) einer KG-Nr. („4034“ bzw. „04034“ → „30639“) – undefined, wenn unbekannt */
export function gemeindeVonKg(kgNr: string | number | null | undefined): string | undefined {
  const ziffern = String(kgNr ?? '').replace(/[^0-9]/g, '')
  if (!ziffern) return undefined
  if (!index) {
    index = new Map()
    for (let p = 0; p < KG_GKZ.length; p += 10) index.set(KG_GKZ.slice(p, p + 5), KG_GKZ.slice(p + 5, p + 10))
  }
  return index.get(ziffern.padStart(5, '0'))
}

/** Name der Gemeinde zu einer Gemeindekennziffer */
export function gemeindeName(gkz: string | null | undefined): string | undefined {
  return gkz ? GEMEINDEN[gkz] : undefined
}
`
writeFileSync('src/lib/wein/kgGemeinde.ts', ts)
console.log(`kgGemeinde.ts: ${kg.length} KG, ${gemeinden.size} Gemeinden, Stichtag ${stichtag}`)
