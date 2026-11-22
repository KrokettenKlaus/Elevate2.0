# Elevate 2.0 – Trainings-Logbuch (Plan)

Persönliches Trainings-Logbuch für Max: Sportklettern (aktuell 7c, Ziel 8a), Hangboard, Kraft & Prävention (Schulter-Reha seit Juni 2026, aktuell ohne Einschränkungen), Laufen, Radfahren, Trainingsplanung.

Dieser Plan ist die Grundlage für die Umsetzung mit Claude Code. Abschnitt 10 enthält die verbindlichen technischen Vorgaben.

---

## 1. Ziele

- Eine einzige App mit einer gemeinsamen Datenbasis für alle Trainingsbereiche.
- Fortschritt Richtung 8a sichtbar machen: Grad-Pyramide, Projekte, Fingerkraft im Vergleich zum Wert vor der Verletzung.
- Belastungssteuerung über alle Sportarten mit **sRPE** (RPE × Minuten) und ACWR.
- Planung: Trainingsblöcke, Wochenvorlage, geplante Einheiten, die mit den tatsächlichen Einheiten abgeglichen werden.
- RehabBoard vollständig übernehmen, inklusive aller bestehenden Daten.
- **Vorerst Desktop-first.** Eine Handy-Version folgt später (Phase 5), deshalb das Layout von Anfang an responsiv anlegen, aber nicht dafür optimieren.

## 2. Plattform und Betrieb

- Der **Quellcode liegt in diesem Ordner (`Elevate2.0`)**.
- **Produktion:** Die App wird als **Claude-Artifact** veröffentlicht, also als private, gehostete Seite auf claude.ai, mit Datenbank (`db`). Dadurch funktioniert sie später ohne Zusatzaufwand am Handy, kann den Strava-Connector nutzen und Claude-Analysen direkt in der App ausführen.
- **Lokale Entwicklung:** Die Artifact-Laufzeit (`window.claude`) gibt es lokal nicht. Deshalb läuft der Datenzugriff über eine Speicher-Abstraktion mit zwei Backends (siehe 10.3). Lokal wird mit einem einfachen statischen Server gestartet, z.B. `npx serve .` oder `python -m http.server`. ES-Module laden nicht über `file://`.
- **Veröffentlichen** geschieht **nicht** aus Claude Code im Terminal, sondern in einer claude.ai-Session mit Artifact-Tools. Dort werden die Dateien aus diesem Ordner mit `publish_files` hochgeladen und anschließend mit `declare_capabilities` die Fähigkeiten freigeschaltet. Der Code muss so gebaut sein, dass er ohne Build-Schritt direkt veröffentlicht werden kann.

## 3. Module

### 3.1 Dashboard (Startseite)
- **Aktuelle Woche:** geplante Einheiten (aus Vorlage bzw. Plan) neben den tatsächlichen, jeweils mit Status (erledigt, offen, ausgelassen, zusätzlich).
- **Belastung:** tägliche sRPE der letzten 6 Wochen, gestapelt nach Modul, dazu eine ACWR-Linie.
- **Fortschritt Richtung 8a:** Mini-Pyramide, aktive Projekte, letzter Hangboard-Wert in % vom Körpergewicht im Vergleich zur Referenz von vor der Verletzung.
- **Kraft & Prävention:** letzte Sitzung (wie in RehabBoard).

### 3.2 Klettern
**Sessions**
- Felder: Datum, Ort (Halle oder Fels), Gebiet bzw. Halle (Freitext mit Autovervollständigung), Session-Typ, Dauer in Minuten, RPE von 1 bis 10, Notizen.
- Session-Typen: `Projektieren`, `Volumen`, `Power-Endurance (Route)`, `Technik`, `Onsight-Training`, `Bouldern`, `Sonstiges`.
- Eine Session enthält beliebig viele **Ticks** und **Projektversuche**.

