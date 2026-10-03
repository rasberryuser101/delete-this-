# Delete That! betreiben – ohne Fachchinesisch

Stand: 03.10.2026. Die Beträge sind Cloudflares öffentliche Listenwerte. Dein tatsächlich gebuchter Tarif und andere Projekte im selben Konto zählen mit. Dieses Repository kann deinen Kontostand nicht lesen.

## Drei unterschiedliche Zähler

| Baustein | Wozu? | Kostenloses Kontingent |
| --- | --- | --- |
| Static Assets | Website, Schrift, Programm | Abrufe kostenlos und unbegrenzt |
| Workers Free | Eingangstür zur Lobby | 100.000 Anfragen pro Tag; 10 ms CPU pro Aufruf |
| Durable Objects Free | Lobby-Verbindungen, Freigaben, Missbrauchszähler | 100.000 berechnete Anfragen und 13.000 GB-Sekunden pro Tag |
| Durable Objects SQLite | Kleine technische Zähler, keine Fotos | 5 Mio. gelesene Zeilen/Tag, 100.000 geschriebene Zeilen/Tag, 5 GB insgesamt |
| Realtime TURN/SFU | Verschlüsselter Umweg, wenn eine Direktverbindung nicht klappt | Gemeinsam 1.000 GB ausgehende Daten pro Monat, danach 0,05 USD/GB |

**1.000 GB sind ungefähr eine Million MB.** Das ist nicht die alte Metered-Grenze. Ein Foto wird nicht zu einer Worker-Anfrage pro Datenstück: Die Foto-Datei läuft über WebRTC, gegebenenfalls TURN. Die Lobby verschickt nur kurze Beitritts- und Verbindungstexte. Ab Version 7.2 laufen Spielstände, Votes und Reactions auf einem separaten verschlüsselten WebRTC-Datenkanal. Für die Durable-Object-Abrechnung zählen 20 eingehende WebSocket-Nachrichten als eine Anfrage; die Diagramme können dagegen die ungekürzte Nachrichtenanzahl zeigen. Verbindungsaufbau, Sicherheitsprüfungen und Alarme kommen dazu.

Die Tageslimits der Cloudflare-Free-Tarife beginnen um 00:00 UTC neu (Österreich: 01:00 im Winter, 02:00 im Sommer). Bei überschrittenen Workers-/DO-Free-Limits können neue Anfragen fehlschlagen. Ein gebuchter Paid-Tarif hat andere Freimengen und verbrauchsabhängige Preise. TURN ist gesondert zu betrachten: 1.000 GB sind eine Freimenge, keine garantierte Abschaltung. Keine R2-, D1-, KV- oder Foto-Speicher-Dienste sind eingerichtet.

## Wo du nachsehen kannst

1. **Gesamtnutzung/Kosten:** Konto öffnen → **Manage Account → Billing → Billable Usage**. Zeitraum prüfen. `Total usage` heißt gesamte Nutzung; `Billable usage` heißt der kostenpflichtige Anteil nach Freimenge. Unter `Product` steht das enthaltene Kontingent. Nach Realtime und Workers filtern. Diese Ansicht ist für Pay-as-you-go-Konten dokumentiert; fehlt sie, ist das kein Beweis für null Verbrauch.
2. **Lobby-Eingang:** **Workers & Pages → delete-this → Metrics**. Anfragen, Fehler und CPU ansehen. Ein plötzlicher Anstieg ohne Spielabende ist auffällig.
3. **Lobby-Räume/Zähler:** Cloudflare-Suche → **Durable Objects**. Dort Kontoübersicht ansehen; anschließend die Namespaces für `Lobby` und `RateGate` → **Metrics**. Neben Anfragen auch Laufzeit und Speicheroperationen beachten.
4. **TURN-Details:** Für Byte-Zeitreihen dokumentiert Cloudflare derzeit die **GraphQL Analytics API** (`callsTurnUsageAdaptiveGroups`, `sum.egressBytes`). Ein garantiert vorhandenes TURN-Analytics-Diagramm im Dashboard behaupten wir nicht. Die Abrechnungsübersicht oben ist der einfachere erste Einstieg. Die offizielle API-Anleitung ist unten verlinkt; der dafür nötige Token braucht `Account Analytics`-Leserechte, er gehört nie ins Frontend oder GitHub.
5. **Kostenwarnung:** In **Billing → Billable Usage → Create budget alert** eine niedrige Schwelle wählen, z. B. 1 USD, soweit dein Konto dies anbietet. Ein Alert schickt eine E-Mail. Er stoppt den Dienst **nicht** und ist kein Kostenlimit; die Daten sind nicht sekundengenau.

