import { createHash, createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ipKey, ipSalt, IP_SALT_MISSING_MESSAGE } from '../worker/ipKey';

const salt = 'test-salt-nur-fuer-unit-tests';
describe('IP-Kennung für Rate-Limits', () => {
  it('bildet HMAC-SHA-256 der IP mit IP_HASH_SALT (Web Crypto)', async () => {
    const key = await ipKey({ IP_HASH_SALT: salt }, '203.0.113.4');
    expect(key).toBe(createHmac('sha256', salt).update('203.0.113.4').digest('hex'));
    expect(key).toMatch(/^[\da-f]{64}$/);
    expect(key).not.toContain('203.0.113.4');
  });
  it('ist stabil pro IP und Secret, aber unterscheidet IPs und Secrets', async () => {
    const env = { IP_HASH_SALT: salt };
    expect(await ipKey(env, '198.51.100.42')).toBe(await ipKey(env, '198.51.100.42'));
    expect(await ipKey(env, '198.51.100.42')).not.toBe(await ipKey(env, '198.51.100.43'));
    expect(await ipKey({ IP_HASH_SALT: 'anderes-secret' }, '198.51.100.42')).not.toBe(await ipKey(env, '198.51.100.42'));
    expect(await ipKey(env, '2001:db8::1')).toBe(createHmac('sha256', salt).update('2001:db8::1').digest('hex'));
  });
  it('nutzt nicht mehr das alte Verfahren hash(salt|ip)', async () => {
    const old = createHash('sha256').update(`${salt}|203.0.113.4`).digest('hex');
    expect(await ipKey({ IP_HASH_SALT: salt }, '203.0.113.4')).not.toBe(old);
  });
  it('schlägt ohne Secret fehl statt einen festen Salt zu verwenden (fail closed)', async () => {
    for (const env of [{}, { IP_HASH_SALT: undefined }, { IP_HASH_SALT: '' }, { IP_HASH_SALT: '   ' }]) {
      expect(ipSalt(env)).toBeNull();
      expect(await ipKey(env, '203.0.113.4')).toBeNull();
    }
    expect(IP_SALT_MISSING_MESSAGE).toMatch(/nicht vollständig eingerichtet/);
  });
});
