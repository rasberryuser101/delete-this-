# Version 7.2: Weniger Verkehr, dieselbe Foto-Show

## Verbindungsfix 7.2.1

Der Relay-Abruf war zusätzlich an dieselbe IP-Adresse wie die WebSocket-Verbindung gebunden. Das konnte ein bereits freigegebenes Gerät abweisen, wenn HTTP und WebSocket unterschiedliche Netzwerkwege verwenden. Jetzt authentifiziert ein zufälliges RAM-Ticket die aktive, freigegebene Verbindung in genau dieser Lobby. Die ursprüngliche IP-Kennung der Lobby-Verbindung bleibt für das Missbrauchslimit maßgeblich; ein Wechsel der HTTP-IP setzt den Zähler nicht zurück. Freigabeentzug und eine erneute Prüfung nach der externen Antwort bleiben bestehen.

Veraltete Tabs erhalten beim Verbindungsaufbau eine Aufforderung zum Neuladen, statt auf den früheren Spielkanal zu warten. Nach diesem Update beide Geräte neu laden und eine neue Lobby erstellen. Die optionale Diagnose unterscheidet abgelehnte Zugänge (403), Schutzpausen (429) und Dienstausfälle (503), ohne Tickets oder Anbieterantworten auszugeben.

Der Fehler wurde im lokalen Worker mit einer abweichenden HTTP-IP zunächst als 403 reproduziert; derselbe Test besteht nach dem Fix. Die 103 automatisierten Tests, Typecheck, Lint, Build und Worker-Smoke-Test prüfen den Code. Sie ersetzen keinen Live-Test zwischen einem echten iPhone und PC.

Stand: 30.09.2026. Keine neue Infrastruktur und keine Änderung an deinen Musikdateien oder Packs. Bestehende Cloudflare-TURN-Secrets bleiben gültig. Nach dem Deployment **alle Geräte neu laden und eine neue Lobby erstellen**: alte und neue Spielkanäle sind nicht kompatibel.

## Was geändert wurde

| Änderung | Wirkung | Für die Gruppe |
| --- | --- | --- |
| Eigener RTC-Spielkanal neben dem Fotokanal, auf derselben Verbindung | Prompts, Stimmen, Punkte, Countdown und Reactions erzeugen keine Cloudflare-Lobby-WebSocket-Nachrichten mehr. Bei Relay-Nutzung entsteht dafür kleines TURN-Volumen. | Dieselben Funktionen; Bestätigungen für wichtige Aktionen bleiben. |
| Identische Spielstände auslassen, Änderungen im selben Ablauf bündeln | Weniger Nachrichten und ACKs auf dem Spielkanal. | Kein künstliches Warten oder langsameres Showtempo. |
| Eigenes Foto lokal behalten | Der Host schickt dir dein Bild nicht zurück. | Kein Unterschied bei der anonymen Präsentation; alle Bilder bleiben nur bis Rundenende im RAM. |
| Vorhandene Fotos bei Reconnect melden | Kein erneuter Versand bereits vorhandener, aktuell erlaubter Bilder. | Nach Tab-Neuladen müssen Fotos erneut empfangen werden, weil es keinen dauerhaften Bildspeicher gibt. |
| Fotoziel 400 → 300 KB, weiterhin höchstens 1280 px | Niedrigeres Größenziel; Bild und Browser bestimmen die tatsächliche Einsparung. Schon kleine Fotos bleiben unverändert. | Bei detailreichen Bildern etwas stärkere Kompression; sehr große Bilder werden zusätzlich verkleinert. |
| Relay-Ausgabe als Worker-HTTP-Aufruf | Die Lobby wartet nicht auf den externen Credential-Dienst. Die leere Lobby braucht keine Zugangsdaten. Aktive Verbindungen teilen einen gecachten Zugang pro Gerät. | Netzwerkhilfe und Wiederverbindung bleiben erhalten. |
| Raum-/IP-/Verbindungslimits statt festem globalem 500er-Stopp | Ein einzelner Raum kann nicht unbegrenzt Zugangsdaten abrufen; reguläre Lobbys teilen keine kleine globale Schranke mehr. | Kein CAPTCHA. Ein optionales Betreiber-Tageslimit ist möglich, aber kein Kostenlimit. |
| Transaktionale Missbrauchszähler, Ablaufalarm nur bei Erstellung eines Zählers | Keine zusätzliche Alarm-Abfrage für jeden Versuch; gleichzeitige Anfragen können den Zähler nicht überholen. | Keine Änderung beim Spielen. |

