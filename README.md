# ABGT Interbank Contagion & Systemic Risk Simulator

**Powered by ABGT Solutions**

A frontend-only (HTML + CSS + JavaScript) research instrument that simulates interbank
contagion and measures systemic risk using the clearing models formulated in the
undergraduate research project:

> **Mathematical Modelling and Risk Management in Financial Networks**
> Ahmed Ibrahim · U1/21/MTH/1420 · B.Sc. (Hons.) Mathematics
> Department of Mathematics, Umaru Musa Yar'adua University, Katsina State, Nigeria
> Supervisor: Dr. Babangida Bature · January 2026

---

## 1. What the application does

You supply an interbank financial-network dataset (a liability matrix plus external
assets). The application validates it, lets you apply an initial shock, solves the
clearing fixed point under three models, and reports which institutions default, in
what order, how large the losses are, and how systemically important each bank is.

There is **no liquidity-buffer mechanism**. The state variables are exactly those of
the research: the liability matrix `L`, the external-asset vector `e`, the payment
vector `p`, and the liquidation rate `λ`.

---

## 2. Research background

- **Aim** - develop and analyse a purely mathematical framework, based on Eisenberg–Noe,
  Rogers–Veraart and Kusnetsov–Veraart, for examining contagion dynamics and systemic
  risk in financial networks.
- **Problem** - traditional models treat institutions in isolation and miss risk
  propagation through network interdependencies.
- **Method** - graph theory, matrix analysis and fixed-point theory over a single
  settlement period with deterministic parameters.

Research assumptions implemented (PDF Sec. 3.3.1): fixed and known obligations; no
strategic default; single settlement period; deterministic parameters; limited
liability; proportional repayment.

---

## 3. Mathematical models

All equations are taken verbatim from Chapter Three of the research.

| Concept | Equation | Source |
|---|---|---|
| Total liabilities | `p̄ᵢ = Σⱼ Lᵢⱼ` | Sec. 3.2 |
| Relative liabilities | `πᵢⱼ = Lᵢⱼ / p̄ᵢ` (0 if `p̄ᵢ = 0`) | Sec. 3.2 |
| **Eisenberg–Noe** | `p = min{ p̄ , e + Πᵀp }` | Sec. 3.3 |
| **Rogers–Veraart** | `p = min{ p̄ , αe + βΠᵀp }`, `α, β ∈ (0,1]` | Sec. 3.4 |
| **Kusnetsov–Veraart** | `e′ᵢ = eᵢ − λᵢ(p̄ᵢ − pᵢ)⁺` | Sec. 3.5 |
| Coupled dynamics | `p⁽ᵏ⁺¹⁾ = min(p̄, αe⁽ᵏ⁾ + Πᵀp⁽ᵏ⁾)`, `e⁽ᵏ⁺¹⁾ = e⁽ᵏ⁾ − λ(p̄ − p⁽ᵏ⁾)⁺` | Sec. 3.6 |
| Systemic risk index | `SR = Σᵢ (p̄ᵢ − pᵢ)⁺` | Sec. 3.7 |
| Default condition | bank *i* defaults ⟺ `pᵢ < p̄ᵢ` | Sec. 3.3 / 3.7 |

**Solution method.** The clearing map `Φ(p) = min{p̄, αe + βΠᵀp}` is monotone and maps
`[0, p̄]` into itself. Starting from `p⁽⁰⁾ = p̄`, the Picard sequence `p⁽ᵏ⁺¹⁾ = Φ(p⁽ᵏ⁾)`
is non-increasing and bounded below, so it converges to the greatest fixed point - the
economically relevant clearing vector. Convergence is enforced by an epsilon tolerance
(1e-10) and a hard iteration cap (500), so the algorithm always terminates.

### Implementation assumptions (clearly separated from the research)

The research does not define a shock operator, so the tool offers two, both acting only
on the external-asset vector `e`:

- `eᵢ → (1 − s)·eᵢ` - proportional external-asset loss
- `eᵢ → 0` - total wipe-out

Other implementation choices: external assets are floored at 0; `β` inside the coupled
KV system is user-selectable because Sec. 3.6 omits it while Sec. 3.4 includes it;
external liabilities, when supplied, are reported but excluded from the fixed point
because the research equations do not contain them.

### Documented inconsistency in the source research

With the Chapter 4 data (`e = (50, 40, 30)`, `α = 0.7`) the literal Rogers–Veraart
equation gives `p* = (30, 15, 20)` - no default - because `αe₁ = 35 > p̄₁ = 30`. The
reported `p* = (25.4, 13.2, 17.6)` cannot be reproduced from that equation on an
unshocked asset vector. The engine computes the equation as written and flags the
discrepancy in **About Research → points where the research text is unclear**; it does
not hard-code the reported figures. The Chapter 4 fire-sale figures
`e′ = (49.1, 39.6, 29.5)` *do* follow exactly from the reported `p*` and are a passing
test in the verification suite.

---

## 4. How to run

The application is entirely static.

```
# simplest
open index.html            # macOS      (or double-click the file)
start index.html           # Windows

# recommended (avoids browser file:// restrictions on some engines)
python3 -m http.server 8000
# then visit http://localhost:8000
```

An internet connection is needed on first load for the CDN libraries
(Chart.js, PapaParse, SheetJS, pdf.js, jsPDF). The mathematics itself runs offline.

---

## 5. Required dataset format

**Wide matrix layout (recommended).** First column = bank name, then one column per
bank containing `Lᵢⱼ` (row *i* owes column *j*), plus `ExternalAssets`. Optional:
`ExternalLiabilities`, `Lambda`.

