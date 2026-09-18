import type { Metadata } from 'next'
import Link from '@/components/ui/Link'
import { Wine, Package, ReceiptText, ListChecks, ShoppingCart, Calendar, Wallet, FlaskConical, Grape } from 'lucide-react'
import { DashHeader, Tile, Card, Badge, Empty, fmtEur, fmtNum, fmtDate, tageBis, type BadgeTone } from './_shared/ui'
import { getCtx, ladeKeller, ladeFlaschenlager, ladeOffenePosten, ladeFristen, ladeEinstellungen, ladeNaechsteTermine, ladeWeingarten, type R } from './_shared/data'
import { ladeFinanzen } from '@/lib/finanzen/uebersicht'
import { ladeMorgenbericht } from '@/lib/morgenbericht/erstellen'
import { canWrite } from '@/lib/auth/roles'
import MorgenberichtKarte from './morgenbericht/MorgenberichtKarte'
import { TrendingUp } from 'lucide-react'

export const metadata: Metadata = { title: 'Übersicht – software:112' }
export const dynamic = 'force-dynamic'

// ── Sicht "Übersicht" (Dashboard-Relaunch 27.8.2026) ─────────────────────────
// Bereichsübergreifende Startseite nach dem Dashboard-PoC: vier Kennzahlen
// (Keller, Flaschenlager, Offene Posten, Aufgaben), "Nächste Schritte" über
// alle Module und die Karte "Morgenbericht" (täglicher Scan + Wetter je Ried). Die Verkaufs-Kennzahlen des
// bisherigen Dashboards leben unverändert in der Sicht "Verkauf & CRM".

type Schritt = { key: string; titel: string; hinweis: string; wann: string; badge: string; tone: BadgeTone; href: string; rang: number }

