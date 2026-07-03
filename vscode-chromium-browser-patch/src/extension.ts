import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { downloadChromeForTesting } from './browserDownload';
import {
  getPatchStatus,
  installPatch,
  PatchRuntimeConfig,
  uninstallPatch
} from './patcher';

function candidateBrowsers(): string[] {
  const local = process.env.LOCALAPPDATA ?? '';
  const programFiles = process.env.ProgramFiles ?? '';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? '';
  return [
    path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ];
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const candidate of paths) {
    if (candidate && await fs.access(candidate).then(() => true, () => false)) {
      return candidate;
    }
  }
  return undefined;
}

async function runtimeConfig(context: vscode.ExtensionContext, appRoot: string): Promise<PatchRuntimeConfig> {
  const settings = vscode.workspace.getConfiguration('chromiumPatch');
  const configuredBrowser = settings.get<string>('browserExecutable', '').trim();
  const browserExecutable = configuredBrowser || await firstExisting(candidateBrowsers());
  if (!browserExecutable) {
    throw new Error('No Chrome/Edge executable was found. Download Chrome for Testing or configure chromiumPatch.browserExecutable.');
  }

  const configuredProfile = settings.get<string>('profileDirectory', '').trim();
  const profileDirectory = configuredProfile || path.join(context.globalStorageUri.fsPath, 'browser-profile');
  const helperExecutable = path.join(context.extensionUri.fsPath, 'runtime', 'helper', 'ChromiumHostHelper.exe');
  await Promise.all([fs.access(browserExecutable), fs.access(helperExecutable)]);
  await fs.mkdir(profileDirectory, { recursive: true });
  return {
    browserExecutable,
    profileDirectory,
    helperExecutable,
    closeBrowserOnExit: settings.get<boolean>('closeBrowserOnExit', true)
  };
}

function appRoot(): string {
  return vscode.env.appRoot;
}

export function activate(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('Chromium Patch');
  context.subscriptions.push(output);

  context.subscriptions.push(vscode.commands.registerCommand('chromiumPatch.status', async () => {
    const status = await getPatchStatus(appRoot());
    output.appendLine(JSON.stringify(status, null, 2));
    output.show(true);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('chromiumPatch.createSandbox', async () => {
    const selection = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      canSelectMany: false,
      title: 'Choose an empty directory for the isolated VS Code app copy'
    });
    if (!selection?.[0]) {
      return;
    }
    const sandboxRoot = path.join(selection[0].fsPath, `vscode-chromium-sandbox-${Date.now()}`);
    const sandboxAppRoot = path.join(sandboxRoot, 'resources', 'app');
    await fs.mkdir(path.join(sandboxAppRoot, 'out'), { recursive: true });
    await fs.copyFile(path.join(appRoot(), 'out', 'main.js'), path.join(sandboxAppRoot, 'out', 'main.js'));
    const config = await runtimeConfig(context, sandboxAppRoot);
    await installPatch(
      sandboxAppRoot,
      path.join(context.extensionUri.fsPath, 'runtime'),
      { ...config, profileDirectory: path.join(sandboxRoot, 'profile') },
      vscode.version
    );
    await fs.writeFile(
      path.join(sandboxRoot, 'README.txt'),
      [
        'This is an isolated patch fixture, not a complete VS Code installation.',
        'It contains a patched copy of resources/app/out/main.js and its runtime files.',
        'Your installed VS Code was not modified.',
        `Created: ${new Date().toISOString()}`
      ].join(os.EOL),
      'utf8'
    );
    void vscode.window.showInformationMessage(`Isolated patch fixture created at ${sandboxRoot}`);
  }));

  context.subscriptions.push(vscode.commands.registerCommand('chromiumPatch.install', async () => {
    const answer = await vscode.window.showWarningMessage(
      'This modifies the current VS Code installation. A restart is required and updates will replace the patch.',
      { modal: true },
      'Patch and Restart Later'
    );
    if (answer !== 'Patch and Restart Later') {
      return;
    }
    const config = await runtimeConfig(context, appRoot());
    await installPatch(appRoot(), path.join(context.extensionUri.fsPath, 'runtime'), config, vscode.version);
    void vscode.window.showInformationMessage('Patch installed. Restart VS Code to activate it.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('chromiumPatch.uninstall', async () => {
    const answer = await vscode.window.showWarningMessage(
      'Restore the backed-up VS Code main.js?',
      { modal: true },
      'Restore'
    );
    if (answer !== 'Restore') {
      return;
    }
    await uninstallPatch(appRoot());
    void vscode.window.showInformationMessage('Original main.js restored. Restart VS Code.');
  }));

  context.subscriptions.push(vscode.commands.registerCommand('chromiumPatch.downloadBrowser', async () => {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Downloading Chrome for Testing', cancellable: false },
      async () => {
        const executable = await downloadChromeForTesting(path.join(context.globalStorageUri.fsPath, 'browsers'));
        await vscode.workspace.getConfiguration('chromiumPatch').update(
          'browserExecutable',
          executable,
          vscode.ConfigurationTarget.Global
        );
      }
    );
    void vscode.window.showInformationMessage('Chrome for Testing downloaded and selected.');
  }));
}

export function deactivate(): void {
  // The patched main process owns the browser lifetime.
}

