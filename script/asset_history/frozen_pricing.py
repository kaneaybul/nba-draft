"""Reintegrate frozen opening impact and scenario prices at closing boundaries.
No new evidence, role, salary policy, residual draw or padding weight enters.
"""
import math,json,zlib,base64
from rolling_impact import ImpactPath
from quote_window import quote_window
CAP=164961000.
def pack_scenarios(groups):
 return dict(codec='zlib-json-v1',data=base64.b64encode(zlib.compress(json.dumps(groups,separators=(',',':'),allow_nan=False).encode())).decode())
def unpack_scenarios(payload):
 if payload.get('codec')!='zlib-json-v1':raise ValueError('Unsupported frozen scenario codec')
 return json.loads(zlib.decompress(base64.b64decode(payload['data'])))
def number(r,k):
 v=float(r[k])
 if not math.isfinite(v):raise ValueError('Nonfinite frozen pricing input '+k)
 return v
def flag(v):return v is True or v=='True'
def clock_from_exposures(exposures):
 first=min(exposures);return 82*(first-2000)+82*(1-float(exposures[first]))
def coordinate_translation(opening,closing):
 old=opening['details']['rolling_impact'];new=closing['details']['rolling_impact'];keys=('coordinate_offset','coordinate_lineage')
 if not any(k in old or k in new for k in keys):return 0.
 if not all(k in old and k in new for k in keys):raise ValueError('Missing ownership coordinate provenance')
 if old['coordinate_lineage']!=new['coordinate_lineage']:raise ValueError('Ownership coordinate lineage mismatch')
 return number(new,'coordinate_offset')-number(old,'coordinate_offset')
def endpoint_shift(original_path,path,group):
 endpoint=group.get('endpoint')
 if endpoint is None:raise ValueError('Missing frozen endpoint scenarios for ownership translation')
 years=endpoint['years'];coeff=endpoint['sensitivities'];weights=endpoint['weights'];paths=endpoint['paths']
 if len(years)!=4 or len(coeff)!=4 or len(paths)!=len(weights):raise ValueError('Invalid frozen endpoint payload')
 if not math.isclose(sum(weights),1.,abs_tol=1e-7):raise ValueError('Invalid frozen endpoint weights')
 delta=[(path.mean(82*(int(y)-2000),82*(int(y)+1-2000))-original_path.mean(82*(int(y)-2000),82*(int(y)+1-2000)))*float(k)for y,k in zip(years,coeff)]
 def peak(row):return 2*sum(sorted(max(0.,float(v))for v in row)[-2:])
 if any(len(row)!=4 for row in paths):raise ValueError('Invalid endpoint scenario length')
 return float(group.get('endpoint_weight',group['weight']))*sum(float(w)*(peak([v+d for v,d in zip(row,delta)])-peak(row))for row,w in zip(paths,weights))
