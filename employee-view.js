async function sendBitrixSalaryRequestNotification({ employeeName, finalPay, weekRange }) {
    try {
        // Получаем настройки Битрикса из Firebase
        const bitrixRef = doc(db, 'settings', 'bitrix24');
        const bitrixSnap = await getDoc(bitrixRef);

        if (!bitrixSnap.exists()) {
            console.warn('❌ Настройки Битрикс24 не найдены');
            return;
        }

        const bitrixData = bitrixSnap.data();
        const webhook = bitrixData.webhook;
        const chatId = bitrixData.chatId || 'chat1104';

        if (!webhook) {
            console.warn('❌ Вебхук Битрикс24 не указан');
            return;
        }

        // Формируем сообщение
        const message = `[URL=${dashboardUrl}][ЗАПРОС ЗП][/URL]\n` +
            `👤 [URL=${employeeUrl}]${employeeName}[/URL]\n` +
            `📅 ${weekRange}\n` +
            `💵 ${finalPay.toLocaleString()} ₽`\n` +
            `📅 Период: ${weekRange}`;

        // Отправляем
        const url = webhook + 'im.message.add.json';
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                DIALOG_ID: chatId,
                MESSAGE: message
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();

        if (result.error) {
            throw new Error(result.error_description || result.error);
        }

        console.log('✅ Уведомление о запросе ЗП отправлено в Битрикс24');
    } catch (error) {
        console.error('❌ Ошибка отправки в Битрикс24:', error);
        throw error;
    }
}
