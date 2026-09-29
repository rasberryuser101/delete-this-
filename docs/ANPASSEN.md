# Delete That! – dein Spickzettel für GitHub

## Ein einziger Branch reicht dir

Öffne immer diesen Link und speichere ihn als Lesezeichen:

**https://github.com/rasberryuser101/delete-this-/tree/cloudflare-migration**

`cloudflare-migration` ist die Version, aus der Cloudflare deine spielbare Website baut. `main` enthält noch den älteren Stand. Du musst für Sounds, Grafiken oder Packs keinen weiteren Branch erstellen. Beim Speichern **Commit directly to the cloudflare-migration branch** auswählen. Ein „Commit“ ist einfach ein gespeicherter Änderungsschritt. Danach baut Cloudflare automatisch neu. Erst wenn „Workers Builds: delete-this“ erfolgreich ist, beide Spielgeräte neu laden und eine neue Lobby erstellen.

Repo-Name und Worker-Adresse heißen technisch weiterhin `delete-this`. Der sichtbare Spielname ist jetzt **Delete That!**. Das vermeidet kaputte Links und neue Hosting-Konfiguration.

## Was liegt wo?

| Du möchtest … | Datei/Ordner im Repository |
| --- | --- |
| Name, Untertitel, Farben, Lautstärken, Showtempo ändern | `customization.json` im Hauptordner |
| Musik austauschen | `public/media/music/` |
| Soundeffekte austauschen | `public/media/sfx/` |
| Kamera, Trommel, Vorhang, Pokal und Ticket ersetzen | `public/media/art/` |
| Avatare ersetzen oder weitere anbieten | `public/media/art/avatars/` plus Liste in `customization.json` |
| Ein Prompt-Pack hinzufügen/ändern/löschen | `src/packs/` |

Die Avatare werden aktuell automatisch aus dem Spielernamen zugeordnet; auf allen Geräten gleich. Es gibt keine persönlichen Avatar-Uploads. Alle Medien, die du ins Repository lädst, sind **öffentliche Website-Dateien**. Private Spielfotos gehören niemals hier hinein.

## Musik: am einfachsten MP3 hochladen

Direktlink: https://github.com/rasberryuser101/delete-this-/tree/cloudflare-migration/public/media/music

| Dateiname | Wann läuft sie? |
| --- | --- |
| `lobby.mp3` | Lobby und Warten auf Freigabe |
| `submit.mp3` | Fotos auswählen |
| `reveal.mp3` | Vorhang und Foto-Show |
| `vote.mp3` | Abstimmung |
| `result.mp3` | Zwischenstand nach einer Runde |
| `finale.mp3` | Gesamtrangliste nach der letzten Runde |

1. Benenne die gewünschte MP3 auf deinem Computer entsprechend um, z. B. `lobby.mp3`.
2. Öffne den **music-Ordner** über den Link oben.
3. **Add file → Upload files**. Ziehe die Datei hinein. Lade die Datei selbst hoch, keinen zusätzlichen `music`-Ordner.
4. Nachricht wie „Neue Lobby-Musik“, direkt auf `cloudflare-migration` speichern.
5. Nach erfolgreichem Build die Website neu laden und Musik einschalten.

Die Datei wird beim Build erkannt. Du musst dafür keinen Programmcode ändern. Noch keine Dateien? Dann verwendet jede Phase eigene lokale Synthesizer-Ersatzmusik. Die bisherige ruhige Dauermelodie wurde ersetzt. Musik bleibt zunächst aus, damit sie nicht ungefragt auf jedem Handy läuft.

Empfehlung: ein sauber geschnittener Loop mit 15–60 Sekunden, MP3 mit 128–192 kbit/s. Grenze: 8 MB und 120 Sekunden pro Musikdatei. Ein langer Titel wird nicht durch bloßes Umbenennen kürzer. Die App wiederholt die Datei; für einen nahtlosen Übergang muss ihr Anfang zum Ende passen. Lautstärke vor dem Hochladen normalisieren.

MP3 funktioniert gut über Geräte hinweg. WAV und OGG sind ebenfalls konfigurierbar, können aber größer sein bzw. vom Browser abhängen. Dafür den Pfad in `customization.json` passend ändern. Fehlende oder nicht abspielbare Sounds verwenden Ersatzklänge und blockieren das Spiel nicht.

