'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from '@/components/ui/Link'
import { Mail, User, Merge, EyeOff, Search, CheckCircle2, AlertTriangle } from 'lucide-react'
import { kontakteZusammenfuehren, dubletteIgnorieren, dublettenIgnorierenViele } from '../actions'
import { rueckfrage } from '@/lib/ui/rueckfrage'

export type DublettenKontakt = {
  id: string
  accountnummer: string | null
  vorname: string | null
  nachname: string | null
  email: string | null
  email_weitere: string[]
  plz: string | null
  ort: string | null
  telefon: string | null
  is_lead: boolean
  erstellt_am: string | null
  firma_id: string | null
  anz_aktivitaeten: number
  anz_verkaeufe: number
}

export type DublettenStufe = 'sicher' | 'pruefen' | 'unwahrscheinlich'

export type DublettenGruppe = {
  art: 'email' | 'name'
  schluessel: string
  anzahl: number
  stufe: DublettenStufe
  kontakte: DublettenKontakt[]
}

type Filter = 'alle' | 'email' | 'name'
type StufenFilter = 'alle' | DublettenStufe

const STUFEN: { key: DublettenStufe; label: string; cls: string; hinweis: string }[] = [
  { key: 'sicher', label: 'sicher', cls: 'bg-s112-ok-bg text-s112-ok-fg', hinweis: 'Gleiche E-Mail und gleicher Name (auch Schreibvariante, Initiale, vertauschte Reihenfolge) bzw. gleicher Name mit gleicher Adresse, Telefonnummer oder E-Mail-Domain' },
  { key: 'pruefen', label: 'prüfen', cls: 'bg-s112-warn-bg text-s112-warn-fg', hinweis: 'Gleiche E-Mail und gleicher Nachname (Familie oder Betrieb?) bzw. gleicher Name mit anderer oder fehlender E-Mail' },
  { key: 'unwahrscheinlich', label: 'unwahrscheinlich', cls: 'bg-s112-bg text-s112-muted border border-s112-line', hinweis: 'Gleiche E-Mail, aber zwei klar verschiedene Namen – meist eine gemeinsame Adresse (office@, Ehepaar)' },
]
const stufeInfo = (s: DublettenStufe) => STUFEN.find(x => x.key === s) ?? STUFEN[1]

const datumDe = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('de-AT') : '–'
const nameVon = (k: DublettenKontakt) => [k.vorname, k.nachname].filter(Boolean).join(' ') || '(ohne Namen)'

// Anzeige des Gruppenschlüssels: "m:<mail>" → Mail, "n:<vor>|<nach>" → Name aus dem ersten Kontakt
function gruppenTitel(g: DublettenGruppe): string {
  if (g.art === 'email') return g.schluessel.slice(2)
  const k = g.kontakte[0]
  return k ? nameVon(k) : g.schluessel.slice(2).replace('|', ' ')
}

