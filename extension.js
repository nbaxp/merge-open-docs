const vscode = require('vscode');
const path = require('path');

const generatedUris = new Set();

let outputChannel;

function logMerge(line) {
  outputChannel?.appendLine(line);
}

const DEFAULT_EXCLUDE_DIRECTORIES = ['node_modules', 'logs', 'dist'];
const DEFAULT_EXCLUDE_FILES = ['*.min.*'];

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.mp3',
  '.mp4',
  '.wav',
  '.mkv',
  '.mov',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
]);

const MAX_FILE_SIZE = 2 * 1024 * 1024;

function getFilterSettings() {
  const config = vscode.workspace.getConfiguration('mergeOpenDocs');
  const excludeDirectories = config.get('excludeDirectories', DEFAULT_EXCLUDE_DIRECTORIES);
  const excludeFiles = config.get('excludeFiles', DEFAULT_EXCLUDE_FILES);
  const excludeDotFiles = config.get('excludeDotFiles', true);
  return {
    excludeDirectories:
      Array.isArray(excludeDirectories) && excludeDirectories.length > 0
        ? excludeDirectories.filter(Boolean)
        : DEFAULT_EXCLUDE_DIRECTORIES.slice(),
    excludeFiles:
      Array.isArray(excludeFiles) && excludeFiles.length > 0
        ? excludeFiles.filter(Boolean)
        : DEFAULT_EXCLUDE_FILES.slice(),
    excludeDotFiles: excludeDotFiles !== false,
  };
}

function shouldSkipDirectory(name, settings) {
  if (name.startsWith('.')) {
    return true;
  }
  const normalized = name.toLowerCase();
  return settings.excludeDirectories.some((value) => value.toLowerCase() === normalized);
}

function matchesFilePattern(fileName, pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i').test(fileName);
}

function shouldSkipFile(name, settings) {
  if (settings.excludeDotFiles && name.startsWith('.')) {
    return true;
  }
  return settings.excludeFiles.some((pattern) => matchesFilePattern(name, pattern));
}

function isBinaryExtension(name) {
  const dot = name.lastIndexOf('.');
  return dot > 0 && BINARY_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

async function isTextFile(uri) {
  const data = await vscode.workspace.fs.readFile(uri);
  const limit = Math.min(data.length, 8192);
  for (let i = 0; i < limit; i += 1) {
    if (data[i] === 0) {
      return false;
    }
  }
  return true;
}

function getLanguage(filePath) {
  const name = filePath.replace(/\\/g, '/').split('/').pop();
  const dot = name.lastIndexOf('.');
  if (dot < 0) {
    return '';
  }
  return name.slice(dot + 1).toLowerCase();
}

function getFence(content) {
  let maxRun = 0;
  const runs = content.match(/^(`{3,})/gm);
  if (runs) {
    for (const run of runs) {
      if (run.length > maxRun) {
        maxRun = run.length;
      }
    }
  }
  return '`'.repeat(Math.max(3, maxRun + 1));
}

function getFilePath(uri) {
  if (uri.scheme === 'untitled') {
    return uri.toString();
  }
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    return vscode.workspace.asRelativePath(uri, false);
  }
  return uri.fsPath;
}

function compressContent(content) {
  const lines = content.split(/\r?\n/);
  const result = [];
  let previousBlank = false;
  for (const line of lines) {
    const isBlank = line.trim() === '';
    if (isBlank) {
      if (previousBlank) {
        continue;
      }
      previousBlank = true;
      result.push('');
      continue;
    }
    previousBlank = false;
    result.push(line);
  }
  while (result.length > 0 && result[0] === '') {
    result.shift();
  }
  while (result.length > 0 && result[result.length - 1] === '') {
    result.pop();
  }
  return result.join('\n');
}

function createDocumentBlock(filePath, content) {
  const language = getLanguage(filePath);
  const fence = getFence(content);
  const body = content === '' || content.endsWith('\n') ? content : `${content}\n`;
  return `## ${filePath}\n\n${fence}${language}\n${body}${fence}`;
}

function createErrorBlock(filePath) {
  return `## ${filePath}\n\n无法读取文件内容`;
}

async function resolveDocument(uri) {
  const key = uri.toString();
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === key);
  if (open) {
    return open;
  }
  return vscode.workspace.openTextDocument(uri);
}

function collectOpenDocuments() {
  const items = [];
  const seen = new Set();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      let uri;
      if (tab.input instanceof vscode.TabInputText) {
        uri = tab.input.uri;
      } else if (tab.input instanceof vscode.TabInputTextDiff) {
        uri = tab.input.modified;
      } else {
        continue;
      }
      const key = uri.toString();
      if (seen.has(key) || generatedUris.has(key)) {
        continue;
      }
      seen.add(key);
      items.push({ uri, relativePath: getFilePath(uri) });
    }
  }
  return items;
}

