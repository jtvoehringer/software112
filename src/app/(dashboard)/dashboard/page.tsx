import type { Metadata } from 'next'
import { geladen } from '@/lib/supabase/geladen'
import { DashHeader, fmtDate } from './_shared/ui'
import { getCtx, ladeEinstellungen, type R } from './_shared/data'
import { ladeWidgetDaten } from './_shared/widgetDaten'
import { STANDARD_LAYOUT, sichtbareWidgets, benoetigteQuellen, abschnitte, layoutPruefen, editorEintraege, type WidgetAbschnitt, type WidgetId } from '@/lib/dashboard/widgets'
import { WIDGET_KOMPONENTEN, schnellaktionenFuer, type WidgetProps } from './_widgets'
import DashboardAnpassen from './_widgets/DashboardAnpassen'

export const metadata: Metadata = { title: 'Übersicht' }
export const dynamic = 'force-dynamic'

// ── Sicht "Übersicht" (Dashboard-Relaunch 27.8.2026) ─────────────────────────
// Bereichsübergreifende Startseite nach dem Dashboard-PoC: vier Kennzahlen
// (Keller, Flaschenlager, Offene Posten, Aufgaben), "Nächste Schritte" über
// alle Module und die Karte "Morgenbericht" (täglicher Scan + Wetter je Ried). Die Verkaufs-Kennzahlen des
// bisherigen Dashboards leben unverändert in der Sicht "Verkauf & CRM".
// Seit KAN-387 (31.10.2026) aus Widgets gebaut: Register lib/dashboard/widgets.ts, Darstellung in _widgets/,
// geladen werden nur die Daten der sichtbaren Widgets. Seit KAN-388 je Benutzer anpassbar (Tabelle benutzer_dashboard,
// über alle Betriebe; ohne Zeile gilt STANDARD_LAYOUT).

export default async function UebersichtPage() {
  const ctx = await getCtx()
  const [einst, profilRes, layoutRes] = await Promise.all([
    ladeEinstellungen(ctx),
    ctx.userId ? ctx.q('profiles').select('full_name').eq('id', ctx.userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    // tenant-isolation-ignore: benutzer_dashboard hat keine tenant_id, gilt je Benutzer über alle Betriebe (RLS: eigene Zeile)
    ctx.userId ? ctx.q('benutzer_dashboard').select('layout').eq('user_id', ctx.userId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ])
  const profil = geladen(profilRes, 'Benutzer')
  // Fehler beim Lesen der eigenen Anordnung: Standard zeigen und darauf hinweisen, statt die ganze Übersicht abzubrechen
  const layoutFehler = layoutRes.error ? 'Deine eigene Anordnung konnte nicht geladen werden – die Übersicht zeigt den Standard.' : null
  const eigenesLayout = layoutRes.error ? null : layoutPruefen((layoutRes.data as R | null)?.layout)

  const vorname = ((profil as R | null)?.full_name ?? '').split(/\s+/)[0] || null
  const stunde = ctx.heute.getHours()
  const gruss = stunde < 11 ? 'Guten Morgen' : stunde < 17 ? 'Guten Tag' : 'Guten Abend'

  const mitSchnellaktionen = schnellaktionenFuer(ctx).length > 0
  const kontext = { modulEa: einst.modulEa, schnellaktionen: mitSchnellaktionen }
  const widgets = sichtbareWidgets(eigenesLayout ?? STANDARD_LAYOUT, kontext)
  const d = await ladeWidgetDaten(ctx, einst, benoetigteQuellen(widgets))
  const props: WidgetProps = { ctx, einst, d, mitSchnellaktionen }

  return (
    <div className="space-y-6 2xl:space-y-4">
      <DashHeader einzeilig
        right={<DashboardAnpassen eintraege={editorEintraege(eigenesLayout, kontext)} eigenes={eigenesLayout !== null} />}
        title={`${gruss}${vorname ? `, ${vorname}` : ''} 👋`}
        sub={<><span className="max-sm:hidden">Kellerbuch, Weingarten, Verkauf und Meldungen an einem Ort – alles, was heute ansteht, auf einen Blick. </span>{ctx.tenantName && <span className="text-s112-tertiary">{ctx.tenantName} · </span>}<span className="text-s112-tertiary">Stand {fmtDate(ctx.heute, { weekday: 'long', day: '2-digit', month: 'long' })}</span></>}
      />
      {layoutFehler && <p role="status" className="text-[12.5px] text-s112-warn-fg bg-s112-warn-bg rounded-lg px-3 py-2">{layoutFehler}</p>}
      {widgets.length === 0 && <p className="text-[13px] text-s112-text-2">Alle Widgets sind ausgeblendet – über „Dashboard anpassen“ wieder einblenden.</p>}
      {abschnitte(widgets).map(a => <Abschnitt key={a.widgets[0].def.id} abschnitt={a} props={props} />)}
    </div>
  )
}

// ── Ein Abschnitt: Kacheln (2 bzw. 4 je Zeile) oder Karten (1 bzw. 2 je Zeile, „breit“ über beide) ──
function Abschnitt({ abschnitt, props }: { abschnitt: WidgetAbschnitt; props: WidgetProps }) {
  const raster = abschnitt.art === 'kacheln' ? 'grid grid-cols-2 lg:grid-cols-4 gap-3.5' : 'grid grid-cols-1 lg:grid-cols-2 gap-5 2xl:gap-4'
  return (
    <div className={`${abschnitt.nurHandy ? 'sm:hidden ' : ''}${raster}`}>
      {abschnitt.widgets.map(w => {
        const Komponente = WIDGET_KOMPONENTEN[w.def.id as WidgetId]
        // *:h-full: Karten einer Zeile bleiben gleich hoch wie bisher im gemeinsamen Raster
        return (
          <div key={w.def.id} className={`min-w-0 *:h-full ${w.groesse === 'breit' ? 'col-span-full' : ''}`}>
            <Komponente {...props} />
          </div>
        )
      })}
    </div>
  )
}
