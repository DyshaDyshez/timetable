// employee.js
// Скрипт страницы сотрудника

const { db, doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } = window;

// Получаем ID сотрудника из URL
const urlParams = new URLSearchParams(window.location.search);
const EMPLOYEE_ID = urlParams.get('id');

if (!EMPLOYEE_ID) {
    document.body.innerHTML = '<div style="padding:50px;text-align:center;color:var(--red);"><h1>Ошибка!</h1><p>Не указан ID сотрудника. Обратитесь к руководителю.</p></div>';
    throw new Error('No employee ID');
}

// Глобальные переменные
let currentWeekOffset = 0;
let currentData = null;
let isSaving = false;

// Константы
const DAY_NAMES = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

// Функции работы с датами
function getWeekKey(date) {
    const d = new Date(date);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
}

function getMonday(date) {
    const d = new Date(date);
    const day = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - day);
    d.setHours(0, 0, 0, 0);
    return d;
}

function getWeekDates(offset) {
    const today = new Date();
    const baseMonday = getMonday(today);
    const monday = new Date(baseMonday);
    monday.setDate(monday.getDate() + offset * 7);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(d.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function formatDate(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' }).replace('.', '');
}

// Загрузка данных из Firestore
async function loadWeekData(weekKey) {
    try {
        const docRef = doc(db, 'weeks', `${EMPLOYEE_ID}_${weekKey}`);
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                workDays: data.workDays || [true, true, true, true, true, false, false],
                hours: data.hours || [8, 8, 8, 8, 8, 0, 0],
                isPaid: data.isPaid || false
            };
        } else {
            return {
                workDays: [true, true, true, true, true, false, false],
                hours: [8, 8, 8, 8, 8, 0, 0],
                isPaid: false
            };
        }
    } catch (error) {
        console.error('Ошибка загрузки:', error);
        return null;
    }
}

// Сохранение данных в Firestore
async function saveWeekData(weekKey, workDays, hours) {
    if (isSaving) return;
    isSaving = true;
    
    try {
        const docRef = doc(db, 'weeks', `${EMPLOYEE_ID}_${weekKey}`);
        await setDoc(docRef, {
            employeeId: EMPLOYEE_ID,
            weekKey: weekKey,
            workDays: workDays,
            hours: hours,
            isPaid: currentData?.isPaid || false,
            updatedAt: new Date().toISOString()
        }, { merge: true });
        
        showSaveIndicator('✅ Сохранено');
    } catch (error) {
        console.error('Ошибка сохранения:', error);
        showSaveIndicator('❌ Ошибка сохранения');
    } finally {
        isSaving = false;
    }
}

// Показать индикатор сохранения
function showSaveIndicator(message) {
    const el = document.getElementById('saveIndicator') || createSaveIndicator();
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 1500);
}

function createSaveIndicator() {
    const el = document.createElement('div');
    el.id = 'saveIndicator';
    el.className = 'save-indicator';
    document.body.appendChild(el);
    return el;
}

