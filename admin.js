// admin.js

import { firebaseConfig } from './config.js';
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { 
    getFirestore, 
    collection, doc, getDocs, addDoc, updateDoc, deleteDoc, 
    query, where, onSnapshot, getDoc 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { 
    getAuth, 
    signInWithEmailAndPassword, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// Импорт модуля аудита
import { initAudit, logAction } from './modules/audit.js';

// Инициализация
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
initAudit(app); // инициализируем аудит

let currentUser = null;

// ============================================
// АВТОРИЗАЦИЯ
// ============================================
onAuthStateChanged(auth, (user) => {
    if (user) {
        currentUser = user;
        const authScreen = document.getElementById('authScreen');
        const adminContent = document.getElementById('adminContent');
        const userEmail = document.getElementById('userEmail');
        
        if (authScreen) {
            authScreen.classList.remove('active');
            authScreen.style.display = 'none';
        }
        if (adminContent) {
            adminContent.style.display = 'block';
        }
        if (userEmail) {
            userEmail.textContent = '👤 ' + user.email;
        }
        loadEmployees();
    } else {
        const authScreen = document.getElementById('authScreen');
        const adminContent = document.getElementById('adminContent');
        
        if (authScreen) {
            authScreen.classList.add('active');
            authScreen.style.display = 'block';
        }
        if (adminContent) {
            adminContent.style.display = 'none';
        }
    }
});

// Логин
const loginBtn = document.getElementById('loginBtn');
if (loginBtn) {
    loginBtn.addEventListener('click', async () => {
        const email = document.getElementById('loginEmail');
        const password = document.getElementById('loginPassword');
        const errorEl = document.getElementById('loginError');
        
        if (!email || !password) return;
        
        try {
            await signInWithEmailAndPassword(auth, email.value, password.value);
            if (errorEl) errorEl.textContent = '';
            showNotification('✅ Вход выполнен');
            // Логируем вход
            await logAction('adminLogin', { email: email.value });
        } catch (error) {
            if (errorEl) errorEl.textContent = '❌ ' + error.message;
        }
    });
}

// Выход
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth);
        // Логируем выход
        logAction('adminLogout', {});
    });
}

// ============================================
// ЗАГРУЗКА СОТРУДНИКОВ
// ============================================
function loadEmployees() {
    const employeesRef = collection(db, 'salaryEmployees');
    onSnapshot(employeesRef, (snapshot) => {
        const container = document.getElementById('employeeList');
        if (!container) return;
        
        container.innerHTML = '';
        if (snapshot.empty) {
            container.innerHTML = '<div class="loading">Нет сотрудников. Добавьте первого!</div>';
            return;
        }
        
        snapshot.forEach((doc) => {
            const emp = { id: doc.id, ...doc.data() };
            const baseUrl = window.location.origin + window.location.pathname.replace(/\/[^\/]*$/, '/');
            const employeeLink = baseUrl + 'employee.html?id=' + emp.id;

            const card = document.createElement('div');
            card.className = 'employee-card';
            card.innerHTML = `
                <div>
                    <div class="emp-name">${emp.name || 'Без имени'}</div>
                    <div class="emp-phone">📱 ${emp.phone || 'Нет телефона'}</div>
                </div>
                <div class="emp-pin">
                    <span style="font-size:.7rem; color:var(--mut);">PIN:</span>
                    <span class="pin-display" id="pinDisplay_${emp.id}">${emp.pin || '—'}</span>
                    <input type="text" class="pin-edit-input" id="pinEdit_${emp.id}" value="${emp.pin || ''}" style="display:none;" maxlength="6" inputmode="numeric">
                    <button class="pin-btn" id="pinEditBtn_${emp.id}" data-id="${emp.id}" title="Редактировать PIN">✏️</button>
                    <button class="pin-btn generate" id="pinGenerateBtn_${emp.id}" data-id="${emp.id}" title="Сгенерировать PIN">🎲</button>
                    <button class="pin-btn save" id="pinSaveBtn_${emp.id}" data-id="${emp.id}" style="display:none;" title="Сохранить">💾</button>
                </div>
                <div class="emp-actions">
                    <button class="btn-copy-link" data-link="${employeeLink}">📋 Ссылка</button>
                    <button class="btn-stats" onclick="window.showStats('${emp.id}', '${emp.name}')">📈 Статистика</button>
                    <button class="btn-delete" onclick="window.deleteEmployee('${emp.id}')">🗑️</button>
                </div>
                <div class="link-hint">${employeeLink}</div>
            `;
            container.appendChild(card);

            // Обработчики PIN
            const editBtn = card.querySelector(`#pinEditBtn_${emp.id}`);
            const generateBtn = card.querySelector(`#pinGenerateBtn_${emp.id}`);
            const saveBtn = card.querySelector(`#pinSaveBtn_${emp.id}`);
            const display = card.querySelector(`#pinDisplay_${emp.id}`);
            const input = card.querySelector(`#pinEdit_${emp.id}`);

            if (editBtn) {
                editBtn.addEventListener('click', () => {
                    if (display) display.style.display = 'none';
                    if (input) {
                        input.style.display = 'inline-block';
                        input.value = emp.pin || '';
                        input.focus();
                    }
                    editBtn.style.display = 'none';
                    if (saveBtn) saveBtn.style.display = 'inline-block';
                });
            }

            if (generateBtn) {
                generateBtn.addEventListener('click', async () => {
                    const newPin = generatePin();
                    await updateEmployeePin(emp.id, newPin);
                    if (display) display.textContent = newPin;
                    emp.pin = newPin;
                    showNotification('✅ PIN обновлён');
                    // Логируем генерацию PIN
                    await logAction('generatePin', { employeeId: emp.id, newPin });
                });
            }

            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    if (!input) return;
                    const newPin = input.value.trim();
                    if (!newPin || newPin.length < 3) {
                        showNotification('❌ PIN должен содержать минимум 3 символа', true);
                        return;
                    }
                    await updateEmployeePin(emp.id, newPin);
                    if (display) {
                        display.textContent = newPin;
                        display.style.display = 'inline-block';
                    }
                    emp.pin = newPin;
                    input.style.display = 'none';
                    if (editBtn) editBtn.style.display = 'inline-block';
                    saveBtn.style.display = 'none';
                    showNotification('✅ PIN сохранён');
                    // Логируем ручное изменение PIN
                    await logAction('editPin', { employeeId: emp.id, newPin });
                });
            }

            const copyBtn = card.querySelector('.btn-copy-link');
            if (copyBtn) {
                copyBtn.addEventListener('click', function() {
                    copyToClipboard(this.dataset.link, this);
                });
            }
        });
    });
}

