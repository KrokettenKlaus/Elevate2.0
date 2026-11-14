# Elevate 2.0

Persönliches Trainings-Logbuch: Klettern, Hangboard, Kraft & Prävention, Laufen, Rad und Planung.
Grundlage ist `PLAN.md`. Vanilla JavaScript (ES-Module), HTML, CSS – kein Build-Schritt.

## Lokal starten

```
npm start        # http://localhost:5173
npm test         # 33 Tests: Domain-Logik, Import-Parser gegen die echten Dateien, Coros-Leser, Speicher-Schicht
```

`index.html` enthält nur den Seiteninhalt (ohne `<html>`, `<head>`, `<body>`), so wie eine Artifact-Seite
veröffentlicht wird. `tools/serve.mjs` setzt lokal denselben Rahmen darum, den die Plattform beim
Veröffentlichen ergänzt. Ein beliebiger statischer Server funktioniert auch, läuft dann aber im Quirks-Modus.

Lokal gibt es kein `window.claude`. Die App erkennt das, speichert in `localStorage` und zeigt den Hinweis
„Lokaler Modus, Daten nur in diesem Browser“. Coros-Abruf und Wochenreview funktionieren nur im Artifact auf claude.ai.

## Erste Schritte in der App

1. **Import → RehabBoard:** `../RehabBoard/data/sessions.json` wählen, Vorschau prüfen, importieren.
2. **Import → Hangboard-Notizen:** `Hangboard.txt` wählen. In der Vorschau die Ausführung der
   Maximalkraft-Einheiten festlegen (offener Punkt 1 aus dem Plan), dann importieren.
3. Unter **Tests** das Körpergewicht pflegen, unter **Einstellungen** die Soll-Pyramide.

Jeder Import ist wiederholbar: vorhandene Einträge werden an ihrer ID erkannt und übersprungen.

## Veröffentlichen als Claude-Artifact

Seite: `index.html`. Dazu als Dateien mit unveränderten relativen Pfaden: `css/app.css` und alles unter `js/`.
`tests/`, `tools/`, `Hangboard.txt`, `PLAN.md` und `package.json` gehören nicht dazu.

Capabilities (Laufzeitvertrag 0.2.96):

```json
{
  "db": { "rules": [{ "path": "", "read": "owner", "write": "owner" }] },
  "user": {},
  "mcp": { "servers": [{ "server": "Coros", "tools": ["querySportRecords", "getActivityDetail"] }] },
  "sample": {},
  "downloads": true
}
```

Die Regel am Wurzelpfad gilt für alle Sammlungen: Nur der Eigentümer liest und schreibt.
Nach dem ersten Start legt die App Einstellungen, die beiden Wochenvorlagen, das Start-Körpergewicht
und die Referenztests an. Alle anderen Daten kommen über den Import.

**Coros:** Lauf- und Radeinheiten kommen über den offiziellen Coros-Connector (`https://mcp.coros.com/mcp`,
in claude.ai als eigener Connector mit dem Namen „Coros“ hinzugefügt). Die Seite ruft nur zwei Lese-Tools auf:
`querySportRecords` (Liste, in 30-Tage-Fenstern) und `getActivityDetail` (Höhenmeter, Trainingsbelastung).
Beide antworten als formatierter Text, nicht als JSON – `js/domain/coros.js` liest genau die Zeilen, die Coros
druckt. Ändert Coros das Format, zeigt der Abruf unter „Technische Details zum Abruf“ den Anfang der Antwort.
Der RPE-Vorschlag nutzt die Coros-Trainingsbelastung pro Stunde; die Stufen dafür sind eine Schätzung
(`LOAD_RATE_RPE` in `js/domain/endurance.js`).

**Strava** ist zurückgestellt (verlangt eine Mitgliedschaft). `js/services/strava.js` bleibt im Projekt, ist aber
nicht mehr angebunden und steht nicht im Manifest.

## Aufbau

```
index.html            Seiteninhalt, lädt css/app.css und js/main.js
css/app.css           Tokens (hell/dunkel), Layout, Komponenten
js/main.js            Start, Navigation, Hash-Routing, „+ Einheit“
js/store/             Speicher-Abstraktion: index.js wählt claudeDb.js oder localDb.js; defaults.js
js/domain/            reine Funktionen: dates, grades, load (sRPE/ACWR), hangboard, plan, strength, climbing, endurance, coros, tests
js/import/            rehabboard.js, hangboardTxt.js
js/services/          caps.js, coros.js, review.js, backup.js (strava.js: zurückgestellt)
js/ui/                dom.js, dialog.js, forms.js, charts.js, view.js
js/modules/           dashboard, plan, climbing, hangboard, strength, endurance, tests, analysis, import, prefs, open
tests/                node --test
tools/serve.mjs       lokaler Server ohne Abhängigkeiten
```
