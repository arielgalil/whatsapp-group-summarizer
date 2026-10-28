import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMeminfo, parseWireless, parseThrottled, detectEvents, parseNetshWlan, parsePmsetBattery, parseWindowsSensors, cpuPctBetween } from '../device.js';

test('meminfo: used percentages from real Pi values', () => {
  const text = 'MemTotal:         439592 kB\nMemAvailable:     227032 kB\nSwapTotal:        102396 kB\nSwapFree:          70232 kB\n';
  const m = parseMeminfo(text);
  assert.equal(m.memUsedPct, 48);
  assert.equal(m.swapUsedPct, 31);
});

test('meminfo: no swap gives null, not NaN', () => {
  assert.equal(parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 500 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n').swapUsedPct, null);
});

test('wireless: quality and signal from /proc/net/wireless', () => {
  const text = 'Inter-| sta-|   Quality        |   Discarded packets\n face | tus | link level noise |  nwid\n wlan0: 0000   42.  -68.  -256        0      0      0      9      0        0\n';
  assert.deepEqual(parseWireless(text, 'wlan0'), { linkQuality: 42, signalDbm: -68 });
});

test('wireless: missing interface gives null', () => {
  assert.equal(parseWireless('Inter-|\n face\n', 'wlan0'), null);
});

test('throttled: 0x0 means nothing happened', () => {
  const t = parseThrottled('throttled=0x0');
  assert.equal(t.underVoltageNow, false);
  assert.equal(t.tempLimitNow, false);
  assert.equal(t.throttledSinceBoot, false);
});

test('throttled: bits decode to now and since-boot flags', () => {
  const t = parseThrottled('throttled=0x50005');
  assert.equal(t.underVoltageNow, true);
  assert.equal(t.throttledNow, true);
  assert.equal(t.underVoltageSinceBoot, true);
  assert.equal(t.throttledSinceBoot, true);
  assert.equal(t.tempLimitNow, false);
});

test('events: a change is recorded once, a steady condition is not', () => {
  const prev = { t: 1, carrierUp: true, throttle: { underVoltageNow: false, tempLimitNow: false }, wa: { acc1: true, acc2: false } };
  const cur = { t: 2, carrierUp: false, throttle: { underVoltageNow: true, tempLimitNow: false }, wa: { acc1: false, acc2: true } };
  const types = detectEvents(prev, cur).map(e => e.type).sort();
  assert.deepEqual(types, ['under_voltage', 'wa_down', 'wa_up', 'wifi_down'].sort());
  assert.deepEqual(detectEvents(cur, { ...cur, t: 3 }), []);
});

test('events: wa_down names the account', () => {
  const ev = detectEvents({ t: 1, wa: { acc1: true } }, { t: 2, wa: { acc1: false } });
  assert.deepEqual(ev, [{ t: 2, type: 'wa_down', account: 'acc1' }]);
});

test('events: an unknown wifi state (null) is not a drop', () => {
  assert.deepEqual(detectEvents({ t: 1, carrierUp: true }, { t: 2, carrierUp: null }), []);
});

test('netsh: English and Hebrew Windows output', () => {
  const en = '    State                  : connected\n    SSID                   : Home\n    Signal                 : 84%\n';
  assert.deepEqual(parseNetshWlan(en), { connected: true, signalPct: 84 });
  const he = '    מצב                    : מחובר\n    SSID                   : Home\n    אות                    : 61%\n';
  assert.deepEqual(parseNetshWlan(he), { connected: true, signalPct: 61 });
  assert.equal(parseNetshWlan('    State                  : disconnected\n').connected, false);
});

test('pmset: battery percentage on a MacBook', () => {
  const out = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=1234)\t87%; discharging; 3:12 remaining present: true\n";
  assert.deepEqual(parsePmsetBattery(out), { pct: 87 });
  assert.equal(parsePmsetBattery('No batteries'), null);
});

test('windows sensors: tenths of Kelvin to Celsius, null when missing', () => {
  assert.deepEqual(parseWindowsSensors('{"temp":3000,"bat":72}'), { tempC: 26.9, batteryPct: 72 });
  assert.deepEqual(parseWindowsSensors('{"temp":null,"bat":null}'), { tempC: null, batteryPct: null });
  assert.deepEqual(parseWindowsSensors('not json'), { tempC: null, batteryPct: null });
});

test('cpu: percent busy between two readings', () => {
  const cpu = (idle, busy) => [{ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }];
  assert.equal(cpuPctBetween(cpu(100, 100), cpu(150, 150)), 50);
  assert.equal(cpuPctBetween(cpu(100, 100), cpu(100, 100)), null);
});
