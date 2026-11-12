'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { AbbrechenKnopf } from '@/components/navigation/Abbrechen'
import { Trash2 } from 'lucide-react'
import { fmtNum } from '@/lib/format'
import LandOptionen from '@/components/crm/LandOptionen'   // KAN-187: Bestimmungsland als ISO-Code aus dem Länderkatalog
import { heuteWien } from '@/lib/datum/wien'
import { INCOTERMS, TRANSPORTARTEN as TRANSPORT, EXPORT_EINHEITEN, EXPORT_MAX, exportauftragFehler } from '@/lib/export/auftragEingabe'
import { KARTON_MAX, KARTON_MIN, KARTON_STANDARD, KUNDE_UID_MAX, ZAHLUNGSBEDINGUNGEN_MAX, lieferfall, zahlungsbedingungenVorschlag } from '@/lib/export/grunddaten'
import { zeigeErfolg } from '@/lib/ui/erfolg'
import { fehlerText } from '@/lib/fehler'
type R = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any


/** KAN-429: vorhandener Auftrag (Entwurf oder Bestätigt) – das Formular speichert dann per PUT statt neu anzulegen */
export type ExportBearbeiten = { id: string; referenz: string | null; auftrag: R; positionen: R[] }
/** KAN-432: Vorgaben des Betriebs – Standard „Flaschen je Karton“ und Zahlungsziel (Tage) für den Vorschlag der Zahlungsbedingungen */
export type ExportVorgaben = { flaschenJeKarton: number; zahlungszielTage: number | null }
interface Props { kontakte: R[]; firmen: R[]; fuellungen: R[]; tenantId: string; bearbeiten?: ExportBearbeiten; vorgaben?: ExportVorgaben }

