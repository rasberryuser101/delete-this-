# Delete That!

**Verbindungsfix 7.2.1:** Der Relay-Abruf akzeptiert freigegebene Geräte auch dann, wenn HTTP und WebSocket unterschiedliche IP-Adressen verwenden. Zugangsticket, aktive Lobby-Freigabe und Missbrauchslimits bleiben erforderlich. Nach dem Update beide Geräte neu laden und eine neue Lobby erstellen. Alte Tabs bekommen beim Verbindungsaufbau einen klaren Hinweis zum Neuladen.

**Version 7.2:** Optimierter WebRTC-Spielkanal, weniger Foto-Dopplungen, bedarfsgesteuerte Relay-Zugänge und Missbrauchslimits pro Lobby. [Änderungen und Verbrauchsbeispiele](docs/OPTIMIERUNG-7.2.md). 8 Spieler auf eigenen Handys oder 20 am gemeinsamen Bildschirm; Host als reiner Bildschirm; Klassisch, Eigene Prompts, Reverse und konfigurierbarer Mix. Stimmenpunkte, optionaler Siegerbonus, Mehrheits-Skip und frei wählbare Profilbilder. Neue kompakte Lobby, Punkte erst im Finale, acht abschaltbare Reactions mit Sounds und automatische/manuelle Foto-Show als Lobby-Einstellung. **[Einfache Anleitung: Sounds, Grafiken, Einstellungen und GitHub-Dateien verwalten](docs/ANPASSEN.md).** [Einfache Anleitung zu Verbrauch, Dashboard, Sicherheitsgrenzen und Betreiberpflichten](docs/BETRIEB.md).

Ein deutsches Foto-Partyspiel für 2–20 Personen. Die App besteht aus React/TypeScript, einem kleinen Cloudflare Worker für die Lobby und kurzlebige TURN-Zugänge sowie Cloudflare Static Assets für die Website. **Fotos werden ausschließlich auf den Geräten verarbeitet und über WebRTC-DataChannels ausgetauscht.** Cloudflare sieht kleine Beitritts- und Verbindungsnachrichten; Spielstände, Prompts, Stimmen und Reactions laufen ebenfalls verschlüsselt über WebRTC; bei blockierten Direktverbindungen leitet Cloudflare TURN die *verschlüsselten* WebRTC-Pakete weiter. Es gibt keine Foto-Uploads, KI, Analytics oder Foto-Datenbank.

## So läuft eine Verbindung ab (ganz einfach)

1. Der Host erstellt eine Lobby. Der Worker bekommt einen zufälligen Lobbycode und merkt sich vorübergehend, welches Gerät Host ist.
2. Der Host schickt einen **Link oder QR-Code**. Der Code zum Abtippen ist nur eine Alternative. Im Link steht auch der öffentliche Schlüssel des Hosts: So kann das Handy erkennen, dass es mit dem richtigen Host spricht.
3. Neue Gäste fragen nach Einlass. Der Host vergleicht ihre Prüfkennung und bestätigt sie einzeln. Vor dieser Freigabe gibt es weder eine Spielverbindung noch TURN-Zugänge für Gäste.
4. Der Worker tauscht wenige kurze Verbindungsnachrichten aus. Die Geräte bauen ihren eigenen verschlüsselten WebRTC-Datenkanal auf. Scheitert die direkte Strecke, gibt Cloudflare für freigegebene Geräte einen zeitlich begrenzten TURN-Zugang aus. **Das TURN-Geheimnis selbst liegt ausschließlich im Worker.**
5. Der Gast wählt ein Foto. Canvas verkleinert und encodiert es neu (EXIF/GPS werden nicht übernommen). Die komprimierten Bytes gehen nur über den Datenkanal zum Host. Im Remote-Modus verschickt der Host enthüllte Fotos über DataChannels weiter.
6. Nach der Runde verschwinden Fotoreferenzen und Object-URLs aus der App. Freigegebene Personen können natürlich Screenshots machen.

