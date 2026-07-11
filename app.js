(() => {
  'use strict';

  const STORAGE_KEY = 'timesheet.shifts.v1';
  const SETTINGS_KEY = 'timesheet.settings.v1';
  const REMINDER_MS = 8 * 60 * 60 * 1000; // 8 hours

  // ---------- Storage ----------

  function loadShifts() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error('Failed to load shifts, starting fresh', e);
      return [];
    }
  }

  function saveShifts(shifts) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(shifts));
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : { notificationsEnabled: false };
    } catch (e) {
      return { notificationsEnabled: false };
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  let shifts = loadShifts();
  let settings = loadSettings();

  function uid() {
    return 'xxxxxxxxxxxx'.replace(/x/g, () =>
      Math.floor(Math.random() * 16).toString(16)
    );
  }

  function getOpenShift() {
    return shifts.find((s) => s.clockOut === null) || null;
  }

  function getOpenBreak(shift) {
    if (!shift || !Array.isArray(shift.breaks) || !shift.breaks.length) return null;
    const last = shift.breaks[shift.breaks.length - 1];
    return last.end === null ? last : null;
  }

  // ---------- Date / time helpers ----------

  function dateKey(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function startOfWeek(d) {
    const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    copy.setDate(copy.getDate() - copy.getDay()); // getDay(): 0 = Sunday
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  }

  function formatClock(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
  }

  function formatHoursMinutes(ms) {
    const totalMinutes = Math.max(0, Math.round(ms / 60000));
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${h}h ${String(m).padStart(2, '0')}m`;
  }

  function formatTimeOfDay(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  function localDateTimeValue(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${mo}-${da}T${h}:${mi}`;
  }

  // ---------- Time math ----------

  // Net worked ms for a shift, counting only completed (or currently-open,
  // capped at `now`) segments outside of breaks.
  function workedMs(shift, now) {
    const clockInMs = new Date(shift.clockIn).getTime();
    const endMs = shift.clockOut !== null ? new Date(shift.clockOut).getTime() : now;
    let total = endMs - clockInMs;
    for (const brk of shift.breaks) {
      const bStart = new Date(brk.start).getTime();
      const bEnd = brk.end !== null ? new Date(brk.end).getTime() : endMs;
      total -= Math.max(0, bEnd - bStart);
    }
    return Math.max(0, total);
  }

  function totalBreakMs(shift, now) {
    const endMs = shift.clockOut !== null ? new Date(shift.clockOut).getTime() : now;
    return shift.breaks.reduce((sum, brk) => {
      const bStart = new Date(brk.start).getTime();
      const bEnd = brk.end !== null ? new Date(brk.end).getTime() : endMs;
      return sum + Math.max(0, bEnd - bStart);
    }, 0);
  }

  // Net worked ms for a shift, clipped to [rangeStart, rangeEndExclusive) --
  // splits a shift's duration proportionally across a week/month boundary
  // it straddles, instead of attributing all of it to one side.
  function workedMsInRange(shift, rangeStart, rangeEndExclusive, now) {
    const clockInMs = new Date(shift.clockIn).getTime();
    const shiftEndMs = shift.clockOut !== null ? new Date(shift.clockOut).getTime() : now;
    const start = Math.max(clockInMs, rangeStart.getTime());
    const end = Math.min(shiftEndMs, rangeEndExclusive.getTime());
    if (end <= start) return 0;
    let total = end - start;
    for (const brk of shift.breaks) {
      const bStart = new Date(brk.start).getTime();
      const bEnd = brk.end !== null ? new Date(brk.end).getTime() : shiftEndMs;
      const overlapStart = Math.max(bStart, start);
      const overlapEnd = Math.min(bEnd, end);
      if (overlapEnd > overlapStart) total -= overlapEnd - overlapStart;
    }
    return Math.max(0, total);
  }

  function sumWorkedMsInRange(rangeStart, rangeEndExclusive, now) {
    return shifts.reduce(
      (sum, s) => sum + workedMsInRange(s, rangeStart, rangeEndExclusive, now),
      0
    );
  }

  // ---------- Actions ----------

  function clockIn() {
    if (getOpenShift()) return;
    const now = new Date();
    shifts.push({
      id: uid(),
      clockIn: now.toISOString(),
      clockOut: null,
      breaks: [],
      reminderFired: false,
    });
    saveShifts(shifts);
    scheduleReminderCheck();
    renderAll();
  }

  function toggleBreak() {
    const shift = getOpenShift();
    if (!shift) return;
    const openBreak = getOpenBreak(shift);
    const now = new Date().toISOString();
    if (openBreak) {
      openBreak.end = now;
    } else {
      shift.breaks.push({ start: now, end: null });
    }
    saveShifts(shifts);
    renderAll();
  }

  function clockOut() {
    const shift = getOpenShift();
    if (!shift) return;
    const now = new Date().toISOString();
    const openBreak = getOpenBreak(shift);
    if (openBreak) {
      openBreak.end = now; // ending an in-progress break at clock-out time
    }
    shift.clockOut = now;
    saveShifts(shifts);
    clearReminderTimer();
    hideBanner();
    renderAll();
  }

  // ---------- Rendering ----------

  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const timerDisplay = document.getElementById('timerDisplay');
  const breakTimerDisplay = document.getElementById('breakTimerDisplay');
  const clockInBtn = document.getElementById('clockInBtn');
  const breakBtn = document.getElementById('breakBtn');
  const clockOutBtn = document.getElementById('clockOutBtn');
  const weekTotalEl = document.getElementById('weekTotal');
  const monthTotalEl = document.getElementById('monthTotal');
  const historyListEl = document.getElementById('historyList');
  const reminderBanner = document.getElementById('reminderBanner');

  function renderStatus() {
    const shift = getOpenShift();
    const now = new Date();

    if (!shift) {
      statusDot.className = 'status-dot status-out';
      statusText.textContent = 'Not clocked in';
      timerDisplay.classList.add('hidden');
      breakTimerDisplay.classList.add('hidden');
      clockInBtn.disabled = false;
      breakBtn.disabled = true;
      breakBtn.textContent = 'Start Break';
      clockOutBtn.disabled = true;
      return;
    }

    clockInBtn.disabled = true;
    clockOutBtn.disabled = false;
    breakBtn.disabled = false;

    const openBreak = getOpenBreak(shift);
    const grossMs = now.getTime() - new Date(shift.clockIn).getTime();
    timerDisplay.classList.remove('hidden');
    timerDisplay.textContent = formatClock(grossMs);

    if (openBreak) {
      statusDot.className = 'status-dot status-break';
      statusText.textContent = `On break since ${formatTimeOfDay(
        openBreak.start
      )}`;
      breakBtn.textContent = 'End Break';
      breakTimerDisplay.classList.remove('hidden');
      breakTimerDisplay.textContent =
        'Break: ' +
        formatClock(now.getTime() - new Date(openBreak.start).getTime());
    } else {
      statusDot.className = 'status-dot status-in';
      statusText.textContent = `Clocked in since ${formatTimeOfDay(
        shift.clockIn
      )}`;
      breakBtn.textContent = 'Start Break';
      breakTimerDisplay.classList.add('hidden');
    }

    if (grossMs >= REMINDER_MS) {
      showBanner();
    }
  }

  function renderTotals() {
    const now = new Date();
    const weekStart = startOfWeek(now);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const monthStart = startOfMonth(now);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 1);

    weekTotalEl.textContent = formatHoursMinutes(
      sumWorkedMsInRange(weekStart, weekEnd, now.getTime())
    );
    monthTotalEl.textContent = formatHoursMinutes(
      sumWorkedMsInRange(monthStart, monthEnd, now.getTime())
    );
  }

  function renderHistory() {
    const now = Date.now();
    const completed = shifts
      .filter((s) => s.clockOut !== null)
      .slice()
      .sort((a, b) => new Date(b.clockIn) - new Date(a.clockIn));

    if (!completed.length) {
      historyListEl.innerHTML =
        '<p class="empty-state">No shifts recorded yet.</p>';
      return;
    }

    historyListEl.innerHTML = completed
      .map((s) => {
        const d = new Date(s.clockIn);
        const dateLabel = d.toLocaleDateString([], {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        });
        const worked = formatHoursMinutes(workedMs(s, now));
        const breakTotal = totalBreakMs(s, now);
        const breakLabel = s.breaks.length
          ? `${s.breaks.length} break${s.breaks.length > 1 ? 's' : ''} · ${formatHoursMinutes(
              breakTotal
            )}`
          : 'No breaks';
        return `
          <div class="shift-row" data-id="${s.id}">
            <div class="shift-row-top">
              <span>${dateLabel}</span>
              <span>${worked}</span>
            </div>
            <div class="shift-row-detail">${formatTimeOfDay(
              s.clockIn
            )} – ${formatTimeOfDay(s.clockOut)}</div>
            <div class="shift-row-breaks">${breakLabel}</div>
          </div>
        `;
      })
      .join('');

    historyListEl.querySelectorAll('.shift-row').forEach((row) => {
      row.addEventListener('click', () => openEditModal(row.dataset.id));
    });
  }

  function renderAll() {
    renderStatus();
    renderTotals();
    renderHistory();
  }

  // ---------- Reminder banner + notifications ----------

  function showBanner() {
    reminderBanner.classList.remove('hidden');
  }

  function hideBanner() {
    reminderBanner.classList.add('hidden');
  }

  let reminderTimerId = null;

  function clearReminderTimer() {
    if (reminderTimerId) {
      clearTimeout(reminderTimerId);
      reminderTimerId = null;
    }
  }

  function fireReminderNotification(shift) {
    if (shift.reminderFired) return;
    shift.reminderFired = true;
    saveShifts(shifts);
    showBanner();
    if (
      settings.notificationsEnabled &&
      'Notification' in window &&
      Notification.permission === 'granted'
    ) {
      const title = 'TimeSheet';
      const body = "You've been clocked in for 8 hours — don't forget to clock out.";
      // iOS Safari (home-screen PWAs) only supports notifications via the
      // service worker's showNotification(); the page-context Notification()
      // constructor silently does nothing there. Prefer the SW path when
      // available and fall back to the constructor for other browsers.
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.ready
          .then((reg) => reg.showNotification(title, { body, icon: 'icons/icon-192.png' }))
          .catch((e) => console.warn('Notification failed', e));
      } else {
        try {
          new Notification(title, { body, icon: 'icons/icon-192.png' });
        } catch (e) {
          console.warn('Notification failed', e);
        }
      }
    }
  }

  function checkReminderNow() {
    const shift = getOpenShift();
    if (!shift) return;
    const elapsed = Date.now() - new Date(shift.clockIn).getTime();
    if (elapsed >= REMINDER_MS) {
      fireReminderNotification(shift);
    }
  }

  function scheduleReminderCheck() {
    clearReminderTimer();
    const shift = getOpenShift();
    if (!shift) return;
    const elapsed = Date.now() - new Date(shift.clockIn).getTime();
    const remaining = REMINDER_MS - elapsed;
    if (remaining <= 0) {
      checkReminderNow();
      return;
    }
    // Best effort: only fires reliably while this tab/app stays active.
    reminderTimerId = setTimeout(() => {
      checkReminderNow();
    }, remaining);
  }

  // ---------- Edit modal ----------

  const editModal = document.getElementById('editModal');
  const editForm = document.getElementById('editForm');
  const editClockIn = document.getElementById('editClockIn');
  const editClockOut = document.getElementById('editClockOut');
  const editBreaksContainer = document.getElementById('editBreaksContainer');
  const addBreakBtn = document.getElementById('addBreakBtn');
  const cancelEditBtn = document.getElementById('cancelEditBtn');
  const deleteShiftBtn = document.getElementById('deleteShiftBtn');

  let editingShiftId = null;

  function renderBreakRow(brk, index) {
    const row = document.createElement('div');
    row.className = 'break-edit-row';
    row.dataset.index = String(index);
    row.innerHTML = `
      <input type="datetime-local" step="60" class="break-start" value="${localDateTimeValue(
        brk.start
      )}" />
      <input type="datetime-local" step="60" class="break-end" value="${localDateTimeValue(
        brk.end
      )}" />
      <button type="button" class="remove-break" aria-label="Remove break">✕</button>
    `;
    row
      .querySelector('.remove-break')
      .addEventListener('click', () => row.remove());
    return row;
  }

  function openEditModal(shiftId) {
    const shift = shifts.find((s) => s.id === shiftId);
    if (!shift) return;
    editingShiftId = shiftId;
    editClockIn.value = localDateTimeValue(shift.clockIn);
    editClockOut.value = localDateTimeValue(shift.clockOut);
    editBreaksContainer.innerHTML = '';
    shift.breaks.forEach((brk, i) => {
      editBreaksContainer.appendChild(renderBreakRow(brk, i));
    });
    editModal.classList.remove('hidden');
  }

  function closeEditModal() {
    editModal.classList.add('hidden');
    editingShiftId = null;
  }

  addBreakBtn.addEventListener('click', () => {
    const index = editBreaksContainer.children.length;
    editBreaksContainer.appendChild(
      renderBreakRow({ start: null, end: null }, index)
    );
  });

  cancelEditBtn.addEventListener('click', closeEditModal);

  deleteShiftBtn.addEventListener('click', () => {
    if (!editingShiftId) return;
    if (!confirm('Delete this shift? This cannot be undone.')) return;
    shifts = shifts.filter((s) => s.id !== editingShiftId);
    saveShifts(shifts);
    closeEditModal();
    renderAll();
  });

  editForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const shift = shifts.find((s) => s.id === editingShiftId);
    if (!shift) return;

    // Clock In/Out are full datetime-local values (own date + time each),
    // so this correctly handles shifts that span midnight. Clock Out is
    // required here: the edit modal only ever opens on a completed shift
    // (renderHistory only lists shifts with clockOut !== null), and it must
    // stay that way -- allowing it to be cleared would let this shift and
    // the real currently-open shift both read as "open" at once.
    const newClockIn = new Date(editClockIn.value).toISOString();
    const newClockOut = new Date(editClockOut.value).toISOString();

    if (new Date(newClockOut).getTime() <= new Date(newClockIn).getTime()) {
      alert('Clock out must be after clock in.');
      return;
    }

    const newBreaks = [];
    for (const row of editBreaksContainer.querySelectorAll('.break-edit-row')) {
      const startVal = row.querySelector('.break-start').value;
      const endVal = row.querySelector('.break-end').value;
      if (!startVal && !endVal) continue; // fully empty row: ignore, not an error
      if (!startVal || !endVal) {
        alert('Each break needs both a start and an end time (or leave both blank to remove it).');
        return;
      }
      const bStart = new Date(startVal).toISOString();
      const bEnd = new Date(endVal).toISOString();
      if (new Date(bEnd).getTime() <= new Date(bStart).getTime()) {
        alert('Each break end must be after its start.');
        return;
      }
      if (
        new Date(bStart).getTime() < new Date(newClockIn).getTime() ||
        new Date(bEnd).getTime() > new Date(newClockOut).getTime()
      ) {
        alert('Breaks must fall between clock in and clock out.');
        return;
      }
      newBreaks.push({ start: bStart, end: bEnd });
    }
    newBreaks.sort((a, b) => new Date(a.start) - new Date(b.start));

    shift.clockIn = newClockIn;
    shift.clockOut = newClockOut;
    shift.breaks = newBreaks;
    saveShifts(shifts);
    closeEditModal();
    renderAll();
  });

  // ---------- Export / Import ----------

  const exportModal = document.getElementById('exportModal');
  const menuExportBtn = document.getElementById('menuExportBtn');
  const closeExportBtn = document.getElementById('closeExportBtn');
  const exportBtn = document.getElementById('exportBtn');
  const importInput = document.getElementById('importInput');
  const enableNotifsBtn = document.getElementById('enableNotifsBtn');

  menuExportBtn.addEventListener('click', () =>
    exportModal.classList.remove('hidden')
  );
  closeExportBtn.addEventListener('click', () =>
    exportModal.classList.add('hidden')
  );

  exportBtn.addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ shifts, exportedAt: new Date().toISOString() }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `timesheet-backup-${dateKey(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  // Validates and normalizes an imported shift array *before* anything is
  // persisted, so a malformed/hand-edited backup can never partially
  // overwrite real data. Rejects (rather than guesses) anything genuinely
  // ambiguous; normalizes only unambiguous variants (missing "breaks",
  // undefined/'' clockOut) to the single canonical form the rest of the
  // app assumes.
  function sanitizeIncomingShifts(incoming) {
    const seenIds = new Set();
    const result = [];
    for (let i = 0; i < incoming.length; i++) {
      const raw = incoming[i];
      const label = `Shift #${i + 1}`;
      if (!raw || typeof raw !== 'object') {
        return { ok: false, error: `${label} is not a valid record.` };
      }
      const clockInMs = new Date(raw.clockIn).getTime();
      if (Number.isNaN(clockInMs)) {
        return { ok: false, error: `${label} has an invalid clock-in time.` };
      }

      let clockOut = null;
      if (raw.clockOut !== null && raw.clockOut !== undefined && raw.clockOut !== '') {
        const clockOutMs = new Date(raw.clockOut).getTime();
        if (Number.isNaN(clockOutMs)) {
          return { ok: false, error: `${label} has an invalid clock-out time.` };
        }
        if (clockOutMs <= clockInMs) {
          return { ok: false, error: `${label} has a clock-out at or before its clock-in.` };
        }
        clockOut = new Date(raw.clockOut).toISOString();
      }

      const rawBreaks = Array.isArray(raw.breaks) ? raw.breaks : [];
      const breaks = [];
      for (let j = 0; j < rawBreaks.length; j++) {
        const brk = rawBreaks[j];
        const breakLabel = `${label}, break #${j + 1}`;
        if (!brk || typeof brk !== 'object') {
          return { ok: false, error: `${breakLabel} is not a valid record.` };
        }
        const bStartMs = new Date(brk.start).getTime();
        if (Number.isNaN(bStartMs)) {
          return { ok: false, error: `${breakLabel} has an invalid start time.` };
        }
        let bEnd = null;
        if (brk.end !== null && brk.end !== undefined && brk.end !== '') {
          const bEndMs = new Date(brk.end).getTime();
          if (Number.isNaN(bEndMs)) {
            return { ok: false, error: `${breakLabel} has an invalid end time.` };
          }
          if (bEndMs <= bStartMs) {
            return { ok: false, error: `${breakLabel} ends at or before it starts.` };
          }
          bEnd = new Date(brk.end).toISOString();
        }
        breaks.push({ start: new Date(brk.start).toISOString(), end: bEnd });
      }
      breaks.sort((a, b) => new Date(a.start) - new Date(b.start));

      let id = typeof raw.id === 'string' && raw.id && !seenIds.has(raw.id) ? raw.id : uid();
      while (seenIds.has(id)) id = uid();
      seenIds.add(id);

      result.push({
        id,
        clockIn: new Date(raw.clockIn).toISOString(),
        clockOut,
        breaks,
        reminderFired: Boolean(raw.reminderFired),
      });
    }
    const openCount = result.filter((s) => s.clockOut === null).length;
    if (openCount > 1) {
      return {
        ok: false,
        error: `This backup has ${openCount} shifts marked as still "open" (no clock-out) -- only one is allowed at a time.`,
      };
    }
    return { ok: true, shifts: result };
  }

  importInput.addEventListener('change', () => {
    const file = importInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const incoming = Array.isArray(data) ? data : data.shifts;
        if (!Array.isArray(incoming)) throw new Error('Invalid backup file');
        const sanitized = sanitizeIncomingShifts(incoming);
        if (!sanitized.ok) {
          alert(`Could not import this backup: ${sanitized.error}\n\nNo changes were made.`);
          importInput.value = '';
          return;
        }
        if (
          !confirm(
            `Import ${sanitized.shifts.length} shift(s)? This will replace all current data.`
          )
        ) {
          importInput.value = '';
          return;
        }
        shifts = sanitized.shifts;
        saveShifts(shifts);
        renderAll();
        scheduleReminderCheck();
        importInput.value = '';
        exportModal.classList.add('hidden');
      } catch (e) {
        alert('Could not read that file as a TimeSheet backup. No changes were made.');
        importInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  enableNotifsBtn.addEventListener('click', async () => {
    if (!('Notification' in window)) {
      alert('Notifications are not supported in this browser.');
      return;
    }
    const permission = await Notification.requestPermission();
    settings.notificationsEnabled = permission === 'granted';
    saveSettings(settings);
    alert(
      settings.notificationsEnabled
        ? 'Reminder notifications enabled.'
        : 'Notifications were not granted.'
    );
  });

  // ---------- Wire up main buttons ----------

  clockInBtn.addEventListener('click', clockIn);
  breakBtn.addEventListener('click', toggleBreak);
  clockOutBtn.addEventListener('click', clockOut);

  // ---------- Ticking + lifecycle ----------

  setInterval(() => {
    renderStatus();
  }, 1000);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkReminderNow();
      renderAll();
    }
  });
  window.addEventListener('focus', () => {
    checkReminderNow();
    renderAll();
  });

  // ---------- Service worker ----------

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch((e) => {
        console.warn('Service worker registration failed', e);
      });
    });
  }

  // ---------- Init ----------

  renderAll();
  checkReminderNow();
  scheduleReminderCheck();
})();