const alsText = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export default function WeinexportFormClient({ kontakte, firmen, fuellungen, tenantId, bearbeiten, vorgaben }: Props) {
  const alt = bearbeiten?.auftrag ?? null
  const kartonStandard = String(vorgaben?.flaschenJeKarton ?? KARTON_STANDARD)
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [fehler, setFehler] = useState<string|null>(null)
  // KAN-246: Auftrag schon angelegt, Positionen gescheitert – Link statt erneutem Speichern (sonst doppelter Auftrag)
  const [angelegtId, setAngelegtId] = useState<string|null>(null)

  // Kopfdaten
  const [empfaengerTyp, setEmpfaengerTyp] = useState<'kontakt'|'firma'>(alt?.kontakt_id && !alt?.firma_id ? 'kontakt' : 'firma')
  const [kontaktId, setKontaktId]   = useState(alsText(alt?.kontakt_id))
  const [firmaId, setFirmaId]       = useState(alsText(alt?.firma_id))
  const [datum, setDatum]           = useState(alsText(alt?.datum).slice(0, 10) || heuteWien())
  const [lieferdatum, setLieferdatum] = useState(alsText(alt?.lieferdatum).slice(0, 10))
  const [incoterms, setIncoterms]   = useState(alsText(alt?.incoterms) || 'EXW')
  const [transportArt, setTransportArt] = useState(alsText(alt?.transport_art) || 'LKW')
  const [destLand, setDestLand]     = useState(alsText(alt?.destination_land))
  const [destStadt, setDestStadt]   = useState(alsText(alt?.destination_stadt))
  const [eori, setEori]             = useState(alsText(alt?.eori_kunde))
  const [versicherung, setVersicherung] = useState(alsText(alt?.versicherungswert))
  const [verpackung, setVerpackung] = useState(alsText(alt?.verpackung_kg))   // KAN-414: Kartons/Palette in kg
  const [notizen, setNotizen]       = useState(alsText(alt?.notizen))
  // KAN-432: Grunddaten für die Dokumente
  const [versanddatum, setVersanddatum] = useState(alsText(alt?.versanddatum).slice(0, 10))
  const [kundeUid, setKundeUid]     = useState(alsText(alt?.kunde_uid))
  const [mustersendung, setMustersendung] = useState(alt?.mustersendung === true)   // KAN-433
  const [zahlung, setZahlung]       = useState(alt ? alsText(alt?.zahlungsbedingungen) : zahlungsbedingungenVorschlag(vorgaben?.zahlungszielTage ?? null))

  /** Kunde gewählt: UID (Firma) und Zahlungsbedingungen vorschlagen – eine eigene Eingabe bleibt stehen */
  function kundeGewaehlt(typ: 'firma' | 'kontakt', id: string) {
    const k = (typ === 'firma' ? firmen : kontakte).find(x => x.id === id)
    const uidAlt = alsText(firmen.find(x => x.id === firmaId)?.uid_nummer)
    if (!kundeUid.trim() || kundeUid.trim() === uidAlt) setKundeUid(typ === 'firma' ? alsText(k?.uid_nummer) : '')
    const vorschlaege = new Set([...firmen, ...kontakte].map(x => zahlungsbedingungenVorschlag(x.zahlungsziel_tage)).concat(zahlungsbedingungenVorschlag(vorgaben?.zahlungszielTage ?? null)))
    if (!zahlung.trim() || vorschlaege.has(zahlung.trim())) {
      setZahlung(zahlungsbedingungenVorschlag(k?.zahlungsziel_tage ?? null) || zahlungsbedingungenVorschlag(vorgaben?.zahlungszielTage ?? null))
    }
  }

  // Positionen
  const [positionen, setPositionen] = useState<R[]>(() => (bearbeiten?.positionen ?? []).map(p => ({
    fullung_id: alsText(p.fullung_id), beschreibung: alsText(p.beschreibung), menge: alsText(p.menge), einheit: alsText(p.einheit) || 'Fl',
    preis_eur: alsText(p.preis_eur), taric_code: alsText(p.taric_code) || '2204.21',
    flaschen_je_karton: alsText(p.flaschen_je_karton),
  })))

  function addPosition() {
    setPositionen(p => [...p, { fullung_id: '', beschreibung: '', menge: '', einheit: 'Fl', preis_eur: '', taric_code: '2204.21', flaschen_je_karton: kartonStandard }])
  }
  function updatePos(i: number, field: string, val: string) {
    setPositionen(p => p.map((pos, idx) => idx === i ? { ...pos, [field]: val } : pos))
  }
  function removePos(i: number) {
    setPositionen(p => p.filter((_, idx) => idx !== i))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFehler(null)
    const body = {
      tenant_id: tenantId,
      kontakt_id: empfaengerTyp === 'kontakt' ? kontaktId || null : null,
      firma_id:   empfaengerTyp === 'firma'   ? firmaId   || null : null,
      datum, lieferdatum: lieferdatum || null,
      incoterms, transport_art: transportArt,
      destination_land: destLand, destination_stadt: destStadt,
      eori_kunde: eori || null,
      versicherungswert: versicherung ? parseFloat(versicherung) : null,
      verpackung_kg: verpackung ? parseFloat(verpackung) : null,
      notizen: notizen || null,
      versanddatum: versanddatum || null,
      zahlungsbedingungen: zahlung.trim() || null,
      kunde_uid: kundeUid.trim() || null,
      mustersendung,
      positionen,
    }
    // KAN-429: dieselbe Prüfung wie Route und Datenbank – u. a. jede Position mit Menge über 0
    const eingabeFehler = exportauftragFehler(body)
    if (eingabeFehler) { setFehler(eingabeFehler); return }
    setSaving(true)
    try {
      const res = await fetch(bearbeiten ? `/api/weinexport/${bearbeiten.id}` : '/api/weinexport', {
        method: bearbeiten ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setFehler(data.fehler ?? 'Der Exportauftrag wurde nicht gespeichert.'); setAngelegtId(data.id ?? null); return }
      if (bearbeiten) {
        zeigeErfolg(Number(data.dokumente_zurueck) > 0
          ? `Exportauftrag gespeichert. ${data.dokumente_zurueck === 1 ? 'Ein ausgestelltes Dokument steht' : `${data.dokumente_zurueck} ausgestellte Dokumente stehen`} wieder auf „Ausstehend“ – bitte neu ausstellen.`
          : 'Exportauftrag gespeichert.')
        router.push(`/weinexport/${bearbeiten.id}`)
        router.refresh()
        return
      }
      router.push(`/weinexport/${data.id}`)
    } catch (err) {
      setFehler(fehlerText(err))
    } finally {
      setSaving(false)
    }
  }

  const gesamtEUR = positionen.reduce((s, p) => s + (parseFloat(p.menge)||0) * (parseFloat(p.preis_eur)||0), 0)

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center gap-2 text-sm text-s112-muted mb-2">
        <Link href="/weinexport" className="hover:text-s112-blue-700 transition-colors">Weinexport</Link>
        <span>/</span>
        {bearbeiten && <><Link href={`/weinexport/${bearbeiten.id}`} className="hover:text-s112-blue-700 transition-colors">{bearbeiten.referenz ?? 'Exportauftrag'}</Link><span>/</span></>}
        <span className="text-s112-text-1 font-medium">{bearbeiten ? 'Bearbeiten' : 'Neuer Exportauftrag'}</span>
      </div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-s112-text">{bearbeiten ? `Exportauftrag ${bearbeiten.referenz ?? ''} bearbeiten` : 'Neuer Exportauftrag'}</h1>
        {bearbeiten && <p className="text-sm text-s112-muted mt-1">Bearbeiten geht, solange der Auftrag Entwurf oder Bestätigt ist. Schon ausgestellte Dokumente stehen nach dem Speichern wieder auf „Ausstehend“.</p>}
      </div>

      <form data-ungespeichert onSubmit={handleSubmit} className="space-y-6">
        {/* Importeur */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <h2 className="font-semibold text-s112-text mb-4">Importeur / Empfänger</h2>
          <div className="flex gap-2 mb-4">
            <button type="button" onClick={() => setEmpfaengerTyp('firma')}
              className={`px-4 py-1.5 rounded-lg text-sm border ${empfaengerTyp==='firma'?'bg-s112-teal text-s112-yellow border-s112-teal':'border-s112-border text-s112-text-2'}`}>
              Firma
            </button>
            <button type="button" onClick={() => setEmpfaengerTyp('kontakt')}
              className={`px-4 py-1.5 rounded-lg text-sm border ${empfaengerTyp==='kontakt'?'bg-s112-teal text-s112-yellow border-s112-teal':'border-s112-border text-s112-text-2'}`}>
              Kontakt
            </button>
          </div>
          {empfaengerTyp === 'firma' ? (
            <select aria-label="Firma" value={firmaId} onChange={e => { setFirmaId(e.target.value); kundeGewaehlt('firma', e.target.value) }}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Firma wählen –</option>
              {firmen.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          ) : (
            <select aria-label="Kontakt" value={kontaktId} onChange={e => { setKontaktId(e.target.value); kundeGewaehlt('kontakt', e.target.value) }}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– Kontakt wählen –</option>
              {kontakte.map(k => <option key={k.id} value={k.id}>{k.vorname} {k.nachname}</option>)}
            </select>
          )}
          <div className="grid grid-cols-2 gap-4 mt-4">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">UID-Nummer Importeur</label>
              <input aria-label="UID-Nummer Importeur" maxLength={KUNDE_UID_MAX} value={kundeUid} onChange={e => setKundeUid(e.target.value)} placeholder="z.B. DE123456789"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
              <p className="text-xs text-s112-muted mt-1">Mit UID gilt die Lieferung als B2B. Derzeit: <span className="font-medium text-s112-text-2">{lieferfall({ destination_land: destLand, kunde_uid: kundeUid }).label}</span></p>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Zahlungsbedingungen</label>
              <input aria-label="Zahlungsbedingungen" maxLength={ZAHLUNGSBEDINGUNGEN_MAX} value={zahlung} onChange={e => setZahlung(e.target.value)} placeholder="z.B. Zahlbar innerhalb von 30 Tagen netto"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">EORI-Nummer Importeur</label>
              <input aria-label="EORI-Nummer Importeur" maxLength={EXPORT_MAX.eori} value={eori} onChange={e => setEori(e.target.value)} placeholder="z.B. AT1234567890"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Versicherungswert (EUR)</label>
              <input aria-label="Versicherungswert (EUR)" type="number" step="0.01" value={versicherung} onChange={e => setVersicherung(e.target.value)} placeholder="0,00"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Verpackung gesamt (kg)</label>
              <input aria-label="Verpackung gesamt (kg)" type="number" step="0.01" min="0" value={verpackung} onChange={e => setVerpackung(e.target.value)} placeholder="Kartons, Palette"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
              <p className="text-xs text-s112-muted mt-1">Geht in die Bruttomasse der Dokumente ein; lässt sich am Auftrag nachtragen.</p>
            </div>
          </div>
        </div>

        {/* Logistik */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <h2 className="font-semibold text-s112-text mb-4">Logistik & Destination</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Auftragsdatum</label>
              <input aria-label="Auftragsdatum" type="date" value={datum} onChange={e => setDatum(e.target.value)} required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Lieferdatum (geplant)</label>
              <input aria-label="Lieferdatum (geplant)" type="date" value={lieferdatum} onChange={e => setLieferdatum(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Versanddatum</label>
              <input aria-label="Versanddatum" type="date" value={versanddatum} onChange={e => setVersanddatum(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
              <p className="text-xs text-s112-muted mt-1">Tag, an dem die Ware das Lager verlässt – lässt sich bis „Versendet“ nachtragen.</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Incoterms</label>
              <select aria-label="Incoterms" value={incoterms} onChange={e => setIncoterms(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
                {INCOTERMS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Transportart</label>
              <select aria-label="Transportart" value={transportArt} onChange={e => setTransportArt(e.target.value)}
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
                {TRANSPORT.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Destination Land *</label>
              <select aria-label="Destination Land" value={destLand} onChange={e => setDestLand(e.target.value)} required
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40">
                <option value="">– Land wählen –</option>
                <LandOptionen aktuell={destLand} />
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-s112-text-2 mb-1">Destination Stadt</label>
              <input aria-label="Destination Stadt" maxLength={EXPORT_MAX.stadt} value={destStadt} onChange={e => setDestStadt(e.target.value)} placeholder="z.B. München"
                className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
            </div>
          </div>
        </div>

        {/* Positionen */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-s112-text">Weinpositionen</h2>
            <button type="button" onClick={addPosition}
              className="text-xs text-s112-blue-700 border border-s112-teal px-3 py-1 rounded-lg hover:bg-s112-teal/5">
              + Position
            </button>
          </div>
          {positionen.length === 0 && (
            <p className="text-sm text-s112-muted text-center py-4">Noch keine Positionen – klick &quot;+ Position&quot;</p>
          )}
          {positionen.map((pos, i) => (
            <div key={i} className="grid grid-cols-12 gap-2 mb-3 items-start">
              <div className="col-span-4">
                <select value={pos.fullung_id} onChange={e => {
                  const f = fuellungen.find(f => f.id === e.target.value)
                  updatePos(i, 'fullung_id', e.target.value)
                  if (f) {
                    updatePos(i, 'beschreibung', [f.name, f.bezeichnung].filter(Boolean).join(' – '))
                    if (f.zolltarifnummer) updatePos(i, 'taric_code', f.zolltarifnummer.replace(/\s/g, '').replace(/^(\d{4})(\d+)$/, '$1.$2'))
                  }
                }} className="w-full border border-s112-border rounded-sm px-2 py-1.5 text-xs focus:outline-hidden">
                  <option value="">– Füllung –</option>
                  {fuellungen.map(f => <option key={f.id} value={f.id}>{f.name}{f.bezeichnung ? ' – ' + f.bezeichnung : ''}{f.jahrgang ? ' ' + f.jahrgang : ''} ({f.bestand_flaschen} Fl.)</option>)}
                </select>
              </div>
              <div className="col-span-2">
                <input value={pos.beschreibung} onChange={e => updatePos(i, 'beschreibung', e.target.value)}
                  placeholder="Bezeichnung" className="w-full border border-s112-border rounded-sm px-2 py-1.5 text-xs focus:outline-hidden" />
              </div>
              <div className="col-span-1">
                <input type="number" step="0.01" value={pos.menge} onChange={e => updatePos(i, 'menge', e.target.value)}
                  placeholder="Menge" className="w-full border border-s112-border rounded-sm px-2 py-1.5 text-xs focus:outline-hidden" />
              </div>
              <div className="col-span-1">
                <select value={pos.einheit} onChange={e => updatePos(i, 'einheit', e.target.value)}
                  className="w-full border border-s112-border rounded-sm px-2 py-1.5 text-xs focus:outline-hidden">
                  {EXPORT_EINHEITEN.map(e => <option key={e}>{e}</option>)}
                </select>
              </div>
              {/* KAN-432: Flaschen je Karton (bei „Kiste“ = Flaschen je Kiste); lose Ware hat keine */}
              <div className="col-span-1">
                <input aria-label={`Flaschen je Karton ${i + 1}`} title="Flaschen je Karton" type="number" step="1" min={KARTON_MIN} max={KARTON_MAX}
                  value={pos.einheit === 'HL' ? '' : pos.flaschen_je_karton} disabled={pos.einheit === 'HL'}
                  onChange={e => updatePos(i, 'flaschen_je_karton', e.target.value)}
                  placeholder="Fl./Kt." className="w-full border border-s112-border rounded-sm px-2 py-1.5 text-xs focus:outline-hidden disabled:bg-s112-bg" />
              </div>
              <div className="col-span-2">
                <input type="number" step="0.01" value={pos.preis_eur} onChange={e => updatePos(i, 'preis_eur', e.target.value)}
                  placeholder="€/Einheit" className="w-full border border-s112-border rounded-sm px-2 py-1.5 text-xs focus:outline-hidden" />
              </div>
              <div className="col-span-1 flex justify-center pt-1">
                <button aria-label="Entfernen" type="button" onClick={() => removePos(i)} className="text-s112-err hover:text-s112-err-fg text-xs">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
          {positionen.length > 0 && (
            <div className="text-right text-sm font-semibold text-s112-text border-t border-s112-border pt-3 mt-2">
              Gesamt: EUR {fmtNum(gesamtEUR, 2)}
            </div>
          )}
        </div>

        {/* KAN-433: Mustersendung */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <label className="flex items-start gap-3 text-sm text-s112-text">
            <input type="checkbox" checked={mustersendung} onChange={e => setMustersendung(e.target.checked)} className="mt-0.5 h-4 w-4 accent-s112-teal" />
            <span>
              <span className="font-medium">Mustersendung</span>
              <span className="block text-xs text-s112-muted mt-0.5">Zum Beispiel für Messen oder Verkostungen. Packliste und Rechnung tragen dann den Vermerk „Mustersendung – ohne Handelswert“.</span>
            </span>
          </label>
        </div>

        {/* Notizen */}
        <div className="bg-white rounded-xl border border-s112-border p-6">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen / Besonderheiten</label>
          <textarea aria-label="Notizen / Besonderheiten" value={notizen} onChange={e => setNotizen(e.target.value)} rows={3}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 resize-none" />
        </div>

        {fehler && <p role="alert" className="text-s112-err-fg text-sm">{fehler}{angelegtId && <> <Link href={`/weinexport/${angelegtId}`} className="underline">Zum angelegten Auftrag</Link></>}</p>}
        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="bg-s112-teal text-s112-yellow px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40">
            {saving ? 'Speichern…' : bearbeiten ? 'Änderungen speichern' : 'Exportauftrag anlegen'}
          </button>
          <AbbrechenKnopf standard={bearbeiten ? `/weinexport/${bearbeiten.id}` : '/weinexport'} className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-s112-text-2 hover:bg-s112-bg">
            Abbrechen
          </AbbrechenKnopf>{/* KAN-333: zurück, woher man kam */}
        </div>
      </form>
    </div>
  )
}