**Ticks**
- Felder: Datum, Routenname, Gebiet bzw. Sektor, Grad, Ort (Halle oder Fels), Stil, Versuche, Notiz, Verweis auf die Session.
- Stile: `OS`, `Flash`, `RP`, `Repeat`.
- Disziplin `route` ist der Standard. `boulder` ist vorbereitet, die Fb-Skala bleibt aber vorerst ausgeblendet.

**Projekte**
- Felder: Routenname, Gebiet, Grad, Status, Startdatum, Durchstiegsdatum, Notizen zu Crux und Beta.
- Status: `aktiv`, `pausiert`, `geschafft`, `aufgegeben`.
- Ein **Projektversuch** gehört zu einer Session und enthält: Anzahl Versuche, höchsten Punkt (Freitext und optional Prozent der Route), Notiz.
- Bei einem RP-Tick auf ein Projekt wird angeboten, das Projekt als `geschafft` zu setzen.

**Gradskala:** französisch, `5a` bis `9c` mit `+`, als geordnete Liste. **Halle und Fels werden kombiniert ausgewertet.** Das Feld `Ort` bleibt trotzdem gespeichert, damit später gefiltert werden kann.

### 3.3 Hangboard
Drei feste Session-Typen plus eigene Trainings. Jeder Satz bzw. Block speichert die **Ausführungsart**:
- `lift_one_arm`: einarmig vom Boden angehobenes Gewicht (Block bzw. No-Hang). Die Last ist das gehobene Gewicht in kg, die Seite wird angegeben, auch abwechselnd.
- `hang_one_arm`: einarmig am Hangboard. Last wie bei `hang_two_arm` (positiv = Zusatzgewicht, negativ = Entlastung), Wert `(KG + Last) / KG` an einer Hand.
- `hang_two_arm`: beidarmig am Hangboard. Die Last ist Zusatzgewicht in kg: **positiv** bedeutet Zusatzgewicht, **negativ** bedeutet Entlastung über eine Umlenkrolle (Beispiel: `-10` ergibt Körpergewicht minus 10 kg).

**Typen**
- `Strength` (Maximalkraft): Hängezeit in s, Pause in s, Leiste in mm (Standard **20**), Griffart, Last, Wiederholungen, Sätze.
- `PowerEndurance` (Repeater): Belastung/Pause in s (z.B. 7/3, 7/2), Leiste in mm, Griffart, Last, Wiederholungen pro Satz, Sätze, Seitenwechsel (ja/nein).
- `PullUp`: Wiederholungen, Zusatzgewicht in kg, Sätze, Pause in s.
- `Custom` (Eigenes Training): frei benannt (`name`), Blöcke mit allen Feldern; Ausführung pro Block `lift_one_arm`, `hang_two_arm` oder `pullup`. Einheiten mit gleichem Namen bilden eine eigene Verlaufsserie. Der Import aus `Hangboard.txt` erzeugt keine eigenen Trainings.

Griffarten: `halfcrimp`, `open`, `slope`, `fullcrimp`, `pinch`.

**Abgeleiteter Wert** für Vergleiche über die Zeit:
- bei `hang_two_arm`: `(KG + Last) / KG` in % vom Körpergewicht
- bei `lift_one_arm`: `Last / KG` in % vom Körpergewicht pro Hand

Für KG wird das Körpergewicht aus 3.6 genommen, und zwar der letzte Eintrag am oder vor dem Datum der Session.

**Allgemein für alle Hangboard-Sessions:** Dauer und RPE (für sRPE), Aufwärmen (ja/nein), Notizen, sowie die Originalzeile `raw` bei importierten Einträgen.

### 3.4 Kraft & Prävention (ehemals RehabBoard)
Das Modul übernimmt RehabBoard **vollständig**, sowohl die Funktionen als auch das Datenformat. Referenz ist der Code unter `../RehabBoard/public/app.js`, `index.html` und `style.css`.

