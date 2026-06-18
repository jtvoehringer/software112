'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createFirma, updateFirma, deleteFirma } from '../actions'
import { SEGMENTE, segmentLabel, segmentFarbe } from '@/lib/crm/types'
import type { FirmaRow } from '@/lib/crm/types'

type KontaktKurz = { id: string; vorname: string | null; nachname: string; segment: string }


const DIAL_CODES = [
  { code: '+43', flag: '🇦🇹', iso: 'AT' },
  { code: '+49', flag: '🇩🇪', iso: 'DE' },
  { code: '+41', flag: '🇨🇭', iso: 'CH' },
  { code: '+423', flag: '🇱🇮', iso: 'LI' },
  { code: '+39', flag: '🇮🇹', iso: 'IT' },
  { code: '+386', flag: '🇸🇮', iso: 'SI' },
  { code: '+421', flag: '🇸🇰', iso: 'SK' },
  { code: '+420', flag: '🇨🇿', iso: 'CZ' },
  { code: '+36', flag: '🇭🇺', iso: 'HU' },
  { code: '+33', flag: '🇫🇷', iso: 'FR' },
  { code: '+31', flag: '🇳🇱', iso: 'NL' },
  { code: '+32', flag: '🇧🇪', iso: 'BE' },
  { code: '+44', flag: '🇬🇧', iso: 'GB' },
  { code: '+48', flag: '🇵🇱', iso: 'PL' },
  { code: '+1',  flag: '🇺🇸', iso: 'US' },
]

function inputCls() {
  return 'w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40'
}

const WAEHRUNGEN = ['EUR', 'USD', 'GBP', 'CHF', 'HUF', 'CZK']
const LAENDER = ['AT', 'DE', 'CH', 'IT', 'FR', 'HU', 'SK', 'CZ', 'US', 'GB']

// ── Formular ──────────────────────────────────────────────────────────────────

