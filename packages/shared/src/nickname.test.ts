import { describe, expect, it } from 'vitest';
import { sanitizeNickname } from './nickname';

describe('sanitizeNickname', () => {
  it('keeps normal names and trims', () => {
    expect(sanitizeNickname('  たろう  ', 'abcd')).toEqual({ nickname: 'たろう', replaced: false });
  });
  it('limits length by code points and caps emoji', () => {
    expect(sanitizeNickname('あ'.repeat(30), 'abcd').nickname).toBe('あ'.repeat(20));
    expect(sanitizeNickname('😀'.repeat(10) + 'ken', 'abcd').nickname).toBe('😀😀😀ken');
  });
  it('strips markup characters and control chars', () => {
    expect(sanitizeNickname('<b>bob</b>‮', 'abcd').nickname).toBe('bbob/b');
  });
  it('falls back for empty, blocked or URL-like input', () => {
    expect(sanitizeNickname('', 'abcd').replaced).toBe(true);
    expect(sanitizeNickname('死ねばいい', 'abcd').nickname).toBe('PILOT-ABCD');
    expect(sanitizeNickname('visit x.com', 'abcd').replaced).toBe(true);
    expect(sanitizeNickname('lnbc1xyz', 'abcd').replaced).toBe(true);
  });
  it('normalises full-width characters', () => {
    expect(sanitizeNickname('ＡＢＣ', 'abcd').nickname).toBe('ABC');
  });
});
