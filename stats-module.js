// stats-module.js
// Модуль статистики для админ-панели

import { calculateWeekPay } from './modules/calculator.js';

export async function getEmployeeSettings(employeeId, db, doc, getDoc) {
    try {
        const docRef = doc(db, 'salarySettings', employeeId);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
            const data = docSnap.data();
            return {
                rDay: data.rDay || 3000,
                rExtra: data.rExtra || 3500,
                rOt1: data.rOt1 || 400,
                rOt2: data.rOt2 || 800,
                hpd: data.hpd || 8,
                otLimit: data.otLimit || 5
            };
        }
    } catch (error) {
        console.warn('Не удалось загрузить настройки:', error);
    }
    return {
        rDay: 3000,
        rExtra: 3500,
        rOt1: 400,
        rOt2: 800,
        hpd: 8,
        otLimit: 5
    };
}

export function getWeekNumber(weekKey) {
    const match = weekKey.match(/W(\d+)/);
    return match ? parseInt(match[1]) : weekKey;
}

export function getWeekDateRange(weekKey) {
    const match = weekKey.match(/^(\d+)-W(\d+)/);
    if (!match) {
        return { startDate: new Date(), endDate: new Date() };
    }
    const year = parseInt(match[1]);
    const weekNum = parseInt(match[2]);
    const jan4 = new Date(year, 0, 4);
    const dayOfWeek = jan4.getDay();
    let daysToMonday;
    if (dayOfWeek === 0) {
        daysToMonday = 1;
    } else {
        daysToMonday = 1 - dayOfWeek;
    }
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() + daysToMonday);
    const startDate = new Date(firstMonday);
    startDate.setDate(firstMonday.getDate() + (weekNum - 1) * 7);
    const endDate = new Date(startDate);
    endDate.setDate(startDate.getDate() + 6);
    return { startDate, endDate };
}

export function formatDateRange(weekKey) {
    try {
        const { startDate, endDate } = getWeekDateRange(weekKey);
        const options = { day: '2-digit', month: 'short' };
        const start = startDate.toLocaleDateString('ru-RU', options);
        const end = endDate.toLocaleDateString('ru-RU', options);
        return `${start} – ${end}`;
    } catch (error) {
        return weekKey;
    }
}

export function getWeekMonth(weekKey) {
    const { startDate } = getWeekDateRange(weekKey);
    const month = startDate.getMonth();
    const year = startDate.getFullYear();
    return { month, year, label: startDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }) };
}

export async function updatePaidAmount(weekId, amount, db, doc, updateDoc) {
    try {
        await updateDoc(doc(db, 'salaryWeeks', weekId), {
            paidAmount: parseFloat(amount) || 0,
            paidAt: new Date().toISOString()
        });
        return true;
    } catch (error) {
        console.error('Ошибка сохранения выплаты:', error);
        return false;
    }
}

function getUniqueMonths(weeks) {
    const months = new Map();
    weeks.forEach(week => {
        const { month, year, label } = getWeekMonth(week.weekKey);
        const key = `${year}-${month}`;
        if (!months.has(key)) {
            months.set(key, { month, year, label, weeks: [] });
        }
        months.get(key).weeks.push(week);
    });
    return Array.from(months.values()).sort((a, b) => {
        if (a.year !== b.year) return a.year - b.year;
        return a.month - b.month;
    });
}

