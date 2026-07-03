import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { patchMainSource, PATCH_ID } from '../patcher';

const fixture = [
  'import{WebContentsView as E2,webContents as T2}from"electron";',
  'class X{constructor(){this._debugger=new bm(this,this.logService),this.setupEventListeners()}',
  'getState(){let e=this._view.webContents,t=e.getURL();return{url:t}}',
  'layout(e){this._view.setBounds({height:Math.round(e.height*e.zoomFactor)})}',
  'setVisible(e){this._view.getVisible()!==e&&(!e&&this._view.webContents.isFocused()&&this._window?.win?.webContents.focus(),this._view.setVisible(e),this._onDidChangeVisibility.fire({visible:e}))}',
  'async loadURL(e){await this._view.webContents.loadURL(e)}',
  'getURL(){return this._view.webContents.getURL()}',
  'goBack(){this._view.webContents.navigationHistory.canGoBack()&&this._view.webContents.navigationHistory.goBack()}',
  'goForward(){this._view.webContents.navigationHistory.canGoForward()&&this._view.webContents.navigationHistory.goForward()}',
  'reload(e){e?this._view.webContents.reloadIgnoringCache():this._view.webContents.reload()}',
  'canGoBack(){return this._view.webContents.navigationHistory.canGoBack()}',
  'canGoForward(){return this._view.webContents.navigationHistory.canGoForward()}',
  'async focus(){this._view.webContents.focus()}',
  'dispose(){this._isDisposed||(this._isDisposed=!0,this._debugger.dispose(),x())}}'
].join('');

test('patches every required browser view hook', () => {
  const result = patchMainSource(fixture);
  assert.match(result, new RegExp(PATCH_ID));
  assert.match(result, /__vscodeChromiumPatch\.loadURL/);
  assert.match(result, /__vscodeChromiumPatch\?\.layout/);
  assert.match(result, /__vscodeChromiumPatch\?\.disposeView/);
});

test('refuses to patch twice', () => {
  const result = patchMainSource(fixture);
  assert.throws(() => patchMainSource(result), /already patched/);
});

test('refuses unknown builds', () => {
  assert.throws(() => patchMainSource('console.log("different build")'), /moduleLoad/);
});
