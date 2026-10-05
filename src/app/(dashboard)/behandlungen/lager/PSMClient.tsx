'use client'

import { useState, useTransition } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { upsertPSM, deactivatePSM } from './actions'
import type { PSMEintrag } from './page'
import { fehlerText } from '@/lib/fehler'
import { LagerJahrKopf, LagerJahrZellen, LagerJahrHinweis } from './LagerJahrSpalten'
import { REGISTERNUMMER_FEHLT } from '@/lib/behandlungen/psmStamm'

const KATEGORIE_OPTS = [
  { value: 'fungizid',         label: 'Fungizid' },
  { value: 'insektizid',       label: 'Insektizid' },
  { value: 'herbizid',         label: 'Herbizid' },
  { value: 'akarizid',         label: 'Akarizid' },
  { value: 'wachstumsregler',  label: 'Wachstumsregler' },
  { value: 'naehrstoff',       label: 'Nährstoff / Dünger' },
  { value: 'sonstiges',        label: 'Sonstiges' },
]

const KAT_COLOR: Record<string, string> = {
  fungizid:        'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str',
  insektizid:      'bg-s112-warn-bg text-s112-warn-fg border-s112-warn/30',
  herbizid:        'bg-s112-err-bg text-s112-err-fg border-s112-err/30',
  akarizid:        'bg-[#F2F3F5] text-s112-text-1 border-s112-line-str',
  wachstumsregler: 'bg-s112-blue-50 text-s112-blue-700 border-s112-blue-100',
  naehrstoff:      'bg-s112-ok-bg text-s112-ok-fg border-s112-ok/30',
  sonstiges:       'bg-s112-bg text-s112-text-2 border-s112-line',
}

