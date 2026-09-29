# Delete That! betreiben – ohne Fachchinesisch

Stand: 29.09.2026. Die Beträge sind Cloudflares öffentliche Listenwerte. Dein tatsächlich gebuchter Tarif und andere Projekte im selben Konto zählen mit. Dieses Repository kann deinen Kontostand nicht lesen.

## Drei unterschiedliche Zähler

| Baustein | Wozu? | Kostenloses Kontingent |
| --- | --- | --- |
| Static Assets | Website, Schrift, Programm | Abrufe kostenlos und unbegrenzt |
| Workers Free | Eingangstür zur Lobby | 100.000 Anfragen pro Tag; 10 ms CPU pro Aufruf |
| Durable Objects Free | Lobby-Verbindungen, Freigaben, Missbrauchszähler | 100.000 berechnete Anfragen und 13.000 GB-Sekunden pro Tag |
| Durable Objects SQLite | Kleine technische Zähler, keine Fotos | 5 Mio. gelesene Zeilen/Tag, 100.000 geschriebene Zeilen/Tag, 5 GB insgesamt |
| Realtime TURN/SFU | Verschlüsselter Umweg, wenn eine Direktverbindung nicht klappt | Gemeinsam 1.000 GB ausgehende Daten pro Monat, danach 0,05 USD/GB |

**1.000 GB sind ungefähr eine Million MB.** Das ist nicht die alte Metered-Grenze. Ein Foto wird nicht zu einer Worker-Anfrage pro Datenstück: Die Foto-Datei läuft über WebRTC, gegebenenfalls TURN. Die Lobby verschickt nur kurze Textnachrichten. Für die Durable-Object-Abrechnung zählen 20 eingehende WebSocket-Nachrichten als eine Anfrage; die Diagramme können dagegen die ungekürzte Nachrichtenanzahl zeigen. Verbindungsaufbau, Sicherheitsprüfungen und Alarme kommen dazu.

Die Tageslimits der Cloudflare-Free-Tarife beginnen um 00:00 UTC neu (Österreich: 01:00 im Winter, 02:00 im Sommer). Bei überschrittenen Workers-/DO-Free-Limits können neue Anfragen fehlschlagen. Ein gebuchter Paid-Tarif hat andere Freimengen und verbrauchsabhängige Preise. TURN ist gesondert zu betrachten: 1.000 GB sind eine Freimenge, keine garantierte Abschaltung. Keine R2-, D1-, KV- oder Foto-Speicher-Dienste sind eingerichtet.

## Wo du nachsehen kannst

1. **Gesamtnutzung/Kosten:** Konto öffnen → **Manage Account → Billing → Billable Usage**. Zeitraum prüfen. `Total usage` heißt gesamte Nutzung; `Billable usage` heißt der kostenpflichtige Anteil nach Freimenge. Unter `Product` steht das enthaltene Kontingent. Nach Realtime und Workers filtern. Diese Ansicht ist für Pay-as-you-go-Konten dokumentiert; fehlt sie, ist das kein Beweis für null Verbrauch.
2. **Lobby-Eingang:** **Workers & Pages → delete-this → Metrics**. Anfragen, Fehler und CPU ansehen. Ein plötzlicher Anstieg ohne Spielabende ist auffällig.
3. **Lobby-Räume/Zähler:** Cloudflare-Suche → **Durable Objects**. Dort Kontoübersicht ansehen; anschließend die Namespaces für `Lobby` und `RateGate` → **Metrics**. Neben Anfragen auch Laufzeit und Speicheroperationen beachten.
4. **TURN-Details:** Für Byte-Zeitreihen dokumentiert Cloudflare derzeit die **GraphQL Analytics API** (`callsTurnUsageAdaptiveGroups`, `sum.egressBytes`). Ein garantiert vorhandenes TURN-Analytics-Diagramm im Dashboard behaupten wir nicht. Die Abrechnungsübersicht oben ist der einfachere erste Einstieg. Die offizielle API-Anleitung ist unten verlinkt; der dafür nötige Token braucht `Account Analytics`-Leserechte, er gehört nie ins Frontend oder GitHub.
5. **Kostenwarnung:** In **Billing → Billable Usage → Create budget alert** eine niedrige Schwelle wählen, z. B. 1 USD, soweit dein Konto dies anbietet. Ein Alert schickt eine E-Mail. Er stoppt den Dienst **nicht** und ist kein Kostenlimit; die Daten sind nicht sekundengenau.

## Was ein Spielabend ungefähr verbraucht

Beispiel mit 8 Personen, 20 Runden, durchschnittlich 250 KB pro Foto, ohne Displays:

- **Party:** Sieben Gäste schicken je ein Foto an den Host: 7 × 20 × 0,25 MB = **35 MB** Bild-Nutzdaten.
- **Remote:** Zusätzlich verteilt der Host acht Fotos an sieben Gäste: (7 + 8 × 7) × 20 × 0,25 MB = **315 MB** Bild-Nutzdaten.

Das sind Schätzungen, keine Messwerte. WebRTC-Verpackung, Bestätigungen, Wiederholungen, Displays und Relay-Strecken kommen hinzu. Direkte Verbindungen benötigen für die Fotos kein TURN-Volumen. Selbst mit großzügig 1 GB pro großem Remote-Spielabend lägen 1.000 solcher Abende in der monatlichen 1.000-GB-Freimenge – sofern keine anderen Projekte mitverbrauchen. Bei einer privaten Freundesgruppe ist regulärer Fotoverbrauch deshalb voraussichtlich klein. Für Lobby-Anfragen gibt es keine seriöse feste „Rundenanzahl“: Wiederverbindungen, Reaktionen und Freigaben beeinflussen sie.

