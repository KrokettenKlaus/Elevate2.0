# Elevate 2.0 – Übergabe und Plan

Stand: 2026-11-14. Dieses Dokument ersetzt das bisherige `PLAN.md` (Plan vom 13.11.2026). Es beschreibt, was gebaut ist, was davon wirklich geprüft wurde, was offen ist und nach welchen Regeln weitergearbeitet wird.

**Für dich als Claude, der hier weitermacht:** Lies zuerst Abschnitt 1 bis 4. Abschnitt 5 bis 9 sind Nachschlagewerk. Der Code ist die Wahrheit über das *Wie*; dieses Dokument hält das *Warum*, die Entscheidungen von Max und den Prüfstand fest. Wenn Code und Dokument sich widersprechen, gilt der Code – korrigiere dann das Dokument.

---

## 1. Worum es geht

Elevate ist das persönliche Trainings-Logbuch von Max: Sportklettern (aktuell 7c, Ziel 8a), Hangboard, Kraft & Prävention (Schulter-Reha seit Juni 2026, aktuell ohne Einschränkungen), Laufen, Radfahren und Trainingsplanung. Nur Max nutzt die App.

Ziele, an denen sich jede Entscheidung misst:

- Eine App mit einer gemeinsamen Datenbasis für alle Trainingsbereiche.
- Fortschritt Richtung 8a sichtbar machen: Grad-Pyramide, Projekte, Fingerkraft im Vergleich zum Wert vor der Verletzung.
- Belastungssteuerung über alle Sportarten mit **sRPE** (RPE × Minuten) und ACWR.
- Planung: Trainingsblöcke, Wochenvorlage, geplante Einheiten, Abgleich mit den tatsächlichen Einheiten.
- RehabBoard (`../RehabBoard`) vollständig ersetzen, mit allen bestehenden Daten.
- Desktop zuerst; das Layout ist responsiv angelegt, die Handy-Nutzung ist noch nicht gezielt geprüft.

## 2. Wo das Projekt steht

### 2.1 Kurzfassung

- Alle Module aus Abschnitt 5 sind gebaut. `npm test` läuft mit 33 Tests grün.
- Die App ist als **privates Claude-Artifact** veröffentlicht, aktuell Version 2:
  https://claude.ai/artifact/HPNB9pF72a3ShKsGS41Xjn
- Der Ausdauer-Import läuft seit dem 14.11. über **Coros** statt Strava (Abschnitt 6).
- **Im echten Artifact ist fast nichts geprüft.** Max hat am 14.11. die lokale Version (`localhost:5173`) getestet und für das Artifact gehalten. Seine Daten liegen deshalb nur im Browser-Speicher von `localhost:5173`.

### 2.2 Prüfstand je Funktion

„Lokal“ heißt: Tests, Browser-Check mit Headless-Edge oder Max' eigene Nutzung auf `localhost:5173`. „Im Artifact“ heißt: auf claude.ai mit echter Laufzeit beobachtet.

| Funktion | Lokal | Im Artifact |
|---|---|---|
| Einträge anlegen und bearbeiten | geprüft (Max, 14.11.) | ungeprüft |
| Datenbank (`db`) | gegen Nachbau getestet | **schreibt**: Startwerte vom 13.11. liegen dort (Einstellungen, 2 Wochenvorlagen, 75 kg, 2 Referenztests) |
| Import RehabBoard, `Hangboard.txt` | geprüft (Tests gegen die echten Dateien, Max) | ungeprüft |
| Import eines Backups | gebaut | ungeprüft |
| Backup und Export | geprüft (lokal über Download-Link) | ungeprüft (läuft dort über `downloads`) |
| Coros-Abruf | Tool-Antworten am echten Connector gelesen, Leser mit 4 Tests, Dialog mit nachgestelltem Connector im Browser geprüft | **ungeprüft** – offen, ob ein selbst hinzugefügter Connector aus dem Artifact aufrufbar ist |
| Wochenreview (`sample`) | nicht möglich | ungeprüft, noch nie echt gelaufen |
| Handy-Layout | Breakpoints bei 1100 px und 860 px vorhanden | ungeprüft |

### 2.3 Was am 14.11. geändert wurde

- Neu: `js/domain/coros.js`, `js/services/coros.js`, `tests/coros.test.js`.
- Geändert: `js/domain/endurance.js` (RPE-Vorschlag aus Trainingsbelastung, Sport-Labels), `js/modules/endurance.js` (Coros-Dialog), `js/modules/prefs.js`, `js/modules/open.js`, `js/store/defaults.js` (`corosLastSync`), `README.md`.
- Manifest: Strava entfernt, Coros mit zwei Lese-Tools eingetragen.
- `js/services/strava.js` und die Strava-Funktionen in `js/domain/endurance.js` bleiben liegen, sind aber nicht angebunden. Max will Strava „evtl. später“; nicht löschen.

