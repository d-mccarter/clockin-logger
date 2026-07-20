const App = {
  selected: new Set(), // "date|index"

  async init() {
    this.bindNav();
    this.bindControls();
    this.bindSync();
    this.bindModals();
    await Storage.seedFromBundledFiles();
    this.syncDelayInput();
    this.renderTable();
    this.updateDataProfileUI();
    this.loadBuildLabel();
    await Storage.init();
    this.syncDelayInput();
    this.renderTable();
  },

  bindNav() {
    document.querySelectorAll('.nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.view;
        document.querySelectorAll('.nav-btn').forEach((b) => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.view').forEach((v) => {
          v.classList.toggle('active', v.id === `view-${view}`);
        });
        const title = document.getElementById('page-title');
        if (title) {
          title.textContent = view === 'clock' ? 'Clocker' : 'Settings';
        }
      });
    });
  },

  syncDelayInput() {
    const input = document.getElementById('delay-seconds');
    if (input) input.value = Storage.getDelaySeconds();
  },

  bindControls() {
    document.getElementById('fob-in-btn').addEventListener('click', () => {
      this.addFobPunch('in');
    });
    document.getElementById('fob-out-btn').addEventListener('click', () => {
      this.addFobPunch('out');
    });

    const delayInput = document.getElementById('delay-seconds');
    const commitDelay = () => {
      Storage.setDelaySeconds(delayInput.value);
      this.syncDelayInput();
      this.flashStatus(`Delay set to ${Storage.getDelaySeconds()}s`);
    };
    delayInput.addEventListener('change', commitDelay);
    document.getElementById('delay-down').addEventListener('click', () => {
      delayInput.value = String((parseInt(delayInput.value, 10) || 0) - 5);
      commitDelay();
    });
    document.getElementById('delay-up').addEventListener('click', () => {
      delayInput.value = String((parseInt(delayInput.value, 10) || 0) + 5);
      commitDelay();
    });

    document.getElementById('add-custom-btn').addEventListener('click', () => {
      this.openCustomModal();
    });
    document.getElementById('delete-selected-btn').addEventListener('click', () => {
      this.deleteSelected();
    });

    document.getElementById('times-table-body').addEventListener('click', (e) => {
      const cell = e.target.closest('[data-punch]');
      if (!cell) return;
      const key = cell.dataset.punch;
      if (this.selected.has(key)) this.selected.delete(key);
      else this.selected.add(key);
      this.renderTable();
    });
  },

  addFobPunch(direction) {
    const delay = Storage.getDelaySeconds();
    const adjusted = TimesFormat.applyDelay(new Date(), delay, direction);
    const isoDate = TimesFormat.dateToIsoDay(adjusted);
    const time24 = TimesFormat.dateToTime24(adjusted);
    Storage.upsertPunch(isoDate, time24);
    this.selected.clear();
    this.renderTable();
    const label = direction === 'in' ? 'FOB In' : 'FOB Out';
    this.flashStatus(
      `${label}: ${TimesFormat.formatDateMDY(isoDate)} ${TimesFormat.formatTime12(TimesFormat.parseTimeToken(time24))} (${delay >= 0 ? (direction === 'in' ? '−' : '+') : ''}${Math.abs(delay)}s)`
    );
  },

  deleteSelected() {
    if (!this.selected.size) {
      this.flashStatus('Select one or more times first', 'error');
      return;
    }
    if (!confirm(`Delete ${this.selected.size} selected time(s)?`)) return;
    const selections = [...this.selected].map((key) => {
      const [date, index] = key.split('|');
      return { date, index: parseInt(index, 10) };
    });
    Storage.deleteSelected(selections);
    this.selected.clear();
    this.renderTable();
    this.flashStatus('Deleted selected time(s)');
  },

  renderTable() {
    const tbody = document.getElementById('times-table-body');
    const theadRow = document.getElementById('times-table-head-row');
    const days = Storage.getDays().slice().reverse(); // newest first for phone use

    const maxTimes = days.reduce((max, d) => Math.max(max, (d.times || []).length), 4);

    theadRow.innerHTML = '';
    const dateTh = document.createElement('th');
    dateTh.className = 'col-date';
    dateTh.textContent = 'Date';
    theadRow.appendChild(dateTh);

    for (let i = 0; i < maxTimes; i++) {
      const th = document.createElement('th');
      th.textContent = i === 0 ? 'Times' : '';
      theadRow.appendChild(th);
    }

    const totalTh = document.createElement('th');
    totalTh.className = 'col-total';
    totalTh.textContent = 'Hours';
    theadRow.appendChild(totalTh);

    tbody.innerHTML = '';
    if (!days.length) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = maxTimes + 2;
      td.className = 'empty-row';
      td.textContent = 'No times yet — tap FOB In Now to start.';
      tr.appendChild(td);
      tbody.appendChild(tr);
      this.updateWeekSummary([]);
      return;
    }

    days.forEach((day) => {
      const tr = document.createElement('tr');
      const dateTd = document.createElement('td');
      dateTd.className = 'col-date';
      dateTd.textContent = TimesFormat.formatDateMDY(day.date);
      tr.appendChild(dateTd);

      for (let i = 0; i < maxTimes; i++) {
        const td = document.createElement('td');
        const t = day.times[i];
        if (t == null || t === '') {
          td.className = 'punch-empty';
          td.textContent = '';
        } else {
          const key = `${day.date}|${i}`;
          td.className = 'punch-cell' + (this.selected.has(key) ? ' selected' : '');
          td.dataset.punch = key;
          td.textContent = TimesFormat.formatTime12(TimesFormat.parseTimeToken(t));
          td.title = 'Tap to select';
        }
        tr.appendChild(td);
      }

      const totalTd = document.createElement('td');
      totalTd.className = 'col-total';
      totalTd.textContent = TimesFormat.dayTotalHours(day).toFixed(2);
      tr.appendChild(totalTd);
      tbody.appendChild(tr);
    });

    this.updateWeekSummary(days);
  },

  updateWeekSummary(daysNewestFirst) {
    const el = document.getElementById('week-summary');
    if (!el) return;
    const days = daysNewestFirst.slice().reverse();
    const now = new Date();
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    start.setHours(0, 0, 0, 0);
    const startIso = TimesFormat.dateToIsoDay(start);
    const endIso = TimesFormat.dateToIsoDay(now);
    let weekHours = 0;
    let allHours = 0;
    days.forEach((d) => {
      const h = TimesFormat.dayTotalHours(d);
      allHours += h;
      if (d.date >= startIso && d.date <= endIso) weekHours += h;
    });
    el.textContent = `This week ${weekHours.toFixed(2)}h · All ${allHours.toFixed(2)}h`;
  },

  flashStatus(message, type = 'info') {
    const el = document.getElementById('clock-status');
    if (!el) return;
    el.textContent = message;
    el.dataset.type = type;
    clearTimeout(this._statusTimer);
    this._statusTimer = setTimeout(() => {
      if (el.textContent === message) {
        el.textContent = '';
        el.dataset.type = '';
      }
    }, 4000);
  },

  bindModals() {
    const modal = document.getElementById('custom-time-modal');
    document.getElementById('custom-cancel-btn').addEventListener('click', () => {
      modal.hidden = true;
    });
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.hidden = true;
    });
    document.getElementById('custom-save-btn').addEventListener('click', () => {
      const dateVal = document.getElementById('custom-date').value;
      const timeVal = document.getElementById('custom-time').value;
      if (!dateVal || !timeVal) {
        alert('Enter both date and time');
        return;
      }
      const time24 = timeVal.slice(0, 5);
      Storage.upsertPunch(dateVal, time24);
      modal.hidden = true;
      this.renderTable();
      this.flashStatus(`Added ${TimesFormat.formatDateMDY(dateVal)} ${TimesFormat.formatTime12(TimesFormat.parseTimeToken(time24))}`);
    });

    document.getElementById('import-times-btn')?.addEventListener('click', () => {
      document.getElementById('import-file').click();
    });
    document.getElementById('import-file')?.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        let data;
        if (file.name.endsWith('.json')) {
          data = TimesFormat.normalize(JSON.parse(text));
        } else {
          data = TimesFormat.parseTimesTxt(text);
        }
        if (!confirm(`Replace current ${Storage.getProfile().label} data with ${data.days.length} day(s) from ${file.name}?`)) {
          e.target.value = '';
          return;
        }
        Storage.replaceAll(data);
        this.syncDelayInput();
        this.renderTable();
        this.flashStatus(`Imported ${data.days.length} day(s)`);
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
      e.target.value = '';
    });

    document.getElementById('export-times-btn')?.addEventListener('click', () => {
      const data = Storage.load();
      const txt = TimesFormat.toTimesTxt(data);
      const blob = new Blob([txt], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'times.txt';
      a.click();
      URL.revokeObjectURL(url);
    });

    document.getElementById('export-json-btn')?.addEventListener('click', () => {
      const data = Storage.load();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = Storage.getProfile().path.split('/').pop();
      a.click();
      URL.revokeObjectURL(url);
    });
  },

  openCustomModal() {
    const modal = document.getElementById('custom-time-modal');
    const now = new Date();
    document.getElementById('custom-date').value = TimesFormat.dateToIsoDay(now);
    document.getElementById('custom-time').value = TimesFormat.dateToTime24(now);
    modal.hidden = false;
  },

  updateDataProfileUI() {
    const profile = Storage.getProfile();
    document.querySelectorAll('[data-profile]').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.profile === profile.id);
    });

    const pathEl = document.getElementById('sync-data-path');
    if (pathEl) pathEl.textContent = `File: ${profile.path}`;

    const badge = document.getElementById('profile-badge');
    if (badge) {
      const isTest = profile.id === 'test';
      badge.hidden = !isTest;
      badge.textContent = 'Test data';
    }
  },

  bindSync() {
    const enabledBtn = document.getElementById('sync-enabled-btn');
    const statusEl = document.getElementById('sync-status');
    const fields = {
      owner: document.getElementById('sync-owner'),
      repo: document.getElementById('sync-repo'),
      token: document.getElementById('sync-token')
    };

    const setStatus = (message, type = 'info') => {
      statusEl.textContent = message;
      statusEl.dataset.type = type;
    };

    const isAutoSyncEnabled = () => enabledBtn.classList.contains('on');

    const updateAutoSyncButton = (enabled) => {
      enabledBtn.classList.toggle('on', enabled);
      enabledBtn.classList.toggle('off', !enabled);
      enabledBtn.textContent = enabled ? 'On' : 'Off';
      enabledBtn.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    };

    const readSettings = () => GitHubSync.normalizeSettings({
      enabled: isAutoSyncEnabled(),
      owner: fields.owner.value,
      repo: fields.repo.value,
      branch: 'main',
      path: Storage.getProfile().path,
      token: fields.token.value
    });

    const saveSettingsFromForm = () => {
      const settings = readSettings();
      Storage.saveSyncSettings(settings);
      return settings;
    };

    const applySettings = (settings) => {
      updateAutoSyncButton(!!settings.enabled);
      fields.owner.value = settings.owner;
      fields.repo.value = settings.repo;
      fields.token.value = settings.token;
    };

    const refreshAfterSync = () => {
      this.syncDelayInput();
      this.renderTable();
    };

    const runInitialSync = async (settings) => {
      const { data: remote, sha } = await GitHubSync.fetchRemote(settings);
      const local = Storage.load();

      Storage._fileSha = sha;

      if (Storage.isEmpty(remote) && !Storage.isEmpty(local)) {
        await Storage.pushToGitHub({ settings });
      } else {
        await Storage.pullFromGitHub({ settings });
        refreshAfterSync();
      }
    };

    const switchDataProfile = async (profileId) => {
      if (profileId === Storage.getProfileId()) return;

      const profile = Storage.setProfile(profileId);
      this.selected.clear();
      this.updateDataProfileUI();
      await Storage.seedFromBundledFiles();
      refreshAfterSync();

      const settings = saveSettingsFromForm();
      setStatus(`Switched to ${profile.label} data (${profile.path}).`, 'info');

      if (GitHubSync.isAutoSyncEnabled(settings)) {
        setStatus(`Loading ${profile.label} data…`, 'info');
        try {
          await runInitialSync(settings);
          setStatus(`Using ${profile.label} data.`, 'success');
        } catch (error) {
          setStatus(error.message, 'error');
        }
      }
    };

    Storage.onSyncStatus = (message, type) => setStatus(message, type);

    applySettings(Storage.getSyncSettings());
    this.updateDataProfileUI();

    document.querySelectorAll('[data-profile]').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchDataProfile(btn.dataset.profile);
      });
    });

    enabledBtn.addEventListener('click', async () => {
      updateAutoSyncButton(!isAutoSyncEnabled());
      const settings = saveSettingsFromForm();

      if (!settings.enabled) {
        setStatus('Auto-sync off. You can still use Test, Pull, and Push.', 'info');
        return;
      }

      if (!settings.token) {
        setStatus('Paste your token first, then turn auto-sync on.', 'error');
        updateAutoSyncButton(false);
        saveSettingsFromForm();
        return;
      }

      setStatus('Connecting…', 'info');
      try {
        await runInitialSync(settings);
        refreshAfterSync();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    Object.values(fields).forEach((field) => {
      field.addEventListener('input', () => saveSettingsFromForm());
      field.addEventListener('change', () => saveSettingsFromForm());
      field.addEventListener('paste', () => {
        setTimeout(() => saveSettingsFromForm(), 0);
      });
    });

    document.getElementById('sync-test-btn').addEventListener('click', async (event) => {
      event.preventDefault();
      const btn = event.currentTarget;
      const settings = readSettings();
      saveSettingsFromForm();

      setStatus('Testing token…', 'info');
      btn.disabled = true;

      try {
        const user = await GitHubSync.testToken(settings);
        setStatus(`Token OK — signed in as ${user.login}`, 'success');
      } catch (error) {
        setStatus(error.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById('sync-pull-btn').addEventListener('click', async () => {
      const settings = saveSettingsFromForm();
      try {
        await Storage.pullFromGitHub({ settings });
        refreshAfterSync();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    document.getElementById('sync-push-btn').addEventListener('click', async () => {
      const settings = saveSettingsFromForm();
      try {
        await Storage.pushToGitHub({ settings });
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });
  },

  async loadBuildLabel() {
    const el = document.getElementById('build-label');
    if (!el) return;
    try {
      const res = await fetch('./build.json', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      el.textContent = `Build ${data.build}`;
    } catch {
      el.textContent = '';
    }
  }
};

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});
