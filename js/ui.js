/**
 * ui.js - Manejo de la Interfaz de Usuario y Animaciones
 */

// Toast notifications
export function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'error') iconName = 'alert-triangle';

    toast.innerHTML = `
        <i data-lucide="${iconName}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    // Inicializar icono de Lucide en el toast
    if (window.lucide) {
        window.lucide.createIcons();
    }

    // Animación de entrada
    setTimeout(() => {
        toast.classList.add('show');
    }, 50);

    // Salida y remoción
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 3000);
}

// Global Loaders
export function showLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.remove('hidden');
}

export function hideLoader() {
    const loader = document.getElementById('global-loader');
    if (loader) loader.classList.add('hidden');
}

// Bottom Sheets Control (con soporte para animaciones de desvanecimiento)
export function openBottomSheet(sheetId, overlayId) {
    const sheet = document.getElementById(sheetId);
    const overlay = document.getElementById(overlayId);
    
    if (sheet && overlay) {
        overlay.classList.remove('hidden');
        sheet.classList.remove('hidden');
        // Pequeño timeout para permitir que la animación CSS se ejecute
        setTimeout(() => {
            sheet.style.transform = 'translateY(0)';
        }, 10);
    }
}

export function closeBottomSheet(sheetId, overlayId) {
    const sheet = document.getElementById(sheetId);
    const overlay = document.getElementById(overlayId);
    
    if (sheet && overlay) {
        sheet.style.transform = 'translateY(100%)';
        setTimeout(() => {
            sheet.classList.add('hidden');
            overlay.classList.add('hidden');
        }, 300); // Duración de la transición CSS
    }
}

// Modales de Confirmación / Simple
export function openModal(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.classList.remove('hidden');
    }
}

export function closeModal(overlayId) {
    const overlay = document.getElementById(overlayId);
    if (overlay) {
        overlay.classList.add('hidden');
    }
}

// Formateadores de fecha y hora
export function formatDateLong(dateStr) {
    if (!dateStr) return '';
    // Corregir offset de zona horaria al instanciar Date
    const date = new Date(dateStr + 'T00:00:00');
    const options = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    const formatted = date.toLocaleDateString('es-ES', options);
    // Capitalizar primera letra
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

export function formatTime12h(timeStr) {
    if (!timeStr) return '';
    const [hoursStr, minutesStr] = timeStr.split(':');
    let hours = parseInt(hoursStr, 10);
    const minutes = minutesStr;
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12; // el número 0 debe ser 12
    return `${hours}:${minutes} ${ampm}`;
}

export function getDurationText(startTime, endTime) {
    if (!startTime || !endTime) return '';
    const [startH, startM] = startTime.split(':').map(Number);
    const [endH, endM] = endTime.split(':').map(Number);
    
    let totalMinutes = (endH * 60 + endM) - (startH * 60 + startM);
    if (totalMinutes < 0) {
        // Asume evento que pasa a la siguiente jornada
        totalMinutes += 24 * 60;
    }
    
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    
    let result = '';
    if (hours > 0) {
        result += `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
    }
    if (minutes > 0) {
        if (result) result += ' y ';
        result += `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
    }
    return result || '0 minutos';
}

// Inicializar iconos Lucide globalmente
export function initIcons() {
    if (window.lucide) {
        window.lucide.createIcons();
    }
}
