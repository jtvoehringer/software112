import { BookOpen, Leaf, Grape, Filter, ArrowLeftRight, Wind, FlaskConical, Microscope, Award, Wine, GitMerge, type LucideIcon } from 'lucide-react'
import type { EventTyp, TimelineEvent } from '@/lib/wein/weinbuch'

// Gemeinsame Timeline-Darstellung des Weinbuchs – verwendet sowohl von der
// Einzelchargen-Seite (buch/page.tsx) als auch von der Weinbuch-Sammlung
// (Auswertungen, BKI-Prüfung) für mehrere Chargen gesammelt.

function fmtDate(d: string | null | undefined) {
  if (!d) return '–'
  return new Date(d).toLocaleDateString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

const EVENT_STYLE: Record<EventTyp, { icon: LucideIcon; dot: string; card: string }> = {
  feldbehandlung: { icon: Leaf,           dot: 'bg-s112-ok',   card: 'border-s112-ok/30  bg-s112-ok-bg/40'  },
  ernte:          { icon: Grape,          dot: 'bg-s112-grey',  card: 'border-s112-line-str bg-[#F2F3F5]' },
  pressung:       { icon: Filter,         dot: 'bg-s112-warn',  card: 'border-s112-warn/30 bg-s112-warn-bg/40' },
  umzug:          { icon: ArrowLeftRight, dot: 'bg-s112-teal',    card: 'border-s112-blue-100   bg-s112-blue-50/40'   },
  schwund:        { icon: Wind,           dot: 'bg-s112-err',     card: 'border-s112-err/30    bg-s112-err-bg/40'    },
  kellerbehandlung:{ icon: FlaskConical,  dot: 'bg-s112-grey',    card: 'border-s112-line-str   bg-[#F2F3F5]'   },
  analyse:        { icon: Microscope,     dot: 'bg-s112-teal',  card: 'border-s112-blue-100 bg-s112-blue-50/40' },
  dac:            { icon: Award,          dot: 'bg-s112-warn',  card: 'border-s112-warn/30 bg-s112-warn-bg/40' },
  fuellung:       { icon: Wine,           dot: 'bg-s112-teal',   card: 'border-s112-teal/20 bg-s112-teal/5'},
  verschneidung:  { icon: GitMerge,       dot: 'bg-s112-grey',  card: 'border-s112-line-str bg-[#F2F3F5]' },
}

const EVENT_LABEL: Record<EventTyp, string> = {
  feldbehandlung: 'Feldbehandlung',
  ernte: 'Ernte / Lese',
  pressung: 'Pressung',
  umzug: 'Umzug',
  kellerbehandlung: 'Kellerbehandlung',
  analyse: 'Analyse',
  dac: 'DAC / Prüfnummer',
  verschneidung: 'Verschneidung',
  schwund: 'Schwund',
  fuellung: 'Füllung',
}

export function WeinbuchTimeline({ events, zeigeLegende = true }: { events: TimelineEvent[]; zeigeLegende?: boolean }) {
  return (
    <>
      {events.length === 0 ? (
        <div className="card p-8 text-center text-s112-muted">
          <BookOpen size={32} strokeWidth={1.5} className="mx-auto mb-3 text-s112-tertiary" />
          <p className="text-sm">Noch keine Ereignisse für diese Charge erfasst.</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-s112-border/60" />
          <div className="space-y-4">
            {events.map((ev, i) => {
              const style = EVENT_STYLE[ev.typ]
              return (
                <div key={i} className="relative flex gap-4">
                  <div className={`relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${style.dot} shadow-sm`}>
                    <style.icon size={18} strokeWidth={1.75} className="text-white" />
                  </div>
                  <div className={`flex-1 rounded-xl border p-4 ${style.card}`}>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <p className="font-semibold text-s112-text text-sm">{ev.titel}</p>
                        {ev.badge && (
                          <span className="inline-block text-xs font-medium text-s112-text-2 bg-white/70 border border-s112-line rounded-full px-2 py-0.5 mt-0.5">
                            {ev.badge}
                          </span>
                        )}
                      </div>
                      <span className="text-xs text-s112-text-2 tabular-nums shrink-0">
                        {fmtDate(ev.datum)}
                      </span>
                    </div>
                    {ev.details.length > 0 && (
                      <ul className="mt-1.5 space-y-0.5">
                        {ev.details.map((d, j) => (
                          <li key={j} className="text-xs text-s112-text-2">{d}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}

            <div className="relative flex gap-4 items-center">
              <div className="relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-s112-line text-s112-tertiary text-lg shadow-sm">
                ∎
              </div>
              <p className="text-xs text-s112-muted">Ende der Aufzeichnung</p>
            </div>
          </div>
        </div>
      )}

      {zeigeLegende && (
        <div className="card p-4">
          <p className="text-xs font-semibold text-s112-text-2 uppercase tracking-wider mb-2">Legende</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {(Object.entries(EVENT_STYLE) as [EventTyp, typeof EVENT_STYLE[EventTyp]][]).map(([typ, style]) => (
              <div key={typ} className="flex items-center gap-1.5">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${style.dot}`} />
                <span className="text-xs text-s112-text-2 inline-flex items-center gap-1">
                  <style.icon size={13} strokeWidth={1.75} className="text-s112-text-2" />
                  {EVENT_LABEL[typ]}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}
