// modules/deductions.js
// Единый список сотрудников с вычетом 20% + утилиты.
// Флаг "убрать вычет" хранится в salarySettings/<id>.deductionDisabled === true

export const DEDUCTION_EMPLOYEES = [
    'UD6ZrvVxPkm4CmKGWDiX', '69bXsB9wPyUjffVUuLFN', 'Ko5LMP5SQKGfFoB4yIx7',
    'U4x9Kr0bpfdx7naoulpM', 'nbBjsOTTSRIO6aBsslAN', 'ZflATZ6egxRkx5fhpJ5o',
    'NitjpMhCI9HqnjU1vyva', 'Uw59jW8WV5IehKtJ3ZnG', '4Wl858egRyTOWKRABwJn',
    'YaEeq4w5xFN2xLB3UcrS', 'IjqWMErzDg5Vrq4WRy57',
    'U4ph0Kduj2KJUPF0eCC4', 'Es8V40MRBaxZpFCSmK0j',
    // сюда добавляй новые ID через запятую:
    // 'Es8V40MRBaxZpFCSmK0j',
];

export const DEDUCTION_RATE = 0.2;

/** Применяется ли вычет к сотруднику (с учётом флага отключения) */
export function hasDeduction(employeeId, settings = null) {
    if (!DEDUCTION_EMPLOYEES.includes(employeeId)) return false;
    if (settings && settings.deductionDisabled === true) return false;
    return true;
}

/** Сумма к выплате (net) с учётом вычета */
export function applyDeduction(gross, employeeId, settings = null) {
    if (!hasDeduction(employeeId, settings)) return gross;
    return gross * (1 - DEDUCTION_RATE);
}
