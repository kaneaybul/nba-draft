# Leaguewide pick reconstruction

These collectors provide review evidence. Their raw references are **not** a
legal pick inventory and must not be summed into team asset totals.

- `pick_event_evidence.py --events PATH --output PATH` extracts dated directions
  from the existing all-team RealGM register. It keeps conditional/basket/swap
  references visibly unresolved rather than replacing them with unprotected picks.
- `pick_sources.py --output PATH` caches detailed current RealGM rights and tries
  year-by-year draft trade histories. HTTP failures remain in the source manifest.
- `salaryswish_pick_history.py --output PATH` follows the public site's own
  documented-in-JavaScript Load More cursor. All responses are cached. It requires
  `lxml` and otherwise uses the Python standard library. Original reported terms,
  subsequent results, and realized selection labels have separate fields.
- `pick_allocator.py` evaluates **reviewed, sourced rules** over joint slot draws.
  Each physical pick has one owner per outcome. Protected rolling obligations
  transfer only their first eligible branch. Swaps exchange existing physical
  picks, rather than manufacturing an extra first. Partitions support correlated
  most/least-favorable baskets. Team expected values conserve the league's value.

Source coverage from the initial retrieval:

- RealGM all-team register: 276 trade events, 216 with pick wording, 558 extracted
  references in 214 events. Two pick-bearing records need parser review.
- SalarySwish: 420 trade groups, all 30 teams, season filters 2015–2027. There are
  116 pre-2022 recipient legs with 175 references to 2022-or-later picks. Those
  references include retransfers and must be chained, not counted independently.
- SalarySwish season 2016 and 2017 returns no records; 2015, 2018 and 2019 are
  sparse. A successful end-of-pagination request is not proof of complete history.
- ProSportsTransactions annual pages 2022–2033 returned HTTP403/503 in this
  environment. Both direct and web retrieval failed on the first historical page.
- RealGM's `/future_drafts/summary/2022` currently returns empty historical team
  pick cells. The year in its heading does not make it an archived 2022 inventory.

The next step is to adjudicate the original opening conditional rights and dated
modifications, then encode them as allocator rules with source URLs, known dates,
and stable operation order. Actual draft slots may resolve a predicate only after
that draft's lottery/order became known. Do not use SalarySwish's realized labels
as historical expected slots. Announcement dates also require comparison with
completion dates before mapping rights into month-end legal ownership.

Run checks with:

```sh
python3 -m unittest discover -s script/asset_history/backfill -p 'test_pick_evidence.py'
```
