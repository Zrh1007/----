import * as crypto from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export const PATCH_ID = 'vscode-chromium-host-v1';
const MARKER_START = `/* ${PATCH_ID}:start */`;
const MARKER_END = `/* ${PATCH_ID}:end */`;
const MAIN_RELATIVE_PATH = path.join('out', 'main.js');
const RUNTIME_DIRECTORY = 'vscode-chromium-patch';
const BACKUP_FILE = 'main.js.chromium-patch.backup';
const MANIFEST_FILE = 'patch-manifest.json';

export interface PatchRuntimeConfig {
  browserExecutable: string;
  profileDirectory: string;
  helperExecutable: string;
  closeBrowserOnExit: boolean;
}

export interface PatchManifest {
  patchId: string;
  vscodeVersion: string;
  originalSha256: string;
  patchedSha256: string;
  installedAt: string;
}

export interface PatchStatus {
  appRoot: string;
  mainFile: string;
  exists: boolean;
  patched: boolean;
  hasBackup: boolean;
  manifest?: PatchManifest;
}

const anchors = {
  moduleLoad:
    'import{WebContentsView as E2,webContents as T2}from"electron";',
  attach:
    'this._debugger=new bm(this,this.logService),this.setupEventListeners()}',
  getState:
    'getState(){let e=this._view.webContents,t=e.getURL();return{',
  layoutEnd:
    'height:Math.round(e.height*e.zoomFactor)})}',
  setVisible:
    'setVisible(e){this._view.getVisible()!==e&&(!e&&this._view.webContents.isFocused()&&this._window?.win?.webContents.focus(),this._view.setVisible(e),this._onDidChangeVisibility.fire({visible:e}))}',
  loadUrl:
    'async loadURL(e){await this._view.webContents.loadURL(e)}',
  getUrl:
    'getURL(){return this._view.webContents.getURL()}',
  goBack:
    'goBack(){this._view.webContents.navigationHistory.canGoBack()&&this._view.webContents.navigationHistory.goBack()}',
  goForward:
    'goForward(){this._view.webContents.navigationHistory.canGoForward()&&this._view.webContents.navigationHistory.goForward()}',
  reload:
    'reload(e){e?this._view.webContents.reloadIgnoringCache():this._view.webContents.reload()}',
  canGoBack:
    'canGoBack(){return this._view.webContents.navigationHistory.canGoBack()}',
  canGoForward:
    'canGoForward(){return this._view.webContents.navigationHistory.canGoForward()}',
  focus:
    'async focus(){this._view.webContents.focus()}',
  dispose:
    'dispose(){this._isDisposed||(this._isDisposed=!0,this._debugger.dispose(),'
};

