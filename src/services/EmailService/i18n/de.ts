import { DeepPartial, EmailStrings } from './types';

export const de: DeepPartial<EmailStrings> = {
  resetPassword: {
    subject: 'Setze dein 2anki.net-Passwort zurück',
    heading: 'Passwort zurücksetzen',
    body: 'Setze dein 2anki.net-Passwort über die Schaltfläche unten zurück.',
    cta: 'Passwort zurücksetzen',
    disclaimer:
      'Nicht angefordert? Ignoriere diese Nachricht. Dein Passwort bleibt unverändert.',
    text: 'Wir haben deine Anfrage zum Ändern des Passworts erhalten. Du kannst es hier ändern: {{link}}',
  },
  magicLinkLogin: {
    subject: 'Dein 2anki-Anmeldelink',
    heading: 'Bei 2anki.net anmelden',
    description:
      'Klicke auf die Schaltfläche unten, um dich bei deinem Konto anzumelden.',
    cta: 'Anmelden',
    text: 'Melde dich mit diesem Link bei deinem 2anki-Konto an: {{link}}',
  },
  magicLinkReset: {
    subject: 'Setze dein 2anki-Passwort zurück',
    heading: 'Setze dein 2anki.net-Passwort zurück',
    description:
      'Klicke auf die Schaltfläche unten, um dein Passwort zurückzusetzen.',
    cta: 'Passwort zurücksetzen',
    text: 'Setze dein 2anki-Passwort mit diesem Link zurück: {{link}}',
  },
  magicLinkShared: {
    expiry: 'Dieser Link läuft in 15 Minuten ab.',
    disclaimer:
      'Nicht angefordert? Ignoriere diese Nachricht. An deinem Konto wird nichts geändert.',
  },
  deckReady: {
    subject: '2anki.net – Dein Stapel «{{filename}}» ist fertig',
    heading: 'Dein Stapel ist fertig',
    bodyAttached:
      'Dein umgewandelter Stapel hängt an dieser E-Mail. Importiere ihn in Anki, um mit dem Lernen zu beginnen.',
    bodyTrouble: 'Probleme? Antworte einfach auf diese E-Mail.',
    disclaimerPrefix:
      'Diese Konvertierung nicht angefordert? Kontaktiere uns unter ',
    disclaimerSuffix: '.',
    cardSingular: 'Karte',
    cardPlural: 'Karten',
    textReadyPrefix: 'Dein Stapel ist fertig: ',
    textAttached: '. Er hängt an dieser E-Mail.',
  },
  reEngagement: {
    subject: 'Machst du Karten noch von Hand?',
    title: '2anki.net – Machst du Karten noch von Hand?',
    heading: 'Machst du Karten noch von Hand?',
    body: 'Hallo {{name}}, du hast dich vor ein paar Tagen bei 2anki angemeldet, aber noch keinen Stapel erstellt. Karten abzutippen ist der langsame Teil — 2anki verwandelt eine Notion-Seite oder eine hochgeladene Datei in unter einer Minute in einen Anki-Stapel.',
    videoCaption: 'Sieh dir an, wie es funktioniert (60 Sek.)',
    bodyPaste:
      'Füge eine Notion-Seiten-URL ein oder lade eine Datei auf 2anki.net hoch, um es auszuprobieren.',
    bodyReply:
      'Irgendwo hängen geblieben? Antworte auf diese E-Mail — Alexander liest jede einzelne.',
    cta: 'Erzähl uns, was passiert ist',
    text: 'Hallo {{name}},\n\nDu hast dich vor ein paar Tagen bei 2anki angemeldet, aber noch keinen Stapel erstellt. Karten abzutippen ist der langsame Teil — 2anki verwandelt eine Notion-Seite oder eine hochgeladene Datei in unter einer Minute in einen Anki-Stapel.\n\nFüge eine Notion-Seiten-URL ein oder lade eine Datei auf https://2anki.net hoch, um es auszuprobieren.\n\nIrgendwo hängen geblieben? Antworte auf diese E-Mail — Alexander liest jede einzelne.\n\nErzähl uns, was passiert ist: {{surveyUrl}}\n\nDas 2anki-Team',
  },
  inactivityWarning: {
    subject: 'Deine Stapel auf 2anki — immer noch hier, wenn du sie brauchst',
    title: '2anki.net – Deine Stapel, immer noch hier, wenn du sie brauchst',
    bodyWithConversion:
      'Dein letzter Stapel auf 2anki war {{deckName}}. Wenn eine weitere Prüfung oder ein neues Kapitel ansteht, ist dein Konto bereit — füge einen Notion-Link ein oder lade eine Datei hoch, und du hast in unter einer Minute einen Stapel.',
    bodyNoConversion:
      'Du hast dich bei 2anki angemeldet, aber noch keinen Stapel erstellt. Wenn du so weit bist, füge einen Notion-Link ein oder lade eine Datei auf 2anki.net hoch, und du hast in unter einer Minute einen Anki-Stapel.',
    passLine:
      'Wenn du es nur für einen Schub brauchst — ein Tagespass deckt einen ganzen Tag Konvertieren ab, ein Wochenpass eine ganze Woche. Einmal zahlen, kein Abo.',
    cta: '2anki öffnen',
    housekeeping:
      'Ein Hinweis zur Ordnung: Konten, die 6 Monate inaktiv sind, werden aufgeräumt, und wir entfernen deine hochgeladenen Stapel und Dateien nach 14 Tagen, wenn wir dich nicht sehen. Alles, was bereits in Anki heruntergeladen wurde, bleibt sicher. Einmal anmelden bewahrt alles.',
    signoff: 'Das 2anki-Team',
  },
  abandonedCheckout: {
    subject: 'Schließe dein 2anki-Pro-Abo ab',
    title: '2anki.net – Schließe dein Pro-Abo ab',
    bodyStarted:
      'Du hast ein 2anki-Pro-Abo begonnen und den Bezahlvorgang nicht abgeschlossen.',
    bodySnag:
      'Die meisten, die hier aufhören, sind beim Bezahlen auf ein Problem gestoßen, nicht auf einen Sinneswandel. Wenn etwas nicht funktioniert hat oder du eine Frage hast, antworte auf diese E-Mail — Alexander liest jede einzelne.',
    cta: 'Anmeldung abschließen',
    signoff: 'Das 2anki-Team',
  },
  commercialShared: {
    unsubscribe: 'Keine E-Mails wie diese? Abmelden',
  },
};
