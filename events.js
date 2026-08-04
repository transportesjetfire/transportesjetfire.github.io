/**
 * events.js - Integración y consultas CRUD con Cloud Firestore
 *
 * Soporta eventos normales (repeat: "none") y eventos recurrentes
 * mediante el modelo "serie + excepciones" (estilo Google Calendar):
 *
 *  - Serie maestra: evento recurrente con repeat, repeatEnds, repeatEndDate.
 *  - Excepción: documento con seriesId, originalDate, date, isException: true
 *    y opcionalmente deleted: true (ocurrencia eliminada individualmente).
 *  - Ocurrencias: calculadas en memoria según el rango visible (sin duplicar
 *    documentos en Firestore).
 *
 * Estrategia de recurrencia mensual:
 *  - Se conserva el día del mes de la PRIMERA ocurrencia de la serie.
 *  - Si un mes no tiene ese día (p. ej. 31 de enero -> febrero), se usa el
 *    ÚLTIMO día de ese mes (28/29 de febrero, 30 de abril, ...).
 *  - Nunca se generan fechas inválidas ni duplicados de la misma ocurrencia.
 *
 * Zona horaria:
 *  - Todas las fechas se manejan en formato local YYYY-MM-DD. Se evita
 *    new Date("YYYY-MM-DD") (puede desplazar por UTC) y se usan utilidades
 *    de calendario local puras que operan sobre el string.
 */
import {
    db,
    collection,
    addDoc,
    doc,
    getDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    query,
    where,
    onSnapshot,
    serverTimestamp,
    writeBatch
} from "./firebase.js";

// ==========================================
// UTILIDADES DE FECHA (local, UTC-safe)
// ==========================================

/** Convierte YYYY-MM-DD a [y, m, d] enteros locales (sin saltos de zona). */
export function parseDateParts(dateStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const [y, m, d] = parts.map(Number);
    if (!y || !m || !d) return null;
    return [y, m, d];
}

