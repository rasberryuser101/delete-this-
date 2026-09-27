# Netzwerk-Migration · Version 5

## Umfang

Die bestehende React/Vite-App und das Vercel-Hosting bleiben erhalten. Design, Prompts, Sounds, Fotoverarbeitung, Reveal, Voting und Punktelogik wurden nicht neu gebaut. Änderungen betreffen Netzwerk, Rollen, Freigaben, Reconnect, die notwendige Display-Ansicht und deren Dokumentation.

Entfernt: Trystero-Abhängigkeiten, öffentliche MQTT-Broker, eigene STUN-Liste, manuell einzutragendes TURN-JSON und alte Trystero-Fotoaktionen. Die bestehende Request/ACK-Schnittstelle bleibt als kleine eigene Schnittstelle erhalten, damit der GameController weiterverwendet wird. Die bisherigen Testfälle bleiben bestehen und wurden an neue Rollen/Transport und die verlangten Limits angepasst; der Trystero-Wire-Test prüft jetzt den eigenen RTC-Chunk-Transport.

Neu: `@metered-ca/realtime` 1.2.0 mit `MeteredPeer`, automatischen SDK-ICE-Servern, `connection-reset`, `game-${roomCode}`-Channels. Keine selbst verwalteten SDP/ICE-Nachrichten, kein eigenes Backend, keine Vercel Function. Der Publishable Key kommt nur aus `VITE_METERED_API_KEY`.

## Datenfluss

**Control:** App → streng validiertes `NetworkControl`/`ControlMessage` → ausschließlich gezieltes `MeteredPeer.sendTo` → bekannter Peer derselben Lobby. Host entscheidet über Spieler und Displays. Aus dem SDK-Envelope kommt die tatsächliche temporäre Absender-ID; vom Client behauptete Host-Rechte werden nicht übernommen. Unbestätigte Peers erhalten nur den Beitrittsaustausch, keine Spiel-Snapshots. Bei bestätigten Spielern sind Steuerdaten einschließlich Namen, Prompt, Votes und Scores für Metered verarbeitbar; sie sind keine P2P-Geheimnisse.

**Fotos:** Lokale Canvas-Neucodierung → Blob/ArrayBuffer im RAM → `PhotoChannel` → echter ordered/reliable `RTCDataChannel` mit Label `photo-transfer` → Empfängerprüfung/ACK. Pakete inklusive Header maximal 16 KiB; `TRANSFER_START`, binärer `PHOTO_CHUNK`, `TRANSFER_COMPLETE`, `TRANSFER_CANCEL` und `TRANSFER_ACK`. Keine Foto-Bytes im Metered-Messaging. Backpressure mit `bufferedAmount`/`bufferedAmountLowThreshold`. Ein aktiver eingehender und ein ausgehender Transfer je zugelassenem Peer, begrenzte Bildgröße, Zeitlimits, MIME/Signatur-/Abmessungsprüfung und Rollen-/Rundenprüfung. Kein Originalversand.

**Party/Display:** Maximal 10 Spieler einschließlich Host, separat bis zu 3 Displays. `HOST`, `PLAYER`, `DISPLAY`; Modi `PARTY`, `REMOTE`. Displays brauchen eigene Freigabe und ID, erhalten nur `PublicDisplayState` ohne Votes, Submission-Zuordnungen oder private Fotos. Erst mit öffentlichem Reveal sendet der Host die jeweilige Bilddatei. Displays können nicht voten, reagieren oder einreichen. Ein Player im Party-Modus bekommt keine fremden Bilddateien. Remote-Spieler erhalten ebenfalls nur bereits enthüllte Bilder.

## Identität und Reconnect

Spieler-ID bzw. separate Display-ID sind lokale UUIDs. Ein zusätzlicher P-256-Schlüssel im RAM signiert die Bindung aus Lobby, App-ID, Rolle und momentaner Metered-Peer-ID. Ein kopierter Name/eine kopierte ID ist daher keine automatische Wiederanmeldung. Der Host hält autorisierte Identitäten und den Spielstand getrennt von den vorübergehenden Transporten.

