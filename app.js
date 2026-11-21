const STATS = ["pass_yds","pass_td","completions","pass_att","interceptions","rush_yds","rush_att","rush_td","rec_yds","receptions","rec_td","rush_rec_yds","anytime_td"];
const MARKET = {
  anytime_td: "ANYTIME TD", pass_yds: "PASS YDS", pass_td: "PASS TDs", completions: "COMPLETIONS",
  pass_att: "PASS ATT", interceptions: "INTs", rush_yds: "RUSH YDS", rush_att: "RUSH ATT",
  rush_td: "RUSH TDs", rec_yds: "REC YDS", receptions: "RECEPTIONS", rec_td: "REC TDs", rush_rec_yds: "RUSH+REC YDS"
};
const TEAM_STYLE = {
  ARI: ["#97233F", "#000000"], ATL: ["#A71930", "#000000"], BAL: ["#241773", "#9E7C0C"], BUF: ["#00338D", "#C60C30"],
  CAR: ["#0085CA", "#101820"], CHI: ["#0B162A", "#C83803"], CIN: ["#FB4F14", "#000000"], CLE: ["#311D00", "#FF3C00"],
  DAL: ["#003594", "#869397"], DEN: ["#FB4F14", "#002244"], DET: ["#0076B6", "#B0B7BC"], GB: ["#203731", "#FFB612"],
  HOU: ["#03202F", "#A71930"], IND: ["#002C5F", "#A2AAAD"], JAX: ["#006778", "#D7A22A"], KC: ["#E31837", "#FFB81C"],
  LV: ["#000000", "#A5ACAF"], LAC: ["#0080C6", "#FFC20E"], LAR: ["#003594", "#FFA300"], MIA: ["#008E97", "#FC4C02"],
  MIN: ["#4F2683", "#FFC62F"], NE: ["#002244", "#C60C30"], NO: ["#D3BC8D", "#101820"], NYG: ["#0B2265", "#A71930"],
  NYJ: ["#125740", "#000000"], PHI: ["#004C54", "#A5ACAF"], PIT: ["#FFB612", "#101820"], SEA: ["#002244", "#69BE28"],
  SF: ["#AA0000", "#B3995D"], TB: ["#D50A0A", "#0A0A08"], TEN: ["#0C2340", "#4B92DB"], WSH: ["#5A1414", "#FFB612"],
  WAS: ["#5A1414", "#FFB612"]
};

function club(abbr) {
  const raw = String(abbr || "").toUpperCase();
  const key = raw === "WAS" ? "WSH" : raw;
  const pair = TEAM_STYLE[key] || ["#3B82F6", "#0F172A"];
  const file = (key === "WSH" ? "wsh" : key.toLowerCase());
  return { key, primary: pair[0], secondary: pair[1], logo: "https://a.espncdn.com/i/teamlogos/nfl/500/" + file + ".png" };
}
function marketLabel(stat) {
  return MARKET[stat] || String(stat || "").replace(/_/g, " ").toUpperCase();
}
function initials(name) {
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase();
}
function avatarEl(player, size) {
  const wrap = document.createElement("span");
  wrap.className = "avatar" + (size ? " " + size : "");
  wrap.style.setProperty("--ring", club(player.team).primary);
  if (!player.espn_id) {
    wrap.textContent = initials(player.name);
    return wrap;
  }
  const img = document.createElement("img");
  img.alt = "";
  img.src = "https://a.espncdn.com/combiner/i?img=/i/headshots/nfl/players/full/" + player.espn_id + ".png&w=120&h=88";
  img.onerror = () => { img.remove(); wrap.textContent = initials(player.name); };
  wrap.append(img);
  return wrap;
}
function logoEl(abbr, extra) {
  const img = document.createElement("img");
  img.className = "logo" + (extra ? " " + extra : "");
  img.alt = abbr || "";
  img.src = club(abbr).logo;
  img.onerror = () => img.remove();
  return img;
}
function toneClass(hit) {
  if (hit >= 0.65) return "tone-hot";
  if (hit >= 0.55) return "tone-mid";
  if (hit >= 0.45) return "tone-warm";
  return "tone-cold";
}
function weatherBadge(game) {
  const roof = String((game && game.roof) || "");
  const indoor = /indoor|dome|canopy|closed/i.test(roof);
  const label = weatherCompact((game.weather && game.weather.label) || "");
  if (indoor && !label) return "🏟️ Dome";
  if (indoor) return "🏟️ " + label;
  return "☀️ " + (label || roof || "Outdoor");
}
function weatherCompact(label) {
  return String(label || "").replace(/\s*wind\b/gi, "").replace(/\s*·\s*/g, " ").replace(/\s+/g, " ").trim();
}
function paintTeam(node, abbr) {
  const style = club(abbr);
  node.style.setProperty("--team", style.primary);
  node.style.setProperty("--team2", style.secondary);
}
const state = { tab: "board", data: null, meta: null, player: null, stat: "rush_yds", line: 59, odds: "", side: "over", gameId: null, sim: null, outs: {}, sort: { key: "name", dir: 1 }, filters: { q: "", game: "", team: "", pos: "", stat: "", min: 0, day: "sunday" } };

function fmtLine(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return "—";
  const doubled = Math.round(x * 2);
  if (Math.abs(x * 2 - doubled) < 1e-6 && Math.abs(x - Math.round(x)) > 0.01) return (doubled / 2).toFixed(1);
  if (Math.abs(x - Math.round(x)) < 1e-6) return String(Math.round(x));
  return x.toFixed(1);
}

function probs(q, line) {
  let underAt = -1, leAt = -1;
  for (let i = 0; i < q.length; i++) {
    if (q[i] < line) underAt = i;
    if (q[i] <= line) leAt = i;
  }
  const pUnder = underAt < 0 ? 0 : underAt / 100;
  const pLe = leAt < 0 ? 0 : leAt / 100;
  return { over: Math.max(0, 1 - pLe), under: pUnder, push: Math.max(0, pLe - pUnder) };
}

function fairAmerican(win, push = 0) {
  if (win <= 0 || win + push > 1.0000001) return null;
  const decimal = (1 - push) / win;
  if (decimal <= 1) return null;
  if (Math.abs(decimal - 2) < 1e-9) return 100;
  if (decimal > 2) {
    const price = Math.round((decimal - 1) * 100);
    return price < 100 ? 100 : price;
  }
  const price = Math.round(-100 / (decimal - 1));
  return price > -100 ? -100 : price;
}

function priceText(price) {
  if (price == null) return "—";
  return price > 0 ? "+" + price : String(price);
}

function quarterKelly(hit, odds) {
  if (hit == null || odds == null || hit <= 0 || hit >= 1) return 0;
  const b = odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  const full = (b * hit - (1 - hit)) / b;
  return Math.max(0, Math.min(1, Math.round(full * 25) / 100));
}

function evPerUnit(win, odds, push = 0) {
  const decimal = odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds);
  const loss = Math.max(0, 1 - win - push);
  return win * (decimal - 1) - loss;
}

function parseOdds(text) {
  const raw = String(text || "").trim().replace("−", "-");
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n !== 0 ? n : null;
}

function normPerson(name) {
  return String(name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "").replace(/\s+/g, " ").trim();
}

function streakBlocked() {
  const names = new Set();
  const audit = (state.data && state.data.roster_audit) || {};
  (audit.dropped_out || []).forEach(row => {
    const who = row && (row.name || row.player);
    if (who) names.add(normPerson(who));
  });
  (audit.espn_fixed || []).forEach(row => {
    const to = String((row && row.status_to) || "").toLowerCase();
    const where = String((row && row.where) || "");
    if (where === "removed" || /^(out|ir|doubtful|inactive|suspended|injured reserve|pup)$/.test(to)) {
      if (row && row.player) names.add(normPerson(row.player));
    }
  });
  Object.keys(state.outs || {}).forEach(name => { if (state.outs[name]) names.add(normPerson(name)); });
  ((state.data && state.data.players) || []).forEach(player => {
    const st = String(player.injury_status || "").toUpperCase();
    if (["O", "OUT", "IR", "D", "PUP", "DOUBTFUL"].includes(st)) names.add(normPerson(player.name));
  });
  return names;
}

function renderStreaks(app) {
  if (!state.streakFilters) state.streakFilters = { game: "", market: "", min: "8", value: false };
  if (!state.streakPicks) state.streakPicks = [];
  if (!state.streaks) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Loading alt-line streaks…";
    app.append(note);
    if (!state.streaksLoading) {
      state.streaksLoading = true;
      fetch("data/streaks.json", { cache: "no-store" }).then(res => res.json()).then(data => {
        state.streaks = data;
        state.streaksLoading = false;
        render();
      }).catch(err => { state.streaksLoading = false; note.textContent = String(err); });
    }
    return;
  }
  const data = state.streaks;
  const f = state.streakFilters;
  const intro = document.createElement("article");
  intro.className = "slip";
  intro.innerHTML = "<strong>Week " + data.week + " alt streaks</strong>"
    + "<p class='meta'>A streak shows the pattern happened. Edge tells you whether the price is still worth it.</p>"
    + "<p class='meta'>" + (data.price_note || "") + "</p>"
    + "<p class='meta'>" + (data.true_note || "") + "</p>"
    + "<p class='caution'>Stacking juiced alt legs multiplies the risk of one blowup. A same-game parlay is one outcome, not four.</p>";
  app.append(intro);
  const filters = document.createElement("div");
  filters.className = "filters";
  const game = document.createElement("select");
  game.innerHTML = "<option value=''>All games</option>" + (data.games || []).map(item => "<option value='" + item.id + "'>" + item.id + "</option>").join("");
  game.value = f.game;
  game.onchange = () => { f.game = game.value; render(); };
  const market = document.createElement("select");
  market.innerHTML = "<option value=''>All markets</option><option value='pass_yds'>Pass yds</option><option value='rush_yds'>Rush yds</option><option value='rec_yds'>Rec yds</option><option value='receptions'>Receptions</option><option value='rush_rec_yds'>Rush+rec</option>";
  market.value = f.market;
  market.onchange = () => { f.market = market.value; render(); };
  const min = document.createElement("select");
  min.innerHTML = "<option value='5'>5+ straight</option><option value='8'>8+ straight</option><option value='10'>10+ straight</option><option value='15'>15+ straight</option>";
  min.value = f.min;
  min.onchange = () => { f.min = min.value; render(); };
  const value = document.createElement("button");
  value.type = "button";
  value.textContent = f.value ? "Value only" : "All prices";
  value.className = f.value ? "on" : "";
  value.onclick = () => { f.value = !f.value; render(); };
  filters.append(game, market, min, value);
  app.append(filters);
  const blocked = streakBlocked();
  const shown = (data.rows || []).filter(row => {
    if (blocked.has(normPerson(row.player))) return false;
    if (row.streak < Number(f.min || 8)) return false;
    if (f.game && row.game !== f.game) return false;
    if (f.market && row.market !== f.market) return false;
    if (f.value && row.state !== "value") return false;
    return true;
  }).slice().sort((a, b) => (b.edge == null ? -9 : b.edge) - (a.edge == null ? -9 : a.edge) || b.streak - a.streak);
  const count = document.createElement("p");
  count.className = "meta";
  count.textContent = shown.length + " rungs · " + (data.counts ? data.counts.eight_plus : 0) + " at 8+ before filters";
  app.append(count);
  shown.slice(0, 80).forEach(row => app.append(streakCard(row)));
  const picks = (data.rows || []).filter(row => state.streakPicks.includes(row.id));
  if (picks.length) app.append(streakParlay(picks));
}

function streakCard(row) {
  const card = document.createElement("article");
  card.className = "slip streak-card " + (row.state || "unpriced");
  const head = document.createElement("button");
  head.type = "button";
  head.className = "home-streak";
  const who = document.createElement("div");
  who.append(avatarEl({ name: row.player, team: row.team, espn_id: row.espn_id }));
  const name = document.createElement("strong");
  name.textContent = " " + row.player + " · " + row.team + (row.home ? " vs " : " @ ") + row.opp;
  who.append(name);
  const meta = document.createElement("div");
  meta.className = "meta";
  const price = row.price == null ? "not posted" : (row.book + " " + (row.price > 0 ? "+" + row.price : row.price));
  meta.textContent = row.market_label + " " + row.rung + "+ · " + row.streak + " straight · " + price
    + (row.edge == null ? "" : " · edge " + Math.round(row.edge * 1000) / 10 + "%")
    + (row.kelly ? " · " + row.kelly.toFixed(2) + "u qK" : "");
  who.append(meta);
  head.append(who, sparkline(row.spark, row.rung));
  head.onclick = () => { state.streakOpen = state.streakOpen === row.id ? "" : row.id; render(); };
  card.append(head);
  const bars = document.createElement("p");
  bars.className = "meta";
  bars.textContent = "L" + row.l10_n + " " + row.l10 + "/" + row.l10_n
    + " · season " + row.season_hits + "/" + row.season_n
    + " · in DB " + row.career_hits + "/" + row.career_n
    + " · true " + Math.round(row.true_p * 1000) / 10 + "%"
    + (row.implied == null ? " · breakeven " + (row.breakeven > 0 ? "+" + row.breakeven : row.breakeven) : " · implied " + Math.round(row.implied * 1000) / 10 + "%")
    + (row.ev10 == null ? "" : " · EV $" + row.ev10.toFixed(2) + " per $10");
  card.append(bars);
  (row.flags || []).forEach(flag => {
    const p = document.createElement("p");
    p.className = "caution";
    p.textContent = flag;
    card.append(p);
  });
  if (row.note) {
    const p = document.createElement("p");
    p.className = "meta";
    p.textContent = row.note;
    card.append(p);
  }
  if (row.state === "value") {
    const add = document.createElement("button");
    add.type = "button";
    add.textContent = state.streakPicks.includes(row.id) ? "Remove from parlay" : "Add to parlay";
    add.onclick = () => {
      if (state.streakPicks.includes(row.id)) state.streakPicks = state.streakPicks.filter(id => id !== row.id);
      else if (state.streakPicks.length < 4) state.streakPicks.push(row.id);
      render();
    };
    card.append(add);
  }
  if (state.streakOpen === row.id) card.append(streakLog(row));
  return card;
}

function sparkline(values, line) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 88 28");
  svg.setAttribute("class", "spark");
  const nums = values && values.length ? values : [line];
  const lo = Math.min(line, ...nums);
  const hi = Math.max(line, ...nums);
  const y = value => 24 - ((value - lo) / (hi - lo || 1)) * 20;
  const step = 80 / Math.max(1, nums.length - 1);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", nums.map((value, index) => (index ? "L" : "M") + (4 + index * step).toFixed(1) + " " + y(value).toFixed(1)).join(" "));
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "#34D399");
  path.setAttribute("stroke-width", "1.6");
  const rule = document.createElementNS("http://www.w3.org/2000/svg", "line");
  rule.setAttribute("x1", "2");
  rule.setAttribute("x2", "86");
  rule.setAttribute("y1", y(line).toFixed(1));
  rule.setAttribute("y2", y(line).toFixed(1));
  rule.setAttribute("stroke", "#F59E0B");
  rule.setAttribute("stroke-dasharray", "3 2");
  svg.append(rule, path);
  return svg;
}

