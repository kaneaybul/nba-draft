"""Versioned publication boundary for asset valuation changes."""
DATA_VERSION='v12'
LEGACY_VERSION='v11'
METHOD='peak4-payroll-0.8-v12'
ATTRIBUTION_METHOD='forecast-based-attribution-v7'

def data_root(repo,version=DATA_VERSION):
    return repo/'frontend/public/data/asset_history'/version