## Kostenbremse: höchstens 1 USD pro Monat („alles aus“)

Ziel: nie mehr als **1 USD pro Monat** bei Cloudflare. Das klappt nur auf **Workers Free**. Workers Paid kostet schon 5 USD/Monat Grundgebühr und läge damit über dem Ziel. Bitte unter **Manage Account → Billing → Subscriptions** prüfen, dass kein Workers-Paid-Abo aktiv ist. Auf Free kosten Workers und Durable Objects nichts: Wird ein Free-Limit überschritten, schlagen Anfragen fehl, es entstehen keine Kosten. Der einzige verbrauchsabhängige Posten dieses Spiels ist **Realtime TURN**: 1.000 GB ausgehende Daten pro Monat frei (gemeinsam mit SFU, kontoweit), danach 0,05 USD/GB.

### Die Rechnung

- 1 USD ÷ 0,05 USD/GB = **20 GB** über der Freimenge. Die Kostengrenze liegt also bei **1.020 GB** TURN-Egress pro Kalendermonat.
- Die Kostenbremse stoppt bei **950 GB** (`TURN_MONTHLY_STOP_GB`). Puffer bis 1 USD: 1.020 − 950 = **70 GB**, davon 50 GB noch innerhalb der Freimenge.
- Reaktionszeit im schlechtesten Fall: Prüfung stündlich (Minute 17) + ca. 30 Sekunden Analytics-Verzögerung (laut Cloudflare) + bis zu 30 Minuten Restlaufzeit bereits ausgegebener TURN-Zugänge (TTL 1.800 s; laut Cloudflare endet Abrechnung und Relay, sobald ein Zugang abläuft). Also rund **90 Minuten**. Um in 90 Minuten 70 GB zu verbrauchen, bräuchte es dauerhaft etwa 13 MB/s (rund 100 Mbit/s) über TURN. Ein normaler Spielabend liegt bei unter 1 GB.
- Werte über 1.000 werden auf 1.000 GB gekappt. Ungültige oder leere Werte bedeuten 950. Gerechnet wird in Dezimal-GB (10⁹ Byte), wie Cloudflare abrechnet.

### Was die Kostenbremse tut

1. Ein **Cron Trigger** (`17 * * * *`, also jede Stunde zur Minute 17 UTC) fragt die **GraphQL Analytics API** ab: `callsTurnUsageAdaptiveGroups`, `sum.egressBytes`, vom 1. des laufenden Monats bis heute (UTC). Absichtlich **für das ganze Konto**, nicht nur für den TURN-Key dieses Spiels, weil sich alle Keys die 1.000 GB teilen. Das ist eine einzige Netzwerkanfrage; die CPU-Zeit bleibt weit unter den 10 ms von Workers Free. Workers Free erlaubt 5 Cron Trigger pro Konto; dieses Spiel braucht einen.
2. Ist die Schwelle erreicht, merkt sich der Worker „pausiert für Monat JJJJ-MM“. Gespeichert wird das in der vorhandenen `RateGate`-Durable-Object-Instanz `cost-guard` (SQLite, Free). Kein KV, kein neues kostenpflichtiges Produkt.
3. Solange pausiert ist:
   - **Neue Lobbys** werden abgelehnt. Die App zeigt: „Das Spiel ist diesen Monat pausiert, weil das Kostenlimit erreicht ist. Ab dem 1. des nächsten Monats geht es automatisch weiter.“
   - **TURN-Zugänge** (`/api/turn`) antworten mit HTTP 503 und einer deutschen Meldung. Laufende Lobbys dürfen fertig spielen (Gäste und der eigene Host dürfen weiterhin beitreten bzw. sich wiederverbinden), aber nur noch über direkte Verbindungen.
   - Innerhalb des Monats hebt sich die Pause nicht von selbst auf, auch nicht, wenn die Analytics später kleinere Zahlen meldet.
