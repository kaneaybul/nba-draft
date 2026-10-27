"""NumPy evaluation of reviewed legal pick rules over joint outcomes.

The scalar allocator remains the semantic reference. This implementation loops
over legal operations and small basket expressions, never over simulated draws.
Ownership codes use OWNER_NAMES, with FORFEITED as the final code.
"""
from __future__ import annotations
from datetime import date
import numpy as np
from pick_allocator import TEAMS, ref

OWNER_NAMES=tuple(sorted(TEAMS))+('FORFEITED',)
OWNER_INDEX={team:i for i,team in enumerate(OWNER_NAMES)}

class Evaluator:
    def __init__(self,raw,keys,conditions=None):
        self.keys=tuple(ref(p)for p in keys);self.index={p:i for i,p in enumerate(self.keys)}
        if len(self.index)!=len(self.keys):raise ValueError('Duplicate physical pick')
        self.raw=np.asarray(raw)
        if self.raw.ndim!=2 or self.raw.shape[1]!=len(self.keys):raise ValueError('Slot-array shape mismatch')
        if not np.issubdtype(self.raw.dtype,np.integer):raise ValueError('Slot arrays must contain integers')
        for j,p in enumerate(self.keys):
            lo,hi=(1,30)if p[2]==1 else(31,60)
            if np.any((self.raw[:,j]<lo)|(self.raw[:,j]>hi)):raise ValueError('Slot is inconsistent with round')
        self.slots=self.raw if conditions is None else np.asarray(conditions)
        if self.slots.shape!=self.raw.shape or not np.issubdtype(self.slots.dtype,np.integer):raise ValueError('Condition-slot shape/type mismatch')
        self.n,self.width=self.raw.shape;self.rows=np.arange(self.n);self.all=np.ones(self.n,bool)
        self.owners=np.broadcast_to(np.array([OWNER_INDEX[p[0]]for p in self.keys],dtype=np.int8),self.raw.shape).copy()
        ranks={p:i for i,p in enumerate(sorted(self.keys))}
        self.lex=np.array([ranks[p]for p in self.keys],dtype=np.int64)
        self.settled={}

    def col(self,p):
        p=ref(p)
        if p not in self.index:raise ValueError('Rule references a physical pick outside the supplied horizon: '+str(p))
        return self.index[p]
    def columns(self,picks,unique=True):
        cols=[self.col(p)for p in picks]
        if unique and len(set(cols))!=len(cols):raise ValueError('Duplicate physical component')
        return cols
    def vector(self,p):return np.full(self.n,self.col(p),dtype=np.int32)
    def check(self,ok,message,active=None):
        bad=(self.all if active is None else active)&~np.asarray(ok,dtype=bool)
        if np.any(bad):raise ValueError(message+' (outcome '+str(int(np.flatnonzero(bad)[0]))+')')
    def at(self,columns):return self.slots[self.rows,np.maximum(columns,0)]
    def inside(self,p,interval):
        values=self.slots[:,self.col(p)]
        return (values>=int(interval[0]))&(values<=int(interval[1]))
    def unprotected(self,columns,ranges):
        values=self.at(columns);yes=columns>=0
        for lo,hi in ranges:yes&=~((values>=int(lo))&(values<=int(hi)))
        return yes
    def transfer(self,columns,source,target,active=None):
        if source not in OWNER_INDEX or target not in OWNER_INDEX:raise ValueError('Invalid transfer owner')
        if isinstance(columns,int):columns=np.full(self.n,columns,dtype=np.int32)
        active=self.all if active is None else active
        self.check(columns>=0,'Missing transferred entitlement',active)
        safe=np.maximum(columns,0)
        self.check(self.owners[self.rows,safe]==OWNER_INDEX[source],'Chain owner mismatch',active)
        self.owners[self.rows[active],columns[active]]=OWNER_INDEX[target]
    def rank(self,candidates,index,active):
        if not candidates:return np.full(self.n,-1,dtype=np.int32)
        cols=np.column_stack(candidates).astype(np.int32,copy=False)
        # The scalar helper ranks a set, including repeated nested selectors.
        for j in range(1,cols.shape[1]):
            repeated=np.any(cols[:,:j]==cols[:,j,None],axis=1)
            cols[repeated,j]=-1
        valid=cols>=0;count=valid.sum(axis=1)
        safe=np.maximum(cols,0)
        score=self.slots[self.rows[:,None],safe].astype(np.int64)*(self.width+1)+self.lex[safe]
        score=np.where(valid,score,np.iinfo(np.int64).max)
        ordering=np.argsort(score,axis=1,kind='stable')
        selected_index=np.full(self.n,int(index))if index>=0 else count+int(index)
        self.check((count==0)|((selected_index>=0)&(selected_index<count)),'Entitlement rank outside eligible candidate set',active)
        selected_index=np.clip(selected_index,0,cols.shape[1]-1)
        result=cols[self.rows,ordering[self.rows,selected_index]]
        return np.where(count>0,result,-1)
    def select(self,expr,active,scope=None,assigned=None):
        if not np.any(active):return np.full(self.n,-1,dtype=np.int32)
        if expr is None:return np.full(self.n,-1,dtype=np.int32)
        if isinstance(expr,(list,tuple)):result=self.vector(expr)
        elif isinstance(expr,str)and expr in('remaining','best_remaining','worst_remaining'):
            if scope is None or assigned is None:raise ValueError('Remainder outside a partition')
            masks=[~assigned[:,c]for c in scope];count=np.column_stack(masks).sum(axis=1)
            self.check(count==1 if expr=='remaining'else count>0,'Remainder is not a single available physical pick',active)
            result=self.rank([np.where(mask,c,-1)for c,mask in zip(scope,masks)],-1 if expr=='worst_remaining'else 0,active)
        elif isinstance(expr,dict)and'if_slot_in'in expr:
            c=expr['if_slot_in'];inside=self.inside(c['pick'],c['range'])
            yes=self.select(expr['then'],active&inside,scope,assigned);no=self.select(expr['else'],active&~inside,scope,assigned)
            result=np.where(inside,yes,no)
        elif isinstance(expr,dict):
            if 'held'in expr:
                c=expr['held'];cols=self.columns(c['picks']);masks=[self.owners[:,j]==OWNER_INDEX[c['owner']]for j in cols]
                count=np.column_stack(masks).sum(axis=1)if cols else np.zeros(self.n,int)
                if 'count_range'in c:
                    lo,hi=c['count_range'];self.check((count>=lo)&(count<=hi),'Held entitlement count outside reviewed bounds',active)
                result=self.rank([np.where(mask,col,-1)for col,mask in zip(cols,masks)],int(c.get('index',0)),active)
            elif 'rank'in expr:
                c=expr['rank'];result=self.rank([self.select(p,active,scope,assigned)for p in c['picks']],int(c['index']),active)
            else:
                op=next((k for k in('best','worst','best_eligible')if k in expr),None)
                if op is None:raise ValueError('Unsupported reviewed entitlement selector')
                if op=='best_eligible':
                    candidates=[]
                    for b in expr[op]:
                        col=self.vector(b['pick']);candidates.append(np.where(self.unprotected(col,b.get('protected_ranges',[])),col,-1))
                else:candidates=[self.select(p,active,scope,assigned)for p in expr[op]]
                if not candidates and scope is not None:raise ValueError('Empty rank selector')
                result=self.rank(candidates,-1 if op=='worst'else 0,active)
        else:raise ValueError('Unsupported pick selector')
        if scope is not None:self.check(np.isin(result,scope),'Selector references a pick outside its reviewed basket',active)
        return result
    def owner_expression(self,expr,active):
        if not np.any(active):return np.zeros(self.n,dtype=np.int8)
        if isinstance(expr,dict)and'if_slot_in'in expr:
            c=expr['if_slot_in'];inside=self.inside(c['pick'],c['range'])
            return np.where(inside,self.owner_expression(expr['then'],active&inside),self.owner_expression(expr['else'],active&~inside))
        if expr not in TEAMS:raise ValueError('Invalid basket recipient')
        return np.full(self.n,OWNER_INDEX[expr],dtype=np.int8)
    def conditions(self,rule):
        active=self.all.copy()
        for c in rule.get('conditions',[]):active&=self.inside(c['pick'],c['range'])==c.get('inside',True)
        return active
    def swap(self,left,right,left_owner,right_owner,active,ranges=(),fallback=(),guard_protected=True):
        lv=np.maximum(left,0);rv=np.maximum(right,0)
        self.check((left>=0)&(right>=0),'Missing swap entitlement',active)
        yes=self.unprotected(right,ranges)
        self.check((self.owners[self.rows,lv]==OWNER_INDEX[left_owner])&(self.owners[self.rows,rv]==OWNER_INDEX[right_owner]),'Swap owner mismatch',active if guard_protected else active&yes)
        move=active&yes&(self.at(right)<self.at(left))
        a=self.owners[self.rows[move],left[move]].copy();b=self.owners[self.rows[move],right[move]].copy()
        self.owners[self.rows[move],left[move]]=b;self.owners[self.rows[move],right[move]]=a
        for p in fallback:self.transfer(self.col(p),right_owner,left_owner,active&~yes)

    def rule(self,r):
        kind=r['kind']
        if kind=='transfer':self.transfer(self.col(r['pick']),r['from_team'],r['to_team'])
        elif kind=='entitlement_transfer':
            cols=self.columns(r['picks']);held=self.owners[:,cols]==OWNER_INDEX[r['from_team']];count=held.sum(axis=1);lo,hi=r.get('count_range',[0,len(cols)])
            self.check((count>=lo)&(count<=hi),'Transferred entitlement count outside reviewed bounds')
            for j,c in enumerate(cols):self.transfer(c,r['from_team'],r['to_team'],held[:,j])
        elif kind=='ranked_transfer':
            if r['rank']not in('best','worst'):raise ValueError('Invalid entitlement rank')
            cols=self.columns(r['picks'],unique=False);masks=[self.owners[:,c]==OWNER_INDEX[r['from_team']]for c in cols]
            count=np.column_stack(masks).sum(axis=1)if cols else np.zeros(self.n,int)
            self.check(count>0,'Ranked entitlement transfer has no held candidates')
            chosen=self.rank([np.where(m,c,-1)for c,m in zip(cols,masks)],-1 if r['rank']=='worst'else 0,self.all)
            self.transfer(chosen,r['from_team'],r['to_team'],self.unprotected(chosen,r.get('protected_ranges',[])))
        elif kind in('selected_transfer','selected_swap'):
            active=self.conditions(r)
            if kind=='selected_transfer':
                chosen=self.select(r['select'],active)
                if not r.get('allow_no_selection'):self.check(chosen>=0,'Reviewed selector unexpectedly has no entitlement',active)
                active&=self.unprotected(chosen,r.get('protected_ranges',[]))
                self.transfer(chosen,r['from_team'],r['to_team'],active)
            else:
                left=self.select(r['left_select'],active);right=self.select(r['right_select'],active)
                if not r.get('allow_no_selection'):self.check((left>=0)&(right>=0),'Reviewed swap unexpectedly has no selected entitlement',active)
                active&=(left>=0)&(right>=0);self.check(left!=right,'Selected swap repeats one physical pick',active)
                self.swap(left,right,r['left_owner'],r['right_owner'],active,r.get('protected_ranges',[]))
        elif kind=='protected_chain':
            dependency=r.get('requires_gap_after_rule')
            if dependency is not None and dependency not in self.settled:raise ValueError('Protected chain dependency must be allocated first')
            prior=self.settled.get(dependency,np.full(self.n,-1));chosen=np.full(self.n,-1,dtype=np.int32);years=np.full(self.n,-1,dtype=np.int16)
            for b in r['branches']:
                col=self.col(b['pick']);year=int(ref(b['pick'])[1]);valid=(chosen<0)&self.unprotected(np.full(self.n,col),b.get('protected_ranges',[]))
                if r.get('requires_prior_conveyance'):valid&=prior>=0
                valid&=(prior<0)|(year>=prior+int(r.get('minimum_gap_years',2)))
                chosen[valid]=col;years[valid]=year
            self.settled[r.get('rule_id')]=years
            self.transfer(chosen,r['from_team'],r['to_team'],chosen>=0)
            for p in r.get('fallback_picks',[]):self.transfer(self.col(p),r['from_team'],r['to_team'],chosen<0)
        elif kind=='swap':self.swap(self.vector(r['left_pick']),self.vector(r['right_pick']),r['left_owner'],r['right_owner'],self.all,r.get('protected_ranges',[]),r.get('fallback_picks',[]),guard_protected=False)
        elif kind=='best_option_swap':
            left=self.vector(r['left_pick']);owner=r['left_owner'];self.check(self.owners[:,left[0]]==OWNER_INDEX[owner],'Option swap left owner mismatch')
            candidates=[left]
            for b in r['options']:
                c=self.col(b['pick']);self.check(self.owners[:,c]==OWNER_INDEX[b['owner']],'Option swap candidate owner mismatch')
                col=np.full(self.n,c);candidates.append(np.where(self.unprotected(col,b.get('protected_ranges',[])),col,-1))
            right=self.rank(candidates,0,self.all);move=(right!=left)&(self.at(right)<self.at(left))
            # Candidate owners may differ by outcome; swap the held codes.
            a=self.owners[self.rows[move],left[move]].copy();b=self.owners[self.rows[move],right[move]].copy()
            self.owners[self.rows[move],left[move]]=b;self.owners[self.rows[move],right[move]]=a
        elif kind in('holder_swap','holder_pool_swap'):
            selected=[]
            pools=[(r['left_pool'],r['left_owner'],r.get('left_rank'))]
            if kind=='holder_swap':pools.append(([r['right_pick']],r['right_owner'],None))
            else:pools.append((r['right_pool'],r['right_owner'],r.get('right_rank')))
            for picks,owner,rank in pools:
                if rank not in(None,'best','worst'):raise ValueError('Invalid pool swap rank')
                cols=self.columns(picks,unique=False);masks=[self.owners[:,c]==OWNER_INDEX[owner]for c in cols]
                count=np.column_stack(masks).sum(axis=1)if cols else np.zeros(self.n,int)
                self.check(count==1 if rank is None else count>0,'Pool swap requires exactly one held pick unless a reviewed rank is supplied')
                selected.append(self.rank([np.where(m,c,-1)for c,m in zip(cols,masks)],-1 if rank=='worst'else 0,self.all))
            self.swap(*selected,r['left_owner'],r['right_owner'],self.all,
                      r.get('protected_ranges',[])if kind=='holder_pool_swap'else(),
                      r.get('fallback_picks',[])if kind=='holder_pool_swap'else())
        elif kind=='deferred_choice':
            policy=r.get('decision_by_slot')
            if policy is None:raise ValueError('Deferred choice requires an ex ante decision policy before allocation')
            early=self.col(r['earlier_pick']);late=self.col(r['later_pick']);lookup=np.array([policy.get(str(i),'missing')for i in range(61)])
            choices=lookup[self.slots[:,early]]
            if np.any(choices=='missing'):raise ValueError('Missing deferred-choice slot policy')
            chosen=np.where(choices=='earlier',early,late);self.transfer(chosen,r['from_team'],r['to_team'])
        elif kind=='selector_partition':
            cols=self.columns(r['picks']);scope=set(cols);expected={self.col(p):o for p,o in r['expected_owners']}
            if set(expected)!=scope:raise ValueError('Selector partition owner mismatch')
            for c,o in expected.items():self.check(self.owners[:,c]==OWNER_INDEX[o],'Selector partition owner mismatch')
            assigned=np.zeros(self.raw.shape,bool);result=self.owners.copy()
            for claim in r['claims']:
                owner=self.owner_expression(claim['owner'],self.all);chosen=self.select(claim['select'],self.all,cols,assigned)
                self.check(~assigned[self.rows,np.maximum(chosen,0)],'Basket assigns one physical pick twice')
                result[self.rows,chosen]=owner;assigned[self.rows,chosen]=True
            self.check(assigned[:,cols].all(axis=1),'Basket leaves a physical pick unassigned')
            self.owners[:,cols]=result[:,cols]
        elif kind=='partition':
            cols=self.columns(r['picks'])
            if len(cols)!=len(r['owners_by_rank']):raise ValueError('Partition does not conserve physical picks')
            expected={self.col(p):o for p,o in r['expected_owners']}
            for c in cols:self.check(self.owners[:,c]==OWNER_INDEX[expected[c]],'Partition owner mismatch')
            keys=self.slots[:,cols].astype(np.int64)*(self.width+1)+self.lex[cols];ordered=np.array(cols)[np.argsort(keys,axis=1)]
            for j,owner in enumerate(r['owners_by_rank']):
                if owner not in TEAMS:raise ValueError('Invalid partition recipient')
                self.owners[self.rows,ordered[:,j]]=OWNER_INDEX[owner]
        elif kind=='forfeit_next_available_second':
            owner=OWNER_INDEX[r['target_team']];start=int(r['first_eligible_year'])
            held_cols=[j for j,p in enumerate(self.keys)if p[2]==2 and p[1]>=start]
            allowed=[ref(p)for p in r.get('allowed_candidates',[self.keys[j]for j in held_cols])]
            allowed_cols=[self.index[p]for p in allowed if p in self.index]
            candidates=[j for j in held_cols if j in allowed_cols]
            masks=[self.owners[:,j]==owner for j in candidates]
            year_scores=np.column_stack([np.where(mask,self.keys[j][1],32767)for j,mask in zip(candidates,masks)])if candidates else np.full((self.n,1),32767)
            earliest=year_scores.min(axis=1);reviewed=max((p[1]for p in allowed),default=start)
            for j in held_cols:
                if j not in allowed_cols:self.check(~((self.owners[:,j]==owner)&(self.keys[j][1]<=np.minimum(earliest,reviewed))),'Unreviewed earlier available ownership')
            masks=[mask&(self.keys[j][1]==earliest)for j,mask in zip(candidates,masks)]
            count=np.column_stack(masks).sum(axis=1)if masks else np.zeros(self.n,int)
            if r.get('same_year_policy')!='first_selection':self.check(count<=1,'Multiple next-year picks require a reviewed penalty-selection policy')
            chosen=self.rank([np.where(mask,j,-1)for j,mask in zip(candidates,masks)],0,self.all)
            active=chosen>=0;self.owners[self.rows[active],chosen[active]]=OWNER_INDEX['FORFEITED']
        else:raise ValueError('Unsupported legal rule kind '+kind)

def allocate_vector(slots_array,physical_keys,rules,asof,condition_slots_array=None):
    """Return [outcome, physical pick] owner codes; raise on any invalid draw."""
    date.fromisoformat(asof);e=Evaluator(slots_array,physical_keys,condition_slots_array)
    for r in sorted(rules,key=lambda r:(r['known_from'],r['order'])):
        if r.get('baseline_only')and asof<r['baseline_asof']:raise ValueError('Collapsed opening rules cannot reconstruct dates before their baseline')
        if r['known_from']>asof or(r.get('known_until')and asof>=r['known_until']):continue
        if r.get('reviewed')is not True or not r.get('source'):raise ValueError('Unreviewed or unsourced legal rule')
        try:e.rule(r)
        except ValueError as err:raise ValueError(str(err)+' [rule '+str(r.get('rule_id'))+']')from err
    return e.owners
