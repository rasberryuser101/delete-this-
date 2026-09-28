# Delete This! 📸

Ein deutsches Foto-Partyspiel für 2–10 Personen. Die App besteht aus React/TypeScript, einem kleinen Cloudflare Worker für die Lobby und kurzlebige TURN-Zugänge sowie Cloudflare Static Assets für die Website. **Fotos werden ausschließlich auf den Geräten verarbeitet und über WebRTC-DataChannels ausgetauscht.** Cloudflare sieht kleine Lobby- und Spielnachrichten; bei blockierten Direktverbindungen leitet Cloudflare TURN die *verschlüsselten* WebRTC-Pakete weiter. Es gibt keine Foto-Uploads, KI, Analytics oder Foto-Datenbank.

## So läuft eine Verbindung ab (ganz einfach)

1. Der Host erstellt eine Lobby. Der Worker bekommt einen zufälligen Lobbycode und merkt sich vorübergehend, welches Gerät Host ist.
2. Der Host schickt einen **Link oder QR-Code**. Der Code zum Abtippen ist nur eine Alternative. Im Link steht auch der öffentliche Schlüssel des Hosts: So kann das Handy erkennen, dass es mit dem richtigen Host spricht.
3. Neue Gäste fragen nach Einlass. Der Host vergleicht ihre Prüfkennung und bestätigt sie einzeln. Der Worker lässt vor dieser Freigabe weder Spielnachrichten noch TURN-Zugänge für Gäste zu.
4. Der Worker tauscht wenige kurze Verbindungsnachrichten aus. Die Geräte bauen ihren eigenen verschlüsselten WebRTC-Datenkanal auf. Scheitert die direkte Strecke, gibt Cloudflare für freigegebene Geräte einen zeitlich begrenzten TURN-Zugang aus. **Das TURN-Geheimnis selbst liegt ausschließlich im Worker.**
5. Der Gast wählt ein Foto. Canvas verkleinert und encodiert es neu (EXIF/GPS werden nicht übernommen). Die komprimierten Bytes gehen nur über den Datenkanal zum Host. Im Remote-Modus verschickt der Host enthüllte Fotos über DataChannels weiter.
6. Nach der Runde verschwinden Fotoreferenzen und Object-URLs aus der App. Freigegebene Personen können natürlich Screenshots machen.

Cloudflare bekommt IP-Adressen und Verbindungs-/Spielmetadaten. Der Worker speichert kurzzeitig **nur eine Prüfsumme des Host-Tickets und Zähler gegen Missbrauch** in SQLite-gestützten Durable Objects, **keine Fotos und keine Spielhistorie**. Das Host-Ticket liegt im Browser-RAM, nicht im Einladungslink. Bilder über TURN sind Ende-zu-Ende mit WebRTC verschlüsselt; der Betreiber sieht den Datenverkehr und dessen Umfang, aber nicht den Bildinhalt. Ein Angriff durch viele verteilte Geräte lässt sich ohne Identitätsprüfung nicht sicher ausschließen. Links privat teilen, Beitritte prüfen, Cloudflare-Nutzung beobachten.

## Vorbereiten: Cloudflare Realtime TURN

**Diesen Schritt machst du einmal im eigenen Cloudflare-Dashboard. Keine Schlüssel in GitHub, Chat, Screenshots oder eine `VITE_`-Variable kopieren.**

1. Im Cloudflare-Dashboard **Realtime → TURN** öffnen und einen TURN Key erstellen.
2. Dort **TURN Key ID** und den zugehörigen **TURN Key API Token** kopieren und sicher aufbewahren. Falls Cloudflare die Namen im Dashboard leicht anders nennt: Die ID ist der Pfadteil für `turn/keys/{ID}`, der Token authentifiziert die Credential-API.
3. Nach dem ersten Worker-Deploy unter **Workers & Pages → delete-this → Settings → Variables & Secrets** zwei **Runtime Secrets** anlegen:
   - `TURN_KEY_ID` = deine TURN Key ID
   - `TURN_KEY_TOKEN` = dein TURN Key API Token
4. Speichern und die neue Worker-Version deployen, falls Cloudflare dazu auffordert. `https://<deine-worker-url>/api/status` muss danach `{"turn":true}` zeigen. Das verrät **keinen** Schlüssel, nur ob beide Einträge existieren.

Der Worker fragt Cloudflare bei Bedarf nach zwei Stunden gültigen TURN-Zugangsdaten und gibt diese nur an freigegebene Geräte. Ohne diese beiden Secrets nutzt das Spiel nur den kostenlosen Cloudflare-STUN-Server; besonders iPhone-zu-PC über Mobilfunk kann dann scheitern. Ein eingetragenes Secret allein ist noch kein Beweis für eine funktionierende TURN-Verbindung: den Live-Test unten durchführen.

## GitHub → Cloudflare Workers deployen

Der Worker und die Vite-Dateien werden **in einem Cloudflare-Workers-Projekt** veröffentlicht. Ein Cloudflare-Pages-Projekt allein würde die Lobby nicht bereitstellen.

