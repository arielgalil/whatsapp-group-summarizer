// Device health for any machine that runs the summarizer: Raspberry Pi (Linux), other Linux, Windows, macOS, Android (Termux).
// Every reading is optional: a metric the machine does not expose comes back null, and the page shows only what exists.
// Read-only: files, OS counters and a few system commands. Nothing is written or changed.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';

/* ---------- pure parsers (tested with text from each system) ---------- */

export function parseMeminfo(text) {
  const kb = name => {
    const m = text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) : 0;
  };
  const total = kb('MemTotal');
  const avail = kb('MemAvailable');
  const swapTotal = kb('SwapTotal');
  const swapFree = kb('SwapFree');
  return {
    memUsedPct: total ? Math.round((1 - avail / total) * 100) : null,
    swapUsedPct: swapTotal ? Math.round((1 - swapFree / swapTotal) * 100) : null,
  };
}

// /proc/net/wireless: "wlan0: 0000   42.  -68.  -256 ..." (quality, signal dBm, noise)
export function parseWireless(text, iface) {
  const line = text.split('\n').find(l => l.trim().startsWith(`${iface}:`));
  if (!line) return null;
  const parts = line.split(':')[1].trim().split(/\s+/);
  const quality = parseFloat(parts[1]);
  const signalDbm = parseFloat(parts[2]);
  return {
    linkQuality: Number.isFinite(quality) ? quality : null,
    signalDbm: Number.isFinite(signalDbm) ? signalDbm : null,
  };
}

// "throttled=0x50005": bits 0-3 are happening now, bits 16-19 happened since boot (Raspberry Pi only).
export function parseThrottled(text) {
  const m = text.match(/0x([0-9a-f]+)/i);
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return {
    raw: `0x${m[1]}`,
    underVoltageNow: Boolean(v & 0x1),
    freqCappedNow: Boolean(v & 0x2),
    throttledNow: Boolean(v & 0x4),
    tempLimitNow: Boolean(v & 0x8),
    underVoltageSinceBoot: Boolean(v & 0x10000),
    throttledSinceBoot: Boolean(v & 0x40000),
    tempLimitSinceBoot: Boolean(v & 0x80000),
  };
}

// "netsh wlan show interfaces". The labels follow the Windows display language (English or Hebrew).
export function parseNetshWlan(text) {
  const state = (text.match(/(?:State|מצב)\s*:\s*([^\r\n]+)/) || [])[1] || '';
  const sig = text.match(/(?:Signal|אות)\s*:\s*(\d+)\s*%/);
  const connected = /connected|מחובר/i.test(state) && !/disconnected|מנותק/i.test(state);
  return { connected, signalPct: sig ? Number(sig[1]) : null };
}

// "pmset -g batt" on macOS: "... InternalBattery-0 ... 87%; charging; ..."
export function parsePmsetBattery(text) {
  const m = text.match(/(\d+)%/);
  return m ? { pct: Number(m[1]) } : null;
}

// Windows sensors, read by one PowerShell call that prints { temp: tenths of Kelvin, bat: percent }.
export function parseWindowsSensors(json) {
  let o;
  try { o = JSON.parse(json); } catch (e) { return { tempC: null, batteryPct: null }; }
  const t = o.temp == null ? NaN : Number(o.temp);
  const b = o.bat == null ? NaN : Number(o.bat);
  return {
    tempC: Number.isFinite(t) && t > 0 ? +((t / 10) - 273.15).toFixed(1) : null,
    batteryPct: Number.isFinite(b) ? b : null,
  };
}

// CPU use between two os.cpus() readings, in percent.
export function cpuPctBetween(prev, cur) {
  const sum = cpus => cpus.reduce((acc, c) => {
    const t = c.times;
    acc.idle += t.idle;
    acc.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return acc;
  }, { idle: 0, total: 0 });
  const a = sum(prev); const b = sum(cur);
  const dTotal = b.total - a.total;
  if (dTotal <= 0) return null;
  return Math.round((1 - (b.idle - a.idle) / dTotal) * 100);
}

// Only the changes between two samples become events, so a condition that stays on is recorded once.
export function detectEvents(prev, cur) {
  const out = [];
  const add = (type, extra = {}) => out.push({ t: cur.t, type, ...extra });
  if (prev.carrierUp === true && cur.carrierUp === false) add('wifi_down');
  if (prev.carrierUp === false && cur.carrierUp === true) add('wifi_up');
  const pt = prev.throttle || {}; const ct = cur.throttle || {};
  if (!pt.underVoltageNow && ct.underVoltageNow) add('under_voltage');
  if (!pt.tempLimitNow && ct.tempLimitNow) add('temp_limit');
  for (const [id, up] of Object.entries(cur.wa || {})) {
    const was = (prev.wa || {})[id];
    if (was === true && up === false) add('wa_down', { account: id });
    if (was === false && up === true) add('wa_up', { account: id });
  }
  return out;
}

/* ---------- readers ---------- */

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}

