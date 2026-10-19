'use strict';

// A single H.264/AAC encoder produces MPEG-TS. Each destination has its own
// lightweight copy-only RTMP remuxer so a failing destination cannot cause
// another platform to re-encode or lose its live program feed.
const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const { buildWebmOutputArgs } = require('./ffmpegRuntime');

const RETRY_MS = [0, 2000, 5000, 10000];
const EBML_HEADER = 0x1a45dfa3;
const MAX_PUBLISH_BUFFER = 6 * 1024 * 1024;
const sanitize = (s) => String(s || '')
  .replace(/rtmps?:\/\/\S+/gi, '[stream destination]')
  .replace(/FB-[\w?&=%.-]+/gi, '[stream key]')
  .slice(-900);

function buildSharedEncoderArgs(output, encoder) {
  const args = buildWebmOutputArgs({ ...output, encoder, outputUrl: 'pipe:1' });
  const flv = args.lastIndexOf('flv');
  if (flv < 0) throw new Error('FFmpeg output format was not found.');
  args[flv] = 'mpegts';
  args.splice(flv - 1, 0, '-mpegts_flags', '+resend_headers', '-muxdelay', '0');
  return args;
}

function buildPublisherArgs(url) {
  return [
    '-hide_banner', '-loglevel', 'warning', '-nostdin',
    '-fflags', '+genpts+discardcorrupt', '-probesize', '1500000',
    '-analyzeduration', '5000000', '-f', 'mpegts', '-i', 'pipe:0',
    '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy',
    '-progress', 'pipe:2', '-stats_period', '1',
    '-rw_timeout', '15000000', '-flvflags', 'no_duration_filesize',
    '-f', 'flv', url
  ];
}

class MultiOutputManager extends EventEmitter {
  constructor(options = {}) {
    super();
    this.spawnProcess = options.spawnProcess || spawn;
    this.setTimeoutImpl = options.setTimeout || setTimeout;
    this.clearTimeoutImpl = options.clearTimeout || clearTimeout;
    this.encoder = null;
    this.targets = new Map();
    this.config = null;
    this.state = 'idle';
    this.stopRequested = false;
    this.waitingForHeader = true;
    this.encoderIndex = 0;
    this.encoderRetries = 0;
    this.encoderTimer = null;
    this.progressBuffer = '';
  }

  diagnostic(category, details = {}) { this.emit('diagnostic', { category, ...details }); }

  emitStatus(state, details = {}) {
    this.diagnostic('state', {state, ...details});
    if (!details.sourceId) this.state = state;
    this.emit('status', { state, ...details });
  }

  get currentEncoder() {
    return this.config?.runtime?.supported?.[this.encoderIndex];
  }

  async start(config) {
    if (!config?.runtime?.available || !config.runtime.executablePath) throw new Error('FFmpeg is not available.');
    if (!config.runtime.supported?.length) throw new Error('No H.264 encoder is available.');
    if (!config.destinations?.length) throw new Error('Choose at least one destination.');
    if (this.state === 'stopping') throw new Error('Wait until the previous stream disconnects.');
    if (this.state === 'idle' || this.state === 'stopped') {
      this.config = { runtime: config.runtime, output: config.output };
      this.encoderIndex = Math.max(0, config.runtime.supported.findIndex(e => e.id === config.runtime.encoder?.id));
      this.stopRequested = false;
      this.encoderRetries = 0;
      this.targets.clear();
      this.startEncoder();
    }
    for (const d of config.destinations) this.addDestination(d);
    return { state: this.state, destinations: [...this.targets.keys()] };
  }

