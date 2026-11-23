/* VELO SPEED — interface : structure, compteur, trajets, météo, réglages. */
(function () {
  "use strict";
  const VS = window.VS, L = VS.L, $ = VS.$, $$ = VS.$$, esc = VS.esc, S = VS.S, cfg = VS.cfg, ride = VS.ride, T = VS.T, pad = VS.pad;
  const main = $("#main");
  const ui = VS.ui = {};
  const views = {}, acts = {};
  VS.views = views; VS.acts = acts;

  /* ---------- formats ---------- */
  const fU = function () { return cfg.units === "mph" ? 0.621371 : 1; };
  const uL = function () { return cfg.units === "mph" ? "mph" : "km/h"; };
  const dU = function () { return cfg.units === "mph" ? "mi" : "km"; };
  ui.fU = fU; ui.uL = uL; ui.dU = dU;
  ui.fT = function (s) { s = Math.round(s); return pad(Math.floor(s / 3600)) + ":" + pad(Math.floor(s % 3600 / 60)) + ":" + pad(s % 60); };
  ui.n1 = function (x) { return (Math.round(x * 10) / 10).toFixed(1).replace(".", ","); };
  ui.n2 = function (x) { return (Math.round(x * 100) / 100).toFixed(2).replace(".", ","); };
  const n1 = ui.n1, n2 = ui.n2;
  ui.dateFr = function (t) { return new Date(t).toLocaleString("fr-FR", { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }); };

  /* ---------- fenêtres ---------- */
  ui.modal = function (html) {
    $("#modal-root").innerHTML = '<div class="modal" data-act="modal-bg"><div class="sheet">' + html + '</div></div>';
  };
  ui.closeModal = function () { $("#modal-root").innerHTML = ""; };
  let dlgResolve = null;
  ui.ask = function (o) {
    return new Promise(function (resolve) {
      dlgResolve = resolve;
      ui.modal('<h2 style="margin-bottom:8px">' + esc(o.title) + '</h2><div class="note" style="font-size:14px;color:var(--ink)">' + o.body + '</div>' +
        (o.check ? '<label class="sw" style="color:var(--ink);font-size:14px;margin-top:10px"><span>' + esc(o.check) + '</span><input type="checkbox" id="dlgCheck"></label>' : '') +
        '<div class="row" style="margin-top:14px"><button class="btn sec" data-act="dlg-no">Annuler</button><button class="btn ' + (o.danger ? "bad" : "") + '" id="dlgOk" data-act="dlg-yes" ' + (o.check ? "disabled" : "") + '>' + esc(o.ok || "Confirmer") + '</button></div>');
    });
  };
  acts["dlg-no"] = function () { ui.closeModal(); if (dlgResolve) { dlgResolve(false); dlgResolve = null; } };
  acts["dlg-yes"] = function () { ui.closeModal(); if (dlgResolve) { dlgResolve(true); dlgResolve = null; } };
  acts["modal-bg"] = function (el, e) { if (e.target === el) { if (dlgResolve) acts["dlg-no"](); else ui.closeModal(); } };
  document.addEventListener("change", function (e) { if (e.target && e.target.id === "dlgCheck") $("#dlgOk").disabled = !e.target.checked; });
  document.addEventListener("click", function (e) {
    const el = e.target.closest ? e.target.closest("[data-act]") : null;
    if (!el) return;
    const f = acts[el.dataset.act];
    if (f) { try { f(el, e); } catch (err) { VS.log("Erreur interface (" + el.dataset.act + ") : " + err.message); VS.toast("Une erreur est survenue : " + err.message); } }
  });

  /* ---------- navigation ---------- */
  VS.show = function (tab) {
    S.tab = tab;
    $$("#nav button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === (tab === "weather" ? "ride" : tab)); });
    main.innerHTML = '<section id="view-' + tab + '">' + views[tab]() + '</section>';
    main.scrollTop = 0;
    if (VS.after && VS.after[tab]) VS.after[tab]();
    if (tab === "ride") updRide(VS.currentSpeed());
  };
  VS.after = {};
  $$("#nav button").forEach(function (b) { b.onclick = function () { VS.show(b.dataset.tab); }; });
  window.nativeBack = function () {
    if ($("#modal-root").innerHTML) { if (dlgResolve) acts["dlg-no"](); else ui.closeModal(); return true; }
    if (document.body.classList.contains("hud")) { acts["hud-off"](); return true; }
    if (S.tab !== "ride") { VS.show("ride"); return true; }
    return false;
  };
  let pending = null;
  VS.onChange = function (what) {
    if (what === "scan" && S.tab === "bike" && S.bikeTab === "conn") { const el = $("#scanList"); if (el && VS.bike) el.innerHTML = VS.bike.scanList(); }
    else if (S.tab === "bike" && /conn|services|notify|battery|perm/.test(what)) {
      const a = document.activeElement;
      if (a && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) { clearTimeout(pending); pending = setTimeout(function () { VS.onChange(what); }, 1200); return; }
      const top = main.scrollTop; VS.show("bike"); main.scrollTop = top;
    } else if (what === "perm" && S.tab !== "bike") { /* rien */ }
    if (S.tab === "ride" && /conn|battery/.test(what)) updRide(VS.currentSpeed());
  };

  /* =====================================================================
     COMPTEUR
     ===================================================================== */
  const C = 2 * Math.PI * 124, ARC = C * 0.75;
  views.ride = function () {
    return '' +
      '<div class="top nohud"><span class="brand">VELO SPEED</span><span class="note" id="rideSub"></span></div>' +
      '<div class="status nohud"><button class="chip" id="chBle" data-act="goto-bike"></button><span class="chip" id="chGps"></span></div>' +
      '<div class="hero"><div class="gauge" id="gauge" data-act="hud-off"><svg viewBox="0 12 300 262" aria-hidden="true">' +
      '<circle cx="150" cy="150" r="124" fill="none" stroke="var(--track)" stroke-width="14" stroke-linecap="round" stroke-dasharray="' + ARC + ' ' + C + '" transform="rotate(135 150 150)"/>' +
      '<circle id="gFill" cx="150" cy="150" r="124" fill="none" stroke="var(--acc)" stroke-width="14" stroke-linecap="round" stroke-dasharray="0 ' + C + '" transform="rotate(135 150 150)"/></svg>' +
      '<div class="c"><div class="spd num"><span id="spdI">0</span><small id="spdD">,0</small></div><div class="u" id="unitL">km/h</div></div></div>' +
      '<div class="lim" id="limL"></div><div class="state nohud"><span id="chSrc"></span></div></div>' +
      '<div class="nohud">' +
      '<div class="grid3">' +
      '<div class="stat"><small>Distance</small><b class="num" id="sDist">0,00</b></div>' +
      '<div class="stat"><small>Durée</small><b class="num" id="sMove">00:00:00</b></div>' +
      '<div class="stat"><small>Moyenne</small><b class="num" id="sAvg">0,0</b></div>' +
      '<div class="stat"><small>Maximum</small><b class="num" id="sMax">0,0</b></div>' +
      '<div class="stat"><small>Batterie</small><b class="num" id="sBat">—</b></div>' +
      '<div class="stat"><small id="sXl">Altitude</small><b class="num" id="sX">—</b></div></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn" id="bStart" data-act="ride-toggle">Démarrer</button><button class="btn sec" id="bEnd" data-act="ride-end" disabled>Terminer</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sec sm grow" data-act="hud-on">Plein écran</button><button class="btn sec sm grow" id="bSrc" data-act="src-cycle"></button></div>' +
      '<div style="margin-top:14px"><button class="cond" id="chTemp" data-act="goto-weather"></button></div>' +
      '</div>';
  };
  acts["goto-weather"] = function () { VS.show("weather"); };
  acts["goto-bike"] = function () { VS.show("bike"); };
  acts["hud-on"] = function () { document.body.classList.add("hud"); T.call("keepScreenOn", true); };
  acts["hud-off"] = function () { if (document.body.classList.contains("hud")) { document.body.classList.remove("hud"); T.call("keepScreenOn", ride.run && !!cfg.wake); } };
  acts["src-cycle"] = function () { const o = ["auto", "gps", "ble"]; cfg.source = o[(o.indexOf(cfg.source) + 1) % 3]; VS.saveCfg(); updRide(VS.currentSpeed()); };
  acts["ride-toggle"] = function () { if (ride.run) VS.pauseRide(); else VS.startRide(); updRide(VS.currentSpeed()); };
  acts["ride-end"] = function () {
    const s = VS.endRide();
    VS.toast(s ? "Trajet enregistré : " + n2(s.km * fU()) + " " + dU() : "Trajet trop court : non enregistré.");
    updRide(VS.currentSpeed());
  };
  function updRide(s) {
    if (S.tab !== "ride" || !$("#spdI")) return;
    const f = fU(), dv = s.v * f, limit = cfg.limit, over = limit > 0 && s.v > limit + 0.05;
    $("#spdI").textContent = Math.floor(dv);
    $("#spdD").textContent = "," + Math.floor((dv % 1) * 10);
    $("#unitL").textContent = uL();
    const gmax = Math.max(40, Math.ceil(s.v / 10) * 10, Math.ceil(limit * 1.6 / 10) * 10);
    $("#gFill").setAttribute("stroke-dasharray", (ARC * Math.min(s.v / gmax, 1)) + " " + C);
    $("#gFill").setAttribute("stroke", over ? "var(--bad)" : "var(--acc)");
    const lim = $("#limL");
    lim.textContent = limit > 0 ? (over ? "Au-dessus de " + Math.round(limit * f) + " " + uL() : "Alerte à " + Math.round(limit * f) + " " + uL()) : "Alerte de vitesse désactivée";
    lim.className = "lim" + (over ? " over" : "");
    $("#rideSub").textContent = ride.run ? "Trajet en cours · " + Math.round(ride.total / 60) + " min" : ride.started ? "Trajet en pause" : "Prêt";
    const cs = S.conn.state, bat = S.battery == null ? "" : " · " + S.battery + " %";
    $("#chBle").innerHTML = '<span class="dot"></span>' + (cs === "connected" ? "Vélo connecté" + bat : cs === "connecting" ? "Bluetooth : connexion…" : "Bluetooth : non connecté");
    $("#chBle").className = "chip " + (cs === "connected" ? "ok" : cs === "connecting" ? "warn" : "");
    $("#chSrc").textContent = "Source : " + s.src.toLowerCase();
    const g = S.live.gps, gOk = g && Date.now() - g.t < 5000;
    $("#chGps").innerHTML = '<span class="dot"></span>' + (S.gpsOn ? (gOk ? "GPS ± " + Math.round(g.acc || 0) + " m" : "GPS : recherche…") : "GPS éteint");
    $("#chGps").className = "chip " + (S.gpsOn ? (gOk && (g.acc || 0) <= 25 ? "ok" : "warn") : "");
    $("#sDist").innerHTML = n2(ride.dist / 1000 * f) + ' <i>' + dU() + '</i>';
    $("#sAvg").innerHTML = n1(VS.rideAvg() * f) + ' <i>' + uL() + '</i>';
    $("#sMax").innerHTML = n1(ride.max * f) + ' <i>' + uL() + '</i>';
    $("#sMove").textContent = ui.fT(ride.move);
    $("#sBat").innerHTML = S.battery == null ? "—" : S.battery + ' <i>%</i>';
    const cad = S.live.cad;
    if (cad && Date.now() - cad.t < 4000) { $("#sXl").textContent = "Cadence"; $("#sX").innerHTML = Math.round(cad.v) + ' <i>tr/min</i>'; }
    else { $("#sXl").textContent = "Altitude"; $("#sX").innerHTML = S.live.alt == null ? "—" : Math.round(S.live.alt) + ' <i>m</i>'; }
    $("#bStart").textContent = ride.run ? "Pause" : ride.started ? "Reprendre" : "Démarrer";
    $("#bEnd").disabled = !ride.started;
    $("#bSrc").textContent = "Source : " + ({ auto: "auto", gps: "GPS", ble: "vélo" })[cfg.source];
    const w = S.weather;
    $("#chTemp").innerHTML = w && w.cur
      ? '<span class="t">' + Math.round(w.cur.temp) + '°</span><span class="grow"><b>' + esc(WMO(w.cur.code)) + '</b><small>Vent ' + Math.round(w.cur.wind * f) + ' ' + uL() + ' · conditions détaillées</small></span><span class="note">›</span>'
      : '<span class="grow"><b>Conditions météo</b><small>Appuyer pour afficher la météo locale</small></span><span class="note">›</span>';
  }
  let alerted = false;
  VS.onTick = function (s) {
    const limit = cfg.limit, over = limit > 0 && s.v > limit + 0.05;
    if (over && !alerted) { alerted = true; if (cfg.vib && navigator.vibrate) { try { navigator.vibrate([150, 80, 150]); } catch (e) { /* ignoré */ } } }
    if (!over && (limit === 0 || s.v < limit - 1)) alerted = false;
    updRide(s);
    if (VS.bike && VS.bike.tick) VS.bike.tick();
  };

  /* =====================================================================
     TRAJETS
     ===================================================================== */
  function stats() {
    const R = VS.rides, st = { n: R.length, km: 0, sec: 0, max: 0, bestKm: 0, bestDur: 0, days: {} };
    R.forEach(function (r) {
      st.km += r.km; st.sec += r.dur; st.max = Math.max(st.max, r.max); st.bestKm = Math.max(st.bestKm, r.km); st.bestDur = Math.max(st.bestDur, r.dur);
      const d = new Date(r.t); st.days[d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate())] = 1;
    });
    const ds = Object.keys(st.days).sort(); let run = 0, best = 0, prev = null;
    ds.forEach(function (k) {
      const t = new Date(k + "T12:00:00").getTime();
      run = prev !== null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1; best = Math.max(best, run); prev = t;
    });
    st.streak = best; st.dayCount = ds.length;
    return st;
  }
  ui.routeSvg = function (track) {
    const pts = (track || []).filter(function (p) { return p && p[0] != null; });
    if (pts.length < 2) return '<div class="box lav">Pas de tracé enregistré pour ce trajet.</div>';
    let a = 90, b = -90, c = 180, d = -180;
    pts.forEach(function (p) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); });
    const k = Math.cos((a + b) / 2 * Math.PI / 180), w = Math.max((d - c) * k, 1e-5), h = Math.max(b - a, 1e-5);
    const sc = Math.min(260 / w, 160 / h), ox = (300 - w * sc) / 2, oy = (200 - h * sc) / 2;
    const xy = pts.map(function (p) { return [(ox + (p[1] - c) * k * sc).toFixed(1), (oy + (b - p[0]) * sc).toFixed(1)]; });
    return '<svg class="route" viewBox="0 0 300 200" aria-label="Tracé du trajet"><polyline points="' + xy.map(function (p) { return p.join(","); }).join(" ") + '" fill="none" stroke="var(--acc)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + xy[0][0] + '" cy="' + xy[0][1] + '" r="6" fill="var(--ok)" stroke="var(--card)" stroke-width="2"/><circle cx="' + xy[xy.length - 1][0] + '" cy="' + xy[xy.length - 1][1] + '" r="6" fill="var(--acc)" stroke="var(--card)" stroke-width="2"/></svg>';
  };
  views.rides = function () {
    const st = stats(), f = fU();
    const days = [], now = new Date();
    for (let i = 6; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i); days.push({ key: d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()), lab: "DLMMJVS".charAt(d.getDay()), km: 0, today: i === 0 }); }
    VS.rides.forEach(function (r) { const d = new Date(r.t), key = d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); days.forEach(function (x) { if (x.key === key) x.km += r.km; }); });
    const mx = Math.max.apply(null, days.map(function (x) { return x.km; }).concat([1])), wk = days.reduce(function (a, x) { return a + x.km; }, 0);
    const bars = days.map(function (x) {
      return '<div style="display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:5px;height:100%"><div style="width:100%;height:' + Math.max(6, Math.round(x.km / mx * 70)) + 'px;border-radius:6px;background:' + (x.km === 0 ? "var(--track)" : x.today ? "var(--acc)" : "var(--acc-bg)") + '"></div><div class="note" style="font-weight:800;color:' + (x.today ? "var(--acc)" : "var(--mut)") + '">' + x.lab + '</div></div>';
    }).join("");
    const list = VS.rides.length ? VS.rides.map(function (r, i) {
      return '<div data-act="ride-open" data-i="' + i + '"><div class="grow"><b>' + n2(r.km * f) + ' ' + dU() + '</b> · ' + ui.fT(r.dur) + '<small>' + esc(ui.dateFr(r.t)) + ' · moy. ' + n1(r.avg * f) + ' · max ' + n1(r.max * f) + ' ' + uL() + '</small></div><span class="tag">' + (r.src === "ble" ? "vélo" : "GPS") + '</span></div>';
    }).join("") : '<p class="note">Aucun trajet enregistré. Démarrez un trajet depuis le tableau de bord.</p>';
    return '<h1 class="title">Trajets</h1>' +
      '<div class="grid2"><div class="stat lav"><small>Trajets</small><b class="num">' + st.n + '</b></div><div class="stat pink"><small>Distance totale</small><b class="num">' + n1(st.km * f) + ' <i>' + dU() + '</i></b></div>' +
      '<div class="stat sky"><small>Temps de route</small><b class="num">' + n1(st.sec / 3600) + ' <i>h</i></b></div><div class="stat mint"><small>Record de vitesse</small><b class="num">' + n1(st.max * f) + ' <i>' + uL() + '</i></b></div></div>' +
      '<div class="card"><div class="row sp"><h2>Cette semaine</h2><span class="note" style="font-weight:800">' + n1(wk * f) + ' ' + dU() + ' · série max ' + st.streak + ' j</span></div><div style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-top:10px;height:96px;align-items:end">' + bars + '</div></div>' +
      '<div class="card"><h2>Historique</h2><div class="list" style="margin-top:6px">' + list + '</div>' +
      '<div class="row" style="margin-top:8px"><button class="btn sec sm grow" data-act="rides-csv">Exporter en CSV</button></div></div>';
  };
  acts["ride-open"] = function (el) {
    const r = VS.rides[+el.dataset.i]; if (!r) return;
    const f = fU();
    ui.modal('<h2>' + esc(ui.dateFr(r.t)) + '</h2><div style="margin:10px 0">' + ui.routeSvg(r.track) + '</div>' +
      '<div class="grid2"><div class="stat pink"><small>Distance</small><b class="num">' + n2(r.km * f) + ' <i>' + dU() + '</i></b></div><div class="stat mint"><small>Durée</small><b class="num">' + ui.fT(r.dur) + '</b></div>' +
      '<div class="stat lav"><small>Moyenne</small><b class="num">' + n1(r.avg * f) + ' <i>' + uL() + '</i></b></div><div class="stat sky"><small>Maximum</small><b class="num">' + n1(r.max * f) + ' <i>' + uL() + '</i></b></div></div>' +
      '<div class="row" style="margin-top:14px"><button class="btn sec" data-act="ride-gpx" data-i="' + el.dataset.i + '">Exporter GPX</button><button class="btn bad" data-act="ride-del" data-i="' + el.dataset.i + '">Supprimer</button></div>' +
      '<button class="btn sec" style="width:100%;margin-top:10px" data-act="dlg-no">Fermer</button>');
  };
  acts["ride-del"] = function (el) {
    const i = +el.dataset.i, r = VS.rides[i]; if (!r) return;
    ui.ask({ title: "Supprimer ce trajet ?", body: "Il sera retiré de l'historique et du compteur total.", ok: "Supprimer", danger: true }).then(function (ok) {
      if (!ok) return;
      VS.rides.splice(i, 1); VS.store.set("rides", VS.rides);
      VS.odoBase = Math.max(0, +(VS.odoBase - r.km).toFixed(3)); VS.store.set("odoBase", VS.odoBase);
      VS.show("rides");
    });
  };
  acts["ride-gpx"] = function (el) {
    const r = VS.rides[+el.dataset.i]; if (!r || !r.track || r.track.length < 2) { VS.toast("Pas de tracé à exporter."); return; }
    const pts = r.track.map(function (p) { return '<trkpt lat="' + p[0] + '" lon="' + p[1] + '">' + (p[4] != null ? "<ele>" + p[4] + "</ele>" : "") + "<time>" + new Date(p[2]).toISOString() + "</time></trkpt>"; }).join("\n");
    const gpx = '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="VELO SPEED" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>' + esc(ui.dateFr(r.t)) + '</name><trkseg>\n' + pts + '\n</trkseg></trk></gpx>';
    T.call("shareText", "Trajet VELO SPEED (GPX)", gpx);
  };
  acts["rides-csv"] = function () {
    if (!VS.rides.length) { VS.toast("Aucun trajet à exporter."); return; }
    const head = "date;duree_s;roulee_s;distance_km;vmax_kmh;vmoy_kmh;source\n";
    T.call("shareText", "Trajets VELO SPEED (CSV)", head + VS.rides.map(function (r) { return [new Date(r.t).toISOString(), r.dur, r.mv, r.km, r.max, r.avg, r.src].join(";"); }).join("\n"));
  };

  /* =====================================================================
     MÉTÉO (Open-Meteo : service gratuit, sans compte)
     ===================================================================== */
  const WMO = function (c) {
    if (c === 0) return "Ciel dégagé"; if (c <= 2) return "Peu nuageux"; if (c === 3) return "Couvert"; if (c === 45 || c === 48) return "Brouillard";
    if (c >= 51 && c <= 57) return "Bruine"; if (c >= 61 && c <= 67) return "Pluie"; if (c >= 71 && c <= 77) return "Neige"; if (c >= 80 && c <= 82) return "Averses";
    if (c === 85 || c === 86) return "Averses de neige"; if (c >= 95) return "Orage"; return "Variable";
  };
  const DIRS = ["nord", "nord-est", "est", "sud-est", "sud", "sud-ouest", "ouest", "nord-ouest"];
  function advice(w) {
    const c = w.cur, maxRain = Math.max.apply(null, w.hours.slice(0, 3).map(function (h) { return h.rain; }).concat([0]));
    const tips = []; let level = "mint", head = "Bonne sortie !";
    if (c.code >= 95) { level = "bad"; head = "Évite de rouler"; tips.push("Orage dans le coin."); }
    else if (maxRain >= 60 || (c.code >= 61 && c.code <= 82)) { level = "sun"; head = "Pluie probable"; tips.push("Prévoir une veste imperméable et allonge les distances de freinage."); }
    if (c.temp <= 2) { level = level === "bad" ? level : "sun"; if (head === "Bonne sortie !") head = "Risque de verglas"; tips.push("Température proche de 0 : prudence sur les zones ombragées."); }
    if (c.temp <= 8) tips.push("Prévoir gants et tour de cou."); else if (c.temp >= 28) tips.push("Il fait chaud : prévoir de l'eau.");
    if (c.wind >= 35) { level = level === "bad" ? level : "sun"; tips.push("Vent fort (" + Math.round(c.wind) + " km/h) : l'autonomie baissera."); }
    if (!tips.length) tips.push("Conditions agréables pour rouler.");
    return { level: level, head: head, text: tips.join(" ") };
  }
  views.weather = function () {
    const w = S.weather;
    let body;
    if (!w) body = '<div class="box lav">Aucune météo en mémoire. Appuyez sur « Actualiser » (localisation et Internet nécessaires).</div>';
    else {
      const c = w.cur, a = advice(w), f = fU();
      const sunset = w.sunset ? new Date(w.sunset) : null;
      let lights = "";
      if (sunset) {
        const mins = Math.round((sunset.getTime() - Date.now()) / 60000);
        lights = mins > 0 && mins <= 120 ? "Coucher du soleil à " + pad(sunset.getHours()) + ":" + pad(sunset.getMinutes()) + " : allumer les lumières dans " + Math.max(0, mins - 30) + " min."
          : mins <= 0 ? "Le soleil est couché : allumer les lumières." : "Coucher du soleil à " + pad(sunset.getHours()) + ":" + pad(sunset.getMinutes()) + ".";
      }
      body = '<div class="hero" style="margin-top:0"><div class="num" style="font-size:76px;line-height:1">' + Math.round(c.temp) + '°</div><div class="note" style="margin-top:6px;font-size:15px">' + esc(WMO(c.code)) + ' · ressenti ' + Math.round(c.feels) + '°</div></div>' +
        '<div class="box ' + a.level + '"><b>' + esc(a.head) + '</b><br>' + esc(a.text) + '</div>' +
        '<div class="grid2" style="margin-top:10px"><div class="stat"><small>Vent</small><b class="num">' + Math.round(c.wind * f) + ' <i>' + uL() + ' · ' + DIRS[Math.round(c.dir / 45) % 8] + '</i></b></div>' +
        '<div class="stat"><small>Pluie (3 h)</small><b class="num">' + Math.max.apply(null, w.hours.slice(0, 3).map(function (h) { return h.rain; }).concat([0])) + ' <i>%</i></b></div>' +
        '<div class="stat"><small>Indice UV</small><b class="num">' + (w.uv == null ? "—" : Math.round(w.uv)) + '</b></div>' +
        '<div class="stat"><small>Soleil</small><b class="num" style="font-size:15px">' + esc(lights || "—") + '</b></div></div>' +
        '<div class="card"><h2>Prochaines heures</h2><div style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px;margin-top:10px;text-align:center">' +
        w.hours.slice(0, 5).map(function (h, i) { return '<div style="border-radius:16px;padding:10px 0;' + (i === 0 ? "background:var(--acc-bg)" : "") + '"><div class="note" style="font-weight:800">' + pad(h.hour) + ' h</div><div class="num" style="font-size:20px;margin-top:4px">' + Math.round(h.temp) + '°</div><div class="note" style="font-weight:800">' + h.rain + ' %</div></div>'; }).join("") + '</div></div>' +
        '<p class="note">Mis à jour à ' + pad(new Date(w.t).getHours()) + ":" + pad(new Date(w.t).getMinutes()) + ' · données Open-Meteo' + (w.stale ? " · <b>hors ligne : dernière mesure</b>" : "") + '</p>';
    }
    return '<div class="top"><button class="back" data-act="wx-back">‹ Tableau de bord</button><button class="btn sm" data-act="wx-refresh" id="wxBtn">Actualiser</button></div><h1 class="title">Météo</h1><div id="wxBody">' + body + '</div>';
  };
  acts["wx-back"] = function () { VS.show("ride"); };
  function getLocation() {
    const l = T.lastLocation();
    if (l && Date.now() - l.time < 20 * 60000) return Promise.resolve(l);
    if (S.live.gps && Date.now() - S.live.gps.t < 60000) return Promise.resolve({ lat: S.live.gps.lat, lon: S.live.gps.lon });
    return VS.startGps().then(function (ok) {
      if (!ok) return l;
      return VS.waitFor("gps", function () { return true; }, 25000).then(function (g) { VS.stopGps(); return g; }, function () { VS.stopGps(); return l; });
    });
  }
  acts["wx-refresh"] = function () {
    const btn = $("#wxBtn"); if (btn) { btn.disabled = true; btn.textContent = "Recherche…"; }
    getLocation().then(function (loc) {
      if (!loc) throw new Error("Position introuvable. Active la localisation et sors à l'air libre.");
      const url = "https://api.open-meteo.com/v1/forecast?latitude=" + loc.lat.toFixed(3) + "&longitude=" + loc.lon.toFixed(3) +
        "&current=temperature_2m,apparent_temperature,wind_speed_10m,wind_direction_10m,weather_code&hourly=temperature_2m,precipitation_probability&daily=sunset,uv_index_max&timezone=auto&forecast_days=2&wind_speed_unit=kmh";
      return fetch(url).then(function (r) { if (!r.ok) throw new Error("Service météo indisponible (" + r.status + ")"); return r.json(); });
    }).then(function (j) {
      const cur = j.current, ht = j.hourly.time, i0 = Math.max(0, ht.findIndex(function (t) { return t >= cur.time.slice(0, 13) + ":00"; }));
      const hours = [];
      for (let i = i0; i < Math.min(ht.length, i0 + 12); i++) hours.push({ hour: +ht[i].slice(11, 13), temp: j.hourly.temperature_2m[i], rain: j.hourly.precipitation_probability[i] == null ? 0 : j.hourly.precipitation_probability[i] });
      S.weather = { t: Date.now(), cur: { temp: cur.temperature_2m, feels: cur.apparent_temperature, wind: cur.wind_speed_10m, dir: cur.wind_direction_10m, code: cur.weather_code }, hours: hours, sunset: j.daily.sunset[0], uv: j.daily.uv_index_max[0] };
      VS.store.set("weather", S.weather);
      if (S.tab === "weather") VS.show("weather");
    }).catch(function (e) {
      if (S.weather) S.weather.stale = true;
      VS.toast(e.message && /fetch|Failed|network/i.test(e.message) ? "Pas de connexion Internet : dernière météo affichée." : e.message);
      if (S.tab === "weather") VS.show("weather");
    });
  };
  VS.after.weather = function () { if (!S.weather || Date.now() - S.weather.t > 30 * 60000) acts["wx-refresh"](); };

  /* =====================================================================
     RÉGLAGES, ENTRETIEN, AIDE
     ===================================================================== */
  let maint = VS.store.get("maint", [
    { n: "Chaîne : nettoyage et graissage", every: 300, last: 0 },
    { n: "Freins : contrôle des plaquettes", every: 1000, last: 0 },
    { n: "Pneus : pression et usure", every: 500, last: 0 }]);
  const odo = function () { return VS.odoBase + ride.dist / 1000; };
  views.more = function () {
    const o = odo();
    const items = maint.map(function (x, i) {
      const left = x.last + x.every - o, pc = Math.max(0, Math.min(100, (o - x.last) / x.every * 100));
      return '<div><div class="grow"><b>' + esc(x.n) + '</b><small>tous les ' + x.every + ' km · ' + (left <= 0 ? "à faire !" : "dans " + Math.round(left) + " km") + '</small><div class="bar"><i style="width:' + pc + '%;background:' + (left <= 0 ? "var(--bad)" : left < 50 ? "var(--sun)" : "var(--mint)") + '"></i></div></div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn sec sm" data-act="mt-ok" data-i="' + i + '">Fait</button><button class="btn sec sm" data-act="mt-rm" data-i="' + i + '">✕</button></div></div>';
    }).join("") || '<p class="note">Aucun rappel.</p>';
    return '<h1 class="title">Réglages</h1>' +
      '<div class="card"><h2>Compteur</h2>' +
      '<label>Unité de vitesse</label><select id="cUnits"><option value="kmh">km/h</option><option value="mph">mph</option></select>' +
      '<label>Alerte de vitesse (km/h, 0 = désactivée)</label><input type="number" id="cLimit" min="0" max="99" inputmode="numeric">' +
      '<div class="note">Dans l\'Union européenne, l\'assistance d\'un vélo électrique légal se coupe à 25 km/h.</div>' +
      '<label>Circonférence de roue (mm)</label><input type="number" id="cWheel" min="800" max="3000" inputmode="numeric">' +
      '<div class="note">Sert au capteur vitesse/cadence Bluetooth standard. Repères : 20″ ≈ 1600, 26″ ≈ 2070, 28″ ≈ 2105.</div>' +
      '<label class="sw" style="color:var(--ink);font-size:15px"><span>Garder l\'écran allumé pendant un trajet</span><input type="checkbox" id="cWake"></label>' +
      '<label class="sw" style="color:var(--ink);font-size:15px"><span>Vibration quand l\'alerte se déclenche</span><input type="checkbox" id="cVib"></label>' +
      '<label class="sw" style="color:var(--ink);font-size:15px"><span>Reconnexion automatique au vélo</span><input type="checkbox" id="cAuto"></label>' +
      '<label>Compteur total du vélo (km) — à ajuster</label><input type="number" step="0.1" id="cOdo" inputmode="decimal"></div>' +
      '<div class="card"><div class="row sp"><h2>Entretien</h2><span class="note" style="font-weight:800">selon les km</span></div><div class="list" style="margin-top:6px">' + items + '</div><div class="row" style="margin-top:8px"><button class="btn sec sm" data-act="mt-add">+ Ajouter un rappel</button></div></div>' +
      '<div class="card"><h2>Aide et sécurité</h2><div class="list" style="margin-top:6px">' +
      '<div data-act="help-ble"><div class="grow"><b>Comprendre l\'état du Bluetooth</b><small>Ce qui marche, ce qui reste à confirmer</small></div>›</div>' +
      '<div data-act="help-capture"><div class="grow"><b>Capturer l\'appli officielle</b><small>Pour retrouver le protocole du vélo</small></div>›</div>' +
      '<div data-act="help-law"><div class="grow"><b>Réglementation et terrain privé</b><small>À lire avant de modifier une limite</small></div>›</div>' +
      '<div data-act="intro"><div class="grow"><b>Revoir la présentation</b></div>›</div></div></div>' +
      '<div class="card"><h2>Données</h2><p class="note">Tout est enregistré sur ton téléphone. Rien n\'est envoyé, hormis la position pour la météo (Open-Meteo).</p>' +
      '<div class="row"><button class="btn bad sm grow" data-act="wipe">Tout effacer</button></div><p class="note" style="margin-top:10px">VELO SPEED 2.0.0 · ' + esc(S.info.model || "") + ' · Android ' + esc(S.info.android || "?") + '</p></div>';
  };
  VS.after.more = function () {
    $("#cUnits").value = cfg.units; $("#cLimit").value = cfg.limit; $("#cWheel").value = cfg.wheel;
    $("#cWake").checked = cfg.wake; $("#cVib").checked = cfg.vib; $("#cAuto").checked = cfg.autoReconnect; $("#cOdo").value = odo().toFixed(1);
    $("#cUnits").onchange = function (e) { cfg.units = e.target.value; VS.saveCfg(); };
    $("#cLimit").onchange = function (e) { cfg.limit = Math.max(0, Math.min(99, +e.target.value || 0)); VS.saveCfg(); };
    $("#cWheel").onchange = function (e) { cfg.wheel = Math.max(800, Math.min(3000, +e.target.value || 2105)); VS.saveCfg(); VS.csc.reset(); };
    $("#cWake").onchange = function (e) { cfg.wake = e.target.checked; VS.saveCfg(); };
    $("#cVib").onchange = function (e) { cfg.vib = e.target.checked; VS.saveCfg(); };
    $("#cAuto").onchange = function (e) { cfg.autoReconnect = e.target.checked; VS.saveCfg(); };
    $("#cOdo").onchange = function (e) { VS.odoBase = Math.max(0, (+e.target.value || 0) - ride.dist / 1000); VS.store.set("odoBase", VS.odoBase); };
  };
  acts["mt-ok"] = function (el) { maint[+el.dataset.i].last = +odo().toFixed(1); VS.store.set("maint", maint); VS.show("more"); };
  acts["mt-rm"] = function (el) { maint.splice(+el.dataset.i, 1); VS.store.set("maint", maint); VS.show("more"); };
  acts["mt-add"] = function () {
    ui.modal('<h2>Nouveau rappel</h2><label>Nom</label><input id="mtN" maxlength="60" placeholder="ex : Batterie — contrôle des connecteurs"><label>Tous les combien de km ?</label><input id="mtE" type="number" value="500" inputmode="numeric">' +
      '<div class="row" style="margin-top:14px"><button class="btn sec" data-act="dlg-no">Annuler</button><button class="btn" data-act="mt-save">Ajouter</button></div>');
  };
  acts["mt-save"] = function () {
    const n = $("#mtN").value.trim(), e = +$("#mtE").value;
    if (!n || !(e > 0)) { VS.toast("Indique un nom et un nombre de km."); return; }
    maint.push({ n: n.slice(0, 60), every: e, last: +odo().toFixed(1) }); VS.store.set("maint", maint); ui.closeModal(); VS.show("more");
  };
  acts["wipe"] = function () {
    ui.ask({ title: "Tout effacer ?", body: "Trajets, réglages, profil et rappels seront supprimés de ce téléphone.", ok: "Tout effacer", danger: true }).then(function (ok) {
      if (!ok) return;
      try { Object.keys(localStorage).filter(function (k) { return k.indexOf("vs_") === 0; }).forEach(function (k) { localStorage.removeItem(k); }); } catch (e) { /* ignoré */ }
      location.reload();
    });
  };
  function info(title, html) { ui.modal('<h2 style="margin-bottom:8px">' + esc(title) + '</h2><div style="font-size:14px;line-height:1.5">' + html + '</div><button class="btn" style="width:100%;margin-top:14px" data-act="dlg-no">Compris</button>'); }
  acts["help-ble"] = function () {
    info("État du Bluetooth", "<p><b>Confirmé :</b> le téléphone peut chercher des appareils Bluetooth LE, s'y connecter, lister leurs services, lire des valeurs et recevoir des notifications. La batterie standard (service 0x180F) et les capteurs vitesse/cadence standard (0x1816) sont lus automatiquement s'ils existent.</p>" +
      "<p><b>Non confirmé :</b> le format des données de ton AVDL A13 (vitesse, limites). AVDL ne publie rien. Son appli officielle lit pourtant la vitesse et le kilométrage en Bluetooth, donc l'information existe, mais son codage reste à établir.</p>" +
      "<p>Dans <b>Mon vélo → Labo</b>, l'assistant compare ce que le vélo envoie avec ta vitesse GPS pour retrouver la bonne valeur, et le rapport de diagnostic permet de nous aider à compléter le profil.</p>");
  };
  acts["help-capture"] = function () {
    info("Capturer l'appli officielle", "<p>Méthode fiable pour retrouver le protocole (téléphone Android) :</p><ol style='padding-left:18px'><li>Installe l'appli officielle du vélo.</li><li>Réglages Android → Options pour les développeurs → active <b>« Journal HCI Bluetooth »</b> (« snoop log »), puis coupe/rallume le Bluetooth.</li><li>Allume le vélo, ouvre l'appli officielle, connecte-toi, laisse-la afficher la vitesse, puis change <b>une seule</b> limite de vitesse (ex. niveau 1 : 10 → 12 km/h), puis remets-la.</li><li>Options développeur → <b>Créer un rapport de bug</b>, puis partage le fichier (il contient le journal Bluetooth).</li></ol><p>Avec ce fichier, les trames échangées se décodent : commandes de lecture, d'écriture, somme de contrôle, position de la vitesse.</p>");
  };
  acts["help-law"] = function () {
    info("Réglementation et terrain privé", "<p>En France et dans l'Union européenne, un vélo à assistance électrique ne doit pas assister au-delà de <b>25 km/h</b> (puissance continue ≤ 250 W). Au-delà, le véhicule devient un cyclomoteur : immatriculation, assurance, permis/formation, casque homologué.</p><p>Relever la limite est donc réservé à un usage sur <b>terrain privé fermé</b>, sans accès au public. Sur la voie publique, c'est illégal et ton assurance ne te couvrira pas.</p><p>Une limite trop haute sollicite aussi les freins, les pneus, le cadre et la batterie : vérifie qu'ils sont prévus pour ça, porte un casque et des protections. Tu restes seul responsable de l'usage.</p>");
  };
  acts["intro"] = function () {
    info("Bienvenue dans VELO SPEED", "<p>Tableau de bord <b>GPS</b>, trajets, météo, entretien et liaison <b>Bluetooth</b> avec le vélo.</p><p><b>À savoir :</b> la lecture de la vitesse du vélo et le réglage des limites dépendent du protocole Bluetooth de l'AVDL A13, qui n'est pas public. Ces deux fonctions sont donc marquées « non confirmé » tant que le profil n'est pas établi (voir Mon vélo). Le reste fonctionne dès maintenant.</p><p>Ne regardez pas l'écran en roulant : fixez le téléphone et réglez tout à l'arrêt.</p>");
    cfg.seenIntro = true; VS.saveCfg();
  };

  /* ---------- démarrage ---------- */
  VS.refreshInfo();
  VS.show("ride");
  if (!VS.hasNative) VS.toast("Cette appli doit être installée sur Android pour utiliser le GPS et le Bluetooth.");
  if (!cfg.seenIntro) setTimeout(function () { acts["intro"](); }, 400);
})();
