"""Validated pricing context and typed persisted rolling path state."""
import json,math

def _number(value,name):
    value=float(value)
    if not math.isfinite(value):raise ValueError('Nonfinite '+name)
    return value

def impact_provenance(provider,method):
    if provider is None:return {'profile_method':method}
    out={'profile_method':method}
    for key in('actual_source_day','data_date'):
        value=provider.get(key)
        if value is not None and not(isinstance(value,float)and math.isnan(value)):out[key]=str(value)
    return out

def serialize_impact_context(row,annual_rows):
    payload=row.get('impact_path_knots_json')
    if not payload:return None
    knots=json.loads(payload)if isinstance(payload,str)else payload
    if len(knots)<2:raise ValueError('Rolling context has insufficient knots')
    knots=[[_number(x,'clock'),_number(y,'impact')]for x,y in knots]
    if any(b[0]<=a[0]for a,b in zip(knots,knots[1:])):raise ValueError('Nonmonotone rolling knots')
    clock=_number(row['impact_team_game_clock'],'current clock')
    if not knots[0][0]<=clock<=knots[-1][0]-328:raise ValueError('Rolling context does not cover four years')
    records=[]
    for annual in annual_rows:
        record=dict(annual);year=int(record['season']);lo=max(clock,82*(year-2000));hi=82*(year+1-2000)
        if hi<=lo or hi>knots[-1][0]+1e-8:continue
        record['impact_slice_start_team_game']=lo;record['impact_slice_end_team_game']=hi;records.append(record)
    years=[int(r['season'])for r in records]
    if len(set(years))!=len(years):raise ValueError('Duplicate rolling pricing season')
    return {'schema_version':1,'policy':'rolling-82-team-game-impact-v1','clock':clock,'knots':knots,'annual_pricing_rows':records,'coordinate_offset':float(row.get('impact_coordinate_offset',0.)),'coordinate_lineage':row.get('impact_coordinate_lineage'),'owner_handoff':json.loads(row.get('impact_owner_handoff_json')or'null'),'evidence_signature':row.get('impact_evidence_signature'),'observation_provenance':json.loads(row.get('impact_observation_provenance_json')or'{}')}

def encode_impact_cache(cache):
    from dataclasses import asdict
    records=[]
    for identity,entry in cache.items():
        records.append({'identity':identity,'identity_type':'int'if isinstance(identity,int)else'str','knots':[list(k)for k in entry['path'].knots],'states':[asdict(st)for st in entry['states']],**{k:v for k,v in entry.items()if k not in('path','states')}})
    return {'schema_version':1,'records':records}

def decode_impact_cache(payload,path_type,state_type):
    if not payload or payload.get('schema_version')!=1:raise ValueError('Missing/version-mismatched rolling impact state; reseed required')
    cache={}
    for record in payload['records']:
        identity=int(record['identity'])if record['identity_type']=='int'else str(record['identity'])
        if identity in cache:raise ValueError('Duplicate rolling state identity')
        entry={k:v for k,v in record.items()if k not in('identity','identity_type','knots','states')}
        entry['path']=path_type(tuple(tuple(k)for k in record['knots']));entry['states']=[state_type(**st)for st in record['states']]
        clock=_number(entry['clock'],'saved clock')
        if not entry['path'].knots[0][0]<=clock<=entry['path'].knots[-1][0]:raise ValueError('Saved clock outside rolling path')
        if not entry['states']:raise ValueError('Missing annual states for tail extension')
        cache[identity]=entry
    return cache
