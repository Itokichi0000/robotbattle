import { randomInt } from 'node:crypto';
import type {
  AvatarPreset,
  MeResponse,
  PassportResponse,
  PilotProfile,
  ProfilePatch,
  RaidState,
  Role,
} from '@sats-wars/shared';
import { AVATAR_PRESETS, ROLES, rankFor, sanitizeNickname } from '@sats-wars/shared';
import type { WallClock } from '../clock';
import type { AuthKind, PilotRow, Repo } from '../db/repo';
import { AppError } from '../errors';
import type { RaidManager } from '../raid/manager';
import type { SessionService } from '../auth/sessions';
import { newId, sha256 } from '../auth/tokens';

export interface PilotServiceOptions {
  repo: Repo;
  manager: RaidManager;
  sessions: SessionService;
  wall: WallClock;
}

export function pseudonym(code: string): string {
  return `PILOT-${code}`;
}

/**
 * Pilots: profile, guest creation, passport and career (ranks, titles).
 * Nothing here changes combat power: careers are cosmetic by design.
 */
export class PilotService {
  constructor(private opts: PilotServiceOptions) {}

  private get repo(): Repo {
    return this.opts.repo;
  }
  private now(): number {
    return this.opts.wall.now();
  }

  private newCode(): string {
    for (let i = 0; i < 20; i++) {
      const code = String(randomInt(0, 100_000)).padStart(5, '0');
      if (!this.repo.db.prepare('SELECT 1 FROM pilots WHERE code = ?').get(code)) return code;
    }
    return String(randomInt(100_000, 10_000_000));
  }

  /** Create a pilot row (guest or a fresh Lightning identity). */
  create(kind: AuthKind, callsign: string | undefined, deviceId?: string): PilotRow {
    const now = this.now();
    const id = newId('pilot');
    const code = this.newCode();
    const clean = callsign?.trim() ? sanitizeNickname(callsign, code).nickname : pseudonym(code);
    this.repo.insertPilot({
      id,
      code,
      callsign: clean,
      callsign_hidden: 0,
      avatar: 'standard',
      locale: 'ja',
      show_name: 0,
      reduced_motion: 0,
      assist_mode: 0,
      auth_type: kind,
      device_hash: deviceId ? sha256(`device:${deviceId}`) : null,
      created_at: now,
      last_seen_at: now,
    });
    this.opts.manager.invalidatePresence();
    return this.repo.getPilot(id)!;
  }

  /**
   * Guest pilot: no wallet needed. The same device gets its guest pilot back
   * (with its history) under a fresh session; this is a convenience, not a
   * guarantee — Lightning login is the reliable way back.
   */
  guest(input: { callsign?: string; deviceId?: string }): {
    pilot: PilotRow;
    token: string;
    expiresAt: number;
  } {
    return this.repo.tx(() => {
      const deviceHash = input.deviceId ? sha256(`device:${input.deviceId}`) : null;
      let pilot = deviceHash ? this.repo.getGuestByDevice(deviceHash) : undefined;
      if (pilot && input.callsign?.trim()) {
        this.repo.updatePilot(pilot.id, {
          callsign: sanitizeNickname(input.callsign, pilot.code).nickname,
        });
        pilot = this.repo.getPilot(pilot.id)!;
      }
      pilot ??= this.create('GUEST', input.callsign, input.deviceId);
      this.repo.touchPilot(pilot.id, this.now());
      const s = this.opts.sessions.issue(pilot.id, 'GUEST');
      return { pilot, ...s };
    });
  }

