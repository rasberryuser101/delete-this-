export function NetworkInfo() { return <section className="network-explainer">
  <h2>Wer bekommt hier was? 🔎</h2>
  <p>Cloudflare liefert die Website, verbindet die Lobby und stellt bei Bedarf eine Netzwerkbrücke bereit. Gäste brauchen keinen Cloudflare-Account.</p>
  <div className="table-scroll"><table><thead><tr><th>Weg</th><th>Aufgabe</th><th>Daten</th></tr></thead><tbody>
    <tr><td>Cloudflare Webhosting</td><td>Liefert die Webseite</td><td>Technisch notwendige Abrufdaten, etwa IP-Adresse und Zeitpunkt; keine Fotos.</td></tr>
    <tr><td>Cloudflare Worker</td><td>Verbindet Gäste mit dem Host; erstellt kurzlebige TURN-Zugänge nach Freigabe.</td><td>Lobbycode, technische Verbindungsdaten, Namen, Freigaben und Spielnachrichten wie Prompt, Stimmen und Punkte. Keine Foto-Dateien im Worker.</td></tr>
    <tr><td>Cloudflare TURN, falls nötig</td><td>Leitet verschlüsselte WebRTC-Pakete zwischen Spielgeräten weiter.</td><td>IP-Adressen und Verkehrsumfang. WebRTC verschlüsselt die Inhalte zwischen den Geräten.</td></tr>
    <tr><td>Spielgeräte</td><td>Verkleinern und zeigen Fotos.</td><td>Der Host bekommt Einreichungen. Im Remote-Modus sehen freigegebene Gäste die enthüllten Fotos; im Party-Modus freigegebene Displays.</td></tr>
  </tbody></table></div>
  <p>Fotos werden lokal neu encodiert und ausschließlich über WebRTC-Datenkanäle übertragen. Es gibt keine Foto-Datenbank und keine Foto-Uploads an den Webhost. Bei einer TURN-Verbindung laufen verschlüsselte Bildpakete technisch über Cloudflare, ohne dort als Bilder abgelegt zu werden.</p>
  <p>Für die Lobby verwaltet ein Cloudflare Durable Object Verbindungen und eine zeitlich begrenzte Prüfsumme für den Host. Weitere kurze Zähler begrenzen Verbindungsversuche. Dort werden keine Fotos gespeichert. Spielerkennung, Anzeigename und Toneinstellungen können lokal im Browser stehen; Bilddaten nicht.</p>
  <p>Der Host muss Beitritte ausdrücklich erlauben. Einladungslinks prüfen seinen öffentlichen Schlüssel; der Code allein erlaubt nur eine Beitrittsanfrage. Freigegebene Personen können Screenshots machen. Der Host-Tab muss offen bleiben; nach einem Neuladen ist eine neue Freigabe nötig.</p>
</section>; }