- **Sitzungsarten:** `home` und `physio`. Physio-Termine bleiben eigens markiert und in der Liste filterbar.
- **Übungsformat** wie in RehabBoard:
  - Kraft: `{ name, type: "strength", groups: [{ sets, reps, weight, warmup }], note? }`
  - Frei: `{ name, type: "free", category, description, duration? }` mit den Kategorien `Aufwärmen`, `Schnellkraft`, `Isometrie`, `Mobilität`, `Test`, `Sonstiges`
- **Übernommene Ansichten:**
  - Sitzungsliste mit Filter (alle, zu Hause, Physio)
  - Editor mit Autovervollständigung der Übungsnamen und Hinweis auf die letzte Ausführung derselben Übung
  - Letzte Sitzung
  - Sitzungen pro Woche
  - Volumen pro Woche (kg × Wiederholungen)
  - Fortschritt beim Arbeitsgewicht
  - Übungsverlauf
  - Häufigste Übungen
  - Trainingskalender
- **Neu:** Dauer und RPE pro Sitzung, beide optional, damit sie in die sRPE eingehen. Alte Sitzungen haben diese Werte nicht und werden in der Belastungsrechnung übersprungen.
- **Wichtig: Übungsnamen werden NICHT zusammengeführt oder normalisiert.** Zum Beispiel bleiben „Innenrotation“ und „Innenrotation (seitlich liegend)“ zwei verschiedene Übungen.

### 3.5 Ausdauer (Laufen und Rad)
- **Quelle ist Strava.** Die Coros-Uhr synchronisiert automatisch zu Strava, ein eigener Coros-Import ist nicht nötig.
- **Import über den Strava-Connector** von claude.ai (Capability `mcp`, siehe 10.5). Die Synchronisierung startet manuell über einen Button und holt alle Aktivitäten seit dem letzten Import.
- **Gefilterte Sportarten:** Run, TrailRun, Ride, GravelRide, MountainBikeRide, VirtualRide. Alles andere wird ignoriert oder optional als „Sonstiges“ übernommen.
- **Gespeicherte Felder:** Strava-ID (für die Duplikatprüfung), Datum, Sportart, Name, Dauer (Bewegungszeit), Distanz, Höhenmeter, durchschnittliche und maximale Herzfrequenz, Rohdaten zur Belastung, sofern vorhanden.
- **RPE:**
  - Beim Import wird eine RPE vorgeschlagen, abgeleitet aus Herzfrequenz bzw. Zeit in den Zonen (`get_athlete_zones`). Max bestätigt oder ändert sie in einer Import-Vorschau.
  - Daraus ergibt sich sRPE, die gemeinsame Einheit.
  - Der Coros Training Load ist über Strava nicht verfügbar, deshalb wird er nicht verwendet.
- **Manueller Eintrag** ist als Fallback ebenfalls möglich.

### 3.6 Körpergewicht
- Eine einfache Zeitreihe aus Datum und kg. **Startwert: 75 kg (13.11.2026).**
- Dient für die Prozentwerte vom Körpergewicht beim Hangboard und bei Tests.

### 3.7 Tests (Benchmarks)
- Felder: Datum, Testart, Protokoll, Ergebnis, Körpergewicht, Notiz.
- **Testarten:**
  - `max_hang` (Leiste in mm, Zeit in s, Zusatzgewicht in kg, beidarmig)
  - `max_pullup` (Wiederholungen, Zusatzgewicht in kg)
  - `pullup_test` und `stuetz_test` (aus RehabBoard, frei beschrieben)
  - eigene Tests frei definierbar
- **Referenz vor der Verletzung (Frühling 2026)**, markiert mit `isReference: true` und in allen Testdiagrammen als horizontale Linie dargestellt:
  - Max Hang: **25 mm, 5 s, +37 kg** beidarmig. Das ergibt 149 % vom Körpergewicht, gerechnet mit 75 kg. Das Körpergewicht zum Testzeitpunkt ist unbekannt, deshalb ist dieser Wert editierbar.
  - Max Pull-up: **2 Wiederholungen mit +40 kg**.
  - Datum: als `2026-04-01` speichern und als ungefähr kennzeichnen (Feld `dateApprox: true`).
