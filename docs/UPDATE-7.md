# Update 7 – neue Spielregeln

## Wie ihr schaut

- **Jeder auf seinem Handy:** maximal 8 Spieler. Enthüllte Fotos werden über WebRTC an alle übertragen.
- **Gemeinsamer Bildschirm:** maximal 20 Spieler. Das Gerät, das die Lobby erstellt, zeigt die Show. Beim Erstellen „Dieses Gerät ist nur Bildschirm und Spielleitung“ einschalten, wenn es kein Foto einreichen und nicht abstimmen soll. Zum selbst Mitspielen den normalen Einladungslink auf einem Handy öffnen. Kein separater Display-Beitritt nötig.
- Im Reverse-Modus erhält jeder Textautor zusätzlich genau das Foto, das er beschriften soll. Die Fotos werden weiterhin ausschließlich über WebRTC übertragen.
- 20 Geräte sind die Obergrenze, kein Nachweis für ein bereits erfolgreich durchgeführtes Spiel mit 20 realen Geräten. Vor einer großen Party unbedingt mit den vorgesehenen Geräten testen. Das Host-Gerät muss geöffnet bleiben.

## Vier getrennte Spielmodi

**Klassisch:** Prompt aus den ausgewählten JSON-Packs → kurzer Leseauftritt → Fotoauswahl → Show → Abstimmung.

**Eigene Prompts:** Jeder schreibt einen Text mit 5–250 Zeichen. Einer wird zufällig ausgewählt. Dann spielen alle mit Fotos zu diesem Prompt. Der Host kann mit bereits eingereichten Texten starten.

**Reverse:** Zuerst reicht jeder ein Foto ein. Eine zufällige zyklische Zuteilung sorgt dafür, dass niemand sein eigenes Foto beschriftet. Jeder schreibt 3–250 Zeichen zum Foto eines anderen. Die Show enthüllt Bild und Text gemeinsam. Punkte gehen an die Person, die den Text geschrieben hat. Für den eigenen Text kann man nicht stimmen.

**Mix:** Wähle mindestens einen der drei Modi. Für jede Runde wird zufällig einer der ausgewählten Modi gezogen. Die Variante und der Mix können in der Lobby und zwischen Runden geändert werden.

## Punkte und Skip

Jede erhaltene Stimme gibt einen Punkt. Optional bekommt ein Rundensieger einen zusätzlichen Bonuspunkt. Bei Stimmengleichheit wird der Bonus unter den Bestplatzierten ausgelost. Der Gesamtsieg wird bei gleichen Punkten geteilt.

Mit „Prompt passt nicht“ kann jeder Spieler einmal pro angezeigtem Prompt stimmen. Mehr als die Hälfte der verbundenen Spieler muss zustimmen. Maximal drei Wechsel pro Runde. Der reine Bildschirm zählt nicht mit. Beim Wechsel werden eingereichte Fotos, Object-URLs und laufende Transfers aufgeräumt. Die Rundenzahl bleibt gleich. Reverse hat keinen vorgegebenen Prompt und deshalb keinen Prompt-Skip.

Unter **Spielleitung: Runde hängt?** kann der Host:

- Bereits eingereichte Prompts/Fotos/Texte verwenden, falls genug vorhanden sind.
- Mit vorhandenen Stimmen auswerten.
- Die komplette Runde ohne Punkte überspringen; sie zählt als gespielte Runde.

## Verbindungsabbruch

Ein offline gegangener Spieler blockiert die Foto-Show nicht. Bereits bestätigte Einreichungen, Stimmen und Punkte bleiben erhalten. Derselbe offene Tab kann mit seinem im RAM gehaltenen Geräteschlüssel wieder verbinden, ohne neu freigegeben zu werden. Beim vollständigen Neuladen muss der Host die neue Identität erneut freigeben. Gäste versuchen automatisch, sich wieder zu verbinden; der Knopf „Erneut verbinden“ fordert den aktuellen Spielstand an.

Der Host kann getrennte Spieler entfernen. Ein ausdrücklich entfernter Spieler erhält keine weiteren Bilder. Bei zu wenigen Spielern kann der Host die Runde überspringen und zwischen den Runden neue Gäste freigeben. Verliert der Host selbst seine Sitzung durch Schließen/Neuladen, gibt es keinen serverseitigen Foto-/Spielstand-Backup und keine Übernahme durch ein anderes Gerät.

## Eigene Profilbilder

Datei nach `public/media/art/avatars/` hochladen und auf `cloudflare-migration` committen. Nach dem Build erscheint sie automatisch. Beispielsweise `katze.png`, maximal 2 MB, quadratisch. Kein Konfigurationseintrag nötig. 18 SVG-Avatare sind mitgeliefert.

## Veröffentlichung dieses Pakets

Den Inhalt des Projektordners ins Repository kopieren, nicht noch einmal den äußeren Ordner darin anlegen. Bereits vorhandene MP3s behalten: `public/media/music/lobby.mp3`, `submit.mp3`, `finale.mp3`. Dieses Quellpaket enthält keine persönlichen TURN-Secrets. Bereits im Cloudflare-Worker gesetzte Secrets bleiben dort erhalten. Danach Commit auf dem für Cloudflare eingestellten Branch und Build prüfen. Beide Spielgeräte neu laden und eine neue Lobby erstellen; alte und neue Clients sind nicht kompatibel.
