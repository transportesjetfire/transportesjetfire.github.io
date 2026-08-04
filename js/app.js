/**
 * app.js - Orquestador y punto de entrada de la aplicación
 */
import { initAuth } from "./auth.js";
import {
    saveEvent,
    deleteEvent,
    subscribeToEvents,
    updateOccurrence,
    deleteOccurrence,
    deleteSeries,
    splitSeries,
    endSeriesBefore,
    computeVisibleEvents
} from "./events.js";
import { MobileCalendar } from "./calendar.js";
import { 
    showToast, 
    showLoader, 
    hideLoader,
    openBottomSheet, 
    closeBottomSheet, 
    openModal, 
    closeModal,
    formatDateLong,
    formatTime12h,
    getDurationText,
    initIcons
} from "./ui.js";

// Estado global de la aplicación
let currentUser = null;
let calendarInstance = null;
let userEvents = []; // Cache local de eventos
let unsubscribeEventsSnap = null;
let currentViewingEvent = null; // Para edición/eliminación
let currentRecurrenceAction = null; // 'edit' | 'delete'
let currentScope = null; // 'this' | 'following' | 'all'

// Elementos del DOM
const fabAddEvent = document.getElementById('fab-add-event');
const eventForm = document.getElementById('event-form');
const eventSheet = document.getElementById('event-sheet');
const eventSheetOverlay = document.getElementById('event-sheet-overlay');
const detailSheet = document.getElementById('detail-sheet');
const detailSheetOverlay = document.getElementById('detail-sheet-overlay');
const confirmModalOverlay = document.getElementById('confirm-modal-overlay');

// Campos de formulario de evento
const eventIdInput = document.getElementById('event-id-input');
const eventTitle = document.getElementById('event-title');
const eventLocation = document.getElementById('event-location');
const eventAllday = document.getElementById('event-allday');
const eventDate = document.getElementById('event-date');
const eventStartTime = document.getElementById('event-starttime');
const eventEndTime = document.getElementById('event-endtime');
const eventRepeat = document.getElementById('event-repeat');
const eventCategory = document.getElementById('event-category');
const eventDescription = document.getElementById('event-description');
const eventReminder = document.getElementById('event-reminder');

// Campos de recurrencia
const repeatEndsContainer = document.getElementById('repeat-ends-container');
const repeatEndDateField = document.getElementById('repeat-end-date-field');
const eventRepeatEndDate = document.getElementById('event-repeat-enddate');

// Bottom sheet de alcance de recurrencia
const scopeSheet = document.getElementById('scope-sheet');
const scopeSheetOverlay = document.getElementById('scope-sheet-overlay');

// Inicialización de la aplicación al cargar
window.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    showLoader();

    // Inicializar Autenticación
    initAuth(
        // Callback de éxito al autenticarse
        (user) => {
            currentUser = user;
            setupAppSession(user);
        },
        // Callback al cerrar sesión
        () => {
            currentUser = null;
            clearAppSession();
        }
    );

    // Inicializar Navegación e Interacción Visual
    setupNavigation();
    setupEventFormListeners();
    setupDetailSheetListeners();
    setupScopeSheetListeners();
    setupSearchListeners();
    setupSidebarListeners();
    setupCategoriesModal();
    
    // Ejecutar creación inicial de iconos
    initIcons();
}

