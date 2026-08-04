/**
 * calendar.js - Lógica matemática del calendario y renderizado de vistas
 */
import { formatDateLong, formatTime12h, getDurationText, initIcons } from "./ui.js";
import { computeVisibleEvents } from "./events.js";

export class MobileCalendar {
    constructor(config) {
        this.containerId = config.containerId;
        this.onEventClick = config.onEventClick;
        this.onDateChange = config.onDateChange;
        
// Estado inicial
        this.currentDate = new Date(); // Mes en curso
        this.selectedDate = this.formatDateISO(new Date()); // Día seleccionado YYYY-MM-DD
        this.events = []; // Lista completa de eventos crudos
        this.rawEvents = []; // Alias de eventos crudos
        this.activeView = 'month'; // month, week, day, agenda
        
        this.initDOMElements();
    }

    initDOMElements() {
        this.monthNameDisplay = document.getElementById('calendar-month-name');
        this.monthDaysGrid = document.getElementById('month-days-grid');
        this.selectedDayTitle = document.getElementById('selected-day-title');
        this.selectedDayEventsList = document.getElementById('selected-day-events-list');
        
        // Subvistas
        this.monthViewEl = document.getElementById('calendar-month-view');
        this.weekViewEl = document.getElementById('calendar-week-view');
        this.dayViewEl = document.getElementById('calendar-day-view');
        this.agendaViewEl = document.getElementById('calendar-agenda-view');
    }

setEvents(events) {
        // Almacenar los eventos crudos (normales + series + excepciones)
        this.rawEvents = events || [];
        this.render();
    }

    /**
     * Calcula los eventos visibles para un rango de fechas [start, end],
     * expandiendo series y aplicando excepciones (sin duplicados).
     */
    getEventsForRange(startDate, endDate) {
        const raw = this.rawEvents || this.events || [];
        return computeVisibleEvents(raw, startDate, endDate);
    }

    setViewType(viewType) {
        this.activeView = viewType;
        
        // Alternar visibilidad de contenedores
        this.monthViewEl.classList.add('hidden');
        this.weekViewEl.classList.add('hidden');
        this.dayViewEl.classList.add('hidden');
        this.agendaViewEl.classList.add('hidden');
        
        if (viewType === 'month') this.monthViewEl.classList.remove('hidden');
        if (viewType === 'week') this.weekViewEl.classList.remove('hidden');
        if (viewType === 'day') this.dayViewEl.classList.remove('hidden');
        if (viewType === 'agenda') this.agendaViewEl.classList.remove('hidden');
        
        this.render();
    }

