const App = {
  selected: new Set(), // "date|index"

  async init() {
    try {
      this.ensureFreshShell();
      this.bindNav();
      this.bindControls();
      this.bindSync();
      this.bindModals();
      this.bindCharts();
      this.updateDataProfileUI();
      this.renderTable();
      this.loadBuildLabel();

      await ClockerStore.seedFromBundledFiles();
      this.renderTable();
      this.flashStatus('');

      await ClockerStore.init();
      this.renderTable();
      if (document.getElementById('view-charts')?.classList.contains('active')) {
        this.renderCharts();
      }
    } catch (error) {
      console.error(error);
      this.flashStatus(`Startup error: ${error.message || error}`, 'error');
    }
  },

  /**
   * Safari (esp. Home Screen) can keep a stale index.html while still
   * fetching a fresh build.json — so Build N shows without the Charts tab.
   * Force a cache-busting navigation when the Charts shell is missing.
   */
  ensureFreshShell() {
    const hasCharts =
      document.querySelector('.nav-btn[data-view="charts"]') &&
      document.getElementById('view-charts');
    if (hasCharts) return;

    try {
      const shell = String(window.__CLOCKER_SHELL__ || Date.now());
      const key = `clocker_shell_bust_${shell}`;
      if (sessionStorage.getItem(key) === '1') return;
      sessionStorage.setItem(key, '1');
      const url = new URL(location.href);
      url.searchParams.set('_shell', shell);
      url.searchParams.set('_t', String(Date.now()));
      location.replace(url.toString());
    } catch {
      // ignore
    }
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
          title.textContent = view === 'clock' ? 'Clocker' : view === 'charts' ? 'Charts' : 'Settings';
        }
        if (view === 'charts') {
          requestAnimationFrame(() => this.renderCharts());
        }
      });
    });
  },

  bindControls() {
    document.getElementById('fob-in-btn').addEventListener('click', () => {
      this.addFobPunch('in');
    });
    document.getElementById('fob-out-btn').addEventListener('click', () => {
      this.addFobPunch('out');
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
    const now = new Date();
    const isoDate = TimesFormat.dateToIsoDay(now);
    const time24 = TimesFormat.dateToTime24(now);
    ClockerStore.upsertPunch(isoDate, time24);
    this.selected.clear();
    this.renderTable();
    const label = direction === 'in' ? 'FOB In' : 'FOB Out';
    this.flashStatus(
      `${label}: ${TimesFormat.formatDateMDY(isoDate)} ${TimesFormat.formatTime12(TimesFormat.parseTimeToken(time24))}`
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
    ClockerStore.deleteSelected(selections);
    this.selected.clear();
    this.renderTable();
    this.flashStatus('Deleted selected time(s)');
  },

  renderTable() {
    const tbody = document.getElementById('times-table-body');
    const theadRow = document.getElementById('times-table-head-row');
    const days = ClockerStore.getDays().slice().reverse(); // newest first → left
    const maxTimes = Math.max(
      4,
      days.reduce((max, d) => Math.max(max, (d.times || []).length), 0)
    );

    theadRow.innerHTML = '';
    tbody.innerHTML = '';

    const corner = document.createElement('th');
    corner.className = 'col-label';
    corner.textContent = '';
    corner.scope = 'col';
    theadRow.appendChild(corner);

    if (!days.length) {
      const emptyTh = document.createElement('th');
      emptyTh.className = 'col-day';
      emptyTh.textContent = '—';
      theadRow.appendChild(emptyTh);

      const tr = document.createElement('tr');
      const label = document.createElement('td');
      label.className = 'col-label';
      label.textContent = '';
      tr.appendChild(label);
      const td = document.createElement('td');
      td.className = 'empty-row';
      td.textContent = 'No times yet — tap FOB In Now to start.';
      tr.appendChild(td);
      tbody.appendChild(tr);

      this.updateWeekSummary([]);
      this.syncTodayTicker([]);
      if (document.getElementById('view-charts')?.classList.contains('active')) {
        this.renderCharts();
      }
      return;
    }

    days.forEach((day) => {
      const th = document.createElement('th');
      th.className = 'col-day';
      th.scope = 'col';
      th.dataset.date = day.date;
      th.title = TimesFormat.formatDateMDY(day.date);

      const weekday = document.createElement('span');
      weekday.className = 'day-weekday';
      weekday.textContent = TimesFormat.formatWeekdayAbbrev(day.date);

      const date = document.createElement('span');
      date.className = 'day-date';
      date.textContent = TimesFormat.formatDateColumn(day.date);

      th.appendChild(weekday);
      th.appendChild(date);
      theadRow.appendChild(th);
    });

    for (let i = 0; i < maxTimes; i++) {
      const tr = document.createElement('tr');
      const label = document.createElement('td');
      label.className = 'col-label';
      label.textContent = i === 0 ? 'Times' : '';
      tr.appendChild(label);

      days.forEach((day) => {
        const td = document.createElement('td');
        td.dataset.date = day.date;
        const t = day.times[i];
        if (t == null || t === '') {
          td.className = 'punch-empty';
          td.textContent = '';
        } else {
          const key = `${day.date}|${i}`;
          td.className = 'punch-cell' + (this.selected.has(key) ? ' selected' : '');
          td.dataset.punch = key;
          td.textContent = TimesFormat.formatTimeCompact(TimesFormat.parseTimeToken(t));
          td.title = TimesFormat.formatTime12(TimesFormat.parseTimeToken(t));
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    }

    const hrsTr = document.createElement('tr');
    hrsTr.className = 'hrs-row';
    const hrsLabel = document.createElement('td');
    hrsLabel.className = 'col-label col-total-label';
    hrsLabel.textContent = 'Hrs';
    hrsTr.appendChild(hrsLabel);
    const todayIso = TimesFormat.dateToIsoDay(new Date());
    days.forEach((day) => {
      const td = document.createElement('td');
      td.className = 'col-total';
      td.dataset.date = day.date;
      if (day.date === todayIso) td.dataset.todayHours = '1';
      const hours =
        day.date === todayIso
          ? TimesFormat.dayCumulativeHours(day) ?? 0
          : TimesFormat.dayTotalHours(day);
      td.textContent = hours.toFixed(2);
      hrsTr.appendChild(td);
    });
    tbody.appendChild(hrsTr);

    this.updateWeekSummary(days);
    this.syncTodayTicker(days);
    if (document.getElementById('view-charts')?.classList.contains('active')) {
      this.renderCharts();
    }
  },

  bindCharts() {
    Charts.bindInteractions();
    Charts.onCursorChange = (date) => this.updateChartsJumpButton(date);
    Charts.onJumpToDate = (date) => this.jumpToTableDate(date);

    const range = document.getElementById('charts-range');
    const period = document.getElementById('charts-period');
    if (range) {
      range.addEventListener('change', () => {
        this.syncChartsPeriodOptions({ preferLatest: true });
        this.renderCharts();
      });
    }
    if (period) {
      period.addEventListener('change', () => this.renderCharts());
    }

    const jumpBtn = document.getElementById('charts-jump-btn');
    if (jumpBtn) {
      jumpBtn.addEventListener('click', () => {
        const date = Charts.getActiveCursorDate() || jumpBtn.dataset.date;
        if (date) this.jumpToTableDate(date);
      });
    }

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      if (!document.getElementById('view-charts')?.classList.contains('active')) return;
      clearTimeout(resizeTimer);
      // Debounce: iOS Safari fires resize while the native <select> picker is open.
      resizeTimer = setTimeout(() => this.renderCharts(), 150);
    });
  },

  syncChartsPeriodOptions({ preferLatest = false } = {}) {
    const range = document.getElementById('charts-range')?.value || '90';
    const wrap = document.getElementById('charts-period-wrap');
    const label = document.getElementById('charts-period-label');
    const select = document.getElementById('charts-period');
    if (!wrap || !select) return;

    const showPeriod = range === 'week' || range === 'month';
    wrap.hidden = !showPeriod;
    if (!showPeriod) {
      select.innerHTML = '';
      return;
    }

    const fullSeries = Charts.buildSeries(ClockerStore.getDays());
    const prev = preferLatest ? '' : select.value;
    select.innerHTML = '';

    if (range === 'week') {
      if (label) label.textContent = 'Week';
      const weeks = Charts.listWeeks(fullSeries);
      weeks.forEach((monday) => {
        const opt = document.createElement('option');
        opt.value = monday;
        opt.textContent = TimesFormat.formatWeekLabel(monday);
        select.appendChild(opt);
      });
    } else {
      if (label) label.textContent = 'Month';
      const months = Charts.listMonths(fullSeries);
      months.forEach((ym) => {
        const opt = document.createElement('option');
        opt.value = ym;
        opt.textContent = TimesFormat.formatMonthLabel(ym);
        select.appendChild(opt);
      });
    }

    if (prev && [...select.options].some((o) => o.value === prev)) {
      select.value = prev;
    } else if (select.options.length) {
      select.selectedIndex = 0;
    }
  },

  updateChartsJumpButton(date) {
    const btn = document.getElementById('charts-jump-btn');
    if (!btn) return;
    if (!date) {
      btn.hidden = true;
      btn.dataset.date = '';
      btn.textContent = 'Open day in table';
      return;
    }
    btn.hidden = false;
    btn.dataset.date = date;
    btn.textContent = `Open ${TimesFormat.formatDateMDY(date)} in table`;
  },

  showView(view) {
    const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
    if (btn) btn.click();
  },

  jumpToTableDate(isoDate) {
    if (!isoDate) return;
    this.showView('clock');
    // Ensure the table is painted before scrolling.
    requestAnimationFrame(() => {
      const shell = document.getElementById('table-shell');
      const header = document.querySelector(`#times-table-head-row th.col-day[data-date="${isoDate}"]`);
      if (!shell || !header) {
        this.flashStatus(`No table column for ${TimesFormat.formatDateMDY(isoDate)}`, 'error');
        return;
      }

      const shellRect = shell.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const delta =
        headerRect.left - shellRect.left - shellRect.width / 2 + headerRect.width / 2;
      shell.scrollLeft += delta;
      shell.scrollTop = 0;

      document.querySelectorAll('.day-flash').forEach((el) => el.classList.remove('day-flash'));
      const cells = document.querySelectorAll(`#times-table [data-date="${isoDate}"]`);
      cells.forEach((el) => el.classList.add('day-flash'));
      clearTimeout(this._dayFlashTimer);
      this._dayFlashTimer = setTimeout(() => {
        cells.forEach((el) => el.classList.remove('day-flash'));
      }, 1600);

      this.flashStatus(`Showing ${TimesFormat.formatDateMDY(isoDate)}`);
    });
  },

  renderCharts() {
    if (typeof Charts === 'undefined') return;
    this.syncChartsPeriodOptions();
    const days = ClockerStore.getDays();
    const range = document.getElementById('charts-range')?.value || '90';
    const period = document.getElementById('charts-period')?.value || '';
    const series = Charts.filterSeries(Charts.buildSeries(days), range, period);

    const summary = document.getElementById('charts-summary');
    if (summary) {
      if (!series.length) {
        summary.textContent = 'Add punches to see trends.';
      } else {
        const withHours = series.filter((row) => row.hours > 0);
        const totalHrs = withHours.reduce((sum, row) => sum + row.hours, 0);
        const avg = withHours.length ? totalHrs / withHours.length : 0;
        let scope = '';
        if (range === 'week' && period) scope = `${TimesFormat.formatWeekLabel(period)} · `;
        else if (range === 'month' && period) scope = `${TimesFormat.formatMonthLabel(period)} · `;
        summary.textContent = `${scope}${series.length} day${series.length === 1 ? '' : 's'} · avg ${avg.toFixed(2)}h/day`;
      }
    }

    this.updateChartsJumpButton(Charts.getActiveCursorDate());

    const draw = (canvasId, emptyId, legendId, drawer) => {
      const canvas = document.getElementById(canvasId);
      const empty = document.getElementById(emptyId);
      const legend = legendId ? document.getElementById(legendId) : null;
      if (!canvas) return;
      const ok = drawer(canvas, series);
      canvas.hidden = !ok;
      if (empty) empty.hidden = ok;
      if (legend) legend.hidden = !ok;
    };

    draw('chart-first-in', 'chart-first-in-empty', 'chart-first-in-legend', (c, s) => Charts.drawFirstIn(c, s));
    draw('chart-last-out', 'chart-last-out-empty', 'chart-last-out-legend', (c, s) => Charts.drawLastOut(c, s));
    draw('chart-hours', 'chart-hours-empty', 'chart-hours-legend', (c, s) => Charts.drawHours(c, s));
  },

  updateWeekSummary(daysNewestFirst) {
    const el = document.getElementById('week-summary');
    if (!el) return;
    const days = daysNewestFirst.slice().reverse();
    const now = new Date();
    const todayIso = TimesFormat.dateToIsoDay(now);
    const start = new Date(now);
    start.setDate(now.getDate() - ((now.getDay() + 6) % 7)); // Monday
    start.setHours(0, 0, 0, 0);
    const startIso = TimesFormat.dateToIsoDay(start);
    const endIso = todayIso;
    const todayDay = days.find((d) => d.date === todayIso);
    const todayHours =
      todayDay && TimesFormat.dayHasPunches(todayDay)
        ? TimesFormat.dayCumulativeHours(todayDay, now)
        : null;

    let weekHours = 0;
    let allHours = 0;
    days.forEach((d) => {
      const h =
        d.date === todayIso
          ? TimesFormat.dayCumulativeHours(d, now) ?? 0
          : TimesFormat.dayTotalHours(d);
      allHours += h;
      if (d.date >= startIso && d.date <= endIso) weekHours += h;
    });

    const parts = [];
    if (todayHours != null) parts.push(`Today ${todayHours.toFixed(2)}h`);
    parts.push(`This week ${weekHours.toFixed(2)}h`);
    parts.push(`All ${allHours.toFixed(2)}h`);
    el.textContent = parts.join(' · ');
  },

  /** Refresh today cumulative while an open clock-in is running. */
  syncTodayTicker(daysNewestFirst) {
    clearInterval(this._todayTicker);
    this._todayTicker = null;
    const todayIso = TimesFormat.dateToIsoDay(new Date());
    const todayDay = (daysNewestFirst || []).find((d) => d.date === todayIso);
    if (!todayDay || !TimesFormat.dayHasPunches(todayDay)) return;
    const punches = TimesFormat.dayMinutes(todayDay).filter((t) => t != null && !Number.isNaN(t));
    if (punches.length % 2 !== 1) return;

    this._todayTicker = setInterval(() => {
      const days = ClockerStore.getDays().slice().reverse();
      this.updateWeekSummary(days);
      const hrsCell = document.querySelector('#times-table-body tr.hrs-row td[data-today-hours]');
      const fresh = days.find((d) => d.date === todayIso);
      if (hrsCell && fresh) {
        hrsCell.textContent = (TimesFormat.dayCumulativeHours(fresh) ?? 0).toFixed(2);
      }
    }, 30000);
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
      ClockerStore.upsertPunch(dateVal, time24);
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
        if (!confirm(`Replace current ${ClockerStore.getProfile().label} data with ${data.days.length} day(s) from ${file.name}?`)) {
          e.target.value = '';
          return;
        }
        ClockerStore.replaceAll(data);
        this.renderTable();
        this.flashStatus(`Imported ${data.days.length} day(s)`);
      } catch (err) {
        alert(`Import failed: ${err.message}`);
      }
      e.target.value = '';
    });

    document.getElementById('export-times-btn')?.addEventListener('click', () => {
      const data = ClockerStore.load();
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
      const data = ClockerStore.load();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = ClockerStore.getProfile().path.split('/').pop();
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
    const profile = ClockerStore.getProfile();
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
      path: ClockerStore.getProfile().path,
      token: fields.token.value
    });

    const saveSettingsFromForm = () => {
      const settings = readSettings();
      ClockerStore.saveSyncSettings(settings);
      return settings;
    };

    const applySettings = (settings) => {
      updateAutoSyncButton(!!settings.enabled);
      fields.owner.value = settings.owner;
      fields.repo.value = settings.repo;
      fields.token.value = settings.token;
    };

    const refreshAfterSync = () => {
      this.renderTable();
    };

    const runInitialSync = async (settings) => {
      const { data: remote, sha } = await GitHubSync.fetchRemote(settings);
      const local = ClockerStore.load();

      ClockerStore._fileSha = sha;

      if (ClockerStore.isEmpty(remote) && !ClockerStore.isEmpty(local)) {
        await ClockerStore.pushToGitHub({ settings });
      } else {
        await ClockerStore.pullFromGitHub({ settings });
        refreshAfterSync();
      }
    };

    const switchDataProfile = async (profileId) => {
      if (profileId === ClockerStore.getProfileId()) return;

      const profile = ClockerStore.setProfile(profileId);
      this.selected.clear();
      this.updateDataProfileUI();
      await ClockerStore.seedFromBundledFiles();
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

    ClockerStore.onSyncStatus = (message, type) => setStatus(message, type);

    applySettings(ClockerStore.getSyncSettings());
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
        await ClockerStore.pullFromGitHub({ settings });
        refreshAfterSync();
      } catch (error) {
        setStatus(error.message, 'error');
      }
    });

    document.getElementById('sync-push-btn').addEventListener('click', async () => {
      const settings = saveSettingsFromForm();
      try {
        await ClockerStore.pushToGitHub({ settings });
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
  App.init().catch((error) => {
    console.error(error);
    const status = document.getElementById('clock-status');
    if (status) {
      status.textContent = `Startup error: ${error.message || error}`;
      status.dataset.type = 'error';
    }
  });
});
