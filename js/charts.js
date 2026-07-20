/** Canvas charts for Clocker daily stats (no external deps). */

const Charts = {
  _setupCanvas(canvas) {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(280, rect.width || canvas.clientWidth || 300);
    const h = parseInt(canvas.getAttribute('height'), 10) || 200;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w, h };
  },

  _drawGrid(ctx, w, h, padding, rows = 4) {
    ctx.strokeStyle = '#c5ccd6';
    ctx.lineWidth = 1;
    const chartH = h - padding.top - padding.bottom;
    for (let i = 0; i <= rows; i++) {
      const y = padding.top + (chartH / rows) * i;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(w - padding.right, y);
      ctx.stroke();
    }
  },

  _formatShortDate(isoDate) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
    if (!m) return isoDate;
    return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}`;
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
    const padding = { top: 14, right: 12, bottom: 28, left: 44 };
    ctx.clearRect(0, 0, w, h);

    const usable = points.filter((p) => p.value != null && !Number.isNaN(p.value));
    if (!usable.length) return false;

    const values = usable.map((p) => p.value);
    let minV = options.min ?? Math.min(...values);
    let maxV = options.max ?? Math.max(...values);
    if (options.padRange) {
      const span = maxV - minV || 1;
      minV -= span * 0.08;
      maxV += span * 0.08;
    }
    if (minV === maxV) {
      minV -= 1;
      maxV += 1;
    }
    const range = maxV - minV;

    const chartW = w - padding.left - padding.right;
    const chartH = h - padding.top - padding.bottom;

    this._drawGrid(ctx, w, h, padding);

    ctx.fillStyle = '#5a6575';
    ctx.font = '600 10px "IBM Plex Sans", "Avenir Next", sans-serif';
    ctx.textAlign = 'right';
    for (let i = 0; i <= 4; i++) {
      const val = maxV - (range / 4) * i;
      const y = padding.top + (chartH / 4) * i;
      const label = options.formatY ? options.formatY(val) : String(Math.round(val));
      ctx.fillText(label, padding.left - 6, y + 3);
    }

    const coords = usable.map((p, i) => ({
      x: padding.left + (usable.length === 1 ? chartW / 2 : (i / (usable.length - 1)) * chartW),
      y: padding.top + chartH - ((p.value - minV) / range) * chartH,
      point: p
    }));

    // Soft fill under line
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

    // X labels: first, mid, last
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
      padRange: true,
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
      padRange: true,
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
      min: 0,
      padRange: false,
      formatY: (v) => v.toFixed(1)
    });
  }
};
