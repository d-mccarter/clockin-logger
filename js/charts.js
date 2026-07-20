/** Canvas charts for Clocker daily stats (no external deps). */

const Charts = {
  /** Logical CSS height — never re-read canvas.height after DPR scaling. */
  CHART_HEIGHT: 200,

  _setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const parent = canvas.parentElement;
    const parentW = parent ? parent.clientWidth : 0;
    const rect = canvas.getBoundingClientRect();
    // Prefer parent width so Safari select/viewport quirks don't inflate size.
    const w = Math.max(280, Math.round(parentW || rect.width || canvas.clientWidth || 300));
    const h = this.CHART_HEIGHT;

    // CSS layout size in CSS pixels (must match the logical draw size below).
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.style.maxHeight = `${h}px`;

    // Backing store in device pixels. Do NOT removeAttribute('width'/'height'):
    // on Safari that resets the bitmap to 300×150 while setTransform(dpr)
    // still scales drawing — charts look massively zoomed.
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  },

  _formatShortDate(isoDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!m) return isoDate;
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
  },

  /**
   * Snap a minutes domain to half-hour boundaries and pick tick step
   * (30, 60, or 120 minutes) so labels stay readable.
   */
  _niceTimeScale(dataMin, dataMax) {
    const half = 30;
    let lo = Math.floor(dataMin / half) * half;
    let hi = Math.ceil(dataMax / half) * half;
    if (lo === hi) {
      lo -= half;
      hi += half;
    }
    // Breathing room when a point sits on a boundary
    if (dataMin <= lo) lo -= half;
    if (dataMax >= hi) hi += half;

    const span = hi - lo;
    let step = half;
    if (span / half > 8) step = 60;
    if (span / step > 8) step = 120;

    lo = Math.floor(lo / step) * step;
    hi = Math.ceil(hi / step) * step;
    if (hi <= lo) hi = lo + step * 2;

    const ticks = [];
    for (let t = lo; t <= hi + 0.001; t += step) ticks.push(t);
    return { min: lo, max: hi, ticks };
  },

  /** Nice numeric scale for hours (0-based preferred). */
  _niceHoursScale(dataMin, dataMax, forceMin) {
    const min0 = forceMin != null ? forceMin : dataMin;
    const max0 = Math.max(dataMax, min0 + 0.5);
    const span = max0 - min0;
    const candidates = [0.5, 1, 2, 2.5, 5, 10];
    const rough = span / 4;
    let step = candidates.find((s) => s >= rough) || Math.ceil(rough);

    let lo = Math.floor(min0 / step) * step;
    let hi = Math.ceil(max0 / step) * step;
    if (forceMin != null) lo = forceMin;
    if (hi <= lo) hi = lo + step * 2;

    const ticks = [];
    for (let t = lo; t <= hi + 1e-9; t += step) {
      ticks.push(Math.round(t * 1000) / 1000);
    }
    return { min: lo, max: hi, ticks };
  },

  /**
   * Build chart series from day records.
   * @returns {{ date: string, firstIn: number|null, lastOut: number|null, hours: number }[]}
   */
  buildSeries(days) {
    return (days || [])
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((day) => {
        const punches = (day.times || [])
          .map((t) => (t == null || t === '' ? null : TimesFormat.parseTimeToken(t)))
          .filter((t) => t != null && !Number.isNaN(t))
          .sort((a, b) => a - b);
        return {
          date: day.date,
          firstIn: punches.length ? punches[0] : null,
          lastOut: punches.length ? punches[punches.length - 1] : null,
          hours: TimesFormat.dayTotalHours(day)
        };
      });
  },

  filterSeries(series, range) {
    if (!range || range === 'all') return series;
    const days = parseInt(range, 10);
    if (!days || Number.isNaN(days)) return series;
    if (!series.length) return series;
    const last = series[series.length - 1].date;
    const end = new Date(`${last}T12:00:00`);
    const start = new Date(end);
    start.setDate(start.getDate() - (days - 1));
    const startIso = TimesFormat.dateToIsoDay(start);
    return series.filter((row) => row.date >= startIso);
  },

  _drawLineChart(canvas, points, options) {
    const { ctx, w, h } = this._setupCanvas(canvas);
    const padding = { top: 14, right: 12, bottom: 28, left: 48 };
    ctx.clearRect(0, 0, w, h);

    const usable = points.filter((p) => p.value != null && !Number.isNaN(p.value));
    if (!usable.length) return false;

    const values = usable.map((p) => p.value);
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);

    let scale;
    if (options.scale === 'time') {
      scale = this._niceTimeScale(dataMin, dataMax);
    } else if (options.scale === 'hours') {
      scale = this._niceHoursScale(dataMin, dataMax, options.min);
    } else {
      let minV = options.min ?? dataMin;
      let maxV = options.max ?? dataMax;
      if (minV === maxV) {
        minV -= 1;
        maxV += 1;
      }
      scale = { min: minV, max: maxV, ticks: [maxV, (minV + maxV) / 2, minV] };
    }

    const minV = scale.min;
    const maxV = scale.max;
    const range = maxV - minV || 1;
    const ticks = scale.ticks;

    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    // Grid + Y labels at nice tick values
    ctx.strokeStyle = '#c5ccd6';
    ctx.lineWidth = 1;
    ctx.fillStyle = '#5a6575';
    ctx.font = '600 10px "IBM Plex Sans", "Avenir Next", sans-serif';
    ctx.textAlign = 'right';
    ticks.forEach((val) => {
      const y = padding.top + chartH - ((val - minV) / range) * chartH;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
      const label = options.formatY ? options.formatY(val) : String(val);
      ctx.fillText(label, padding.left - 6, y + 3);
    });

    const coords = usable.map((p, i) => ({
      x: padding.left + (usable.length === 1 ? chartW / 2 : (i / (usable.length - 1)) * chartW),
      y: padding.top + chartH - ((p.value - minV) / range) * chartH,
      point: p
    }));

    if (coords.length > 1 && options.fill) {
      ctx.beginPath();
      ctx.moveTo(coords[0].x, padding.top + chartH);
      coords.forEach((c) => ctx.lineTo(c.x, c.y));
      ctx.lineTo(coords[coords.length - 1].x, padding.top + chartH);
      ctx.closePath();
      ctx.fillStyle = options.fill;
      ctx.fill();
    }

    if (coords.length > 1) {
      ctx.beginPath();
      ctx.strokeStyle = options.color || '#e87a2e';
      ctx.lineWidth = 2.25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      coords.forEach((c, i) => {
        if (i === 0) ctx.moveTo(c.x, c.y);
        else ctx.lineTo(c.x, c.y);
      });
      ctx.stroke();
    }

    coords.forEach((c) => {
      ctx.beginPath();
      ctx.fillStyle = options.color || '#e87a2e';
      ctx.arc(c.x, c.y, usable.length > 60 ? 2 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = '#5a6575';
    ctx.font = '600 10px "IBM Plex Sans", "Avenir Next", sans-serif';
    ctx.textAlign = 'center';
    const labelIdx = usable.length === 1
      ? [0]
      : usable.length === 2
        ? [0, usable.length - 1]
        : [0, Math.floor((usable.length - 1) / 2), usable.length - 1];
    labelIdx.forEach((idx) => {
      const c = coords[idx];
      ctx.fillText(this._formatShortDate(c.point.date), c.x, h - 8);
    });

    return true;
  },

  drawFirstIn(canvas, series) {
    const points = series
      .filter((row) => row.firstIn != null)
      .map((row) => ({ date: row.date, value: row.firstIn }));
    return this._drawLineChart(canvas, points, {
      color: '#2f6fed',
      fill: 'rgba(47, 111, 237, 0.12)',
      scale: 'time',
      formatY: (v) => TimesFormat.formatTimeCompact(v)
    });
  },

  drawLastOut(canvas, series) {
    const points = series
      .filter((row) => row.lastOut != null)
      .map((row) => ({ date: row.date, value: row.lastOut }));
    return this._drawLineChart(canvas, points, {
      color: '#c45c1a',
      fill: 'rgba(232, 122, 46, 0.14)',
      scale: 'time',
      formatY: (v) => TimesFormat.formatTimeCompact(v)
    });
  },

  drawHours(canvas, series) {
    const points = series
      .filter((row) => row.hours > 0)
      .map((row) => ({ date: row.date, value: row.hours }));
    return this._drawLineChart(canvas, points, {
      color: '#1f7a45',
      fill: 'rgba(31, 122, 69, 0.12)',
      scale: 'hours',
      min: 0,
      formatY: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1))
    });
  }
};
