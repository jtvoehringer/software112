import type { Metadata } from 'next'
import { UMSATZ_BESCHRIFTUNG } from '@/lib/verkauf/umsatz'
import Link from '@/components/ui/Link'
import { redirect } from 'next/navigation'
import { TrendingUp, TrendingDown, Wallet, Landmark, ReceiptText, FileCheck2, Send, ArrowRight } from 'lucide-react'
import { DashHeader, Tile, Card, Badge, Note, BarRow, Th, Td, fmtEur, fmtDate } from '@/app/(dashboard)/dashboard/_shared/ui'
import { getCtx, ladeEinstellungen } from '@/app/(dashboard)/dashboard/_shared/data'
import { ladeFinanzen, monatLabel, OHNE_KATEGORIE } from '@/lib/finanzen/uebersicht'

export const metadata: Metadata = { title: 'Finanzübersicht' }
export const dynamic = 'force-dynamic'

// ── Finanzübersicht "Wo stehe ich?" (Rückmeldung 8.9.2026) ─────────────────
// Erster Punkt im Bereich E&A-Rechnung / Belege & BMD. Ein Blick: Ergebnis
// gegen Vorjahr, Liquidität, Forderungen, Meldestand - bei Doppik statt UVA und
// Monatsabschluss der Übergabestand an den Steuerberater.

