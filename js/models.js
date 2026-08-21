/* =============================================================================
 * models.js — Core mathematical engine
 * ABGT Systemic Risk & Interbank Contagion Simulator
 *
 * Every equation implemented here is taken directly from:
 *   "Mathematical Modelling and Risk Management in Financial Networks"
 *   Ahmed Ibrahim (U1/21/MTH/1420), Umaru Musa Yar'adua University, Jan 2026.
 *   Chapter 3 (Sections 3.2 - 3.7) and Chapter 4 (numerical example).
 *
 * Nothing in this file introduces a liquidity-buffer rule. The only state
 * variables are: liability matrix L, external assets e, payment vector p,
 * and (for Kusnetsov-Veraart) the liquidation rate vector lambda.
 * ========================================================================== */

(function (global) {
  "use strict";

  var EPS_DEFAULT = 1e-10;   // convergence tolerance for the fixed-point iteration
  var MAX_ITER_DEFAULT = 500; // hard cap -> guarantees termination, no infinite loops

  /* ---------------------------------------------------------------------------
   * (x)+ = max(x, 0)                                       [PDF Sec. 3.5 / 3.7]
   * ------------------------------------------------------------------------ */
  function pos(x) { return x > 0 ? x : 0; }

  /* ---------------------------------------------------------------------------
   * Total liabilities.
   *
   *   Equation (PDF Sec. 3.2):     p̄_i = SUM_{j=1..n} L_ij
   *
   * Computational form: row sum of the liability matrix.
   * ------------------------------------------------------------------------ */
  function totalLiabilities(L) {
    return L.map(function (row) {
      return row.reduce(function (a, b) { return a + b; }, 0);
    });
  }

  /* ---------------------------------------------------------------------------
   * Relative liability matrix.
   *
   *   Equation (PDF Sec. 3.2):
   *        pi_ij = L_ij / p̄_i   if p̄_i > 0
   *        pi_ij = 0            if p̄_i = 0
   *
   * Each row of Pi sums to 1 for a bank with obligations. This encodes the
   * "proportional repayment" assumption (PDF Sec. 3.3.1, assumption vi).
   * ------------------------------------------------------------------------ */
  function relativeLiabilities(L, pbar) {
    return L.map(function (row, i) {
      return row.map(function (v) { return pbar[i] > 0 ? v / pbar[i] : 0; });
    });
  }

  /* ---------------------------------------------------------------------------
   * Incoming interbank payments to bank i.
   *
   *   Equation (PDF Sec. 4.3):    SUM_{j=1..n} pi_ji * p_j
   *
   * i.e. the i-th component of Pi^T p — what bank i actually receives from the
   * counterparties that owe it money, given that each payer j pays p_j in total
   * and distributes it proportionally according to row j of Pi.
   * ------------------------------------------------------------------------ */
  function incoming(PI, p, i) {
    var s = 0;
    for (var j = 0; j < p.length; j++) s += PI[j][i] * p[j];
    return s;
  }

  function transposeTimes(PI, p) {
    return p.map(function (_, i) { return incoming(PI, p, i); });
  }

  /* ---------------------------------------------------------------------------
   * GENERIC CLEARING FIXED POINT
   *
   *   p = min{ p̄ , alpha*e + beta * Pi^T p }        (component-wise minimum)
   *
   * alpha = beta = 1  ->  Eisenberg-Noe            (PDF Sec. 3.3)
   * alpha, beta in (0,1] ->  Rogers-Veraart        (PDF Sec. 3.4)
   *
   * Solution method (the "fictitious default algorithm" in Picard form):
   * The map Phi(p) = min{p̄, alpha*e + beta*Pi^T p} is monotone increasing and
   * maps [0, p̄] into itself. Starting from the greatest element p^(0) = p̄, the
   * sequence p^(k+1) = Phi(p^(k)) is non-increasing and bounded below by 0, so
   * by Tarski/monotone convergence it converges to the GREATEST fixed point —
   * which is the economically relevant clearing vector of Eisenberg & Noe.
   *
   * Termination is guaranteed twice over: by the epsilon tolerance and by the
   * maxIter hard cap.
   * ------------------------------------------------------------------------ */
  function solveClearing(pbar, PI, e, alpha, beta, opts) {
    opts = opts || {};
    var eps = opts.eps || EPS_DEFAULT;
    var maxIter = opts.maxIter || MAX_ITER_DEFAULT;
    var n = pbar.length;

    var p = pbar.slice();          // p^(0) = p̄  (start at the greatest element)
    var history = [p.slice()];     // iterate-by-iterate record = contagion rounds
    var iterations = 0;
    var converged = false;

    for (var k = 0; k < maxIter; k++) {
      var next = new Array(n);
      var maxDiff = 0;
      for (var i = 0; i < n; i++) {
        // alpha*e_i + beta * SUM_j pi_ji p_j   -> resources available to bank i
        var resources = alpha * e[i] + beta * incoming(PI, p, i);
        if (resources < 0) resources = 0;           // limited liability: never negative
        next[i] = Math.min(pbar[i], resources);     // pay the lesser of what is owed / affordable
        var d = Math.abs(next[i] - p[i]);
        if (d > maxDiff) maxDiff = d;
      }
      p = next;
      history.push(p.slice());
      iterations = k + 1;
      if (maxDiff < eps) { converged = true; break; }
    }

    return { p: p, history: history, iterations: iterations, converged: converged };
  }

  /* ---------------------------------------------------------------------------
   * Default / solvency condition.
   *
   * A bank defaults when it cannot discharge its obligations in full:
   *        default_i  <=>  p_i < p̄_i        (strictly, up to tolerance)
   * Shortfall of bank i:   (p̄_i - p_i)+     [PDF Sec. 3.7]
   * ------------------------------------------------------------------------ */
  function defaultFlags(pbar, p, tol) {
    tol = tol == null ? 1e-8 : tol;
    return pbar.map(function (pb, i) { return pb - p[i] > tol; });
  }

  function shortfalls(pbar, p) {
    return pbar.map(function (pb, i) { return pos(pb - p[i]); });
  }

  /* ---------------------------------------------------------------------------
   * Aggregate systemic risk index.
   *
   *   Equation (PDF Sec. 3.7):    SR = SUM_{i=1..n} (p̄_i - p_i)+
   *
   * Total unpaid obligations in the system.
   * ------------------------------------------------------------------------ */
  function systemicRisk(pbar, p) {
    return shortfalls(pbar, p).reduce(function (a, b) { return a + b; }, 0);
  }

  /* =========================================================================
   * MODEL 1 — EISENBERG & NOE (2001)          [PDF Sec. 3.3]
   *
   *      p = min{ p̄ , e + Pi^T p }
   *
   * Special case of the generic clearing map with alpha = beta = 1.
   * ====================================================================== */
  function eisenbergNoe(net, opts) {
    var r = solveClearing(net.pbar, net.PI, net.e, 1, 1, opts);
    return finalize("Eisenberg-Noe", net, r, net.e, { alpha: 1, beta: 1 });
  }

  /* =========================================================================
   * MODEL 2 — ROGERS & VERAART (2013) liquidity extension   [PDF Sec. 3.4]
   *
   *      p = min{ p̄ , alpha*e + beta * Pi^T p },   alpha, beta in (0,1]
   *
   * alpha = fraction of EXTERNAL assets still accessible in distress.
   * beta  = fraction of INTERBANK receipts still recoverable in distress.
   * alpha = beta = 1 reduces exactly to Eisenberg-Noe (stated in the PDF).
   * ====================================================================== */
  function rogersVeraart(net, params, opts) {
    var alpha = params.alpha, beta = params.beta;
    var r = solveClearing(net.pbar, net.PI, net.e, alpha, beta, opts);
    return finalize("Rogers-Veraart", net, r, net.e, { alpha: alpha, beta: beta });
  }

  /* =========================================================================
   * MODEL 3 — KUSNETSOV & VERAART (2019) fire-sale contagion
   *                                             [PDF Sec. 3.5 and Sec. 3.6]
   *
   * Fire-sale asset adjustment (Sec. 3.5):
   *      e'_i = e_i - lambda_i * (p̄_i - p_i)+
   *
   * Coupled dynamic system (Sec. 3.6):
   *      p^(k+1) = min( p̄ , alpha*e^(k) + Pi^T p^(k) )
   *      e^(k+1) = e^(k) - lambda * (p̄ - p^(k))+
   *
   * This is the DYNAMIC model: payment shortfalls in round k erode external
   * assets in round k+1, which lowers payments further — the fire-sale
   * feedback loop. Each k is a genuine time step / contagion round.
   *
   * Implementation notes (labelled honestly as implementation choices):
   *  - The PDF writes Pi^T p without beta in Sec. 3.6 but keeps alpha. The
   *    engine exposes beta as an optional multiplier defaulting to the value
   *    the user set for RV, so that KV nests RV; set beta = 1 to follow
   *    Sec. 3.6 literally. Both are shown in the UI.
   *  - Assets are floored at 0 (an institution cannot hold negative external
   *    assets). The PDF does not state this; it is an implementation
   *    assumption required for numerical well-posedness.
   * ====================================================================== */
  function kusnetsovVeraart(net, params, opts) {
    opts = opts || {};
    var eps = opts.eps || EPS_DEFAULT;
    var maxRounds = opts.maxRounds || 100;
    var alpha = params.alpha;
    var beta = params.betaKV == null ? params.beta : params.betaKV;
    var lambda = params.lambda; // vector, lambda_i >= 0

    var pbar = net.pbar, PI = net.PI, n = pbar.length;
    var e = net.e.slice();
    var p = pbar.slice();

    var rounds = [];   // per-time-step record: {k, e, p, shortfall, defaults, SR}
    var converged = false;
    var k = 0;

    for (k = 0; k < maxRounds; k++) {
      // --- payment update:  p^(k+1) = min(p̄, alpha*e^(k) + beta*Pi^T p^(k)) ---
      var next = new Array(n);
      for (var i = 0; i < n; i++) {
        var res = alpha * e[i] + beta * incoming(PI, p, i);
        if (res < 0) res = 0;
        next[i] = Math.min(pbar[i], res);
      }

      // --- fire-sale asset update: e^(k+1) = e^(k) - lambda*(p̄ - p^(k+1))+ ---
      var nextE = new Array(n);
      var sf = new Array(n);
      for (var m = 0; m < n; m++) {
        sf[m] = pos(pbar[m] - next[m]);
        nextE[m] = Math.max(0, net.e[m] - lambda[m] * sf[m]); // measured from ORIGINAL e
      }

      var diff = 0;
      for (var q = 0; q < n; q++) {
        diff = Math.max(diff, Math.abs(next[q] - p[q]), Math.abs(nextE[q] - e[q]));
      }

      p = next; e = nextE;
      rounds.push({
        k: k + 1,
        e: e.slice(),
        p: p.slice(),
        shortfall: sf.slice(),
        defaults: defaultFlags(pbar, p),
        SR: sf.reduce(function (a, b) { return a + b; }, 0)
      });

      if (diff < eps) { converged = true; break; }
    }

    var res2 = finalize("Kusnetsov-Veraart", net, { p: p, history: rounds.map(function (r) { return r.p; }), iterations: rounds.length, converged: converged }, e, { alpha: alpha, beta: beta, lambda: lambda });
    res2.rounds = rounds;
    res2.adjustedAssets = e.slice();   // e'_i  (PDF Sec. 4.5.1)
    return res2;
  }

  /* ---------------------------------------------------------------------------
   * Assemble the per-bank and system-level result object shared by all models.
   * ------------------------------------------------------------------------ */
  function finalize(name, net, r, effectiveAssets, params) {
    var pbar = net.pbar, p = r.p, n = pbar.length;
    var sf = shortfalls(pbar, p);
    var def = defaultFlags(pbar, p);

    // Amount actually RECEIVED by bank i from the interbank system: (Pi^T p)_i
    var received = transposeTimes(net.PI, p);
    // Amount bank i was CONTRACTUALLY owed: column sum of L
    var owedToMe = [];
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var j = 0; j < n; j++) s += net.L[j][i];
      owedToMe.push(s);
    }
    // Credit loss suffered by bank i = contractual receivable - actual receipts
    var creditLoss = owedToMe.map(function (v, idx) { return pos(v - received[idx]); });
    // Equity / net worth at clearing:  e_i + received_i - p_i
    var equity = p.map(function (pi, idx) { return effectiveAssets[idx] + received[idx] - pi; });

    return {
      model: name,
      params: params,
      p: p,
      pbar: pbar.slice(),
      shortfall: sf,
      defaults: def,
      defaultCount: def.filter(Boolean).length,
      received: received,
      owedToMe: owedToMe,
      creditLoss: creditLoss,
      equity: equity,
      effectiveAssets: effectiveAssets.slice(),
      systemicRisk: sf.reduce(function (a, b) { return a + b; }, 0), // SR = SUM (p̄_i - p_i)+
      totalCreditLoss: creditLoss.reduce(function (a, b) { return a + b; }, 0),
      iterations: r.iterations,
      converged: r.converged,
      history: r.history
    };
  }

  global.ABGTModels = {
    pos: pos,
    totalLiabilities: totalLiabilities,
    relativeLiabilities: relativeLiabilities,
    transposeTimes: transposeTimes,
    solveClearing: solveClearing,
    defaultFlags: defaultFlags,
    shortfalls: shortfalls,
    systemicRisk: systemicRisk,
    eisenbergNoe: eisenbergNoe,
    rogersVeraart: rogersVeraart,
    kusnetsovVeraart: kusnetsovVeraart
  };
})(typeof window !== "undefined" ? window : globalThis);
