/** Parse / serialize LabVIEW-style times.txt and app JSON. */

const TimesFormat = {
  /** "8:40 AM" or "08:40" → minutes from midnight, or null */
  parseTimeToken(token) {
    const raw = String(token ?? '').trim();
    if (!raw) return null;

    const ampm = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)$/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      const m = parseInt(ampm[2], 10);
      const s = parseInt(ampm[3] || '0', 10);
      const mer = ampm[4].toUpperCase();
      if (h === 12) h = 0;
      if (mer === 'PM') h += 12;
      if (h > 23 || m > 59 || s > 59) return null;
      return h * 60 + m + s / 60;
    }

    const h24 = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (h24) {
      const h = parseInt(h24[1], 10);
      const m = parseInt(h24[2], 10);
      const s = parseInt(h24[3] || '0', 10);
      if (h > 23 || m > 59 || s > 59) return null;
      return h * 60 + m + s / 60;
    }

    return null;
  },

  /** minutes from midnight → "8:40 AM" */
  formatTime12(minutes) {
    if (minutes == null || Number.isNaN(minutes)) return '';
    let totalMins = Math.round(minutes);
    totalMins = ((totalMins % 1440) + 1440) % 1440;
    let h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const mer = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, '0')} ${mer}`;
  },

  /** minutes → compact "1:16p" / "11:30a" for dense phone tables */
  formatTimeCompact(minutes) {
    if (minutes == null || Number.isNaN(minutes)) return '';
    let totalMins = Math.round(minutes);
    totalMins = ((totalMins % 1440) + 1440) % 1440;
    let h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    const mer = h >= 12 ? 'p' : 'a';
    h = h % 12;
    if (h === 0) h = 12;
    return `${h}:${String(m).padStart(2, '0')}${mer}`;
  },

  /** minutes → "HH:MM" 24h for JSON storage */
  formatTime24(minutes) {
    if (minutes == null || Number.isNaN(minutes)) return null;
    let totalMins = Math.round(minutes);
    totalMins = ((totalMins % 1440) + 1440) % 1440;
    const h = Math.floor(totalMins / 60);
    const m = totalMins % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  },

  parseDateToken(token) {
    const raw = String(token ?? '').trim();
    const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      const month = parseInt(mdy[1], 10);
      const day = parseInt(mdy[2], 10);
      const year = parseInt(mdy[3], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return null;
  },

  formatDateMDY(isoDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!m) return isoDate;
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${m[1]}`;
  },

  /**
   * Pair punches in order (skip empties). Odd leftover is ignored for hours.
   * Returns hours as float.
   */
  calcTotalHours(timeMinutesList) {
    const punches = (timeMinutesList || []).filter((t) => t != null && !Number.isNaN(t));
    let totalMins = 0;
    for (let i = 0; i + 1 < punches.length; i += 2) {
      let diff = punches[i + 1] - punches[i];
      if (diff < 0) diff += 1440; // overnight
      totalMins += diff;
    }
    return Math.round((totalMins / 60) * 100) / 100;
  },

  emptyData(delaySeconds = 60) {
    return {
      version: 1,
      settings: { delaySeconds },
      days: []
    };
  },

  normalizeDay(day = {}) {
    const date = this.parseDateToken(day.date) || day.date;
    const times = Array.isArray(day.times)
      ? day.times.map((t) => {
          if (t == null || t === '') return null;
          if (typeof t === 'number') return this.formatTime24(t);
          const mins = this.parseTimeToken(t);
          return mins == null ? null : this.formatTime24(mins);
        })
      : [];
    // Drop trailing nulls for cleaner storage
    while (times.length && times[times.length - 1] == null) times.pop();
    return { date, times };
  },

  normalize(data) {
    const delay = parseInt(data?.settings?.delaySeconds, 10);
    return {
      version: 1,
      settings: {
        delaySeconds: Number.isNaN(delay) ? 60 : delay
      },
      days: (Array.isArray(data?.days) ? data.days : [])
        .map((d) => this.normalizeDay(d))
        .filter((d) => d.date && (d.times || []).some((t) => t != null && t !== ''))
        .sort((a, b) => a.date.localeCompare(b.date))
    };
  },

  dayMinutes(day) {
    return (day.times || []).map((t) => (t == null || t === '' ? null : this.parseTimeToken(t)));
  },

  dayTotalHours(day) {
    return this.calcTotalHours(this.dayMinutes(day));
  },

  /** Parse LabVIEW times.txt (tab or multi-space delimited). */
  parseTimesTxt(text) {
    const days = [];
    const lines = String(text || '').split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.includes('\t')
        ? line.split('\t')
        : line.trim().split(/\s{2,}|\t/);

      // Fallback: split on single tabs / mixed — try smarter split
      let cells = parts.map((p) => p.trim());
      if (cells.length < 2) {
        // date then times separated by single spaces with AM/PM
        const match = line.trim().match(/^(\d{1,2}\/\d{1,2}\/\d{4})\s+(.*)$/);
        if (!match) continue;
        const rest = match[2];
        const tokens = [];
        const re = /(\d{1,2}:\d{2}(?::\d{2})?\s*[AP]M)|(\d+(?:\.\d+)?)/gi;
        let m;
        while ((m = re.exec(rest))) tokens.push(m[0].trim());
        cells = [match[1], ...tokens];
      }

      const date = this.parseDateToken(cells[0]);
      if (!date) continue;

      const times = [];
      for (let i = 1; i < cells.length; i++) {
        const cell = cells[i];
        if (cell === '' || cell == null) {
          times.push(null);
          continue;
        }
        // Last numeric-only column is Total Hours — skip
        if (i === cells.length - 1 && /^-?\d+(\.\d+)?$/.test(cell) && !cell.includes(':')) {
          break;
        }
        const mins = this.parseTimeToken(cell);
        if (mins == null && cell !== '') {
          // could be blank placeholder
          times.push(null);
        } else {
          times.push(mins == null ? null : this.formatTime24(mins));
        }
      }
      while (times.length && times[times.length - 1] == null) times.pop();
      days.push({ date, times });
    }
    return this.normalize({ version: 1, settings: { delaySeconds: 60 }, days });
  },

  toTimesTxt(data, options = {}) {
    const normalized = this.normalize(data);
    const includeTotal = options.includeTotal === true;
    // LabVIEW export uses a fixed-width time grid (8 columns) with trailing tabs.
    const minSlots = options.slots ?? 8;
    const maxTimes = Math.max(
      minSlots,
      ...normalized.days.map((day) => (day.times || []).length),
      0
    );

    return normalized.days.map((day) => {
      const date = this.formatDateMDY(day.date);
      const timeCells = [];
      for (let i = 0; i < maxTimes; i++) {
        const t = day.times[i];
        timeCells.push(
          t == null || t === '' ? '' : this.formatTime12(this.parseTimeToken(t))
        );
      }
      const cells = [date, ...timeCells];
      if (includeTotal) cells.push(this.dayTotalHours(day).toFixed(2));
      return cells.join('\t');
    }).join('\r\n') + (normalized.days.length ? '\r\n' : '');
  },

  /** Apply delay (seconds) to a Date → adjusted Date */
  applyDelay(date, delaySeconds, direction) {
    const ms = (Number(delaySeconds) || 0) * 1000;
    const d = new Date(date.getTime());
    if (direction === 'in') {
      d.setTime(d.getTime() - ms);
    } else {
      d.setTime(d.getTime() + ms);
    }
    return d;
  },

  dateToIsoDay(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  dateToTime24(date) {
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  }
};
