# HowToBeAHero-WikiToPdf

Baut aus Seiten des [How-to-be-a-Hero-Wikis](https://howtobeahero.de) Buch-PDFs: das Regelwerk,
einzelne Module und Abenteuer, wahlweise mit ausfüllbarem Charakterbogen, in A4 oder A5.
Spielleitungen klicken sich im **Buch-Baukasten** ihr Buch zusammen und bekommen einen Link, den sie an
ihre Gruppe weitergeben können.

Version 2 (2026) ersetzt die alte Node/Parsoid/PhantomJS-Fassung von 2018 (Tag `v1-legacy`).

## Wie es funktioniert

```
Browser ──> Caddy ──/pdf/*──> wikitopdf (Bun + Chromium)
                                  │  api.php (intern, Docker-Netz)
                                  ▼
                            MediaWiki-Container
```

1. Der Dienst fragt über die Wiki-API die Revision ab, die Leser sehen (`action=htbahpdf` aus der
   [MediaWiki-Erweiterung](https://github.com/How-to-be-a-Hero-e-V/HowToBeAHero-WikiToPdf-MediawikiIntegration),
   berücksichtigt ApprovedRevs) und holt das fertige HTML mit `action=parse&oldid=…`.
2. Das HTML wird bereinigt (Bearbeiten-Links, Abzeichen, Videos, Inhaltsverzeichnisse) und in das
   Buch-Template gegossen: Umschlag, Inhaltsverzeichnis mit Seitenzahlen, Teil-Titelseiten, laufende
   Kopfzeilen, Lizenzseite mit Quellen.
3. [Paged.js](https://pagedjs.org) setzt die Seiten im headless Chromium (Playwright), das PDF entsteht
   mit `page.pdf()`. Schriften (Alegreya SC, Open Sans) liegen im Image, es wird nichts aus dem Internet
   geladen; der Container spricht nur mit `mediawiki:80`.
4. Der gewählte Charakterbogen wird mit pdf-lib angehängt. Die Formularfelder bleiben erhalten
   (AcroForm wird neu aufgebaut), zusätzlich hängt das Original als Dateianhang im PDF.
5. Fertige Bücher werden unter einem Hash aus Titeln, Revisions-IDs, Format und Template-Version
   zwischengespeichert. Vordefinierte Bücher (`books` im Katalog) werden nachts vorgerendert.

## Endpunkte

| Pfad | Zweck |
|---|---|
| `/` | Buch-Baukasten (Oberfläche) |
| `/book?rules=all&modules=A\|B&adventures=C&pages=D&sheet=standard&fmt=a5&title=…` | Buch anfordern; aus dem Cache sofort als PDF, sonst Warteseite mit automatischem Download. Dieser Link ist teilbar. |
| `/book?book=regelwerk&fmt=a4` | vordefiniertes Buch |
| `/book?pages=Kampf` | einzelne Seite (Link „Diese Seite als Buch-PDF" im Wiki) |
| `/api/catalog` | Katalog mit aufgelösten Kategorien |
| `/api/jobs` (POST, gleiche Parameter) → `/api/jobs/{id}` → `/api/jobs/{id}/download` | Auftrag anlegen, Status abfragen, PDF laden |
| `/healthz` | Lebenszeichen |

Grenzen: höchstens 40 Seiten pro Buch, 6 Aufträge pro Minute und IP, 2 gleichzeitige Renderings,
nur Namensräume aus `allowedNamespaces` (Standard: Artikel und Kategorien).

## Katalog

`catalog.default.json` enthält die Regelwerk-Reihenfolge, die Kategorien für Module und Abenteuer, die
Charakterbögen und vordefinierte Bücher. Die Redaktion kann alles auf der Wiki-Seite
`MediaWiki:Wikitopdf-catalog.json` überschreiben (gleiches Format, einzelne Schlüssel reichen). Die
Seite wird alle zehn Minuten neu gelesen, `POST /api/catalog/refresh` erzwingt es sofort.

## Betrieb

```yaml
# docker-compose.yml (Auszug)
  wikitopdf:
    build: ./wikitopdf
    container_name: mediawiki_htbah_wikitopdf
    restart: always
    shm_size: 512m
    environment:
      - PUBLIC_BASE=/pdf
      - PUBLIC_WIKI=https://howtobeahero.de
    volumes:
      - ./wikitopdf_data:/data
    networks:
      - web
```

```
# Caddyfile (Auszug)
handle_path /pdf/* {
        reverse_proxy wikitopdf:3000
}
handle /pdf {
        redir /pdf/ 302
}
```

Umgebungsvariablen: `WIKI_API` (Standard `http://mediawiki/api.php`), `WIKI_INDEX`, `WIKI_HOST`,
`PUBLIC_WIKI`, `PUBLIC_BASE`, `DATA_DIR`, `CATALOG_PAGE`, `PRERENDER_AT` (Standard `04:15`),
`MAX_TITLES`, `CONCURRENCY`, `JOBS_PER_MINUTE`, `CACHE_MAX_BYTES`, `CACHE_MAX_AGE_DAYS`.

Lokal entwickeln: `bun install && WIKI_API=https://howtobeahero.de/api.php WIKI_INDEX=https://howtobeahero.de/index.php CHROMIUM_PATH=/Applications/Chromium.app/Contents/MacOS/Chromium bun run dev`

## Lizenz

Code: GPL-3.0-or-later. Schriften: SIL Open Font License (siehe `template/fonts`). Wiki-Inhalte in den
erzeugten PDFs: CC BY-NC-SA 4.0, jedes PDF trägt eine Lizenzseite mit den Quellen.