  startEncoder() {
    if (this.stopRequested) return;
    const runtime = this.config.runtime;
    const args = buildSharedEncoderArgs(this.config.output, this.currentEncoder.id);
    this.waitingForHeader = true;
    this.pendingHeaderChunks = [];
    this.pendingHeaderBytes = 0;
    this.progressBuffer = '';
    this.emitStatus('connecting', { message: 'Starting the shared encoder…' });
    const child = this.spawnProcess(runtime.executablePath, args, {
      stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true
    });
    this.encoder = child;
    this.diagnostic('encoder-spawn', {pid:child.pid,encoder:this.currentEncoder.id,argumentCount:args.length});
    child.stdin?.on('error', error => this.diagnostic('encoder-stdin-error',{code:error.code,message:error.message}));
    let encodedBytes=0, lastEncodedLog=0;
    child.stdout?.on('data', chunk => {
      if (this.encoder !== child || this.stopRequested) return;
      encodedBytes += chunk.length;
      if (Date.now()-lastEncodedLog>3000) {lastEncodedLog=Date.now();this.diagnostic('encoder-output',{pid:child.pid,chunkBytes:chunk.length,totalBytes:encodedBytes,targets:this.targets.size});}
      for (const target of this.targets.values()) {
        const sink = target.child?.stdin;
        if (!sink?.writable || sink.destroyed) continue;
        if (sink.writableLength > MAX_PUBLISH_BUFFER) {
          target.error = 'The publisher cannot keep up with the encoded stream.';
          try { target.child.kill(); } catch (_) {}
          continue;
        }
        try { sink.write(chunk); } catch (_) {}
      }
    });
    let errorText = '';
    child.stderr?.on('data', chunk => {
      const str = String(chunk);
      if (/error|failed|invalid|warning|frame=|fps=|bitrate=/i.test(str)) this.diagnostic('encoder-stderr',{pid:child.pid,text:sanitize(str)});
      if (/error|failed|invalid|no capable devices|cannot load/i.test(str)) errorText = sanitize(str);
      this.progressBuffer += str;
      const lines = this.progressBuffer.split(/\r?\n/);
      this.progressBuffer = lines.pop() || '';
      const update = {};
      for (const line of lines) {
        const pivot = line.indexOf('=');
        if (pivot < 0) continue;
        const key = line.slice(0, pivot), value = line.slice(pivot + 1);
        if (key === 'frame') update.frame = Number(value) || 0;
        if (key === 'fps') update.fps = Number(value) || 0;
        if (key === 'bitrate') update.bitrate = value;
      }
      if (Object.keys(update).length) {
        // Encoding frames doesn't mean every destination has accepted RTMP.
        this.emit('status', { state: this.state, ...update });
      }
    });
    child.once('spawn', () => {
      if (this.encoder === child && !this.stopRequested) this.emitStatus('awaiting-input', { message: 'Shared encoder ready.' });
    });
    let done = false;
    const finish = () => {
      if (done || this.encoder !== child) return;
      done = true;
      this.encoder = null;
      if (this.stopRequested) return;
      // All publisher input streams depend on this transport; reconnect each
      // after the encoder has restarted with a new WebM recording header.
      for (const d of this.targets.values()) {
        if (d.timer !== null) this.clearTimeoutImpl(d.timer);
        d.timer = null;
        const prior = d.child;
        d.child = null;
        if (prior) { try { prior.kill(); } catch (_) {} }
      }
      if (/unknown encoder|no capable devices|error while opening encoder|cannot load/i.test(errorText)
        && this.encoderIndex < this.config.runtime.supported.length - 1) this.encoderIndex++;
      const wait = RETRY_MS[Math.min(this.encoderRetries++, RETRY_MS.length - 1)];
      this.emitStatus('reconnecting', { retryInMs: wait, error: errorText || 'Encoder stopped.' });
      this.encoderTimer = this.setTimeoutImpl(() => {
        this.encoderTimer = null;
        if (this.stopRequested) return;
        this.startEncoder();
        for (const target of this.targets.values()) this.startPublisher(target);
      }, wait);
    };
    child.once('error', finish);
    child.once('close', finish);
  }

  addDestination(d) {
    if (this.targets.has(d.id)) return;
    const target = { id: d.id, name: d.name, url: d.outputUrl,
      child: null, timer: null, retry: 0, error: '', state: 'connecting' };
    this.targets.set(d.id, target);
    if (!this.encoderTimer) this.startPublisher(target);
    this.emitStatus('connecting', { sourceId: d.id, name: d.name });
  }

  startPublisher(target) {
    if (this.stopRequested || !this.targets.has(target.id)) return;
    const child = this.spawnProcess(this.config.runtime.executablePath, buildPublisherArgs(target.url), {
      stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true
    });
    target.child = child;
    this.diagnostic('publisher-spawn',{sourceId:target.id,name:target.name,pid:child.pid});
    target.state = 'connecting';
    target.error = '';
    this.emitStatus('connecting', { sourceId: target.id, name: target.name });
    child.stdin?.on('error',error=>this.diagnostic('publisher-stdin-error',{sourceId:target.id,code:error.code,message:error.message}));
    let log = '', completed = false, progress = '', lastProgressLogged=0;
    child.stderr?.on('data', data => {
      const raw = String(data);
      if (/error|failed|invalid|denied|rejected|refused|io error|unable/i.test(raw) || Date.now()-lastProgressLogged>3000) {lastProgressLogged=Date.now();this.diagnostic('publisher-stderr',{sourceId:target.id,pid:child.pid,text:sanitize(raw)});}
      if (/error|failed|invalid|denied|rejected|refused|io error|unable/i.test(raw)) log = sanitize(raw);
      progress += raw;
      const lines = progress.split(/\r?\n/);
      progress = lines.pop() || '';
      for (const line of lines) {
        const pivot = line.indexOf('=');
        if (pivot < 0 || line.slice(0, pivot) !== 'frame') continue;
        if ((Number(line.slice(pivot + 1)) || 0) > 0 && target.state !== 'live') {
          target.state = 'live';
          target.retry = 0;
          this.emitStatus('live', { sourceId: target.id, name: target.name });
        }
      }
    });
    const finish = () => {
      if (completed || target.child !== child) return;
      completed = true;
      target.child = null;
      if (this.stopRequested || !this.targets.has(target.id)) return;
      const delayMs = RETRY_MS[Math.min(target.retry++, RETRY_MS.length - 1)];
      target.state = 'reconnecting';
      target.error = log || target.error || 'Destination closed the connection.';
      this.emitStatus('reconnecting', {
        sourceId: target.id, name: target.name,
        retryInMs: delayMs, error: target.error
      });
      target.timer = this.setTimeoutImpl(() => {
        target.timer = null;
        if (!this.stopRequested && this.targets.has(target.id)) this.startPublisher(target);
      }, delayMs);
    };
    child.once('error', finish);
    child.once('close', finish);
  }