export default async function UebersichtPage() {
  const ctx = await getCtx()
  const einst = await ladeEinstellungen(ctx)
  const jahr = ctx.heute.getFullYear()

  const [keller, flaschen, offen, fristen, termine, weingarten, { data: profil }, { count: checklistOffen }, finanzen, morgenbericht] = await Promise.all([
    ladeKeller(ctx, einst.messintervallTage),
    ladeFlaschenlager(ctx),
    ladeOffenePosten(ctx),
    ladeFristen(ctx, { modulEa: einst.modulEa, uvaZeitraum: einst.uvaZeitraum, vorwarnungTage: einst.vorwarnungTage, betriebsbeginn: einst.betriebsbeginn, doppik: einst.doppik }),
    ladeNaechsteTermine(ctx, 3),
    ladeWeingarten(ctx),
    ctx.userId ? ctx.q('profiles').select('full_name').eq('id', ctx.userId).maybeSingle() : Promise.resolve({ data: null }),
    ctx.tf(ctx.q('checklisten_punkte').select('id, checkliste:checkliste_id!inner(jahr, typ)', { count: 'exact', head: true }).eq('erledigt', false).eq('checkliste.jahr', jahr)),
    // Finanzübersicht-Kachel (Rückmeldung 8.9.2026): "wo stehe ich" auf einen Klick
    einst.modulEa ? ladeFinanzen(ctx, { art: einst.doppik ? 'doppik' : 'ea', uvaZeitraum: einst.uvaZeitraum }) : Promise.resolve(null),
    // Morgenbericht (Migration 201): jüngster gespeicherter Bericht
    ctx.tenantId ? ladeMorgenbericht(ctx.supabase, ctx.tenantId) : Promise.resolve(null),
  ])

  const vorname = ((profil as R | null)?.full_name ?? '').split(/\s+/)[0] || null
  const stunde = ctx.heute.getHours()
  const gruss = stunde < 11 ? 'Guten Morgen' : stunde < 17 ? 'Guten Tag' : 'Guten Abend'

  const fristenDringend = fristen.filter(f => f.status === 'ueberfaellig' || f.status === 'faellig')
  const aufgaben = fristenDringend.length + keller.messungFaellig + (checklistOffen ?? 0)

  // ── Nächste Schritte: aus Keller, Fristen, Terminen und Wartefristen ──────
  const schritte: Schritt[] = []
  for (const c of keller.chargen.filter(c => c.messungFaellig).slice(0, 3)) {
    schritte.push({
      key: `mess:${c.id}`, titel: `Gärkontrolle – ${c.name}`, hinweis: c.tageSeitMessung === null ? 'Noch keine Analyse erfasst' : `Letzte Messung vor ${c.tageSeitMessung} Tagen${c.behaelter ? ` · ${c.behaelter}` : ''}`,
      wann: 'heute', badge: 'FÄLLIG', tone: 'warn', href: `/kellerbuch/weinausbau/${c.id}`, rang: 1,
    })
  }
  for (const c of keller.chargen.filter(c => c.status === 'abfuellung').slice(0, 2)) {
    schritte.push({
      key: `fuell:${c.id}`, titel: `Abfüllung planen – ${c.name}`, hinweis: `${fmtNum(c.menge_liter)} L füllfertig${c.behaelter ? ` · ${c.behaelter}` : ''}`,
      wann: 'offen', badge: 'FÜLLFERTIG', tone: 'info', href: `/kellerbuch/weinausbau/${c.id}`, rang: 3,
    })
  }
  for (const f of fristenDringend.slice(0, 4)) {
    schritte.push({
      key: f.key, titel: f.bezeichnung, hinweis: f.hinweis, wann: f.faelligAm ? `bis ${fmtDate(f.faelligAm, { day: '2-digit', month: '2-digit' })}` : '–',
      badge: f.status === 'ueberfaellig' ? 'ÜBERFÄLLIG' : 'FÄLLIG', tone: f.status === 'ueberfaellig' ? 'err' : 'warn', href: f.href ?? '/dashboard/fristen', rang: f.status === 'ueberfaellig' ? 0 : 2,
    })
  }
  for (const w of weingarten.wartefristen.filter(w => tageBis(w.freiAb) <= 14).slice(0, 2)) {
    schritte.push({
      key: `wf:${w.id}`, titel: `Wartefrist endet – ${w.ried}`, hinweis: `Behandlung vom ${fmtDate(w.datum)} · Lese frei ab ${fmtDate(w.freiAb)}`,
      wann: fmtDate(w.freiAb, { day: '2-digit', month: '2-digit' }), badge: 'WARTEFRIST', tone: 'gray', href: '/behandlungen', rang: 4,
    })
  }
  for (const t of termine) {
    schritte.push({
      key: `t:${t.id}`, titel: t.betreff, hinweis: t.wer || 'Termin', wann: fmtDate(t.datum, { weekday: 'short', day: '2-digit', month: '2-digit' }),
      badge: 'TERMIN', tone: 'info', href: '/crm', rang: 5,
    })
  }
  schritte.sort((a, b) => a.rang - b.rang)

  return (
    <div className="space-y-6 2xl:space-y-4">
      <DashHeader einzeilig
        title={`${gruss}${vorname ? `, ${vorname}` : ''} 👋`}
        sub={<>Kellerbuch, Weingarten, Verkauf und Meldungen an einem Ort – alles, was heute ansteht, auf einen Blick. {ctx.tenantName && <span className="text-s112-tertiary">{ctx.tenantName} · </span>}<span className="text-s112-tertiary">Stand {fmtDate(ctx.heute, { weekday: 'long', day: '2-digit', month: 'long' })}</span></>}
      />

      {/* ── Kennzahlen ─────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">
        <Tile label="Kellerbestand" icon={Wine} href="/dashboard/kellerbuch"
          value={`${fmtNum(keller.gesamtLiter)} L`}
          sub={keller.jungweinLiter > 0 ? `davon ${fmtNum(keller.jungweinLiter)} L Jahrgang ${jahr}` : `${keller.behaelterBelegt} von ${keller.behaelterGesamt} Gebinden belegt`} />
        <Tile label="Flaschenlager" icon={Package} href="/weinhandel"
          value={`${fmtNum(flaschen.bestand)} Fl.`}
          sub={flaschen.abgefuelltWoche > 0 ? `+${fmtNum(flaschen.abgefuelltWoche)} abgefüllt diese Woche` : `${flaschen.nachRebsorte.length} Rebsorten am Lager`}
          tone={flaschen.abgefuelltWoche > 0 ? 'ok' : undefined} />
        <Tile label="Offene Posten" icon={ReceiptText} href="/weinhandel/offene-posten"
          value={fmtEur(offen.summe)}
          sub={offen.anzahl === 0 ? 'Keine offenen Posten' : offen.ueberfaellig > 0 ? `${offen.ueberfaellig} überfällig · ${fmtEur(offen.ueberfaelligSumme)}` : `${offen.anzahl} offen · Ø ${offen.avgTage} Tage`}
          tone={offen.ueberfaellig > 0 ? 'err' : undefined} />
        <Tile label="Offene Aufgaben" icon={ListChecks} href="/dashboard/fristen"
          value={fmtNum(aufgaben)}
          sub={fristenDringend.length > 0 ? `${fristenDringend.length} Meldefrist${fristenDringend.length === 1 ? '' : 'en'} < ${einst.vorwarnungTage} Tage` : keller.messungFaellig > 0 ? `${keller.messungFaellig} Gärkontrolle${keller.messungFaellig === 1 ? '' : 'n'} fällig` : 'Nichts Dringendes'}
          tone={fristenDringend.some(f => f.status === 'ueberfaellig') ? 'err' : fristenDringend.length > 0 || keller.messungFaellig > 0 ? 'warn' : undefined} />
      </div>

      {/* ── Finanzen (E&A / Doppik) ─────────────────────────────────────── */}
      {finanzen && (() => {
        const f = finanzen
        const d = f.ytd.ergebnisVj === 0 ? null : (f.ytd.ergebnis - f.ytd.ergebnisVj) / Math.abs(f.ytd.ergebnisVj) * 100
        const offenUebergabe = f.uebergabe ? f.uebergabe.rechnungenOffen + f.uebergabe.belegeOffen : 0
        return (
          <Link href="/buchhaltung/uebersicht" className="block bg-white border border-s112-line rounded-xl px-[18px] py-3.5 hover:border-s112-teal hover:shadow-sm transition-all">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-2">
                <TrendingUp size={16} strokeWidth={1.75} className="text-s112-blue-700" />
                <span className="font-display font-semibold text-[14.5px] text-s112-text">Finanzen {jahr}</span>
                <span className="text-[12px] text-s112-tertiary">bis heute · {einst.doppik ? 'Belege für den Steuerberater' : 'E&A-Rechnung'}</span>
              </div>
              <div className="flex items-center gap-6 flex-wrap text-[13px]">
                <span><span className="text-s112-text-2">Ergebnis </span><span className={`font-mono font-semibold ${f.ytd.ergebnis < 0 ? 'text-s112-err-fg' : ''}`}>{fmtEur(f.ytd.ergebnis)}</span>{d !== null && <span className={`ml-1 text-[12px] ${d < 0 ? 'text-s112-err-fg' : 'text-s112-ok-fg'}`}>{d >= 0 ? '+' : ''}{d.toFixed(0)} % VJ</span>}</span>
                <span><span className="text-s112-text-2">Liquidität </span><span className={`font-mono font-semibold ${f.liquiditaet.summe < 0 ? 'text-s112-err-fg' : ''}`}>{fmtEur(f.liquiditaet.summe)}</span></span>
                <span><span className="text-s112-text-2">Forderungen </span><span className="font-mono font-semibold">{fmtEur(f.forderungen.summe)}</span></span>
                {f.uebergabe
                  ? <Badge tone={offenUebergabe > 0 ? 'warn' : 'ok'}>{offenUebergabe > 0 ? `${offenUebergabe} Belege nicht übergeben` : 'alles übergeben'}</Badge>
                  : f.uva && <Badge tone={f.uva.status === 'uebermittelt' ? 'ok' : f.uva.faelligAm < ctx.heuteStr ? 'err' : 'warn'}>UVA {f.uva.label}: {f.uva.status === 'uebermittelt' ? 'übermittelt' : f.uva.status === 'entwurf' ? 'Entwurf' : 'offen'}</Badge>}
                <span className="text-[12px] text-s112-blue-700">Finanzübersicht →</span>
              </div>
            </div>
          </Link>
        )
      })()}

      {/* Auf großen Bildschirmen (2xl) wandert der Schnellzugriff als schmale
          Spalte nach rechts, damit die Übersicht ohne Scrollen auf den Bildschirm
          passt (Idee 18.9.2026); darunter bleibt die Zeile unter den Karten. */}
      <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_230px] gap-5 2xl:gap-4">
        {/* ── Nächste Schritte ───────────────────────────────────────────── */}
        <Card title="Nächste Schritte" right={<Link href="/dashboard/fristen" className="text-[11.5px] text-s112-blue-700 hover:underline">alle Fristen →</Link>}>
          {schritte.length === 0 ? (
            <Empty>Nichts Dringendes – keine fälligen Messungen, Fristen oder Termine.</Empty>
          ) : (
            <table className="w-full">
              <tbody>
                {schritte.slice(0, 8).map(s => (
                  <tr key={s.key} className="border-b border-s112-line last:border-0 hover:bg-[#F7F8FA]">
                    <td className="py-2.5 pr-2">
                      <Link href={s.href} className="block">
                        <span className="block text-[13.5px] font-semibold text-s112-text">{s.titel}</span>
                        <span className="block text-[12px] text-s112-text-2">{s.hinweis}</span>
                      </Link>
                    </td>
                    <td className="py-2.5 px-2 font-mono text-[12px] text-s112-text-2 whitespace-nowrap text-right">{s.wann}</td>
                    <td className="py-2.5 pl-2 text-right"><Badge tone={s.tone}>{s.badge}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        {/* ── Morgenbericht (ersetzt seit 10.9.2026 „Datenfluss statt Zettelwirtschaft“) ── */}
        <MorgenberichtKarte bericht={morgenbericht} darfSchreiben={canWrite(ctx.role)} wetterHinweis={!einst.wetterAktiv || !einst.modulWeingarten ? 'Wetter & Empfehlungen sind für diesen Betrieb deaktiviert (Mein Betrieb → Branding & Regeln).' : null} />

      {/* ── Schnellzugriff ─────────────────────────────────────────────────── */}
      <div className="lg:col-span-2 2xl:col-span-1">
        <h2 className="text-xs font-semibold text-s112-muted uppercase tracking-wider mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-1 gap-3">
          {[
            { href: '/weinhandel/verkauf/neu',    icon: ShoppingCart, label: 'Neuer Verkauf' },
            { href: '/crm',                        icon: Calendar,     label: 'Aktivität' },
            { href: '/weinhandel/offene-posten',   icon: Wallet,       label: 'Offene Posten' },
            { href: '/erntemeldung',               icon: Wine,         label: 'Lese / Pressung' },
            { href: '/behandlungen/neu',           icon: FlaskConical, label: 'Maßnahme erfassen' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="bg-white border border-s112-line rounded-xl p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-sm transition-all">
              <item.icon size={20} strokeWidth={1.75} className="text-s112-blue-700" />
              <span className="text-sm font-medium text-s112-text">{item.label}</span>
            </Link>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-s112-tertiary flex items-center gap-1"><Grape size={12} strokeWidth={1.5} /> Tipp: Strg K öffnet Seiten, Aktionen und die Suche von überall.</p>
      </div>
      </div>
    </div>
  )
}