4. **Automatischer Neustart** am 1. des Folgemonats um 00:00 UTC (Österreich: 01:00 im Winter, 02:00 im Sommer). Die gespeicherte Pause gilt nur für ihren Monat; dafür muss nichts gelöscht werden.

### Manueller Not-Aus: `KILL_SWITCH`

`KILL_SWITCH` = `1` schaltet **sofort alles ab**: keine neuen Lobby-Verbindungen (weder Host noch Gast), keine TURN-Zugänge. Die App zeigt: „Das Spiel ist vom Betreiber vorübergehend abgeschaltet.“ Eine Variablenänderung im Dashboard erzeugt eine neue Worker-Version; dabei werden laufende Lobby-Verbindungen in der Regel getrennt und können sich nicht neu verbinden. Bereits ausgegebene TURN-Zugänge laufen spätestens nach 30 Minuten ab.

- Einschalten: **Workers & Pages → delete-this → Settings → Variables and Secrets → Add** → Typ *Text*, Name `KILL_SWITCH`, Wert `1` → **Deploy**.
- Ausschalten: Variable löschen oder auf `0` setzen → **Deploy**.
- `KILL_SWITCH` steht absichtlich **nicht** in `wrangler.jsonc`. Dort ist `keep_vars: true` gesetzt, damit ein späterer automatischer Deploy die Dashboard-Variable nicht löscht. Variablen, die in `wrangler.jsonc` stehen (`TURN_DAILY_LIMIT`, `TURN_MONTHLY_STOP_GB`, `CF_ACCOUNT_ID`), überschreibt jeder Deploy mit dem Wert aus dem Repository; diese bitte im Repository ändern.

### Einmalig einrichten: Token `CF_ANALYTICS_TOKEN`

Ohne dieses Secret ist nur die monatliche Automatik inaktiv. `TURN_DAILY_LIMIT` und `KILL_SWITCH` funktionieren trotzdem. Das Spiel läuft normal weiter.

1. Cloudflare-Dashboard → oben rechts **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Name z. B. `delete-this Kostenbremse (nur lesen)`.
3. **Permissions:** `Account` → `Account Analytics` → `Read`. Sonst nichts.
4. **Account Resources:** `Include` → nur dieses eine Konto.
5. Optional: kein Ablaufdatum oder ein Ablaufdatum mit Kalendererinnerung (ein abgelaufener Token wirkt wie ein fehlender, das Spiel läuft weiter).
6. **Continue to summary → Create Token**, Token kopieren (wird nur einmal angezeigt).
7. Als Worker-Secret hinterlegen, **nie** in GitHub oder `wrangler.jsonc`:
   - Dashboard: **Workers & Pages → delete-this → Settings → Variables and Secrets → Add** → Typ **Secret**, Name `CF_ANALYTICS_TOKEN`, Wert einfügen → **Deploy**.
   - oder im Terminal im Projektordner: `npx wrangler secret put CF_ANALYTICS_TOKEN` und den Token einfügen.
8. Kontrolle nach der nächsten vollen Stunde + 17 Minuten: `https://<deine-Spieladresse>/api/status` zeigt `"monitor":"ok"`.

### Status ablesen: `/api/status`

Öffentlich, ohne Verbrauchszahlen und ohne Secrets, z. B. `{"turn":true,"paused":false,"reason":null,"monitor":"ok"}`.

