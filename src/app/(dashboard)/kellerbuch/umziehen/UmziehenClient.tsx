'use client'

import { gebindeOption } from '@/lib/keller/gebindeAnzeige'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { zielNachVorgang } from '@/lib/navigation/zurueckBrowser'
import Link from '@/components/ui/Link'
import { umziehen, deleteUmzug, updateUmzug } from './actions'
import { endgueltigLoeschen } from '../actions'
import { ArrowLeftRight, Filter, X, AlertTriangle, CheckCircle2, Pencil } from 'lucide-react'
import StornoButton from '@/components/StornoButton'
import { formatRebsorteMitKuerzel } from '@/lib/wein/bki_kuerzel'
import { fmtNum } from '@/lib/format'
import { fehlerText } from '@/lib/fehler'
import { weinartKonflikt, WEINART_LABEL } from '@/lib/keller/weinart'
import { verschnittHinweis } from '@/lib/kellerbuch/verschnittHinweis'

type BehaelterMitCharge = {
  behaelter_id:   string
  behaelter_name: string
  charge_id:      string
  charge_name:    string
  jahrgang:       number | null
  rebsorte:       string | null
  weinart:        string | null
  menge_liter:    number
}
type Behaelter = { id: string; name: string; kapazitaet_liter: number | null }
type UmzugRow  = { id: string; von_name: string; nach_name: string; menge_liter: number; schwund_liter: number; datum: string; notizen: string | null; umzug_typ?: string
  /** KAN-145: storniert – Vermerk statt Aktionen */
  storno?: { am: string; grund: string | null; von: string | null } | null }

function fmt(n: number | null) {
  if (n == null) return '–'
  return fmtNum(n, 2) + ' L'
}

// ── Quell-Zeile: Charge wählen (Behälter · Charge) → Menge auto-befüllt ──────
// KAN-94 (01.10.2026): gewählt wird die Charge, nicht der Behälter – liegen mehrere Chargen in
// einem Gebinde, war bisher immer die erste die Quelle.

function QuelleZeile({
  quellen, value, menge, onChange, onRemove,
}: {
  quellen:  BehaelterMitCharge[]
  value:    string
  menge:    string
  onChange: (chargeId: string, menge: string) => void
  onRemove: () => void
}) {
  const selected  = quellen.find(q => q.charge_id === value) ?? null
  const mengeNum  = parseFloat(menge) || 0
  const ueberzogen = selected && mengeNum > selected.menge_liter + 0.001

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={value}
          onChange={e => {
            const charge = quellen.find(q => q.charge_id === e.target.value)
            onChange(e.target.value, charge ? String(charge.menge_liter) : '')
          }}
          required
          className="border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 flex-1 basis-full sm:basis-0 sm:min-w-[220px]"
        >
          <option value="">– Behälter · Charge wählen –</option>
          {quellen.map(q => (
            <option key={q.charge_id} value={q.charge_id}>
              {q.behaelter_name} · {q.charge_name}{q.jahrgang ? ` ${q.jahrgang}` : ''} · {fmt(q.menge_liter)}
            </option>
          ))}
        </select>
        <input
          type="number"
          inputMode="decimal"
          value={menge}
          onChange={e => onChange(value, e.target.value)}
          min="0.001"
          step="0.001"
          max={selected?.menge_liter ?? undefined}
          placeholder="Liter"
          required
          className={`border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 w-28 tabular-nums ${ueberzogen ? 'border-s112-err/50 focus:ring-s112-err/30' : 'border-s112-border focus:ring-s112-teal/40'}`}
        />
        <span className="text-xs text-s112-muted w-8">L</span>
        {selected && !ueberzogen && (
          <span className="text-xs text-s112-muted">max {fmt(selected.menge_liter)}</span>
        )}
        <button aria-label="Zeile entfernen" type="button" onClick={onRemove} className="text-xs text-s112-err hover:text-s112-err-fg p-2 sm:py-0 sm:px-1"><X size={13} strokeWidth={2} /></button>
      </div>
      {selected && (
        <p className="text-xs text-s112-muted pl-1">
          Charge: <span className="font-medium text-s112-text-2">{selected.charge_name}</span>
        </p>
      )}
      {ueberzogen && (
        <p className="text-xs text-s112-err-fg pl-1 font-medium inline-flex items-center gap-1">
          <AlertTriangle size={12} strokeWidth={2} />Menge überschreitet verfügbaren Bestand ({fmt(selected!.menge_liter)})
        </p>
      )}
    </div>
  )
}

