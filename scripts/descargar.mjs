// Descarga los pronósticos para Dolores, Soriano, Uruguay (-33.53, -58.217) y escribe data.json.
// Fuentes: Open-Meteo (GFS, ECMWF, ICON, GEM, ensambles, historial) y MET Noruega (yr.no).
import { writeFileSync } from 'node:fs';

const LAT=-33.53,LON=-58.217,TZ='America/Montevideo',OFF_H=-3,LEADS=[1,3,5,7];
const isNum=v=>typeof v==='number'&&isFinite(v);const sum=a=>a.reduce((s,v)=>s+v,0);const mean=a=>a.length?sum(a)/a.length:null;
const r1=v=>isNum(v)?Math.round(v*10)/10:null;const r0=v=>isNum(v)?Math.round(v):null;
const isoDay=d=>d.toISOString().slice(0,10);const localNow=()=>new Date(Date.now()+OFF_H*3600e3);
const addDays=(s,n)=>{const d=new Date(s+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return isoDay(d)};
const UA={'User-Agent':'pronostico-dolores/1.0 github.com/actions'};
async function J(url){
  for(let i=0;i<3;i++){
    try{const r=await fetch(url,{headers:UA});const j=await r.json();if(j.error)throw new Error(j.reason);if(!r.ok)throw new Error('HTTP '+r.status);return j}
    catch(e){if(i===2)throw e;await new Promise(s=>setTimeout(s,5000))}
  }
}
const vecMean=(degs)=>{let x=0,y=0,n=0;degs.forEach(d=>{if(isNum(d)){x+=Math.sin(d*Math.PI/180);y+=Math.cos(d*Math.PI/180);n++}});return n?((Math.atan2(x,y)*180/Math.PI)+360)%360:null};

const now=localNow();const D0=isoDay(now);
const t0=now.toISOString().slice(0,11)+String(Math.floor(now.getUTCHours()/6)*6).padStart(2,'0')+':00';
const t0ms=new Date(t0+':00Z').getTime();const NH=79;
const hIdx=t=>Math.round((new Date(t+':00Z').getTime()-t0ms)/3600e3);
const D={gen:new Date().toISOString(),t0,det:{},err:[]};

const DET={gfs:'gfs_seamless',ecmwf:'ecmwf_ifs025',icon:'icon_seamless',gem:'gem_seamless',aifs:'ecmwf_aifs025_single',aigfs:'ncep_aigfs025',ukmo:'ukmo_seamless',arpege:'meteofrance_seamless',jma:'jma_seamless',cma:'cma_grapes_global'};
for(const [id,m] of Object.entries(DET)){try{
 const j=await J(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&timezone=${TZ}&forecast_days=16&models=${m}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant&hourly=precipitation,temperature_2m,wind_speed_10m`);
 const d=j.daily,h=j.hourly;let n=d.time.length;while(n>0&&!isNum(d.precipitation_sum[n-1]))n--;
 const H={p:Array(NH).fill(null),t:Array(NH).fill(null),w:Array(NH).fill(null)};
 h.time.forEach((t,i)=>{const k=hIdx(t);if(k>=0&&k<NH){H.p[k]=r1((h.precipitation||[])[i]);H.t[k]=r1((h.temperature_2m||[])[i]);H.w[k]=r0((h.wind_speed_10m||[])[i])}});
 D.det[id]={d:{time:d.time.slice(0,n),p:d.precipitation_sum.slice(0,n).map(r1),tmax:d.temperature_2m_max.slice(0,n).map(r1),tmin:d.temperature_2m_min.slice(0,n).map(r1),w:d.wind_speed_10m_max.slice(0,n).map(r0),g:(d.wind_gusts_10m_max||[]).slice(0,n).map(r0),dir:(d.wind_direction_10m_dominant||[]).slice(0,n).map(r0)},h:H};
}catch(e){D.err.push(id+':'+e.message)}}

try{const j=await J(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-33.53&lon=-58.22`);
 const H={p:Array(NH).fill(null),t:Array(NH).fill(null),w:Array(NH).fill(null)};const days={};
 j.properties.timeseries.forEach(e=>{const lt=new Date(new Date(e.time).getTime()+OFF_H*3600e3).toISOString().slice(0,13)+':00';const day=lt.slice(0,10);const det=e.data.instant.details;
  const p1=e.data.next_1_hours?.details?.precipitation_amount,p6=e.data.next_6_hours?.details?.precipitation_amount;const p=isNum(p1)?p1:(isNum(p6)?p6:null);
  const k=hIdx(lt);if(k>=0&&k<NH){H.p[k]=r1(p);H.t[k]=r1(det.air_temperature);H.w[k]=r0(det.wind_speed*3.6)}
  const X=days[day]||(days[day]={p:0,t:[],w:[],dir:[]});if(isNum(p))X.p+=p;X.t.push(det.air_temperature);X.w.push(det.wind_speed*3.6);X.dir.push(det.wind_from_direction)});
 const keys=Object.keys(days).sort().filter(k=>days[k].t.length>=3);
 D.det.yr={d:{time:keys,p:keys.map(k=>r1(days[k].p)),tmax:keys.map(k=>r1(Math.max(...days[k].t))),tmin:keys.map(k=>r1(Math.min(...days[k].t))),w:keys.map(k=>r0(Math.max(...days[k].w))),g:keys.map(()=>null),dir:keys.map(k=>r0(vecMean(days[k].dir)))},h:H};
}catch(e){D.err.push('yr:'+e.message)}

const ENS={gfs:'gfs_seamless',ecmwf:'ecmwf_ifs025',icon:'icon_seamless',gem:'gem_global',aifs:'ecmwf_aifs025',aigfs:'ncep_aigefs025',ukmo:'ukmo_global_ensemble_20km'};
const days35=[];for(let i=0;i<35;i++)days35.push(addDays(D0,i));
const E={};
for(const [id,m] of Object.entries(ENS)){try{const j=await J(`https://ensemble-api.open-meteo.com/v1/ensemble?latitude=${LAT}&longitude=${LON}&timezone=${TZ}&forecast_days=35&models=${m}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,wind_speed_10m_max`);
 const d=j.daily;const g=b=>Object.keys(d).filter(k=>k===b||k.startsWith(b+'_member')).map(k=>days35.map(day=>{const i=d.time.indexOf(day);return i<0?null:d[k][i]}));
 E[id]={p:g('precipitation_sum'),tx:g('temperature_2m_max'),tn:g('temperature_2m_min'),w:g('wind_speed_10m_max')}}catch(e){D.err.push('ens '+id+':'+e.message)}}
const ensD={time:days35,m:{},p1:[],p10:[]};
for(const id in E){ensD.m[id]={};for(const k of ['p','tx','tn','w'])ensD.m[id][k]=days35.map((_,i)=>{const v=E[id][k].map(a=>a[i]).filter(isNum);return v.length?(k==='w'?r0(mean(v)):r1(mean(v))):null})}
days35.forEach((_,i)=>{const pool=[];for(const id in E)E[id].p.forEach(a=>{if(isNum(a[i]))pool.push(a[i])});ensD.p1.push(pool.length?r0(100*pool.filter(v=>v>=1).length/pool.length):null);ensD.p10.push(pool.length?r0(100*pool.filter(v=>v>=10).length/pool.length):null)});
const ensW=[];for(let w=0;w<5;w++){const idx=[0,1,2,3,4,5,6].map(i=>w*7+i);const W={s:days35[w*7],m:{},pr:null};const pool=[];
 for(const id in E){const full=k=>E[id][k].filter(a=>idx.every(i=>isNum(a[i]))).map(a=>idx.map(i=>a[i]));const P=full('p');if(!P.length)continue;const sums=P.map(sum);pool.push(...sums);
  W.m[id]={p:r1(mean(sums)),tx:r1(mean(full('tx').map(mean))),tn:r1(mean(full('tn').map(mean))),w:r0(mean(full('w').map(a=>Math.max(...a))))}}
 if(pool.length)W.pr=[10,25,50].map(t=>r0(100*pool.filter(v=>v>=t).length/pool.length));W.n=pool.length;ensW.push(W)}
const p30=[];for(const id in E)E[id].p.forEach(a=>{const v=a.slice(0,30);if(v.every(isNum))p30.push(sum(v))});
D.ensD=ensD;D.ensW=ensW;D.ens30={pr50:p30.length?r0(100*p30.filter(v=>v>=50).length/p30.length):null,n:p30.length};

const vs=addDays(D0,-66),ve=addDays(D0,-1);
try{
const a=await J(`https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&timezone=${TZ}&models=era5&start_date=${vs}&end_date=${ve}&daily=precipitation_sum,temperature_2m_max,wind_speed_10m_max`);
let nObs=a.daily.time.length;while(nObs>0&&!isNum(a.daily.precipitation_sum[nObs-1]))nObs--;
const odays=a.daily.time.slice(0,nObs);
D.obs={start:vs,p:a.daily.precipitation_sum.slice(0,nObs).map(r1),t:a.daily.temperature_2m_max.slice(0,nObs).map(r1),w:a.daily.wind_speed_10m_max.slice(0,nObs).map(r0)};
const vars=[];LEADS.forEach(l=>vars.push('precipitation_previous_day'+l,'temperature_2m_previous_day'+l,'wind_speed_10m_previous_day'+l));
D.prev={};
for(const [id,m] of Object.entries(DET)){try{const r=await J(`https://previous-runs-api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&timezone=${TZ}&models=${m}&start_date=${vs}&end_date=${ve}&hourly=${vars.join(',')}`);const h=r.hourly;D.prev[id]={};
 for(const l of LEADS){const P=h['precipitation_previous_day'+l]||[],T=h['temperature_2m_previous_day'+l]||[],W=h['wind_speed_10m_previous_day'+l]||[];const dd={};
  h.time.forEach((t,i)=>{const k=t.slice(0,10);const X=dd[k]||(dd[k]={p:[],t:[],w:[]});if(isNum(P[i]))X.p.push(P[i]);if(isNum(T[i]))X.t.push(T[i]);if(isNum(W[i]))X.w.push(W[i])});
  const ok=odays.some(k=>dd[k]&&dd[k].p.length>=24);if(!ok)continue;
  D.prev[id][l]={p:odays.map(k=>dd[k]&&dd[k].p.length>=24?r1(sum(dd[k].p)):null),t:odays.map(k=>dd[k]&&dd[k].t.length>=20?r1(Math.max(...dd[k].t)):null),w:odays.map(k=>dd[k]&&dd[k].w.length>=20?r0(Math.max(...dd[k].w)):null)}}}catch(e){D.err.push('prev '+id+':'+e.message)}}
}catch(e){D.err.push('obs:'+e.message)}

if(!Object.keys(D.det).length){console.error('Sin datos de ningún modelo:',D.err);process.exit(1)}
writeFileSync('data.json',JSON.stringify(D));
console.log('data.json escrito. Modelos:',Object.keys(D.det).join(', '),'| errores:',D.err.length?D.err.join('; '):'ninguno');
