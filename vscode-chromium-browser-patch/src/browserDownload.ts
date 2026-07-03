import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as https from 'node:https';
import { spawn } from 'node:child_process';

interface ChromeForTestingIndex {
  channels: {
    Stable: {
      version: string;
      downloads: {
        chrome: Array<{ platform: string; url: string }>;
      };
    };
  };
}

function requestBuffer(url: string, redirects = 0): Promise<Buffer> {
  if (redirects > 5) {
    return Promise.reject(new Error('Too many HTTP redirects.'));
  }
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'vscode-chromium-browser-patch' } }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        requestBuffer(new URL(response.headers.location, url).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        return;
      }
      const chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(Buffer.from(chunk)));
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    }).on('error', reject);
  });
}

function downloadFile(url: string, destination: string, redirects = 0): Promise<void> {
  if (redirects > 5) {
    return Promise.reject(new Error('Too many HTTP redirects.'));
  }
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'vscode-chromium-browser-patch' } }, response => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), destination, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        return;
      }
      const output = createWriteStream(destination, { flags: 'wx' });
      const fail = (error: Error) => {
        response.destroy();
        output.destroy();
        reject(error);
      };
      response.on('error', fail);
      output.on('error', fail);
      output.on('finish', resolve);
      response.pipe(output);
    }).on('error', reject);
  });
}

function extractArchive(archive: string, destination: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn('tar.exe', ['-xf', archive, '-C', destination], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe']
    });
    const errors: Buffer[] = [];
    process.stderr.on('data', chunk => errors.push(Buffer.from(chunk)));
    process.on('error', reject);
    process.on('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`tar.exe exited with code ${code}: ${Buffer.concat(errors).toString('utf8')}`));
      }
    });
  });
}

export async function downloadChromeForTesting(destinationRoot: string): Promise<string> {
  const indexUrl = 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json';
  const index = JSON.parse((await requestBuffer(indexUrl)).toString('utf8')) as ChromeForTestingIndex;
  const stable = index.channels.Stable;
  const archive = stable.downloads.chrome.find(item => item.platform === 'win64');
  if (!archive || !archive.url.startsWith('https://storage.googleapis.com/chrome-for-testing-public/')) {
    throw new Error('The official win64 Chrome for Testing download was not found.');
  }

  const versionRoot = path.join(destinationRoot, stable.version);
  const executable = path.join(versionRoot, 'chrome-win64', 'chrome.exe');
  try {
    await fs.access(executable);
    return executable;
  } catch {
    // Continue with the explicit download.
  }

  await fs.mkdir(versionRoot, { recursive: true });
  const archivePath = path.join(versionRoot, 'chrome-win64.zip');
  await downloadFile(archive.url, archivePath);
  try {
    await extractArchive(archivePath, versionRoot);
  } finally {
    await fs.rm(archivePath, { force: true });
  }
  await fs.access(executable);
  return executable;
}