## Soundeffekte

Direktlink: https://github.com/rasberryuser101/delete-this-/tree/cloudflare-migration/public/media/sfx

| Datei | Einsatz |
| --- | --- |
| `button.mp3` | Klick |
| `connected.mp3` | Spieler verbunden |
| `prompt.mp3` | Neuer Prompt |
| `countdown.mp3` | Jeder Countdown-Schritt |
| `submit.mp3` | Foto bestätigt |
| `drumroll.mp3` | Vorhang vor der Foto-Show |
| `camera.mp3` | Einzelnes Foto erscheint |
| `voting.mp3` | Abstimmung beginnt |
| `vote.mp3` | Stimme abgegeben |
| `winner.mp3` | Rundenergebnis |
| `gameover.mp3` | Gesamtergebnis |
| `reaction.mp3` | Reaktion |
| `error.mp3` | Fehler |
| `reveal.mp3` | Reserve für einen allgemeinen Reveal-Effekt |

Effekte möglichst kurz: Klick 0,05–0,2 s, Countdown unter 0,5 s, Trommelwirbel ca. 1,5–3 s. Maximal 1 MB und 10 s pro Effekt. Dateien genauso hochladen wie Musik. Vorhandene Effekte werden beim Spielstart vorgeladen; falls ein Effekt vorher ausgelöst wird, erklingt zunächst der lokale Ersatz. Der Mute-Schalter schaltet Musik und Effekte gemeinsam aus.

Kostenlos/„royalty-free“ bedeutet nicht automatisch, dass jede Nutzung oder Weitergabe erlaubt ist. Wähle Dateien, deren Lizenz die Nutzung auf deiner Website **und die öffentliche Bereitstellung im Repository** erlaubt, gegebenenfalls auch kommerziell. Bei Namensnennungspflicht trage einen Nachweis ein (unten). Es wurden keine Stock-Sounds ohne Lizenznachweis eingebaut.

## Grafiken austauschen

Direktlink: https://github.com/rasberryuser101/delete-this-/tree/cloudflare-migration/public/media/art

| Platzhalter | Vorschlag für deine Datei |
| --- | --- |
| `camera.svg` | Quadratische Kamera/Logoillustration, transparenter Hintergrund |
| `drum.svg` | Quadratische Trommel-/Showgrafik |
| `trophy.svg` | Quadratischer Pokal oder Siegermaskottchen |
| `ticket.svg` | Quadratische Verbindung-/Einlassgrafik |
| `curtain.svg` | Einzelne linke Vorhangbahn, Seitenverhältnis etwa 1:5; rechts gespiegelt |
| `avatars/01.svg` bis `06.svg` | Quadratische Charakterköpfe, z. B. 256 × 256 px |

SVG, PNG, WebP und JPEG sind möglich, maximal 2 MB pro Grafik. PNG/WebP mit Transparenz eignen sich gut. Keine externen Schriften, Skripte oder verlinkten Bilder in SVGs einbetten.

**Wenn das Format gleich bleibt:** Gleichen Dateinamen im gleichen Ordner hochladen, dann wird die bisherige Version ersetzt.

**Wenn du z. B. PNG statt SVG willst:** `drum.png` in `public/media/art` hochladen und in `customization.json` bei `art.drum` den Wert auf `media/art/drum.png` ändern. Erst nach dieser Änderung die alte SVG löschen. Eine PNG einfach in `.svg` umzubenennen konvertiert sie nicht.

Weitere Avatare: Dateien hochladen und ihre Pfade zur Liste `art.avatars` hinzufügen. Beim Ersetzen vorhandener sechs Dateien bleibt die Zuordnung stabil. Ändert sich die Listenlänge oder Reihenfolge, können Namen andere Avatare bekommen.

## Einstellungen bearbeiten

Direktlink: https://github.com/rasberryuser101/delete-this-/blob/cloudflare-migration/customization.json

Datei öffnen → Stift **Edit** → Wert ändern → **Commit changes**. Anführungszeichen und Kommas beibehalten. JSON erlaubt keine Kommentare.