function streakLog(row) {
  const wrap = document.createElement("div");
  const summary = document.createElement("p");
  summary.className = "meta";
  summary.textContent = "Low " + row.low + " · avg " + row.avg + " · closest call " + row.closest + " (" + row.closest_margin + " over the rung). Oldest is on the left of the sparkline.";
  wrap.append(summary);
  const table = document.createElement("table");
  table.className = "streak-log";
  table.innerHTML = "<thead><tr><th>Date</th><th>Wk</th><th>Opp</th><th>Actual</th><th></th></tr></thead>";
  const body = document.createElement("tbody");
  (row.log || []).slice().reverse().forEach(game => {
    const tr = document.createElement("tr");
    const opp = document.createElement("td");
    opp.append(logoEl(game.opp, "sm"), document.createTextNode(" " + (game.home ? "vs " : "@ ") + (game.opp || "—")));
    [game.date || "—", "W" + game.week].forEach(text => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.append(td);
    });
    tr.append(opp);
    const actual = document.createElement("td");
    actual.textContent = String(game.actual);
    const ctx = document.createElement("td");
    ctx.textContent = game.context + " " + game.context_label;
    tr.append(actual, ctx);
    body.append(tr);
  });
  table.append(body);
  wrap.append(table);
  if (row.previous_miss) {
    const miss = row.previous_miss;
    const p = document.createElement("p");
    p.className = "meta";
    p.textContent = "Previous run ended " + (miss.date || ("week " + miss.week)) + " " + (miss.home ? "vs " : "@ ") + (miss.opp || "—") + " with " + miss.actual + ".";
    wrap.append(p);
  }
  return wrap;
}

function streakParlay(picks) {
  const card = document.createElement("article");
  card.className = "slip";
  const same = new Set(picks.map(row => row.game)).size < picks.length;
  let decimal = 1;
  let trueP = 1;
  picks.forEach(row => {
    const odds = row.price;
    decimal *= odds == null ? 1 : (odds > 0 ? 1 + odds / 100 : 1 + 100 / Math.abs(odds));
    trueP *= row.true_p;
  });
  const priced = picks.every(row => row.price != null);
  card.innerHTML = "<strong>Streak parlay · " + picks.length + " legs</strong>"
    + "<p class='meta'>Combined true " + Math.round(trueP * 1000) / 10 + "% assuming the legs are separate."
    + (priced ? " Combined decimal " + decimal.toFixed(2) + "." : " A leg has no posted price.") + "</p>";
  if (same) {
    const warn = document.createElement("p");
    warn.className = "caution";
    warn.textContent = "Same-game correlation: these legs move together. The combined true % is too high if you treat them as independent.";
    card.append(warn);
  }
  return card;
}

function renderModelLab(app) {
  if (!state.lab) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Loading the model lab…";
    app.append(note);
    if (!state.labLoading) {
      state.labLoading = true;
      fetch("data/model-lab.json", { cache: "no-store" }).then(res => res.json()).then(data => {
        state.lab = data;
        state.labLoading = false;
        render();
      }).catch(() => { state.labLoading = false; note.textContent = "Model lab file is not on this build."; });
    }
    return;
  }
  const lab = state.lab;
  const card = document.createElement("article");
  card.className = "slip";
  card.innerHTML = "<strong>Model lab</strong><p class='meta'>Data: " + (lab.freshness || "—") + "</p>";
  (lab.credits || []).forEach(line => {
    const p = document.createElement("p");
    p.className = "meta";
    p.textContent = line;
    card.append(p);
  });
  (lab.active || []).forEach(row => {
    const p = document.createElement("p");
    p.textContent = row.market + ": " + row.model + (row.shipped ? "" : " — not shipped");
    card.append(p);
  });
  (lab.tests || []).forEach(row => {
    const p = document.createElement("p");
    p.className = "meta";
    p.textContent = row.name + ": " + row.result;
    card.append(p);
  });
  app.append(card);
}

function renderParlayDesk(app, data) {
  const desk = data && data.parlays;
  if (!desk || !desk.parlay_of_the_night) return;
  const card = document.createElement("article");
  card.className = "slip";
  const title = document.createElement("strong");
  title.textContent = "Parlay of the Night";
  card.append(title);
  const bookie = desk.bookie || {};
  const who = document.createElement("p");
  who.className = "meta";
  who.textContent = (bookie.name || "The Bookie") + " — " + (bookie.personality || "")
    + " · w " + (bookie.weight == null ? "1" : bookie.weight) + " · " + (bookie.record || "0-0");
  card.append(who);
  card.append(parlayBlock(desk.parlay_of_the_night, true));
  (desk.alternates || []).forEach(ticket => card.append(parlayBlock(ticket, false)));
  if ((desk.votes || []).some(vote => vote.why)) {
    const box = document.createElement("details");
    const sum = document.createElement("summary");
    sum.textContent = "Why the bots voted";
    box.append(sum);
    const names = { professor: "The Professor", alpha: "Alpha", actuary: "The Actuary", coordinator: "The Coordinator" };
    desk.votes.forEach(vote => { if (vote.why) box.append(whyEl(vote.why, (names[vote.who] || vote.who) + ":")); });
    card.append(box);
  }
  if (bookie.quote) {
    const quote = document.createElement("p");
    quote.className = "meta";
    quote.textContent = "Bookie: " + bookie.quote;
    card.append(quote);
  }
  const heat = desk.parlay_of_the_night.heatmap;
  if (heat && heat.matrix) {
    const grid = document.createElement("div");
    grid.className = "heat";
    heat.labels.forEach((label, row) => {
      heat.labels.forEach((other, col) => {
        const cell = document.createElement("b");
        const value = heat.matrix[row][col];
        cell.textContent = (row === col ? label : label.split(" ")[0] + " / " + other.split(" ")[0]) + " " + value;
        const tone = value < 0 ? "rgba(244,63,94,0.45)" : "rgba(16,185,129," + Math.min(0.75, 0.15 + Math.abs(value)) + ")";
        cell.style.background = tone;
        grid.append(cell);
      });
    });
    card.append(grid);
  }
  app.append(card);
}

function whyEl(text, label) {
  const p = document.createElement("p");
  p.className = "why";
  if (label) {
    const b = document.createElement("b");
    b.textContent = label + " ";
    p.append(b);
  }
  p.append(document.createTextNode(text));
  return p;
}

function parlayBlock(ticket, night) {
  const block = document.createElement("div");
  const head = document.createElement("p");
  head.className = "meta";
  const price = ticket.payout_american > 0 ? "+" + ticket.payout_american : ticket.payout_american;
  const fair = ticket.fair_american > 0 ? "+" + ticket.fair_american : ticket.fair_american;
  head.textContent = (night ? "" : "Alternate · ") + ticket.legs.length + "-leg · joint "
    + Math.round(ticket.joint_p * 1000) / 10 + "% · fair " + fair + " · book " + price
    + " · " + (ticket.stake || 0) + "u" + (ticket.thin ? " thin" : "") + " · " + (ticket.label || "");
  block.append(head);
  if (ticket.why) block.append(whyEl(ticket.why, night ? "Why:" : ""));
  ticket.legs.forEach(leg => {
    const row = document.createElement("div");
    row.className = "leg";
    row.append(avatarEl({ name: leg.player, team: leg.team, espn_id: leg.espn_id }, "sm"));
    const text = document.createElement("span");
    const american = leg.price > 0 ? "+" + leg.price : leg.price;
    text.textContent = leg.player + " " + leg.side + " " + leg.line + " " + leg.stat + " " + american + " " + (leg.book || "");
    row.append(text);
    block.append(row);
    if (leg.why) block.append(whyEl(leg.why));
  });
  if (ticket.sgp) {
    const need = document.createElement("p");
    need.className = "meta";
    const ask = ticket.need_american > 0 ? "+" + ticket.need_american : ticket.need_american;
    need.textContent = ticket.plus_ev
      ? "SGP. The singles product is +EV. On the builder, need >= " + ask
      : "check SGP price, need >= " + ask;
    block.append(need);
  }
  if (ticket.corr_note) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = ticket.corr_note;
    block.append(note);
  }
  return block;
}

function renderWarRoom(app) {
  if (!state.warroom && !state.warLoading) {
    state.warLoading = true;
    fetch("data/warroom.json", { cache: "no-store" }).then(res => res.ok ? res.json() : null).then(data => {
      state.warroom = data || { status: "skipped", message: "War Room runs on the next scheduled GitHub job", props: [] };
      state.warLoading = false;
      render();
    }).catch(() => {
      state.warroom = { status: "skipped", message: "War Room runs on the next scheduled GitHub job", props: [] };
      state.warLoading = false;
      render();
    });
  }
  const data = state.warroom;
  const banner = document.createElement("article");
  banner.className = "slip";
  if (!data) {
    banner.textContent = "War Room runs on the next scheduled GitHub job";
    app.append(banner);
    return;
  }
  banner.innerHTML = "<strong>" + (data.status === "gemini" ? "Gemini desk" : "Rules desk") + "</strong><p class='meta'>"
    + (data.message || "War Room runs on the next scheduled GitHub job") + "</p>";
  renderParlayDesk(app, data);
  app.append(banner);
  app.append(picksOfWeek(data));
  if (data.backtest) {
    const bt = data.backtest;
    const card = document.createElement("article");
    card.className = "slip";
    card.innerHTML = "<strong>Week " + bt.week + " backtest</strong><p class='meta'>" + bt.note + "</p>"
      + "<p class='meta'>Plain sim " + bt.plain_sim.wins + "-" + bt.plain_sim.losses + " " + bt.plain_sim.units + "u. "
      + "War Room gate " + bt.war_room.wins + "-" + bt.war_room.losses + " " + bt.war_room.units + "u. "
      + "CLV " + (bt.war_room.clv == null ? "null" : bt.war_room.clv) + ".</p>";
    app.append(card);
  }
  const night = (data.props || []).find(row => data.bet_of_the_night && row.packet.id === data.bet_of_the_night.id);
  if (night) app.append(warCard(night, true));
  (data.props || []).forEach(row => {
    if (night && row.packet.id === night.packet.id) return;
    app.append(warCard(row, false));
  });
}

const PERSONA_ICON = { professor: "🎓", alpha: "😎", actuary: "🧮", coordinator: "🏈" };
function picksOfWeek(data) {
  const wrap = document.createElement("section");
  wrap.className = "potw";
  const h = document.createElement("h2");
  h.textContent = "Picks of the Week";
  wrap.append(h);
  const picks = data.picks_of_week || {};
  const keys = ["professor", "alpha", "actuary", "coordinator"].filter(key => picks[key]);
  if (!keys.length) {
    const p = document.createElement("p");
    p.className = "meta";
    p.textContent = "The bots post their Picks of the Week on the next War Room run.";
    wrap.append(p);
    return wrap;
  }
  const grid = document.createElement("div");
  grid.className = "potw-grid";
  keys.forEach(key => {
    const pick = picks[key];
    const card = document.createElement("article");
    card.className = "slip potw-card " + key + (pick.forced ? " forced" : "");
    const top = document.createElement("div");
    top.className = "potw-head";
    const name = document.createElement("strong");
    name.textContent = (PERSONA_ICON[key] || "") + " " + (pick.name || key);
    top.append(name);
    if (pick.motto) {
      const motto = document.createElement("em");
      motto.textContent = "“" + pick.motto + "”";
      top.append(motto);
    }
    card.append(top);
    const leg = document.createElement("div");
    leg.className = "leg";
    leg.append(avatarEl({ name: pick.player, team: pick.team }, "sm"));
    const text = document.createElement("span");
    const price = pick.price == null ? "—" : (pick.price > 0 ? "+" + pick.price : pick.price);
    text.textContent = (pick.forced ? "Lean · " : "") + pick.player + " " + (pick.stat === "anytime_td" ? "anytime TD" : (pick.side || "") + " " + pick.line + " " + marketLabel(pick.stat)) + " " + price + " " + (pick.book || "");
    leg.append(text);
    card.append(leg);
    const nums = document.createElement("p");
    nums.className = "meta";
    const bits = [];
    if (pick.p != null) bits.push("my p " + pct(pick.p));
    if (pick.novig != null) bits.push("no-vig " + pct(pick.novig));
    if (pick.sim_p != null) bits.push("sim hit " + pct(pick.sim_p));
    if (pick.sim_mean != null) bits.push("sim mean " + pick.sim_mean);
    if (pick.ev != null) bits.push("EV " + (pick.ev > 0 ? "+" : "") + pct(pick.ev));
    if (pick.forced) bits.push("max 0.03u");
    nums.textContent = bits.join(" · ");
    card.append(nums);
    if (pick.why) card.append(whyEl(pick.why));
    grid.append(card);
  });
  wrap.append(grid);
  return wrap;
}

function warCard(row, night) {
  const card = document.createElement("article");
  card.className = "slip";
  const decision = row.decision || {};
  const packet = row.packet || {};
  const head = document.createElement("button");
  head.type = "button";
  head.className = "home-streak";
  const price = decision.price == null ? "—" : (decision.price > 0 ? "+" + decision.price : decision.price);
  head.innerHTML = "<div><strong>" + (night ? "Bet of the Night · " : "") + (packet.player || "") + "</strong><div class='meta'>"
    + decision.verdict + " " + (decision.side || "") + " " + (packet.stat || "") + " " + (packet.line ?? "")
    + " " + price + " · " + (decision.stake || 0) + "u" + (decision.thin ? " thin" : "") + " · " + (decision.agree || 0) + "/4 · " + (decision.why || "")
    + "</div></div><span>" + (state.warOpen === packet.id ? "Hide" : "Notes") + "</span>";
  head.onclick = () => { state.warOpen = state.warOpen === packet.id ? "" : packet.id; render(); };
  card.append(head);
  const kongWhy = row.why || (row.consensus && row.consensus.why);
  if (kongWhy && (night || state.warOpen === packet.id)) card.append(whyEl(kongWhy, "Kong:"));
  if (state.warOpen !== packet.id) return card;
  const people = row.personas || row.analysts || {};
  Object.keys(people).forEach(role => {
    const note = people[role] || {};
    const p = document.createElement("p");
    p.className = "meta";
    const who = note.name || role;
    const prob = note.p == null ? "" : " p " + Math.round(note.p * 1000) / 10 + "%";
    const weight = note.weight == null ? "" : " · w " + note.weight;
    const record = note.record ? " · " + note.record : "";
    p.textContent = who + (note.personality ? " — " + note.personality : "") + prob + weight + record
      + " · " + (note.stance || "pass") + " — " + (note.quote || note.note || "no data");
    card.append(p);
    if (note.why) card.append(whyEl(note.why, who + ":"));
  });
  if (row.consensus) {
    const line = document.createElement("p");
    line.className = "meta";
    line.textContent = "Meeting ground p " + Math.round(row.consensus.p * 1000) / 10 + "% · spread "
      + row.consensus.spread + " · " + row.consensus.verdict + " " + (row.consensus.stake || 0) + "u";
    card.append(line);
  }
  if ((row.debate || []).length) {
    const squabble = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = "Squabble";
    squabble.append(summary);
    row.debate.forEach(note => {
      const p = document.createElement("p");
      p.className = "meta";
      const who = note.who || "debate";
      p.textContent = who + " " + (note.stance || "") + " — " + (note.quote || note.note || "");
      squabble.append(p);
    });
    card.append(squabble);
  }
  const risk = row.risk || {};
  const riskLine = document.createElement("p");
  riskLine.className = "meta";
  riskLine.textContent = "risk: " + (risk.verdict || "—") + " — " + (risk.note || "");
  card.append(riskLine);
  if (row.devil) {
    const devil = document.createElement("p");
    devil.className = "meta";
    devil.textContent = "devil's advocate: " + (row.devil.hold === false ? "killed the bet" : "held") + " — " + (row.devil.note || "");
    card.append(devil);
  }
  return card;
}

