"""Build a dated legal-rule view, with an explicit event-completeness gate.

Rules are evaluated over joint physical-slot outcomes by pick_allocator. This
module never substitutes a realized future selection label for an unknown slot.
"""
from copy import deepcopy
from collections import Counter,defaultdict
from datetime import date
import argparse,importlib,json
from pathlib import Path

COHORTS=['reviewed_replay_2022','reviewed_replay_2023','reviewed_replay_2024_2025','reviewed_replay_2026']

def load_actions():
 actions=[];missing=[]
 for name in COHORTS:
  try:module=importlib.import_module(name)
  except ModuleNotFoundError as e:
   if e.name!=name:raise
   missing.append(name);continue
  actions.extend(module.actions())
 return actions,missing

def event_instances(events):
 counts=Counter(e['event_id']for e in events);seen=defaultdict(int);out=[]
 for e in events:
  row=dict(e);eid=e['event_id'];idx=seen[eid];seen[eid]+=1
  row['event_instance']=eid+('#'+str(idx)if counts[eid]>1 else'')
  out.append(row)
 return out

def active_rules(baseline,actions,asof,catalog=()):
 date.fromisoformat(asof)
 if not baseline.get('complete'):raise ValueError('Opening ownership is incomplete')
 if asof<baseline['asof']:raise ValueError('Requested date precedes the reviewed baseline')
 rules={r['rule_id']:deepcopy(r)for r in baseline['rules']}
 if len(rules)!=len(baseline['rules']):raise ValueError('Duplicate baseline rule ID')
 covered=set();unresolved=[];applied=[];disabled=set();economic_claims=[]
 for action in sorted(actions,key=lambda a:(a['known_from'],a.get('order',0))):
  if action['known_from']>asof or (action.get('known_until') and asof>=action['known_until']):continue
  if action.get('reviewed')is not True or not action.get('source'):raise ValueError('Unreviewed replay action')
  instance=action.get('event_instance',action['event_id']);kind=action['kind']
  if kind=='unresolved':unresolved.append(action);continue
  if kind=='add_rule':
   rule=deepcopy(action['rule']);rid=rule['rule_id']
   if rid in rules:raise ValueError('Duplicate replay rule '+rid)
   rule.setdefault('known_from',action['known_from']);rule.setdefault('order',action.get('order',0));rule.setdefault('reviewed',True);rule.setdefault('source',action['source'])
   if rule['known_from']!=action['known_from']:raise ValueError('New rule date differs from transaction date')
   rules[rid]=rule
  elif kind=='patch_rule':
   rid=action['rule_id']
   if rid not in rules:raise ValueError('Patch references unknown rule '+rid)
   for change in action['changes']:
    path=change['path'];target=rules[rid]
    if not path:raise ValueError('Empty patch path')
    for key in path[:-1]:target=target[key]
    if 'expected'in change and target[path[-1]]!=change['expected']:raise ValueError('Prior legal term differs for '+rid+' '+str(path))
    target[path[-1]]=deepcopy(change['value'])
   rules[rid].setdefault('dated_amendments',[]).append(dict(known_from=action['known_from'],source=action['source'],event_instance=instance))
  elif kind=='disable_rule':
   if action['rule_id']not in rules:raise ValueError('Unknown disabled rule '+action['rule_id'])
   disabled.add(action['rule_id'])
  elif kind=='add_economic_claim':
   claim=deepcopy(action['claim']);claim.setdefault('known_from',action['known_from']);claim.setdefault('source',action['source']);claim.setdefault('known_until',action.get('known_until'));economic_claims.append(claim)
  elif kind=='no_future_pick_effect':
   if not action.get('reason'):raise ValueError('Consumed/voided event needs a reviewed reason')
  else:raise ValueError('Unsupported replay action '+kind)
  covered.add(instance);applied.append(action)
 expected={e['event_instance']:e for e in event_instances(catalog)if baseline['asof']<e['known_from']<=asof}
 for key,e in expected.items():
  if key not in covered and not any(a.get('event_instance',a['event_id'])==key for a in unresolved):
   unresolved.append(dict(event_id=e['event_id'],event_instance=key,known_from=e['known_from'],kind='unresolved',reason='No reviewed action covers this dated source event',source=e['source'],source_text=e['source_text']))
 return dict(asof=asof,complete=not unresolved,status='reviewed_dated_legal_view'if not unresolved else'partial_dated_legal_view',
             rules=[r for rid,r in rules.items()if rid not in disabled],economic_claims=economic_claims,unresolved=unresolved,
             covered_source_event_instances=sorted(covered),expected_source_event_count=len(expected),applied_action_count=len(applied),
             scope='Legal ownership only; slot distributions, availability windows, known draft resolutions and quote values must be supplied by the dated simulation layer.')

def display_years(asof,draft_completion_dates,horizon=7,announced_draft_months=None):
 """Use the next undrafted year; caller supplies verified draft completion dates."""
 day=date.fromisoformat(asof);year=day.year
 draft_completion_dates={int(y):d for y,d in draft_completion_dates.items()}
 if year not in draft_completion_dates:
  upcoming=(announced_draft_months or{}).get(str(year))
  if upcoming and upcoming.get('source') and asof<upcoming['month']+'-01':return list(range(year,year+horizon))
  raise ValueError('Missing verified draft completion date; retain the last validated inventory')
 first=year+(asof>=draft_completion_dates[year])
 return list(range(first,first+horizon))

def main():
 p=argparse.ArgumentParser();p.add_argument('--baseline',type=Path,required=True);p.add_argument('--catalog',type=Path,required=True);p.add_argument('--asof',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 actions,missing=load_actions();view=active_rules(json.loads(a.baseline.read_text()),actions,a.asof,json.loads(a.catalog.read_text()));view['missing_replay_cohorts']=missing
 if missing:view.update(complete=False,status='partial_dated_legal_view')
 a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(json.dumps(view,indent=2));print(json.dumps({k:view[k]for k in ['asof','complete','applied_action_count','expected_source_event_count','missing_replay_cohorts']}))

if __name__=='__main__':main()
