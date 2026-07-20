const SYNC_SETTINGS_KEY = 'clocker-sync';

const DEFAULT_SYNC_SETTINGS = {
  enabled: false,
  owner: 'd-mccarter',
  repo: 'clockin-logger',
  branch: 'main',
  path: 'data/times-data.json',
  token: ''
};

const GitHubSync = {
  cleanToken(token) {
    return String(token || '').replace(/\s+/g, '').trim();
  },

  normalizeSettings(settings) {
    const normalized = { ...DEFAULT_SYNC_SETTINGS, ...settings };
    normalized.owner = String(normalized.owner || '').trim();
    normalized.repo = String(normalized.repo || '').trim();
    normalized.branch = String(normalized.branch || DEFAULT_SYNC_SETTINGS.branch).trim() || DEFAULT_SYNC_SETTINGS.branch;
    normalized.path = String(normalized.path || DEFAULT_SYNC_SETTINGS.path).trim() || DEFAULT_SYNC_SETTINGS.path;
    normalized.token = this.cleanToken(normalized.token);
    normalized.enabled = !!normalized.enabled;
    return normalized;
  },

  getSettings() {
    try {
      const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SYNC_SETTINGS };
      return this.normalizeSettings(JSON.parse(raw));
    } catch {
      return { ...DEFAULT_SYNC_SETTINGS };
    }
  },

  saveSettings(settings) {
    localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(this.normalizeSettings(settings)));
  },

  isConfigured(settings = this.getSettings()) {
    return !!(settings.owner && settings.repo && settings.token);
  },

  isAutoSyncEnabled(settings = this.getSettings()) {
    return settings.enabled && this.isConfigured(settings);
  },

  readApiUrl(settings) {
    return `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path}?ref=${settings.branch}`;
  },

  writeApiUrl(settings) {
    return `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${settings.path}`;
  },

  headers(settings) {
    const token = this.cleanToken(settings.token);
    const auth = token.startsWith('github_pat_') || token.startsWith('gho_')
      ? `Bearer ${token}`
      : `token ${token}`;

    return {
      Accept: 'application/vnd.github+json',
      Authorization: auth,
      'X-GitHub-Api-Version': '2022-11-28',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache'
    };
  },

  validateToken(settings) {
    const token = this.cleanToken(settings.token);
    if (!token) {
      throw new Error('Paste your GitHub token first');
    }
    if (token.length < 20) {
      throw new Error('Token looks too short — copy the full token from GitHub');
    }
    if (!/^(ghp_|github_pat_|gho_)/.test(token)) {
      throw new Error('Token should start with ghp_ or github_pat_');
    }
  },

  async testToken(settings) {
    this.validateToken(settings);
    const response = await fetch('https://api.github.com/user', {
      headers: this.headers(settings)
    });

    if (response.status === 401) {
      throw new Error(await this.parseError(response, 'GitHub token rejected'));
    }

    if (!response.ok) {
      throw new Error(await this.parseError(response, 'GitHub token test failed'));
    }

    return response.json();
  },

  async parseError(response, fallback) {
    try {
      const body = await response.json();
      if (body.message) {
        return `${fallback} (${response.status}): ${body.message}`;
      }
    } catch {
      /* ignore */
    }
    return `${fallback} (${response.status})`;
  },

  utf8ToBase64(text) {
    return btoa(unescape(encodeURIComponent(text)));
  },

  base64ToUtf8(base64) {
    return decodeURIComponent(escape(atob(base64.replace(/\n/g, ''))));
  },

  async fetchRemote(settings) {
    settings = this.normalizeSettings(settings);
    this.validateToken(settings);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);
    let response;
    try {
      response = await fetch(this.readApiUrl(settings), {
        headers: this.headers(settings),
        cache: 'no-store',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 404) {
      return { data: TimesFormat.emptyData(), sha: null };
    }

    if (response.status === 401) {
      throw new Error(await this.parseError(response, 'GitHub token rejected'));
    }

    if (response.status === 403) {
      throw new Error(await this.parseError(response, 'GitHub read denied — check token repo access'));
    }

    if (!response.ok) {
      throw new Error(await this.parseError(response, 'GitHub read failed'));
    }

    const payload = await response.json();
    const text = this.base64ToUtf8(payload.content);
    let data;
    if (settings.path.endsWith('.txt')) {
      data = TimesFormat.parseTimesTxt(text);
    } else {
      data = TimesFormat.normalize(JSON.parse(text));
    }
    return { data, sha: payload.sha };
  },

  async pushRemote(settings, data, sha) {
    settings = this.normalizeSettings(settings);
    this.validateToken(settings);

    const normalized = TimesFormat.normalize(data);
    const content = settings.path.endsWith('.txt')
      ? TimesFormat.toTimesTxt(normalized)
      : JSON.stringify(normalized, null, 2);

    const body = {
      message: settings.path.includes('test')
        ? 'Update test clock data'
        : 'Update clock data',
      branch: settings.branch,
      content: this.utf8ToBase64(content)
    };
    if (sha) body.sha = sha;

    const response = await fetch(this.writeApiUrl(settings), {
      method: 'PUT',
      cache: 'no-store',
      headers: {
        ...this.headers(settings),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (response.status === 401) {
      throw new Error(await this.parseError(response, 'GitHub token rejected'));
    }

    if (response.status === 403) {
      throw new Error(await this.parseError(response, 'GitHub write denied — token needs Contents read/write access'));
    }

    if (response.status === 409 || response.status === 422) {
      throw new Error(await this.parseError(response, 'GitHub write conflict'));
    }

    if (!response.ok) {
      throw new Error(await this.parseError(response, 'GitHub write failed'));
    }

    const payload = await response.json();
    return payload.content.sha;
  }
};
