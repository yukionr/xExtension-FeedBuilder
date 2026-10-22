import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchDocument} from '../renderer/render.mjs';
test('static fetch refuses localhost before connecting',()=>assert.rejects(fetchDocument('http://127.0.0.1/')));

import {ServiceError,errorResponse} from '../renderer/errors.mjs';
test('service errors expose a translation key and interpolation arguments',()=>{
 assert.deepEqual(errorResponse(new ServiceError('upstream_status',404)),{error:'Upstream HTTP 404',errorCode:'upstream_status',errorArgs:[404]});
 assert.deepEqual(errorResponse(new Error('fixture failure')),{error:'fixture failure'});
});
test('network errors retain their translation key',()=>assert.rejects(fetchDocument('http://127.0.0.1/'),error=>error.errorCode==='private_address'));