Bei Reset: alten Kanal schließen, Listener entfernen, Chunk Maps und laufende Requests abbrechen, neue `remote.pc` verwenden. Nur `!remote.polite` erstellt den neuen Kanal. Die Gegenstelle nimmt `data-channel` entgegen. Keine Wiederverwendung alter PC-/Kanalreferenzen. Neue Metered-IDs werden nach Signaturprüfung wieder an denselben Spieler gebunden. Online/Offline, Sichtbarkeit, `pageshow`, regelmäßige Prüfungen sowie SDK-Reconnect/ICE Restart werden berücksichtigt. Nach Wiederverbindung fordert der Gast einen aktuellen Snapshot an; bereits öffentliche Fotos werden bei Bedarf nochmals übertragen.

Getrennte Spieler bleiben mindestens fünf Minuten erhalten; aktuell bis zum Entfernen/Spielende. Nach echtem Reload ist wegen des verlorenen RAM-Schlüssels eine neue ausdrückliche Freigabe nötig. Der Host muss dabei den alten Teilnehmer als offline sehen; zwei verschiedene Schlüssel können nicht gleichzeitig dieselbe Spieler-ID übernehmen. Nach Host-Reload ist das Spiel beendet. Die App speichert absichtlich keine Host-Partie auf einem Server.

## Cleanup und Zugriffsschutz

Rundenwechsel/Ergebnis/Verlassen: Object URLs widerrufen, Blob-Referenzen und Chunk Maps entfernen, Requests abbrechen, Transferzustand löschen. Disconnect bricht laufende Transfers ab. Bekannte Peers außerhalb ihrer Rolle, andere Runden, manipulierte Kontrollnachrichten, zu große Fotos, doppelte Stimmen und Self-Votes werden abgewiesen. Keine Daten für abgelehnte Peers. Einladungslink/QR bindet den Host-Schlüssel; bei Code-Eingabe ohne Schlüssel bleibt die anfängliche Host-Zuordnung ein Vertrauensschritt.

Prüfung der Fotoausgänge: kein fetch, XMLHttpRequest, sendBeacon, FormData, HTTP-/REST-Upload, Base64-Bildtransport, IndexedDB, Cache oder Service Worker für Fotos. Browser-Speicherung nur für IDs/Anzeigename, keine Bilddaten. Kontrollschemas lehnen zusätzliche unbekannte Felder ab. `PhotoTransferMessage` und Kontrolltypen sind getrennt. Der einzige SDK-Sendeaufruf ist die validierende `sendControl`-Funktion in `room.ts`; RTC-Sendeaufrufe stehen ausschließlich im Fototransport. Das SDK nutzt WebSockets intern für Signaling und Control.

## Einrichtung und bekannte Grenzen

- Bestehendes GitHub/Vercel behalten. Publishable Key in Vercel setzen und neu deployen; lokal `.env.local`. Keine echten Keys einchecken. `VITE_`-Werte sind im ausgelieferten Bundle sichtbar – Publishable ist kein Secret.
- Aktiver Metered-TURN-Dienst und eingeschaltete Auto-Injection sind Voraussetzungen für den Relay-Fallback. Keine TURN-Zugangsdaten werden von der App hardcodiert oder gespeichert.
- Laut Metered-Dokumentation haben Publishable Keys keine Origin-Beschränkung. Auf `game-*` und die benötigten Aktionen begrenzen; kopierte Keys können Dienst-/TURN-Kontingente verbrauchen. App-Freigaben ersetzen keine serverseitige Kosten-/DoS-Begrenzung. Das ist eine Einschränkung der verlangten Architektur ohne Backend/JWT.
- Metered sieht Steuer-/Verbindungsdaten. TURN sieht verschlüsselte Pakete und Verkehrsdaten, keine entschlüsselten Fotos. Keine Zusicherung zu fremden Speicherfristen oder Rechenzentrumsstandorten.
- iOS kann Tabs verwerfen, Browser können WebRTC blockieren, Netze und Dienste können ausfallen. Reconnect erhält Zustand nur solange der Host-Tab überlebt. Unterbrochene, noch nicht bestätigte Uploads ggf. erneut auswählen; bereits bestätigte Einreichungen bleiben beim Host.
- Bekannte Mitspieler können Screenshots machen; Entfernen löscht nicht deren Kopien. Keine absolute Unangreifbarkeit oder Garantie für jedes Netzwerk.
- **Kein echter Metered-/iPhone-/Mobilfunk-End-to-End-Test in der Entwicklungsumgebung erfolgt.** Automatisierte Tests prüfen SDK-Ereignisfolgen, Signaturen, Controller, Transfer, Backpressure, Rollen, Datenschutzgrenzen und Cleanup. Die folgende Liste muss mit dem konfigurierten Dienst auf echten Geräten durchgeführt werden.

