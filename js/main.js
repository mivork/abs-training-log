/**
 * 腹筋トレーニング記録 - メインスクリプト
 * 既存実装の全ロジックを外部ファイルに移植。
 * localStorage キー・記録形式・同期挙動は既存と完全互換。
 */
(function () {
  'use strict';

  // ===== 定数 =====
  const STORAGE_KEY = 'absTrainingLogEntriesV1';
  const SYNC_TOKEN_KEY = 'absTrainingLogSyncTokenV1';
  const SYNC_REPO_KEY = 'absTrainingLogSyncRepoV1';
  const SYNC_DEFAULT_REPO = 'mivork/abs-training-data';

  const TYPE_LABELS = {
    videoA: '動画A（鬼の腹筋）',
    videoB: '動画B（4分腹筋）',
    videoC: '動画C（下腹集中4分）',
    videoD: '動画D（脇腹3分）',
    videoE: '動画E（鬼の腹筋・強度高め）',
    videoF: '動画F（鬼の腹筋・8分）',
    videoG: '動画G（限界突破・悟り4分）',
    light: '軽い体幹',
    none: 'なし'
  };

  const VIDEO_LABELS = {
    videoA: '動画A',
    videoB: '動画B',
    videoC: '動画C',
    videoD: '動画D',
    videoE: '動画E',
    videoF: '動画F',
    videoG: '動画G'
  };

  // ===== 状態 =====
  let entries = loadEntries();
  let editingId = null;
  let weightChart = null;
  let weeklyChart = null;
  let videoCountChart = null;

  // ===== DOM 参照 =====
  const form = document.getElementById('logForm');
  const dateInput = document.getElementById('date');
  const typeInput = document.getElementById('sessionType');
  const sorenessInput = document.getElementById('soreness');
  const backInput = document.getElementById('backPain');
  const weightInput = document.getElementById('weight');
  const sleepInput = document.getElementById('sleep');
  const completedInput = document.getElementById('completed');
  const eatingOutInput = document.getElementById('eatingOut');
  const longWalkInput = document.getElementById('longWalk');
  const memoInput = document.getElementById('memo');
  const submitBtn = document.getElementById('submitBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const formTitle = document.getElementById('formTitle');
  const listEl = document.getElementById('entryList');

  dateInput.value = todayString();

  // ===== フォームイベント =====
  form.addEventListener('submit', onSubmit);
  cancelEditBtn.addEventListener('click', resetForm);

  // Ctrl+Enter / Cmd+Enter でフォームを送信
  form.addEventListener('keydown', (ev) => {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      }
    }
  });

  // ===== 入出力 =====
  document.getElementById('exportBtn').addEventListener('click', exportJson);
  const importFile = document.getElementById('importFile');
  document.getElementById('importBtn').addEventListener('click', () => {
    importFile.click();
  });
  importFile.addEventListener('change', importJson);

  // ===== 共有ボタン =====
  document.getElementById('shareBtn').addEventListener('click', () => {
    const shareData = {
      title: document.title,
      text: '腹筋トレーニング記録',
      url: location.href
    };
    if (navigator.share) {
      navigator.share(shareData).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(location.href).then(() => {
        alert('URLをコピーしました。');
      });
    } else {
      alert('このブラウザでは共有機能が使えません。URLをコピーして共有してください。');
    }
  });

  // ===== 動画の埋め込み再生（dialog + youtube-nocookie） =====
  const videoDialog = document.getElementById('videoDialog');
  const videoFrame = document.getElementById('videoFrame');
  const videoDialogTitle = document.getElementById('videoDialogTitle');

  document.querySelectorAll('button[data-embed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      videoDialogTitle.textContent = btn.getAttribute('data-title');
      videoFrame.src =
        'https://www.youtube-nocookie.com/embed/' +
        btn.getAttribute('data-embed') +
        '?autoplay=1&rel=0';
      if (typeof videoDialog.showModal === 'function') {
        videoDialog.showModal();
      }
    });
  });

  function closeVideo() {
    videoFrame.src = '';
    if (videoDialog.open) {
      videoDialog.close();
    }
  }

  document.getElementById('videoCloseBtn').addEventListener('click', closeVideo);

  videoDialog.addEventListener('click', (ev) => {
    if (ev.target === videoDialog) {
      closeVideo();
    }
  });
  videoDialog.addEventListener('close', () => {
    videoFrame.src = '';
  });

  // ===== 入出力／同期タブ切り替え =====
  const ioTabMain = document.getElementById('ioTabMain');
  const ioTabSync = document.getElementById('ioTabSync');
  const ioPanelMain = document.getElementById('ioPanelMain');
  const ioPanelSync = document.getElementById('ioPanelSync');

  function selectIoTab(which) {
    const isMain = which === 'main';
    ioPanelMain.hidden = !isMain;
    ioPanelSync.hidden = isMain;
    ioTabMain.classList.toggle('is-active', isMain);
    ioTabSync.classList.toggle('is-active', !isMain);
    ioTabMain.setAttribute('aria-selected', isMain ? 'true' : 'false');
    ioTabSync.setAttribute('aria-selected', isMain ? 'false' : 'true');
  }

  ioTabMain.addEventListener('click', () => {
    selectIoTab('main');
  });
  ioTabSync.addEventListener('click', () => {
    selectIoTab('sync');
  });

  // ===== プライベート同期（GitHub Contents API） =====
  const syncRepoInput = document.getElementById('syncRepo');
  const syncTokenInput = document.getElementById('syncToken');
  const syncStatusEl = document.getElementById('syncStatus');

  syncRepoInput.value = localStorage.getItem(SYNC_REPO_KEY) || SYNC_DEFAULT_REPO;
  syncTokenInput.value = localStorage.getItem(SYNC_TOKEN_KEY) || '';

  function syncConfig() {
    return {
      repo: (syncRepoInput.value || '').trim() || SYNC_DEFAULT_REPO,
      token: (localStorage.getItem(SYNC_TOKEN_KEY) || '').trim()
    };
  }

  function setSyncStatus(msg) {
    syncStatusEl.textContent = msg;
  }

  function refreshSyncStatus() {
    if (syncConfig().token) {
      setSyncStatus('設定済み: 記録の変更は自動で同期されます');
    } else {
      setSyncStatus('未設定: トークンを入れると自動同期します');
    }
  }

  function utf8ToBase64(str) {
    return btoa(String.fromCharCode.apply(null, new TextEncoder().encode(str)));
  }

  function base64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  function ghHeaders(token) {
    return {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }

  function ghDataUrl(repo) {
    return 'https://api.github.com/repos/' + repo + '/contents/data.json';
  }

  function pushToGitHub(isRetry) {
    const cfg = syncConfig();
    if (!cfg.token) {
      refreshSyncStatus();
      return Promise.resolve(false);
    }
    setSyncStatus('同期中...');
    return fetch(ghDataUrl(cfg.repo), { headers: ghHeaders(cfg.token) })
      .then((res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error('GET ' + res.status);
        return res.json();
      })
      .then((fileInfo) => {
        const payload = JSON.stringify(sortedEntries(false), null, 2);
        const body = {
          message: 'Update training log data',
          content: utf8ToBase64(payload)
        };
        if (fileInfo && fileInfo.sha) {
          body.sha = fileInfo.sha;
        }
        return fetch(ghDataUrl(cfg.repo), {
          method: 'PUT',
          headers: ghHeaders(cfg.token),
          body: JSON.stringify(body)
        });
      })
      .then((res) => {
        if (res.status === 409 && !isRetry) return pushToGitHub(true);
        if (!res.ok) throw new Error('PUT ' + res.status);
        const now = new Date();
        setSyncStatus(
          '同期済み（' + pad2(now.getHours()) + ':' + pad2(now.getMinutes()) + '）'
        );
        return true;
      })
      .catch((err) => {
        setSyncStatus(
          '同期に失敗しました（' + err.message + '）。トークンとリポジトリをご確認ください'
        );
        return false;
      });
  }

  function trySyncPush() {
    if (syncConfig().token) {
      pushToGitHub(false);
    }
  }

  function pullFromGitHub() {
    const cfg = syncConfig();
    if (!cfg.token) {
      setSyncStatus('未設定: 先にトークンを保存してください');
      return;
    }
    setSyncStatus('クラウドから読み込み中...');
    fetch(ghDataUrl(cfg.repo), { headers: ghHeaders(cfg.token) })
      .then((res) => {
        if (res.status === 404) {
          setSyncStatus('クラウドに data.json がまだありません');
          return null;
        }
        if (!res.ok) throw new Error('GET ' + res.status);
        return res.json();
      })
      .then((fileInfo) => {
        if (!fileInfo) return;
        const parsed = JSON.parse(base64ToUtf8(fileInfo.content));
        if (!Array.isArray(parsed)) throw new Error('not an array');
        const cleaned = parsed.map(normalizeEntry).filter((e) => e !== null);
        if (
          !window.confirm(
            'クラウドの記録 ' +
              cleaned.length +
              ' 件を読み込み、この端末のデータを置き換えますか？'
          )
        ) {
          refreshSyncStatus();
          return;
        }
        entries = cleaned;
        saveEntries();
        resetForm();
        renderAll();
        setSyncStatus('クラウドから読み込みました（' + cleaned.length + ' 件）');
      })
      .catch((err) => {
        setSyncStatus('読み込みに失敗しました（' + err.message + '）');
      });
  }

  document.getElementById('syncSaveBtn').addEventListener('click', () => {
    localStorage.setItem(
      SYNC_REPO_KEY,
      (syncRepoInput.value || '').trim() || SYNC_DEFAULT_REPO
    );
    localStorage.setItem(SYNC_TOKEN_KEY, (syncTokenInput.value || '').trim());
    if (syncConfig().token) {
      pushToGitHub(false);
    } else {
      refreshSyncStatus();
    }
  });

  document.getElementById('syncPullBtn').addEventListener('click', pullFromGitHub);
  refreshSyncStatus();

  // 端末に記録がなく、同期設定がある場合はクラウドから自動で取り込む
  if (syncConfig().token && entries.length === 0) {
    const autoCfg = syncConfig();
    fetch(ghDataUrl(autoCfg.repo), { headers: ghHeaders(autoCfg.token) })
      .then((res) => (res.ok ? res.json() : null))
      .then((fileInfo) => {
        if (!fileInfo) return;
        const parsed = JSON.parse(base64ToUtf8(fileInfo.content));
        if (!Array.isArray(parsed) || parsed.length === 0) return;
        entries = parsed.map(normalizeEntry).filter((e) => e !== null);
        saveEntries();
        renderAll();
        setSyncStatus('クラウドの記録を自動で取り込みました');
      })
      .catch(() => {});
  }

  // ===== PWA: Service Worker =====
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ===== 初期描画 =====
  renderAll();

  // =========================================================================
  //  データ操作
  // =========================================================================

  function loadEntries() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.map(normalizeEntry).filter((e) => e !== null);
    } catch (e) {
      return [];
    }
  }

  function saveEntries() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }

  function normalizeEntry(item) {
    if (!item || typeof item !== 'object') return null;
    if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
      return null;
    }
    const type = Object.prototype.hasOwnProperty.call(TYPE_LABELS, item.sessionType)
      ? item.sessionType
      : 'none';
    return {
      id: typeof item.id === 'string' && item.id ? item.id : makeId(),
      date: item.date,
      sessionType: type,
      completed: !!item.completed,
      soreness: clampScale(item.soreness),
      backPain: clampScale(item.backPain),
      weight: toNumberOrNull(item.weight),
      sleep: toNumberOrNull(item.sleep),
      eatingOut: !!item.eatingOut,
      longWalk: !!item.longWalk,
      memo: typeof item.memo === 'string' ? item.memo : ''
    };
  }

  function clampScale(v) {
    const n = parseInt(v, 10);
    if (isNaN(n) || n < 0) return 0;
    if (n > 3) return 3;
    return n;
  }

  function toNumberOrNull(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isNaN(n) ? null : n;
  }

  function makeId() {
    return (
      Date.now().toString(36) +
      '-' +
      Math.floor(Math.random() * 1000000000).toString(36)
    );
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function formatDateObj(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function todayString() {
    return formatDateObj(new Date());
  }

  function parseDate(dateStr) {
    return new Date(dateStr + 'T00:00:00');
  }

  function weekStartString(dateStr) {
    const d = parseDate(dateStr);
    const diff = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - diff);
    return formatDateObj(d);
  }

  function isSession(entry) {
    return !!entry.completed && entry.sessionType !== 'none';
  }

  function findById(id) {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].id === id) return entries[i];
    }
    return null;
  }

  function sortedEntries(desc) {
    const copy = entries.slice();
    copy.sort((a, b) => {
      if (a.date < b.date) return desc ? 1 : -1;
      if (a.date > b.date) return desc ? -1 : 1;
      return 0;
    });
    return copy;
  }

  function average(nums) {
    let sum = 0;
    for (const n of nums) {
      sum += n;
    }
    return nums.length ? sum / nums.length : 0;
  }

  // =========================================================================
  //  フォーム操作
  // =========================================================================

  function onSubmit(ev) {
    ev.preventDefault();
    const data = {
      date: dateInput.value,
      sessionType: typeInput.value,
      completed: completedInput.checked,
      soreness: clampScale(sorenessInput.value),
      backPain: clampScale(backInput.value),
      weight: toNumberOrNull(weightInput.value),
      sleep: toNumberOrNull(sleepInput.value),
      eatingOut: eatingOutInput.checked,
      longWalk: longWalkInput.checked,
      memo: memoInput.value.trim()
    };
    if (!data.date) {
      alert('日付を入力してください。');
      return;
    }
    if (editingId) {
      for (let i = 0; i < entries.length; i++) {
        if (entries[i].id === editingId) {
          data.id = editingId;
          entries[i] = data;
          break;
        }
      }
    } else {
      let dupIndex = -1;
      for (let j = 0; j < entries.length; j++) {
        if (entries[j].date === data.date) {
          dupIndex = j;
          break;
        }
      }
      if (dupIndex >= 0) {
        if (!window.confirm('同じ日付の記録がすでにあります。置き換えますか？')) return;
        data.id = entries[dupIndex].id;
        entries[dupIndex] = data;
      } else {
        data.id = makeId();
        entries.push(data);
      }
    }
    saveEntries();
    resetForm();
    renderAll();
    trySyncPush();
  }

  function resetForm() {
    editingId = null;
    form.reset();
    dateInput.value = todayString();
    submitBtn.textContent = '保存する';
    formTitle.textContent = '記録する';
    cancelEditBtn.hidden = true;
  }

  function startEdit(id) {
    const entry = findById(id);
    if (!entry) return;
    editingId = id;
    dateInput.value = entry.date;
    typeInput.value = entry.sessionType;
    sorenessInput.value = String(entry.soreness);
    backInput.value = String(entry.backPain);
    weightInput.value = entry.weight === null ? '' : String(entry.weight);
    sleepInput.value = entry.sleep === null ? '' : String(entry.sleep);
    completedInput.checked = !!entry.completed;
    eatingOutInput.checked = !!entry.eatingOut;
    longWalkInput.checked = !!entry.longWalk;
    memoInput.value = entry.memo || '';
    submitBtn.textContent = '更新する';
    formTitle.textContent = '記録を編集';
    cancelEditBtn.hidden = false;
    const recordSection = document.getElementById('record');
    if (recordSection) {
      recordSection.scrollIntoView({ behavior: 'smooth' });
    }
  }

  function deleteEntry(id) {
    const entry = findById(id);
    if (!entry) return;
    if (!window.confirm(entry.date + ' の記録を削除しますか？')) return;
    entries = entries.filter((e) => e.id !== id);
    if (editingId === id) resetForm();
    saveEntries();
    renderAll();
    trySyncPush();
  }

  // =========================================================================
  //  描画
  // =========================================================================

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderAll() {
    renderList();
    renderStats();
    renderHeroStats();
    renderCharts();
  }

  function renderList() {
    const sorted = sortedEntries(true);
    if (sorted.length === 0) {
      listEl.innerHTML =
        '<p class="entry-list__empty">まだ記録がありません。上のフォームから最初の記録を追加してください。</p>';
      return;
    }
    const htmlParts = [];
    for (const entry of sorted) {
      const session = isSession(entry);
      const meta = [];
      meta.push('筋肉痛（翌日）: ' + entry.soreness);
      meta.push('腰の違和感: ' + entry.backPain);
      if (entry.weight !== null) meta.push('体重: ' + entry.weight + ' kg');
      if (entry.sleep !== null) meta.push('睡眠: ' + entry.sleep + ' 時間');
      if (entry.eatingOut) meta.push('外食あり');
      if (entry.longWalk) meta.push('長く歩いた');

      let html = '';
      html += '<div class="entry">';
      html += '<div class="entry__header">';
      html +=
        '<span class="entry__date">' + escapeHtml(entry.date) + '</span>';
      html +=
        '<span class="badge' +
        (session ? '' : ' badge--off') +
        '">' +
        escapeHtml(TYPE_LABELS[entry.sessionType]) +
        (session ? '・実施' : '') +
        '</span>';
      html += '</div>';
      html +=
        '<div class="entry__meta">' +
        escapeHtml(meta.join(' / ')) +
        '</div>';
      if (entry.memo) {
        html +=
          '<div class="entry__memo">' + escapeHtml(entry.memo) + '</div>';
      }
      html += '<div class="entry__actions">';
      html +=
        '<button type="button" class="btn btn--secondary btn--small" data-action="edit" data-id="' +
        escapeHtml(entry.id) +
        '">編集</button>';
      html +=
        '<button type="button" class="btn btn--danger btn--small" data-action="delete" data-id="' +
        escapeHtml(entry.id) +
        '">削除</button>';
      html += '</div>';
      html += '</div>';
      htmlParts.push(html);
    }
    listEl.innerHTML = htmlParts.join('');

    const buttons = listEl.querySelectorAll('button[data-action]');
    for (const btn of buttons) {
      btn.addEventListener('click', () => {
        if (btn.getAttribute('data-action') === 'edit') {
          startEdit(btn.getAttribute('data-id'));
        }
        if (btn.getAttribute('data-action') === 'delete') {
          deleteEntry(btn.getAttribute('data-id'));
        }
      });
    }
  }

  function renderStats() {
    const totalEl = document.getElementById('statTotal');
    const recentEl = document.getElementById('statRecent');
    const changeEl = document.getElementById('statWeightChange');
    const changeSubEl = document.getElementById('statWeightChangeSub');
    const avgEl = document.getElementById('statAvgCompare');

    const sessions = entries.filter(isSession);
    totalEl.textContent = String(sessions.length) + ' 回';

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 27);
    const recentCount = sessions.filter((e) => parseDate(e.date) >= start).length;
    recentEl.textContent = String(recentCount) + ' 回';

    const withWeight = sortedEntries(false).filter((e) => e.weight !== null);
    if (withWeight.length < 2) {
      changeEl.textContent = 'データが足りません';
      changeSubEl.textContent = '体重の記録が2件以上あると変化を表示します';
    } else {
      const first = withWeight[0];
      const last = withWeight[withWeight.length - 1];
      const diff = last.weight - first.weight;
      const sign = diff > 0 ? '+' : '';
      changeEl.textContent = sign + diff.toFixed(2) + ' kg';
      changeSubEl.textContent =
        first.date +
        ' の ' +
        first.weight +
        ' kg から ' +
        last.date +
        ' の ' +
        last.weight +
        ' kg';
    }

    const weekMap = {};
    for (const e of entries) {
      const wk = weekStartString(e.date);
      if (!weekMap[wk]) weekMap[wk] = { sessions: 0, weights: [] };
      if (isSession(e)) weekMap[wk].sessions += 1;
      if (e.weight !== null) weekMap[wk].weights.push(e.weight);
    }
    const highWeights = [];
    const lowWeights = [];
    for (const wk of Object.keys(weekMap)) {
      const bucket = weekMap[wk];
      const target = bucket.sessions >= 4 ? highWeights : lowWeights;
      for (const w of bucket.weights) {
        target.push(w);
      }
    }
    if (highWeights.length === 0 || lowWeights.length === 0) {
      avgEl.textContent =
        'データが足りません（両方の週の体重記録が必要です）';
    } else {
      const highAvg = average(highWeights);
      const lowAvg = average(lowWeights);
      avgEl.textContent =
        '週4回以上: 平均 ' +
        highAvg.toFixed(2) +
        ' kg / 週4回未満: 平均 ' +
        lowAvg.toFixed(2) +
        ' kg';
    }
  }

  function renderHeroStats() {
    const heroTotalEl = document.getElementById('heroTotal');
    const heroRecentEl = document.getElementById('heroRecent');
    const heroWeightEl = document.getElementById('heroWeight');

    const sessions = entries.filter(isSession);
    heroTotalEl.textContent = String(sessions.length) + ' 回';

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - 27);
    const recentCount = sessions.filter((e) => parseDate(e.date) >= start).length;
    heroRecentEl.textContent = String(recentCount) + ' 回';

    const withWeight = sortedEntries(false).filter((e) => e.weight !== null);
    if (withWeight.length < 2) {
      heroWeightEl.textContent = '-';
    } else {
      const first = withWeight[0];
      const last = withWeight[withWeight.length - 1];
      const diff = last.weight - first.weight;
      const sign = diff > 0 ? '+' : '';
      heroWeightEl.textContent = sign + diff.toFixed(2) + ' kg';
    }
  }

  // =========================================================================
  //  グラフ描画
  // =========================================================================

  function renderCharts() {
    if (typeof Chart === 'undefined') {
      document.getElementById('chartNote').style.display = 'block';
      return;
    }

    renderWeightChart();
    renderWeeklyChart();
    renderVideoCountChart();
  }

  function renderWeightChart() {
    const withWeight = sortedEntries(false).filter((e) => e.weight !== null);
    const labels = withWeight.map((e) => e.date);
    const values = withWeight.map((e) => e.weight);
    const pointColors = withWeight.map((e) =>
      isSession(e) ? '#ce0000' : '#0017c1'
    );
    const pointSizes = withWeight.map((e) => (isSession(e) ? 7 : 4));

    const ctx = document.getElementById('weightChart').getContext('2d');
    if (weightChart) weightChart.destroy();
    weightChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '体重 (kg)',
            data: values,
            borderColor: '#0017c1',
            backgroundColor: pointColors,
            pointBackgroundColor: pointColors,
            pointBorderColor: pointColors,
            pointRadius: pointSizes,
            pointHoverRadius: 8,
            tension: 0.15,
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: { title: { display: true, text: 'kg' } },
          x: { ticks: { maxTicksLimit: 8 } }
        }
      }
    });
  }

  function renderWeeklyChart() {
    const weekMap = {};
    for (const e of entries) {
      if (!isSession(e)) continue;
      const wk = weekStartString(e.date);
      weekMap[wk] = (weekMap[wk] || 0) + 1;
    }
    const weekKeys = Object.keys(weekMap).sort();
    const weekCounts = weekKeys.map((k) => weekMap[k]);

    const ctx = document.getElementById('weeklyChart').getContext('2d');
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: weekKeys,
        datasets: [
          {
            label: 'セッション数',
            data: weekCounts,
            backgroundColor: '#0017c1'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 },
            title: { display: true, text: '回' }
          },
          x: { ticks: { maxTicksLimit: 8 } }
        }
      },
      plugins: [
        {
          // 週4回の目標ラインをカスタムプラグインで描画
          id: 'goalLine',
          afterDraw(chart) {
            const yScale = chart.scales.y;
            if (!yScale) return;
            const goalY = yScale.getPixelForValue(4);
            if (goalY < chart.chartArea.top || goalY > chart.chartArea.bottom) return;
            const ctx2 = chart.ctx;
            ctx2.save();
            ctx2.beginPath();
            ctx2.setLineDash([6, 4]);
            ctx2.strokeStyle = '#ce0000';
            ctx2.lineWidth = 2;
            ctx2.moveTo(chart.chartArea.left, goalY);
            ctx2.lineTo(chart.chartArea.right, goalY);
            ctx2.stroke();
            ctx2.setLineDash([]);
            ctx2.fillStyle = '#ce0000';
            ctx2.font = 'bold 11px sans-serif';
            ctx2.textAlign = 'right';
            ctx2.fillText('目標: 週4回', chart.chartArea.right, goalY - 5);
            ctx2.restore();
          }
        }
      ]
    });
  }

  function renderVideoCountChart() {
    // 動画A〜Gの実施回数を集計
    const videoKeys = ['videoA', 'videoB', 'videoC', 'videoD', 'videoE', 'videoF', 'videoG'];
    const counts = videoKeys.map((key) =>
      entries.filter((e) => isSession(e) && e.sessionType === key).length
    );
    const labels = videoKeys.map((key) => VIDEO_LABELS[key]);

    const ctx = document.getElementById('videoCountChart').getContext('2d');
    if (videoCountChart) videoCountChart.destroy();
    videoCountChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '実施回数',
            data: counts,
            backgroundColor: [
              '#0017c1',
              '#0031d8',
              '#2952cc',
              '#4d6fbf',
              '#7090d3',
              '#94b0e6',
              '#b3ccff'
            ]
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1 },
            title: { display: true, text: '回' }
          }
        }
      }
    });
  }

  // =========================================================================
  //  JSON 入出力
  // =========================================================================

  function exportJson() {
    const payload = JSON.stringify(sortedEntries(false), null, 2);
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'abs-training-log.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 500);
  }

  function importJson() {
    const file = importFile.files && importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        if (!Array.isArray(parsed)) throw new Error('not an array');
        const cleaned = parsed.map(normalizeEntry).filter((e) => e !== null);
        if (cleaned.length === 0) {
          alert('読み込める記録がありませんでした。');
          return;
        }
        if (
          !window.confirm(
            cleaned.length + ' 件の記録を読み込み、現在のデータを置き換えますか？'
          )
        ) {
          return;
        }
        entries = cleaned;
        saveEntries();
        resetForm();
        renderAll();
        trySyncPush();
        alert('読み込みが完了しました。');
      } catch (e) {
        alert('JSONの読み込みに失敗しました。ファイルの形式をご確認ください。');
      } finally {
        importFile.value = '';
      }
    };
    reader.readAsText(file);
  }
})();
