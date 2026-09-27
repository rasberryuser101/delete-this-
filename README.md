# Delete This! 📸

Bestehendes deutsches Foto-Partyspiel für 2–10 Spieler, weiterhin statisch mit React, TypeScript und Vite auf **GitHub + Vercel**. Design, Prompts, Sounds und Spielablauf bleiben erhalten. Ab Version 5 ersetzt `@metered-ca/realtime` (SDK 1.2.0 oder neuer) die bisherigen öffentlichen MQTT-Broker und die manuelle TURN-Eingabe. Kein eigenes Backend, keine Vercel Functions und keine Foto-Datenbank.

## Spielen

1. Namen eingeben, Party oder Remote wählen, Spiel erstellen.
2. Einladungslink/QR teilen oder den zehnstelligen Raumcode eingeben. Der Link enthält zusätzlich den öffentlichen Host-Schlüssel zur Prüfung des richtigen Hosts.
3. Der Host vergleicht die Prüfkennung mit dem Freund und erlaubt oder verweigert den Beitritt. Vorher gibt es weder Spielstand noch Fotokanal.
4. Prompt, lokale Fotoauswahl, Show mit einzeln enthüllten Bildern, Abstimmung, Punkte, nächste Runde funktionieren wie bisher.
5. **Remote:** zugelassene Spieler erhalten die enthüllten Fotos auf ihren Geräten.
6. **Party:** Spieler reichen per Handy ein und stimmen dort ab. Fotos erscheinen beim Host und auf separat bestätigten **Displays**. Zum Verbinden „Als Display beitreten“ wählen oder den Display-Link des Hosts öffnen. Displays zählen nicht als Spieler und können keine Spieleraktionen ausführen; maximal drei Displays.

Musik und Sounds werden lokal über Web Audio erzeugt. Die Schrift ist lokal eingebunden. Keine KI-APIs, Analytics oder externen Sound-/Font-Aufrufe. Nach dem Update alle Geräte neu laden und eine neue Lobby erstellen; alte Lobbys sind nicht kompatibel.

## Lokal entwickeln

```sh
npm install
```

Eine nicht eingecheckte `.env.local` mit **deinem bereits angelegten Publishable Key** erstellen:

```dotenv
VITE_METERED_API_KEY=pk_live_...
```

Das ist ein Platzhalter, kein echter Key. `.env.example` enthält ebenfalls ausschließlich einen Platzhalter. Dann:

```sh
npm run dev
npm test
npm run typecheck
npm run lint
npm run build
```

Ohne Variable erscheint beim Spielstart eine verständliche Fehlermeldung. Vite nach Änderungen an `.env.local` neu starten. Der Debugbereich ist ausschließlich im Development Build verfügbar. Dort stehen Verbindungszustände, temporäre Peer-ID, stabile App-ID, Freigabe, DataChannel, Reconnects und – wenn verfügbar – ausgewählte Candidate-Typen/direct/relay. Keine Schlüssel, Bildinhalte, SDP oder IP-Adressen werden von der App geloggt.

## Bestehendes Vercel-Projekt

**Nicht zu Cloudflare migrieren und kein neues Backend anlegen.**

1. Änderungen in das vorhandene GitHub-Repository `rasberryuser101/delete-this-` übernehmen.
2. In Vercel das bestehende Projekt öffnen.
3. Unter **Settings → Environment Variables** `VITE_METERED_API_KEY` mit dem eigenen Publishable Key setzen. Für **Production** und bei Bedarf **Preview/Development** aktivieren.
4. Framework bleibt **Vite**, Build Command **`npm run build`**, Output Directory **`dist`**.
5. Nach dem Setzen/Ändern der Variable **neu deployen**. Vite liest sie beim Build; ein alter Build übernimmt neue Variablen nicht nachträglich.
6. URL teilen. Freunde brauchen keine Konten oder Konfiguration.

Bei einer erstmaligen Vercel-Einrichtung: Repository auf GitHub → Vercel öffnen → Repository importieren → Vite → `npm run build` → `dist` → Variable setzen → Deploy.

`vercel.json` bleibt unverändert; `dist/` ist rein statisch. Hash-Routen, `robots.txt` mit `Disallow: /` und `noindex,nofollow` bleiben erhalten. Diese Suchmaschinenhinweise sind keine Zugangssperre.

### Metered-Konfiguration und Grenzen des Publishable Keys

Der Key wird **nur** über `import.meta.env.VITE_METERED_API_KEY` gelesen. Keine echten Keys in Source, README, Tests oder Git speichern. `.env*` werden bis auf `.env.example` ignoriert.

**Eine VITE-Variable wird in das öffentliche Browser-Bundle eingebaut. Ein Publishable Key ist ausdrücklich kein geheimes Serverpasswort.** Er wird nicht in der normalen Oberfläche angezeigt oder von der App geloggt, kann aber von Websitebesuchern aus dem Browser gelesen werden. Niemals einen Metered Secret/Signing Key einsetzen.

Laut offizieller Metered-Dokumentation benötigt automatische TURN-Injection einen **aktiven TURN-Dienst im Metered-Konto** und die eingeschaltete Option **Auto-inject TURN credentials**. Ein Publishable Key allein beweist nicht, dass TURN aktiv ist. Die App überschreibt die vom SDK gelieferten ICE-Server nicht und bevorzugt direkte Verbindungen, erlaubt aber TURN.

