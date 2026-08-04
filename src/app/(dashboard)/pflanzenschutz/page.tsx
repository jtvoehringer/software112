import { redirect } from 'next/navigation'

// Die PSM-Stammdatenverwaltung ist in die Betriebsmittel-Lagerverwaltung (unter Maßnahmen) umgezogen.
// Diese Route bleibt als Weiterleitung bestehen, falls noch alte Links/Bookmarks existieren.
export default function PflanzenschutzRedirect() {
  redirect('/behandlungen/lager?tab=stammdaten')
}
