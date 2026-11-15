'use client'

// Weinshop-Anbindung (KAN-460): Formular für Shop-Adresse, WooCommerce-Schlüssel, Bestandsreserve und Verbindungstest.
// Die Schlüssel kommen nie in den Browser – `daten.shop_woo_*` ist nur die Maske („hinterlegt“); ein leeres Feld
// schickt die Maske zurück (= unverändert), „entfernen“ schickt leer (= löschen).

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { fehlerText } from '@/lib/fehler'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { shopUrlFehler } from '@/lib/shop/url'
import { saveShopEinstellungen, shopVerbindungTesten } from './actions'
import type { ShopDaten } from './page'

type Feld = 'shop_url' | 'shop_bestandsreserve' | 'schluessel'
type Fehler = { text: string; feld?: Feld }

const eingabe = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'
const beschriftung = 'block text-xs font-medium text-s112-text-2 mb-1'

export default function ShopEinstellungen({ daten, nurLesen }: { daten: ShopDaten; nurLesen: boolean }) {
  const router = useRouter()
  const [url, setUrl] = useState(daten.shop_url ?? '')
  const [key, setKey] = useState('')
  const [secret, setSecret] = useState('')
  const [entfernen, setEntfernen] = useState(false)
  const [reserve, setReserve] = useState(String(daten.shop_bestandsreserve))
  const [bestand, setBestand] = useState(daten.shop_bestand_uebertragen)
  const [speichert, setSpeichert] = useState(false)
  const [testet, setTestet] = useState(false)
  const [fehler, setFehler] = useState<Fehler | null>(null)
  const [testOk, setTestOk] = useState<string | null>(null)

  const hinterlegt = !!daten.shop_woo_api_key && !!daten.shop_woo_secret
  const geaendert = url.trim() !== (daten.shop_url ?? '') || key !== '' || secret !== '' || entfernen
    || reserve.trim() !== String(daten.shop_bestandsreserve) || bestand !== daten.shop_bestand_uebertragen
  const fehlerAm = (f: Feld) => (fehler?.feld === f ? fehler.text : null)
  const aendern = () => { setFehler(null); setTestOk(null) }

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    const adresse = shopUrlFehler(url)
    if (adresse) { setFehler({ text: adresse, feld: 'shop_url' }); return }
    if ((key.trim() === '') !== (secret.trim() === '')) {
      setFehler({ text: 'Bitte Consumer Key und Consumer Secret gemeinsam eingeben.', feld: 'schluessel' }); return
    }
    setSpeichert(true); setFehler(null); setTestOk(null)
    try {
      const fd = new FormData()
      fd.set('shop_url', url.trim())
      fd.set('shop_bestandsreserve', reserve.trim())
      fd.set('shop_bestand_uebertragen', bestand ? 'true' : 'false')
      // leer = hinterlegten Schlüssel behalten (Maske geht zurück), „entfernen“ = löschen
      fd.set('shop_woo_api_key', key.trim() || (entfernen ? '' : (daten.shop_woo_api_key ?? '')))
      fd.set('shop_woo_secret', secret.trim() || (entfernen ? '' : (daten.shop_woo_secret ?? '')))
      const r = await saveShopEinstellungen(fd)
      if ('error' in r) { setFehler({ text: r.error, feld: r.feld }); return }
      setKey(''); setSecret(''); setEntfernen(false)
      zeigeErfolg('Shop-Einstellungen gespeichert.')
      router.refresh()
    } catch (err) {
      setFehler({ text: fehlerText(err) })
    } finally {
      setSpeichert(false)
    }
  }

  async function testen() {
    setTestet(true); setFehler(null); setTestOk(null)
    try {
      const r = await shopVerbindungTesten()
      if ('error' in r) { setFehler({ text: r.error, feld: r.feld }); return }
      setTestOk(r.text ?? 'Verbindung steht.')
    } catch (err) {
      setFehler({ text: fehlerText(err) })
    } finally {
      setTestet(false)
    }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold text-s112-text">Shop-Anbindung</h1>
        <nav aria-label="Shop-Anbindung" className="flex gap-4 mt-2 text-sm border-b border-s112-border">
          <span aria-current="page" className="pb-2 font-medium text-s112-text border-b-2 border-s112-teal">Einstellungen</span>
          <Link href="/weinhandel/shop/zuordnung" className="pb-2 text-s112-muted hover:text-s112-text">Zuordnung</Link>
        </nav>
        <p className="text-sm text-s112-muted mt-3">
          Verbindet software:112 mit deinem WooCommerce-Shop. Hier richtest du die Verbindung ein und prüfst sie – dabei
          wird im Shop nichts geändert.
        </p>
      </div>

      <div className="card p-5 space-y-2 text-sm text-s112-text-1">
        <h2 className="font-semibold text-s112-text text-sm">So bekommst du die Schlüssel</h2>
        <ol className="list-decimal pl-5 space-y-1 text-s112-muted">
          <li>Im WordPress-Adminbereich: WooCommerce → Einstellungen → Erweitert → REST-API.</li>
          <li>„Schlüssel hinzufügen“, Beschreibung „software:112“, Berechtigung <strong>Lesen/Schreiben</strong>.</li>
          <li>Consumer Key (<code>ck_…</code>) und Consumer Secret (<code>cs_…</code>) hier eintragen – WooCommerce zeigt sie nur einmal.</li>
        </ol>
      </div>

      <form onSubmit={speichern} className="card p-5 space-y-4" noValidate>
        {fehler && !fehler.feld && (
          <div role="alert" className="text-sm text-s112-err-fg bg-s112-err-bg rounded-lg px-3 py-2">{fehler.text}</div>
        )}

        <div>
          <label htmlFor="shop-url" className={beschriftung}>Adresse des Shops</label>
          <input id="shop-url" type="url" inputMode="url" value={url} disabled={nurLesen}
            onChange={e => { setUrl(e.target.value); aendern() }}
            placeholder="https://www.mein-weingut.at" autoComplete="off" className={eingabe}
            aria-invalid={!!fehlerAm('shop_url') || undefined} aria-describedby={fehlerAm('shop_url') ? 'shop-url-fehler' : 'shop-url-hinweis'} />
          {fehlerAm('shop_url')
            ? <p id="shop-url-fehler" role="alert" className="text-xs text-s112-err mt-1">{fehlerAm('shop_url')}</p>
            : <p id="shop-url-hinweis" className="text-xs text-s112-muted mt-1">Die Startadresse der Website, mit https:// – ohne „/shop“ oder „/wp-json“.</p>}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="shop-key" className={beschriftung}>Consumer Key</label>
            <input id="shop-key" type="password" value={key} disabled={nurLesen || entfernen}
              onChange={e => { setKey(e.target.value); aendern() }}
              placeholder={hinterlegt ? 'hinterlegt (verschlüsselt) – zum Ändern neu eingeben' : 'ck_…'}
              autoComplete="off" className={eingabe}
              aria-invalid={!!fehlerAm('schluessel') || undefined} aria-describedby={fehlerAm('schluessel') ? 'shop-schluessel-fehler' : undefined} />
          </div>
          <div>
            <label htmlFor="shop-secret" className={beschriftung}>Consumer Secret</label>
            <input id="shop-secret" type="password" value={secret} disabled={nurLesen || entfernen}
              onChange={e => { setSecret(e.target.value); aendern() }}
              placeholder={hinterlegt ? 'hinterlegt (verschlüsselt) – zum Ändern neu eingeben' : 'cs_…'}
              autoComplete="off" className={eingabe}
              aria-invalid={!!fehlerAm('schluessel') || undefined} aria-describedby={fehlerAm('schluessel') ? 'shop-schluessel-fehler' : undefined} />
          </div>
        </div>
        {fehlerAm('schluessel') && <p id="shop-schluessel-fehler" role="alert" className="text-xs text-s112-err -mt-2">{fehlerAm('schluessel')}</p>}
        {hinterlegt && (
          <label className="flex items-center gap-2 text-xs text-s112-muted">
            <input type="checkbox" checked={entfernen} disabled={nurLesen}
              onChange={e => { setEntfernen(e.target.checked); setKey(''); setSecret(''); aendern() }} />
            Hinterlegte Schlüssel entfernen
          </label>
        )}

        <div className="border-t border-s112-border pt-4 space-y-3">
          <label className="flex items-start gap-2 text-sm text-s112-text-1">
            <input type="checkbox" className="mt-1" checked={bestand} disabled={nurLesen}
              onChange={e => { setBestand(e.target.checked); aendern() }} />
            <span>
              Bestand an den Shop übertragen
              <span className="block text-xs text-s112-muted">
                Ausgeschaltet bekommt der Shop nur Weindaten. Eingeschaltet schaltet software:112 je zugeordnetem Produkt die
                Lagerführung im Shop ein und meldet die verfügbaren Flaschen (Bestand abzüglich reservierter Flaschen und
                Reserve) – nach jeder Bestandsänderung, mit bis zu zehn Minuten Abstand.
              </span>
              <span className="block text-xs text-s112-warn-fg mt-1">
                Erst einschalten, wenn Shop-Bestellungen in software:112 ankommen oder zeitnah nachgebucht werden – sonst
                überschreibt die Übertragung Verkäufe aus dem Shop.
              </span>
            </span>
          </label>
          <div className="max-w-xs">
            <label htmlFor="shop-reserve" className={beschriftung}>Bestandsreserve (Flaschen je Wein)</label>
            <input id="shop-reserve" type="text" inputMode="numeric" value={reserve} disabled={nurLesen}
              onChange={e => { setReserve(e.target.value); aendern() }} className={eingabe}
              aria-invalid={!!fehlerAm('shop_bestandsreserve') || undefined}
              aria-describedby={fehlerAm('shop_bestandsreserve') ? 'shop-reserve-fehler' : 'shop-reserve-hinweis'} />
            {fehlerAm('shop_bestandsreserve')
              ? <p id="shop-reserve-fehler" role="alert" className="text-xs text-s112-err mt-1">{fehlerAm('shop_bestandsreserve')}</p>
              : <p id="shop-reserve-hinweis" className="text-xs text-s112-muted mt-1">So viele Flaschen bleiben dem Ab-Hof-Verkauf vorbehalten.</p>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-1">
          <button type="submit" disabled={nurLesen || speichert || testet || !geaendert}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-medium hover:bg-s112-teal/90 disabled:opacity-40">
            {speichert ? 'Speichern…' : 'Speichern'}
          </button>
          <button type="button" onClick={testen} disabled={nurLesen || speichert || testet || geaendert || !daten.shop_url || !hinterlegt}
            className="border border-s112-border px-4 py-2 rounded-lg text-sm font-medium text-s112-text-1 hover:bg-s112-bg disabled:opacity-40">
            {testet ? 'Verbindung wird geprüft…' : 'Verbindung testen'}
          </button>
          {geaendert && <span className="text-xs text-s112-muted">Erst speichern, dann testen.</span>}
        </div>
        {testOk && <div role="status" className="text-sm text-s112-ok-fg bg-s112-ok-bg rounded-lg px-3 py-2">{testOk}</div>}
      </form>
    </div>
  )
}