function sha256(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function replaceExactlyOnce(source: string, anchor: string, replacement: string, name: string): string {
  const first = source.indexOf(anchor);
  if (first < 0) {
    throw new Error(`Unsupported VS Code build: patch anchor "${name}" was not found.`);
  }
  if (source.indexOf(anchor, first + anchor.length) >= 0) {
    throw new Error(`Unsafe patch: anchor "${name}" is not unique.`);
  }
  return source.slice(0, first) + replacement + source.slice(first + anchor.length);
}

export function patchMainSource(source: string): string {
  if (source.includes(MARKER_START)) {
    throw new Error('This main.js is already patched.');
  }

  let output = source;
  output = replaceExactlyOnce(
    output,
    anchors.moduleLoad,
    `${anchors.moduleLoad}${MARKER_START}import("./${RUNTIME_DIRECTORY}/vscode-chromium-host.mjs").then(e=>globalThis.__vscodeChromiumPatch=e).catch(e=>console.error("[ChromiumPatch]",e));${MARKER_END}`,
    'moduleLoad'
  );
  output = replaceExactlyOnce(
    output,
    anchors.attach,
    'this._debugger=new bm(this,this.logService),this.setupEventListeners(),globalThis.__vscodeChromiumPatch?.attach(this)}',
    'attach'
  );
  output = replaceExactlyOnce(
    output,
    anchors.getState,
    'getState(){let h=globalThis.__vscodeChromiumPatch?.getState(this);if(h)return h;let e=this._view.webContents,t=e.getURL();return{',
    'getState'
  );
  output = replaceExactlyOnce(
    output,
    anchors.layoutEnd,
    'height:Math.round(e.height*e.zoomFactor)}),globalThis.__vscodeChromiumPatch?.layout(this,e)}',
    'layoutEnd'
  );
  output = replaceExactlyOnce(
    output,
    anchors.setVisible,
    `${anchors.setVisible.slice(0, -1)},globalThis.__vscodeChromiumPatch?.setVisible(this,e)}`,
    'setVisible'
  );
  output = replaceExactlyOnce(
    output,
    anchors.loadUrl,
    'async loadURL(e){if(globalThis.__vscodeChromiumPatch?.handles(this))return globalThis.__vscodeChromiumPatch.loadURL(this,e);await this._view.webContents.loadURL(e)}',
    'loadUrl'
  );
  output = replaceExactlyOnce(
    output,
    anchors.getUrl,
    'getURL(){return globalThis.__vscodeChromiumPatch?.getURL(this)??this._view.webContents.getURL()}',
    'getUrl'
  );
  output = replaceExactlyOnce(
    output,
    anchors.goBack,
    'goBack(){if(globalThis.__vscodeChromiumPatch?.handles(this))return globalThis.__vscodeChromiumPatch.goBack(this);this._view.webContents.navigationHistory.canGoBack()&&this._view.webContents.navigationHistory.goBack()}',
    'goBack'
  );
  output = replaceExactlyOnce(
    output,
    anchors.goForward,
    'goForward(){if(globalThis.__vscodeChromiumPatch?.handles(this))return globalThis.__vscodeChromiumPatch.goForward(this);this._view.webContents.navigationHistory.canGoForward()&&this._view.webContents.navigationHistory.goForward()}',
    'goForward'
  );
  output = replaceExactlyOnce(
    output,
    anchors.reload,
    'reload(e){if(globalThis.__vscodeChromiumPatch?.handles(this))return globalThis.__vscodeChromiumPatch.reload(this,e);e?this._view.webContents.reloadIgnoringCache():this._view.webContents.reload()}',
    'reload'
  );
  output = replaceExactlyOnce(
    output,
    anchors.canGoBack,
    'canGoBack(){return globalThis.__vscodeChromiumPatch?.canGoBack(this)??this._view.webContents.navigationHistory.canGoBack()}',
    'canGoBack'
  );
  output = replaceExactlyOnce(
    output,
    anchors.canGoForward,
    'canGoForward(){return globalThis.__vscodeChromiumPatch?.canGoForward(this)??this._view.webContents.navigationHistory.canGoForward()}',
    'canGoForward'
  );
  output = replaceExactlyOnce(
    output,
    anchors.focus,
    'async focus(){if(globalThis.__vscodeChromiumPatch?.handles(this))return globalThis.__vscodeChromiumPatch.focus(this);this._view.webContents.focus()}',
    'focus'
  );
  output = replaceExactlyOnce(
    output,
    anchors.dispose,
    'dispose(){globalThis.__vscodeChromiumPatch?.disposeView(this),this._isDisposed||(this._isDisposed=!0,this._debugger.dispose(),',
    'dispose'
  );
  return output;
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function getPatchStatus(appRoot: string): Promise<PatchStatus> {
  const mainFile = path.join(appRoot, MAIN_RELATIVE_PATH);
  const runtimeRoot = path.join(path.dirname(mainFile), RUNTIME_DIRECTORY);
  try {
    const source = await fs.readFile(mainFile, 'utf8');
    return {
      appRoot,
      mainFile,
      exists: true,
      patched: source.includes(MARKER_START) && source.includes(MARKER_END),
      hasBackup: await fs.access(path.join(runtimeRoot, BACKUP_FILE)).then(() => true, () => false),
      manifest: await readJson<PatchManifest>(path.join(runtimeRoot, MANIFEST_FILE))
    };
  } catch {
    return { appRoot, mainFile, exists: false, patched: false, hasBackup: false };
  }
}

export async function installPatch(
  appRoot: string,
  runtimeSourceDirectory: string,
  config: PatchRuntimeConfig,
  vscodeVersion: string
): Promise<PatchManifest> {
  const mainFile = path.join(appRoot, MAIN_RELATIVE_PATH);
  const outDirectory = path.dirname(mainFile);
  const runtimeRoot = path.join(outDirectory, RUNTIME_DIRECTORY);
  const original = await fs.readFile(mainFile, 'utf8');
  const patched = patchMainSource(original);

  await fs.mkdir(runtimeRoot, { recursive: true });
  await fs.copyFile(path.join(runtimeSourceDirectory, 'vscode-chromium-host.mjs'), path.join(runtimeRoot, 'vscode-chromium-host.mjs'));
  await fs.copyFile(config.helperExecutable, path.join(runtimeRoot, 'ChromiumHostHelper.exe'));
  const installedConfig: PatchRuntimeConfig = {
    ...config,
    helperExecutable: path.join(runtimeRoot, 'ChromiumHostHelper.exe')
  };
  await fs.writeFile(path.join(runtimeRoot, 'config.json'), JSON.stringify(installedConfig, null, 2), 'utf8');
  await fs.writeFile(path.join(runtimeRoot, BACKUP_FILE), original, { encoding: 'utf8', flag: 'wx' });

  const manifest: PatchManifest = {
    patchId: PATCH_ID,
    vscodeVersion,
    originalSha256: sha256(original),
    patchedSha256: sha256(patched),
    installedAt: new Date().toISOString()
  };
  await fs.writeFile(path.join(runtimeRoot, MANIFEST_FILE), JSON.stringify(manifest, null, 2), 'utf8');
  await fs.writeFile(mainFile, patched, 'utf8');
  return manifest;
}

export async function uninstallPatch(appRoot: string): Promise<void> {
  const mainFile = path.join(appRoot, MAIN_RELATIVE_PATH);
  const runtimeRoot = path.join(path.dirname(mainFile), RUNTIME_DIRECTORY);
  const manifest = await readJson<PatchManifest>(path.join(runtimeRoot, MANIFEST_FILE));
  if (!manifest || manifest.patchId !== PATCH_ID) {
    throw new Error('Patch manifest is missing or belongs to another patch.');
  }
  const current = await fs.readFile(mainFile);
  if (sha256(current) !== manifest.patchedSha256) {
    throw new Error('main.js changed after patching. Refusing to overwrite it.');
  }
  const backup = await fs.readFile(path.join(runtimeRoot, BACKUP_FILE));
  if (sha256(backup) !== manifest.originalSha256) {
    throw new Error('Backup checksum mismatch. Refusing to restore it.');
  }
  await fs.writeFile(mainFile, backup);
  await fs.rm(runtimeRoot, { recursive: true, force: true });
}

