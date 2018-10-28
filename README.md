# HowToBeAHero-WikiToPdf

This tool uses [Request](https://github.com/request/request) on [Parasoid](https://www.mediawiki.org/wiki/Parsoid) to fetch specific pages of the [How to be a Hero](https://howtobeahero.de/index.php?title=Hauptseite) Wiki, put them in a nice HTML-template and generate a PDF via [html-pdf](https://www.npmjs.com/package/html-pdf) for a printable version.

## Requirements

Ensure these executables can be found using the `path` environment variable:

* A NodeJS >8.0.0-installation
* A python 2-installation
* A `git` executable

On unix, ensure the `libfontconfig` is installed as well.

## Running the project

1. Start a command line inside your cloned repository
2. `npm install`
3. `npm run service`
4. You're now able to make web-requests to generate PDFs.

### Example
To generate a PDF containing "Begabungen", "Fähigkeiten", "Geistesblitzpunkte" and "Kategorie:Charaktererstellung" visit `http://localhost:3000/?title=Begabungen|F%C3%A4higkeiten|Geistesblitzpunkte|Kategorie:Charaktererstellung`.

## Ports

Two ports are required to run this project.  
* `publicPort` (default 3000), is the user-facing port used to receive HTTP requests and return the generated PDFs.
* `parsoidPort` (default 8000), is exclusively used internally to communicate between parsoid and the HTTP server handling user requests.

To change ports, modify the associated value in `package.json` and run `npm install`. Ensure that `/index.js`, `/config.yaml` and `/node_modules/parsoid/config.yaml` are writable before running `npm install` - you can re-run this command as often as needed.  
**If you need to change them at a later point, remember to run `npm install` again, after changing `package.json`.**