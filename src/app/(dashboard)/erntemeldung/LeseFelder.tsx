'use client'

import { LESE_ARTEN, LESE_ART_LABEL, LESE_ZEITRAUM_FOLGEJAHR_BIS, type Lese } from '@/lib/wein/lesen'

const inputCls = 'w-full border border-s112-border rounded-lg px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-s112-teal/40'

/**
 * KAN-129: Felder einer Lese (Art, Bezeichnung, Beginn, Ende, Notizen) – „Neue Lese“ und „Lese bearbeiten“.
 * Beginn/Ende im Jahrgangsjahr oder im Folgejahr bis 31.03. (Eiswein); die Aktion prüft dasselbe (leseZeitraumFehler).
 */
export default function LeseFelder({ jahrgang, lese }: { jahrgang: number | null; lese?: Lese }) {
  const min = jahrgang != null ? `${jahrgang}-01-01` : undefined
  const max = jahrgang != null ? `${jahrgang + 1}-${LESE_ZEITRAUM_FOLGEJAHR_BIS}` : undefined
  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="lese-art" className="block text-sm font-medium text-s112-text-1 mb-1">Art</label>
          <select id="lese-art" name="art" defaultValue={lese?.art ?? 'hauptlese'} className={inputCls}>
            {LESE_ARTEN.map(a => <option key={a} value={a}>{LESE_ART_LABEL[a]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="lese-bezeichnung" className="block text-sm font-medium text-s112-text-1 mb-1">Bezeichnung</label>
          <input id="lese-bezeichnung" name="bezeichnung" maxLength={100} defaultValue={lese?.bezeichnung ?? ''}
            placeholder="optional, z. B. Grüner Veltliner" className={inputCls} />
        </div>
        <div>
          <label htmlFor="lese-beginn" className="block text-sm font-medium text-s112-text-1 mb-1">Beginn</label>
          <input id="lese-beginn" name="beginn" type="date" min={min} max={max} defaultValue={lese?.beginn ?? ''} className={inputCls} />
        </div>
        <div>
          <label htmlFor="lese-ende" className="block text-sm font-medium text-s112-text-1 mb-1">Ende</label>
          <input id="lese-ende" name="ende" type="date" min={min} max={max} defaultValue={lese?.ende ?? ''} className={inputCls} />
        </div>
      </div>
      {jahrgang != null && (
        <p className="text-xs text-s112-muted">
          Beginn und Ende im Jahr {jahrgang} oder im Folgejahr bis 31.03.{jahrgang + 1} (Eiswein); beide optional.
        </p>
      )}
      <div>
        <label htmlFor="lese-notizen" className="block text-sm font-medium text-s112-text-1 mb-1">Notizen</label>
        <textarea id="lese-notizen" name="notizen" rows={2} defaultValue={lese?.notizen ?? ''} className={inputCls} />
      </div>
    </>
  )
}
