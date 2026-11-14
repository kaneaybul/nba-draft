"""Uncertainty about the appraisal knowable at year four, not later outcomes.

A linked error vector is the revision to four forward production forecasts
between an earlier origin and a later assessed endpoint. Its label is complete
at that endpoint; actual production in the following four years never enters.
"""
import math
import numpy as np
from .path_model import feature_vector


def build_endpoint_errors(panel):
    rows=[]
    for (origin,pid),state in sorted(panel.states.items()):
        if origin<2017 or origin>=panel.last_year:continue
        key=panel.by_id[origin,pid]['key']
        if key in panel.ambiguous:continue
        full=panel.forecast(origin,pid,min(4,panel.last_year-origin)+4)
        for lead in range(1,min(4,panel.last_year-origin)+1):
            end=origin+lead;endpoint=panel.states.get((end,pid))
            observed=panel.actual_stats.get((end,pid))or panel.bref.get((end,key))
            if endpoint is None and observed and float(observed.get('minutes')or 0)>0:continue
            assessed=panel.forecast(end,pid,4)if endpoint else [0.]*4
            prediction=full[lead:lead+4]
            rows.append(dict(key=key,origin=origin,lead=lead,label_end=end,
                feature=feature_vector(state.age,state.total,state.minutes,state.yoe),
                residual=(np.asarray(assessed)-np.asarray(prediction)).tolist()))
    return rows


class EndpointRevisionPool:
    def __init__(self,rows,neighbors=60):self.rows=rows;self.neighbors=neighbors

    def scenarios(self,mean,feature,cutoff,lead,exclude=None):
        mean=np.asarray(mean,float)
        if mean.shape!=(4,)or not np.isfinite(mean).all()or not 0<=lead<=4:
            raise ValueError('Invalid assessed-endpoint forecast or development horizon')
        lower=int(math.floor(lead));upper=int(math.ceil(lead))
        choices=[(lower,1.)]if lower==upper else [(lower,upper-lead),(upper,lead-lower)]
        paths=[];weights=[];latest=[];counts={}
        for horizon,chance in choices:
            if horizon==0:
                paths.append(mean[None,:]);weights.append(np.array([chance]));counts[0]=1
                continue
            eligible=[r for r in self.rows if r['lead']==horizon and r['label_end']<=cutoff and r['key']!=exclude]
            if not eligible:raise ValueError('No completed endpoint-revision paths for this horizon')
            features=np.asarray([r['feature']for r in eligible])
            distances=np.square((features-np.asarray(feature))/np.array([5.,2.,1.2,5.])).sum(axis=1)
            use=np.argsort(distances,kind='stable')[:self.neighbors]
            chosen=[eligible[i]for i in use];distance=distances[use]
            w=np.exp(-.5*distance/max(float(np.median(distance)),.05));w/=w.sum()
            errors=np.asarray([r['residual']for r in chosen],float);errors-=w@errors
            paths.append(mean[None,:]+errors);weights.append(chance*w)
            latest.extend(r['label_end']for r in chosen);counts[horizon]=len(chosen)
        p=np.concatenate(paths);w=np.concatenate(weights)
        return p,w,dict(n=len(p),latest_label=max(latest,default=cutoff),
            remaining_development_years=float(lead),revision_horizons=counts,
            own_annual_mean_preserved=True,
            target='production appraisal assessed at year four; no later realized production')

