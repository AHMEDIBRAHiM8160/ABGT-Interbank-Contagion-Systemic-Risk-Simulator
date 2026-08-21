/* =============================================================================
 * contagionEngine.js — orchestrates model runs + reconstructs contagion rounds
 * ========================================================================== */
(function (global) {
  "use strict";

  /**
   * Reconstruct the default cascade round-by-round from the Picard iterates of
   * the clearing map. Iterate k is the payment vector after k rounds of
   * "fictitious default" propagation, so the round at which bank i first fails
   * p_i^{(k)} < p̄_i is its contagion stage.
   *   stage 0 = fundamental / directly shocked default
   *   stage k = contagious default triggered by counterparty shortfalls
   */
  function cascadeStages(pbar, history, tol) {
    tol = tol == null ? 1e-8 : tol;
    var n = pbar.length;
    var stage = new Array(n).fill(-1); // -1 = never defaults
    for (var k = 0; k < history.length; k++) {
      for (var i = 0; i < n; i++) {
        if (stage[i] === -1 && pbar[i] - history[k][i] > tol) stage[i] = k;
      }
    }
    return stage;
  }

  function roundSeries(pbar, history) {
    return history.map(function (p, k) {
      var sr = 0, d = 0;
      for (var i = 0; i < pbar.length; i++) {
        var s = Math.max(0, pbar[i] - p[i]);
        sr += s;
        if (s > 1e-8) d++;
      }
      return { round: k, SR: sr, defaults: d, p: p.slice() };
    });
  }

  /** Run one named model against a (possibly shocked) network. */
  function run(modelKey, net, params) {
    var res;
    if (modelKey === "EN") res = ABGTModels.eisenbergNoe(net);
    else if (modelKey === "RV") res = ABGTModels.rogersVeraart(net, params);
    else if (modelKey === "KV") res = ABGTModels.kusnetsovVeraart(net, params);
    else throw new Error("Unknown model: " + modelKey);

    res.key = modelKey;
    res.stages = cascadeStages(net.pbar, res.history);
    res.series = roundSeries(net.pbar, res.history);
    res.contagionRounds = res.series.filter(function (r) { return r.defaults > 0; }).length;

    // Default sequence, ordered by the round in which the default appeared.
    res.defaultSequence = net.banks
      .map(function (b, i) { return { bank: b, idx: i, stage: res.stages[i] }; })
      .filter(function (o) { return o.stage >= 0; })
      .sort(function (a, b) { return a.stage - b.stage; });

    // Directly shocked banks are marked as the initial condition of the run.
    res.shockedIdx = net.shockedIdx || [];
    return res;
  }

  function runAll(net, params) {
    return { EN: run("EN", net, params), RV: run("RV", net, params), KV: run("KV", net, params) };
  }

  global.ABGTEngine = { run: run, runAll: runAll, cascadeStages: cascadeStages };
})(window);
