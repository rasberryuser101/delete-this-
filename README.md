# Delete This! 📸

Ein deutschsprachiges Foto-Partyspiel für 2–8 Personen. Statische React/TypeScript/Vite-Webapp ohne Backend und ohne Accounts. Die Fotos werden lokal per Canvas auf höchstens 1280 px Kantenlänge und höchstens 450 KB verarbeitet; Metadaten des Originals werden nicht übertragen. Spielbilder liegen nur im RAM und gehen direkt über WebRTC-Datenkanäle zwischen den Geräten. Nach der Runde werden die Object URLs freigegeben.

## Direkt losspielen

1. Eine Person öffnet **Spiel erstellen** und wählt Party Mode (Fotos nur beim Host) oder Remote Mode (Fotos auf allen Geräten).
2. Der Host wählt **Mit Freund verbinden**. Der Gast scannt den Einladungs-QR-Code mit der Kamera (der Link öffnet die Webapp) oder fügt den Code in **Mitspielen** ein.
3. Der Gast sieht einen **Antwort-QR-Code**. Der Host scannt ihn in der Webapp oder fügt den Antwortcode ein und tippt auf **Verbindung herstellen**.
4. Für weitere Gäste Schritte 2–3 wiederholen. **Das Pairing ist pro Gerät nur einmal nötig**, nicht für jede Runde.
5. Ab zwei verbundenen Personen startet der Host die Runde. Alle wählen ein Foto, stimmen über die anonymen Bilder ab und erhalten Punkte.

Die Spielansicht und der Browser-Tab müssen während der Partie offen bleiben. Der Host sollte eine stabile Verbindung und für Party Mode einen gemeinsam sichtbaren Bildschirm haben. Es gibt keinen zufälligen Matchmaking-Dienst. In manchen Netzwerken, besonders bei restriktiven Mobilfunk- oder Firmennetzen, verhindert NAT eine direkte P2P-Verbindung; ohne TURN ist dort Spielen nicht möglich.

## Lokale Entwicklung

```sh
npm install
npm run dev
```

## Prüfungen und statischer Build

```sh
npm test
npm run typecheck
npm run build
```

`dist/` enthält ausschließlich statische Dateien. Keine Environment Secrets oder weiteren Dienste nötig. Die Anwendung verwendet Hash-Routen (`#/spiel`, `#/datenschutz`, `#/info`), damit die Navigation auch ohne Server-Routing auf GitHub Pages funktioniert. `robots.txt` und das Robots-Meta-Tag untersagen die Indexierung der privaten Testversion. Sie sind keine Zugangssperre.

## Vercel Deployment

1. Repository auf GitHub erstellen und Projektdateien pushen.
2. [Vercel](https://vercel.com) öffnen.
3. **Add New → Project** wählen und das GitHub-Repository importieren.
4. **Framework Preset:** Vite.
5. **Build Command:** `npm run build`.
6. **Output Directory:** `dist`.
7. **Deploy** klicken und den Link teilen.

Die Datei `vercel.json` enthält die nötige statische Konfiguration. Vercel benötigt keine Secrets. Für Netlify oder GitHub Pages reicht ebenfalls der Inhalt von `dist/` als statische Website (bei GitHub Pages die Vite-Basis für das Repository-Unterverzeichnis entsprechend konfigurieren oder eine benutzerdefinierte Domain verwenden).

## Technik und Datenschutz

- WebRTC mit manuellen komprimierten SDP Offer/Answer Codes, einschließlich ICE-Kandidaten, ohne Signaling-Server.
- Standard-STUN: `stun:stun.l.google.com:19302`, in der Host-Lobby änderbar. STUN sieht Verbindungsdaten wie IP-Adressen, keine Fotos. Kein TURN und kein Server-Fallback.
- Host-zentrierte Sternstruktur. Host und bis zu sieben Gäste. Host verteilt Fotos in Remote Mode per DataChannel an jeden Gast.
- Alle Fotos werden aus der ausgewählten Originaldatei per Canvas neu encodiert, auf maximal 450 KB begrenzt, als WebP/JPEG in 16-KB-Stücken über verschlüsselte WebRTC-Datenkanäle geschickt. Originaldateien werden nie übertragen.
- Aufgenommene Fotos werden nicht über `fetch`, HTTP, Uploads oder APIs versendet. Sie werden nicht in `localStorage`, IndexedDB, Service Worker, Logs oder Datenbanken gespeichert. Nur der Anzeigename liegt im `localStorage`.
- Keine Analytics, Cloud-Dienste, Bildspeicherung, KI-APIs oder eigenen Server.
- Ein öffentlicher Host kann trotzdem vom Hostinganbieter technische Abrufdaten erfassen. Für reale öffentliche Nutzung die Datenschutzhinweise des gewählten Hosters und STUN-Anbieters prüfen.

## Grenzen

Ein gemeinsamer Bildtransfer kann bei schlechter P2P-Verbindung dauern. Ohne TURN ist eine Verbindung nicht garantiert. Das Spiel hat keinen Raumcode, der allein zum Beitreten reicht: Für das direkte P2P-Pairing muss der Host jede Antwort einmal übernehmen. In Party Mode müssen Gäste die nummerierten Bilder auf dem Host-Bildschirm sehen können. Bei Tab-Schließung oder Reload geht die Partie verloren; es gibt absichtlich keine Speicherung oder Wiederaufnahme.