// 单文件是否纳入合并：过滤规则、大小、二进制扩展名、文本检测；不纳入时计入 stats
async function acceptFile(uri, settings, stats) {
  const name = path.basename(uri.fsPath);
  if (shouldSkipFile(name, settings)) {
    stats.excludedFiles += 1;
    return false;
  }
  const stat = await vscode.workspace.fs.stat(uri);
  if (stat.size > MAX_FILE_SIZE) {
    stats.excludedLargeFiles += 1;
    return false;
  }
  if (isBinaryExtension(name) || !(await isTextFile(uri))) {
    stats.excludedBinaryFiles += 1;
    return false;
  }
  return true;
}

// 递归收集目录内文件，标题统一用 workspace 相对路径
async function collectDirectoryDocuments(rootUri) {
  const settings = getFilterSettings();
  const files = [];
  const stats = { excludedFiles: 0, excludedBinaryFiles: 0, excludedLargeFiles: 0 };

  async function visit(directoryUri) {
    const entries = await vscode.workspace.fs.readDirectory(directoryUri);
    for (const [name, type] of entries) {
      const childUri = vscode.Uri.joinPath(directoryUri, name);
      if (type === vscode.FileType.Directory) {
        if (shouldSkipDirectory(name, settings)) {
          continue;
        }
        await visit(childUri);
        continue;
      }
      if (type !== vscode.FileType.File) {
        continue;
      }
      if (await acceptFile(childUri, settings, stats)) {
        files.push(childUri);
      }
    }
  }

  await visit(rootUri);

  files.sort((a, b) => a.fsPath.localeCompare(b.fsPath, undefined, { sensitivity: 'base' }));

  return {
    items: files.map((uri) => ({ uri, relativePath: getFilePath(uri) })),
    skippedCount: stats.excludedFiles + stats.excludedBinaryFiles + stats.excludedLargeFiles,
  };
}

async function createMergedDocument(content) {
  const document = await vscode.workspace.openTextDocument({
    content,
    language: 'markdown',
  });
  generatedUris.add(document.uri.toString());
  await vscode.window.showTextDocument(document, { preview: false });
}

async function mergeDocuments(items, options = {}) {
  const compress = options.compress === true;
  const blocks = [];
  let merged = 0;
  const failed = [];

  const folders = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  outputChannel?.show(true);
  logMerge(
    `===== 合并开始：${items.length} 个文件；workspace 根：${folders.length ? folders.join(' | ') : '(无工作区)'}`,
  );
  for (const item of items) {
    logMerge(`${item.uri.fsPath}  =>  ## ${item.relativePath}`);
  }

  for (const item of items) {
    try {
      const document = await resolveDocument(item.uri);
      let content = document.getText();
      if (compress) {
        content = compressContent(content);
      }
      blocks.push(createDocumentBlock(item.relativePath, content));
      merged += 1;
    } catch (error) {
      failed.push(item.relativePath);
      blocks.push(createErrorBlock(item.relativePath));
    }
  }

  await createMergedDocument(blocks.join(compress ? '\n' : '\n\n'));

  const problems = [];
  if (failed.length > 0) {
    problems.push(`${failed.length} 个无法读取：${failed.join('、')}`);
  }
  if (options.skippedCount > 0) {
    problems.push(`跳过 ${options.skippedCount} 个文件`);
  }
  if (problems.length > 0) {
    vscode.window.showWarningMessage(
      `已合并 ${merged} 个${options.noun || '文件'}，${problems.join('；')}。`,
    );
  }
}

async function mergeOpenDocuments(options = {}) {
  const items = collectOpenDocuments();
  if (items.length === 0) {
    vscode.window.showInformationMessage('没有可合并的已打开文本文档。');
    return;
  }
  return mergeDocuments(items, { ...options, noun: '文本文档' });
}

