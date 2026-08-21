/* =============================================================================
 * networkVisualizer.js — interactive directed-network SVG renderer
 * Nodes = institutions, directed edges = interbank liabilities L_ij (i owes j).
 * Pure SVG, no external graph library.
 * ========================================================================== */
(function (global) {
  "use strict";

  var state = { net: null, res: null, sel: null, stage: null, onSelect: null };

  function layout(n, w, h) {
    var cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 70;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  function statusOf(i) {
    var res = state.res;
    if (!res) return "idle";
    if ((res.shockedIdx || []).indexOf(i) >= 0) return "shocked";
    if (state.stage != null) {
      var st = res.stages[i];
      if (st >= 0 && st <= state.stage) return "default";
      return "solvent";
    }
    return res.defaults[i] ? "default" : "solvent";
  }

  function render(container) {
    var net = state.net;
    if (!net) return;
    var w = container.clientWidth || 900;
    var h = Math.max(460, Math.min(640, w * 0.62));
    var pts = layout(net.n, w, h);
    var maxL = 0;
    net.L.forEach(function (r) { r.forEach(function (v) { if (v > maxL) maxL = v; }); });

    var svg = ['<svg viewBox="0 0 ' + w + ' ' + h + '" width="100%" height="' + h + '" role="img" aria-label="Interbank network">'];
    svg.push('<defs>' +
      '<marker id="ah" markerWidth="9" markerHeight="9" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="currentColor"/></marker>' +
      '</defs>');

    // ---- edges -------------------------------------------------------------
    for (var i = 0; i < net.n; i++) {
      for (var j = 0; j < net.n; j++) {
        var v = net.L[i][j];
        if (!v || i === j) continue;
        var a = pts[i], b = pts[j];
        var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
        var pad = 30;
        var x1 = a.x + (dx / d) * pad, y1 = a.y + (dy / d) * pad;
        var x2 = b.x - (dx / d) * (pad + 6), y2 = b.y - (dy / d) * (pad + 6);
        var mx = (x1 + x2) / 2 - dy * 0.11, my = (y1 + y2) / 2 + dx * 0.11;
        var wgt = 1 + 4 * (v / (maxL || 1));
        var related = state.sel == null || state.sel === i || state.sel === j;
        var flowing = state.res && statusOf(i) === "default" && state.res.shortfall[i] > 1e-8;
        var cls = "edge" + (related ? "" : " edge--dim") + (flowing && related ? " edge--contagion" : "");
        svg.push('<path class="' + cls + '" d="M' + x1 + ',' + y1 + ' Q' + mx + ',' + my + ' ' + x2 + ',' + y2 +
          '" stroke-width="' + wgt.toFixed(2) + '" marker-end="url(#ah)" fill="none"><title>' +
          esc(net.banks[i]) + ' owes ' + esc(net.banks[j]) + ': ' + fmt(v) + '</title></path>');
      }
    }

    // ---- nodes -------------------------------------------------------------
    for (var k = 0; k < net.n; k++) {
      var p = pts[k], st = statusOf(k);
      var rad = 20 + 12 * Math.sqrt((net.pbar[k] + net.interbankAssets[k]) / (maxL * 4 || 1));
      rad = Math.max(20, Math.min(38, rad));
      var selCls = state.sel === k ? " node--sel" : "";
      var dim = state.sel != null && state.sel !== k && !connected(state.sel, k) ? " node--dim" : "";
      svg.push('<g class="node node--' + st + selCls + dim + '" data-i="' + k + '" tabindex="0" role="button" aria-label="' + esc(net.banks[k]) + '">');
      if (st === "default" || st === "shocked") svg.push('<circle class="node-halo" cx="' + p.x + '" cy="' + p.y + '" r="' + (rad + 9) + '"/>');
      svg.push('<circle class="node-body" cx="' + p.x + '" cy="' + p.y + '" r="' + rad + '"/>');
      svg.push('<text class="node-label" x="' + p.x + '" y="' + (p.y + rad + 17) + '" text-anchor="middle">' + esc(net.banks[k]) + '</text>');
      if (state.res) {
        var rr = net.pbar[k] > 0 ? state.res.p[k] / net.pbar[k] : 1;
        svg.push('<text class="node-sub" x="' + p.x + '" y="' + (p.y + 4) + '" text-anchor="middle">' + Math.round(rr * 100) + '%</text>');
      }
      svg.push('</g>');
    }
    svg.push("</svg>");
    container.innerHTML = svg.join("");

    Array.prototype.forEach.call(container.querySelectorAll(".node"), function (g) {
      var handler = function () {
        var i = +g.getAttribute("data-i");
        state.sel = state.sel === i ? null : i;
        render(container);
        if (state.onSelect) state.onSelect(state.sel);
      };
      g.addEventListener("click", handler);
      g.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); handler(); } });
    });
  }

  function connected(a, b) {
    var L = state.net.L;
    return L[a][b] > 0 || L[b][a] > 0;
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }
  function fmt(v) { return Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }); }

  global.ABGTNetworkViz = {
    setData: function (net, res) { state.net = net; state.res = res; state.stage = null; },
    setStage: function (s) { state.stage = s; },
    select: function (i) { state.sel = i; },
    getSelected: function () { return state.sel; },
    onSelect: function (fn) { state.onSelect = fn; },
    render: render,
    state: state
  };
})(window);
