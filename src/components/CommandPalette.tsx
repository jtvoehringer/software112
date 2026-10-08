'use client'

// ── Befehlspalette (Strg K / ⌘K) – Dashboard-Relaunch 27.8.2026 ───────────────
// Ein Eingabefeld für alles: Seiten aufrufen, Aktionen starten ("Neuer
// Verkauf"), Kontakte/Firmen/Rechnungen/Füllungen/Chargen/Rieden finden – von
// jeder Seite aus. Tastatur: ↑↓ wählen, ↵ öffnen, Esc schließen. Öffnen auch
// über den Knopf in der Kopfleiste (Ereignis PALETTE_EVENT aus Topbar.tsx).
//
// Ersetzt die bisherige GlobalSearch.tsx – die Datensuche nutzt weiterhin die
// bestehende API-Route /api/global-search (tenant-gescopt, RLS).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Search, Plus, ShoppingCart, Calendar, Wallet, Wine, FlaskConical, Droplets, Grape,
  ScanLine, LogOut, ArrowLeftRight, Users, Building2, Package, FileText, MapPin, BookOpen, Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { createSupabaseBrowserClient } from '@/lib/supabase/client'
import { PALETTE_EVENT } from '@/components/layout/Topbar'
import { SPERRE_EREIGNIS, istTabGesperrt } from '@/lib/tenant/waechter'
import type { NavGroup } from '@/lib/navigation'
import type { SearchResult } from '@/app/api/global-search/route'
import type { TenantBranding } from '@/app/(dashboard)/layout'

type Gruppe = 'Aktionen' | 'Seiten' | 'Kontakte' | 'Firmen' | 'Rechnungen' | 'Füllungen' | 'Kellerbuch' | 'Rieden' | 'Grundstücke' | 'Jahrgänge'

type Eintrag = {
  id: string
  gruppe: Gruppe
  label: string
  /** rechte Spalte (Bereich, Untertitel …) */
  detail?: string
  icon: LucideIcon
  href?: string
  run?: () => void | Promise<void>
  keywords?: string
}

const GRUPPEN_REIHENFOLGE: Gruppe[] = ['Aktionen', 'Seiten', 'Kontakte', 'Firmen', 'Rechnungen', 'Füllungen', 'Kellerbuch', 'Rieden', 'Grundstücke', 'Jahrgänge']

const KATEGORIE: Record<SearchResult['kategorie'], { gruppe: Gruppe; icon: LucideIcon }> = {
  kontakt:     { gruppe: 'Kontakte',     icon: Users },
  firma:       { gruppe: 'Firmen',       icon: Building2 },
  verkauf:     { gruppe: 'Rechnungen',   icon: FileText },
  fuellung:    { gruppe: 'Füllungen',    icon: Package },
  kellerbuch:  { gruppe: 'Kellerbuch',   icon: Wine },
  weingarten:  { gruppe: 'Rieden',       icon: Grape },
  grundstueck: { gruppe: 'Grundstücke',  icon: MapPin },
  jahrgang:    { gruppe: 'Jahrgänge',    icon: BookOpen },
}

