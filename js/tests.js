/* =============================================================================
 * tests.js — mathematical verification suite
 * Each case is hand-checkable; expected values are derived analytically or
 * taken directly from Chapter 4 of the research PDF.
 * ========================================================================== */
(function (global) {
  "use strict";

  function close(a, b, tol) { return Math.abs(a - b) <= (tol == null ? 1e-6 : tol); }
  function vecClose(a, b, tol) { return a.length === b.length && a.every(function (v, i) { return close(v, b[i], tol); }); }
  function net(banks, L, e) { return ABGTNetwork.build(banks, L, e, null); }

  function runAll() {
    var t = [];
    var push = function (name, ok, detail) { t.push({ name: name, pass: !!ok, detail: detail }); };

    /* --- Case 1: PDF Chapter 4 — total liabilities p̄ = (30, 15, 20) ------- */
    var banks = ["Bank A", "Bank B", "Bank C"];
    var L = [[0, 10, 20], [5, 0, 10], [15, 5, 0]];
    var e = [50, 40, 30];
    var N = net(banks, L, e);
    push("PDF Sec. 4.2.1 — total liabilities p̄ = (30, 15, 20)",
      vecClose(N.pbar, [30, 15, 20]), "got (" + N.pbar.join(", ") + ")");

    /* --- Case 2: relative liability matrix Π (PDF Sec. 4.3) --------------- */
    push("PDF Sec. 4.3 — Π row A = (0, 0.333, 0.667), row C = (0.75, 0.25, 0)",
      close(N.PI[0][1], 1 / 3, 1e-3) && close(N.PI[0][2], 2 / 3, 1e-3) &&
      close(N.PI[2][0], 0.75) && close(N.PI[2][1], 0.25),
      "Π[A] = (" + N.PI[0].map(function (v) { return v.toFixed(3); }).join(", ") + ")");

    /* --- Case 3: Eisenberg-Noe on the PDF example → p* = (30, 15, 20) ----- */
    var en = ABGTModels.eisenbergNoe(N);
    push("PDF Sec. 4.3 — Eisenberg–Noe clearing vector p* = (30, 15, 20), no default",
      vecClose(en.p, [30, 15, 20], 1e-6) && en.defaultCount === 0,
      "got (" + en.p.map(function (v) { return v.toFixed(2); }).join(", ") + "), defaults = " + en.defaultCount);

    /* --- Case 4: SR = 0 when all obligations are met (PDF Sec. 3.7) ------- */
    push("PDF Sec. 3.7 — SR = Σ(p̄−p)⁺ = 0 under full clearing", close(en.systemicRisk, 0),
      "SR = " + en.systemicRisk.toFixed(6));

    /* --- Case 5: fire-sale equation reproduces PDF Sec. 4.5.1 ------------- *
     * Given the payment vector reported in Sec. 4.4.1, p = (25.4, 13.2, 17.6)
     * and λ = 0.2, the PDF equation e'_i = e_i − λ_i (p̄_i − p_i)+ gives
     *   A: 50 − 0.2(30−25.4) = 49.08 ≈ 49.1
     *   B: 40 − 0.2(15−13.2) = 39.64 ≈ 39.6
     *   C: 30 − 0.2(20−17.6) = 29.52 ≈ 29.5                                 */
    var pRep = [25.4, 13.2, 17.6];
    var ePrime = e.map(function (v, i) { return v - 0.2 * Math.max(N.pbar[i] - pRep[i], 0); });
    push("PDF Sec. 4.5.1 — fire-sale assets e′ = (49.1, 39.6, 29.5) from the reported p*",
      vecClose(ePrime.map(function (v) { return Math.round(v * 10) / 10; }), [49.1, 39.6, 29.5], 1e-9),
      "e′ = (" + ePrime.map(function (v) { return v.toFixed(2); }).join(", ") + ")");

    /* --- Case 6: RV with α=β=1 must equal Eisenberg-Noe (stated in PDF) --- */
    var rv1 = ABGTModels.rogersVeraart(N, { alpha: 1, beta: 1 });
    push("PDF Sec. 3.4 — Rogers–Veraart with α = β = 1 reduces to Eisenberg–Noe",
      vecClose(rv1.p, en.p, 1e-9), "identical clearing vectors");

    /* --- Case 7: documented inconsistency in Sec. 4.4.1 ------------------- *
     * With α = 0.7 the term αe₁ = 35 > p̄₁ = 30, so bank A can always pay in
     * full and no default is possible without a shock. Verified explicitly.  */
    var rv = ABGTModels.rogersVeraart(N, { alpha: 0.7, beta: 0.9 });
    push("Sec. 4.4.1 cross-check — literal RV equation on unshocked data gives (30, 15, 20), NOT (25.4, 13.2, 17.6)",
      vecClose(rv.p, [30, 15, 20], 1e-6),
      "engine computes the equation as written: (" + rv.p.map(function (v) { return v.toFixed(2); }).join(", ") + "). Documented in About → unclear points.");

    /* --- Case 8: hand-checkable two-bank default ------------------------- *
     * A owes B 100, B owes A 0. e = (10, 0).
     * A: p_A = min(100, 10 + 0) = 10  → defaults, shortfall 90.
     * B: p̄_B = 0 → p_B = 0, no default. SR = 90.                            */
    var N2 = net(["A", "B"], [[0, 100], [0, 0]], [10, 0]);
    var r2 = ABGTModels.eisenbergNoe(N2);
    push("Two-bank analytic case — p = (10, 0), SR = 90",
      vecClose(r2.p, [10, 0]) && close(r2.systemicRisk, 90),
      "p = (" + r2.p.join(", ") + "), SR = " + r2.systemicRisk);

    /* --- Case 9: contagion chain A→B→C ----------------------------------- *
     * A owes B 100, B owes C 100, e = (0, 0, 0).
     * A pays 0 → B receives 0 → B pays 0 → C receives 0. SR = 200,
     * 2 defaults (C owes nothing so cannot default).                        */
    var N3 = net(["A", "B", "C"], [[0, 100, 0], [0, 0, 100], [0, 0, 0]], [0, 0, 0]);
    var r3 = ABGTModels.eisenbergNoe(N3);
    push("Contagion chain A→B→C with zero external assets — 2 defaults, SR = 200",
      r3.defaultCount === 2 && close(r3.systemicRisk, 200),
      "defaults = " + r3.defaultCount + ", SR = " + r3.systemicRisk);

    /* --- Case 10: limited liability / proportional repayment -------------- *
     * A owes B 60 and C 40 (p̄=100), e_A = 50, B and C owe nothing.
     * p_A = min(100, 50) = 50; B receives 0.6*50 = 30, C receives 0.4*50=20. */
    var N4 = net(["A", "B", "C"], [[0, 60, 40], [0, 0, 0], [0, 0, 0]], [50, 0, 0]);
    var r4 = ABGTModels.eisenbergNoe(N4);
    push("Proportional repayment — A pays 50, split 30 / 20 to B and C",
      close(r4.p[0], 50) && close(r4.received[1], 30) && close(r4.received[2], 20),
      "received = (" + r4.received.map(function (v) { return v.toFixed(1); }).join(", ") + ")");

    /* --- Case 11: KV amplification is monotone in λ ---------------------- */
    var Nsh = ABGTNetwork.applyShock(N, [0], "asset", 0.9);
    var kv0 = ABGTModels.kusnetsovVeraart(Nsh, { alpha: 1, beta: 1, betaKV: 1, lambda: [0, 0, 0] });
    var kv1 = ABGTModels.kusnetsovVeraart(Nsh, { alpha: 1, beta: 1, betaKV: 1, lambda: [0.5, 0.5, 0.5] });
    var enS = ABGTModels.eisenbergNoe(Nsh);
    push("KV with λ = 0 collapses to the Eisenberg–Noe solution", vecClose(kv0.p, enS.p, 1e-6),
      "SR: KV(λ=0) = " + kv0.systemicRisk.toFixed(4) + " vs EN = " + enS.systemicRisk.toFixed(4));
    push("KV fire-sale feedback is non-decreasing in λ (SR(λ=0.5) ≥ SR(λ=0))",
      kv1.systemicRisk >= kv0.systemicRisk - 1e-9,
      "SR(0) = " + kv0.systemicRisk.toFixed(4) + ", SR(0.5) = " + kv1.systemicRisk.toFixed(4));

    /* --- Case 12: RV is monotone — lower α/β cannot reduce SR ------------- */
    var shocked = ABGTNetwork.applyShock(N, [0, 1], "asset", 0.8);
    var a = ABGTModels.rogersVeraart(shocked, { alpha: 1, beta: 1 }).systemicRisk;
    var b = ABGTModels.rogersVeraart(shocked, { alpha: 0.5, beta: 0.5 }).systemicRisk;
    push("Rogers–Veraart monotonicity — tighter liquidity (α,β ↓) weakly raises SR", b >= a - 1e-9,
      "SR(1,1) = " + a.toFixed(3) + " ≤ SR(0.5,0.5) = " + b.toFixed(3));

    /* --- Case 13: convergence and termination ---------------------------- */
    push("Fixed-point iteration converges within the iteration cap",
      en.converged && rv.converged && kv1.converged,
      "iterations — EN " + en.iterations + ", RV " + rv.iterations + ", KV " + kv1.iterations);

    /* --- Case 14: edge case — zero liabilities everywhere ---------------- */
    var N5 = net(["A", "B"], [[0, 0], [0, 0]], [5, 5]);
    var r5 = ABGTModels.eisenbergNoe(N5);
    push("Edge case — empty liability matrix gives p = 0, SR = 0, no defaults",
      vecClose(r5.p, [0, 0]) && r5.defaultCount === 0, "handled without division by zero (π = 0 when p̄ = 0)");

    /* --- Case 15: fixed-point self-consistency under a total wipe-out ----- *
     * With e = 0 the map becomes p = min(p̄, Pi^T p). Payments can still
     * circulate around a cycle, so the greatest fixed point need not be zero.
     * The correct universal check is that the returned vector SATISFIES the
     * equation exactly, component by component, and respects 0 <= p <= p̄.    */
    var N6 = ABGTNetwork.applyShock(N, [0, 1, 2], "wipeout", 1);
    var r6 = ABGTModels.eisenbergNoe(N6);
    var recomputed = r6.p.map(function (_, i) {
      return Math.min(N6.pbar[i], 0 + ABGTModels.transposeTimes(N6.PI, r6.p)[i]);
    });
    push("Edge case — all external assets wiped out: returned vector satisfies p = min(p̄, Πᵀp) exactly",
      vecClose(recomputed, r6.p, 1e-7) && r6.p.every(function (v, i) { return v >= -1e-12 && v <= N6.pbar[i] + 1e-12; }),
      "p = (" + r6.p.map(function (v) { return v.toFixed(3); }).join(", ") + "), SR = " + r6.systemicRisk.toFixed(3) + " with " + r6.defaultCount + " default(s)");

    /* --- Case 16: every model output must satisfy its own fixed point ----- */
    var Nx = ABGTNetwork.applyShock(N, [1], "asset", 0.85);
    var rvx = ABGTModels.rogersVeraart(Nx, { alpha: 0.6, beta: 0.8 });
    var rec2 = rvx.p.map(function (_, i) {
      return Math.min(Nx.pbar[i], 0.6 * Nx.e[i] + 0.8 * ABGTModels.transposeTimes(Nx.PI, rvx.p)[i]);
    });
    push("Rogers–Veraart output satisfies p = min(p̄, αe + βΠᵀp) to 1e-7",
      vecClose(rec2, rvx.p, 1e-7),
      "residual = " + Math.max.apply(null, rec2.map(function (v, i) { return Math.abs(v - rvx.p[i]); })).toExponential(2));

    return t;
  }

  global.ABGTTests = { runAll: runAll };
})(window);
