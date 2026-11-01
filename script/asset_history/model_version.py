"""Versioned publication boundary for asset valuation changes."""
DATA_VERSION='v4'
LEGACY_VERSION='v3'
METHOD='peak4-payroll-0.8-v4'

def data_root(repo,version=DATA_VERSION):
    return repo/'frontend/public/data/asset_history'/version