| Feld | Bedeutung |
| --- | --- |
| `paused` | `true` = neue Lobbys und TURN sind gesperrt |
| `reason` | `null`, `"monthly-limit"` (Monatsgrenze erreicht) oder `"manual"` (`KILL_SWITCH`) |
| `monitor` | `"ok"` letzte Abfrage erfolgreich · `"no-token"` kein `CF_ANALYTICS_TOKEN` gesetzt · `"pending"` in diesem Monat noch keine erfolgreiche Abfrage · `"failing"` sechs oder mehr Abfragen in Folge fehlgeschlagen |

### Wenn die Analytics-Abfrage scheitert

Bewusste Entscheidung: **weiterlaufen, nicht still abschalten.** Ein Ausfall der Analytics-API oder ein abgelaufener Token soll nicht monatelang unbemerkt das Spiel abdrehen. Stattdessen:

- Jede fehlgeschlagene Abfrage zählt mit; ab sechs Fehlschlägen in Folge (≈ 6 Stunden) zeigt `/api/status` `"monitor":"failing"`, und der Worker schreibt eine kurze Warnung ohne Zahlen oder Token ins Log (sichtbar mit `npx wrangler tail`).
- Eine bereits gesetzte Monatspause bleibt bestehen.
- Als zweite Schranke bleibt `TURN_DAILY_LIMIT` = 500 aktiv: höchstens 500 TURN-Zugangsausgaben pro festem 24-Stunden-Fenster für die gesamte Installation. Ein Spielabend mit 8 Personen braucht je nach Dauer grob 10 bis 100 davon (eine pro Gerät und Verbindungsaufbau, Erneuerung alle 20 Minuten).
- Wer lieber „im Zweifel aus“ möchte: bei `"failing"` per `KILL_SWITCH` = `1` abschalten.

### Ehrlicher Hinweis

Cloudflare bietet **keine harte Ausgabengrenze**. Diese Kostenbremse senkt das Risiko deutlich, garantiert aber nichts: Analytics kann verzögert oder unvollständig sein, die Prüfung läuft nur stündlich, und bereits ausgegebene TURN-Zugänge bleiben bis zu 30 Minuten gültig. Andere Projekte im selben Konto, die TURN oder SFU nutzen, werden mitgezählt und lösen die Pause ebenfalls aus; deren Kosten kann dieses Spiel aber nicht verhindern. Zusätzlich empfohlen: Budget-Alert (siehe oben) und 2FA. Auf Workers Paid wäre das 1-USD-Ziel schon durch die Grundgebühr verfehlt.

## Was ein Spielabend ungefähr verbraucht

Beispiel mit 8 Personen, 20 Runden, durchschnittlich 250 KB pro Foto, ohne Displays:

- **Party:** Sieben Gäste schicken je ein Foto an den Host: 7 × 20 × 0,25 MB = **35 MB** Bild-Nutzdaten.
- **Jeder auf seinem Handy (ab 7.2):** Der Host verteilt an jeden der sieben Gäste sieben fremde Fotos. Dessen eigenes Foto liegt bereits lokal im RAM: (7 + 7 × 7) × 20 × 0,25 MB = **280 MB** Bild-Nutzdaten. Vorher waren es 315 MB; allein das vermeidet rund 11 %.

Das sind Schätzungen, keine Messwerte. WebRTC-Verpackung, Bestätigungen, Wiederholungen, Displays und Relay-Strecken kommen hinzu. Direkte Verbindungen benötigen für die Fotos kein TURN-Volumen. Selbst mit großzügig 1 GB pro großem Remote-Spielabend lägen 1.000 solcher Abende in der monatlichen 1.000-GB-Freimenge – sofern keine anderen Projekte mitverbrauchen. Bei einer privaten Freundesgruppe ist regulärer Fotoverbrauch deshalb voraussichtlich klein. Die App bietet weiterhin 3/5/10 Runden; die 20 Runden oben entsprechen zwei 10-Runden-Partien. Für Lobby-Anfragen gibt es keine seriöse feste „Rundenanzahl“: vor allem Beitritte, Wiederverbindungen und Relay-Erneuerungen beeinflussen sie. Reactions verursachen ab 7.2 keine Lobby-WebSocket-Nachrichten mehr, über TURN aber etwas verschlüsseltes Datenvolumen.

