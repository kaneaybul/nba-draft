import { useEffect, useState } from 'react';
import './assetHistory.css';
import { LeagueComparison, Waterfall, signedMoney, type ReviewedAnalysis } from './AssetHistoryCharts';
type Asset={id:string;kind:'player'|'pick';name:string;value:number;source:string;note?:string;details?:{peak_production:number;contract_adjustment:number;draft_development?:{status:string;endpoint:string;value:number;original_expectation:number;gain:number}}};
type Snapshot={team:string;date:string;total:number;reporting_cap:number;closed:boolean;vintage:'reconstructed'|'published';assets:Asset[];moves:{date:string;label:string;major:boolean}[];bridge?:{key:string;label:string;value:number}[];assumptions?:string[];source_dates?:Record<string,string>};
type TeamFile={team:string;method:string;snapshots:Snapshot[]};
type Manifest={generated_at:string;method:string;teams:{team:string;status:string;count:number;latest:string|null;path:string|null;points?:{date:string;total:number;players:number;picks:number;reporting_cap:number;vintage:string}[]}[]};
type RefreshStatus={status:string;observation_date?:string;recorded_at:string};
const money=(v:number)=>`${v<0?'−':''}$${(Math.abs(v)/1e6).toLocaleString(undefined,{maximumFractionDigits:1})}M`;
async function read<T,>(url:string,signal:AbortSignal):Promise<T>{const r=await fetch(url,{cache:'no-cache',signal});if(!r.ok)throw Error(`Asset data unavailable (${r.status})`);return r.json();}
export function AssetHistoryWorkspace(){
 const [manifest,setManifest]=useState<Manifest|null>(null),[file,setFile]=useState<TeamFile|null>(null),[team,setTeam]=useState('UTA'),[selected,setSelected]=useState(''),[error,setError]=useState(''),[query,setQuery]=useState(''),[kind,setKind]=useState('all');
 const [revision,setRevision]=useState(0);
 const [startDate,setStartDate]=useState('2024-02-29');
 const [reviewed,setReviewed]=useState<ReviewedAnalysis|null>(null);
 const [showReviewed,setShowReviewed]=useState(true);
 const [reviewError,setReviewError]=useState('');
 const [historyVersion,setHistoryVersion]=useState('v5');
 const [refreshStatus,setRefreshStatus]=useState<RefreshStatus|null>(null);
 useEffect(()=>{const f=()=>setRevision(x=>x+1);const timer=window.setInterval(f,60000);window.addEventListener('focus',f);return()=>{clearInterval(timer);window.removeEventListener('focus',f);};},[]);
 useEffect(()=>{const c=new AbortController();read<{history_version?:string}>('/data/asset_valuation.json',c.signal).then(async metadata=>{const version=metadata.history_version;if(version!=='v5')throw Error('The current asset valuation release is unavailable.');const m=await read<Manifest>(`/data/asset_history/${version}/manifest.json`,c.signal);setHistoryVersion(version);setManifest(m);setError('');}).catch(e=>{if(!c.signal.aborted)setError(String(e.message));});return()=>c.abort();},[revision]);
 useEffect(()=>{const c=new AbortController();read<RefreshStatus>(`/data/asset_history/${historyVersion}/refresh_status.json`,c.signal).then(setRefreshStatus).catch(()=>{});return()=>c.abort();},[revision,historyVersion]);
 useEffect(()=>{if(team!=='UTA')return;const c=new AbortController();read<ReviewedAnalysis>('/data/asset_history/analysis/UTA_2024-02-29_2026-11-01.json',c.signal).then(data=>{if(Math.abs(data.opening+Object.values(data.categories).reduce((a,b)=>a+b,0)-data.closing)>.01)throw Error('Saved breakdown does not reconcile.');setReviewed(data);setReviewError('');}).catch(e=>{if(!c.signal.aborted)setReviewError(String(e.message));});return()=>c.abort();},[team]);
 const path=manifest?.teams.find(t=>t.team===team)?.path;
 useEffect(()=>{setFile(null);setQuery('');setError('');},[team]);
 useEffect(()=>{if(!path)return;const c=new AbortController();read<TeamFile>(path,c.signal).then(x=>{setFile(x);setSelected(d=>x.snapshots.some(s=>s.date===d)?d:x.snapshots[x.snapshots.length-1]?.date??'');setError('');}).catch(e=>{if(!c.signal.aborted)setError(String(e.message));});return()=>c.abort();},[path,manifest?.generated_at]);
 const points=file?.team===team?file.snapshots:[];const index=Math.max(0,points.findIndex(s=>s.date===selected));const current=points[index];const previous=points[index-1];
 const values=points.map(s=>s.total);const low=Math.min(...values),high=Math.max(...values);const pad=Math.max((high-low)*.12,1e6);const min=low-pad,max=high+pad;
 const first=points.length?Date.parse(points[0].date):0,last=points.length?Date.parse(points[points.length-1]!.date):1;
 const x=(s:Snapshot)=>70+((Date.parse(s.date)-first)/Math.max(1,last-first))*910;
 const y=(s:Snapshot)=>265-(s.total-min)/Math.max(1,max-min)*220;
 const chart=points.map((s,i)=>`${i?'L':'M'}${x(s)},${y(s)}`).join(' ');
 const assets=current?.assets.filter(a=>(kind==='all'||a.kind===kind)&&a.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.value-a.value)??[];
 const startIndex=points.findIndex((s,i)=>s.date===startDate&&i<=index);
 const baseline=points[startIndex>=0?startIndex:0];
 const interval=points.slice((startIndex>=0?startIndex:0)+1,index+1);
 const changes=Object.values(interval.reduce<Record<string,{key:string;label:string;value:number}>>((all,s)=>{for(const c of s.bridge??[])all[c.key]={...c,value:(all[c.key]?.value??0)+c.value};return all;},{}));
 const completeBridge=interval.every(s=>s.bridge?.length && Math.abs(s.bridge.reduce((sum,c)=>sum+c.value,0)-(s.total-points[points.indexOf(s)-1].total))<.01);
 const oldAssets=new Map(baseline?.assets.map(a=>[a.id,a.value])??[]);
 const players=current?.assets.filter(a=>a.kind==='player').reduce((s,a)=>s+a.value,0)??0;
 const latestDate=points[points.length-1]?.date;
 const stale=latestDate&&Date.now()-Date.parse(latestDate)>3*86400000;
 return <main className="asset-history workspace"><header className="ah-heading"><div><span className="ah-eyebrow">FOUR-SEASON ASSET INVENTORY</span><h1>Asset history</h1><p>Explore how a team’s players and draft rights change in value over time.</p></div><label>Team<select value={team} onChange={e=>setTeam(e.target.value)}>{manifest?.teams.map(t=><option key={t.team} value={t.team}>{t.team}{t.status==='pending_backfill'?' · awaiting history':''}</option>)}</select></label></header>
 <details className="ah-method"><summary>How asset value works</summary><p>Asset value combines projected player production and contract costs over a rolling four-season window. Picks reflect expected player value, protections and swaps. Young-player estimates blend draft expectations with NBA evidence.</p><p>All values use the same salary cap. Historical estimates are reconstructed; the current month refreshes daily. Cash, cap space and trade exceptions are excluded.</p></details>
 {error&&<p role="alert" className="ah-message">{error} <button onClick={()=>setRevision(r=>r+1)}>Retry</button></p>}
 {(stale||refreshStatus?.status==='retained_last_good')&&<p role="status" className="ah-message">The latest update is awaiting validation. The last validated inventory{latestDate?` from ${latestDate}`:''} remains available.</p>}
 {!manifest&&!error&&<p role="status">Loading coverage…</p>}
 {manifest&&!path&&<section className="ah-message"><h2>{team} history is awaiting reconstruction</h2><p>Monthly SKILL, dated contract terms, pick rights and injury outlooks must pass coverage checks before this team’s totals can be compared. Missing inventory is not shown as zero.</p></section>}
 {path&&!current&&!error&&<p role="status">Loading {team} inventory…</p>}
 {current&&<><div className="ah-stats"><div><span>Total inventory</span><strong>{money(current.total)}</strong></div><div><span>Players</span><strong>{money(players)}</strong></div><div><span>Draft rights</span><strong>{money(current.total-players)}</strong></div><div><span>Change since {baseline.date}</span><strong>{signedMoney(current.total-baseline.total)}</strong></div></div>
 <section className="ah-chart"><div className="ah-chart-heading"><label>Snapshot<select value={current.date} onChange={e=>setSelected(e.target.value)}>{points.map(s=><option key={s.date} value={s.date}>{s.date}{s.closed?' · preserved':' · provisional'}</option>)}</select></label><span>{current.vintage==='reconstructed'?'Historical reconstruction':'Recorded at publication'} · {current.closed?'Preserved monthly observation':'Provisional estimate'} · ${(current.reporting_cap/1e6).toFixed(3)}M reporting cap</span></div>
 <p className="ah-chart-legend">Larger markers indicate major moves. Select a point or use the date control to inspect its inventory.</p>
 <svg viewBox="0 0 1000 310" role="img" aria-label={`${team} asset inventory over time. Select a snapshot using the date control.`}>
 {[0,.5,1].map(t=><g key={t}><line x1="70" x2="980" y1={265-t*220} y2={265-t*220} stroke="currentColor" opacity=".12"/><text x="4" y={270-t*220}>{money(min+t*(max-min))}</text></g>)}
 <path d={chart} fill="none" stroke="#6bd4c3" strokeWidth="3"/>
 {points.map(s=><g key={s.date}><circle cx={x(s)} cy={y(s)} r={s.date===current.date?6:s.moves.some(m=>m.major)?4:2} fill={s.date===current.date?'#fff':'#6bd4c3'}><title>{s.date}: {money(s.total)}{s.moves.filter(m=>m.major).map(m=>' · '+m.label).join('')}</title></circle><circle cx={x(s)} cy={y(s)} r="12" fill="transparent" onClick={()=>setSelected(s.date)} style={{cursor:'pointer'}}><title>{s.date}: {money(s.total)}{s.moves.filter(m=>m.major).map(m=>' · '+m.label).join('')}</title></circle></g>)}
 <text x="70" y="300">{points[0].date}</text><text x="980" y="300" textAnchor="end">{points[points.length-1]!.date}</text>
 </svg><input aria-label="Explore snapshots" type="range" min="0" max={points.length-1} value={index} onChange={e=>setSelected(points[Number(e.target.value)].date)}/></section>
 <section className="ah-analysis-panel">
 <div className="ah-chart-heading"><div><h2>What changed</h2><p className="ah-caption">{baseline.date} → {current.date}</p></div><label>Compare from<select value={baseline.date} onChange={e=>setStartDate(e.target.value)}>{points.slice(0,index+1).map(s=><option key={s.date} value={s.date}>{s.date}</option>)}</select></label></div>
 {team==='UTA'&&<div className="ah-mode-switch" role="group" aria-label="Waterfall view"><button aria-pressed={showReviewed} onClick={()=>setShowReviewed(true)}>Detailed Jazz breakdown</button><button aria-pressed={!showReviewed} onClick={()=>setShowReviewed(false)}>Selected period</button></div>}
 {team==='UTA'&&showReviewed?<>{reviewed?<><p className="ah-analysis-period"><strong>Saved analysis · {reviewed.start} → {reviewed.end}</strong><span>{signedMoney(reviewed.change)} total change</span></p><p className="ah-caption">The corrected breakdown from our earlier analysis, fixed through November 1. Select a category for its contributors.</p><Waterfall opening={reviewed.opening} closing={reviewed.closing} changes={Object.entries(reviewed.categories).map(([key,value])=>({key,label:key,value}))} reviewed={reviewed}/></>:<p role="status">{reviewError||'Loading detailed Jazz analysis…'}</p>}</>:completeBridge?<Waterfall opening={baseline.total} closing={current.total} changes={changes}/>:<p>{baseline.date===current.date?'Choose an earlier starting date to compare changes.':'Category attribution is unavailable for part of this period.'} Total change: {signedMoney(current.total-baseline.total)}.</p>}
 {!(team==='UTA'&&showReviewed)&&<p className="ah-caption">Live breakdown by holdings added, removed and repriced. It does not separate trades, contracts or player development.</p>}
 </section>
 <LeagueComparison teams={manifest?.teams??[]} start={baseline.date} end={current.date} cap={current.reporting_cap} selectedTeam={team} onSelect={setTeam}/>
 <details className="ah-method ah-moves"><summary>Moves since {previous?.date??current.date} ({current.moves.length})</summary>{current.moves.length?<ul>{current.moves.map((m,i)=><li key={i}><time>{m.date}</time> {m.label}</li>)}</ul>:<p>No annotated moves.</p>}</details>
 <section><div className="ah-filters"><h2>Assets · {current.date}</h2><input aria-label="Search assets" placeholder="Find a player or pick" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Asset category" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All assets</option><option value="player">Players</option><option value="pick">Draft rights</option></select></div><div className="ah-table ah-inventory"><table><thead><tr><th>Asset</th><th>Type</th><th>Asset value</th><th>Change since {baseline.date}</th><th>Details</th></tr></thead><tbody>{assets.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.kind==='player'?'Player':'Pick'}</td><td>{money(a.value)}</td><td>{oldAssets.has(a.id)?signedMoney(a.value-oldAssets.get(a.id)!):'Added'}</td><td><details><summary>View</summary>{a.details&&<p>Production {money(a.details.peak_production)} · Contract effect {money(a.details.contract_adjustment)}</p>}{a.details?.draft_development?.status==='priced'&&<p>Draft development: {signedMoney(a.details.draft_development.gain)} versus original expectation.</p>}{a.note&&<p>{a.note}</p>}<small>{a.source}</small></details></td></tr>)}</tbody></table></div><p className="ah-caption">Sorted by asset value. Changes compare assets held on both dates; removed assets appear in the waterfall.</p></section>
 <details className="ah-method"><summary>Sources and assumptions</summary>{current.source_dates&&<p>{Object.entries(current.source_dates).map(([name,date])=>`${name}: ${date}`).join(' · ')}</p>}{current.assumptions?.length?<ul>{current.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul>:null}<p>Method: {file?.method}. Draft endpoint grades are separate from the additive waterfall.</p></details>
 <footer><a href={path??undefined} download>Download {team} history</a> · Data through {points[points.length-1]!.date} · Method {file?.method}</footer></>}
 </main>;
}


