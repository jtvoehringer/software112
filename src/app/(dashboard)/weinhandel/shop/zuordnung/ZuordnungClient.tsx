'use client'

// Weinshop-Anbindung (KAN-461): Tabelle Shop-Produkt ↔ Füllung mit Vorschlägen. Nichts wird von selbst gespeichert –
// jede Zuordnung bestätigt die Betriebsleitung (einzeln oder „alle Vorschläge übernehmen“).

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { rueckfrage } from '@/lib/ui/rueckfrage'
import { fuellungText, vorschlaege, type FuellungKurz } from '@/lib/shop/zuordnung'
import type { GespeicherteZuordnung } from '@/lib/shop/laden'
import type { WooProdukt } from '@/lib/shop/woocommerce'
import { shopSkuErneutSchreiben, shopVorschlaegeUebernehmen, shopZuordnen, shopZuordnungLoesen } from './actions'

type Props = {
  produkte: WooProdukt[]
  fuellungen: FuellungKurz[]
  zuordnungen: GespeicherteZuordnung[]
  shopFehler: string | null
  abgeschnitten: boolean
  nurLesen: boolean
}

const knopf = 'border border-s112-border px-3 py-1.5 rounded-lg text-xs font-medium text-s112-text-1 hover:bg-s112-bg disabled:opacity-40'
const haupt = 'bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-s112-teal/90 disabled:opacity-40'