## Was gegen absichtlichen Verbrauch eingebaut ist

- Zehn zufällige Zeichen für den Lobbycode (ungefähr 50 Bit). Ein gefundener Code ist nur eine Anfrage, kein Einlass.
- Host bestätigt jede neue Geräteidentität. Namen allein beweisen keine Identität; Prüfkennung vergleichen. Einladungslinks pinnen zusätzlich den öffentlichen Host-Schlüssel.
- Verbindungsangebote und -antworten werden mit den Geräte-Schlüsseln signiert. Manipulierte SDP-Daten werden nicht akzeptiert. Das bindet auch den WebRTC-Zertifikatsfingerabdruck an die freigegebene Identität.
- Eine Ablehnung betrifft nur diesen Versuch. Erneute Anfrage ist möglich. Bewusst über „Spieler entfernen“ entfernte Identitäten bleiben für die betreffende Lobby gesperrt.
- Server trennt entfernte/abgelehnte Gäste und entzieht die Freigabe; kein nachträglicher Spielstand oder neuer Relay-Zugang.
- Vor der Raumverwaltung: höchstens 30 Verbindungsversuche pro Minute/IP/Cloudflare-Standort. Diese schnelle Schranke ist näherungsweise, keine weltweite exakte Abrechnung.
- Diese Edge-Schranke (Cloudflare Rate Limiting, Binding `ENTRY_LIMIT`) bekommt die IP-Adresse selbst als Zählschlüssel und wertet sie nur im Ein-Minuten-Fenster aus.
- Danach zentral pro pseudonymisierter IP-Kennung: 10 Hostversuche, 40 Gastversuche, 90 TURN-Anforderungen je Stundenfenster. Geteilte WLANs teilen diese Schranke; nicht dauernd neu laden. Ab 7.2.2 ist die IP-Kennung ein HMAC-SHA-256 der IP mit dem eigenen Worker-Secret `IP_HASH_SALT` (vorher ein SHA-256 mit dem TURN-Token bzw. einem festen Ersatzwert). **Fehlt `IP_HASH_SALT`, lehnt der Worker neue Lobbys und Beitritte ab** (fail closed). Einrichten: **Workers & Pages → delete-this → Settings → Variables and Secrets → Add** → Typ **Secret**, Name `IP_HASH_SALT`, Wert z. B. aus `openssl rand -hex 32` → **Deploy**, oder `npx wrangler secret put IP_HASH_SALT`.
- Ab Version 6.3.1 zeigt eine erreichte Lobby-Schutzschranke die verbleibende Wartezeit statt „Lobby nicht gefunden“. Fehlversuche verlängern das feste Stundenfenster nicht. Abgelehnte Verbindungen erhalten nur eine Fehlermeldung und werden sofort geschlossen, ohne Lobbyzugang. „Erneut versuchen“ funktioniert auch nach fehlgeschlagener Host-Erstellung. Alte statische Hosting-Adressen ohne Lobby-Dienst werden gesondert erkannt.
- Je Verbindung maximal 1200 Host- bzw. 160 Gastnachrichten/Minute, höchstens 32 KiB Text. Auch fehlerhafte Nachrichten zählen. Binärnachrichten werden abgewiesen.
- Relay-Zugänge nur bei anstehendem Verbindungsaufbau für Hosts und freigegebene Gäste. Eine leere Host-Lobby fordert keine Zugangsdaten an. Die Ausgabe läuft als kleiner POST zum Worker, mit maximal 1 KiB Körper, Origin-Prüfung und einem zufälligen Ticket im RAM. Ticket, aktive Freigabe und Lobby-Verbindung müssen passen; nach der Credential-API-Antwort wird die Freigabe erneut geprüft. Ab 7.2.1 darf die HTTP-Anfrage eine andere IP-Adresse nutzen als die Lobby-Verbindung. Für das Missbrauchslimit gilt weiterhin deren ursprüngliche IP-Kennung, unabhängig von der HTTP-Adresse. Ausgabe höchstens einmal/Minute/Verbindung. Gültigkeit 30 Minuten, normale Erneuerung nach 20 Minuten nur bei vorhandenen WebRTC-Verbindungen. Kein dauerhafter API-Aufruf im Lobby-Durable-Object: Es kann während des externen Abrufs ruhen.
- Ab 7.2 ersetzt ein Limit von **180 Relay-Ausgabeversuchen pro Lobby/Stunde** die feste globale 500er-Schranke. IP- und Verbindungslimits gelten zusätzlich. Zusätzlich begrenzt die Variable `TURN_DAILY_LIMIT` (ab der Kostenbremse fest **500** in `wrangler.jsonc`) die gesamte Installation pro festem 24-Stunden-Fenster. Ein leerer Wert oder `0` würde diesen globalen Stopp abschalten. Die optionale Schranke zählt Zugangsausgaben, keine Partien und keine GB. Viele verteilte Angreifer können weiterhin selbst Lobbys eröffnen; dieser Schutz ist keine Kostenobergrenze.
- Fotos werden auf höchstens 1280 Pixel und ein Ziel von 300 KB neu encodiert; das Protokoll verwirft Bilder über 1 MB auch von veränderten Clients. Die Rolle, Runde und Sichtbarkeit werden geprüft. Ein eigenes Foto wird nicht zurückgesendet; bei Wiederverbindung meldet das Gerät erlaubte Bilder, die es noch im RAM hat. Alle Referenzen werden nach der Runde entfernt. Identische Spielstände werden ausgelassen, Änderungen im selben Ablauf gebündelt. Keine regelmäßige Vollsynchronisation und kein permanenter Chat-Heartbeat.
- Der neue RTC-Spielkanal hat maximal 64 gleichzeitig ausgehende Aktionen, maximal 32 laufende eingehende Aktionen, 32 KiB pro Paket und 240 eingehende Pakete/Minute/Gastverbindung beim Host; Gäste erlauben 1600 vom Host. Überlastete Kanäle werden geschlossen. Aktionen und Fotos behalten ihre Empfangsbestätigung. Nur kurze Reactions brauchen keine zusätzliche App-Bestätigung; die darunterliegende RTC-Verbindung überträgt weiterhin zuverlässig. Freigaben werden bei jeder Aktion geprüft.
- Browser-Schutzheader gegen Einbetten, fremde Skripte und MIME-Verwechslungen. Die CSP erlaubt sichere WebSockets (`wss:`), damit auch Safari den Kanal öffnen kann. Keine Anwendungs- oder Request-Logs durch Wrangler Observability aktiviert.

