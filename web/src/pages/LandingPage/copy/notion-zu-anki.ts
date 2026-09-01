import type { LandingCopy } from '../types';

const notionZuAnkiCopy: LandingCopy = {
  galleryBadge: true,
  pathname: '/notion-zu-anki',
  htmlLang: 'de',
  alternates: [
    { hreflang: 'en', href: 'https://2anki.net/notion-to-anki/' },
    { hreflang: 'de', href: 'https://2anki.net/notion-zu-anki/' },
    { hreflang: 'x-default', href: 'https://2anki.net/notion-to-anki/' },
  ],
  title: 'Notion zu Anki — Karteikarten in Sekunden | 2anki',
  description:
    'Verbinde Notion einmal und mach aus jeder Seite einen Anki-Stapel: Toggles werden zu Karten, Bilder und Formeln bleiben erhalten. Kostenlos, ohne Add-on.',
  h1: 'Notion zu Anki: deine Notizen werden zu Karteikarten fürs Studium',
  subhead:
    'Verbinde Notion einmal, wähle eine Seite und lade einen fertigen Anki-Stapel herunter. Deine Toggles werden zu Vorder- und Rückseite — ohne Add-on, ohne Copy-and-paste.',
  steps: [
    {
      title: 'Notion verbinden',
      body: 'Melde dich an und verbinde deinen Notion-Workspace einmalig. 2anki liest nur die Seiten, die du auswählst.',
    },
    {
      title: 'Seite auswählen',
      body: 'Füge den Link zu deiner Lernseite ein — Anatomie, Pharmakologie, Mikrobiologie, egal welches Fach.',
    },
    {
      title: 'In Anki öffnen',
      body: 'Lade die .apkg-Datei herunter und öffne sie per Doppelklick. Deine Karten sind sofort lernbereit.',
    },
  ],
  formats: [
    'Notion',
    'PDF',
    'Word',
    'Markdown',
    'PowerPoint',
    'Quizlet',
    'CSV',
  ],
  whatComesAcross: [
    {
      title: 'Toggles werden zu Karten',
      body: 'Jede Umschaltliste (Toggle) wird eine Karte: die Überschrift ist die Frage, der aufgeklappte Inhalt die Antwort.',
    },
    {
      title: 'Bilder und Diagramme bleiben',
      body: 'Anatomie-Schemata, EKG-Streifen und beschriftete Abbildungen werden in die Karte eingebettet.',
    },
    {
      title: 'Formeln und Codeblöcke',
      body: 'LaTeX-Formeln und Codeblöcke behalten ihre Formatierung — wichtig für Biochemie und Statistik.',
    },
    {
      title: 'Cloze bleibt anklickbar',
      body: 'Lückentext aus Notion wird zu klickbaren Cloze-Karten in Anki.',
    },
    {
      title: 'Für Medizin, Pflege und Examen gebaut',
      body: 'Ob Physikum, Hammerexamen oder Pflegeexamen — die stärksten Karten baust du aus deinem eigenen Material. Leg deine Anatomie-, Pharmakologie- und Mikrobiologie-Notizen in Notion an, strukturiere sie mit Toggles, und 2anki macht daraus einen lernbereiten Anki-Stapel. So paukst du genau das, was in deinen Vorlesungen und Skripten steht — statt einen fertigen Stapel von der Stange.',
    },
  ],
  faqs: [
    {
      q: 'Funktioniert das mit Toggles und Callouts?',
      a: 'Ja. Toggles werden zu Vorder- und Rückseite, Callouts kommen als eigener Block auf die Karte. Wenn ein Blocktyp nicht so übernommen wird, wie du es dir wünschst, schick uns die Seite an support@2anki.net und wir schauen es uns an.',
    },
    {
      q: 'Brauche ich einen Notion-Integrations-Token?',
      a: 'Ja — verbinde Notion einmalig auf der Upload-Seite. Wir nutzen den Token nur, um die von dir ausgewählten Seiten zu lesen, und du kannst ihn jederzeit in deinen Notion-Einstellungen widerrufen.',
    },
    {
      q: 'Was passiert mit Bildern und Formeln?',
      a: 'Beides bleibt erhalten. Bilder werden in die Karte eingebettet, LaTeX-Formeln und Codeblöcke behalten ihre Formatierung. Was wir nicht abrufen können, ersetzen wir durch einen kurzen Hinweis, damit die Karte trotzdem funktioniert.',
    },
    {
      q: 'Aktualisiert sich der Stapel, wenn ich die Notion-Seite später ändere?',
      a: 'Eine einmalige Konvertierung ist eine Momentaufnahme. Füge den Link erneut ein, um einen frischen Stapel zu erzeugen. Wenn Änderungen automatisch übernommen werden sollen, sieh dir Auto Sync auf der Preisseite an — es fragt Notion alle paar Minuten ab.',
    },
    {
      q: 'Gibt es fertige Medizin-Decks zum Herunterladen?',
      a: 'Nein, und das ist Absicht. Am besten lernst du mit Karten aus deinem eigenen Material — deinen Vorlesungen, deinen Skripten, deiner Struktur. 2anki macht aus deinen Notion-Seiten Karten; einen fertigen Stapel von der Stange bekommst du hier bewusst nicht.',
    },
  ],
  relatedLinks: [
    { label: 'Karten aus einem PDF', href: '/pdf-to-anki' },
    { label: 'Automatische Synchronisierung', href: '/pricing' },
    { label: 'Alle Konverter ansehen', href: '/convert' },
  ],
};

export default notionZuAnkiCopy;