def price_context(asset,exposures,market,coordinate_shift=0.):
 d=asset['details'];ctx=d['rolling_impact'];rows={int(r['season']):r for r in ctx['annual_pricing_rows']}
 path=ImpactPath(tuple((float(x)+coordinate_shift,float(y))for x,y in ctx['knots']));clock=clock_from_exposures(exposures)
 if clock<float(ctx['clock'])+coordinate_shift-1e-7:raise ValueError('Counterfactual clock moved backward')
 if not math.isclose(sum(exposures.values()),4,abs_tol=1e-8):raise ValueError('Frozen quote requires four seasons')
 payload=d.get('path_calibration',{}).get('frozen_pricing_scenarios')
 groups=unpack_scenarios(payload)if payload else [dict(kind='nba',weight=1.,seasons=[],paths=[[]],weights=[1.])]
 prod_quote=financial=0.;start=clock;means={}
 for year,e in sorted(exposures.items()):
  if year not in rows:raise ValueError('Missing frozen role/pricing tail '+str(year))
  end=start+82*e;means[year]=path.mean(start,end);start=end
 for group in groups:
  if float(group['weight'])==0:continue
  indices={int(y):i for i,y in enumerate(group['seasons'])}
  if len(group['paths'])!=len(group['weights']):raise ValueError('Frozen scenario count mismatch')
  if not math.isclose(sum(group['weights']),1,abs_tol=1e-7):raise ValueError('Scenario weights not normalized')
  for draws,w in zip(group['paths'],group['weights']):
   pp=[];aa=[];ee=[]
   for year,e in sorted(exposures.items()):
    r=rows[year];cap=number(r,'salary_cap_scenario');budget=number(r,'scale_budget_scenario');raw=number(r,'annual_production')*CAP/cap
    p=float(draws[indices[year]])if year in indices else raw;window=flag(r.get('in_original_draft_window'))
    if not(group['kind']=='prior'and window):
     sensitivity=number(r,'forecast_annual_minutes')*budget*30/number(r,'league_timin')*CAP/cap
     p+=(means[year]-number(r,'latent_total'))*sensitivity
    c=number(r,'app_effective_contract')*CAP/cap
    if flag(r.get('is_unsigned_market_year')):
     if market is None:raise ValueError('Frozen unsigned pricing requires the existing salary model')
     yos=float(r.get('forecast_yos')if r.get('forecast_yos')not in(None,'')else max(0,year-int(float(d.get('draft_year')or year))-1))
     c=market.expected(p*cap/CAP,budget,cap,yos,int(r['league_reference_year']))[0]*CAP/cap
     if 1.8*p-.8*c<0:p=c=0.
    elif payload is not None and flag(r.get('waiver_option_verified')):
     g=number(r,'waiver_guaranteed_amount_asof')*CAP/cap
     if 1.8*p-.8*c<-.8*g:p=0.;c=g
    asset_value=1.8*p-.8*c
    if payload is None and window and r.get('app_expected_pick_annual_production')not in(None,''):
     maturity=number(r,'draft_maturity_weight');prior_p=number(r,'app_expected_pick_annual_production')*CAP/cap;prior_a=number(r,'app_expected_pick_annual_asset')*CAP/cap
     p=maturity*p+(1-maturity)*prior_p;asset_value=maturity*asset_value+(1-maturity)*prior_a
    if payload is None and flag(r.get('waiver_option_verified')):
     g=number(r,'waiver_guaranteed_amount_asof')*CAP/cap
     if asset_value<-.8*g:p=0.;asset_value=-.8*g
    pp.append(p);aa.append(asset_value);ee.append(e)
   q=quote_window(pp,aa,ee);ww=float(group['weight'])*float(w);prod_quote+=ww*q['production_quote'];financial+=ww*q['contract_adjustment_sum']
 if not math.isclose(sum(float(g['weight'])for g in groups),1,abs_tol=1e-7):raise ValueError('Mixture weights not normalized')
 from endpoint_stock import active
 if payload is not None or(active(d)and not d.get('draft_development',{}).get('completed')):
  prod_quote=float(d.get('peak_production',d.get('app_style_four_year_peak_production_quote')))
  if abs(coordinate_shift)>1e-12 and payload is not None:
   original_path=ImpactPath(tuple(tuple(x)for x in ctx['knots']))
   for group in groups:
    if group['kind']=='nba'and float(group.get('endpoint_weight',group['weight'])):prod_quote+=endpoint_shift(original_path,path,group)
 return dict(value=prod_quote+financial,peak=prod_quote,rolling_peak=prod_quote,tail_carry=[],method='opening rolling impact path reintegrated with frozen pricing scenarios')
def frozen_clock(asset,exposures,market=None,closing_asset=None):
 original={int(r['season']):float(r['exposure'])for r in asset['details']['annual_values']if float(r['exposure'])>0}
 check=price_context(asset,original,market)
 if abs(check['value']-float(asset['value']))>.05:raise ValueError('Frozen opening quote fails reconstruction for '+asset['name']+': '+str(check['value']-float(asset['value'])))
 shift=coordinate_translation(asset,closing_asset)if closing_asset is not None else 0.
 return price_context(asset,exposures,market,shift)
