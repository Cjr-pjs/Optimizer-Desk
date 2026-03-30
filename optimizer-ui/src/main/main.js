const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const os = require('os');

const execFileAsync = promisify(execFile);

console.log('MAIN EXECUTANDO');
console.log('__dirname:', __dirname);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
   icon: path.join(__dirname, '../assets/logo/Logo.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, '../renderer/index.html'));
  win.setMenu(null);
}


app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

async function calculatePathSize(targetPath) {
  try {
    const stats = await fs.stat(targetPath);

    if (!stats.isDirectory()) {
      return stats.size;
    }

    const entries = await fs.readdir(targetPath);
    let total = 0;

    for (const entry of entries) {
      const entryPath = path.join(targetPath, entry);
      total += await calculatePathSize(entryPath);
    }

    return total;
  } catch {
    return 0;
  }
}

async function getTopRamProcesses() {
  if (process.platform !== 'win32') {
    return [];
  }

  const script = [
    '$procs = Get-Process | Sort-Object -Property WorkingSet64 -Descending | Select-Object -First 8 ProcessName, Id, @{Name="ramBytes";Expression={$_.WorkingSet64}};',
    '$procs | ConvertTo-Json -Compress'
  ].join(' ');

  try {
    const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
      windowsHide: true,
      maxBuffer: 1024 * 1024
    });

    const parsed = JSON.parse(stdout || '[]');
    const items = Array.isArray(parsed) ? parsed : [parsed];

    return items
      .filter((item) => item && item.ProcessName)
      .map((item) => ({
        name: item.ProcessName,
        pid: item.Id,
        ramBytes: Number(item.ramBytes) || 0
      }));
  } catch {
    return [];
  }
}

async function clearDirectoryContents(dirPath) {
  let removed = 0;
  let failed = 0;
  let totalBytes = 0;
  const deletedFiles = [];
  const failedFiles = [];

  const entries = await fs.readdir(dirPath);

  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry);
    const sizeBytes = await calculatePathSize(entryPath);

    try {
      await fs.rm(entryPath, { recursive: true, force: true });
      removed += 1;
      totalBytes += sizeBytes;
      deletedFiles.push({
        name: entry,
        path: entryPath,
        sizeBytes
      });
    } catch {
      failed += 1;
      failedFiles.push({
        name: entry,
        path: entryPath,
        sizeBytes
      });
    }
  }

  return {
    removed,
    failed,
    totalBytes,
    deletedFiles,
    failedFiles
  };
}

function getTempDirectories() {
  const candidates = [process.env.TEMP, process.env.TMP, os.tmpdir()]
    .filter(Boolean)
    .map((entry) => path.resolve(entry));

  return [...new Set(candidates)];
}

async function clearTempDirectories() {
  const directories = getTempDirectories();
  const perDirectory = [];
  const deletedFiles = [];
  const failedFiles = [];
  let removed = 0;
  let failed = 0;
  let totalBytes = 0;

  for (const dirPath of directories) {
    try {
      const result = await clearDirectoryContents(dirPath);
      removed += result.removed;
      failed += result.failed;
      totalBytes += result.totalBytes;

      deletedFiles.push(
        ...result.deletedFiles.map((file) => ({
          ...file,
          directory: dirPath
        }))
      );

      failedFiles.push(
        ...result.failedFiles.map((file) => ({
          ...file,
          directory: dirPath
        }))
      );

      perDirectory.push({
        directory: dirPath,
        removidos: result.removed,
        falhas: result.failed,
        totalBytes: result.totalBytes
      });
    } catch (error) {
      perDirectory.push({
        directory: dirPath,
        removidos: 0,
        falhas: 0,
        totalBytes: 0,
        erro: error.message || 'Falha ao acessar a pasta.'
      });
    }
  }

  return {
    directories,
    perDirectory,
    removed,
    failed,
    totalBytes,
    deletedFiles,
    failedFiles
  };
}

async function emptySystemTrashWithDetails() {
  if (process.platform !== 'win32') {
    const module = await import('empty-trash');
    const emptyTrash = module.default || module;
    await emptyTrash();
    return { deletedFiles: [], totalBytes: 0 };
  }

  const script = [
    '$shell = New-Object -ComObject Shell.Application;',
    '$bin = $shell.Namespace(0xA);',
    '$files = @();',
    'if ($null -ne $bin) {',
    '  foreach ($item in $bin.Items()) {',
    '    $size = $item.ExtendedProperty("System.Size");',
    '    if ($null -eq $size) { $size = 0 }',
    '    $files += [PSCustomObject]@{',
    '      name = $item.Name;',
    '      originalPath = $item.Path;',
    '      sizeBytes = [int64]$size',
    '    };',
    '  }',
    '}',
    '$totalBytes = ($files | Measure-Object -Property sizeBytes -Sum).Sum;',
    'if ($null -eq $totalBytes) { $totalBytes = 0 }',
    '$result = [PSCustomObject]@{ deletedFiles = $files; totalBytes = [int64]$totalBytes };',
    '$result | ConvertTo-Json -Depth 5 -Compress'
  ].join(' ');

  const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });

  const parsed = JSON.parse(stdout || '{}');

  const module = await import('empty-trash');
  const emptyTrash = module.default || module;
  await emptyTrash();

  return {
    deletedFiles: Array.isArray(parsed.deletedFiles) ? parsed.deletedFiles : [],
    totalBytes: Number(parsed.totalBytes) || 0
  };
}

ipcMain.handle('get-ram-usage', async () => {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  const processes = await getTopRamProcesses();

  return {
    total,
    free,
    used,
    percent: total > 0 ? Math.round((used / total) * 100) : 0,
    processes,
    timestamp: Date.now()
  };
});

ipcMain.handle('limpar-temporarios', async () => {
  try {
    const result = await clearTempDirectories();

    return {
      sucesso: true,
      removidos: result.removed,
      falhas: result.failed,
      diretoriosVarredura: result.directories,
      resumoPorDiretorio: result.perDirectory,
      totalBytes: result.totalBytes,
      arquivosDeletados: result.deletedFiles,
      arquivosFalha: result.failedFiles,
      mensagem: `Arquivos temporarios limpos. Removidos: ${result.removed}. Falhas: ${result.failed}. Diretorios: ${result.directories.join(', ')}.`
    };
  } catch (error) {
    return {
      sucesso: false,
      erro: error.message || 'Erro desconhecido ao limpar temporarios.'
    };
  }
});

ipcMain.handle('empty-trash', async () => {
  try {
    const result = await emptySystemTrashWithDetails();
    return {
      sucesso: true,
      mensagem: 'Lixeira esvaziada com sucesso.',
      totalBytes: result.totalBytes,
      arquivosDeletados: result.deletedFiles
    };
  } catch (error) {
    return {
      sucesso: false,
      erro: error.message || 'Falha ao esvaziar a lixeira.'
    };
  }
});