function renderReview(app) {
  if (!state.reviewIndex) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Loading graded weeks…";
    app.append(note);
    if (!state.reviewIndexLoading) {
      state.reviewIndexLoading = true;
      fetch("data/reviews.json", { cache: "no-store" }).then(res => res.ok ? res.json() : null).catch(() => null).then(data => {
        state.reviewIndex = (data && data.weeks && data.weeks.length) ? data : { weeks: [{ week: 9, file: "week-2026-09-review.json", version: 1, label: "Week 9" }] };
        state.reviewIndexLoading = false;
        render();
      });
    }
    return;
  }
  const weeks = state.reviewIndex.weeks;
  const pick = weeks.find(w => w.week === state.reviewWeek) || weeks[0];
  const bar = document.createElement("div");
  bar.className = "review-weeks";
  weeks.forEach(w => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "ghost" + (w.week === pick.week ? " on" : "");
    b.textContent = w.label || ("Week " + w.week);
    b.onclick = () => { if (w.week === pick.week) return; pushNav(); state.reviewWeek = w.week; render(); };
    bar.append(b);
  });
  app.append(bar);
  state.reviews = state.reviews || {};
  const data = state.reviews[pick.week];
  if (!data) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Loading Week " + pick.week + "…";
    app.append(note);
    if (state.reviewLoadingWeek !== pick.week) {
      state.reviewLoadingWeek = pick.week;
      fetch("data/" + pick.file, { cache: "no-store" }).then(res => res.json()).then(json => {
        state.reviews[pick.week] = json;
        state.reviewLoadingWeek = null;
        render();
      }).catch(err => { state.reviewLoadingWeek = null; note.textContent = String(err); });
    }
    return;
  }
  state.review = data;
  if (data.version === 2) renderReviewV2(app, data);
  else renderReviewV1(app);
}

function units(n) { return n == null ? "—" : (n > 0 ? "+" : "") + (Math.round(n * 1000) / 1000) + "u"; }
function american(n) { return n == null ? "—" : (n > 0 ? "+" + n : String(n)); }
function resultClass(r) { return r === "win" ? "hit" : r === "loss" ? "miss" : "void"; }
function reviewCard(title, html) {
  const card = document.createElement("article");
  card.className = "slip";
  const h = document.createElement("strong");
  h.textContent = title;
  card.append(h);
  if (html) { const p = document.createElement("p"); p.className = "meta"; p.textContent = html; card.append(p); }
  return card;
}
function legText(l) {
  const stat = { rec_yds: "rec yds", rush_yds: "rush yds", pass_yds: "pass yds", receptions: "receptions", completions: "completions", rush_rec_yds: "rush+rec yds" }[l.stat] || l.stat;
  return l.player + " " + l.side + " " + l.line + " " + stat;
}
function ctTime(iso) {
  try { return new Date(iso).toLocaleString("en-US", { timeZone: "America/Chicago", weekday: "short", month: "numeric", day: "numeric", hour: "numeric", minute: "2-digit" }) + " CT"; } catch (err) { return iso; }
}

function renderReviewV2(app, d) {
  const h = d.headline;
  const top = document.createElement("div");
  top.className = "review-kpis";
  const games = h.botn.wins + h.botn.losses;
  [["Bets of the Night", h.botn.wins + "-" + h.botn.losses, units(h.botn.units_staked) + " staked · " + units(h.botn.units_flat) + " at 1u"],
   ["Parlays of the Night", h.potn.wins + "-" + h.potn.losses, units(h.potn.units_staked) + " staked · " + units(h.potn.units_flat) + " at 1u"],
   ["Win rate (BOTN + POTN)", Math.round(100 * (h.botn.wins + h.potn.wins) / Math.max(1, games + h.potn.wins + h.potn.losses)) + "%", (h.botn.wins + h.potn.wins) + " of " + (games + h.potn.wins + h.potn.losses) + " graded"],
   ["CLV (BOTN)", h.botn.clv_avg_pts == null ? "—" : (h.botn.clv_avg_pts > 0 ? "+" : "") + h.botn.clv_avg_pts + " pts", h.botn.clv_n + " of " + games + " had a later pre-kick capture"],
   h.ticket ? ["Your FD ticket", h.ticket.hit + "/" + h.ticket.legs + " legs", h.ticket.result.toUpperCase()] : null,
   !h.board ? null : ["Full board", h.board.wins + "-" + h.board.losses + " (" + Math.round(h.board.hit * 1000) / 10 + "%)", units(h.board.units) + " on " + h.board.priced + " priced"]].filter(Boolean).forEach(([k, v, sub]) => {
    const tile = document.createElement("div");
    tile.className = "statcard";
    tile.innerHTML = "<div class='k'></div><div class='v'></div><div class='meta'></div>";
    tile.children[0].textContent = k; tile.children[1].textContent = v; tile.children[2].textContent = sub;
    top.append(tile);
  });
  app.append(reviewCard("Week " + d.week + " Review" + (d.dates ? " · " + d.dates : "") + (d.auto ? " · auto-built" : ""), d.sources));
  app.append(top);
  const take = reviewCard("Weekly takeaways");
  const ul = document.createElement("ul");
  (d.takeaways || []).forEach(t => { const li = document.createElement("li"); li.textContent = t; ul.append(li); });
  take.append(ul);
  app.append(take);
  const imp = reviewCard("What needs to improve, and what changed");
  (d.improvements || []).forEach(x => { const p = document.createElement("p"); p.className = "meta"; p.innerHTML = "<b></b> "; p.firstChild.textContent = x.what + ":"; p.append(document.createTextNode(x.done)); imp.append(p); });
  app.append(imp);
  const botn = reviewCard("Bets of the Night (as published)");
  d.botn.forEach(x => {
    const p = document.createElement("p");
    p.className = resultClass(x.result);
    const clv = !x.clv ? "CLV n/a (no later capture)" : x.clv.type === "price" ? "CLV " + (x.clv.pts > 0 ? "+" : "") + x.clv.pts + " pts (last capture " + american(x.clv.close_price) + ")" : "line moved " + x.clv.line_move;
    p.textContent = (x.superseded ? "REPLACED (not counted)  " : x.result.toUpperCase() + "  ") + legText(x) + " " + american(x.price) + " · " + x.stake + "u · actual " + (x.actual == null ? "—" : x.actual) + (x.superseded ? "" : " · " + units(x.units_staked) + " · " + clv) + " · posted " + ctTime(x.published);
    if (x.superseded) p.style.opacity = "0.55";
    botn.append(p);
  });
  app.append(botn);
  const potn = reviewCard("Parlays of the Night (as published)");
  d.potn.forEach(x => {
    const p = document.createElement("p");
    p.className = resultClass(x.result);
    p.textContent = x.result.toUpperCase() + "  " + american(x.price) + " · " + x.stake + "u · " + units(x.units_staked) + " · posted " + ctTime(x.published);
    potn.append(p);
    x.legs.forEach(l => { const q = document.createElement("p"); q.className = "meta " + resultClass(l.result); q.textContent = "   " + (l.result === "win" ? "✓ " : "✗ ") + legText(l) + " · actual " + (l.actual == null ? "—" : l.actual); potn.append(q); });
  });
  (d.journal || []).forEach(x => {
    const p = document.createElement("p");
    p.className = resultClass(x.result);
    p.textContent = x.result.toUpperCase() + "  " + (x.label || "Journal parlay") + ": " + x.legs.map(l => legText(l) + " (" + l.actual + ")").join(" + ") + ". " + (x.note || "");
    potn.append(p);
  });
  app.append(potn);
  if (d.pow && d.pow.length) {
    const pw = reviewCard("War Room Picks of the Week (as published)");
    d.pow.forEach(x => { const p = document.createElement("p"); p.className = resultClass(x.result); p.textContent = (x.superseded ? "REPLACED (not counted)  " : x.result.toUpperCase() + "  ") + x.persona + ": " + legText(x) + " " + american(x.price) + " · actual " + (x.actual == null ? "—" : x.actual) + (x.superseded ? "" : " · " + units(x.units_flat) + " at 1u") + " · posted " + ctTime(x.published); if (x.superseded) p.style.opacity = "0.55"; pw.append(p); });
    app.append(pw);
  }
  if (h.ticket && d.ticket && d.ticket.length) {
    const tk = reviewCard("Your " + h.ticket.legs + "-leg ticket", h.ticket.hit + " of " + h.ticket.legs + " legs hit · " + h.ticket.result.toUpperCase() + ". Price and stake weren't saved, so no units.");
    d.ticket.forEach(l => { const p = document.createElement("p"); p.className = resultClass(l.result); p.textContent = (l.result === "win" ? "✓ " : "✗ ") + l.player + " " + (l.leg || "") + " · had " + (l.actual == null ? "—" : l.actual) + " · " + (l.game || ""); tk.append(p); });
    app.append(tk);
  }
  const fac = reviewCard("Sim factors: keep, reweight, or drop");
  (d.factors || []).forEach(f => {
    const p = document.createElement("p"); p.className = "meta"; p.innerHTML = "<b></b> ";
    p.firstChild.textContent = f.factor + " → " + f.verdict + ".";
    p.append(document.createTextNode(" " + f.numbers + " " + f.why));
    fac.append(p);
  });
  app.append(fac);
  const bars = reviewCard("Sim hit % vs actual by confidence band (board)");
  (d.buckets || []).forEach(b => {
    const line = document.createElement("div"); line.className = "bar";
    const pred = document.createElement("i"); pred.className = "pred"; pred.style.width = Math.round(b.pred * 160) + "px";
    const act = document.createElement("i"); act.className = "act"; act.style.width = Math.round(b.hit * 160) + "px";
    const lab = document.createElement("span"); lab.textContent = b.band + " · n " + b.n + " · sim " + Math.round(b.pred * 100) + "% · actual " + Math.round(b.hit * 100) + "% · " + units(b.units);
    line.append(pred, act, lab); bars.append(line);
  });
  const legend = document.createElement("p"); legend.className = "meta"; legend.textContent = "Cyan is the sim. Gold is what happened.";
  bars.append(legend);
  app.append(bars);
  const t = document.createElement("table"); t.className = "box season";
  const cap = document.createElement("caption"); cap.textContent = "Board by market: sim vs line"; t.append(cap);
  const head = document.createElement("tr");
  ["Market", "Record", "Hit", "Units", "MAE sim", "MAE line", "Sim bias", "Brier sim"].forEach(x => { const th = document.createElement("th"); th.textContent = x; head.append(th); });
  t.append(head);
  Object.entries(Object.assign({}, d.by_stat, { "all overs": d.by_side.over, "all unders": d.by_side.under })).forEach(([k, r]) => {
    if (!r) return;
    const tr = document.createElement("tr");
    [k, r.wins + "-" + r.losses, Math.round(r.hit * 1000) / 10 + "%", units(r.units), r.mae_sim, r.mae_line, r.bias_sim, r.brier_sim].forEach(v => { const td = document.createElement("td"); td.textContent = v; tr.append(td); });
    t.append(tr);
  });
  const wrap = document.createElement("div"); wrap.className = "table-scroll"; wrap.append(t); app.append(wrap);
  const gaps = reviewCard("Gaps (marked, not guessed)");
  const ul2 = document.createElement("ul");
  d.gaps.forEach(g => { const li = document.createElement("li"); li.textContent = g; ul2.append(li); });
  gaps.append(ul2);
  app.append(gaps);
  const games2 = reviewCard("Final scores (ESPN)", Object.entries(d.games).map(([k, g]) => g.away + " " + g.away_score + " – " + g.home_score + " " + g.home).join(" · "));
  app.append(games2);
}

function renderReviewV1(app) {
  if (!state.review) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "Loading the last graded week…";
    app.append(note);
    if (!state.reviewLoading) {
      state.reviewLoading = true;
      fetch("data/week-2026-09-review.json", { cache: "no-store" }).then(res => res.json()).then(data => {
        state.review = data;
        state.reviewLoading = false;
        render();
      }).catch(err => {
        state.reviewLoading = false;
        note.textContent = String(err);
      });
    }
    return;
  }
  const data = state.review;
  const s = data.summary.graded;
  const head = document.createElement("article");
  head.className = "slip";
  head.innerHTML = "<strong>Week 9 finished " + s.wins + "-" + s.losses + "</strong>"
    + "<p class='meta'>1 unit risk at the posted American price. " + s.units + " units, " + Math.round(s.roi * 1000) / 10 + "% ROI. "
    + "Flat −110 on the same sides would have been " + data.summary.flat_110_units + " units. "
    + "Voids " + data.summary.voids + " (player not in the ESPN box score). Pushes " + data.summary.pushes + ".</p>"
    + "<p class='meta'>" + data.summary.mnf_note + " " + data.summary.madrid_note + "</p>"
    + "<p class='meta'>" + data.summary.clv_note + "</p>";
  app.append(head);
  renderWarRoomGrade(app);
  renderModelLab(app);
  const change = document.createElement("article");
  change.className = "slip";
  const cal = data.calibration[0];
  change.innerHTML = "<strong>What changed for next week</strong><p class='meta'>" + cal.change + " " + cal.week9_evidence + " " + cal.not_changed + "</p>";
  app.append(change);
  data.lessons.forEach(text => {
    const p = document.createElement("p");
    p.className = "meta";
    p.textContent = text;
    app.append(p);
  });
  const bars = document.createElement("article");
  bars.className = "slip";
  bars.innerHTML = "<strong>Sim hit% vs actual, by the edge we showed</strong>";
  Object.keys(data.by_bucket).forEach(key => {
    const row = data.by_bucket[key];
    if (!row.n) return;
    const line = document.createElement("div");
    line.className = "bar";
    const pred = document.createElement("i");
    pred.className = "pred";
    pred.style.width = Math.round((row.pred || 0) * 160) + "px";
    const act = document.createElement("i");
    act.className = "act";
    act.style.width = Math.round(row.hit * 160) + "px";
    const lab = document.createElement("span");
    lab.textContent = key + "% EV  sim " + Math.round((row.pred || 0) * 100) + "%  actual " + Math.round(row.hit * 100) + "%  " + row.units + "u";
    line.append(pred, act, lab);
    bars.append(line);
  });
  const legend = document.createElement("p");
  legend.className = "meta";
  legend.textContent = "Cyan is the sim. Gold is what happened.";
  bars.append(legend);
  app.append(bars);
  app.append(metricTable("By market", data.by_market));
  app.append(metricTable("By book and position", Object.assign({}, data.by_book, data.by_pos)));
  const lists = document.createElement("article");
  lists.className = "slip";
  lists.innerHTML = "<strong>Lists sent on Sunday</strong>";
  [["7:05 AM top 5", data.lists.run50_0705], ["10:37 AM top 5", data.lists.run51_1037], ["Bears–Bucs parlay", data.lists.sgp_bears_bucs]].forEach(([title, pack]) => {
    const h = document.createElement("p");
    h.className = "meta";
    h.textContent = title + ". " + pack.note;
    lists.append(h);
    pack.legs.forEach(leg => {
      const line = document.createElement("p");
      line.className = leg.result === "hit" ? "hit" : leg.result === "miss" ? "miss" : "void";
      line.textContent = leg.result.toUpperCase() + "  " + leg.book + " " + leg.player + " " + leg.side + " " + leg.line + " " + (leg.odds > 0 ? "+" + leg.odds : leg.odds)
        + "  actual " + (leg.actual == null ? "—" : leg.actual) + (leg.detail ? "  " + leg.detail : "");
      lists.append(line);
    });
  });
  app.append(lists);
  data.games.forEach(game => {
    const card = document.createElement("article");
    card.className = "slip";
    const rec = game.record || {};
    card.innerHTML = "<strong>" + game.id + "  " + game.away_score + "–" + game.home_score + "</strong>"
      + "<p class='meta'>Implied " + (game.implied ? game.implied.join("–") : "—") + " · total " + (game.total ?? "—")
      + " · board " + (rec.wins || 0) + "-" + (rec.losses || 0) + " " + (rec.units || 0) + "u</p>"
      + "<p class='meta'>" + game.why + "</p>";
    (game.misses || []).forEach(row => {
      const p = document.createElement("p");
      p.className = "miss";
      p.textContent = "Miss  " + row.player + " " + row.side + " " + row.stat.replace("_", " ") + " " + row.line + "  sim " + row.mean + "  actual " + row.actual + "  " + row.units + "u";
      card.append(p);
    });
    app.append(card);
  });
  const search = document.createElement("input");
  search.placeholder = "Search a player";
  search.value = state.reviewQuery || "";
  search.oninput = () => { state.reviewQuery = search.value; drawRows(); };
  app.append(search);
  const wrap = document.createElement("div");
  wrap.className = "review-scroll";
  const table = document.createElement("table");
  table.className = "review-table";
  wrap.append(table);
  app.append(wrap);
  function drawRows() {
    const q = (state.reviewQuery || "").toLowerCase();
    const shown = data.rows.filter(row => !q || row.player.toLowerCase().includes(q) || row.team.toLowerCase().includes(q) || row.game.toLowerCase().includes(q));
    table.innerHTML = "<thead><tr><th>Player</th><th>Market</th><th>Side</th><th>Line</th><th>Price</th><th>Sim</th><th>Actual</th><th>Result</th><th>EV</th><th>Units</th></tr></thead>";
    const body = document.createElement("tbody");
    shown.slice(0, 400).forEach(row => {
      const tr = document.createElement("tr");
      tr.className = row.result;
      const price = row.odds == null ? "—" : (row.odds > 0 ? "+" + row.odds : String(row.odds));
      [row.player, row.stat, row.side, row.line, price, row.mean, row.actual == null ? "—" : row.actual, row.result, row.ev == null ? "—" : Math.round(row.ev * 1000) / 10 + "%", row.units == null ? "—" : row.units]
        .forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
      body.append(tr);
    });
    table.append(body);
  }
  drawRows();
}

