# Endpoint-aligned asset valuation (v5)

The production target for the draft prior and NBA-evidence reliability fit is
contract-neutral production value at July 31 after the fourth draft season:
twice the best two annual production values in the following four seasons.
These are retrospective endpoint forecasts using coefficients refitted at each
historical origin, not observed future seasons or recorded market transactions.

One linked panel contains first-four-year service and the endpoint production
forecast. The existing log-slot regularization is fitted to the new endpoint
payoff and scales the whole linked path, preserving zero-service outcomes,
development shape and within-career correlation. The observed NBA weight is
refitted against this same endpoint target. First-season learning has not been
extrapolated from older players: rookie-season NBA weight remains zero.

The current asset price remains a rolling four-season-equivalent stock quote.
Each production path is priced before averaging. Pick prices use the shared
endpoint-trained prior's linked service path; costs come from the existing
round-specific expected rookie terms. Picks are not assigned the salary-free
endpoint score as their current trade price. All original protections, swaps,
forfeiture policies and joint outcome pricing remain in effect. Historical
inventories are reconstructed in v5; v4 stays available as the previous archive.

Young players blend that prior with the existing player-specific NBA forecast
and linked forecast errors. The adjustment continues to apply only within the
remaining original development window, fading continuously as it is consumed.
Post-window veteran projections, injury handling, signed liabilities, the
0.8 contract coefficient and the best-two-years production formula are retained.
No extra pick multiplier, aggregate recentering or veteran uplift is introduced.

Draft development is exported separately: the endpoint production forecast
minus the original draft-time endpoint expectation. Its original expectation
uses only endpoint labels completed before the draft year and never changes
because later cohorts mature. Own annual production is read before all salary-
dependent continuation/release decisions. Only missing future years are extended
with the player's own career-model trajectory. Salaries and extensions cannot
change this grade. Completed endpoints stop updating.

All asset surfaces receive a common v5 publication. Missing live player quotes
are unavailable rather than silently recomputed with legacy inputs. Ambiguous
legal pick claims are flagged as unpriced for trade evaluation; portfolio marks
continue to use the full joint rights model. Legacy Player Impact production
columns are intentionally retained. Cap space and empty exceptions remain out
of scope. The new MECE waterfall is a separate attribution project, not another
asset pricing formula.

The release workflow rebuilds and validates all 30 histories before publication,
checks method-only player and pick differences on identical current inputs,
and tests the app, trade engine and common exporter. Daily and manual refresh
paths use the same producer and exporter. Calibration caches include source and
model hashes; only validated staged state is promoted. A failed refresh retains
the previous validated observation and never invents a more recent date.
