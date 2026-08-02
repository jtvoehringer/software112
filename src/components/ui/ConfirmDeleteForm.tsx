'use client'

interface Props {
  action:    () => Promise<void> | void
  message:   string
  label?:    React.ReactNode
  title?:    string
  className?: string
  style?:    React.CSSProperties
}

// Kleiner Client Component für "Bestätigen dann Server Action" Muster.
// Server Actions dürfen als Props an Client Components übergeben werden (Next.js unterstützt das).
export default function ConfirmDeleteForm({ action, message, label = '×', title, className, style }: Props) {
  return (
    <form action={action} style={style ?? { display: 'inline' }}>
      <button
        type="submit"
        title={title}
        aria-label={title}
        className={className}
        onClick={e => { if (!confirm(message)) e.preventDefault() }}
      >
        {label}
      </button>
    </form>
  )
}