- `theme.accent`: Akzentfarbe, z. B. `#f22882`. Die Illustrationen haben eigene Farben.
- `theme.ink`: Konturen-/Textfarbe, z. B. `#17111e`.
- `audio.musicVolume` und `effectsVolume`: 0 = stumm, 1 = volle Lautstärke. Standard 0.35 / 0.65. Auch die Originaldatei beeinflusst die wahrgenommene Lautstärke.
- `show.introMs`: Vorhangdauer; 4500 = 4,5 Sekunden.
- `show.photoMs`: Mindestzeit pro Foto nach bestätigter Übertragung; 6500 = 6,5 Sekunden. Erlaubt: 1500–20000.
- `credits`: optionale Liste von Lizenznachweisen, die im Spiel unter **Info → Musik- und Grafiknachweise** erscheint. Beispiel:

```json
"credits": [
  {
    "title": "Titel deines Sounds",
    "author": "Name des Urhebers",
    "license": "Genaue Lizenz laut Anbieter",
    "url": "https://example.org/originalquelle"
  }
]
```

Schlechte Konfigurationen stoppen den Build mit einer Fehlermeldung. Die zuletzt erfolgreich veröffentlichte Version bleibt dann bestehen. Fehlende optionale Audiodateien sind erlaubt; eine konfigurierte Grafik muss vorhanden sein.

## Dateien oder ganze Ordner löschen

Auf GitHub den gewünschten **Ordner öffnen**, rechts oben das **…-Menü** → **Delete directory**. Inhalt kontrollieren und den Commit direkt auf `cloudflare-migration` speichern. Für einzelne Dateien: Datei öffnen → **… → Delete file**. Du brauchst Schreibrechte und musst im Repository angemeldet sein.

Ein Ordner verschwindet auch, wenn seine letzte Datei gelöscht ist. Nur neue Dateien hochzuladen entfernt alte Dateien nicht. Löschen verändert den aktuellen Stand; frühere Versionen bleiben in der Git-Historie.

Bei vielen Änderungen ist der Browsereditor praktischer: Repository öffnen und auf der Tastatur **`.`** drücken. Im Datei-Explorer kannst du Dateien und Ordner verwalten. Abschließend im Bereich **Source Control** alle gewünschten Änderungen kontrollieren, eine Nachricht eintragen und **Commit & Push** wählen. Auch hier vorab den richtigen Branch kontrollieren. Du musst keine neue lokale Entwicklungsumgebung einrichten.

## Etwas versehentlich geändert?

Bei einer kleinen Textänderung: Datei öffnen → **History** → vorherige Version ansehen; deren Inhalt wieder in die aktuelle Datei kopieren und als neuen Commit speichern. Bei Grafiken die frühere Datei herunterladen und wieder unter demselben Namen hochladen. Das ist für einzelne Dateien übersichtlicher als die gesamte Branch-Historie zurückzusetzen. Wenn ein Build fehlschlägt, zuerst seine Fehlermeldung lesen; nicht wahllos weitere Branches anlegen.

## Runden und Architektur

Der Host wählt in der Lobby **3, 5 oder 10 Runden**. Während einer Partie bleibt die Anzahl fest. Nach der letzten Runde erscheint das Endergebnis, bei Punktegleichstand mehrere Sieger. **Revanche** setzt Punkte und Rundennummer zurück und führt dieselben Geräte in die Lobby zurück; dort sind Rundenzahl und Packs wieder änderbar.

Das braucht nur eine kleine zusätzliche Zahl im bestehenden Spielstand, keinen neuen Dienst und keine Datenbank. Die Übertragungskosten pro Runde bleiben ungefähr gleich; eine kurze Partie hat insgesamt entsprechend weniger Fotos. Die bestehende Bildkomprimierung und der Party-Modus sparen deutlich mehr. Statische Musik/Grafiken laufen über das Website-Hosting, nicht über TURN. Sie erhöhen die Downloadmenge für Besucher, nicht die Anzahl der Foto-Relay-Übertragungen.

## Offizielle GitHub-Hilfe

- Dateien/Ordner löschen: https://docs.github.com/en/repositories/working-with-files/managing-files/deleting-files-in-a-repository
- Dateien hochladen: https://docs.github.com/en/repositories/working-with-files/managing-files/adding-a-file-to-a-repository
- Browsereditor: https://docs.github.com/en/codespaces/the-githubdev-web-based-editor
