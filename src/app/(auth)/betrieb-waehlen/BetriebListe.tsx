'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { selectBetriebAction } from './actions'
import BetriebCard from './BetriebCard'

// Betriebsauswahl (21.9.2026): Vorsorge für mehrere hundert Mandanten – ab
// SUCHE_AB Betrieben ein Suchfeld (Name, Anzeigename, Kurzname, Rolle), Enter
// öffnet den ersten Treffer; die zuletzt geöffneten Betriebe stehen oben
// (nur im Browser gemerkt, kein Serverzustand).

export type BetriebEintrag = { tenantId: string; displayName: string; slug: string; roleLabel: string; accentColor: string | null }

const SUCHE_AB = 8
const ZULETZT_KEY = 's112_betriebe_zuletzt'
const ZULETZT_MAX = 5

function zuletztLesen(): string[] {
  try { const v = JSON.parse(localStorage.getItem(ZULETZT_KEY) ?? '[]'); return Array.isArray(v) ? v.filter(x => typeof x === 'string') : [] } catch { return [] }
}
function zuletztMerken(id: string) {
  try { localStorage.setItem(ZULETZT_KEY, JSON.stringify([id, ...zuletztLesen().filter(x => x !== id)].slice(0, ZULETZT_MAX))) } catch { /* privater Modus o.ä. */ }
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export default function BetriebListe({ betriebe, weiter }: { betriebe: BetriebEintrag[]; weiter?: string | null }) {
  const [suche, setSuche] = useState('')
  const [zuletzt, setZuletzt] = useState<string[]>([])
  const ersteForm = useRef<HTMLFormElement>(null)
  useEffect(() => { setZuletzt(zuletztLesen()) }, [])

  const mitSuche = betriebe.length >= SUCHE_AB
  const q = norm(suche.trim())
  const treffer = useMemo(() => {
    const liste = q
      ? betriebe.filter(b => norm(`${b.displayName} ${b.slug} ${b.roleLabel}`).includes(q))
      : betriebe
    return [...liste].sort((a, b) => a.displayName.localeCompare(b.displayName, 'de'))
  }, [betriebe, q])

  const zuletztListe = !q ? zuletzt.map(id => betriebe.find(b => b.tenantId === id)).filter((b): b is BetriebEintrag => !!b) : []
  const rest = zuletztListe.length ? treffer.filter(b => !zuletztListe.some(z => z.tenantId === b.tenantId)) : treffer

  const karte = (b: BetriebEintrag, erste: boolean) => (
    <form key={b.tenantId} ref={erste ? ersteForm : undefined} action={selectBetriebAction} onSubmit={() => zuletztMerken(b.tenantId)}>
      <input type="hidden" name="tenant_id" value={b.tenantId} />
      {weiter && <input type="hidden" name="weiter" value={weiter} />}
      <BetriebCard displayName={b.displayName} roleLabel={b.roleLabel} accentColor={b.accentColor} />
    </form>
  )

  return (
    <div>
      {mitSuche && (
        <div className="relative mb-4">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-s112-muted" />
          <input
            type="text" autoFocus value={suche} onChange={e => setSuche(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (zuletztListe[0] ?? rest[0])) { e.preventDefault(); ersteForm.current?.requestSubmit() } }}
            placeholder={`${betriebe.length} Betriebe durchsuchen …`}
            className="w-full border border-s112-border rounded-xl pl-9 pr-3 py-2.5 text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40"
          />
        </div>
      )}

      {zuletztListe.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-s112-muted mb-2 px-1">Zuletzt geöffnet</p>
          <div className="space-y-3">{zuletztListe.map((b, i) => karte(b, i === 0))}</div>
        </div>
      )}

      {rest.length > 0 && zuletztListe.length > 0 && (
        <p className="text-[11px] uppercase tracking-wide text-s112-muted mb-2 px-1">Alle Betriebe</p>
      )}
      <div className={`space-y-3 ${mitSuche ? 'max-h-[60vh] overflow-y-auto pr-1' : ''}`}>
        {rest.map((b, i) => karte(b, zuletztListe.length === 0 && i === 0))}
        {rest.length === 0 && zuletztListe.length === 0 && (
          <p className="text-sm text-s112-muted text-center py-6">Kein Betrieb passt zu „{suche}“.</p>
        )}
      </div>
      {mitSuche && q && rest.length > 0 && (
        <p className="text-xs text-s112-muted text-center mt-3">{rest.length} von {betriebe.length} · Enter öffnet den ersten Treffer</p>
      )}
    </div>
  )
}
