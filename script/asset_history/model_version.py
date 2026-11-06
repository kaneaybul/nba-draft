"""Versioned publication boundary for asset valuation changes."""
DATA_VERSION='v11'
LEGACY_VERSION='v10'
METHOD='peak4-payroll-0.8-v11'
ATTRIBUTION_METHOD='forecast-based-attribution-v7'

def data_root(repo,version=DATA_VERSION):
    return repo/'frontend/public/data/asset_history'/version