Cloudflare bekommt IP-Adressen und Verbindungsmetadaten. Der Worker speichert kurzzeitig **eine Prüfsumme des Host-Tickets und Zähler gegen Missbrauch** in SQLite-gestützten Durable Objects; aktive WebSocket-Zuordnungen und Freigaben werden für Wiederaufwecken verwaltet. **Keine Fotos und keine Spielhistorie.** Das Host-Ticket liegt im Browser-RAM, nicht im Einladungslink. Bilder und Spielaktionen über TURN sind Ende-zu-Ende mit WebRTC verschlüsselt; der Betreiber sieht den Datenverkehr und dessen Umfang, aber nicht den Inhalt. Ein Angriff durch viele verteilte Geräte lässt sich ohne Identitätsprüfung nicht sicher ausschließen. Links privat teilen, Beitritte prüfen, Cloudflare-Nutzung beobachten.

## Neue Spielregeln

[Update 7: Modi, Bildschirm, Skip, Verbindungsabbruch und Profilbilder](docs/UPDATE-7.md).

## Vorbereiten: Cloudflare Realtime TURN

**Diesen Schritt machst du einmal im eigenen Cloudflare-Dashboard. Keine Schlüssel in GitHub, Chat, Screenshots oder eine `VITE_`-Variable kopieren.**

1. Im Cloudflare-Dashboard **Realtime → TURN** öffnen und einen TURN Key erstellen.
2. Dort **TURN Key ID** und den zugehörigen **TURN Key API Token** kopieren und sicher aufbewahren. Falls Cloudflare die Namen im Dashboard leicht anders nennt: Die ID ist der Pfadteil für `turn/keys/{ID}`, der Token authentifiziert die Credential-API.
3. Nach dem ersten Worker-Deploy unter **Workers & Pages → delete-this → Settings → Variables & Secrets** zwei **Runtime Secrets** anlegen:
   - `TURN_KEY_ID` = deine TURN Key ID
   - `TURN_KEY_TOKEN` = dein TURN Key API Token
4. Speichern und die neue Worker-Version deployen, falls Cloudflare dazu auffordert. `https://<deine-worker-url>/api/status` muss danach `{"turn":true}` zeigen. Das verrät **keinen** Schlüssel, nur ob beide Einträge existieren.

Der Worker fragt Cloudflare bei Bedarf nach 30 Minuten gültigen TURN-Zugangsdaten und gibt diese nur an freigegebene Geräte. Ohne diese beiden Secrets nutzt das Spiel nur den kostenlosen Cloudflare-STUN-Server; besonders iPhone-zu-PC über Mobilfunk kann dann scheitern. Ein eingetragenes Secret allein ist noch kein Beweis für eine funktionierende TURN-Verbindung: den Live-Test unten durchführen.

## GitHub → Cloudflare Workers deployen

Der Worker und die Vite-Dateien werden **in einem Cloudflare-Workers-Projekt** veröffentlicht. Ein Cloudflare-Pages-Projekt allein würde die Lobby nicht bereitstellen.

1. Den Quellcode im Branch **`cloudflare-migration`** deines GitHub-Repositories `rasberryuser101/delete-this-` öffnen. Der bisherige `main`-Branch und die alte Vercel-Seite bleiben bis zum bestandenen Gerätetest bestehen. Wichtig: Inhalt im Repository-Stamm, kein zusätzlicher `delete-this/`-Ordner.
2. Im Cloudflare-Dashboard **Workers & Pages → Create application → Import a repository** wählen, mit GitHub verbinden und dieses Repository auswählen.
3. Projektnamen auf **`delete-this`** setzen; er muss zum `name` in `wrangler.jsonc` passen. Falls dieser Name bereits vergeben ist: Namen **in `wrangler.jsonc` und im Dashboard identisch** anpassen.
4. Root directory: Repository-Stamm. Build command: **`npm run build`**. Deploy command: **`npx wrangler deploy`**. Produktionsbranch: **`cloudflare-migration`**. Wenn zunächst `main` vorausgewählt ist, vor dem Deploy in den Build-Einstellungen auf `cloudflare-migration` umstellen. Dann **Save and Deploy**.
5. Die beiden TURN Runtime Secrets wie oben setzen. Danach die neue **`workers.dev`-URL** auf iPhone und PC öffnen. Alte Vercel-Einladungslinks sind mit neuen Cloudflare-Lobbys nicht kompatibel.

