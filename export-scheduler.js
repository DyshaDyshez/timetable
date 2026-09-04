// export-scheduler.js
// Экспорт текущей недели в Bitrix24 и Google Sheets

import { getFirestore, collection, getDocs, doc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { calculateWeekPay } from './modules/calculator.js';
import { buildWeekDataFromAttendance } from './modules/attendance.js';
import { syncToGoogle } from './google-sync.js';

let db = null;

export function initExporter(firebaseApp) {
    db = getFirestore(firebaseApp);
}

function getWeekKey(date) {
    const d = new Date(date);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 864e5 + 1) / 7);
    return `${y}-W${String(week).padStart(2, '0')}`;
}

function getWeekDates(offset) {
    const today = new Date();
    const dayOfWeek = today.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - daysToMonday + offset * 7);
    monday.setHours(0, 0, 0, 0);
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        dates.push(d);
    }
    return dates;
}

function formatDateShort(d) {
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
}

async function getEmployeeSettings(employeeId) {
    if (!db) return { rDay: 3000, rExtra: 3500, rOt1: 400, rOt2: 800, otLimit: 5, hpd: 8 };
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
                otLimit: data.otLimit || 5,
                hpd: data.hpd || 8
            };
        }
    } catch (e) {
        console.warn('Settings load error:', e);
    }
    return { rDay: 3000, rExtra: 3500, rOt1: 400, rOt2: 800, otLimit: 5, hpd: 8 };
}

function getWeekRange(offset) {
    const dates = getWeekDates(offset);
    const start = dates[0];
    const end = dates[6];
    const weekKey = getWeekKey(start);
    return { start, end, weekKey, dates };
}

/**
 * Экспортирует отчёт за текущую неделю во все настроенные сервисы
 */
export async function exportWeeklyReport() {
    if (!db) {
        console.error('Exporter not initialized');
        return { success: false, error: 'Exporter not initialized' };
    }

    try {
        const { start, end, weekKey, dates } = getWeekRange(0);
        const dateRange = `${formatDateShort(start)} – ${formatDateShort(end)}`;

        // Получаем всех сотрудников
        const employeesSnap = await getDocs(collection(db, 'salaryEmployees'));
        const employees = [];
        employeesSnap.forEach(doc => employees.push({ id: doc.id, ...doc.data() }));

        // Получаем все недели
        const weeksSnap = await getDocs(collection(db, 'salaryWeeks'));
        const allWeeks = {};
        weeksSnap.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.weekKey;
            allWeeks[key] = { id: doc.id, ...data };
        });

        // Получаем все отметки для построения данных, если нет в salaryWeeks
        const attSnap = await getDocs(collection(db, 'attendance'));
        const allAttendance = {};
        attSnap.forEach(doc => {
            const data = doc.data();
            const key = data.employeeId + '_' + data.date;
            if (!allAttendance[key]) allAttendance[key] = [];
            allAttendance[key].push({ id: doc.id, ...data });
        });

        // Собираем отчёт
        const reportData = [];
        let totalSalary = 0;
        let totalDebt = 0;
        let totalEmployees = 0;

        for (const emp of employees) {
            let weekData = allWeeks[emp.id + '_' + weekKey];
            let fromAttendance = false;

            if (!weekData) {
                const attData = buildWeekDataFromAttendance(emp.id, dates, allAttendance);
                if (attData.fromAttendance) {
                    weekData = attData;
                    fromAttendance = true;
                }
            }

            if (!weekData) continue;

            const settings = await getEmployeeSettings(emp.id);
            const stats = calculateWeekPay(weekData, settings);

            let displaySalary = stats.total;
            let displayHours = stats.totalHours;
            let displayDays = stats.days;
            let displayOt = stats.ot;

            // Учитываем фиксированную зарплату, если есть
            if (weekData.fixedSalary !== undefined && weekData.fixedSalary !== null) {
                displaySalary = weekData.fixedSalary;
                if (weekData.fixedHours !== undefined) displayHours = weekData.fixedHours;
                if (weekData.fixedDays !== undefined) displayDays = weekData.fixedDays;
                if (weekData.fixedOt !== undefined) displayOt = weekData.fixedOt;
                fromAttendance = true;
            }

            // Получаем активные авансы
            const advancesRef = collection(db, 'salaryAdvances');
            const q = query(advancesRef, where('employeeId', '==', emp.id), where('status', '==', 'active'));
            const advSnap = await getDocs(q);
            let debt = 0;
            advSnap.forEach(doc => debt += doc.data().amount || 0);

            reportData.push({
                name: emp.name || 'Без имени',
                weekRange: dateRange,
                days: displayDays,
                totalHours: displayHours,
                overtime: displayOt,
                salary: displaySalary,
                debt: debt,
                fromAttendance: fromAttendance
            });

            totalSalary += displaySalary;
            totalDebt += debt;
            totalEmployees++;
        }

        if (reportData.length === 0) {
            return { success: false, error: 'Нет данных для экспорта' };
        }

        // 1. Отправка в Bitrix24
        const bitrixResult = await sendToBitrix(reportData, dateRange, totalSalary, totalDebt, totalEmployees);

        // 2. Отправка в Google Sheets (если настроено)
        const googleResult = await syncToGoogle({
            action: 'weeklyReport',
            weekKey: weekKey,
            dateRange: dateRange,
            employees: reportData,
            totalSalary: totalSalary,
            totalDebt: totalDebt,
            totalEmployees: totalEmployees,
            timestamp: new Date().toISOString()
        });

        return {
            success: true,
            bitrix: bitrixResult,
            google: googleResult,
            exported: reportData.length
        };
    } catch (error) {
        console.error('Export error:', error);
        return { success: false, error: error.message };
    }
}

