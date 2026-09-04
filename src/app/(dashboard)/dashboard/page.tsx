import type { Metadata } from 'next'
import Link from 'next/link'
import { Wine, Package, ReceiptText, ListChecks, ShoppingCart, Calendar, Wallet, FlaskConical, Grape } from 'lucide-react'
import { DashHeader, Tile, Card, Badge, Note, Empty, fmtEur, fmtNum, fmtDate, tageBis, type BadgeTone } from './_shared/ui'
import { getCtx, ladeKeller, ladeFlaschenlager, ladeOffenePosten, ladeFristen, ladeEinstellungen, ladeNaechsteTermine, ladeWeingarten, type R } from './_shared/data'

export const metadata: Metadata = { title: 'Übersicht – software:112' }
export const dynamic = 'force-dynamic'

// ── Sicht "Übersicht" (Dashboard-Relaunch 27.8.2026) ─────────────────────────
// Bereichsübergreifende Startseite nach dem Dashboard-PoC: vier Kennzahlen
// (Keller, Flaschenlager, Offene Posten, Aufgaben), "Nächste Schritte" über
// alle Module und die Karte "Datenfluss". Die Verkaufs-Kennzahlen des
// bisherigen Dashboards leben unverändert in der Sicht "Verkauf & CRM".

type Schritt = { key: string; titel: string; hinweis: string; wann: string; badge: string; tone: BadgeTone; href: string; rang: number }

export default async function UebersichtPage() {
  const ctx = await getCtx()
  const einst = await ladeEinstellungen(ctx)
  const jahr = ctx.heute.getFullYear()

  const [keller, flaschen, offen, fristen, termine, weingarten, { data: profil }, { count: checklistOffen }, { count: belegeErkannt }] = await Promise.all([
    ladeKeller(ctx, einst.messintervallTage),
    ladeFlaschenlager(ctx),
    ladeOffenePosten(ctx),
    ladeFristen(ctx, { modulEa: einst.modulEa, uvaZeitraum: einst.uvaZeitraum, vorwarnungTage: einst.vorwarnungTage, betriebsbeginn: einst.betriebsbeginn, doppik: einst.doppik }),
    ladeNaechsteTermine(ctx, 3),
    ladeWeingarten(ctx),
    ctx.userId ? ctx.q('profiles').select('full_name').eq('id', ctx.userId).maybeSingle() : Promise.resolve({ data: null }),
    ctx.tf(ctx.q('checklisten_punkte').select('id, checkliste:checkliste_id!inner(jahr, typ)', { count: 'exact', head: true }).eq('erledigt', false).eq('checkliste.jahr', jahr)),
    einst.modulEa ? ctx.tf(ctx.q('ea_belege').select('id', { count: 'exact', head: true }).eq('status', 'erkannt')) : Promise.resolve({ count: 0 }),
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
    <div className="space-y-6">
      <DashHeader
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Nächste Schritte ───────────────────────────────────────────── */}
        <Card title="Nächste Schritte" right={<Link href="/dashboard/fristen" className="text-[11.5px] text-s112-blue-700 hover:underline">alle Fristen →</Link>}>
          {schritte.length === 0 ? (
            <Empty>Nichts Dringendes – keine fälligen Messungen, Fristen oder Termine.</Empty>
          ) : (
            <table className="w-full">
              <tbody>
                {schritte.slice(0, 8).map(s => (
                  <tr key={s.key} className="border-b border-s112-line last:border-0 hover:bg-[#F8FAFC]">
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

        {/* ── Datenfluss ─────────────────────────────────────────────────── */}
        <Card title="Datenfluss statt Zettelwirtschaft">
          <p className="text-[13px] text-s112-text-2 mb-3">Stammdaten und Meldungen fließen strukturiert – Stand der Anbindungen dieses Betriebs.</p>
          <div className="grid grid-cols-[minmax(150px,40%)_1fr] text-[13px]">
            <Zeile k="Rieden & Grundstücke">
              <Link href="/weingarten" className="hover:underline">{fmtNum(weingarten.rieden.length)} Rieden · {fmtNum(weingarten.grundstueckeCount)} Grundstücke · {fmtNum(weingarten.flaecheHa, 2)} ha</Link>
              {weingarten.rieden.some(r => r.amaFs.length > 0) ? <Badge tone="ok">AMA-FS hinterlegt</Badge> : <Badge tone="gray">AMA-FS offen</Badge>}
            </Zeile>
            <Zeile k="E-Mail & CRM">{einst.m365Aktiv ? <Badge tone="ok">Microsoft 365 aktiv</Badge> : <Badge tone="gray">M365 nicht verbunden</Badge>}</Zeile>
            <Zeile k="Belege Buchhaltung">
              {einst.modulEa
                ? (belegeErkannt ?? 0) > 0 ? <Link href="/buchhaltung/belege"><Badge tone="warn">OCR · {belegeErkannt} zu buchen</Badge></Link> : <Badge tone="ok">OCR · nichts offen</Badge>
                : <Badge tone="gray">E&A-Modul inaktiv</Badge>}
            </Zeile>
            <Zeile k="Erntemeldung / bawb.at">{einst.bawbKennung ? <Badge tone="ok">✓ Kennung hinterlegt</Badge> : <Link href="/betrieb/einstellungen"><Badge tone="gray">Kennung fehlt</Badge></Link>}</Zeile>
            <Zeile k="Weinbuch / Kellerbuch"><Link href="/reports/weinbuecher-sammlung"><Badge tone="info">→ PDF-Export jederzeit</Badge></Link></Zeile>
          </div>
          <Note className="mt-3">Die Kennzahlen dieser Seite entstehen aus den Modulen des Betriebs – nichts wird doppelt erfasst. Fristen und Regeln sind Betriebs-Stammdaten, keine Rechtsberatung.</Note>
        </Card>
      </div>

      {/* ── Schnellzugriff ─────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-semibold text-s112-muted uppercase tracking-wider mb-3">Schnellzugriff</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {[
            { href: '/weinhandel/verkauf/neu',    icon: ShoppingCart, label: 'Neuer Verkauf' },
            { href: '/crm',                        icon: Calendar,     label: 'Aktivität' },
            { href: '/weinhandel/offene-posten',   icon: Wallet,       label: 'Offene Posten' },
            { href: '/erntemeldung',               icon: Wine,         label: 'Lese / Pressung' },
            { href: '/behandlungen/neu',           icon: FlaskConical, label: 'Maßnahme erfassen' },
          ].map(item => (
            <Link key={item.href} href={item.href}
              className="bg-white border border-s112-line rounded-xl p-4 flex items-center gap-3 hover:border-s112-teal hover:shadow-sm transition-all">
              <item.icon size={20} strokeWidth={1.75} className="text-s112-teal" />
              <span className="text-sm font-medium text-s112-text">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
      <p className="text-[11px] text-s112-tertiary flex items-center gap-1"><Grape size={12} strokeWidth={1.5} /> Tipp: Strg K öffnet Seiten, Aktionen und die Suche von überall.</p>
    </div>
  )
}

function Zeile({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <div className="py-2 border-b border-s112-line text-s112-text-2">{k}</div>
      <div className="py-2 border-b border-s112-line flex items-center gap-2 flex-wrap font-medium">{children}</div>
    </>
  )
}
