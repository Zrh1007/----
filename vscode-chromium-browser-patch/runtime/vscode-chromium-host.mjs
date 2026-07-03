import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, readFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const runtimeDirectory = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(await readFile(path.join(runtimeDirectory, 'config.json'), 'utf8'));
const states = new WeakMap();
const liveStates = new Set();
const token = `VSCode Chromium Host ${randomUUID()}`;
const logFile = path.join(runtimeDirectory, 'host.log');

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const log = (message, detail) => {
  const line = `${new Date().toISOString()} ${message}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}\n`;
  appendFile(logFile, line, 'utf8').catch(() => {});
};

class JsonLineProcess {
  constructor(executable) {
    this.sequence = 0;
    this.pending = new Map();
    this.process = spawn(executable, [], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.process.stderr.on('data', value => console.error('[ChromiumPatch helper]', value.toString()));
    readline.createInterface({ input: this.process.stdout }).on('line', line => {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.ok) {
        pending.resolve(message);
      } else {
        pending.reject(new Error(message.error || 'Native helper command failed.'));
      }
    });
    this.process.once('exit', code => {
      log('helper-exit', { code });
      for (const pending of this.pending.values()) {
        pending.reject(new Error(`Native helper exited with code ${code}.`));
      }
      this.pending.clear();
    });
  }

  request(command, payload = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.process.stdin.write(`${JSON.stringify({ id, command, ...payload })}\n`, error => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
  }

  dispose() {
    this.request('shutdown').catch(() => {});
  }
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Set();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out connecting to Chromium CDP.')), 10_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timeout);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', event => {
        clearTimeout(timeout);
        reject(event.error || new Error('Chromium CDP connection failed.'));
      }, { once: true });
    });
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) {
          return;
        }
        this.pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        } else {
          pending.resolve(message.result || {});
        }
        return;
      }
      for (const listener of this.listeners) {
        listener(message);
      }
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) {
        pending.reject(new Error('Chromium CDP connection closed.'));
      }
      this.pending.clear();
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

class ChromiumHost {
  constructor() {
    this.browserProcess = undefined;
    this.client = undefined;
    this.helper = undefined;
    this.starting = undefined;
    this.firstTargetUsed = false;
    this.sessionStates = new Map();
  }

