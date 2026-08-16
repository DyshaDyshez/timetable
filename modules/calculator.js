// modules/calculator.js
// Единый модуль для всех расчетов зарплаты

/**
 * Расчет зарплаты за неделю
 * @param {Object} weekData - данные недели { workDays, hours }
 * @param {Object} settings - настройки { rDay, rExtra, rOt1, rOt2, hpd, otLimit }
 * @returns {Object} - детальный расчет
 */
export function calculateWeekPay(weekData, settings = {}) {
    const workDays = weekData.workDays || [true, true, true, true, true, false, false];
    const hours = weekData.hours || [8, 8, 8, 8, 8, 0, 0];
    
    const rD = settings.rDay || 3000;
    const rE = settings.rExtra || 3500;
    const r1 = settings.rOt1 || 400;
    const r2 = settings.rOt2 || 800;
    const hpd = settings.hpd || 8;
    const lim = settings.otLimit || 5;
    
    const days = workDays.filter(Boolean).length;
    const totalHours = hours.reduce((a, b) => a + b, 0);
    const norm = days * hpd;
    const ot = Math.max(0, totalHours - norm);
    const ot1 = Math.min(ot, lim);
    const ot2 = Math.max(0, ot - lim);
    
    let payBase = 0;
    let payExtra = 0;
    
    for (let i = 0; i < workDays.length; i++) {
        if (!workDays[i]) continue;
        const dayHours = hours[i] || 0;
        const dayIndex = workDays.slice(0, i).filter(Boolean).length;
        const isExtraDay = dayIndex >= 5;
        const dayRate = isExtraDay ? rE : rD;
        const dayPay = Math.min(dayRate, (dayHours / hpd) * dayRate);
        if (isExtraDay) {
            payExtra += dayPay;
        } else {
            payBase += dayPay;
        }
    }
    
    const payOt1 = ot1 * r1;
    const payOt2 = ot2 * r2;
    const total = payBase + payExtra + payOt1 + payOt2;
    
    return {
        days,
        totalHours,
        norm,
        ot,
        ot1,
        ot2,
        payBase,
        payExtra,
        payOt1,
        payOt2,
        total,
        workDays,
        hours
    };
}

/**
 * Получить сумму к выплате с учётом погашенных авансов
 * @param {Object} weekData - данные недели (с полем repaidAmount)
 * @param {Object} settings - настройки
 * @returns {Object} - результат с полем finalPay
 */
export function getFinalPay(weekData, settings = {}) {
    const stats = calculateWeekPay(weekData, settings);
    const repaidAmount = weekData.repaidAmount || 0;
    return {
        ...stats,
        repaidAmount,
        finalPay: stats.total - repaidAmount
    };
}