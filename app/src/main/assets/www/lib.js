/* VELO SPEED — bibliothèque pure (sans accès au téléphone), testable avec Node.
   Contient : conversion hexadécimale, décodage d'octets, capteur vitesse/cadence
   standard (Bluetooth SIG 0x1816), sommes de contrôle, construction de trames
   d'écriture et assistant d'identification de la vitesse (corrélation avec le GPS). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.VeloLib = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const UNIT = { kmh: 1, ms: 3.6, mph: 1.609344 };

  function hexToBytes(h) {
    h = String(h || "").replace(/[^0-9a-fA-F]/g, "");
    if (h.length % 2) throw new Error("Chaîne hexadécimale de longueur impaire");
    const a = [];
    for (let i = 0; i < h.length; i += 2) a.push(parseInt(h.substr(i, 2), 16));
    return a;
  }
  function bytesToHex(a, sep) {
    return Array.from(a).map(function (b) { return (b & 255).toString(16).padStart(2, "0"); }).join(sep || "");
  }

  /* Lit un entier de 1 à 4 octets. f = {offset, len, endian:"le"|"be", signed} */
  function readField(b, f) {
    const o = f.offset | 0, n = f.len | 0;
    if (n < 1 || n > 4 || o < 0 || o + n > b.length) return null;
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + b[f.endian === "be" ? o + i : o + n - 1 - i];
    if (f.signed) { const lim = Math.pow(2, 8 * n); if (v >= lim / 2) v -= lim; }
    return v;
  }
  /* Décode une vitesse en km/h à partir d'une spécification {offset,len,endian,signed,scale,unit}. */
  function decodeSpeed(b, spec) {
    const raw = readField(b, spec);
    if (raw === null) return null;
    const v = raw * (Number(spec.scale) || 0) * (UNIT[spec.unit] || 1);
    return isFinite(v) ? v : null;
  }

  /* Capteur vitesse/cadence standard (caractéristique 0x2A5B). État conservé entre deux trames. */
  function makeCsc() {
    let prev = null;
    return {
      reset: function () { prev = null; },
      push: function (b, wheelMm) {
        if (!b.length) return {};
        const f = b[0];
        let o = 1, w = null, k = null;
        const u16 = function (i) { return b[i] | (b[i + 1] << 8); };
        if (f & 1) {
          if (b.length < o + 6) return {};
          w = { r: (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 16777216, t: u16(o + 4) };
          o += 6;
        }
        if (f & 2) {
          if (b.length < o + 4) return {};
          k = { r: u16(o), t: u16(o + 2) };
        }
        const out = {};
        if (w && prev && prev.w) {
          let dr = w.r - prev.w.r; if (dr < 0) dr += 4294967296;
          let dt = w.t - prev.w.t; if (dt < 0) dt += 65536;
          if (dt > 0) out.speed = (dr * wheelMm / 1000) / (dt / 1024) * 3.6;
          else if (dr === 0) out.speed = 0;
        }
        if (k && prev && prev.k) {
          let dr = k.r - prev.k.r; if (dr < 0) dr += 65536;
          let dt = k.t - prev.k.t; if (dt < 0) dt += 65536;
          if (dt > 0) out.cadence = dr / (dt / 1024) * 60;
          else if (dr === 0) out.cadence = 0;
        }
        prev = { w: w || (prev && prev.w) || null, k: k || (prev && prev.k) || null };
        return out;
      }
    };
  }

  /* Sommes de contrôle courantes. Renvoie un tableau d'octets à ajouter. */
  function checksum(kind, bytes) {
    switch (kind || "none") {
      case "none": return [];
      case "sum8": return [bytes.reduce(function (a, b) { return a + b; }, 0) & 255];
      case "neg_sum8": return [(256 - (bytes.reduce(function (a, b) { return a + b; }, 0) & 255)) & 255];
      case "xor8": return [bytes.reduce(function (a, b) { return a ^ b; }, 0)];
      case "crc16_modbus_le":
      case "crc16_modbus_be": {
        let crc = 0xFFFF;
        for (let i = 0; i < bytes.length; i++) {
          crc ^= bytes[i];
          for (let j = 0; j < 8; j++) crc = (crc & 1) ? ((crc >> 1) ^ 0xA001) : (crc >> 1);
        }
        const lo = crc & 255, hi = (crc >> 8) & 255;
        return kind === "crc16_modbus_le" ? [lo, hi] : [hi, lo];
      }
      default: throw new Error("Somme de contrôle inconnue : " + kind);
    }
  }

  /* Construit une trame d'écriture à partir d'un modèle hexadécimal.
     Jetons : {LEVEL} {VALUE} (1 octet), {VALUE:u16le} {VALUE:u16be}, {LEVEL:u16le}, etc.
     chk = {kind, from, to} : somme calculée sur les octets [from, to) (to<0 : depuis la fin) puis ajoutée. */
  function buildFrame(template, vars, chk) {
    let t = String(template || "");
    if (!t) throw new Error("Modèle de trame vide");
    t = t.replace(/\{(LEVEL|VALUE)(?::(u8|u16le|u16be))?\}/g, function (_m, name, fmt) {
      const v = Math.round(Number(vars[name]));
      if (!isFinite(v) || v < 0) throw new Error("Valeur invalide pour " + name);
      fmt = fmt || "u8";
      if (fmt === "u8") { if (v > 255) throw new Error(name + " dépasse 255"); return v.toString(16).padStart(2, "0"); }
      if (v > 65535) throw new Error(name + " dépasse 65535");
      const hi = (v >> 8) & 255, lo = v & 255;
      return fmt === "u16le" ? bytesToHex([lo, hi]) : bytesToHex([hi, lo]);
    });
    if (/[{}]/.test(t)) throw new Error("Jeton inconnu dans le modèle");
    const bytes = hexToBytes(t);
    if (chk && chk.kind && chk.kind !== "none") {
      const from = chk.from == null ? 0 : chk.from;
      let to = chk.to == null ? bytes.length : chk.to;
      if (to < 0) to = bytes.length + to;
      if (from < 0 || to > bytes.length || from >= to) throw new Error("Plage de somme de contrôle invalide");
      return bytes.concat(checksum(chk.kind, bytes.slice(from, to)));
    }
    return bytes;
  }

  /* ---------- Assistant d'identification de la vitesse ---------- */
  function Analyzer() { this.frames = []; this.gps = []; }
  Analyzer.prototype.reset = function () { this.frames = []; this.gps = []; };
  Analyzer.prototype.addFrame = function (key, bytes, t) {
    if (this.frames.length < 8000 && bytes.length > 0 && bytes.length <= 64) this.frames.push({ key: key, b: bytes, t: t });
  };
  Analyzer.prototype.addGps = function (v, t) {
    this.gps.push({ v: v, t: t });
    if (this.gps.length > 4000) this.gps.shift();
  };
  Analyzer.prototype.gpsAt = function (t) {
    const g = this.gps;
    if (g.length < 2 || t < g[0].t || t > g[g.length - 1].t) return null;
    let lo = 0, hi = g.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (g[mid].t <= t) lo = mid; else hi = mid; }
    const a = g[lo], b = g[hi];
    if (b.t - a.t > 4000) return null; /* trou GPS : on n'invente rien */
    return b.t === a.t ? a.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  };
  function pearson(xs, ys) {
    const n = xs.length;
    let mx = 0, my = 0;
    for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
    mx /= n; my /= n;
    let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const dx = xs[i] - mx, dy = ys[i] - my;
      sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return null;
    return { r: sxy / Math.sqrt(sxx * syy), slope: sxy / sxx, intercept: my - (sxy / sxx) * mx };
  }
  function isNiceScale(x) {
    if (!(x > 0)) return false;
    const m = x / Math.pow(10, Math.floor(Math.log10(x)));
    return [1, 1.5, 2, 2.5, 3, 3.6, 5, 6, 7.2, 8, 10].some(function (n) { return Math.abs(m - n) / n < 0.02; });
  }
  function round3(x) { return Number(x.toPrecision(3)); }

  /* Cherche, dans les trames reçues, un champ (position, taille, ordre) dont la valeur
     suit la vitesse GPS. Renvoie des candidats classés ; rien n'est appliqué automatiquement. */
  Analyzer.prototype.analyze = function (opts) {
    opts = opts || {};
    const minN = opts.minSamples || 25, minRange = opts.minRangeKmh || 6;
    const stats = { frames: this.frames.length, gpsPoints: this.gps.length, gpsMin: null, gpsMax: null };
    if (this.gps.length) {
      stats.gpsMin = Math.min.apply(null, this.gps.map(function (g) { return g.v; }));
      stats.gpsMax = Math.max.apply(null, this.gps.map(function (g) { return g.v; }));
    }
    if (this.gps.length < 10) return { ok: false, reason: "Pas assez de points GPS (roule quelques minutes dehors).", candidates: [], stats: stats };
    if (stats.gpsMax - stats.gpsMin < minRange) return { ok: false, reason: "La vitesse GPS n'a pas assez varié (écart < " + minRange + " km/h). Accélère et ralentis plusieurs fois.", candidates: [], stats: stats };
    if (this.frames.length < minN) return { ok: false, reason: "Pas assez de trames Bluetooth reçues.", candidates: [], stats: stats };

    const groups = {};
    for (let i = 0; i < this.frames.length; i++) {
      const f = this.frames[i];
      const gk = f.key + "|" + f.b.length + "|" + f.b[0];
      (groups[gk] = groups[gk] || []).push(f);
    }
    const lags = [-1000, 0, 1000, 2000];
    const cands = [];
    Object.keys(groups).forEach(function (gk) {
      const fr = groups[gk];
      if (fr.length < minN) return;
      const n = fr[0].b.length;
      const defs = [];
      for (let o = 0; o < n; o++) {
        defs.push({ offset: o, len: 1, endian: "le" });
        if (o + 2 <= n) { defs.push({ offset: o, len: 2, endian: "le" }); defs.push({ offset: o, len: 2, endian: "be" }); }
      }
      defs.forEach(function (d) {
        let best = null;
        lags.forEach(function (lag) {
          const xs = [], ys = [];
          for (let i = 0; i < fr.length; i++) {
            const y = this.gpsAt(fr[i].t + lag);
            if (y === null) continue;
            xs.push(readField(fr[i].b, d)); ys.push(y);
          }
          if (xs.length < minN) return;
          const p = pearson(xs, ys);
          if (p && p.r > 0 && (!best || p.r > best.r)) best = { r: p.r, slope: p.slope, intercept: p.intercept, n: xs.length, lag: lag };
        }, this);
        if (best && best.r >= 0.85 && best.slope > 0) {
          const parts = gk.split("|");
          cands.push({
            char: parts[0], length: Number(parts[1]), firstByte: Number(parts[2]),
            offset: d.offset, len: d.len, endian: d.endian,
            r: round3(best.r), scale: round3(best.slope), intercept: round3(best.intercept),
            n: best.n, lagMs: best.lag
          });
        }
      }, this);
    }, this);
    /* Classement : une vraie vitesse a une ordonnée à l'origine proche de 0 et une échelle « ronde »
       (0,1 ; 0,01 ; 1 ; 3,6…). On préfère ensuite la meilleure corrélation puis le champ le plus large
       (un octet seul déborde au-delà de 255). */
    const range = stats.gpsMax - stats.gpsMin;
    cands.forEach(function (c) {
      c.interceptOk = Math.abs(c.intercept) <= Math.max(1, 0.05 * range);
      c.niceScale = isNiceScale(c.scale);
    });
    cands.sort(function (a, b) {
      return (b.interceptOk - a.interceptOk) || (b.niceScale - a.niceScale) ||
        (Math.round(b.r * 100) - Math.round(a.r * 100)) || (b.len - a.len) || (b.n - a.n);
    });
    return {
      ok: cands.length > 0,
      reason: cands.length ? "" : "Aucun champ ne suit clairement la vitesse GPS. Le vélo répond peut-être seulement à des requêtes (il faut alors capturer le dialogue de l'appli officielle).",
      candidates: cands.slice(0, 8), stats: stats
    };
  };

  return {
    UNIT: UNIT, hexToBytes: hexToBytes, bytesToHex: bytesToHex, readField: readField,
    decodeSpeed: decodeSpeed, makeCsc: makeCsc, checksum: checksum, buildFrame: buildFrame, Analyzer: Analyzer
  };
});