### 2.4 Zustand der Arbeitsumgebung

- **Git:** Nichts ist committet. `git rev-parse --show-toplevel` liefert `C:/Users/Max` – das Repo liegt im Benutzerordner, der Projektordner ist dort nur eine unversionierte Datei unter vielen. Ein eigenes Repo im Projektordner (`git init`) wäre sinnvoll, aber erst nach Rückfrage bei Max.
- **Lokaler Server:** Max startet ihn selbst mit `npm start` (Port 5173). Für eigene Prüfungen einen zweiten Port nehmen (`PORT=5199`), seinen Prozess nicht beenden.
- **Claude-Code-Notizen:** `C:\Users\Max\.claude\projects\C--Users-Max\memory\elevate-2-0.md` enthält denselben Stand in Kurzform. Nach größeren Schritten dort mitpflegen.

## 3. Nächste Schritte

In dieser Reihenfolge. Schritt 1 bis 3 brauchen Max, weil nur er das Artifact auf claude.ai bedienen kann.

1. **Coros-Abruf im Artifact prüfen.** Max öffnet den Artifact-Link, geht auf *Ausdauer → Coros synchronisieren*, bestätigt die Anfrage von claude.ai.
   - Fertig, wenn die Vorschau seine Läufe und Radfahrten seit dem gewählten Datum zeigt und der Import sie ohne Duplikate speichert.
   - Bei Fehlern: Fehlermeldung und „Technische Details zum Abruf“ geben lassen. Die Meldungen sind nach Fehlercode getrennt (`corosErrorMessage` in `js/services/coros.js`).
   - Scheitert es grundsätzlich an eigenen Connectoren: Ausweichweg ist ein Datei-Import aus dem Coros Training Hub (Sammelexport als FIT oder TCX). Das wäre neu zu bauen.
2. **Daten ins Artifact bringen.** Lokal unter *Einstellungen → Backup und Export* sichern, im Artifact unter *Import → Elevate-Backup* einspielen. Alternativ dort RehabBoard und `Hangboard.txt` neu importieren; dann fehlen aber von Hand angelegte Einträge.
   - Fertig, wenn `ArtifactData list` für `strength_sessions` mindestens 61 und für `hangboard_sessions` mindestens 16 Dokumente zeigt (so viele liefern die beiden Quelldateien).