function renderWarRoomGrade(app) {
  if (!state.warBacktest && !state.warBacktestLoading) {
    state.warBacktestLoading = true;
    fetch("data/warroom-backtest.json", { cache: "no-store" }).then(res => res.ok ? res.json() : null).then(data => {
      state.warBacktest = data;
      state.warBacktestLoading = false;
      if (state.tab === "review") render();
    }).catch(() => { state.warBacktestLoading = false; });
  }
  const data = state.warBacktest;
  if (!data) return;
  const card = document.createElement("article");
  card.className = "slip";
  card.innerHTML = "<strong>War Room vs the plain sim</strong><p class='meta'>" + data.note + "</p>"
    + "<p class='meta'>Plain sim " + data.plain_sim.wins + "-" + data.plain_sim.losses + ", " + data.plain_sim.units + "u, ROI "
    + Math.round(data.plain_sim.roi * 1000) / 10 + "%. War Room " + data.war_room.wins + "-" + data.war_room.losses + ", "
    + data.war_room.units + "u, ROI " + Math.round((data.war_room.roi || 0) * 1000) / 10
    + "%. Hit " + Math.round((data.war_room.hit || 0) * 1000) / 10 + "%. CLV " + (data.war_room.clv == null ? "null" : data.war_room.clv) + ".</p>";
  const parlays = data.parlays;
  if (parlays && parlays.desk) {
    const line = document.createElement("p");
    line.className = "meta";
    const naive = parlays.naive_stack || {};
    line.textContent = "Parlay desk " + parlays.desk.wins + "-" + parlays.desk.losses + ", " + parlays.desk.units
      + "u. Naive stack " + (naive.wins || 0) + "-" + (naive.losses || 0) + ", " + (naive.units || 0) + "u. " + (parlays.note || "");
    card.append(line);
  }
  app.append(card);
}

function metricTable(title, map) {
  const card = document.createElement("article");
  card.className = "slip";
  card.innerHTML = "<strong>" + title + "</strong>";
  const table = document.createElement("table");
  table.className = "review-table";
  table.innerHTML = "<thead><tr><th></th><th>Record</th><th>Hit</th><th>Units</th><th>MAE</th><th>Bias</th></tr></thead>";
  const body = document.createElement("tbody");
  Object.keys(map).forEach(key => {
    const row = map[key];
    if (!row || !row.n) return;
    const tr = document.createElement("tr");
    [key, row.wins + "-" + row.losses, Math.round(row.hit * 100) + "%", row.units, row.mae == null ? "—" : row.mae, row.bias == null ? "—" : row.bias]
      .forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
    body.append(tr);
  });
  table.append(body);
  card.append(table);
  return card;
}

async function load(force) {
  const stamp = force ? "?t=" + Date.now() : "";
  const latest = await fetch("data/latest.json" + stamp, { cache: force ? "no-store" : "default" });
  if (!latest.ok) throw new Error("latest.json " + latest.status);
  state.meta = await latest.json();
  const week = await fetch("data/" + state.meta.file + stamp, { cache: force ? "no-store" : "default" });
  if (!week.ok) throw new Error(state.meta.file + " " + week.status);
  state.data = await week.json();
  const cache = await caches.open("kong-data");
  cache.put("data/latest.json", new Response(JSON.stringify(state.meta)));
  cache.put("data/" + state.meta.file, new Response(JSON.stringify(state.data)));
}

// Week-review learning loop: blend the sim toward the no-vig price per market, give back the over shift.
function impliedProb(odds) { return odds > 0 ? 100 / (odds + 100) : -odds / (-odds + 100); }
function learnAdjust(stat, p, block) {
  const L = state.learning;
  if (!L || !L.w || L.w[stat] == null || block.over == null || block.under == null) return p;
  const io = impliedProb(+block.over), iu = impliedProb(+block.under);
  const nv = io / (io + iu);
  const live = 1 - (p.push || 0);
  if (live <= 0) return p;
  const w = Math.max(0, Math.min(1, +L.w[stat]));
  const shift = Math.max(0, Math.min(0.04, +(L.over_shift || 0)));
  let over = nv + w * (p.over / live - nv) - shift;
  over = Math.max(0.02, Math.min(0.98, over));
  return { over: over * live, under: (1 - over) * live, push: p.push || 0, raw: p };
}

function rows() {
  const out = [];
  for (const player of state.data.players) {
    for (const stat of Object.keys(player.stats)) {
      const block = player.stats[stat];
      if (stat === "anytime_td") {
        // A 101-point curve turns a 2% longshot into 3% and a fake plus-EV price.
        const yes = block.mean != null && block.mean < 0.15 ? 1 - Math.exp(-block.mean) : probs(block.q, 0.5).over;
        const fair = fairAmerican(yes, 0);
        out.push({ player, stat, block, line: 0.5, p: { over: yes, under: 0, push: 0 }, hit: yes, side: "yes", odds: block.over, edge: block.over == null ? null : evPerUnit(yes, block.over, 0), fair });
        continue;
      }
      if (block.line == null) continue;
      const line = block.line;
      const p = learnAdjust(stat, probs(block.q, line), block);
      const side = block.board_side === "under" ? "under" : "over";
      const hit = side === "under" ? p.under : p.over;
      const odds = side === "over" ? block.over : block.under;
      const edge = odds == null ? null : evPerUnit(hit, odds, p.push);
      out.push({ player, stat, block, line, p, hit, side, odds, edge, fair: fairAmerican(hit, p.push) });
    }
  }
  const f = state.filters;
  return out.filter(row => {
    if (f.q && !row.player.name.toLowerCase().includes(f.q.toLowerCase())) return false;
    if (f.game && row.player.game !== f.game) return false;
    if (f.team && row.player.team !== f.team) return false;
    if (f.pos && row.player.pos !== f.pos) return false;
    const showcase = { pass_yds: 1, rush_yds: 1, rec_yds: 1, receptions: 1, completions: 1, pass_td: 1, anytime_td: 1 };
    if (!f.stat && !showcase[row.stat]) return false;
    if (row.player.pos !== "QB" && (row.player.depth ?? 0) >= 3) return false;
    if (row.block.board !== true) return false;
    if (row.stat === "anytime_td") {
      const floor = f.stat === "anytime_td" ? 0.22 : 0.30;
      if (row.hit < floor) return false;
      if ((row.player.depth ?? 9) >= 2 && row.hit < 0.45) return false;
      if (row.odds != null && row.odds >= 800 && row.hit < 0.45) return false;
    }
    if (f.stat && row.stat !== f.stat) return false;
    if (row.stat !== "anytime_td" && row.hit * 100 < Number(f.min || 0)) return false;
    const game = (state.data.games || []).find(item => item.id === row.player.game);
    if (game && (game.completed || game.day === "thursday")) return false;
    if (f.day && f.day !== "all") {
      const day = game && game.day;
      if (f.day === "sunday" && day !== "sunday") return false;
      if (f.day === "monday" && day !== "monday") return false;
    }
    return true;
  }).sort((a, b) => (b.edge == null ? -999 : b.edge) - (a.edge == null ? -999 : a.edge) || b.hit - a.hit);
}

function edgeGroup(row) {
  const ev = row.edge;
  if (ev != null && ev > 0.35) return 2;
  if (ev != null && ev >= 0.04 && ev <= 0.22) return 0;
  if (ev != null && ev > 0) return 1;
  return 3;
}

function render() {
  setTimeout(updateBackBtn, 0);
  const reviewWeek = state.review && state.review.week ? state.review.week : "";
  const title = { stats: (state.statsFor && state.statsFor.name ? state.statsFor.name + " · Season stats" : "Season stats"), board: "Board", games: "Matchups", match: "Matchup", calc: "Calculator", slip: "Bet slip", review: reviewWeek ? ("Week " + reviewWeek + " Review") : "Review", streaks: "Alt streaks", warroom: "War Room", player: state.player || "Player" };
  const live = document.getElementById("week-live");
  if (live && state.data) live.textContent = "WEEK " + state.data.week + " LIVE SIM";
  document.getElementById("title").textContent = title[state.tab] || "Board";
  const slipN = loadSlip().length;
  const badge = document.getElementById("slip-count");
  if (badge) {
    badge.textContent = String(slipN);
    badge.hidden = slipN === 0;
  }
  const when = state.data ? state.data.generated_at : "no file yet";
  document.getElementById("stamp").textContent = state.data
    ? "Week " + state.data.week + " · " + state.data.n_sims.toLocaleString() + " draws · updated " + when
      + (state.sync ? " · " + state.sync : "")
    : "No published week. Run nfl-publish.";
  const navTab = state.tab === "player" || state.tab === "stats" ? "board" : state.tab === "match" ? "games" : state.tab;
  document.querySelectorAll("nav button").forEach(btn => btn.classList.toggle("on", btn.dataset.tab === navTab));
  const app = document.getElementById("app");
  app.innerHTML = "";
  if (!state.data) {
    app.textContent = "The week file did not load. Use Refresh when a new JSON is published.";
    return;
  }
  if (state.tab === "board" || state.tab === "games" || state.tab === "calc" || state.tab === "player") app.append(rosterPill());
  if (state.tab === "board") renderBoard(app);
  else if (state.tab === "games") renderGames(app);
  else if (state.tab === "match") renderMatch(app);
  else if (state.tab === "calc") renderCalc(app);
  else if (state.tab === "slip") renderSlip(app);
  else if (state.tab === "review") renderReview(app);
  else if (state.tab === "streaks") renderStreaks(app);
  else if (state.tab === "warroom") renderWarRoom(app);
  else if (state.tab === "stats") renderStats(app);
  else renderPlayer(app);
}

function qPill(player) {
  if (player.injury_status !== "Q") return "";
  return " <span class='q'>Q" + (player.injury_note ? " " + player.injury_note : "") + "</span>";
}

function renderBoard(app) {
  const promo = document.createElement("button");
  promo.type = "button";
  promo.className = "slip home-streak";
  promo.innerHTML = "<div><strong>Alt line streaks</strong><div class='meta'>10 straight only matters if the price still pays.</div></div><span>Open</span>";
  promo.onclick = () => navTo("streaks");
  app.append(promo);
  const war = document.createElement("button");
  war.type = "button";
  war.className = "slip home-streak";
  war.innerHTML = "<div><strong>War Room</strong><div class='meta'>Four personas, one meeting ground, one Bet of the Night.</div></div><span>Open</span>";
  war.onclick = () => navTo("warroom");
  app.append(war);
  const f = state.filters;
  const sundayN = state.data.games.filter(game => game.day === "sunday" && !game.completed).length;
  const days = document.createElement("div");
  days.className = "seg";
  [["sunday", "Sunday Slate (" + sundayN + ")"], ["monday", "MNF"], ["all", "All Week " + state.data.week]].forEach(([id, label]) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (f.day === id) btn.className = "on";
    btn.onclick = () => { f.day = id; render(); };
    days.append(btn);
  });
  app.append(days);
  const cats = document.createElement("div");
  cats.className = "pills";
  [["", "🔥 All Props"], ["pass_yds", "🎯 Pass Yds"], ["rush_yds", "🏃 Rush Yds"], ["rec_yds", "🙌 Rec Yds"], ["receptions", "🧤 Receptions"], ["pass_td", "🚀 Pass TDs"], ["anytime_td", "🏈 Anytime TD"]].forEach(([id, label]) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    if ((f.stat || "") === id) btn.className = id === "anytime_td" ? "on hot" : "on";
    btn.onclick = () => { f.stat = id; render(); };
    cats.append(btn);
  });
  app.append(cats);
  const box = document.createElement("div");
  box.className = "filters";
  box.append(field("search", f.q, v => { f.q = v; render(); }, "Search players"));
  box.append(select(games(), f.game, v => { f.game = v; render(); }, "All games"));
  box.append(select(teams(), f.team, v => { f.team = v; render(); }, "All teams"));
  box.append(select(["QB","RB","WR","TE","FB"], f.pos, v => { f.pos = v; render(); }, "All positions"));
  box.append(select(STATS, f.stat, v => { f.stat = v; render(); }, "All markets", MARKET));
  box.append(field("number", f.min, v => { f.min = v; render(); }, "Min %"));
  app.append(box);
  const list = document.createElement("div");
  list.className = "board";
  const found = rows();
  if (!found.length) {
    const empty = document.createElement("p");
    empty.className = "meta";
    empty.textContent = "No props match these filters.";
    app.append(empty);
  }
  found.slice(0, 80).forEach(row => list.append(propCard(row)));
  app.append(list);
}

