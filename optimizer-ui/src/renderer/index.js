const ramBtn = document.getElementById('ramBtn');
const temporaryBtn = document.getElementById('temporaryArchivesBtn');
const cleanTrashBtn = document.getElementById('cleanTrashBtn');
const hideRamPanelBtn = document.getElementById('hideRamPanelBtn');

const ramPanel = document.getElementById('ramPanel');
const ramBar = document.getElementById('ramBar');
const ramPercent = document.getElementById('ramPercent');
const ramUsed = document.getElementById('ramUsed');
const ramTotal = document.getElementById('ramTotal');
const ramProcessList = document.getElementById('ramProcessList');

const statusTemporary = document.getElementById('statusTemporary');
const statusTrash = document.getElementById('statusTrash');
const tempReport = document.getElementById('tempReport');
const trashReport = document.getElementById('trashReport');
const tempSummary = document.getElementById('tempSummary');
const trashSummary = document.getElementById('trashSummary');
const tempDeletedList = document.getElementById('tempDeletedList');
const trashDeletedList = document.getElementById('trashDeletedList');

let ramIntervalId = null;

function formatBytesToGB(bytes) {
  const gb = bytes / 1024 / 1024 / 1024;
  return `${gb.toFixed(2)} GB`;
}

function formatBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function getBarColor(percent) {
  if (percent < 50) return '#2ea043';
  if (percent < 80) return '#d29922';
  return '#da3633';
}

function clearList(listElement) {
  listElement.innerHTML = '';
}

function appendProcessItems(processes) {
  clearList(ramProcessList);

  if (!processes || processes.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Nao foi possivel obter processos neste momento.';
    ramProcessList.appendChild(li);
    return;
  }

  for (const process of processes) {
    const li = document.createElement('li');
    li.textContent = `${process.name} (PID ${process.pid}) - ${formatBytes(process.ramBytes)}`;
    ramProcessList.appendChild(li);
  }
}

function appendDeletedFileItems(listElement, files) {
  clearList(listElement);

  if (!files || files.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Nenhum arquivo encontrado para listar.';
    listElement.appendChild(li);
    return;
  }

  for (const file of files) {
    const li = document.createElement('li');
    const name = file.name || file.originalPath || 'Arquivo sem nome';
    li.textContent = `${name} - ${formatBytes(file.sizeBytes)}`;
    listElement.appendChild(li);
  }
}

async function updateRamPanel() {
  try {
    const data = await window.api.getRamUsage();
    const used = data.used;
    const total = data.total;
    const percent = data.percent;

    ramBar.style.width = `${percent}%`;
    ramBar.style.backgroundColor = getBarColor(percent);
    ramPercent.textContent = `${percent}%`;
    ramUsed.textContent = `Usada: ${formatBytesToGB(used)}`;
    ramTotal.textContent = `Total: ${formatBytesToGB(total)}`;
    appendProcessItems(data.processes);
  } catch (error) {
    ramPercent.textContent = 'Erro ao carregar RAM';
    clearList(ramProcessList);
  }
}

ramBtn.addEventListener('click', async () => {
  ramPanel.classList.remove('hidden');

  await updateRamPanel();

  if (ramIntervalId) {
    clearInterval(ramIntervalId);
  }

  ramIntervalId = setInterval(updateRamPanel, 1000);
});

hideRamPanelBtn.addEventListener('click', () => {
  ramPanel.classList.add('hidden');
  if (ramIntervalId) {
    clearInterval(ramIntervalId);
    ramIntervalId = null;
  }
});

temporaryBtn.addEventListener('click', async () => {
  statusTemporary.textContent = 'Limpando arquivos temporarios...';
  tempReport.classList.add('hidden');

  const resultado = await window.api.limparTemporarios();

  if (resultado.sucesso) {
    statusTemporary.textContent = resultado.mensagem;
    tempSummary.textContent = `Total liberado: ${formatBytes(resultado.totalBytes)} | Falhas: ${resultado.falhas}`;
    appendDeletedFileItems(tempDeletedList, resultado.arquivosDeletados);
    tempReport.classList.remove('hidden');
  } else {
    statusTemporary.textContent = `Erro: ${resultado.erro}`;
  }
});

cleanTrashBtn.addEventListener('click', async () => {
  statusTrash.textContent = 'Esvaziando lixeira...';
  trashReport.classList.add('hidden');

  const resultado = await window.api.emptyTrash();

  if (resultado.sucesso) {
    statusTrash.textContent = resultado.mensagem;
    trashSummary.textContent = `Total removido da lixeira: ${formatBytes(resultado.totalBytes)}`;
    appendDeletedFileItems(trashDeletedList, resultado.arquivosDeletados);
    trashReport.classList.remove('hidden');
  } else {
    statusTrash.textContent = `Erro: ${resultado.erro}`;
  }
});