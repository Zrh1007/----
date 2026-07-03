const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

function write(context, message, detail) {
  const file = path.join(context.globalStorageUri.fsPath, 'smoke.log');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    `${new Date().toISOString()} ${message}${detail === undefined ? '' : ` ${JSON.stringify(detail)}`}\n`,
    'utf8'
  );
}

async function activate(context) {
  write(context, 'activated', { version: vscode.version });
  await new Promise(resolve => setTimeout(resolve, 1500));
  try {
    if (typeof vscode.window.openBrowserTab !== 'function') {
      throw new Error('The proposed browser API is unavailable.');
    }
    const tab = await vscode.window.openBrowserTab('https://example.com/', {
      preserveFocus: false,
      background: false
    });
    write(context, 'browser-opened', {
      id: tab.id,
      url: tab.url,
      title: tab.title
    });
  } catch (error) {
    write(context, 'error', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

exports.activate = activate;