function propCard(row) {
  const card = document.createElement("button");
  card.className = "card";
  paintTeam(card, row.player.team);
  card.append(logoEl(row.player.team, "wm"));
  const who = document.createElement("div");
  who.className = "who";
  who.append(avatarEl(row.player));
  const id = document.createElement("div");
  const title = document.createElement("div");
  title.className = "name";
  title.textContent = row.player.name;
  const chips = document.createElement("div");
  chips.className = "chips";
  chips.append(logoEl(row.player.team));
  const pos = document.createElement("span");
  pos.className = "pos " + (row.player.pos || "");
  pos.textContent = row.player.pos || "";
  const game = document.createElement("span");
  game.className = "chip";
  game.textContent = row.player.game || "";
  chips.append(pos, game);
  if (row.player.injury_status === "Q") {
    const q = document.createElement("span");
    q.className = "q";
    q.textContent = "Q" + (row.player.injury_note ? " · " + row.player.injury_note : "");
    chips.append(q);
  }
  id.append(title, chips);
  who.append(id);
  const hero = document.createElement("div");
  hero.className = "hero-box";
  const left = document.createElement("div");
  const market = document.createElement("div");
  market.className = "market";
  market.textContent = marketLabel(row.stat);
  const line = document.createElement("div");
  line.className = "line";
  line.textContent = bestLine(row);
  const fair = document.createElement("div");
  fair.className = "fair";
  fair.textContent = row.fair == null ? "Fair —" : "Fair " + priceText(row.fair);
  left.append(market, line, fair);
  const ring = document.createElement("div");
  ring.className = "ring " + toneClass(row.hit);
  ring.style.setProperty("--p", String(Math.max(4, Math.round(row.hit * 100))));
  const pct = document.createElement("span");
  pct.textContent = (Math.round(row.hit * 1000) / 10).toFixed(1) + "%";
  ring.append(pct);
  hero.append(left, ring);
  const foot = document.createElement("div");
  foot.className = "foot";
  const books = bookStrip(row);
  if (books) foot.append(books);
  else {
    const source = document.createElement("span");
    source.className = "meta";
    source.textContent = row.stat === "anytime_td" ? "YES only · enter a book price for EV" : "Proj .5 line · enter DK/FD line";
    foot.append(source);
  }
  const kelly = quarterKelly(row.hit, row.odds);
  if (kelly > 0) {
    const unit = document.createElement("span");
    unit.className = "meta";
    unit.textContent = kelly.toFixed(2) + "u quarter-Kelly · cap 1u";
    foot.append(unit);
  }
  if (row.edge != null && row.edge > 0.35) {
    const role = document.createElement("span");
    role.className = "caution";
    role.textContent = "Role/news discrepancy";
    foot.append(role);
  } else if (row.player.usage_flag) {
    const caution = document.createElement("span");
    caution.className = "caution";
    caution.textContent = row.player.usage_flag === "high" ? "Hot usage" : "Usage caution";
    foot.append(caution);
  }
  card.append(who, hero, foot);
  card.onclick = () => openPlayer(row.player.name, row.stat, row.line);
  return card;
}

function bestLine(row) {
  if (row.stat === "anytime_td") return "1+ TD";
  const side = row.side === "under" ? "UNDER " : "OVER ";
  return side + fmtLine(row.line);
}

function bookLabel(key, offer, row, best) {
  const tag = key.toUpperCase();
  if (row.stat === "anytime_td") return (best ? "BEST: " : "") + tag + " YES " + priceText(offer.yes);
  if (best) {
    const price = row.side === "under" ? offer.under : offer.over;
    return "BEST: " + tag + " " + row.side.toUpperCase() + " " + fmtLine(offer.line) + " (" + priceText(price) + ")";
  }
  return tag + " " + fmtLine(offer.line) + " (" + priceText(offer.over) + ")";
}

function bookStrip(row) {
  const books = row.block.books;
  if (!books) return null;
  const wrap = document.createElement("div");
  wrap.className = "books";
  ["dk", "fd"].forEach(key => {
    const offer = books[key];
    if (!offer) return;
    const best = (row.block.best_book || "").toLowerCase() === key;
    const pill = document.createElement("span");
    pill.className = "book " + key + (best ? " best" : "");
    pill.textContent = bookLabel(key, offer, row, best);
    wrap.append(pill);
  });
  if (row.edge != null) {
    const badge = document.createElement("span");
    badge.className = "evbadge" + (row.edge > 0 ? " up" : "");
    badge.textContent = (row.edge >= 0 ? "+" : "") + (row.edge * 100).toFixed(1) + "% EV";
    wrap.append(badge);
  }
  const sim = document.createElement("span");
  sim.className = "chip";
  sim.textContent = row.stat === "anytime_td"
    ? "Sim " + (Math.round(row.block.mean * 1000) / 10).toFixed(1) + "%"
    : "Sim " + row.block.mean;
  wrap.append(sim);
  return wrap;
}

function fillBook(player, stat) {
  const block = player && player.stats && player.stats[stat];
  if (!block || !block.books) return;
  const offer = block.books[(block.best_book || "dk").toLowerCase()] || block.books.dk || block.books.fd;
  if (!offer) return;
  state.line = offer.line != null ? offer.line : block.line;
  if (stat === "anytime_td") {
    state.side = "over";
    if (offer.yes != null) state.odds = String(offer.yes);
    return;
  }
  state.side = block.board_side === "under" ? "under" : "over";
  const price = state.side === "under" ? offer.under : offer.over;
  if (price != null) state.odds = String(price);
}

function bookPicks(player, stat) {
  const books = player.stats[stat] && player.stats[stat].books;
  if (!books) return null;
  const row = document.createElement("div");
  row.className = "pills";
  ["dk", "fd"].forEach(key => {
    const offer = books[key];
    if (!offer) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "book " + key;
    const price = stat === "anytime_td" ? offer.yes : offer.over;
    btn.textContent = key.toUpperCase() + " " + fmtLine(offer.line) + " (" + priceText(price) + ")";
    btn.onclick = () => {
      state.line = offer.line;
      state.side = "over";
      if (price != null) state.odds = String(price);
      render();
    };
    row.append(btn);
  });
  return row;
}

function renderGames(app) {
  const f = state.filters;
  const sundayN = state.data.games.filter(game => game.day === "sunday" && !game.completed).length;
  const days = document.createElement("div");
  days.className = "seg";
  [["sunday", "Sunday Slate (" + sundayN + ")"], ["monday", "MNF"], ["all", "All Week " + state.data.week]].forEach(([id, label]) => {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (f.day === id) btn.className = "on";
    btn.onclick = () => { f.day = id; render(); };
    days.append(btn);
  });
  app.append(days);
  const grid = document.createElement("div");
  grid.className = "games";
  state.data.games.forEach(game => {
    if (game.completed || game.day === "thursday") return;
    if (state.filters.day === "sunday" && game.day !== "sunday") return;
    if (state.filters.day === "monday" && game.day !== "monday") return;
    const card = document.createElement("article");
    card.className = "slip match-card";
    const away = club(game.away);
    const home = club(game.home);
    const split = document.createElement("div");
    split.className = "split";
    split.style.setProperty("--away", away.primary);
    split.style.setProperty("--home", home.primary);
    const left = document.createElement("div");
    left.className = "side";
    left.append(logoEl(game.away, "lg"), document.createTextNode(game.away));
    const right = document.createElement("div");
    right.className = "side right";
    right.append(document.createTextNode(game.home), logoEl(game.home, "lg"));
    split.append(left, right);
    const body = document.createElement("div");
    body.className = "match-body";
    const when = document.createElement("div");
    when.textContent = game.kickoff_ct || game.date || "";
    const pills = document.createElement("div");
    pills.className = "pills-inline";
    [game.spread_label || ("Spread " + (game.spread ?? "—")), "O/U " + (game.total ?? "—"), weatherBadge(game)].forEach(text => {
      const pill = document.createElement("span");
      pill.className = "chip";
      pill.textContent = text;
      pills.append(pill);
    });
    const go = document.createElement("button");
    go.className = "go";
    go.type = "button";
    go.textContent = "Simulate Matchup →";
    go.onclick = (event) => { event.stopPropagation(); openMatch(game.id); };
    body.append(when, pills, go);
    card.append(split, body);
    card.onclick = () => openMatch(game.id);
    grid.append(card);
  });
  app.append(grid);
}

function renderCalc(app) {
  const names = state.data.players.filter(player => {
    const game = state.data.games.find(item => item.id === player.game);
    return !(game && (game.completed || game.day === "thursday"));
  }).map(p => p.name).sort();
  const player = (state.override && state.override.name === state.player)
    ? state.override
    : (state.data.players.find(p => p.name === state.player) || state.data.players[0]);
  state.player = player.name;
  const stat = player.stats[state.stat] ? state.stat : Object.keys(player.stats)[0];
  state.stat = stat;
  const block = player.stats[stat];
  if (state.line == null) state.line = block.line ?? block.mean;
  if (!state.odds && block.books) fillBook(player, stat);
  const box = document.createElement("div");
  box.className = "filters";
  box.append(select(names, player.name, v => {
    state.override = null;
    state.player = v;
    const next = state.data.players.find(item => item.name === v);
    const nextStat = next && next.stats[state.stat] ? state.stat : Object.keys((next && next.stats) || {})[0];
    state.stat = nextStat;
    state.line = null;
    fillBook(next, nextStat);
    render();
  }, ""));
  box.append(select(Object.keys(player.stats), stat, v => { state.stat = v; state.line = null; fillBook(player, v); render(); }, "", MARKET));
  const stepper = document.createElement("div");
  stepper.className = "stepper";
  const down = document.createElement("button");
  down.type = "button";
  down.textContent = "−0.5";
  down.onclick = () => { state.line = Math.round((Number(state.line) - 0.5) * 2) / 2; render(); };
  const line = document.createElement("input");
  line.type = "number";
  line.step = "0.5";
  line.value = state.line;
  line.setAttribute("aria-label", "Line");
  line.onblur = () => { state.line = Number(line.value); render(); };
  const up = document.createElement("button");
  up.type = "button";
  up.textContent = "+0.5";
  up.onclick = () => { state.line = Math.round((Number(state.line) + 0.5) * 2) / 2; render(); };
  stepper.append(down, line, up);
  const odds = document.createElement("input");
  odds.placeholder = "Book odds";
  odds.value = state.odds;
  odds.setAttribute("aria-label", "Book odds");
  odds.onblur = () => { state.odds = odds.value; render(); };
  box.append(stepper, odds);
  const picks = bookPicks(player, stat);
  if (picks) box.append(picks);
  app.append(box);
  drawQuote(app, player, stat, block, Number(state.line));
}

function renderPlayer(app) {
  const player = state.data.players.find(p => p.name === state.player);
  if (!player) { state.tab = "board"; render(); return; }
  const head = document.createElement("p");
  head.innerHTML = "<strong>" + player.name + "</strong> " + player.pos + " " + player.team + " vs " + player.opp
    + "<br><span class='meta'>" + (player.move ? "Roster move: " + player.move + ". " : "") + (player.defense || "No defense rank") + ". Out: " + ((player.out || []).join(", ") || "none on the latest report") + "</span>";
  app.append(head);
  app.append(statsButton(player));
  const grid = splitsGrid(player);
  if (grid) app.append(grid);
  Object.keys(player.stats).forEach(stat => {
    const btn = document.createElement("button");
    btn.className = "ghost";
    btn.textContent = marketLabel(stat);
    btn.onclick = () => { pushNav(); state.stat = stat; state.line = player.stats[stat].line ?? player.stats[stat].mean; state.tab = "calc"; render(); };
    app.append(btn);
  });
  const block = player.stats[state.stat] || player.stats[Object.keys(player.stats)[0]];
  const stat = player.stats[state.stat] ? state.stat : Object.keys(player.stats)[0];
  drawQuote(app, player, stat, block, Number(state.line ?? block.line ?? block.mean));
}

function drawQuote(app, player, stat, block, line) {
  const p = block.line != null && Number(line) === Number(block.line) ? learnAdjust(stat, probs(block.q, line), block) : probs(block.q, line);
  const card = document.createElement("article");
  card.className = "calc-hero";
  paintTeam(card, player.team);
  card.style.background = "linear-gradient(120deg, " + club(player.team).primary + " 0%, rgba(7,11,20,0.2) 46%, " + club(player.team).secondary + " 140%), rgba(17,25,42,0.82)";
  card.append(logoEl(player.team, "wm"));
  const who = document.createElement("div");
  who.className = "who";
  who.append(avatarEl(player, "lg"), logoEl(player.team, "lg"));
  const id = document.createElement("div");
  const title = document.createElement("div");
  title.className = "name";
  title.textContent = player.name;
  const sub = document.createElement("div");
  sub.className = "chips";
  const pos = document.createElement("span");
  pos.className = "pos " + (player.pos || "");
  pos.textContent = player.pos || "";
  const mk = document.createElement("span");
  mk.className = "market";
  mk.textContent = marketLabel(stat) + " " + fmtLine(line);
  sub.append(pos, mk);
  if (player.injury_status === "Q") {
    const q = document.createElement("span");
    q.className = "q";
    q.textContent = "Q";
    sub.append(q);
  }
  const mean = document.createElement("div");
  mean.className = "meta";
  mean.textContent = "Mean " + block.mean + (player.defense ? " · " + player.defense : "") + (weatherFor(player) ? " · " + weatherFor(player) : "");
  if (player.pos === "QB" && player.untargeted_rate != null) {
    mean.textContent += " · Untargeted " + (Math.round(player.untargeted_rate * 1000) / 10).toFixed(1) + "%";
  }
  id.append(title, sub, mean);
  who.append(id);
  const fairOver = fairAmerican(p.over, p.push);
  const fairUnder = fairAmerican(p.under, p.push);
  const dual = document.createElement("div");
  dual.className = "dual";
  [["over", "OVER", p.over, fairOver], ["under", "UNDER", p.under, fairUnder]].forEach(([cls, label, prob, fair]) => {
    const tile = document.createElement("button");
    tile.type = "button";
    tile.className = "statcard " + cls + (state.side === cls ? " on" : "");
    tile.innerHTML = "<div class='k'>" + label + " " + Math.round(prob * 100) + "%</div><div class='v'>" + priceText(fair) + "</div><div class='meta'>Fair " + priceText(fair) + "</div>";
    tile.onclick = () => { state.side = cls; render(); };
    dual.append(tile);
  });
  card.append(who, dual);
  const note = document.createElement("div");
  note.className = "meta";
  note.textContent = block.line_source === "live" && block.line != null
    ? "Live DK line " + fmtLine(block.line)
    : "No live DK line posted yet — enter your DraftKings/FanDuel line above";
  if (p.push) note.textContent += " · Push " + pct(p.push);
  if (p.raw) note.textContent += " · Review-adjusted (raw sim over " + pct(p.raw.over) + ")";
  card.append(note);
  const odds = parseOdds(state.odds);
  if (odds != null) {
    const win = state.side === "under" ? p.under : p.over;
    const ev = evPerUnit(win, odds, p.push);
    const badge = document.createElement("div");
    badge.className = "ev";
    badge.textContent = "EV " + pct(ev) + " at " + priceText(odds) + " " + state.side.toUpperCase();
    card.append(badge);
  }
  const grid = splitsGrid(player);
  if (grid) card.append(grid);
  card.append(statsButton(player));
  const save = document.createElement("button");
  save.className = "primary";
  save.textContent = "Save to slip";
  save.onclick = () => {
    const slip = loadSlip();
    slip.unshift({ id: Date.now(), player: player.name, game: player.game, stat, line, side: state.side, odds, p: state.side === "under" ? p.under : p.over, result: null });
    localStorage.setItem("kong-nfl-slip", JSON.stringify(slip.slice(0, 100)));
    navTo("slip");
  };
  card.append(save);
  app.append(card);
  app.append(chart(block.q, line));
  const slider = document.createElement("input");
  slider.type = "range";
  const lo = block.q[5], hi = block.q[95];
  slider.min = String(lo);
  slider.max = String(Math.max(hi, lo + 0.5));
  slider.step = "0.5";
  slider.value = String(line);
  slider.setAttribute("aria-label", "Line slider");
  slider.oninput = () => { state.line = Number(slider.value); state.tab = state.tab === "player" ? "player" : "calc"; render(); };
  app.append(slider);
}

