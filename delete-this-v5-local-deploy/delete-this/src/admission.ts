export const APPROVAL_MS = 60_000;
export type JoinRequest = {id: string; name: string; check: string; role?: 'PLAYER'|'DISPLAY'};
export const peerCheck = (id: string) => id.slice(-8).toUpperCase();

/** The check must be compared with the friend's screen; a name is not an identity. */
export class AdmissionGate {
  private pending = new Map<string, {request: JoinRequest; resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout>}>();
  private denied = new Set<string>();
  private attempts: number[] = [];
  constructor(private changed: (requests: JoinRequest[]) => void) {}
  request(id: string, name: string, role: 'PLAYER'|'DISPLAY' = 'PLAYER', check = peerCheck(id)): Promise<void> {
    const now = Date.now();
    this.attempts = this.attempts.filter(t => now - t < 60_000);
    if (this.denied.has(id) || this.pending.has(id) || this.pending.size >= 12 || this.attempts.length >= 12) return Promise.reject(new Error('Zu viele Anfragen oder Beitritt abgelehnt.'));
    this.attempts.push(now);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.decide(id, false, 'Die Freigabe ist abgelaufen. Bitte erneut anfragen.'), APPROVAL_MS);
      this.pending.set(id, {request: {id, name, check, role}, resolve, reject, timer});
      this.emit();
    });
  }
  decide(id: string, accepted: boolean, reason = 'Der Host hat die Anfrage abgelehnt.'): void {
    const item = this.pending.get(id); if (!item) return;
    clearTimeout(item.timer); this.pending.delete(id);
    if (accepted) item.resolve();
    else { if (this.denied.size >= 256) this.denied.delete(this.denied.values().next().value!); this.denied.add(id); item.reject(new Error(reason)); }
    this.emit();
  }
  clear(): void {
    for (const id of this.pending.keys()) this.decide(id, false, 'Lobby geschlossen.');
    this.denied.clear(); this.attempts = [];
  }
  private emit() { this.changed([...this.pending.values()].map(item => item.request)); }
}