  async ensureStarted() {
    if (this.client) {
      return;
    }
    if (this.starting) {
      return this.starting;
    }
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  async start() {
    log('browser-start-requested', {
      browserExecutable: config.browserExecutable,
      profileDirectory: config.profileDirectory
    });
    await mkdir(config.profileDirectory, { recursive: true });
    const portFile = path.join(config.profileDirectory, 'DevToolsActivePort');
    await rm(portFile, { force: true });
    this.helper = new JsonLineProcess(config.helperExecutable);
    const bootstrap = `data:text/html,${encodeURIComponent(`<title>${token}</title><body style="background:#1e1e1e;color:#ddd;font:16px sans-serif">Starting Chromium…</body>`)}`;
    this.browserProcess = spawn(config.browserExecutable, [
      `--user-data-dir=${config.profileDirectory}`,
      '--remote-debugging-port=0',
      '--remote-debugging-address=127.0.0.1',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--new-window',
      bootstrap
    ], {
      detached: false,
      windowsHide: false,
      stdio: 'ignore'
    });

    const deadline = Date.now() + 20_000;
    let port;
    let browserPath;
    while (Date.now() < deadline) {
      try {
        const lines = (await readFile(portFile, 'utf8')).trim().split(/\r?\n/);
        port = Number(lines[0]);
        browserPath = lines[1];
        if (Number.isInteger(port) && browserPath) {
          break;
        }
      } catch {
        // Chromium has not created the endpoint file yet.
      }
      await delay(100);
    }
    if (!port || !browserPath) {
      throw new Error('Chromium did not expose a DevTools endpoint.');
    }

    this.client = new CdpClient(`ws://127.0.0.1:${port}${browserPath}`);
    await this.client.connect();
    log('cdp-connected', { port, browserPath });
    this.client.onEvent(message => this.onCdpEvent(message));
    await this.client.send('Target.setDiscoverTargets', { discover: true });
  }

  async ensureView(state) {
    await this.ensureStarted();
    if (state.sessionId) {
      return;
    }
    if (state.initializing) {
      return state.initializing;
    }

    state.initializing = (async () => {
      let targetId;
      if (!this.firstTargetUsed) {
        const result = await this.client.send('Target.getTargets');
        const target = result.targetInfos?.find(item => item.type === 'page');
        targetId = target?.targetId;
        this.firstTargetUsed = Boolean(targetId);
      }
      if (!targetId) {
        ({ targetId } = await this.client.send('Target.createTarget', { url: 'about:blank' }));
      }
      const attached = await this.client.send('Target.attachToTarget', { targetId, flatten: true });
      state.targetId = targetId;
      state.sessionId = attached.sessionId;
      log('target-attached', { targetId, sessionId: state.sessionId });
      this.sessionStates.set(state.sessionId, state);
      await this.client.send('Page.enable', {}, state.sessionId);
      await this.client.send('Runtime.enable', {}, state.sessionId);
      await this.client.send('Page.setLifecycleEventsEnabled', { enabled: true }, state.sessionId);
      await this.refreshHistory(state);
    })();
    try {
      await state.initializing;
    } finally {
      state.initializing = undefined;
    }
  }

  async refreshHistory(state) {
    if (!state.sessionId) {
      return;
    }
    const history = await this.client.send('Page.getNavigationHistory', {}, state.sessionId);
    state.history = history;
    const current = history.entries?.find(entry => entry.id === history.currentIndex) ?? history.entries?.[history.currentIndex];
    if (current) {
      state.url = current.url;
      state.title = current.title || state.title;
    }
  }

  async activateAndAttach(state) {
    await this.ensureView(state);
    if (!state.visible || !state.layout || !state.parentHandle) {
      return;
    }
    await this.client.send('Target.activateTarget', { targetId: state.targetId });
    const titleResult = await this.client.send(
      'Runtime.evaluate',
      {
        expression: `(() => { const old = document.title; document.title = ${JSON.stringify(token)}; return old; })()`,
        returnByValue: true
      },
      state.sessionId
    ).catch(() => undefined);
    await delay(50);
    await this.helper.request('attach', {
      parentHandle: state.parentHandle,
      titleToken: token,
      ...state.layout
    });
    log('window-attached', {
      targetId: state.targetId,
      parentHandle: state.parentHandle,
      layout: state.layout
    });
    if (titleResult?.result?.value !== undefined) {
      await this.client.send(
        'Runtime.evaluate',
        { expression: `document.title = ${JSON.stringify(titleResult.result.value)}` },
        state.sessionId
      ).catch(() => {});
    }
    state.owner._view.setVisible(false);
  }

  onCdpEvent(message) {
    const state = this.sessionStates.get(message.sessionId);
    if (!state) {
      if (message.method === 'Target.targetInfoChanged') {
        const targetState = [...liveStates].find(candidate => candidate.targetId === message.params?.targetInfo?.targetId);
        if (targetState) {
          targetState.title = message.params.targetInfo.title || targetState.title;
          targetState.url = message.params.targetInfo.url || targetState.url;
          this.emitNavigation(targetState);
        }
      }
      return;
    }
    switch (message.method) {
      case 'Page.frameStartedLoading':
        state.loading = true;
        state.owner._onDidChangeLoadingState.fire({ loading: true });
        break;
      case 'Page.frameStoppedLoading':
      case 'Page.loadEventFired':
        state.loading = false;
        this.refreshHistory(state).then(() => this.emitNavigation(state)).catch(console.error);
        state.owner._onDidChangeLoadingState.fire({ loading: false });
        break;
      case 'Page.frameNavigated':
        if (!message.params?.frame?.parentId) {
          state.url = message.params.frame.url;
          this.refreshHistory(state).then(() => this.emitNavigation(state)).catch(console.error);
        }
        break;
      case 'Page.navigatedWithinDocument':
        state.url = message.params.url;
        this.refreshHistory(state).then(() => this.emitNavigation(state)).catch(console.error);
        break;
    }
  }

  emitNavigation(state) {
    const history = state.history;
    state.owner._onDidNavigate.fire({
      url: state.url,
      title: state.title,
      canGoBack: Boolean(history && history.currentIndex > 0),
      canGoForward: Boolean(history && history.currentIndex < history.entries.length - 1)
    });
    state.owner._onDidChangeTitle.fire({ title: state.title });
  }

  async navigate(state, url) {
    await this.ensureView(state);
    state.url = url;
    log('navigate', { targetId: state.targetId, url });
    await this.client.send('Page.navigate', { url }, state.sessionId);
  }

  async historyMove(state, offset) {
    await this.ensureView(state);
    await this.refreshHistory(state);
    const target = state.history.entries[state.history.currentIndex + offset];
    if (target) {
      await this.client.send('Page.navigateToHistoryEntry', { entryId: target.id }, state.sessionId);
    }
  }

  async disposeState(state) {
    liveStates.delete(state);
    if (state.sessionId) {
      this.sessionStates.delete(state.sessionId);
    }
    if (state.targetId && this.client) {
      await this.client.send('Target.closeTarget', { targetId: state.targetId }).catch(() => {});
    }
    if (liveStates.size === 0) {
      await this.helper?.request('detach').catch(() => {});
      if (config.closeBrowserOnExit) {
        this.browserProcess?.kill();
        this.helper?.dispose();
        this.browserProcess = undefined;
        this.client = undefined;
        this.helper = undefined;
        this.firstTargetUsed = false;
      }
    }
  }
}

const host = new ChromiumHost();

function stateFor(owner) {
  let state = states.get(owner);
  if (!state) {
    state = {
      owner,
      targetId: undefined,
      sessionId: undefined,
      initializing: undefined,
      url: 'about:blank',
      title: 'Chromium',
      history: undefined,
      loading: false,
      visible: true,
      layout: undefined,
      parentHandle: undefined
    };
    states.set(owner, state);
    liveStates.add(state);
  }
  return state;
}

function nativeHandle(owner) {
  const buffer = owner._window?.win?.getNativeWindowHandle?.();
  if (!buffer || buffer.length < 4) {
    return undefined;
  }
  return buffer.length >= 8 ? buffer.readBigUInt64LE().toString() : String(buffer.readUInt32LE());
}

export function attach(owner) {
  stateFor(owner);
  log('browser-view-created');
}

export function handles(owner) {
  return process.platform === 'win32' && states.has(owner);
}

export function getState(owner) {
  if (!handles(owner)) {
    return undefined;
  }
  const state = stateFor(owner);
  const history = state.history;
  return {
    url: state.url,
    title: state.title,
    canGoBack: Boolean(history && history.currentIndex > 0),
    canGoForward: Boolean(history && history.currentIndex < history.entries.length - 1),
    loading: state.loading,
    focused: false,
    visible: state.visible,
    isDevToolsOpen: false,
    storageScope: owner.session.storageScope,
    browserZoomIndex: owner._browserZoomIndex
  };
}

export function layout(owner, value) {
  const state = stateFor(owner);
  state.layout = {
    x: Math.round(value.x * value.zoomFactor),
    y: Math.round(value.y * value.zoomFactor),
    width: Math.round(value.width * value.zoomFactor),
    height: Math.round(value.height * value.zoomFactor)
  };
  state.parentHandle = nativeHandle(owner);
  log('layout', { parentHandle: state.parentHandle, layout: state.layout });
  host.activateAndAttach(state).catch(error => console.error('[ChromiumPatch layout]', error));
}

export function setVisible(owner, visible) {
  const state = stateFor(owner);
  state.visible = visible;
  if (!host.helper) {
    return;
  }
  if (visible) {
    host.activateAndAttach(state).catch(error => console.error('[ChromiumPatch show]', error));
  } else {
    host.helper.request('hide').catch(error => console.error('[ChromiumPatch hide]', error));
  }
}

export function loadURL(owner, url) {
  return host.navigate(stateFor(owner), url);
}

export function getURL(owner) {
  return states.get(owner)?.url;
}

export function goBack(owner) {
  return host.historyMove(stateFor(owner), -1);
}

export function goForward(owner) {
  return host.historyMove(stateFor(owner), 1);
}

export async function reload(owner, ignoreCache) {
  const state = stateFor(owner);
  await host.ensureView(state);
  await host.client.send('Page.reload', { ignoreCache: Boolean(ignoreCache) }, state.sessionId);
}

export function canGoBack(owner) {
  const history = states.get(owner)?.history;
  return history ? history.currentIndex > 0 : undefined;
}

export function canGoForward(owner) {
  const history = states.get(owner)?.history;
  return history ? history.currentIndex < history.entries.length - 1 : undefined;
}

export async function focus(owner) {
  const state = stateFor(owner);
  await host.activateAndAttach(state);
  await host.helper.request('focus');
}

export function disposeView(owner) {
  const state = states.get(owner);
  if (state) {
    states.delete(owner);
    host.disposeState(state).catch(error => console.error('[ChromiumPatch dispose]', error));
  }
}