// Configurar sesión activa del usuario
function setupAppSession(user) {
    // Inicializar calendario si aún no existe
    if (!calendarInstance) {
        calendarInstance = new MobileCalendar({
            containerId: 'month-days-grid',
            onEventClick: (event) => {
                showEventDetails(event);
            },
            onDateChange: (dateStr) => {
                // Sincronizar fecha en formulario de creación por defecto
                eventDate.value = dateStr;
            }
        });

        // Configurar por defecto la fecha seleccionada en formulario
        eventDate.value = calendarInstance.selectedDate;
        
        // Vincular controles directos del calendario
        document.getElementById('prev-month-btn').addEventListener('click', () => calendarInstance.prevPeriod());
        document.getElementById('next-month-btn').addEventListener('click', () => calendarInstance.nextPeriod());
        document.getElementById('today-btn').addEventListener('click', () => calendarInstance.goToday());
        
        // Selector de tipo de vista
        const tabs = document.querySelectorAll('.view-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', (e) => {
                tabs.forEach(t => t.classList.remove('active'));
                e.target.classList.add('active');
                calendarInstance.setViewType(e.target.dataset.viewType);
            });
        });
    }

    // Suscribirse a eventos de Firestore
    let isInitialLoad = true;
    console.log('[Agenda] Iniciando suscripción a eventos de Firestore para el UID:', user.uid);
    
    // Timeout de seguridad: Ocultar el loader tras 4 segundos pase lo que pase para evitar bloqueo infinito
    const safetyTimeoutId = setTimeout(() => {
        if (isInitialLoad) {
            console.warn('[Agenda] Timeout de seguridad de carga inicial disparado. Ocultando loader.');
            isInitialLoad = false;
            hideLoader();
            showToast("La carga inicial de eventos está tardando más de lo esperado.", "info");
        }
    }, 4000);

    if (unsubscribeEventsSnap) unsubscribeEventsSnap();
    unsubscribeEventsSnap = subscribeToEvents(user.uid, (events) => {
        console.log('[Agenda] Snapshot recibido de Firestore. Cantidad de eventos:', events.length);
        
        try {
            userEvents = events;
            
            // Alimentar calendario
            if (calendarInstance) {
                calendarInstance.setEvents(events);
            }
            
            // Actualizar listas globales en las otras pestañas
            renderEventsTab();
            renderRemindersTab();
        } catch (err) {
            console.error('[Agenda] Error crítico al procesar o renderizar eventos en la UI:', err);
        } finally {
            // Ocultar el cargador global una vez completada la carga inicial
            if (isInitialLoad) {
                isInitialLoad = false;
                clearTimeout(safetyTimeoutId);
                console.log('[Agenda] Primer snapshot procesado con éxito. Ocultando loader inicial.');
                hideLoader();
            }
        }
    }, (error) => {
        console.error('[Agenda] Error en el canal de comunicación en tiempo real de Firestore:', error);
        if (isInitialLoad) {
            isInitialLoad = false;
            clearTimeout(safetyTimeoutId);
            console.log('[Agenda] Error detectado. Ocultando loader inicial.');
            hideLoader();
        }
        showToast("Error al sincronizar eventos en tiempo real.", "error");
    });
}

// Limpiar sesión al desconectarse
function clearAppSession() {
    if (unsubscribeEventsSnap) {
        unsubscribeEventsSnap();
        unsubscribeEventsSnap = null;
    }
    userEvents = [];
    calendarInstance = null;
}

// Navegación principal (Bottom Nav & Sidebar)
function setupNavigation() {
    const navItems = document.querySelectorAll('.nav-item, .drawer-item');
    const views = document.querySelectorAll('.app-view');

    navItems.forEach(item => {
        item.addEventListener('click', (e) => {
            const targetBtn = e.currentTarget;
            const targetViewId = `view-${targetBtn.dataset.targetView}`;
            
            // Ignorar clics a categorías o configuración directa
            if (!targetBtn.dataset.targetView) return;

            // Actualizar active class en Bottom Nav y Sidebar
            navItems.forEach(n => {
                if (n.dataset.targetView === targetBtn.dataset.targetView) {
                    n.classList.add('active');
                } else {
                    n.classList.remove('active');
                }
            });

            // Cambiar visibilidad de las vistas
            views.forEach(v => {
                if (v.id === targetViewId) {
                    v.classList.remove('hidden');
                } else {
                    v.classList.add('hidden');
                }
            });

            // Cerrar menú lateral en caso de que esté abierto
            closeSidebarDrawer();

            // Ocultar o mostrar FAB según la pestaña
            if (targetBtn.dataset.targetView === 'profile') {
                fabAddEvent.classList.add('hidden');
            } else {
                fabAddEvent.classList.remove('hidden');
            }
        });
    });
}

// Menú Lateral (Sidebar Drawer)
function setupSidebarListeners() {
    const sidebar = document.getElementById('sidebar-drawer');
    const overlay = document.getElementById('sidebar-drawer-overlay');
    const menuToggle = document.getElementById('menu-toggle-btn');
    const closeBtn = document.getElementById('drawer-close-btn');

    const openSidebar = () => {
        overlay.classList.remove('hidden');
        sidebar.classList.remove('hidden');
    };

    const closeSidebar = () => {
        sidebar.classList.add('hidden');
        overlay.classList.add('hidden');
    };

    menuToggle.addEventListener('click', openSidebar);
    closeBtn.addEventListener('click', closeSidebar);
    overlay.addEventListener('click', closeSidebar);

    // Ajustar configuración y ayuda
    document.getElementById('drawer-btn-settings').addEventListener('click', () => {
        closeSidebar();
        showToast("Funcionalidad de configuración estará disponible en la próxima versión móvil.", "info");
    });
    document.getElementById('drawer-btn-help').addEventListener('click', () => {
        closeSidebar();
        showToast("Para soporte escríbenos a soporte@agenda-ade11.firebaseapp.com", "info");
    });
    document.getElementById('btn-settings').addEventListener('click', () => {
        showToast("Funcionalidad de configuración estará disponible en la próxima versión móvil.", "info");
    });
    document.getElementById('btn-help').addEventListener('click', () => {
        showToast("Para soporte escríbenos a soporte@agenda-ade11.firebaseapp.com", "info");
    });
    document.getElementById('btn-edit-profile').addEventListener('click', () => {
        showToast("Opción disponible próximamente en la pestaña Perfil.", "info");
    });
}