function renderSlip(app) {
  const slip = loadSlip();
  const graded = slip.filter(row => row.result);
  const wins = graded.filter(row => row.result === "win").length;
  let units = 0;
  graded.forEach(row => {
    if (row.result === "push") return;
    if (row.result === "loss") { units -= 1; return; }
    const odds = row.odds || -110;
    units += odds > 0 ? odds / 100 : 100 / Math.abs(odds);
  });
  const summary = document.createElement("p");
  summary.textContent = graded.length
    ? "Record " + wins + "-" + graded.filter(r => r.result === "loss").length + ", " + units.toFixed(2) + " units"
    : "No graded picks yet. Saved picks stay on this iPad.";
  app.append(summary);
  const gameKeys = slip.map(row => row.game).filter(Boolean);
  if (gameKeys.some((game, index) => gameKeys.indexOf(game) !== index)) {
    const warn = document.createElement("p");
    warn.className = "caution";
    warn.textContent = "Same-game parlay: these legs are one game, not separate bets. Do not add the quarter-Kelly sizes together.";
    app.append(warn);
  }
  slip.forEach(row => {
    const card = document.createElement("article");
    card.className = "slip";
    card.innerHTML = "<strong>" + row.player + "</strong> " + marketLabel(row.stat) + " " + row.line + " " + String(row.side || "").toUpperCase()
      + "<div class='meta'>" + pct(row.p) + (row.result ? " · " + row.result : "") + "</div>";
    ["win", "loss", "push"].forEach(result => {
      const btn = document.createElement("button");
      btn.textContent = result;
      btn.onclick = () => { row.result = result; saveSlip(slip); render(); };
      card.append(btn);
    });
    app.append(card);
  });
}

function chart(q, line) {
  const wrap = document.createElement("div");
  wrap.className = "chart";
  const lo = q[2], hi = q[98];
  const bins = 12;
  const width = (hi - lo) / bins || 1;
  const counts = Array(bins).fill(0);
  for (let i = 0; i <= 100; i++) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((q[i] - lo) / width)));
    counts[idx] += 1;
  }
  const max = Math.max(...counts, 1);
  counts.forEach((count, idx) => {
    const left = lo + idx * width;
    const row = document.createElement("div");
    row.className = "bar";
    const label = document.createElement("span");
    label.textContent = left.toFixed(0);
    const track = document.createElement("span");
    const bar = document.createElement("i");
    if (left <= line && line < left + width) {
      bar.className = "mark";
      row.classList.add("threshold");
    } else if (left + width <= line) bar.className = "under";
    else bar.className = "over";
    bar.style.width = Math.round(100 * count / max) + "%";
    track.append(bar);
    const n = document.createElement("span");
    n.textContent = String(count);
    row.append(label, track, n);
    wrap.append(row);
  });
  return wrap;
}


const navStack = [];
const NAV_KEYS = ["tab", "player", "stat", "line", "odds", "side", "gameId", "override", "sim", "live", "statsFor", "warOpen", "reviewWeek", "statsYear"];
function snapNav() {
  const snap = { y: window.scrollY, outs: Object.assign({}, state.outs || {}) };
  NAV_KEYS.forEach(key => { snap[key] = state[key]; });
  return snap;
}
function pushNav() {
  navStack.push(snapNav());
  try { history.pushState({ kong: navStack.length }, ""); } catch (err) {}
}
function goBack() {
  const s = navStack.pop();
  if (!s) return;
  // Restore the exact view, including the sim that was already run. No re-sim.
  NAV_KEYS.forEach(key => { state[key] = s[key]; });
  state.outs = s.outs || {};
  render();
  requestAnimationFrame(() => window.scrollTo(0, s.y || 0));
}
window.addEventListener("popstate", () => { if (navStack.length) goBack(); });
function updateBackBtn() {
  let btn = document.getElementById("kong-back");
  if (!btn) {
    btn = document.createElement("button");
    btn.id = "kong-back";
    btn.type = "button";
    btn.textContent = "\u2190 Back";
    btn.setAttribute("aria-label", "Back to previous page");
    btn.style.cssText = "position:fixed;left:12px;top:calc(env(safe-area-inset-top,0px) + 10px);z-index:9999;padding:8px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.25);background:rgba(15,18,30,.85);color:#fff;font-weight:700;font-size:15px;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 4px 14px rgba(0,0,0,.4)";
    btn.onclick = () => { if (history.state && history.state.kong) history.back(); else goBack(); };
    document.body.appendChild(btn);
  }
  btn.style.display = navStack.length ? "block" : "none";
}

function navTo(tab) {
  if (state.tab === tab) { render(); return; }
  pushNav();
  state.tab = tab;
  render();
  window.scrollTo(0, 0);
}

function openPlayer(name, stat, line) {
  pushNav();
  state.override = null;
  state.player = name;
  state.stat = stat;
  state.line = line;
  state.tab = "calc";
  const player = state.data && state.data.players.find(item => item.name === name);
  fillBook(player, stat);
  render();
}

function games() { return state.data.games.map(g => g.id); }
function teams() { return [...new Set(state.data.players.map(p => p.team))].sort(); }
function select(options, value, on, blank, labels) {
  const node = document.createElement("select");
  if (blank) node.append(new Option(blank, ""));
  options.forEach(opt => node.append(new Option(labels && labels[opt] ? labels[opt] : opt, opt)));
  node.value = value || "";
  node.onchange = () => on(node.value);
  return node;
}
function field(type, value, on, label) {
  const node = document.createElement("input");
  node.type = type;
  node.placeholder = label;
  node.setAttribute("aria-label", label);
  node.value = value ?? "";
  node.oninput = () => on(node.value);
  return node;
}
function pct(n) { return (Math.round(n * 1000) / 10) + "%"; }
function loadSlip() { try { return JSON.parse(localStorage.getItem("kong-nfl-slip") || "[]"); } catch (err) { return []; } }
function saveSlip(rows) { localStorage.setItem("kong-nfl-slip", JSON.stringify(rows)); }

function weatherFor(player) {
  const game = (state.data.games || []).find(item => item.id === player.game);
  if (!game) return "";
  if (game.weather && game.weather.label) return weatherCompact((game.roof || "Outdoor") + " · " + game.weather.label);
  return game.roof || "";
}

function openMatch(id) {
  pushNav();
  const same = state.sim && state.sim.gameId === id;
  state.gameId = id;
  state.tab = "match";
  if (!same) state.sim = null;
  render();
}

function splitsGrid(player) {
  const splits = player && player.splits;
  if (!splits) return null;
  const wrap = document.createElement("div");
  wrap.className = "tiles";
  const success = splits.success && splits.success.matchup;
  const openPct = splits.open && splits.open.open_pct;
  const cards = [
    ["⚔️", "Vs Opponent", splits.last_vs || (splits.vs_opp && splits.vs_opp.line) || "No history", null],
    ["🏟️", "Indoor vs Outdoor", envLine(splits.env), null],
    ["🌤️", "Live Kickoff Weather", weatherCompact((splits.env && splits.env.sunday) || weatherFor(player)), null],
    ["📈", "Matchup Success Rate", (splits.success && splits.success.label) || "—", success],
    ["🔀", "Routes & Usage", routeLine(splits.routes), splits.routes && splits.routes.route_pct],
    ["📡", "Open % & Separation", openLine(splits.open), openPct],
  ];
  cards.forEach(([icon, title, body, meter]) => {
    if (!body) return;
    const card = document.createElement("article");
    card.className = "tile";
    const heading = document.createElement("h3");
    heading.textContent = icon + " " + title;
    const copy = document.createElement("div");
    copy.textContent = body;
    card.append(heading, copy);
    if (meter != null && Number.isFinite(+meter)) {
      const bar = document.createElement("div");
      bar.className = "mini";
      const fill = document.createElement("i");
      fill.style.width = Math.round(Math.max(0, Math.min(1, +meter)) * 100) + "%";
      bar.append(fill);
      card.append(bar);
    }
    wrap.append(card);
  });
  return wrap;
}

function envLine(env) {
  if (!env) return "";
  const inn = env.in_yds == null ? "n/a" : env.in_yds;
  const out = env.out_yds == null ? "n/a" : env.out_yds;
  return "Indoor " + inn + " (" + env.n_in + "g) · Outdoor " + out + " (" + env.n_out + "g)";
}

function routeLine(routes) {
  if (!routes || routes.routes_per_game == null) return "";
  return routes.routes_per_game + " routes/g · " + Math.round(routes.route_pct * 100) + "% route share · " + (routes.yprr == null ? "—" : routes.yprr) + " YPRR · " + (routes.tprr == null ? "—" : Math.round(routes.tprr * 1000) / 10 + "%") + " TPRR";
}

function openLine(open) {
  if (!open || open.open_pct == null) return "";
  const sep = open.sep == null ? "—" : open.sep;
  const delta = open.league_sep == null || open.sep == null ? "" : " (" + (open.sep - open.league_sep >= 0 ? "+" : "") + (Math.round((open.sep - open.league_sep) * 10) / 10) + " vs NFL)";
  const cushion = open.cushion == null ? "" : " · " + open.cushion + " yds cushion";
  return Math.round(open.open_pct * 1000) / 10 + "% Open · " + sep + " yds Sep" + delta + cushion;
}

function renderMatch(app) {
  const game = (state.data.games || []).find(item => item.id === state.gameId);
  if (!game || !game.engine) {
    app.textContent = "This game has no sim factors yet. Publish a new week file.";
    return;
  }
  const back = document.createElement("button");
  back.className = "ghost";
  back.textContent = "← All matchups";
  back.onclick = () => navTo("games");
  app.append(back);
  const head = document.createElement("article");
  head.className = "scoreboard";
  const awayStyle = club(game.away);
  const homeStyle = club(game.home);
  head.style.background = "linear-gradient(90deg, " + awayStyle.primary + " 0%, " + awayStyle.primary + " 46%, " + homeStyle.primary + " 54%, " + homeStyle.primary + " 100%)";
  const split = document.createElement("div");
  split.className = "score-split";
  const left = document.createElement("div");
  left.className = "club";
  left.append(logoEl(game.away, "lg"), document.createTextNode(game.away));
  const mid = document.createElement("div");
  mid.className = "score";
  const simmed = state.sim && state.sim.gameId === game.id;
  const awayScore = simmed ? state.sim.away.score : ((+game.engine.total + +game.engine.homeSpread) / 2);
  const homeScore = simmed ? state.sim.home.score : ((+game.engine.total - +game.engine.homeSpread) / 2);
  mid.textContent = game.away + " " + Number(awayScore).toFixed(1) + " – " + Number(homeScore).toFixed(1) + " " + game.home;
  const right = document.createElement("div");
  right.className = "club right";
  right.append(document.createTextNode(game.home), logoEl(game.home, "lg"));
  split.append(left, mid, right);
  const homeWin = simmed ? state.sim.homeWin : null;
  const tug = document.createElement("div");
  tug.className = "tug";
  tug.style.setProperty("--away", awayStyle.primary);
  tug.style.setProperty("--home", homeStyle.primary);
  const awayBar = document.createElement("i");
  awayBar.className = "away";
  const homeBar = document.createElement("i");
  homeBar.className = "home";
  const homePct = homeWin == null ? 50 : Math.round(homeWin * 1000) / 10;
  awayBar.style.width = (100 - homePct) + "%";
  homeBar.style.width = homePct + "%";
  tug.append(awayBar, homeBar);
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.style.padding = "0 16px 8px";
  meta.textContent = (game.kickoff_ct || "") + " · " + (game.spread_label || "spread " + (game.spread ?? "—"))
    + " · Total " + (simmed ? state.sim.total.toFixed(1) : (game.total ?? "—"))
    + " · " + weatherBadge(game)
    + (simmed ? " · Home win " + homePct + "% · " + state.sim.n.toLocaleString() + " draws" : " · Vegas implied");
  const row = document.createElement("div");
  row.className = "sim-row";
  [[1000, "⚡ Sim 1,000×", "k"], [10000, "🔥 Sim 10,000×", "hot"]].forEach(([n, label, cls]) => {
    const btn = document.createElement("button");
    btn.className = cls;
    btn.textContent = label;
    btn.onclick = () => runSim(game, n);
    row.append(btn);
  });
  head.append(split, tug, meta, row);
  app.append(head);
  app.append(weightStrip(game));
  ["away", "home"].forEach(key => {
    const side = game.engine[key];
    (side.removed || []).forEach(item => {
      const banner = document.createElement("div");
      banner.className = "banner";
      const out = document.createElement("span");
      out.className = "out-chip";
      out.textContent = item.name + " " + String(item.status || "out").toUpperCase();
      banner.append(logoEl(side.team), out);
      const inn = document.createElement("span");
      inn.className = "in-chip";
      inn.textContent = item.replaced_by ? item.replaced_by + " inserted at " + item.pos : "snaps redistributed";
      banner.append(inn);
      app.append(banner);
    });
  });
  app.append(lineupToggles(game));
  if (state.sim && state.sim.gameId === game.id) {
    ["away", "home"].forEach(key => renderBox(app, game, key));
  }
}

function weightStrip(game) {
  const card = document.createElement("article");
  card.className = "slip";
  const away = game.engine.away;
  const home = game.engine.home;
  const spread = +game.engine.homeSpread || 0;
  const total = +game.engine.total || 0;
  const homePts = total ? ((total - spread) / 2).toFixed(1) : "—";
  const awayPts = total ? ((total + spread) / 2).toFixed(1) : "—";
  const title = document.createElement("strong");
  title.textContent = "Trench & coverage edge";
  card.append(title);
  card.append(edgeMeter(game.away + " pass block vs " + game.home + " pass rush", away.madden_ol_pb, home.madden_dl_pr));
  card.append(edgeMeter(game.home + " pass block vs " + game.away + " pass rush", home.madden_ol_pb, away.madden_dl_pr));
  card.append(edgeMeter(game.away + " run block vs " + game.home + " front", away.madden_ol_rb, home.madden_run_def));
  card.append(edgeMeter(game.home + " run block vs " + game.away + " front", home.madden_ol_rb, away.madden_run_def));
  const note = document.createElement("div");
  note.className = "meta";
  note.textContent = "Coverage " + (home.madden_cov ?? "—") + " / " + (away.madden_cov ?? "—")
    + " · Pace " + (away.pace ?? "—") + " / " + (home.pace ?? "—")
    + " · PROE " + (away.proe ?? "—") + " / " + (home.proe ?? "—")
    + " · Vegas " + awayPts + " – " + homePts;
  card.append(note);
  card.append(coverageLine(game));
  const legend = document.createElement("p");
  legend.className = "meta";
  legend.textContent = "Line edge is the offensive grade minus the defensive grade. +6 means the line grades 6 points higher than the front. That is about +2.4% yards per carry on a run edge, and +1.8% pass yards with about −0.9 points of sack rate on a pass edge. It does not change who gets the carries. A blitz or man-coverage tilt then nudges the quarterback by at most 2.5 completion points, 0.35 YPA, and 1.5 sack points, shrunk when the sample is small.";
  card.append(legend);
  return card;
}

