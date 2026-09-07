import type { LandingCopy } from '../types';

const powerpointZuAnkiCopy: LandingCopy = {
  pathname: '/powerpoint-zu-anki',
  htmlLang: 'de',
  alternates: [
    { hreflang: 'en', href: 'https://2anki.net/powerpoint-to-anki/' },
    { hreflang: 'de', href: 'https://2anki.net/powerpoint-zu-anki/' },
    { hreflang: 'x-default', href: 'https://2anki.net/powerpoint-to-anki/' },
  ],
  title: 'PowerPoint zu Anki — Vorlesungsfolien als Karteikarten | 2anki',
  description:
    'Lade eine .pptx hoch und 2anki macht aus dem Text deiner Folien einen Anki-Stapel. Funktioniert auch mit Google-Slides-Exporten.',
  h1: 'Aus PowerPoint-Folien Anki-Karteikarten machen',
  subhead:
    'Lade eine .pptx hoch — deine Vorlesungsfolien — und 2anki liest den Text auf den Folien und baut einen Anki-Stapel, den du bearbeiten kannst.',
  steps: [
    {
      title: 'Folien hochladen',
      body: 'Zieh deine .pptx hierher — eine native PowerPoint-Datei oder ein Google-Slides-Export.',
    },
    {
      title: '2anki liest deine Folien',
      body: 'Titel, Aufzählungen und Fließtext werden zu Karten. Meist ein paar Sekunden.',
    },
    {
      title: 'In Anki öffnen',
      body: 'Lade die .apkg-Datei herunter und öffne sie per Doppelklick. Deine Karten sind sofort lernbereit.',
    },
  ],
  formats: [
    'PowerPoint',
    'PDF',
    'Notion',
    'Word',
    'Markdown',
    'Quizlet',
    'CSV',
  ],
  whatComesAcross: [
    {
      title: 'Folientext wird zu Karten',
      body: 'Titel, Aufzählungspunkte und Fließtext jeder Folie werden zu Karten, die du in Anki bearbeiten und umsortieren kannst.',
    },
    {
      title: 'Bilder bleiben erhalten',
      body: 'Eingebettete Abbildungen und Diagramme von deinen Folien werden in die Karte übernommen.',
    },
    {
      title: 'Richtige Notiztypen',
      body: 'Basic und Vorder-/Rückseite landen im passenden Anki-Notiztyp, damit der Import sauber ist.',
    },
    {
      title: 'Kein Ballast in den Karten',
      body: 'Keine leeren Rückseiten und keine übrig gebliebenen Sonderzeichen aus deinen Folien.',
    },
    {
      title: 'Für Medizin, Pflege und Examen gebaut',
      body: 'Ob Physikum, Hammerexamen oder Pflegeexamen — lade deine Vorlesungsfolien hoch und lerne aus dem Material deiner eigenen Dozenten statt aus einem Stapel von der Stange.',
    },
  ],
  faqs: [
    {
      q: 'Welcher Folieninhalt wird zur Karte?',
      a: 'Der Text auf jeder Folie — Titel, Aufzählungen und Fließtext. 2anki liest ihn und baut Karten, die du danach in Anki bearbeiten und umsortieren kannst.',
    },
    {
      q: 'Werden meine Referentennotizen übernommen?',
      a: '2anki liest den Text auf den Folien selbst, deshalb werden Notizen, die nur im Notizenbereich stehen, nicht erfasst. Schreib alles, was auf eine Karte soll, vor dem Hochladen direkt auf die Folie.',
    },
    {
      q: 'Ich habe meine Folien in Google Slides erstellt — geht das?',
      a: 'Ja. Wähle in Google Slides Datei, dann Herunterladen, dann Microsoft PowerPoint (.pptx). Lade diese Datei hier hoch, und sie wird genauso konvertiert wie eine native PowerPoint-Datei.',
    },
    {
      q: 'Was passiert mit Folien, die nur aus einem Bild bestehen?',
      a: 'Folien ohne Text — ein bildfüllendes Diagramm oder Foto — haben nichts, was wir lesen könnten, und erzeugen daher keine Karte. Füge dieser Folie einen Titel oder eine Zeile Text hinzu, wenn sie zur Karte werden soll. Wird etwas nicht so übernommen, wie du es dir wünschst, schick uns die Datei an support@2anki.net.',
    },
  ],
  relatedLinks: [
    { label: 'Aus einem PDF Karten machen', href: '/pdf-zu-anki' },
    { label: 'Notion-Seiten zu Anki', href: '/notion-zu-anki' },
    { label: 'Alle Konverter ansehen', href: '/convert' },
  ],
};

export default powerpointZuAnkiCopy;
