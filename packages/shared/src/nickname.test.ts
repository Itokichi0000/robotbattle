import { describe, expect, it } from 'vitest';
import { sanitizeNickname } from './nickname';

describe('sanitizeNickname', () => {
  it('keeps normal names and trims', () => {
    expect(sanitizeNickname('  たろう  ', 'abcd')).toEqual({ nickname: 'たろう', replaced: false });
  });
  it('limits length by code points', () => {
    expect(sanitizeNickname('😀'.repeat(20), 'abcd').nickname).toBe('😀'.repeat(12));
  });
  it('strips markup characters and control chars', () => {
    expect(sanitizeNickname('<b>bob</b>‮', 'abcd').nickname).toBe('bbob/b');
  });
  it('falls back for empty, blocked or URL-like input', () => {
    expect(sanitizeNickname('', 'abcd').replaced).toBe(true);
    expect(sanitizeNickname('死ねばいい', 'abcd').nickname).toBe('Player-ABCD');
    expect(sanitizeNickname('visit x.com', 'abcd').replaced).toBe(true);
    expect(sanitizeNickname('lnbc1xyz', 'abcd').replaced).toBe(true);
  });
  it('normalises full-width characters', () => {
    expect(sanitizeNickname('ＡＢＣ', 'abcd').nickname).toBe('ABC');
  });
});