/** Umlaute/Akzente weg, Kleinschreibung – für tolerante Suche */
function norm(s: string) {
  return s.toLowerCase()
    .replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

function passt(e: Eintrag, q: string) {
  const heu = norm(`${e.label} ${e.keywords ?? ''} ${e.detail ?? ''}`)
  return norm(q).split(/\s+/).filter(Boolean).every(w => heu.includes(w))
}

export default function CommandPalette({
  groups, darfSchreiben, branding, betriebCount = 1,
}: {
  groups: NavGroup[]
  /** canWrite(role) – serverseitig in layout.tsx ermittelt (lib/auth/roles ist server-only) */
  darfSchreiben: boolean
  branding: TenantBranding
  betriebCount?: number
}) {
  const router = useRouter()
  const [offen, setOffen] = useState(false)
  const [q, setQ] = useState('')
  const [auswahl, setAuswahl] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listeRef = useRef<HTMLDivElement>(null)
  const anfrageNr = useRef(0)

  // ── Statische Einträge: Aktionen + Seiten je Rolle/Modul ─────────────────
  const statisch = useMemo<Eintrag[]>(() => {
    const seiten: Eintrag[] = groups.flatMap(g =>
      g.items.filter(i => i.phase !== 2).map(i => ({
        id: `s:${g.key}:${i.href}`, gruppe: 'Seiten' as const, label: i.label, detail: g.label, icon: g.icon, href: i.href,
        keywords: `${g.label} ${i.keywords ?? ''}`,
      })),
    )
    const aktionen: Eintrag[] = darfSchreiben ? [
      { id: 'a:verkauf',    gruppe: 'Aktionen', label: 'Neuer Verkauf',            icon: ShoppingCart, href: '/weinhandel/verkauf/neu',   keywords: 'rechnung auftrag anlegen neu' },
      { id: 'a:aktivitaet', gruppe: 'Aktionen', label: 'Aktivität / Termin anlegen', icon: Calendar,   href: '/crm',                       keywords: 'kalender neu' },
      { id: 'a:fuellung',   gruppe: 'Aktionen', label: 'Neue Füllung',             icon: Droplets,     href: '/weinhandel/fuellungen/neu', keywords: 'abfüllen flaschen neu' },
      { id: 'a:massnahme',  gruppe: 'Aktionen', label: 'Maßnahme erfassen',        icon: FlaskConical, href: '/behandlungen/neu',          keywords: 'pflanzenschutz spritzung neu' },
      { id: 'a:ernte',      gruppe: 'Aktionen', label: 'Lesedaten erfassen',       icon: Wine,         href: '/erntemeldung/erfassen',            keywords: 'ernte jahrgang lese neu' },
      // Pilottest 30.09.2026: Pressungen im Kellerbuch
      { id: 'a:abstufen',   gruppe: 'Aktionen', label: 'Charge abstufen',          icon: Wine,         href: '/kellerbuch/abstufen',       keywords: 'abstufen downgrade qualität herkunft charge kellerbuch' },
      { id: 'a:pressung',   gruppe: 'Aktionen', label: 'Pressung erfassen',        icon: Wine,         href: '/kellerbuch/pressungen',     keywords: 'pressung most keltern charge neu' },
      // KAN-119: Produktion (Spritzer, Mischgetränk, Perlwein, Schaumwein/Sekt, PetNat) – Assistent
      { id: 'a:produktion', gruppe: 'Aktionen', label: 'Produktion',               icon: Sparkles,     href: '/kellerbuch/produktion/neu', keywords: 'produktion spritzer perlweinspritzer perlwein sekt schaumwein petnat mischgetränk weinmischgetränk charge kellerbuch neu' },
      // KAN-129: eine Lese im Jahrgang anlegen (Hauptlese, Eiswein …) – der Jahrgang entsteht bei Bedarf mit
      { id: 'a:lese',       gruppe: 'Aktionen', label: 'Neue Lese anlegen',        icon: Plus,         href: '/erntemeldung/neu',          keywords: 'lese eiswein hauptlese vorlese nachlese jahrgang ernte neu' },
      { id: 'a:ried',       gruppe: 'Aktionen', label: 'Neue Ried',                icon: Plus,         href: '/weingarten/neu',            keywords: 'weingarten anlegen neu' },
      { id: 'a:offen',      gruppe: 'Aktionen', label: 'Offene Posten prüfen',     icon: Wallet,       href: '/weinhandel/offene-posten',  keywords: 'überfällig zahlung' },
      ...(branding.modul_ea ? [{ id: 'a:beleg', gruppe: 'Aktionen' as const, label: 'Beleg hochladen (OCR)', icon: ScanLine, href: '/buchhaltung/belege', keywords: 'scan foto buchhaltung' }] : []),
    ] : []
    if (betriebCount > 1) {
      aktionen.push({ id: 'a:betrieb', gruppe: 'Aktionen', label: 'Betrieb wechseln', icon: ArrowLeftRight, keywords: 'mandant', run: () => { window.location.href = '/betrieb-waehlen' } })
    }
    aktionen.push({
      id: 'a:logout', gruppe: 'Aktionen', label: 'Abmelden', icon: LogOut, keywords: 'logout ausloggen',
      run: async () => { await createSupabaseBrowserClient().auth.signOut(); window.location.href = '/login' },
    })
    return [...aktionen, ...seiten]
  }, [groups, darfSchreiben, branding.modul_ea, betriebCount])

  // ── Öffnen/Schließen: Strg+K, ⌘K, Kopfleisten-Knopf ──────────────────────
  // Betriebs-Wächter (KAN-30): Solange der Tab wegen eines Betriebswechsels gesperrt ist, bleibt
  // die Palette zu – inert sperrt nur Klicks und Fokus, nicht die Tasten-Listener am window.
  useEffect(() => {
    const oeffnen = () => { if (istTabGesperrt()) return; setQ(''); setAuswahl(0); setOffen(true) }
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        if (istTabGesperrt()) return
        e.preventDefault()
        setOffen(o => { if (o) return false; setQ(''); setAuswahl(0); return true })
      }
    }
    const gesperrt = () => setOffen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener(PALETTE_EVENT, oeffnen)
    window.addEventListener(SPERRE_EREIGNIS, gesperrt)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(PALETTE_EVENT, oeffnen)
      window.removeEventListener(SPERRE_EREIGNIS, gesperrt)
    }
  }, [])

  useEffect(() => {
    if (!offen) return
    const t = setTimeout(() => inputRef.current?.focus(), 10)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { clearTimeout(t); document.body.style.overflow = prev }
  }, [offen])

  // ── Suche: statische Einträge sofort, Daten verzögert über die API ───────
  const frage = q.trim()
  const statischGefiltert = useMemo(() => {
    const stat = frage ? statisch.filter(e => passt(e, frage)) : statisch
    return frage
      ? [...stat].sort((a, b) => Number(norm(b.label).startsWith(norm(frage))) - Number(norm(a.label).startsWith(norm(frage))))
      : stat
  }, [frage, statisch])

  const datenSuche = frage.length >= 2
  const [daten, setDaten] = useState<{ frage: string; items: Eintrag[] }>({ frage: '', items: [] })
  const sucheLaeuft = datenSuche && daten.frage !== frage

  useEffect(() => {
    if (!offen || !datenSuche) return
    const nr = ++anfrageNr.current
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/global-search?q=${encodeURIComponent(frage)}`)
        const json = await res.json().catch(() => ({ results: [] }))
        if (nr !== anfrageNr.current) return // inzwischen weitergetippt
        const items: Eintrag[] = ((json.results ?? []) as SearchResult[]).map(r => {
          const k = KATEGORIE[r.kategorie] ?? { gruppe: 'Seiten' as const, icon: Search }
          return { id: `d:${r.kategorie}:${r.id}`, gruppe: k.gruppe, label: r.titel, detail: r.untertitel, icon: k.icon, href: r.href }
        })
        setDaten({ frage, items })
      } catch {
        if (nr === anfrageNr.current) setDaten({ frage, items: [] })
      }
    }, 180)
    return () => clearTimeout(t)
  }, [frage, offen, datenSuche])

  const treffer = useMemo(
    () => [...statischGefiltert, ...(datenSuche && daten.frage === frage ? daten.items : [])],
    [statischGefiltert, datenSuche, daten, frage],
  )

  const gruppiert = useMemo(() =>
    GRUPPEN_REIHENFOLGE.map(g => ({ g, items: treffer.filter(e => e.gruppe === g) })).filter(x => x.items.length > 0),
  [treffer])
  const flach = useMemo(() => gruppiert.flatMap(x => x.items), [gruppiert])

  const ausfuehren = useCallback((e: Eintrag) => {
    setOffen(false)
    if (e.run) void e.run()
    else if (e.href) router.push(e.href)
  }, [router])

  // Tasten gelten im ganzen Fenster, solange die Palette offen ist
  useEffect(() => {
    if (!offen) return
    const onKey = (e: KeyboardEvent) => {
      if (istTabGesperrt())           { setOffen(false); return }   // Tasten gehören dann dem Sperrdialog
      if (e.key === 'Escape')         { e.preventDefault(); setOffen(false) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); setAuswahl(i => Math.min(flach.length - 1, i + 1)) }
      else if (e.key === 'ArrowUp')   { e.preventDefault(); setAuswahl(i => Math.max(0, i - 1)) }
      else if (e.key === 'Home')      { e.preventDefault(); setAuswahl(0) }
      else if (e.key === 'End')       { e.preventDefault(); setAuswahl(Math.max(0, flach.length - 1)) }
      else if (e.key === 'Enter')     { e.preventDefault(); const t = flach[auswahl]; if (t) ausfuehren(t) }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [offen, flach, auswahl, ausfuehren])

  // gewählten Eintrag im Blick halten
  useEffect(() => {
    const el = listeRef.current?.querySelector<HTMLElement>(`[data-idx="${auswahl}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [auswahl, flach])

  if (!offen) return null

  return (
    <div
      className="fixed inset-0 z-100 bg-[rgba(10,26,42,.5)] px-4 pt-[10vh] pb-8 overflow-y-auto"
      onMouseDown={e => { if (e.target === e.currentTarget) setOffen(false) }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Befehlspalette"
        className="max-w-[640px] mx-auto bg-white rounded-xl border border-s112-line shadow-xl overflow-hidden"
      >
        <div className="flex items-center gap-3 px-4 h-[52px] border-b border-s112-line">
          <Search size={18} strokeWidth={1.75} className="text-s112-tertiary shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={e => { setQ(e.target.value); setAuswahl(0) }}
            placeholder="Seite, Aktion, Kontakt, Rechnung, Charge oder Ried …"
            aria-label="Suchen oder Befehl eingeben"
            className="flex-1 min-w-0 bg-transparent text-[15px] text-s112-text placeholder:text-s112-tertiary focus:outline-hidden"
            autoComplete="off"
            spellCheck={false}
          />
          {sucheLaeuft && <span className="font-mono text-[11px] text-s112-tertiary">■ sucht …</span>}
          <button
            type="button"
            onClick={() => setOffen(false)}
            aria-label="Schließen"
            className="font-mono text-[10.5px] text-s112-tertiary border border-s112-line-str rounded-xs px-1.5 py-0.5 hover:bg-s112-bg hover:text-s112-text transition-colors"
          >
            ESC
          </button>
        </div>

        <div ref={listeRef} className="max-h-[60vh] overflow-y-auto py-2">
          {flach.length === 0 && (
            <p className="px-4 py-8 text-center text-[13.5px] text-s112-tertiary">
              {sucheLaeuft ? 'Wird gesucht …' : `Nichts gefunden für „${q}“.`}
            </p>
          )}
          {gruppiert.map(({ g, items }) => (
            <div key={g} className="px-2 pb-1">
              <p className="px-2 pt-2 pb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[.08em] text-s112-tertiary">{g}</p>
              {items.map(e => {
                const idx = flach.indexOf(e)
                const aktiv = idx === auswahl
                const Icon = e.icon
                return (
                  <button
                    key={e.id}
                    type="button"
                    data-idx={idx}
                    onMouseEnter={() => setAuswahl(idx)}
                    onClick={() => ausfuehren(e)}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-md text-left transition-colors ${
                      aktiv ? 'bg-s112-blue-50 text-s112-blue-700' : 'text-s112-text hover:bg-s112-bg'
                    }`}
                  >
                    <Icon size={16} strokeWidth={1.75} className={`shrink-0 ${aktiv ? 'text-s112-blue-700' : 'text-s112-tertiary'}`} />
                    <span className="flex-1 min-w-0 truncate text-[13.5px] font-medium">{e.label}</span>
                    {e.detail && <span className="shrink-0 max-w-[45%] truncate text-[11.5px] text-s112-text-2">{e.detail}</span>}
                    {aktiv && <kbd className="font-mono text-[10.5px] text-s112-tertiary shrink-0">↵</kbd>}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-2 border-t border-s112-line bg-s112-bg font-mono text-[10.5px] text-s112-tertiary">
          <span>↑↓ wählen · ↵ öffnen · esc schließen</span>
          <span className="hidden sm:inline">Strg K öffnet von überall</span>
        </div>
      </div>
    </div>
  )
}
