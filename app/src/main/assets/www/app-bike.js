/* VELO SPEED — onglet « Mon vélo » : connexion, limites de vitesse, laboratoire Bluetooth. */
(function () {
  "use strict";
  const VS = window.VS, L = VS.L, $ = VS.$, esc = VS.esc, S = VS.S, cfg = VS.cfg, T = VS.T, ui = VS.ui, acts = VS.acts, views = VS.views, pad = VS.pad;
  const bike = VS.bike = {};
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  const has = function (c, p) { return c.props.indexOf(p) >= 0; };
  S.showUnnamed = false;

  views.bike = function () {
    VS.refreshInfo();
    const t = S.bikeTab;
    const seg = [["conn", "Connexion"], ["limits", "Limites"], ["lab", "Labo"]].map(function (x) {
      return '<button class="' + (t === x[0] ? "on" : "") + '" data-act="bike-tab" data-t="' + x[0] + '">' + x[1] + '</button>';
    }).join("");
    return '<h1 class="title">Mon vélo</h1><div class="seg">' + seg + '</div>' + (t === "limits" ? limitsView() : t === "lab" ? labView() : connView());
  };
  acts["bike-tab"] = function (el) { S.bikeTab = el.dataset.t; VS.show("bike"); };
  VS.after.bike = function () {
    if (S.bikeTab === "lab") { const el = $("#log"); if (el) { el.textContent = S.logs.slice(-300).join("\n") + "\n"; el.scrollTop = el.scrollHeight; } }
    if (S.bikeTab === "limits") { Object.keys(S.limits).forEach(function (k) { const i = $("#lv" + k); if (i && !i.value) i.value = S.limits[k]; }); }
  };

  /* =====================================================================
     CONNEXION
     ===================================================================== */
  function statusBox() {
    const i = S.info;
    if (!VS.hasNative) return '<div class="box bad">Le Bluetooth et le GPS ne fonctionnent que dans l\'appli Android installée.</div>';
    if (i.bleSupported === false) return '<div class="box bad">Ce téléphone ne gère pas le Bluetooth Low Energy : la connexion au vélo est impossible.</div>';
    let h = "";
    if (!i.bleEnabled) h += '<div class="box sun" style="margin-bottom:10px">Le Bluetooth est désactivé.<div class="row" style="margin-top:8px"><button class="btn sm sky" data-act="bt-enable">Activer</button></div></div>';
    if (!i.permBle) h += '<div class="box lav" style="margin-bottom:10px">Pour chercher le vélo, VELO SPEED a besoin de l\'autorisation « Appareils à proximité » (Android 11 et moins : « Localisation »). Elle ne sert pas à vous localiser.' + (S.permBlocked ? '<br><b>Android ne redemande plus cette autorisation :</b> ouvrez les réglages de l\'appli, puis Autorisations.' : '') + '<div class="row" style="margin-top:8px">' + (S.permBlocked ? '<button class="btn sm" data-act="perm-settings">Ouvrir les réglages de l\'appli</button>' : '<button class="btn sm" data-act="perm-ble">Autoriser</button>') + '</div></div>';
    if ((i.sdk || 99) < 31 && i.locationEnabled === false) h += '<div class="box sun" style="margin-bottom:10px">La localisation du téléphone est désactivée : Android la réclame pour le scan Bluetooth avant la version 12.<div class="row" style="margin-top:8px"><button class="btn sm" data-act="loc-settings">Ouvrir les réglages</button></div></div>';
    return h;
  }
  bike.scanList = function () {
    const all = Object.keys(S.scan.list).map(function (k) { return S.scan.list[k]; });
    const named = all.filter(function (d) { return d.name; }), unnamed = all.length - named.length;
    const rank = function (a, b) { return (VS.isLikelyBike(b.name) - VS.isLikelyBike(a.name)) || (b.rssi - a.rssi); };
    const shown = (S.showUnnamed ? all : named).sort(rank).slice(0, 40);
    let h = shown.map(function (d) {
      const sig = d.rssi > -60 ? "signal fort" : d.rssi > -80 ? "signal moyen" : "signal faible";
      return '<div data-act="bike-connect" data-addr="' + esc(d.address) + '"><div class="grow"><b>' + esc(d.name || "Appareil sans nom") + '</b><small>' + esc(d.address) + ' · ' + d.rssi + ' dBm (' + sig + ')</small></div>' +
        (VS.isLikelyBike(d.name) ? '<span class="tag pink">Probable</span>' : "") + (d.connectable === false ? '<span class="tag">non connectable</span>' : "") + (d.type === 1 ? '<span class="tag sun">classique seul</span>' : "") + (VS.isTuyaAdv(d) ? '<span class="tag sun">signature Tuya</span>' : "") + (d.bond === 12 ? '<span class="tag">appairé</span>' : "") + '</div>';
    }).join("");
    if (!shown.length) h = '<p class="note">' + (S.scan.on ? "Recherche en cours… allume le vélo et approche-toi." : "Aucun appareil trouvé pour l'instant.") + '</p>';
    if (unnamed && !S.showUnnamed) h += '<p class="note">' + unnamed + ' appareil(s) sans nom masqué(s). <button class="btn sec sm" data-act="show-unnamed">Afficher</button></p>';
    return h;
  };
  /* ----- contrôle de compatibilité : « vérifié » = constaté à l'instant sur ce téléphone ; « non confirmé » = dépend du protocole inconnu de l'A13 ----- */
  function compatRows() {
    const i = S.info, c = S.conn, p = VS.profile, rows = [];
    const add = function (label, st, txt) { rows.push({ label: label, st: st, txt: txt }); };
    const all = Object.keys(S.scan.list).map(function (k) { return S.scan.list[k]; });
    const likely = all.filter(function (d) { return VS.isLikelyBike(d.name); })[0];
    const bonded = (i.bonded || []).filter(function (d) { return VS.isLikelyBike(d.name); });
    add("Bluetooth Low Energy sur ce téléphone", i.bleSupported === false ? "bad" : "ok", i.bleSupported === false ? "Absent : connexion impossible." : "Pris en charge.");
    add("Bluetooth activé", i.bleEnabled ? "ok" : "todo", i.bleEnabled ? "Activé." : "À activer.");
    add("Autorisations Bluetooth", i.permBle ? "ok" : S.permBlocked ? "bad" : "todo", i.permBle ? "Accordées." : S.permBlocked ? "Refusées définitivement : réglages de l'appli." : "À accorder.");
    if ((i.sdk || 99) < 31) add("Localisation du téléphone (Android 11 et moins)", i.locationEnabled === false ? "todo" : "ok", i.locationEnabled === false ? "Désactivée : le scan ne renverra rien." : "Active.");
    if (likely) add("Vélo détecté", "ok", likely.name + " · " + likely.rssi + " dBm");
    else if (bonded.some(function (d) { return d.type === 1; })) add("Vélo détecté", "bad", "Appairé en Bluetooth CLASSIQUE (« " + bonded[0].name + " ») : invisible au scan BLE. VELO SPEED ne sait pas lui parler.");
    else add("Vélo détecté", c.state === "connected" ? "ok" : "todo", c.state === "connected" ? "Connecté." : "Lancer la recherche, vélo allumé, appli officielle fermée.");
    if (likely) add("Vélo connectable (BLE)", likely.connectable === false ? "bad" : "ok", likely.connectable === false ? "L'annonce indique « non connectable »." : "Oui" + (likely.type === 3 ? " (double mode)" : "") + ".");
    add("Connexion GATT", c.state === "connected" ? "ok" : "todo", c.state === "connected" ? "Établie" + (c.bond === 12 ? " · appairé" : " · sans appairage") + (S.mtu ? " · MTU " + S.mtu : "") + "." : "Pas encore connecté.");
    const tuyaAdv = all.some(function (d) { return VS.isTuyaAdv(d) && (VS.isLikelyBike(d.name) || d.address === c.address); }), tuya = tuyaAdv || VS.isTuyaGatt();
    add("Protocole en clair (sans chiffrement)", tuya ? "bad" : "unconf", tuya ? "Signature Tuya détectée : trames chiffrées, clé du compte propriétaire requise. Le profil en clair ne peut pas fonctionner." : "NON CONFIRMÉ : signature Tuya non observée pour l'instant (lancer un scan vélo allumé).");
    add("Services découverts", S.services.length ? "ok" : "todo", S.services.length ? S.services.length + " service(s)." : "Aucun (connexion requise).");
    add("Données envoyées par le vélo", (S.rxN || 0) > 0 ? "ok" : "todo", (S.rxN || 0) > 0 ? S.rxN + " trame(s) reçue(s)." : c.state === "connected" ? "Aucune : activer l'écoute dans Labo." : "Connexion requise.");
    const fresh = S.live.ble && Date.now() - S.live.ble.t < 3500;
    add("Vitesse réelle du vélo", p.speed.enabled && fresh ? "ok" : "unconf", p.speed.enabled && fresh ? "Décodée" + (p.speed.origin === "analyseur" ? " (déduite : à valider par rapport au GPS)." : ".") : "NON CONFIRMÉ : format A13 inconnu, profil requis.");
    add("Lecture et réglage des limites", Object.keys(S.limits).length && p.confirmed ? "ok" : "unconf", Object.keys(S.limits).length && p.confirmed ? "Lecture réussie avec le profil." : "NON CONFIRMÉ : protocole A13 inconnu, écriture verrouillée.");
    return rows;
  }
  function compatView() {
    const tag = { ok: '<span class="tag mint">Vérifié</span>', todo: '<span class="tag sun">À faire</span>', bad: '<span class="tag bad">Bloquant</span>', unconf: '<span class="tag sun">Non confirmé</span>' };
    return '<div class="card"><h2>Contrôle de compatibilité</h2><p class="note">« Vérifié » : constaté à l\'instant sur ce téléphone. « Non confirmé » : dépend du protocole de l\'A13, qui n\'est pas public.</p><div class="list">' +
      compatRows().map(function (r) { return '<div><div class="grow"><b>' + esc(r.label) + '</b><small>' + esc(r.txt) + '</small></div>' + tag[r.st] + '</div>'; }).join("") + '</div></div>';
  }
  VS.on("value", function (d) { if (d.kind === "notify") S.rxN = (S.rxN || 0) + 1; });
  function connView() {
    const c = S.conn, p = VS.profile, sp = p.speed;
    let state;
    if (c.state === "connected") {
      state = '<div class="row sp"><div><h2>' + esc(c.name || "Appareil") + '</h2><div class="note">' + esc(c.address) + '</div></div><span class="chip ok"><span class="dot"></span>Connecté</span></div>' +
        '<div class="grid2" style="margin-top:10px"><div class="stat mint"><small>Batterie</small><b class="num">' + (S.battery == null ? "—" : S.battery + " <i>%</i>") + '</b></div><div class="stat sky"><small>Vitesse reçue</small><b class="num" id="liveBle">—</b></div></div>' +
        '<div class="row" style="margin-top:12px"><button class="btn sec" data-act="bike-disc">Déconnecter</button></div>';
    } else if (c.state === "connecting") {
      state = '<div class="row sp"><h2>Connexion en cours…</h2><span class="chip warn"><span class="dot"></span>' + esc(c.name || c.address) + '</span></div><div class="row" style="margin-top:12px"><button class="btn sec" data-act="bike-disc">Annuler</button></div>';
    } else {
      state = '<div class="row sp"><h2>Non connecté</h2><span class="chip"><span class="dot"></span>Inactif</span></div><p class="note">Allume le vélo, ferme l\'appli officielle (une seule connexion à la fois), puis lance la recherche.</p>' +
        '<div class="row"><button class="btn" data-act="scan-toggle">' + (S.scan.on ? "Arrêter la recherche" : "Rechercher mon vélo") + '</button></div>';
    }
    const speedTxt = !sp.enabled ? "Aucun décodeur actif" : sp.origin === "analyseur" ? "Actif — déduit par l'assistant (à valider)" : "Actif — décrit par le profil";
    return statusBox() + '<div class="card">' + state + '</div>' +
      (c.state === "idle" ? '<div class="card"><h2>Appareils trouvés</h2><div class="list" id="scanList" style="margin-top:6px">' + bike.scanList() + '</div></div>' : "") +
      compatView() +
      '<div class="card"><div class="row sp"><h2>Profil du vélo</h2>' + (p.confirmed ? '<span class="tag mint">Confirmé</span>' : '<span class="tag sun">NON CONFIRMÉ</span>') + '</div>' +
      '<p class="note"><b>' + esc(p.name) + '</b></p>' +
      '<div class="list"><div><div class="grow"><b>Lecture de la vitesse du vélo</b><small>' + esc(speedTxt) + '</small></div></div>' +
      '<div><div class="grow"><b>Réglage des limites de vitesse</b><small>' + (VS.limitsWritable() ? "Disponible (profil confirmé)" : "Indisponible tant que le protocole n'est pas confirmé") + '</small></div></div></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sec sm grow" data-act="profile-open">Voir / importer un profil</button></div>' +
      (p.confirmed ? "" : '<p class="note" style="margin-top:8px">Pourquoi ? AVDL ne publie pas le protocole Bluetooth de l\'A13. Voir <b>Labo</b> pour l\'identifier.</p>') + '</div>';
  }
  acts["perm-settings"] = function () { T.call("openAppSettings"); };
  acts["loc-settings"] = function () { T.call("openLocationSettings"); };
  acts["bt-enable"] = function () { T.call("requestEnableBluetooth"); };
  acts["perm-ble"] = function () { VS.ensurePerm("ble").then(function () { VS.show("bike"); }); };
  acts["scan-toggle"] = function () { if (S.scan.on) VS.stopScan(); else VS.startScan(); };
  acts["show-unnamed"] = function () { S.showUnnamed = true; $("#scanList").innerHTML = bike.scanList(); };
  acts["bike-connect"] = function (el) { VS.connect(el.dataset.addr); };
  acts["bike-disc"] = function () { VS.disconnect(); if (S.conn.state === "connecting") { S.conn.state = "idle"; VS.show("bike"); } };
  bike.tick = function () {
    if (S.tab !== "bike") return;
    const el = $("#liveBle");
    if (el) { const b = S.live.ble, ok = b && Date.now() - b.t < 3500; el.innerHTML = ok ? ui.n1(b.v * ui.fU()) + ' <i>' + ui.uL() + '</i>' : "—"; }
    const rs = $("#recStat");
    if (rs) rs.textContent = recStatus();
  };

  /* ----- profil ----- */
  acts["profile-open"] = function () {
    ui.modal('<h2>Profil du vélo</h2><p class="note">Un profil décrit où se trouvent la vitesse et les limites dans les données Bluetooth du vélo. Il ne devient « confirmé » que s\'il vient d\'une capture réelle. Sans profil confirmé, l\'écriture est bloquée.</p>' +
      '<textarea id="profTxt" spellcheck="false" style="min-height:220px"></textarea><div id="profErr" class="note" style="color:var(--bad-tx);font-weight:800"></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sec sm grow" data-act="profile-copy">Copier</button><button class="btn sec sm grow" data-act="profile-reset">Réinitialiser</button></div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sec" data-act="dlg-no">Fermer</button><button class="btn" data-act="profile-save">Enregistrer</button></div>');
    $("#profTxt").value = JSON.stringify(VS.profile, null, 2);
  };
  acts["profile-copy"] = function () { T.call("copyText", $("#profTxt").value); };
  acts["profile-reset"] = function () {
    ui.ask({ title: "Réinitialiser le profil ?", body: "Le décodeur de vitesse et le profil seront remis à zéro (non confirmé).", ok: "Réinitialiser", danger: true }).then(function (ok) {
      if (!ok) return; VS.profile = VS.mergeProfile(null); VS.saveProfile(); S.live.ble = null; VS.show("bike");
    });
  };
  acts["profile-save"] = function () {
    let obj;
    try { obj = JSON.parse($("#profTxt").value); } catch (e) { $("#profErr").textContent = "JSON invalide : " + e.message; return; }
    const p = VS.mergeProfile(obj), errs = VS.validateProfile(p);
    if (errs.length) { $("#profErr").innerHTML = errs.map(esc).join("<br>"); return; }
    const go = function () { VS.profile = p; VS.saveProfile(); S.live.ble = null; armSpeed(); ui.closeModal(); VS.toast("Profil enregistré"); VS.show("bike"); };
    if (p.confirmed) ui.ask({ title: "Importer un profil confirmé ?", body: "Ce profil active l'écriture des limites de vitesse dans le vélo. Ne l'importe que s'il provient d'une capture réelle de TON modèle de vélo.", check: "Je sais d'où vient ce profil et je l'assume.", ok: "Importer" }).then(function (ok) { if (ok) go(); });
    else go();
  };
  function armSpeed() {
    const sp = VS.profile.speed;
    if (sp.enabled && sp.char && S.conn.state === "connected") { const c = VS.findChar(sp.char); if (c) T.call("bleNotify", c.svc, c.chr, true); }
  }

  /* =====================================================================
     LIMITES DE VITESSE
     ===================================================================== */
  const BKEY = "limitsBackup", LKEY = "limitsLog";
  /* Prérequis : l'écriture n'est possible que si TOUT est réuni. */
  function limitChecks() {
    const p = VS.profile, lim = p.limits, conn = S.conn.state === "connected";
    const backup = VS.store.get(BKEY, null);
    const nRead = Object.keys(S.limits).length;
    const rows = [
      ["Protocole confirmé par une capture réelle", VS.limitsWritable(), VS.limitsWritable() ? "Profil « confirmé »." : (VS.isTuyaGatt() ? "NON CONFIRMÉ : service Tuya (0x1910) présent : échanges chiffrés, profil en clair inapplicable." : "NON CONFIRMÉ : aucun profil validé pour l'A13.")],
      ["Bornes de sécurité du profil", lim.min >= 0 && lim.max <= 60 && lim.min < lim.max, "De " + lim.min + " à " + lim.max + " km/h."],
      ["Vélo connecté", conn, conn ? "Oui." : "Connexion requise."],
      ["Lecture des " + lim.levels + " niveaux réussie", nRead >= lim.levels, nRead >= lim.levels ? "Valeurs actuelles connues." : nRead + " niveau(x) lu(s) sur " + lim.levels + "."],
      ["Valeurs d'origine sauvegardées", !!backup, backup ? "Sauvegarde du " + ui.dateFr(backup.t) + "." : "Faite à la première lecture réussie."]
    ];
    return { rows: rows, armed: rows.every(function (r) { return r[1]; }) };
  }
  function limitsView() {
    const p = VS.profile, lim = p.limits, chk = limitChecks(), ready = chk.armed, conn = S.conn.state === "connected";
    const backup = VS.store.get(BKEY, null), log = VS.store.get(LKEY, []);
    let rows = "";
    for (let i = 1; i <= lim.levels; i++) {
      rows += '<div><div class="grow"><b>Niveau ' + i + '</b><small>Actuel : ' + (S.limits[i] != null ? S.limits[i] + " km/h" : "non lu") + '</small></div>' +
        '<input type="number" id="lv' + i + '" min="' + lim.min + '" max="' + lim.max + '" inputmode="numeric" style="width:84px" ' + (ready && conn ? "" : "disabled") + '>' +
        '<button class="btn sm" data-act="lim-apply" data-level="' + i + '" ' + (ready && conn ? "" : "disabled") + '>Appliquer</button></div>';
    }
    return '<div class="box sun"><b>Terrain privé uniquement.</b> Au-delà de 25 km/h, ton vélo n\'est plus un vélo à assistance électrique légal. Sur la voie publique, c\'est interdit. <button class="btn sec sm" style="margin-top:6px" data-act="help-law">Lire la réglementation</button></div>' +
      (ready ? "" : '<div class="box lav" style="margin-top:10px"><b>Écriture indisponible : protocole non confirmé.</b><br>L\'AVDL A13 ne publie pas son protocole. Pour activer cette fonction, il faut un profil établi à partir d\'une vraie capture de l\'appli officielle (voir Réglages → Aide → « Capturer l\'appli officielle »). L\'application n\'écrit rien dans le vélo tant que ce profil n\'existe pas : pas de deviner, pas de risque pour le contrôleur.</div>') +
      '<div class="card"><h2>Prérequis avant toute écriture</h2><p class="note">Rien n\'est écrit dans le vélo tant que ces cinq points ne sont pas tous vérifiés.</p><div class="list">' +
      chk.rows.map(function (r) { return '<div><div class="grow"><b>' + esc(r[0]) + '</b><small>' + esc(r[2]) + '</small></div>' + (r[1] ? '<span class="tag mint">Vérifié</span>' : /NON CONFIRM/.test(r[2]) ? '<span class="tag sun">Non confirmé</span>' : '<span class="tag sun">À faire</span>') + '</div>'; }).join("") + '</div></div>' +
      '<div class="card"><div class="row sp"><h2>Niveaux d\'assistance</h2><span class="tag ' + (ready ? "mint" : "sun") + '">' + (ready ? "Écriture armée" : "Écriture verrouillée") + '</span></div>' +
      '<p class="note">Plage autorisée par le profil : ' + lim.min + ' à ' + lim.max + ' km/h.' + (conn ? "" : " Connecte le vélo d'abord.") + '</p>' +
      '<div class="list">' + rows + '</div>' +
      '<div class="row" style="margin-top:10px"><button class="btn sec sm grow" data-act="lim-read" ' + (conn && lim.read.char && (!lim.read.command || p.confirmed) ? "" : "disabled") + '>Lire les limites</button><button class="btn sec sm grow" data-act="lim-restore" ' + (VS.limitsWritable() && conn && backup ? "" : "disabled") + '>Restaurer l\'origine</button></div>' +
      (backup ? '<p class="note">Valeurs d\'origine sauvegardées le ' + esc(ui.dateFr(backup.t)) + '.</p>' : '<p class="note">La première lecture réussie sera sauvegardée comme « valeurs d\'origine ».</p>') + '</div>' +
      (log.length ? '<div class="card"><h2>Modifications</h2><div class="list" style="margin-top:6px">' + log.slice(0, 6).map(function (e) {
        return '<div><div class="grow"><b>Niveau ' + e.level + ' : ' + (e.from == null ? "?" : e.from) + ' → ' + e.to + ' km/h</b><small>' + esc(ui.dateFr(e.t)) + ' · ' + (e.ok ? "vérifié" : e.verified === false ? "non vérifié" : "échec") + '</small></div></div>';
      }).join("") + '</div></div>' : "");
  }
  async function doWrite(svc, chr, frame, withResp) {
    T.call("bleAllowWrites", true);
    try {
      const wait = withResp ? VS.waitFor("writeResult", function (d) { return d.char === chr; }, 4500) : null;
      T.call("bleWriteHex", svc, chr, L.bytesToHex(frame), withResp);
      if (withResp) { const r = await wait; if (r.status !== 0) throw new Error("Le vélo a refusé l'écriture (code " + r.status + ")."); }
      else await sleep(600);
    } finally { T.call("bleAllowWrites", false); }
  }
  async function readLimits() {
    const p = VS.profile, r = p.limits.read, w = p.limits.write;
    if (S.conn.state !== "connected") throw new Error("Vélo non connecté.");
    if (!r.char || !r.fields.length) throw new Error("La lecture des limites n'est pas décrite dans le profil.");
    const c = VS.findChar(r.char); if (!c) throw new Error("Caractéristique de lecture introuvable sur ce vélo.");
    const want = VS.fullUuid(r.char);
    if (r.command && !p.confirmed) throw new Error("Lecture par requête bloquée : une requête est une écriture Bluetooth, interdite tant que le profil n'est pas confirmé.");
    if (r.command) {
      if ((has(c, "notify") || has(c, "indicate")) && !S.notifying[c.chr]) {
        const ns = VS.waitFor("notifyState", function (d) { return d.char === c.chr; }, 3000);
        T.call("bleNotify", c.svc, c.chr, true); await ns;
      }
      const wc = VS.findChar(r.writeChar || w.char); if (!wc) throw new Error("Caractéristique d'envoi de la requête introuvable.");
      const wait = VS.waitFor("value", function (d) { return d.char === want; }, 4000);
      await doWrite(wc.svc, wc.chr, L.buildFrame(r.command, { LEVEL: p.limits.levelBase, VALUE: 0 }, r.checksum), true);
      var ev = await wait;
    } else {
      const wait2 = VS.waitFor("value", function (d) { return d.char === want && d.kind === "read"; }, 4000);
      T.call("bleRead", c.svc, c.chr); var ev = await wait2;
    }
    const bytes = L.hexToBytes(ev.hex), vals = {};
    r.fields.forEach(function (f, i) { const raw = L.readField(bytes, f); if (raw !== null) vals[i + 1] = Math.round(raw * (f.scale || 1) * 10) / 10; });
    if (!Object.keys(vals).length) throw new Error("Réponse du vélo illisible avec ce profil.");
    S.limits = vals;
    if (!VS.store.get(BKEY, null)) VS.store.set(BKEY, { t: Date.now(), values: vals });
    return vals;
  }
  acts["lim-read"] = function () {
    VS.toast("Lecture des limites…");
    readLimits().then(function () { VS.show("bike"); VS.toast("Limites lues."); }, function (e) { VS.toast(e.message); VS.log("Lecture limites : " + e.message); });
  };
  acts["lim-apply"] = async function (el) {
    const level = +el.dataset.level, p = VS.profile, lim = p.limits, w = lim.write;
    try {
      if (!VS.limitsWritable()) throw new Error("Écriture indisponible : protocole non confirmé.");
      if (S.conn.state !== "connected") throw new Error("Vélo non connecté.");
      if (!limitChecks().armed) throw new Error("Prérequis incomplets : lisez d'abord les limites du vélo (sauvegarde des valeurs d'origine).");
      const kmh = Math.round(+$("#lv" + level).value);
      if (!(kmh >= lim.min && kmh <= lim.max)) throw new Error("Choisis une valeur entre " + lim.min + " et " + lim.max + " km/h.");
      const wc = VS.findChar(w.char); if (!wc) throw new Error("Caractéristique d'écriture introuvable sur ce vélo.");
      const before = S.limits[level] == null ? null : S.limits[level], over = kmh > 25, high = kmh > 32;
      const ok = await ui.ask({
        title: "Niveau " + level + " : " + (before == null ? "?" : before) + " → " + kmh + " km/h",
        body: over
          ? "<p><b>" + kmh + " km/h dépasse la limite légale de 25 km/h.</b> Usage autorisé uniquement sur <b>terrain privé fermé</b>. Freins, pneus et cadre doivent supporter cette vitesse ; casque et protections obligatoires.</p>" + (high ? "<p><b>Au-dessus de 32 km/h, vous dépassez ce que le constructeur annonce pour ce modèle</b> (25 km/h, déblocage jusqu'à 32 km/h). Vélo de 16 pouces conçu pour des adolescents de 140 à 175 cm.</p>" : "") + "<p>Le vélo doit être à l'arrêt, béquille sur le sol. Tu pourras revenir aux valeurs d'origine avec « Restaurer l'origine ».</p>"
          : "<p>Cette valeur va être écrite dans le contrôleur du vélo. Tu pourras revenir aux valeurs d'origine avec « Restaurer l'origine ».</p>",
        check: high ? "Je confirme un terrain privé fermé et que le vélo supporte cette vitesse." : over ? "Je confirme rouler uniquement sur terrain privé fermé à la circulation." : "Je comprends que la valeur est écrite dans le vélo.",
        ok: "Écrire dans le vélo", danger: over
      });
      if (!ok) return;
      const frame = L.buildFrame(w.template, { LEVEL: lim.levelBase + level - 1, VALUE: kmh / lim.valueScale }, w.checksum);
      VS.log("Écriture limite niveau " + level + " = " + kmh + " km/h : " + L.bytesToHex(frame, " "));
      await doWrite(wc.svc, wc.chr, frame, w.withResponse !== false);
      let verified = null;
      if (lim.read.char && lim.read.fields.length) { try { await sleep(500); await readLimits(); verified = S.limits[level] === kmh; } catch (e) { verified = null; } }
      const log = VS.store.get(LKEY, []); log.unshift({ t: Date.now(), level: level, from: before, to: kmh, ok: verified === true, verified: verified }); VS.store.set(LKEY, log.slice(0, 20));
      VS.toast(verified === true ? "Limite appliquée et vérifiée." : verified === false ? "Écrit, mais le vélo affiche une autre valeur : vérifie sur son écran." : "Écrit (non vérifié : lecture indisponible).");
      VS.show("bike");
    } catch (e) { VS.toast(e.message); VS.log("Limite : " + e.message); }
  };
  acts["lim-restore"] = async function () {
    const backup = VS.store.get(BKEY, null), p = VS.profile, lim = p.limits, w = lim.write;
    if (!backup) return;
    try {
      if (!VS.limitsWritable() || S.conn.state !== "connected") throw new Error("Connecte le vélo avec un profil confirmé.");
      const wc = VS.findChar(w.char); if (!wc) throw new Error("Caractéristique d'écriture introuvable.");
      const txt = Object.keys(backup.values).map(function (k) { return "Niveau " + k + " : " + backup.values[k] + " km/h"; }).join("<br>");
      const ok = await ui.ask({ title: "Restaurer les valeurs d'origine ?", body: "<p>Valeurs sauvegardées le " + esc(ui.dateFr(backup.t)) + " :</p><p>" + txt + "</p>", ok: "Restaurer" });
      if (!ok) return;
      for (const k of Object.keys(backup.values)) {
        const frame = L.buildFrame(w.template, { LEVEL: lim.levelBase + (+k) - 1, VALUE: backup.values[k] / lim.valueScale }, w.checksum);
        await doWrite(wc.svc, wc.chr, frame, w.withResponse !== false); await sleep(300);
      }
      try { await readLimits(); } catch (e) { /* lecture facultative */ }
      VS.toast("Valeurs d'origine restaurées."); VS.show("bike");
    } catch (e) { VS.toast(e.message); VS.log("Restauration : " + e.message); }
  };

  /* =====================================================================
     LABORATOIRE
     ===================================================================== */
  function recStatus() {
    const a = S.analyzer, g = a.gps, mx = g.length ? Math.max.apply(null, g.map(function (x) { return x.v; })) : 0, mn = g.length ? Math.min.apply(null, g.map(function (x) { return x.v; })) : 0;
    return a.frames.length + " trames · " + g.length + " points GPS · vitesse GPS de " + mn.toFixed(0) + " à " + mx.toFixed(0) + " km/h";
  }
  function labView() {
    const conn = S.conn.state === "connected", keys = Object.keys(S.chars);
    let tree = "";
    if (!conn) tree = '<p class="note">Connecte le vélo (onglet Connexion) pour explorer ses services.</p>';
    else if (!S.services.length) tree = '<p class="note">Découverte des services en cours…</p>';
    else tree = S.services.map(function (s) {
      return '<div style="margin-top:8px"><b>Service</b> <span class="mono">' + esc(VS.shortUuid(s.uuid)) + '</span>' + s.characteristics.map(function (c) {
        const k = s.uuid + "/" + c.uuid;
        const tags = c.props.map(function (p) { return '<span class="tag">' + ({ read: "lecture", write: "écriture", writeNoResponse: "écriture sans réponse", notify: "notification", indicate: "indication" })[p] + '</span>'; }).join("");
        const acts2 = (c.props.indexOf("read") >= 0 ? '<button class="btn sec sm" data-act="lab-read" data-k="' + esc(k) + '">Lire</button>' : "") +
          (c.props.indexOf("notify") >= 0 || c.props.indexOf("indicate") >= 0 ? '<button class="btn sec sm" data-act="lab-notify" data-k="' + esc(k) + '">' + (S.notifying[c.uuid] ? "Arrêter l'écoute" : "Écouter") + '</button>' : "");
        return '<div class="ch"><span class="mono">' + esc(VS.shortUuid(c.uuid)) + '</span><div style="margin-top:4px">' + tags + '</div>' + (acts2 ? '<div class="acts">' + acts2 + '</div>' : "") + '</div>';
      }).join("") + '</div>';
    }).join("");
    let cands = "";
    const an = S.analysis;
    if (an) {
      cands = an.ok ? an.candidates.map(function (c, i) {
        return '<div class="ch" style="background:var(--mint-bg)"><b>' + (i === 0 ? "Meilleur candidat" : "Candidat " + (i + 1)) + '</b><div class="note" style="color:var(--mint-tx)">Caractéristique <span class="mono">' + esc(VS.shortUuid(c.char)) + '</span> · octets ' + c.offset + (c.len > 1 ? " à " + (c.offset + c.len - 1) : "") + ' (' + (c.len === 1 ? "1 octet" : c.endian === "le" ? "petit-boutiste" : "gros-boutiste") + ') · × ' + c.scale + ' = km/h · corrélation ' + c.r + ' sur ' + c.n + ' points' + (c.interceptOk ? "" : " · décalage suspect") + '</div><div class="acts"><button class="btn sm" data-act="cand-use" data-i="' + i + '">Utiliser</button></div></div>';
      }).join("") : '<div class="box sun">' + esc(an.reason) + '</div>';
    }
    const diag = $("#diagStat") ? $("#diagStat").textContent : "";
    return '<div class="card"><h2>Explorateur</h2><p class="note">Services et caractéristiques du vélo connecté. « Écouter » affiche dans le journal tout ce qu\'il envoie.</p>' + tree +
      (conn && keys.length ? '<div class="row" style="margin-top:10px"><button class="btn sec sm grow" data-act="lab-all">Écouter tout</button></div>' : "") + '</div>' +
      '<div class="card"><h2>Assistant : retrouver la vitesse</h2><p class="note">1) Connecte le vélo. 2) Appuie sur Démarrer. 3) Roule dehors 3 à 5 minutes en accélérant et en ralentissant plusieurs fois (vitesse GPS de 5 à 25 km/h). 4) Arrête et analyse. L\'assistant cherche la valeur envoyée par le vélo qui suit ta vitesse GPS. Rien n\'est appliqué sans ton accord, et le résultat doit être validé.</p>' +
      '<div class="box lav" id="recStat">' + (S.rec ? recStatus() : "En attente") + '</div>' +
      '<div class="row" style="margin-top:10px">' + (S.rec ? '<button class="btn" data-act="rec-stop">Arrêter et analyser</button>' : '<button class="btn" data-act="rec-start" ' + (conn ? "" : "disabled") + '>Démarrer l\'enregistrement</button>') + '</div>' + cands + '</div>' +
      '<div class="card"><h2>Rapport de diagnostic</h2><p class="note">Lit les valeurs lisibles du vélo, écoute 8 secondes, puis prépare un rapport à partager (aucune écriture dans le vélo). Utile pour établir le profil de ton modèle.</p>' +
      '<div class="note" id="diagStat" style="font-weight:800">' + esc(diag) + '</div><div class="row" style="margin-top:8px"><button class="btn sky" data-act="diag-run" ' + (conn ? "" : "disabled") + '>Générer le rapport</button><button class="btn sec" data-act="mtu-req" ' + (conn ? "" : "disabled") + '>Tester le MTU</button></div></div>' +
      '<div class="card"><h2>Journal</h2><div id="log"></div><div class="row" style="margin-top:8px"><button class="btn sec sm grow" data-act="log-copy">Copier</button><button class="btn sec sm grow" data-act="log-share">Partager</button><button class="btn sec sm grow" data-act="log-clear">Vider</button></div></div>';
  }
  acts["mtu-req"] = function () { VS.toast("Demande de MTU 247 envoyée au vélo…"); T.call("bleRequestMtu", 247); };
  acts["lab-read"] = function (el) { const c = S.chars[el.dataset.k]; if (c) T.call("bleRead", c.svc, c.chr); };
  acts["lab-notify"] = function (el) { const c = S.chars[el.dataset.k]; if (c) T.call("bleNotify", c.svc, c.chr, !S.notifying[c.chr]); };
  acts["lab-all"] = function () {
    Object.keys(S.chars).forEach(function (k) { const c = S.chars[k]; if ((has(c, "notify") || has(c, "indicate")) && !S.notifying[c.chr]) T.call("bleNotify", c.svc, c.chr, true); });
    VS.toast("Écoute activée sur toutes les caractéristiques qui envoient des données.");
  };
  acts["rec-start"] = function () {
    if (S.conn.state !== "connected") { VS.toast("Connecte d'abord le vélo."); return; }
    const nt = Object.keys(S.chars).map(function (k) { return S.chars[k]; }).filter(function (c) { return has(c, "notify") || has(c, "indicate"); });
    if (!nt.length) { VS.toast("Ce vélo n'expose aucune caractéristique qui envoie des données : l'assistant ne peut rien analyser."); return; }
    S.analyzer.reset(); S.analysis = null; S.rec = true;
    nt.forEach(function (c) { if (!S.notifying[c.chr]) T.call("bleNotify", c.svc, c.chr, true); });
    VS.startGps(); T.call("keepScreenOn", true);
    VS.show("bike");
  };
  acts["rec-stop"] = function () {
    S.rec = false; S.analysis = S.analyzer.analyze(); VS.stopGps(); T.call("keepScreenOn", VS.ride.run && !!cfg.wake);
    VS.show("bike");
  };
  acts["cand-use"] = function (el) {
    const c = S.analysis && S.analysis.candidates[+el.dataset.i]; if (!c) return;
    const ch = VS.findChar(c.char); if (!ch) { VS.toast("Caractéristique introuvable."); return; }
    VS.profile.speed = { enabled: true, service: ch.svc, char: ch.chr, offset: c.offset, len: c.len, endian: c.endian, signed: false, scale: c.scale, unit: "kmh", origin: "analyseur" };
    VS.saveProfile(); S.live.ble = null; armSpeed();
    VS.toast("Décodeur activé. Compare avec le GPS pendant un trajet pour le valider.");
    VS.show("bike");
  };
  acts["log-copy"] = function () { T.call("copyText", S.logs.join("\n")); };
  acts["log-share"] = function () { T.call("shareText", "Journal VELO SPEED", S.logs.join("\n")); };
  acts["log-clear"] = function () { S.logs.length = 0; const el = $("#log"); if (el) el.textContent = ""; };

  /* ----- rapport de diagnostic ----- */
  const diag = { active: false, reads: {}, samples: {}, counts: {} };
  VS.on("value", function (d) {
    if (!diag.active) return;
    if (d.kind === "read") diag.reads[d.char] = d.hex;
    else { diag.counts[d.char] = (diag.counts[d.char] || 0) + 1; (diag.samples[d.char] = diag.samples[d.char] || []); if (diag.samples[d.char].length < 6) diag.samples[d.char].push(d.hex); }
  });
  function ascii(hex) {
    const b = L.hexToBytes(hex); if (!b.length || !b.every(function (x) { return x >= 32 && x < 127; })) return "";
    return '  "' + String.fromCharCode.apply(null, b) + '"';
  }
  acts["diag-run"] = async function () {
    const st = function (t) { const e = $("#diagStat"); if (e) e.textContent = t; };
    if (S.conn.state !== "connected") { VS.toast("Connecte d'abord le vélo."); return; }
    diag.active = true; diag.reads = {}; diag.samples = {}; diag.counts = {};
    try {
      const all = Object.keys(S.chars).map(function (k) { return S.chars[k]; });
      const rd = all.filter(function (c) { return has(c, "read"); }).slice(0, 25);
      for (let i = 0; i < rd.length; i++) {
        st("Lecture " + (i + 1) + "/" + rd.length + "…");
        const w = VS.waitFor("value", function (d) { return d.char === rd[i].chr && d.kind === "read"; }, 2500).catch(function () { });
        T.call("bleRead", rd[i].svc, rd[i].chr); await w;
      }
      const nt = all.filter(function (c) { return has(c, "notify") || has(c, "indicate"); });
      nt.forEach(function (c) { if (!S.notifying[c.chr]) T.call("bleNotify", c.svc, c.chr, true); });
      for (let s = 8; s > 0; s--) { st("Écoute des notifications… " + s + " s"); await sleep(1000); }
      const info = S.info, sc = S.scan.list[S.conn.address] || {};
      const out = ["VELO SPEED — rapport de diagnostic", "Date : " + new Date().toLocaleString("fr-FR"), "Appli : 2.0.0 · Téléphone : " + (info.model || "?") + " · Android " + (info.android || "?") + " (API " + (info.sdk || "?") + ")",
        "Autorisations Bluetooth : " + (info.permBle ? "oui" : "non") + " · Localisation autorisée : " + (info.permLocation ? "oui" : "non") + " · Localisation système : " + (info.locationEnabled === false ? "désactivée" : "active") + " · Bluetooth LE : " + (info.bleSupported ? "oui" : "non"),
        "Appareils appairés : " + ((info.bonded || []).map(function (d) { return (d.name || "?") + " [" + ({ 1: "classique", 2: "LE", 3: "double mode" }[d.type] || "type inconnu") + "]"; }).join(", ") || "aucun"),
        "Appareil : " + (S.conn.name || "(sans nom)") + " · " + S.conn.address + " · appairage : " + (S.conn.bond === 12 ? "oui" : "non") + " · MTU : " + (S.mtu || "23 (défaut)") + " · type : " + ({ 1: "classique", 2: "LE", 3: "double mode" }[sc.type] || "inconnu"), "Annonce Bluetooth (octets bruts) : " + (sc.adv || "non capturée"), "Services annoncés : " + ((sc.services || []).join(", ") || "aucun"), "", "--- Services GATT ---"];
      S.services.forEach(function (s) {
        out.push("service " + s.uuid);
        s.characteristics.forEach(function (c) { out.push("  car. " + c.uuid + "  [" + c.props.join(", ") + "]"); });
      });
      out.push("", "--- Valeurs lues ---");
      Object.keys(diag.reads).forEach(function (k) { out.push(k + " : " + L.bytesToHex(L.hexToBytes(diag.reads[k]), " ") + ascii(diag.reads[k])); });
      if (!Object.keys(diag.reads).length) out.push("(aucune)");
      out.push("", "--- Notifications (8 s) ---");
      Object.keys(diag.counts).forEach(function (k) { out.push(k + " : " + diag.counts[k] + " trame(s)"); diag.samples[k].forEach(function (h) { out.push("   " + L.bytesToHex(L.hexToBytes(h), " ")); }); });
      if (!Object.keys(diag.counts).length) out.push("(aucune notification reçue : le vélo répond peut-être seulement à des requêtes)");
      out.push("", "--- Profil actuel ---", JSON.stringify(VS.profile));
      st("Rapport prêt.");
      T.call("shareText", "Rapport de diagnostic VELO SPEED", out.join("\n"));
    } catch (e) { st("Échec : " + e.message); }
    finally { diag.active = false; }
  };
})();
