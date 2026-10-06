'use client'

// ── KAN-216: E-Label einer Füllung bearbeiten (Zutatenliste, Nährwerte, Freigabe) ─────────────────────────────
// Die Nährwerte zeigt das Formular live mit derselben Rechnung wie der Server (lib/elabel/naehrwerte); gespeichert
// wird, was der Server rechnet. Freigegeben = nur Anzeige.

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowDown, ArrowUp, Lock, X } from 'lucide-react'
import { fehlerText } from '@/lib/fehler'
import { zahlAus } from '@/lib/format'
import { berechneNaehrwerte, etikettEnergie, geringfuegigeMengen, naehrwertFehler, type Naehrwerte } from '@/lib/elabel/naehrwerte'
import { ALLERGEN_LABEL, ELABEL_KATEGORIEN, KATEGORIE_LABEL, allergeneDerListe, zutatenText, type KatalogEintrag } from '@/lib/elabel/katalog'
import type { ElabelEingabe } from '@/lib/elabel/eingabe'

export type AnalyseWahl = { id: string; datum: string | null; labor: string | null; alkoholVol: number | null; restzuckerGl: number | null; gesamtsaeureGl: number | null }
export type TypZuordnung = { id: string; name: string; zutatId: string | null }
export type ElabelStand = {
  code: string
  status: 'entwurf' | 'freigegeben'
  zutatenIds: string[]
  analyseId: string | null
  alkoholVol: number | null
  restzuckerGl: number | null
  gesamtsaeureGl: number | null
  glycerinGl: number | null
  manuell: boolean
  manuellGrund: string | null
  werte: Partial<Naehrwerte>
  freigegebenAm: string | null
  freigegebenVonName: string | null
}

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm'
const labelCls = 'block text-xs font-medium text-s112-text-2 mb-1'

const zahlText = (x: number | null | undefined) => (x == null ? '' : String(x).replace('.', ','))
const fmt = (x: number | null | undefined, stellen = 1) =>
  x == null ? '–' : x.toLocaleString('de-AT', { minimumFractionDigits: 0, maximumFractionDigits: stellen })

