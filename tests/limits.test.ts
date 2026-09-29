import { expect, it } from 'vitest';
import { consume, rateRule, TURN_TTL, TURN_RENEW_MS } from '../worker/limits';
it('begrenzt Geräteversuche und globale TURN-Ausgabe mit unabhängigen festen Fenstern',()=>{
  for(const role of ['HOST','GUEST','TURN','GLOBAL_TURN']) {
    const rule=rateRule(role);let value;
    for(let i=0;i<rule.max;i++)value=consume(value,100,rule)!;
    expect(consume(value,101,rule)).toBeNull();
    expect(consume(value,100+rule.window,rule)).toEqual({start:100+rule.window,count:1});
  }
});
it('erneuert kurzlebige Relay-Zugänge vor Ablauf',()=>{
  expect(TURN_RENEW_MS).toBeLessThan(TURN_TTL*1000);
  expect(TURN_TTL).toBe(1800);
});
