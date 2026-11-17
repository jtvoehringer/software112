import { redirect } from 'next/navigation'

// KAN-478 (BKI-Sitzung 16.11.2026): Ein Gebinde zeigt nur, was jetzt drin liegt – das Bewegungsbuch am Gebinde gibt es nicht
// mehr. Die Historie steht im Weinbuch der Charge. Die alte Adresse (Lesezeichen, Links in alten Ausdrucken) führt
// zur Gebinde-Seite.
export default async function BewegungenWeiterleitung({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  redirect(`/kellerbuch/behaelter/${encodeURIComponent(id)}`)
}