// ── Ziel-Zeile ────────────────────────────────────────────────────────────────

function ZielZeile({
  behaelter, quellen, value, menge, onChange, onRemove,
}: {
  behaelter: Behaelter[]
  // Alle aktiven Chargen (nicht nur die als Quelle wählbaren) - um im Ziel-Dropdown
  // anzuzeigen, was bereits in einem Behälter drinnen ist (analog zum Umziehen-Widget auf
  // der einzelnen Charge-Seite, das genau diese Info schon lange zeigt).
  quellen:   BehaelterMitCharge[]
  value:     string
  menge:     string
  onChange:  (id: string, menge: string) => void
  onRemove:  () => void
}) {
  // Inhalt + enthaltene Weine je Behälter (aus allen aktiven Chargen)
  const inhalt: Record<string, number> = {}
  const weinByGebinde: Record<string, string[]> = {}
  for (const c of quellen) {
    inhalt[c.behaelter_id] = (inhalt[c.behaelter_id] ?? 0) + (c.menge_liter || 0)
    const label = c.rebsorte ? formatRebsorteMitKuerzel(c.rebsorte) : c.charge_name
    if (!weinByGebinde[c.behaelter_id]) weinByGebinde[c.behaelter_id] = []
    if (!weinByGebinde[c.behaelter_id].includes(label)) weinByGebinde[c.behaelter_id].push(label)
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={value}
        onChange={e => onChange(e.target.value, menge)}
        required
        className="border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 flex-1 basis-full sm:basis-0 sm:min-w-[200px]"
      >
        <option value="">– Behälter wählen –</option>
        {behaelter.map(b => {
          // KAN-174 C: „Name · Inhalt – Charge | frei“ statt Kapazität
          return (
            <option key={b.id} value={b.id}>
              {gebindeOption({ name: b.name, inhaltLiter: inhalt[b.id] ?? 0, chargen: weinByGebinde[b.id] ?? [], volumenLiter: b.kapazitaet_liter })}
            </option>
          )
        })}
      </select>
      <input
        type="number"
        inputMode="decimal"
        value={menge}
        onChange={e => onChange(value, e.target.value)}
        min="0.001"
        step="0.001"
        placeholder="Liter"
        required
        className="border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 w-28 tabular-nums"
      />
      <span className="text-xs text-s112-muted w-8">L</span>
      <button aria-label="Zeile entfernen" type="button" onClick={onRemove} className="text-xs text-s112-err hover:text-s112-err-fg p-2 sm:py-0 sm:px-1"><X size={13} /></button>
    </div>
  )
}

// ── Umzug-Formular ────────────────────────────────────────────────────────────