export default async function FinanzUebersichtPage({ searchParams }: { searchParams: Promise<{ jahr?: string }> }) {
  const ctx = await getCtx()
  if (!ctx.tenantId) redirect('/login')
  const einst = await ladeEinstellungen(ctx)
  if (!einst.modulEa) redirect('/dashboard')

  const sp = await searchParams
  const jahrAktuell = ctx.heute.getFullYear()
  const jahr = Math.min(jahrAktuell, Math.max(jahrAktuell - 5, parseInt(sp.jahr ?? '') || jahrAktuell))   // null-vorgabe-ok: Jahr 0 aus der URL ist ungültig – aktuelles Jahr
  const art = einst.doppik ? 'doppik' : 'ea'
  const f = await ladeFinanzen(ctx, { art, uvaZeitraum: einst.uvaZeitraum, jahr })

  const delta = (a: number, b: number) => b === 0 ? null : (a - b) / Math.abs(b) * 100
  const deltaText = (a: number, b: number, invers = false) => {
    const d = delta(a, b)
    if (d === null) return 'kein Vorjahreswert'
    void invers
    return `${d >= 0 ? '+' : ''}${d.toFixed(0)} % gegenüber Vorjahr (${fmtEur(b)})`
  }
  const ergebnisTone = f.ytd.ergebnis < 0 ? 'err' : f.ytd.ergebnisVj !== 0 && f.ytd.ergebnis < f.ytd.ergebnisVj ? 'warn' : 'ok'
  const maxMonat = Math.max(1, ...f.monate.flatMap(m => [m.einnahmen, m.ausgaben, m.einnahmenVj, m.ausgabenVj]))
  const bisMonat = jahr === jahrAktuell ? ctx.heute.getMonth() + 1 : 12
  const bereich = einst.doppik ? 'Belege & BMD' : 'E&A-Rechnung'

  return (
    <div className="space-y-6">
      <DashHeader
        title="Finanzübersicht"
        sub={<>{einst.doppik ? 'Belegerfassung für die doppelte Buchhaltung beim Steuerberater' : 'Einnahmen-Ausgaben-Rechnung'} · {jahr === jahrAktuell ? <>Jahr bis {fmtDate(ctx.heute)}</> : <>Gesamtjahr {jahr}</>}, Vorjahr jeweils bis zum gleichen Stichtag. Beträge netto, Liquidität und Forderungen brutto.</>}
        right={
          <form method="GET" className="flex items-center gap-2">
            <select name="jahr" defaultValue={String(jahr)} className="border border-s112-border rounded-lg px-2 py-1.5 text-sm bg-white">
              {Array.from({ length: 4 }, (_, i) => jahrAktuell - i).map(j => <option key={j} value={j}>{j}</option>)}
            </select>
            <button type="submit" className="bg-s112-teal text-s112-yellow px-3 py-1.5 rounded-lg text-[13px] font-semibold hover:opacity-90">Anzeigen</button>
          </form>
        }
      />

      {/* KAN-158: Datenbankfehler nicht als 0 € verstecken */}
      {f.unvollstaendig.length > 0 && (
        <div role="alert" className="rounded-xl border border-s112-err/30 bg-s112-err-bg text-s112-err-fg px-4 py-3 text-[13px]">
          <b>Zahlen unvollständig:</b> {f.unvollstaendig.join(', ')} {f.unvollstaendig.length === 1 ? 'konnte' : 'konnten'} nicht geladen werden – die betroffenen Werte sind zu niedrig oder 0. Bitte die Seite neu laden; bleibt der Hinweis, den Support verständigen.
        </div>
      )}

      {/* ── Kennzahlen ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Tile label={einst.doppik ? 'Ergebnis lt. Belegen' : 'Ergebnis (Einnahmen − Ausgaben)'} icon={f.ytd.ergebnis >= 0 ? TrendingUp : TrendingDown} href="/buchhaltung"
          value={fmtEur(f.ytd.ergebnis)} sub={deltaText(f.ytd.ergebnis, f.ytd.ergebnisVj)} tone={ergebnisTone} />
        <Tile label="Einnahmen" icon={TrendingUp} href="/buchhaltung"
          value={fmtEur(f.ytd.einnahmen)} sub={deltaText(f.ytd.einnahmen, f.ytd.einnahmenVj)} />
        <Tile label="Ausgaben" icon={TrendingDown} href="/buchhaltung"
          value={fmtEur(f.ytd.ausgaben)} sub={deltaText(f.ytd.ausgaben, f.ytd.ausgabenVj, true)}
          tone={f.ytd.ausgabenVj > 0 && f.ytd.ausgaben > f.ytd.ausgabenVj * 1.15 ? 'warn' : undefined} />
        <Tile label="Liquidität (Konten)" icon={Landmark} href="/konten"
          value={fmtEur(f.liquiditaet.summe)}
          sub={f.liquiditaet.konten.length === 0 ? 'Keine Konten angelegt' : f.liquiditaet.konten.map(k => `${k.name} ${fmtEur(k.saldo)}`).join(' · ')}
          tone={f.liquiditaet.summe < 0 ? 'err' : undefined} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Tile label={jahr === jahrAktuell ? 'Offene Forderungen' : 'Offene Forderungen (heute)'} icon={ReceiptText} href="/weinhandel/offene-posten"
          value={fmtEur(f.forderungen.summe)}
          sub={f.forderungen.anzahl === 0 ? 'Alle Rechnungen bezahlt' : f.forderungen.ueberfaellig > 0 ? `${f.forderungen.ueberfaellig} überfällig · ${fmtEur(f.forderungen.ueberfaelligSumme)}` : `${f.forderungen.anzahl} offen`}
          tone={f.forderungen.ueberfaellig > 0 ? 'err' : undefined} />
        <Tile label={UMSATZ_BESCHRIFTUNG} icon={Wallet} href="/weinhandel"
          value={fmtEur(f.umsatz.ytd)} sub={deltaText(f.umsatz.ytd, f.umsatz.vj)} />
        {einst.doppik && f.uebergabe ? (
          <Tile label="Übergabe an Steuerberater" icon={Send} href="/controlling/bmd"
            value={`${f.uebergabe.rechnungenOffen + f.uebergabe.belegeOffen} offen`}
            sub={f.uebergabe.letzte ? `${f.uebergabe.rechnungenOffen} Rechnungen · ${f.uebergabe.belegeOffen} Belege · letzte Übergabe ${fmtDate(f.uebergabe.letzte.erstelltAm)}` : 'Noch keine Übergabe protokolliert'}
            tone={f.uebergabe.rechnungenOffen + f.uebergabe.belegeOffen > 0 ? 'warn' : 'ok'} />
        ) : (
          <Tile label={`UVA ${f.uva?.label ?? ''}`} icon={FileCheck2} href="/buchhaltung/uva"
            value={f.uva?.status === 'uebermittelt' ? 'übermittelt' : f.uva?.status === 'entwurf' ? 'Entwurf' : 'offen'}
            sub={f.uva ? (f.uva.zahllast !== null ? `Zahllast ${fmtEur(f.uva.zahllast)} · fällig ${fmtDate(f.uva.faelligAm)}` : `noch nicht berechnet · fällig ${fmtDate(f.uva.faelligAm)}`) : ''}
            tone={f.uva?.status === 'uebermittelt' ? 'ok' : f.uva && f.uva.faelligAm < ctx.heuteStr ? 'err' : 'warn'} />
        )}
        <Tile label={einst.doppik ? 'Belege' : 'Buchungen & Belege'} icon={FileCheck2} href={f.belege.zuBuchen > 0 ? '/buchhaltung/belege' : '/buchhaltung'}
          value={`${f.belege.buchungenJahr}`}
          sub={f.belege.zuBuchen > 0 ? `${f.belege.zuBuchen} erkannte Belege noch zu buchen` : f.belege.ohneKategorie > 0 ? `${f.belege.ohneKategorie} Buchungen ohne Kategorie` : `Buchungen ${jahr} · nichts offen`}
          tone={f.belege.zuBuchen > 0 || f.belege.ohneKategorie > 0 ? 'warn' : 'ok'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* ── Monatsverlauf ──────────────────────────────────────────────── */}
        <Card className="lg:col-span-3" title={`Monatsverlauf ${jahr}`} right={<span className="text-[11.5px] text-s112-text-2">Blau = Einnahmen {jahr} · Hellblau = Einnahmen {jahr - 1} · Grau = Ausgaben {jahr}</span>}>
          <div className="space-y-2">
            {f.monate.slice(0, bisMonat).map(m => (
              <div key={m.monat} className="grid grid-cols-[44px_1fr] gap-2 items-start">
                <span className="text-[12px] font-medium text-s112-text-2 pt-[3px]">{monatLabel(m.monat)}</span>
                <div>
                  <BarRow label="Einnahmen" value={m.einnahmen} max={maxMonat} text={fmtEur(m.einnahmen)} tone={1} labelWidth={70} />
                  <BarRow label={`VJ`} value={m.einnahmenVj} max={maxMonat} text={fmtEur(m.einnahmenVj)} tone={2} labelWidth={70} />
                  <BarRow label="Ausgaben" value={m.ausgaben} max={maxMonat} text={fmtEur(m.ausgaben)} tone="grey" labelWidth={70} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 pt-3 border-t border-s112-line grid grid-cols-3 gap-3 text-[12.5px]">
            <div><span className="text-s112-text-2">Einnahmen {jahr - 1} gesamt</span><br /><span className="font-mono font-semibold">{fmtEur(f.gesamtVj.einnahmen)}</span></div>
            <div><span className="text-s112-text-2">Ausgaben {jahr - 1} gesamt</span><br /><span className="font-mono font-semibold">{fmtEur(f.gesamtVj.ausgaben)}</span></div>
            <div><span className="text-s112-text-2">Ergebnis {jahr - 1} gesamt</span><br /><span className={`font-mono font-semibold ${f.gesamtVj.ergebnis < 0 ? 'text-s112-err-fg' : ''}`}>{fmtEur(f.gesamtVj.ergebnis)}</span></div>
          </div>
        </Card>

        {/* ── Stand & nächste Schritte ───────────────────────────────────── */}
        <Card className="lg:col-span-2" title={einst.doppik ? 'Stand der Übergabe' : 'Stand der Buchhaltung'}>
          <div className="space-y-3 text-[13px]">
            {einst.doppik && f.uebergabe ? (
              <>
                <Zeile k="Ausgangsrechnungen" v={f.uebergabe.rechnungenOffen === 0 ? <Badge tone="ok">alle übergeben</Badge> : <Badge tone="warn">{f.uebergabe.rechnungenOffen} nicht übergeben</Badge>} />
                <Zeile k="Eingangsbelege" v={f.uebergabe.belegeOffen === 0 ? <Badge tone="ok">alle übergeben</Badge> : <Badge tone="warn">{f.uebergabe.belegeOffen} nicht übergeben</Badge>} />
                <Zeile k="Letzte Übergabe" v={f.uebergabe.letzte ? `${fmtDate(f.uebergabe.letzte.erstelltAm)} · ${f.uebergabe.letzte.anzahl} Belege` : '–'} />
                <Zeile k="UVA" v={<span className="text-s112-text-2">meldet der Steuerberater aus BMD · <Link href="/buchhaltung/uva" className="text-s112-blue-700 hover:underline">Vorschau</Link></span>} />
                <Zeile k="Belege zu buchen" v={f.belege.zuBuchen > 0 ? <Link href="/buchhaltung/belege"><Badge tone="warn">{f.belege.zuBuchen} erkannt</Badge></Link> : <Badge tone="ok">nichts offen</Badge>} />
                <Link href="/controlling/bmd" className="inline-flex items-center gap-1.5 mt-2 bg-s112-teal text-s112-yellow px-3.5 py-2 rounded-lg text-[13px] font-semibold hover:opacity-90">
                  Zur BMD-Übergabe <ArrowRight size={15} />
                </Link>
              </>
            ) : (
              <>
                <Zeile k={`UVA ${f.uva?.label ?? ''}`} v={f.uva?.status === 'uebermittelt' ? <Badge tone="ok">übermittelt</Badge> : f.uva?.status === 'entwurf' ? <Link href="/buchhaltung/uva"><Badge tone="warn">Entwurf · fällig {fmtDate(f.uva.faelligAm)}</Badge></Link> : <Link href="/buchhaltung/uva"><Badge tone={f.uva && f.uva.faelligAm < ctx.heuteStr ? 'err' : 'warn'}>noch nicht berechnet</Badge></Link>} />
                <Zeile k="Monatsabschluss" v={f.monatsabschluss.offeneMonate === 0 ? <Badge tone="ok">alle Monate abgeschlossen</Badge> : <Link href="/buchhaltung/monatsabschluss"><Badge tone="warn">{f.monatsabschluss.offeneMonate} {f.monatsabschluss.offeneMonate === 1 ? 'Monat' : 'Monate'} offen</Badge></Link>} />
                <Zeile k="Zuletzt abgeschlossen" v={f.monatsabschluss.letzter ? f.monatsabschluss.letzter.split('-').reverse().join('/') : '–'} />
                <Zeile k="Belege zu buchen" v={f.belege.zuBuchen > 0 ? <Link href="/buchhaltung/belege"><Badge tone="warn">{f.belege.zuBuchen} erkannt</Badge></Link> : <Badge tone="ok">nichts offen</Badge>} />
                <Zeile k="Ohne Kategorie" v={f.belege.ohneKategorie > 0 ? <Link href="/buchhaltung"><Badge tone="warn">{f.belege.ohneKategorie} Buchungen</Badge></Link> : <Badge tone="ok">0</Badge>} />
              </>
            )}
          </div>
          <Note className="mt-4">
            {einst.doppik
              ? 'Die Zahlen zeigen die in software:112 erfassten Belege. Verbindlich ist die Buchhaltung des Steuerberaters in BMD.'
              : 'Ergebnis vor Steuern nach Einnahmen-Ausgaben-Rechnung (Zuflussprinzip). Für die Steuererklärung gilt die Auswertung des Steuerberaters.'}
          </Note>
        </Card>
      </div>

      {/* ── Anlagevermögen & steuerliches Ergebnis (Migration 200) ──────────── */}
      <Card title="Anlagevermögen & Ergebnis nach AfA" right={<Link href="/buchhaltung/anlagen" className="text-[12.5px] text-s112-blue-700 hover:underline">Anlagen & AfA →</Link>}>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-3 text-[13px]">
          <div className="space-y-2">
            <Zeile k={`Ergebnis (Einnahmen − Ausgaben)${jahr === jahrAktuell ? ' bis heute' : ''}`} v={<span className="font-mono">{fmtEur(f.ytd.ergebnis)}</span>} />
            <Zeile k="+ Anlagenkäufe (Kontenklasse 0, aktivierungspflichtig)" v={<span className="font-mono">{f.anlagen.anlagenkaeufeJahr > 0 ? `+ ${fmtEur(f.anlagen.anlagenkaeufeJahr)}` : '–'}</span>} />
            <Zeile k={`− Abschreibung (AfA) ${jahr} lt. Anlagenverzeichnis, volles Jahr`} v={<span className="font-mono">{f.anlagen.afaJahr > 0 ? `− ${fmtEur(f.anlagen.afaJahr)}` : f.anlagen.imVerzeichnis === 0 ? <Link href="/buchhaltung/anlagen" className="text-s112-blue-700 hover:underline">Verzeichnis anlegen</Link> : '–'}</span>} />
            <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-s112-line-str">
              <span className="font-semibold text-s112-text">Ergebnis nach voller Jahres-AfA (steuerlich, vereinfacht)</span>
              <span className={`font-mono font-semibold ${f.anlagen.ergebnisNachAfa < 0 ? 'text-s112-err-fg' : 'text-s112-text'}`}>{fmtEur(f.anlagen.ergebnisNachAfa)}</span>
            </div>
            <p className="text-[11.5px] text-s112-tertiary">Vorjahr bis zum gleichen Stichtag: {fmtEur(f.anlagen.ergebnisNachAfaVj)}{f.anlagen.afaGebuchtJahr > 0 && <> · AfA {jahr} bereits gebucht: {fmtEur(f.anlagen.afaGebuchtJahr)}</>}</p>
            {/* KAN-157 (Entscheidung Jörgen): volle Jahres-AfA lt. Plan (Anschaffungsjahr mit Halbjahresregel), nicht anteilig bis heute */}
            {jahr === jahrAktuell && <p className="text-[11.5px] text-s112-tertiary">Abgezogen ist die AfA des ganzen Jahres {jahr} lt. Anlagenverzeichnis (im Anschaffungsjahr ganz bzw. halb nach der Halbjahresregel) – auch wenn das Jahr noch läuft.</p>}
          </div>
          <div className="space-y-2">
            <Zeile k="Anlagen im Verzeichnis" v={f.anlagen.imVerzeichnis === 0 ? <Badge tone="gray">keine</Badge> : <span className="font-mono">{f.anlagen.anzahlAktiv} aktiv</span>} />
            <Zeile k="Anschaffungskosten (Bestand)" v={<span className="font-mono">{fmtEur(f.anlagen.anschaffungskosten)}</span>} />
            <Zeile k="Kumulierte AfA" v={<span className="font-mono">{fmtEur(f.anlagen.kumulierteAfa)}</span>} />
            <div className="flex items-baseline justify-between gap-3 pt-2 border-t border-s112-line-str">
              <span className="font-semibold text-s112-text">Buchwert Anlagevermögen{jahr === jahrAktuell ? '' : ` 31.12.${jahr}`}</span>
              <span className="font-mono font-semibold text-s112-text">{fmtEur(f.anlagen.buchwert)}</span>
            </div>
            {f.anlagen.offeneKaeufe > 0 && (
              <p className="text-[12px]"><Link href="/buchhaltung/anlagen"><Badge tone="warn">{f.anlagen.offeneKaeufe} {f.anlagen.offeneKaeufe === 1 ? 'Anlagenkauf' : 'Anlagenkäufe'} noch nicht im Verzeichnis</Badge></Link></p>
            )}
          </div>
        </div>
      </Card>

      {/* ── Kategorien ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <KategorieKarte titel={`Einnahmen nach Kategorie ${jahr}`} zeilen={f.kategorien.einnahmen} />
        <KategorieKarte titel={`Ausgaben nach Kategorie ${jahr}`} zeilen={f.kategorien.ausgaben} warn />
      </div>

      <p className="text-[11.5px] text-s112-tertiary">Schnell zu: <Link href="/buchhaltung" className="text-s112-blue-700 hover:underline">Buchungen</Link> · <Link href="/konten" className="text-s112-blue-700 hover:underline">Konten</Link> · <Link href="/weinhandel/offene-posten" className="text-s112-blue-700 hover:underline">Offene Posten</Link> · <Link href="/reports" className="text-s112-blue-700 hover:underline">Auswertungen</Link> · <Link href="/buchhaltung/svs" className="text-s112-blue-700 hover:underline">SV-Beiträge (SVS)</Link> · Bereich {bereich}</p>
    </div>
  )
}

function Zeile({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-s112-line pb-2 last:border-0">
      <span className="text-s112-text-2">{k}</span>
      <span className="font-medium text-right">{v}</span>
    </div>
  )
}

function KategorieKarte({ titel, zeilen, warn }: { titel: string; zeilen: { name: string; betrag: number; vj: number }[]; warn?: boolean }) {
  const max = Math.max(1, ...zeilen.flatMap(z => [z.betrag, z.vj]))
  return (
    <Card title={titel} right={<span className="text-[11.5px] text-s112-text-2">Vorjahr bis gleicher Stichtag</span>}>
      {zeilen.length === 0 ? (
        <p className="text-[13px] text-s112-text-2">Noch keine Buchungen.</p>
      ) : (
        <table className="w-full">
          <thead><tr><Th>Kategorie</Th><Th right>Heuer</Th><Th right>Vorjahr</Th><Th right>Δ</Th></tr></thead>
          <tbody>
            {zeilen.map(z => {
              const d = z.vj === 0 ? null : (z.betrag - z.vj) / z.vj * 100
              return (
                <tr key={z.name}>
                  <Td>
                    <span className={`block ${z.name === OHNE_KATEGORIE ? 'italic text-s112-text-2' : ''}`}>{z.name}</span>
                    <div className="mt-1 h-[6px] rounded-sm bg-s112-line overflow-hidden"><div className={`h-full ${warn ? 'bg-s112-grey' : 'bg-s112-blue-700'}`} style={{ width: `${Math.max(2, z.betrag / max * 100)}%` }} /></div>
                  </Td>
                  <Td right mono>{fmtEur(z.betrag, 2)}</Td>
                  <Td right mono className="text-s112-text-2">{fmtEur(z.vj, 2)}</Td>
                  <Td right mono className={d === null ? 'text-s112-tertiary' : (warn ? d > 15 : d < -15) ? 'text-s112-warn-fg' : 'text-s112-text-2'}>{d === null ? '–' : `${d >= 0 ? '+' : ''}${d.toFixed(0)} %`}</Td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </Card>
  )
}