- **Hinweis zur Leistengröße:** Der Test lief auf 25 mm, das Training läuft meist auf 20 mm. Werte mit unterschiedlichen Leisten werden nicht direkt verglichen, sondern getrennt dargestellt.

### 3.8 Planung
- **Trainingsblöcke:** Name, Typ, Start- und Enddatum, Ziel bzw. Fokus, Notizen. Typen: `Basis`, `Kraft`, `Power`, `Power-Endurance`, `Performance`, `Deload`, `Übergang`. Sie werden als Zeitleiste dargestellt. **Die konkreten Blöcke legt Max zusammen mit Claude fest.** Die App muss sie nur anlegen und bearbeiten können. Ein konkretes 8a-Projekt gibt es aktuell nicht.
- **Wochenvorlage**, als Standard bereits angelegt:

  | Tag | Standard | Sommer-Variante |
  |---|---|---|
  | Mo | Ruhetag | Ruhetag |
  | Di | Klettern | Klettern |
  | Mi | Kraft & Prävention + Laufen | wie Standard |
  | Do | Kraft & Prävention + Hangboard | wie Standard |
  | Fr | Laufen + Mobility | wie Standard |
  | Sa | Klettern | **Radfahren** |
  | So | Klettern **oder** Hangboard | wie Standard |

  - Die Sommer-Variante gilt in einem frei einstellbaren Zeitraum, Standard ist Juni bis September.
  - Ein Block kann eine eigene Vorlage haben, die die Standard-Vorlage überschreibt.
- **Geplante Einheiten:** entstehen aus der Vorlage für eine Woche und lassen sich pro Tag anpassen.
  - Felder: Modul, Typ, Zielwerte (optional Dauer und Ziel-RPE), Notiz.
  - Bei „oder“-Tagen wird die Einheit als Alternative hinterlegt, jede der Alternativen gilt als erfüllt.
- **Abgleich geplant mit tatsächlich:** automatisch über Datum und Modul. Eine Einheit ist erledigt, wenn am selben Tag eine passende tatsächliche Einheit existiert. Ohne Treffer gilt sie bis zum Ende des Tages als `offen`, danach als `ausgelassen`. Einheiten ohne Plan erscheinen als `zusätzlich`.

### 3.9 Analyse
- **Grad-Pyramide:** Halle und Fels kombiniert, nach Stil eingefärbt, wahlweise für die letzten 12 Monate oder gesamt, mit 8a als Zielmarke. Zusätzlich die Soll-Pyramide (z.B. 8a: 1, 7c+: 2, 7c: 4, 7b+: 8) zum Vergleich.
- **Belastung:**
  - sRPE pro Tag und Woche, nach Modul.
  - ACWR mit EWMA, akut 7 Tage und chronisch 28 Tage, also λ = 2/(N+1).
  - Markierungen bei ACWR > 1,5 und < 0,8.
  - Die Werte erst ab 28 Tagen mit Daten anzeigen.
- **Hangboard:** Verlauf in % vom Körpergewicht, getrennt nach Ausführungsart, Griff und Leiste, mit Referenzlinie.
- **Kraft & Prävention:** die RehabBoard-Diagramme.
- **Projekte:** Zeitleiste mit Versuchen pro Session und Fortschritt beim höchsten Punkt.
- **Wochenreview mit Claude** (Phase 4, Capability `sample`):
  - Auf Knopfdruck geht eine kompakte JSON-Zusammenfassung der Woche an Claude: geplante und tatsächliche Einheiten, sRPE, ACWR, Ticks, Hangboard-Werte.
  - Zurück kommt ein kurzer Rückblick mit Empfehlung für die nächste Woche.
  - Er wird in `reviews` gespeichert.

## 4. Datenmodell

