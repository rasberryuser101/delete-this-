# Delete This! 📸

Deutschsprachiges Foto-Partyspiel für 2–8 Personen. Statische React/TypeScript/Vite-Webapp ohne eigenen Server, Datenbank oder Account. Der kurze Lobbycode wird über **mehrere öffentliche MQTT-over-WSS-Broker** vermittelt. Trystero verschlüsselt die WebRTC-Verbindungsdaten und nutzt zwei Broker (Mosquitto und HiveMQ). Fotos werden lokal verarbeitet und über verschlüsselte WebRTC-Datenkanäle übertragen. WebRTC versucht zunächst eine direkte Route; bei blockierenden Netzen kann jeder Teilnehmer kurzlebige TURN-Zugangsdaten für die aktuelle Sitzung eingeben. Ohne eingerichteten TURN-Dienst ist eine Verbindung zwischen restriktiven Netzen nicht garantiert.

## Spielen

1. Website öffnen, Namen eingeben und **Spiel erstellen** drücken.
2. **Party Mode** zeigt Fotos nur beim Host; **Remote Mode** verteilt sie per WebRTC an alle.
3. Der Host zeigt einen zehnstelligen Lobbycode oder teilt den Einladungslink. Freunde geben den Code ein und drücken **Beitreten**. Der Host sieht Name und Prüfkennung und muss jede Anfrage aktiv freigeben.
4. Sobald mindestens zwei Personen in der Lobby sind, startet der Host den sichtbaren Countdown. Prompt lesen, Foto wählen. Wenn alle eingereicht haben: Trommelwirbel, Prompt noch einmal vorlesen, dann enthüllt der Host jedes Foto einzeln. Erst danach ist Voting möglich. Gewinner bekommt einen Punkt.
5. Der Code gilt für die gesamte Partie. Die Browser-Tabs bleiben während der Partie geöffnet.

### Verbindung zwischen getrennten Netzen

Falls auf einem Gerät „WebRTC-Verbindung konnte nicht hergestellt werden“ erscheint, brauchen die beteiligten Geräte möglicherweise TURN. Auf der Info-Seite unter „Technische Einstellungen für Betreiber“ kann **vor Spiel erstellen oder Beitreten** auf beiden Geräten eine vom TURN-Anbieter ausgestellte, kurzlebige Konfiguration eingetragen werden, zum Beispiel `{"urls":["turns:relay.example:443?transport=tcp"],"username":"zeitlich-begrenzt","credential":"zeitlich-begrenzt"}`. Danach eine neue Lobby erstellen und mit einem neuen Code erneut beitreten. Bei einem TURN-Anbieter fallen Verbindungs- und Verkehrsdaten an; seine Limits und Kosten gelten. Zugangsdaten bleiben im Arbeitsspeicher des Browsers und werden weder im Repository noch in der Einladung abgelegt. Für diese optionale Verbindung muss der Host selbst einen geeigneten TURN-Dienst bereitstellen oder Zugangsdaten von einem Dienst beziehen; die App kann solche Anmeldedaten ohne vertraulichen Server nicht automatisch ausstellen.

Emoji-Reaktionen (😂 💀 🚩 👏) erscheinen bei allen freigegebenen Spielern; pro Gerät gilt ein Limit von einer Reaktion je 1,2 Sekunden. Comic-Avatare werden ohne Profildateien aus der Sitzungskennung abgeleitet. Im Remote Mode werden nur bereits enthüllte Bilder an Gäste geschickt, und vor dem Weitergehen wird deren Empfang bestätigt. Der Host bestimmt das Show-Tempo.

Die selbst gehostete Schrift Fredoka ist als Fontsource-Paket eingebunden; beim Spielen wird kein externer Font-Dienst angefragt. Die Musik startet nach der Interaktion zum Erstellen oder Beitreten. 🎵 schaltet nur die Musik um, 🔊/🔇 schaltet sämtliche Sounds stumm. Musik und Effekte werden lokal mit der Web Audio API erzeugt; es gibt keine externen Sounddateien oder Lizenzabhängigkeiten.

## Lokale Entwicklung

```sh
npm install
npm run dev
```

```sh
npm test
npm run typecheck
npm run build
```

`dist/` enthält ausschließlich statische Dateien. Es gibt keine Environment Secrets. Die Hash-Routen `#/spiel`, `#/datenschutz` und `#/info` funktionieren auch auf statischen Hosts ohne spezielle Rewrite-Regeln. `robots.txt` und das Robots-Meta-Tag verhindern gewöhnliche Suchmaschinenindexierung, sind aber keine Zugangssperre.

## Vercel Deployment