## Was das nicht verhindern kann

Eine öffentliche Website kann durch Skripte aufgerufen werden. Auch abgewiesene HTTP-Anfragen zählen auf der Worker-Ebene. Viele verschiedene IP-Adressen können IP-Schranken umgehen. Weil jeder eine eigene Lobby erstellen darf, kann ein Angreifer auch selbst Host werden und kurzfristige TURN-Zugangsdaten erhalten. Diese sind im Browser technisch auslesbar und könnten bis zum Ablauf für fremden Relay-Verkehr verwendet werden. Die App kann diese Nutzung außerhalb ihres eigenen Codes nicht nach Bildgröße oder Lobby filtern.

**Auch das Tageslimit begrenzt Zugangsausgaben, nicht GB, Euro oder bereits bestehende TURN-Verbindungen.** Token-Ablauf ist kein sofortiger Kill-Switch für alle bestehenden Allokationen. Die genannten Maßnahmen reduzieren Missbrauch; sie garantieren keinen absoluten Schutz vor Kosten oder Ausfällen. Origin-Prüfungen verhindern fremde Webseiten im Browser, aber keine Skripte mit selbst gesetztem Origin-Header.

Wenn der Dienst öffentlich stark wächst, wäre die nächste Stufe eine Prüfung beim **Erstellen** einer Lobby (z. B. Cloudflare Turnstile) oder nur für eingeladene Hosts. Ein CAPTCHA garantiert ebenfalls keine Sicherheit. Das ist derzeit nicht eingebaut und würde Konfiguration sowie eine Anpassung der Datenschutzinformationen erfordern.

