import type { LandingCopy } from '../types';

const pdfZuAnkiCopy: LandingCopy = {
  pathname: '/pdf-zu-anki',
  htmlLang: 'de',
  alternates: [
    { hreflang: 'en', href: 'https://2anki.net/pdf-to-anki/' },
    { hreflang: 'de', href: 'https://2anki.net/pdf-zu-anki/' },
    { hreflang: 'x-default', href: 'https://2anki.net/pdf-to-anki/' },
  ],
  title: 'PDF zu Anki — Karteikarten aus jedem PDF | 2anki',
  description:
    'Lade ein PDF hoch und mach daraus einen Anki-Stapel: Überschriften werden zu Decks, Bilder eingebettet, sauberer Import. Datei rein, .apkg raus.',
  h1: 'Aus einem PDF Anki-Karteikarten machen',
  subhead:
    'Lade ein PDF hoch — Vorlesungsskript, Lehrbuchkapitel oder Zusammenfassung — und 2anki holt den Text heraus, aus dem du Karten baust.',
  steps: [
    {
      title: 'PDF hochladen',
      body: 'Zieh dein Vorlesungsskript, ein Lehrbuchkapitel oder eine Zusammenfassung als PDF hierher.',
    },
    {
      title: '2anki baut deinen Stapel',
      body: 'Meist ein paar Sekunden. Größere Dateien dauern eine Minute.',
    },
    {
      title: 'In Anki öffnen',
      body: 'Lade die .apkg-Datei herunter und öffne sie per Doppelklick. Deine Karten sind sofort lernbereit.',
    },
  ],
  formats: [
    'PDF',
    'Notion',
    'Word',
    'Markdown',
    'PowerPoint',
    'Quizlet',
    'CSV',
  ],
  whatComesAcross: [
    {
      title: 'Cloze bleibt anklickbar',
      body: '{{c1::...}} wird zu einer echten Anki-Cloze-Karte, nicht zu einfachem Text.',
    },
    {
      title: 'Bilder erscheinen in der Karte',
      body: 'Eingebettete Abbildungen und Diagramme werden übernommen und auf Vorder- oder Rückseite angezeigt.',
    },
    {
      title: 'Überschriften werden zu Decks',
      body: 'Kapitelüberschriften aus dem PDF werden zu Deck- und Tag-Namen, damit dein Stapel geordnet bleibt.',
    },
    {
      title: 'Richtige Notiztypen',
      body: 'Basic, Cloze und Vorder-/Rückseite landen im passenden Anki-Notiztyp, damit der Import sauber ist.',
    },
    {
      title: 'Für Medizin, Pflege und Examen gebaut',
      body: 'Ob Physikum, Hammerexamen oder Pflegeexamen — lade dein Vorlesungsskript oder ein Lehrbuchkapitel als PDF hoch und lerne aus deinem eigenen Material statt aus einem Stapel von der Stange.',
    },
  ],
  faqs: [
    {
      q: 'Funktioniert das mit gescannten PDFs?',
      a: 'Nur wenn der Scan eine Textebene hat (OCR). Die meisten aktuellen Lehrbücher und Folien-Exporte haben das. Ist deins ein Foto einer Seite ohne Textebene, schick es vorher durch ein OCR-Tool — die macOS-Vorschau und Adobe Acrobat können das beide.',
    },
    {
      q: 'Wie entscheidet 2anki, was zur Karte wird?',
      a: 'Überschriften werden zu Deck- und Tag-Namen. Aufzählungspunkte und kurze Absätze werden zur Kartenvorderseite; die nächste Zeile oder Einrückung zur Rückseite. Du kannst die Karten danach in Anki frei bearbeiten.',
    },
    {
      q: 'Kann ich ein ganzes Lehrbuch hochladen?',
      a: 'Ja, aber große PDFs dauern länger und erzeugen riesige Stapel. Wir empfehlen, ein Kapitel nach dem anderen hochzuladen — leichter zu prüfen, leichter zu teilen, und Anki kommt mit einem Stapel aus ein paar Hundert Karten besser klar als mit einem aus Zehntausenden.',
    },
    {
      q: 'Was passiert mit Diagrammen und Formeln?',
      a: 'Diagramme werden als eingebettete Bilder übernommen. Als Bild gerenderte Formeln bleiben Bilder; als Text gespeicherte Formeln brauchen aktiviertes MathJax in deiner Anki-Kartenvorlage, um angezeigt zu werden.',
    },
  ],
  relatedLinks: [
    {
      label: 'Aus PowerPoint-Folien Karten machen',
      href: '/powerpoint-zu-anki',
    },
    { label: 'Notion-Seiten zu Anki', href: '/notion-zu-anki' },
    { label: 'Alle Konverter ansehen', href: '/convert' },
  ],
};

export default pdfZuAnkiCopy;
