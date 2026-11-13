# Kong Hub

Static NFL prop board for GitHub Pages. Week 10 is in `pwa/`. Probabilities are model output, not locks. This folder does not place bets and does not contain API keys.

## What runs on its own

`.github/workflows/pages.yml` uses `GITHUB_TOKEN` only.

- Tuesday 09:00 UTC (3:00 AM CT in November): reload the free stat rolls and publish the week.
- Every day 13:00 UTC (7:00 AM CT in November): light roster and streak refresh.
- Saturday and Sunday at that same 7:00 AM CT run: republish DraftKings and FanDuel props.

The job writes `pwa/` and pushes that folder to the `gh-pages` branch. The live site is the branch root, so the address is `https://coolhvacleads-star.github.io/kong-hub/`.

## If the site is not up after the first green run

GitHub sometimes does not turn Pages on when `gh-pages` appears. One setting does it:

**Settings → Pages → Build and deployment → Source → Deploy from a branch → Branch `gh-pages` and folder `/ (root)` → Save.**

## Other deploy option

`PAGES.md` shows `actions/deploy-pages` instead of the `gh-pages` branch. That option needs Source set to **GitHub Actions**.
