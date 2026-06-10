'use client'

interface Props {
  action: () => Promise<void>
  bestaetigung?: string
}

export default function LoeschenButton({ action, bestaetigung = 'Eintrag wirklich löschen?' }: Props) {
  async function handleClick() {
    if (!window.confirm(bestaetigung)) return
    await action()
  }
  return (
    <button type="button" onClick={handleClick}
      className="text-xs text-red-500 hover:underline">
      Löschen
    </button>
  )
}
