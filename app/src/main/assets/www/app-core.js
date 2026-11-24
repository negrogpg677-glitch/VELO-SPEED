/* VELO SPEED — cœur : état, pont Android, Bluetooth, GPS, trajet en cours. Tout en français. */
(function () {
  "use strict";
  const L = window.VeloLib;
  const VS = window.VS = {};
  VS.L = L;
  VS.$ = function (s, r) { return (r || document).querySelector(s); };
  VS.$$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  VS.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  VS.pad = function (n) { return String(n).padStart(2, "0"); };
  const pad = VS.pad;

  /* ---------- stockage local ---------- */
  VS.store = {
    get: function (k, d) { try { const v = localStorage.getItem("vs_" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("vs_" + k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  };

  /* ---------- réglages ---------- */
  VS.cfg = Object.assign({
    units: "kmh", wheel: 2105, limit: 25, vib: true, wake: true, source: "auto",
    autoReconnect: true, seenIntro: false, limitCap: 25
  }, VS.store.get("cfg", {}));
  VS.saveCfg = function () { VS.store.set("cfg", VS.cfg); };

  /* ---------- UUID ---------- */
  const BASE = "-0000-1000-8000-00805f9b34fb";
  VS.fullUuid = function (u) {
    u = String(u || "").trim().toLowerCase();
    if (/^[0-9a-f]{4}$/.test(u)) return "0000" + u + BASE;
    if (/^[0-9a-f]{8}$/.test(u)) return u + BASE;
    return u;
  };
  VS.shortUuid = function (u) {
    u = String(u || "").toLowerCase();
    return /^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/.test(u) ? u.slice(4, 8) : u;
  };
  VS.isUuid = function (u) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(u); };

  /* ---------- profil de protocole (AVDL A13 : NON CONFIRMÉ) ---------- */
  VS.DEFAULT_PROFILE = {
    name: "AVDL A13 — protocole NON confirmé",
    confirmed: false,
    deviceNames: ["YouFs", "AVDL", "A13", "B9"],
    notes: "Le fabricant ne publie pas le protocole Bluetooth. Aucune valeur n'est inventée ici.",
    speed: { enabled: false, service: "", char: "", offset: 0, len: 2, endian: "le", signed: false, scale: 0.1, unit: "kmh", origin: "" },
    limits: {
      levels: 5, min: 5, max: 25, levelBase: 1, valueScale: 1,
      read: { command: "", service: "", writeChar: "", char: "", fields: [], checksum: { kind: "none" } },
      write: { service: "", char: "", template: "", withResponse: true, checksum: { kind: "none" } }
    }
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  VS.mergeProfile = function (p) {
    const out = clone(VS.DEFAULT_PROFILE);
    if (!p || typeof p !== "object") return out;
    if (typeof p.name === "string") out.name = p.name.slice(0, 80);
    out.confirmed = p.confirmed === true;
    if (Array.isArray(p.deviceNames)) out.deviceNames = p.deviceNames.filter(function (x) { return typeof x === "string"; }).slice(0, 12);
    if (typeof p.notes === "string") out.notes = p.notes.slice(0, 500);
    if (p.speed && typeof p.speed === "object") Object.assign(out.speed, p.speed);
    if (p.limits && typeof p.limits === "object") {
      const l = p.limits;
      ["levels", "min", "max", "levelBase", "valueScale"].forEach(function (k) { if (typeof l[k] === "number") out.limits[k] = l[k]; });
      if (l.read && typeof l.read === "object") Object.assign(out.limits.read, l.read);
      if (l.write && typeof l.write === "object") Object.assign(out.limits.write, l.write);
    }
    return out;
  };
  VS.validateProfile = function (p) {
    const errs = [];
    const chkUuid = function (v, label) { if (v && !VS.isUuid(VS.fullUuid(v))) errs.push(label + " : UUID invalide"); };
    chkUuid(p.speed.service, "Vitesse, service"); chkUuid(p.speed.char, "Vitesse, caractéristique");
    chkUuid(p.limits.read.service, "Lecture limites, service"); chkUuid(p.limits.read.char, "Lecture limites, caractéristique");
    chkUuid(p.limits.read.writeChar, "Lecture limites, écriture de la requête");
    chkUuid(p.limits.write.service, "Écriture limites, service"); chkUuid(p.limits.write.char, "Écriture limites, caractéristique");
    const lim = p.limits;
    if (!(lim.levels >= 1 && lim.levels <= 9)) errs.push("Nombre de niveaux invalide (1 à 9)");
    if (!(lim.min >= 0 && lim.max <= 60 && lim.min < lim.max)) errs.push("Bornes de vitesse invalides (0 ≤ min < max ≤ 60)");
    if (!(lim.valueScale > 0)) errs.push("valueScale doit être > 0");
    const tpl = p.limits.write.template;
    if (tpl) { try { L.buildFrame(tpl, { LEVEL: 1, VALUE: 10 }, p.limits.write.checksum); } catch (e) { errs.push("Modèle d'écriture : " + e.message); } }
    const rc = p.limits.read.command;
    if (rc) { try { L.buildFrame(rc, { LEVEL: 1, VALUE: 10 }, p.limits.read.checksum); } catch (e) { errs.push("Commande de lecture : " + e.message); } }
    const sp = p.speed;
    if (sp.enabled && !(sp.len >= 1 && sp.len <= 4 && sp.offset >= 0 && sp.scale > 0 && L.UNIT[sp.unit])) errs.push("Décodeur de vitesse incomplet");
    return errs;
  };
  VS.profile = VS.mergeProfile(VS.store.get("profile", null));
  VS.saveProfile = function () { VS.store.set("profile", VS.profile); };
  VS.limitsWritable = function () {
    const p = VS.profile, w = p.limits.write;
    return p.confirmed === true && !!w.template && !!w.char && !!w.service;
  };

  /* ---------- état ---------- */
  const S = VS.S = {
    info: {}, tab: "ride", bikeTab: "conn",
    scan: { on: false, list: {} }, conn: { state: "idle", name: "", address: "" },
    services: [], chars: {}, notifying: {}, battery: null, frames: {},
    live: { gps: null, ble: null, cad: null, alt: null },
    gpsOn: false, gpsEnabled: true,
    weather: VS.store.get("weather", null),
    rec: false, analyzer: new L.Analyzer(), analysis: null,
    logs: [], limits: {}, userDisc: false, retries: 0, advOf: {}
  };

  /* ---------- pont Android ---------- */
  VS.hasNative = typeof window.Native !== "undefined";
  VS.T = {
    call: function (m) {
      const a = Array.prototype.slice.call(arguments, 1);
      try { window.Native[m].apply(window.Native, a); return true; }
      catch (e) { VS.log("Erreur du pont Android (" + m + ") : " + e.message); return false; }
    },
    info: function () { try { return JSON.parse(window.Native.getInfo()); } catch (e) { return {}; } },
    lastLocation: function () { try { return JSON.parse(window.Native.lastLocation()); } catch (e) { return null; } }
  };
  VS.refreshInfo = function () { if (VS.hasNative) S.info = VS.T.info(); return S.info; };

  /* ---------- journal et messages ---------- */
  VS.log = function (msg) {
    const d = new Date();
    const line = pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()) + "." + String(d.getMilliseconds()).padStart(3, "0") + "  " + msg;
    S.logs.push(line);
    if (S.logs.length > 800) S.logs.splice(0, S.logs.length - 600);
    const el = VS.$("#log");
    if (el) { const end = el.scrollTop + el.clientHeight >= el.scrollHeight - 24; el.textContent += line + "\n"; if (end) el.scrollTop = el.scrollHeight; }
  };
  let toastTimer = null;
  VS.toast = function (m) {
    const t = VS.$("#toast"); t.textContent = m; t.classList.add("on");
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.remove("on"); }, 3200);
  };
  VS.errMsg = function (code, detail) {
    const m = {
      mtu_timeout: "Le vélo n'a pas répondu à la demande de MTU (souvent déjà négocié). Liaison conservée.",
      retry_133: "Première tentative refusée (code 133) : nouvel essai automatique…",
      location_off: "La localisation du téléphone est désactivée : Android l'exige pour scanner le Bluetooth avant la version 12. Active-la puis réessaie.",
      bt_off: "Le Bluetooth est désactivé. Active-le puis réessaie.",
      scanner_null: "Le scanner Bluetooth n'est pas disponible. Coupe puis rallume le Bluetooth.",
      scan_failed: "Le scan Bluetooth a échoué (code " + detail + "). Coupe puis rallume le Bluetooth.",
      permission: "Autorisation refusée (" + detail + "). Autorise « Appareils à proximité » / la localisation pour VELO SPEED.",
      bad_address: "Adresse Bluetooth invalide.",
      discover_failed: "Impossible de lister les services du vélo (code " + detail + ").",
      read_failed: "Lecture refusée par le vélo (code " + detail + ").",
      op_timeout: "Le vélo n'a pas répondu à temps (" + detail + ").",
      op_refused: "Opération refusée par le téléphone (" + detail + ").",
      op_failed: "Opération Bluetooth en échec (" + detail + ").",
      write_blocked: "Écriture bloquée par sécurité : elle n'a pas été autorisée par l'interface.",
      bad_hex: "Trame invalide.",
      gps_failed: "Le GPS ne démarre pas (" + detail + ")."
    };
    return m[code] || ("Erreur " + code + (detail ? " (" + detail + ")" : ""));
  };
  VS.connMsg = function (status) {
    const m = {
      "-3": "Le vélo n'a pas répondu à la découverte des services. Réessaie.",
      "-4": "Le vélo a cessé de répondre : liaison refermée. Reconnecte-toi.",
      "-1": "Délai dépassé : le vélo n'a pas répondu. Vérifie qu'il est allumé et proche.",
      "-2": "Autorisation Bluetooth manquante.",
      "8": "Connexion perdue (signal trop faible ou vélo éteint).",
      "19": "Le vélo a coupé la connexion (éteint ? déjà connecté à un autre téléphone ou à l'appli officielle ?).",
      "22": "Le téléphone a coupé la connexion.",
      "133": "Échec de connexion (code 133). Ferme l'appli officielle du vélo, coupe/rallume le Bluetooth puis réessaie.",
      "62": "Échec de connexion (code 62). Rapproche-toi du vélo et réessaie."
    };
    return m[String(status)] || ("Connexion interrompue (code " + status + ").");
  };

  /* ---------- événements natifs ---------- */
  const handlers = {}, waiters = [];
  VS.on = function (t, f) { (handlers[t] = handlers[t] || []).push(f); };
  VS.waitFor = function (type, pred, ms) {
    return new Promise(function (res, rej) {
      const w = { type: type, pred: pred || function () { return true; }, res: res };
      w.timer = setTimeout(function () { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); rej(new Error("Délai dépassé")); }, ms || 4000);
      waiters.push(w);
    });
  };
  window.onNative = function (type, data) {
    try { (handlers[type] || []).forEach(function (f) { f(data); }); }
    catch (e) { VS.log("Erreur interne (" + type + ") : " + e.message); }
    for (let i = waiters.length - 1; i >= 0; i--) {
      const w = waiters[i];
      if (w.type === type) { let ok = false; try { ok = w.pred(data); } catch (e) { ok = false; } if (ok) { clearTimeout(w.timer); waiters.splice(i, 1); w.res(data); } }
    }
  };
  VS.render = function () {}; /* remplacé par app-views.js */
  VS.refresh = function (what) { if (VS.onChange) VS.onChange(what); };

  /* Permissions */
  VS.ensurePerm = function (kind) {
    VS.refreshInfo();
    const key = kind === "ble" ? "permBle" : "permLocation";
    if (S.info[key]) return Promise.resolve(true);
    VS.T.call("requestPermissions", kind);
    return VS.waitFor("perm", function (d) { return d.kind === kind; }, 60000)
      .then(function (d) { VS.refreshInfo(); return !!S.info[key]; }, function () { return false; });
  };
  VS.on("perm", function (d) { S.permBlocked = !!d.blocked; VS.refreshInfo(); VS.refresh("perm"); });
  VS.on("mtu", function (d) { S.mtu = d.mtu; VS.log("MTU négocié : " + d.mtu + " (code " + d.status + ")"); VS.refresh("conn"); });

  VS.on("error", function (d) {
    const msg = VS.errMsg(d.code, d.detail);
    VS.log("ERREUR " + d.code + (d.detail ? " (" + d.detail + ")" : ""));
    VS.toast(msg);
  });

  /* ---------- Bluetooth : scan et connexion ---------- */
  VS.on("scanState", function (d) { S.scan.on = !!d.scanning; VS.refresh("scan"); });
  VS.on("scan", function (d) {
    S.scan.list[d.address] = { name: d.name || "", address: d.address, rssi: d.rssi, connectable: d.connectable, services: d.services || [], adv: d.adv || "", type: d.type || 0, bond: d.bond || 10, seen: Date.now() };
    VS.refresh("scan");
  });
  /* Signature « Tuya » (documentation publique du SDK BLE Tuya) : service annoncé 0xA201 ou données constructeur 0x07D0 ;
     après connexion : service GATT 0x1910. Ce n'est qu'une SIGNATURE : elle ne prouve pas que l'A13 est un produit Tuya. */
  VS.adStructs = function (hex) {
    const b = Array.prototype.slice.call(L.hexToBytes(hex || "")), out = [];
    for (let i = 0; i < b.length;) { const n = b[i]; if (!n) break; out.push({ t: b[i + 1], d: b.slice(i + 2, i + 1 + n) }); i += n + 1; }
    return out;
  };
  VS.isTuyaAdv = function (e) {
    if (!e) return false;
    if ((e.services || []).some(function (u) { return String(u).indexOf("0000a201-") === 0; })) return true;
    return VS.adStructs(e.adv).some(function (a) { return a.t === 0xFF && a.d.length >= 2 && a.d[0] === 0xD0 && a.d[1] === 0x07; });
  };
  VS.isTuyaGatt = function () { return (S.services || []).some(function (s) { return String(s.uuid).indexOf("00001910-") === 0; }); };
  /* Liaison radio ouverte mais vélo Tuya non authentifié : le vélo ne se considère PAS connecté (pas de logo Bluetooth, pas de données). */
  VS.linkOnly = function () { return S.conn.state === "connected" && VS.isTuyaGatt(); };
  VS.isLikelyBike = function (name) {
    if (!name) return false;
    const n = name.toLowerCase();
    return VS.profile.deviceNames.some(function (k) { return k && n.indexOf(k.toLowerCase()) >= 0; });
  };
  VS.startScan = function () {
    VS.ensurePerm("ble").then(function (ok) {
      if (!ok) { VS.toast(S.permBlocked ? "Autorisation refusée définitivement : ouvrez les réglages de l'appli." : "Autorisez « Appareils à proximité » (ou la localisation sur Android 11 et moins) pour chercher le vélo."); VS.refresh("perm"); return; }
      VS.refreshInfo();
      if (!S.info.bleEnabled) { VS.T.call("requestEnableBluetooth"); VS.toast("Active le Bluetooth, puis relance la recherche."); return; }
      S.scan.list = {};
      VS.T.call("bleStartScan");
      VS.log("Scan Bluetooth démarré");
    });
  };
  VS.stopScan = function () { VS.T.call("bleStopScan"); };
  VS.connect = function (address) {
    S.userDisc = false; S.retries = 0;
    S.conn = { state: "connecting", name: (S.scan.list[address] || {}).name || "", address: address };
    VS.T.call("bleConnect", address);
    VS.log("Connexion à " + address);
    VS.refresh("conn");
  };
  VS.disconnect = function () { S.userDisc = true; VS.T.call("bleDisconnect"); };

  function resetLinkState() {
    S.services = []; S.chars = {}; S.notifying = {}; S.battery = null; S.live.ble = null; S.live.cad = null;
    VS.T.call("bleAllowWrites", false);
    VS.csc.reset();
  }
  VS.csc = L.makeCsc();
  VS.on("conn", function (d) {
    if (d.state === "connecting") { S.conn.state = "connecting"; }
    else if (d.state === "connected") {
      S.conn = { state: "connected", name: d.name || S.conn.name, address: d.address || S.conn.address, bond: d.bond, type: d.type };
      S.retries = 0; VS.log("Connecté à " + (S.conn.name || S.conn.address) + " — découverte des services…");
      VS.toast("Liaison Bluetooth ouverte — vérification du vélo…");
    } else {
      const wasUser = S.userDisc, addr = d.address || S.conn.address;
      const wasConnected = d.state === "disconnected";
      S.conn = { state: "idle", name: S.conn.name, address: addr };
      resetLinkState();
      VS.log((wasConnected ? "Déconnecté" : "Échec de connexion") + " (code " + d.status + ")");
      if (!wasUser) {
        VS.toast(VS.connMsg(d.status));
        if (VS.cfg.autoReconnect && S.retries < 3 && addr) {
          S.retries++; S.conn.state = "connecting";
          setTimeout(function () { if (S.conn.state === "connecting" && !S.userDisc) { VS.log("Reconnexion automatique (" + S.retries + "/3)"); VS.T.call("bleConnect", addr); } }, 2000);
        }
      }
    }
    VS.refresh("conn");
  });
  VS.on("services", function (d) {
    S.services = d.services || []; S.chars = {};
    S.services.forEach(function (s) {
      s.characteristics.forEach(function (c) { S.chars[s.uuid + "/" + c.uuid] = { svc: s.uuid, chr: c.uuid, props: c.props }; });
    });
    VS.log(S.services.length + " service(s), " + Object.keys(S.chars).length + " caractéristique(s)");
    armAfterServices();
    if (VS.isTuyaGatt()) { VS.log("Service Tuya 0x1910 : le vélo attend une authentification chiffrée. Liaison radio seulement, le vélo ne se considère pas connecté."); VS.toast("Vélo Tuya : liaison radio seulement, le vélo ne valide pas la connexion."); }
    VS.refresh("services");
  });
  VS.findChar = function (chr) {
    chr = VS.fullUuid(chr);
    const k = Object.keys(S.chars).filter(function (x) { return S.chars[x].chr === chr; })[0];
    return k ? S.chars[k] : null;
  };
  function armAfterServices() {
    Object.keys(S.chars).forEach(function (k) {
      const c = S.chars[k], s = VS.shortUuid(c.chr), p = c.props;
      if (s === "2a19") { if (p.indexOf("read") >= 0) VS.T.call("bleRead", c.svc, c.chr); if (p.indexOf("notify") >= 0) VS.T.call("bleNotify", c.svc, c.chr, true); }
      if (s === "2a5b" && p.indexOf("notify") >= 0) VS.T.call("bleNotify", c.svc, c.chr, true);
    });
    const sp = VS.profile.speed;
    if (sp.enabled && sp.char) { const c = VS.findChar(sp.char); if (c) VS.T.call("bleNotify", c.svc, c.chr, true); }
  }
  VS.on("notifyState", function (d) {
    S.notifying[d.char] = !!d.enabled && d.status === 0;
    VS.log("Notifications " + VS.shortUuid(d.char) + " : " + (d.status === 0 ? (d.enabled ? "activées" : "désactivées") : "échec (code " + d.status + ")"));
    VS.refresh("notify");
  });
  VS.on("value", function (d) {
    const bytes = L.hexToBytes(d.hex), s = VS.shortUuid(d.char), now = Date.now();
    S.frames[d.char] = (S.frames[d.char] || 0) + 1;
    VS.log(s + (d.kind === "read" ? " (lecture)" : "") + "  " + L.bytesToHex(bytes, " "));
    if (S.rec && d.kind === "notify") S.analyzer.addFrame(d.char, bytes, now);
    if (s === "2a5b") {
      const o = VS.csc.push(bytes, VS.cfg.wheel);
      if (o.speed !== undefined) S.live.ble = { v: o.speed, t: now, src: "capteur standard" };
      if (o.cadence !== undefined) S.live.cad = { v: o.cadence, t: now };
    } else if (s === "2a19" && bytes.length) { S.battery = bytes[0]; VS.refresh("battery"); }
    const sp = VS.profile.speed;
    if (sp.enabled && sp.char && d.char === VS.fullUuid(sp.char)) {
      const v = L.decodeSpeed(bytes, sp);
      if (v !== null) S.live.ble = { v: Math.max(0, v), t: now, src: sp.origin === "analyseur" ? "déduit (à valider)" : "profil" };
    }
  });

  /* ---------- GPS ---------- */
  VS.startGps = function () {
    return VS.ensurePerm("location").then(function (ok) {
      if (!ok) { VS.toast("Autorise la localisation « précise » pour le GPS."); return false; }
      VS.T.call("gpsStart"); S.gpsOn = true; return true;
    });
  };
  VS.stopGps = function () { if (!S.rec && !ride.run) { VS.T.call("gpsStop"); S.gpsOn = false; S.live.gps = null; } };
  VS.on("gpsState", function (d) {
    if (d.enabled === false) { S.gpsEnabled = false; VS.toast("Le GPS du téléphone est désactivé. Active la localisation dans les réglages Android."); }
    if (d.enabled === true) S.gpsEnabled = true;
    VS.refresh("gps");
  });
  function hav(a, b, c, d) {
    const R = 6371000, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
    const h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  VS.hav = hav;
  let lastFix = null;
  VS.on("gps", function (g) {
    const now = Date.now();
    let ms = g.speed;
    if (ms == null && lastFix && now > lastFix.t) ms = hav(lastFix.lat, lastFix.lon, g.lat, g.lon) / ((now - lastFix.t) / 1000);
    lastFix = { lat: g.lat, lon: g.lon, t: now };
    const bad = g.acc != null && g.acc > 60;
    let kmh = ms == null ? 0 : Math.max(0, ms * 3.6);
    if (kmh < 1.5 || bad) kmh = 0;
    S.live.gps = { v: kmh, t: now, acc: g.acc, lat: g.lat, lon: g.lon };
    S.live.alt = g.alt;
    if (S.rec && !bad) S.analyzer.addGps(kmh, now);
    if (ride.run && !bad) {
      const tr = ride.track, last = tr[tr.length - 1];
      if (!last || hav(last[0], last[1], g.lat, g.lon) >= 10 || now - last[2] >= 10000) {
        tr.push([+g.lat.toFixed(6), +g.lon.toFixed(6), now, +kmh.toFixed(1), g.alt == null ? null : Math.round(g.alt)]);
        if (tr.length > 4000) tr.splice(1, 1);
      }
    }
    VS.refresh("gps");
  });

  /* ---------- vitesse affichée ---------- */
  VS.currentSpeed = function () {
    const now = Date.now(), b = S.live.ble, g = S.live.gps;
    const bOk = !!(b && now - b.t < 3500), gOk = !!(g && now - g.t < 5000);
    let src = VS.cfg.source;
    if (src === "auto") src = bOk ? "ble" : "gps";
    if (src === "ble") return { v: bOk ? b.v : 0, src: "VÉLO (BLUETOOTH)", ok: bOk, kind: "ble" };
    return { v: gOk ? g.v : 0, src: "GPS", ok: gOk, kind: "gps" };
  };

  /* ---------- trajet ---------- */
  VS.rides = VS.store.get("rides", []);
  VS.odoBase = VS.store.get("odoBase", 0);
  const ride = VS.ride = { run: false, started: false, dist: 0, move: 0, total: 0, max: 0, t0: 0, track: [] };
  VS.rideAvg = function () { return ride.move > 0 ? ride.dist / ride.move * 3.6 : 0; };
  VS.startRide = function () {
    if (ride.run) return;
    ride.run = true;
    if (!ride.started) { ride.started = true; ride.t0 = Date.now(); }
    VS.T.call("keepScreenOn", !!VS.cfg.wake);
    VS.startGps();
    VS.refresh("ride");
  };
  VS.pauseRide = function () { ride.run = false; VS.T.call("keepScreenOn", false); VS.refresh("ride"); };
  VS.resetRide = function () {
    Object.assign(ride, { run: false, started: false, dist: 0, move: 0, total: 0, max: 0, t0: 0, track: [] });
    VS.T.call("keepScreenOn", false);
  };
  VS.endRide = function () {
    ride.run = false;
    let saved = null;
    if (ride.total >= 10 && ride.dist >= 20) {
      saved = {
        id: ride.t0, t: ride.t0, dur: Math.round(ride.total), mv: Math.round(ride.move),
        km: +(ride.dist / 1000).toFixed(3), max: +ride.max.toFixed(1), avg: +VS.rideAvg().toFixed(1),
        src: VS.currentSpeed().kind, track: ride.track.slice()
      };
      VS.rides.unshift(saved);
      VS.rides.forEach(function (r, i) { if (i >= 30) delete r.track; }); /* la mémoire du téléphone est limitée */
      if (!VS.store.set("rides", VS.rides)) { VS.rides.forEach(function (r) { delete r.track; }); VS.store.set("rides", VS.rides); }
      VS.odoBase = +(VS.odoBase + ride.dist / 1000).toFixed(3); VS.store.set("odoBase", VS.odoBase);
    }
    VS.resetRide();
    VS.stopGps();
    VS.refresh("ride");
    return saved;
  };

  let lastTick = performance.now();
  setInterval(function () {
    const now = performance.now(), dt = Math.min((now - lastTick) / 1000, 2); lastTick = now;
    const s = VS.currentSpeed();
    if (ride.run) {
      ride.total += dt;
      if (s.v >= 1) { ride.dist += s.v / 3.6 * dt; ride.move += dt; }
      if (s.v > ride.max) ride.max = s.v;
    }
    if (VS.onTick) VS.onTick(s);
  }, 500);
})();