3. **Rest im Artifact prüfen:** Export (fragt über `downloads` nach), Wochenreview (fragt beim ersten Aufruf nach Zustimmung, verbraucht Max' Claude-Kontingent).
4. **Entscheidung von Max einholen: Hangboard-Maximalkraft 06.09.–25.10.** Einarmig vom Boden gehoben oder beidarmig am Board gehängt? Eingestellt ist `lift_one_arm`. Die Lasten (18–21 kg Halfcrimp, 6–10 kg Open, 16 kg Sloper) sprechen eher für beidarmig mit Zusatzgewicht. Die Antwort ändert die Prozentwerte vom Körpergewicht deutlich; nach der Antwort die betroffenen Einträge umstellen (in der Import-Vorschau pro Eintrag umschaltbar, sonst im Editor).
5. **RPE-Vorschlag eichen.** Die Stufen in `LOAD_RATE_RPE` (`js/domain/endurance.js`) sind eine Schätzung aus nur zwei Einheiten (Abschnitt 6.4). Max fragen, ob die Vorschläge zu seinem Gefühl passen, dann nachstellen.
6. **Mit Max gemeinsam festlegen:** Trainingsblöcke und Soll-Pyramide. Die App kann beides anlegen und bearbeiten; die Soll-Pyramide `8a: 1, 7c+: 2, 7c: 4, 7b+: 8` ist ein Platzhalter. Ein konkretes 8a-Projekt gibt es noch nicht.
7. **Kleinigkeiten, die schon bekannt sind:**
   - `js/modules/analysis.js` sagt beim Wochenreview noch „nur im veröffentlichten Artifact verfügbar“, auch wenn man im Artifact ist und nur `sample` fehlt. Lokale Version und fehlende Fähigkeit getrennt benennen, so wie im Coros-Dialog.
   - Einzahl/Mehrzahl: „1 Aktivitäten importieren“.
   - Das Körpergewicht beim Referenztest im Frühling ist unbekannt und mit 75 kg angenommen (im Test editierbar).
8. **Ideen, nicht beauftragt** – erst vorschlagen, nicht einfach bauen:
   - Ruhepuls, HRV, Schlaf und Erholungsstatus aus Coros in die Belastungsauswertung nehmen (Tools in Abschnitt 6.5).
   - Kraft-Einheiten von der Uhr nutzen, um Dauer und Puls der Sitzungen in *Kraft & Prävention* zu füllen, statt sie als „Sonstiges“ doppelt zu zählen.
   - Handy-Layout gezielt durchgehen, Schnelleintrag in der Halle.

## 4. Arbeitsregeln

### 4.1 Zusammenarbeit mit Max

- Max schreibt Deutsch; antworte auf Deutsch. Oberfläche auf Deutsch, Code und Bezeichner auf Englisch.
- **Wenn Max meldet, dass etwas (nicht) funktioniert: zuerst klären, in welcher Ansicht.** Lokal steht oben der Hinweis „Lokaler Modus, Daten nur in diesem Browser“. Was wirklich in der Artifact-Datenbank liegt, zeigt `ArtifactData` mit `action: "list"` und der Artifact-URL – das ist der schnellste Beleg.
- Offene Entscheidungen (Abschnitt 3, Punkt 4 bis 6) gehören Max. Empfehlung geben, nicht selbst festlegen.
- Sag bei jeder Übergabe klar, was geprüft ist und was nicht. Der Unterschied zwischen „lokal geprüft“ und „im Artifact geprüft“ hat am 14.11. schon einmal für Verwirrung gesorgt.

### 4.2 Feste Regeln für den Code

Diese Regeln stammen aus Max' ursprünglichem Plan oder aus dem Laufzeitvertrag der Artifacts und gelten weiter:

- **Kein Build-Schritt.** Nur Vanilla JavaScript (ES-Module), HTML, CSS. Die Dateien werden unverändert veröffentlicht. Alle Pfade relativ.
- **`../RehabBoard` nur lesen, nie verändern.** `Hangboard.txt` bleibt als Quelldatei liegen.
- **Übungsnamen nie zusammenführen oder normalisieren.** „Innenrotation“ und „Innenrotation (seitlich liegend)“ sind zwei Übungen.
- **Connector-Argumente und Antwortformate nie raten.** Vor dem Bauen das Schema lesen oder einen echten, ungefährlichen Lese-Aufruf beobachten. Ist der Connector in der Session nicht sichtbar (`mcp__claude_ai_…`), muss Max die Session neu starten; Connectoren werden nur beim Start geladen.
- **Echte Daten von Max nie als Beispiel- oder Testdaten in den Code schreiben.** Tests nutzen erfundene Werte im echten Format.
- **`srpe` wird berechnet, nie gespeichert** (`duration_min × rpe`).
- **Import ist idempotent:** stabile IDs aus der Quelle (`s-…`, `hb-YYYYMMDD`, `coros-<labelId>`), vorhandene Einträge werden übersprungen. Geschrieben wird erst nach einer Vorschau.
- **Keine Startdaten im Code**, außer den Standardwerten, die `js/store/defaults.js` beim ersten Start anlegt. `settings.seeds` merkt sich, was angelegt wurde, damit Gelöschtes nicht wiederkommt.
- Domain-Logik als reine Funktionen in `js/domain/`, mit Tests (`node --test`). Parser werden gegen die echten Dateien getestet: genau 61 RehabBoard-Sitzungen, alle Kopfzeilen in `Hangboard.txt` erkannt, keine stillschweigend verworfenen Zeilen.

### 4.3 Grenzen des Artifact-Rahmens

- `alert`, `confirm`, `prompt`, `window.print` und `<a download>` funktionieren im Artifact nicht. Dialoge kommen aus `js/ui/dialog.js`, Dateien gehen über die Fähigkeit `downloads` (`saveFile` in `js/services/backup.js`). Kopieren nur aus einem Klick-Handler.
- `fetch` zu fremden Hosts ist blockiert. Datei-Inputs funktionieren; darauf baut der Import auf.
- Skripte nur von `cdnjs.cloudflare.com` (und den wenigen anderen erlaubten CDNs), Schriften nur über Google Fonts, Bilder und Icons als Inline-SVG oder `data:`-URI.
- `localStorage` im Artifact nur für Komfort (zuletzt geöffnete Ansicht, Theme), immer in `try/catch`. Daten gehören in `db`.
- Hash-Routing nur mit einfachen Namen. `settings`, `sidebar`, `customize`, `upgrade`, `downloads` und `comment-*` sind von claude.ai reserviert; die Einstellungsseite heißt deshalb `#prefs`.
- Formulare: `submit` per Skript mit `preventDefault()`. Externe Links als einfaches `<a href>`.

### 4.4 Laufzeit-Fähigkeiten (`window.claude`)

- Zugriff ausschließlich über `cap(name)` aus `js/services/caps.js`. Das prüft, ob `window.claude.use` existiert (lokal nicht), und liefert sonst `null`. Jede Funktion muss mit `null` umgehen können.
- `hasRuntime()` unterscheidet nur „lokale Kopie“ von „Seite mit Laufzeit“. Eine Fähigkeit kann auch im Artifact `null` sein.
- Zustimmung fragt claude.ai beim ersten *Aufruf* ab, nicht bei `use()`. Aufrufe deshalb nur aus einem Klick, nie in einer Schleife. Fehler nach `code` behandeln, nur `retryable` einmal wiederholen.
- Das von `use()` gelieferte Objekt ist eingefroren: nur aufrufen, nie verändern.
- Vor Änderungen an `db`, `mcp`, `sample` oder `downloads` den Skill `artifact-capabilities` laden und die Typdefinitionen des Vertrags lesen. Sie sind maßgeblich, nicht dieses Dokument.

### 4.5 Veröffentlichen

Veröffentlicht wird aus Claude Code mit dem `Artifact`-Tool (der alte Plan nannte noch eine eigene claude.ai-Session; das ist überholt).

1. In einer neuen Session zuerst lesen: `Artifact` mit `action: "read"` und der URL.
2. Veröffentlichen mit `url` = Artifact-Link, `file_path` = `index.html`, `root` = Projektordner, `files` = die geänderten Dateien mit unveränderten relativen Pfaden. Nicht genannte Dateien bleiben erhalten.
3. **`capabilities` weglassen**, solange sich am Manifest nichts ändert – dann bleibt die gespeicherte Deklaration. Wer `capabilities` übergibt, muss alle fünf Einträge vollständig wiederholen, sonst werden die fehlenden entzogen.
4. Nicht veröffentlicht werden `tests/`, `tools/`, `Hangboard.txt`, `PLAN.md`, `opus.md`, `README.md`, `package.json`.
5. Veröffentlichen ändert, was Max auf claude.ai sieht. Nur tun, wenn Max die Änderung beauftragt hat.

Aktuelles Manifest (Laufzeitvertrag 0.2.96):

```json
{
  "db": { "rules": [{ "path": "", "read": "owner", "write": "owner" }] },
  "user": {},
  "mcp": { "servers": [{ "server": "Coros", "tools": ["querySportRecords", "getActivityDetail"] }] },
  "sample": {},
  "downloads": true
}
```

Beim Veröffentlichen aus einer Session heißt der Server `claude_ai_Coros`; die Plattform löst ihn zum Anzeigenamen „Coros“ auf. Im Seiten-Code steht der Anzeigename (`SERVER = 'Coros'`).

### 4.6 Prüfen vor der Übergabe

- `npm test` muss grün sein.
- Für Oberflächen-Änderungen ein Browser-Check. Auf diesem Rechner startet Headless-Chrome nicht; es funktioniert **Edge mit `puppeteer-core`**: `executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'`, `args: ['--no-first-run', '--no-sandbox', '--disable-gpu']`, frisches `userDataDir`. `puppeteer-core` nicht ins Projekt installieren, sondern in einen temporären Ordner.
- Eine Laufzeit-Fähigkeit lässt sich lokal nachstellen, indem vor dem Laden `window.claude = { use: async name => … }` gesetzt wird (`page.evaluateOnNewDocument`). So wurde der Coros-Dialog geprüft. Das ersetzt nicht die Prüfung im Artifact.
- Shell: Windows 10, PowerShell 5.1 und Git Bash. Mehrzeilige Node-Skripte als Datei schreiben und ausführen; Heredocs mit Anführungszeichen sind in Git Bash hier gescheitert.

---

## 5. Module und fachliche Vorgaben

Alle Module sind gebaut. Dieser Abschnitt hält die fachlichen Festlegungen fest, die man im Code nicht ohne Weiteres als Absicht erkennt.

### 5.1 Dashboard
Aktuelle Woche (geplant neben tatsächlich, mit Status), Belastung der letzten 6 Wochen (sRPE pro Tag, gestapelt nach Modul, mit ACWR-Linie), Fortschritt Richtung 8a (Mini-Pyramide, aktive Projekte, letzter Hangboard-Wert in % vom Körpergewicht gegen die Referenz), letzte Sitzung Kraft & Prävention.

### 5.2 Klettern
- **Sessions:** Datum, Ort (Halle oder Fels), Gebiet bzw. Halle, Typ, Dauer, RPE, Notizen. Typen: `Projektieren`, `Volumen`, `Power-Endurance (Route)`, `Technik`, `Onsight-Training`, `Bouldern`, `Sonstiges`.
- **Ticks:** Routenname, Gebiet bzw. Sektor, Grad, Ort, Stil (`OS`, `Flash`, `RP`, `Repeat`), Versuche, Notiz, Verweis auf die Session. Disziplin `route` ist Standard; `boulder` ist vorbereitet, die Fb-Skala bleibt ausgeblendet.
- **Projekte:** Status `aktiv`, `pausiert`, `geschafft`, `aufgegeben`. Ein Projektversuch gehört zu einer Session: Versuche, höchster Punkt (Freitext, optional Prozent), Notiz. Ein RP-Tick auf ein Projekt bietet an, es auf `geschafft` zu setzen.
- **Gradskala:** französisch, `5a` bis `9c` mit `+`. **Halle und Fels werden kombiniert ausgewertet**; das Feld Ort bleibt gespeichert, damit später gefiltert werden kann.

### 5.3 Hangboard
Jeder Block speichert die **Ausführungsart**:
- `lift_one_arm`: einarmig vom Boden gehobenes Gewicht. Last = gehobenes Gewicht in kg, mit Seite.
- `hang_two_arm`: beidarmig am Board. Last = Zusatzgewicht in kg; **negativ bedeutet Entlastung** über eine Umlenkrolle (`-10` = Körpergewicht minus 10 kg).

Typen: `Strength` (Hängezeit, Pause, Leiste in mm – Standard 20 –, Griff, Last, Wiederholungen, Sätze), `PowerEndurance` (Repeater, z. B. 7/3, mit Seitenwechsel), `PullUp`. Griffe: `halfcrimp`, `open`, `slope`, `fullcrimp`, `pinch`.

Vergleichswert über die Zeit, in % vom Körpergewicht:
- `hang_two_arm`: `(KG + Last) / KG`
- `lift_one_arm`: `Last / KG` pro Hand

KG ist der letzte Körpergewichts-Eintrag am oder vor dem Datum der Session. Werte mit unterschiedlicher Ausführungsart, Griffart oder Leiste werden getrennt dargestellt, nie direkt verglichen.

### 5.4 Kraft & Prävention (ehemals RehabBoard)
Übernimmt RehabBoard vollständig, Funktionen und Datenformat. Referenz bleibt `../RehabBoard/public/app.js`.
- Sitzungsarten `home` und `physio`; Physio bleibt eigens markiert und filterbar.
- Übungen: Kraft `{ name, type: "strength", groups: [{ sets, reps, weight, warmup }], note? }`, frei `{ name, type: "free", category, description, duration? }` mit den Kategorien `Aufwärmen`, `Schnellkraft`, `Isometrie`, `Mobilität`, `Test`, `Sonstiges`.
- Ansichten: Sitzungsliste mit Filter, Editor mit Autovervollständigung und Hinweis auf die letzte Ausführung, letzte Sitzung, Sitzungen pro Woche, Volumen pro Woche, Fortschritt beim Arbeitsgewicht, Übungsverlauf, häufigste Übungen, Trainingskalender.
- Dauer und RPE pro Sitzung sind optional. Alte Sitzungen haben sie nicht und zählen deshalb nicht zur Belastung.

### 5.5 Ausdauer
- Quelle ist der Coros-Connector (Abschnitt 6), dazu manuelle Einträge.
- Laufen: `Run`, `TrailRun`. Rad: `Ride`, `GravelRide`, `MountainBikeRide`, `VirtualRide`. Alles andere ist „Sonstiges“ und wird nur auf Wunsch importiert.
- Beim Import wird eine RPE vorgeschlagen; Max bestätigt oder ändert sie in der Vorschau. Ein erneuter Import überschreibt bearbeitete Einträge nicht.

### 5.6 Körpergewicht und Tests
- Körpergewicht: Zeitreihe aus Datum und kg. Startwert 75 kg (13.11.2026); das Coros-Profil nennt ebenfalls 75 kg.
- Testarten: `max_hang`, `max_pullup`, `pullup_test`, `stuetz_test`, eigene.
- **Referenz vor der Verletzung** (Frühling 2026), `isReference: true`, in den Diagrammen als waagrechte Linie:
  - Max Hang: 25 mm, 5 s, +37 kg beidarmig → 149 % bei 75 kg. Das damalige Körpergewicht ist unbekannt, der Wert ist editierbar.
  - Max Pull-up: 2 Wiederholungen mit +40 kg.
  - Datum `2026-04-01`, als ungefähr markiert (`dateApprox: true`).
- Der Test lief auf 25 mm, das Training meist auf 20 mm – getrennt darstellen.

### 5.7 Planung
- **Blöcke:** Name, Typ (`Basis`, `Kraft`, `Power`, `Power-Endurance`, `Performance`, `Deload`, `Übergang`), Zeitraum, Fokus. Als Zeitleiste. Die konkreten Blöcke legt Max mit Claude fest.
- **Wochenvorlage** (als Standard angelegt):

  | Tag | Standard | Sommer |
  |---|---|---|
  | Mo | Ruhetag | Ruhetag |
  | Di | Klettern | Klettern |
  | Mi | Kraft & Prävention + Laufen | wie Standard |
  | Do | Kraft & Prävention + Hangboard | wie Standard |
  | Fr | Laufen + Mobility | wie Standard |
  | Sa | Klettern | **Radfahren** |
  | So | Klettern **oder** Hangboard | wie Standard |

  Die Sommer-Variante gilt in einem einstellbaren Zeitraum (Standard Juni bis September). Ein Block kann eine eigene Vorlage haben.
- **Abgleich:** über Datum und Modul. Erledigt, wenn am selben Tag eine passende Einheit existiert; sonst bis Tagesende `offen`, danach `ausgelassen`; Einheiten ohne Plan sind `zusätzlich`. Bei „oder“-Tagen erfüllt jede Alternative. Wochen vor `settings.planStart` zeigen keinen Abgleich.

### 5.8 Analyse
- **Pyramide:** Halle und Fels kombiniert, nach Stil gefärbt, 12 Monate oder gesamt, mit 8a als Zielmarke und Soll-Pyramide.
- **Belastung:** sRPE pro Tag und Woche nach Modul. ACWR mit EWMA, akut 7 Tage, chronisch 28 Tage, λ = 2/(N+1). Markierung über 1,5 und unter 0,8. Anzeige erst ab 28 Tagen mit Daten.
- **Hangboard, Kraft & Prävention, Projekte:** Verlaufsdiagramme.
- **Wochenreview:** `buildWeekSummary` baut eine kompakte JSON-Zusammenfassung, `buildPrompt` den Auftrag, `requestReview` schickt ihn über `sample`. Das Ergebnis liegt in `reviews` (`rev-YYYYMMDD` des Wochenbeginns). Lokal lässt sich die Anfrage kopieren.

### 5.9 Import, Backup, Einstellungen
- **Import-Ansicht:** Datei wählen → im Browser parsen → Vorschau mit Korrektur → schreiben. Quellen: RehabBoard (`../RehabBoard/data/sessions.json`, 61 Sitzungen, 1:1 nach `strength_sessions`; freie Übungen der Kategorie `Test` werden zusätzlich als Test vorgeschlagen), `Hangboard.txt` (16 Einheiten, Jahr 2026 angenommen, Originalzeile immer als `raw`, nicht erkannte Zeilen in die Notizen), Elevate-Backup.
- **Hangboard.txt:** Die erkannten Zeilenmuster stehen in `js/import/hangboardTxt.js` und `tests/import.test.js`. `PowerEndurance` mit kg ohne „Hangboard“ ist `lift_one_arm` (von Max bestätigt). `Strength` ist offen (Abschnitt 3, Punkt 4).
- **Backup:** JSON mit allen Sammlungen, dazu Ticks als CSV.

## 6. Coros-Anbindung

### 6.1 Hintergrund
Strava verlangt für den Connector eine Mitgliedschaft; Max will das vorerst nicht. Coros betreibt einen offiziellen MCP-Server (`https://mcp.coros.com/mcp`), den Max am 14.11. in claude.ai als eigenen Connector mit dem Namen „Coros“ hinzugefügt hat. Der Server verlangt OAuth; ohne Anmeldung antwortet er mit 401.

### 6.2 Was die Seite aufruft
Nur zwei Lese-Tools. Die Argumente stammen aus den Schemas, gelesen am 14.11.:

- `querySportRecords { startDate, endDate, limit }` – Datum als `yyyyMMdd`. Ohne Zeitraum liefert das Tool nur 7 Tage, ohne `limit` nur 20 Einträge. `limit: 100` funktioniert. **Es gibt kein Blättern.**
- `getActivityDetail { labelId, sportType }` – `labelId` als Text, `sportType` als Zahl.

`js/services/coros.js` fragt deshalb in 30-Tage-Fenstern von heute rückwärts (höchstens 12 Fenster), teilt ein volles Fenster, und holt Details nur für neue Einheiten (höchstens 40 pro Abruf, neueste zuerst).

### 6.3 Antwortformat
**Beide Tools antworten als formatierter Text, nicht als JSON.** `js/domain/coros.js` liest genau diese Zeilen (Werte hier erfunden):

```
Sport Records — 2026-09-01 to 2026-09-30 (5 records)
========================

1. Outdoor Run — 2026-09-28
   Location: Musterstadt Laufen
   Start Coordinates: 47.000000, 11.000000
   Time Window: startTimestamp=1790582400 | endTimestamp=1790585600
   Duration: 47:20 | Distance: 8.60 km
   Average Pace: 5:30 /km | Avg HR: 150 bpm | Calories: 600 kcal
   LabelId: 400000000000000101 | SportType: 100
```

Beobachtete Abweichungen, alle vom Leser abgedeckt und getestet:
- Kraft: `Duration: 45:00 | Sets: 12`, die Folgezeile beginnt mit ` | Avg HR: …`.
- Kurze Distanzen in Metern: `Distance: 350 m`.
- Indoor-Einheiten ohne `Start Coordinates`, teils ohne Distanz.
- Dauer als `mm:ss` oder `h:mm:ss`. Es ist die Trainingszeit, nicht die Gesamtzeit.
- Leerer Zeitraum: `No sport records found from 2020-01-01 to 2020-01-07.` – ein normaler Text, kein Fehler.

`getActivityDetail` liefert je Zeile `Schlüssel: Wert`, unter anderem `Elevation Gain / Loss: 80 m / 82 m`, `Training Load: 100`, `Aerobic TE: 3.0`, `Anaerobic TE: 1.0`, `Training Focus: Tempo`. Manche Felder enthalten Platzhalter wie `Performance: -1` oder `Efficiency Factor: 655.35`; die werden nicht verwendet.

Wichtig:
- **`labelId` ist größer als 2^53** und muss Text bleiben. Als Zahl würde JavaScript sie verfälschen.
- **Coros liefert weder Herzfrequenz-Zonen noch die maximale Herzfrequenz**, nur die Durchschnitts-Herzfrequenz.
- Der Name der Einheit steht in der Zeile `Location`.
- Max' Coros-Daten beginnen am **26.07.2026**.
- Erkennt der Leser bei vorhandenen `LabelId`-Zeilen keinen Eintrag, bricht der Abruf mit `unknown_shape` ab und zeigt den Anfang der Antwort unter „Technische Details zum Abruf“.

### 6.4 Sportarten und RPE-Vorschlag
- Zuordnung über den Sport-Code: 100, 101, 103 → `Run`; 102 → `TrailRun`; 200, 299 → `Ride`; 201 → `VirtualRide`; 203 → `GravelRide`; 204 → `MountainBikeRide`. Alle anderen Codes (z. B. 104 Wandern, 402 Kraft, 400 Cardio, 900 Gehen, 10001 Multisport, 800–802 Klettern) bleiben „Sonstiges“ mit dem Namen, den Coros druckt.
- Max zeichnet Kraft-Einheiten mit der Uhr auf. Als „Sonstiges“ importiert zählen sie doppelt, wenn dieselbe Einheit in *Kraft & Prävention* steht. Der Dialog weist darauf hin.
- **RPE-Vorschlag** (`suggestRpe`), in dieser Reihenfolge: Zeit in HF-Zonen (liefert Coros nicht) → **Coros-Trainingsbelastung pro Stunde** → Ø-Herzfrequenz gegen gespeicherte Zonen → Ø-Herzfrequenz in % der maximalen Herzfrequenz aus den Einstellungen. Lange Einheiten bekommen einen Zuschlag (+0,5 ab 105 min, +1 ab 180 min).
- Die Stufen für die Trainingsbelastung pro Stunde (`LOAD_RATE_RPE`): unter 45 → 2,5; unter 70 → 4; unter 95 → 5; unter 130 → 6; unter 170 → 7,5; darüber 9. **Das ist eine Schätzung**, geeicht an zwei Einheiten von Max: ein Tempolauf mit etwa 125 pro Stunde (ergibt RPE 6) und eine lange lockere Radtour mit etwa 55 pro Stunde (ergibt mit Zuschlag RPE 5). Die Pro-Stunde-Rate statt der Summe wird genommen, weil die Belastung mit der Dauer wächst und sRPE die Dauer noch einmal einrechnet.

### 6.5 Was der Connector sonst noch kann
In einer Session mit verbundenem Connector sichtbar als `mcp__claude_ai_Coros__…`. Nur gelesen, nicht ausprobiert, sofern nicht anders vermerkt:

- Lesen: `queryActivityLapData`, `queryCustomActivityLapData`, `queryAvgHeartRate`, `queryRestingHeartRate`, `querySleepOverview`, `querySleepHrv`, `queryStressLevel`, `queryStressTimeSeries`, `queryDailyHealthData`, `queryHealthCheckTimeSeries`, `queryRecoveryStatus`, `queryTrainingLoadAssessment`, `queryFitnessAssessmentOverview`, `queryUserInfo` (ausprobiert: Größe, Gewicht, Geburtsdatum, Geschlecht), `queryDevices`, `queryTrainingSchedule`, Abfragen zu Trainingsplänen und Workouts, `queryActivityFitFileDownloadUrls`, `downloadActivityFitFiles`.
- Schreiben: `createTrainingPlan`, `createSingleWorkout`, `createScheduledWorkout`, `scheduleWorkout`, `update…`, `uploadRouteFile`. **Diese Tools stehen bewusst nicht im Manifest** und werden ohne ausdrücklichen Auftrag von Max nicht aufgerufen.

Für jedes weitere Tool gilt: Schema lesen, Antwort an einem echten Lese-Aufruf beobachten, Tool ins Manifest aufnehmen (vollständige Deklaration wiederholen, Abschnitt 4.5), neu veröffentlichen. Max wird dann erneut um Zustimmung gefragt.

## 7. Technischer Aufbau

```
index.html            Seiteninhalt ohne <html>/<head>/<body>, so wie eine Artifact-Seite veröffentlicht wird
css/app.css           Tokens (hell/dunkel), Layout, Komponenten; Breakpoints 1100 px und 860 px
js/main.js            Start, Navigation, Hash-Routing, „+ Einheit“, Status-Banner
js/store/             index.js (Schnittstelle, wählt Backend), claudeDb.js, localDb.js, defaults.js
js/domain/            reine Funktionen: dates, grades, load, hangboard, plan, strength, climbing, endurance, coros, tests
js/import/            rehabboard.js, hangboardTxt.js
js/services/          caps.js, coros.js, review.js, backup.js, strava.js (zurückgestellt)
js/ui/                dom.js, dialog.js, forms.js, charts.js, view.js
js/modules/           dashboard, plan, climbing, hangboard, strength, endurance, tests, analysis, import, prefs, open
tests/                domain, import, store, coros (node --test)
tools/serve.mjs       lokaler Server ohne Abhängigkeiten; setzt um index.html denselben Rahmen wie die Plattform
```

- **Start:** `npm start` → `http://localhost:5173`. `npm test` → 33 Tests.
- **Jedes Modul** exportiert `meta` (`id`, `title`, `sub`) und `render(root)`. `main.js` rendert bei jeder Änderung im Store neu (gebündelt über `requestAnimationFrame`).
- **Store** (`js/store/index.js`): `list`, `get`, `all`, `settings`, `put`, `putMany`, `remove`, `saveSettings`, `subscribe`, `newId`, `clone`. Alle Sammlungen werden beim Start einmal abonniert und im Speicher gehalten. **Ausgegebene Dokumente sind eingefroren – vor dem Bearbeiten `clone()`.** `put` schreibt nur bei echter Änderung und nie zweimal gleichzeitig auf dasselbe Dokument; ein abgelehnter Schreibvorgang wird zurückgerollt.
- **Backend-Wahl:** Gibt es `window.claude.use` und liefert `use("db")` innerhalb von 10 s etwas, dann `claudeDb`, sonst `localDb` (localStorage, Schlüssel `elevate2:<sammlung>`). `store.status` trägt `backend`, `stale`, `errors`, `readOnly`; `main.js` zeigt daraus die Hinweise.
- **Diagramme:** eigene SVG-Funktionen in `js/ui/charts.js` (`barChart`, `lineChart`, `sparkline`, `pyramidChart`, `heatCalendar`, `timeline`, `rankBars`). Modulfarben kommen aus `moduleColor()` und sind in allen Diagrammen gleich.

## 8. Datenmodell

Jedes Dokument hat `id`, `createdAt`, `updatedAt` (ISO-Zeitpunkt). Datumsfelder sind `YYYY-MM-DD`. Sessions und Aktivitäten tragen `duration_min` und `rpe`.

| Sammlung | Inhalt |
|---|---|
| `climb_sessions` | Klettersessions, eingebettet `projectAttempts[]` (`{ projectId, attempts, highpoint, highpointPct?, note }`) |
| `ticks` | Ticks (`sessionId`, optional `projectId`) |
| `projects` | Projekte |
| `hangboard_sessions` | Sessions mit `blocks[]` (`{ mode, work_s, rest_s, edge_mm, grip, load_kg, reps, sets, side, switching, raw? }`) |
| `strength_sessions` | Kraft & Prävention im RehabBoard-Format (`kind`, `exercises[]`, optional `duration_min`, `rpe`) |
| `endurance_activities` | `source: coros \| strava \| manual`; bei Coros `corosId` (Text), `corosSportType`, `startTime`, `loadRaw` (`calories`, `training_load`, `aerobic_te`, `anaerobic_te`, `focus`), `rpeSuggested`, `rpeBasis` |
| `bodyweight` | `{ date, kg }`, ID `bw-YYYYMMDD` |
| `tests` | Benchmarks, Referenzen mit `isReference` |
| `plan_blocks` | Trainingsblöcke |
| `plan_templates` | Wochenvorlagen (`standard`, `summer`) |
| `plan_units` | konkrete geplante Einheiten |
| `reviews` | Wochenreviews, ID `rev-YYYYMMDD` |
| `settings` | ein Dokument `main`: Sommerzeitraum, Standard-Leiste, Zielgrad, Soll-Pyramide, `hrMax`, `planStart`, `includeOtherSports`, `corosLastSync`, `seeds` |

Zugriff: Nur der Eigentümer liest und schreibt (Regel am Wurzelpfad).

## 9. Nicht im Umfang

- Bouldern mit Fb-Skala (Feld vorbereitet).
- Mehrbenutzerbetrieb und Teilen.
- Schreibzugriffe auf Coros (Trainingspläne, Workouts).
- Strava, solange Max keine Mitgliedschaft will.
