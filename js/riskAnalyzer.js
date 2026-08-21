/* =============================================================================
 * riskAnalyzer.js — systemic-risk measurement and bank-level ranking
 *
 * RESEARCH-DEFINED measure (PDF Sec. 3.7):
 *      SR = SUM_{i=1..n} (p̄_i - p_i)+
 *
 * Everything else in this file that is NOT that equation is explicitly marked
 * as an APPLICATION-LEVEL ANALYTICAL INDICATOR. It is not claimed to be part
 * of the research methodology.
 * ========================================================================== */
(function (global) {
  "use strict";

  /**
   * Marginal systemic impact of bank i (APPLICATION-LEVEL INDICATOR).
   * Definition used: re-run the same model with bank i's external assets fully
   * wiped out and measure the increase in the research SR index:
   *      Impact_i = SR(shock on i) - SR(baseline)
   * This is a standard "knock-out" experiment built ON TOP of the research
   * equation (SR is taken verbatim from PDF Sec. 3.7); it is not itself an
   * equation from the PDF.
   */
  function marginalImpact(baseNet, modelKey, params, baselineSR) {
    var out = [];
    for (var i = 0; i < baseNet.n; i++) {
      var shocked = ABGTNetwork.applyShock(baseNet, [i], "wipeout", 1);
      var r = ABGTEngine.run(modelKey, shocked, params);
      out.push({
        idx: i,
        sr: r.systemicRisk,
        delta: Math.max(0, r.systemicRisk - baselineSR),
        defaults: r.defaultCount
      });
    }
    return out;
  }

  /**
   * Build the bank-level table for one model result.
   * All columns are either raw model output or the research SR shortfall.
   */
  function bankTable(net, res, impacts) {
    var maxDelta = impacts ? Math.max.apply(null, impacts.map(function (o) { return o.delta; }).concat([0])) : 0;
    var maxExp = Math.max.apply(null, net.pbar.concat(net.interbankAssets).concat([1]));

    return net.banks.map(function (name, i) {
      var affected = 0;   // counterparties that receive less than contracted from i
      if (res.shortfall[i] > 1e-8) {
        for (var j = 0; j < net.n; j++) if (net.L[i][j] > 0) affected++;
      }
      var impact = impacts ? impacts[i] : null;
      // Composite score (APPLICATION-LEVEL INDICATOR, clearly labelled in the UI):
      // equal-weight blend of normalised marginal SR impact and normalised
      // gross interbank exposure. Not an equation from the research.
      var score = 0;
      if (impact) {
        var a = maxDelta > 0 ? impact.delta / maxDelta : 0;
        var b = maxExp > 0 ? (net.pbar[i] + net.interbankAssets[i]) / (2 * maxExp) : 0;
        score = 100 * (0.65 * a + 0.35 * b);
      }
      return {
        idx: i,
        bank: name,
        externalAssets: net.e[i],
        effectiveAssets: res.effectiveAssets[i],
        totalLiabilities: net.pbar[i],          // p̄_i
        interbankAssets: net.interbankAssets[i],
        clearingPayment: res.p[i],              // p_i
        received: res.received[i],              // (Pi^T p)_i
        shortfall: res.shortfall[i],            // (p̄_i - p_i)+  -> the SR contribution
        recoveryRate: net.pbar[i] > 0 ? res.p[i] / net.pbar[i] : 1,
        creditLoss: res.creditLoss[i],
        equity: res.equity[i],
        defaulted: res.defaults[i],
        initiallyShocked: (res.shockedIdx || []).indexOf(i) >= 0,
        stage: res.stages[i],
        affectedCounterparties: affected,
        contagionContribution: res.systemicRisk > 0 ? res.shortfall[i] / res.systemicRisk : 0,
        marginalImpact: impact ? impact.delta : null,
        riskScore: score
      };
    });
  }

  /** System-level summary, using the research SR index. */
  function summary(net, res) {
    return {
      model: res.model,
      banks: net.n,
      initialDefaults: (res.shockedIdx || []).length,
      finalDefaults: res.defaultCount,
      solvent: net.n - res.defaultCount,
      systemicRisk: res.systemicRisk,          // SR = SUM (p̄_i - p_i)+  [PDF 3.7]
      totalLiabilities: net.pbar.reduce(function (a, b) { return a + b; }, 0),
      totalExternalAssets: net.e.reduce(function (a, b) { return a + b; }, 0),
      totalPaid: res.p.reduce(function (a, b) { return a + b; }, 0),
      totalCreditLoss: res.totalCreditLoss,
      contagionRounds: res.contagionRounds,
      iterations: res.iterations,
      converged: res.converged,
      // Contagion intensity (APPLICATION-LEVEL): SR as a share of all obligations.
      contagionIntensity: (function () {
        var t = net.pbar.reduce(function (a, b) { return a + b; }, 0);
        return t > 0 ? res.systemicRisk / t : 0;
      })()
    };
  }

  global.ABGTRisk = { marginalImpact: marginalImpact, bankTable: bankTable, summary: summary };
})(window);