function PSMForm({ psm, onDone }: { psm?: PSMEintrag; onDone: () => void }) {
  const [pending, startTransition] = useTransition()
  const [fehler, setFehler] = useState<string | null>(null)
  // Bug (gemeldet): beim Ändern eines anderen Felds "verlor" das Formular das
  // Häkchen bei "Bio/Öko zugelassen", auch ohne es angefasst zu haben. Ursache:
  // das hidden+checkbox-Paar (Standard-Trick, damit eine NICHT angehakte Box
  // trotzdem "false" mitsendet) wurde nur per onChange synchronisiert - beim
  // Bearbeiten eines bereits angehakten Mittels war die Checkbox zwar dank
  // defaultChecked von Anfang an sichtbar angehakt, das disabled am hidden-
  // Zwilling blieb aber unverändert (false). Ohne Klick auf die Checkbox
  // feuerte onChange nie, also gingen BEIDE Felder namens oeko_zugelassen ins
  // FormData - "false" (hidden, zuerst im DOM) UND "true" (Checkbox, danach).
  // FormData.get() liefert den ERSTEN Treffer, also "false" - die Aktion hat
  // das Häkchen beim Speichern jedes anderen Feldes stillschweigend gelöscht.
  // Fix: kontrollierte Checkbox + disabled am hidden-Zwilling direkt aus
  // demselben State ableiten, statt es nur reaktiv per onChange nachzuziehen.
  const [oekoZugelassen, setOekoZugelassen] = useState(psm?.oeko_zugelassen ?? false)
  // KAN-86: dasselbe kontrollierte hidden+checkbox-Paar wie oben
  const [bienengefaehrlich, setBienengefaehrlich] = useState(psm?.bienengefaehrlich ?? false)

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      try { await upsertPSM(fd); setFehler(null); onDone() }
      catch (e) { setFehler(fehlerText(e)) }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="bg-s112-bg border border-s112-border rounded-xl p-4 space-y-3">
      {fehler && <div className="p-2.5 bg-s112-err-bg border border-s112-err/30 rounded-lg text-sm text-s112-err-fg">{fehler}</div>}
      <h3 className="text-sm font-semibold text-s112-text">
        {psm ? 'Mittel bearbeiten' : 'Neues Mittel anlegen'}
      </h3>
      {psm && <input type="hidden" name="existing_id" value={psm.id} />}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Name *</label>
          <input aria-label="Name" name="name" required defaultValue={psm?.name ?? ''}
            placeholder="z.B. Cuprozin progress"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Handelsname</label>
          <input aria-label="Handelsname" name="handelsname" defaultValue={psm?.handelsname ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Kategorie</label>
          <select aria-label="Kategorie" name="kategorie" defaultValue={psm?.kategorie ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40">
            <option value="">– keine –</option>
            {KATEGORIE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Wirkstoff</label>
          <input aria-label="Wirkstoff" name="wirkstoff" defaultValue={psm?.wirkstoff ?? ''}
            placeholder="z.B. Kupferhydroxid"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Wirkstoffgehalt (%)</label>
          <input aria-label="Wirkstoffgehalt (%)" name="wirkstoffgehalt_pct" type="number" step="0.01" min="0" max="100"
            defaultValue={psm?.wirkstoffgehalt_pct ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Cu-Gehalt (%)</label>
          <input aria-label="Cu-Gehalt (%)" name="cu_gehalt_pct" type="number" step="0.01" min="0" max="100"
            defaultValue={psm?.cu_gehalt_pct ?? ''}
            placeholder="nur bei Kupfermitteln"
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Max. Aufwand (kg/ha)</label>
          <input aria-label="Max. Aufwand (kg/ha)" name="max_aufwand_kg_ha" type="number" step="0.001" min="0"
            defaultValue={psm?.max_aufwand_kg_ha ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Max. Anwendungen</label>
          <input aria-label="Max. Anwendungen" name="max_anwendungen" type="number" min="0"
            defaultValue={psm?.max_anwendungen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>

        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Wartezeit (Tage)</label>
          <input aria-label="Wartezeit (Tage)" name="wartezeit_tage" type="number" min="0"
            defaultValue={psm?.wartezeit_tage ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div className="flex items-end pb-1.5">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="hidden" name="oeko_zugelassen" value="false" disabled={oekoZugelassen} />
            <input type="checkbox" name="oeko_zugelassen" value="true"
              checked={oekoZugelassen}
              onChange={e => setOekoZugelassen(e.currentTarget.checked)}
              className="accent-s112-teal w-4 h-4" />
            <span className="text-sm text-s112-text-1">Bio/Öko zugelassen</span>
          </label>
        </div>

        {/* KAN-86: Pflichtangaben der Pflanzenschutz-Aufzeichnung – jeder Betrieb pflegt sie von Hand */}
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Registernummer (Zulassungsnr.)</label>
          <input aria-label="Registernummer (Zulassungsnr.)" name="zulassungsnr" defaultValue={psm?.zulassungsnr ?? ''}
            placeholder="z.B. 3456-0 (PSM-Register)" maxLength={30}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div>
          <label className="block text-xs font-medium text-s112-text-2 mb-1">EPPO-Code Hauptschaderreger</label>
          <input aria-label="EPPO-Code Hauptschaderreger" name="eppo_code" defaultValue={psm?.eppo_code ?? ''}
            placeholder="z.B. PLASVI (Peronospora), UNCINE (Oidium)" maxLength={6}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm uppercase focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
        <div className="col-span-2 flex items-center pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="hidden" name="bienengefaehrlich" value="false" disabled={bienengefaehrlich} />
            <input type="checkbox" name="bienengefaehrlich" value="true"
              checked={bienengefaehrlich}
              onChange={e => setBienengefaehrlich(e.currentTarget.checked)}
              className="accent-s112-teal w-4 h-4" />
            <span className="text-sm text-s112-text-1">Bienengefährlich (laut Zulassung)</span>
          </label>
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-s112-text-2 mb-1">Notizen</label>
          <input aria-label="Notizen" name="notizen" defaultValue={psm?.notizen ?? ''}
            className="w-full border border-s112-border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-s112-teal/40" />
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={pending}
          className="bg-s112-teal text-s112-yellow px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-opacity-90 disabled:opacity-50">
          {pending ? 'Speichert…' : 'Speichern'}
        </button>
        <button type="button" onClick={onDone}
          className="px-4 py-1.5 rounded-lg text-sm font-medium text-s112-text-2 hover:text-s112-text">
          Abbrechen
        </button>
      </div>
    </form>
  )
}

export default function PSMClient({
  psm, jahr, writeOk, adminOk,
}: {
  psm: PSMEintrag[]; jahr: number; writeOk: boolean; adminOk: boolean
}) {
  const [showForm, setShowForm] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleDeactivate(id: string) {
    if (!confirm('Mittel deaktivieren? Es bleibt in bestehenden Maßnahmen erhalten.')) return
    startTransition(() => deactivatePSM(id))
  }

  return (
    <div className={pending ? 'opacity-60 pointer-events-none' : ''}>
      {/* Formular */}
      {showForm && !editId && (
        <div className="mb-6">
          <PSMForm onDone={() => setShowForm(false)} />
        </div>
      )}

      {!showForm && writeOk && (
        <div className="mb-6">
          <button onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-2 bg-s112-teal text-s112-yellow px-4 py-2 rounded-xl text-sm font-semibold hover:bg-opacity-90 transition-colors">
            Neues Mittel anlegen
          </button>
        </div>
      )}

      {/* Tabelle */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-s112-border">
                <th className="text-left text-xs text-s112-muted font-semibold py-2 pr-3">Name</th>
                {/* KAN-173: Detailspalten je nach Breite ausblenden, damit die Lagerspalten ohne seitliches Scrollen passen */}
                <th className="hidden lg:table-cell text-left text-xs text-s112-muted font-semibold py-2 pr-3">Kategorie</th>
                <th className="hidden md:table-cell text-left text-xs text-s112-muted font-semibold py-2 pr-3">Reg.-Nr.</th>
                <th className="hidden xl:table-cell text-left text-xs text-s112-muted font-semibold py-2 pr-3">Wirkstoff</th>
                <th className="hidden md:table-cell text-right text-xs text-s112-muted font-semibold py-2 pr-3">Cu-%</th>
                <th className="hidden xl:table-cell text-right text-xs text-s112-muted font-semibold py-2 pr-3">Max. kg/ha</th>
                <th className="hidden xl:table-cell text-right text-xs text-s112-muted font-semibold py-2 pr-3">Wartezeit</th>
                <th className="hidden sm:table-cell text-center text-xs text-s112-muted font-semibold py-2 pr-3">Bio</th>
                <LagerJahrKopf jahr={jahr} />
                {(writeOk || adminOk) && (
                  <th className="py-2 px-3 sticky right-0 bg-white border-l border-s112-border" />
                )}
              </tr>
            </thead>
            <tbody>
              {psm.map(p => (
                <>
                  <tr key={p.id} className="group border-b border-s112-border/40 hover:bg-s112-bg/30">
                    <td className="py-2.5 pr-3 font-medium text-s112-text">
                      {p.name}
                      {p.handelsname && p.handelsname !== p.name && (
                        <span className="ml-1 text-xs text-s112-muted">({p.handelsname})</span>
                      )}
                    </td>
                    <td className="hidden lg:table-cell py-2.5 pr-3">
                      {p.kategorie ? (
                        <span className={`text-xs px-2 py-0.5 rounded-full border ${KAT_COLOR[p.kategorie] ?? 'bg-s112-bg text-s112-text-2 border-s112-line'}`}>
                          {KATEGORIE_OPTS.find(o => o.value === p.kategorie)?.label ?? p.kategorie}
                        </span>
                      ) : '–'}
                    </td>
                    {/* KAN-86: Registernummer ist Pflichtangabe der Aufzeichnung – fehlt sie, Hinweis statt Strich */}
                    <td className="hidden md:table-cell py-2.5 pr-3 text-xs tabular-nums">
                      {p.zulassungsnr
                        ? <span className="text-s112-text-1">{p.zulassungsnr}</span>
                        : <span className="text-s112-warn-fg font-medium" title={REGISTERNUMMER_FEHLT}>fehlt</span>}
                      {p.eppo_code && <span className="ml-1 text-s112-muted">· {p.eppo_code}</span>}
                      {p.bienengefaehrlich && <span className="ml-1 text-s112-warn-fg" title="Bienengefährlich">· B</span>}
                    </td>
                    <td className="hidden xl:table-cell py-2.5 pr-3 text-s112-muted text-xs">{p.wirkstoff ?? '–'}</td>
                    <td className="hidden md:table-cell py-2.5 pr-3 text-right tabular-nums text-xs">
                      {p.cu_gehalt_pct ? (
                        <span className="text-s112-blue-700 font-medium">{p.cu_gehalt_pct} %</span>
                      ) : '–'}
                    </td>
                    <td className="hidden xl:table-cell py-2.5 pr-3 text-right tabular-nums text-xs text-s112-muted">
                      {p.max_aufwand_kg_ha ? `${p.max_aufwand_kg_ha} kg/ha` : '–'}
                    </td>
                    <td className="hidden xl:table-cell py-2.5 pr-3 text-right tabular-nums text-xs text-s112-muted">
                      {p.wartezeit_tage ? `${p.wartezeit_tage} T` : '–'}
                    </td>
                    <td className="hidden sm:table-cell py-2.5 pr-3 text-center">
                      {p.oeko_zugelassen
                        ? <span className="text-s112-ok-fg">Ja</span>
                        : <span className="text-s112-tertiary">–</span>}
                    </td>
                    <LagerJahrZellen lager={p.lager} />
                    {(writeOk || adminOk) && (
                      <td className="py-2.5 px-3 text-right sticky right-0 bg-white border-l border-s112-border/40">
                        <div className="flex items-center justify-end gap-2">
                          {writeOk && (
                            <button onClick={() => setEditId(editId === p.id ? null : p.id)}
                              title="Bearbeiten" aria-label="Bearbeiten"
                              className="text-s112-blue-700 hover:text-s112-blue-700/70"><Pencil className="w-4 h-4" /></button>
                          )}
                          {adminOk && (
                            <button onClick={() => handleDeactivate(p.id)}
                              title="Deaktivieren" aria-label="Deaktivieren"
                              className="text-s112-err hover:text-s112-err-fg"><Trash2 className="w-4 h-4" /></button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                  {editId === p.id && (
                    <tr key={`edit-${p.id}`}>
                      <td colSpan={12} className="px-0 py-2">
                        <PSMForm psm={p} onDone={() => setEditId(null)} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
          {psm.length > 0 && <LagerJahrHinweis jahr={jahr} />}
          {psm.length === 0 && (
            <p className="text-center py-12 text-s112-muted text-sm">
              Noch keine Pflanzenschutzmittel angelegt.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