function closeSidebarDrawer() {
    const sidebar = document.getElementById('sidebar-drawer');
    const overlay = document.getElementById('sidebar-drawer-overlay');
    if (sidebar) sidebar.classList.add('hidden');
    if (overlay) overlay.classList.add('hidden');
}

// Bottom Sheet de Crear/Editar Evento
function setupEventFormListeners() {
// Abrir formulario para nuevo evento
    fabAddEvent.addEventListener('click', () => {
        // Limpiar formulario y rellenar fecha por defecto
        eventForm.reset();
        eventIdInput.value = '';
        currentViewingEvent = null;
        document.getElementById('sheet-title').textContent = "Nuevo evento";
        
        // Resetear campos de recurrencia
        repeatEndsContainer.classList.add('hidden');
        repeatEndDateField.classList.add('hidden');
        const neverRadio = document.querySelector('input[name="repeatEnds"][value="never"]');
        if (neverRadio) neverRadio.checked = true;
        eventRepeatEndDate.value = '';
        currentRecurrenceAction = null;
        currentScope = null;
        
        // Re-sincronizar fecha
        if (calendarInstance) {
            eventDate.value = calendarInstance.selectedDate;
        } else {
            eventDate.value = new Date().toISOString().split('T')[0];
        }

        // Mostrar u ocultar campos de hora por defecto
        toggleTimeFields(false);
        openBottomSheet('event-sheet', 'event-sheet-overlay');
    });

    // Cancelar
    document.getElementById('sheet-cancel-btn').addEventListener('click', (e) => {
        e.preventDefault();
        closeBottomSheet('event-sheet', 'event-sheet-overlay');
    });

    eventSheetOverlay.addEventListener('click', () => {
        closeBottomSheet('event-sheet', 'event-sheet-overlay');
    });

// Guardar
    document.getElementById('sheet-save-btn').addEventListener('click', async (e) => {
        e.preventDefault();
        
        if (!eventTitle.value.trim()) {
            showToast("Por favor, introduce un título.", "error");
            eventTitle.focus();
            return;
        }

        if (!eventDate.value) {
            showToast("Por favor, introduce una fecha.", "error");
            eventDate.focus();
            return;
        }

        const selectedColorEl = document.querySelector('input[name="event-color"]:checked');
        const colorVal = selectedColorEl ? selectedColorEl.value : '#6366F1';

        // Leer opción de fin de recurrencia
        const repeatEndsRadio = document.querySelector('input[name="repeatEnds"]:checked');
        const repeatEnds = repeatEndsRadio ? repeatEndsRadio.value : 'never';
        const repeatEndDate = repeatEnds === 'date' ? eventRepeatEndDate.value : null;

        const data = {
            id: eventIdInput.value,
            title: eventTitle.value,
            location: eventLocation.value,
            allDay: eventAllday.checked,
            date: eventDate.value,
            startTime: eventStartTime.value,
            endTime: eventEndTime.value,
            repeat: eventRepeat.value,
            repeatEnds,
            repeatEndDate,
            category: eventCategory.value,
            color: colorVal,
            description: eventDescription.value,
            reminder: eventReminder.value
        };

        // UI de carga local en el botón
        const saveBtn = document.getElementById('sheet-save-btn');
        const originalText = saveBtn.textContent;
        saveBtn.textContent = data.id ? "Guardando..." : "Creando...";
        saveBtn.disabled = true;

        try {
            // Determinar si es una edición de ocurrencia recurrente
            const ev = currentViewingEvent;
            const isRecurringEdit = ev && ev.seriesId && currentRecurrenceAction === 'edit';

            if (isRecurringEdit) {
                // Edición de una ocurrencia de serie
                if (currentScope === 'this') {
                    // Solo esta ocurrencia: crear/actualizar excepción
                    await updateOccurrence(currentViewingEvent, data, currentUser.uid);
                } else if (currentScope === 'following') {
                    // Este y los siguientes: dividir la serie
                    await splitSeries(ev.seriesId, ev.date, data, currentUser.uid);
                } else {
                    // Toda la serie: actualizar el documento maestro
                    await saveEvent(data, currentUser.uid);
                }
            } else {
                // Crear o editar normal (o editar serie completa)
                await saveEvent(data, currentUser.uid);
            }

            closeBottomSheet('event-sheet', 'event-sheet-overlay');
            closeBottomSheet('detail-sheet', 'detail-sheet-overlay');
            currentViewingEvent = null;
            const isUpdate = !!data.id || isRecurringEdit;
            showToast(isUpdate ? "Evento actualizado correctamente" : "Evento creado correctamente", "success");
        } catch (error) {
            console.error("Error al guardar evento:", error);
            showToast("Error al guardar el evento.", "error");
        } finally {
            saveBtn.textContent = originalText;
            saveBtn.disabled = false;
            currentRecurrenceAction = null;
            currentScope = null;
        }
    });

    // Manejar toggle de "Todo el día"
    eventAllday.addEventListener('change', (e) => {
        toggleTimeFields(e.target.checked);
    });

    // Manejar visibilidad del campo de fin de recurrencia
    eventRepeat.addEventListener('change', (e) => {
        if (e.target.value !== 'none') {
            repeatEndsContainer.classList.remove('hidden');
        } else {
            repeatEndsContainer.classList.add('hidden');
        }
    });

    // Manejar radio buttons de fin de recurrencia
    document.querySelectorAll('input[name="repeatEnds"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            if (e.target.value === 'date') {
                repeatEndDateField.classList.remove('hidden');
            } else {
                repeatEndDateField.classList.add('hidden');
            }
        });
    });

    // Evitar que el formulario se envíe por defecto (recargando la página si se pulsa Enter)
    eventForm.addEventListener('submit', (e) => {
        e.preventDefault();
    });
}

