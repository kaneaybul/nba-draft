# Career-path methodology review (v7)

The earlier November 1–2 discussion, recovered through prior-conversation
retrieval, agreed to price linked multi-year careers before averaging, keep
daily player values on the rolling four-season window, and use a fixed,
contract-neutral year-four draft appraisal. The later explicit instruction
requires pick production to use that year-four valuation. The retrieved
material is indexed excerpts and summaries, not an exported full transcript.

| Requirement | Discrepancy found in v6 | v7 implementation |
| --- | --- | --- |
| Price careers, then average | Endpoint labels and own estimates priced one mean forecast | Endpoint labels, learning predictions and published draft estimates use linked forecast-error scenarios, each priced first |
| Keep daily player stock rolling | Publication replaced young-player production with endpoint appraisal | Daily price retains rolling path mean, annual components and valid path quantiles; endpoint appraisal is separate |
| Fixed draft expectation | Learning cases used an updating as-of prior; daily prior also changed as cohorts matured | Original baseline uses only labels completed before the draft year in training and supported player updates |
| Same target in picks and learning | Endpoint point forecasts omitted nonlinear uncertainty | Pick model and reliability learn the same per-path year-four production valuation |
| Nonlinear pick option value | Pick zero floor was applied after averaging | Floor each linked endpoint/service outcome, then average; keep the floor effect explicit |
| Separate production from salary | Pick-to-player conversion placed all differences in contracts | Split endpoint change, rolling/endpoint production basis, and financial terms |
| Draft outcome without double counting | Daily stock substitution changed the agreed asset definition | Use the exact identity P = E + (P−E); draft records ΔE, the named basis records Δ(P−E), and contracts record financial changes |
| Preserve own trajectory | Endpoint point estimate did not retain path upside | Residual scenarios retain the player's own signed annual production means; comparisons calibrate uncertainty rather than replace talent |
| Preserve upside below replacement | Flooring the mean before simulating erases comeback paths | Retain signed means; apply the nonnegative production floor only while pricing each simulated path |
| No future labels | Longer endpoint horizons need more history | Only completed residual prefixes enter each origin; unavailable tail errors carry the last linked error and are explicitly audited |

For every career path, production is twice the best two season-equivalents;
financial adjustment is 0.8 times exposed production less salary. Daily window
exposures sum to four, including partial first/fifth seasons. Signed liabilities,
release guarantees, expected unsigned-market salaries and continuation choices
retain the existing policy. Historical pick rights still use the same joint
lottery/protection/swap/forfeiture outcome engine, priced before averaging.

Endpoint production is assessed using information after season four, forecasting
the following four years. It is not realized years five through eight. Each
historical endpoint label uses completed error paths known at that origin.
Early origins lack full error histories: the available linked prefix is extended
by carrying its last error, with observed/requested horizons recorded. No new
independent annual sampling or hidden future outcomes are introduced.

The same endpoint label trains the pick curve and evidence weight. Rookie-season
NBA weight remains zero because a first-season learning policy was excluded in
the prior decision. Subsequent weights use observed NBA minutes and the fitted
reliability scale. Baselines are fixed at draft time; completed endpoints freeze.
No veteran uplift, pick multiplier, aggregate recentering or cap assets is added.

A draft holding's endpoint changes telescope to its endpoint estimate less the
fixed original expectation. Rolling daily stock differs from that appraisal:
its named basis is P−E. Basis changes can be material and are shown explicitly;
they are computed from the two production valuations, never used as a balancing
residual. Pure window movement affects the basis, not draft performance.
Contracts and contract-induced service choices remain financial. Trades transfer
the actual rolling stock; development credit stops at ownership transfer.

This release refits and replays all supported 2022+ cohorts on preserved dated
inputs, all 30 teams and all observation dates. Earlier unsupported player marks
remain archived values and are not labeled as endpoint draft gains. Older v5/v6
histories remain preserved. Player Impact's legacy production columns are retained;
Asset Value, Trade Machine and Asset History share v7. Calibration signatures cover
all model source and training inputs, and only validated staged state is published.
