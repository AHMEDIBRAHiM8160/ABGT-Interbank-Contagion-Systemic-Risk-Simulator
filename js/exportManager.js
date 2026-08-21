/* =============================================================================
 * exportManager.js — CSV / Excel / PDF / print export of real results
 * ========================================================================== */
(function (global) {
  "use strict";

  function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-"); }
  function n2(v) { return v == null || isNaN(v) ? "" : Number(v).toFixed(4); }

  function bankRows(table) {
    return table.map(function (r) {
      return {
        Bank: r.bank,
        "External assets e_i": n2(r.externalAssets),
        "Effective assets": n2(r.effectiveAssets),
        "Total liabilities p̄_i": n2(r.totalLiabilities),
        "Interbank receivable": n2(r.interbankAssets),
        "Clearing payment p_i": n2(r.clearingPayment),
        "Received (Pi^T p)_i": n2(r.received),
        "Recovery rate p_i/p̄_i": n2(r.recoveryRate),
        "Shortfall (p̄_i-p_i)+": n2(r.shortfall),
        "Credit loss": n2(r.creditLoss),
        "Equity at clearing": n2(r.equity),
        "Default": r.defaulted ? "DEFAULT" : "SOLVENT",
        "Contagion stage": r.stage < 0 ? "-" : r.stage,
        "Affected counterparties": r.affectedCounterparties,
        "Contagion contribution": n2(r.contagionContribution),
        "Marginal impact dSR": n2(r.marginalImpact),
        "Risk score (app-level)": n2(r.riskScore)
      };
    });
  }

  function toCSV(rows) {
    if (!rows.length) return "";
    var head = Object.keys(rows[0]);
    var esc = function (v) { var s = String(v == null ? "" : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [head.join(",")].concat(rows.map(function (r) { return head.map(function (h) { return esc(r[h]); }).join(","); })).join("\n");
  }

  function download(name, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }

  function exportCSV(ctx) {
    var lines = [];
    lines.push("ABGT Systemic Risk & Interbank Contagion Simulator");
    lines.push("Research: Mathematical Modelling and Risk Management in Financial Networks — Ahmed Ibrahim (U1/21/MTH/1420)");
    lines.push("Generated," + new Date().toISOString());
    lines.push("Model," + ctx.summary.model);
    lines.push("alpha," + ctx.params.alpha + ",beta," + ctx.params.beta + ",lambda," + ctx.params.lambdaScalar);
    lines.push("Shock," + ctx.shockLabel);
    lines.push("");
    lines.push("SYSTEM SUMMARY");
    Object.keys(ctx.summary).forEach(function (k) { lines.push(k + "," + ctx.summary[k]); });
    lines.push("");
    lines.push("BANK-LEVEL RESULTS");
    lines.push(toCSV(bankRows(ctx.table)));
    if (ctx.comparison) {
      lines.push("");
      lines.push("MODEL COMPARISON");
      lines.push(toCSV(ctx.comparison));
    }
    download("abgt-simulation-" + stamp() + ".csv", lines.join("\n"), "text/csv;charset=utf-8");
  }

  function exportExcel(ctx) {
    var wb = XLSX.utils.book_new();
    var meta = [
      ["ABGT Systemic Risk & Interbank Contagion Simulator"],
      ["Research", "Mathematical Modelling and Risk Management in Financial Networks"],
      ["Author", "Ahmed Ibrahim (U1/21/MTH/1420), Umaru Musa Yar'adua University"],
      ["Generated", new Date().toISOString()],
      ["Model", ctx.summary.model],
      ["alpha", ctx.params.alpha], ["beta", ctx.params.beta], ["lambda", ctx.params.lambdaScalar],
      ["Shock", ctx.shockLabel], [],
      ["SYSTEM SUMMARY"]
    ];
    Object.keys(ctx.summary).forEach(function (k) { meta.push([k, ctx.summary[k]]); });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(meta), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(bankRows(ctx.table)), "Bank Results");
    if (ctx.comparison) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ctx.comparison), "Model Comparison");
    var lm = [[""].concat(ctx.net.banks)];
    ctx.net.L.forEach(function (r, i) { lm.push([ctx.net.banks[i]].concat(r)); });
    lm.push([]); lm.push(["External assets"].concat(ctx.net.e));
    lm.push(["Total liabilities p̄"].concat(ctx.net.pbar));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(lm), "Input Network");
    XLSX.writeFile(wb, "abgt-simulation-" + stamp() + ".xlsx");
  }

  function canvasesFor(ids) {
    return ids.map(function (id) {
      var el = document.getElementById(id);
      if (!el) return null;
      try { return { id: id, url: el.toDataURL("image/png", 1.0), w: el.width, h: el.height }; }
      catch (e) { return null; }
    }).filter(Boolean);
  }

  function svgToPng(svgEl) {
    return new Promise(function (resolve) {
      if (!svgEl) return resolve(null);
      try {
        var clone = svgEl.cloneNode(true);
        var styles = "text{font-family:Inter,Arial,sans-serif}.node-label{font-size:12px;fill:#1e293b}.node-sub{font-size:11px;fill:#fff;font-weight:700}" +
          ".edge{stroke:#94a3b8;opacity:.6}.edge--contagion{stroke:#e0526a;opacity:.95}.node-body{stroke:#fff;stroke-width:2}" +
          ".node--solvent .node-body{fill:#2f6df6}.node--default .node-body{fill:#e0526a}.node--shocked .node-body{fill:#f0a92a}.node--idle .node-body{fill:#64748b}" +
          ".node-halo{fill:rgba(224,82,106,.18)}";
        var s = document.createElementNS("http://www.w3.org/2000/svg", "style");
        s.textContent = styles; clone.insertBefore(s, clone.firstChild);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        var vb = (clone.getAttribute("viewBox") || "0 0 900 500").split(/\s+/).map(Number);
        var W = vb[2], H = vb[3];
        var blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
        var url = URL.createObjectURL(blob);
        var img = new Image();
        img.onload = function () {
          var c = document.createElement("canvas");
          c.width = W * 2; c.height = H * 2;
          var g = c.getContext("2d");
          g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve({ url: c.toDataURL("image/png"), w: c.width, h: c.height });
        };
        img.onerror = function () { URL.revokeObjectURL(url); resolve(null); };
        img.src = url;
      } catch (e) { resolve(null); }
    });
  }

  function exportPDF(ctx) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: "pt", format: "a4" });
    var W = doc.internal.pageSize.getWidth();
    var M = 40, y = 0;

    // Cover band
    doc.setFillColor(11, 26, 47); doc.rect(0, 0, W, 120, "F");
    doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(19);
    doc.text("Systemic Risk & Interbank Contagion Report", M, 50);
    doc.setFontSize(10); doc.setFont("helvetica", "normal");
    doc.text("ABGT Solutions — Interbank Contagion Simulator", M, 70);
    doc.text("Mathematical Modelling and Risk Management in Financial Networks", M, 86);
    doc.text("Ahmed Ibrahim (U1/21/MTH/1420) · Umaru Musa Yar'adua University · Supervisor: Dr. Babangida Bature", M, 101);
    doc.setTextColor(30, 41, 59);
    y = 145;

    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("1. Simulation configuration", M, y); y += 6;
    doc.autoTable({
      startY: y + 6, margin: { left: M, right: M }, theme: "grid", styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [47, 109, 246] },
      head: [["Setting", "Value"]],
      body: [
        ["Generated", new Date().toLocaleString()],
        ["Model", ctx.summary.model],
        ["Institutions (n)", String(ctx.net.n)],
        ["Shock scenario", ctx.shockLabel],
        ["alpha (external-asset recovery)", String(ctx.params.alpha)],
        ["beta (interbank recovery)", String(ctx.params.beta)],
        ["lambda (liquidation rate)", String(ctx.params.lambdaScalar)]
      ]
    });
    y = doc.lastAutoTable.finalY + 22;

    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("2. Model equations applied", M, y);
    doc.setFont("helvetica", "normal"); doc.setFontSize(9.5);
    var eqs = [
      "Total liabilities:        p_i = SUM_j L_ij            (PDF Sec. 3.2)",
      "Relative liabilities:     pi_ij = L_ij / p_i           (PDF Sec. 3.2)",
      "Eisenberg-Noe:            p = min{ p_bar, e + Pi^T p }        (PDF Sec. 3.3)",
      "Rogers-Veraart:           p = min{ p_bar, a*e + b*Pi^T p }    (PDF Sec. 3.4)",
      "Kusnetsov-Veraart:        e'_i = e_i - lambda_i (p_bar_i - p_i)+   (PDF Sec. 3.5)",
      "Coupled dynamics:         p(k+1)=min(p_bar, a*e(k)+Pi^T p(k));  e(k+1)=e(k)-lambda(p_bar-p(k))+   (Sec. 3.6)",
      "Systemic risk index:      SR = SUM_i (p_bar_i - p_i)+          (PDF Sec. 3.7)"
    ];
    y += 16; eqs.forEach(function (t) { doc.text(t, M, y); y += 13; });

    y += 10;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("3. System summary", M, y);
    doc.autoTable({
      startY: y + 8, margin: { left: M, right: M }, theme: "striped", styles: { fontSize: 9, cellPadding: 4 },
      headStyles: { fillColor: [11, 26, 47] },
      head: [["Metric", "Value"]],
      body: [
        ["Institutions", ctx.summary.banks],
        ["Initially shocked", ctx.summary.initialDefaults],
        ["Final defaults", ctx.summary.finalDefaults],
        ["Solvent institutions", ctx.summary.solvent],
        ["Systemic risk SR = SUM (p_bar - p)+", ctx.summary.systemicRisk.toFixed(4)],
        ["Total interbank obligations", ctx.summary.totalLiabilities.toFixed(2)],
        ["Total cleared payments", ctx.summary.totalPaid.toFixed(2)],
        ["Total credit loss to creditors", ctx.summary.totalCreditLoss.toFixed(4)],
        ["Contagion rounds", ctx.summary.contagionRounds],
        ["Fixed-point iterations", ctx.summary.iterations],
        ["Converged", ctx.summary.converged ? "Yes" : "No (iteration cap reached)"]
      ]
    });

    doc.addPage();
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("4. Bank-level results", M, 50);
    doc.autoTable({
      startY: 62, margin: { left: 24, right: 24 }, theme: "grid",
      styles: { fontSize: 7.2, cellPadding: 3 }, headStyles: { fillColor: [47, 109, 246], fontSize: 7.2 },
      head: [["Bank", "e_i", "p_bar_i", "p_i", "Recv", "Recovery", "Shortfall", "Credit loss", "Status", "Stage", "Risk score"]],
      body: ctx.table.map(function (r) {
        return [r.bank, r.externalAssets.toFixed(2), r.totalLiabilities.toFixed(2), r.clearingPayment.toFixed(2),
          r.received.toFixed(2), (r.recoveryRate * 100).toFixed(1) + "%", r.shortfall.toFixed(3),
          r.creditLoss.toFixed(3), r.defaulted ? "DEFAULT" : "SOLVENT", r.stage < 0 ? "-" : r.stage,
          r.riskScore ? r.riskScore.toFixed(1) : "-"];
      })
    });

    if (ctx.comparison && ctx.comparison.length) {
      var yy = doc.lastAutoTable.finalY + 24;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("5. Model comparison", M, yy);
      doc.autoTable({
        startY: yy + 8, margin: { left: M, right: M }, theme: "grid", styles: { fontSize: 8, cellPadding: 3 },
        headStyles: { fillColor: [224, 82, 106] },
        head: [Object.keys(ctx.comparison[0])],
        body: ctx.comparison.map(function (r) { return Object.keys(r).map(function (k) { return r[k]; }); })
      });
    }

    var chartIds = ["chartBankLoss", "chartPath", "chartCmpDefaults", "chartCmpSR", "chartCmpBank", "chartRadar", "chartScatter"];
    return svgToPng(document.querySelector("#networkCanvas svg")).then(function (netImg) {
      doc.addPage();
      var yy = 50;
      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("6. Network visualisation", M, yy); yy += 14;
      if (netImg) {
        var w = W - 2 * M, h = w * (netImg.h / netImg.w);
        doc.addImage(netImg.url, "PNG", M, yy, w, Math.min(h, 300)); yy += Math.min(h, 300) + 24;
      } else { doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.text("Network image unavailable.", M, yy); yy += 20; }

      doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("7. Charts", M, yy); yy += 14;
      canvasesFor(chartIds).forEach(function (c) {
        var w = (W - 2 * M - 14) / 2, h = w * 0.62;
        if (yy + h > doc.internal.pageSize.getHeight() - 40) { doc.addPage(); yy = 50; }
        doc.addImage(c.url, "PNG", M, yy, w, h);
        yy += h + 14;
      });

      var pages = doc.internal.getNumberOfPages();
      for (var i = 1; i <= pages; i++) {
        doc.setPage(i); doc.setFontSize(8); doc.setTextColor(120, 132, 148);
        doc.text("Powered by ABGT Solutions   ·   page " + i + " of " + pages, M, doc.internal.pageSize.getHeight() - 20);
      }
      doc.save("abgt-systemic-risk-report-" + stamp() + ".pdf");
    });
  }

  global.ABGTExport = { exportCSV: exportCSV, exportExcel: exportExcel, exportPDF: exportPDF, print: function () { window.print(); }, download: download, toCSV: toCSV };
})(window);