export default function DublettenClient({ gruppen: gruppenProp, writeOk }: { gruppen: DublettenGruppe[]; writeOk: boolean }) {
  const router = useRouter()
  const [gruppen, setGruppen] = useState(gruppenProp)
  const [filter, setFilter] = useState<Filter>('alle')
  const [stufenFilter, setStufenFilter] = useState<StufenFilter>('alle')
  const [suche, setSuche] = useState('')
  const [meldung, setMeldung] = useState<{ art: 'ok' | 'fehler'; text: string } | null>(null)
  const [bulkPending, startBulk] = useTransition()

  // Nach router.refresh() kommen neue Props (z.B. weil ein zusammengeführter Kontakt
  // auch in einer anderen Gruppe stand) – lokalen Stand übernehmen
  // (beim Rendern statt im Effekt)
  const [gruppenPropVorher, setGruppenPropVorher] = useState(gruppenProp)
  if (gruppenProp !== gruppenPropVorher) { setGruppenPropVorher(gruppenProp); setGruppen(gruppenProp) }

  const sichtbar = useMemo(() => {
    const s = suche.trim().toLowerCase()
    return gruppen.filter(g => {
      if (filter !== 'alle' && g.art !== filter) return false
      if (stufenFilter !== 'alle' && g.stufe !== stufenFilter) return false
      if (!s) return true
      return g.schluessel.toLowerCase().includes(s) || g.kontakte.some(k =>
        nameVon(k).toLowerCase().includes(s) || (k.email ?? '').toLowerCase().includes(s) || (k.accountnummer ?? '').toLowerCase().includes(s) || (k.ort ?? '').toLowerCase().includes(s))
    })
  }, [gruppen, filter, stufenFilter, suche])

  const anzEmail = gruppen.filter(g => g.art === 'email').length
  const anzName = gruppen.length - anzEmail
  const anzStufe = (s: DublettenStufe) => gruppen.filter(g => g.stufe === s).length
  const unwahrscheinliche = gruppen.filter(g => g.stufe === 'unwahrscheinlich')

  function entfernen(schluessel: string) {
    setGruppen(g => g.filter(x => x.schluessel !== schluessel))
  }

  // Alle "unwahrscheinlich" auf einmal als keine Dublette markieren
  async function alleUnwahrscheinlichenIgnorieren() {
    if (!unwahrscheinliche.length) return
    if (!(await rueckfrage({
      titel: `${unwahrscheinliche.length} unwahrscheinliche ${unwahrscheinliche.length === 1 ? 'Gruppe' : 'Gruppen'} als „keine Dublette“ markieren?`,
      text: 'Gleiche E-Mail, verschiedene Namen. Die Gruppen erscheinen dann weder hier noch im Morgenbericht. Die Kontakte selbst bleiben unverändert.',
      bestaetigen: 'Markieren',
    }))) return
    startBulk(async () => {
      const res = await dublettenIgnorierenViele(unwahrscheinliche.map(g => g.schluessel))
      if (res.error) setMeldung({ art: 'fehler', text: `Markieren fehlgeschlagen: ${res.error}` })
      else {
        setMeldung({ art: 'ok', text: `${res.anzahl ?? unwahrscheinliche.length} Gruppen als keine Dublette markiert.` })
        setGruppen(g => g.filter(x => x.stufe !== 'unwahrscheinlich'))
        if (stufenFilter === 'unwahrscheinlich') setStufenFilter('alle')
        router.refresh()
      }
    })
  }

  if (gruppen.length === 0) {
    return (
      <div className="card text-center py-12">
        <CheckCircle2 className="w-10 h-10 mx-auto text-s112-ok mb-3" />
        <p className="text-s112-text font-medium">Keine möglichen Dubletten gefunden</p>
        <p className="text-sm text-s112-muted mt-1">Der Morgenbericht prüft täglich alle aktiven Kontakte auf gleiche E-Mail-Adresse oder gleichen Namen.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Hinweis + Filter */}
      <div className="bg-s112-blue-50 border border-s112-blue-100 rounded-xl px-4 py-3 text-sm text-s112-text-1">
        <p><strong>So funktioniert das Zusammenführen:</strong> Der Kontakt mit dem Punkt „behalten“ bleibt bestehen. Alle angehakten Kontakte werden in ihn überführt:
          Aktivitäten, Verkäufe, Bestellungen, Pipeline-Einträge und weitere Verknüpfungen werden umgehängt, leere Felder ergänzt, alle E-Mail-Adressen als „weitere Adressen“ gesammelt.
          Die zusammengeführten Kontakte werden deaktiviert (nichts wird gelöscht) und bekommen einen Vermerk in den Notizen. Vorgeschlagen ist jeweils der Kontakt mit den meisten Verkäufen bzw. Aktivitäten.</p>
        <p className="mt-2"><strong>Einstufung:</strong> {STUFEN.map((s, i) => (
          <span key={s.key}>{i > 0 && ' · '}<span className={`px-1.5 py-0.5 rounded-full text-xs font-semibold ${s.cls}`}>{s.label}</span> {s.hinweis}</span>
        ))}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-lg border border-s112-border overflow-hidden text-sm">
          {([['alle', `Alle (${gruppen.length})`], ...STUFEN.map(s => [s.key, `${s.label[0].toUpperCase()}${s.label.slice(1)} (${anzStufe(s.key)})`])] as [StufenFilter, string][]).map(([f, label]) => (
            <button key={f} type="button" onClick={() => setStufenFilter(f)}
              className={`px-3 py-1.5 ${stufenFilter === f ? 'bg-s112-teal text-s112-yellow' : 'bg-white text-s112-text-1 hover:bg-s112-bg'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg border border-s112-border overflow-hidden text-sm">
          {([['alle', 'Alle Arten'], ['email', `E-Mail (${anzEmail})`], ['name', `Name (${anzName})`]] as [Filter, string][]).map(([f, label]) => (
            <button key={f} type="button" onClick={() => setFilter(f)}
              className={`px-3 py-1.5 ${filter === f ? 'bg-s112-teal text-s112-yellow' : 'bg-white text-s112-text-1 hover:bg-s112-bg'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-s112-muted" />
          <input value={suche} onChange={e => setSuche(e.target.value)} placeholder="Name, E-Mail, AN-Nr., Ort …"
            className="border border-s112-border rounded-lg pl-8 pr-3 py-1.5 text-sm w-64 focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        {writeOk && unwahrscheinliche.length > 0 && (
          <button type="button" onClick={alleUnwahrscheinlichenIgnorieren} disabled={bulkPending}
            className="inline-flex items-center gap-1.5 border border-s112-border text-s112-text-1 px-3 py-1.5 rounded-lg text-sm hover:bg-s112-bg disabled:opacity-40"
            title="Alle Gruppen der Stufe „unwahrscheinlich“ dauerhaft ausblenden">
            <EyeOff className="w-4 h-4" /> {bulkPending ? 'Wird markiert …' : `${unwahrscheinliche.length} unwahrscheinliche als keine Dublette markieren`}
          </button>
        )}
      </div>
      {meldung && (
        <div role={meldung.art === 'ok' ? 'status' : 'alert'} className={`text-sm px-3 py-2 rounded-lg ${meldung.art === 'ok' ? 'bg-s112-ok-bg text-s112-ok-fg' : 'bg-s112-err-bg text-s112-err-fg'}`}>{meldung.text}</div>
      )}

      {sichtbar.length === 0 && <p className="text-sm text-s112-muted py-6 text-center">Keine Gruppe passt zum Filter.</p>}

      {sichtbar.map(g => (
        <Gruppe key={g.schluessel} gruppe={g} writeOk={writeOk}
          onFertig={(text, art) => { setMeldung({ art, text }); if (art === 'ok') { entfernen(g.schluessel); router.refresh() } }} />
      ))}
    </div>
  )
}

function Gruppe({ gruppe: g, writeOk, onFertig }: { gruppe: DublettenGruppe; writeOk: boolean; onFertig: (text: string, art: 'ok' | 'fehler') => void }) {
  const [behalten, setBehalten] = useState(g.kontakte[0]?.id ?? '')
  const [weg, setWeg] = useState<Set<string>>(() => new Set(g.kontakte.slice(1).map(k => k.id)))
  const [pending, startTransition] = useTransition()

  function waehleBehalten(id: string) {
    setBehalten(id)
    setWeg(prev => { const n = new Set(prev); n.delete(id); return n })
  }
  function toggleWeg(id: string) {
    if (id === behalten) return
    setWeg(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  }

  async function zusammenfuehren() {
    const ids = [...weg].filter(id => id !== behalten)
    const b = g.kontakte.find(k => k.id === behalten)
    if (!b || ids.length === 0) return
    const namen = ids.map(id => { const k = g.kontakte.find(x => x.id === id); return k ? `${nameVon(k)} (${k.accountnummer ?? '–'})` : id }).join(', ')
    if (!(await rueckfrage({
      titel: `${ids.length === 1 ? 'Kontakt' : `${ids.length} Kontakte`} in ${nameVon(b)} (${b.accountnummer ?? '–'}) zusammenführen?`,
      text: `Zusammengeführt ${ids.length === 1 ? 'wird' : 'werden'}: ${namen}\n\nAktivitäten, Verkäufe und Verknüpfungen werden übertragen, die zusammengeführten Kontakte deaktiviert. Das lässt sich nicht automatisch rückgängig machen.`,
      bestaetigen: 'Zusammenführen',
      gefaehrlich: true,
    }))) return
    startTransition(async () => {
      const res = await kontakteZusammenfuehren(behalten, ids)
      if (res.error) onFertig(`Zusammenführen fehlgeschlagen: ${res.error}`, 'fehler')
      else onFertig(`${res.ergebnis?.zusammengefuehrt ?? ids.length} ${(res.ergebnis?.zusammengefuehrt ?? ids.length) === 1 ? 'Kontakt' : 'Kontakte'} in ${nameVon(b)} zusammengeführt${res.ergebnis?.konflikte_entfernt ? ` (${res.ergebnis.konflikte_entfernt} doppelte Verknüpfung(en) entfernt)` : ''}.`, 'ok')
    })
  }

  async function ignorieren() {
    if (!(await rueckfrage({
      titel: `„${gruppenTitel(g)}“ als „keine Dublette“ markieren?`,
      text: 'Die Gruppe wird künftig weder hier noch im Morgenbericht angezeigt.',
      bestaetigen: 'Markieren',
    }))) return
    startTransition(async () => {
      const res = await dubletteIgnorieren(g.schluessel)
      if (res.error) onFertig(`Markieren fehlgeschlagen: ${res.error}`, 'fehler')
      else onFertig(`„${gruppenTitel(g)}“ als keine Dublette markiert.`, 'ok')
    })
  }

  const anzWeg = [...weg].filter(id => id !== behalten).length

  return (
    <div className="card p-0 overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-s112-line bg-s112-bg/60">
        <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2 py-0.5 rounded-full ${g.art === 'email' ? 'bg-s112-blue-50 text-s112-blue-700' : 'bg-s112-warn-bg text-s112-warn-fg'}`}>
          {g.art === 'email' ? <Mail className="w-3 h-3" /> : <User className="w-3 h-3" />}
          {g.art === 'email' ? 'gleiche E-Mail' : 'gleicher Name'}
        </span>
        <span className="font-medium text-s112-text">{gruppenTitel(g)}</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${stufeInfo(g.stufe).cls}`} title={stufeInfo(g.stufe).hinweis}>{stufeInfo(g.stufe).label}</span>
        <span className="text-xs text-s112-muted">{g.anzahl} Kontakte</span>
        {writeOk && (
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={ignorieren} disabled={pending}
              className="inline-flex items-center gap-1.5 border border-s112-border text-s112-text-1 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-s112-bg disabled:opacity-40">
              <EyeOff className="w-3.5 h-3.5" /> Keine Dublette
            </button>
            <button type="button" onClick={zusammenfuehren} disabled={pending || anzWeg === 0}
              className="inline-flex items-center gap-1.5 bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-40">
              <Merge className="w-3.5 h-3.5" /> {pending ? 'Wird zusammengeführt …' : `${anzWeg === 1 ? '1 Kontakt' : `${anzWeg} Kontakte`} zusammenführen`}
            </button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-s112-muted uppercase tracking-wide">
              {writeOk && <th className="px-3 py-2 font-medium whitespace-nowrap">Behalten</th>}
              {writeOk && <th className="px-3 py-2 font-medium whitespace-nowrap">Zusammenführen</th>}
              <th className="px-3 py-2 font-medium">AN-Nr.</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">E-Mail</th>
              <th className="px-3 py-2 font-medium">Ort</th>
              <th className="px-3 py-2 font-medium">Telefon</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Aktivitäten</th>
              <th className="px-3 py-2 font-medium text-right">Verkäufe</th>
              <th className="px-3 py-2 font-medium">Angelegt</th>
            </tr>
          </thead>
          <tbody>
            {g.kontakte.map((k, i) => {
              const istBehalten = k.id === behalten
              return (
                <tr key={k.id} className={`border-t border-s112-line ${istBehalten ? 'bg-s112-ok-bg/50' : ''}`}>
                  {writeOk && (
                    <td className="px-3 py-2">
                      <input type="radio" name={`b-${g.schluessel}`} checked={istBehalten} onChange={() => waehleBehalten(k.id)} className="cursor-pointer" title="Diesen Kontakt behalten" />
                    </td>
                  )}
                  {writeOk && (
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={weg.has(k.id) && !istBehalten} disabled={istBehalten} onChange={() => toggleWeg(k.id)} className="rounded-sm cursor-pointer disabled:opacity-30" title="In den behaltenen Kontakt überführen" />
                    </td>
                  )}
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/crm/kontakte/${k.id}`} className="text-s112-blue-700 hover:underline font-mono text-xs">{k.accountnummer ?? '–'}</Link>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <Link href={`/crm/kontakte/${k.id}`} className="hover:text-s112-blue-700 font-medium">{nameVon(k)}</Link>
                    {i === 0 && writeOk && <span className="ml-2 text-[11px] text-s112-muted">Vorschlag</span>}
                  </td>
                  <td className="px-3 py-2">
                    <div>{k.email ?? <span className="text-s112-muted">–</span>}</div>
                    {k.email_weitere.length > 0 && <div className="text-xs text-s112-muted">{k.email_weitere.join(', ')}</div>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{[k.plz, k.ort].filter(Boolean).join(' ') || <span className="text-s112-muted">–</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{k.telefon ?? <span className="text-s112-muted">–</span>}</td>
                  <td className="px-3 py-2">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${k.is_lead ? 'bg-s112-warn-bg text-s112-warn-fg' : 'bg-s112-ok-bg text-s112-ok-fg'}`}>{k.is_lead ? 'Lead' : 'Kunde'}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.anz_aktivitaeten}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{k.anz_verkaeufe}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-s112-muted">{datumDe(k.erstellt_am)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!writeOk && (
        <div className="px-5 py-2 text-xs text-s112-muted border-t border-s112-line flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Zusammenführen ist Betriebs-Managern und Mitarbeitern vorbehalten.
        </div>
      )}
    </div>
  )
}
