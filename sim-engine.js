/* Same matchup draws as hub/nfl_engine.py. Lognormal yards, route x TPRR targets. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.KongSim = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const TD_BASE = 0.211;
  const TD_EPA = 0.35;
  const FG_RATE = 0.135;
  const EXPLOSIVE_P = 0.08;
  const EXPLOSIVE_MULT = 2.15;
  const YARD_SIGMA = 0.55;
  const YARD_MEAN_FIX = 1 + EXPLOSIVE_P * (EXPLOSIVE_MULT - 1);

  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let mixed = Math.imul(a ^ (a >>> 15), 1 | a) | 0;
      mixed = (((mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) | 0) ^ mixed) | 0;
      return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(value, low, high) {
    return Math.max(low, Math.min(high, value));
  }

  function poisson(rng, mean) {
    if (mean <= 0) return 0;
    const limit = Math.exp(-mean);
    let count = 0;
    let product = 1;
    while (product > limit && count < 40) {
      count += 1;
      product *= rng();
    }
    return count - 1;
  }

  function negbin(rng, mean) {
    const scale = mean / 4;
    let gamma = 0;
    for (let i = 0; i < 4; i++) gamma += -Math.log(Math.max(rng(), 1e-12)) * scale;
    return poisson(rng, gamma);
  }

  /* v48 skewed prop draws (mirrors hub/model_v48.py): NB counts, gamma yards, median kept on center. */
  const REC_R = 10, CAR_R = 6, ATT_R = 16, COMP_R = 16, REC_CV = 0.85, RUSH_CV = 0.75, PASS_CV = 0.35;

  function stdNormal(rng) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function gammaP(shape, x) {
    if (x <= 0) return 0;
    if (x < shape + 1) {
      let term = 1 / shape;
      let total = term;
      for (let k = 1; k < 500; k++) {
        term *= x / (shape + k);
        total += term;
        if (Math.abs(term) < Math.abs(total) * 1e-13) break;
      }
      return Math.min(1, total * Math.exp(-x + shape * Math.log(x) - lgamma(shape)));
    }
    const tiny = 1e-300;
    let b = x + 1 - shape;
    let c = 1 / tiny;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - shape);
      b += 2;
      d = an * d + b;
      if (Math.abs(d) < tiny) d = tiny;
      c = b + an / c;
      if (Math.abs(c) < tiny) c = tiny;
      d = 1 / d;
      const delta = d * c;
      h *= delta;
      if (Math.abs(delta - 1) < 1e-13) break;
    }
    return Math.max(0, 1 - h * Math.exp(-x + shape * Math.log(x) - lgamma(shape)));
  }

  function lgamma(z) {
    const g = 7;
    const coef = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
    z -= 1;
    let x = coef[0];
    for (let i = 1; i < g + 2; i++) x += coef[i] / (z + i);
    const t = z + g + 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }

  const QCACHE = {};
  function gammaQuantileUnit(k, p) {
    const key = k.toFixed(6) + "|" + p.toFixed(6);
    if (QCACHE[key] != null) return QCACHE[key];
    let lo = 0, hi = 1;
    while (gammaP(k, k * hi) < p && hi < 64) hi *= 2;
    for (let i = 0; i < 70; i++) {
      const mid = 0.5 * (lo + hi);
      if (gammaP(k, k * mid) < p) lo = mid; else hi = mid;
    }
    QCACHE[key] = 0.5 * (lo + hi);
    return QCACHE[key];
  }

  function gammaSfMean(x, mean, cv) {
    if (mean <= 0) return 0;
    const k = 1 / (cv * cv);
    return 1 - gammaP(k, k * Math.max(x, 0) / mean);
  }

  function gammaUnit(rng, k) {
    const k0 = k;
    let boost = 1;
    if (k < 1) { boost = Math.pow(Math.max(rng(), 1e-12), 1 / k); k += 1; }
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (let i = 0; i < 64; i++) {
      const x = stdNormal(rng);
      let v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v;
      const u = Math.max(rng(), 1e-12);
      if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v * boost / k0;
    }
    return 1;
  }

  function poissonBig(rng, mean) {
    if (mean <= 0) return 0;
    if (mean >= 30) return Math.max(0, Math.round(mean + Math.sqrt(mean) * stdNormal(rng)));
    const limit = Math.exp(-mean);
    let count = 0;
    let product = 1;
    while (product > limit && count < 120) { count += 1; product *= rng(); }
    return count - 1;
  }

  function nbDraw(rng, mean, r) {
    if (mean <= 0) return 0;
    return poissonBig(rng, mean * gammaUnit(rng, r));
  }

  function skewYards(rng, center, cv, cap) {
    if (center <= 0) return 0;
    const k = 1 / (cv * cv);
    return Math.min(cap || 260, center * gammaUnit(rng, k) / gammaQuantileUnit(k, 0.5));
  }

  function nbSf(mean, r, threshold) {
    if (threshold <= 0) return 1;
    if (mean <= 0) return 0;
    const p = r / (r + mean);
    const lp = Math.log(p), lq = Math.log(1 - p);
    let total = 0;
    for (let k = 0; k < threshold; k++) total += Math.exp(lgamma(k + r) - lgamma(k + 1) - lgamma(r) + r * lp + k * lq);
    return Math.max(0, Math.min(1, 1 - total));
  }

  function nbMeanFor(threshold, probability, r) {
    let lo = 0.02, hi = 40;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      if (nbSf(mid, r, threshold) > probability) hi = mid; else lo = mid;
    }
    return 0.5 * (lo + hi);
  }

  function marketProb(price) {
    const american = +price;
    return american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
  }

  function yardCenter(season, line, price, cv) {
    cv = cv || REC_CV;
    const marketP = marketProb(price);
    const modelP = season != null && +season > 0 ? gammaSfMean(+line, +season, cv) : marketP;
    let blended = 0.45 * modelP + 0.55 * marketP;
    blended = Math.min(Math.max(blended, marketP - 0.03), marketP + 0.03);
    blended = Math.min(Math.max(blended, 0.04), 0.96);
    const k = 1 / (cv * cv);
    const q = gammaQuantileUnit(k, 1 - blended);
    if (q <= 0) return +line;
    return Math.max(0, +line * gammaQuantileUnit(k, 0.5) / q);
  }

  function recLambda(rate, line, price) {
    const threshold = Math.floor(+line) + 1;
    const marketP = marketProb(price);
    const modelP = nbSf(+rate, REC_R, threshold);
    let blended = 0.45 * modelP + 0.55 * marketP;
    blended = Math.min(Math.max(blended, marketP - 0.03), marketP + 0.03);
    return nbMeanFor(threshold, Math.min(Math.max(blended, 0.02), 0.95), REC_R);
  }

  function practiceMult(player) {
    const blob = player && player.practice;
    if (!blob || blob.status !== "Questionable") return 1;
    const mult = +blob.snap_mult;
    return Number.isFinite(mult) ? Math.max(0.85, Math.min(1, mult)) : 1;
  }

  function applyPracticeUsage(player) {
    const mult = practiceMult(player);
    if (mult >= 0.999) return;
    player.target = (+player.target || 0) * mult;
    player.carry = (+player.carry || 0) * mult;
    if (player.route_pct != null) player.route_pct = +player.route_pct * mult;
  }

  function lognorm(rng, mean) {
    const target = mean / YARD_MEAN_FIX;
    const mu = Math.log(target) - 0.5 * YARD_SIGMA * YARD_SIGMA;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    let yards = Math.exp(mu + YARD_SIGMA * z);
    if (rng() < EXPLOSIVE_P) yards *= EXPLOSIVE_MULT;
    return yards;
  }

  function pick(rng, players, key) {
    let total = 0;
    for (let i = 0; i < players.length; i++) total += Math.max(players[i][key], 0.001);
    let mark = rng() * total;
    for (let i = 0; i < players.length; i++) {
      mark -= Math.max(players[i][key], 0.001);
      if (mark <= 0) return players[i];
    }
    return players[players.length - 1];
  }

  function environment(spec) {
    const roof = String(spec.roof || "");
    const indoor = /indoor|dome|canopy|closed|retractable/i.test(roof);
    const wind = indoor ? 0 : +spec.wind || 0;
    const gust = indoor ? 0 : +spec.gust || 0;
    const precip = indoor ? 0 : +spec.precip || 0;
    const altitude = indoor ? 0 : +spec.altitude || 0;
    let boost = indoor ? 1.025 : 1;
    if (altitude >= 3000) boost *= 1 + Math.min(0.03, 0.01 * (altitude - 3000) / 1000);
    let compPen = 0;
    let fgPen = 0;
    let runNudge = 0;
    if (wind >= 15) {
      boost *= Math.max(0.9, 1 - 0.004 * (wind - 15));
      compPen += Math.min(0.06, 0.004 * (wind - 15));
      fgPen += Math.min(0.18, 0.012 * (wind - 15));
      runNudge += Math.min(0.06, 0.003 * (wind - 15));
    }
    if (gust >= 22) {
      fgPen += 0.04;
      compPen += 0.01;
    }
    if (precip >= 40) {
      boost *= 0.97;
      compPen += 0.015;
    }
    let fumbleMult = 1;
    if (!indoor && spec.wet) {
      boost *= 0.96;
      compPen += 0.02;
      runNudge += 0.03;
      fumbleMult = 1.25;
    }
    return { indoor: indoor, wind: wind, pass_boost: boost, comp_pen: compPen, fg_pen: fgPen, run_nudge: runNudge, fumble_mult: fumbleMult };
  }

  function copyPlayer(player) {
    const row = {
      name: player.name,
      pos: player.pos || "WR",
      depth: player.depth == null ? 9 : player.depth | 0,
      status: isOut(player) ? "out" : (player.status || "active"),
      forcedOut: !!player.forcedOut,
      target: +player.target || 0,
      carry: +player.carry || 0,
      route_pct: player.route_pct,
      tprr: player.tprr,
      ypr: player.ypr,
      ypt: player.ypt,
      ypc: player.ypc,
      ypa: player.ypa,
      comp: player.comp,
      catch: player.catch,
      ptd: player.ptd,
      intr: player.intr,
      rtd: player.rtd,
      skill_index: player.skill_index,
      opp_pos_mult: player.opp_pos_mult,
      vs_opp_mult: player.vs_opp_mult,
      dvp_rec: player.dvp_rec == null ? 1 : +player.dvp_rec,
      dvp_yds: player.dvp_yds == null ? 1 : +player.dvp_yds,
      dvp_rush: player.dvp_rush == null ? 1 : +player.dvp_rush,
      dvp_pass: player.dvp_pass == null ? 1 : +player.dvp_pass,
      env_mult: player.env_mult,
      success_mult: player.success_mult,
      open_pct: player.open_pct,
      sep: player.sep,
      yac_oe: player.yac_oe,
      cmp_mult: player.cmp_mult,
      rzCarry: player.rzCarry,
      rzTarget: player.rzTarget,
      madden_skill: player.madden_skill,
      dropbacks: player.dropbacks,
      splits: player.splits || null,
      espn_id: player.espn_id || "",
      bookPass: player.bookPass == null ? null : +player.bookPass,
      bookComp: player.bookComp == null ? null : +player.bookComp,
      bookPassTd: player.bookPassTd == null ? null : +player.bookPassTd,
      td_over: player.td_over == null ? null : +player.td_over,
      td_offers: pricedOffers(player.td_offers),
      rec_offers: pricedOffers(player.rec_offers),
      yard_offers: pricedOffers(player.yard_offers),
      rec_g: player.rec_g == null ? null : +player.rec_g,
      att_pg: player.att_pg == null ? null : +player.att_pg,
      comp_pg: player.comp_pg == null ? null : +player.comp_pg,
      pass_yds_pg: player.pass_yds_pg == null ? null : +player.pass_yds_pg,
      pass_td_pg: player.pass_td_pg == null ? null : +player.pass_td_pg,
      td_pg: player.td_pg == null ? null : +player.td_pg,
      bookRush: player.bookRush == null ? null : +player.bookRush,
      bookRec: player.bookRec == null ? null : +player.bookRec,
      bookTd: player.bookTd == null ? null : +player.bookTd,
      rush_td_per: player.rush_td_per == null ? null : +player.rush_td_per,
      rec_td_per: player.rec_td_per == null ? null : +player.rec_td_per,
      any_yes: player.any_yes == null ? null : +player.any_yes,
      rush_pg: +player.rush_pg || 0,
      rec_pg: player.rec_pg == null ? null : +player.rec_pg,
      tgt_pg: player.tgt_pg == null ? null : +player.tgt_pg,
      bookRecs: player.bookRecs == null ? null : +player.bookRecs,
      untargeted_rate: player.untargeted_rate == null ? null : +player.untargeted_rate,
      qb_rush_pg: player.qb_rush_pg == null ? null : +player.qb_rush_pg,
      qb_rush_ypc: player.qb_rush_ypc == null ? null : +player.qb_rush_ypc,
      rush_recent: player.rush_recent == null ? null : +player.rush_recent,
      return_ramp: player.return_ramp == null ? null : +player.return_ramp,
      slot_rate: player.slot_rate == null ? null : +player.slot_rate,
      adot: player.adot == null ? null : +player.adot,
      role: player.role || null,
      man_ypt: player.man_ypt == null ? null : +player.man_ypt,
      zone_ypt: player.zone_ypt == null ? null : +player.zone_ypt,
      split_n: player.split_n == null ? null : +player.split_n,
      qb_base_comp: player.qb_base_comp == null ? null : +player.qb_base_comp,
      qb_base_ypa: player.qb_base_ypa == null ? null : +player.qb_base_ypa,
      qb_base_sack: player.qb_base_sack == null ? null : +player.qb_base_sack,
      qb_base_int: player.qb_base_int == null ? null : +player.qb_base_int,
      qb_blitz_comp: player.qb_blitz_comp == null ? null : +player.qb_blitz_comp,
      qb_blitz_ypa: player.qb_blitz_ypa == null ? null : +player.qb_blitz_ypa,
      qb_blitz_sack: player.qb_blitz_sack == null ? null : +player.qb_blitz_sack,
      qb_blitz_td: player.qb_blitz_td == null ? null : +player.qb_blitz_td,
      qb_blitz_int: player.qb_blitz_int == null ? null : +player.qb_blitz_int,
      qb_blitz_n: player.qb_blitz_n == null ? null : +player.qb_blitz_n,
      qb_press_comp: player.qb_press_comp == null ? null : +player.qb_press_comp,
      qb_press_ypa: player.qb_press_ypa == null ? null : +player.qb_press_ypa,
      qb_press_sack: player.qb_press_sack == null ? null : +player.qb_press_sack,
      qb_press_scr: player.qb_press_scr == null ? null : +player.qb_press_scr,
      qb_clean_comp: player.qb_clean_comp == null ? null : +player.qb_clean_comp,
      qb_clean_ypa: player.qb_clean_ypa == null ? null : +player.qb_clean_ypa,
      qb_clean_sack: player.qb_clean_sack == null ? null : +player.qb_clean_sack,
      qb_clean_scr: player.qb_clean_scr == null ? null : +player.qb_clean_scr,
      qb_press_n: player.qb_press_n == null ? null : +player.qb_press_n,
      qb_man_ypa: player.qb_man_ypa == null ? null : +player.qb_man_ypa,
      qb_zone_ypa: player.qb_zone_ypa == null ? null : +player.qb_zone_ypa,
      qb_man_n: player.qb_man_n == null ? null : +player.qb_man_n,
      team: player.team || null,
      locker_room: player.locker_room || null,
      practice: player.practice || null,
    };
    applyLockerUsage(row);
    applyPracticeUsage(row);
    return row;
  }

  function applyLockerUsage(player) {
    const raw = player.locker_room && player.locker_room.usage_mult;
    const mult = Math.max(0.94, Math.min(1.06, raw == null || raw === "" ? 1 : +raw));
    if (!Number.isFinite(mult) || Math.abs(mult - 1) < 1e-9) return;
    player.target = (+player.target || 0) * mult;
    player.carry = (+player.carry || 0) * mult;
    if (player.route_pct != null) player.route_pct = +player.route_pct * mult;
  }

  function promote(players) {
    ["QB", "RB", "WR", "TE"].forEach(function (pos) {
      const group = players.filter(function (player) { return player.pos === pos; });
      const active = group.filter(function (player) { return player.status !== "out"; });
      if (!active.length) return;
      [["carry", 0.72], ["target", 0.45], ["route_pct", 0.96]].forEach(function (pair) {
        const key = pair[0];
        const cap = pair[1];
        const pool = group.reduce(function (sum, player) { return sum + (+player[key] || 0); }, 0);
        if (pool <= 0) return;
        const weights = active.map(function (player) { return Math.max(+player[key] || 0, 0.01); });
        const total = weights.reduce(function (sum, value) { return sum + value; }, 0);
        const raw = weights.map(function (weight) { return pool * weight / total; });
        for (let pass = 0; pass < 3; pass++) {
          let overflow = 0;
          const room = [];
          raw.forEach(function (value, index) {
            if (value > cap) {
              overflow += value - cap;
              raw[index] = cap;
            } else room.push(index);
          });
          if (overflow <= 0 || !room.length) break;
          const roomSum = room.reduce(function (sum, index) { return sum + raw[index]; }, 0) || 1;
          room.forEach(function (index) { raw[index] += overflow * raw[index] / roomSum; });
        }
        active.forEach(function (player, index) { player[key] = raw[index]; });
      });
    });
  }

  function isOut(player) {
    const status = String((player && player.status) || "").toLowerCase();
    return !!(player && (player.out || status === "out" || status === "ir" || status === "doubtful" || status === "inactive" || status === "suspended" || status.indexOf("reserve") >= 0));
  }

  function unit(list, key, count, fallback) {
    const live = (list || []).filter(function (player) { return !isOut(player) && player[key] != null; })
      .sort(function (a, b) { return (a.depth == null ? 99 : a.depth) - (b.depth == null ? 99 : b.depth); })
      .slice(0, count);
    if (!live.length) return fallback == null ? null : +fallback;
    return live.reduce(function (sum, player) { return sum + (+player[key]); }, 0) / live.length;
  }

  function prepareSide(side, opp, spec, env, home) {
    const league = spec.league || {};
    const players = (side.players || []).map(copyPlayer);
    concentrate(players);
    const olPb = unit(side.ol, "pb", 5, side.madden_ol_pb);
    const olRb = unit(side.ol, "rb", 5, side.madden_ol_rb);
    const dlPr = unit(opp.dl, "pr", 4, opp.madden_dl_pr);
    const runDef = unit(opp.dl, "run", 4, opp.madden_run_def);
    const cov = unit(opp.cb, "cov", 3, opp.madden_cov);
    const leagueCov = +(league.cov || cov || 0);
    const passGap = olPb == null || dlPr == null ? 0 : +olPb - +dlPr;
    const runGap = olRb == null || runDef == null ? 0 : +olRb - +runDef;
    const passTrench = clamp(1 + passGap / 350, 0.9, 1.1);
    const runTrench = clamp(1 + runGap / 350, 0.9, 1.1);
    const corners = coverageMults(opp, leagueCov);
    const safety = safetyBump(opp);
    corners.outside *= safety;
    corners.nickel *= safety;
    const covMult = cov == null ? 1 : clamp(1 - (cov - leagueCov) / 400, 0.93, 1.07);
    const lbGrade = unit(opp.lb, "cov", 3, null);
    const lbMult = lbGrade == null ? covMult : clamp(1 - (lbGrade - leagueCov) / 400, 0.93, 1.07);
    const removed = new Set((side.removed || []).map(function (row) { return row.name; }));
    function toggled(player) {
      if (!player) return false;
      if (player.forcedOut) return true;
      return player.status === "out" && !removed.has(player.name);
    }
    const qbs = players.filter(function (player) { return player.pos === "QB"; }).sort(function (a, b) { return a.depth - b.depth; });
    const wrs = players.filter(function (player) { return player.pos === "WR"; }).sort(function (a, b) { return a.depth - b.depth; });
    const rbs = players.filter(function (player) { return player.pos === "RB"; }).sort(function (a, b) { return a.depth - b.depth; });
    const starter = qbs[0] || null;
    let activeQb = qbs.find(function (player) { return player.status !== "out"; }) || null;
    let drop = 0;
    if (toggled(starter)) {
      const starterOvr = +((starter && starter.madden_skill) || 78);
      const backupOvr = +(((activeQb || starter) && (activeQb || starter).madden_skill) || 66);
      drop += clamp(5 + Math.max(0, starterOvr - backupOvr) * 0.05, 5, 6.5);
      activeQb = null;
    } else if (activeQb && +(activeQb.dropbacks || 0) < 80) {
      activeQb.ypa = Math.min(+(activeQb.ypa || 6.4), 6.4);
      activeQb.comp = Math.min(+(activeQb.comp || 0.62), 0.62);
    }
    if (toggled(wrs[0])) drop += 1.3;
    if (toggled(rbs[0])) drop += 1.2;
    const homeSpread = +spec.homeSpread || 0;
    const total = spec.total;
    let implied = total == null ? 22 : (home ? (+total - homeSpread) / 2 : (+total + homeSpread) / 2);
    implied = Math.max(9, implied - drop);
    const pFg = clamp(0.18 * (1 - env.fg_pen), 0.08, 0.24);
    const pTd = clamp((implied / 11 - 3 * pFg) / (7 - 3 * pFg), 0.04, 0.4);
    const leagueCatch = +(league.catch || 0.64);
    const leagueOpen = +(league.open || 0.72);
    const leagueSep = +(league.sep || 2.9);
    const live = players.filter(function (player) { return player.status !== "out"; });
    let pace = side.pace;
    if (!pace) pace = (+side.plays || 5.6) * 11;
    const teamPlays = clamp(+pace, 56, 62);
    live.forEach(function (player) {
      const skill = +(player.skill_index || 1);
      const oppMult = +(player.opp_pos_mult || 1);
      const hist = +(player.vs_opp_mult || 1);
      const envMult = +(player.env_mult || 1);
      const passEff = 0.45 * skill + 0.30 * oppMult + 0.15 * passTrench + 0.10 * hist;
      const runEff = 0.45 * skill + 0.30 * oppMult + 0.15 * runTrench + 0.10 * hist;
      let ypr = +(player.ypr || player.ypt || 11);
      ypr *= clamp(passEff, 0.92, 1.08) * clamp(envMult, 0.94, 1.06);
      player._ypr = clamp(ypr, 8, 14.5);
      const rawYpc = +(player.ypc || 4.3) * clamp(runEff, 0.92, 1.08);
      player._ypc = clamp(0.35 * rawYpc + 0.65 * 4.35, 3.7, 5.05);
      player._ypc = clamp(player._ypc * clamp(1 + runGap * 0.004, 0.97, 1.03), 3.55, 5.25);
      player._carry = Math.max(+player.carry || 0, 0);
      const coverBase = player.pos === "WR" ? (slotHeavy(player) ? corners.nickel : corners.outside) : (player.pos === "TE" || player.pos === "RB" ? lbMult : covMult);
      const cover = coverBase * (+player.cmp_mult || 1);
      if ((player.pos === "WR" || player.pos === "TE") && player.open_pct != null) {
        const sep = +(player.sep || leagueSep);
        player._open = clamp((0.85 + 0.15 * (+player.open_pct / leagueOpen)) * (1 + (sep - leagueSep) * 0.03) * cover, 0.85, 1.2);
      } else player._open = cover;
      player.catch = +(player.catch || leagueCatch);
      let weight = (+player.route_pct || 0) * (+player.tprr || 0);
      if (weight <= 0) weight = +player.target || 0;
      if (weight < 0.02) weight = 0;
      player._weight = weight * clamp(hist, 0.94, 1.06);
    });
    restoreDepth(live);
    live.forEach(function (player) {
      if (player.pos !== "QB") return;
      player._qbStarter = player === activeQb;
      if (player !== activeQb) player._carry = 0;
    });
    const proven = activeQb && +(activeQb.dropbacks || 0) >= 80;
    if (activeQb) {
      const envMult = +(activeQb.env_mult || 1);
      activeQb._comp = clamp(+(activeQb.comp || 0.64) * clamp(envMult, 0.96, 1.04) - env.comp_pen, 0.56, proven ? 0.68 : 0.62);
      activeQb._int = clamp(+(activeQb.intr || 0.022), 0.012, 0.045);
      const cap = proven ? 7.2 : 6.05;
      activeQb._ypa_abs = clamp(+(activeQb.ypa || (proven ? 7.1 : 6.0)), 5.6, cap);
      activeQb._ypa_abs = clamp(activeQb._ypa_abs * clamp(1 + passGap * 0.003, 0.97, 1.03), 5.4, cap + 0.25);
    }
    const sackAdj = qbCoverage(activeQb, opp, league);
    let sack = (drop ? 0.07 : 0.055) + clamp(-passGap * 0.0015, -0.012, 0.012) + sackAdj;
    const catchers = live.filter(function (player) { return player.pos !== "QB" && player._weight > 0; });
    liftAlpha(catchers);
    shapeCarries(live);
    let baseRate = clamp((+side.passRate || 0.56) + (+side.proe || 0) * 0.5, 0.5, 0.58);
    if (activeQb && !proven) baseRate = clamp(baseRate - 0.06, 0.46, 0.52);
    const favored = home ? -homeSpread : homeSpread;
    const rushTarget = clamp(25 + favored * 0.28, 24, 29);
    const passPlays = clamp(teamPlays * baseRate, 30, 37);
    const totalPlays = passPlays + rushTarget;
    blendMarketRole(live, passPlays, rushTarget, activeQb, drop ? 0.07 : 0.055, side.team_rush_ypg, runGap);
    const throwaway = anchorTargets(players, passPlays, activeQb && activeQb.untargeted_rate);
    live.forEach(function (player) { player._base_tgt = +player._weight || 0; });
    pullReceivingYards(live);
    setMarketMeans(live, activeQb);
    tiltManZone(live, opp, league);
    applyQbRush(players);
    if (activeQb && activeQb._scr_add && activeQb._qbStarter) activeQb._gadget = Math.max(0, (+activeQb._gadget || 0) + clamp(activeQb._scr_add * passPlays, -0.8, 0.8));
    setTouchdowns(live, implied);
    const aimed = live.filter(function (player) { return player.pos !== "QB" && player._weight > 0; });
    return {
      players: live,
      qb: activeQb,
      catchers: aimed,
      rushers: live.filter(function (player) { return player._carry > 0; }),
      pass_rate: passPlays / totalPlays,
      plays: totalPlays / 11,
      sack: clamp(sack, 0.035, 0.085),
      throwaway: throwaway,
      p_td: pTd,
      p_fg: pFg,
      league_catch: leagueCatch,
    };
  }

  const BELLCOW = { "jahmyr gibbs": 1, "saquon barkley": 1, "bijan robinson": 1, "christian mccaffrey": 1 };

  function normName(name) {
    return String(name || "").toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  function carryCap(player) {
    if (BELLCOW[normName(player.name)]) return 0.74;
    if (player.bookRush != null && +player.bookRush >= 85) return 0.70;
    return 0.68;
  }

  function parkSkillCarries(players) {
    const backs = players.filter(function (player) { return player.pos === "RB" && player.status !== "out"; });
    let freed = 0;
    players.forEach(function (player) {
      if (player.pos !== "WR" && player.pos !== "TE" || player.status === "out") {
        player._gadget = 0;
        return;
      }
      let rate = +player.rush_pg || 0;
      if (rate < 0.8) rate = Math.min(rate, 1.2);
      player._gadget = rate;
      freed += +player._carry || 0;
      player._carry = 0;
    });
    if (freed <= 0 || !backs.length) return;
    const total = backs.reduce(function (sum, player) { return sum + +player._carry; }, 0);
    if (total <= 0) {
      const share = freed / backs.length;
      backs.forEach(function (player) { player._carry += share; });
      return;
    }
    backs.forEach(function (player) { player._carry += freed * player._carry / total; });
  }

  function capRushShare(players) {
    parkSkillCarries(players);
    const backs = players.filter(function (player) { return player.pos === "RB" && player.status !== "out"; });
    if (!backs.length) return;
    const rushers = backs.concat(players.filter(function (player) { return player.pos === "QB" && player.status !== "out"; }));
    const total = rushers.reduce(function (sum, player) { return sum + +player._carry; }, 0);
    if (total <= 0) return;
    const lead = backs.slice().sort(function (a, b) { return b._carry - a._carry; })[0];
    const cap = carryCap(lead);
    if (lead._carry / total <= cap) return;
    const removed = lead._carry - cap * total;
    lead._carry = cap * total;
    const others = backs.filter(function (player) { return player !== lead; });
    if (!others.length) { lead._carry += removed; return; }
    const raw = others.map(function (player) { return Math.max(+player._carry, 0.05); });
    const rawSum = raw.reduce(function (sum, value) { return sum + value; }, 0);
    others.forEach(function (player, index) { player._carry += removed * raw[index] / rawSum; });
  }

  function restoreDepth(players) {
    [["RB", "_carry", "bookRush"], ["WR", "_weight", "bookRec"], ["TE", "_weight", "bookRec"]].forEach(function (pair) {
      const pos = pair[0], key = pair[1], market = pair[2];
      const group = players.filter(function (player) { return player.pos === pos && player.status !== "out"; });
      const priced = group.filter(function (player) { return player[market] != null; });
      const starter = priced.length >= 2
        ? priced.slice().sort(function (a, b) { return +b[market] - +a[market]; })[0]
        : group.find(function (player) { return (player.depth | 0) === 0; });
      if (!starter) return;
      group.forEach(function (other) {
        if (other === starter) return;
        if (+other[key] > +starter[key]) {
          const held = starter[key];
          starter[key] = other[key];
          other[key] = held;
        }
      });
    });
  }

  function blendMarketRole(players, passPlays, rushTarget, qb, sack, teamRushYpg, runGap) {
    assignRbCarries(players, rushTarget, teamRushYpg, runGap || 0);
  }

  function nearLine(value, line) {
    if (line == null || +line <= 0) return value;
    return Math.min(Math.max(value, +line * 0.94), +line * 1.06);
  }

  function recentRate(player) {
    if (player.rush_recent != null) return Math.max(0, +player.rush_recent);
    return Math.max(0, +player.rush_pg || 0);
  }

  function returnRamp(player) {
    const value = player.return_ramp == null ? 1 : +player.return_ramp;
    return Math.max(0.45, Math.min(1, value));
  }

  function assignRbCarries(players, rushTarget, teamRushYpg, runGap) {
    const backs = players.filter(function (player) { return player.pos === "RB" && player.status !== "out"; })
      .sort(function (a, b) { return a.depth - b.depth || recentRate(b) - recentRate(a); });
    if (!backs.length) return;
    const plans = backs.map(function (player, index) {
      let recent = recentRate(player) * returnRamp(player);
      let ypc = +(player._ypc || player.ypc || 4.4) || 4.4;
      ypc = Math.max(3.4, Math.min(5.3, ypc));
      let seasonYards = recent * ypc * dvpMult(player, "dvp_rush");
      const line = player.bookRush;
      const higher = backs.some(function (other) {
        return other !== player && other.bookRush != null && line != null && +other.bookRush >= +line * 1.5;
      });
      if (higher && line != null) {
        seasonYards = Math.min(seasonYards, +line * 1.35);
        recent = Math.min(recent, seasonYards / ypc);
      }
      let yards = seasonYards;
      let carries = recent;
      if (index < 2 && line != null && ypc > 0) {
        yards = nearLine(0.45 * seasonYards + 0.55 * +line, line);
        carries = yards / ypc;
      }
      if (index >= 2) {
        const own = recentRate(player);
        carries = Math.min(carries, own);
        yards = Math.min(yards, own * ypc);
      }
      return [player, Math.max(0, carries), Math.max(0, yards)];
    });
    const priced = backs.map(function (player, index) { return index < 2 && player.bookRush != null ? index : -1; }).filter(function (index) { return index >= 0; });
    if (priced.length >= 2) {
      const left = priced[0], right = priced[1];
      const leftLine = +backs[left].bookRush, rightLine = +backs[right].bookRush;
      if (Math.min(leftLine, rightLine) > 0 && Math.max(leftLine, rightLine) / Math.min(leftLine, rightLine) <= 1.2) {
        const pair = plans[left][2] + plans[right][2];
        const lineShare = leftLine / (leftLine + rightLine);
        const formShare = pair ? plans[left][2] / pair : lineShare;
        const mixed = 0.5 * formShare + 0.5 * lineShare;
        [[left, mixed], [right, 1 - mixed]].forEach(function (pairShare) {
          const index = pairShare[0];
          const share = pairShare[1];
          const plan = plans[index];
          const newYards = pair * share;
          const ratio = plan[2] ? newYards / plan[2] : 1;
          plans[index] = [plan[0], plan[1] * ratio, newYards];
        });
      }
    }
    if (teamRushYpg) {
      const cap = +teamRushYpg * Math.max(0.92, Math.min(1.08, 1 + (+runGap || 0) * 0.004));
      const total = plans.reduce(function (sum, plan) { return sum + plan[2]; }, 0);
      if (total > cap && cap > 0) {
        const scale = cap / total;
        for (let index = 0; index < plans.length; index++) plans[index] = [plans[index][0], plans[index][1] * scale, plans[index][2] * scale];
      }
    }
    plans.forEach(function (plan, index) {
      if (index < 2 && plan[0].bookRush != null) {
        const yards = nearLine(plan[2], plan[0].bookRush);
        const ypc = Math.max(3.4, Math.min(5.3, +(plan[0]._ypc || 4.4)));
        plans[index] = [plan[0], ypc ? yards / ypc : plan[1], yards];
      }
    });
    plans.forEach(function (plan) {
      const player = plan[0];
      player._carry = 0;
      if (plan[1] < 0.15) { player._gadget = 0; return; }
      player._gadget = Math.min(plan[1], 22);
      player._ypc = Math.max(2.8, Math.min(6.2, plan[2] / plan[1]));
    });
  }

  function pullReceivingYards(players) {
    players.forEach(function (player) {
      if ((player.pos !== "WR" && player.pos !== "TE" && player.pos !== "RB") || player.status === "out") return;
      const season = player.rec_pg;
      const line = player.bookRec;
      if (season == null && line == null) return;
      let yards = season == null ? +line : line == null ? +season : 0.45 * +season + 0.55 * +line;
      let catches = null;
      if (player.bookRecs != null) {
        const seasonRec = season == null ? null : +season / 11;
        catches = seasonRec == null ? +player.bookRecs : 0.45 * seasonRec + 0.55 * +player.bookRecs;
        catches = nearLine(catches, player.bookRecs);
      }
      if (line != null) yards = nearLine(yards, line);
      const ypt = Math.max(8, +(player._ypr || 11));
      let desired = Math.max(0, yards) / ypt;
      if (catches != null) desired = Math.min(desired, catches / 0.70);
      const cap = player.tgt_pg == null ? desired * 1.15 : +player.tgt_pg * 1.35;
      player._weight = Math.min(Math.max(0, desired), Math.max(0, cap));
    });
  }

  function poissonSf(lam, threshold) {
    if (threshold <= 0) return 1;
    let term = Math.exp(-lam);
    let total = term;
    for (let index = 1; index < threshold; index++) {
      term *= lam / index;
      total += term;
    }
    return Math.max(0, Math.min(1, 1 - total));
  }

  function lamFor(threshold, probability) {
    let lo = 0.02, hi = 16;
    for (let step = 0; step < 28; step++) {
      const mid = (lo + hi) / 2;
      if (poissonSf(mid, threshold) > probability) hi = mid;
      else lo = mid;
    }
    return (lo + hi) / 2;
  }

  function propMean(season, line, absBand, pctBand) {
    if (season == null && line == null) return null;
    let value = season != null && line != null ? 0.45 * +season + 0.55 * +line : line != null ? +line : +season;
    if (line != null && +line > 0) {
      if (absBand != null) value = Math.min(Math.max(value, +line - absBand), +line + absBand);
      else if (pctBand != null) value = Math.min(Math.max(value, +line * (1 - pctBand)), +line * (1 + pctBand));
    }
    return Math.max(0, value);
  }

  function spreadDraw(rng, mean, cv) {
    if (mean <= 0) return 0;
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    return Math.max(0, mean + z * mean * cv);
  }

  function pricedOffers(offers) {
    return (offers || []).filter(function (offer) {
      return offer && offer.line != null && offer.over != null;
    }).map(function (offer) { return { line: +offer.line, over: +offer.over }; });
  }

  function phi(z) {
    const sign = z < 0 ? -1 : 1;
    const a = Math.abs(z);
    const t = 1 / (1 + 0.3275911 * a);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
    return 0.5 * (1 + sign * y);
  }

  function normsinv(p) {
    p = Math.min(Math.max(+p, 1e-6), 1 - 1e-6);
    const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239];
    const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
    const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
    const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
    if (p < 0.02425) {
      const q = Math.sqrt(-2 * Math.log(p));
      return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    if (p > 0.97575) {
      const q = Math.sqrt(-2 * Math.log(1 - p));
      return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    }
    const q = p - 0.5;
    const r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  function yardMean(season, line, price, cv) {
    cv = cv || 0.42;
    const american = +price;
    const marketP = american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
    const modelP = season != null && +season > 0 ? 1 - phi((+line - +season) / (cv * +season)) : marketP;
    let blended = 0.45 * modelP + 0.55 * marketP;
    blended = Math.min(Math.max(blended, marketP - 0.03), marketP + 0.03);
    blended = Math.min(Math.max(blended, 0.04), 0.96);
    const z = normsinv(1 - blended);
    const denom = 1 + z * cv;
    if (Math.abs(denom) < 0.08) return +line;
    return Math.max(0, +line / denom);
  }

  function tdLambda(rate, line, price) {
    const threshold = Math.floor(+line) + 1;
    const american = +price;
    const marketP = american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
    const modelP = poissonSf(+rate, threshold);
    let blended = 0.45 * modelP + 0.55 * marketP;
    blended = Math.min(Math.max(blended, marketP - 0.03), marketP + 0.03);
    return lamFor(threshold, Math.min(Math.max(blended, 0.02), 0.95));
  }

  function fitSkill(skill, bookKey, calKey, target, total) {
    if (target == null || !(+target > 0 && total > 0)) return;
    const flexible = skill.filter(function (player) { return player[bookKey] == null && player[calKey]; });
    const flex = flexible.reduce(function (sum, player) { return sum + +player[calKey]; }, 0);
    const pinned = total - flex;
    if (flex <= 0) return;
    // Unpriced players absorb only a modest share of the gap (mirrors Python FIT_SCALE_MIN/MAX).
    const scale = Math.min(1.3, Math.max(0.6, (+target - pinned) / flex));
    flexible.forEach(function (player) { player[calKey] = +player[calKey] * scale; });
  }

  function setTouchdowns(players, implied) {
    const scale = clamp(+implied / 22.5, 0.72, 1.35);
    const live = [];
    players.forEach(function (player) {
      if (player.status === "out") {
        player._lam_rtd = 0;
        player._lam_ctd = 0;
        return;
      }
      let carries = +player._gadget || 0;
      if (carries <= 0 && player.pos === "QB") carries = +player.qb_rush_pg || 0;
      let recs = player._cal_rec == null ? (+player.rec_g || 0) : +player._cal_rec;
      if (player.pos === "QB") recs = 0;
      const rushPer = player.rush_td_per == null ? (+player.rtd || 0) : +player.rush_td_per;
      const recPer = player.rec_td_per == null ? (+player.ptd || 0) : +player.rec_td_per;
      player._lam_rtd = Math.max(0, carries * rushPer * scale);
      player._lam_ctd = Math.max(0, recs * recPer * scale);
      live.push(player);
    });
    const total = live.reduce(function (sum, player) { return sum + player._lam_rtd + player._lam_ctd; }, 0);
    const target = Math.max(0.8, +implied / 7);
    if (total > 0) {
      const factor = clamp(target / total, 0.45, 1.7);
      live.forEach(function (player) {
        player._lam_rtd *= factor;
        player._lam_ctd *= factor;
      });
    }
    live.forEach(anchorAnytime);
  }

  function anchorAnytime(player) {
    const rush = +player._lam_rtd || 0;
    const rec = +player._lam_ctd || 0;
    const have = rush + rec;
    const model = have > 0 ? 1 - Math.exp(-have) : 0;
    let market = null;
    if (player.any_yes != null) {
      const american = +player.any_yes;
      market = american > 0 ? 100 / (american + 100) : Math.abs(american) / (Math.abs(american) + 100);
    } else if (player.bookTd != null) market = +player.bookTd;
    if (market == null) return;
    let blended = 0.45 * model + 0.55 * market;
    blended = Math.min(Math.max(blended, market - 0.03), market + 0.03);
    if (player.any_yes != null && +player.any_yes >= 150) blended = Math.min(blended, market);
    blended = Math.min(Math.max(blended, 0.005), 0.85);
    const want = -Math.log(Math.max(1e-6, 1 - blended));
    if (have <= 0) {
      if (player.pos === "QB") { player._lam_rtd = want; player._lam_ctd = 0; }
      else if (player.pos === "RB") { player._lam_rtd = want * 0.72; player._lam_ctd = want * 0.28; }
      else { player._lam_rtd = want * 0.08; player._lam_ctd = want * 0.92; }
      return;
    }
    const factor = want / have;
    player._lam_rtd = rush * factor;
    player._lam_ctd = rec * factor;
  }

  
  function starterVolume(qb, att) {
    if (!qb) return false;
    if (+(qb.dropbacks || 0) < 80) return false;
    if (att != null && +att < 15) return false;
    return true;
  }

  function flagVolume(player, kind, value, bound, detail) {
    if (typeof console !== "undefined" && console.warn) {
      console.warn("volume clamp:", player && player.name, kind, detail);
    }
  }

  function clampCalibratedVolume(players, qb) {
    if (qb) {
      let att = qb._cal_att;
      let comp = qb._cal_comp;
      let pyd = qb._cal_pyd;
      if (att && att > 0 && comp != null) {
        const rate = +comp / +att;
        if (rate < 0.50) {
          flagVolume(qb, "comp_pct", rate, 0.50, comp.toFixed(1) + "/" + att.toFixed(1) + " below 50%");
          qb._cal_comp = +att * 0.50;
          comp = qb._cal_comp;
        } else if (rate > 0.75) {
          flagVolume(qb, "comp_pct", rate, 0.75, comp.toFixed(1) + "/" + att.toFixed(1) + " above 75%");
          qb._cal_comp = +att * 0.75;
          comp = qb._cal_comp;
        }
      }
      if (comp && comp > 0 && pyd != null) {
        const ypc = +pyd / +comp;
        if (ypc < 8) {
          flagVolume(qb, "yards_per_comp", ypc, 8, pyd.toFixed(1) + "/" + comp.toFixed(1) + " below 8");
          qb._cal_pyd = +comp * 8;
        } else if (ypc > 14) {
          flagVolume(qb, "yards_per_comp", ypc, 14, pyd.toFixed(1) + "/" + comp.toFixed(1) + " above 14");
          qb._cal_pyd = +comp * 14;
        }
      }
    }
    (players || []).forEach(function (player) {
      if (["WR", "TE"].indexOf(player.pos) < 0) return;
      const rec = player._cal_rec;
      const yds = player._cal_yds;
      if (rec && rec > 0 && yds != null) {
        const ypr = +yds / +rec;
        if (ypr < 8) {
          flagVolume(player, "yards_per_rec", ypr, 8, yds.toFixed(1) + "/" + rec.toFixed(1) + " below 8");
          player._cal_yds = +rec * 8;
        } else if (ypr > 14) {
          flagVolume(player, "yards_per_rec", ypr, 14, yds.toFixed(1) + "/" + rec.toFixed(1) + " above 14");
          player._cal_yds = +rec * 14;
        }
      }
    });
  }

  function dvpMult(player, key) {
    const value = +(player && player[key]);
    return Number.isFinite(value) && value > 0 ? Math.min(1.15, Math.max(0.85, value)) : 1;
  }

  function setMarketMeans(players, qb) {
    const skill = players.filter(function (player) { return (player.pos === "WR" || player.pos === "TE" || player.pos === "RB") && player.status !== "out"; });
    skill.forEach(function (player) {
      const base = player._base_tgt == null ? +player._weight || 0 : +player._base_tgt;
      let seasonRec = player.rec_g == null ? null : +player.rec_g;
      if (seasonRec == null) seasonRec = base * Math.max(0.45, +(player.catch || 0.64)) * 0.85;
      let seasonYds = player.rec_pg == null ? null : +player.rec_pg;
      if (seasonYds == null && seasonRec != null) seasonYds = seasonRec * +(player.ypr || player._ypr || 10);
      if (seasonRec != null) seasonRec *= dvpMult(player, "dvp_rec");
      if (seasonYds != null) seasonYds *= dvpMult(player, "dvp_yds");
      const haircut = practiceMult(player);
      if (seasonRec != null) seasonRec *= haircut;
      if (seasonYds != null) seasonYds *= haircut;
      const recLams = [];
      if (seasonRec != null) (player.rec_offers || []).forEach(function (offer) { recLams.push(recLambda(+seasonRec, offer.line, offer.over)); });
      const yardMeans = [];
      (player.yard_offers || []).forEach(function (offer) { yardMeans.push(yardCenter(seasonYds, offer.line, offer.over, REC_CV)); });
      player._cal_rec = recLams.length ? recLams.reduce(function (sum, value) { return sum + value; }, 0) / recLams.length : propMean(seasonRec, player.bookRecs, 0, null);
      player._cal_yds = yardMeans.length ? yardMeans.reduce(function (sum, value) { return sum + value; }, 0) / yardMeans.length : propMean(seasonYds, player.bookRec, null, 0.05);
      let tdRate = player.td_pg == null ? (+player.rtd || 0) + (+player.ptd || 0) : +player.td_pg;
      const modelP = 1 - Math.exp(-Math.max(tdRate || 0, 0));
      if (player.bookTd != null) {
        const blended = 0.45 * modelP + 0.55 * +player.bookTd;
        player._cal_any = Math.min(Math.max(blended, +player.bookTd * 0.90), +player.bookTd * 1.10);
      } else player._cal_any = modelP;
    });
    if (!qb) return;
    let att = qb.att_pg == null ? null : +qb.att_pg;
    let comp = qb.comp_pg == null ? null : +qb.comp_pg;
    let pyd = qb.pass_yds_pg == null ? null : +qb.pass_yds_pg;
    let ptd = qb.pass_td_pg == null ? null : +qb.pass_td_pg;
    if (!starterVolume(qb, att)) att = comp = pyd = ptd = null;
    if (pyd == null && att != null) pyd = att * +(qb.ypa || 6.5);
    if (pyd != null) pyd *= dvpMult(qb, "dvp_pass");
    const qbCut = practiceMult(qb);
    if (qbCut < 1) {
      if (att != null) att *= qbCut;
      if (comp != null) comp *= qbCut;
      if (pyd != null) pyd *= qbCut;
    }
    qb._cal_att = propMean(att, null, null, null);
    qb._cal_comp = propMean(comp, qb.bookComp, 0.40, null);
    qb._cal_pyd = propMean(pyd, qb.bookPass, null, 0.05);
    const tdLams = [];
    if (ptd != null) (qb.td_offers || []).forEach(function (offer) { tdLams.push(tdLambda(+ptd, offer.line, offer.over)); });
    if (tdLams.length) qb._cal_ptd = tdLams.reduce(function (sum, value) { return sum + value; }, 0) / tdLams.length;
    else if (qb.bookPassTd != null && qb.td_over != null && ptd != null) qb._cal_ptd = tdLambda(+ptd, qb.bookPassTd, qb.td_over);
    else {
      const center = qb.bookPassTd != null && +qb.bookPassTd <= 0.5 ? 0.85 : qb.bookPassTd;
      qb._cal_ptd = propMean(ptd, center, 0.25, null);
    }
    if (qb._cal_att != null) qb._cal_att = Math.min(38, Math.max(24, +qb._cal_att));
    const skillRec = skill.reduce(function (sum, player) { return sum + (+player._cal_rec || 0); }, 0);
    const skillYds = skill.reduce(function (sum, player) { return sum + (+player._cal_yds || 0); }, 0);
    if (qb._cal_comp == null) qb._cal_comp = skillRec || null;
    if (qb._cal_pyd == null) qb._cal_pyd = skillYds || null;
    if (qb.att_pg == null || !starterVolume(qb, qb.att_pg)) qb._cal_att = null;
    clampCalibratedVolume(skill, qb);
    fitSkill(skill, "bookRecs", "_cal_rec", qb._cal_comp, skillRec);
    fitSkill(skill, "bookRec", "_cal_yds", qb._cal_pyd, skillYds);
    clampCalibratedVolume(skill, qb);
  }

  function apportion(total, weights) {
    if (total <= 0 || !weights.length) return weights.map(function () { return 0; });
    const pool = weights.reduce(function (sum, value) { return sum + value; }, 0) || 1;
    const exact = weights.map(function (value) { return total * value / pool; });
    const base = exact.map(function (value) { return Math.floor(value); });
    let left = total - base.reduce(function (sum, value) { return sum + value; }, 0);
    const order = exact.map(function (value, index) { return index; }).sort(function (a, b) {
      const frac = (exact[b] - base[b]) - (exact[a] - base[a]);
      return frac || a - b;
    });
    for (let i = 0; i < left; i++) base[order[i]] += 1;
    return base;
  }


  function expectedFrac(pos, favoredBy, total) {
    const p = injuryP(pos);
    const eInj = 1 - 0.5 * p;
    let pBlow = 0.08;
    if (favoredBy != null && +favoredBy >= 6) pBlow += 0.07;
    if (total != null && +total >= 51) pBlow += 0.03;
    return Math.max(0.80, eInj * (1 - pBlow * 0.22));
  }

  function injuryP(pos) {
    if (pos === "QB") return 0.04;
    if (pos === "RB") return 0.045;
    if (pos === "WR" || pos === "TE") return 0.03;
    return 0;
  }

  function blowoutKeep(margin, favoredBy, total, rng) {
    if (margin == null || +margin < 21) return 1;
    let extra = Math.min(1, (+margin - 21) / 14);
    let prob = 0.25 + 0.55 * extra;
    if (favoredBy != null && +favoredBy >= 6) prob += 0.15;
    if (total != null && +total >= 51) prob += 0.05;
    if (rng() < Math.min(0.92, prob)) return 0.72 + 0.12 * rng();
    return 1;
  }

  function drawFrac(player, rng, margin, favoredBy, total) {
    let frac = Math.max(0.88, Math.min(1, 1 + 0.05 * gauss(rng)));
    if (rng() < injuryP(player.pos)) frac *= rng();
    frac *= blowoutKeep(margin, favoredBy, total, rng);
    return Math.max(0, Math.min(1, frac));
  }

  function gauss(rng) {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  function backupsFor(players, starter) {
    return players.filter(function (player) {
      return player !== starter && player.pos === starter.pos && player.status !== "out" && player.status !== "ir" && player.status !== "IR";
    }).sort(function (a, b) { return (+a.depth || 8) - (+b.depth || 8); });
  }

  function ensureBox(player, key, length) {
    player.box = player.box || {};
    if (!player.box[key] || player.box[key].length < length) {
      const next = new Array(length).fill(0);
      if (player.box[key]) for (let i = 0; i < player.box[key].length; i++) next[i] = player.box[key][i];
      player.box[key] = next;
    }
    return player.box[key];
  }

  function scaleTrial(players, fracs, trial, expected) {
    expected = expected || new Map();
    players.forEach(function (player) {
      const e = +(expected.get(player) || 1);
      const keys = player.pos === "QB" ? ["att","comp","pyd","ptd","int","rtd"] : ["rec","cyd","tgt","ctd","car","ryd","rtd"];
      if (e < 0.999 && player.box) {
        keys.forEach(function (key) { if (player.box[key]) player.box[key][trial] = +player.box[key][trial] / e; });
      }
      const frac = fracs.get(player);
      if (frac == null || frac >= 0.995) return;
      const lost = 1 - frac;
      const dests = backupsFor(players, player);
      const box = player.box || {};
      if (player.pos === "QB") {
        const att = +((box.att && box.att[trial]) || 0);
        const lostAtt = att * lost;
        ["att", "comp", "pyd", "ptd", "int", "rtd"].forEach(function (key) {
          if (box[key]) box[key][trial] = +box[key][trial] * frac;
        });
        if (dests.length && lostAtt > 0) {
          const backup = dests[0];
          const n = (box.att && box.att.length) || (trial + 1);
          const comp = Math.min(Math.max(+(backup.comp || 0.60), 0.50), 0.70);
          const ypa = Math.min(+(backup.ypa || 6.4), 6.4);
          ensureBox(backup, "att", n)[trial] += lostAtt;
          ensureBox(backup, "comp", n)[trial] += lostAtt * comp;
          ensureBox(backup, "pyd", n)[trial] += lostAtt * ypa;
          ensureBox(backup, "ptd", n)[trial] += lostAtt * +(backup.ptd || 0.035);
        }
        return;
      }
      const shares = dests.length > 1 ? [0.7, 0.3] : dests.length ? [1] : [];
      ["rec", "cyd", "tgt", "ctd", "car", "ryd", "rtd"].forEach(function (key) {
        if (!box[key]) return;
        const amount = +box[key][trial] * lost;
        box[key][trial] = +box[key][trial] * frac;
        dests.slice(0, 2).forEach(function (dest, index) {
          ensureBox(dest, key, box[key].length)[trial] += amount * shares[index];
        });
      });
    });
  }

  function redrawMarkets(side, rng, trials, teamPass, ownScore, oppScore, favoredBy, total, snapVolume) {
    const players = side.players || [];
    const qb = side.qb;
    const skill = players.filter(function (player) { return player._cal_rec != null || player._cal_yds != null; });
    if (!qb && !skill.length) return;
    const ownPass = qb && qb.bookPass != null;
    const backs = players.filter(function (player) { return player.pos === "RB" && +player._gadget > 0; });
    for (let trial = 0; trial < trials; trial++) {
      backs.forEach(function (player) {
        player.box.car[trial] = nbDraw(rng, +player._gadget, CAR_R);
        player.box.ryd[trial] = skewYards(rng, +player._gadget * +(player._ypc || 4.4), RUSH_CV);
      });
      let caught = 0;
      let gained = 0;
      skill.forEach(function (player) {
        const recMean = +player._cal_rec || 0;
        const count = nbDraw(rng, recMean, REC_R);
        const yardMean = +player._cal_yds || 0;
        const yards = skewYards(rng, yardMean, REC_CV);
        player.box.rec[trial] = count;
        player.box.cyd[trial] = yards;
        player.box.tgt[trial] = poisson(rng, Math.max(recMean / 0.62, count));
        player.box.rtd[trial] = poisson(rng, +player._lam_rtd || 0);
        player.box.ctd[trial] = poisson(rng, +player._lam_ctd || 0);
        caught += count;
        gained += yards;
      });
      if (!qb) continue;
      qb.box.rtd[trial] = poisson(rng, +qb._lam_rtd || 0);
      if (ownPass) {
        qb.box.comp[trial] = nbDraw(rng, +(qb._cal_comp || caught), COMP_R);
        qb.box.pyd[trial] = skewYards(rng, +(qb._cal_pyd || gained), PASS_CV, 700);
      } else {
        qb.box.comp[trial] = caught;
        qb.box.pyd[trial] = gained;
      }
      if (qb._cal_att == null) qb.box.att[trial] = Math.max(qb.box.att[trial], qb.box.comp[trial]);
      else qb.box.att[trial] = Math.max(qb.box.comp[trial], nbDraw(rng, +qb._cal_att, ATT_R));
      qb.box.ptd[trial] = qb._cal_ptd == null ? 0 : poisson(rng, +qb._cal_ptd);
      if (snapVolume !== false) {
        const margin = (ownScore && oppScore) ? (+ownScore[trial] - +oppScore[trial]) : null;
        const fracs = new Map();
        const expected = new Map();
        players.forEach(function (player) {
          fracs.set(player, drawFrac(player, rng, margin, favoredBy, total));
          expected.set(player, expectedFrac(player.pos, favoredBy, total));
        });
        scaleTrial(players, fracs, trial, expected);
      }
      teamPass[trial] = qb.box.pyd[trial];
    }
  }

  function slotHeavy(player) {
    if (player.role === "Slot") return true;
    return player.slot_rate != null && +player.slot_rate >= 0.28 && (player.adot == null || +player.adot < 9);
  }

  function coverageMults(opp, leagueCov) {
    const corners = (opp.cb || []).filter(function (player) { return !isOut(player) && player.cov != null; })
      .sort(function (a, b) { return (a.depth == null ? 99 : a.depth) - (b.depth == null ? 99 : b.depth); });
    function mult(grade) { return grade == null ? 1 : clamp(1 - (grade - leagueCov) / 400, 0.93, 1.07); }
    if (!corners.length) return { outside: 1, nickel: 1 };
    const outside = corners.slice(0, 2).reduce(function (sum, player) { return sum + +player.cov; }, 0) / Math.min(2, corners.length);
    const nickel = corners.length > 2 ? +corners[2].cov : outside;
    return { outside: mult(outside), nickel: mult(nickel) };
  }

  function sampleShrink(sample, prior) {
    const size = +sample || 0;
    return size > 0 ? size / (size + (prior || 80)) : 0;
  }

  function rushCut(opp) {
    const front = (opp.dl || []).slice().sort(function (a, b) { return (a.depth == null ? 99 : a.depth) - (b.depth == null ? 99 : b.depth); });
    const gone = front.slice(0, 4).filter(isOut).length;
    return Math.min(0.18, 0.06 * gone);
  }

  function safetyBump(opp) {
    const safeties = (opp.lb || []).concat(opp.s || []).filter(function (player) {
      const pos = String(player.pos || "").toUpperCase();
      return pos === "S" || pos === "SS" || pos === "FS";
    }).sort(function (a, b) { return (a.depth == null ? 99 : a.depth) - (b.depth == null ? 99 : b.depth); });
    const gone = safeties.slice(0, 2).filter(isOut).length;
    return Math.min(1.04, 1 + 0.015 * gone);
  }

  function qbCoverage(qb, opp, league) {
    if (!qb) return 0;
    let compAdj = 0, ypaAdj = 0, sackAdj = 0, intAdj = 0;
    const cut = rushCut(opp);
    const blitzRate = opp.blitz_rate == null ? null : +opp.blitz_rate * (1 - cut);
    if (blitzRate != null && league.blitz != null && qb.qb_blitz_comp != null && qb.qb_base_comp != null) {
      const extra = clamp(blitzRate - +league.blitz, -0.1, 0.1);
      const scale = sampleShrink(qb.qb_blitz_n, 80) * (extra ? extra / 0.1 : 0) * (league.w_blitz == null ? 1 : +league.w_blitz);
      compAdj += scale * (+qb.qb_blitz_comp - +qb.qb_base_comp);
      if (qb.qb_blitz_ypa != null && qb.qb_base_ypa != null) ypaAdj += scale * (+qb.qb_blitz_ypa - +qb.qb_base_ypa);
      if (qb.qb_blitz_sack != null && qb.qb_base_sack != null) sackAdj += scale * (+qb.qb_blitz_sack - +qb.qb_base_sack);
      if (qb.qb_blitz_int != null && qb.qb_base_int != null) intAdj += scale * (+qb.qb_blitz_int - +qb.qb_base_int);
    }
    const pressureRate = opp.pressure_rate == null ? null : +opp.pressure_rate * (1 - cut);
    qb._scr_add = 0;
    if (pressureRate != null && league.pressure != null) {
      // Pressure matchup: extra pressure share x this QB's pressured-minus-clean rates.
      let extra = clamp(pressureRate - +league.pressure, -0.1, 0.1) * sampleShrink(opp.pressure_n, 150);
      extra *= league.w_press == null ? 1 : +league.w_press;
      const lp = league.press || {}, lc = league.clean || {};
      const qbWeight = league.w_press_qb == null ? 1 : +league.w_press_qb;
      const partWeight = league.w_press_parts || {};
      const gap = function (stat) {
        const base = lp[stat] == null || lc[stat] == null ? null : +lp[stat] - +lc[stat];
        const hi = qb["qb_press_" + stat], lo = qb["qb_clean_" + stat];
        const own = hi == null || lo == null ? null : +hi - +lo;
        let value = own == null ? base : base == null ? own : qbWeight * own + (1 - qbWeight) * base;
        return value == null ? null : value * (partWeight[stat] == null ? 1 : +partWeight[stat]);
      };
      if (extra) {
        const comp = gap("comp"), ypa = gap("ypa"), sk = gap("sack"), scr = gap("scr");
        if (comp != null) compAdj += clamp(extra * comp, -0.02, 0.02);
        if (ypa != null) ypaAdj += clamp(extra * ypa, -0.3, 0.3);
        if (sk != null) sackAdj += clamp(extra * sk, -0.012, 0.012);
        if (scr != null) qb._scr_add = clamp(extra * scr, -0.02, 0.02);
      }
    }
    if (opp.man_rate != null && league.man != null && qb.qb_man_ypa != null && qb.qb_zone_ypa != null) {
      const extra = clamp(+opp.man_rate - +league.man, -0.15, 0.15);
      ypaAdj += sampleShrink(qb.qb_man_n, 80) * (extra ? extra / 0.15 : 0) * (+qb.qb_man_ypa - +qb.qb_zone_ypa) * 0.5;
    }
    qb._comp = clamp(+(qb._comp || 0.62) + clamp(compAdj, -0.025, 0.025), 0.54, 0.7);
    qb._ypa_abs = clamp(+(qb._ypa_abs || 6.4) + clamp(ypaAdj, -0.35, 0.35), 5.3, 7.7);
    qb._int = clamp(+(qb._int || 0.022) + clamp(intAdj, -0.004, 0.004), 0.012, 0.045);
    return clamp(sackAdj, -0.015, 0.015);
  }

  function tiltManZone(players, opp, league) {
    if (opp.man_rate == null || league.man == null) return;
    const extra = clamp(+opp.man_rate - +league.man, -0.15, 0.15);
    if (!extra) return;
    players.forEach(function (player) {
      if ((player.pos !== "WR" && player.pos !== "TE") || player.status === "out") return;
      if (player.man_ypt == null || player.zone_ypt == null) return;
      const shrink = sampleShrink(player.split_n, 40);
      const zone = Math.max(+player.zone_ypt, 6);
      const edge = (+player.man_ypt - +player.zone_ypt) / zone;
      const tilt = shrink * (extra / 0.15) * edge;
      player._weight = (+player._weight || 0) * clamp(1 + 0.22 * tilt, 0.94, 1.06);
      player._ypr = clamp(+(player._ypr || 11) * clamp(1 + 0.18 * tilt, 0.96, 1.04), 8, 14.5);
    });
  }

  function mixRole(player, expected, market) {
    return 0.42 * expected + 0.58 * market;
  }

  function blendCarries(players, rushTarget) {
    const backs = players.filter(function (player) { return player.pos === "RB" && player.status !== "out"; });
    const qbWeight = players.reduce(function (sum, player) {
      return sum + (player.pos === "QB" && player.status !== "out" ? +player._carry : 0);
    }, 0);
    const total = backs.reduce(function (sum, player) { return sum + +player._carry; }, 0) + qbWeight;
    if (total <= 0) return;
    const scales = [];
    backs.forEach(function (player) {
      if (player.bookRush == null) return;
      const expected = (+player._carry / total) * rushTarget * (+player._ypc || 4.4);
      if (expected < 1) return;
      scales.push([player, mixRole(player, expected, +player.bookRush) / expected]);
    });
    scales.forEach(function (pair) { pair[0]._carry = +pair[0]._carry * pair[1]; });
  }

  function baseTargets(player) {
    const season = player.tgt_pg == null ? null : +player.tgt_pg;
    const book = player.bookRecs == null ? null : +player.bookRecs;
    const catchRate = Math.max(+(player.catch || 0.7), 0.45);
    const implied = book == null ? null : book / catchRate;
    if (season != null && implied != null) return Math.max(0, 0.45 * season + 0.55 * implied);
    if (season != null) return Math.max(0, season);
    if (implied != null) return Math.max(0, implied);
    return 0;
  }

  function capTargets(player, value) {
    const season = player.tgt_pg == null ? null : +player.tgt_pg;
    if (player.pos === "RB") {
      if (season != null && season > 4) return Math.min(value, season * 1.25);
      return Math.min(value, 4);
    }
    if (season != null) return Math.min(value, season * 1.4);
    return Math.max(0, value);
  }

  function setRbCatchLength(player, targets) {
    if (targets <= 0.2) return;
    const season = player.rec_pg == null ? null : +player.rec_pg;
    const book = player.bookRec == null ? null : +player.bookRec;
    let yards = null;
    if (season != null && book != null) yards = 0.45 * season + 0.55 * book;
    else if (season != null) yards = season;
    else if (book != null) yards = book;
    if (yards == null) return;
    const catchRate = Math.max(+(player.catch || 0.7), 0.45);
    const receptions = Math.max(targets * catchRate * 0.85, 0.35);
    player._ypr = Math.max(2.5, Math.min(14.5, yards / receptions));
  }

  function anchorTargets(players, passPlays, untargetedRate) {
    const skill = players.filter(function (player) { return player.pos === "RB" || player.pos === "WR" || player.pos === "TE"; });
    const bases = skill.map(baseTargets);
    const active = [];
    let vacated = 0;
    let activeSum = 0;
    skill.forEach(function (player, index) {
      if (player.status === "out") vacated += bases[index];
      else { active.push([player, bases[index]]); activeSum += bases[index]; }
    });
    active.forEach(function (pair) {
      const extra = activeSum > 0 ? vacated * (pair[1] / activeSum) : 0;
      pair[0]._weight = capTargets(pair[0], pair[1] + extra);
      if (pair[0].pos === "RB") setRbCatchLength(pair[0], pair[0]._weight);
    });
    skill.forEach(function (player) { if (player.status === "out") player._weight = 0; });
    const allocated = active.reduce(function (sum, pair) { return sum + (+pair[0]._weight || 0); }, 0);
    let rate = untargetedRate == null ? 0.109 : clamp(+untargetedRate, 0, 0.4);
    if (passPlays <= 0) return rate;
    const budget = passPlays * (1 - rate);
    if (allocated > budget && budget > 0) {
      const scale = budget / allocated;
      active.forEach(function (pair) { pair[0]._weight = (+pair[0]._weight || 0) * scale; });
      return rate;
    }
    return Math.max(rate, Math.min(0.9, 1 - allocated / passPlays));
  }

  function expectedRec(player, share, passPlays, qb, sack) {
    if (!qb || share <= 0) return 0;
    const comp = +(qb._comp || 0.64);
    const ypa = +(qb._ypa_abs || 7);
    const opened = +(player._open || 1);
    const completeP = clamp(comp * (0.82 + 0.18 * opened), 0.52, 0.71);
    const rel = clamp(+(player._ypr || 11) / 11, 0.88, 1.18);
    const perCatch = (ypa / Math.max(comp, 0.55)) * rel;
    return share * passPlays * (1 - sack) * completeP * perCatch;
  }

  function desiredRec(player, expected) {
    const season = player.rec_pg == null ? null : +player.rec_pg;
    const book = player.bookRec == null ? null : +player.bookRec;
    if (player.pos === "TE") {
      if (season != null && book != null) return 0.45 * season + 0.55 * book;
      if (season != null) return season;
      if (book != null) return 0.42 * expected + 0.58 * book;
      return null;
    }
    if (season != null && book != null) {
      const blend = 0.45 * season + 0.55 * book;
      if (expected <= blend) return null;
      return 0.82 * blend;
    }
    if (season != null && expected > 1.25 * season) return 0.82 * season;
    return null;
  }

  function blendTargets(players, passPlays, qb, sack) {
    const pool = players.filter(function (player) { return player.pos !== "QB" && player._weight > 0; });
    if (!pool.length || !qb) return;
    for (let pass = 0; pass < 5; pass++) {
      let total = pool.reduce(function (sum, player) { return sum + +player._weight; }, 0) || 1;
      pool.forEach(function (player) {
        if (player.pos !== "WR" && player.pos !== "TE") return;
        const share = player._weight / total;
        const expected = expectedRec(player, share, passPlays, qb, sack);
        const desired = desiredRec(player, expected);
        if (desired == null || expected < 1) return;
        const newShare = clamp(share * desired / expected, 0.02, 0.42);
        if (Math.abs(newShare - share) < 0.004) return;
        const others = total - player._weight;
        player._weight = others * newShare / (1 - newShare);
        total = others + player._weight;
      });
    }
  }

  function shrinkTouchdowns(players, rng) {
    players.forEach(function (player) {
      if (player.bookTd == null) return;
      const rtd = player.box.rtd;
      const ctd = player.box.ctd;
      const scored = [];
      for (let i = 0; i < rtd.length; i++) if (rtd[i] + ctd[i] >= 1) scored.push(i);
      const model = rtd.length ? scored.length / rtd.length : 0;
      const target = clamp(0.42 * model + 0.58 * +player.bookTd, 0, 0.85);
      if (model <= 0 || Math.abs(target - model) < 0.015) return;
      if (target < model) {
        const keep = target / model;
        scored.forEach(function (index) {
          if (rng() > keep) {
            if (rtd[index] >= ctd[index]) rtd[index] = 0;
            else ctd[index] = 0;
          }
        });
        return;
      }
      const quiet = [];
      for (let i = 0; i < rtd.length; i++) if (rtd[i] + ctd[i] < 1) quiet.push(i);
      if (!quiet.length) return;
      const rate = Math.min(1, (target - model) / (quiet.length / rtd.length));
      quiet.forEach(function (index) {
        if (rng() < rate) {
          if (player.pos === "RB") rtd[index] = 1;
          else ctd[index] = 1;
        }
      });
    });
  }

  function concentrate(players) {
    const windows = { WR: 4, TE: 2, RB: 3, QB: 2 };
    Object.keys(windows).forEach(function (pos) {
      const keep = windows[pos];
      const group = players.filter(function (player) { return player.pos === pos; }).sort(function (a, b) { return a.depth - b.depth; });
      const active = group.filter(function (player) { return player.status !== "out"; });
      active.slice(keep).forEach(function (player) {
        player.route_pct = 0;
        player.tprr = 0;
        player.target = 0;
        if (pos === "RB" || pos === "WR" || pos === "TE") player.carry = 0;
      });
    });
  }

  function addGadgetCarries(players, rng, trials) {
    players.forEach(function (player) {
      const rate = +player._gadget || 0;
      if (rate <= 0) return;
      const ypc = +(player._ypc || player.ypc || 4.2);
      for (let trial = 0; trial < trials; trial++) {
        const count = poisson(rng, rate);
        for (let draw = 0; draw < count; draw++) {
          player.box.car[trial] += 1;
          player.box.ryd[trial] += lognorm(rng, Math.max(2.5, ypc));
        }
      }
    });
  }

  function shapeCarries(players) {
    parkSkillCarries(players);
    const backs = players.filter(function (player) { return player.pos === "RB" && player.status !== "out"; })
      .sort(function (a, b) { return a.depth - b.depth; });
    if (!backs.length) return;
    if (backs.every(function (player) { return player._carry <= 0; })) backs[0]._carry = 0.68;
    players.forEach(function (player) { if (player.pos === "QB") player._carry = 0; });
    capRushShare(players);
    applyQbRush(players);
  }

  function applyQbRush(players) {
    players.forEach(function (player) {
      if (player.pos !== "QB") return;
      player._carry = 0;
      if (!player._qbStarter || player.qb_rush_pg == null) {
        player._gadget = 0;
        return;
      }
      let carries = Math.max(0, +player.qb_rush_pg);
      let ypc = player.qb_rush_ypc == null ? 4.3 : +player.qb_rush_ypc;
      if (player.bookRush != null && ypc > 0) {
        let yards = carries * ypc;
        carries = 0.45 * carries + 0.55 * (+player.bookRush / ypc);
        yards = 0.45 * yards + 0.55 * +player.bookRush;
        ypc = carries ? yards / carries : ypc;
      }
      player._gadget = carries;
      player._ypc = ypc;
    });
  }

  function liftAlpha(catchers) {
    let total = catchers.reduce(function (sum, player) { return sum + player._weight; }, 0);
    catchers.forEach(function (player) {
      if (player.pos !== "WR" || player.depth !== 0 || +(player.route_pct || 0) < 0.85 || total <= 0) return;
      const share = player._weight / total;
      const target = Math.min(0.32, Math.max(0.26, share));
      const others = total - player._weight;
      if (others <= 0 || target >= 0.95) return;
      player._weight = target * others / (1 - target);
      total = others + player._weight;
    });
  }

  function mean(values) {
    let sum = 0;
    for (let i = 0; i < values.length; i++) sum += values[i];
    return values.length ? sum / values.length : 0;
  }

  function curve(values) {
    const ordered = Array.from(values).sort(function (a, b) { return a - b; });
    const last = ordered.length - 1;
    const points = new Array(101);
    for (let step = 0; step <= 100; step++) {
      const index = Math.min(last, Math.max(0, Math.round(step / 100 * last)));
      points[step] = Math.round(ordered[index] * 100) / 100;
    }
    return points;
  }

  function simulateMatchup(spec, n, seed) {
    const started = typeof performance !== "undefined" ? performance.now() : Date.now();
    const trials = Math.max(1, n | 0);
    const rng = mulberry32(seed == null ? 1 : seed | 0);
    const env = environment(spec);
    const away = prepareSide(spec.away || {}, spec.home || {}, spec, env, false);
    const home = prepareSide(spec.home || {}, spec.away || {}, spec, env, true);
    const sides = [away, home];
    const score = [new Float64Array(trials), new Float64Array(trials)];
    const teamPass = [new Float64Array(trials), new Float64Array(trials)];
    const teamRush = [new Float64Array(trials), new Float64Array(trials)];
    sides.forEach(function (side) {
      side.players.forEach(function (player) {
        player.box = {
          att: new Float64Array(trials), comp: new Float64Array(trials), pyd: new Float64Array(trials),
          ptd: new Float64Array(trials), int: new Float64Array(trials), car: new Float64Array(trials),
          ryd: new Float64Array(trials), rtd: new Float64Array(trials), tgt: new Float64Array(trials),
          rec: new Float64Array(trials), cyd: new Float64Array(trials), ctd: new Float64Array(trials),
        };
      });
    });
    for (let t = 0; t < trials; t++) {
      const points = [0, 0];
      for (let drive = 0; drive < 22; drive++) {
        const offI = drive % 2;
        const off = sides[offI];
        const margin = points[offI] - points[1 - offI];
        let rate = off.pass_rate + clamp(-margin, -10, 10) * 0.003 - env.run_nudge;
        if (drive >= 16 && margin > 8) rate -= 0.04;
        rate = clamp(rate, 0.48, 0.6);
        const plays = Math.max(4, negbin(rng, off.plays));
        const wetExtra = 0.006 * ((+env.fumble_mult || 1) - 1);
        let lost = false;
        for (let play = 0; play < plays; play++) {
          if (rng() < rate) {
            const qb = off.qb;
            const catchers = off.catchers;
            if (!qb || !catchers.length) continue;
            if (rng() < off.sack) continue;
            qb.box.att[t] += 1;
            if (rng() < (+off.throwaway || 0)) continue;
            const target = pick(rng, catchers, "_weight");
            target.box.tgt[t] += 1;
            const completeP = clamp(qb._comp * (0.82 + 0.18 * target._open), 0.52, 0.71);
            if (rng() < completeP) {
              qb.box.comp[t] += 1;
              target.box.rec[t] += 1;
              const rel = clamp((target._ypr || 11) / 11, target.pos === "RB" ? 0.25 : 0.88, 1.18);
              let yards = lognorm(rng, Math.max(4, qb._ypa_abs / Math.max(qb._comp, 0.55) * rel * 1.07));
            yards = Math.min(yards, Math.max(0, 112 - target.box.cyd[t]));
              qb.box.pyd[t] += yards;
              target.box.cyd[t] += yards;
              teamPass[offI][t] += yards;
              if (wetExtra > 0 && rng() < wetExtra) { lost = true; break; }
            } else if (rng() < clamp(qb._int / Math.max(0.25, 1 - qb._comp), 0.02, 0.12)) {
              qb.box.int[t] += 1;
            }
          } else {
            const rushers = off.rushers;
            if (!rushers.length) continue;
            const rusher = pick(rng, rushers, "_carry");
            if (rusher.box.car[t] >= 22) continue;
            rusher.box.car[t] += 1;
            const yards = lognorm(rng, Math.max(2.5, rusher._ypc));
            rusher.box.ryd[t] += yards;
            teamRush[offI][t] += yards;
            if (wetExtra > 0 && rng() < wetExtra) { lost = true; break; }
          }
        }
        if (lost) continue;
        if (rng() < off.p_td) {
          points[offI] += 7;
          if (rng() < rate && off.qb && off.catchers.length) {
            off.qb.box.ptd[t] += 1;
            pick(rng, off.catchers, "_weight").box.ctd[t] += 1;
          } else if (off.rushers.length) {
            pick(rng, off.rushers, "_carry").box.rtd[t] += 1;
          }
        } else if (rng() < off.p_fg) points[offI] += 3;
      }
      score[0][t] = points[0];
      score[1][t] = points[1];
    }
    addGadgetCarries(away.players, rng, trials);
    addGadgetCarries(home.players, rng, trials);
    shrinkTouchdowns(away.players, rng);
    shrinkTouchdowns(home.players, rng);
    const hs = spec.homeSpread != null ? +spec.homeSpread : (spec.home_spread != null ? +spec.home_spread : null);
    const gameTotal = spec.total != null ? +spec.total : null;
    redrawMarkets(away, rng, trials, teamPass[0], score[0], score[1], hs, gameTotal, spec.snapVolume !== false);
    redrawMarkets(home, rng, trials, teamPass[1], score[1], score[0], hs == null ? null : -hs, gameTotal, spec.snapVolume !== false);
    function pack(side, sideScore, pass, rush) {
      return {
        score: mean(sideScore),
        passYds: mean(pass),
        rushYds: side.players.reduce(function (sum, player) { return sum + mean(player.box.ryd); }, 0),
        players: side.players.map(function (player) {
          const anytime = new Float64Array(trials);
          for (let i = 0; i < trials; i++) anytime[i] = player.box.rtd[i] + player.box.ctd[i] >= 1 ? 1 : 0;
          return {
            name: player.name,
            pos: player.pos,
            depth: player.depth,
            espn_id: player.espn_id || "",
            comp: mean(player.box.comp),
            att: mean(player.box.att),
            passYds: mean(player.box.pyd),
            passTd: mean(player.box.ptd),
            int: mean(player.box.int),
            carries: mean(player.box.car),
            rushYds: mean(player.box.ryd),
            rushTd: mean(player.box.rtd),
            targets: mean(player.box.tgt),
            rec: mean(player.box.rec),
            recYds: mean(player.box.cyd),
            recTd: mean(player.box.ctd),
            anytime: mean(anytime),
            q: {
              pass_yds: curve(player.box.pyd),
              pass_td: curve(player.box.ptd),
              completions: curve(player.box.comp),
              pass_att: curve(player.box.att),
              interceptions: curve(player.box.int),
              rush_yds: curve(player.box.ryd),
              rush_att: curve(player.box.car),
              rush_td: curve(player.box.rtd),
              rec_yds: curve(player.box.cyd),
              rec_td: curve(player.box.ctd),
              receptions: curve(player.box.rec),
              rush_rec_yds: curve(Array.from(player.box.ryd).map(function (value, index) { return value + player.box.cyd[index]; })),
              anytime_td: curve(anytime),
            },
            splits: player.splits,
            role: player.role || null,
            slot_rate: player.slot_rate == null ? null : +player.slot_rate,
            adot: player.adot == null ? null : +player.adot,
          };
        }),
      };
    }
    let wins = 0;
    for (let i = 0; i < trials; i++) if (score[1][i] > score[0][i]) wins += 1;
    const elapsed = (typeof performance !== "undefined" ? performance.now() : Date.now()) - started;
    return {
      n: trials,
      ms: Math.round(elapsed),
      away: pack(away, score[0], teamPass[0], teamRush[0]),
      home: pack(home, score[1], teamPass[1], teamRush[1]),
      homeWin: wins / trials,
      total: mean(Array.from(score[0]).map(function (value, index) { return value + score[1][index]; })),
    };
  }

  return { simulateMatchup: simulateMatchup, mulberry32: mulberry32 };
});
