/* =============================================================================
 * app.js — UI controller. No mathematics lives here; every number displayed
 * comes from ABGTModels / ABGTEngine / ABGTRisk.
 * ========================================================================== */
(function () {
  "use strict";

  var S = {
    data: null,        // parsed dataset awaiting confirmation
    net: null,         // built network (pre-shock)
    shocked: null,     // shocked network actually simulated
    results: null,     // { EN, RV, KV } or a subset
    active: null,      // active single result
    table: null,       // bank-level table for the active model
    tables: null,      // per-model tables when comparing
    summaries: null,
    model: "EN",
    shockSel: [],
    resPage: 0,
    sortKey: "riskScore",
    sortDir: -1
  };

  var $ = function (s) { return document.querySelector(s); };
  var $$ = function (s) { return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var fmt = function (v, d) { return v == null || isNaN(v) ? "—" : Number(v).toLocaleString(undefined, { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); };
  var esc = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); };

  function toast(msg, kind) {
    var d = document.createElement("div");
    d.className = "toast " + (kind || "");
    d.textContent = msg;
    $("#toasts").appendChild(d);
    setTimeout(function () { d.style.opacity = 0; setTimeout(function () { d.remove(); }, 300); }, 4200);
  }
  function busy(on, msg) {
    $("#overlay").hidden = !on;
    if (msg) $("#overlayMsg").textContent = msg;
  }

  /* ------------------------------ navigation ---------------------------- */
  var TITLES = {
    dashboard: ["Dashboard", "Interbank contagion and systemic-risk analytics"],
    upload: ["Data Upload", "Import and validate an interbank network dataset"],
    network: ["Network", "Directed interbank liability graph and contagion propagation"],
    simulation: ["Simulation", "Configure the shock, choose a model, solve the clearing fixed point"],
    comparison: ["Model Comparison", "Eisenberg–Noe vs Rogers–Veraart vs Kusnetsov–Veraart"],
    risk: ["Risk Analysis", "Bank-level systemic risk ranking"],
    results: ["Results", "System summary and bank-level clearing results"],
    export: ["Export Report", "Download results and verify the mathematics"],
    about: ["About Research", "Academic background and mathematical specification"]
  };
  function go(view) {
    $$(".view").forEach(function (v) { v.classList.toggle("is-active", v.id === "view-" + view); });
    $$(".nav-item").forEach(function (b) { b.classList.toggle("is-active", b.dataset.view === view); });
    $("#viewTitle").textContent = TITLES[view][0];
    $("#viewSub").textContent = TITLES[view][1];
    $("#sidebar").classList.remove("open");
    if (view === "network" && S.net) ABGTNetworkViz.render($("#networkCanvas"));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $$(".nav-item").forEach(function (b) { b.addEventListener("click", function () { go(b.dataset.view); }); });
  $$("[data-goto]").forEach(function (b) { b.addEventListener("click", function () { go(b.dataset.goto); }); });
  $("#menuBtn").addEventListener("click", function () { $("#sidebar").classList.toggle("open"); });
  $("#themeBtn").addEventListener("click", function () {
    var d = document.documentElement;
    d.dataset.theme = d.dataset.theme === "dark" ? "light" : "dark";
    if (S.results) renderAll();
    if (S.net) ABGTNetworkViz.render($("#networkCanvas"));
  });

  /* ------------------------------ upload -------------------------------- */
  var SAMPLE_CSV = "Bank,Bank A,Bank B,Bank C,ExternalAssets\nBank A,0,10,20,50\nBank B,5,0,10,40\nBank C,15,5,0,30\n";

  function handleFile(file) {
    busy(true, "Parsing " + file.name + "…");
    ABGTLoader.load(file).then(function (data) {
      busy(false);
      S.data = data;
      showPreview(file.name, data);
      toast("Parsed " + file.name, "ok");
    }).catch(function (err) {
      busy(false);
      $("#uploadStatus").innerHTML = '<div class="notice notice-err"><strong>Could not read the file.</strong> ' + esc(err.message) + "</div>";
      toast("Parse failed: " + err.message, "err");
    });
  }

  $("#dropzone").addEventListener("click", function () { $("#fileInput").click(); });
  $("#dropzone").addEventListener("keydown", function (e) { if (e.key === "Enter") $("#fileInput").click(); });
  $("#fileInput").addEventListener("change", function (e) { if (e.target.files[0]) handleFile(e.target.files[0]); });
  ["dragenter", "dragover"].forEach(function (ev) {
    $("#dropzone").addEventListener(ev, function (e) { e.preventDefault(); $("#dropzone").classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    $("#dropzone").addEventListener(ev, function (e) { e.preventDefault(); $("#dropzone").classList.remove("drag"); });
  });
  $("#dropzone").addEventListener("drop", function (e) { if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });
  $("#sampleCsvBtn").addEventListener("click", function () { ABGTExport.download("abgt-sample-network.csv", SAMPLE_CSV, "text/csv"); });

  function loadExample() {
    S.data = ABGTLoader.fromGrid([
      ["Bank", "Bank A", "Bank B", "Bank C", "ExternalAssets"],
      ["Bank A", 0, 10, 20, 50],
      ["Bank B", 5, 0, 10, 40],
      ["Bank C", 15, 5, 0, 30]
    ]);
    showPreview("Chapter 4 research example", S.data);
    go("upload");
    toast("Loaded the three-bank example from Chapter 4 of the research", "ok");
  }
  $("#loadExampleBtn").addEventListener("click", loadExample);
  $("#loadExampleBtn2").addEventListener("click", loadExample);

  function showPreview(name, data) {
    var v = ABGTValidator.validate(data);
    $("#previewCard").hidden = false;
    $("#sourceBadge").textContent = name + " · " + data.banks.length + " institutions";
    $("#pdfConfirm").hidden = data.source !== "pdf";
    $("#validationList").innerHTML = v.issues.length
      ? v.issues.map(function (i) { return '<div class="vitem ' + i.level + '"><b>' + i.level + "</b><span>" + esc(i.message) + (i.detail ? ' <span class="muted">' + esc(i.detail) + "</span>" : "") + "</span></div>"; }).join("")
      : '<div class="notice notice-ok">All validation checks passed.</div>';
    $("#confirmDataBtn").disabled = !v.ok;

    var h = ['<table class="dt"><thead><tr><th>Bank (owes ↓ / to →)</th>'];
    data.columnLabels.forEach(function (c) { h.push("<th>" + esc(c) + "</th>"); });
    h.push("<th>ExternalAssets eᵢ</th><th>Total p̄ᵢ</th></tr></thead><tbody>");
    data.banks.forEach(function (b, i) {
      var rowSum = data.L[i].reduce(function (a, x) { return a + (x || 0); }, 0);
      h.push("<tr><td>" + esc(b) + "</td>");
      data.L[i].forEach(function (val, j) {
        h.push('<td contenteditable="true" class="editable" data-i="' + i + '" data-j="' + j + '">' + val + "</td>");
      });
      h.push('<td contenteditable="true" class="editable" data-i="' + i + '" data-e="1">' + (isNaN(data.e[i]) ? "" : data.e[i]) + "</td>");
      h.push("<td><strong>" + fmt(rowSum) + "</strong></td></tr>");
    });
    h.push("</tbody></table>");
    $("#previewTable").innerHTML = h.join("");

    $$("#previewTable .editable").forEach(function (td) {
      td.addEventListener("blur", function () {
        var val = ABGTLoader.num(td.textContent);
        var i = +td.dataset.i;
        if (td.dataset.e) S.data.e[i] = val; else S.data.L[i][+td.dataset.j] = isNaN(val) ? 0 : val;
        showPreview(name, S.data);
      });
    });
    $("#uploadStatus").innerHTML = "";
  }

  $("#clearDataBtn").addEventListener("click", function () {
    S.data = null; $("#previewCard").hidden = true; $("#fileInput").value = "";
  });

  $("#confirmDataBtn").addEventListener("click", function () {
    S.net = ABGTNetwork.build(S.data.banks, S.data.L, S.data.e.map(function (v) { return isNaN(v) ? 0 : v; }), S.data.extLiab);
    if (S.data.lambda && S.data.lambda.some(function (v) { return !isNaN(v); })) S.net.lambdaCol = S.data.lambda.slice();
    S.results = null; S.active = null;
    S.shockSel = [];
    $("#statusPill").textContent = S.net.n + " institutions loaded";
    $("#runBtn").disabled = false;
    renderShockChips();
    ABGTNetworkViz.setData(S.net, null);
    ABGTCharts.heatmap($("#heatmapBox"), S.net.banks, S.net.L);
    updateKpis(null);
    toast("Network built — " + S.net.n + " institutions, Σp̄ = " + fmt(S.net.totalInterbank), "ok");
    go("simulation");
  });

  /* ------------------------------ shock config -------------------------- */
  function renderShockChips() {
    var box = $("#shockBanks");
    if (!S.net) return;
    box.innerHTML = S.net.banks.map(function (b, i) {
      return '<button class="chip' + (S.shockSel.indexOf(i) >= 0 ? " is-on" : "") + '" data-i="' + i + '">' + esc(b) + "</button>";
    }).join("");
    $$("#shockBanks .chip").forEach(function (c) {
      c.addEventListener("click", function () {
        var i = +c.dataset.i, k = S.shockSel.indexOf(i);
        if (k >= 0) S.shockSel.splice(k, 1); else S.shockSel.push(i);
        renderShockChips();
      });
    });
  }
  function bindRange(id, out, fn) {
    var el = $(id);
    var upd = function () { $(out).textContent = fn(el.value); };
    el.addEventListener("input", upd); upd();
  }
  bindRange("#shockMag", "#shockOut", function (v) { return v + "%"; });
  bindRange("#alphaIn", "#alphaOut", function (v) { return Number(v).toFixed(2); });
  bindRange("#betaIn", "#betaOut", function (v) { return Number(v).toFixed(2); });
  bindRange("#lambdaIn", "#lambdaOut", function (v) { return Number(v).toFixed(2); });
  $$("#modelSeg .seg-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      $$("#modelSeg .seg-btn").forEach(function (x) { x.classList.remove("is-active"); });
      b.classList.add("is-active");
      S.model = b.dataset.model;
    });
  });

  function currentParams() {
    var lam = +$("#lambdaIn").value;
    var lambdaVec = S.net.lambdaCol
      ? S.net.lambdaCol.map(function (v) { return isNaN(v) ? lam : v; })
      : S.net.banks.map(function () { return lam; });
    return {
      alpha: +$("#alphaIn").value,
      beta: +$("#betaIn").value,
      betaKV: $("#kvBeta").checked ? +$("#betaIn").value : 1,
      lambda: lambdaVec,
      lambdaScalar: lam
    };
  }
  function shockLabel() {
    var t = $("#shockType").value;
    if (t === "none" || !S.shockSel.length) return "None (baseline clearing)";
    var names = S.shockSel.map(function (i) { return S.net.banks[i]; }).join(", ");
    return (t === "wipeout" ? "Total external-asset wipe-out" : "External-asset loss of " + $("#shockMag").value + "%") + " on " + names;
  }

  /* ------------------------------ run ----------------------------------- */
  $("#runBtn").addEventListener("click", function () {
    if (!S.net) return;
    busy(true, "Solving the clearing fixed point…");
    setTimeout(function () {
      try { runSimulation(); } catch (err) {
        console.error(err);
        $("#runStatus").innerHTML = '<div class="notice notice-err">' + esc(err.message) + "</div>";
        toast("Simulation error: " + err.message, "err");
      } finally { busy(false); }
    }, 60);
  });

  function runSimulation() {
    var params = currentParams();
    var type = $("#shockType").value;
    var mag = +$("#shockMag").value / 100;
    S.shocked = (type === "none" || !S.shockSel.length)
      ? ABGTNetwork.applyShock(S.net, [], "asset", 0)
      : ABGTNetwork.applyShock(S.net, S.shockSel, type, mag);

    var keys = S.model === "ALL" ? ["EN", "RV", "KV"] : [S.model];
    S.results = {};
    keys.forEach(function (k) { S.results[k] = ABGTEngine.run(k, S.shocked, params); });
    S.active = S.results[keys[0]];

    S.tables = {}; S.summaries = {};
    keys.forEach(function (k) {
      var impacts = ABGTRisk.marginalImpact(S.shocked, k, params, S.results[k].systemicRisk);
      S.tables[k] = ABGTRisk.bankTable(S.shocked, S.results[k], impacts);
      S.summaries[k] = ABGTRisk.summary(S.shocked, S.results[k]);
    });
    S.table = S.tables[keys[0]];
    S.params = params;

    $("#activeModelBadge").textContent = S.model === "ALL" ? "All three models" : S.active.model;
    $("#runStatus").innerHTML = '<div class="notice notice-ok"><strong>Converged in ' + S.active.iterations +
      " iterations.</strong> " + S.active.defaultCount + " of " + S.shocked.n + " institutions default; SR = " + fmt(S.active.systemicRisk) + ".</div>";
    renderAll();
    toast("Simulation complete", "ok");
    go("results");
  }

  /* ------------------------------ rendering ----------------------------- */
  function renderAll() {
    updateKpis(S.active);
    ABGTCharts.heatmap($("#heatmapBox"), S.shocked.banks, S.shocked.L);
    ABGTCharts.contagionPath("chartPath", S.results);
    ABGTCharts.bankShortfall("chartBankLoss", S.shocked.banks, S.table);
    renderSimCard();
    renderNetwork();
    renderResults();
    renderRisk();
    renderComparison();
  }

  function updateKpis(res) {
    if (!S.net) return;
    $("#kpiBanks").textContent = S.net.n;
    $("#kpiLiab").textContent = fmt(S.net.totalInterbank);
    $("#kpiDefaults").textContent = res ? res.defaultCount : "—";
    $("#kpiSR").textContent = res ? fmt(res.systemicRisk) : "—";
  }

  function renderSimCard() {
    $("#simResultCard").hidden = false;
    $("#simModelBadge").textContent = S.active.model;
    var s = S.summaries[S.active.key];
    $("#simKpis").innerHTML = [
      ["Final defaults", s.finalDefaults + " / " + s.banks, "pᵢ < p̄ᵢ", "danger"],
      ["Systemic risk SR", fmt(s.systemicRisk), "Σ (p̄ᵢ − pᵢ)⁺", "warn"],
      ["Total cleared", fmt(s.totalPaid), "Σ pᵢ", ""],
      ["Contagion rounds", s.contagionRounds, "iterations with defaults", ""],
      ["Contagion intensity", (s.contagionIntensity * 100).toFixed(1) + "%", "SR ÷ Σp̄ᵢ (app-level)", ""]
    ].map(function (k) {
      return '<div class="card kpi"><span class="kpi-label">' + k[0] + '</span><span class="kpi-value ' + k[3] + '">' + k[1] + '</span><span class="kpi-note">' + k[2] + "</span></div>";
    }).join("");

    var seq = S.active.defaultSequence;
    $("#seqBox").innerHTML = seq.length
      ? '<div class="seq">' + seq.map(function (o, i) {
        return (i ? '<span class="seq-arrow">→</span>' : "") + '<span class="seq-item"><b>' + esc(o.bank) + "</b><br><span class='muted xs'>stage " + o.stage + (o.stage === 0 ? " (fundamental)" : " (contagious)") + "</span></span>";
      }).join("") + "</div>"
      : '<p class="empty">No institution defaults under this configuration.</p>';
  }

  /* ------------------------------ network view -------------------------- */
  function renderNetwork() {
    ABGTNetworkViz.setData(S.shocked, S.active);
    var maxStage = Math.max.apply(null, S.active.stages.concat([0]));
    var sl = $("#stageSlider");
    sl.max = maxStage; sl.value = maxStage;
    ABGTNetworkViz.setStage(null);
    ABGTNetworkViz.render($("#networkCanvas"));
  }
  $("#stageSlider").addEventListener("input", function (e) {
    ABGTNetworkViz.setStage(+e.target.value);
    $("#stageOut").textContent = "k = " + e.target.value;
    ABGTNetworkViz.render($("#networkCanvas"));
  });
  $("#resetStageBtn").addEventListener("click", function () {
    ABGTNetworkViz.setStage(null); $("#stageOut").textContent = "final";
    ABGTNetworkViz.render($("#networkCanvas"));
  });
  $("#animateBtn").addEventListener("click", function () {
    if (!S.active) return toast("Run a simulation first");
    var max = +$("#stageSlider").max, k = 0;
    var tick = function () {
      ABGTNetworkViz.setStage(k);
      $("#stageSlider").value = k; $("#stageOut").textContent = "k = " + k;
      ABGTNetworkViz.render($("#networkCanvas"));
      if (k++ < max) setTimeout(tick, 750);
      else setTimeout(function () { ABGTNetworkViz.setStage(null); $("#stageOut").textContent = "final"; ABGTNetworkViz.render($("#networkCanvas")); }, 800);
    };
    tick();
  });
  ABGTNetworkViz.onSelect(function (i) {
    var box = $("#nodeInspector");
    if (i == null || !S.table) { box.hidden = true; return; }
    box.hidden = false;
    var r = S.table[i], net = S.shocked;
    $("#inspectTitle").textContent = r.bank;
    var owes = [], owed = [];
    for (var j = 0; j < net.n; j++) {
      if (net.L[i][j] > 0) owes.push(net.banks[j] + " — " + fmt(net.L[i][j]));
      if (net.L[j][i] > 0) owed.push(net.banks[j] + " — " + fmt(net.L[j][i]));
    }
    $("#inspectBody").innerHTML =
      '<div class="cards">' +
      kpi("Status", r.defaulted ? "DEFAULT" : "SOLVENT", r.initiallyShocked ? "initially shocked" : "stage " + (r.stage < 0 ? "—" : r.stage), r.defaulted ? "danger" : "ok") +
      kpi("Clearing payment pᵢ", fmt(r.clearingPayment), "of p̄ᵢ = " + fmt(r.totalLiabilities), "") +
      kpi("Shortfall", fmt(r.shortfall), "(p̄ᵢ − pᵢ)⁺", "warn") +
      kpi("Recovery rate", (r.recoveryRate * 100).toFixed(1) + "%", "pᵢ / p̄ᵢ", "") +
      "</div>" +
      '<div class="grid-2"><div><h4 class="sub">Owes (outgoing Lᵢⱼ)</h4><ul class="ul sm">' +
      (owes.length ? owes.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") : "<li>none</li>") +
      '</ul></div><div><h4 class="sub">Owed by (incoming Lⱼᵢ)</h4><ul class="ul sm">' +
      (owed.length ? owed.map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("") : "<li>none</li>") +
      "</ul></div></div>";
  });
  function kpi(l, v, n, c) {
    return '<div class="card kpi"><span class="kpi-label">' + l + '</span><span class="kpi-value ' + (c || "") + '" style="font-size:20px">' + v + '</span><span class="kpi-note">' + n + "</span></div>";
  }

  /* ------------------------------ results ------------------------------- */
  var RES_COLS = [
    ["bank", "Bank", 0], ["externalAssets", "eᵢ", 1], ["effectiveAssets", "Effective assets", 1],
    ["totalLiabilities", "p̄ᵢ", 1], ["interbankAssets", "Interbank receivable", 1],
    ["clearingPayment", "pᵢ", 1], ["received", "(Πᵀp)ᵢ", 1], ["recoveryRate", "Recovery", 2],
    ["shortfall", "Shortfall", 1], ["creditLoss", "Credit loss", 1], ["equity", "Equity", 1],
    ["defaulted", "Status", 3], ["stage", "Stage", 4], ["riskScore", "Risk score", 1]
  ];

  function renderResults() {
    $("#resEmpty").hidden = true; $("#resWrap").hidden = false;
    var s = S.summaries[S.active.key];
    $("#sumTable").innerHTML = '<table class="dt"><tbody>' + [
      ["Model", s.model], ["Institutions", s.banks], ["Initially shocked", s.initialDefaults],
      ["Final defaults", s.finalDefaults], ["Solvent institutions", s.solvent],
      ["Systemic risk SR = Σ(p̄ᵢ − pᵢ)⁺", fmt(s.systemicRisk, 4)],
      ["Total obligations Σp̄ᵢ", fmt(s.totalLiabilities)],
      ["Total external assets Σeᵢ", fmt(s.totalExternalAssets)],
      ["Total cleared payments Σpᵢ", fmt(s.totalPaid)],
      ["Total credit loss to creditors", fmt(s.totalCreditLoss, 4)],
      ["Contagion rounds", s.contagionRounds],
      ["Fixed-point iterations", s.iterations],
      ["Converged", s.converged ? "Yes" : "No — iteration cap reached"],
      ["Shock scenario", shockLabel()],
      ["α, β, λ", S.params.alpha + ", " + S.params.beta + ", " + S.params.lambdaScalar]
    ].map(function (r) { return "<tr><td>" + r[0] + "</td><td><strong>" + r[1] + "</strong></td></tr>"; }).join("") + "</tbody></table>";

    drawResTable();
    var kv = S.results.KV;
    $("#kvRoundsCard").hidden = !kv;
    if (kv) {
      var h = ['<table class="dt"><thead><tr><th>Step k</th>'];
      S.shocked.banks.forEach(function (b) { h.push("<th>p (" + esc(b) + ")</th>"); });
      S.shocked.banks.forEach(function (b) { h.push("<th>e′ (" + esc(b) + ")</th>"); });
      h.push("<th>Defaults</th><th>SR</th></tr></thead><tbody>");
      kv.rounds.forEach(function (r) {
        h.push("<tr><td>" + r.k + "</td>");
        r.p.forEach(function (v) { h.push("<td>" + fmt(v) + "</td>"); });
        r.e.forEach(function (v) { h.push("<td>" + fmt(v) + "</td>"); });
        h.push("<td>" + r.defaults.filter(Boolean).length + "</td><td>" + fmt(r.SR, 4) + "</td></tr>");
      });
      h.push("</tbody></table>");
      $("#kvTable").innerHTML = h.join("");
    }
  }

  function drawResTable() {
    var q = ($("#resSearch").value || "").toLowerCase();
    var rows = S.table.filter(function (r) { return r.bank.toLowerCase().indexOf(q) >= 0; });
    var paginate = $("#resPaginate").checked, per = 12;
    var pages = Math.max(1, Math.ceil(rows.length / per));
    if (S.resPage >= pages) S.resPage = 0;
    var view = paginate ? rows.slice(S.resPage * per, S.resPage * per + per) : rows;

    var h = ['<table class="dt"><thead><tr>'];
    RES_COLS.forEach(function (c) { h.push('<th data-k="' + c[0] + '">' + c[1] + "</th>"); });
    h.push("</tr></thead><tbody>");
    view.forEach(function (r) {
      h.push("<tr>");
      RES_COLS.forEach(function (c) {
        var v = r[c[0]];
        if (c[2] === 0) h.push("<td>" + esc(v) + (r.initiallyShocked ? ' <span class="badge">shock</span>' : "") + "</td>");
        else if (c[2] === 1) h.push("<td>" + fmt(v) + "</td>");
        else if (c[2] === 2) h.push("<td>" + (v * 100).toFixed(1) + "%</td>");
        else if (c[2] === 3) h.push('<td class="' + (v ? "tag-default" : "tag-solvent") + '">' + (v ? "DEFAULT" : "SOLVENT") + "</td>");
        else h.push("<td>" + (v < 0 ? "—" : v) + "</td>");
      });
      h.push("</tr>");
    });
    h.push("</tbody></table>");
    $("#resTable").innerHTML = h.join("");
    $$("#resTable th").forEach(function (th) {
      th.addEventListener("click", function () {
        var k = th.dataset.k;
        S.sortDir = S.sortKey === k ? -S.sortDir : -1;
        S.sortKey = k;
        S.table.sort(function (a, b) {
          var x = a[k], y = b[k];
          if (typeof x === "string") return S.sortDir * x.localeCompare(y);
          return S.sortDir * ((x || 0) - (y || 0));
        });
        drawResTable();
      });
    });
    $("#resPager").innerHTML = paginate && pages > 1
      ? Array.from({ length: pages }, function (_, i) { return '<button class="' + (i === S.resPage ? "is-active" : "") + '" data-p="' + i + '">' + (i + 1) + "</button>"; }).join("")
      : "";
    $$("#resPager button").forEach(function (b) { b.addEventListener("click", function () { S.resPage = +b.dataset.p; drawResTable(); }); });
  }
  $("#resSearch").addEventListener("input", function () { S.resPage = 0; drawResTable(); });
  $("#resPaginate").addEventListener("change", drawResTable);

  /* ------------------------------ risk ---------------------------------- */
  function renderRisk() {
    $("#riskEmpty").hidden = true; $("#riskWrap").hidden = false;
    drawRiskTable();
    ABGTCharts.scatterRisk("chartScatter", S.table);
    var sorted = S.table.slice().sort(function (a, b) { return b.riskScore - a.riskScore; });
    var max = Math.max.apply(null, sorted.map(function (r) { return r.riskScore; }).concat([1]));
    $("#riskBars").innerHTML = sorted.map(function (r) {
      return '<div class="bar-row"><span>' + esc(r.bank) + '</span><span class="bar-track"><span class="bar-fill" style="width:' +
        Math.max(2, (r.riskScore / max) * 100).toFixed(1) + '%"></span></span><output>' + r.riskScore.toFixed(1) + "</output></div>";
    }).join("");
  }
  function drawRiskTable() {
    var q = ($("#riskSearch").value || "").toLowerCase();
    var f = $("#riskFilter").value;
    var rows = S.table.filter(function (r) {
      if (r.bank.toLowerCase().indexOf(q) < 0) return false;
      if (f === "default") return r.defaulted;
      if (f === "solvent") return !r.defaulted;
      return true;
    }).sort(function (a, b) { return b.riskScore - a.riskScore; });

    var h = ['<table class="dt"><thead><tr><th>Rank / Bank</th><th>Initial status</th><th>Final status</th><th>Gross exposure</th><th>Loss (shortfall)</th><th>Credit loss</th><th>Affected counterparties</th><th>Contagion contribution</th><th>Marginal ΔSR</th><th>Risk score*</th></tr></thead><tbody>'];
    rows.forEach(function (r, i) {
      h.push("<tr><td><span class='rank'>" + (i + 1) + "</span>" + esc(r.bank) + "</td>" +
        "<td>" + (r.initiallyShocked ? "<span class='tag-default'>SHOCKED</span>" : "Normal") + "</td>" +
        '<td class="' + (r.defaulted ? "tag-default" : "tag-solvent") + '">' + (r.defaulted ? "DEFAULT" : "SOLVENT") + "</td>" +
        "<td>" + fmt(r.totalLiabilities + r.interbankAssets) + "</td>" +
        "<td>" + fmt(r.shortfall) + "</td><td>" + fmt(r.creditLoss) + "</td>" +
        "<td>" + r.affectedCounterparties + "</td>" +
        "<td>" + (r.contagionContribution * 100).toFixed(1) + "%</td>" +
        "<td>" + fmt(r.marginalImpact) + "</td>" +
        "<td><strong>" + r.riskScore.toFixed(1) + "</strong></td></tr>");
    });
    h.push("</tbody></table>");
    $("#riskTable").innerHTML = h.join("");
  }
  $("#riskSearch").addEventListener("input", drawRiskTable);
  $("#riskFilter").addEventListener("change", drawRiskTable);

  /* ------------------------------ comparison ---------------------------- */
  function renderComparison() {
    var keys = Object.keys(S.results);
    if (keys.length < 3) { $("#cmpEmpty").hidden = false; $("#cmpWrap").hidden = true; return; }
    $("#cmpEmpty").hidden = true; $("#cmpWrap").hidden = false;

    ABGTCharts.compareBars("chartCmpDefaults", S.results, "defaultCount", "Institutions in default");
    ABGTCharts.compareBars("chartCmpSR", S.results, "systemicRisk", "SR = Σ(p̄ᵢ − pᵢ)⁺");
    ABGTCharts.compareBankLosses("chartCmpBank", S.shocked.banks, S.tables);
    ABGTCharts.radar("chartRadar", S.results, S.summaries);

    var rows = keys.map(function (k) {
      var s = S.summaries[k];
      return {
        Model: s.model,
        "Defaults": s.finalDefaults + " / " + s.banks,
        "Systemic risk SR": s.systemicRisk.toFixed(4),
        "Total cleared Σpᵢ": s.totalPaid.toFixed(2),
        "Credit loss": s.totalCreditLoss.toFixed(4),
        "Contagion rounds": s.contagionRounds,
        "Iterations": s.iterations,
        "Unpaid share": (s.contagionIntensity * 100).toFixed(2) + "%",
        "Parameters": k === "EN" ? "α = β = 1" : (k === "RV" ? "α = " + S.params.alpha + ", β = " + S.params.beta
          : "α = " + S.params.alpha + ", β = " + S.params.betaKV + ", λ = " + S.params.lambdaScalar)
      };
    });
    S.comparison = rows;
    var head = Object.keys(rows[0]);
    $("#cmpTable").innerHTML = '<table class="dt"><thead><tr>' + head.map(function (h) { return "<th>" + h + "</th>"; }).join("") +
      "</tr></thead><tbody>" + rows.map(function (r) {
        return "<tr>" + head.map(function (h) { return "<td>" + r[h] + "</td>"; }).join("") + "</tr>";
      }).join("") + "</tbody></table>";

    var en = S.summaries.EN, rv = S.summaries.RV, kv = S.summaries.KV;
    $("#cmpNarrative").innerHTML =
      "<strong>Reading the differences.</strong> Eisenberg–Noe (α = β = 1) is the frictionless benchmark: SR = " + fmt(en.systemicRisk, 3) +
      " with " + en.finalDefaults + " default(s). Rogers–Veraart withholds a fraction of assets in distress (α = " + S.params.alpha +
      ", β = " + S.params.beta + "), giving SR = " + fmt(rv.systemicRisk, 3) + " and " + rv.finalDefaults +
      " default(s) — the difference of " + fmt(rv.systemicRisk - en.systemicRisk, 3) +
      " is attributable to liquidity/default costs alone, since the network structure is unchanged. Kusnetsov–Veraart adds fire-sale feedback (λ = " +
      S.params.lambdaScalar + "), eroding external assets by λ(p̄ − p)⁺ each step and yielding SR = " + fmt(kv.systemicRisk, 3) + " over " +
      kv.iterations + " time steps — an additional " + fmt(kv.systemicRisk - rv.systemicRisk, 3) + " of unpaid obligations from the feedback loop.";
  }

  /* ------------------------------ export -------------------------------- */
  function ctx() {
    if (!S.active) { toast("Run a simulation first", "err"); return null; }
    return {
      net: S.shocked, summary: S.summaries[S.active.key], table: S.table,
      comparison: S.comparison && Object.keys(S.results).length === 3 ? S.comparison : null,
      params: S.params, shockLabel: shockLabel()
    };
  }
  $("#expCsv").addEventListener("click", function () { var c = ctx(); if (c) { ABGTExport.exportCSV(c); toast("CSV exported", "ok"); } });
  $("#expXlsx").addEventListener("click", function () { var c = ctx(); if (c) { ABGTExport.exportExcel(c); toast("Excel workbook exported", "ok"); } });
  $("#expPdf").addEventListener("click", function () {
    var c = ctx(); if (!c) return;
    busy(true, "Rendering PDF report…");
    Promise.resolve(ABGTExport.exportPDF(c)).then(function () { busy(false); toast("PDF report exported", "ok"); })
      .catch(function (e) { busy(false); toast("PDF export failed: " + e.message, "err"); });
  });
  $("#expPrint").addEventListener("click", function () { ABGTExport.print(); });

  $("#runTestsBtn").addEventListener("click", function () {
    var t = ABGTTests.runAll();
    var passed = t.filter(function (x) { return x.pass; }).length;
    $("#testOut").innerHTML = '<div class="notice ' + (passed === t.length ? "notice-ok" : "notice-err") + '"><strong>' +
      passed + " / " + t.length + " checks passed.</strong></div>" +
      t.map(function (x) {
        return '<div class="test-row ' + (x.pass ? "pass" : "fail") + '"><b>' + (x.pass ? "PASS" : "FAIL") +
          "</b><span>" + esc(x.name) + '<br><span class="muted xs">' + esc(x.detail || "") + "</span></span></div>";
      }).join("");
  });

  /* ------------------------------ equations panel ----------------------- */
  var EQS = [
    ["Total liabilities — PDF Sec. 3.2", "p̄ᵢ = Σⱼ₌₁ⁿ Lᵢⱼ", "Row sum of the liability matrix: everything institution i owes."],
    ["Relative liabilities — PDF Sec. 3.2", "πᵢⱼ = Lᵢⱼ / p̄ᵢ  if p̄ᵢ > 0,  else 0", "Proportional-repayment shares; each row sums to 1."],
    ["Eisenberg–Noe — PDF Sec. 3.3", "p = min{ p̄ , e + Πᵀp }", "Greatest fixed point, solved by Picard iteration from p⁽⁰⁾ = p̄."],
    ["Rogers–Veraart — PDF Sec. 3.4", "p = min{ p̄ , αe + βΠᵀp },  α, β ∈ (0,1]", "α = accessible external assets, β = recoverable interbank receipts. α = β = 1 gives EN."],
    ["Kusnetsov–Veraart — PDF Sec. 3.5", "e′ᵢ = eᵢ − λᵢ(p̄ᵢ − pᵢ)⁺", "Reduced-form fire sale: shortfalls erode external assets. No price-impact function, as stated in the research."],
    ["Coupled dynamics — PDF Sec. 3.6", "p⁽ᵏ⁺¹⁾ = min(p̄, αe⁽ᵏ⁾ + Πᵀp⁽ᵏ⁾);  e⁽ᵏ⁺¹⁾ = e⁽ᵏ⁾ − λ(p̄ − p⁽ᵏ⁾)⁺", "Each k is a genuine time step; the loop is the dynamic contagion mechanism."],
    ["Systemic risk — PDF Sec. 3.7", "SR = Σᵢ₌₁ⁿ (p̄ᵢ − pᵢ)⁺", "Total unpaid obligations — the research's aggregate distress index."],
    ["Default condition", "bank i defaults ⟺ pᵢ < p̄ᵢ", "Limited liability plus proportional repayment (assumptions v and vi)."]
  ];
  $("#eqGrid").innerHTML = EQS.map(function (e) {
    return '<div class="eq-card"><h5>' + e[0] + "</h5><code>" + esc(e[1]) + "</code><p>" + esc(e[2]) + "</p></div>";
  }).join("");

  window.addEventListener("resize", function () { if (S.net) ABGTNetworkViz.render($("#networkCanvas")); });
})();
