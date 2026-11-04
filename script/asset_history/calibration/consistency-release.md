# Consistent valuation window (v8)

The available Asset History window starts December 31, 2021. Version 8
recomputes every player observation in that window with the current minutes
adapter, including inherited players. It never copies an old cohort's rolling
price merely because endpoint draft attribution is unsupported for that cohort.
The career-path and draft appraisal specification remains the v7 policy.

Impact and the asset producer read the same ten-appearance prior and 38-MPG
baseline cap from `script/frontend/role_minutes_policy.json`. The main exporter
retains dated injury accounting and temporary rotation redistribution; asset
pricing retains its canonical attendance, injury and roster-event treatment.
The rule describes conditional baseline MPG, not a 38-minute limit on actual
games or temporary injury replacement minutes.

All current asset surfaces read the published inventory, including sorting,
trade suggestions and Trade Machine. Historical season views read the latest
common observation within that season. Their quote and observation date are
copied directly from Asset History. These small season feeds load on demand.
Rows with no owned, priced claim at that observation remain unavailable rather
than using a different model or a guessed zero. Earlier seasons outside the
available history window are not reconstructed.

Value and 4Y Value remain the original production measures. Asset Value is the
separate rolling quote with contract economics; its distinct definition is
intentional. Both trade entry points use Asset Value.

A method-only rebuild uses the saved observation date, even if newer raw files
were fetched after UTC midnight. Player, skill, injury, clock and pick forecast
inputs are replayed from saved dated evidence. It cannot pull later live inputs
into that date. Subsequent daily refreshes cannot mix minutes policies within
the history window; a policy change requires a complete versioned rebuild.

The release verifies all 30 teams, every selectable waterfall date range,
trade/lottery conservation and exact equality between every season's app
quotes and the corresponding inventory. It regenerates current Impact minutes
and dependent values using the existing source inputs before publication.