function pct(value) {
  return value == null ? "—" : Math.round(value * 1000) / 10 + "%";
}

function coverageLine(game) {
  const line = document.createElement("p");
  line.className = "meta";
  const bits = ["away", "home"].map(key => {
    const side = game.engine[key];
    const qb = (side.players || []).find(player => player.pos === "QB" && player.status !== "out");
    const blitz = pct(side.blitz_rate);
    const man = pct(side.man_rate);
    const zone = pct(side.zone_rate);
    let counter = "";
    if (qb && qb.qb_blitz_comp != null) {
      counter = " " + qb.name.split(" ").slice(-1)[0] + " vs blitz " + pct(qb.qb_blitz_comp) + " comp, " + Number(qb.qb_blitz_ypa).toFixed(1) + " YPA";
      if (qb.qb_blitz_td != null && qb.qb_blitz_int != null) counter += ", TD/INT " + Number(qb.qb_blitz_td).toFixed(1) + "/" + Number(qb.qb_blitz_int).toFixed(1) + "%";
    }
    return side.team + " blitz " + blitz + " · man " + man + " / zone " + zone + counter;
  });
  line.textContent = bits.join("  ·  ");
  return line;
}

function edgeMeter(label, left, right) {
  const wrap = document.createElement("div");
  wrap.className = "edge";
  const lab = document.createElement("div");
  lab.className = "lab";
  const gap = left == null || right == null ? null : Math.round((left - right) * 10) / 10;
  lab.title = "Offensive grade minus defensive grade. +6 is about +2.4% yards per carry or −0.9 points of sack rate. Carry counts stay with the backfield roles.";
  lab.innerHTML = "<span>" + label + "</span><span>" + (left ?? "—") + " vs " + (right ?? "—") + (gap == null ? "" : " (" + (gap > 0 ? "+" : "") + gap + ")") + "</span>";
  const track = document.createElement("div");
  track.className = "track";
  const a = document.createElement("b");
  const b = document.createElement("b");
  const scale = (Number(left) || 0) + (Number(right) || 0) || 1;
  a.style.width = Math.round(100 * (Number(left) || 0) / scale) + "%";
  b.style.width = Math.round(100 * (Number(right) || 0) / scale) + "%";
  a.className = gap != null && gap >= 0 ? "good" : "l";
  b.className = "r";
  track.append(a, b);
  wrap.append(lab, track);
  return wrap;
}

function lineupToggles(game) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  ["away", "home"].forEach(key => {
    const side = game.engine[key];
    ["players", "ol", "dl", "cb", "lb", "s", "k"].forEach(group => (side[group] || []).forEach(player => {
      if (!player || !player.name) return;
      if (player.status === "out" && !state.outs[player.name]) return;
      const label = document.createElement("label");
      const active = !state.outs[player.name] && player.status !== "out";
      label.className = "toggle" + (active ? "" : " off");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = active;
      input.onchange = () => {
        state.outs[player.name] = !input.checked;
        state.sim = null;
        render();
      };
      const person = { name: player.name, team: side.team, espn_id: player.espn_id };
      label.append(input, avatarEl(person, "sm"), document.createTextNode(player.name + " " + (player.pos || group) + (player.status === "Q" ? " Q" : "")));
      wrap.append(label);
    }));
  });
  return wrap;
}

function runSim(game, n) {
  const spec = JSON.parse(JSON.stringify(game.engine));
  ["away", "home"].forEach(key => {
    (spec[key].players || []).forEach(player => {
      if (state.outs[player.name]) { player.status = "out"; player.forcedOut = true; }
    });
    ["ol", "dl", "cb", "lb", "s", "k"].forEach(group => {
      (spec[key][group] || []).forEach(player => { if (state.outs[player.name]) player.status = "out"; });
    });
  });
  const started = performance.now();
  const result = KongSim.simulateMatchup(spec, n, 20261108);
  result.ms = Math.round(performance.now() - started);
  result.gameId = game.id;
  state.sim = result;
  state.live = {};
  ["away", "home"].forEach(key => {
    result[key].players.forEach(player => { state.live[player.name] = player; });
  });
  render();
}

function renderBox(app, game, key) {
  const side = state.sim[key];
  const title = document.createElement("h2");
  title.className = "who";
  title.append(logoEl(game.engine[key].team, "lg"), document.createTextNode(game.engine[key].team));
  app.append(title);
  const starter = (game.engine[key].players || []).find(player => player.pos === "QB" && player.status !== "out");
  if (starter && starter.untargeted_rate != null) {
    const note = document.createElement("p");
    note.className = "meta";
    const pct = (Math.round(starter.untargeted_rate * 1000) / 10).toFixed(1);
    note.textContent = starter.untargeted_sample >= 80
      ? "Untargeted attempts " + pct + "% of " + starter.name + "'s 2026 dropbacks. Team targets = attempts × " + (100 - Number(pct)).toFixed(1) + "%."
      : "Untargeted attempts " + pct + "% (league average; small 2026 sample).";
    app.append(note);
  }
  const passing = side.players.filter(player => player.pos === "QB" && player.att >= 1);
  const rushing = side.players.filter(player => player.carries >= 0.5);
  const receiving = side.players.filter(player => player.pos !== "QB" && player.targets >= 0.5);
  app.append(statTable("Passing", passing, [
    ["name", "Player"], ["compAtt", "Comp/Att"], ["compPct", "Comp%"], ["passYds", "Pass Yds"], ["passTd", "Pass TDs"], ["int", "INTs"], ["why", "Vs / In-Out / Succ"],
  ], game));
  app.append(statTable("Rushing", rushing, [
    ["name", "Player"], ["carries", "Carries"], ["rushYds", "Rush Yds"], ["ypc", "Yds/Carry"], ["rushTd", "Rush TDs"], ["why", "Vs / Succ"],
  ], game));
  app.append(statTable("Receiving", receiving, [
    ["name", "Player"], ["targets", "Targets"], ["rec", "Rec"], ["recYds", "Rec Yds"], ["ypr", "Yds/Rec"], ["recTd", "Rec TDs"], ["why", "Routes / Open / Succ"],
  ], game));
  app.append(statTable("Touchdowns", side.players.filter(player => player.pos !== "QB" || player.carries >= 0.5), [
    ["name", "Player"], ["anytime", "Anytime TD %"], ["scoreTd", "Avg rush+rec TDs"],
  ], game));
}

function statTable(caption, players, columns, game) {
  const table = document.createElement("table");
  table.className = "box";
  const cap = document.createElement("caption");
  cap.textContent = caption;
  table.append(cap);
  const head = document.createElement("tr");
  columns.forEach(col => {
    const cell = document.createElement("th");
    cell.textContent = col[1];
    cell.onclick = () => {
      state.sort = { key: col[0], dir: state.sort.key === col[0] ? -state.sort.dir : 1 };
      render();
    };
    head.append(cell);
  });
  table.append(head);
  const rows = players.slice().sort((a, b) => (num(a, state.sort.key) - num(b, state.sort.key)) * state.sort.dir);
  rows.forEach(player => {
    const tr = document.createElement("tr");
    columns.forEach(col => {
      const td = document.createElement("td");
      if (col[0] === "name") {
        const cell = document.createElement("div");
        cell.className = "player-cell";
        cell.append(avatarEl({ name: player.name, team: teamFor(game, player.name), espn_id: player.espn_id }, "sm"));
        const label = document.createElement("span");
        label.textContent = player.name;
        cell.append(label);
        td.append(cell);
      } else if (col[0] === "anytime") {
        const rate = player.anytime || 0;
        const pill = document.createElement("span");
        pill.className = "tdpill " + (rate >= 0.5 ? "hot" : rate >= 0.3 ? "mid" : "cool");
        pill.textContent = Math.round(rate * 1000) / 10 + "%";
        td.append(pill);
      } else td.textContent = cellText(player, col[0], caption);
      tr.append(td);
    });
    tr.onclick = () => openSimPlayer(player, caption);
    table.append(tr);
  });
  return table;
}

function teamFor(game, name) {
  for (const key of ["away", "home"]) {
    const side = game.engine && game.engine[key];
    if (side && (side.players || []).some(player => player.name === name)) return side.team;
  }
  return "";
}

function num(player, key) {
  if (key === "name") return player.name;
  if (key === "compAtt") return player.att;
  if (key === "compPct") return player.att ? player.comp / player.att : 0;
  if (key === "ypc") return player.carries ? player.rushYds / player.carries : 0;
  if (key === "ypr") return player.rec ? player.recYds / player.rec : 0;
  if (key === "scoreTd") return player.rushTd + player.recTd;
  if (key === "why") return player.targets || player.carries || 0;
  return player[key] || 0;
}

function cellText(player, key, caption) {
  const splits = player.splits || {};
  if (key === "name") return player.name + (caption === "Receiving" && player.role ? " · " + player.role : "");
  if (key === "compAtt") return player.comp.toFixed(1) + " / " + player.att.toFixed(1);
  if (key === "compPct") return player.att ? Math.round(1000 * player.comp / player.att) / 10 + "%" : "—";
  if (key === "ypc") return player.carries ? (player.rushYds / player.carries).toFixed(2) : "—";
  if (key === "ypr") return player.rec ? (player.recYds / player.rec).toFixed(2) : "—";
  if (key === "anytime") return Math.round(player.anytime * 1000) / 10 + "%";
  if (key === "scoreTd") return (player.rushTd + player.recTd).toFixed(2);
  if (key === "why") return whyText(splits, caption, player);
  if (typeof player[key] === "number") return player[key].toFixed(1);
  return "—";
}

function whyText(splits, caption, player) {
  const bits = [];
  const receiving = caption === "Receiving";
  const rushing = caption === "Rushing";
  const pack = receiving ? (splits.receiving || {}) : rushing ? (splits.rushing || {}) : {};
  const env = receiving || rushing ? (pack.env || {}) : (splits.env || {});
  const versus = receiving || rushing ? (pack.vs_opp || {}) : (splits.vs_opp || {});
  const routes = receiving ? ((pack.routes) || splits.routes) : null;
  const open = receiving ? ((pack.open) || splits.open) : null;
  const person = player || {};
  if (receiving && person.role) bits.push(person.role);
  if (receiving && person.slot_rate != null) bits.push(Math.round(person.slot_rate * 100) + "% slot");
  if (receiving && person.adot != null) bits.push(person.adot + " aDOT");
  if (routes && routes.routes_per_game != null) bits.push(routes.routes_per_game + " rte");
  if (open && open.open_pct != null) bits.push(Math.round(open.open_pct * 100) + "% open");
  if (open && open.sep != null) bits.push(open.sep + " sep");
  if (!receiving && !rushing && splits.success && splits.success.matchup != null) bits.push(Math.round(splits.success.matchup * 1000) / 10 + "% succ");
  if (env && (env.in_yds != null || env.out_yds != null)) {
    const inn = env.in_yds == null ? "n/a" : Math.round(env.in_yds) + "y";
    const outY = env.out_yds == null ? "n/a" : Math.round(env.out_yds) + "y";
    const place = weatherCompact(env.sunday || (splits.env && splits.env.sunday) || "");
    bits.push("In " + inn + " / Out " + outY + (place ? " · " + place : ""));
  }
  if (splits.last_vs) bits.push(splits.last_vs);
  else if (versus && versus.games) bits.push(versus.line);
  return bits.join(" · ");
}

function openSimPlayer(player, caption) {
  const stat = caption === "Passing" ? "pass_yds" : caption === "Rushing" ? "rush_yds" : caption === "Touchdowns" ? "anytime_td" : "rec_yds";
  const block = player.q && player.q[stat] ? { q: player.q[stat], mean: player[stat === "pass_yds" ? "passYds" : stat === "rush_yds" ? "rushYds" : stat === "anytime_td" ? "anytime" : "recYds"], line: null, over: null, under: null } : null;
  const board = state.data.players.find(item => item.name === player.name) || { name: player.name, pos: player.pos, team: "", opp: "", stats: {}, splits: player.splits, game: state.gameId };
  if (block) {
    board.stats = Object.assign({}, board.stats);
    board.stats[stat] = block;
  }
  board.splits = player.splits || board.splits;
  if (!board.espn_id && player.espn_id) board.espn_id = player.espn_id;
  pushNav();
  state.player = player.name;
  state.stat = stat;
  state.line = block ? block.mean : state.line;
  state.tab = "calc";
  state.override = board;
  render();
}

function rosterPill() {
  const moves = (state.data.roster_moves || []).filter(row => row.from !== row.to);
  const wrap = document.createElement("details");
  wrap.className = "moves";
  const summary = document.createElement("summary");
  summary.textContent = "Roster & Injury Sync: 32 teams verified · Tap to view moves";
  wrap.append(summary);
  const body = document.createElement("p");
  body.className = "meta";
  body.textContent = moves.length ? moves.map(row => row.player + " " + (row.from || "—") + " → " + (row.to || "off")).join("; ") : "No team changes on the latest roster pull.";
  wrap.append(body);
  return wrap;
}

function applyScoreboard(payload) {
  const games = state.data && state.data.games || [];
  (payload.events || []).forEach(event => {
    const comp = (event.competitions || [])[0] || {};
    const teams = {};
    (comp.competitors || []).forEach(side => {
      const abbr = ((side.team || {}).abbreviation || "").toUpperCase().replace("WSH", "WSH").replace("WAS", "WSH");
      teams[side.homeAway] = abbr === "WAS" ? "WSH" : abbr;
    });
    if (!teams.away || !teams.home) return;
    const game = games.find(item => item.id === teams.away + "@" + teams.home || item.away === teams.away && item.home === teams.home);
    if (!game) return;
    const odds = (comp.odds || [])[0] || {};
    if (odds.details) game.spread_label = String(odds.details);
    if (odds.overUnder != null) {
      game.total = Number(odds.overUnder);
      if (game.engine) game.engine.total = game.total;
    }
    const homeOdds = odds.homeTeamOdds || {};
    if (odds.spread != null && homeOdds.favorite != null) {
      const number = Math.abs(Number(odds.spread));
      const homeSpread = homeOdds.favorite === true ? -number : number;
      game.home_spread = homeSpread;
      game.spread = homeSpread;
      if (game.engine) game.engine.homeSpread = homeSpread;
    }
    const type = ((comp.status || event.status || {}).type) || {};
    if (type.completed === true || type.state === "post") {
      game.completed = true;
      (state.data.players || []).forEach(player => {
        if (player.game !== game.id) return;
        Object.keys(player.stats || {}).forEach(stat => {
          player.stats[stat].board = false;
          player.stats[stat].board_side = null;
        });
      });
    }
  });
}

async function refreshLive() {
  await load(true);
  const clock = new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
  const scoreboard = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=2026&seasontype=2&week=9", { cache: "no-store" });
  const injuries = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries", { cache: "no-store" });
  if (!scoreboard.ok || !injuries.ok) {
    state.sync = "ESPN scoreboard or injuries unavailable";
    render();
    return;
  }
  applyScoreboard(await scoreboard.json());
  const payload = await injuries.json();
  const hard = /out|injured reserve|doubtful|suspended|inactive/i;
  (payload.injuries || []).forEach(team => {
    (team.injuries || []).forEach(item => {
      const name = item.athlete && item.athlete.displayName;
      if (name && hard.test(item.status || "")) state.outs[name] = true;
    });
  });
  state.sync = "Synced live ESPN lines & injuries · " + clock + " CT";
  render();
}

