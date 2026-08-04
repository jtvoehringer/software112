'use client'

import { useState } from 'react'
import { createCustomWeinbaugebiet, type CustomWeinbaugebiet } from '@/app/(dashboard)/weinbaugebiete/actions'

type Option = { value: string; label: string }

// Herkunft-Code(BKI)-Auswahl mit Inline-"+ Neues Weinbaugebiet hinzufügen".
// `builtinOptions` sind die fix hinterlegten, ranggeprüften Stufen aus
// lib/herkunft.ts (bereits vom Aufrufer auf mögliche Abstufungen gefiltert).
// `customOptions` sind die eigenen, vom Mandanten selbst angelegten
// Weinbaugebiete – diese liegen bewusst außerhalb der Abstufungs-Rangfolge
// und werden nie gefiltert (siehe Migration 140 / lib/herkunft.ts-Kommentare).
//
// Selbstverwaltet den eigenen Wert (defaultValue als Startwert, optional
// onChange für den Aufrufer) und rendert ein verstecktes Feld für die
// tatsächliche Formular-Übermittlung, damit auch während der "+ Neu"-Eingabe
// der zuletzt gewählte Wert erhalten bleibt.
export default function HerkunftCodeSelect({
  name,
  value: controlledValue,
  defaultValue = '',
  onChange,
  builtinOptions,
  customOptions,
  onNeuAngelegt,
  emptyLabel = '– keine Angabe –',
  disabled,
  className,
}: {
  name: string
  /** Kontrollierter Modus (z.B. wenn der Aufrufer den Wert für andere Berechnungen
   *  braucht, siehe FuellungFormClient) – hat Vorrang vor defaultValue. */
  value?: string
  /** Unkontrollierter Modus (Startwert, Komponente verwaltet sich selbst) –
   *  praktisch für Server-Component-Formulare ohne eigenen React-State. */
  defaultValue?: string
  onChange?: (val: string) => void
  builtinOptions: Option[]
  customOptions: CustomWeinbaugebiet[]
  /** Optional: informiert den Aufrufer über ein neu angelegtes Weinbaugebiet,
   *  damit übergeordnete Komponenten mit mehreren Formular-Instanzen (z.B. das
   *  Grundstücke-Panel) ihre gemeinsame Liste aktualisieren können. */
  onNeuAngelegt?: (w: CustomWeinbaugebiet) => void
  emptyLabel?: string
  disabled?: boolean
  className: string
}) {
  const isControlled = controlledValue !== undefined
  const [innerValue, setInnerValue] = useState(defaultValue)
  const value = isControlled ? (controlledValue as string) : innerValue

  const [eigene, setEigene]       = useState(customOptions)
  const [neuModus, setNeuModus]   = useState(false)
  const [neuName, setNeuName]     = useState('')
  const [speichert, setSpeichert] = useState(false)
  const [fehler, setFehler]       = useState<string | null>(null)

  function setzeWert(v: string) {
    if (!isControlled) setInnerValue(v)
    onChange?.(v)
  }

  async function speichern() {
    const trimmed = neuName.trim()
    if (!trimmed) return
    setSpeichert(true)
    setFehler(null)
    try {
      const neu = await createCustomWeinbaugebiet(trimmed)
      if (neu) {
        setEigene(prev =>
          prev.some(w => w.id === neu.id) ? prev : [...prev, neu].sort((a, b) => a.name.localeCompare(b.name, 'de-AT'))
        )
        setzeWert(neu.name)
        setNeuModus(false)
        setNeuName('')
        onNeuAngelegt?.(neu)
      }
    } catch (e) {
      setFehler(e instanceof Error ? e.message : 'Fehler beim Speichern')
    } finally {
      setSpeichert(false)
    }
  }

  return (
    <div>
      <input type="hidden" name={name} value={value} />

      {neuModus ? (
        <div className="flex gap-1.5">
          <input
            autoFocus
            value={neuName}
            onChange={e => setNeuName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { e.preventDefault(); speichern() }
              if (e.key === 'Escape') { setNeuModus(false); setNeuName(''); setFehler(null) }
            }}
            placeholder="Name des Weinbaugebiets, z.B. Wachau DAC"
            className={className + ' flex-1'}
          />
          <button
            type="button"
            onClick={speichern}
            disabled={speichert || !neuName.trim()}
            className="shrink-0 px-3 py-2 rounded-lg text-xs font-semibold bg-s112-teal text-white hover:bg-opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {speichert ? '…' : 'Speichern'}
          </button>
          <button
            type="button"
            onClick={() => { setNeuModus(false); setNeuName(''); setFehler(null) }}
            className="shrink-0 px-2 py-2 rounded-lg text-xs text-s112-muted hover:text-gray-700 transition-colors"
          >
            Abbrechen
          </button>
        </div>
      ) : (
        <select
          value={value}
          onChange={e => {
            if (e.target.value === '__neu__') { setNeuModus(true); return }
            setzeWert(e.target.value)
          }}
          disabled={disabled}
          className={className}
        >
          <option value="">{emptyLabel}</option>
          {builtinOptions.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
          {eigene.length > 0 && (
            <optgroup label="Eigene Weinbaugebiete">
              {eigene.map(w => (
                <option key={w.id} value={w.name}>{w.name}</option>
              ))}
            </optgroup>
          )}
          <option value="__neu__">+ Neues Weinbaugebiet hinzufügen…</option>
        </select>
      )}

      {fehler && <p className="text-xs text-red-500 mt-1">{fehler}</p>}
    </div>
  )
}