export default function ElabelFormular({ fuellungId, katalog, analysen, typen, stand, schreiben, typenSchreiben, speichern, freigeben, zuordnen }: {
  fuellungId: string
  katalog: KatalogEintrag[]
  analysen: AnalyseWahl[]
  typen: TypZuordnung[]
  stand: ElabelStand | null
  schreiben: boolean
  typenSchreiben: boolean
  speichern: (e: ElabelEingabe) => Promise<void>
  freigeben: () => Promise<void>
  zuordnen: (typId: string, zutatId: string | null) => Promise<void>
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const gesperrt = stand?.status === 'freigegeben' || !schreiben

  const trauben = katalog.find(k => k.kategorie === 'zutat' && k.name_de === 'Trauben')
  const vorschlag = useMemo(() => {
    const ids: string[] = trauben ? [trauben.id] : []
    for (const t of typen) if (t.zutatId && !ids.includes(t.zutatId) && katalog.some(k => k.id === t.zutatId)) ids.push(t.zutatId)
    return ids
  }, [typen, katalog, trauben])
  const juengste = analysen[0] ?? null

  const [zutaten, setZutaten] = useState<string[]>(stand?.zutatenIds ?? vorschlag)
  const [analyseId, setAnalyseId] = useState<string | null>(stand ? stand.analyseId : juengste?.id ?? null)
  const [alkohol, setAlkohol] = useState(zahlText(stand ? stand.alkoholVol : juengste?.alkoholVol))
  const [zucker, setZucker] = useState(zahlText(stand ? stand.restzuckerGl : juengste?.restzuckerGl))
  const [saeure, setSaeure] = useState(zahlText(stand ? stand.gesamtsaeureGl : juengste?.gesamtsaeureGl))
  const [glycerin, setGlycerin] = useState(zahlText(stand?.glycerinGl))
  const [manuell, setManuell] = useState(stand?.manuell ?? false)
  const [grund, setGrund] = useState(stand?.manuellGrund ?? '')
  const [werte, setWerte] = useState<Record<string, string>>(() => {
    const w = stand?.werte ?? {}
    return {
      energieKj: zahlText(w.energieKj), energieKcal: zahlText(w.energieKcal),
      kohlenhydrateG: zahlText(w.kohlenhydrateG), zuckerG: zahlText(w.zuckerG),
      fettG: zahlText(w.fettG ?? 0), fettGesaettigtG: zahlText(w.fettGesaettigtG ?? 0),
      eiweissG: zahlText(w.eiweissG ?? 0), salzG: zahlText(w.salzG ?? 0),
    }
  })
  const [neueZutat, setNeueZutat] = useState('')

  const eingabe = { alkoholVol: zahlAus(alkohol), restzuckerGl: zahlAus(zucker), gesamtsaeureGl: zahlAus(saeure), glycerinGl: zahlAus(glycerin) }
  const berechnet = berechneNaehrwerte(eingabe)
  const fehlend = naehrwertFehler(eingabe)
  const anzeige: Partial<Naehrwerte> | null = manuell
    ? Object.fromEntries(Object.entries(werte).map(([k, v]) => [k, zahlAus(v) ?? undefined]))
    : berechnet
  const allergene = allergeneDerListe(zutaten, katalog)

  function analyseUebernehmen(id: string) {
    setAnalyseId(id || null)
    const a = analysen.find(x => x.id === id)
    if (a) { setAlkohol(zahlText(a.alkoholVol)); setZucker(zahlText(a.restzuckerGl)); setSaeure(zahlText(a.gesamtsaeureGl)) }
  }
  function verschiebe(i: number, d: -1 | 1) {
    const j = i + d
    if (j < 0 || j >= zutaten.length) return
    const n = [...zutaten]; [n[i], n[j]] = [n[j], n[i]]; setZutaten(n)
  }
  function aktion(f: () => Promise<void>, ok: string) {
    setFehler(null); setHinweis(null)
    startTransition(async () => {
      try { await f(); setHinweis(ok); router.refresh() } catch (e) { setFehler(fehlerText(e, 'Aktion fehlgeschlagen')) }
    })
  }
  function speichernKlick() {
    aktion(() => speichern({
      zutatenIds: zutaten, analyseId, ...eingabe, manuell, manuellGrund: manuell ? grund : null,
      werte: manuell ? Object.fromEntries(Object.entries(werte).map(([k, v]) => [k, zahlAus(v)])) as Partial<Naehrwerte> : null,
    }), 'E-Label gespeichert.')
  }

  const naehrZeilen: { key: keyof Naehrwerte; label: string; einheit: string; stellen: number }[] = [
    { key: 'energieKj', label: 'Brennwert', einheit: 'kJ', stellen: 0 },
    { key: 'energieKcal', label: 'Brennwert', einheit: 'kcal', stellen: 0 },
    { key: 'fettG', label: 'Fett', einheit: 'g', stellen: 1 },
    { key: 'fettGesaettigtG', label: '– davon gesättigte Fettsäuren', einheit: 'g', stellen: 1 },
    { key: 'kohlenhydrateG', label: 'Kohlenhydrate', einheit: 'g', stellen: 1 },
    { key: 'zuckerG', label: '– davon Zucker', einheit: 'g', stellen: 1 },
    { key: 'eiweissG', label: 'Eiweiß', einheit: 'g', stellen: 1 },
    { key: 'salzG', label: 'Salz', einheit: 'g', stellen: 2 },
  ]
  const gering = anzeige ? geringfuegigeMengen({ fettG: anzeige.fettG ?? 0, fettGesaettigtG: anzeige.fettGesaettigtG ?? 0, eiweissG: anzeige.eiweissG ?? 0, salzG: anzeige.salzG ?? 0 }) : []

  return (
    <div className="space-y-6">
      {stand?.status === 'freigegeben' && (
        <div className="card flex items-start gap-2 text-sm">
          <Lock className="w-4 h-4 mt-0.5 text-s112-muted" aria-hidden />
          <div>
            <p className="font-medium text-s112-text">Freigegeben{stand.freigegebenAm ? ` am ${new Date(stand.freigegebenAm).toLocaleDateString('de-AT')}` : ''}{stand.freigegebenVonName ? ` von ${stand.freigegebenVonName}` : ''} – nicht mehr änderbar.</p>
            <p className="text-s112-muted text-xs mt-0.5">Kennung {stand.code}. Korrekturen nur durch die Betriebsleitung (Korrektur gesperrter Daten).</p>
          </div>
        </div>
      )}

      {/* Zutaten */}
      <section className="card space-y-3">
        <h2 className="font-semibold text-s112-text">Zutatenliste</h2>
        <p className="text-xs text-s112-muted">Reihenfolge = Reihenfolge auf dem E-Label. Zusatzstoffe erscheinen gesammelt unter ihrer Kategorie.</p>
        {zutaten.length === 0 && <p className="text-sm text-s112-muted">Noch keine Zutaten.</p>}
        <ul className="divide-y divide-s112-border">
          {zutaten.map((zid, i) => {
            const k = katalog.find(x => x.id === zid)
            return (
              <li key={zid} className="flex items-center gap-2 py-1.5 text-sm">
                <span className="flex-1 min-w-0">
                  {k ? k.name_de : 'Unbekannt'}{k?.e_nummer ? ` (${k.e_nummer})` : ''}
                  <span className="text-xs text-s112-muted"> · {k ? KATEGORIE_LABEL[k.kategorie].de : ''}</span>
                  {k?.allergen && <span className="ml-2 text-xs px-1.5 py-0.5 rounded-sm bg-s112-warn-bg text-s112-warn-fg">Allergen: {ALLERGEN_LABEL[k.allergen].de}</span>}
                </span>
                {!gesperrt && (
                  <span className="flex gap-1">
                    <button type="button" aria-label="nach oben" onClick={() => verschiebe(i, -1)} className="p-1 text-s112-muted hover:text-s112-text"><ArrowUp className="w-4 h-4" /></button>
                    <button type="button" aria-label="nach unten" onClick={() => verschiebe(i, 1)} className="p-1 text-s112-muted hover:text-s112-text"><ArrowDown className="w-4 h-4" /></button>
                    <button type="button" aria-label="entfernen" onClick={() => setZutaten(zutaten.filter(x => x !== zid))} className="p-1 text-s112-muted hover:text-s112-err-fg"><X className="w-4 h-4" /></button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
        {!gesperrt && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-48">
              <label htmlFor="neue-zutat" className={labelCls}>Zutat oder Zusatzstoff hinzufügen</label>
              <select id="neue-zutat" value={neueZutat} onChange={e => setNeueZutat(e.target.value)} className={inputCls}>
                <option value="">– auswählen –</option>
                {ELABEL_KATEGORIEN.map(kat => (
                  <optgroup key={kat} label={KATEGORIE_LABEL[kat].de}>
                    {katalog.filter(k => k.kategorie === kat && !zutaten.includes(k.id)).map(k => (
                      <option key={k.id} value={k.id}>{k.name_de}{k.e_nummer ? ` (${k.e_nummer})` : ''}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
            <button type="button" disabled={!neueZutat} onClick={() => { setZutaten([...zutaten, neueZutat]); setNeueZutat('') }}
              className="border border-s112-border px-3 py-2 rounded-lg text-sm disabled:opacity-50">Hinzufügen</button>
            {vorschlag.some(v => !zutaten.includes(v)) && (
              <button type="button" onClick={() => setZutaten([...zutaten, ...vorschlag.filter(v => !zutaten.includes(v))])}
                className="text-xs text-s112-blue-700 hover:underline py-2">Vorschlag aus den Kellerbehandlungen übernehmen</button>
            )}
          </div>
        )}
        {zutaten.length > 0 && <p className="text-xs text-s112-muted">Vorschau: {zutatenText(zutaten, katalog, 'de')}</p>}
      </section>

      {/* Nährwerte */}
      <section className="card space-y-4">
        <h2 className="font-semibold text-s112-text">Nährwerte je 100 ml</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label htmlFor="analyse" className={labelCls}>Analyse</label>
            <select id="analyse" value={analyseId ?? ''} disabled={gesperrt} onChange={e => analyseUebernehmen(e.target.value)} className={inputCls}>
              <option value="">– ohne Analyse (Werte von Hand) –</option>
              {analysen.map(a => (
                <option key={a.id} value={a.id}>
                  {a.datum ? new Date(a.datum).toLocaleDateString('de-AT') : 'ohne Datum'}{a.labor ? ` · ${a.labor}` : ''} · {fmt(a.alkoholVol, 2)} % vol · {fmt(a.restzuckerGl)} g/l Zucker
                </option>
              ))}
            </select>
            {analysen.length === 0 && <p className="text-xs text-s112-muted mt-1">Zu den Chargen der Füllung gibt es keine Analyse – Werte bitte eintragen.</p>}
          </div>
          <div><label htmlFor="alk" className={labelCls}>Alkohol (% vol)</label><input id="alk" inputMode="decimal" value={alkohol} disabled={gesperrt} onChange={e => setAlkohol(e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="rz" className={labelCls}>Restzucker (g/l)</label><input id="rz" inputMode="decimal" value={zucker} disabled={gesperrt} onChange={e => setZucker(e.target.value)} className={inputCls} /></div>
          <div><label htmlFor="gs" className={labelCls}>Gesamtsäure (g/l)</label><input id="gs" inputMode="decimal" value={saeure} disabled={gesperrt} onChange={e => setSaeure(e.target.value)} className={inputCls} /></div>
          <div>
            <label htmlFor="gly" className={labelCls}>Glycerin (g/l, optional)</label>
            <input id="gly" inputMode="decimal" value={glycerin} disabled={gesperrt} onChange={e => setGlycerin(e.target.value)} className={inputCls} placeholder="leer = nicht eingerechnet" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={manuell} disabled={gesperrt} onChange={e => setManuell(e.target.checked)} />
          Nährwerte von Hand eintragen (z. B. Laborwerte)
        </label>
        {manuell && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {naehrZeilen.map(z => (
              <div key={z.key}>
                <label htmlFor={`w-${z.key}`} className={labelCls}>{z.label} ({z.einheit})</label>
                <input id={`w-${z.key}`} inputMode="decimal" value={werte[z.key] ?? ''} disabled={gesperrt}
                  onChange={e => setWerte({ ...werte, [z.key]: e.target.value })} className={inputCls} />
              </div>
            ))}
            <div className="col-span-2 sm:col-span-4">
              <label htmlFor="grund" className={labelCls}>Grund (mind. 10 Zeichen)</label>
              <input id="grund" value={grund} disabled={gesperrt} onChange={e => setGrund(e.target.value)} className={inputCls} />
            </div>
          </div>
        )}

        {!manuell && fehlend.length > 0 ? (
          <p className="text-sm text-s112-warn-fg flex items-center gap-1"><AlertTriangle className="w-4 h-4" aria-hidden /> Für die Berechnung fehlt: {fehlend.join(', ')}.</p>
        ) : anzeige && (
          <table className="w-full text-sm">
            <tbody>
              {naehrZeilen.filter(z => z.key !== 'energieKcal').map(z => (
                <tr key={z.key} className="border-b border-s112-border last:border-0">
                  <td className="py-1.5 text-s112-text-1">{z.label}</td>
                  <td className="py-1.5 text-right tabular-nums">
                    {z.key === 'energieKj'
                      ? `${fmt(anzeige.energieKj, 0)} kJ / ${fmt(anzeige.energieKcal, 0)} kcal`
                      : `${fmt(anzeige[z.key] as number | undefined, z.stellen)} ${z.einheit}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {gering.length === 4 && <p className="text-xs text-s112-muted">Auf dem E-Label: „Enthält geringfügige Mengen von Fett, gesättigten Fettsäuren, Eiweiß und Salz.“</p>}
      </section>

      {/* Etikett */}
      <section className="card space-y-1 text-sm">
        <h2 className="font-semibold text-s112-text">Auf das gedruckte Etikett</h2>
        <p>Brennwert: <strong>{etikettEnergie(anzeige?.energieKcal ?? null) ?? '–'}</strong> (je 100 ml)</p>
        <p>Allergene: <strong>{allergene.length ? `Enthält ${allergene.map(a => ALLERGEN_LABEL[a].de).join(', ')}` : 'keine'}</strong></p>
        <p className="text-xs text-s112-muted">QR-Code und öffentliche Seite folgen mit KAN-217{stand ? ` (Kennung ${stand.code})` : ''}.</p>
      </section>

      {/* Zuordnung Behandlungstypen */}
      {typen.length > 0 && (
        <section className="card space-y-3">
          <h2 className="font-semibold text-s112-text">Kellerbehandlungen der Chargen</h2>
          <p className="text-xs text-s112-muted">Ordne jeden Behandlungstyp einmal einer Zutat zu – das gilt für alle Füllungen und ergibt den Vorschlag der Zutatenliste.</p>
          <ul className="divide-y divide-s112-border">
            {typen.map(t => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-1.5 text-sm">
                <span className="flex-1 min-w-40">{t.name}</span>
                <select aria-label={`Zutat für ${t.name}`} value={t.zutatId ?? ''} disabled={!typenSchreiben || pending}
                  onChange={e => aktion(() => zuordnen(t.id, e.target.value || null), 'Zuordnung gespeichert.')}
                  className="border border-s112-border rounded-lg px-2 py-1 text-sm max-w-xs">
                  <option value="">– keine (nicht deklarationspflichtig) –</option>
                  {ELABEL_KATEGORIEN.map(kat => (
                    <optgroup key={kat} label={KATEGORIE_LABEL[kat].de}>
                      {katalog.filter(k => k.kategorie === kat).map(k => <option key={k.id} value={k.id}>{k.name_de}</option>)}
                    </optgroup>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </section>
      )}

      {fehler && <p role="alert" className="text-sm text-s112-err-fg">{fehler}</p>}
      {hinweis && <p className="text-sm text-s112-ok-fg">{hinweis}</p>}
      {!gesperrt && (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={speichernKlick} disabled={pending}
            className="bg-s112-teal text-s112-yellow px-4 py-2 rounded-lg text-sm font-semibold hover:bg-s112-teal/90 disabled:opacity-50">
            {pending ? 'Wird gespeichert …' : 'Entwurf speichern'}
          </button>
          {stand && (
            <button type="button" disabled={pending}
              onClick={() => { if (confirm('E-Label freigeben? Danach ist es nicht mehr änderbar.')) aktion(freigeben, 'E-Label freigegeben.') }}
              className="border border-s112-border px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-50">
              Freigeben
            </button>
          )}
        </div>
      )}
      <input type="hidden" value={fuellungId} readOnly />
    </div>
  )
}