    prevPeriod() {
        if (this.activeView === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() - 1);
        } else if (this.activeView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() - 7);
        } else if (this.activeView === 'day') {
            this.currentDate.setDate(this.currentDate.getDate() - 1);
            this.selectedDate = this.formatDateISO(this.currentDate);
        }
        this.render();
    }

    nextPeriod() {
        if (this.activeView === 'month') {
            this.currentDate.setMonth(this.currentDate.getMonth() + 1);
        } else if (this.activeView === 'week') {
            this.currentDate.setDate(this.currentDate.getDate() + 7);
        } else if (this.activeView === 'day') {
            this.currentDate.setDate(this.currentDate.getDate() + 1);
            this.selectedDate = this.formatDateISO(this.currentDate);
        }
        this.render();
    }

    goToday() {
        const today = new Date();
        this.currentDate = new Date(today);
        this.selectedDate = this.formatDateISO(today);
        this.render();
    }

    // Formatear Date a YYYY-MM-DD local
    formatDateISO(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    render() {
        this.updateHeader();
        
        if (this.activeView === 'month') {
            this.renderMonthView();
        } else if (this.activeView === 'week') {
            this.renderWeekView();
        } else if (this.activeView === 'day') {
            this.renderDayView();
        } else if (this.activeView === 'agenda') {
            this.renderAgendaView();
        }
        
        initIcons();
    }

    updateHeader() {
        const options = { month: 'long', year: 'numeric' };
        let displayDate = this.currentDate;
        
        if (this.activeView === 'day') {
            displayDate = new Date(this.selectedDate + 'T00:00:00');
        }
        
        let title = displayDate.toLocaleDateString('es-ES', options);
        // Capitalizar mes
        title = title.charAt(0).toUpperCase() + title.slice(1);
        this.monthNameDisplay.textContent = title;
    }

    // ==========================================
    // OBTENER RANGO VISIBLE
    // ==========================================
    /** Devuelve la fecha inicial del rango visible actual según la vista. */
    getViewRangeStart() {
        if (this.activeView === 'day') {
            return this.selectedDate;
        }
        if (this.activeView === 'week') {
            const startOfWeek = this.getWeekStartDate();
            return this.formatDateISO(startOfWeek);
        }
        // month / agenda
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const firstDayOfMonth = new Date(year, month, 1);
        let startDayIndex = firstDayOfMonth.getDay() - 1;
        if (startDayIndex < 0) startDayIndex = 6;
        const startDate = firstDayOfMonth;
        startDate.setDate(startDate.getDate() - startDayIndex);
        return this.formatDateISO(startDate);
    }

    /** Devuelve la fecha final del rango visible actual según la vista. */
    getViewRangeEnd() {
        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();
        const totalDaysInMonth = new Date(year, month + 1, 0).getDate();
        const firstDayOfMonth = new Date(year, month, 1);
        let startDayIndex = firstDayOfMonth.getDay() - 1;
        if (startDayIndex < 0) startDayIndex = 6;
        const totalCells = startDayIndex + totalDaysInMonth;
        const remainingCells = (totalCells % 7 === 0) ? 0 : 7 - (totalCells % 7);
        const endDate = new Date(year, month, totalDaysInMonth + remainingCells);
        return this.formatDateISO(endDate);
    }

    // ==========================================
    // RENDERIZADO VISTA MES
    // ==========================================
    renderMonthView() {
        this.monthDaysGrid.innerHTML = '';

        const rangeStart = this.getViewRangeStart();
        const rangeEnd = this.getViewRangeEnd();
        const monthEvents = this.getEventsForRange(rangeStart, rangeEnd);

        const year = this.currentDate.getFullYear();
        const month = this.currentDate.getMonth();

        // Obtener primer día del mes (ajustado para Lunes = 0)
        const firstDayOfMonth = new Date(year, month, 1);
        let startDayIndex = firstDayOfMonth.getDay() - 1;
        if (startDayIndex < 0) startDayIndex = 6;

        // Total días del mes
        const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

        // Total días del mes anterior
        const totalDaysInPrevMonth = new Date(year, month, 0).getDate();

        const todayStr = this.formatDateISO(new Date());

        // 1. Días del mes anterior (relleno)
        for (let i = startDayIndex - 1; i >= 0; i--) {
            const dayNum = totalDaysInPrevMonth - i;
            const prevMonthDate = new Date(year, month - 1, dayNum);
            const dateISO = this.formatDateISO(prevMonthDate);
            const dayEvts = monthEvents.filter(e => e.date === dateISO);
            this.monthDaysGrid.appendChild(this.createDayCell(dayNum, dateISO, true, todayStr, dayEvts));
        }

        // 2. Días del mes actual
        for (let dayNum = 1; dayNum <= totalDaysInMonth; dayNum++) {
            const dateISO = this.formatDateISO(new Date(year, month, dayNum));
            const dayEvts = monthEvents.filter(e => e.date === dateISO);
            this.monthDaysGrid.appendChild(this.createDayCell(dayNum, dateISO, false, todayStr, dayEvts));
        }

        // 3. Días del mes siguiente (relleno)
        const totalCells = startDayIndex + totalDaysInMonth;
        const remainingCells = (totalCells % 7 === 0) ? 0 : 7 - (totalCells % 7);
        for (let dayNum = 1; dayNum <= remainingCells; dayNum++) {
            const nextMonthDate = new Date(year, month + 1, dayNum);
            const dateISO = this.formatDateISO(nextMonthDate);
            const dayEvts = monthEvents.filter(e => e.date === dateISO);
            this.monthDaysGrid.appendChild(this.createDayCell(dayNum, dateISO, true, todayStr, dayEvts));
        }

        // Renderizar eventos del día seleccionado debajo
        this.renderSelectedDayEvents();
    }

    createDayCell(dayNum, dateISO, isOtherMonth, todayStr, dayEvents) {
        const cell = document.createElement('div');
        cell.className = 'day-cell';
        if (isOtherMonth) cell.classList.add('other-month');
        if (dateISO === todayStr) cell.classList.add('today');
        if (dateISO === this.selectedDate) cell.classList.add('selected');

        cell.innerHTML = `<span>${dayNum}</span>`;

        // Dot indicators para eventos
        if (dayEvents && dayEvents.length > 0) {
            const dotsContainer = document.createElement('div');
            dotsContainer.className = 'day-events-dots';

            dayEvents.slice(0, 3).forEach(event => {
                const dot = document.createElement('span');
                dot.className = 'event-dot';
                dot.style.backgroundColor = event.color || '#6366F1';
                dotsContainer.appendChild(dot);
            });
            cell.appendChild(dotsContainer);
        }

        // Tap handler
        cell.addEventListener('click', () => {
            this.selectedDate = dateISO;
            const cellDate = new Date(dateISO + 'T00:00:00');
            if (cellDate.getMonth() !== this.currentDate.getMonth()) {
                this.currentDate = new Date(cellDate.getFullYear(), cellDate.getMonth(), 1);
            }
            if (this.onDateChange) this.onDateChange(dateISO);
            this.render();
        });

        return cell;
    }

    renderSelectedDayEvents() {
        this.selectedDayTitle.textContent = formatDateLong(this.selectedDate);

        const rangeStart = this.getViewRangeStart();
        const rangeEnd = this.getViewRangeEnd();
        const monthEvents = this.getEventsForRange(rangeStart, rangeEnd);
        const dayEvents = monthEvents.filter(e => e.date === this.selectedDate);
        this.renderEventsListToContainer(dayEvents, this.selectedDayEventsList);
    }

    getWeekStartDate() {
        const startOfWeek = new Date(this.currentDate);
        const day = startOfWeek.getDay();
        const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
        startOfWeek.setDate(diff);
        return startOfWeek;
    }

    // ==========================================
    // RENDERIZADO VISTA SEMANA
    // ==========================================
    renderWeekView() {
        const startOfWeek = this.getWeekStartDate();
        const weekStartStr = this.formatDateISO(startOfWeek);
        const weekEnd = new Date(startOfWeek);
        weekEnd.setDate(startOfWeek.getDate() + 6);
        const weekEndStr = this.formatDateISO(weekEnd);

        const weekDaysStrip = this.weekViewEl.querySelector('.week-days-strip');
        weekDaysStrip.innerHTML = '';

        const weekdaysNames = ['LUN', 'MAR', 'MIÉ', 'JUE', 'VIE', 'SÁ', 'DOM'];
        const todayStr = this.formatDateISO(new Date());
        const weekEvents = this.getEventsForRange(weekStartStr, weekEndStr);

        // Generar tira de 7 días
        for (let i = 0; i < 7; i++) {
            const currentDay = new Date(startOfWeek);
            currentDay.setDate(startOfWeek.getDate() + i);
            const dateISO = this.formatDateISO(currentDay);

            const dayEvents = weekEvents.filter(e => e.date === dateISO);

            const pill = document.createElement('div');
            pill.className = 'week-day-pill';
            if (dateISO === todayStr) pill.classList.add('today');
            if (dateISO === this.selectedDate) pill.classList.add('active');

            // Dots para días con eventos en vista semanal
            let dotsHTML = '';
            if (dayEvents.length > 0) {
                dotsHTML = `<div class="day-events-dots" style="position: relative; bottom: 0; margin-top: 4px; width: 100%; display: flex; justify-content: center; gap: 2px;">`;
                dayEvents.slice(0, 3).forEach(event => {
                    dotsHTML += `<span class="event-dot" style="background-color: ${event.color || '#6366F1'}; width: 4px; height: 4px; border-radius: 50%;"></span>`;
                });
                dotsHTML += `</div>`;
            }

            pill.innerHTML = `
                <span class="week-day-pill-name">${weekdaysNames[i]}</span>
                <span class="week-day-pill-num">${currentDay.getDate()}</span>
                ${dotsHTML}
            `;

            pill.addEventListener('click', () => {
                this.selectedDate = dateISO;
                this.currentDate = new Date(currentDay);
                if (this.onDateChange) this.onDateChange(dateISO);
                this.render();
            });

            weekDaysStrip.appendChild(pill);
        }

        // Renderizar eventos de la semana
        const weekEventsList = document.getElementById('week-events-list');
        const selectedDayEvents = weekEvents.filter(e => e.date === this.selectedDate);

        const weekSectionTitle = this.weekViewEl.querySelector('.week-events-timeline');
        let titleEl = weekSectionTitle.querySelector('h3');
        if (!titleEl) {
            titleEl = document.createElement('h3');
            titleEl.className = 'section-subtitle';
            weekSectionTitle.insertBefore(titleEl, weekEventsList);
        }
        titleEl.textContent = `Eventos del ${formatDateLong(this.selectedDate)}`;

        this.renderEventsListToContainer(selectedDayEvents, weekEventsList);
    }

    // ==========================================
    // RENDERIZADO VISTA DÍA (Horario)
    // ==========================================
    renderDayView() {
        const dayHoursGrid = document.getElementById('day-hours-grid');
        dayHoursGrid.innerHTML = '';

        // Obtener eventos del día seleccionado
        const dayEvents = this.getEventsForRange(this.selectedDate, this.selectedDate);
        const dayEventsFiltered = dayEvents.filter(e => e.date === this.selectedDate);
        
        // Horas para mostrar (de 7:00 a 22:00 por ejemplo, o las 24 horas)
        for (let h = 0; h < 24; h++) {
            const hourBlock = document.createElement('div');
            hourBlock.className = 'hour-block';
            
            const ampm = h >= 12 ? 'PM' : 'AM';
            const displayHour = h % 12 === 0 ? 12 : h % 12;
            const timeKey = String(h).padStart(2, '0') + ':00';

            const label = document.createElement('div');
            label.className = 'hour-label';
            label.textContent = `${displayHour} ${ampm}`;
            hourBlock.appendChild(label);

            const eventsArea = document.createElement('div');
            eventsArea.className = 'hour-events-area';
            
            // Buscar eventos que comiencen en esta hora
            const matchingEvents = dayEventsFiltered.filter(e => {
                const startHour = e.startTime.split(':')[0];
                return parseInt(startHour, 10) === h;
            });

            if (matchingEvents.length > 0) {
                matchingEvents.forEach(event => {
                    const evCard = document.createElement('div');
                    evCard.className = 'timeline-event-card';
                    evCard.style.borderLeftColor = event.color || '#6366F1';
                    // Convertir color hexadecimal a fondo rgba suave
                    const hex = event.color || '#6366F1';
                    evCard.style.backgroundColor = `${hex}1A`; // 1A es ~10% de opacidad

                    evCard.innerHTML = `
                        <div class="timeline-event-card-title">${event.title}</div>
                        <div class="timeline-event-card-time">${formatTime12h(event.startTime)} - ${formatTime12h(event.endTime)}</div>
                    `;

                    evCard.addEventListener('click', () => {
                        if (this.onEventClick) this.onEventClick(event);
                    });

                    eventsArea.appendChild(evCard);
                });
            }

            hourBlock.appendChild(eventsArea);
            dayHoursGrid.appendChild(hourBlock);
        }
    }

    // ==========================================
    // RENDERIZADO VISTA AGENDA
    // ==========================================
    renderAgendaView() {
        const agendaEventsList = document.getElementById('agenda-events-list');
        agendaEventsList.innerHTML = '';

        // Rango generoso: desde 1 año atrás hasta 1 año en el futuro
        const today = new Date();
        const startDate = new Date(today);
        startDate.setFullYear(today.getFullYear() - 1);
        const endDate = new Date(today);
        endDate.setFullYear(today.getFullYear() + 1);
        const rangeStartStr = this.formatDateISO(startDate);
        const rangeEndStr = this.formatDateISO(endDate);

        const visibleEvents = this.getEventsForRange(rangeStartStr, rangeEndStr);

        if (visibleEvents.length === 0) {
            agendaEventsList.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="calendar-x"></i>
                    <p>No tienes eventos agendados.</p>
                </div>
            `;
            return;
        }

        // Agrupar eventos por fecha
        const grouped = {};
        visibleEvents.forEach(e => {
            if (e.date && !grouped[e.date]) {
                grouped[e.date] = [];
            }
            if (e.date) grouped[e.date].push(e);
        });

        // Generar listado agrupado
        Object.keys(grouped).sort().forEach(dateStr => {
            const dateEvents = grouped[dateStr];

            const groupHeader = document.createElement('div');
            groupHeader.className = 'agenda-group-header';
            groupHeader.textContent = formatDateLong(dateStr);
            agendaEventsList.appendChild(groupHeader);

            dateEvents.forEach(event => {
                const card = this.createEventCardElement(event);
                agendaEventsList.appendChild(card);
            });
        });
    }

    // ==========================================
    // UTILS DE RENDERIZADO DE EVENTOS
    // ==========================================
    renderEventsListToContainer(eventsList, container) {
        container.innerHTML = '';
        
        if (eventsList.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <i data-lucide="info"></i>
                    <p>No hay eventos para este día.</p>
                    <button class="btn btn-secondary btn-sm" id="btn-create-event-empty" style="margin-top: 8px; font-size: 0.85rem; padding: 8px 16px; display: flex; align-items: center; gap: 6px;">
                        <i data-lucide="plus" style="width: 14px; height: 14px;"></i>
                        <span>Crear evento</span>
                    </button>
                </div>
            `;
            
            container.querySelector('#btn-create-event-empty')?.addEventListener('click', () => {
                document.getElementById('fab-add-event')?.click();
            });
            
            if (window.lucide) {
                window.lucide.createIcons();
            }
            return;
        }

        const allDayEvents = eventsList.filter(e => e.allDay);
        const regularEvents = eventsList.filter(e => !e.allDay);

        // Si hay eventos de todo el día, mostrarlos primero bajo una sección
        if (allDayEvents.length > 0) {
            const allDayHeader = document.createElement('div');
            allDayHeader.className = 'agenda-group-header';
            allDayHeader.style.color = 'var(--text-secondary)';
            allDayHeader.style.fontSize = '0.75rem';
            allDayHeader.style.marginTop = '4px';
            allDayHeader.style.marginBottom = '6px';
            allDayHeader.textContent = 'Todo el día';
            container.appendChild(allDayHeader);

            allDayEvents.forEach(event => {
                const card = this.createEventCardElement(event);
                container.appendChild(card);
            });
        }

        // Si hay eventos regulares y también de todo el día, añadir una pequeña cabecera para los normales
        if (regularEvents.length > 0) {
            if (allDayEvents.length > 0) {
                const regularHeader = document.createElement('div');
                regularHeader.className = 'agenda-group-header';
                regularHeader.style.color = 'var(--text-secondary)';
                regularHeader.style.fontSize = '0.75rem';
                regularHeader.style.marginTop = '12px';
                regularHeader.style.marginBottom = '6px';
                regularHeader.textContent = 'Horario';
                container.appendChild(regularHeader);
            }

            regularEvents.forEach(event => {
                const card = this.createEventCardElement(event);
                container.appendChild(card);
            });
        }
    }

    createEventCardElement(event) {
        const card = document.createElement('div');
        card.className = 'event-card';
        card.style.borderLeftColor = event.color || '#6366F1';
        
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
            </div>
        `;

        card.addEventListener('click', () => {
            if (this.onEventClick) this.onEventClick(event);
        });

        return card;
    }
}