Reactions übertragen nur eine Kennung: Der zugehörige Sound wird lokal abgespielt, keine Audiodatei zwischen Spielern verschickt. 100 Gast-Reactions in einer 8er-Lobby erzeugten vorher ungefähr 1600 eingehende Lobby-WebSocket-Nachrichten inklusive ACKs. Jetzt entstehen dafür **0** solche Lobby-Nachrichten. Das ist keine 100-%-Einsparung aller Backend-Anfragen: Beitritt, Freigaben, ICE, Reconnects und Relay-Zugänge bleiben.

## Verbrauchsbeispiel

8 Personen einschließlich mitspielendem Host, 5 Runden, alle sehen Fotos auf dem Handy, keine zusätzlichen Displays:

| Annahme | Bild-Nutzdaten pro Partie | Änderung gegenüber vorher |
| --- | ---: | ---: |
| Vorher, durchschnittlich 250 KB/Foto | 78,75 MB | Ausgangswert |
| Jetzt, weiterhin 250 KB/Foto | 70 MB | rund 11 % weniger durch Weglassen eigener Rücksendungen |
| Jetzt, falls Kompression den Durchschnitt auf 200 KB senkt | 56 MB | rund 29 % weniger insgesamt |
| Gemeinsamer Host-Bildschirm, 250 KB/Foto | 8,75 MB | rund 89 % weniger als der alte Handy-Modus |

Die 200 KB sind ein Rechenbeispiel, kein gemessener neuer Durchschnitt. Bei zwei Personen spart die eigene Foto-Wiederverwendung ein Drittel der Bild-Nutzdaten; bei acht Personen ein Neuntel. Zusätzliche Einsparungen durch Reconnects hängen davon ab, wie oft Verbindungen abbrechen. WebRTC/TURN-Verpackung, kleine Spieltexte und Wiederholungen kommen hinzu. Direkte Verbindungen benötigen kein TURN-Fotovolumen. Maßgeblich für die Rechnung ist Cloudflares gemessener **ausgehender TURN-Verkehr**, nicht die Summe lokaler Fotogrößen.

## Kostenbeispiel bei 1000 Partien am Tag

Als Annahme: 30 Tage, jeweils 8 Personen, 5 Runden, durchschnittlich 200 KB pro Foto nach Verarbeitung. Das ergibt rund 1680 GB Bild-Nutzdaten im Handy-Modus. Wenn Cloudflare am Monatsende tatsächlich 1680 GB berechnungsrelevanten TURN-Verkehr misst, lautet die Rechnung:

**(1680 GB − 1000 GB frei) × 0,05 USD = 34 USD TURN im Monat.**

Bei tatsächlich nur 840 GB TURN-Verkehr wären es 0 USD TURN. Entscheidend ist also, welche Strecken ein Relay benötigen; bei unterschiedlichen Netzwerken wird außerdem nicht zwangsläufig jedes gesendete Foto auf derselben TURN-Strecke abgerechnet. Für ein einfaches, von Bildgrößen unabhängiges Beispiel: **1500 GB gemessenes TURN-Volumen kosten 25 USD** nach der 1000-GB-Freimenge. Die Freimenge teilen TURN und Realtime SFU sowie andere Projekte im Konto.

Workers und Durable Objects werden separat abgerechnet. Auf Workers Free können erreichte Tageslimits Anfragen blockieren; es wird nicht automatisch ein Paid-Tarif gebucht. Workers Paid beginnt mit 5 USD pro Monat. Blieben dessen übrige Kontingente eingehalten, ergäbe das beim 1680-GB-Beispiel **39 USD insgesamt**, vor Steuern. Das ist keine Kostenobergrenze. Weitere beispielhafte Aufpreise im Paid-Tarif:

| Abrechnung | Enthalten pro Monat | Beispiel über der Freimenge |
| --- | --- | --- |
| Worker-Anfragen | 10 Mio. | 12 Mio. insgesamt → 0,60 USD zusätzlich |
| Worker-CPU | 30 Mio. CPU-ms | 40 Mio. insgesamt → 0,20 USD zusätzlich |
| Durable-Object-Anfragen | 1 Mio. | 2 Mio. insgesamt → 0,15 USD zusätzlich |
| Durable-Object-Laufzeit | 400.000 GB-s | 500.000 insgesamt → 12,50 USD zusätzlich, wegen Aufrundung der Mehrnutzung auf eine Million GB-s |

Speicher- und Build-Nutzung haben eigene Kontingente. Die Beispiele sind einzelne Dimensionen, keine Vorhersage der tatsächlichen Nutzung dieser App. Eine Dauerverbindung verursacht bei hibernationsfähigem, untätigem Durable Object keine fortlaufende Laufzeit-Abrechnung. Der größere Unterschied in 7.2: Spielaktionen wecken es nicht mehr und der externe Relay-Abruf hält es nicht wach. Eine seriöse Prozentzahl für Laufzeit und Gesamtkosten erfordert neue Live-Messwerte.

## Grenzen und Prüfung

Die Anwendung bewahrt Host-Freigabe, signierte WebRTC-Angebote, erlaubte Rollen, Rundenprüfung, Empfangsbestätigungen und Foto-Cleanup. Tickets für Relay-Zugänge bleiben im RAM und werden nie in Einladungslinks geschrieben. Der Worker prüft sie gegen die aktive Freigabe und Lobby-Verbindung; nach der externen Antwort wird die Freigabe erneut geprüft. IP-Kennungen dienen den Missbrauchslimits und sind keine Identitätsprüfung. Der Code allein ermöglicht weiterhin nur eine Beitrittsanfrage.

Der Standard hat nun 180 Relay-Anforderungen/Lobby/Stunde plus 90/IP/Stunde und höchstens eine/Verbindung/Minute. Verbindungsaufbau bleibt begrenzt auf 10 Host- und 40 Gastversuche/IP/Stunde sowie eine zusätzliche schnelle Schranke. Geteilte WLANs teilen die IP-Limits. Bei vielen Wiederverbindungen im selben großen WLAN kann das limitieren; beobachte echte Nutzung, bevor du Grenzen anhebst. `TURN_DAILY_LIMIT` ist optional und begrenzt Zugangsausgaben pro 24-Stunden-Fenster, nicht Partien, GB oder Euro.

Verteilte Angreifer können weiterhin selbst Host werden und kurzlebige Zugangsdaten bis zu deren Ablauf zweckentfremden. Host-Freigabe schützt deine Bilder vor Fremden, ist keine Identitätsprüfung für alle Betreiber von Lobbys. Budgetwarnungen stoppen keinen Verkehr. Weitere Betreiberhinweise und die Notfallabschaltung stehen in [BETRIEB.md](BETRIEB.md).

Tests prüfen den separaten Spielkanal mit ACKs, Ablehnungen, Duplikaten, Spam und Cleanup; asynchrone Kanalbereitschaft; manipulierte SDP-Angebote; komplette Spielrunden, 20 Gäste, eigene Foto-Wiederverwendung und Reconnects. Der lokale Worker-Test prüft die tatsächlichen HTTP-/WebSocket-Wege einschließlich TURN-Berechtigungen. Keine Lasttests werden gegen das öffentliche Cloudflare-Konto ausgeführt. Ein echter iPhone-/PC-Test bleibt zusätzlich notwendig.

Quellen: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [Realtime](https://developers.cloudflare.com/realtime/sfu/platform/pricing/), [TURN-Abrechnung](https://developers.cloudflare.com/realtime/turn/faq/).
