---
title: Selbst hosten
description: Du kannst 2anki selbst betreiben. Hier die Kurzfassung.
---

:::note
Selbst-Hosting ist für Bastler und Mitwirkende. Fast alle sind mit dem gehosteten Dienst unter [2anki.net](https://2anki.net/) besser bedient — derselbe Code, kein Setup, kostenlos für die Konvertierungsfunktionen.
:::

Der Code liegt in [2anki/server](https://github.com/2anki/server) — ein pnpm-Monorepo mit der Express-API und dem React-Frontend (dem `web/`-Workspace, Paketname `2anki-web`). Frei zu betreiben für private oder kommerzielle Nutzung.

**Plan:** Kostenlos (selbst gehostet; die [Stufen des gehosteten Dienstes](/pricing) gelten nicht, wenn du deine eigene Instanz betreibst)

## Systemanforderungen

- Node.js — passe zur Version in `.nvmrc`.
- pnpm — nutze nicht npm oder yarn.
- PostgreSQL.
- LibreOffice — für die PPT/PPTX-zu-PDF-Konvertierung.
- Poppler (`pdftoppm`) — für das Rendern von PDF-Seiten.

Auf Debian/Ubuntu:

```bash
sudo apt-get install -y git postgresql libreoffice poppler-utils
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
nvm install --lts
npm install -g pnpm
```

## Erforderliche Umgebungsvariablen

Erstelle `.env` im Repo-Root. Echte Schlüssel liegen in `src/env.example`:

```bash
PORT=2020
DOMAIN=http://localhost:2020
WORKSPACE_BASE=/tmp/genanki
UPLOAD_BASE=/tmp/genanki-uploads
WEB_BUILD_DIR=./web/build

DATABASE_URL=postgresql://tanki:tanki@localhost:5432/tanki

SECRET=replace-with-a-long-random-string
THE_HASHING_SECRET=replace-with-a-different-long-random-string
```

`SECRET` signiert Session-JWTs; `THE_HASHING_SECRET` verschlüsselt gespeicherte Notion-Tokens. Beide müssen lange Zufallsstrings sein, bevor du den Server öffentlich freigibst. Migrationen laufen beim Boot automatisch über die Knex-Konfiguration.

## Optionale Integrationen

Jede Integration fügt eine Funktion hinzu. Du kannst 2anki ohne jede davon betreiben — der Datei-Upload-Konvertierungsweg funktioniert für sich.

| Integration                         | Umgebungsvariablen                                                                                                                  | Fügt hinzu                                                                                                                                                                                         |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notion OAuth                        | `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, `NOTION_REDIRECT_URI`                                                                   | Notion verbinden + Seiten-Picker                                                                                                                                                                   |
| Anthropic Claude                    | `ANTHROPIC_API_KEY`                                                                                                                 | KI-Karteikartenerstellung aus PDFs                                                                                                                                                                 |
| Stripe                              | `STRIPE_KEY`, `STRIPE_ENDPOINT_SECRET`                                                                                              | Kostenpflichtige Pläne (überspringen, wenn du für dich selbst betreibst)                                                                                                                           |
| SendGrid                            | `SENDGRID_API_KEY`                                                                                                                  | Transaktions-E-Mail (Passwort-Reset usw.)                                                                                                                                                          |
| DigitalOcean Spaces (S3-kompatibel) | `SPACES_ENDPOINT`, `SPACES_REGION`, `SPACES_DEFAULT_BUCKET_NAME`, plus standardmäßige `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Remote-Speicher für konvertierte Decks (nötig für die "Meine Stapel"-Historie und Sync) und Mindmap-Bilder. Mindmap-Bild-Upload braucht Spaces — ohne es scheitern Bild-Uploads an der API-Grenze. |

## Wo du Hilfe bekommst

- Die [`README.md`](https://github.com/2anki/server#readme) des Repos ist die Quelle der Wahrheit für die Setup-Schritte.
- Sobald der Server läuft, liegt die API-Referenz unter `/api/docs` (Swagger UI).
- Für Selbst-Host-Fragen [eröffne eine Diskussion](https://github.com/2anki/server/discussions) auf GitHub. E-Mail ist für Fragen zum gehosteten Dienst in Ordnung, aber das Diskussionsforum ist beim Selbst-Hosting schneller, weil andere Selbst-Hoster antworten.

Wir schreiben absichtlich kein volles Betriebshandbuch — der gehostete Dienst ist, was die meisten Nutzer wollen, und die README plus der Code reichen für die Bastler, die es nicht wollen.