function toggleTimeFields(isAllDay) {
    const timeFields = document.querySelectorAll('.time-fields');
    timeFields.forEach(el => {
        if (isAllDay) {
            el.classList.add('hidden');
        } else {
            el.classList.remove('hidden');
        }
    });
}

// Abrir el formulario de evento precargado para editar
function openEventFormForEdit(ev) {
    // Si es una ocurrencia base sintética (no un documento real), no pasar id real.
    // Al guardar, updateOccurrence creará una excepción nueva sin id.
    const isSyntheticOccurrence = !!ev.isOccurrence;
    eventIdInput.value = isSyntheticOccurrence ? '' : (ev.id || '');
    eventTitle.value = ev.title;
    eventLocation.value = ev.location || '';
    eventAllday.checked = !!ev.allDay;
    eventDate.value = ev.date;
    eventStartTime.value = ev.startTime || '09:00';
    eventEndTime.value = ev.endTime || '10:00';
    eventRepeat.value = ev.repeat || 'none';
    eventCategory.value = ev.category || 'Otros';
    eventDescription.value = ev.description || '';
    eventReminder.value = ev.reminder || 'none';

    // Precargar fin de recurrencia
    const isSeries = ev.repeat && ev.repeat !== 'none';
    if (isSeries) {
        repeatEndsContainer.classList.remove('hidden');
        const endsRadio = ev.repeatEnds === 'date'
            ? document.querySelector('input[name="repeatEnds"][value="date"]')
            : document.querySelector('input[name="repeatEnds"][value="never"]');
        if (endsRadio) endsRadio.checked = true;
        if (ev.repeatEnds === 'date' && ev.repeatEndDate) {
            repeatEndDateField.classList.remove('hidden');
            eventRepeatEndDate.value = ev.repeatEndDate;
        } else {
            repeatEndDateField.classList.add('hidden');
            eventRepeatEndDate.value = '';
        }
    } else {
        repeatEndsContainer.classList.add('hidden');
        repeatEndDateField.classList.add('hidden');
    }

    // Seleccionar color en radio buttons
    const colorRadio = document.querySelector(`input[name="event-color"][value="${ev.color}"]`);
    if (colorRadio) {
        colorRadio.checked = true;
    }

    toggleTimeFields(!!ev.allDay);
    document.getElementById('sheet-title').textContent = "Editar evento";
    openBottomSheet('event-sheet', 'event-sheet-overlay');
}

// ==========================================
// ALCANCE DE RECURRENCIA (editar / eliminar)
// ==========================================