Bei Änderungen auf `cloudflare-migration` wird neu gebaut. `npm run build` führt dabei auch alle Tests (`npm test`) aus: Ein roter Test bricht den Build ab, und Cloudflare veröffentlicht dann **nicht**. Die Node-Version (22) liest Workers Builds aus `.nvmrc`; falls im Dashboard zusätzlich eine Build-Variable `NODE_VERSION` gesetzt ist, sollte sie ebenfalls `22` sein. Im Worker gibt es keine weiteren Konten oder Cloud-Dienste. `dist/` bleibt eine statische Vite-Ausgabe; die Cloudflare-Lobby entsteht erst durch den danebenliegenden Worker. `robots.txt` und `noindex,nofollow` halten die Testversion aus Suchmaschinen, sind aber keine Zugangssperre.

## Eigene Prompt-Packs ohne Code ändern

Jede Datei `src/packs/*.json` wird beim Build **automatisch** zur Pack-Auswahl hinzugefügt. Du kannst im GitHub-Repository über **Add file → Create new file** beispielsweise `src/packs/urlaub.json` anlegen:

```json
{
  "id": "urlaub",
  "title": "Urlaub eskaliert",
  "description": "Für Gruppenreisen mit zweifelhaften Entscheidungen.",
  "icon": "🏖️",
  "adult": false,
  "prompts": [
    "Das Profilbild für jemanden, der auf LinkedIn ein Schneeballsystem als Mindset verkauft.",
    "Fünf Minuten vor dem schlechtesten Hotel-Check-in aller Zeiten."
  ]
}
```

`id` muss einzigartig sein (3–40 Kleinbuchstaben/Ziffern/Bindestriche). `title` ist der sichtbare Packname, `icon` ist dein Emoji oder ein kurzes Textsymbol (maximal 16 Zeichen). `description` beschreibt das Pack. `prompts` enthält mindestens einen deutschen Text. Eine Kategorie gibt es nicht mehr: Jedes Pack wird direkt an- oder ausgeschaltet. Für Erwachsenen-Packs setzt du `adult` auf `true`; diese sind zunächst ausgeschaltet. Ungültige JSON-Dateien oder Schemafehler stoppen den Build mit einer verständlichen Meldung. Die vier mitgelieferten Packs enthalten ausschließlich die 108 ausgewählten Texte: Classic (26), Roast (33), After Dark (29, standardmäßig aus) und Challenges (20). JSON-Packs sind öffentlich auf GitHub und in der Webseite sichtbar: keine privaten Daten hineinschreiben.

### Freigegeben, aber die Fotoverbindung fehlt?

Die Gastgeberfreigabe und der verschlüsselte Fotokanal sind zwei Schritte. `/api/status` muss nach dem Eintragen der Secrets `{"turn":true}` zeigen. Bei `false` fehlt mindestens ein Secret im **aktiven Worker** (Build-Variablen allein reichen nicht). Prüfe `TURN_KEY_ID` und `TURN_KEY_TOKEN` unter Settings → Variables & Secrets. Danach die Version deployen und beide Geräte neu laden.

Die App wartet auf eine Bereitschaftsbestätigung beider Fotokanäle, bevor sie den Gast in die Lobby übernimmt. Ein fehlgeschlagener erster Spielstand-Abruf wird bis zu zweimal wiederholt. Nur mit `?debug=1` vor dem Hash erscheint das ausklappbare Feld „Verbindungsdiagnose“. Es zeigt nur technische Zustände (keine IP-Adressen, Zugangsdaten oder Fotos). „TURN: Zugang erhalten“ bestätigt erhaltene Zugangsdaten, nicht die tatsächliche Nutzung des Relay-Pfads.

