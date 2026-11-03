"""Versioned publication boundary for asset valuation changes."""
DATA_VERSION='v7'
LEGACY_VERSION='v6'
METHOD='peak4-payroll-0.8-v7'

def data_root(repo,version=DATA_VERSION):
    return repo/'frontend/public/data/asset_history'/version