/** Abre el bottom sheet de alcance para recurrencias. action: 'edit' | 'delete' */
function openScopeSheet(action) {
    currentRecurrenceAction = action;
    currentScope = null;

    const titleEl = document.getElementById('scope-sheet-title');
    const descEl = document.getElementById('scope-sheet-desc');
    const thisOptSub = document.querySelector('#scope-this-event .scope-option-sub');
    const followingOptSub = document.querySelector('#scope-this-and-following .scope-option-sub');
    const allOptSub = document.querySelector('#scope-all-series .scope-option-sub');

    if (action === 'delete') {
        titleEl.textContent = 'Eliminar evento recurrente';
        descEl.textContent = 'Este evento pertenece a una serie. ¿Qué deseas eliminar?';
        if (thisOptSub) thisOptSub.textContent = 'Elimina solo esta ocurrencia. El resto no cambia.';
        if (followingOptSub) followingOptSub.textContent = 'Elimina esta y todas las ocurrencias posteriores.';
        if (allOptSub) allOptSub.textContent = 'Elimina todas las ocurrencias de la serie.';
    } else {
        titleEl.textContent = 'Editar evento recurrente';
        descEl.textContent = 'Este evento pertenece a una serie. ¿Qué deseas editar?';
        if (thisOptSub) thisOptSub.textContent = 'Edita solo esta ocurrencia. El resto no cambia.';
        if (followingOptSub) followingOptSub.textContent = 'Edita esta y todas las ocurrencias posteriores.';
        if (allOptSub) allOptSub.textContent = 'Edita todas las ocurrencias de la serie.';
    }

    openBottomSheet('scope-sheet', 'scope-sheet-overlay');
    initIcons();
}

function closeScopeSheet() {
    closeBottomSheet('scope-sheet', 'scope-sheet-overlay');
    currentRecurrenceAction = null;
    currentScope = null;
}