// ============================================
// PIN ФУНКЦИИ
// ============================================
function generatePin() {
    return String(Math.floor(100 + Math.random() * 900));
}

async function updateEmployeePin(employeeId, pin) {
    try {
        await updateDoc(doc(db, 'salaryEmployees', employeeId), { pin: pin });
        // Логируем обновление PIN (вызывается из генерации и сохранения)
        // Само логирование будет в вызывающих функциях, но на всякий случай можно и здесь оставить
        return true;
    } catch (error) {
        console.error('Ошибка обновления PIN:', error);
        showNotification('❌ Ошибка: ' + error.message, true);
        return false;
    }
}

// ============================================
// ГЕНЕРАЦИЯ PIN ДЛЯ ВСЕХ
// ============================================
const generateAllPinsBtn = document.getElementById('generateAllPinsBtn');
if (generateAllPinsBtn) {
    generateAllPinsBtn.addEventListener('click', async () => {
        const btn = document.getElementById('generateAllPinsBtn');
        if (!btn) return;
        
        btn.disabled = true;
        btn.textContent = '⏳ ...';

        try {
            const snapshot = await getDocs(collection(db, 'salaryEmployees'));
            const missingPin = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                if (!data.pin) {
                    missingPin.push({ id: doc.id, name: data.name });
                }
            });

            if (missingPin.length === 0) {
                showNotification('✅ У всех сотрудников уже есть PIN');
                btn.disabled = false;
                btn.textContent = '🔢 PIN для всех';
                return;
            }

            if (!confirm(`Найдено ${missingPin.length} сотрудников без PIN. Сгенерировать для них PIN?\n\n${missingPin.map(e => e.name).join(', ')}`)) {
                btn.disabled = false;
                btn.textContent = '🔢 PIN для всех';
                return;
            }

            let updated = 0;
            for (const emp of missingPin) {
                const newPin = generatePin();
                await updateEmployeePin(emp.id, newPin);
                updated++;
                // Логируем каждую генерацию
                await logAction('generatePinForAll', { employeeId: emp.id, name: emp.name, newPin });
            }

            showNotification(`✅ Сгенерировано PIN для ${updated} сотрудников`);
        } catch (error) {
            showNotification('❌ Ошибка: ' + error.message, true);
        } finally {
            btn.disabled = false;
            btn.textContent = '🔢 PIN для всех';
        }
    });
}

