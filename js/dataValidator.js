/* =============================================================================
 * dataValidator.js — validates a parsed dataset BEFORE any simulation.
 * Principle: never silently modify financial data. Report; let the user fix.
 * ========================================================================== */
(function (global) {
  "use strict";

  function validate(data) {
    var issues = [];
    var n = data.banks.length;

    var err = function (m, d) { issues.push({ level: "error", message: m, detail: d || "" }); };
    var warn = function (m, d) { issues.push({ level: "warning", message: m, detail: d || "" }); };
    var info = function (m, d) { issues.push({ level: "info", message: m, detail: d || "" }); };

    if (n === 0) { err("No banks were detected in the file."); return { ok: false, issues: issues }; }
    if (n === 1) warn("Only one institution detected — contagion requires at least two banks.");

    // Duplicate bank names
    var seen = {};
    data.banks.forEach(function (b) {
      var k = b.toLowerCase();
      if (seen[k]) err("Duplicate bank name: “" + b + "”.", "Each institution must appear exactly once.");
      seen[k] = true;
    });

    // Matrix dimensions: L must be n x n
    data.L.forEach(function (row, i) {
      if (row.length !== n) {
        err("Row “" + data.banks[i] + "” has " + row.length + " liability columns but there are " + n + " banks.",
            "The liability matrix L must be square (n x n).");
      }
    });
    if (data.columnLabels && data.columnLabels.length === n) {
      data.columnLabels.forEach(function (lbl, j) {
        if (String(lbl).trim().toLowerCase() !== String(data.banks[j]).trim().toLowerCase()) {
          warn("Column " + (j + 1) + " is labelled “" + lbl + "” but row " + (j + 1) + " is “" + data.banks[j] + "”.",
               "Row and column ordering should match so that L_ij is read correctly.");
        }
      });
    }

    // Values: negatives, missing, self-liabilities
    var missing = 0, negatives = [], selfLiab = [];
    data.L.forEach(function (row, i) {
      row.forEach(function (v, j) {
        if (v == null || isNaN(v)) missing++;
        else if (v < 0) negatives.push(data.banks[i] + " → " + (data.columnLabels[j] || data.banks[j]) + " = " + v);
        if (i === j && v > 0) selfLiab.push(data.banks[i] + " (" + v + ")");
      });
    });
    if (missing) err(missing + " missing / non-numeric entries in the liability matrix.", "L_ij must satisfy L_ij ≥ 0 (PDF Sec. 3.2).");
    if (negatives.length) err("Negative liabilities found.", negatives.slice(0, 6).join("; "));
    if (selfLiab.length) warn("Self-liabilities on the diagonal: " + selfLiab.join(", ") + ".",
      "A bank owing itself inflates p̄_i. Set L_ii = 0 unless this is intentional.");

    // External assets
    var missingE = [];
    data.e.forEach(function (v, i) { if (v == null || isNaN(v)) missingE.push(data.banks[i]); });
    if (missingE.length === n) {
      err("No external-asset column found.", 'Add a column named "ExternalAssets" — e is required by every model (PDF Sec. 3.2).');
    } else if (missingE.length) {
      err("External assets missing for: " + missingE.join(", ") + ".");
    }
    data.e.forEach(function (v, i) {
      if (!isNaN(v) && v < 0) err("Negative external assets for " + data.banks[i] + " (" + v + ").");
    });

    // Isolated institutions
    var isolated = [];
    for (var i = 0; i < n; i++) {
      var out = (data.L[i] || []).reduce(function (a, b) { return a + (b || 0); }, 0);
      var inn = 0;
      for (var j = 0; j < n; j++) inn += (data.L[j] && data.L[j][i]) || 0;
      if (out === 0 && inn === 0) isolated.push(data.banks[i]);
    }
    if (isolated.length) info("Institutions with no interbank links: " + isolated.join(", ") + ".",
      "They can neither transmit nor receive contagion.");

    // Lambda for Kusnetsov-Veraart
    var hasLambda = data.lambda && data.lambda.some(function (v) { return !isNaN(v); });
    if (!hasLambda) info("No liquidation-rate (λ) column supplied.",
      "The Kusnetsov–Veraart model will use the uniform λ you set in the Simulation panel.");
    else data.lambda.forEach(function (v, i) {
      if (!isNaN(v) && v < 0) err("Negative liquidation rate λ for " + data.banks[i] + ".", "PDF Sec. 3.5 requires λ_i ≥ 0.");
    });

    return { ok: !issues.some(function (x) { return x.level === "error"; }), issues: issues };
  }

  global.ABGTValidator = { validate: validate };
})(window);