1. Das bestehende Repository `rasberryuser101/delete-this-` auf GitHub öffnen.
2. [Vercel](https://vercel.com) öffnen.
3. **Add New → Project** und das Repository importieren.
4. **Framework Preset:** Vite.
5. **Build Command:** `npm run build`.
6. **Output Directory:** `dist`.
7. **Deploy** klicken und die URL teilen.

`vercel.json` enthält die statische Build-Konfiguration. Netlify oder GitHub Pages können dieselben Builddateien hosten. Auf GitHub Pages funktioniert `base: './'` mit den Hash-Routen im Projektunterverzeichnis.

## Technik und Privatsphäre

- Trystero nutzt zwei öffentliche MQTT-over-WSS-Broker (Mosquitto und HiveMQ) zur Peer-Erkennung. Die darüber ausgetauschten WebRTC-Verbindungsdaten sind mit einem aus App-ID und Lobbycode abgeleiteten Schlüssel verschlüsselt. Broker können technische Verbindungsdaten sehen, erhalten aber keine Fotos oder Spielinhalte. Es gibt weiterhin keine Datenbank und keinen eigenen Signaling-Server.
- Mehrere öffentliche STUN-Endpunkte von Google und Cloudflare sind in `src/room.ts` konfiguriert. Über einen Rollen- und Freigabe-Handshake akzeptiert der Host nur aktiv bestätigte Gäste; Prüfkennung und zehnstelliger Code erschweren Fehlbeitritte. Beitrittsversuche werden pro Lobby begrenzt. Die Spieldaten bleiben hostzentriert. Optional eingegebener TURN leitet ausschließlich bereits verschlüsselte WebRTC-Pakete weiter; der Relay-Betreiber verarbeitet dabei technisch notwendige Verbindungs- und Verkehrsdaten.
- Originalfotos werden lokal per Canvas neu encodiert, höchstens 1280 px Kantenlänge und 450 KB. EXIF/GPS der Originaldatei werden nicht übernommen. Nur die neu erzeugten WebP/JPEG-Bytes werden über verschlüsselte RTCDataChannels geschickt; Trystero übernimmt Chunking und Flusskontrolle. Empfänger prüfen Signatur, MIME, Größe und Abmessungen und bestätigen erst danach den Upload. Unterbrochene Fotos werden automatisch einmal wiederholt.
- Keine Foto-Uploads über HTTP, keine Fotos im `localStorage`, IndexedDB, Service Worker Cache, in Logs oder Cloud Storage. Bilder liegen nur temporär im RAM. Bei Rundenende oder Verlassen werden Object URLs freigegeben. Nur der Anzeigename wird lokal gespeichert.
- Keine Analytics, kein Tracking, keine KI-APIs. Der Hostinganbieter empfängt beim Seitenaufruf technisch notwendige Verbindungsdaten.

## Grenzen

Der zehnstellige Code ist eine Einladung an Freunde, keine Benutzerkonten-Authentifizierung. Zusätzlich muss der Host jede Anfrage freigeben; ein erratener Code reicht deshalb nicht für den Spielbeitritt. Die Begrenzung von Beitrittsanfragen läuft auf dem Hostgerät und ersetzt keinen serverseitigen Schutz gegen massenhafte Verbindungsversuche. Ohne TURN klappt WebRTC in restriktiven Mobilfunk- und Firmennetzen manchmal nicht; mit TURN sind Verfügbarkeit und Durchsatz vom externen Anbieter abhängig. Fällt ein einzelner MQTT-Broker aus, stehen weitere Broker bereit; bei einem breiten Ausfall öffentlicher Broker können neue Verbindungen trotzdem scheitern. Bei Tab-Schließung oder Reload geht die Partie verloren: Es gibt absichtlich keine Speicherung oder Wiederaufnahme.


## Version 4 und Sicherheit

Beide Geräte nach einem Update neu laden und eine neue Lobby erstellen. Version 4 verwendet eine eigene Vermittlungskennung und kann nicht mit Version 3 spielen.

- Keine Konten- oder Profilfoto-Funktion: Die Emoji-Avatare erzeugen keine zusätzlichen Bilddateien.
- Der Host kennt die Zuordnung der Fotos; die Gastansicht zeigt keine fremden Urheber oder Stimmziele. Screenshots und Rückschlüsse aus dem Bildinhalt kann die App nicht verhindern.
- Admission-Gates gelten für Spielnachrichten, Bilder und Reaktionen; nach dem Entfernen wird die Freigabe zurückgezogen. Das ersetzt keine unabhängige Sicherheitsprüfung.
- Die Verbindungen zu den öffentlich zugänglichen Testbrokern sind keine Garantie für eine Verbindung zwischen zwei Geräten. Öffentlich heißt außerdem, dass technische Vermittlungskennungen beobachtet werden können. Verbindungsangebote sind mit dem Lobby-Geheimnis verschlüsselt.
- Eine zuverlässige Mobilfunk-Verbindung braucht gegebenenfalls einen dauerhaft erreichbaren TURN-Dienst. Der ist nicht automatisch eingerichtet. Ohne Anbieter-Zugang oder eigenen Dienst kann die App ihn nicht bereitstellen.
- Die Betreiber der Hilfsdienste können technische Verbindungsdaten protokollieren. Keine pauschale Zusicherung über deren Speicherfristen oder Serverstandorte.
