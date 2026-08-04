# Implementación de Eventos Recurrentes — COMPLETADA

## Estado final

- [x] 1. `js/firebase.js`: exportar `writeBatch`.
- [x] 2. `js/events.js`: lógica completa de series/excepciones.
  - `computeVisibleEvents()` — expansión de series en memoria.
  - `expandSeriesOccurrences()` — genera ocurrencias base para un rango.
  - `isSeriesActiveOn()` — verifica si una serie cubre una fecha.
  - `saveEvent()` — crea/actualiza eventos normales, series o excepciones.
  - `deleteEvent()` — elimina un documento único.
  - `deleteSeries()` — elimina serie + excepciones (batch).
  - `splitSeries()` — divide una serie en dos (este y siguientes) con batch.
  - `endSeriesBefore()` — termina serie + limpia excepciones huérfanas (batch).
  - `updateOccurrence()` — crea/actualiza excepción individual.
  - `deleteOccurrence()` — elimina ocurrencia (crea excepción deleted).
  - Utilidades UTC-safe: `parseDateParts`, `addDays`, `addMonths`, `compareDates`.
- [x] 3. `js/calendar.js`: las 4 vistas usan `getEventsForRange()` → `computeVisibleEvents()`.
- [x] 4. `index.html`: campos de fin de recurrencia + bottom sheet de alcance.
- [x] 5. `js/app.js`: flujo completo de edición/eliminación por alcance (this/following/all).
- [x] 6. `css/styles.css`: estilos para controles de recurrencia y scope sheet.
- [x] 7. Render de pestañas Eventos y Recordatorios expande recurrencias con `computeVisibleEvents`.
- [x] 8. Limpieza de excepciones huérfanas al terminar serie (en `endSeriesBefore`).
- [x] 9. Correcciones finales: `currentViewingEvent` limpiado al crear evento, IDs sintéticos manejados en updateOccurrence, mensajes de guardado corregidos.
- [x] 10. Sintaxis JS validada con `node --check` en los 4 archivos modificados.

