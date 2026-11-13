"""Versioned publication boundary for asset valuation changes."""
DATA_VERSION='v13'
LEGACY_VERSION='v12'
METHOD='peak4-payroll-0.8-v13'
ATTRIBUTION_METHOD='forecast-based-attribution-v8'

def data_root(repo,version=DATA_VERSION):
    return repo/'frontend/public/data/asset_history'/version
