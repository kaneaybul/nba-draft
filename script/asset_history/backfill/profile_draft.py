"""Fill missing actual draft slots from NBA-ID-matched original player profiles.

Existing reviewed actual picks win disagreements. Profile data never replace a
known actual slot with a mock slot. Immutable draft identity is separate from
current contract terms.
"""

def profile_drafts(agreements,key):
    byid={};conflicts=[]
    for a in agreements:
        pid=a.get('nba_id');year=a.get('source_profile_draft_year');slot=a.get('source_profile_draft_pick')
        try:pid=int(pid);year=int(year);slot=int(slot)
        except (ValueError,TypeError):continue
        if pid<=0 or not 1947<=year<=2100 or not 1<=slot<=60:continue
        value=(year,slot)
        if pid in byid and byid[pid]['draft']!=value:
            conflicts.append({'nba_id':pid,'first':byid[pid]['draft'],'other':value});continue
        byid[pid]={'draft':value,'player_name':a['player_name'],'source':a.get('source'),'name_key':key(a['player_name'])}
    return byid,conflicts

def apply_profile_drafts(src,agreements,key):
    byid,conflicts=profile_drafts(agreements,key)
    src.draft_by_id={pid:r['draft']for pid,r in byid.items()}
    src.draft_profile_conflicts=conflicts;added=[]
    keys_by_id={}
    for pair in src.pairs.values():
        for r in pair.itertuples():keys_by_id.setdefault(int(r.nba_id),set()).add(key(r.name))
    for s in src.inventory:
        for a in s['roster_and_rights']:
            if a.get('nba_id')is not None:keys_by_id.setdefault(int(a['nba_id']),set()).add(key(a['player_name']))
    for pid,r in byid.items():
        names=keys_by_id.get(pid,set())|{r['name_key']}
        for k in names:
            existing=src.draft.get(k)
            if existing and existing!=r['draft']:
                conflicts.append({'nba_id':pid,'name_key':k,'reviewed_register':existing,'profile':r['draft'],'action':'kept_reviewed_register'})
                # Known roster identity supplies the reviewed slot to the ID
                # lookup too, preserving curated resolved draft selections.
                src.draft_by_id[pid]=existing
            elif not existing:
                src.draft[k]=r['draft'];added.append({'nba_id':pid,'name_key':k,'draft':r['draft'],'source':r['source']})
    return {'added':added,'conflicts':conflicts}
