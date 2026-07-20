const PROFILE_KEY = 'clocker-profile';
const DELAY_KEY = 'clocker-delay-seconds';
const PUSH_LOCK_KEY = 'clocker-push-lock';

const DATA_PROFILES = {
  real: {
    id: 'real',
    label: 'Real',
    storageKey: 'clocker-data',
    path: 'data/times-data.json'
  },
  test: {
    id: 'test',
    label: 'Test',
    storageKey: 'clocker-data-test',
    path: 'data/times-data-test.json'
  }
};

const ClockerStore = {
  _fileSha: null,
  _pushTimer: null,
  _pushInFlight: null,
  _pushQueued: false,
  /** Debounce before auto-push after a local change (ms). */
  AUTO_PUSH_DELAY_MS: 1500,
  onSyncStatus: null,

  getProfiles() {
    return DATA_PROFILES;
  },

  getProfileId() {
    try {
      const raw = localStorage.getItem(PROFILE_KEY);
      if (raw && DATA_PROFILES[raw]) return raw;
    } catch {
      /* ignore */
    }
    return 'real';
  },

  getProfile() {
    return DATA_PROFILES[this.getProfileId()] || DATA_PROFILES.real;
  },

  storageKey() {
    return this.getProfile().storageKey;
  },

  setProfile(profileId) {
    const profile = DATA_PROFILES[profileId];
    if (!profile || profile.id === this.getProfileId()) return this.getProfile();

    clearTimeout(this._pushTimer);
    this._pushTimer = null;
    this._pushInFlight = null;
    this._pushQueued = false;
    this._fileSha = null;

    localStorage.setItem(PROFILE_KEY, profile.id);

    const settings = this.getSyncSettings();
    settings.path = profile.path;
    this.saveSyncSettings(settings);

    return profile;
  },

  normalize(data) {
    return TimesFormat.normalize(data);
  },

  load() {
    try {
      const raw = localStorage.getItem(this.storageKey());
      if (!raw) return TimesFormat.emptyData(this.readDelaySeconds());
      const data = this.normalize(JSON.parse(raw));
      return data;
    } catch {
      return TimesFormat.emptyData(this.readDelaySeconds());
    }
  },

  save(data, options = {}) {
    const normalized = this.normalize(data);
    if (options.persistDelay !== false && normalized.settings?.delaySeconds != null) {
      this.setDelaySeconds(normalized.settings.delaySeconds, { syncData: false });
    }
    localStorage.setItem(this.storageKey(), JSON.stringify(normalized));
    if (options.sync !== false) {
      this.schedulePush();
    }
    return normalized;
  },

  /** Read delay without touching load() — avoids recursion on empty storage. */
  readDelaySeconds() {
    try {
      const raw = localStorage.getItem(DELAY_KEY);
      if (raw != null && raw !== '') {
        const n = parseInt(raw, 10);
        if (!Number.isNaN(n)) return n;
      }
    } catch {
      /* ignore */
    }
    return 60;
  },

  getDelaySeconds() {
    return this.readDelaySeconds();
  },

  setDelaySeconds(seconds, options = {}) {
    const n = parseInt(seconds, 10);
    const value = Number.isNaN(n) ? 60 : n;
    localStorage.setItem(DELAY_KEY, String(value));
    if (options.syncData !== false) {
      const data = this.load();
      data.settings.delaySeconds = value;
      this.save(data, { persistDelay: false });
    }
    return value;
  },

  getSyncSettings() {
    const settings = GitHubSync.getSettings();
    settings.path = this.getProfile().path;
    return settings;
  },

  saveSyncSettings(settings) {
    const normalized = GitHubSync.normalizeSettings(settings);
    normalized.path = this.getProfile().path;
    GitHubSync.saveSettings(normalized);
  },

  setSyncStatus(message, type = 'info') {
    if (this.onSyncStatus) this.onSyncStatus(message, type);
  },

  isEmpty(data) {
    return !data?.days?.length;
  },

  async init() {
    if (!GitHubSync.isAutoSyncEnabled()) return;

    try {
      const settings = this.getSyncSettings();
      const { data: remote, sha } = await GitHubSync.fetchRemote(settings);
      const local = this.load();

      this._fileSha = sha;

      if (this.isEmpty(remote) && !this.isEmpty(local)) {
        await this.pushToGitHub({ silent: true });
        this.setSyncStatus('Synced to GitHub', 'success');
      } else {
        this.save(remote, { sync: false });
        this.setSyncStatus('Synced from GitHub', 'success');
      }
    } catch (error) {
      this.setSyncStatus(error.message, 'error');
    }
  },

  async pullFromGitHub({ silent = false, settings = null } = {}) {
    settings = GitHubSync.normalizeSettings(settings || this.getSyncSettings());
    if (!GitHubSync.isConfigured(settings)) {
      throw new Error('Paste your GitHub token first');
    }

    if (!silent) this.setSyncStatus('Pulling from GitHub…', 'info');

    const { data, sha } = await GitHubSync.fetchRemote(settings);
    this._fileSha = sha;
    this.save(data, { sync: false });
    if (!silent) this.setSyncStatus('Loaded from GitHub', 'success');
    return data;
  },

  async pushToGitHub({ silent = false, settings = null } = {}) {
    settings = GitHubSync.normalizeSettings(settings || this.getSyncSettings());
    if (!GitHubSync.isConfigured(settings)) {
      throw new Error('Paste your GitHub token first');
    }

    clearTimeout(this._pushTimer);
    this._pushTimer = null;

    // If a push is already running, mark dirty so we push again afterward
    // with the latest local edits (including deletions).
    if (this._pushInFlight) {
      this._pushQueued = true;
      return this._pushInFlight;
    }

    this._pushInFlight = this._pushWithRetry(settings, silent)
      .finally(() => {
        this._releasePushLock();
        this._pushInFlight = null;
        if (this._pushQueued) {
          this._pushQueued = false;
          if (GitHubSync.isAutoSyncEnabled(settings)) {
            this.schedulePush();
          }
        }
      });

    return this._pushInFlight;
  },

  _tabId() {
    if (!this._tabIdValue) {
      this._tabIdValue = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return this._tabIdValue;
  },

  _acquirePushLock() {
    try {
      const now = Date.now();
      const raw = localStorage.getItem(PUSH_LOCK_KEY);
      if (raw) {
        const lock = JSON.parse(raw);
        if (lock?.id && lock.id !== this._tabId() && now - (lock.at || 0) < 15000) {
          return false;
        }
      }
      localStorage.setItem(PUSH_LOCK_KEY, JSON.stringify({ id: this._tabId(), at: now }));
      return true;
    } catch {
      return true;
    }
  },

  _releasePushLock() {
    try {
      const raw = localStorage.getItem(PUSH_LOCK_KEY);
      if (!raw) return;
      const lock = JSON.parse(raw);
      if (lock?.id === this._tabId()) localStorage.removeItem(PUSH_LOCK_KEY);
    } catch {
      /* ignore */
    }
  },

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  },

  /**
   * Push local data as source of truth. On 409/422, re-fetch the latest SHA
   * (no-store) and retry the same local payload — do NOT merge remote days
   * back in (that resurrected deleted rows).
   */
  async _pushWithRetry(settings, silent) {
    this.setSyncStatus(silent ? 'Syncing…' : 'Saving to GitHub…', 'info');

    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        if (!this._acquirePushLock()) {
          // Another tab is pushing — wait and retry.
          lastError = new Error('Another Clocker tab is syncing — tap Push again in a moment.');
          await this._sleep(400 + attempt * 300);
          continue;
        }

        const local = this.normalize(this.load());
        const snapshot = JSON.stringify(local);
        const remote = await GitHubSync.fetchRemote(settings);
        const remoteNorm = this.normalize(remote.data);

        // Already matches GitHub — nothing to write (avoids needless conflicts).
        if (JSON.stringify(local) === JSON.stringify(remoteNorm)) {
          this._fileSha = remote.sha;
          this.setSyncStatus(silent ? 'Synced to GitHub' : 'Already up to date on GitHub', 'success');
          return;
        }

        this._fileSha = await GitHubSync.pushRemote(settings, local, remote.sha);

        if (JSON.stringify(this.normalize(this.load())) !== snapshot) {
          this._pushQueued = true;
        }

        const note = attempt > 0 ? ' (retry after conflict)' : '';
        this.setSyncStatus(
          silent ? `Synced to GitHub${note}` : `Saved to GitHub${note}`,
          'success'
        );
        return;
      } catch (error) {
        lastError = error;
        this._releasePushLock();
        const msg = String(error.message || error);
        if (!/409|422/.test(msg) || attempt === 4) {
          break;
        }
        this.setSyncStatus('Sync conflict — retrying with latest file…', 'info');
        await this._sleep(300 + attempt * 400);
      }
    }

    const friendly = /409|422/.test(String(lastError?.message || ''))
      ? 'GitHub was updated elsewhere (often another phone/tab with Auto-sync). Tap Push again — your local copy wins, including deletes.'
      : lastError.message;
    this.setSyncStatus(friendly, 'error');
    throw lastError;
  },

  schedulePush() {
    if (!GitHubSync.isAutoSyncEnabled()) return;
    clearTimeout(this._pushTimer);
    this._pushTimer = setTimeout(() => {
      this.pushToGitHub({ silent: true }).catch(() => {});
    }, this.AUTO_PUSH_DELAY_MS);
  },

  getDays() {
    return this.load().days;
  },

  getDay(isoDate) {
    return this.getDays().find((d) => d.date === isoDate) || null;
  },

  upsertPunch(isoDate, time24) {
    const data = this.load();
    let day = data.days.find((d) => d.date === isoDate);
    if (!day) {
      day = { date: isoDate, times: [] };
      data.days.push(day);
    }
    day.times.push(time24);
    data.days.sort((a, b) => a.date.localeCompare(b.date));
    this.save(data);
    return day;
  },

  setDayTimes(isoDate, times) {
    const data = this.load();
    let day = data.days.find((d) => d.date === isoDate);
    if (!day) {
      day = { date: isoDate, times: [] };
      data.days.push(day);
    }
    day.times = times;
    while (day.times.length && day.times[day.times.length - 1] == null) {
      day.times.pop();
    }
    if (!day.times.length) {
      data.days = data.days.filter((d) => d.date !== isoDate);
    }
    data.days.sort((a, b) => a.date.localeCompare(b.date));
    this.save(data);
    return day;
  },

  deleteSelected(selections) {
    // selections: [{ date, index }]
    const data = this.load();
    const byDate = new Map();
    selections.forEach(({ date, index }) => {
      if (!byDate.has(date)) byDate.set(date, new Set());
      byDate.get(date).add(index);
    });

    data.days = data.days
      .map((day) => {
        const remove = byDate.get(day.date);
        if (!remove) return day;
        const times = day.times.map((t, i) => (remove.has(i) ? null : t));
        while (times.length && times[times.length - 1] == null) times.pop();
        return { ...day, times };
      })
      .filter((day) => day.times.length > 0);

    this.save(data);
  },

  replaceAll(data) {
    return this.save(data);
  },

  async seedFromBundledFiles() {
    const profile = this.getProfile();
    const existing = this.load();
    if (!this.isEmpty(existing)) return existing;

    const fetchText = async (url) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) return null;
        return response;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      const response = await fetchText(`./${profile.path}?v=${Date.now()}`);
      if (response) {
        const json = await response.json();
        return this.save(json, { sync: false });
      }
    } catch {
      /* fall through */
    }

    if (profile.id === 'real') {
      try {
        const response = await fetchText('./data/times.txt');
        if (response) {
          const text = await response.text();
          return this.save(TimesFormat.parseTimesTxt(text), { sync: false });
        }
      } catch {
        /* ignore */
      }
    }

    return existing;
  }
};
