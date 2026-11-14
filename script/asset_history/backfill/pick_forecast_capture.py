"""Keep dated pick forecasts reproducible after the live feed advances."""
import json

def capture(path, asof, ratings, standings):
    data = json.loads(path.read_text())
    latest = max(data['ratings'])
    if asof < latest:
        if data['ratings'].get(asof) != ratings or data['standings'].get(asof) != standings:
            raise ValueError('Cannot replace an earlier dated pick forecast')
        return
    if any(row['date'] != asof for row in ratings):
        raise ValueError('Pick forecast date differs from capture date')
    data['ratings'][asof] = ratings
    data['standings'][asof] = standings
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, separators=(',', ':'), allow_nan=False))
    temporary.replace(path)
