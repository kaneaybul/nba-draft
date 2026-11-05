# Aging and development attribution

`age-separated-attribution-v5` splits the previous Player Development & Aging
category into Aging and Player Development. Prices and portfolio totals do not
change. Draft Value Added / Destroyed is now called Draftee Development.

The age-only counterfactual uses the exact exported `target_delta_total` model
used in the asset engine: intercept, age distance from 27, its square, and NBA
experience. The recent-performance `delta_total` term is excluded. The curve is
integrated over elapsed calendar years (days / 365.2425), advancing both age and
experience, and retains the scorer's total-impact bounds of -8 to 12.

For each opening annual production rate, convert that expected rating change
to dollars using its original forecast minutes, availability, scale budget,
league denominator and reporting cap. Hold those inputs, the annual exposure
weights and contracts fixed. Apply the existing best-two-season-equivalents
production selector to the original and aged paths. Their difference is Aging.
The opening path's uncertainty premium is held fixed. Financial continuation
choices remain in Contract Management.

Player Development is the remaining production change after subtracting Aging.
It includes observed impact, role and availability revisions and other remaining
production changes; it is not a causal estimate of coaching quality. The prior
production-window component also remains in this residual rather than becoming
a new waterfall category.

Draftee Development preserves the original padded value-versus-expectation
comparison through year four. Aging is not subtracted from that category. Once
the player leaves that window, subsequent production changes split into Aging
and Player Development. Transfers follow the existing monthly attribution
convention: opening ownership receives the interval's clock/aging change before
the source-priced transfer. Contracts and trade prices remain unchanged.

`aging_basis` records each annual dollar sensitivity and the dated age source.
Where no prior age is observed, the existing scorer's explicit age-22 prior is
recorded. Missing aging metadata for active ordinary production is an error,
never an implicit zero. The exporter adds the basis on every daily update.
`release_aging.py` attaches it to existing history only after reproducing the
original prices, then validates every contiguous date range for all 30 teams.