document.getElementById("refresh").onclick = () => refreshLive().catch(err => { document.getElementById("stamp").textContent = String(err); });
(function installButton() {
  const button = document.getElementById("install");
  const modal = document.getElementById("install-modal");
  if (!button || !modal) return;
  const standalone = window.navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  if (standalone) { button.hidden = true; return; }
  let promptEvent = null;
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); promptEvent = event; });
  const installNow = document.getElementById("install-now");
  button.onclick = () => {
    modal.hidden = false;
    if (installNow) installNow.hidden = !promptEvent;
  };
  if (installNow) installNow.onclick = () => {
    if (!promptEvent) return;
    const pending = promptEvent;
    promptEvent = null;
    installNow.hidden = true;
    pending.prompt();
  };
  document.getElementById("install-close").onclick = () => { modal.hidden = true; };
  modal.onclick = (event) => { if (event.target === modal) modal.hidden = true; };
})();
document.querySelectorAll("nav button").forEach(btn => btn.onclick = () => navTo(btn.dataset.tab));
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js", { scope: "./" });
fetch("data/learning.json", { cache: "no-store" }).then(res => res.ok ? res.json() : null).then(data => { if (data && data.w) { state.learning = data; if (state.data) render(); } }).catch(() => {});
load(false).then(render).catch(err => { document.getElementById("stamp").textContent = String(err); });

// ---- Season stats (ESPN free athlete endpoint, cached per player for the session) ----
const STATS_CATS = { QB: ["passing", "rushing", "scoring"], RB: ["rushing", "receiving", "scoring"], WR: ["receiving", "rushing", "scoring"], TE: ["receiving", "rushing", "scoring"], K: ["kicking", "scoring"] };

function statsButton(player) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "stats-btn";
  btn.textContent = "📊 Stats & game log";
  btn.setAttribute("aria-label", "Open " + player.name + " season stats");
  btn.onclick = (event) => {
    event.stopPropagation();
    const board = state.data && state.data.players.find(item => item.name === player.name);
    pushNav();
    state.statsYearBy = state.statsYearBy || {};
    state.statsYear = state.statsYearBy[player.espn_id || (board && board.espn_id) || ""] || null;
    state.statsFor = { name: player.name, team: player.team || (board && board.team) || "", pos: player.pos || (board && board.pos) || "", espn_id: player.espn_id || (board && board.espn_id) || null };
    state.tab = "stats";
    render();
    window.scrollTo(0, 0);
  };
  return btn;
}

// ---------- Game log (one row per game, any season) ----------
const GAMELOG_COLS = {
  QB: [["C/ATT", ["completions", "passingAttempts"], "/"], ["PASS YDS", ["passingYards"]], ["TD", ["passingTouchdowns"]], ["INT", ["interceptions"]], ["CAR", ["rushingAttempts"]], ["RUSH YDS", ["rushingYards"]]],
  RB: [["CAR", ["rushingAttempts"]], ["RUSH YDS", ["rushingYards"]], ["RUSH TD", ["rushingTouchdowns"]], ["TGT", ["receivingTargets"]], ["REC", ["receptions"]], ["REC YDS", ["receivingYards"]]],
  WR: [["TGT", ["receivingTargets"]], ["REC", ["receptions"]], ["REC YDS", ["receivingYards"]], ["TD", ["receivingTouchdowns"]], ["LNG", ["longReception"]]],
  K: [["FG", ["fieldGoalsMade-fieldGoalAttempts"]], ["LNG", ["longFieldGoalMade"]], ["XP", ["extraPointsMade-extraPointAttempts"]], ["PTS", ["totalKickingPoints"]]],
};
GAMELOG_COLS.FB = GAMELOG_COLS.RB;
GAMELOG_COLS.TE = GAMELOG_COLS.WR;
GAMELOG_COLS.PK = GAMELOG_COLS.K;

function loadGameLog(id, year) {
  state.gameLogCache = state.gameLogCache || {};
  const key = id + "|" + (year || "");
  if (state.gameLogCache[key]) return;
  state.gameLogCache[key] = { loading: true };
  const url = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/" + encodeURIComponent(id) + "/gamelog" + (year ? "?season=" + encodeURIComponent(year) : "");
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
  fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(res => { if (!res.ok) throw new Error("ESPN " + res.status); return res.json(); })
    .then(json => { state.gameLogCache[key] = { data: json }; })
    .catch(err => { state.gameLogCache[key] = { error: String(err && err.name === "AbortError" ? "ESPN timed out" : err) }; })
    .finally(() => { if (timer) clearTimeout(timer); if (state.tab === "stats") render(); });
}

function gameLogYears(json, fallback) {
  const filter = ((json && json.filters) || []).find(f => f.name === "season");
  const years = filter ? (filter.options || []).map(o => Number(o.value)).filter(Boolean) : [];
  return years.length ? years.sort((a, b) => b - a) : [fallback];
}

function renderGameLog(app, who, season) {
  const id = who.espn_id;
  const year = Number(state.statsYear) || season;
  // The current season's log also tells us every year he's played (the chip row).
  loadGameLog(id, season);
  if (year !== season) loadGameLog(id, year);
  const base = state.gameLogCache[id + "|" + season] || {};
  const entry = state.gameLogCache[id + "|" + year] || {};
  const card = document.createElement("article");
  card.className = "slip gamelog-card";
  const title = document.createElement("strong");
  title.textContent = "Game log";
  card.append(title);
  const chips = document.createElement("div");
  chips.className = "year-chips";
  gameLogYears(base.data || entry.data, season).forEach(y => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "year-chip" + (y === year ? " on" : "");
    chip.textContent = y;
    chip.setAttribute("aria-pressed", y === year ? "true" : "false");
    chip.onclick = () => {
      state.statsYear = y === season ? null : y;
      state.statsYearBy = state.statsYearBy || {};
      state.statsYearBy[id] = state.statsYear;
      render();
    };
    chips.append(chip);
  });
  card.append(chips);
  app.append(card);
  if (entry.loading || (!entry.data && !entry.error)) {
    const wait = document.createElement("p");
    wait.className = "meta";
    wait.textContent = "Loading the " + year + " game log from ESPN…";
    card.append(wait);
    return;
  }
  if (entry.error) {
    const err = document.createElement("p");
    err.className = "caution";
    err.textContent = "ESPN game log didn't load (" + entry.error + "). Tap Stats again to retry.";
    card.append(err);
    delete state.gameLogCache[id + "|" + year];
    return;
  }
  const json = entry.data;
  const names = json.names || [];
  const events = json.events || {};
  const cols = GAMELOG_COLS[who.pos] || GAMELOG_COLS.RB;
  const types = (json.seasonTypes || []).filter(t => /Regular|Postseason/.test(t.displayName || "")).sort((a, b) => (/Post/.test(b.displayName) ? 1 : 0) - (/Post/.test(a.displayName) ? 1 : 0));
  const value = (stats, keys, join) => {
    const vals = keys.map(k => { const i = names.indexOf(k); return i < 0 ? null : stats[i]; });
    if (vals.some(v => v == null)) return "—";
    return vals.join(join || "");
  };
  let shown = 0;
  types.forEach(type => {
    const post = /Post/.test(type.displayName || "");
    const rows = [];
    (type.categories || []).forEach(cat => (cat.events || []).forEach(ev => { if (events[ev.eventId]) rows.push({ ev: events[ev.eventId], stats: ev.stats || [] }); }));
    if (!rows.length) return;
    rows.sort((a, b) => String(b.ev.gameDate).localeCompare(String(a.ev.gameDate)));
    if (!post) {
      // Weeks with no game in the log: a bye, or he didn't play.
      const weeks = new Set(rows.map(r => Number(r.ev.week)));
      const hi = Math.max(...weeks);
      for (let w = hi - 1; w >= 1; w--) if (!weeks.has(w)) rows.push({ gap: w });
      rows.sort((a, b) => Number(b.gap || b.ev.week) - Number(a.gap || a.ev.week));
    }
    const table = document.createElement("table");
    table.className = "box season gamelog";
    const cap = document.createElement("caption");
    cap.textContent = type.displayName || (year + (post ? " Postseason" : " Regular Season"));
    table.append(cap);
    const head = document.createElement("tr");
    ["WK", "OPP", "RESULT"].concat(cols.map(c => c[0])).forEach(label => { const th = document.createElement("th"); th.textContent = label; head.append(th); });
    const thead = document.createElement("thead");
    thead.append(head);
    table.append(thead);
    const body = document.createElement("tbody");
    rows.forEach(r => {
      const tr = document.createElement("tr");
      if (r.gap) {
        tr.className = "bye";
        [String(r.gap), "Bye / did not play", ""].concat(cols.map(() => "")).forEach(v => { const td = document.createElement("td"); td.textContent = v; tr.append(td); });
      } else {
        const ev = r.ev;
        const opp = (ev.atVs === "@" ? "@ " : "vs ") + ((ev.opponent && ev.opponent.abbreviation) || "?");
        const result = (ev.gameResult || "") + " " + (ev.score || "");
        [String(ev.week != null ? (post ? "P" + ev.week : ev.week) : "—"), opp, result.trim()].concat(cols.map(c => value(r.stats, c[1], c[2]))).forEach(v => { const td = document.createElement("td"); td.textContent = v; tr.append(td); });
        if (ev.gameResult === "W") tr.children[2].className = "win";
        if (ev.gameResult === "L") tr.children[2].className = "loss";
      }
      body.append(tr);
    });
    table.append(body);
    const wrap = document.createElement("div");
    wrap.className = "table-scroll gamelog-scroll";
    wrap.append(table);
    card.append(wrap);
    shown += 1;
  });
  if (!shown) {
    const none = document.createElement("p");
    none.className = "meta";
    none.textContent = "ESPN has no " + year + " games logged for " + who.name + ".";
    card.append(none);
  }
}

function loadSeasonStats(id) {
  state.statsCache = state.statsCache || {};
  if (state.statsCache[id]) return;
  state.statsCache[id] = { loading: true };
  const url = "https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/" + encodeURIComponent(id) + "/stats";
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 12000) : null;
  fetch(url, ctrl ? { signal: ctrl.signal } : {})
    .then(res => { if (!res.ok) throw new Error("ESPN " + res.status); return res.json(); })
    .then(json => { state.statsCache[id] = { data: json }; })
    .catch(err => { state.statsCache[id] = { error: String(err && err.name === "AbortError" ? "ESPN timed out" : err) }; })
    .finally(() => { if (timer) clearTimeout(timer); if (state.tab === "stats") render(); });
}

function renderStats(app) {
  const who = state.statsFor;
  if (!who) { app.textContent = "Pick a player first."; return; }
  const board = state.data.players.find(item => item.name === who.name);
  const head = document.createElement("article");
  head.className = "calc-hero";
  paintTeam(head, who.team);
  const top = document.createElement("div");
  top.className = "who";
  top.append(avatarEl({ name: who.name, team: who.team, espn_id: who.espn_id }, "lg"), logoEl(who.team, "lg"));
  const id = document.createElement("div");
  const title = document.createElement("div");
  title.className = "name";
  title.textContent = who.name;
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.textContent = [who.pos, who.team, board && board.opp ? "vs " + board.opp + " this week" : ""].filter(Boolean).join(" · ");
  id.append(title, meta);
  top.append(id);
  head.append(top);
  app.append(head);
  if (board && board.stats) {
    const proj = document.createElement("article");
    proj.className = "slip";
    const bits = Object.keys(board.stats).filter(key => board.stats[key] && board.stats[key].mean != null).map(key => {
      const block = board.stats[key];
      return marketLabel(key) + " " + (key === "anytime_td" ? Math.round(block.mean * 1000) / 10 + "%" : Math.round(block.mean * 10) / 10) + (block.line != null ? " (line " + fmtLine(block.line) + ")" : "");
    });
    proj.innerHTML = "<strong>This week's sim means</strong>";
    const p = document.createElement("p");
    p.className = "meta";
    p.textContent = bits.join(" · ") || "No sim means for this player.";
    proj.append(p);
    app.append(proj);
  }
  if (!who.espn_id) {
    const note = document.createElement("p");
    note.className = "meta";
    note.textContent = "No ESPN athlete id on file for " + who.name + ", so season stats can't load.";
    app.append(note);
    return;
  }
  renderGameLog(app, who, Number(state.data.season) || new Date().getFullYear());
  loadSeasonStats(who.espn_id);
  const entry = state.statsCache[who.espn_id] || {};
  if (entry.loading) {
    const wait = document.createElement("p");
    wait.className = "meta";
    wait.textContent = "Loading season stats from ESPN…";
    app.append(wait);
    return;
  }
  if (entry.error || !entry.data) {
    const err = document.createElement("p");
    err.className = "caution";
    err.textContent = "ESPN stats didn't load (" + (entry.error || "no data") + "). Tap Stats again to retry.";
    app.append(err);
    delete state.statsCache[who.espn_id];
    return;
  }
  const season = Number(state.data.season) || new Date().getFullYear();
  const cats = entry.data.categories || [];
  const order = STATS_CATS[who.pos] || ["passing", "rushing", "receiving", "scoring"];
  const shown = order.map(name => cats.find(cat => cat.name === name)).filter(Boolean);
  let any = false;
  shown.forEach(cat => {
    const rows = (cat.statistics || []).filter(row => row.season && (row.season.year === season || row.season.year === season - 1));
    const current = rows.filter(row => row.season.year === season);
    const allZero = current.every(row => (row.stats || []).slice(1).every(v => v === "0" || v === "0.0" || v === "-" || v === "0-0"));
    if (!current.length || allZero) return;
    any = true;
    const table = document.createElement("table");
    table.className = "box season";
    const cap = document.createElement("caption");
    cap.textContent = cat.displayName || cat.name;
    table.append(cap);
    const tr = document.createElement("tr");
    ["Season"].concat(cat.labels || []).forEach(label => { const th = document.createElement("th"); th.textContent = String(label).trim(); tr.append(th); });
    table.append(tr);
    rows.sort((a, b) => b.season.year - a.season.year).forEach(row => {
      const line = document.createElement("tr");
      if (row.season.year === season) line.className = "now";
      const team = row.teamSlug ? Object.values(entry.data.teams || {}).find(t => t.slug === row.teamSlug) : null;
      [row.season.year + (team && team.abbreviation ? " " + team.abbreviation : "")].concat(row.stats || []).forEach(value => { const td = document.createElement("td"); td.textContent = value; line.append(td); });
      table.append(line);
    });
    if (cat.totals) {
      const tot = document.createElement("tr");
      tot.className = "career";
      ["Career"].concat(cat.totals).forEach(value => { const td = document.createElement("td"); td.textContent = value; tot.append(td); });
      table.append(tot);
    }
    const wrap = document.createElement("div");
    wrap.className = "table-scroll";
    wrap.append(table);
    app.append(wrap);
  });
  if (!any) {
    const none = document.createElement("p");
    none.className = "meta";
    none.textContent = "ESPN has no " + season + " regular-season stats for " + who.name + " yet.";
    app.append(none);
  }
  const src = document.createElement("p");
  src.className = "meta";
  src.textContent = "Source: ESPN regular-season stats. " + season + " row highlighted; " + (season - 1) + " and career for context.";
  app.append(src);
}
