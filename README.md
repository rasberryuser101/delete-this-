# Delete This! 📸

Deutschsprachiges Foto-Partyspiel für 2–8 Personen. Statische React/TypeScript/Vite-Webapp ohne eigenen Server, Datenbank oder Account. Der kurze Lobbycode wird über **mehrere öffentliche MQTT-over-WSS-Broker** vermittelt. Trystero verschlüsselt die WebRTC-Verbindungsdaten und nutzt fünf Broker redundant, statt von einem einzelnen kostenlosen Signaling-Dienst abhängig zu sein. Fotos werden lokal verarbeitet und ausschließlich über WebRTC-Datenkanäle zwischen den Spielgeräten übertragen. Die Vermittlungsdienste bekommen von der App keine Fotos.

## Spielen

1. Website öffnen, Namen eingeben und **Spiel erstellen** drücken.
2. **Party Mode** zeigt Fotos nur beim Host; **Remote Mode** verteilt sie per WebRTC an alle.
3. Der Host zeigt einen sechsstelligen Lobbycode oder teilt den Einladungslink. Freunde geben den Code ein und drücken **Beitreten**. Kein QR-Code, keine Answer, kein Rückscan.
4. Sobald mindestens zwei Personen in der Lobby sind, startet der Host die Runde. Prompt lesen, Foto wählen, anonym abstimmen. Gewinner bekommt einen Punkt.
5. Der Code gilt für die gesamte Partie. Die Browser-Tabs bleiben während der Partie geöffnet.

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

- Trystero nutzt fünf öffentliche MQTT-over-WSS-Broker redundant zur Peer-Erkennung. Die darüber ausgetauschten WebRTC-Verbindungsdaten sind mit einem aus App-ID und Lobbycode abgeleiteten Schlüssel verschlüsselt. Broker können technische Verbindungsdaten sehen, erhalten aber keine Fotos oder Spielinhalte. Es gibt weiterhin keine Datenbank und keinen eigenen Signaling-Server.
- Mehrere öffentliche STUN-Endpunkte von Google, Cloudflare und Twilio sind in `src/room.ts` konfiguriert. Über einen Rollen-Handshake akzeptiert der Host nur Gäste und Gäste nur den Host; die Spieldaten bleiben hostzentriert. **Kein TURN**: Falls direkte Verbindungen in einem Netzwerk unmöglich sind, erscheint eine Fehlermeldung und Fotos werden nicht über einen Server geleitet.
- Originalfotos werden lokal per Canvas neu encodiert, höchstens 1280 px Kantenlänge und 450 KB. EXIF/GPS der Originaldatei werden nicht übernommen. Nur die neu erzeugten WebP/JPEG-Blobs werden über verschlüsselte RTCDataChannels geschickt; Trystero übernimmt Chunking und Flusskontrolle.
- Keine Foto-Uploads über HTTP, keine Fotos im `localStorage`, IndexedDB, Service Worker Cache, in Logs oder Cloud Storage. Bilder liegen nur temporär im RAM. Bei Rundenende oder Verlassen werden Object URLs freigegeben. Nur der Anzeigename wird lokal gespeichert.
- Keine Analytics, kein Tracking, keine KI-APIs. Der Hostinganbieter empfängt beim Seitenaufruf technisch notwendige Verbindungsdaten.

## Grenzen

Ein sechsstelliger Code ist eine Einladung an Freunde, keine starke Zugangssperre. Wer den Code errät, kann während der Lobby versuchen beizutreten. Der Host sollte nur mit bekannten Personen spielen. Ohne TURN klappt WebRTC in restriktiven Mobilfunk- und Firmennetzen manchmal nicht. Fällt ein einzelner MQTT-Broker aus, stehen weitere Broker bereit; bei einem breiten Ausfall öffentlicher Broker können neue Verbindungen trotzdem scheitern. Bei Tab-Schließung oder Reload geht die Partie verloren: Es gibt absichtlich keine Speicherung oder Wiederaufnahme.
