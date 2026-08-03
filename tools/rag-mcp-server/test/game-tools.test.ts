import assert from 'node:assert/strict';
import test from 'node:test';
import { buildGameMarketingPrompt } from '../src/game-tools.js';

test('buildGameMarketingPrompt includes coding plan requirements', () => {
  const prompt = buildGameMarketingPrompt('plan', {
    activity: '周年庆抽奖活动',
    region: 'TW/SEA',
    platform: 'H5',
    product: '示例游戏',
  });

  assert.match(prompt, /周年庆抽奖活动/);
  assert.match(prompt, /页面结构/);
  assert.match(prompt, /埋点/);
  assert.match(prompt, /AI Coding/);
});

test('buildGameMarketingPrompt marks missing evidence boundary', () => {
  const prompt = buildGameMarketingPrompt('region-check', {
    activity: '海外官网预约活动',
  });

  assert.match(prompt, /待确认/);
  assert.match(prompt, /本地化/);
});
