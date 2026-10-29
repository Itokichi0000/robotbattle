# sim:balance — 1000 runs per crew size

Command: `pnpm sim:balance --runs 1000 --pilots 2,10,30,50 --threads 3` (run on 2026-10-29, 4-core container, 575 s).

Simulated pilots = the demo-bot solver (skill 0.65 = chance of a clean minigame run, balanced seats). Real people are slower at first and smarter later: these numbers guide venue playtests; they do not promise a clear rate. `effective actions` = successful minigames in winning raids; `role skew` = most crowded seat's share minus 1/4.

| crew | clear | Japan fell | timeout | clear time p50/p90 | cities left | SYNC avg | special ok/fb/fail | effective actions (wins) | role skew | assist |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 91.4% | 1.8% | 6.8% | 420s / 438s | 7.8 | 73 | 1.3%/75.4%/0.0% | 99 (p10 94) | 0.25 | 51 |
| 10 | 98.7% | 0.2% | 1.1% | 404s / 438s | 8.0 | 97 | 71.7%/28.3%/0.0% | 218 (p10 206) | 0.05 | 0 |
| 30 | 91.7% | 6.0% | 2.3% | 401s / 418s | 7.6 | 97 | 84.6%/15.4%/0.0% | 641 (p10 623) | 0.05 | 0 |
| 50 | 99.8% | 0.1% | 0.1% | 397s / 402s | 8.0 | 97 | 99.8%/0.2%/0.0% | 1052 (p10 1029) | 0.05 | 0 |

Reading: small crews (2) rely on the assist AI and mostly finish with the partial combo (FALLBACK); 10–50 pilots usually reach the full 神雷風陣. 30 pilots show the most "Japan fell" outcomes (6%) — the wings of escorts scale with the crowd before the boss. See docs/BALANCE_REPORT.md (`pnpm simulate`) for role-mix and skill sweeps.
