// Öffentliche E-Label-Seite: /e/[code] bzw. https://<E-Label-Host>/<code> (KAN-217, 07.10.2026)
// Keine Anmeldung, keine Cookies, kein Tracking, keine Werbung – nur Bezeichnung, Zutatenliste (Allergene hervorgehoben)
// und Nährwertdeklaration je 100 ml eines FREIGEGEBENEN E-Labels (KAN-216). Sprache nach Browsersprache, Umschalter ?lang=.
// KAN-218: alle 24 EU-Amtssprachen (Begriffe aus den amtlichen Verordnungstexten, lib/elabel/uebersetzungen.ts).

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { zutatenGruppen, type Allergen, type KatalogEintrag } from '@/lib/elabel/katalog'
import { allergenText, kategorieText, seitenTexte, sprachName, zutatName } from '@/lib/elabel/texte'
import { geringfuegigeMengen } from '@/lib/elabel/naehrwerte'
import { ELABEL_SPRACHLISTE, elabelSprache, geringfuegigSatz, folgeUmleitung, istElabelCode, zahlText, type Sprache } from '@/lib/elabel/oeffentlich'
import { qualitaetAnzeigeOderNull } from '@/lib/wein/qualitaet'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type R = Record<string, any>

export const metadata: Metadata = { title: 'E-Label', robots: { index: false, follow: false } }

async function ladeElabel(code: string): Promise<{ e: R; f: R | null; betrieb: string | null; katalog: KatalogEintrag[] } | null> {
  if (!istElabelCode(code)) return null
  // Öffentliche, unangemeldete Seite → Service-Role; der Code ist global eindeutig (UNIQUE), gelesen wird nur ein
  // freigegebenes E-Label und die Anzeige-Felder seiner Füllung.
  const supabase = createSupabaseAdminClient()
  const SPALTEN = 'id, umleitung_auf, tenant_id, fuellung_id, zutaten_ids, alkohol_vol, energie_kj, energie_kcal, fett_g, fett_gesaettigt_g, kohlenhydrate_g, zucker_g, eiweiss_g, salz_g'
  // tenant-isolation-ignore: oeffentliche, unangemeldete Seite ohne aktiven Mandanten – Code global eindeutig (UNIQUE)
  const { data: start } = await (supabase.from('elabels') as R)
    .select(SPALTEN).eq('code', code).eq('status', 'freigegeben').maybeSingle()
  if (!start) return ladeArchiv(supabase, code)
  // KAN-219: umgeleiteter QR-Code (z. B. Nachfolgefüllung) – Ziel im selben Betrieb, freigegeben, höchstens 5 Schritte
  const e = await folgeUmleitung(start as R & { id: string; umleitung_auf: string | null }, async zielId => {
    // tenant-isolation-ignore: Ziel der Umleitung – nur im Betrieb des gedruckten E-Labels und freigegeben
    const { data } = await (supabase.from('elabels') as R)
      .select(SPALTEN).eq('id', zielId).eq('tenant_id', (start as R).tenant_id).eq('status', 'freigegeben').maybeSingle()
    return (data ?? null) as (R & { id: string; umleitung_auf: string | null }) | null
  })
  const [{ data: f }, { data: t }, { data: k }] = await Promise.all([
    // tenant-isolation-ignore: Füllung des freigegebenen E-Labels (tenant_id aus dem E-Label)
    (supabase.from('fuellungen') as R).select('name, jahrgang, rebsorte, qualitaet, zusatzbezeichnung, erzeugnis, sekt_stufe, flaschengroesse_ml')
      .eq('id', (e as R).fuellung_id).eq('tenant_id', (e as R).tenant_id).maybeSingle(),
    (supabase.from('tenants') as R).select('name').eq('id', (e as R).tenant_id).maybeSingle(),
    // alle-ausnahme: globaler E-Label-Katalog (Zutaten/Zusatzstoffe), wenige Dutzend Einträge
    (supabase.from('elabel_zutaten') as R).select('id, kategorie, name_de, name_en, e_nummer, allergen, sortierung').order('sortierung').limit(500),
  ])
  return { e: e as R, f: (f ?? null) as R | null, betrieb: (t as R | null)?.name ?? null, katalog: (k ?? []) as KatalogEintrag[] }
}

/**
 * KAN-219: E-Label eines gelöschten Betriebs – schreibgeschützte Kopie (Inhalt des Umleitungsziels) bis gueltig_bis.
 * Entscheidung Jörgen 07.10.2026: 5 Jahre ab der Löschung (Regel in den AGB).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ladeArchiv(supabase: any, code: string): Promise<{ e: R; f: R | null; betrieb: string | null; katalog: KatalogEintrag[] } | null> {
  // Archiv außerhalb der Data-API (Schema s112_archiv) – nur über die Service-Role-Funktion, die gueltig_bis prüft
  const { data } = await supabase.rpc('s112_elabel_archiv_lesen', { p_code: code })
  if (!data) return null
  const inhalt = data as R
  return { e: (inhalt.e ?? {}) as R, f: (inhalt.f ?? null) as R | null, betrieb: inhalt.betrieb ?? null, katalog: (inhalt.katalog ?? []) as KatalogEintrag[] }
}

export default async function ElabelSeite({ params, searchParams }: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ lang?: string }>
}) {
  const { code } = await params
  const { lang } = await searchParams
  const sprache: Sprache = elabelSprache(lang ?? null, (await headers()).get('accept-language'))
  const T = seitenTexte(sprache)
  const daten = await ladeElabel(decodeURIComponent(code).toUpperCase())

  return (
    <div className="min-h-screen bg-s112-bg flex items-start sm:items-center justify-center p-4" lang={sprache}>
      <main className="w-full max-w-md bg-white rounded-xl shadow-xl overflow-hidden">
        {/* KAN-218: Sprachwahl ohne JavaScript – aufklappbare Liste aller Amtssprachen */}
        <details className="px-4 pt-3 text-right">
          <summary className="inline-block cursor-pointer text-xs text-s112-blue-700 hover:underline list-none">{T.sprache} ▾</summary>
          <ul className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1 text-left text-xs">
            {ELABEL_SPRACHLISTE.map(s => (
              <li key={s}>
                <a href={`?lang=${s}`} hrefLang={s} lang={s}
                  className={s === sprache ? 'font-semibold text-s112-text' : 'text-s112-blue-700 hover:underline'}>{sprachName(s)}</a>
              </li>
            ))}
          </ul>
        </details>
        {!daten ? (
          <p className="px-6 pb-8 pt-2 text-sm text-s112-text-2">{T.nichtGefunden}</p>
        ) : <Inhalt daten={daten} sprache={sprache} />}
      </main>
    </div>
  )
}

