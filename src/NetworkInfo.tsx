export function NetworkInfo(){return <section className="network-explainer">
  <h2>Wer bekommt hier was? 🔎</h2>
  <p>Die kostenlose Testversion nutzt öffentlich bereitgestellte Hilfsdienste von Softwareprojekten und Firmen. „Kostenlos“ bedeutet hier: zum Ausprobieren bereitgestellt. Verfügbarkeit und die Verarbeitung technischer Verbindungsdaten bestimmt der jeweilige Anbieter.</p>
  <div className="table-scroll"><table><thead><tr><th>Dienst</th><th>Aufgabe</th><th>Daten</th></tr></thead><tbody>
    <tr><td>Vercel</td><td>Liefert diese Webseite</td><td>Normale Abrufdaten wie IP-Adresse und Zeitpunkt; keine Spielfotos</td></tr>
    <tr><td>Mosquitto / HiveMQ<br/><small>test.mosquitto.org · broker.hivemq.com</small></td><td>Helfen euren Browsern, sich zu finden</td><td>Verschlüsselte Verbindungsangebote, technische Kennungen und IP-Adressen; keine Fotos</td></tr>
    <tr><td>Google / Cloudflare<br/><small>stun.l.google.com · stun.cloudflare.com</small></td><td>Helfen beim Finden eines direkten Wegs</td><td>Verbindungsdaten und IP-Adressen; keine Fotos</td></tr>
    <tr><td>TURN, falls eingerichtet</td><td>Umweg, wenn Router den direkten Weg sperren</td><td>Verschlüsselte WebRTC-Pakete und Verkehrsdaten; der Relay kann die Bilder nicht entschlüsseln</td></tr>
    <tr><td>Eure Spielgeräte</td><td>Verarbeiten und zeigen Fotos</td><td>Der Host erhält jedes Foto. Im Remote Mode erhalten auch die freigegebenen Gäste die gezeigten Fotos.</td></tr>
  </tbody></table></div>
  <p><strong>Warum klappt es am selben PC?</strong> Dort muss die Verbindung kaum Netzwerkgrenzen überwinden. Zwischen Mobilfunk und WLAN können Router den Weg blockieren. Die App kann diese Sperren nicht zuverlässig ohne eine erreichbare Netzwerkbrücke umgehen.</p>
  <p><strong>Aktueller Stand:</strong> Ein automatischer TURN-Dienst ist nicht eingerichtet. Ein Test im selben WLAN kann helfen, ist aber keine Garantie. Eine Anzahl erreichbarer Vermittlungsdienste beweist noch keine Verbindung zum Host.</p>
  <p>Es gibt keine Foto-Datenbank. Fotos werden nur für die Runde im Speicher gehalten. Freigegebene Mitspieler können trotzdem Screenshots machen; vollständige Unangreifbarkeit kann keine Webapp versprechen.</p>
</section>;}
