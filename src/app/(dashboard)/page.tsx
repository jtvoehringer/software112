import { redirect } from 'next/navigation'

// (dashboard) ist eine Route Group – die Root-Route "/" wird von src/app/page.tsx behandelt.
// Diese Datei ist nur nötig damit Next.js 16 keinen TypeScript-Build-Fehler wirft.
export default function DashboardGroupPage() {
  redirect('/dashboard')
}
