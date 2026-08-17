'use client'

// Beleg-Buchen-Formular (Client Component) - ausgelagert aus page.tsx, weil
// die Lieferanten-Zuordnung (Migration 167) Interaktivität braucht: erkennt
// die Belege-OCR bei einer Ausgabe einen Lieferantennamen, wird versucht,
// eine bestehende Firma zu finden und automatisch zu verknüpfen. Ohne Treffer
// wird gefragt, ob eine neue Firma (Lieferant) angelegt werden soll - "Ja"
// öffnet die bestehende Firmen-Anlage (FirmaForm) inline, "Nein" bucht ohne
// Lieferanten weiter (z.B. Tankrechnungen/Kassenbons brauchen keinen).

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Trash2, Building2, X } from 'lucide-react'
import { verbucheBeleg } from '../../actions'
import { FirmaForm } from '@/app/(dashboard)/crm/firmen/FirmenClient'
import type { FirmaRow } from '@/lib/crm/types'
import ConfirmDeleteForm from '@/components/ui/ConfirmDeleteForm'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

const UST_SAETZE = [
  { value: 0,  label: '0% (Export / befreit)' },
  { value: 10, label: '10%' },
  { value: 13, label: '13% (Wein, Landwirtschaft)' },
  { value: 20, label: '20% (Standard)' },
]

type Kategorie = { id: string; name: string; typ: string; abzugsfaehigPct: number }
type Konto = { id: string; name: string }

