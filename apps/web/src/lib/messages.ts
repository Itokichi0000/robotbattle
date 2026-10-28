import type { GameEvent, Locale, TeamId } from '@sats-wars/shared';
import { REGION_INFO, RESULT_REASON_LABELS, TEAM_META } from '@sats-wars/shared';

export interface FeedMessage {
  seq: number;
  teamId: TeamId | null;
  text: string;
  /** Larger emphasis for clashes/results. */
  big: boolean;
}

const team = (t: TeamId, l: Locale) => (l === 'ja' ? TEAM_META[t].nameJa : TEAM_META[t].nameEn);
const region = (id: keyof typeof REGION_INFO, l: Locale) =>
  l === 'ja' ? REGION_INFO[id].labelJa : REGION_INFO[id].labelEn;

/** Short battle-commentary line for an event (venue feed and phone toasts). */
export function eventMessage(e: GameEvent, l: Locale): FeedMessage | null {
  const ja = l === 'ja';
  const base = { seq: e.seq, big: false };
  switch (e.type) {
    case 'ACTION_APPLIED': {
      const d = e.data;
      const who = d.nickname;
      const r = d.regionId ? region(d.regionId, l) : '';
      const t = team(d.teamId, l);
      const text = (() => {
        switch (d.code) {
          case 'CAPTURED':
            return ja ? `${t}が${r}を占領！（${who}）` : `${t} captured ${r}! (${who})`;
          case 'CONTEST_STARTED':
            return ja ? `${r}が争奪中！（${t}・${who}）` : `${r} is contested! (${t}, ${who})`;
          case 'CONTEST_BROKEN':
            return ja ? `${t}が${r}の争奪を阻止！（${who}）` : `${t} held ${r}! (${who})`;
          case 'SHIELD_BROKEN':
            return ja
              ? `${t}が${r}のシールドを破壊！（${who}）`
              : `${t} broke the shield on ${r}! (${who})`;
          case 'SHIELD_PLACED':
            return ja ? `${t}が${r}にシールド設置（${who}）` : `${t} shielded ${r} (${who})`;
          case 'CHARGED':
            return ja ? `${t}のエネルギー充電！（${who}）` : `${t} charged energy! (${who})`;
        }
      })();
      return { ...base, teamId: d.teamId, text };
    }
    case 'PARTICIPANT_JOINED':
      return {
        ...base,
        teamId: e.data.teamId,
        text: ja
          ? `${e.data.nickname}が${team(e.data.teamId, l)}に参戦！`
          : `${e.data.nickname} joined ${team(e.data.teamId, l)}!`,
      };
    case 'CONTEST_EXPIRED':
      return {
        ...base,
        teamId: e.data.ownerTeamId,
        text: ja
          ? `${region(e.data.regionId, l)}の争奪は時間切れ。防衛成功！`
          : `${region(e.data.regionId, l)} contest timed out — defended!`,
      };
    case 'SHIELD_EXPIRED':
      return null;
    case 'CLASH_RESOLVED': {
      const c = e.data.clash;
      const r = c.outcome.RAIJIN;
      const f = c.outcome.FUJIN;
      return {
        ...base,
        teamId: null,
        big: true,
        text: ja
          ? `第${c.clashIndex + 1}激突！ 雷神→${r.damageDealt}${r.special ? '（必殺）' : ''} / 風神→${f.damageDealt}${f.special ? '（必殺）' : ''}`
          : `Clash ${c.clashIndex + 1}! RAIJIN ${r.damageDealt}${r.special ? ' (special)' : ''} / FUJIN ${f.damageDealt}${f.special ? ' (special)' : ''}`,
      };
    }
    case 'MATCH_RESULT': {
      const res = e.data.result;
      const reason = RESULT_REASON_LABELS[res.reason][l];
      return {
        ...base,
        teamId: res.winnerTeamId,
        big: true,
        text: res.winnerTeamId
          ? ja
            ? `${team(res.winnerTeamId, l)}の勝利！（${reason}）`
            : `${team(res.winnerTeamId, l)} wins! (${reason})`
          : reason,
      };
    }
    case 'MATCH_STATUS_CHANGED': {
      const to = e.data.to;
      const text =
        to === 'LIVE'
          ? e.data.from === 'PAUSED'
            ? ja
              ? '試合再開！'
              : 'Resumed!'
            : ja
              ? '試合開始！'
              : 'Battle start!'
          : to === 'PAUSED'
            ? ja
              ? '一時停止中'
              : 'Paused'
            : to === 'FINALIZING'
              ? ja
                ? '最終決戦！'
                : 'Final showdown!'
              : to === 'LOBBY'
                ? ja
                  ? '参加受付開始！'
                  : 'Lobby open!'
                : null;
      return text ? { ...base, teamId: null, big: to === 'LIVE', text } : null;
    }
  }
}
