'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { paramsAusFilter, LISTE_SCHRITT, type ListenFilter, type Zaehler } from '@/lib/crm/liste'
import { useListenSuche } from '@/lib/crm/listenSuche'
import Link from '@/components/ui/Link'
import CsvExportKnopf from '@/components/CsvExportKnopf'
import { createFirma, updateFirma, deleteFirma, pruefeFirmaDublette } from '../actions'
import { SEGMENTE, LAENDER, DIAL_CODES, segmentLabel, segmentFarbe } from '@/lib/crm/types'
import type { FirmaRow } from '@/lib/crm/types'
import { AlertTriangle, Pencil, Trash2 } from 'lucide-react'

type KontaktKurz = { id: string; vorname: string | null; nachname: string; segment: string }

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

const WAEHRUNGEN = ['EUR', 'USD', 'GBP', 'CHF', 'HUF', 'CZK']

// ── Formular ──────────────────────────────────────────────────────────────────

export function FirmaForm({
  initial, rabattgruppen = [], defaultSegment, existingFirmen, onDone, onCreated,
  prefillName, defaultIstKunde, defaultIstLieferant,
}: {
  initial?: FirmaRow | null
  rabattgruppen?: {id:string;name:string;rabatt_pct:number}[]
  defaultSegment?: string
  existingFirmen?: FirmaRow[]
  onDone: () => void
  // Wird zusätzlich zu onDone aufgerufen, wenn eine NEUE Firma erfolgreich
  // angelegt wurde (nicht bei Bearbeitung) - übergibt deren neue ID, damit
  // der Aufrufer sie direkt weiterverknüpfen kann (z.B. Belege-OCR-
  // Lieferantenzuordnung). Bestehende Aufrufer (Firmenliste, Firma
  // bearbeiten) lassen das weg und verhalten sich unverändert.
  onCreated?: (id: string) => void
  // Vorbefüllung bei Neuanlage aus einem anderen Kontext heraus (z.B. der aus
  // einem Beleg erkannte Lieferantenname) - initial hat hier bewusst Vorrang,
  // falls doch im Bearbeiten-Modus aufgerufen.
  prefillName?: string
  defaultIstKunde?: boolean
  defaultIstLieferant?: boolean
}) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const [segmentVal, setSegmentVal] = useState(initial?.segment ?? defaultSegment ?? 'handel')
  const [isLead, setIsLead]           = useState(initial?.is_lead ?? true)
  const [landVal, setLandVal]           = useState(initial?.land ?? 'AT')
  const [istKunde, setIstKunde]         = useState(initial?.ist_kunde ?? defaultIstKunde ?? true)
  const [istLieferant, setIstLieferant] = useState(initial?.ist_lieferant ?? defaultIstLieferant ?? false)
  const [saveError, setSaveError]   = useState<string | null>(null)
  const [dubletteWarnung, setDubletteWarnung] = useState<string | null>(null)
  const [dubletteIgnorieren, setDubletteIgnorieren] = useState(false)
  const v = (field: keyof FirmaRow) => (initial?.[field] ?? '') as string

  useEffect(() => {
    if (!initial && defaultSegment) setSegmentVal(defaultSegment)
  }, [defaultSegment, initial])

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    setSaveError(null)

    // Dublettenprüfung nur bei Neuanlage - serverseitig (17.9.2026), da die
    // Liste nicht mehr alle Firmen enthält.
    if (!initial && !dubletteIgnorieren) {
      const eingabe = { name: ((fd.get('name') as string) ?? ''), strasse: ((fd.get('strasse') as string) ?? ''), plz: ((fd.get('plz') as string) ?? ''), ort: ((fd.get('ort') as string) ?? '') }
      startTransition(async () => {
        const d = await pruefeFirmaDublette(eingabe)
        if (d.name) { setDubletteWarnung(`Eine Firma „${d.name}" ist bereits vorhanden.`); return }
        if (d.adresse) { setDubletteWarnung(`Eine Firma mit dieser Adresse ist bereits vorhanden: ${d.adresse}.`); return }
        const result = await createFirma(fd)
        if (result?.error) { setSaveError(result.error); return }
      if (!initial && result?.id && onCreated) {
        onCreated(result.id)
      } else {
        onDone()
      }
      router.refresh()
    })
      return
    }

    startTransition(async () => {
      const result = initial
        ? await updateFirma(initial.id, fd)
        : await createFirma(fd)
      if (result?.error) {
        setSaveError(result.error)
        return
      }
      if (!initial && result?.id && onCreated) {
        onCreated(result.id)
      } else {
        onDone()
      }
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-s112-text">{initial ? 'Firma bearbeiten' : 'Neue Firma'}</h3>
      {saveError && <p className="text-xs text-s112-err-fg bg-s112-err-bg border border-s112-err/30 rounded-lg px-3 py-2">{saveError}</p>}
      {dubletteWarnung && (
        <div className="bg-s112-warn-bg border border-s112-warn/30 rounded-xl px-4 py-3 text-sm">
          <p className="font-medium text-s112-warn-fg mb-1 flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> Mögliche Dublette</p>
          <p className="text-s112-warn-fg mb-3">{dubletteWarnung}</p>
          <p className="text-s112-warn-fg mb-3">Möchten Sie den Eintrag trotzdem übernehmen oder verwerfen?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setDubletteIgnorieren(true); setDubletteWarnung(null); setTimeout(() => { (document.activeElement as HTMLElement)?.closest('form')?.requestSubmit() }, 10) }}
              className="bg-s112-warn-fg text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90">
              Trotzdem übernehmen
            </button>
            <button type="button" onClick={() => { setDubletteWarnung(null); onDone() }}
              className="border border-s112-warn/50 text-s112-warn-fg px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-s112-warn-bg">
              Verwerfen
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Firmenname *</label>
          <input aria-label="Firmenname" name="name" defaultValue={v('name') || prefillName || ''} required className={inputCls()} />
        </div>
        {/* Kunde / Lieferant - Migration 167 */}
        <div className="sm:col-span-2 flex items-center gap-5 bg-white border border-s112-border rounded-xl px-4 py-2.5">
          <input type="hidden" name="ist_kunde" value={String(istKunde)} />
          <input type="hidden" name="ist_lieferant" value={String(istLieferant)} />
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <input type="checkbox" checked={istKunde} onChange={e => setIstKunde(e.target.checked)}
              className="accent-s112-teal w-4 h-4" />
            Kunde
          </label>
          <label className="flex items-center gap-2 cursor-pointer select-none text-sm">
            <input type="checkbox" checked={istLieferant} onChange={e => setIstLieferant(e.target.checked)}
              className="accent-s112-teal w-4 h-4" />
            Lieferant
          </label>
          <p className="text-[11px] text-s112-tertiary ml-auto">Eine Firma kann Kunde, Lieferant oder beides sein.</p>
        </div>
        {/* Lead / Kunde Toggle */}
        <div className="sm:col-span-2 flex items-center justify-between bg-white border border-s112-border rounded-xl px-4 py-2.5">
          <div>
            <p className={`text-sm font-semibold ${isLead ? 'text-s112-warn-fg' : 'text-s112-blue-700'}`}>
              {isLead ? 'Lead' : 'Aktiv'}
            </p>
            <p className="text-xs text-s112-muted">
              {isLead ? 'Noch kein Verkauf – wird automatisch Kunde beim ersten Verkauf' : ''}
            </p>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="hidden" name="is_lead" value={String(isLead)} />
            <button type="button" role="switch" aria-checked={!isLead} aria-label="Kunde (aus) oder Lead" onClick={() => setIsLead(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${isLead ? 'bg-s112-grey' : 'bg-s112-teal'}`}>
              <span className={`block w-4 h-4 rounded-full bg-white shadow transition-transform ${isLead ? 'translate-x-0' : 'translate-x-5'}`} />
            </button>
            <span className={`text-sm font-semibold min-w-[48px] ${isLead ? 'text-s112-warn-fg' : 'text-s112-blue-700'}`}>
              {isLead ? 'Lead' : 'Aktiv'}
            </span>
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Segment *</label>
          <select aria-label="Segment" name="segment" value={segmentVal} onChange={e => setSegmentVal(e.target.value)} required className={inputCls()}>
            {SEGMENTE.filter(s => s.value !== 'privat').map(s =>
              <option key={s.value} value={s.value}>{s.label}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">UID-Nummer</label>
          <input aria-label="UID-Nummer" name="uid_nummer" defaultValue={v('uid_nummer')} placeholder="ATU…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">BKI-Betriebsnummer</label>
          <input aria-label="BKI-Betriebsnummer" name="betrieb_nr" defaultValue={v('betrieb_nr' as keyof FirmaRow)} placeholder="z.B. 905721" className={inputCls()} />
          <p className="text-[11px] text-s112-tertiary mt-0.5">Betriebsnummer des Abnehmers für BKI-Transportliste</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">DebitorNr.</label>
          <input aria-label="DebitorNr." name="debitor_nr" defaultValue={v('debitor_nr' as keyof FirmaRow)} placeholder="z.B. 227002" className={inputCls()} />
          <p className="text-[11px] text-s112-tertiary mt-0.5">Kontonummer im BMD-Kontenplan (Buchhaltung), falls dort bereits angelegt</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Straße</label>
          <input aria-label="Straße" name="strasse" defaultValue={v('strasse')} className={inputCls()} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-medium text-s112-text-2 mb-1">PLZ</label>
            <input aria-label="PLZ" name="plz" defaultValue={v('plz')} className={inputCls()} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-s112-text-2 mb-1">Ort</label>
            <input aria-label="Ort" name="ort" defaultValue={v('ort')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Land</label>
          <select aria-label="Land" name="land" value={landVal} onChange={e => setLandVal(e.target.value)} className={inputCls()}>
            {LAENDER.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Telefon</label>
          <div className="flex gap-1.5">
            <select
              name="telefon_vorwahl"
              defaultValue={initial?.telefon_vorwahl ?? '+43'}
              onChange={e => {
                const d = DIAL_CODES.find(x => x.code === e.target.value)
                if (d) setLandVal(d.iso)
              }}
              className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-24 flex-shrink-0"
            >
              {DIAL_CODES.map(d => (
                <option key={d.code} value={d.code}>{d.flag} {d.code}</option>
              ))}
            </select>
            <input name="telefon" defaultValue={v('telefon')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Mobil</label>
          <div className="flex gap-1.5">
            <select
              name="mobil_vorwahl"
              defaultValue={initial?.mobil_vorwahl ?? '+43'}
              className="border border-s112-border rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40 w-24 flex-shrink-0"
            >
              {DIAL_CODES.map(d => (
                <option key={d.code} value={d.code}>{d.flag} {d.code}</option>
              ))}
            </select>
            <input name="mobil" defaultValue={v('mobil' as keyof FirmaRow)} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">E-Mail <span className="text-s112-muted font-normal">(Standard: Newsletter, Rechnung)</span></label>
          <input aria-label="E-Mail (Standard: Newsletter, Rechnung)" name="email" type="email" defaultValue={v('email')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Weitere E-Mail-Adressen <span className="text-s112-muted font-normal">(mit Komma trennen)</span></label>
          <input aria-label="Weitere E-Mail-Adressen (mit Komma trennen)" name="email_weitere" defaultValue={(initial?.email_weitere ?? []).join(', ')} placeholder="bestellung@…, buchhaltung@…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Website</label>
          <input aria-label="Website" name="website" defaultValue={v('website')} placeholder="https://…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Zahlungsziel (Tage) *</label>
          {/* Bewusst NICHT ueber den v()-Helfer (initial?.[field] ?? '') || '30' -
              das wuerde eine eingetragene 0 stillschweigend durch 30 ersetzen,
              0 ist hier aber ein gueltiger, bewusster Wert ("bei Erhalt"). */}
          <input aria-label="Zahlungsziel (Tage)" name="zahlungsziel_tage" type="number" required defaultValue={initial?.zahlungsziel_tage ?? 30}
            min="0" max="365" className={inputCls()} />
          <p className="text-[11px] text-s112-tertiary mt-0.5">0 = Rechnung wird mit "bei Erhalt" statt Fälligkeitsdatum gedruckt</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Währung</label>
          <select aria-label="Währung" name="waehrung" defaultValue={v('waehrung') || 'EUR'} className={inputCls()}>
            {WAEHRUNGEN.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Rabattgruppe</label>
          <select aria-label="Rabattgruppe" name="rabattgruppe_id" defaultValue={initial?.rabattgruppe_id ?? ''} className={inputCls()}>
            <option value="">– kein Rabatt –</option>
            {rabattgruppen.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.rabatt_pct}%)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Sonderrabatt %</label>
          <input aria-label="Sonderrabatt %"
            name="sonderrabatt_pct"
            type="number"
            min="0" max="100" step="0.5"
            defaultValue={initial?.sonderrabatt_pct ?? 0}
            placeholder="0"
            className={inputCls()}
          />
        </div>
      </div>

      <div className="flex gap-2">
        <div className="flex-1">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Skonto %</label>
          <input aria-label="Skonto %"
            name="skonto_pct"
            type="number"
            min="0" max="20" step="0.5"
            defaultValue={initial?.skonto_pct ?? 0}
            placeholder="0"
            className={inputCls()}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Skonto-Frist (Tage)</label>
          <input aria-label="Skonto-Frist (Tage)"
            name="skonto_tage"
            type="number"
            min="0" max="60" step="1"
            defaultValue={initial?.skonto_tage ?? 10}
            placeholder="10"
            className={inputCls()}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
        <textarea aria-label="Notizen" name="notizen" defaultValue={v('notizen')} rows={2}
          className={inputCls() + ' resize-none'} />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird gespeichert…' : (initial ? 'Speichern' : 'Anlegen')}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

// ── Firma-Karte ───────────────────────────────────────────────────────────────

function FirmaKarte({
  firma, kontakte, rabattgruppen, writeOk,
}: {
  firma: FirmaRow
  kontakte: KontaktKurz[]
  rabattgruppen?: {id:string;name:string;rabatt_pct:number}[]
  writeOk: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [showKontakte, setShowKontakte] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleDelete() {
    if (!confirm(`Firma "${firma.name}" wirklich löschen?`)) return
    startTransition(async () => { await deleteFirma(firma.id) })
  }

  if (editing) return <FirmaForm initial={firma} rabattgruppen={rabattgruppen} onDone={() => setEditing(false)} />

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-s112-teal/10 flex items-center justify-center text-s112-blue-700 font-semibold text-sm flex-shrink-0">
          {firma.name[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {firma.accountnummer && (
              <span className="text-xs font-mono text-s112-muted">{firma.accountnummer}</span>
            )}
            <Link href={`/crm/firmen/${firma.id}`}
              className="font-semibold text-s112-text text-sm hover:text-s112-blue-700 hover:underline">
              {firma.name}
            </Link>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(firma.segment)}`}>
              {segmentLabel(firma.segment)}
            </span>
            {firma.is_lead
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">Lead</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-s112-teal/10 text-s112-blue-700 font-medium">Aktiv</span>
            }
            {firma.rabattgruppe_name && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-ok-bg text-s112-ok-fg font-medium">
                {firma.rabattgruppe_pct}% {firma.rabattgruppe_name}
              </span>
            )}
            {(firma.sonderrabatt_pct ?? 0) > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-s112-warn-bg text-s112-warn-fg font-medium">
                {firma.sonderrabatt_pct}% Sonderrab.
              </span>
            )}
            {firma.land !== 'AT' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-[#F2F3F5] text-s112-text-2 font-medium">{firma.land}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {firma.ort && <span className="text-xs text-s112-muted">{firma.plz ? `${firma.plz} ` : ''}{firma.ort}</span>}
            {firma.email && <span className="text-xs text-s112-muted">{firma.email}</span>}
            {firma.telefon && <span className="text-xs text-s112-muted">{firma.telefon_vorwahl ? `${firma.telefon_vorwahl} ` : ''}{firma.telefon}</span>}
            {firma.mobil && <span className="text-xs text-s112-muted">{firma.mobil_vorwahl ? `${firma.mobil_vorwahl} ` : ''}{firma.mobil}</span>}
            {firma.uid_nummer && <span className="text-xs text-s112-muted">UID: {firma.uid_nummer}</span>}
            {firma.debitor_nr && <span className="text-xs text-s112-muted">DebitorNr.: {firma.debitor_nr}</span>}
            {firma.zahlungsziel_tage !== 30 && (
              <span className="text-xs text-s112-muted">
                Zahlungsziel: {firma.zahlungsziel_tage === 0 ? 'bei Erhalt' : `${firma.zahlungsziel_tage} Tage`}
              </span>
            )}
          </div>
          {firma.notizen && <p className="mt-1 text-xs text-s112-text-2 italic">{firma.notizen}</p>}
        </div>
        {writeOk && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={() => setEditing(true)}
              title="Bearbeiten" aria-label="Bearbeiten"
              className="text-s112-muted hover:text-s112-blue-700 px-2 py-1 rounded transition-colors">
              <Pencil className="w-4 h-4" />
            </button>
            <button onClick={handleDelete} disabled={pending}
              title="Löschen" aria-label="Löschen"
              className="text-s112-muted hover:text-s112-err px-2 py-1 rounded transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Kontakte */}
      {kontakte.length > 0 && (
        <div className="mt-3 border-t border-s112-border/60 pt-2">
          <button onClick={() => setShowKontakte(o => !o)}
            className="text-xs text-s112-muted hover:text-s112-text-1 flex items-center gap-1">
            {showKontakte ? '▾' : '▸'} {kontakte.length} {kontakte.length === 1 ? 'Kontakt' : 'Kontakte'}
          </button>
          {showKontakte && (
            <div className="mt-2 flex flex-wrap gap-2">
              {kontakte.map(k => (
                <span key={k.id} className="text-xs bg-s112-bg border border-s112-border rounded-lg px-2 py-0.5">
                  {[k.vorname, k.nachname].filter(Boolean).join(' ')}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Hauptkomponente ───────────────────────────────────────────────────────────

export default function FirmenClient({
  firmen, kontakteMap, rabattgruppen, writeOk, filter, gesamt, zaehler,
}: {
  firmen: FirmaRow[]
  kontakteMap: Record<string, KontaktKurz[]>
  rabattgruppen?: {id:string;name:string;rabatt_pct:number}[]
  writeOk: boolean
  filter: ListenFilter
  gesamt: number
  zaehler: Zaehler
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  // Serverseitige Filter (17.9.2026, wie KontakteClient): URL-Parameter, die
  // Seite lädt nur die passenden Firmen; Suche mit 300 ms Verzögerung.
  const setzeFilter = (aenderung: Partial<ListenFilter>) => {
    const neu = { ...filter, ...aenderung }
    if (!('n' in aenderung)) neu.n = LISTE_SCHRITT
    startTransition(() => router.replace(`${pathname}${paramsAusFilter(neu)}`, { scroll: false }))
  }
  // Suchfeld überlebt den Neuaufbau der Seite bei URL-Änderung (lib/crm/listenSuche.ts)
  const sucheFeld = useListenSuche('firmen', filter.q, q => setzeFilter({ q }))
  const segment = filter.segment
  const filterLead = filter.lead
  const filterKunde = filter.kunde
  const filterLieferant = filter.lieferant
  const buchstabe = filter.buchstabe
  const BUCHSTABEN = ['Alle', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
  const gefiltert = firmen

  const bSegmente = SEGMENTE.filter(s => s.value !== 'privat')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
      {/* Alphabet-Filter */}
      <div className="flex flex-wrap gap-0.5">
        {BUCHSTABEN.map(b => (
          <button key={b} onClick={() => setzeFilter({ buchstabe: b })}
            className={`min-w-[1.75rem] px-1 py-0.5 text-xs font-medium rounded transition-colors
              ${buchstabe === b
                ? 'bg-s112-teal text-s112-yellow'
                : 'bg-s112-bg text-s112-text-2 hover:bg-s112-teal/10 hover:text-s112-blue-700'}`}>
            {b}
          </button>
        ))}
      </div>

              <input type="search" placeholder="Name, Accountnummer, E-Mail, Ort…"
          ref={sucheFeld.ref} value={sucheFeld.suche} onChange={sucheFeld.onChange} onKeyDown={sucheFeld.onKeyDown} autoComplete="off"
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        <div className="flex gap-1">
          <button onClick={() => setzeFilter({ segment: 'alle' })}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === 'alle' ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
            Alle ({zaehler.gesamt})
          </button>
          {bSegmente.filter(s => (zaehler.segment[s.value] ?? 0) > 0 || s.value === segment).map(s => {
            const count = zaehler.segment[s.value] ?? 0
            return (
              <button key={s.value} onClick={() => setzeFilter({ segment: s.value })}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === s.value ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
                {s.label} ({count})
              </button>
            )
          })}
        </div>
        <div className="flex gap-1">
          {(['alle', 'lead', 'kunde'] as const).map(v => (
            <button key={v} onClick={() => setzeFilter({ lead: v })}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterLead === v ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
              {v === 'alle' ? 'Alle' : v === 'lead' ? 'Lead' : 'Aktiv'}
              {' '}({v === 'alle' ? zaehler.gesamt : v === 'lead' ? zaehler.lead : zaehler.kunde})
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={() => setzeFilter({ kunde: !filterKunde })}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterKunde ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
            Kunde ({zaehler.istKunde})
          </button>
          <button onClick={() => setzeFilter({ lieferant: !filterLieferant })}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterLieferant ? 'bg-s112-teal text-s112-yellow' : 'bg-s112-bg text-s112-text-2 hover:text-s112-text'}`}>
            Lieferant ({zaehler.istLieferant})
          </button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Export nur mit CRM-Schreibrecht – dieselbe Regel prüft /api/export/firmen (KAN-54);
              der Knopf zeigt Fehler und Hinweise der Route (X-Warnungen) statt sie als Datei zu speichern */}
          {writeOk && (
            <CsvExportKnopf href="/api/export/firmen" label="CSV" ariaLabel="Firmen als CSV exportieren"
              hinweis="Alle aktiven Firmen als CSV für Excel (Semikolon, UTF-8)" />
          )}
          {writeOk && !showForm && (
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
              Neue Firma
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <FirmaForm
          rabattgruppen={rabattgruppen}
          defaultSegment={segment !== 'alle' ? segment : undefined}
          onDone={() => setShowForm(false)}
        />
      )}

      {pending && <p className="text-xs text-s112-tertiary animate-pulse">Lade…</p>}
      {gefiltert.length === 0 ? (
        <div className="card text-center py-12 text-s112-muted text-sm">
          {zaehler.gesamt === 0 ? 'Noch keine Firmen angelegt.' : 'Keine Treffer für diesen Filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {gefiltert.map(f => (
            <FirmaKarte key={f.id} firma={f}
              kontakte={kontakteMap[f.id] ?? []}
              rabattgruppen={rabattgruppen}
              writeOk={writeOk} />
          ))}
          {gesamt > gefiltert.length && (
            <button type="button" disabled={pending} onClick={() => setzeFilter({ n: filter.n + LISTE_SCHRITT })}
              className="w-full card text-center py-3 text-sm font-medium text-s112-blue-700 hover:bg-s112-bg disabled:opacity-50">
              {pending ? 'Lade…' : `Mehr anzeigen (${gefiltert.length} von ${gesamt})`}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