```csv
Bank,Bank A,Bank B,Bank C,ExternalAssets
Bank A,0,10,20,50
Bank B,5,0,10,40
Bank C,15,5,0,30
```

**Edge-list layout.** Columns `Debtor, Creditor, Amount` (+ optional `ExternalAssets`).

Accepted files: `.csv`, `.xlsx`, `.xls`, `.pdf`. PDF tables are extracted heuristically
and are **always** shown for confirmation and manual correction before simulation.

Provided samples in `sample-data/`:

- `research-example-3-banks.csv` - the Chapter 4 example
- `interbank-8-banks.csv` - a larger stylised network
- `edge-list-example.csv` - the edge-list layout

---

## 6. How the simulation works

1. **dataLoader** parses CSV / Excel / PDF into `{banks, L, e, extLiab, lambda}`.
2. **dataValidator** reports missing values, negative liabilities, duplicate banks,
   non-square matrices, self-liabilities, and missing parameters. Data is never
   silently modified.
3. **networkBuilder** computes `p̄` and `Π` and applies the shock to `e`.
4. **models** solves the clearing fixed point for EN / RV / KV.
5. **contagionEngine** reconstructs the default cascade: the iteration `k` at which
   `pᵢ⁽ᵏ⁾ < p̄ᵢ` first holds is bank *i*'s contagion stage (stage 0 = fundamental
   default, stage ≥ 1 = contagious default).
6. **riskAnalyzer** produces the bank table, the system summary and the marginal
   systemic impact `ΔSR` (a knock-out experiment built on the research SR index).
7. **chartManager / networkVisualizer** render results; **exportManager** exports them.

---

## 7. How to interpret results

- **pᵢ** — what bank *i* actually pays at clearing. `pᵢ = p̄ᵢ` means full settlement.
- **Shortfall `(p̄ᵢ − pᵢ)⁺`** - bank *i*'s contribution to the systemic-risk index.
- **SR** — total unpaid obligations across the system; the research distress indicator.
- **Recovery rate `pᵢ / p̄ᵢ`** - the fraction creditors receive (also shown inside the
  network nodes).
- **Contagion stage** - 0 means the bank failed on its own fundamentals; higher stages
  mean it failed because counterparties failed first.
- **Marginal ΔSR** and **Risk score** - *application-level analytical indicators*,
  not equations from the research. The risk score is
  `100 × (0.65 × normalised ΔSR + 0.35 × normalised gross exposure)`.

---

## 8. Exporting

**Export Report** provides CSV, Excel (multi-sheet: Summary, Bank Results, Model
Comparison, Input Network), a multi-page PDF report (configuration, equations applied,
system summary, bank-level table, model comparison, network diagram and every chart),
and Print. The same panel runs the **mathematical verification suite** - 17 checks
including the Chapter 4 numerical example and analytic edge cases.

---

## 9. Project structure

```
index.html
css/styles.css
js/  models.js            core equations (EN, RV, KV) and the fixed-point solver
     networkBuilder.js    network construction, p̄, Π, shock application
     contagionEngine.js   model orchestration, cascade stages, round series
     riskAnalyzer.js      SR, bank table, marginal impact, ranking
     dataLoader.js        CSV / Excel / PDF ingestion
     dataValidator.js     validation rules
     networkVisualizer.js interactive directed-graph SVG renderer
     chartManager.js      Chart.js wrappers + heatmap
     exportManager.js     CSV / Excel / PDF / print export
     tests.js             mathematical verification suite
     app.js               UI controller (no mathematics)
sample-data/
assets/
README.md
```

---
## 10. Tool Overview
### -Contagion View

<img width="1600" height="900" alt="contagion part" src="https://github.com/user-attachments/assets/778f50a0-39f8-4dad-b4a6-bfcb3dad9e31" />

### -Data upload View 

<img width="1600" height="900" alt="Data upload view" src="https://github.com/user-attachments/assets/38679164-21df-43a3-bc8b-5b275eb98da0" />

### -Simulation Setup View 

<img width="1600" height="900" alt="simulation view" src="https://github.com/user-attachments/assets/0c55ac1e-9a81-416c-a0bc-757b0754c04c" />

### -Simulation Output View

<img width="1600" height="900" alt="simulation out put" src="https://github.com/user-attachments/assets/89f4fa82-5914-4e50-a7d4-e506202da7e8" />

### -Simulation Result View

<img width="1599" height="881" alt="result view" src="https://github.com/user-attachments/assets/da35acb5-4b45-4e03-af9e-36ed6ab57d36" />

### -Simulation Comparison View

<img width="1600" height="900" alt="model comparison view" src="https://github.com/user-attachments/assets/e5d32fef-c576-4f6e-9c24-29f15df15d2f" />

### -Risk Analysis View

<img width="1600" height="900" alt="risk analysis view" src="https://github.com/user-attachments/assets/d82f54a7-1568-4a60-8786-1fd4ba613a86" />

### -Network View

<img width="1600" height="900" alt="network" src="https://github.com/user-attachments/assets/5b32dd14-931d-44ea-ae27-0cc59eed879e" />

## 11. Technology

Vanilla HTML5, CSS3 (custom properties, light/dark themes, responsive grid) and
ES5-compatible JavaScript — no build step, no backend, no framework. Browser libraries
loaded from CDN: Chart.js 4, PapaParse 5, SheetJS 0.18, pdf.js 3, jsPDF 2 with
AutoTable. Network visualisation is hand-written SVG.

---

© Ahmed Ibrahim. Built and owned by **ABGT Solutions**.
