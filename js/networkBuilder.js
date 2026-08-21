/* =============================================================================
 * networkBuilder.js — builds the financial-network object from validated data
 * PDF Sec. 3.2: V = {1..n}, L = (L_ij) in R^{nxn}, e in R^n
 * ========================================================================== */
(function (global) {
  "use strict";

  /**
   * @param {string[]} banks   institution names  (V = {1,...,n})
   * @param {number[][]} L     liability matrix, L_ij = amount i OWES j
   * @param {number[]} e       external assets
   * @param {number[]} extLiab external (non-interbank) liabilities, optional.
   *        NOTE: the research PDF's clearing equations use only interbank
   *        liabilities. External liabilities are carried for reporting only and
   *        DO NOT enter the fixed point — flagged as an application-level field.
   */
  function build(banks, L, e, extLiab) {
    var n = banks.length;
    var pbar = ABGTModels.totalLiabilities(L);          // p̄_i = SUM_j L_ij
    var PI = ABGTModels.relativeLiabilities(L, pbar);    // pi_ij = L_ij / p̄_i

    var owedToMe = [];
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var j = 0; j < n; j++) s += L[j][i];
      owedToMe.push(s);
    }

    return {
      banks: banks.slice(),
      n: n,
      L: L.map(function (r) { return r.slice(); }),
      e: e.slice(),
      e0: e.slice(),                                  // pristine pre-shock assets
      extLiab: (extLiab || banks.map(function () { return 0; })).slice(),
      pbar: pbar,
      PI: PI,
      interbankAssets: owedToMe,
      totalInterbank: pbar.reduce(function (a, b) { return a + b; }, 0)
    };
  }

  /**
   * Apply an initial shock. The PDF does not formally define a shock operator
   * (Sec. 1.7 uses "stylized networks and simulated scenarios"), so the two
   * mechanisms below are labelled IMPLEMENTATION ASSUMPTIONS in the UI:
   *
   *   'asset'  :  e_i  ->  (1 - s) * e_i           for each shocked bank i
   *   'wipeout':  e_i  ->  0                        (total loss of external assets)
   *
   * Neither introduces a liquidity buffer; both act only on the external-asset
   * vector e, which is a primitive of the research model (PDF Sec. 3.2).
   */
  function applyShock(net, shockedIdx, type, magnitude) {
    var e = net.e0.slice();
    shockedIdx.forEach(function (i) {
      if (type === "wipeout") e[i] = 0;
      else e[i] = Math.max(0, e[i] * (1 - magnitude));
    });
    var shocked = build(net.banks, net.L, e, net.extLiab);
    shocked.e0 = net.e0.slice();
    shocked.shockedIdx = shockedIdx.slice();
    shocked.shockType = type;
    shocked.shockMagnitude = magnitude;
    return shocked;
  }

  global.ABGTNetwork = { build: build, applyShock: applyShock };
})(window);