// Listeners del bottom sheet de alcance
function setupScopeSheetListeners() {
    // Cancelar
    document.getElementById('scope-cancel-btn').addEventListener('click', () => {
        closeScopeSheet();
    });
    scopeSheetOverlay.addEventListener('click', () => {
        closeScopeSheet();
    });

    // Editar / Eliminar solo esta ocurrencia
    document.getElementById('scope-this-event').addEventListener('click', async () => {
        if (!currentViewingEvent) return;
        currentScope = 'this';

        if (currentRecurrenceAction === 'edit') {
            closeScopeSheet();
            openEventFormForEdit(currentViewingEvent);
            return;
        }

        // Eliminar solo esta ocurrencia
        const btn = document.getElementById('scope-this-event');
        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>Eliminando...</span>';
        try {
            await deleteOccurrence(currentViewingEvent, currentUser.uid);
            closeScopeSheet();
            closeBottomSheet('detail-sheet', 'detail-sheet-overlay');
            currentViewingEvent = null;
            showToast("Ocurrencia eliminada correctamente.", "success");
        } catch (error) {
            console.error("Error al eliminar ocurrencia:", error);
            showToast("No se pudo eliminar la ocurrencia.", "error");
            closeScopeSheet();
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });

    // Este evento y los siguientes
    document.getElementById('scope-this-and-following').addEventListener('click', async () => {
        if (!currentViewingEvent) return;
        currentScope = 'following';
        const ev = currentViewingEvent;

        if (currentRecurrenceAction === 'edit') {
            closeScopeSheet();
            openEventFormForEdit(ev);
            return;
        }

        // Eliminar este y los siguientes
        const btn = document.getElementById('scope-this-and-following');
        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>Eliminando...</span>';
        try {
            await endSeriesBefore(ev.seriesId, ev.date, currentUser.uid);
            closeScopeSheet();
            closeBottomSheet('detail-sheet', 'detail-sheet-overlay');
            currentViewingEvent = null;
            showToast("Serie terminada a partir de esta ocurrencia.", "success");
        } catch (error) {
            console.error("Error al terminar la serie:", error);
            showToast("No se pudo terminar la serie.", "error");
            closeScopeSheet();
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });

    // Toda la serie
    document.getElementById('scope-all-series').addEventListener('click', async () => {
        if (!currentViewingEvent) return;
        currentScope = 'all';
        const ev = currentViewingEvent;

        if (currentRecurrenceAction === 'edit') {
            closeScopeSheet();
            // Editar toda la serie: abrir el formulario con el ID de la serie maestra
            const masterEvent = userEvents.find(e => e.id === ev.seriesId) || ev;
            openEventFormForEdit(masterEvent);
            return;
        }

        // Eliminar toda la serie
        const btn = document.getElementById('scope-all-series');
        btn.disabled = true;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span>Eliminando...</span>';
        try {
            await deleteSeries(ev.seriesId, currentUser.uid);
            closeScopeSheet();
            closeBottomSheet('detail-sheet', 'detail-sheet-overlay');
            currentViewingEvent = null;
            showToast("Serie eliminada correctamente.", "success");
        } catch (error) {
            console.error("Error al eliminar serie:", error);
            showToast("No se pudo eliminar la serie.", "error");
            closeScopeSheet();
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHTML;
        }
    });
}

// Bottom Sheet de Detalles de Evento
function setupDetailSheetListeners() {
    const closeBtn = document.getElementById('detail-close-btn');
    const editBtn = document.getElementById('detail-edit-btn');
    const deleteBtn = document.getElementById('detail-delete-btn');
    
    // Cerrar detalle
    closeBtn.addEventListener('click', () => {
        closeBottomSheet('detail-sheet', 'detail-sheet-overlay');
    });
    detailSheetOverlay.addEventListener('click', () => {
        closeBottomSheet('detail-sheet', 'detail-sheet-overlay');
    });

// Editar evento
    editBtn.addEventListener('click', () => {
        if (!currentViewingEvent) return;

        // Si pertenece a una serie recurrente, preguntar el alcance
        if (currentViewingEvent.seriesId) {
            openScopeSheet('edit');
            return;
        }

        // Evento normal: editar directamente
        openEventFormForEdit(currentViewingEvent);
    });

// Eliminar evento (abrir modal de confirmación o alcance de recurrencia)
    deleteBtn.addEventListener('click', () => {
        if (currentViewingEvent && currentViewingEvent.seriesId) {
            openScopeSheet('delete');
            return;
        }
        openModal('confirm-modal-overlay');
    });

    // Manejar confirmación de eliminación
    document.getElementById('confirm-cancel-btn').addEventListener('click', () => {
        closeModal('confirm-modal-overlay');
    });
    
    document.getElementById('confirm-delete-btn').addEventListener('click', async () => {
        if (!currentViewingEvent) return;
        
        const deleteBtn = document.getElementById('confirm-delete-btn');
        const cancelBtn = document.getElementById('confirm-cancel-btn');
        const originalText = deleteBtn.textContent;
        
        deleteBtn.textContent = "Eliminando...";
        deleteBtn.disabled = true;
        cancelBtn.disabled = true;
        
        try {
            await deleteEvent(currentViewingEvent.id);
            closeModal('confirm-modal-overlay');
            closeBottomSheet('detail-sheet', 'detail-sheet-overlay');
            showToast("Evento eliminado correctamente.", "success");
            currentViewingEvent = null;
        } catch (error) {
            console.error("Error al eliminar evento:", error);
            showToast("No se pudo eliminar el evento.", "error");
        } finally {
            deleteBtn.textContent = originalText;
            deleteBtn.disabled = false;
            cancelBtn.disabled = false;
        }
    });
}

// Cargar y mostrar la información del evento seleccionado
function showEventDetails(event) {
    currentViewingEvent = event;

    document.getElementById('detail-title').textContent = event.title;
    
    // Indicador de color
    const colorInd = document.getElementById('detail-color-indicator');
    colorInd.style.backgroundColor = event.color || '#6366F1';
    
    // Fecha y duración
    document.getElementById('detail-date').textContent = formatDateLong(event.date);
    
    if (event.allDay) {
        document.getElementById('detail-time').textContent = 'Todo el día';
        document.getElementById('detail-duration').textContent = '24 horas';
    } else {
        document.getElementById('detail-time').textContent = `${formatTime12h(event.startTime)} - ${formatTime12h(event.endTime)}`;
        document.getElementById('detail-duration').textContent = getDurationText(event.startTime, event.endTime);
    }

    // Ubicación
    const locRow = document.getElementById('detail-location-row');
    if (event.location) {
        locRow.classList.remove('hidden');
        document.getElementById('detail-location').textContent = event.location;
    } else {
        locRow.classList.add('hidden');
    }

    // Categoría
    const catRow = document.getElementById('detail-category-row');
    if (event.category) {
        catRow.classList.remove('hidden');
        document.getElementById('detail-category').textContent = event.category;
    } else {
        catRow.classList.add('hidden');
    }

    // Recordatorio
    const remRow = document.getElementById('detail-reminder-row');
    if (event.reminder && event.reminder !== 'none') {
        remRow.classList.remove('hidden');
        const remVal = event.reminder;
        let text = 'Al momento del evento';
        if (remVal === '5') text = '5 minutos antes';
        if (remVal === '15') text = '15 minutos antes';
        if (remVal === '30') text = '30 minutos antes';
        if (remVal === '60') text = '1 hora antes';
        if (remVal === '1440') text = '1 día antes';
        document.getElementById('detail-reminder').textContent = text;
    } else {
        remRow.classList.add('hidden');
    }

    // Repetición
    const repRow = document.getElementById('detail-repeat-row');
    if (event.repeat && event.repeat !== 'none') {
        repRow.classList.remove('hidden');
        let text = 'Nunca';
        if (event.repeat === 'daily') text = 'Todos los días';
        if (event.repeat === 'weekly') text = 'Todas las semanas';
        if (event.repeat === 'monthly') text = 'Todos los meses';
        document.getElementById('detail-repeat').textContent = text;
    } else {
        repRow.classList.add('hidden');
    }

    // Descripción
    const descRow = document.getElementById('detail-desc-row');
    if (event.description) {
        descRow.classList.remove('hidden');
        document.getElementById('detail-description').textContent = event.description;
    } else {
        descRow.classList.add('hidden');
    }

    openBottomSheet('detail-sheet', 'detail-sheet-overlay');
    initIcons();
}

// ==========================================
// RENDERIZADOS DE SECCIONES EXTRAS
// ==========================================

/** Obtiene YYYY-MM-DD local actual usando método UTC-safe. */
function getTodayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/** Obtiene un rango amplio de fechas (pasado y futuro) para expandir series. */
function getWideRange() {
    const today = getTodayISO();
    // Desde 1 año atrás hasta 2 años en el futuro
    const start = new Date();
    start.setFullYear(start.getFullYear() - 1);
    const end = new Date();
    end.setFullYear(end.getFullYear() + 2);
    const s = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')}`;
    const e = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
    return [s, e];
}

// Renderizar eventos próximos en la pestaña "Eventos"
function renderEventsTab() {
    const listEl = document.getElementById('global-events-list');
    if (!listEl) return;

    if (userEvents.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <i data-lucide="calendar"></i>
                <p>No tienes eventos configurados en tu agenda.</p>
            </div>
        `;
        initIcons();
        return;
    }

    // Expandir series y aplicar excepciones para un rango amplio
    const [rangeStart, rangeEnd] = getWideRange();
    const visibleEvents = computeVisibleEvents(userEvents, rangeStart, rangeEnd);

    // Filtrar eventos a partir de hoy (inclusive)
    const todayStr = getTodayISO();
    const upcomingEvents = visibleEvents.filter(e => e.date >= todayStr);

    if (upcomingEvents.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <i data-lucide="check-circle-2"></i>
                <p>No tienes eventos próximos programados.</p>
            </div>
        `;
        initIcons();
        return;
    }

    listEl.innerHTML = '';

    // Agruparlos por fecha
    const grouped = {};
    upcomingEvents.forEach(e => {
        if (!grouped[e.date]) {
            grouped[e.date] = [];
        }
        grouped[e.date].push(e);
    });

    // Renderizar agrupados por fecha
    Object.keys(grouped).sort().forEach(dateStr => {
        const dateEvents = grouped[dateStr];

        const dateHeader = document.createElement('div');
        dateHeader.className = 'agenda-group-header';
        dateHeader.textContent = formatDateLong(dateStr);
        listEl.appendChild(dateHeader);

        dateEvents.forEach(event => {
            const card = createSimpleEventCard(event);
            listEl.appendChild(card);
        });
    });

    initIcons();
}

// Renderizar eventos con recordatorio configurado en la pestaña "Recordatorios"
function renderRemindersTab() {
    const listEl = document.getElementById('reminders-events-list');
    if (!listEl) return;

    if (userEvents.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <i data-lucide="bell-off"></i>
                <p>No tienes alertas o recordatorios programados en tus eventos.</p>
            </div>
        `;
        initIcons();
        return;
    }

    const [rangeStart, rangeEnd] = getWideRange();
    const visibleEvents = computeVisibleEvents(userEvents, rangeStart, rangeEnd);

    // Filtrar eventos que tengan recordatorio configurado
    const reminderEvents = visibleEvents.filter(e => e.reminder && e.reminder !== 'none');

    if (reminderEvents.length === 0) {
        listEl.innerHTML = `
            <div class="empty-state">
                <i data-lucide="bell-off"></i>
                <p>No tienes alertas o recordatorios programados en tus eventos.</p>
            </div>
        `;
        initIcons();
        return;
    }

    listEl.innerHTML = '';

    // Agruparlos cronológicamente por fecha
    const grouped = {};
    reminderEvents.forEach(e => {
        if (!grouped[e.date]) {
            grouped[e.date] = [];
        }
        grouped[e.date].push(e);
    });

    Object.keys(grouped).sort().forEach(dateStr => {
        const dateEvents = grouped[dateStr];

        const dateHeader = document.createElement('div');
        dateHeader.className = 'agenda-group-header';
        dateHeader.textContent = formatDateLong(dateStr);
        listEl.appendChild(dateHeader);

        dateEvents.forEach(event => {
            const card = createSimpleEventCard(event, true);
            listEl.appendChild(card);
        });
    });

    initIcons();
}

// Genera una tarjeta de evento reutilizable y elegante
function createSimpleEventCard(event, showReminderLabel = false) {
    const card = document.createElement('div');
    card.className = 'event-card';
    card.style.borderLeftColor = event.color || '#6366F1';

    let reminderText = '';
    if (showReminderLabel) {
        let text = 'Al momento';
        if (event.reminder === '5') text = 'Alerta 5 min antes';
        if (event.reminder === '15') text = 'Alerta 15 min antes';
        if (event.reminder === '30') text = 'Alerta 30 min antes';
        if (event.reminder === '60') text = 'Alerta 1 hora antes';
        if (event.reminder === '1440') text = 'Alerta 1 día antes';
        reminderText = `
            <div class="event-card-location" style="color: var(--warning); margin-top: 4px;">
                <i data-lucide="bell"></i>
                <span>${text}</span>
            </div>
        `;
    }

    const locHTML = event.location ? `
        <div class="event-card-location">
            <i data-lucide="map-pin"></i>
            <span>${event.location}</span>
        </div>
    ` : '';

    card.innerHTML = `
        <div class="event-card-time">
            <span class="time-start">${event.allDay ? 'Todo el día' : formatTime12h(event.startTime)}</span>
            <span class="time-end">${event.allDay ? '' : formatTime12h(event.endTime)}</span>
        </div>
        <div class="event-card-content">
            <h4 class="event-card-title">${event.title}</h4>
            <div class="event-card-category">
                <span class="event-dot" style="background-color: ${event.color || '#6366F1'};"></span>
                <span>${event.category || 'Otros'}</span>
            </div>
            ${locHTML}
            ${reminderText}
        </div>
    `;

    card.addEventListener('click', () => {
        showEventDetails(event);
    });

    return card;
}

// Búsqueda de eventos integrada en el header
function setupSearchListeners() {
    const searchToggleBtn = document.getElementById('search-toggle-btn');
    const searchCloseBtn = document.getElementById('search-close-btn');
    const searchBarContainer = document.getElementById('search-bar-container');
    const searchInput = document.getElementById('search-input');

    searchToggleBtn.addEventListener('click', () => {
        searchBarContainer.classList.remove('hidden');
        searchInput.focus();
    });

    const closeSearch = () => {
        searchBarContainer.classList.add('hidden');
        searchInput.value = '';
        
        // Restaurar listas originales
        if (calendarInstance) {
            calendarInstance.setEvents(userEvents);
        }
        renderEventsTab();
    };

    searchCloseBtn.addEventListener('click', closeSearch);

    // Búsqueda dinámica al escribir (Debounce sencillo)
    searchInput.addEventListener('input', (e) => {
        const query = e.target.value.trim().toLowerCase();
        
        if (!query) {
            // Si está vacío, restaurar
            if (calendarInstance) calendarInstance.setEvents(userEvents);
            renderEventsTab();
            return;
        }

        // Filtrar localmente en el cache de eventos
        const filtered = userEvents.filter(event => {
            return (event.title && event.title.toLowerCase().includes(query)) ||
                   (event.description && event.description.toLowerCase().includes(query)) ||
                   (event.location && event.location.toLowerCase().includes(query)) ||
                   (event.category && event.category.toLowerCase().includes(query));
        });

        // Actualizar visualizaciones con los eventos filtrados
        if (calendarInstance) {
            calendarInstance.setEvents(filtered);
        }

        // Si estamos en la vista de lista de eventos o si buscamos de forma general, actualizar la lista
        const listEl = document.getElementById('global-events-list');
        if (listEl) {
            listEl.innerHTML = '';
            if (filtered.length === 0) {
                listEl.innerHTML = `
                    <div class="empty-state">
                        <i data-lucide="search-code"></i>
                        <p>No se encontraron eventos coincidentes.</p>
                    </div>
                `;
            } else {
                filtered.forEach(event => {
                    const card = createSimpleEventCard(event);
                    listEl.appendChild(card);
                });
            }
            initIcons();
        }
    });
}

// Modal de gestión de categorías sencillas
function setupCategoriesModal() {
    const modal = document.getElementById('categories-modal-overlay');
    const closeBtn = document.getElementById('categories-close-btn');

    const openCatModal = () => {
        openModal('categories-modal-overlay');
    };

    const closeCatModal = () => {
        closeModal('categories-modal-overlay');
    };

    document.getElementById('btn-categories').addEventListener('click', openCatModal);
    document.getElementById('drawer-btn-categories').addEventListener('click', openCatModal);
    closeBtn.addEventListener('click', closeCatModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeCatModal();
    });
}