1. Den Quellcode im Branch **`cloudflare-migration`** deines GitHub-Repositories `rasberryuser101/delete-this-` öffnen. Der bisherige `main`-Branch und die alte Vercel-Seite bleiben bis zum bestandenen Gerätetest bestehen. Wichtig: Inhalt im Repository-Stamm, kein zusätzlicher `delete-this/`-Ordner.
2. Im Cloudflare-Dashboard **Workers & Pages → Create application → Import a repository** wählen, mit GitHub verbinden und dieses Repository auswählen.
3. Projektnamen auf **`delete-this`** setzen; er muss zum `name` in `wrangler.jsonc` passen. Falls dieser Name bereits vergeben ist: Namen **in `wrangler.jsonc` und im Dashboard identisch** anpassen.
4. Root directory: Repository-Stamm. Build command: **`npm run build`**. Deploy command: **`npx wrangler deploy`**. Produktionsbranch: **`cloudflare-migration`**. Wenn zunächst `main` vorausgewählt ist, vor dem Deploy in den Build-Einstellungen auf `cloudflare-migration` umstellen. Dann **Save and Deploy**.
5. Die beiden TURN Runtime Secrets wie oben setzen. Danach die neue **`workers.dev`-URL** auf iPhone und PC öffnen. Alte Vercel-Einladungslinks sind mit neuen Cloudflare-Lobbys nicht kompatibel.

Bei Änderungen auf `cloudflare-migration` wird neu gebaut. Im Worker gibt es keine weiteren Konten oder Cloud-Dienste. `dist/` bleibt eine statische Vite-Ausgabe; die Cloudflare-Lobby entsteht erst durch den danebenliegenden Worker. `robots.txt` und `noindex,nofollow` halten die Testversion aus Suchmaschinen, sind aber keine Zugangssperre.

## Eigene Prompt-Packs ohne Code ändern

Jede Datei `src/packs/*.json` wird beim Build **automatisch** zur Pack-Auswahl hinzugefügt. Du kannst im GitHub-Repository über **Add file → Create new file** beispielsweise `src/packs/urlaub.json` anlegen:

```json
{
  "id": "urlaub",
  "title": "Urlaub eskaliert",
  "description": "Für Gruppenreisen mit zweifelhaften Entscheidungen.",
  "category": "Freunde",
  "prompts": [
    "Das Profilbild für jemanden, der auf LinkedIn ein Schneeballsystem als Mindset verkauft.",
    "Fünf Minuten vor dem schlechtesten Hotel-Check-in aller Zeiten."
  ]
}
```

`id` muss einzigartig sein (3–40 Kleinbuchstaben/Ziffern/Bindestriche). `title` und `category` erscheinen in der App; neue Kategorien erscheinen automatisch. `prompts` enthält mindestens einen deutschen Text. 18+-Packs bekommen die Kategorie `18+` und sind dadurch zunächst ausgeschaltet. Ungültige JSON-Dateien oder Schemafehler lassen den Build mit einer verständlichen Meldung scheitern. Die mitgelieferten acht Kategorien enthalten 618 Prompts plus ein kleines Beispiel-Pack. JSON-Packs sind öffentlich auf GitHub und in der Webseite sichtbar: keine privaten Daten hineinschreiben.

## Lokal entwickeln und testen

```sh
npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run test:worker
```

`npm run test:worker` startet einen **lokalen** Cloudflare Worker und prüft Lobby-Isolation, Freigabe und TURN-Zugang; er benötigt keinen echten Cloudflare-Key. Für einen manuellen lokalen Test optional `.dev.vars.example` nach `.dev.vars` kopieren, eigene Schlüssel dort eintragen (Datei wird ignoriert), dann `npm run dev:worker` ausführen und `http://localhost:8787` öffnen. `npm run dev` startet nur den Vite-Editor und bietet ohne parallel gestarteten Worker keinen Multiplayer.

## Gerätetest nach dem Deploy

1. `.../api/status` zeigt `turn:true`.
2. Auf dem PC **neue** Lobby starten, Link/QR auf iPhone mit Mobilfunk öffnen. Link inklusive `host=` benutzen.
3. Die Prüfkennung des iPhones beim Host vergleichen und freigeben.
4. Beide Geräte wählen unterschiedliche Fotos, beide können einreichen; der Host enthüllt nacheinander, beide stimmen ab; danach nächste Runde.
5. Dasselbe im Remote-Modus wiederholen. Host-Tab im Vordergrund lassen. Falls Mobilfunk/Browser die Verbindung unterbricht, beide Geräte offen lassen und „Erneut versuchen“ wählen.

Lokale Tests und ein Worker-Simulationstest ersetzen **keinen** Test mit zwei echten Geräten und aktiven Cloudflare-TURN-Secrets. Ohne Zugangsberechtigung zum Cloudflare-Dashboard kann dieses Repository keinen Live-Deploy oder iPhone-Test nachweisen.

## Kosten und Sicherheitsgrenzen

Cloudflare Realtime TURN/SFU teilen nach aktueller Preistabelle **1.000 GB kostenloses ausgehendes Datenvolumen pro Monat**, danach aktuell **0,05 US-Dollar/GB**. Workers und Durable Objects haben **eigene** Freikontingente, z. B. für Durable-Object-Anfragen, und können nach Erreichen von Limits blockieren. Die alte Grenze von Metered (100.000 Nachrichten) ist in diesem Cloudflare-Build nicht mehr relevant. Unnötige Vollsynchronisation alle acht Sekunden wurde entfernt; die Lobby sendet Änderungen, Freigaben und WebRTC-Signale. Dauerhafte Verbindungen werden über hibernierbare WebSockets gehalten. Kein System kann trotz Rate Limits und Gastgeberfreigabe einen öffentlichen Dienst vollständig gegen missbräuchliche verteilte Zugriffe absichern.

Quellen: [Cloudflare TURN Credentials](https://developers.cloudflare.com/realtime/turn/generate-credentials/), [Realtime Pricing](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [Durable Objects Free](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/), [GitHub → Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/).
