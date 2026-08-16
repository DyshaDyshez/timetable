// google-sync.js
// Синхронизация с Google Sheets через Apps Script

// Вставьте сюда ваш URL из шага 4
const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzDle4KzDw0GrbLpcuUQueMYvTltos0usBuqWrgYOst09fHlWflRyxKuuws3znGlUZShA/exec';

/**
 * Отправка данных в Google Sheets
 */
export async function syncToGoogle(data) {
    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            mode: 'no-cors', // Важно для GAS
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });
        
        // При mode: 'no-cors' ответ пустой, но данные отправляются
        console.log('✅ Данные отправлены в Google Sheets');
        return { success: true };
        
    } catch (error) {
        console.error('❌ Ошибка отправки:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Синхронизация всех сотрудников
 */
export async function syncEmployees(employees) {
    return syncToGoogle({
        action: 'syncEmployees',
        employees: employees
    });
}

/**
 * Синхронизация всех недель
 */
export async function syncWeeks(weeks) {
    return syncToGoogle({
        action: 'syncWeeks',
        weeks: weeks
    });
}

/**
 * Синхронизация всех авансов
 */
export async function syncAdvances(advances) {
    return syncToGoogle({
        action: 'syncAdvances',
        advances: advances
    });
}

/**
 * Полный бэкап сотрудника
 */
export async function backupEmployee(employeeId, weeks) {
    return syncToGoogle({
        action: 'backupComplete',
        employeeId: employeeId,
        weeks: weeks
    });
}

/**
 * Синхронизация всего (все данные)
 */
export async function syncAll(employees, weeks, advances) {
    return syncToGoogle({
        action: 'syncAll',
        employees: employees,
        weeks: weeks,
        advances: advances
    });
}