## Konkrete manuelle Testliste

Vorbereitung: `VITE_METERED_API_KEY` in Vercel setzen, TURN aktiv/Auto-Injection prüfen, neu deployen, beide Geräte neu laden. Für Diagnose auf einem Desktop einen lokalen Development Build mit demselben Key starten oder vor dem Spiel `chrome://webrtc-internals` öffnen. Debugpanel ist im Production Build absichtlich nicht enthalten.

| Nr. | Test | Erwartetes Ergebnis |
|---|---|---|
| 1 | Zwei Browser-Tabs: Host erstellt Remote-Lobby, zweiter Tab öffnet Link. Erst ablehnungsfrei anfragen, dann Host-Freigabe. Beide reichen unterschiedliche Fotos ein und stimmen ab. | Vor Freigabe kein Spielstand; danach beide Fotos, sequenzieller Reveal, gültiges Voting, genau ein Punkt. Kein eigener Upload beim Host nötig, um den Gasttransfer auszulösen. |
| 2 | Laptop und Smartphone im selben WLAN, neue Party-Lobby. | Spielerfoto kommt beim Host an; Handy sieht Prompt/Voting, keine fremden Fotos. |
| 3 | Laptop im WLAN, Smartphone nur über Mobilfunk. Remote-Lobby und eine ganze Runde spielen. | Automatischer Aufbau ohne weitere Codes/JSON. Falls direkte Route blockiert, TURN-Relay; Foto-ACK wird erreicht. Bei Fehler Debugzustand/aktive TURN-Konfiguration prüfen. |
| 4 | Smartphone nach bestätigter Einreichung 30 Sekunden sperren, wieder öffnen. | Verbindung/Snapshot erholen sich; gleicher Spieler, Score und bereits bestätigte Einreichung bleiben erhalten. Ggf. „Erneut versuchen“; keine neue Partie. |
| 5 | Während der Runde am Smartphone WLAN deaktivieren, auf Mobilfunk wechseln. | Unterbrechung wird angezeigt, laufender Transfer abgebrochen, neue Verbindung aufgebaut. Kein doppelter Spieler oder Punkt. Unbestätigtes Foto ggf. erneut auswählen. |
| 6 | Weiterer Spieler stellt Anfrage; Host lehnt ab. | Keine Spiel-Snapshots, kein Fotokanal, keine Bilder; Ablehnung statt endloser Suchanzeige. |
| 7 | Im Party-Modus „Als Display beitreten“ wählen, Host lehnt ab. | Kein öffentlicher oder privater Spielstand, keine Bilder, Spielerzahl unverändert. |
| 8 | Display zulassen, während Fotoauswahl prüfen: keine Bilder. Ein Bild enthüllen; Display neu laden, wieder beitreten und erneut freigeben. | Display zählt nicht als Spieler, keine Vote-/Upload-Steuerung. Nach erneuter Freigabe nur aktueller öffentlicher Stand und bereits enthülltes Bild; keine künftigen Fotos. |
| 9 | Browser-Netzwerkansicht öffnen, Testfoto auswählen/senden. Metered-WebSocket-Frames und HTTP-Anfragen prüfen. | Keine Bilddatei, Bildbytes oder Base64-Bilder in HTTP/WebSocket-Control. RTC-DataChannel-Statistik zeigt Bytezuwachs. Im Foto-Wire-Test werden Chunking und ACK separat geprüft. Keine echten Keys/SDP/IP-Logs weitergeben. |
| 10 | In einem restriktiven Netz verbinden und ausgewähltes ICE-Candidate-Paar prüfen. | Debugpanel bzw. WebRTC-Internals zeigt `relay`, wenn TURN gewählt wurde. `direct` im offenen Netz ist richtig. Fehlendes `relay` in einem einfachen Netz beweist keinen Fehler; fehlende TURN-Konfiguration dagegen im Konto prüfen. |

Abschluss zusätzlich: neue Runde und Spiel verlassen → keine alten Object URLs in der App; Debugdiagnose zeigt keine aktiven Transfers. Die automatisierten Befehle sind `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