// Runs a system command with a short timeout. A missing command or a failure gives null.
function run(cmd, args, timeout = 4000) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, out) => resolve(err ? null : String(out)));
  });
}

// Slow readings (PowerShell, pmset) are refreshed at most once a minute.
let slow = { t: 0, val: {} };
async function slowReadings() {
  if (Date.now() - slow.t < 60 * 1000) return slow.val;
  const val = {};
  if (process.platform === 'win32') {
    const script = "$t=Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -EA 0 | Select-Object -First 1 -ExpandProperty CurrentTemperature; $b=Get-CimInstance Win32_Battery -EA 0 | Select-Object -First 1 -ExpandProperty EstimatedChargeRemaining; [pscustomobject]@{temp=$t;bat=$b} | ConvertTo-Json -Compress";
    Object.assign(val, parseWindowsSensors((await run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], 8000)) || ''));
  } else if (process.platform === 'darwin') {
    const batt = parsePmsetBattery((await run('pmset', ['-g', 'batt'])) || '');
    val.batteryPct = batt ? batt.pct : null;
  }
  slow = { t: Date.now(), val };
  return val;
}

function linuxThermalC() {
  let dir;
  try { dir = fs.readdirSync('/sys/class/thermal').filter(d => d.startsWith('thermal_zone')); } catch (e) { return null; }
  const temps = dir.map(d => Number(readText(`/sys/class/thermal/${d}/temp`))).filter(t => t > 0);
  return temps.length ? +(Math.max(...temps) / 1000).toFixed(1) : null;
}

function linuxBatteryPct() {
  let dir;
  try { dir = fs.readdirSync('/sys/class/power_supply').filter(d => d.startsWith('BAT')); } catch (e) { return null; }
  for (const d of dir) {
    const v = Number((readText(`/sys/class/power_supply/${d}/capacity`) || '').trim());
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function linuxWifiInterface() {
  try { return fs.readdirSync('/sys/class/net').find(n => n.startsWith('wl')) || null; } catch (e) { return null; }
}

// What this machine is, for the page header. The Raspberry Pi model comes from the device tree.
export function platformInfo() {
  const names = { win32: 'Windows', linux: 'Linux', darwin: 'macOS', android: 'Android' };
  const model = (readText('/proc/device-tree/model') || '').replace(/\0/g, '').trim();
  return { os: names[process.platform] || process.platform, model: /raspberry/i.test(model) ? model : null, hostname: os.hostname() };
}

export async function readDevice() {
  const linux = process.platform === 'linux' || process.platform === 'android';
  const slowVals = await slowReadings();

  // memory: Linux counts reclaimable cache as available, which matches what the system reports
  let memUsedPct = Math.round((1 - os.freemem() / os.totalmem()) * 100);
  let swapUsedPct = null;
  if (linux) {
    const mi = parseMeminfo(readText('/proc/meminfo') || '');
    if (mi.memUsedPct != null) memUsedPct = mi.memUsedPct;
    swapUsedPct = mi.swapUsedPct;
  }

  // Wi-Fi and connection
  let wifi = null; let carrierUp = null;
  if (linux) {
    const iface = linuxWifiInterface();
    if (iface) {
      const carrier = readText(`/sys/class/net/${iface}/carrier`);
      carrierUp = carrier == null ? null : carrier.trim() === '1';
      wifi = parseWireless(readText('/proc/net/wireless') || '', iface);
    }
  } else if (process.platform === 'win32') {
    const nw = parseNetshWlan((await run('netsh', ['wlan', 'show', 'interfaces'])) || '');
    if (nw.signalPct != null || nw.connected) {
      carrierUp = nw.connected;
      wifi = { signalPct: nw.signalPct };
    }
  }

  // temperature and battery
  let tempC = null; let batteryPct = null;
  if (linux) { tempC = linuxThermalC(); batteryPct = linuxBatteryPct(); }
  else { tempC = slowVals.tempC ?? null; batteryPct = slowVals.batteryPct ?? null; }

  // Raspberry Pi firmware: only where vcgencmd exists
  let throttle = null;
  if (linux) throttle = parseThrottled((await run('vcgencmd', ['get_throttled'], 2000)) || '');

  let disk = null;
  try {
    const st = fs.statfsSync(path.parse(process.cwd()).root);
    disk = { freeGb: +(st.bavail * st.bsize / 1e9).toFixed(1), usedPct: Math.round((1 - st.bavail / st.blocks) * 100) };
  } catch (e) {}

  return {
    t: Date.now(),
    platform: platformInfo(),
    cpuPct: cpuReading(),
    tempC,
    memUsedPct,
    swapUsedPct,
    wifi,
    carrierUp,
    batteryPct,
    throttle,
    disk,
    uptimeH: +(os.uptime() / 3600).toFixed(1),
  };
}

let cpuPrev = null;
function cpuReading() {
  const cur = os.cpus();
  const pct = cpuPrev ? cpuPctBetween(cpuPrev, cur) : null;
  cpuPrev = cur;
  return pct;
}