function Inhalt({ daten, sprache }: { daten: NonNullable<Awaited<ReturnType<typeof ladeElabel>>>; sprache: Sprache }) {
  const T = seitenTexte(sprache)
  const { e, f, betrieb, katalog } = daten
  const ids = (e.zutaten_ids ?? []) as string[]
  const gruppen = zutatenGruppen(ids, katalog)
  const n = (x: unknown) => (x == null ? null : Number(x))
  const gering = geringfuegigeMengen({ fettG: n(e.fett_g) ?? 0, fettGesaettigtG: n(e.fett_gesaettigt_g) ?? 0, eiweissG: n(e.eiweiss_g) ?? 0, salzG: n(e.salz_g) ?? 0 })
  const geringText: Record<string, string> = { fett: T.fett, gesaettigt: T.gesaettigt, eiweiss: T.eiweiss, salz: T.salz }
  const name = (k: KatalogEintrag) => zutatName(k, sprache)
  const zeile = (k: KatalogEintrag) => {
    const text = `${name(k)}${k.e_nummer ? ` (${k.e_nummer})` : ''}`
    return k.allergen ? <strong key={k.id}>{text}</strong> : <span key={k.id}>{text}</span>
  }
  const qualitaet = f ? qualitaetAnzeigeOderNull(f) : null

  return (
    <div className="px-6 pb-6 space-y-5">
      <header>
        <h1 className="text-xl font-semibold text-s112-text">{f?.name ?? 'Wein'}{f?.jahrgang ? ` ${f.jahrgang}` : ''}</h1>
        <p className="text-sm text-s112-text-2">
          {[f?.rebsorte, qualitaet, e.alkohol_vol != null ? `${zahlText(Number(e.alkohol_vol), 1, sprache)} % vol` : null,
            f?.flaschengroesse_ml ? `${zahlText(Number(f.flaschengroesse_ml) / 1000, Number(f.flaschengroesse_ml) % 1000 === 0 ? 1 : 3, sprache)} l` : null]
            .filter(Boolean).join(' · ')}
        </p>
        {betrieb && <p className="text-xs text-s112-muted mt-0.5">{betrieb}</p>}
      </header>

      <section aria-labelledby="zutaten">
        <h2 id="zutaten" className="text-sm font-semibold text-s112-text mb-1">{T.zutaten}</h2>
        <p className="text-sm text-s112-text leading-relaxed">
          {gruppen.map((g, i) => (
            <span key={g.kategorie}>
              {i > 0 ? '; ' : ''}
              {g.kategorie !== 'zutat' ? `${kategorieText(g.kategorie, sprache)}: ` : ''}
              {g.eintraege.map((k, j) => <span key={k.id}>{j > 0 ? ', ' : ''}{zeile(k)}</span>)}
            </span>
          ))}
        </p>
        {gruppen.some(g => g.eintraege.some(k => k.allergen)) && <p className="text-[11px] text-s112-muted mt-1">{T.allergenHinweis}</p>}
      </section>

      <section aria-labelledby="naehrwerte">
        <h2 id="naehrwerte" className="text-sm font-semibold text-s112-text mb-1">{T.naehrwerte} <span className="font-normal text-s112-muted">({T.je100})</span></h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-s112-line">
            <tr><th scope="row" className="py-1.5 text-left font-normal">{T.energie}</th>
              <td className="py-1.5 text-right tabular-nums">{n(e.energie_kj) ?? '–'} kJ / {n(e.energie_kcal) ?? '–'} kcal</td></tr>
            {([['fett', e.fett_g], ['gesaettigt', e.fett_gesaettigt_g], ['kohlenhydrate', e.kohlenhydrate_g], ['zucker', e.zucker_g], ['eiweiss', e.eiweiss_g], ['salz', e.salz_g]] as const).map(([k, v]) => (
              <tr key={k}>
                <th scope="row" className={`py-1.5 text-left font-normal ${k === 'gesaettigt' || k === 'zucker' ? 'pl-4 text-s112-text-2' : ''}`}>{T[k]}</th>
                <td className="py-1.5 text-right tabular-nums">{v == null ? '–' : `${zahlText(Number(v), k === 'salz' ? 2 : 1, sprache)} g`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {gering.length > 0 && <p className="text-xs text-s112-text-2 mt-2">{geringfuegigSatz(T.geringfuegig, gering.map(g => geringText[g]).join(', '))}</p>}
      </section>

      {(() => {
        const allergene = [...new Set(gruppen.flatMap(g => g.eintraege.map(k => k.allergen)).filter(Boolean))] as Allergen[]
        return allergene.length > 0
          ? <p className="text-sm"><strong>{T.enthaelt}: {allergene.map(a => allergenText(a, sprache)).join(', ')}</strong></p>
          : null
      })()}
    </div>
  )
}
