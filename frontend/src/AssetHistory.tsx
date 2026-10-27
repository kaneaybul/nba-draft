import { useEffect, useState } from 'react';
import './assetHistory.css';
type Asset={id:string;kind:'player'|'pick';name:string;value:number;source:string;note?:string;details?:{peak_production:number;contract_adjustment:number}};
type Snapshot={team:string;date:string;total:number;reporting_cap:number;closed:boolean;vintage:'reconstructed'|'published';assets:Asset[];moves:{date:string;label:string;major:boolean}[];bridge?:{key:string;label:string;value:number}[]};
type TeamFile={team:string;method:string;snapshots:Snapshot[]};
type Manifest={generated_at:string;method:string;teams:{team:string;status:string;count:number;latest:string|null;path:string|null}[]};
const money=(v:number)=>`${v<0?'−':''}$${(Math.abs(v)/1e6).toLocaleString(undefined,{maximumFractionDigits:1})}M`;
async function read<T,>(url:string,signal:AbortSignal):Promise<T>{const r=await fetch(url,{cache:'no-cache',signal});if(!r.ok)throw Error(`Asset data unavailable (${r.status})`);return r.json();}
export function AssetHistoryWorkspace(){
 const [manifest,setManifest]=useState<Manifest|null>(null),[file,setFile]=useState<TeamFile|null>(null),[team,setTeam]=useState('UTA'),[selected,setSelected]=useState(''),[error,setError]=useState(''),[query,setQuery]=useState(''),[kind,setKind]=useState('all');
 const [revision,setRevision]=useState(0);
 useEffect(()=>{const f=()=>setRevision(x=>x+1);const timer=window.setInterval(f,60000);window.addEventListener('focus',f);return()=>{clearInterval(timer);window.removeEventListener('focus',f);};},[]);
 useEffect(()=>{const c=new AbortController();read<Manifest>('/data/asset_history/v1/manifest.json',c.signal).then(m=>{setManifest(m);setError('');}).catch(e=>{if(!c.signal.aborted)setError(String(e.message));});return()=>c.abort();},[revision]);
 const path=manifest?.teams.find(t=>t.team===team)?.path;
 useEffect(()=>{setFile(null);setSelected('');setQuery('');setError('');},[team]);
 useEffect(()=>{if(!path)return;const c=new AbortController();read<TeamFile>(path,c.signal).then(x=>{setFile(x);setSelected(d=>x.snapshots.some(s=>s.date===d)?d:x.snapshots[x.snapshots.length-1]?.date??'');setError('');}).catch(e=>{if(!c.signal.aborted)setError(String(e.message));});return()=>c.abort();},[path,manifest?.generated_at]);
 const points=file?.team===team?file.snapshots:[];const index=Math.max(0,points.findIndex(s=>s.date===selected));const current=points[index];const previous=points[index-1];
 const values=points.map(s=>s.total);const low=Math.min(...values),high=Math.max(...values);const pad=Math.max((high-low)*.12,1e6);const min=low-pad,max=high+pad;
 const first=points.length?Date.parse(points[0].date):0,last=points.length?Date.parse(points[points.length-1]!.date):1;
 const x=(s:Snapshot)=>70+((Date.parse(s.date)-first)/Math.max(1,last-first))*910;
 const y=(s:Snapshot)=>265-(s.total-min)/Math.max(1,max-min)*220;
 const chart=points.map((s,i)=>`${i?'L':'M'}${x(s)},${y(s)}`).join(' ');
 const assets=current?.assets.filter(a=>(kind==='all'||a.kind===kind)&&a.name.toLowerCase().includes(query.toLowerCase())).sort((a,b)=>b.value-a.value)??[];
 const players=current?.assets.filter(a=>a.kind==='player').reduce((s,a)=>s+a.value,0)??0;
 return <main className="asset-history workspace"><header className="ah-heading"><div><span className="ah-eyebrow">FOUR-SEASON ASSET INVENTORY</span><h1>Asset history</h1><p>Explore how a team’s players and draft rights change in value over time.</p></div><label>Team<select value={team} onChange={e=>setTeam(e.target.value)}>{manifest?.teams.map(t=><option key={t.team} value={t.team}>{t.team}{t.status==='pending_backfill'?' · awaiting history':''}</option>)}</select></label></header>
 <details className="ah-method"><summary>Valuation and update method</summary><p>Season value = production + 0.8 × (production − salary). All dollars use the same reporting cap. Player quotes use the best two season-equivalents of production × 2, plus contract adjustments across exactly four rolling season-equivalents. Picks use expected production and rookie salary costs; protections and swaps use joint outcomes. Full inventory includes automatic own-pick horizon additions.</p><p>The latest daily estimate is provisional. A validated month-end observation is preserved; missing month-end observations are never filled with a later date. Historical reconstructions are labeled separately from snapshots recorded when published. Model corrections require a new version. Inventory changes include forecast changes and automatic additions, so they are not a causal front-office grade.</p></details>
 {error&&<p role="alert" className="ah-message">{error} <button onClick={()=>setRevision(r=>r+1)}>Retry</button></p>}
 {!manifest&&!error&&<p role="status">Loading coverage…</p>}
 {manifest&&!path&&<section className="ah-message"><h2>{team} history is awaiting reconstruction</h2><p>Monthly SKILL, dated contract terms, pick rights and injury outlooks must pass coverage checks before this team’s totals can be compared. Missing inventory is not shown as zero.</p></section>}
 {path&&!current&&!error&&<p role="status">Loading {team} inventory…</p>}
 {current&&<><div className="ah-stats"><div><span>Total inventory</span><strong>{money(current.total)}</strong></div><div><span>Players</span><strong>{money(players)}</strong></div><div><span>Draft rights</span><strong>{money(current.total-players)}</strong></div><div><span>Change since previous snapshot</span><strong>{previous?money(current.total-previous.total):'Baseline'}</strong></div></div>
 <section className="ah-chart"><div className="ah-chart-heading"><label>Snapshot<select value={current.date} onChange={e=>setSelected(e.target.value)}>{points.map(s=><option key={s.date} value={s.date}>{s.date}{s.closed?' · month end':' · provisional'}</option>)}</select></label><span>{current.vintage==='reconstructed'?'Historical reconstruction':'Recorded at publication'} · {current.closed?'Preserved month end':'Provisional estimate'} · {(current.reporting_cap/1e6).toFixed(3)}M reporting cap</span></div>
 <p className="ah-chart-legend">Larger markers indicate major moves. Select a point or use the date control to inspect its inventory.</p>
 <svg viewBox="0 0 1000 310" role="img" aria-label={`${team} asset inventory over time. Select a snapshot using the date control.`}>
 {[0,.5,1].map(t=><g key={t}><line x1="70" x2="980" y1={265-t*220} y2={265-t*220} stroke="currentColor" opacity=".12"/><text x="4" y={270-t*220}>{money(min+t*(max-min))}</text></g>)}
 <path d={chart} fill="none" stroke="#6bd4c3" strokeWidth="3"/>
 {points.map(s=><g key={s.date}><circle cx={x(s)} cy={y(s)} r={s.date===current.date?6:s.moves.some(m=>m.major)?4:2} fill={s.date===current.date?'#fff':'#6bd4c3'}><title>{s.date}: {money(s.total)}{s.moves.filter(m=>m.major).map(m=>' · '+m.label).join('')}</title></circle><circle cx={x(s)} cy={y(s)} r="12" fill="transparent" onClick={()=>setSelected(s.date)} style={{cursor:'pointer'}}/></g>)}
 <text x="70" y="300">{points[0].date}</text><text x="980" y="300" textAnchor="end">{points[points.length-1]!.date}</text>
 </svg><input aria-label="Explore snapshots" type="range" min="0" max={points.length-1} value={index} onChange={e=>setSelected(points[Number(e.target.value)].date)}/></section>
 <div className="ah-columns"><section><h2>Moves during this interval</h2>{current.moves.length?<ul>{current.moves.map((m,i)=><li key={i}><time>{m.date}</time> {m.label}</li>)}</ul>:<p>No annotated moves.</p>}</section><section><h2>What changed</h2>{current.bridge?.length?<ul>{current.bridge.map(c=><li key={c.key}><span>{c.label}</span><strong>{money(c.value)}</strong></li>)}</ul>:<p>Opening inventory.</p>}</section></div>
 <section><div className="ah-filters"><h2>Inventory · {current.date}</h2><input aria-label="Search assets" placeholder="Find a player or pick" value={query} onChange={e=>setQuery(e.target.value)}/><select aria-label="Asset category" value={kind} onChange={e=>setKind(e.target.value)}><option value="all">All assets</option><option value="player">Players</option><option value="pick">Draft rights</option></select></div><div className="ah-table"><table><thead><tr><th>Asset</th><th>Type</th><th>Four-year quote</th><th>Details</th></tr></thead><tbody>{assets.map(a=><tr key={a.id}><td>{a.name}</td><td>{a.kind}</td><td>{money(a.value)}</td><td>{a.details?`Production ${money(a.details.peak_production)}; contract adjustment ${money(a.details.contract_adjustment)}. `:''}{a.note}<small>{a.source}</small></td></tr>)}</tbody></table></div></section>
 <footer><a href={path??undefined} download>Download {team} history</a> · Data through {points[points.length-1]!.date} · Method {file?.method}</footer></>}
 </main>;
}
