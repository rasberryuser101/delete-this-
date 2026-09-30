import { expect, it } from 'vitest';
import { consume, rateRule, TURN_TTL, TURN_RENEW_MS } from '../worker/limits';
it('begrenzt Geräteversuche und globale TURN-Ausgabe mit unabhängigen festen Fenstern',()=>{
  for(const role of ['HOST','GUEST','TURN','ROOM_TURN','GLOBAL_TURN']) {
    const rule=rateRule(role,20000);let value;
    for(let i=0;i<rule.max;i++)value=consume(value,100,rule)!;
    expect(consume(value,101,rule)).toBeNull();
    expect(consume(value,100+rule.window,rule)).toEqual({start:100+rule.window,count:1});
  }
});
it('erneuert kurzlebige Relay-Zugänge vor Ablauf',()=>{
  expect(TURN_RENEW_MS).toBeLessThan(TURN_TTL*1000);
  expect(TURN_TTL).toBe(1800);
});
it('ersetzt den pauschalen 500er-Stopp durch Raum- und IP-Limits; Tageslimit ist optional',()=>{
 expect(rateRule('ROOM_TURN').max).toBe(180);expect(rateRule('TURN').max).toBe(90);
 expect(rateRule('GLOBAL_TURN').max).toBe(0);expect(rateRule('GLOBAL_TURN',12000).max).toBe(12000);
});
