# Year-four production stock (v6)

A draft pick's production component is its expected year-four production
valuation, priced separately for every possible selection before averaging.
The target remains the existing four-season production quote assessed after
season four. Expected rookie salary surplus remains a separate component;
protections, swaps, forfeitures and joint outcome probabilities are retained.
For historical draft classes, the expectation uses only labels completed
before that class's draft year. Future picks use the latest eligible labels.

During the original supported development window, a player's production
component equals the same endpoint estimate used in their draft evaluation.
The original expectation is fixed; the existing calibrated NBA evidence weight
moves the estimate toward that player's own forecast. The rookie prior and
existing scenario pricing of service/salary paths are retained. No cohort is
forced to break even, and no new rookie-season learning policy is introduced.

Draft Value Added / Destroyed records changes in that endpoint estimate while
the original drafting team owns the player. For an uninterrupted holding this
sums to endpoint production minus original expectation. A trade freezes the
seller's development result at the ownership boundary; loss of drafted rights
before year four makes the retained production claim zero. Salary terms and
changes remain in Contract Management. Acquired players' subsequent production
changes use Player Development & Aging.

After development, daily player stock uses the existing rolling four-season
valuation. Any difference between the frozen endpoint stock and the rolling
production stock at the handoff is shown explicitly in Development Window
Timing. It is derived from two named valuation bases, not a balancing residual,
and is never added to the draft outcome a second time.

The source-identical migration preserves v5 and rebuilds v6 with identical
ownership, production forecasts, injury inputs and contract schedules. Active
endpoint grades are promoted without changing their salary component. Older
archived cohorts and unsupported endpoint observations retain their previous
production policy; unsigned supported rights start at their fixed cohort prior.
All app asset surfaces and daily refreshes use the new common version.