  profile(p: PilotRow): PilotProfile {
    return {
      pilotId: p.id,
      callsign: p.callsign,
      avatar: (AVATAR_PRESETS as readonly string[]).includes(p.avatar)
        ? (p.avatar as AvatarPreset)
        : 'standard',
      authType: p.auth_type,
      lightningLinked: this.repo.activeAuthKeys(p.id) > 0,
      rank: rankFor(p.rank_points).index,
      sorties: p.sorties,
      victories: p.victories,
      titles: JSON.parse(p.titles_json) as string[],
      showNameOnArena: p.show_name === 1,
      locale: p.locale === 'en' ? 'en' : 'ja',
      reducedMotion: p.reduced_motion === 1,
      assistMode: p.assist_mode === 1,
      createdAt: p.created_at,
    };
  }

  patch(p: PilotRow, patch: ProfilePatch): PilotProfile {
    this.repo.updatePilot(p.id, {
      ...(patch.callsign !== undefined
        ? { callsign: sanitizeNickname(patch.callsign, p.code).nickname }
        : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
      ...(patch.locale !== undefined ? { locale: patch.locale } : {}),
      ...(patch.showNameOnArena !== undefined ? { show_name: patch.showNameOnArena ? 1 : 0 } : {}),
      ...(patch.reducedMotion !== undefined ? { reduced_motion: patch.reducedMotion ? 1 : 0 } : {}),
      ...(patch.assistMode !== undefined ? { assist_mode: patch.assistMode ? 1 : 0 } : {}),
    });
    const fresh = this.repo.getPilot(p.id)!;
    this.applyNamePolicy(fresh);
    return this.profile(fresh);
  }

  /** Tell the running raid how this pilot may be named on public screens. */
  applyNamePolicy(p: PilotRow): void {
    this.opts.manager.current().setNamePolicy(p.id, {
      show: p.show_name === 1,
      hidden: p.callsign_hidden === 1,
      pseudonym: pseudonym(p.code),
    });
  }

  me(p: PilotRow, pendingInvoice: MeResponse['pendingInvoice']): MeResponse {
    this.repo.touchPilot(p.id, this.now());
    const rt = this.opts.manager.current();
    const s = rt.state;
    const ent = this.repo.getEntitlement(s.raidId, p.id);
    const pilot = s.pilots[p.id];
    const task = pilot?.task && pilot.task.deadline >= rt.nowGameMs() ? pilot.task : null;
    return {
      pilot: this.profile(p),
      seat: {
        raidId: s.raidId,
        boarded: !!pilot,
        entitled: !!ent,
        entitlementSource: ent?.source ?? null,
        role: pilot?.role ?? null,
        robot: pilot?.robot ?? null,
        task,
        cooldownUntil: pilot?.cooldownUntil ?? 0,
        roleChangeReadyAt: pilot
          ? pilot.roleChangedAt + s.config.roleChangeCooldownSeconds * 1000
          : 0,
        stats: pilot?.stats ?? null,
      },
      pendingInvoice,
      passCredits: p.pass_credits,
    };
  }

  passport(p: PilotRow): PassportResponse {
    const rank = rankFor(p.rank_points);
    return {
      pilot: this.profile(p),
      history: this.repo.passportHistory(p.id).map((h) => ({
        raidId: h.raid_id,
        eventId: h.event_id,
        outcome: h.outcome,
        role: h.role,
        score: h.score,
        titles: JSON.parse(h.titles_json) as string[],
        endedAt: h.created_at,
      })),
      rankNameJa: rank.ja,
      rankNameEn: rank.en,
      nextRankAt: rank.nextAt,
    };
  }

  /**
   * Merge a guest's career into a Lightning pilot. Only called after the
   * person proved both: the guest session (cookie at login time) and the
   * wallet key; the route asks for explicit confirmation first.
   */
  mergeGuest(guest: PilotRow, target: PilotRow): PilotProfile {
    if (guest.id === target.id || guest.auth_type !== 'GUEST' || guest.merged_into)
      throw new AppError('BAD_REQUEST', 'nothing to merge');
    const titles = [
      ...new Set([
        ...(JSON.parse(target.titles_json) as string[]),
        ...(JSON.parse(guest.titles_json) as string[]),
      ]),
    ];
    const roles = [
      ...new Set([...target.roles_done.split(','), ...guest.roles_done.split(',')].filter(Boolean)),
    ];
    this.repo.tx(() => {
      this.repo.moveHistory(guest.id, target.id);
      this.repo.mergePilotInto(
        guest.id,
        target.id,
        JSON.stringify(titles),
        roles.join(','),
        this.now(),
      );
      this.repo.audit(
        `pilot:${target.id}`,
        'MERGE_GUEST',
        guest.id,
        { into: target.id },
        this.now(),
      );
    });
    return this.profile(this.repo.getPilot(target.id)!);
  }

  /** Data export: the pilot's own data, no secrets (no tokens, no keys). */
  export(p: PilotRow) {
    return {
      exportedAt: new Date(this.now()).toISOString(),
      profile: this.profile(p),
      code: p.code,
      passCredits: p.pass_credits,
      history: this.passport(p).history,
      lightningKeysLinked: this.repo.activeAuthKeys(p.id),
    };
  }

  delete(p: PilotRow): void {
    this.repo.tx(() => {
      this.repo.deletePilot(p.id, this.now());
      this.repo.audit(`pilot:${p.id}`, 'DELETE_ACCOUNT', p.id, null, this.now());
    });
    this.opts.manager
      .current()
      .setNamePolicy(p.id, { show: false, hidden: true, pseudonym: 'PILOT' });
  }

  /**
   * Career update after a raid: passport entry, sortie/victory counts, titles
   * and rank points. Bots are not pilots in the DB and are skipped.
   */
  recordRaid(state: RaidState): void {
    const result = state.result;
    if (!result || result.outcome === 'CANCELLED') return;
    const now = this.now();
    const won = result.outcome === 'SUCCEEDED';
    const specialPilots = new Set(
      state.special.status === 'ACTIVATED' ? Object.values(state.special.contributors) : [],
    );
    this.repo.tx(() => {
      for (const pilot of Object.values(state.pilots)) {
        if (pilot.isBot) continue;
        const row = this.repo.getPilot(pilot.pilotId);
        if (!row) continue;
        // Only pilots who actually flew a mission get a sortie.
        if (pilot.stats.tasks === 0) continue;
        const roles = new Set(row.roles_done.split(',').filter(Boolean));
        for (const role of ROLES) if (pilot.lastSuccessAt[role] !== undefined) roles.add(role);
        const titles = new Set(JSON.parse(row.titles_json) as string[]);
        const earned: string[] = [];
        const earn = (t: string) => {
          if (!titles.has(t)) earned.push(t);
          titles.add(t);
        };
        earn('FIRST_SORTIE');
        if (won) earn('EARTH_DEFENDER');
        if (specialPilots.has(pilot.pilotId)) earn('SHINRAI_FUJIN');
        for (const [k, v] of Object.entries(result.mvps))
          if (v?.pilotId === pilot.pilotId) earn(`MVP_${k}`);
        if (ROLES.every((r) => roles.has(r))) earn('ALL_ROUNDER');
        if (row.sorties + 1 >= 10) earn('VETERAN');
        const points =
          row.rank_points + 1 + (won ? 2 : 0) + (specialPilots.has(pilot.pilotId) ? 1 : 0);
        this.repo.recordSortie(pilot.pilotId, won, [...roles].join(','), [...titles], points);
        this.repo.insertPassport({
          pilot_id: pilot.pilotId,
          event_id: this.opts.manager.eventId,
          raid_id: state.raidId,
          role: pilot.role as Role,
          outcome: result.outcome,
          score: result.score.total,
          contribution_json: JSON.stringify(pilot.stats),
          titles_json: JSON.stringify(earned),
          created_at: now,
        });
      }
    });
  }

  requireLive(p: PilotRow | null): PilotRow {
    if (!p) throw new AppError('UNAUTHORIZED', 'パイロット認証が必要です / Pilot login required');
    return p;
  }
}