## Was gegen absichtlichen Verbrauch eingebaut ist

- Zehn zufällige Zeichen für den Lobbycode (ungefähr 50 Bit). Ein gefundener Code ist nur eine Anfrage, kein Einlass.
- Host bestätigt jede neue Geräteidentität. Namen allein beweisen keine Identität; Prüfkennung vergleichen. Einladungslinks pinnen zusätzlich den öffentlichen Host-Schlüssel.
- Verbindungsangebote und -antworten werden mit den Geräte-Schlüsseln signiert. Manipulierte SDP-Daten werden nicht akzeptiert. Das bindet auch den WebRTC-Zertifikatsfingerabdruck an die freigegebene Identität.
- Eine Ablehnung betrifft nur diesen Versuch. Erneute Anfrage ist möglich. Bewusst über „Spieler entfernen“ entfernte Identitäten bleiben für die betreffende Lobby gesperrt.
- Server trennt entfernte/abgelehnte Gäste und entzieht die Freigabe; kein nachträglicher Spielstand oder neuer Relay-Zugang.
- Vor der Raumverwaltung: höchstens 30 Verbindungsversuche pro Minute/IP/Cloudflare-Standort. Diese schnelle Schranke ist näherungsweise, keine weltweite exakte Abrechnung.
- Danach zentral pro pseudonymisierter IP-Kennung: 10 Hostversuche, 40 Gastversuche, 90 TURN-Anforderungen je Stundenfenster. Geteilte WLANs teilen diese Schranke; nicht dauernd neu laden.
- Je Verbindung maximal 400 Host- bzw. 160 Gastnachrichten/Minute, höchstens 32 KiB Text. Auch fehlerhafte Nachrichten zählen. Binärnachrichten werden abgewiesen.
- Relay-Zugänge nur für Hosts und freigegebene Gäste; Ausgabe höchstens einmal/Minute/Verbindung. Gültigkeit 30 Minuten, normale Erneuerung nach 20 Minuten.
- Für diese gesamte Installation höchstens **500 Ausgabenversuche für Relay-Zugänge pro 24-Stunden-Fenster** ab dem ersten Versuch. Wert in `worker/limits.ts`. Das schützt auch gegen wechselnde IPs beim Erstellen neuer Zugänge, kann bei Missbrauch aber reguläre Gäste aussperren. Bestehende Verbindungen werden durch Erreichen der Schranke nicht sofort getrennt.
- Fotos werden größenbegrenzt, für Rolle und Runde geprüft und nach bestätigtem Empfang nicht grundlos erneut übertragen. Keine regelmäßige Vollsynchronisation und kein permanenter Chat-Heartbeat.
- Browser-Schutzheader gegen Einbetten, fremde Skripte und MIME-Verwechslungen. Die CSP erlaubt sichere WebSockets (`wss:`), damit auch Safari den Kanal öffnen kann. Keine Anwendungs- oder Request-Logs durch Wrangler Observability aktiviert.

## Was das nicht verhindern kann

Eine öffentliche Website kann durch Skripte aufgerufen werden. Auch abgewiesene HTTP-Anfragen zählen auf der Worker-Ebene. Viele verschiedene IP-Adressen können IP-Schranken umgehen. Weil jeder eine eigene Lobby erstellen darf, kann ein Angreifer auch selbst Host werden und kurzfristige TURN-Zugangsdaten erhalten. Diese sind im Browser technisch auslesbar und könnten bis zum Ablauf für fremden Relay-Verkehr verwendet werden. Die App kann diese Nutzung außerhalb ihres eigenen Codes nicht nach Bildgröße oder Lobby filtern.

**Die 500er-Schranke begrenzt Zugangsausgaben, nicht GB, Euro oder bereits bestehende TURN-Verbindungen.** Token-Ablauf ist kein sofortiger Kill-Switch für alle bestehenden Allokationen. Die genannten Maßnahmen reduzieren Missbrauch; sie garantieren keinen absoluten Schutz vor Kosten oder Ausfällen. Origin-Prüfungen verhindern fremde Webseiten im Browser, aber keine Skripte mit selbst gesetztem Origin-Header.

Wenn der Dienst öffentlich stark wächst, wäre die nächste Stufe eine Prüfung beim **Erstellen** einer Lobby (z. B. Cloudflare Turnstile) oder nur für eingeladene Hosts. Ein CAPTCHA garantiert ebenfalls keine Sicherheit. Das ist derzeit nicht eingebaut und würde Konfiguration sowie eine Anpassung der Datenschutzinformationen erfordern.

Bei ungewöhnlichem Verbrauch: zuerst TURN-Key beim Anbieter sperren/löschen und die öffentliche API vorübergehend deaktivieren; nach einer Key-Rotation die Worker-Secrets aktualisieren. Nur den Schlüssel aus dem Frontend zu entfernen genügt nicht. Cloudflare-Konto und GitHub-Konto mit 2FA schützen. Keine Secrets ins Repository; ein offengelegter dauerhafter Token muss widerrufen werden.

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
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://www.oesterreich.gv.at/de/themen/onlinesicherheit_internet_und_neue_medien/internet_und_handy___sicher_durch_die_digitale_welt/Seite.1720902
- https://www.cloudflare.com/cloudflare-customer-dpa/

Eigene Medien, Showtempo und Gestaltung: [Anleitung](ANPASSEN.md). Seit Version 6.3: 3/5/10 Runden mit Gesamtwertung und Revanche.
