// backend/shared/kafka/events/SagaEvents.js
// CHANGE: Centralized saga event schemas for orchestration and compensation

const TOPICS = {
  SAGA_STARTED: 'saga.started',
  SAGA_STEP_COMPLETED: 'saga.step.completed',
  SAGA_STEP_FAILED: 'saga.step.failed',
  SAGA_COMPLETED: 'saga.completed',
  SAGA_FAILED: 'saga.failed',
  SAGA_COMPENSATING: 'saga.compensating',
  SAGA_COMPENSATED: 'saga.compensated',
};

const createSagaStartedEvent = (sagaId, sagaType, correlationId, payload) => ({
  eventType: 'SagaStarted',
  payload: {
    sagaId,
    sagaType,
    correlationId,
    payload,
    startedAt: new Date().toISOString(),
  },
});

const createSagaStepCompletedEvent = (sagaId, stepName, stepData) => ({
  eventType: 'SagaStepCompleted',
  payload: {
    sagaId,
    stepName,
    stepData,
    completedAt: new Date().toISOString(),
  },
});

const createSagaStepFailedEvent = (sagaId, stepName, error) => ({
  eventType: 'SagaStepFailed',
  payload: {
    sagaId,
    stepName,
    error: error.message || error,
    failedAt: new Date().toISOString(),
  },
});

const createSagaCompletedEvent = (sagaId) => ({
  eventType: 'SagaCompleted',
  payload: {
    sagaId,
    completedAt: new Date().toISOString(),
  },
});

const createSagaFailedEvent = (sagaId, error) => ({
  eventType: 'SagaFailed',
  payload: {
    sagaId,
    error: error.message || error,
    failedAt: new Date().toISOString(),
  },
});

module.exports = {
  TOPICS,
  createSagaStartedEvent,
  createSagaStepCompletedEvent,
  createSagaStepFailedEvent,
  createSagaCompletedEvent,
  createSagaFailedEvent,
};