  writeChunk(data) {
    if (this.stopRequested || this.state === 'stopping' || this.state === 'reconnecting') return Promise.resolve(false);
    const input = this.encoder?.stdin;
    if (!input?.writable || input.destroyed) return Promise.resolve(false);
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    this.inputBytes = (this.inputBytes || 0) + chunk.length;
    if (Date.now()-(this.lastInputDiagnostic || 0)>3000) {this.lastInputDiagnostic=Date.now();this.diagnostic('encoder-input',{chunkBytes:chunk.length,totalBytes:this.inputBytes,waitingForHeader:this.waitingForHeader,encoderWritableLength:input.writableLength});}
    let payload = chunk;
    if (this.waitingForHeader) {
      this.pendingHeaderChunks.push(chunk);
      this.pendingHeaderBytes += chunk.length;
      // Chromium may emit a one-byte first WebM chunk. Do not discard it:
      // the remaining EBML magic bytes arrive in the next MediaRecorder blob.
      if (this.pendingHeaderBytes < 4) {
        this.diagnostic('webm-header-fragment',{receivedBytes:this.pendingHeaderBytes});
        return Promise.resolve(true);
      }
      payload = Buffer.concat(this.pendingHeaderChunks, this.pendingHeaderBytes);
      this.pendingHeaderChunks = [];
      this.pendingHeaderBytes = 0;
      if (payload.readUInt32BE(0) !== EBML_HEADER) {
        this.diagnostic('invalid-webm-header',{bytes:payload.length,first16:payload.subarray(0,16).toString('hex')});
        return Promise.resolve(false);
      }
      this.waitingForHeader = false;
      this.diagnostic('webm-header-accepted',{bytes:payload.length,first16:payload.subarray(0,4).toString('hex')});
    }
    return new Promise((resolve, reject) => {
      input.write(payload, err => {
        if (err?.code === 'EPIPE' || err?.code === 'ERR_STREAM_DESTROYED') return resolve(false);
        return err ? reject(err) : resolve(true);
      });
    });
  }

  async stop(id = null) {
    if (id) {
      const target = this.targets.get(id);
      if (!target) return;
      this.targets.delete(id);
      if (target.timer !== null) this.clearTimeoutImpl(target.timer);
      if (target.child) {
        target.child.stdin?.destroy();
        try { target.child.kill(); } catch (_) {}
      }
      this.emitStatus('stopped', { sourceId: id, name: target.name });
      if (this.targets.size) return;
    }
    if (this.state === 'idle' || this.state === 'stopped') return;
    this.stopRequested = true;
    this.emitStatus('stopping');
    if (this.encoderTimer !== null) this.clearTimeoutImpl(this.encoderTimer);
    this.encoderTimer = null;
    for (const target of this.targets.values()) {
      if (target.timer !== null) this.clearTimeoutImpl(target.timer);
      if (target.child) {
        target.child.stdin?.destroy();
        try { target.child.kill(); } catch (_) {}
      }
      this.emitStatus('stopped', { sourceId: target.id, name: target.name });
    }
    this.targets.clear();
    const child = this.encoder;
    this.encoder = null;
    if (child) {
      child.stdin?.destroy();
      try { child.kill(); } catch (_) {}
    }
    this.emitStatus('stopped');
  }

  snapshot() {
    return { state: this.state, sources: [...this.targets.values()].map(({id,name,state,error}) =>
      ({ id, name, state, error })) };
  }
}

module.exports = { MultiOutputManager, buildSharedEncoderArgs, buildPublisherArgs, sanitize };