export function renderWeekDetailsModal(weekData, settings, employeeName, weekKey, weekId, db, doc, updateDoc, showNotification) {
    const oldModal = document.getElementById('weekDetailsModal');
    if (oldModal) oldModal.remove();
    
    const stats = calculateWeekPay(weekData, settings);
    const weekNum = getWeekNumber(weekKey);
    const dateRange = formatDateRange(weekKey);
    const paidAmount = weekData.paidAmount || 0;
    const isPaid = weekData.isPaid || false;
    
    const modal = document.createElement('div');
    modal.id = 'weekDetailsModal';
    modal.className = 'modal active';
    modal.style.display = 'block';
    modal.innerHTML = `
        <div class="modal-content" style="max-width: 600px;">
            <button class="modal-close" id="closeWeekDetails">&times;</button>
            <h2 style="font-family: var(--display); color: var(--amber); margin-bottom: 8px;">
                📊 ${employeeName}
            </h2>
            <div style="color: var(--mut); font-size: .85rem; margin-bottom: 16px;">
                Неделя ${weekNum} · ${dateRange}
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px;">
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Рабочих дней</div>
                    <div style="font-size: 2rem; font-weight: bold; color: var(--amber2);">${stats.days}</div>
                </div>
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Часов</div>
                    <div style="font-size: 2rem; font-weight: bold; color: var(--amber2);">${stats.totalHours}</div>
                </div>
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Норма</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: var(--teal);">${stats.norm} ч</div>
                </div>
                <div style="background: rgba(255,255,255,.05); padding: 12px; border-radius: 8px; text-align: center;">
                    <div style="color: var(--mut); font-size: .7rem;">Переработка</div>
                    <div style="font-size: 1.2rem; font-weight: bold; color: ${stats.ot > 0 ? 'var(--amber)' : 'var(--mut)'};">${stats.ot > 0 ? stats.ot + ' ч' : '—'}</div>
                </div>
            </div>
            
            <div style="background: rgba(255,181,46,.08); padding: 16px; border-radius: 8px; margin-bottom: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="color: var(--mut); font-size: .8rem;">Расчётная сумма</span>
                    <span style="font-size: 2rem; font-weight: bold; color: var(--amber);">${stats.total.toLocaleString()} ₽</span>
                </div>
            </div>
            
            <div style="background: rgba(62,207,168,.08); padding: 16px; border-radius: 8px; margin-bottom: 16px; border: 1px solid var(--teal);">
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
                    <span style="color: var(--mut); font-size: .8rem;">💰 Фактически выплачено</span>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <input type="number" id="paidInput" value="${paidAmount}" 
                               style="width: 140px; padding: 8px 12px; border-radius: 8px; 
                                      border: 1px solid var(--line); background: var(--bg2); color: var(--txt); 
                                      font-size: 1.1rem; text-align: right;">
                        <span style="font-weight: bold; font-size: 1.1rem;">₽</span>
                        <button id="savePaidBtn" 
                                style="background: var(--teal); color: #0c1520; border: none; 
                                       padding: 8px 16px; border-radius: 8px; cursor: pointer; font-weight: bold;">
                            Сохранить
                        </button>
                    </div>
                </div>
                <div style="margin-top: 8px; font-size: .7rem; color: var(--mut);">
                    ${isPaid ? '✅ Отмечено как выплачено' : '⏳ Ожидает выплаты'}
                </div>
            </div>
            
            <div style="border-top: 1px solid var(--line); padding-top: 16px; margin-bottom: 16px;">
                <div style="color: var(--mut); font-size: .7rem; margin-bottom: 10px;">Расписание по дням:</div>
                <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px;">
                    ${['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].map((day, i) => `
                        <div style="text-align: center; padding: 6px 2px; border-radius: 6px; 
                            background: ${stats.workDays[i] ? 'rgba(62,207,168,.2)' : 'rgba(255,255,255,.05)'};
                            border: 1px solid ${stats.workDays[i] ? 'var(--teal)' : 'var(--line)'};
                            color: ${stats.workDays[i] ? 'var(--txt)' : 'var(--mut)'};">
                            <div style="font-size: .55rem; color: var(--mut);">${day}</div>
                            <div style="font-weight: bold; font-size: .9rem;">${stats.hours[i]}ч</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            
            <div style="font-size: .7rem; color: var(--mut); border-top: 1px solid var(--line); padding-top: 12px;">
                ${stats.payBase > 0 ? `${stats.payBase.toLocaleString()} ₽` : ''}
                ${stats.payExtra > 0 ? ` + ${stats.payExtra.toLocaleString()} ₽` : ''}
                ${stats.payOt1 > 0 ? ` + ${stats.payOt1.toLocaleString()} ₽` : ''}
                ${stats.payOt2 > 0 ? ` + ${stats.payOt2.toLocaleString()} ₽` : ''}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    const savePaidBtn = modal.querySelector('#savePaidBtn');
    const paidInput = modal.querySelector('#paidInput');
    
    savePaidBtn.addEventListener('click', async () => {
        const amount = parseFloat(paidInput.value) || 0;
        const success = await updatePaidAmount(weekId, amount, db, doc, updateDoc);
        if (success) {
            showNotification('✅ Сумма выплаты сохранена!');
            const statsData = window._statsData;
            if (statsData) {
                const weekIndex = statsData.weeks.findIndex(w => w.id === weekId);
                if (weekIndex !== -1) {
                    statsData.weeks[weekIndex].paidAmount = amount;
                    statsData.weeks[weekIndex].isPaid = true;
                    renderStats(
                        statsData.employeeId,
                        statsData.employeeName,
                        db, collection, doc, query, where, getDocs, getDoc,
                        showNotification
                    );
                }
            }
            modal.remove();
        } else {
            showNotification('❌ Ошибка сохранения', true);
        }
    });
    
    modal.querySelector('#closeWeekDetails').addEventListener('click', () => {
        modal.remove();
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

// ===== ОСНОВНАЯ ФУНКЦИЯ СТАТИСТИКИ =====
export async function renderStats(employeeId, employeeName, db, collection, doc, query, where, getDocs, getDoc, showNotification) {
    const oldModal = document.getElementById('statsModal');
    if (oldModal) oldModal.remove();
    
    const settings = await getEmployeeSettings(employeeId, db, doc, getDoc);
    
    const weeksRef = collection(db, 'salaryWeeks');
    const q = query(weeksRef, where('employeeId', '==', employeeId));
    const snapshot = await getDocs(q);
    
    const allWeeks = [];
    snapshot.forEach((doc) => {
        allWeeks.push({ id: doc.id, ...doc.data() });
    });
    
    allWeeks.sort((a, b) => a.weekKey.localeCompare(b.weekKey));
    
    window._statsData = { weeks: allWeeks, settings, employeeName, employeeId };
    
    const uniqueMonths = getUniqueMonths(allWeeks);
    let currentFilter = 'all';
    
    const modal = document.createElement('div');
    modal.id = 'statsModal';
    modal.className = 'modal active';
    modal.style.display = 'block';
    
    let bodyHTML = `
        <div class="modal-content" style="max-width: 1000px;">
            <button class="modal-close" id="closeStatsModal">&times;</button>
            <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 8px;">
                <h2 style="font-family: var(--display); color: var(--amber); margin: 0;">
                    📊 ${employeeName}
                </h2>
                <button id="toggleArchiveBtn" 
                        style="background: rgba(255,255,255,.1); border: 1px solid var(--line); 
                               color: var(--txt); padding: 6px 16px; border-radius: 8px; cursor: pointer; 
                               font-size: .8rem; transition: .2s;">
                    📂 Показать архив
                </button>
            </div>
            
            <div style="color: var(--mut); font-size: .85rem; margin-bottom: 12px;">
                Всего недель: ${allWeeks.length}
                <span style="margin-left: 16px;">⚙️ Ставка: ${settings.rDay.toLocaleString()}₽ / ${settings.rExtra.toLocaleString()}₽</span>
            </div>
            
            <div style="display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; padding: 12px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);">
                <button class="filter-btn active" data-filter="all" 
                        style="background: var(--amber); color: #241d10; border: none; 
                               padding: 6px 18px; border-radius: 999px; cursor: pointer; font-weight: bold; 
                               font-size: .8rem; transition: all .2s;">
                    📅 Все недели
                </button>
    `;
    
    uniqueMonths.forEach((monthData) => {
        const filterKey = `${monthData.year}-${String(monthData.month + 1).padStart(2, '0')}`;
        const weeksCount = monthData.weeks.length;
        bodyHTML += `
            <button class="filter-btn" data-filter="${filterKey}" 
                    style="background: rgba(255,255,255,.05); color: var(--txt); border: 1px solid var(--line); 
                           padding: 6px 18px; border-radius: 999px; cursor: pointer; 
                           font-size: .8rem; transition: all .2s;">
                ${monthData.label} (${weeksCount})
            </button>
        `;
    });
    
    bodyHTML += `
            </div>
            
            <div id="statsContent">
    `;
    
    bodyHTML += buildStatsTable(allWeeks, settings, false);
    
    bodyHTML += `
            </div>
            
            <div style="margin-top: 16px; font-size: .7rem; color: var(--mut); border-top: 1px solid var(--line); padding-top: 12px;">
                ⚙️ Ставки: ${settings.rDay.toLocaleString()}₽ / ${settings.rExtra.toLocaleString()}₽ · 
                переработка ${settings.rOt1.toLocaleString()}₽ / ${settings.rOt2.toLocaleString()}₽ · 
                норма ${settings.hpd}ч · лимит переработки ${settings.otLimit}ч
            </div>
        </div>
    `;
    
    modal.innerHTML = bodyHTML;
    document.body.appendChild(modal);
    
    const filterButtons = modal.querySelectorAll('.filter-btn');
    const contentContainer = modal.querySelector('#statsContent');
    
    filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            filterButtons.forEach(b => {
                b.style.background = 'rgba(255,255,255,.05)';
                b.style.color = 'var(--txt)';
                b.style.border = '1px solid var(--line)';
                b.classList.remove('active');
            });
            btn.style.background = 'var(--amber)';
            btn.style.color = '#241d10';
            btn.style.border = 'none';
            btn.classList.add('active');
            
            const filter = btn.dataset.filter;
            currentFilter = filter;
            
            let filteredWeeks;
            if (filter === 'all') {
                filteredWeeks = allWeeks;
            } else {
                const [year, month] = filter.split('-').map(Number);
                filteredWeeks = allWeeks.filter(week => {
                    const { month: wMonth, year: wYear } = getWeekMonth(week.weekKey);
                    return wYear === year && wMonth === month - 1;
                });
            }
            
            contentContainer.innerHTML = buildStatsTable(filteredWeeks, settings, false);
            
            const archiveVisible = modal._archiveVisible || false;
            if (!archiveVisible) {
                const rows = contentContainer.querySelectorAll('.archived-row');
                rows.forEach(row => {
                    row.style.display = 'none';
                });
            }
        });
    });
    
    const toggleBtn = modal.querySelector('#toggleArchiveBtn');
    let archiveVisible = false;
    modal._archiveVisible = archiveVisible;
    
    toggleBtn.addEventListener('click', () => {
        archiveVisible = !archiveVisible;
        modal._archiveVisible = archiveVisible;
        const rows = modal.querySelectorAll('.archived-row');
        rows.forEach(row => {
            row.style.display = archiveVisible ? '' : 'none';
        });
        toggleBtn.textContent = archiveVisible ? '📂 Скрыть архив' : '📂 Показать архив';
        toggleBtn.style.borderColor = archiveVisible ? 'var(--amber)' : 'var(--line)';
    });
    
    modal.querySelector('#closeStatsModal').addEventListener('click', () => {
        modal.remove();
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

function buildStatsTable(weeks, settings, showAll) {
    if (!weeks || weeks.length === 0) {
        return `
            <div style="text-align:center; padding: 40px; color: var(--mut);">
                Нет данных за выбранный период
            </div>
        `;
    }
    
    let totalDays = 0;
    let totalHours = 0;
    let totalPay = 0;
    let totalPaid = 0;
    let visibleCount = 0;
    
    let tableHTML = `
        <div style="overflow-x:auto;">
            <table class="stats-table" id="statsTable">
                <thead>
                    <tr>
                        <th>Неделя</th>
                        <th style="min-width: 120px;">Период</th>
                        <th>Дней</th>
                        <th>Часов</th>
                        <th>Переработка</th>
                        <th style="text-align:right;">Расчёт</th>
                        <th style="text-align:right;">Выплачено</th>
                        <th style="text-align:center;">Детали</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    weeks.forEach((week) => {
        const stats = calculateWeekPay(week, settings);
        const weekNum = getWeekNumber(week.weekKey);
        const dateRange = formatDateRange(week.weekKey);
        const paidAmount = week.paidAmount || 0;
        const isArchived = week.isArchived || false;
        
        if (!isArchived) {
            totalDays += stats.days;
            totalHours += stats.totalHours;
            totalPay += stats.total;
            totalPaid += paidAmount;
            visibleCount++;
        }
        
        const rowClass = isArchived ? 'archived-row' : '';
        const displayStyle = isArchived ? 'style="display: none;"' : '';
        
        tableHTML += `
            <tr class="${rowClass}" data-archived="${isArchived}" ${displayStyle}>
                <td><b>${weekNum}</b></td>
                <td style="font-size: .8rem; color: var(--mut);">${dateRange}</td>
                <td>${stats.days}</td>
                <td>${stats.totalHours} ч</td>
                <td>${stats.ot > 0 ? stats.ot + ' ч' : '—'}</td>
                <td style="text-align:right;"><b>${stats.total.toLocaleString()} ₽</b></td>
                <td style="text-align:right; color: ${paidAmount > 0 ? 'var(--teal)' : 'var(--mut)'};">${paidAmount > 0 ? paidAmount.toLocaleString() + ' ₽' : '—'}</td>
                <td style="text-align:center;">
                    <button onclick="window.showWeekDetails('${week.id}')" 
                            style="background: rgba(255,181,46,.15); border: 1px solid var(--amber); 
                                   color: var(--amber2); padding: 4px 10px; border-radius: 6px; 
                                   cursor: pointer; font-size: .7rem; margin: 2px;">
                        👁️
                    </button>
                    <button onclick="window.toggleArchive('${week.id}', ${isArchived})" 
                            style="background: ${isArchived ? 'rgba(62,207,168,.15)' : 'rgba(255,255,255,.05)'}; 
                                   border: 1px solid ${isArchived ? 'var(--teal)' : 'var(--line)'}; 
                                   color: ${isArchived ? 'var(--teal)' : 'var(--mut)'}; 
                                   padding: 4px 10px; border-radius: 6px; cursor: pointer; font-size: .7rem; margin: 2px;">
                        ${isArchived ? '📤' : '📥'}
                    </button>
                </td>
            </tr>
        `;
    });
    
    tableHTML += `
                <tr style="border-top: 2px solid var(--amber);">
                    <td><b style="color: var(--amber);">📊 ИТОГО</b></td>
                    <td style="font-size: .7rem; color: var(--mut);">${visibleCount} недель</td>
                    <td><b>${totalDays}</b></td>
                    <td><b>${totalHours} ч</b></td>
                    <td>—</td>
                    <td style="text-align:right;"><b style="color: var(--amber); font-size: 1.1rem;">${totalPay.toLocaleString()} ₽</b></td>
                    <td style="text-align:right;"><b style="color: var(--teal); font-size: 1.1rem;">${totalPaid.toLocaleString()} ₽</b></td>
                    <td></td>
                </tr>
    `;
    
    tableHTML += `
                </tbody>
            </table>
        </div>
        <div style="margin-top: 8px; font-size: .7rem; color: var(--mut);">
            💡 Кнопка ${'📥'} — архив (скрыть неделю) · ${'📤'} — восстановить из архива
        </div>
    `;
    
    return tableHTML;
}

// ===== ГЛОБАЛЬНЫЕ ФУНКЦИИ =====
window.toggleArchive = async function(weekId, currentStatus) {
    try {
        const { db, doc, updateDoc } = window;
        await updateDoc(doc(db, 'salaryWeeks', weekId), {
            isArchived: !currentStatus
        });
        const statsData = window._statsData;
        if (statsData) {
            const weekIndex = statsData.weeks.findIndex(w => w.id === weekId);
            if (weekIndex !== -1) {
                statsData.weeks[weekIndex].isArchived = !currentStatus;
            }
            renderStats(
                statsData.employeeId,
                statsData.employeeName,
                db, collection, doc, query, where, getDocs, getDoc,
                window.showNotification || console.log
            );
        }
    } catch (error) {
        console.error('Ошибка переключения архива:', error);
        alert('❌ Ошибка: ' + error.message);
    }
};

window.showWeekDetails = function(weekId) {
    const data = window._statsData;
    if (!data) return;
    const week = data.weeks.find(w => w.id === weekId);
    if (!week) return;
    renderWeekDetailsModal(
        week, 
        data.settings, 
        data.employeeName, 
        week.weekKey, 
        weekId,
        window.db,
        window.doc,
        window.updateDoc,
        window.showNotification || console.log
    );
};

window.updateStatsAfterClear = async function(employeeId) {
    const modal = document.getElementById('statsModal');
    if (modal && modal.classList.contains('active')) {
        const data = window._statsData;
        if (data && data.employeeId === employeeId) {
            await renderStats(
                data.employeeId,
                data.employeeName,
                db, collection, doc, query, where, getDocs, getDoc,
                window.showNotification || console.log
            );
        }
    }
};