export default function ZuordnungClient({ produkte, fuellungen, zuordnungen, shopFehler, abgeschnitten, nurLesen }: Props) {
  const router = useRouter()
  const [laeuft, setLaeuft] = useState<string | null>(null)
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweise, setHinweise] = useState<string[]>([])
  const [wahl, setWahl] = useState<Record<number, string>>({})

  const fuellungJe = useMemo(() => new Map(fuellungen.map(f => [f.id, f])), [fuellungen])
  const zuordnungJe = useMemo(() => new Map(zuordnungen.map(z => [z.woo_produkt_id, z])), [zuordnungen])
  const vergeben = useMemo(() => new Set(zuordnungen.map(z => z.fuellung_id)), [zuordnungen])
  const vorschlagJe = useMemo(() => new Map(vorschlaege(produkte, fuellungen, zuordnungen).map(v => [v.produktId, v])), [produkte, fuellungen, zuordnungen])

  // Zeilen: alle Produkte des Shops, dazu gespeicherte Zuordnungen, deren Produkt der Shop (gerade) nicht liefert
  const zeilen = useMemo(() => {
    const bekannt = new Set(produkte.map(p => p.id))
    const nurGespeichert: WooProdukt[] = zuordnungen.filter(z => !bekannt.has(z.woo_produkt_id))
      .map(z => ({ id: z.woo_produkt_id, name: z.woo_name ?? `Produkt ${z.woo_produkt_id}`, sku: z.woo_sku, status: null, typ: null }))
    return [...produkte.map(p => ({ p, imShop: true })), ...nurGespeichert.map(p => ({ p, imShop: false }))]
  }, [produkte, zuordnungen])
  const ohneProdukt = fuellungen.filter(f => !vergeben.has(f.id))
  const offeneVorschlaege = [...vorschlagJe.values()]

  async function ausfuehren(schluessel: string, aktion: () => Promise<{ fehler?: string; hinweise?: string[]; erfolg?: string }>) {
    setLaeuft(schluessel); setFehler(null); setHinweise([])
    try {
      const r = await aktion()
      if (r.fehler) { setFehler(r.fehler); return }
      if (r.hinweise?.length) setHinweise(r.hinweise)
      if (r.erfolg) zeigeErfolg(r.erfolg)
      router.refresh()
    } catch (e) {
      setFehler(fehlerText(e))
    } finally {
      setLaeuft(null)
    }
  }

  const zuordnen = (p: WooProdukt, fuellungId: string) => ausfuehren(`z${p.id}`, async () => {
    const r = await shopZuordnen(p.id, fuellungId, p.name)
    if ('error' in r) return { fehler: r.error }
    setWahl(w => { const n = { ...w }; delete n[p.id]; return n })
    return { erfolg: 'Zuordnung gespeichert.', hinweise: r.hinweis ? [r.hinweis] : [] }
  })

  const loesen = async (p: WooProdukt) => {
    if (!(await rueckfrage({ titel: 'Zuordnung lösen?', text: `„${p.name}“ gehört danach zu keiner Füllung mehr. Die Artikelnummer im Shop bleibt stehen.`, bestaetigen: 'Lösen', gefaehrlich: true }))) return
    await ausfuehren(`l${p.id}`, async () => {
      const r = await shopZuordnungLoesen(p.id)
      return 'error' in r ? { fehler: r.error } : { erfolg: 'Zuordnung gelöst.' }
    })
  }

  const skuErneut = (p: WooProdukt) => ausfuehren(`s${p.id}`, async () => {
    const r = await shopSkuErneutSchreiben(p.id)
    return 'error' in r ? { fehler: r.error } : { erfolg: 'Artikelnummer in den Shop geschrieben.' }
  })

  const alleUebernehmen = () => ausfuehren('alle', async () => {
    const namen = new Map(produkte.map(p => [p.id, p.name]))
    const r = await shopVorschlaegeUebernehmen(offeneVorschlaege.map(v => ({ produktId: v.produktId, fuellungId: v.fuellungId, produktName: namen.get(v.produktId) })))
    if ('error' in r) return { fehler: r.error }
    return {
      erfolg: `${r.uebernommen} ${r.uebernommen === 1 ? 'Zuordnung' : 'Zuordnungen'} gespeichert.`,
      hinweise: [...r.fehler.map(f => `Nicht übernommen: ${f}`), ...r.hinweise],
    }
  })

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Shop-Anbindung</h1>
        <nav aria-label="Shop-Anbindung" className="flex gap-4 mt-2 text-sm border-b border-s112-border">
          <Link href="/weinhandel/shop" className="pb-2 text-s112-muted hover:text-s112-text">Einstellungen</Link>
          <span aria-current="page" className="pb-2 font-medium text-s112-text border-b-2 border-s112-teal">Zuordnung</span>
        </nav>
        <p className="text-sm text-s112-muted mt-3">
          Lege je Shop-Produkt fest, welche Füllung dahintersteht. Beim Zuordnen schreibt software:112 eine Artikelnummer
          (SKU) in den Shop, wenn das Produkt dort noch keine hat – sonst wird im Shop nichts geändert.
        </p>
      </div>

      {shopFehler && (
        <div role="alert" className="text-sm text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2">
          Die Produkte konnten nicht aus dem Shop gelesen werden: {shopFehler} Angezeigt werden die gespeicherten Zuordnungen.
        </div>
      )}
      {abgeschnitten && (
        <div role="status" className="text-sm text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2">
          Der Shop hat mehr als 1.000 Produkte – angezeigt werden die ersten 1.000.
        </div>
      )}
      {fehler && <div role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg rounded-lg px-3 py-2">{fehler}</div>}
      {hinweise.length > 0 && (
        <div role="status" className="text-sm text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2 space-y-1">
          {hinweise.map(h => <p key={h}>{h}</p>)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-sm text-s112-muted">
        <span>{zeilen.length} {zeilen.length === 1 ? 'Produkt' : 'Produkte'} · {zuordnungen.length} zugeordnet · {ohneProdukt.length} {ohneProdukt.length === 1 ? 'Füllung' : 'Füllungen'} ohne Produkt</span>
        {offeneVorschlaege.length > 0 && (
          <button type="button" className={haupt} disabled={nurLesen || laeuft !== null} onClick={alleUebernehmen}>
            {laeuft === 'alle' ? 'Wird übernommen…' : `Alle ${offeneVorschlaege.length} Vorschläge übernehmen`}
          </button>
        )}
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-s112-muted border-b border-s112-border">
              <th className="px-3 py-2 font-medium">Produkt im Shop</th>
              <th className="px-3 py-2 font-medium">Artikelnummer (SKU)</th>
              <th className="px-3 py-2 font-medium">Füllung in software:112</th>
              <th className="px-3 py-2 font-medium"><span className="sr-only">Aktionen</span></th>
            </tr>
          </thead>
          <tbody>
            {zeilen.length === 0 && (
              <tr><td colSpan={4} className="px-3 py-6 text-center text-s112-muted">{shopFehler ? 'Noch keine Zuordnungen gespeichert.' : 'Der Shop hat keine Produkte.'}</td></tr>
            )}
            {zeilen.map(({ p, imShop }) => {
              const z = zuordnungJe.get(p.id)
              const f = z ? fuellungJe.get(z.fuellung_id) : undefined
              const v = vorschlagJe.get(p.id)
              const gewaehlt = wahl[p.id] ?? ''
              // Auswahl: freie Füllungen (beim Umhängen ohne die aktuelle)
              const optionen = fuellungen.filter(x => !vergeben.has(x.id))
              return (
                <tr key={p.id} className="border-b border-s112-border last:border-0 align-top">
                  <td className="px-3 py-2">
                    <div className="text-s112-text">{p.name}</div>
                    <div className="text-xs text-s112-muted">
                      Nr. {p.id}{p.status && p.status !== 'publish' ? ` · ${p.status === 'draft' ? 'Entwurf' : p.status}` : ''}{p.typ && p.typ !== 'simple' ? ` · ${p.typ}` : ''}
                      {!imShop && !shopFehler ? ' · im Shop nicht mehr vorhanden' : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {(z?.woo_sku ?? p.sku) || <span className="text-s112-muted">–</span>}
                    {z && !(z.woo_sku ?? p.sku) && (
                      <button type="button" className={`${knopf} ml-2`} disabled={nurLesen || laeuft !== null} onClick={() => skuErneut(p)}>
                        {laeuft === `s${p.id}` ? 'Schreibt…' : 'SKU schreiben'}
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {z && <div className="text-s112-text">{f ? fuellungText(f) : <span className="text-s112-warn-fg">Füllung nicht mehr aktiv</span>}</div>}
                    {!z && v && fuellungJe.get(v.fuellungId) && (
                      <div className="text-xs text-s112-muted mb-1">
                        Vorschlag ({v.grund === 'sku' ? 'gleiche SKU' : 'Name und Jahrgang'}): <span className="text-s112-text">{fuellungText(fuellungJe.get(v.fuellungId)!)}</span>
                      </div>
                    )}
                    <select aria-label={`Füllung für ${p.name}`} value={gewaehlt} disabled={nurLesen || laeuft !== null}
                      onChange={e => setWahl(w => ({ ...w, [p.id]: e.target.value }))}
                      className="mt-1 w-full max-w-sm border border-s112-border rounded-lg px-2 py-1.5 text-sm">
                      <option value="">{z ? 'auf andere Füllung umhängen …' : 'Füllung wählen …'}</option>
                      {optionen.map(x => <option key={x.id} value={x.id}>{fuellungText(x)}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-right space-x-2">
                    {gewaehlt && (
                      <button type="button" className={haupt} disabled={nurLesen || laeuft !== null} onClick={() => zuordnen(p, gewaehlt)}>
                        {laeuft === `z${p.id}` ? 'Speichert…' : z ? 'Umhängen' : 'Zuordnen'}
                      </button>
                    )}
                    {!z && !gewaehlt && v && (
                      <button type="button" className={haupt} disabled={nurLesen || laeuft !== null} onClick={() => zuordnen(p, v.fuellungId)}>
                        {laeuft === `z${p.id}` ? 'Speichert…' : 'Vorschlag übernehmen'}
                      </button>
                    )}
                    {z && (
                      <button type="button" className={knopf} disabled={nurLesen || laeuft !== null} onClick={() => loesen(p)}>
                        {laeuft === `l${p.id}` ? 'Löst…' : 'Lösen'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-s112-text text-sm mb-2">Füllungen ohne Shop-Produkt ({ohneProdukt.length})</h2>
        {ohneProdukt.length === 0
          ? <p className="text-sm text-s112-muted">Jede aktive Füllung ist einem Produkt zugeordnet.</p>
          : <ul className="text-sm text-s112-text-1 columns-1 md:columns-2 gap-6">{ohneProdukt.map(f => <li key={f.id} className="py-0.5">{fuellungText(f)}</li>)}</ul>}
      </div>
    </div>
  )
}
