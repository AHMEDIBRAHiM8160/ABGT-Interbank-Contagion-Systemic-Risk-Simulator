/* =============================================================================
 * chartManager.js — Chart.js wrappers. All series come from real simulation
 * output; nothing here generates random or placeholder data.
 * ========================================================================== */
(function (global) {
  "use strict";

  var charts = {};
  var PALETTE = { EN: "#2f6df6", RV: "#f0a92a", KV: "#e0526a", grid: "rgba(148,163,184,.18)" };

  function css(v) { return getComputedStyle(document.documentElement).getPropertyValue(v).trim(); }
  function base() {
    var tick = css("--txt-muted") || "#7b8794";
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: tick, font: { family: "Inter, system-ui", size: 11 } } } },
      scales: {
        x: { ticks: { color: tick, font: { size: 11 } }, grid: { color: PALETTE.grid } },
        y: { ticks: { color: tick, font: { size: 11 } }, grid: { color: PALETTE.grid }, beginAtZero: true }
      }
    };
  }

  function make(id, cfg) {
    var el = document.getElementById(id);
    if (!el) return;
    if (charts[id]) charts[id].destroy();
    charts[id] = new Chart(el.getContext("2d"), cfg);
    return charts[id];
  }

  function destroyAll() { Object.keys(charts).forEach(function (k) { charts[k].destroy(); delete charts[k]; }); }

  /** Bank-level shortfall (p̄_i - p_i)+ for one model. */
  function bankShortfall(id, banks, rows) {
    make(id, {
      type: "bar",
      data: {
        labels: banks,
        datasets: [
          { label: "Shortfall (p̄ᵢ − pᵢ)⁺", data: rows.map(function (r) { return r.shortfall; }), backgroundColor: "#e0526a", borderRadius: 4 },
          { label: "Clearing payment pᵢ", data: rows.map(function (r) { return r.clearingPayment; }), backgroundColor: "#2f6df6", borderRadius: 4 }
        ]
      },
      options: base()
    });
  }

  /** Contagion path: SR by iteration/round. */
  function contagionPath(id, results) {
    var maxLen = Math.max.apply(null, Object.keys(results).map(function (k) { return results[k].series.length; }));
    var labels = []; for (var i = 0; i < maxLen; i++) labels.push("k=" + i);
    var ds = Object.keys(results).map(function (k) {
      return {
        label: results[k].model, data: results[k].series.map(function (s) { return s.SR; }),
        borderColor: PALETTE[k], backgroundColor: PALETTE[k] + "22", tension: 0.25, fill: false, pointRadius: 2
      };
    });
    make(id, { type: "line", data: { labels: labels, datasets: ds }, options: base() });
  }

  /** Model comparison — defaults and SR. */
  function compareBars(id, results, key, label) {
    var keys = Object.keys(results);
    make(id, {
      type: "bar",
      data: {
        labels: keys.map(function (k) { return results[k].model; }),
        datasets: [{ label: label, data: keys.map(function (k) { return results[k][key]; }), backgroundColor: keys.map(function (k) { return PALETTE[k]; }), borderRadius: 5 }]
      },
      options: base()
    });
  }

  /** Bank-level losses across the three models (grouped bars). */
  function compareBankLosses(id, banks, tables) {
    var ds = Object.keys(tables).map(function (k) {
      return { label: k, data: tables[k].map(function (r) { return r.shortfall; }), backgroundColor: PALETTE[k], borderRadius: 4 };
    });
    make(id, { type: "bar", data: { labels: banks, datasets: ds }, options: base() });
  }

  /** Radar of normalised system metrics per model. */
  function radar(id, results, summaries) {
    var keys = Object.keys(results);
    var metrics = ["Defaults", "Systemic risk SR", "Credit loss", "Contagion rounds", "Unpaid share"];
    var raw = keys.map(function (k) {
      var s = summaries[k];
      return [s.finalDefaults, s.systemicRisk, s.totalCreditLoss, s.contagionRounds, s.contagionIntensity * 100];
    });
    var maxes = metrics.map(function (_, j) { return Math.max.apply(null, raw.map(function (r) { return r[j]; }).concat([1e-9])); });
    var tick = css("--txt-muted") || "#7b8794";
    make(id, {
      type: "radar",
      data: {
        labels: metrics,
        datasets: keys.map(function (k, i) {
          return {
            label: results[k].model,
            data: raw[i].map(function (v, j) { return (v / maxes[j]) * 100; }),
            borderColor: PALETTE[k], backgroundColor: PALETTE[k] + "33", pointBackgroundColor: PALETTE[k]
          };
        })
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: tick } } },
        scales: { r: { beginAtZero: true, suggestedMax: 100, angleLines: { color: PALETTE.grid }, grid: { color: PALETTE.grid }, pointLabels: { color: tick, font: { size: 11 } }, ticks: { display: false } } }
      }
    });
  }

  /** Scatter: gross interbank exposure vs marginal systemic impact. */
  function scatterRisk(id, rows) {
    make(id, {
      type: "scatter",
      data: {
        datasets: [{
          label: "Institutions",
          data: rows.map(function (r) { return { x: r.totalLiabilities + r.interbankAssets, y: r.marginalImpact || 0, b: r.bank }; }),
          backgroundColor: rows.map(function (r) { return r.defaulted ? "#e0526a" : "#2f6df6"; }),
          pointRadius: 7, pointHoverRadius: 9
        }]
      },
      options: Object.assign(base(), {
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) { return c.raw.b + " — exposure " + c.raw.x.toFixed(1) + ", impact " + c.raw.y.toFixed(2); } } }
        },
        scales: Object.assign(base().scales, {
          x: Object.assign(base().scales.x, { title: { display: true, text: "Gross interbank exposure (p̄ᵢ + receivables)", color: css("--txt-muted") } }),
          y: Object.assign(base().scales.y, { title: { display: true, text: "Marginal systemic impact ΔSR", color: css("--txt-muted") } })
        })
      })
    });
  }

  /** Liability heatmap rendered as an HTML grid (exact L_ij values). */
  function heatmap(el, banks, L) {
    var max = 0; L.forEach(function (r) { r.forEach(function (v) { if (v > max) max = v; }); });
    var h = ['<table class="heatmap"><thead><tr><th></th>'];
    banks.forEach(function (b) { h.push("<th>" + b + "</th>"); });
    h.push("</tr></thead><tbody>");
    L.forEach(function (row, i) {
      h.push("<tr><th>" + banks[i] + "</th>");
      row.forEach(function (v) {
        var a = max > 0 ? v / max : 0;
        h.push('<td style="background:rgba(224,82,106,' + (0.06 + a * 0.85).toFixed(3) + ')" title="' + v + '">' + (v ? v.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "·") + "</td>");
      });
      h.push("</tr>");
    });
    h.push("</tbody></table>");
    el.innerHTML = h.join("");
  }

  global.ABGTCharts = {
    bankShortfall: bankShortfall, contagionPath: contagionPath, compareBars: compareBars,
    compareBankLosses: compareBankLosses, radar: radar, scatterRisk: scatterRisk,
    heatmap: heatmap, destroyAll: destroyAll, charts: charts
  };
})(window);
