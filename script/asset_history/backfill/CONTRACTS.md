# Dated original contract reconstruction

`contracts.py` reads the union of dated league rosters, prioritizes material salaries, caches SalarySwish player contract histories, and parses each original contract separately. Current roster or current contract years are never simply copied into earlier snapshots.

Run:

```sh
python3 script/asset_history/backfill/contracts.py --sources /absolute/path/to/monthly_reconstruction --output /absolute/path/to/league_backfill/contracts --workers 4
```

Resume with the same paths. Completed player pages are reused. A source429/503 circuit defers new requests after three overload responses. Canonical URLs in downloaded `raw/index_*.json` override name slugs. Player-page slug rules preserve the site's punctuation conventions; genuine aliases still require source-verified URL mappings.

To reparse only existing evidence after parser changes:

```sh
python3 script/asset_history/backfill/rebuild_contract_cache.py --sources /absolute/path/to/monthly_reconstruction --output /absolute/path/to/league_backfill/contracts
```

Outputs:

- `contract_agreements.json`: canonical agreement dates, annual base salaries/cap hits, original option type, expiry year, source URL and structural coverage.
- `contract_adjustments.json`: dated option exercises/declines. Apply `remove_years` or `exercise_years` only after `known_from`.
- `coverage.json`: processed and missing players, original source hashes, parsing errors and limitations.
- `raw/`: original player pages retained for provenance.

`table_complete` means the original table has all stated years. `schedule_complete` additionally rejects short episodes and maximum-salary agreements signed before their first-year cap was fixed. The adapter must still validate as-of clauses at the requested date; this flag alone is not proof of every original guarantee. Important remaining as-of reviews:

1. A then-future maximum salary starts from a projected cap and sometimes contingent All-NBA performance. A current source's finalized dollar amount cannot be used early. `maximum_salary`, `first_year_cap_pct_current_diagnostic`, `max_salary_asof_review_required`, `first_cap_known_from`, `amount_terms_fixed_from` and original agreement type identify candidates for formula conversion or manual review. A fixed veteran extension above35% cap may instead be105% of prior salary; never assume every Max label is a percentage-of-cap formula.
2. Partial guarantee amounts and current `Option Used` annotations are retrospective. Keep original options contingent until dated resolution; guarantees amended later need original dated terms.
3. `short_episode` contracts are incomplete until annual salary rate and exact expiry are resolved. Episode dollars are not annual salaries.
4. Source signing dates can differ from first public announcements. Material agreements should be reconciled with the dated transaction register and primary team releases, using the later established public knowledge boundary when uncertain.
5. All current-source original tables represent reconstructed information, not recovered archived model publications. Existing independently reviewed Utah schedule inputs remain authoritative where sources conflict.

The `parsed_v2` directory is authoritative. Reparse with `--output <contracts>/parsed_v2 --raw <contracts>/raw` to isolate current-schema output from legacy downloader checkpoints. `max_salary_templates.json` contains39 dated formula/policy entries. They distinguish standard maximums, fixed original schedules and fixed later-year discounts. They are not an inference that every flagged maximum contract has identical terms.

For contingent rookie escalators the quote uses the signed25%base until a dated
qualifying award is known. The30%upper salary scenario stays in cell metadata;
no subjective award probability or eventual award is backdated. Doncic's2021
qualification was established before signing. Wembanyama's2026 agreement has
no escalators and therefore stays at25%. This is a disclosed base-cost policy,
not a claim that an unearned contingent cost has zero possible economic value.

Partial-season cash is preserved in `original_episode_amount` and converted to
an annual salary rate before the rolling exposure calculation. `episode_contracts.py`
records the published regular-season calendar and calculation. Ten-day rates
assume ten covered days; a three-game minimum can extend an individual episode.
Later full-year contract cells are unchanged. These are labeled rate estimates,
not an assertion that the team paid a full annual salary for a short contract.

For regular app updates, keep parsed schedules and `refresh_state.json` in the
processed data seed, then run:

```sh
python3 script/asset_history/backfill/refresh_contracts.py \
  --contracts processed/asset_history/contracts \
  --live-pool /path/to/current_player_pool.json \
  --roster /path/to/monthly_league_rosters.json \
  --events /path/to/current_dated_transactions.json --date YYYY-MM-DD
```

New and recently transacted owned players are refreshed immediately. Twenty
additional owned players receive rotating source checks per run. Source failures
retain their previous schedules and are recorded; failed mandatory refreshes
stop publication and retry the next run. A source signing date later than the
requested cutoff is never admitted. Refreshing sources cannot itself rewrite
sealed monthly observations.

The requested dated roster is authoritative for current contract discovery.
It includes signed players omitted from the live ESPN pool and assigns stable
source-profile keys to newly signed camp players without NBA identifiers.
Without a roster argument, recent parsed signing/removal events supplement the
pool. Recovered canonical URLs are reused on later CI runs. A new source profile
cannot silently reuse another established person's contract URL.

The completed league source seed contains3,810 agreements across1,242 contract
identities. Of these,122 use `-9000000000 - RealGM_profile_id` as a source key
because a historical camp/short-service ledger record had no NBA identifier.
These keys never assert an NBA identity. In particular, Auburn's Jaylin Williams
uses profile117468 and SalarySwish `jaylin-williams2`, independently of the
Oklahoma City player. Dated source-profile identity takes precedence over a
matching name.

`fetch_name_contract_gaps.py` recovers original tables for these records and
records source hashes. The completed finite queue resolved183 player-month
gaps. Mudiay's2021 ten-day and Lundberg's2022 two-way are explicitly labeled
published-CBA-minimum rate estimates because exact original dollar tables were
not recovered. Their dated signings and short terms are independently sourced.

Reviewed Exhibit10/training-camp and partially guaranteed two-way agreements
carry a dated release option. The annual valuation may choose service or release
at its known guaranteed cost; it does not force a full future minimum salary
when the team can legally waive the player. Ordinary veteran guarantee cells
are not automatically treated as original dated release rights.
