'use client'

// Sweep 94 (KAN-289, 10.10.2026): Absende-Knopf, der sich während des Absendens selbst sperrt (useFormStatus) – gegen
// doppelte Buchungen durch Doppelklick (E&A-Buchung, Zahlung, Umbuchung, Eröffnungsbestand, Umzug …). Funktioniert in
// Formularen mit Server Action (action={…}), auch in Server Components. Test kan289-doppelklick prüft, dass jeder
// Absende-Knopf eines schreibenden Formulars gesperrt wird.
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useFormStatus } from 'react-dom'

type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  /** Beschriftung während des Absendens (Standard: unverändert) */
  wartend?: ReactNode
}

export default function SendenKnopf({ children, wartend, disabled, className, ...rest }: Props) {
  const { pending } = useFormStatus()
  return (
    <button type="submit" {...rest} disabled={pending || disabled} aria-busy={pending || undefined}
      className={`${className ?? ''} disabled:opacity-50 disabled:cursor-wait`.trim()}>
      {pending && wartend ? wartend : children}
    </button>
  )
}
