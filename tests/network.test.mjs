import {test} from 'node:test';
import assert from 'node:assert/strict';
import {isPublicAddress, resolveTarget} from '../renderer/network.mjs';
for (const ip of ['127.0.0.1','10.0.0.1','192.168.1.1','172.16.0.2','169.254.169.254','100.100.100.100','0.0.0.0','224.1.1.1','198.18.0.1','::1','::ffff:8.8.8.8','fc00::1','fe80::1','2001:db8::1']) test(`reject ${ip}`,()=>assert.equal(isPublicAddress(ip),false));
for (const ip of ['8.8.8.8','1.1.1.1','2606:4700:4700::1111']) test(`public ${ip}`,()=>assert.equal(isPublicAddress(ip),true));
test('reject credentials, protocol, ports and mixed DNS',async()=>{
 for(const url of ['file:///etc/passwd','https://u:p@example.test','https://example.test:8443']) await assert.rejects(resolveTarget(url));
 await assert.rejects(resolveTarget('https://example.test',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
});
test('pin resolved public IP',async()=>assert.equal((await resolveTarget('https://example.test',async()=>[{address:'8.8.8.8',family:4}])).address,'8.8.8.8'));
test('pinned lookup supports Node dual-stack lookup contract',async()=>{
 const {pinnedLookup}=await import('../renderer/network.mjs');
 const lookup=pinnedLookup({address:'8.8.8.8',family:4});
 lookup('example.test',{all:true},(err,addresses)=>assert.deepEqual(addresses,[{address:'8.8.8.8',family:4}]));
 lookup('example.test',{},(err,address,family)=>{assert.equal(address,'8.8.8.8');assert.equal(family,4);});
});
