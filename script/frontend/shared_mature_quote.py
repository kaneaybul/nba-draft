"""Reprice a post-draft-window contract using the released salary and peak functions."""
import numpy as np
from quote_window import quote_window
from valuation_engine import annual_production, scale_asset


class MatureQuote:
    def __init__(self, rows, market, reporting_cap):
        rows = list(rows)
        self.rows = {int(row["season"]):row for row in rows}
        if len(rows) != len(self.rows):
            raise ValueError("Expected one dated contract row per season")
        self.market = market
        self.reporting_cap = reporting_cap

    def annual(self, clock, minutes, impact):
        years = (clock+np.arange(328))//82+2000
        output = []
        for year in np.unique(years):
            row = self.rows[int(year)]
            if row["in_original_draft_window"] in (True,"True"):
                raise ValueError("Draft-window valuation requires the calibrated endpoint pricer")
            mask = years==year
            exposure = mask.sum()/82
            volume = sum(minutes[mask])/exposure
            above_replacement = np.dot(minutes[mask],impact[mask]-float(row["replacement"]))/exposure
            budget = float(row["scale_budget_scenario"])
            cap = float(row["salary_cap_scenario"])
            # Linear production in impact-minutes, prior to contract choices.
            production = annual_production(above_replacement,0.,1.,budget,float(row["league_timin"]))
            unsigned = row["is_unsigned_market_year"] in (True,"True")
            salary = (self.market.expected(production,budget,cap,float(row["forecast_yos"]),
                                           int(row["league_reference_year"]))[0]
                      if unsigned else float(row["app_effective_contract"]))
            _,asset = scale_asset(production,salary,volume,budget)
            if unsigned and asset < 0:
                production = asset = 0.
            elif row["waiver_option_verified"] in (True,"True"):
                guarantee = -.8*float(row["waiver_guaranteed_amount_asof"])
                if asset < guarantee:
                    production,asset = 0.,guarantee
            output.append((production*self.reporting_cap/cap,asset*self.reporting_cap/cap,exposure))
        return output

    def parts(self, clock, minutes, impact):
        return quote_window(*zip(*self.annual(clock, minutes, impact)))

    def __call__(self, clock, minutes, impact):
        return self.parts(clock,minutes,impact)["quote"]