function UmziehenForm({ quellen, behaelter, vonBehaelter = null }: { quellen: BehaelterMitCharge[]; behaelter: Behaelter[]; vonBehaelter?: string | null }) {
  const [pending, startTransition] = useTransition()
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState(false)
  // KAN-112: Hinweise „Als Verschnitt in … gebucht“ – einer je Ziel-Gebinde mit Verschnitt
  const [verschnitt, setVerschnitt] = useState<{ zeilen: string[]; chargeId: string | null }[] | null>(null)
  const [datum, setDatum]         = useState(new Date().toISOString().split('T')[0])
  const [notizen, setNotizen]     = useState('')
  const [umzugTyp, setUmzugTyp]   = useState<'normal' | 'filtration'>('normal')
  const router = useRouter()

  type QEntry = { id: string; chargeId: string; menge: string }
  type ZEntry = { id: string; behId: string; menge: string }

  // KAN-174 B: vom Gebinde aus – erste Charge dieses Gebindes als Quelle vorbelegt
  const [quellenState, setQuellen] = useState<QEntry[]>(() => [{
    id: crypto.randomUUID(),
    chargeId: (vonBehaelter ? quellen.find(q => q.behaelter_id === vonBehaelter)?.charge_id : undefined) ?? '',
    menge: '',
  }])
  const [ziele, setZiele]         = useState<ZEntry[]>([{ id: crypto.randomUUID(), behId: '', menge: '' }])

  const totalVon  = quellenState.reduce((s, q) => s + (parseFloat(q.menge) || 0), 0)
  const totalNach = ziele.reduce((s, z)         => s + (parseFloat(z.menge) || 0), 0)
  const schwund   = Math.max(0, +(totalVon - totalNach).toFixed(3))

  // Rebsortenmix-Vorschau (wie im Umziehen-Widget auf der einzelnen Charge-Seite): nur für
  // den häufigsten Fall genau EINE Quelle → genau EIN Ziel sicher berechenbar - bei mehreren
  // Quellen/Zielen übernimmt weiterhin die Server-Logik (actions.ts) die eigentliche
  // Erkennung, hier zeigen wir dann bewusst keine Vorab-Warnung an, um niemanden mit einer
  // falschen "passt schon"-Aussage in die Irre zu führen.
  const quelleRebsorte = quellenState.length === 1
    ? (quellen.find(q => q.charge_id === quellenState[0].chargeId)?.rebsorte ?? null)
    : null
  const zielBehId = ziele.length === 1 ? ziele[0].behId : null
  const andereRebsorten = zielBehId && quelleRebsorte
    ? [...new Set(
        quellen
          .filter(c => c.behaelter_id === zielBehId && c.rebsorte && c.rebsorte !== quelleRebsorte)
          .map(c => c.rebsorte as string)
      )]
    : []
  const hatRebsortenmix = andereRebsorten.length > 0

  // Weinart (21.9.2026): Rot + Weiß in einem Gebinde – Quellen untereinander bzw. Quelle gegen Inhalt eines Ziel-Gebindes.
  // KAN-193 (Entscheidung Jörgen 03.10.2026): kein Sperren mehr, sondern ein Hinweis – der Server bucht einen Verschnitt
  // mit Abstufung auf Wein (aus Österreich) nach einer Rückfrage (bzw. lehnt ab, wenn es keiner wäre).
  const quellChargen = quellenState.map(q => quellen.find(x => x.charge_id === q.chargeId)).filter((x): x is BehaelterMitCharge => !!x)
  const zielChargen = ziele.flatMap(z => quellen.filter(c => c.behaelter_id === z.behId && !quellChargen.some(q => q.charge_id === c.charge_id)))
  let weinartSperre: string | null = null
  for (let i = 1; i < quellChargen.length && !weinartSperre; i++) {
    if (weinartKonflikt(quellChargen[0].weinart, quellChargen[i].weinart)) weinartSperre = `„${quellChargen[0].charge_name}“ (${WEINART_LABEL[quellChargen[0].weinart!]}) und „${quellChargen[i].charge_name}“ (${WEINART_LABEL[quellChargen[i].weinart!]}).`
  }
  for (const q of quellChargen) for (const z of zielChargen) {
    if (weinartSperre) break
    if (weinartKonflikt(q.weinart, z.weinart)) weinartSperre = `„${q.charge_name}“ (${WEINART_LABEL[q.weinart!]}) nach ${z.behaelter_name} – dort liegt „${z.charge_name}“ (${WEINART_LABEL[z.weinart!]}).`
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (quellenState.some(q => !q.chargeId || !q.menge)) { setError('Alle Quell-Zeilen ausfüllen.'); return }
    if (ziele.some(z => !z.behId || !z.menge))         { setError('Alle Ziel-Zeilen ausfüllen.'); return }
    if (schwund < 0)                                    { setError('Ziel-Menge größer als Quell-Menge.'); return }

    // KAN-94: die gewählte Charge ist direkt die Quelle
    const quellenResolved = quellenState.map(q => ({ weinausbau_id: q.chargeId, menge: parseFloat(q.menge) }))

    const fd = new FormData()
    fd.set('quellen_json', JSON.stringify(quellenResolved))
    fd.set('ziele_json',   JSON.stringify(ziele.map(z => ({ behaelter_id: z.behId, menge: parseFloat(z.menge) }))))
    fd.set('datum', datum)
    fd.set('notizen', notizen)
    fd.set('umzug_typ', umzugTyp)
    startTransition(async () => {
      try {
        let result = await umziehen(fd)
        // KAN-83: Zusammenführung mit einer Charge mit Prüfnummer – nur nach Bestätigung buchen
        if (result?.bestaetigung) {
          if (!window.confirm(result.bestaetigung)) return
          fd.set('pn_bestaetigt', '1')
          fd.set('rotweiss_bestaetigt', '1')   // KAN-193: Rückfrage Rot/Weiß steht in derselben Bestätigung
          result = await umziehen(fd)
        }
        // KAN-112: abweichender Wein im Ziel-Gebinde – der Server hat den Umzug sofort als Verschnitt gebucht
        // (keine Zwischencharge, keine Weiterleitung ins Verschneiden-Formular mehr): Hinweis zeigen, nicht weiterleiten
        if (result?.verschnitte?.length) {
          const bloecke = result.verschnitte.map(v => ({ zeilen: verschnittHinweis(v), chargeId: v.zielChargeId }))
          // übrige Ziele per Umzug zusammengeführt – deren Qualitätsabstufung mit anzeigen
          if (result.abstufung) {
            bloecke.push({ zeilen: [`Umzug in die übrigen Gebinde gebucht – Abstufung von ${result.abstufung.vonLabel} auf ${result.abstufung.nachLabel}.`], chargeId: null })
          }
          setVerschnitt(bloecke)
          setSuccess(true)
          router.refresh()
          return
        }
        setSuccess(true)
        // KAN-224: zurück, woher man kam (Standard Kellerbuch), mit Bestätigung
        router.push(zielNachVorgang('/kellerbuch', 'umzug'))
      } catch (err) {
        setError(fehlerText(err, 'Fehler'))
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="card p-5 space-y-5">
      {error && <div className="bg-s112-err-bg border border-s112-err/30 text-s112-err-fg rounded-lg px-4 py-2 text-sm">{error}</div>}

      {/* Art des Vorgangs */}
      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-2">Art des Vorgangs</label>
        <div className="flex gap-2">
          <button type="button"
            onClick={() => setUmzugTyp('normal')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${umzugTyp === 'normal' ? 'bg-s112-teal text-s112-yellow border-s112-teal' : 'border-s112-border text-s112-text-2 hover:border-s112-teal hover:text-s112-blue-700'}`}>
            <ArrowLeftRight size={15} strokeWidth={1.75} />Umzug
          </button>
          <button type="button"
            onClick={() => setUmzugTyp('filtration')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border text-sm font-medium transition-colors ${umzugTyp === 'filtration' ? 'bg-s112-teal text-s112-yellow border-s112-teal' : 'border-s112-border text-s112-text-2 hover:border-s112-teal hover:text-s112-blue-700'}`}>
            <Filter size={15} strokeWidth={1.75} />Filtration
          </button>
        </div>
        {umzugTyp === 'filtration' && (
          <p className="text-xs text-s112-muted mt-1.5">
            Filtration: Wein wird über einen Filter in ein anderes Gebinde umgezogen. Schwund entsteht.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Datum *</label>
          <input aria-label="Datum" type="date" value={datum} onChange={e => setDatum(e.target.value)} required
            className="border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 w-full" />
        </div>
      </div>

      {/* Von Behälter */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-s112-text-1">Von Behälter</h3>
          <button type="button"
            onClick={() => setQuellen(p => [...p, { id: crypto.randomUUID(), chargeId: '', menge: '' }])}
            className="text-xs text-s112-blue-700 hover:underline">+ Quelle</button>
        </div>
        {quellenState.map(q => (
          <QuelleZeile key={q.id} quellen={quellen} value={q.chargeId} menge={q.menge}
            onChange={(cId, m) => setQuellen(p => p.map(x => x.id === q.id ? { ...x, chargeId: cId, menge: m } : x))}
            onRemove={() => quellenState.length > 1 && setQuellen(p => p.filter(x => x.id !== q.id))} />
        ))}
        <div className="text-xs text-s112-muted text-right tabular-nums">
          Gesamt: <span className="font-semibold text-s112-text-1">{fmt(totalVon)}</span>
        </div>
      </div>

      {/* Nach Behälter */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-s112-text-1">Nach Behälter</h3>
          <button type="button"
            onClick={() => setZiele(p => [...p, { id: crypto.randomUUID(), behId: '', menge: '' }])}
            className="text-xs text-s112-blue-700 hover:underline">+ Ziel</button>
        </div>
        {ziele.map(z => (
          <ZielZeile key={z.id} behaelter={behaelter} quellen={quellen} value={z.behId} menge={z.menge}
            onChange={(bId, m) => setZiele(p => p.map(x => x.id === z.id ? { ...x, behId: bId, menge: m } : x))}
            onRemove={() => ziele.length > 1 && setZiele(p => p.filter(x => x.id !== z.id))} />
        ))}
        <div className="text-xs text-s112-muted text-right tabular-nums">
          Gesamt: <span className="font-semibold text-s112-text-1">{fmt(totalNach)}</span>
        </div>
        {weinartSperre && (
          <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 text-xs text-s112-warn-fg flex items-start gap-1.5">
            <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span><span className="font-semibold">Rot- und Weißwein werden verschnitten – Abstufung auf Wein (aus Österreich):</span> {weinartSperre} Sind alle schon „Wein (ohne Herkunft)“, wird nicht abgestuft (KAN-170); sonst folgt beim Speichern eine Rückfrage.</span>
          </div>
        )}
        {hatRebsortenmix && !weinartSperre && (
          <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-lg px-3 py-2 text-xs text-s112-warn-fg flex items-start gap-1.5">
            <AlertTriangle size={14} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span>
              <span className="font-semibold">Rebsortenverschnitt:</span>{' '}
              Das Ziel-Gebinde enthält bereits Chargen mit Rebsorte <strong>{andereRebsorten.map(r => formatRebsorteMitKuerzel(r)).join(', ')}</strong>.
              Der Umzug wird als Verschnitt in die Charge im Ziel-Gebinde gebucht (KAN-112).
            </span>
          </div>
        )}
      </div>

      {/* Schwund */}
      <div className={`flex items-center justify-between px-4 py-2.5 rounded-lg ${schwund > 0 ? 'bg-s112-warn-bg border border-s112-warn/30' : 'bg-s112-bg border border-s112-border'}`}>
        <span className="text-sm font-medium text-s112-text-1">Schwund (auto-berechnet)</span>
        <span className={`text-sm font-semibold tabular-nums ${schwund > 0 ? 'text-s112-warn-fg' : 'text-s112-muted'}`}>{fmt(schwund)}</span>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
        <input aria-label="Notizen" type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
          className="border border-s112-border rounded-lg px-3 py-2.5 sm:py-2 text-base sm:text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40 w-full"
          placeholder="Optional" />
      </div>

      {/* KAN-181: am Handy bleibt die Leiste beim Scrollen unten sichtbar */}
      <div className="max-sm:sticky max-sm:bottom-0 max-sm:-mx-5 max-sm:-mb-5 max-sm:px-5 max-sm:py-3 max-sm:bg-s112-bg max-sm:border-t max-sm:border-s112-line max-sm:z-10">
        {success && verschnitt ? (
          <div role="status" className="bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg rounded-xl px-5 py-3 text-sm space-y-2">
            {verschnitt.map((b, k) => (
              <div key={k} className="space-y-1">
                {b.zeilen.map((z, i) => (
                  <p key={i} className={i === 0 ? 'font-semibold flex items-center gap-2' : 'text-xs'}>
                    {i === 0 && <CheckCircle2 size={16} strokeWidth={1.75} />}{z}
                  </p>
                ))}
                {b.chargeId && <p className="text-xs"><Link href={`/kellerbuch/weinausbau/${b.chargeId}`} className="underline">Zur Charge</Link></p>}
              </div>
            ))}
            <p className="text-xs pt-1">
              <Link href="/kellerbuch" className="underline">Zur Übersicht</Link>
            </p>
          </div>
        ) : success ? (
          <div className="flex items-center justify-center gap-2 bg-s112-ok-bg border border-s112-ok/30 text-s112-ok-fg rounded-xl px-5 py-3 text-sm font-semibold">
            <CheckCircle2 size={16} strokeWidth={1.75} />Gespeichert – weiterleiten…
          </div>
        ) : (
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-s112-yellow px-5 py-3 sm:py-2 rounded-xl text-base sm:text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-40 w-full">
            {pending ? 'Wird verarbeitet…' : `Umziehen (${fmt(totalVon)} → ${fmt(totalNach)}${schwund > 0 ? `, ${fmt(schwund)} Schwund` : ''})`}
          </button>
        )}
      </div>
    </form>
  )
}

// ── Protokoll-Zeile mit Edit / Delete ─────────────────────────────────────────

function UmzugZeile({ u, writeOk }: { u: UmzugRow; writeOk: boolean }) {
  // KAN-35: Bei Schwundbuchungen sind Datum/Menge nie änderbar (nur Notizen); stornieren dürfen
  // sie nur Betriebs-Manager. Umzüge sind nur stornierbar bzw. im Datum änderbar, solange die
  // Ziel-Charge nicht weiterbewegt wurde – der Server meldet sonst den Grund.
  const istSchwund = u.umzug_typ === 'schwund'
  const [editing, setEditing]       = useState(false)
  const datum = u.datum
  const [notizen, setNotizen]       = useState(u.notizen ?? '')
  const [pending, startTransition]  = useTransition()
  const [error, setError]           = useState<string | null>(null)
  const router = useRouter()

  function handleSave() {
    setError(null)
    startTransition(async () => {
      try {
        await updateUmzug(u.id, datum, notizen || null)
        setEditing(false)
        router.refresh()   // Server-Daten neu laden
      } catch (err) {
        setError(fehlerText(err, 'Fehler beim Speichern'))
      }
    })
  }

  if (editing) {
    return (
      <tr className="bg-s112-blue-50/50 border-b border-s112-border">
        <td className="px-3 py-2">
          {/* KAN-207: das Datum ist nach dem Speichern fest – Korrektur über Stornieren und Neubuchen */}
          <span className="text-xs text-s112-muted tabular-nums" title="Datum fest – Korrektur über Stornieren und neu buchen">{new Date(u.datum).toLocaleDateString('de-AT')}</span>
        </td>
        <td className="px-3 py-2 text-xs text-s112-text-2">{u.von_name}</td>
        <td className="px-3 py-2 text-xs text-s112-text-2">{u.nach_name}</td>
        <td className="px-3 py-2 text-right tabular-nums text-xs text-s112-blue-700 font-semibold">{fmt(u.menge_liter)}</td>
        <td className="px-3 py-2">
          <input type="text" value={notizen} onChange={e => setNotizen(e.target.value)}
            placeholder="Notizen…"
            className="border border-s112-border rounded-sm px-2 py-1 text-base sm:text-xs w-full min-w-[120px]" />
          {error && <p role="alert" className="text-xs text-s112-err-fg mt-0.5 whitespace-normal wrap-break-word">{error}</p>}
        </td>
        <td className="px-3 py-2 text-right whitespace-nowrap">
          <button onClick={handleSave} disabled={pending}
            className="text-xs bg-s112-teal text-s112-yellow px-2 py-1 rounded-sm hover:bg-s112-teal/90 disabled:opacity-40 mr-1">
            {pending ? '…' : 'Speichern'}
          </button>
          <button onClick={() => setEditing(false)}
            className="text-xs text-s112-muted hover:text-s112-text-1 px-1">Abbrechen</button>
        </td>
      </tr>
    )
  }

  return (
    <tr className={`border-b border-s112-border last:border-0 ${u.storno ? 'opacity-70' : 'hover:bg-s112-bg/50'}`}>
      <td className="px-4 py-2.5 tabular-nums text-s112-muted text-xs">
        {new Date(u.datum).toLocaleDateString('de-AT')}
      </td>
      <td className="px-4 py-2.5 text-sm">
        <span className="font-medium text-s112-text">{u.von_name}</span>
        {u.umzug_typ === 'filtration' && (
          <span className="ml-1.5 text-xs bg-s112-blue-100 text-s112-blue-700 px-1.5 py-0.5 rounded-full">Filtration</span>
        )}
        {istSchwund && (
          <span className="ml-1.5 text-xs bg-s112-warn-bg text-s112-warn-fg px-1.5 py-0.5 rounded-full">Schwund</span>
        )}
        {u.storno && (
          <span className="block text-[11px] text-s112-warn-fg">
            storniert am {new Date(u.storno.am).toLocaleDateString('de-AT')}{u.storno.von ? ` von ${u.storno.von}` : ''}{u.storno.grund ? ` – ${u.storno.grund}` : ''}
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-s112-text-2 text-sm">{u.nach_name}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-s112-blue-700 font-semibold text-sm">{fmt(u.menge_liter)}</td>
      <td className="px-4 py-2.5 text-right tabular-nums text-s112-muted text-sm">
        {u.schwund_liter > 0 ? fmt(u.schwund_liter) : '–'}
        {u.notizen && <span className="block text-xs text-s112-muted truncate max-w-[120px]">{u.notizen}</span>}
      </td>
      {writeOk && u.storno && (
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          {/* KAN-145 B4: endgültig löschen nur stornierter Buchungen, mit Grund */}
          <StornoButton modus="loeschen" label="Endgültig löschen" danach={() => router.refresh()}
            action={grund => endgueltigLoeschen('keller_umzuege', u.id, grund)}
            hinweis="Nur bei Fehlbuchungen: Die stornierte Buchung wird endgültig entfernt – Grund und Benutzer stehen im Änderungsprotokoll." />
        </td>
      )}
      {writeOk && !u.storno && (
        <td className="px-4 py-2.5 text-right whitespace-nowrap">
          <span className="inline-flex items-start gap-2">
            <button onClick={() => setEditing(true)}
              title={istSchwund ? 'Notizen bearbeiten' : 'Bearbeiten'} aria-label="Bearbeiten"
              className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil size={15} strokeWidth={1.75} /></button>
            {/* KAN-145: Stornieren mit Grund – die Buchung bleibt gekennzeichnet stehen; Schwund seit B4 auch für Mitarbeiter */}
            <StornoButton action={grund => deleteUmzug(u.id, grund)} danach={() => router.refresh()}
              hinweis={istSchwund ? 'Die Menge wird auf die Charge zurückgebucht; die Schwundbuchung bleibt als storniert stehen – nur wenn sie den Bestand gemindert hat und an der Charge seither nichts gebucht wurde.' : 'Die Bestände werden zurückgebucht; der Umzug bleibt als storniert im Bewegungsbuch – nur solange die Ziel-Charge seither nicht weiterbewegt wurde.'} />
          </span>
          {error && (
            <p role="alert" className="text-xs text-s112-err-fg mt-0.5 ml-auto w-[260px] max-w-[70vw] text-left whitespace-normal wrap-break-word">{error}</p>
          )}
        </td>
      )}
    </tr>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function UmziehenClient({
  behaelterMitChargen, behaelter, umzuege, writeOk, initialShowForm = false, vonBehaelter = null,
}: {
  behaelterMitChargen: BehaelterMitCharge[]
  behaelter:           Behaelter[]
  umzuege:             UmzugRow[]
  writeOk:             boolean
  initialShowForm?:    boolean
  /** KAN-174 B: Quell-Gebinde vorbelegen */
  vonBehaelter?:       string | null
}) {
  const [showForm, setShowForm] = useState(initialShowForm)

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-s112-muted">
        <Link href="/kellerbuch" className="hover:text-s112-blue-700 transition-colors">Kellerbuch</Link>
        <span>/</span>
        <span className="text-s112-text-1 font-medium">Umziehen</span>
      </div>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-s112-text">Umziehen</h1>
          <p className="text-sm text-s112-muted mt-0.5">Wein zwischen Behältern verschieben · Schwund wird automatisch berechnet</p>
        </div>
        {writeOk && (
          <button onClick={() => setShowForm(o => !o)}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-s112-teal/90">
            {showForm ? 'Abbrechen' : '+ Neuer Umzug'}
          </button>
        )}
      </div>

      {showForm && writeOk && (
        <UmziehenForm quellen={behaelterMitChargen} behaelter={behaelter} vonBehaelter={vonBehaelter} />
      )}

      {/* Protokoll */}
      <div className="space-y-2">
        <h2 className="text-base font-semibold text-s112-text">Umzug-Protokoll</h2>
        {umzuege.length === 0 ? (
          <div className="card p-6 text-center text-s112-muted text-sm">Noch keine Umzüge protokolliert.</div>
        ) : (
          <div className="card p-0 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-s112-bg border-b border-s112-border">
                  <th className="text-left px-4 py-2.5 font-semibold text-s112-text-1">Datum</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-s112-text-1">Von</th>
                  <th className="text-left px-4 py-2.5 font-semibold text-s112-text-1">Nach</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-s112-text-1">Menge</th>
                  <th className="text-right px-4 py-2.5 font-semibold text-s112-text-1">Schwund / Notizen</th>
                  {writeOk && <th className="px-4 py-2.5" />}
                </tr>
              </thead>
              <tbody>
                {umzuege.map(u => (
                  <UmzugZeile key={u.id} u={u} writeOk={writeOk} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