Alle Dokumente haben `id` (String), `createdAt` und `updatedAt` (ISO-Zeitpunkt). Datumsfelder sind `YYYY-MM-DD`.

| Collection | Inhalt |
|---|---|
| `climb_sessions` | Klettersessions mit `ticks[]`-IDs bzw. Referenzen und `projectAttempts[]` (eingebettet: `{ projectId, attempts, highpoint, highpointPct?, note }`) |
| `ticks` | Ticks (Verweis auf die Session über `sessionId`, optional `projectId`) |
| `projects` | Projekte |
| `hangboard_sessions` | Hangboard-Sessions mit eingebetteten `blocks[]` (`{ mode, work_s, rest_s, edge_mm, grip, load_kg, reps, sets, side, switching, raw? }`) |
| `strength_sessions` | Kraft & Prävention (RehabBoard-Format, `kind: home|physio`, `exercises[]`, dazu `duration_min?`, `rpe?`) |
| `endurance_activities` | Laufen und Rad (`source: strava|manual`, `stravaId?`) |
| `bodyweight` | `{ date, kg }` |
| `tests` | Benchmarks |
| `plan_blocks` | Trainingsblöcke |
| `plan_templates` | Wochenvorlagen (`days: { mon: [unit], … }`, `variant: standard|summer`, `validFrom/To?`) |
| `plan_units` | konkrete geplante Einheiten |
| `reviews` | Wochenreviews von Claude |
| `settings` | ein Dokument `settings/main`: Sommerzeitraum, Standard-Leiste, Soll-Pyramide, letzter Strava-Sync |

**Gemeinsame Felder für die Belastung** in jeder Session- bzw. Aktivitäts-Collection: `duration_min`, `rpe`. Daraus wird `srpe = duration_min × rpe` **berechnet und nicht gespeichert**.

## 5. Datenimport (einmalig, wiederholbar)

Eine eigene **Import-Ansicht** in der App:
1. Datei auswählen.
2. Die Datei wird im Browser geparst.
3. Es erscheint eine **Vorschau**, in der sich die Zuordnung pro Eintrag korrigieren lässt.
4. Erst danach wird geschrieben.

**Der Import ist idempotent:** Stabile IDs aus der Quelle verhindern Duplikate, und ein bereits vorhandener Eintrag wird übersprungen oder optional überschrieben.

### 5.1 RehabBoard: `../RehabBoard/data/sessions.json`
- Format: `{ version, sessions: [ { id, date, kind, notes, exercises[] } ] }`. Es gibt 61 Sitzungen vom 27.07. bis 12.11.2026, davon 55 `home` und 6 `physio`.
- Die Daten werden **1:1** nach `strength_sessions` übernommen. Die ID bleibt `s-…`, das Feld `raw` an Übungen bleibt erhalten, Namen werden nicht verändert.
- Freie Übungen der Kategorie `Test` (z.B. „Pullup-Test“, „Stütz-Test“) bleiben in der Sitzung **und** werden zusätzlich als Eintrag in `tests` vorgeschlagen, mit Bestätigung in der Vorschau.

### 5.2 Hangboard: `./Hangboard.txt`
- Freitext-Notizen vom 06.09. bis 12.11.2026, 16 Einheiten.
- Das Jahr fehlt in den Datumsangaben und wird als 2026 angenommen.
- IDs: `hb-YYYYMMDD`.
- **Die Originalzeile wird immer als `raw` gespeichert.** Nicht erkannte Zeilen landen in den Notizen und werden in der Vorschau markiert.

**Erkannte Muster** (die Groß- und Kleinschreibung bzw. Tippfehler wie `Strengh` tolerieren):

