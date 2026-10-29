import { AllyPanel } from './hud/Allies';
import { TacticalMap } from './hud/TacticalMap';
import { TelemetryStrip } from './hud/Telemetry';
import type { RaidLike, RaidView } from './view';

export { fmtClock } from './hud/primitives';

/** Mission telemetry for pages outside the pilot console (landing, replay, venue). */
export function RaidHeader({
  raid,
  view,
  locale,
}: {
  raid: RaidLike;
  view: RaidView;
  locale: 'ja' | 'en';
  compact?: boolean;
}) {
  return (
    <div className="hud-root hud-embed">
      <TelemetryStrip raid={raid} view={view} locale={locale} />
    </div>
  );
}

/** The tactical map of the 8 cities (admin, results, landing, the venue's 2D mode). */
export function JapanMapMini({
  view,
  locale,
  maxHp,
  labels = true,
}: {
  view: RaidView;
  locale: 'ja' | 'en';
  maxHp: number;
  labels?: boolean;
}) {
  return (
    <div className="hud-root hud-embed">
      <TacticalMap view={view} locale={locale} maxHp={maxHp} labels={labels} />
    </div>
  );
}

/** Both robots' status panels side by side (venue screen). */
export function RobotBars({ raid, locale }: { raid: RaidLike; locale: 'ja' | 'en' }) {
  return (
    <div className="hud-root hud-embed hud-ally-pair">
      <AllyPanel robot={raid.robots[0]!} crew={raid.crew} locale={locale} side="left" />
      <AllyPanel robot={raid.robots[1]!} crew={raid.crew} locale={locale} side="right" />
    </div>
  );
}