export default function BelegBuchenForm({
  belegId, dateiname, status, fehlerDetails, erkannt, ustStandard,
  einnahmeKat, ausgabeKat, konten, lieferanten, allFirmen, rabattgruppen,
  verwerfenAction,
}: {
  belegId: string
  dateiname: string
  status: string
  fehlerDetails: string | null
  erkannt: R
  ustStandard: number
  einnahmeKat: Kategorie[]
  ausgabeKat: Kategorie[]
  konten: Konto[]
  lieferanten: FirmaRow[]
  allFirmen: FirmaRow[]
  rabattgruppen: { id: string; name: string; rabatt_pct: number }[]
  verwerfenAction: () => Promise<void>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)

  const e = erkannt
  const lieferantName: string | null = e.lieferant_name ?? null
  const vorschlagId: string | null   = e.firma_id_vorschlag ?? null

  const [firmaId, setFirmaId] = useState<string | null>(vorschlagId)
  // 'offen' = Frage noch nicht beantwortet, 'beantwortet' = Ja/Nein wurde
  // geklärt (oder war von Anfang an nicht nötig, weil kein Name erkannt wurde).
  const [frageOffen, setFrageOffen] = useState(!vorschlagId && !!lieferantName)
  const [zeigeFirmaDialog, setZeigeFirmaDialog] = useState(false)
  const [zeigeManuelleSuche, setZeigeManuelleSuche] = useState(false)
  const [sucheQuery, setSucheQuery] = useState('')
  const [kategorieId, setKategorieId] = useState(e.kategorie_id ?? '')

  const alleKategorien = [...einnahmeKat, ...ausgabeKat]
  const gewaehlteKategorie = alleKategorien.find(k => k.id === kategorieId) ?? null

  const gefundeneFirma = firmaId ? (lieferanten.find(f => f.id === firmaId) ?? allFirmen.find(f => f.id === firmaId)) : null
  const sucheTreffer = sucheQuery.length < 1
    ? lieferanten.slice(0, 30)
    : lieferanten.filter(f => f.name.toLowerCase().includes(sucheQuery.toLowerCase())).slice(0, 30)

  function handleSubmit(fd: FormData) {
    setSubmitError(null)
    fd.set('firma_id', firmaId ?? '')
    startTransition(async () => {
      const result = await verbucheBeleg(belegId, fd)
      if (result?.error) { setSubmitError(result.error); return }
      router.push('/buchhaltung/belege')
    })
  }

  return (
    <div className="bg-white rounded-2xl border border-s112-border p-6 space-y-5">
      {status === 'fehler' && (
        <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-sm px-3 py-2.5 rounded-lg">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Automatische Erkennung fehlgeschlagen{fehlerDetails ? ` (${fehlerDetails})` : ''} – bitte alle Felder manuell ausfüllen.</span>
        </div>
      )}
      {e.hinweis && (
        <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-sm px-3 py-2.5 rounded-lg">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{e.hinweis}</span>
        </div>
      )}
      {e.konfidenz && e.konfidenz !== 'hoch' && (
        <p className="text-xs text-s112-muted">Erkennungssicherheit: {e.konfidenz === 'mittel' ? 'mittel' : 'niedrig'} – bitte Werte vor dem Buchen prüfen.</p>
      )}
      {submitError && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2.5 rounded-lg">{submitError}</div>
      )}

      {/* ── Lieferanten-Zuordnung ─────────────────────────────────────────── */}
      {gefundeneFirma ? (
        <div className="flex items-center gap-2 bg-s112-teal/5 border border-s112-teal/30 rounded-xl px-3 py-2.5 text-sm">
          <Building2 className="w-4 h-4 text-s112-teal flex-shrink-0" />
          <span className="flex-1">
            Lieferant: <span className="font-medium text-gray-800">{gefundeneFirma.name}</span>
            {vorschlagId === firmaId && <span className="text-xs text-s112-muted"> (automatisch erkannt)</span>}
          </span>
          <button type="button" onClick={() => { setFirmaId(null); setFrageOffen(false) }}
            className="text-s112-muted hover:text-red-500" title="Verknüpfung entfernen">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : frageOffen ? (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm space-y-2">
          <p className="text-amber-800">
            Konnte keinen bestehenden Lieferanten für „{lieferantName}" finden. Soll ein neuer Lieferant erstellt werden?
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setZeigeFirmaDialog(true); setFrageOffen(false) }}
              className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-700">
              Ja, Lieferant anlegen
            </button>
            <button type="button" onClick={() => setFrageOffen(false)}
              className="border border-amber-400 text-amber-700 px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-100">
              Nein, ohne Lieferant buchen
            </button>
          </div>
        </div>
      ) : zeigeManuelleSuche ? (
        <div className="border border-s112-border rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="block text-xs font-medium text-gray-600">Lieferant suchen</label>
            <button type="button" onClick={() => setZeigeManuelleSuche(false)} className="text-s112-muted hover:text-gray-700">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <input type="text" value={sucheQuery} onChange={ev => setSucheQuery(ev.target.value)}
            placeholder="Name eingeben…" autoFocus
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {sucheTreffer.map(f => (
              <button key={f.id} type="button"
                onClick={() => { setFirmaId(f.id); setZeigeManuelleSuche(false) }}
                className="w-full text-left px-2 py-1.5 text-sm rounded-lg hover:bg-s112-teal/10">
                {f.name}
              </button>
            ))}
            {sucheTreffer.length === 0 && <p className="text-xs text-s112-muted px-2 py-1">Kein Lieferant gefunden.</p>}
          </div>
          <button type="button" onClick={() => { setZeigeFirmaDialog(true); setZeigeManuelleSuche(false) }}
            className="text-xs text-s112-teal hover:underline">+ Neuen Lieferanten anlegen</button>
        </div>
      ) : (
        <button type="button" onClick={() => setZeigeManuelleSuche(true)}
          className="text-xs text-s112-muted hover:text-s112-teal">+ Lieferant zuordnen (optional)</button>
      )}

      {zeigeFirmaDialog && (
        <FirmaForm
          rabattgruppen={rabattgruppen}
          existingFirmen={allFirmen}
          prefillName={lieferantName ?? ''}
          defaultIstLieferant={true}
          defaultIstKunde={false}
          onDone={() => setZeigeFirmaDialog(false)}
          onCreated={(id) => { setFirmaId(id); setZeigeFirmaDialog(false) }}
        />
      )}

      {/* ── Buchungsformular ──────────────────────────────────────────────── */}
      <form action={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-2">Typ *</label>
          <div className="flex gap-3">
            {[
              { value: 'einnahme', label: '↑ Einnahme', color: 'text-green-700 border-green-300 bg-green-50' },
              { value: 'ausgabe',  label: '↓ Ausgabe',  color: 'text-red-600 border-red-300 bg-red-50'     },
            ].map(t => (
              <label key={t.value} className={`flex items-center gap-2 px-4 py-2 rounded-xl border cursor-pointer text-sm font-medium ${t.color}`}>
                <input type="radio" name="typ" value={t.value} required
                  defaultChecked={(e.typ ?? 'ausgabe') === t.value}
                  className="accent-current" />
                {t.label}
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Datum *</label>
            <input type="date" name="datum" required
              defaultValue={e.datum ?? new Date().toISOString().split('T')[0]}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">USt-Satz *</label>
            <select name="ust_satz" defaultValue={e.ust_satz ?? ustStandard}
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              {UST_SAETZE.map(u => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Bezeichnung *</label>
          <input name="beschreibung" required defaultValue={e.beschreibung ?? ''}
            placeholder="z.B. Diesel Tankstelle Müller"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Betrag Netto (€) *</label>
          <input type="number" name="betrag_netto" step="0.01" min="0" required
            defaultValue={e.betrag_netto ?? ''} placeholder="0.00"
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
          {e.betrag_brutto != null && (
            <p className="text-xs text-s112-muted mt-1">
              Erkannter Bruttobetrag auf dem Beleg: € {Number(e.betrag_brutto).toLocaleString('de-AT', { minimumFractionDigits: 2 })}
            </p>
          )}
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Kategorie</label>
          <select name="kategorie_id" value={kategorieId} onChange={ev => setKategorieId(ev.target.value)}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– keine –</option>
            <optgroup label="Einnahmen">
              {einnahmeKat.map(k => <option key={k.id} value={k.id}>{k.name}{k.abzugsfaehigPct < 100 ? ` — nur ${k.abzugsfaehigPct}% abzugsfähig` : ''}</option>)}
            </optgroup>
            <optgroup label="Ausgaben">
              {ausgabeKat.map(k => <option key={k.id} value={k.id}>{k.name}{k.abzugsfaehigPct < 100 ? ` — nur ${k.abzugsfaehigPct}% abzugsfähig` : ''}</option>)}
            </optgroup>
          </select>
          {gewaehlteKategorie && gewaehlteKategorie.abzugsfaehigPct < 100 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 mt-1.5">
              Nur {gewaehlteKategorie.abzugsfaehigPct}% dieser Ausgabe ist steuerlich abzugsfähig (§ 20 EStG) – wird automatisch erfasst und in der Übersicht ausgewiesen.
            </p>
          )}
        </div>

        {konten.length > 0 && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Konto</label>
            <select name="konto_id" defaultValue=""
              className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
              <option value="">– keines –</option>
              {konten.map(k => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
            <p className="text-xs text-s112-muted mt-1">Optional – wenn gesetzt, erscheint die Buchung in der Kontoabstimmung dieses Kontos.</p>
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
          <textarea name="notizen" rows={2} defaultValue={`Beleg: ${dateiname}`}
            className="w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 resize-none" />
        </div>

        <div className="flex gap-3 pt-2">
          <button type="submit" disabled={pending}
            className="bg-s112-teal text-white px-6 py-2.5 rounded-xl text-sm font-semibold hover:bg-opacity-90 disabled:opacity-40">
            {pending ? 'Wird gebucht…' : 'Buchung anlegen'}
          </button>
          <Link href="/buchhaltung/belege"
            className="px-6 py-2.5 rounded-xl text-sm border border-s112-border text-gray-600 hover:bg-s112-bg">
            Später
          </Link>
        </div>
      </form>

      <div className="pt-3 border-t border-s112-border">
        <ConfirmDeleteForm
          action={verwerfenAction}
          message="Beleg verwerfen? Die Datei wird endgültig gelöscht, es entsteht keine Buchung."
          label={<span className="inline-flex items-center gap-1.5"><Trash2 size={14} /> Beleg verwerfen</span>}
          title="Verwerfen"
          className="text-xs text-red-400 hover:text-red-600"
        />
      </div>
    </div>
  )
}