// Обновление UI
function update() {
    if (!currentData) return;
    
    const { workDays, hours, isPaid } = currentData;
    const dates = getWeekDates(currentWeekOffset);
    const weekKey = getWeekKey(dates[0]);
    
    const rD = parseFloat(document.getElementById('rDay').value) || 3000;
    const rE = parseFloat(document.getElementById('rExtra').value) || 3500;
    const r1 = parseFloat(document.getElementById('rOt1').value) || 400;
    const r2 = parseFloat(document.getElementById('rOt2').value) || 800;
    const hpd = parseFloat(document.getElementById('hpd').value) || 8;
    const lim = parseFloat(document.getElementById('otLimit').value) || 5;
    
    const days = workDays.filter(Boolean).length;
    const totalHours = hours.reduce((a, b) => a + b, 0);
    const norm = days * hpd;
    const baseDays = Math.min(days, 5);
    const extraDays = Math.max(0, days - 5);
    const ot = Math.max(0, totalHours - norm);
    const ot1 = Math.min(ot, lim);
    const ot2 = Math.max(0, ot - lim);
    
    const payBase = baseDays * rD;
    const payExtra = extraDays * rE;
    const payOt1 = ot1 * r1;
    const payOt2 = ot2 * r2;
    const total = payBase + payExtra + payOt1 + payOt2;
    
    document.querySelectorAll('#days .day').forEach((b, i) => {
        const on = workDays[i];
        b.classList.toggle('on', on);
        const dayIndex = workDays.slice(0, i).filter(Boolean).length;
        const isExtra = on && dayIndex >= 5;
        b.classList.toggle('extra', isExtra);
        const rate = isExtra ? rE : rD;
        b.querySelector('i').textContent = rate.toLocaleString() + ' ₽';
    });
    
    document.querySelectorAll('#dayHours .dh-item input').forEach((inp, i) => {
        inp.disabled = !workDays[i];
        if (!workDays[i]) inp.value = 0;
        else if (parseFloat(inp.value) !== hours[i]) inp.value = hours[i];
    });
    
    document.getElementById('dOut').textContent = days;
    document.getElementById('normOut').textContent = `норма: ${norm} ч (${days} дн × ${hpd} ч)`;
    
    const otB = document.getElementById('otBadge');
    const uwB = document.getElementById('uwBadge');
    if (ot > 0) {
        otB.hidden = false;
        otB.textContent = `переработка +${ot} ч`;
        otB.className = 'badge ' + (ot2 > 0 ? 'hot' : 'ot');
    } else {
        otB.hidden = true;
    }
    if (days > 0 && totalHours < norm) {
        uwB.hidden = false;
        uwB.textContent = `меньше нормы на ${norm - totalHours} ч — переработки нет`;
    } else {
        uwB.hidden = true;
    }
    
    document.getElementById('qBase').textContent = `${baseDays} × ${rD.toLocaleString()} ₽`;
    document.getElementById('vBase').textContent = payBase.toLocaleString() + ' ₽';
    
    document.getElementById('rowExtra').classList.toggle('gone', extraDays === 0);
    document.getElementById('qExtra').textContent = `${extraDays} × ${rE.toLocaleString()} ₽`;
    document.getElementById('vExtra').textContent = payExtra.toLocaleString() + ' ₽';
    
    document.getElementById('rowOt1').classList.toggle('gone', ot1 === 0);
    document.getElementById('qOt1').textContent = `${ot1} ч × ${r1.toLocaleString()} ₽`;
    document.getElementById('vOt1').textContent = payOt1.toLocaleString() + ' ₽';
    
    document.getElementById('rowOt2').classList.toggle('gone', ot2 === 0);
    document.getElementById('qOt2').textContent = `${ot2} ч × ${r2.toLocaleString()} ₽`;
    document.getElementById('vOt2').textContent = payOt2.toLocaleString() + ' ₽';
    
    const scale = Math.max(totalHours, norm, 1);
    document.getElementById('bNorm').style.width = (Math.min(totalHours, norm) / scale * 100) + '%';
    document.getElementById('bOt1').style.width = (ot1 / scale * 100) + '%';
    document.getElementById('bOt2').style.width = (ot2 / scale * 100) + '%';
    document.getElementById('lNorm').textContent = Math.min(totalHours, norm) + ' ч';
    document.getElementById('lOt1').textContent = ot1 + ' ч';
    document.getElementById('lOt2').textContent = ot2 + ' ч';
    
    document.getElementById('totalOut').textContent = total.toLocaleString();
    
    const parts = [];
    if (baseDays) parts.push(`<b class="f-n">${baseDays}×${rD.toLocaleString()}</b>`);
    if (extraDays) parts.push(`<b class="f-n">${extraDays}×${rE.toLocaleString()}</b>`);
    if (ot1) parts.push(`<b class="f-1">${ot1}×${r1.toLocaleString()}</b>`);
    if (ot2) parts.push(`<b class="f-2">${ot2}×${r2.toLocaleString()}</b>`);
    document.getElementById('formula').innerHTML = parts.length ? parts.join(' + ') + ` = ${total.toLocaleString()} ₽` : '—';
    
    document.getElementById('metaLine').textContent =
        `отработано ${totalHours} ч · норма ${norm} ч` +
        (totalHours > 0 && total > 0 ? ` · ≈ ${Math.round(total/totalHours)} ₽/час` : '');
    
    document.getElementById('chip1').textContent = `1–5 день · ${rD.toLocaleString()} ₽`;
    document.getElementById('chip2').textContent = `6–7 день · ${rE.toLocaleString()} ₽`;
    document.getElementById('chip3').textContent = `переработка · ${r1.toLocaleString()} / ${r2.toLocaleString()} ₽/ч`;
    
    const mon = dates[0];
    const sun = dates[6];
    const weekLabel = `неделя №${weekKey.replace('W', '')} · ${formatDate(mon)} – ${formatDate(sun)}`;
    document.getElementById('eyebrow').textContent = `Табель · ${weekLabel}`;
    document.getElementById('wk').textContent = weekLabel;
}

// Построение UI
function buildUI() {
    const daysBox = document.getElementById('days');
    const dhBox = document.getElementById('dayHours');
    
    daysBox.innerHTML = '';
    dhBox.innerHTML = '';
    
    DAY_NAMES.forEach((n, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'day';
        b.dataset.i = i;
        b.innerHTML = `<b>${n}</b><i></i>`;
        b.addEventListener('click', async () => {
            if (!currentData) return;
            currentData.workDays[i] = !currentData.workDays[i];
            if (currentData.workDays[i]) {
                currentData.hours[i] = parseFloat(document.getElementById('hpd').value) || 8;
            } else {
                currentData.hours[i] = 0;
            }
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours);
        });
        daysBox.appendChild(b);
        
        const div = document.createElement('div');
        div.className = 'dh-item';
        div.dataset.i = i;
        div.innerHTML = `
            <label>${n}</label>
            <input type="number" min="0" max="24" step="1" value="0">
        `;
        const inp = div.querySelector('input');
        inp.addEventListener('input', async (e) => {
            if (!currentData) return;
            const v = parseFloat(e.target.value);
            if (!isNaN(v) && v >= 0) {
                currentData.hours[i] = v;
                update();
                const dates = getWeekDates(currentWeekOffset);
                const weekKey = getWeekKey(dates[0]);
                await saveWeekData(weekKey, currentData.workDays, currentData.hours);
            }
        });
        dhBox.appendChild(div);
    });
}

