import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fetchDocument} from '../renderer/render.mjs';
test('static fetch refuses localhost before connecting',()=>assert.rejects(fetchDocument('http://127.0.0.1/')));
