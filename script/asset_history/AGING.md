# Aging and development attribution

For each observation interval, advance the rolling four-season window using
the opening snapshot's production forecast. This keeps the forecasted impact
and playing time for each season, uses the closing window's season weights,
and retains the opening uncertainty premium. If the window reaches a season
past the opening path, carry the final forecasted annual rate forward.

Aging is the expected change between the opening production quote and that
rolled quote. Player Development is the revised closing production quote
minus the rolled quote, after allocating changes in contract terms and
continuation to Contract Management. Revised impact, playing time and
availability can all affect the residual.

Draftee Development keeps the padded comparison with original expectations
through year four for the drafting team. Once the player leaves that window,
the ordinary split applies. Transfers use the existing opening-forecast quote
and book the expected interval change to the opening owner.

The attribution changes how existing portfolio movements are categorized.
Historical annual paths retain their recorded `aging_basis` metadata.