| Zeile | Bedeutung |
|---|---|
| `DD.MM. Strengh` bzw. `Strength`, `PowerEndurance`, `PullUp` | Kopfzeile einer Session mit Typ |
| `- progressive warmup`, `- Warmup` | Aufwärmen = ja |
| `- 7 s work 3 min pause` | Protokoll für die folgenden Strength-Zeilen: Hängezeit 7 s, Pause 180 s |
| `- 18kg * 4 (halfcrimp)` | Last 18, Wiederholungen 4, Griff halfcrimp |
| `- 7/3 25kg*24` | Belastung 7 s, Pause 3 s, Last 25, Wiederholungen 24, 1 Satz |
| `- 7/2 26kg*22 (2sets)`, `… 3sets`, `… 2sets` | wie oben, mit Satzanzahl |
| `- 7/3 22kg switching sides` | Seitenwechsel, Wiederholungen unbekannt |
| `- 20s switching sides` | freier Block, kommt in die Notiz und wird geprüft |
| `- 7/3 * 20 Hangboard -10kg 3sets` | **`hang_two_arm`**, Last −10 (Entlastung), Wiederholungen 20, 3 Sätze |
| `5 Pullups +19kg` / `Work / 3min Pause` / `6 sets` | PullUp: 5 Wiederholungen, +19 kg, Pause 180 s, 6 Sätze |

**Standard-Ausführungsart:**
- `PowerEndurance` mit kg-Angabe ohne „Hangboard“ ist **`lift_one_arm`** (bestätigt).
- **`Strength`: OFFEN, Max fragen.** Unklar ist, ob die Einträge vom 06.09. bis 25.10. (z.B. 18–21 kg halfcrimp, 6–10 kg open, 16 kg slope) einarmig gehoben oder beidarmig am Board ausgeführt wurden. Bis zur Klärung ist der Standard `lift_one_arm`, der Wert ist in der Vorschau pro Eintrag umschaltbar.
- Leiste: Standard 20 mm, sofern nicht angegeben.

## 6. Oberfläche

- **Navigation:** Seitenleiste mit Dashboard, Planung, Klettern, Hangboard, Kraft & Prävention, Ausdauer, Tests, Analyse, Import, Einstellungen.
- **Routing über den Hash:** nur einfache Namen wie `#dashboard`, `#climbing`, `#hangboard`, `#strength`, `#endurance`, `#tests`, `#plan`, `#analysis`, `#import`, `#prefs`. Keine Pfade oder Parameter im Hash. Die Namen `settings`, `sidebar`, `customize`, `upgrade`, `downloads` und `comment-*` sind von claude.ai reserviert und dürfen nicht verwendet werden, deshalb heißt die Einstellungsseite `#prefs`.
- **Schnelleintrag:** ein globaler Button „+ Einheit“ mit Auswahl des Moduls. Datum, Ort und Halle werden mit den Werten der letzten Einheit vorbelegt.
- **Stil:** Das RehabBoard-CSS (`../RehabBoard/public/style.css`) dient als Ausgangspunkt. Hell- und Dunkelmodus, ruhige Gestaltung, die Modulfarben sind konsistent über alle Diagramme.
- **Sprache:** Oberfläche auf Deutsch, Code und Bezeichner auf Englisch.

## 7. Phasen

| Phase | Inhalt | Fertig, wenn … |
|---|---|---|
| **1 – Grundgerüst und Import** | Projektstruktur, Speicher-Abstraktion (lokal und Claude-DB), Navigation, Modul Kraft & Prävention (RehabBoard-Funktionsumfang), Hangboard-Modul, Körpergewicht, Tests mit Referenzwerten, Import-Ansicht für RehabBoard und Hangboard.txt | alle 61 RehabBoard-Sitzungen und alle Hangboard-Einheiten korrekt importiert und dargestellt sind und RehabBoard ersetzt werden kann |
| **2 – Klettern und Planung** | Sessions, Ticks, Projekte, Gradskala, Wochenvorlage (Standard und Sommer), Blöcke, geplante Einheiten, Abgleich, Dashboard | sich eine Woche vollständig planen und erfassen lässt |
| **3 – Ausdauer und Strava** | Strava-Import mit Vorschau und RPE-Vorschlag, manuelle Einträge, Belastungsrechnung über alle Module (sRPE, ACWR) | Strava-Aktivitäten ohne Duplikate importiert werden und die ACWR stimmt |
| **4 – Analyse und Claude** | Pyramide inkl. Soll-Pyramide, alle Verlaufsdiagramme, Wochenreview über `sample`, JSON-Backup und -Export über `downloads` | |
| **5 – Handy** | Mobiles Layout, Schnelleintrag in der Halle bzw. am Fels | |