Bei ungewöhnlichem Verbrauch: sofort `KILL_SWITCH` = `1` setzen (siehe Kostenbremse), dann TURN-Key beim Anbieter sperren/löschen und die öffentliche API vorübergehend deaktivieren; nach einer Key-Rotation die Worker-Secrets aktualisieren. Nur den Schlüssel aus dem Frontend zu entfernen genügt nicht. Cloudflare-Konto und GitHub-Konto mit 2FA schützen. Keine Secrets ins Repository; ein offengelegter dauerhafter Token muss widerrufen werden.

Freigegebene Mitspieler können Bilder kopieren. Wer den Host, das Gerät, den GitHub-Account oder die Auslieferung der Website kompromittiert, kann Sicherheitsprüfungen umgehen. Signierte WebRTC-Angebote ersetzen kein Vertrauen in den ausgelieferten JavaScript-Code. Dieser Review und die Tests sind kein unabhängiges Penetrationstest-Zertifikat.

## Finale Oberfläche und Betreiberangaben

- Musik zunächst aus; 🎼 schaltet die zur Spielphase passende Musik ein, 🔊/🔇 schaltet alle Töne.
- Prompt und kurzer Vorhang, dann automatische Foto-Show: erstes Foto nach 4,5 s, danach mindestens 6,5 s pro Foto nach bestätigter Übertragung. Pausieren und manuelles Weiter möglich. Bei fehlenden Fotos pausiert sie; bei getrennten Geräten wartet sie.
- Packs sind kompakte Schalter. Weitere `src/packs/*.json` erscheinen weiterhin automatisch beim Build.
- Diagnose nur mit `?debug=1` **vor** dem Hash: `https://deine-url/?debug=1#/spiel`. Kein geheimer Administrationszugang, nur eine lokale Statusanzeige. Secrets und Fotos werden dort nicht angezeigt.
- Impressum: private, werbefreie österreichische kleine Website; Name, Wohnort, Kontakt-E-Mail. Keine Telefonnummer oder Straßenadresse veröffentlicht. Datenschutzerklärung beschreibt die tatsächlichen Speicher- und Übertragungswege.
- **Vor Google-Werbung oder anderer Monetarisierung** die rechtliche Einordnung, Anbieterangaben, Datenempfänger und gegebenenfalls Einwilligungsverwaltung neu prüfen. Der aktuelle Text deckt keine Werbeintegration ab. Die Einordnung ist keine individuelle Rechtsberatung.

## Quellen

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/realtime/sfu/platform/pricing/
- https://developers.cloudflare.com/billing/manage/billable-usage/
- https://developers.cloudflare.com/billing/manage/budget-alerts/
- https://developers.cloudflare.com/workers/observability/metrics-and-analytics/
- https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/
- https://developers.cloudflare.com/realtime/turn/analytics/
- https://developers.cloudflare.com/realtime/turn/faq/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/wrangler/configuration/ (`keep_vars`)
- https://developers.cloudflare.com/fundamentals/api/get-started/create-token/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://www.oesterreich.gv.at/de/themen/onlinesicherheit_internet_und_neue_medien/internet_und_handy___sicher_durch_die_digitale_welt/Seite.1720902
- https://www.cloudflare.com/cloudflare-customer-dpa/

Eigene Medien, Showtempo und Gestaltung: [Anleitung](ANPASSEN.md). Version 7: 3/5/10 Runden, Stimmenpunkte, optionaler Bonus, Reverse und Mix. [Neue Spielregeln und Update-Anleitung](UPDATE-7.md).