// Инициализация
async function init() {
    buildUI();
    
    const dates = getWeekDates(0);
    const weekKey = getWeekKey(dates[0]);
    currentData = await loadWeekData(weekKey);
    
    updateWeekLabel(dates);
    update();
    
    document.getElementById('weekPrev').addEventListener('click', async () => {
        currentWeekOffset--;
        const dates = getWeekDates(currentWeekOffset);
        const weekKey = getWeekKey(dates[0]);
        updateWeekLabel(dates);
        currentData = await loadWeekData(weekKey);
        update();
    });
    
    document.getElementById('weekNext').addEventListener('click', async () => {
        currentWeekOffset++;
        const dates = getWeekDates(currentWeekOffset);
        const weekKey = getWeekKey(dates[0]);
        updateWeekLabel(dates);
        currentData = await loadWeekData(weekKey);
        update();
    });
    
    document.getElementById('weekToday').addEventListener('click', async () => {
        currentWeekOffset = 0;
        const dates = getWeekDates(0);
        const weekKey = getWeekKey(dates[0]);
        updateWeekLabel(dates);
        currentData = await loadWeekData(weekKey);
        update();
    });
    
    document.getElementById('dMinus').addEventListener('click', async () => {
        if (!currentData) return;
        const idx = currentData.workDays.lastIndexOf(true);
        if (idx !== -1) {
            currentData.workDays[idx] = false;
            currentData.hours[idx] = 0;
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours);
        }
    });
    
    document.getElementById('dPlus').addEventListener('click', async () => {
        if (!currentData) return;
        const idx = currentData.workDays.indexOf(false);
        if (idx !== -1) {
            currentData.workDays[idx] = true;
            currentData.hours[idx] = parseFloat(document.getElementById('hpd').value) || 8;
            update();
            const dates = getWeekDates(currentWeekOffset);
            const weekKey = getWeekKey(dates[0]);
            await saveWeekData(weekKey, currentData.workDays, currentData.hours);
        }
    });
    
    ['rDay', 'rExtra', 'rOt1', 'rOt2', 'hpd', 'otLimit'].forEach(id => {
        document.getElementById(id).addEventListener('input', update);
    });
    
    document.getElementById('resetBtn').addEventListener('click', async () => {
        if (!confirm('Сбросить данные за эту неделю?')) return;
        const dates = getWeekDates(currentWeekOffset);
        const weekKey = getWeekKey(dates[0]);
        currentData = {
            workDays: [true, true, true, true, true, false, false],
            hours: [8, 8, 8, 8, 8, 0, 0],
            isPaid: false
        };
        update();
        await saveWeekData(weekKey, currentData.workDays, currentData.hours);
    });
    
    document.getElementById('copyBtn').addEventListener('click', async () => {
        const total = document.getElementById('totalOut').textContent;
        const dates = getWeekDates(currentWeekOffset);
        const mon = dates[0];
        const sun = dates[6];
        const text = `Зарплата за неделю ${formatDate(mon)}–${formatDate(sun)}: ${total} ₽`;
        try {
            await navigator.clipboard.writeText(text);
            const btn = document.getElementById('copyBtn');
            const old = btn.textContent;
            btn.textContent = '✓ Скопировано';
            setTimeout(() => btn.textContent = old, 1500);
        } catch (e) {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            ta.remove();
        }
    });
}

function updateWeekLabel(dates) {
    const mon = dates[0];
    const sun = dates[6];
    const weekKey = getWeekKey(mon);
    const today = new Date();
    const todayWeek = getWeekKey(today);
    const isCurrent = weekKey === todayWeek;
    
    document.getElementById('weekRange').textContent = `${formatDate(mon)} – ${formatDate(sun)}`;
    document.getElementById('weekSub').textContent = isCurrent ? 'текущая неделя' : weekKey;
}

// Добавляем стиль для индикатора сохранения
const style = document.createElement('style');
style.textContent = `
    .save-indicator {
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: var(--teal);
        color: #0c1520;
        padding: 10px 20px;
        border-radius: 999px;
        font-size: .85rem;
        font-weight: 700;
        opacity: 0;
        transition: opacity .4s;
        pointer-events: none;
        font-family: var(--mono);
        z-index: 9999;
    }
    .save-indicator.show {
        opacity: 1;
    }
`;
document.head.appendChild(style);

// Запускаем
init();