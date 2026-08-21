/* =============================================================================
 * dataLoader.js — CSV / Excel / PDF ingestion
 *
 * Accepted layout (long or wide):
 *  WIDE (recommended): first column = bank name, then one column per bank
 *  holding L_ij (row i owes column j), plus optional columns named
 *  "ExternalAssets" (e_i), "ExternalLiabilities", "Lambda".
 *
 *  LONG (edge list): columns Debtor, Creditor, Amount  (+ optional assets sheet)
 * ========================================================================== */
(function (global) {
  "use strict";

  var ASSET_KEYS = ["externalassets", "external_assets", "assets", "e", "ei", "external asset"];
  var EXTL_KEYS = ["externalliabilities", "external_liabilities", "extliab", "external liability", "external liabilities"];
  var LAMBDA_KEYS = ["lambda", "liquidationrate", "liquidation_rate", "lambda_i", "liquidation rate"];
  var BANK_KEYS = ["bank", "banks", "institution", "name", "owes\\to", "owes / to", "from\\to", ""];

  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " "); }
  function num(v) {
    if (v == null || v === "") return NaN;
    if (typeof v === "number") return v;
    var s = String(v).replace(/[, ]/g, "").replace(/[$₦€£]/g, "");
    if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
    return parseFloat(s);
  }

  /** Convert an array-of-arrays grid into a raw table {header, rows}. */
  function gridToTable(grid) {
    var clean = grid.filter(function (r) {
      return r && r.some(function (c) { return String(c == null ? "" : c).trim() !== ""; });
    });
    if (!clean.length) throw new Error("The file contains no readable rows.");
    return { header: clean[0].map(function (c) { return String(c == null ? "" : c).trim(); }), rows: clean.slice(1) };
  }

  function isEdgeList(header) {
    var h = header.map(norm);
    var has = function (a) { return a.some(function (k) { return h.indexOf(k) >= 0; }); };
    return has(["debtor", "from", "source", "payer"]) && has(["creditor", "to", "target", "payee"]);
  }

  /** Parse a WIDE matrix table into the canonical dataset shape. */
  function parseMatrix(table) {
    var header = table.header, h = header.map(norm);
    var idxAssets = -1, idxExtL = -1, idxLambda = -1;
    h.forEach(function (c, i) {
      if (idxAssets < 0 && ASSET_KEYS.indexOf(c) >= 0) idxAssets = i;
      if (idxExtL < 0 && EXTL_KEYS.indexOf(c) >= 0) idxExtL = i;
      if (idxLambda < 0 && LAMBDA_KEYS.indexOf(c) >= 0) idxLambda = i;
    });

    var special = [0, idxAssets, idxExtL, idxLambda];
    var matrixCols = [];
    for (var c = 1; c < header.length; c++) if (special.indexOf(c) < 0) matrixCols.push(c);

    var banks = [], L = [], e = [], extL = [], lam = [];
    table.rows.forEach(function (r) {
      var name = String(r[0] == null ? "" : r[0]).trim();
      if (!name) return;
      banks.push(name);
      L.push(matrixCols.map(function (c) { var v = num(r[c]); return isNaN(v) ? 0 : v; }));
      e.push(idxAssets >= 0 ? num(r[idxAssets]) : NaN);
      extL.push(idxExtL >= 0 ? num(r[idxExtL]) : 0);
      lam.push(idxLambda >= 0 ? num(r[idxLambda]) : NaN);
    });

    return {
      banks: banks,
      columnLabels: matrixCols.map(function (c) { return header[c]; }),
      L: L,
      e: e,
      extLiab: extL.map(function (v) { return isNaN(v) ? 0 : v; }),
      lambda: lam,
      layout: "matrix"
    };
  }

  /** Parse a LONG edge list into the canonical dataset shape. */
  function parseEdgeList(table) {
    var h = table.header.map(norm);
    var find = function (opts) { for (var i = 0; i < h.length; i++) if (opts.indexOf(h[i]) >= 0) return i; return -1; };
    var iD = find(["debtor", "from", "source", "payer"]);
    var iC = find(["creditor", "to", "target", "payee"]);
    var iA = find(["amount", "liability", "exposure", "value", "weight"]);
    var iE = find(ASSET_KEYS);
    if (iA < 0) throw new Error('Edge list detected but no "Amount" column was found.');

    var names = [], assets = {};
    table.rows.forEach(function (r) {
      [r[iD], r[iC]].forEach(function (v) {
        var s = String(v == null ? "" : v).trim();
        if (s && names.indexOf(s) < 0) names.push(s);
      });
      if (iE >= 0) {
        var d = String(r[iD]).trim(), val = num(r[iE]);
        if (d && !isNaN(val) && assets[d] == null) assets[d] = val;
      }
    });
    var idx = {}; names.forEach(function (nm, i) { idx[nm] = i; });
    var L = names.map(function () { return names.map(function () { return 0; }); });
    table.rows.forEach(function (r) {
      var d = String(r[iD] == null ? "" : r[iD]).trim(), c = String(r[iC] == null ? "" : r[iC]).trim();
      var v = num(r[iA]);
      if (d && c && !isNaN(v)) L[idx[d]][idx[c]] += v;
    });
    return {
      banks: names, columnLabels: names.slice(), L: L,
      e: names.map(function (nm) { return assets[nm] == null ? NaN : assets[nm]; }),
      extLiab: names.map(function () { return 0; }),
      lambda: names.map(function () { return NaN; }),
      layout: "edges"
    };
  }

  function fromGrid(grid) {
    var table = gridToTable(grid);
    var data = isEdgeList(table.header) ? parseEdgeList(table) : parseMatrix(table);
    data.rawTable = table;
    return data;
  }

  /* ------------------------------- CSV ---------------------------------- */
  function loadCSV(file) {
    return new Promise(function (resolve, reject) {
      Papa.parse(file, {
        skipEmptyLines: true,
        complete: function (r) {
          try { resolve(fromGrid(r.data)); } catch (err) { reject(err); }
        },
        error: reject
      });
    });
  }

  /* ------------------------------ EXCEL --------------------------------- */
  function loadExcel(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function (ev) {
        try {
          var wb = XLSX.read(new Uint8Array(ev.target.result), { type: "array" });
          var ws = wb.Sheets[wb.SheetNames[0]];
          var grid = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
          resolve(fromGrid(grid));
        } catch (err) { reject(err); }
      };
      fr.onerror = reject;
      fr.readAsArrayBuffer(file);
    });
  }

  /* ------------------------------- PDF ----------------------------------
   * Table extraction from PDF is heuristic: pdf.js gives positioned text
   * items, which we cluster into rows by y-coordinate and into cells by
   * x-gaps. The result is ALWAYS shown to the user for confirmation and
   * correction before any simulation is run.
   * --------------------------------------------------------------------- */
  function loadPDF(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function (ev) {
        pdfjsLib.getDocument({ data: new Uint8Array(ev.target.result) }).promise.then(function (pdf) {
          var pages = [];
          var chain = Promise.resolve();
          for (var pnum = 1; pnum <= pdf.numPages; pnum++) {
            (function (n) {
              chain = chain.then(function () {
                return pdf.getPage(n).then(function (page) {
                  return page.getTextContent().then(function (tc) { pages.push(itemsToGrid(tc.items)); });
                });
              });
            })(pnum);
          }
          return chain.then(function () {
            // Choose the page-grid that looks most like a numeric table.
            var best = null, bestScore = -1;
            pages.forEach(function (g) {
              var score = scoreGrid(g);
              if (score > bestScore) { bestScore = score; best = g; }
            });
            if (!best || bestScore <= 0) throw new Error("No table-like numeric block was detected in this PDF.");
            var data = fromGrid(best);
            data.source = "pdf";
            data.needsConfirmation = true;
            resolve(data);
          });
        }).catch(reject);
      };
      fr.onerror = reject;
      fr.readAsArrayBuffer(file);
    });
  }

  function itemsToGrid(items) {
    var rows = {};
    items.forEach(function (it) {
      if (!it.str || !it.str.trim()) return;
      var y = Math.round(it.transform[5] / 3) * 3;
      (rows[y] = rows[y] || []).push({ x: it.transform[4], s: it.str.trim() });
    });
    return Object.keys(rows)
      .sort(function (a, b) { return b - a; })
      .map(function (y) {
        var cells = rows[y].sort(function (a, b) { return a.x - b.x; });
        var out = [], cur = cells[0].s, lastX = cells[0].x;
        for (var i = 1; i < cells.length; i++) {
          if (cells[i].x - lastX > 18) { out.push(cur); cur = cells[i].s; }
          else cur += " " + cells[i].s;
          lastX = cells[i].x;
        }
        out.push(cur);
        return out;
      });
  }

  function scoreGrid(grid) {
    var s = 0;
    grid.forEach(function (r) {
      if (r.length < 3) return;
      var nums = r.filter(function (c) { return !isNaN(num(c)); }).length;
      if (nums >= r.length - 1) s += nums;
    });
    return s;
  }

  function load(file) {
    var name = file.name.toLowerCase();
    if (name.endsWith(".csv") || name.endsWith(".txt")) return loadCSV(file);
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) return loadExcel(file);
    if (name.endsWith(".pdf")) return loadPDF(file);
    return Promise.reject(new Error("Unsupported file type. Use CSV, XLSX, XLS or PDF."));
  }

  global.ABGTLoader = { load: load, fromGrid: fromGrid, num: num };
})(window);