async function mergeDirectory(directoryUri, options = {}) {
  if (!directoryUri || directoryUri.scheme !== 'file') {
    vscode.window.showWarningMessage('请选择本地文件夹。');
    return;
  }
  let stat;
  try {
    stat = await vscode.workspace.fs.stat(directoryUri);
  } catch (error) {
    vscode.window.showErrorMessage(`无法读取目录：${directoryUri.fsPath}`);
    return;
  }
  if (stat.type !== vscode.FileType.Directory) {
    vscode.window.showWarningMessage('请选择文件夹。');
    return;
  }

  let collected;
  try {
    collected = await collectDirectoryDocuments(directoryUri);
  } catch (error) {
    vscode.window.showErrorMessage(`无法读取目录：${directoryUri.fsPath}`);
    return;
  }

  if (collected.items.length === 0) {
    vscode.window.showInformationMessage('所选目录下没有可合并的文本文件。');
    return;
  }

  return mergeDocuments(collected.items, {
    ...options,
    skippedCount: collected.skippedCount,
    noun: '文件',
  });
}

// Explorer 多选入口：uris 为全部选中节点；文件夹递归收集，散文件直接收集，按 uri 去重
async function mergeSelection(uris, options = {}) {
  const list = (uris ?? []).filter((uri) => uri && uri.scheme === 'file');
  if (list.length === 0) {
    vscode.window.showWarningMessage('请选择本地文件或文件夹。');
    return;
  }

  // 单个目录：直接递归收集
  if (list.length === 1) {
    try {
      const stat = await vscode.workspace.fs.stat(list[0]);
      if (stat.type === vscode.FileType.Directory) {
        return mergeDirectory(list[0], options);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`无法读取：${list[0].fsPath}`);
      return;
    }
  }

  const settings = getFilterSettings();
  const stats = { excludedFiles: 0, excludedBinaryFiles: 0, excludedLargeFiles: 0 };
  const seen = new Set();
  const items = [];

  const add = (uri) => {
    const key = uri.toString();
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    items.push({ uri, relativePath: getFilePath(uri) });
  };

  for (const uri of list) {
    let stat;
    try {
      stat = await vscode.workspace.fs.stat(uri);
    } catch (error) {
      continue;
    }
    if (stat.type === vscode.FileType.Directory) {
      const collected = await collectDirectoryDocuments(uri);
      collected.items.forEach((item) => add(item.uri));
      stats.excludedFiles += collected.skippedCount;
    } else if (stat.type === vscode.FileType.File && (await acceptFile(uri, settings, stats))) {
      add(uri);
    }
  }

  items.sort((a, b) =>
    a.uri.fsPath.localeCompare(b.uri.fsPath, undefined, { sensitivity: 'base' }),
  );

  if (items.length === 0) {
    vscode.window.showInformationMessage('所选内容没有可合并的文本文件。');
    return;
  }

  return mergeDocuments(items, {
    ...options,
    skippedCount: stats.excludedFiles + stats.excludedBinaryFiles + stats.excludedLargeFiles,
    noun: '文件',
  });
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Merge Open Docs');
  context.subscriptions.push(outputChannel);
  logMerge(
    `[${new Date().toLocaleString()}] merge-open-docs v${context.extension.packageJSON.version} 已激活`,
  );

  const run =
    (fn) =>
    (...args) => {
      try {
        return fn(...args);
      } catch (error) {
        vscode.window.showErrorMessage(`合并打开文档失败: ${error.message}`);
      }
    };
  context.subscriptions.push(
    vscode.commands.registerCommand(
      'mergeOpenDocs.copyAll',
      run(() => mergeOpenDocuments({ compress: false })),
    ),
    vscode.commands.registerCommand(
      'mergeOpenDocs.copyAllMinified',
      run(() => mergeOpenDocuments({ compress: true })),
    ),
    vscode.commands.registerCommand(
      'mergeOpenDocs.copyDirectory',
      run((uri, uris) =>
        mergeSelection(uris?.length ? uris : uri ? [uri] : [], { compress: false }),
      ),
    ),
    vscode.commands.registerCommand(
      'mergeOpenDocs.copyDirectoryMinified',
      run((uri, uris) =>
        mergeSelection(uris?.length ? uris : uri ? [uri] : [], { compress: true }),
      ),
    ),
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate,
};
