export function NetworkInfo(){return <section className="network-explainer">
 <h2>Wer bekommt hier was? 🔎</h2><p>Metered stellt die Vermittlung und bei Bedarf eine verschlüsselte Netzwerkbrücke bereit. Deine Freunde brauchen keinen Account und keine technischen Einstellungen.</p>
 <div className="table-scroll"><table><thead><tr><th>Dienst</th><th>Aufgabe</th><th>Daten</th></tr></thead><tbody>
 <tr><td>Vercel</td><td>Liefert diese Webseite</td><td>Normale Abrufdaten wie IP-Adresse und Zeitpunkt; keine Spielfotos</td></tr>
 <tr><td>Metered Realtime</td><td>Findet die Lobby und vermittelt Verbindungen und Spielzustände</td><td>IP-Adressen, Gerätekennungen, Verbindungsdaten, Namen, Freigaben, Prompt, Runde, Stimmen und Punkte. Keine Bilddateien im Messaging.</td></tr>
 <tr><td>Metered STUN / TURN</td><td>Direkter Weg oder bei Bedarf Relay</td><td>Netzwerk- und Verkehrsdaten. TURN transportiert verschlüsselte WebRTC-Pakete, deren Bildinhalt es nicht entschlüsseln kann.</td></tr>
 <tr><td>Eure Spielgeräte</td><td>Verarbeiten und zeigen Fotos</td><td>Der Host erhält die Einreichungen. Im Remote-Modus erhalten freigegebene Spieler die enthüllten Fotos, im Party-Modus freigegebene Displays.</td></tr>
 </tbody></table></div>
 <p>Fotos werden lokal verkleinert und neu encodiert, ausschließlich über WebRTC-Datenkanäle übertragen und nach der Runde aus dem App-Speicher entfernt. Es gibt keine Foto-Datenbank und keinen Foto-Upload an Vercel oder Metered Messaging.</p>
 <p>Spieler-/Display-ID, Anzeigename und Toneinstellungen dürfen lokal gespeichert werden. Andere Geräte sehen nur freigegebene Spielinhalte. Nach dem Neuladen ist eine erneute Host-Freigabe nötig; kurze Unterbrechungen können automatisch wiederhergestellt werden. Der Host muss geöffnet bleiben.</p>
 <p>Freigegebene Mitspieler können Screenshots machen. Ein weitergegebener Raumcode ermöglicht eine Beitrittsanfrage, keine automatische Freigabe. Es gibt keine Garantie vollständiger Unangreifbarkeit. Die Verarbeitung technischer Daten und Verfügbarkeit bei Metered richtet sich nach dem Anbieter und dem eingerichteten Tarif.</p>
 </section>;}