/** Convierte [y, m, d] a string YYYY-MM-DD. */
export function formatDateISO(year, month, day) {
    const y = String(year).padStart(4, '0');
    const m = String(month).padStart(2, '0');
    const d = String(day).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

/** Suma días a una fecha YYYY-MM-DD (n puede ser negativo). */
export function addDays(dateStr, n) {
    const p = parseDateParts(dateStr);
    if (!p) return dateStr;
    const dt = new Date(p[0], p[1] - 1, p[2] + n);
    return formatDateISO(dt.getFullYear(), dt.getMonth() + 1, dt.getDate());
}

/** Suma n meses a una fecha YYYY-MM-DD (n puede ser negativo). */
export function addMonths(dateStr, n) {
    const p = parseDateParts(dateStr);
    if (!p) return dateStr;
    const total = (p[0] * 12 + (p[1] - 1)) + n;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    const lastDay = new Date(year, month, 0).getDate();
    const day = Math.min(p[2], lastDay);
    return formatDateISO(year, month, day);
}

/** Obtener el último día del mes de [year, month] (month 1-12). */
function getLastDayOfMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

/** Días de diferencia entre dos fechas YYYY-MM-DD (basado en calendario local). */
function dayDiff(fromDateStr, toDateStr) {
    const p0 = parseDateParts(fromDateStr);
    const p1 = parseDateParts(toDateStr);
    if (!p0 || !p1) return 0;
    const a = new Date(p0[0], p0[1] - 1, p0[2]);
    const b = new Date(p1[0], p1[1] - 1, p1[2]);
    return Math.round((b - a) / 86400000);
}

/** Comparar dos fechas YYYY-MM-DD. Devuelve -1, 0 o 1. */
export function compareDates(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

// ==========================================
// CÁLCULO DE OCURRENCIAS (expansión)
// ==========================================

/** Indica si una serie genera una ocurrencia en la fecha indicada. */
export function isSeriesActiveOn(series, dateStr) {
    if (!series || !series.date || !dateStr) return false;
    const repeat = series.repeat || 'none';
    if (repeat === 'none') return false;
    if (dateStr < series.date) return false;
    if (series.repeatEnds === 'date' && series.repeatEndDate && dateStr > series.repeatEndDate) return false;

    if (repeat === 'daily') return true;

    if (repeat === 'weekly') {
        return dayDiff(series.date, dateStr) % 7 === 0;
    }

    if (repeat === 'monthly') {
        const p0 = parseDateParts(series.date);
        const p1 = parseDateParts(dateStr);
        if (!p0 || !p1) return false;
        const lastDayP1 = getLastDayOfMonth(p1[0], p1[1]);
        if (p1[2] === p0[2]) return true;
        // Mes sin ese día: la ocurrencia cae el último día del mes
        if (p1[2] === lastDayP1 && p0[2] > lastDayP1) return true;
        return false;
    }

    return false;
}

/** Devuelve la primera ocurrencia de una serie con un offset dado (0 = la inicial). */
function firstOccurrenceAt(series, offset) {
    if (series.repeat === 'daily') return addDays(series.date, offset);
    if (series.repeat === 'weekly') return addDays(series.date, offset * 7);
    if (series.repeat === 'monthly') return addMonths(series.date, offset);
    return series.date;
}

/**
 * Expande las ocurrencias de una serie dentro de [rangeStart, rangeEnd]
 * respetando su fecha de fin (repeatEnds/repeatEndDate) y limitando la
 * expansión al rango visible (nunca infinito).
 * Devuelve las ocurrencias BASE (sin aplicar excepciones).
 */
export function expandSeriesOccurrences(series, rangeStart, rangeEnd) {
    if (!series || !series.date) return [];
    const repeat = series.repeat || 'none';
    if (repeat === 'none') return [];

    const occurrences = [];
    let offset = 0;
    let date = firstOccurrenceAt(series, offset);

    const effectiveEnd = (series.repeatEnds === 'date' && series.repeatEndDate && series.repeatEndDate < rangeEnd)
        ? series.repeatEndDate
        : rangeEnd;

    while (date && date <= effectiveEnd) {
        if (date >= rangeStart) {
            occurrences.push({
                id: `${series.id}__${date}__${series.startTime || '00:00'}`,
                date,
                startTime: series.startTime || '00:00',
                endTime: series.endTime || (series.allDay ? '23:59' : '10:00'),
                allDay: !!series.allDay,
                title: series.title,
                location: series.location || '',
                category: series.category || 'Otros',
                color: series.color || '#6366F1',
                reminder: series.reminder || 'none',
                description: series.description || '',
                seriesId: series.id,
                seriesDate: series.date,
                repeat: series.repeat,
                repeatEnds: series.repeatEnds || 'never',
                repeatEndDate: series.repeatEndDate || null,
                isOccurrence: true
            });
        }

        if (date >= effectiveEnd) break;

        offset++;
        date = firstOccurrenceAt(series, offset);
    }

    return occurrences;
}

/**
 * Construye la lista de eventos visibles para un rango [rangeStart, rangeEnd].
 * - Expande las series maestras.
 * - Aplica excepciones: las deleted se omiten; las modificadas se muestran
 *   en su nueva fecha (date), y la ocurrencia base queda ocultada.
 * - Sólo se muestran excepciones si su serie aún está activa en la fecha
 *   original (evita huérfanos tras "eliminar este y los siguientes").
 * - Garantiza que una misma ocurrencia nunca aparezca dos veces.
 */
export function computeVisibleEvents(allEvents, rangeStart, rangeEnd) {
    const resultMap = new Map();

    const seriesMap = new Map();
    const exceptions = [];

    allEvents.forEach(ev => {
        if (ev.seriesId && ev.isException) {
            exceptions.push(ev);
        } else if (ev.repeat && ev.repeat !== 'none') {
            seriesMap.set(ev.id, ev);
        } else {
            // Evento normal (sin recurrencia y sin excepción)
            if (ev.date && ev.date >= rangeStart && ev.date <= rangeEnd) {
                resultMap.set(ev.id || `${ev.date}__${ev.startTime || '00:00'}`, ev);
            }
        }
    });

    // Expansión de series base
    seriesMap.forEach(series => {
        const handled = new Set();
        exceptions.forEach(exc => {
            if (exc.seriesId === series.id) handled.add(exc.originalDate);
        });

        const baseOccs = expandSeriesOccurrences(series, rangeStart, rangeEnd);
        baseOccs.forEach(occ => {
            if (handled.has(occ.date)) {
                // Existe una excepción para esta fecha: la base se suprime.
                return;
            }
            resultMap.set(`${occ.id}`, occ);
        });
    });

    // Aplicar excepciones modificadas
    exceptions.forEach(exc => {
        if (exc.deleted) return;

        const series = seriesMap.get(exc.seriesId);
        // Sólo visible si su serie sigue cubriendo la fecha original
        if (!series || !isSeriesActiveOn(series, exc.originalDate)) return;

        if (exc.date && exc.date >= rangeStart && exc.date <= rangeEnd) {
            resultMap.set(`${exc.id}__${exc.date}__${exc.startTime || '00:00'}`, exc);
        }
    });

    return Array.from(resultMap.values());
}

// ==========================================
// SAVE (crear / actualizar evento, serie o excepción)
// ==========================================

function normalizeEventFields(eventData) {
    return {
        title: (eventData.title || '').trim(),
        description: (eventData.description || '').trim(),
        date: eventData.date,
        startTime: eventData.allDay ? '00:00' : (eventData.startTime || '09:00'),
        endTime: eventData.allDay ? '23:59' : (eventData.endTime || '10:00'),
        allDay: !!eventData.allDay,
        location: (eventData.location || '').trim(),
        category: eventData.category || 'Otros',
        color: eventData.color || '#6366F1',
        reminder: eventData.reminder || 'none',
        updatedAt: serverTimestamp()
    };
}

/**
 * Guarda o actualiza un documento de evento.
 *
 * Tipos detectados automáticamente:
 *  - Serie recurrente: eventData.repeat !== 'none'  (crea/actualiza maestro).
 *  - Excepción:        eventData.seriesId presente   (crea/actualiza excepción).
 *  - Normal:           si no se cumple lo anterior    (crea/actualiza normal).
 */
export async function saveEvent(eventData, userId) {
    if (!eventData.title || !eventData.date) {
        throw new Error("El título y la fecha son campos requeridos.");
    }

    const fields = normalizeEventFields(eventData);
    const isSeries = eventData.repeat && eventData.repeat !== 'none';
    const isException = !!eventData.seriesId;
    const base = { ...fields, userId };

    if (isException) {
        base.repeat = 'none';
        base.seriesId = eventData.seriesId;
        base.originalDate = eventData.originalDate || eventData.date;
        base.isException = true;
        if (eventData.deleted) base.deleted = true;

        if (eventData.id) {
            const ref = doc(db, "events", eventData.id);
            await updateDoc(ref, base);
            return { id: eventData.id, ...base };
        }
        const ref = await addDoc(collection(db, "events"), { ...base, createdAt: serverTimestamp() });
        return { id: ref.id, ...base };
    }

    if (isSeries) {
        base.repeat = eventData.repeat;
        base.repeatEnds = eventData.repeatEnds || 'never';
        base.repeatEndDate = (eventData.repeatEnds === 'date' && eventData.repeatEndDate) ? eventData.repeatEndDate : null;
    } else {
        base.repeat = 'none';
    }

    if (eventData.id) {
        const ref = doc(db, "events", eventData.id);
        await updateDoc(ref, base);
        return { id: eventData.id, ...base };
    }

    const ref = await addDoc(collection(db, "events"), { ...base, createdAt: serverTimestamp() });
    return { id: ref.id, ...base };
}

// ==========================================
// OCURRENCIAS: EDITAR / ELIMINAR SOLO UNA
// ==========================================

/**
 * Crea o actualiza una excepción para una ocurrencia.
 * Se usa al editar "solo esta ocurrencia":
 *  - Si la ocurrencia es base de una serie (isOccurrence): crea una excepción nueva.
 *  - Si la ocurrencia ya era una excepción (isException): actualiza su documento.
 */
export async function updateOccurrence(event, formData, userId) {
    const isExistingException = !!event.isException;
    const originalDate = isExistingException ? (event.originalDate || event.date) : (event.date);

    const payload = {
        ...formData,
        seriesId: event.seriesId,
        originalDate
    };

    if (isExistingException) {
        // Actualizar la excepción existente con su id real
        payload.id = event.id;
    } else {
        // Ocurrencia base: crear excepción nueva (sin id)
        delete payload.id;
    }

    return saveEvent(payload, userId);
}

/**
 * Elimina solo una ocurrencia:
 *  - Ocurrencia base de una serie -> crea excepción con deleted: true.
 *  - Excepción existente -> se marca deleted: true (evita que reaparezca la base).
 *  - Evento normal -> se elimina el documento directamente.
 */
export async function deleteOccurrence(event, userId) {
    if (!event.seriesId) {
        return deleteEvent(event.id);
    }

    if (event.isException && event.id) {
        const ref = doc(db, "events", event.id);
        await updateDoc(ref, {
            deleted: true,
            updatedAt: serverTimestamp()
        });
        return true;
    }

    // Ocurrencia base: crear excepción eliminada
    await saveEvent({
        title: event.title,
        description: event.description,
        date: event.date,
        startTime: event.startTime,
        endTime: event.endTime,
        allDay: event.allDay,
        location: event.location,
        category: event.category,
        color: event.color,
        reminder: event.reminder,
        seriesId: event.seriesId,
        originalDate: event.date,
        deleted: true
    }, userId);
    return true;
}

// ==========================================
// DELETE
// ==========================================

/** Elimina un único documento de evento (normal, serie o excepción). */
export async function deleteEvent(eventId) {
    if (!eventId) return false;
    const eventRef = doc(db, "events", eventId);
    await deleteDoc(eventRef);
    return true;
}

/** Obtiene todas las excepciones de una serie. */
export async function getSeriesExceptions(seriesId, userId) {
    if (!seriesId) return [];
    const exceptions = [];
    const q = query(
        collection(db, "events"),
        where("seriesId", "==", seriesId),
        where("userId", "==", userId)
    );
    const snap = await getDocs(q);
    snap.forEach(docSnap => {
        exceptions.push({ id: docSnap.id, ...docSnap.data() });
    });
    return exceptions;
}

/** Elimina toda una serie y sus excepciones de forma atómica (batch). */
export async function deleteSeries(seriesId, userId) {
    if (!seriesId) return false;

    const batch = writeBatch(db);
    batch.delete(doc(db, "events", seriesId));

    const exceptions = await getSeriesExceptions(seriesId, userId);
    exceptions.forEach(exc => {
        batch.delete(doc(db, "events", exc.id));
    });

    await batch.commit();
    return true;
}

// ==========================================
// DIVISIÓN DE SERIE ("este y los siguientes")
// ==========================================

/**
 * Divide una serie en la fecha de corte:
 *  - La serie original finaliza el día anterior (repeatEndDate = corte-1).
 *  - Se crea una NUEVA serie (nuevo ID de documento) que comienza en la fecha
 *    de corte con los datos suministrados en newEventData.
 *  - Excepciones con originalDate >= corte se REASIGNAN a la nueva serie
 *    (conservando modificaciones previas); la excepción exacta de la fecha de
 *    corte se actualiza con los nuevos datos para no perder la edición.
 *  - Operación atómica mediante writeBatch.
 */
export async function splitSeries(seriesId, splitDate, newEventData, userId) {
    if (!seriesId || !splitDate) return null;

    const seriesRef = doc(db, "events", seriesId);
    const seriesSnap = await getDoc(seriesRef);
    if (!seriesSnap.exists()) {
        throw new Error("La serie original no existe.");
    }
    const series = { id: seriesSnap.id, ...seriesSnap.data() };

    const cutDate = addDays(splitDate, -1); // fin de la serie original

    const isAllDay = !!newEventData.allDay;
    const newSeriesPayload = {
        title: (newEventData.title || series.title || '').trim(),
        description: (newEventData.description !== undefined ? newEventData.description : (series.description || '')).trim(),
        date: splitDate,
        startTime: isAllDay ? '00:00' : (newEventData.startTime || series.startTime || '09:00'),
        endTime: isAllDay ? '23:59' : (newEventData.endTime || series.endTime || '10:00'),
        allDay: isAllDay,
        location: (newEventData.location !== undefined ? newEventData.location : (series.location || '')).trim(),
        category: newEventData.category || series.category || 'Otros',
        color: newEventData.color || series.color || '#6366F1',
        reminder: newEventData.reminder || series.reminder || 'none',
        repeat: series.repeat || 'none',
        repeatEnds: series.repeatEnds || 'never',
        repeatEndDate: series.repeatEndDate || null,
        userId: userId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    };

    const batch = writeBatch(db);
    const newSeriesRef = doc(collection(db, "events"));

    // 1) Cortar la serie original el día anterior al corte
    batch.update(seriesRef, {
        title: series.title || '',
        date: series.date,
        repeatEnds: 'date',
        repeatEndDate: cutDate,
        updatedAt: serverTimestamp()
    });

    // 2) Crear la nueva serie con ID nuevo
    batch.set(newSeriesRef, newSeriesPayload);

// 3) Reasignar excepciones a partir del corte
    const exceptions = await getSeriesExceptions(seriesId, userId);
    const exceptionsToReassign = exceptions.filter(exc =>
        (exc.originalDate || exc.date) >= splitDate
    );

    exceptionsToReassign.forEach(exc => {
        const excRef = doc(db, "events", exc.id);
        const isAtSplitDate = (exc.originalDate || exc.date) === splitDate;

        const payload = {
            seriesId: newSeriesRef.id,
            deleted: !!exc.deleted,
            isException: true,
            originalDate: exc.originalDate,
            updatedAt: serverTimestamp()
        };

        // Mantener campos base existentes
        if (!exc.deleted && !isAtSplitDate) {
            payload.title = exc.title || '';
            payload.date = exc.date || exc.originalDate;
            payload.description = exc.description || '';
            payload.startTime = exc.allDay ? '00:00' : (exc.startTime || '09:00');
            payload.endTime = exc.allDay ? '23:59' : (exc.endTime || '10:00');
            payload.allDay = !!exc.allDay;
            payload.location = exc.location || '';
            payload.category = exc.category || 'Otros';
            payload.color = exc.color || '#6366F1';
            payload.reminder = exc.reminder || 'none';
        }

        // La excepción exacta del corte se actualiza con los nuevos datos
        if (!exc.deleted && isAtSplitDate) {
            payload.title = newSeriesPayload.title;
            payload.date = splitDate;
            payload.description = newSeriesPayload.description;
            payload.startTime = newSeriesPayload.startTime;
            payload.endTime = newSeriesPayload.endTime;
            payload.allDay = newSeriesPayload.allDay;
            payload.location = newSeriesPayload.location;
            payload.category = newSeriesPayload.category;
            payload.color = newSeriesPayload.color;
            payload.reminder = newSeriesPayload.reminder;
        }

        batch.set(excRef, payload, { merge: true });
    });

    await batch.commit();

    return {
        newSeriesId: newSeriesRef.id,
        series: { ...newSeriesPayload, id: newSeriesRef.id }
    };
}

// ==========================================
// TERMINAR SERIE ANTES DE UNA FECHA ("eliminar este y los siguientes")
// ==========================================

/**
 * Termina la serie el día anterior a endDate (ocultando ese día y posteriores).
 * Las excepciones posteriores quedan dentro del documento de la serie pero la
 * serie ya no las alcanza; no se generan ocurrencias huérfanas visibles.
 */
export async function endSeriesBefore(seriesId, endDate, userId) {
    if (!seriesId || !endDate) return false;

    const seriesRef = doc(db, "events", seriesId);
    const seriesSnap = await getDoc(seriesRef);
    if (!seriesSnap.exists()) return false;
    const series = { id: seriesSnap.id, ...seriesSnap.data() };

    const cutDate = addDays(endDate, -1);
    const existingEnd = (series.repeatEnds === 'date' && series.repeatEndDate) ? series.repeatEndDate : null;
    const newEndDate = (existingEnd && existingEnd < cutDate) ? existingEnd : cutDate;

    const batch = writeBatch(db);
    batch.update(seriesRef, {
        title: series.title || '',
        date: series.date,
        repeatEnds: 'date',
        repeatEndDate: newEndDate,
        updatedAt: serverTimestamp()
    });

// Limpiar excepciones que ya no podrán tener efecto: al terminar la serie
    // antes de su fecha (originalDate > nueva fecha de fin), dichas excepciones
    // dejan de ser alcanzables de forma permanente. Cada excepción pertenece a
    // una única serie (seriesId), así que solo se eliminan las de esta serie y
    // nunca las que pudieran ser necesarias para otra serie o segmento.
    const exceptions = await getSeriesExceptions(seriesId, userId);
    exceptions.forEach(exc => {
        const excOriginal = exc.originalDate || exc.date;
        if (excOriginal && excOriginal > newEndDate) {
            batch.delete(doc(db, "events", exc.id));
        }
    });

    await batch.commit();
    return true;
}

// ==========================================
// SUSCRIPCIÓN EN TIEMPO REAL
// ==========================================

/** Suscribirse a eventos del usuario autenticado en tiempo real. */
export function subscribeToEvents(userId, onEventsChange, onError) {
    if (!userId) return () => {};

    const eventsColRef = collection(db, "events");
    const q = query(
        eventsColRef,
        where("userId", "==", userId)
    );

    return onSnapshot(q, (snapshot) => {
        const events = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            events.push({
                id: doc.id,
                ...data
            });
        });

        // Ordenar en memoria por fecha y hora de inicio de forma ascendente
        events.sort((a, b) => {
            const dateA = a.date || '';
            const dateB = b.date || '';
            if (dateA !== dateB) {
                return dateA.localeCompare(dateB);
            }
            const timeA = a.startTime || '00:00';
            const timeB = b.startTime || '00:00';
            return timeA.localeCompare(timeB);
        });

        onEventsChange(events);
    }, (error) => {
        console.error("Error al suscribirse a eventos:", error);
        if (onError) onError(error);
    });
}

