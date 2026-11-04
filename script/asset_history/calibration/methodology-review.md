# Career-path methodology review (v7)

The earlier November 1–2 discussion agreed to price linked careers before
averaging, retain daily rolling four-season player prices, and assess draft
outcomes against a fixed, contract-neutral year-four expectation. The later
explicit instruction requires pick production to use that year-four valuation.
The recovered material consists of indexed chat excerpts and summaries, checked
against the original method notes; a full verbatim transcript was unavailable.

| Requirement | Audit finding | v7 implementation |
| --- | --- | --- |
| Price careers before averaging | The own year-four estimate priced one projected mean path | Simulate revisions to the future assessed appraisal, price every linked path, then average |
| Retain the mature-player policy | The endpoint must be the quote actually assessable at year four; later realized production would be a different target | Completed labels use the existing contract-neutral forward appraisal; development uncertainty converges to that appraisal without an extra mature-player premium |
| Daily player stock stays rolling | v6 publication replaced young-player production with the endpoint appraisal | Retain the rolling path price, annual components and distribution; export the endpoint appraisal separately |
| Fix the original expectation | Learning cases and daily priors used updating training cutoffs | Use only labels completed before the draft year for the original baseline in training and supported player updates |
| Separate financial effects | Pick-to-player conversion put production-basis differences in contracts | Split endpoint changes, rolling/endpoint production basis and financial terms |
| Draft outcomes enter once | Daily stock substitution changed the agreed price definition | Use P = E + (P−E): draft records changes in E; the named basis records changes in P−E |
| Preserve own trajectory and upside | Flooring a weak mean before simulating erased recovery paths | Retain signed own forecasts and linked revision vectors; apply the production floor while valuing each path |
| Retain valid uncertainty | Endpoint publication discarded the rolling-price quantiles | Keep rolling quantiles attached to the rolling price; draft appraisal quantiles describe a separate distribution |
| Complete dated history | The portable seed omitted the October 31, 2026 source panel | Restore its original captured inputs from commit d4c35c1, with digest and observation-date checks |
| Avoid future labels | Uncertainty concerns what can be assessed at the endpoint | Use only forecast-revision labels completed by each information date, excluding the target player |

A completed year-four production label is twice the best two forward annual
production forecasts, assessed using information available after season four.
Actual production in years five through eight is not a label. No additional
uncertainty premium is attached after the endpoint becomes known, preserving
the existing mature-player policy.

Before the endpoint, entire forecast-revision vectors describe plausible future
appraisals. Each vector comes from the difference between an earlier four-year
forward forecast and the appraisal assessable one, two or three years later.
Those labels finish at the later appraisal date, never four years afterward.
Neighbor selection uses only the earlier player's features. The player's own
annual forecast means remain unchanged; comparables supply uncertainty rather
than replace the trajectory. Each possible appraisal is priced before averaging.
Adjacent remaining development horizons are blended using fractional season
exposures, converging continuously to the known mature quote as the window ends.

The pick curve averages historical completed year-four appraisals across whole
careers and retains the existing log-slot regularization. Linked first-four
service supplies its separate rookie financial component. Negative career
payoffs retain expected rookie costs; the existing ex-ante zero floor is applied
after expected career payoffs are combined. It does not create a free option to
avoid costs after learning which player disappointed.

NBA reliability is refitted against the same assessed endpoint target. Original
draft expectations use only labels completed before that draft. Rookie-season
NBA weight remains zero, as required by the earlier exclusion of a new
first-season learning policy. Later weights use observed NBA minutes. Completed
endpoints freeze. No veteran uplift, extra pick multiplier, forced break-even
adjustment or cap assets are introduced.

Daily player prices retain the rolling four-season-equivalent window, including
partial first/fifth seasons. For every priced career, production is twice its
best two season-equivalents; the financial adjustment is
`0.8 × Σ exposure × (production − salary)`. Existing signed liabilities, release
guarantees, expected market salaries and continuation decisions are retained.
Prior blending and uncertainty in daily quotes apply only to the remaining
original development window; later veteran projections retain their policy.

The draft holding's endpoint changes telescope to its endpoint estimate less
the original expectation. Daily rolling stock differs from that appraisal:
its named basis is P−E. The waterfall labels this Rolling Window / Valuation
Basis and derives its changes directly from those two valuations. Pure window
movement does not become draft underperformance. Contracts remain financial;
trades transfer the actual rolling stock and development credit stops at transfer.
All 30 teams use the same categories, reconciliation and league rankings.

The release preserves v5/v6 and rebuilds supported 2022+ draft cohorts on their
saved dated inputs. Earlier unsupported marks are preserved and are not labeled
as endpoint draft gains. The recovered October 31 panel covers 562 players and
all 30 teams, with evidence through October 30 matching the archived snapshot.
Legacy Player Impact production columns remain separate; Asset Value, Trade
Machine and Asset History share v7. Historical forecasts are reconstructions
under the model specification, not archived transaction-price observations.

Method-only rebuilds checkpoint canonical annual forecasts separately from path
calibration. Reuse requires matching dated runtime inputs, producer code, injury
and contract sources, observation date, and every saved output digest. Calibration
and attribution rerun; ordinary incremental daily refreshes do not use this cache.
Published closed histories require a new method version for corrections.


Documented endpoint input exclusions remain unavailable instead of receiving a
fabricated zero or a guessed rating. The release report lists every affected
player/date and checks the exclusion against the training-data audit. Other
missing or failed appraisals still fail validation.
