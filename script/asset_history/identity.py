"""Verified ID transitions for comparisons; never rewrite closed observations."""

# Official profile: https://www.nba.com/player/1643563/richie-saunders
ASSET_ID_ALIASES={'player:name:richiesaunders':'player:nba:1643563'}

def asset_id(asset):
    return ASSET_ID_ALIASES.get(asset['id'],asset['id'])

def indexed_assets(assets):
    result={}
    for asset in assets:
        identity=asset_id(asset)
        if identity in result:
            raise ValueError('Duplicate canonical asset identity: '+identity)
        result[identity]=asset
    return result