// ============================================
// ДОБАВЛЕНИЕ СОТРУДНИКА
// ============================================
const addBtn = document.getElementById('addBtn');
if (addBtn) {
    addBtn.addEventListener('click', async () => {
        const nameInput = document.getElementById('empName');
        const phoneInput = document.getElementById('empPhone');
        
        if (!nameInput || !phoneInput) return;
        
        const name = nameInput.value.trim();
        const phone = phoneInput.value.trim();

        if (!name || !phone) {
            showNotification('❌ Заполните все поля!', true);
            return;
        }
        if (!auth.currentUser) {
            showNotification('❌ Вы не авторизованы!', true);
            return;
        }

        addBtn.disabled = true;
        addBtn.textContent = '⏳ ...';

        try {
            const newPin = generatePin();
            const docRef = await addDoc(collection(db, 'salaryEmployees'), {
                name: name,
                phone: phone,
                pin: newPin,
                createdAt: new Date().toISOString(),
                adminId: auth.currentUser.uid,
                adminEmail: auth.currentUser.email
            });
            nameInput.value = '';
            phoneInput.value = '';
            showNotification(`✅ Сотрудник добавлен! PIN: ${newPin}`);
            // Логируем добавление
            await logAction('addEmployee', { 
                employeeId: docRef.id, 
                name, 
                phone, 
                pin: newPin,
                adminId: auth.currentUser.uid,
                adminEmail: auth.currentUser.email
            });
        } catch (error) {
            showNotification('❌ Ошибка: ' + error.message, true);
        } finally {
            addBtn.disabled = false;
            addBtn.textContent = '➕ Добавить';
        }
    });
}

// ============================================
// УДАЛЕНИЕ СОТРУДНИКА
// ============================================
window.deleteEmployee = async (id) => {
    if (!confirm('🗑️ Удалить сотрудника и все его данные?')) return;
    try {
        // Получаем данные сотрудника для логирования
        const empRef = doc(db, 'salaryEmployees', id);
        const empSnap = await getDoc(empRef);
        const empData = empSnap.exists() ? empSnap.data() : null;
        const empName = empData ? empData.name : id;

        // Удаляем недели
        const q = query(collection(db, 'salaryWeeks'), where('employeeId', '==', id));
        const weeksSnap = await getDocs(q);
        for (const doc of weeksSnap.docs) await deleteDoc(doc.ref);

        // Удаляем авансы
        const q2 = query(collection(db, 'salaryAdvances'), where('employeeId', '==', id));
        const advSnap = await getDocs(q2);
        for (const doc of advSnap.docs) await deleteDoc(doc.ref);

        // Удаляем отметки
        const q3 = query(collection(db, 'attendance'), where('employeeId', '==', id));
        const attSnap = await getDocs(q3);
        for (const doc of attSnap.docs) await deleteDoc(doc.ref);

        // Удаляем настройки
        const settingsRef = doc(db, 'salarySettings', id);
        await deleteDoc(settingsRef).catch(() => {});

        // Удаляем долг компании
        const debtRef = doc(db, 'companyDebt', id);
        await deleteDoc(debtRef).catch(() => {});

        // Удаляем самого сотрудника
        await deleteDoc(empRef);

        showNotification('🗑️ Удалено');
        // Логируем удаление
        await logAction('deleteEmployee', { 
            employeeId: id, 
            name: empName,
            deletedWeeks: weeksSnap.size,
            deletedAdvances: advSnap.size,
            deletedAttendance: attSnap.size
        });
    } catch (error) {
        showNotification('❌ Ошибка: ' + error.message, true);
    }
};

// ============================================
// СТАТИСТИКА (заглушка)
// ============================================
window.showStats = (employeeId, employeeName) => {
    showNotification(`📊 Статистика для ${employeeName} (в разработке)`);
};

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================
function showNotification(message, isError = false) {
    const el = document.getElementById('notification');
    if (!el) return;
    el.textContent = message;
    el.className = 'notification show';
    if (isError) el.classList.add('error');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('show'), 3000);
}

async function copyToClipboard(text, btnElement) {
    try {
        await navigator.clipboard.writeText(text);
        const original = btnElement.textContent;
        btnElement.textContent = '✅ Скопировано!';
        setTimeout(() => btnElement.textContent = original, 2000);
        showNotification('✅ Ссылка скопирована');
    } catch (e) {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        const original = btnElement.textContent;
        btnElement.textContent = '✅ Скопировано!';
        setTimeout(() => btnElement.textContent = original, 2000);
        showNotification('✅ Ссылка скопирована');
    }
}

console.log('✅ Админ-панель загружена');