## 8. Offene Punkte

1. **Hangboard-Strength-Einträge** vom 06.09. bis 25.10.: einarmig gehoben oder beidarmig am Board? Max fragen.
2. **Körpergewicht beim Test im Frühling** ist unbekannt, als Annahme gilt 75 kg.
3. **Trainingsblöcke** werden nach Phase 2 gemeinsam mit Claude ausgearbeitet.
4. **Soll-Pyramide** gemeinsam festlegen. Der Vorschlag in 3.9 ist ein Platzhalter.

## 9. Nicht im Umfang (vorerst)

- Bouldern mit Fb-Skala. Das Feld ist vorbereitet.
- Eigene Coros-Anbindung, weil Coros zu Strava synchronisiert.
- Mehrbenutzerbetrieb und Teilen. Die App ist nur für Max.

---

## 10. Technische Vorgaben für Claude Code

### 10.1 Stack
- **Kein Build-Schritt.** Nur Vanilla JavaScript (ES-Module), HTML und CSS, damit die Dateien unverändert veröffentlicht werden können.
- **Diagramme:** die eigenen SVG-Diagrammfunktionen aus RehabBoard (`barChart`, `lineChart`, `sparkline`, `niceTicks`) übernehmen und erweitern. Falls nötig ist auch **Chart.js 4 über `cdnjs.cloudflare.com`** erlaubt. Andere Hosts werden von der Content Security Policy des Artifacts blockiert.
- **Schriften** nur über Google Fonts. Bilder und Icons als Inline-SVG oder `data:`-URI. Remote-Bilder laden nicht.

### 10.2 Dateistruktur (Vorschlag)
```
Elevate2.0/
  index.html            # Einstieg, <title>Elevate</title>
  css/app.css
  js/main.js            # Start, Routing über den Hash
  js/store/index.js     # Speicher-Abstraktion: wählt das Backend
  js/store/claudeDb.js  # Backend für Produktion (claude.use("db"))
  js/store/localDb.js   # Backend für die lokale Entwicklung (localStorage oder IndexedDB)
  js/domain/            # grades.js, load.js (sRPE, ACWR), hangboard.js (% Körpergewicht), plan.js (Abgleich)
  js/modules/           # dashboard.js, climbing.js, hangboard.js, strength.js, endurance.js, tests.js, plan.js, analysis.js, import.js, prefs.js
  js/import/            # rehabboard.js, hangboardTxt.js
  js/ui/                # charts.js, dialog.js, forms.js
  PLAN.md
  Hangboard.txt         # Quelldaten für den Import (bleibt liegen)
```
Alle Pfade müssen **relativ** sein, damit sie im veröffentlichten Artifact funktionieren.

### 10.3 Speicher-Abstraktion
- **Eine Schnittstelle** für die ganze App, etwa `list(col)`, `get(col,id)`, `put(col,doc)`, `remove(col,id)`, `subscribe(col, cb)`.
- **Backend-Wahl beim Start:**
  - Ist `typeof window.claude?.use === "function"`, dann `await claude.use("db")`. Ergebnis ungleich `null` heißt `claudeDb`. Lokal existiert `window.claude` nicht, deshalb **nie direkt** auf `claude.use` zugreifen, ohne diese Prüfung.
  - Ist das Ergebnis `null` (z.B. nicht angemeldet), oder kommt nach 10 s keine Antwort, dann `localDb`. In diesem Fall ein deutlicher Hinweis „Lokaler Modus, Daten nur in diesem Browser“.
