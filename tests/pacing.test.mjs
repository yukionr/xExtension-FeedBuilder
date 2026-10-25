import {test} from 'node:test';
import assert from 'node:assert/strict';
import {HostPacing} from '../renderer/pacing.mjs';

function fixture() {
 let time=100000;
 const waits=[];
 const pacing=new HostPacing({now:()=>time,sleep:async ms=>{waits.push(ms);time+=ms;}});
 return {pacing,waits,advance:ms=>{time+=ms;},now:()=>time};
}
test('space requests per hostname, shared across protocols, without delaying other hosts',async()=>{
 const {pacing,waits}=fixture();
 await pacing.acquire('https://example.test/');
 await pacing.acquire('http://example.test/article');
 await pacing.acquire('https://other.test/');
 assert.deepEqual(waits,[2000]);
});
test('concurrent callers reserve separate request slots',async()=>{
 let time=0;const pending=[];
 const pacing=new HostPacing({now:()=>time,sleep:ms=>new Promise(resolve=>pending.push({ms,resolve}))});
 await pacing.acquire('https://example.test/');
 const second=pacing.acquire('https://example.test/2');
 const third=pacing.acquire('https://example.test/3');
 assert.deepEqual(pending.map(p=>p.ms),[2000,4000]);
 time=2000;pending[0].resolve();await second;
 time=4000;pending[1].resolve();await third;
});
for(const status of [429,503]) test(`${status} pauses only the affected host and resumes after cooldown`,async()=>{
 const {pacing,advance}=fixture();
 pacing.observe('https://example.test/',status);
 assert.throws(()=>pacing.check('http://example.test/next'),new RegExp(`HTTP ${status}`));
 await assert.rejects(pacing.acquire('https://example.test/next'),new RegExp(`HTTP ${status}`));
 await pacing.acquire('https://other.test/');
 advance(60000);
 await pacing.acquire('https://example.test/');
});
test('respect Retry-After seconds and HTTP dates, with a minimum cooldown for invalid or short values',()=>{
 for(const header of ['120',new Date(220000).toUTCString()]) {
  const {pacing,advance}=fixture();
  pacing.observe('https://example.test/',503,header);
  advance(119999);assert.throws(()=>pacing.check('https://example.test/'));
  advance(1);pacing.check('https://example.test/');
 }
 for(const header of [undefined,'invalid','0','-1','1.5',new Date(0).toUTCString()]) {
  const {pacing,advance}=fixture();
  pacing.observe('https://example.test/',429,header);
  advance(59999);assert.throws(()=>pacing.check('https://example.test/'));
  advance(1);pacing.check('https://example.test/');
 }
});
test('successful responses do not shorten cooldowns and later errors do not shorten Retry-After',()=>{
 const {pacing,advance}=fixture();
 pacing.observe('https://example.test/',503,'120');
 pacing.observe('https://example.test/',200);
 pacing.observe('https://example.test/',429,'1');
 advance(60000);assert.throws(()=>pacing.check('https://example.test/'));
 advance(60000);pacing.check('https://example.test/');
});
test('queued requests recheck cooldown before sending',async()=>{
 let resume;let time=0;
 const pacing=new HostPacing({now:()=>time,sleep:()=>new Promise(resolve=>{resume=resolve;})});
 await pacing.acquire('https://example.test/');
 const queued=pacing.acquire('https://example.test/next');
 pacing.observe('https://example.test/',503);
 time=2000;resume();
 await assert.rejects(queued,/HTTP 503/);
});
test('do not wait past a request deadline',async()=>{
 const {pacing,now,waits}=fixture();
 await pacing.acquire('https://example.test/');
 await assert.rejects(pacing.acquire('https://example.test/',now()+1000),/Fetch timed out/);
 assert.deepEqual(waits,[]);
});
