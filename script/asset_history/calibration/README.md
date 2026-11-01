# Young-player path valuation

Version 4 runs this layer after every canonical player refresh and before portfolio publication. The player board, annual values, four-year quotes, asset history and trade machine read the same published results.

Young players use linked career paths, pricing each path before averaging. Full unfloored annual inputs retain signed salary, known absences, unsigned continuation pricing and verified release guarantees in every scenario. After one completed NBA season, reliability is observed NBA minutes divided by minutes plus an empirically fitted scale. Completed and currently observed minutes update that evidence. First-season rookies retain the draft prior because the reliability fit has no first-season cases. Veteran and generic pick policies retain their existing specification.

Uncertainty and prior blending apply only to the remaining original four-year draft window, matching the validated payoff target. Later forecast years retain the canonical veteran production and contract choices. The adjustment therefore vanishes continuously as the remaining rookie-window exposure reaches zero, rather than dropping when a player crosses a calendar-year boundary.

Historical labels must finish by the observation's completed reference year. Entire career and error vectors remain linked. Observations without sufficient mature paths retain the deterministic quote and record the reason. Dormant unsigned draft rights retain their existing slot-prior quote; they do not acquire an NBA service history or a fabricated NBA identity. The v3 archive is preserved; v4 rebuilds history under this policy.

Training data and model source are hashed. The staged cache is reused while those inputs remain identical and rebuilt when completed annual inputs or model code change. Publication commits the cache and player state only after all 30 portfolios validate. Identical same-day source inputs reuse the published result; new evidence invalidates that shortcut.

The prototype original-window production-payoff RMSE improved 8.4%, from $41.61M to $38.12M, across 544 player/stage observations and 251 players. Improvement was concentrated after the first season; after three seasons it was negligible. The exploratory cohort-bootstrap 90% improvement interval was 3.6%–12.5% over five draft classes. These are retrospective specification hindcasts, not broad transaction-price calibration. The broad veteran uplift and raw empirical pick mean failed their comparisons and are excluded. Small-service estimates are explicit; historical injury versus healthy benching labels remain incomplete.

The release report reconciles method changes on identical current inputs. Training and pricing coverage diagnostics remain in the validation artifact. Expected peak and contract components reconcile separately from annual means: selecting a peak after averaging cannot recover the expected quote.

Run:

```bash
python -m unittest discover -s script/asset_history -p 'test_*.py'
python -m unittest discover -s script/asset_history/backfill -p 'test_*.py'
python script/frontend/test_asset_value_data.py
```

The live producer uses production.py with the full annual inputs. The earlier input exporter, chronological backtest, prototype comparison and trade benchmark remain reproducible diagnostic tools.
