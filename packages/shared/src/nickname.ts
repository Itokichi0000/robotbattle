import { NICKNAME_MAX_LENGTH } from './protocol';

/**
 * Minimal blocklist for the venue screen. Moderation is best-effort: admins can
 * also hide any nickname from /admin. Keep entries lowercase / NFKC-normalised.
 */
const BLOCKED_SUBSTRINGS = [
  'fuck',
  'shit',
  'bitch',
  'nigger',
  'nazi',
  'porn',
  'sex',
  'ちんこ',
  'まんこ',
  'うんこ',
  'しね',
  '死ね',
  '殺す',
  'ころす',
  'きちがい',
  'ガイジ',
];

// Control chars, zero-width chars, bidi overrides.
// eslint-disable-next-line no-control-regex
const STRIP_RE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁯﻿]/g;
const URL_LIKE_RE = /(https?:|www\.|\.com|\.jp|\.io|lnbc|lnurl|@)/i;

export interface NicknameResult {
  nickname: string;
  /** True when the input was replaced because it was empty or not acceptable. */
  replaced: boolean;
}

export function sanitizeNickname(raw: string | undefined | null, fallbackSuffix: string): NicknameResult {
  const fallback = `Player-${fallbackSuffix.slice(0, 4).toUpperCase()}`;
  if (!raw) return { nickname: fallback, replaced: true };
  let s = raw.normalize('NFKC').replace(STRIP_RE, '').replace(/[<>&"'`\\]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  // Count by code points so emoji/surrogates are not split.
  const chars = Array.from(s);
  if (chars.length > NICKNAME_MAX_LENGTH) s = chars.slice(0, NICKNAME_MAX_LENGTH).join('');
  if (!s) return { nickname: fallback, replaced: true };
  const lower = s.toLowerCase();
  if (BLOCKED_SUBSTRINGS.some((w) => lower.includes(w)) || URL_LIKE_RE.test(s)) {
    return { nickname: fallback, replaced: true };
  }
  return { nickname: s, replaced: false };
}
