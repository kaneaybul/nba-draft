"""Source-only acute metadata seam. No role fit, allocator, collectors or writes.
Requires separately validated same-day identity/age/position and native schedule.
"""
from datetime import datetime
from zoneinfo import ZoneInfo

def prepare(metadata,outlook,schedules,asof,calendar_module):
    observed=outlook['generated_at']
    day=datetime.fromisoformat(observed.replace('Z','+00:00')).astimezone(ZoneInfo('America/New_York')).date().isoformat()
    if day!=asof:raise ValueError('Source outlook is not requested local knowledge day')
    if outlook.get('teams_checked')!=30:raise ValueError('Incomplete outlook coverage')
    result=[];seen=set()
    for original in metadata:
        row=dict(original);pid=row.get('source_nba_id') or row.get('nba_id')
        if pid in seen:raise ValueError('Duplicate source identity')
        seen.add(pid)
        if not pid or row.get('team') in (None,'FA'):continue
        row['injury_projection_as_of']=observed
        row['injury_availability']=1.
        payload=calendar_module.dated_payload(row,outlook,schedules,asof)
        if payload.get('availability_resolution')!='dated_existing_frontend_plan':raise ValueError('Missing exact dated team schedule')
        cells=payload['availability_scheduled_games']
        row['injury_availability']=round(sum(c['probability'] for c in cells)/len(cells),5)
        source=payload.get('availability_source_row') or {}
        row['injury_source_url']=source.get('source_url')
        row['injury_projection_basis']=source.get('basis')
        row['injury_projection_note']=source.get('note')
        result.append(row)
    return result
