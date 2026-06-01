import type { Metadata } from 'next'
export const metadata: Metadata = { title: 'BMD NTCS-Schnittstelle – software:112' }
export default function Page() {
  return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <p className="text-4xl">🚧</p>
      <h1 className="text-xl font-bold text-gray-800">BMD NTCS-Schnittstelle</h1>
      <p className="text-sm text-s112-muted">Dieses Modul ist in Planung (Phase 3).</p>
    </div>
  )
}
