import {ServiceError} from './errors.mjs';

// Shared by plain fetches, Chromium navigations, and preview image fetches.
export class HostPacing {
 constructor({now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  this.now=now;this.sleep=sleep;this.hosts=new Map();
 }
 state(url) {
  const now=this.now();
  for(const [host,state] of this.hosts) {
   if(state.next<=now && state.until<=now)this.hosts.delete(host);
  }
  const host=new URL(url).hostname;
  if(!this.hosts.has(host))this.hosts.set(host,{next:0,until:0,status:503});
  return this.hosts.get(host);
 }
 check(url) {
  const state=this.state(url);
  if(state.until>this.now())throw new ServiceError('upstream_status',state.status);
 }
 async acquire(url,deadline=Infinity) {
  this.check(url);
  const state=this.state(url),now=this.now();
  const start=Math.max(now,state.next);
  if(start>=deadline)throw new ServiceError('fetch_timeout');
  state.next=start+2000;
  if(start>now)await this.sleep(start-now);
  this.check(url);
  if(this.now()>=deadline)throw new ServiceError('fetch_timeout');
 }
 observe(url,status,retryAfter) {
  if(![429,503].includes(status))return;
  const now=this.now(),state=this.state(url);
  const header=String(retryAfter ?? '').trim();
  const until=/^\d+$/.test(header)?now+Number(header)*1000:/^[a-z]/i.test(header)?Date.parse(header):NaN;
  const next=Math.max(now+60000,Number.isFinite(until)?until:0);
  if(next>=state.until){state.until=next;state.status=status;}
 }
}
export const hostPacing=new HostPacing();
