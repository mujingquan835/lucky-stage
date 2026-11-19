import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beijingInput, beijingToIso } from '../web/src/beijing-time.ts';

test('北京时间填写和回显不随设备时区变化，保留原有绝对时间', () => {
  for (const zone of ['America/Los_Angeles', 'Asia/Shanghai', 'UTC']) {
    process.env.TZ = zone;
    assert.equal(beijingToIso('2026-11-18T09:30'), '2026-11-18T01:30:00.000Z');
    assert.equal(beijingInput('2026-11-18T01:30:00.000Z'), '2026-11-18T09:30');
  }
});