async function sendToBitrix(reportData, dateRange, totalSalary, totalDebt, totalEmployees) {
    try {
        const bitrixRef = doc(db, 'settings', 'bitrix24');
        const bitrixSnap = await getDoc(bitrixRef);
        if (!bitrixSnap.exists()) {
            return { success: false, error: 'Bitrix24 настройки не найдены' };
        }
        const { webhook, chatId = 'chat1104' } = bitrixSnap.data();
        if (!webhook) {
            return { success: false, error: 'Bitrix24 вебхук не указан' };
        }

        let message = `📊 **ОТЧЁТ ЗА НЕДЕЛЮ**\n`;
        message += `📅 ${dateRange}\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

        reportData.forEach((emp, index) => {
            const sourceLabel = emp.fromAttendance ? ' (из отметок)' : '';
            message += `👤 **${emp.name}**${sourceLabel}\n`;
            message += `• Дней: ${emp.days}\n`;
            message += `• Часов: ${emp.totalHours.toFixed(2)} ч\n`;
            if (emp.overtime > 0) message += `• Переработка: ${emp.overtime.toFixed(2)} ч\n`;
            message += `• Зарплата: ${emp.salary.toLocaleString()} ₽\n`;
            if (emp.debt > 0) message += `• Долг: ${emp.debt.toLocaleString()} ₽\n`;
            if (index < reportData.length - 1) message += `\n`;
        });

        message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `📊 **ИТОГО:**\n`;
        message += `• Сотрудников: ${totalEmployees}\n`;
        message += `• Общая зарплата: ${totalSalary.toLocaleString()} ₽\n`;
        if (totalDebt > 0) message += `• Общий долг: ${totalDebt.toLocaleString()} ₽\n`;
        message += `\n🔗 Отчёт сгенерирован автоматически`;

        const url = webhook + 'im.message.add';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                DIALOG_ID: chatId,
                MESSAGE: message
            })
        });

        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        return { success: true, result };
    } catch (error) {
        console.error('Bitrix send error:', error);
        return { success: false, error: error.message };
    }
}