export function FirmaForm({ initial, rabattgruppen, defaultSegment, existingFirmen, onDone }: { initial?: FirmaRow | null; rabattgruppen: {id:string;name:string;rabatt_pct:number}[]; defaultSegment?: string; existingFirmen?: FirmaRow[]; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const [segmentVal, setSegmentVal] = useState(initial?.segment ?? defaultSegment ?? 'handel')
  const [isLead, setIsLead]           = useState(initial?.is_lead ?? true)
  const [landVal, setLandVal]           = useState(initial?.land ?? 'AT')
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

    // Dublettenprüfung nur bei Neuanlage
    if (!initial && !dubletteIgnorieren && existingFirmen && existingFirmen.length > 0) {
      const eingabeName    = ((fd.get('name')    as string) ?? '').trim().toLowerCase()
      const eingabeStrasse = ((fd.get('strasse') as string) ?? '').trim().toLowerCase()
      const eingabePlz     = ((fd.get('plz')     as string) ?? '').trim().toLowerCase()
      const eingabeOrt     = ((fd.get('ort')     as string) ?? '').trim().toLowerCase()

      const dubletteNamen = existingFirmen.find(f =>
        f.name.trim().toLowerCase() === eingabeName
      )
      const dubletteAdresse = eingabeStrasse && eingabePlz && eingabeOrt
        ? existingFirmen.find(f =>
            (f.strasse ?? '').trim().toLowerCase() === eingabeStrasse &&
            (f.plz ?? '').trim().toLowerCase() === eingabePlz &&
            (f.ort ?? '').trim().toLowerCase() === eingabeOrt
          )
        : null

      if (dubletteNamen) {
        setDubletteWarnung(`Eine Firma „${dubletteNamen.name}" ist bereits vorhanden.`)
        return
      }
      if (dubletteAdresse) {
        setDubletteWarnung(`Eine Firma mit dieser Adresse (${dubletteAdresse.strasse}, ${dubletteAdresse.plz} ${dubletteAdresse.ort}) ist bereits vorhanden: „${dubletteAdresse.name}".`)
        return
      }
    }

    startTransition(async () => {
      try {
        if (initial) await updateFirma(initial.id, fd)
        else await createFirma(fd)
        onDone()
        router.refresh()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Fehler beim Speichern')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-5 space-y-4">
      <h3 className="text-sm font-semibold text-gray-800">{initial ? 'Firma bearbeiten' : 'Neue Firma'}</h3>
      {saveError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{saveError}</p>}
      {dubletteWarnung && (
        <div className="bg-amber-50 border border-amber-300 rounded-xl px-4 py-3 text-sm">
          <p className="font-medium text-amber-800 mb-1">⚠ Mögliche Dublette</p>
          <p className="text-amber-700 mb-3">{dubletteWarnung}</p>
          <p className="text-amber-700 mb-3">Möchten Sie den Eintrag trotzdem übernehmen oder verwerfen?</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => { setDubletteIgnorieren(true); setDubletteWarnung(null); setTimeout(() => { (document.activeElement as HTMLElement)?.closest('form')?.requestSubmit() }, 10) }}
              className="bg-amber-600 text-white px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-700">
              Trotzdem übernehmen
            </button>
            <button type="button" onClick={() => { setDubletteWarnung(null); onDone() }}
              className="border border-amber-400 text-amber-700 px-4 py-1.5 rounded-lg text-xs font-semibold hover:bg-amber-100">
              Verwerfen
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Firmenname *</label>
          <input name="name" defaultValue={v('name')} required className={inputCls()} />
        </div>
        {/* Lead / Kunde Toggle */}
        <div className="sm:col-span-2 flex items-center justify-between bg-white border border-s112-border rounded-xl px-4 py-2.5">
          <div>
            <p className={`text-sm font-semibold ${isLead ? 'text-amber-600' : 'text-s112-teal'}`}>
              {isLead ? '🌱 Lead' : '✅ Kunde'}
            </p>
            <p className="text-xs text-s112-muted">
              {isLead ? 'Noch kein Verkauf – wird automatisch Kunde beim ersten Verkauf' : 'Aktiver Kunde'}
            </p>
          </div>
          <label className="flex items-center gap-2.5 cursor-pointer select-none">
            <input type="hidden" name="is_lead" value={String(isLead)} />
            <div onClick={() => setIsLead(v => !v)}
              className={`w-10 h-5 rounded-full transition-colors flex items-center px-0.5 ${isLead ? 'bg-amber-400' : 'bg-s112-teal'}`}>
              <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform ${isLead ? 'translate-x-0' : 'translate-x-5'}`} />
            </div>
            <span className={`text-sm font-semibold min-w-[48px] ${isLead ? 'text-amber-600' : 'text-s112-teal'}`}>
              {isLead ? 'Lead' : 'Kunde'}
            </span>
          </label>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Segment *</label>
          <select name="segment" value={segmentVal} onChange={e => setSegmentVal(e.target.value)} required className={inputCls()}>
            {SEGMENTE.filter(s => s.value !== 'privat').map(s =>
              <option key={s.value} value={s.value}>{s.icon} {s.label}</option>
            )}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">UID-Nummer</label>
          <input name="uid_nummer" defaultValue={v('uid_nummer')} placeholder="ATU…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Straße</label>
          <input name="strasse" defaultValue={v('strasse')} className={inputCls()} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">PLZ</label>
            <input name="plz" defaultValue={v('plz')} className={inputCls()} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-600 mb-1">Ort</label>
            <input name="ort" defaultValue={v('ort')} className={inputCls()} />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Land</label>
          <select name="land" value={landVal} onChange={e => setLandVal(e.target.value)} className={inputCls()}>
            {LAENDER.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Telefon</label>
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
          <label className="block text-xs font-medium text-gray-600 mb-1">E-Mail</label>
          <input name="email" type="email" defaultValue={v('email')} className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Website</label>
          <input name="website" defaultValue={v('website')} placeholder="https://…" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Zahlungsziel (Tage)</label>
          <input name="zahlungsziel_tage" type="number" defaultValue={v('zahlungsziel_tage') || '30'}
            min="0" max="365" className={inputCls()} />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Währung</label>
          <select name="waehrung" defaultValue={v('waehrung') || 'EUR'} className={inputCls()}>
            {WAEHRUNGEN.map(w => <option key={w} value={w}>{w}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Rabattgruppe</label>
          <select name="rabattgruppe_id" defaultValue={initial?.rabattgruppe_id ?? ''} className={inputCls()}>
            <option value="">– kein Rabatt –</option>
            {rabattgruppen.map(r => (
              <option key={r.id} value={r.id}>{r.name} ({r.rabatt_pct}%)</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sonderrabatt %</label>
          <input
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Skonto %</label>
          <input
            name="skonto_pct"
            type="number"
            min="0" max="20" step="0.5"
            defaultValue={initial?.skonto_pct ?? 0}
            placeholder="0"
            className={inputCls()}
          />
        </div>
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-600 mb-1">Skonto-Frist (Tage)</label>
          <input
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
        <label className="block text-xs font-medium text-gray-600 mb-1">Notizen</label>
        <textarea name="notizen" defaultValue={v('notizen')} rows={2}
          className={inputCls() + ' resize-none'} />
      </div>

      <div className="flex gap-2">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-40">
          {pending ? 'Wird gespeichert…' : (initial ? 'Speichern' : 'Anlegen')}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-800">
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
  rabattgruppen: {id:string;name:string;rabatt_pct:number}[]
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
        <div className="w-9 h-9 rounded-lg bg-s112-teal/10 flex items-center justify-center text-s112-teal font-bold text-sm flex-shrink-0">
          {firma.name[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {firma.kundennummer && (
              <span className="text-xs font-mono text-s112-muted">{firma.kundennummer}</span>
            )}
            <Link href={`/crm/firmen/${firma.id}`}
              className="font-semibold text-gray-900 text-sm hover:text-s112-teal hover:underline">
              {firma.name}
            </Link>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${segmentFarbe(firma.segment)}`}>
              {segmentLabel(firma.segment)}
            </span>
            {firma.is_lead
              ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">🌱 Lead</span>
              : <span className="text-xs px-2 py-0.5 rounded-full bg-s112-teal/10 text-s112-teal font-medium">✅ Kunde</span>
            }
            {firma.rabattgruppe_name && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium">
                {firma.rabattgruppe_pct}% {firma.rabattgruppe_name}
              </span>
            )}
            {(firma.sonderrabatt_pct ?? 0) > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-medium">
                {firma.sonderrabatt_pct}% Sonderrab.
              </span>
            )}
            {firma.land !== 'AT' && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{firma.land}</span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
            {firma.ort && <span className="text-xs text-s112-muted">📍 {firma.plz ? `${firma.plz} ` : ''}{firma.ort}</span>}
            {firma.email && <span className="text-xs text-s112-muted">✉ {firma.email}</span>}
            {firma.telefon && <span className="text-xs text-s112-muted">📞 {firma.telefon_vorwahl ? `${firma.telefon_vorwahl} ` : ''}{firma.telefon}</span>}
            {firma.uid_nummer && <span className="text-xs text-s112-muted">UID: {firma.uid_nummer}</span>}
            {firma.zahlungsziel_tage != null && firma.zahlungsziel_tage !== 30 && (
              <span className="text-xs text-s112-muted">Zahlungsziel: {firma.zahlungsziel_tage} Tage</span>
            )}
          </div>
          {firma.notizen && <p className="mt-1 text-xs text-gray-500 italic">{firma.notizen}</p>}
        </div>
        {writeOk && (
          <div className="flex gap-1 flex-shrink-0">
            <button onClick={() => setEditing(true)}
              className="text-xs text-s112-muted hover:text-s112-teal px-2 py-1 rounded transition-colors">
              Bearbeiten
            </button>
            <button onClick={handleDelete} disabled={pending}
              className="text-xs text-s112-muted hover:text-red-500 px-2 py-1 rounded transition-colors">
              Löschen
            </button>
          </div>
        )}
      </div>

      {/* Kontakte */}
      {kontakte.length > 0 && (
        <div className="mt-3 border-t border-s112-border/60 pt-2">
          <button onClick={() => setShowKontakte(o => !o)}
            className="text-xs text-s112-muted hover:text-gray-700 flex items-center gap-1">
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
  firmen, kontakteMap, rabattgruppen, writeOk,
}: {
  firmen: FirmaRow[]
  kontakteMap: Record<string, KontaktKurz[]>
  rabattgruppen: {id:string;name:string;rabatt_pct:number}[]
  writeOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [suche, setSuche] = useState('')
  const [segment, setSegment] = useState('alle')
  const [filterLead, setFilterLead] = useState<'alle' | 'lead' | 'kunde'>('alle')
  const BUCHSTABEN = ['Alle', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')]
  const [buchstabe, setBuchstabe] = useState('Alle')

  const gefiltert = firmen.filter(f => {
    const text = [f.kundennummer, f.name, f.ort, f.email, f.telefon].filter(Boolean).join(' ').toLowerCase()
    const matchAlpha = buchstabe === 'Alle' || (f.name ?? '').toUpperCase().startsWith(buchstabe)
    const matchLead = filterLead === 'alle' || (filterLead === 'lead' ? f.is_lead : !f.is_lead)
    return (!suche || text.includes(suche.toLowerCase())) &&
           (segment === 'alle' || f.segment === segment) && matchAlpha && matchLead
  })

  const bSegmente = SEGMENTE.filter(s => s.value !== 'privat')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
      {/* Alphabet-Filter */}
      <div className="flex flex-wrap gap-0.5">
        {BUCHSTABEN.map(b => (
          <button key={b} onClick={() => setBuchstabe(b)}
            className={`min-w-[1.75rem] px-1 py-0.5 text-xs font-medium rounded transition-colors
              ${buchstabe === b
                ? 'bg-s112-teal text-white'
                : 'bg-s112-bg text-gray-500 hover:bg-s112-teal/10 hover:text-s112-teal'}`}>
            {b}
          </button>
        ))}
      </div>

              <input type="search" placeholder="Name, Kundennummer, E-Mail, Ort…"
          value={suche} onChange={e => setSuche(e.target.value)}
          className="border border-s112-border rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        <div className="flex gap-1">
          <button onClick={() => setSegment('alle')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === 'alle' ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:text-gray-900'}`}>
            Alle ({firmen.length})
          </button>
          {bSegmente.map(s => {
            const count = firmen.filter(f => f.segment === s.value).length
            if (count === 0) return null
            return (
              <button key={s.value} onClick={() => setSegment(s.value)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${segment === s.value ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:text-gray-900'}`}>
                {s.icon} {s.label} ({count})
              </button>
            )
          })}
        </div>
        <div className="flex gap-1">
          {(['alle', 'lead', 'kunde'] as const).map(v => (
            <button key={v} onClick={() => setFilterLead(v)}
              className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${filterLead === v ? 'bg-s112-teal text-white' : 'bg-s112-bg text-gray-600 hover:text-gray-900'}`}>
              {v === 'alle' ? 'Alle' : v === 'lead' ? '🌱 Lead' : '✅ Kunde'}
              {' '}({v === 'alle' ? firmen.length : firmen.filter(f => v === 'lead' ? f.is_lead : !f.is_lead).length})
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a href="/api/export/firmen" download
            className="inline-flex items-center gap-1.5 border border-s112-border text-gray-600 px-3 py-2 rounded-xl text-sm hover:bg-s112-bg transition-colors">
            ⬇ CSV
          </a>
          {writeOk && !showForm && (
            <button onClick={() => setShowForm(true)}
              className="inline-flex items-center gap-2 bg-s112-teal text-white px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90">
              <span>＋</span> Neue Firma
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <FirmaForm
          rabattgruppen={rabattgruppen}
          existingFirmen={firmen}
          defaultSegment={segment !== 'alle' ? segment : undefined}
          onDone={() => setShowForm(false)}
        />
      )}

      {gefiltert.length === 0 ? (
        <div className="card text-center py-12 text-s112-muted text-sm">
          {firmen.length === 0 ? 'Noch keine Firmen angelegt.' : 'Keine Treffer für diesen Filter.'}
        </div>
      ) : (
        <div className="space-y-2">
          {gefiltert.map(f => (
            <FirmaKarte key={f.id} firma={f}
              kontakte={kontakteMap[f.id] ?? []}
              rabattgruppen={rabattgruppen}
              writeOk={writeOk} />
          ))}
        </div>
      )}
    </div>
  )
}
