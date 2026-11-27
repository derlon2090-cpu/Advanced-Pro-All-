import test from 'node:test';
import assert from 'node:assert/strict';
import { extractApprovalDeviceInfo, parseDetailedDeviceInfo } from '../lib/device-info.js';

test('recognizes iPhone Safari and iOS version', () => {
  const info = parseDetailedDeviceInfo('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Version/18.1 Mobile/15E148 Safari/604.1');
  assert.equal(info.category, 'mobile');
  assert.equal(info.deviceType, 'جوال iPhone');
  assert.equal(info.os, 'iOS 18');
  assert.equal(info.browser, 'Safari');
});

test('recognizes Android and Samsung Internet', () => {
  const info = parseDetailedDeviceInfo('Mozilla/5.0 (Linux; Android 15; SM-S928B) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36 SamsungBrowser/27.0');
  assert.equal(info.deviceType, 'جوال Android');
  assert.equal(info.os, 'Android 15');
  assert.equal(info.browser, 'Samsung Internet');
});

test('uses Chromium Client Hints to distinguish Windows 11', () => {
  const info = parseDetailedDeviceInfo('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36', { platform: 'Windows', platformVersion: '15.0.0', brands: [{ brand: 'Google Chrome' }] });
  assert.equal(info.deviceType, 'كمبيوتر Windows 11');
  assert.equal(info.browser, 'Chrome');
});

test('recognizes Mac and approval-mail device hints', () => {
  const info = parseDetailedDeviceInfo('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Version/17.6 Safari/605.1.15');
  assert.equal(info.deviceType, 'جهاز Mac');
  assert.equal(info.os, 'macOS 14');
  assert.deepEqual(extractApprovalDeviceInfo('New login from Chrome on Windows'), { device: 'Windows', browser: 'Chrome', label: 'Windows • Chrome' });
});