- **Regeln der Claude-DB**, Kurzfassung des Laufzeitvertrags 0.2.96:
  - `db.collection(name)` und `db.doc("col/id")`, mit get, set, update, delete, where, orderBy, limit und onSnapshot.
  - Eine ungerade Anzahl von Pfadsegmenten bezeichnet eine Collection, eine gerade Anzahl ein Dokument.
  - **Pro Collection nur einmal abonnieren**, nie beim Rendern. Die Datenmenge ist klein, deshalb werden alle Collections beim Start abonniert und im Speicher gehalten.
  - Beim Laden ein Timeout von 10 s setzen, der bei Daten oder Fehler gelöscht wird. Nie automatisch neu laden.
  - **Ein Schreibvorgang pro Dokument zur selben Zeit**, und nur bei echter Änderung.
  - Leere Datenbank sauber behandeln. **Keine Startdaten im Code festschreiben**, ausgenommen Standardwerte für Einstellungen und Vorlagen, die beim ersten Start angelegt werden, wenn sie fehlen.
  - Das Namespace-Objekt nie verändern, nur aufrufen.
- **Zugriff:** nur der Eigentümer liest und schreibt. Die Regeln dafür werden bei der Deklaration gesetzt (10.5).

### 10.4 Einschränkungen des Artifact-Rahmens (verbindlich)
- `alert`, `confirm`, `prompt`, `window.print` und Downloads per `<a download>` funktionieren nicht. **Dialoge selbst bauen**, Exporte nur über die Capability `downloads` (Phase 4). Eine Kopieren-Schaltfläche ist nur aus einem Klick-Handler erlaubt.
- **Formulare:** `submit` per Skript mit `preventDefault()` behandeln.
- `fetch` zu fremden Hosts ist blockiert. **Datei-Inputs funktionieren**, darauf baut der Import auf.
- `localStorage` nur für Komfort wie den zuletzt geöffneten Tab oder Entwürfe, und immer in `try/catch`. Im Produktivbetrieb niemals als Datenspeicher verwenden.
- Externe Links mit einfachem `<a href>`, nicht mit `window.open`.

### 10.5 Capabilities (Deklaration beim Veröffentlichen)
- **Phase 1–2:** `{ db: { rules: [ …nur Eigentümer: read "owner", write "owner" für alle Collections… ] }, user: {} }`
- **Phase 3:** zusätzlich `mcp: { servers: [ { server: "Strava", tools: ["list_activities", "get_activity_performance", "get_athlete_zones"] } ] }`
  - Die Argumente der Strava-Tools sind unbekannt. **Vor der Implementierung mit `describeTool` lesen bzw. an einem echten Aufruf beobachten, nicht raten.**
  - Für Aktionen `callTool` verwenden, Fehler nach `code` behandeln und nur `retryable` erneut versuchen. Den Datenstand anzeigen.
  - Max muss den Strava-Connector in claude.ai verbunden haben.
- **Phase 4:** zusätzlich `sample: {}` (Wochenreview) und `downloads: true` (Backup und Export).
- Vor jeder Phase die genaue API mit `describe_capabilities` in der Veröffentlichungs-Session prüfen. Die Kurzfassungen hier stammen aus dem Vertrag 0.2.96.

### 10.6 Qualität
- **Domain-Logik** (Grade, sRPE, ACWR, % Körpergewicht, Plan-Abgleich, beide Import-Parser) als reine Funktionen schreiben und mit kleinen Tests absichern, z.B. `node --test`.
- **Die Parser gegen die echten Dateien testen:**
  - `../RehabBoard/data/sessions.json`: genau 61 Sitzungen, Übungsnamen unverändert.
  - `./Hangboard.txt`: alle Kopfzeilen erkannt, keine stillschweigend verworfenen Zeilen.
- **Die Quelldateien in `../RehabBoard` nur lesen, nie verändern.**
