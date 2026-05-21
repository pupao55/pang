# Launch plan

Owner: growth-strategist agent (`.claude/agents/growth-strategist.md`).

This is a scaffold. Fill in as launch readiness develops. Date-stamp every
revision so older copy is recoverable.

## One-liner candidates

- "Honest calibration for A-share signals — research, not a tip line."
- "Tongdaxin-style formulas, transparently scored and openly calibrated."
- "胖子 · 不预测股价，只告诉你今天的评分是否还靠谱。"

Pick one once the audience is decided.

## Positioning

Pangzi vs. competitors (see `RESEARCH_LOG.md` for evidence):

| Competitor | Position vs. Pangzi |
|---|---|
| 同花顺 / 东方财富 (THS, Eastmoney) | Pro execution + data, opaque scoring. Pangzi is research-only and transparent. |
| 米筐 / 聚宽 (Ricequant, JoinQuant) | Quant sandboxes. Pangzi is a daily research dashboard, not a backtesting platform. |
| Generic Twitter/Xueqiu signal accounts | Black-box picks. Pangzi shows the model. |

## Demo narrative (TBD)

When ready to demo:

1. Open `/dashboard` — show market sentiment.
2. Open `/signals` — show ranked candidates with score breakdown.
3. Click into a stock — show /stocks/[symbol] with KLine + score components.
4. Open `/validation` — *land here last*, because this is the punchline:
   "the tool tells you whether to trust itself."
5. Open `reports/horizon-calibration-report.md` — show the v1.9 finding
   that high-score signals are 1d momentum, not 5d swings.

## Launch checklist (when ready)

- [ ] Decide repo visibility (currently public on
      `https://github.com/pupao55/pang.git`).
- [ ] Resolve T-008 (data redistribution + license position).
- [ ] Write a v1.9 changelog summary (1 paragraph).
- [ ] Screenshots: dashboard, signals (with detail expanded), validation,
      horizon report.
- [ ] Disclaimer copy: "Research software, not investment advice" appears
      on every page.
- [ ] Decide audience: Chinese-language post on 雪球 / 即刻 / 少数派 / V2EX,
      vs. English-language post on HN / Twitter, vs. private alpha to
      friends-of-friends.

## Open positioning questions

- Should Pangzi be presented as a personal tool or as something other
  traders should adopt? (Affects whether the README opens with "I built
  this for me" or "for you.")
- Should the public demo include the live BaoStock cache, or run on the
  mock universe to keep data redistribution clean?
- Does the calibration-honest framing read as "rigorous" or as
  "underconfident"? Audience-test before launching.
