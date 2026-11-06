"""A common distributional payoff for picks and players.

All monetary inputs are salary-cap-normalized dollars. A scenario is an entire
career segment, not independently resampled seasons. Historical labels are
eligible only after the LAST season of that segment has finished. No centering
of a draft cohort's aggregate realized return is performed.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
import numpy as np


def path_quotes(production, cost, exposures=None):
    """Price every path BEFORE taking an expectation, including partial seasons."""
    p = np.atleast_2d(np.asarray(production, float))
    c = np.broadcast_to(np.asarray(cost, float), p.shape)
    e = np.ones(p.shape[1]) if exposures is None else np.asarray(exposures, float)
    if e.shape != (p.shape[1],) or np.any(e <= 0) or np.any(e > 1):
        raise ValueError('Invalid annual exposures')
    if not np.isclose(e.sum(), 4):
        raise ValueError('A quote requires exactly four season-equivalents')
    if not np.isfinite(p).all() or not np.isfinite(c).all() or np.any(c < 0):
        raise ValueError('Missing/nonfinite production or invalid cost')
    order = np.argsort(-p, axis=1, kind='stable')
    sorted_p = np.take_along_axis(p, order, axis=1)
    sorted_e = np.broadcast_to(e, p.shape)[np.arange(len(p))[:, None], order]
    before = np.cumsum(sorted_e, axis=1) - sorted_e
    selected = np.minimum(sorted_e, np.maximum(0, 2 - before))
    return 2 * (sorted_p * selected).sum(axis=1) + .8 * ((p-c)*e).sum(axis=1)


def weighted_quantile(values, weights, quantiles=(.1, .5, .9)):
    v, w = np.asarray(values, float), np.asarray(weights, float)
    positive=w>0
    v,w=v[positive],w[positive]
    order = np.argsort(v)
    v, w = v[order], w[order]
    cdf = (np.cumsum(w) - .5*w) / w.sum()
    return np.interp(quantiles, cdf, v).tolist()


def summarize(production, cost, weights, exposures=None):
    p = np.asarray(production, float)
    w = np.asarray(weights, float)
    if len(w) != len(p) or not np.isfinite(w).all() or np.any(w < 0) or w.sum() <= 0:
        raise ValueError('Invalid scenario weights')
    w = w / w.sum()
    q = path_quotes(p, cost, exposures)
    c = np.broadcast_to(np.asarray(cost, float), p.shape)
    mean_p, mean_c = w @ p, w @ c
    plug_in = float(path_quotes(mean_p, mean_c, exposures)[0])
    result = dict(mean=float(w @ q), mean_path_quote=plug_in,
                  path_selection_premium=float(w @ q)-plug_in,
                  annual_mean_production=mean_p.tolist(),
                  annual_mean_cost=mean_c.tolist(),
                  scenarios=len(p), effective_scenarios=float(1/(w@w)))
    result.update(zip(('p10', 'p50', 'p90'), weighted_quantile(q, w)))
    ex=np.ones(p.shape[1]) if exposures is None else np.asarray(exposures,float)
    result['contract_adjustment_sum']=float(.8*((mean_p-mean_c)*ex).sum())
    result['production_quote']=result['mean']-result['contract_adjustment_sum']
    return result


def slot_weights(slots, target, bandwidth=.55):
    """Smooth whole historical careers locally by log pick; retain busts."""
    d = (np.log(np.asarray(slots, float)) - math.log(float(target))) / bandwidth
    w = np.exp(-.5 * d*d)
    return w/w.sum()


def regularize_paths(production, slots, target, weights, exposures=None, target_payoff=None):
    """Keep empirical path shapes, shrink their center to the log-slot fit.

    Sparse tail-slot kernel means are noisy. Fitting expected PAYOFFS to log
    selection is the existing regularization, and is independent of pricing
    each career first. A positive scaling preserves zero-service paths and
    all within-career season ordering/correlation.
    """
    p=np.asarray(production,float)
    q=path_quotes(p,np.zeros(p.shape[1]),exposures)
    if target_payoff is None:
        x=np.column_stack([np.ones(len(p)),np.log(np.asarray(slots,float))])
        coef=np.linalg.lstsq(x,q,rcond=None)[0]
        target_payoff=float(np.array([1.,math.log(target)])@coef)
    target_payoff=max(0.,float(target_payoff))
    center=float(np.asarray(weights)@q)
    if center<=0:
        raise ValueError('Cannot calibrate a nonpositive empirical production payoff')
    return p*(target_payoff/center),target_payoff/center


@dataclass
class CareerPool:
    rows: list[dict]

    def scenarios(self, slot, stage, horizon, cutoff, bandwidth=.55, exclude=None):
        eligible = [r for r in self.rows
                    if r['stage'] == stage and r['horizon'] >= horizon
                    and r['label_end']-r['horizon']+horizon <= cutoff and r['key'] != exclude]
        if not eligible:
            raise ValueError(f'No mature historical career paths at {cutoff}, stage {stage}')
        # Exactly one row per player / stage / longest known path.
        p = np.array([r['production'][:horizon] for r in eligible])
        w = slot_weights([r['slot'] for r in eligible], slot, bandwidth)
        return p, w, eligible


@dataclass
class ResidualPool:
    rows: list[dict]
    neighbors: int = 60

    def scenarios(self, mean_path, feature, cutoff, centered=True, exclude=None):
        """Reuse linked errors; no future-completed labels or target-player leak.

        Centering preserves the core forecast's mean to isolate uncertainty.
        Uncentered errors additionally estimate a historical conditional bias.
        Neither choice forces aggregate team or cohort returns to zero.
        """
        mean = np.asarray(mean_path, float)
        h = len(mean)
        eligible = [r for r in self.rows if r['horizon'] >= h and
                    r['origin'] + h <= cutoff and r['key'] != exclude]
        if not eligible:
            raise ValueError(f'No {h}-year residual paths known by {cutoff}')
        f = np.array([r['feature'] for r in eligible])
        scales = np.array([5., 2., 1.2, 5.])
        distance = np.square((f - np.asarray(feature))/scales).sum(axis=1)
        use = np.argsort(distance, kind='stable')[:self.neighbors]
        chosen = [eligible[i] for i in use]
        d = distance[use]
        # Adaptive distance bandwidth; whole career rows remain intact.
        weights = np.exp(-.5*d/max(float(np.median(d)), .05))
        weights /= weights.sum()
        errors = np.array([r['residual'][:h] for r in chosen])
        bias = weights @ errors
        if centered:
            errors = errors - bias
        return mean[None, :] + errors, weights, dict(
            historical_bias=bias.tolist(), n=len(chosen),
            latest_label=max(r['origin']+h for r in chosen))


def feature_vector(age, total, minutes, experience):
    return [float(age), float(total), math.log1p(max(0, float(minutes))/100), float(experience)]


def evidence_weight(minutes, scale):
    """Empirical-Bayes reliability; scale is fitted on mature payoff labels."""
    if minutes < 0 or scale <= 0:
        raise ValueError('Invalid experience or evidence scale')
    return float(minutes/(minutes+scale))


def development_weight(minutes, scale, remaining_seasons):
    """Retain fitted NBA reliability; release the last prior by year four.

    The empirical minute-based rule is unchanged before the last development
    season. During that final season its remaining prior mass runs down with
    the same season exposures used by the asset model, reaching exactly zero.
    """
    if not math.isfinite(remaining_seasons) or remaining_seasons < 0:
        raise ValueError('Invalid remaining development exposure')
    weight=evidence_weight(minutes, scale)
    return weight if remaining_seasons>=1. else 1.-(1.-weight)*remaining_seasons


def summarize_development(prior, prior_cost, prior_weights, endpoint_values,
                          nba, nba_cost, nba_weights, nba_weight, exposures,
                          nba_endpoint_values=None, nba_endpoint_weights=None):
    """One padded stock: original prior blended with the updated Y4 appraisal.

    Each linked NBA career is priced before averaging. The draft component
    uses its original mature production expectation, with current service/cost
    paths retained for contract attribution. Live callers supply the same fixed
    endpoint for NBA evidence; omitting it retains the archived rolling blend.
    """
    pw, nw = np.asarray(prior_weights, float), np.asarray(nba_weights, float)
    pw, nw = pw / pw.sum(), nw / nw.sum()
    endpoint_values = np.asarray(endpoint_values, float)
    if endpoint_values.shape != pw.shape or not np.isfinite(endpoint_values).all():
        raise ValueError('Missing linked mature production payoffs')
    if not 0 <= nba_weight <= 1:
        raise ValueError('Invalid NBA learning weight')
    e = np.asarray(exposures, float)
    p = np.concatenate([prior, nba]); c = np.concatenate([prior_cost, nba_cost])
    w = np.concatenate([(1-nba_weight)*pw, nba_weight*nw])
    result = summarize(p, c, w, e)
    financial = .8 * ((p-c)*e).sum(axis=1)
    live_production = path_quotes(nba, nba_cost, e) - financial[len(pw):]
    if nba_endpoint_values is None:
        own,ow=live_production,nw
        quotes=np.concatenate([endpoint_values+financial[:len(pw)],own+financial[len(pw):]])
        qw=w
    else:
        own=np.asarray(nba_endpoint_values,float)
        ow=np.asarray(nba_endpoint_weights,float);ow=ow/ow.sum()
        if own.shape!=ow.shape or not np.isfinite(own).all():
            raise ValueError('Invalid year-four appraisal scenarios')
        # Endpoint revisions and current service-cost uncertainty have separate
        # empirical pools. Preserve each marginal; do not invent paired careers.
        quotes=np.concatenate([endpoint_values+financial[:len(pw)],
            (own[:,None]+financial[len(pw):][None,:]).ravel()])
        qw=np.concatenate([(1-nba_weight)*pw,nba_weight*(ow[:,None]*nw[None,:]).ravel()])
    production=np.concatenate([endpoint_values,own])
    production_weights=np.concatenate([(1-nba_weight)*pw,nba_weight*ow])
    result['draft_prior_adjustment'] = float(qw@quotes) - result['mean']
    result['mean'] = float(qw@quotes)
    result['scenarios']=len(qw)
    result['effective_scenarios']=float(1./(qw@qw))
    result['production_quote'] = float(production_weights@production)
    result.update(zip(('p10','p50','p90'), weighted_quantile(quotes,qw)))
    result.update(zip(('production_p10','production_p50','production_p90'), weighted_quantile(production,production_weights)))
    result['draft_prior_production'] = float(pw@endpoint_values)
    result['nba_production_quote'] = float(ow@own)
    result['current_window_production_quote'] = float(nw@live_production)
    return result


def fit_reliability(cases, cutoff, scales=(25., 50., 100., 250., 500., 1000., 2000., 4000., 8000., 16000.)):
    """Fit reliability to the shared completed endpoint labels at this cutoff."""
    train = [r for r in cases if r['label_end'] <= cutoff]
    if not train:
        return dict(scale=None, n=0, cutoff=cutoff)
    scores = []
    for scale in scales:
        predictions = [r['prior'] + evidence_weight(r['minutes'], scale)*(r['nba']-r['prior']) for r in train]
        mse = float(np.mean([(p-r['actual'])**2 for p, r in zip(predictions, train)]))
        scores.append((mse, scale))
    mse, scale = min(scores)
    return dict(scale=scale, n=len(train), cutoff=cutoff, rmse=math.sqrt(mse),
                latest_label=max(r['label_end'] for r in train))