Ab 7.2.1 zeigt die Diagnose bei einem fehlgeschlagenen Zugang auch die Fehlerklasse: 403 = aktive Freigabe/Ticket fehlt, 429 = Schutzpause, 503 = Verbindungsdienst nicht verfügbar. Bitte nur diese Statuszeilen weitergeben, keine Zugangsdaten. Beide Geräte müssen die neue Seite laden; ein veralteter Tab kann nicht mit dem neuen Spielkanal verbunden werden.

## Lokal entwickeln und testen

Benötigt **Node.js 22 oder neuer** (siehe `.nvmrc`, z. B. `nvm use`). Mit Node 20 schlagen einzelne Tests fehl, und `wrangler` setzt Node 22 voraus.

```sh
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run test:worker
```

GitHub Actions (`.github/workflows/ci.yml`) führt bei jedem Push auf `cloudflare-migration` und bei jedem Pull Request dorthin automatisch `npm ci`, Lint, Typecheck, Tests, Build und `npm run test:worker` mit Node 22 aus. Ein roter CI-Lauf vor dem Mergen heißt: nicht mergen.

`npm run test:worker` startet einen **lokalen** Cloudflare Worker und prüft Lobby-Isolation, Freigabe und TURN-Zugang; er benötigt keinen echten Cloudflare-Key. Für einen manuellen lokalen Test optional `.dev.vars.example` nach `.dev.vars` kopieren, eigene Schlüssel dort eintragen (Datei wird ignoriert), dann `npm run dev:worker` ausführen und `http://localhost:8787` öffnen. `npm run dev` startet nur den Vite-Editor und bietet ohne parallel gestarteten Worker keinen Multiplayer.

## Gerätetest nach dem Deploy

1. `.../api/status` zeigt `turn:true`.
2. Auf dem PC **neue** Lobby starten, Link/QR auf iPhone mit Mobilfunk öffnen. Link inklusive `host=` benutzen.
3. Die Prüfkennung des iPhones beim Host vergleichen und freigeben.
4. Beide Geräte wählen unterschiedliche Fotos, beide können einreichen; der Host enthüllt nacheinander, beide stimmen ab; danach nächste Runde.
5. Dasselbe im Remote-Modus wiederholen. Host-Tab im Vordergrund lassen. Falls Mobilfunk/Browser die Verbindung unterbricht, beide Geräte offen lassen und „Erneut versuchen“ wählen.

Lokale Tests und ein Worker-Simulationstest ersetzen **keinen** Test mit zwei echten Geräten und aktiven Cloudflare-TURN-Secrets. Ohne Zugangsberechtigung zum Cloudflare-Dashboard kann dieses Repository keinen Live-Deploy oder iPhone-Test nachweisen.

## Kosten und Sicherheitsgrenzen

Cloudflare Realtime TURN/SFU teilen nach aktueller Preistabelle **1.000 GB kostenloses ausgehendes Datenvolumen pro Monat**, danach aktuell **0,05 US-Dollar/GB**. Workers und Durable Objects haben **eigene** Freikontingente, z. B. für Durable-Object-Anfragen, und können nach Erreichen von Limits blockieren. Die alte Grenze von Metered (100.000 Nachrichten) ist in diesem Cloudflare-Build nicht mehr relevant. Spieländerungen und Reactions laufen ab 7.2 ausschließlich über den separaten WebRTC-Spielkanal. Die Cloudflare-Lobby vermittelt nur Beitritt, Freigaben und Verbindungsangebote. Identische Spielstände und bereits vorhandene Bilder werden nicht erneut verschickt. Dauerhafte Verbindungen werden über hibernierbare WebSockets gehalten. Kein System kann trotz Rate Limits und Gastgeberfreigabe einen öffentlichen Dienst vollständig gegen missbräuchliche verteilte Zugriffe absichern.

Quellen: [Cloudflare TURN Credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [Realtime Pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [Durable Objects Free](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [GitHub → Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).
