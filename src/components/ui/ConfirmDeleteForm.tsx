'use client'
import SendenKnopf from '@/components/ui/SendenKnopf'
import { frageAufteilen, rueckfrage } from '@/lib/ui/rueckfrage'

interface Props {
  action:    () => Promise<void> | void
  /** Rückfrage: Frage bis zum ersten „?“ = Titel, der Rest = Erklärung */
  message:   string
  label?:    React.ReactNode
  title?:    string
  /** Beschriftung des Bestätigungsknopfs im Dialog (Standard: title, sonst „Bestätigen“) */
  bestaetigen?: string
  /** Löschen/Sperren/Unumkehrbares: roter Knopf, Fokus auf „Abbrechen“ (Standard: true) */
  gefaehrlich?: boolean
  className?: string
  style?:    React.CSSProperties
}

// Kleiner Client Component für "Bestätigen dann Server Action" Muster.
// Server Actions dürfen als Props an Client Components übergeben werden (Next.js unterstützt das).
// KAN-359 (22.10.2026): Rückfrage über den eigenen Dialog (rueckfrage) statt window.confirm – der Klick wird abgefangen,
// nach „ja“ sendet der Knopf das Formular selbst ab (requestSubmit mit demselben Knopf, die Server Action bleibt gleich).
export default function ConfirmDeleteForm({ action, message, label = '×', title, bestaetigen, gefaehrlich = true, className, style }: Props) {
  return (
    <form action={action} style={style ?? { display: 'inline' }}>
      <SendenKnopf
        title={title}
        aria-label={title}
        className={className}
        onClick={async e => {
          e.preventDefault()
          const knopf = e.currentTarget
          const { titel, text } = frageAufteilen(message)
          if (!(await rueckfrage({ titel, text, bestaetigen: bestaetigen ?? title ?? 'Bestätigen', gefaehrlich }))) return
          knopf.form?.requestSubmit(knopf)
        }}
      >
        {label}
      </SendenKnopf>
    </form>
  )
}