Den Key auf Channels `game-*` begrenzen; benötigt werden `subscribe`, `presence` und `send` (die App verwendet keinen Broadcast über `publish`). Einrichtungsberechtigungen sind im Metered-Dashboard zu prüfen. Publishable Keys sind laut Dokumentation **nicht nach Website-Origin beschränkt**. Kopierte Keys können daher fremde Nutzung und TURN-Kontingentverbrauch ermöglichen. Kontingente/Kosten im Konto prüfen und bei Missbrauch den Key widerrufen/ersetzen. App-seitige Freigaben schützen die Spielfotos, ersetzen aber keine serverseitigen Kontingent- und Missbrauchsgrenzen. Ohne Backend gibt es keine pro Benutzer ausgestellten Server-Tokens.

Offizielle Dokumentation:
- [Authentifizierung und automatische TURN-Injection](https://www.metered.ca/docs/realtime-messaging/sdk-javascript/guides/authentication/)
- [MeteredPeer](https://www.metered.ca/docs/realtime-messaging/sdk-javascript/api-reference/metered-peer/)
- [Reconnect und connection-reset](https://www.metered.ca/docs/realtime-messaging/sdk-javascript/guides/reconnect-best-practices/)

## Datenwege

| Daten | Weg |
|---|---|
| Webseite | Vercel → Browser; technisch notwendige Abrufdaten beim Host |
| Verbindungsdaten, Beitritte, Freigaben, Namen, Prompt, Runde, Stimmen, Punkte | Kleine validierte Nachrichten über Metered Realtime/Signaling; Dienst ist hierbei ein Datenempfänger |
| Foto | File Picker → Canvas (JPEG/WebP, maximal 1280 px, Ziel bis 400 KB, hartes Empfangslimit 1 MB) → RAM → eigener zuverlässiger RTCDataChannel → bestätigtes Spielgerät |
| Bei blockierter Direktverbindung | Derselbe Ende-zu-Ende-verschlüsselte WebRTC-Verkehr über Metered TURN; keine Bilddateien im Messaging/HTTP/Cloud Storage |

Fotos werden nie als JSON/Base64 über `peer.send`, `peer.sendTo`, WebSocket, HTTP, fetch, FormData oder REST verschickt. Die App hat keine solchen alternativen Bildpfade. QR-Codes enthalten nur Einladungslinks und werden lokal auf Canvas gezeichnet. Originaldateien werden nicht versendet; Canvas-Neucodierung übernimmt kein EXIF/GPS.

Lokal gespeichert werden Spieler-ID, separate Display-ID und Anzeigename; Toneinstellungen dürfen ebenfalls lokal bleiben. Fotos, Blob URLs, Chunks und Foto-Hashes werden nicht persistiert. Bild-/Chunk-Referenzen und Object URLs werden nach der Runde bzw. beim Verlassen aufgeräumt. Das ist keine garantierte physische Speicherlöschung durch das Betriebssystem. Freigegebene Mitspieler können Screenshots erstellen; der Host kennt die Urheber.

## Wiederverbinden

Die App-ID und die temporäre Metered-Peer-ID sind getrennt. Eine RAM-basierte Signaturidentität bindet Wiederanmeldungen an denselben Teilnehmer; die öffentlich bekannte Spieler-ID allein reicht nicht aus. Der Host behält getrennte Spieler einschließlich Punkten und Einreichungen mindestens fünf Minuten (bis zum Entfernen/Spielende). Ein überlebender Browser-Tab kann mit neuer Peer-ID ohne neue Freigabe weiterarbeiten.

Bei `connection-reset` werden alter Kanal, Listener und Transfers entfernt. Genau die vom SDK als impolite bestimmte Seite öffnet auf der **neuen** PeerConnection den Fotokanal; die andere nimmt `data-channel` entgegen. Sichtbarkeit, `pageshow`, Online/Offline-Ereignisse und regelmäßige Zustandsprüfungen unterstützen die SDK-Wiederverbindung. Bei längerem Stillstand wird die Metered-Sitzung neu aufgebaut, der Spielstand bleibt im Controller erhalten.

**Browser-Reload ist anders als kurzzeitiges Sperren:** RAM-Schlüssel gehen beim echten Reload verloren. Derselbe Spieler/dasselbe Display braucht deshalb eine erneute Host-Freigabe. Spieler-ID und Punktestand können erhalten bleiben, private Bilder kommen nicht aus einem Browser-Cache zurück. Bei einem Display-Reload werden nach Freigabe nur aktuelle öffentliche Zustände und bereits enthüllte Fotos erneut übertragen. Reload/Schließen/OS-Verwerfen des **Host-Tabs** beendet die Partie; ohne persistente Host-Speicherung oder Backend gibt es keine Host-Migration.

Verfügbarkeit, Mobilfunk-/Firmenfirewalls, iOS-Hintergrundregeln, Browser-Prozessbeendigung und Dienstkontingente können weiterhin Verbindungen verhindern. Es gibt keine Zusicherung „in jedem Netzwerk“ oder „unangreifbar“. Einladungslinks prüfen den mitgeteilten Host-Schlüssel; bei manueller Code-Eingabe wird der erste gültig signierte Host beim ersten Beitritt vertraut. Den Code privat teilen und Prüfkennungen vergleichen. Bereits empfangene Bilder lassen sich bei entfernten Mitspielern nicht zurückrufen.

Details und die konkrete manuelle Gerätetestliste stehen in [NETWORK_MIGRATION.md](NETWORK_MIGRATION.md).
