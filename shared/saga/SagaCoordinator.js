// backend/shared/saga/SagaCoordinator.js
// CHANGE: Accept mongoose instance in constructor

const createSagaModel = require('./Saga');
const KafkaProducer = require('../kafka/KafkaProducer');
const { 
  TOPICS,
  createSagaStartedEvent,
  createSagaStepCompletedEvent,
  createSagaStepFailedEvent,
  createSagaCompletedEvent,
  createSagaFailedEvent,
} = require('../kafka/events/SagaEvents');

class SagaCoordinator {
  // CHANGE: Accept mongoose instance to ensure same connection
  constructor(serviceName, mongooseInstance) {
    if (!mongooseInstance) {
      throw new Error('Mongoose instance is required for SagaCoordinator');
    }
    
    this.mongoose = mongooseInstance;
    this.Saga = createSagaModel(mongooseInstance);
    this.producer = new KafkaProducer(`${serviceName}-saga-coordinator`);
    this.sagaDefinitions = new Map();
  }

  async connect() {
    await this.producer.connect();
  }

  async disconnect() {
    await this.producer.disconnect();
  }

  // CHANGE: Validate MongoDB connection before operations
  _ensureMongoConnection() {
    if (this.mongoose.connection.readyState !== 1) {
      throw new Error('MongoDB connection not ready. Current state: ' + this.mongoose.connection.readyState);
    }
  }

  registerSaga(sagaType, definition) {
    this.sagaDefinitions.set(sagaType, definition);
  }

  async startSaga(sagaType, payload, correlationId) {
    // CHANGE: Check MongoDB connection before starting saga
    this._ensureMongoConnection();
    
    const sagaId = `${sagaType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const definition = this.sagaDefinitions.get(sagaType);
    if (!definition) {
      throw new Error(`Saga definition not found for type: ${sagaType}`);
    }

    // CHANGE: Create saga record with retry logic
    let saga;
    const maxRetries = 3;
    let lastError;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // CHANGE: Use this.Saga instead of imported Saga
        saga = new this.Saga({
          sagaId,
          sagaType,
          correlationId,
          payload,
          status: 'started',
          steps: definition.steps.map(step => ({
            stepName: step.name,
            status: 'pending',
          })),
          currentStep: 0,
        });

        await saga.save();
        break; // Success, exit retry loop
      } catch (error) {
        lastError = error;
        console.error(`❌ Saga creation attempt ${attempt + 1}/${maxRetries} failed:`, error.message);
        
        if (attempt < maxRetries - 1) {
          // CHANGE: Wait before retry
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    }
    
    if (!saga) {
      throw new Error(`Failed to create saga after ${maxRetries} attempts: ${lastError.message}`);
    }

    // CHANGE: Publish saga started event
    const event = createSagaStartedEvent(sagaId, sagaType, correlationId, payload);
    const message = this.producer.buildMessage(sagaId, event, correlationId);
    
    await this.producer.publish(TOPICS.SAGA_STARTED, message, {
      critical: true,
      correlationId,
    });

    console.log(`✅ Saga started: ${sagaId} (${sagaType})`);
    
    return saga;
  }

  async completeStep(sagaId, stepName, stepData, correlationId) {
    // CHANGE: Check MongoDB connection
    this._ensureMongoConnection();
    
    // CHANGE: Use this.Saga instead of imported Saga
    const saga = await this.Saga.findOne({ sagaId });
    if (!saga) {
      throw new Error(`Saga not found: ${sagaId}`);
    }

    const stepIndex = saga.steps.findIndex(s => s.stepName === stepName);
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${stepName}`);
    }

    saga.steps[stepIndex].status = 'completed';
    saga.steps[stepIndex].completedAt = new Date();
    saga.steps[stepIndex].compensationData = stepData;
    saga.currentStep = stepIndex + 1;

    const allCompleted = saga.steps.every(s => s.status === 'completed');
    if (allCompleted) {
      saga.status = 'completed';
      await saga.save();

      const event = createSagaCompletedEvent(sagaId);
      const message = this.producer.buildMessage(sagaId, event, correlationId);
      
      await this.producer.publish(TOPICS.SAGA_COMPLETED, message, {
        critical: false,
        correlationId,
      });

      console.log(`✅ Saga completed: ${sagaId}`);
    } else {
      await saga.save();

      const event = createSagaStepCompletedEvent(sagaId, stepName, stepData);
      const message = this.producer.buildMessage(sagaId, event, correlationId);
      
      await this.producer.publish(TOPICS.SAGA_STEP_COMPLETED, message, {
        critical: false,
        correlationId,
      });

      console.log(`✅ Saga step completed: ${sagaId} - ${stepName}`);
    }

    return saga;
  }

  async failStep(sagaId, stepName, error, correlationId) {
    // CHANGE: Check MongoDB connection
    this._ensureMongoConnection();
    
    // CHANGE: Use this.Saga instead of imported Saga
    const saga = await this.Saga.findOne({ sagaId });
    if (!saga) {
      throw new Error(`Saga not found: ${sagaId}`);
    }

    const stepIndex = saga.steps.findIndex(s => s.stepName === stepName);
    if (stepIndex === -1) {
      throw new Error(`Step not found: ${stepName}`);
    }

    saga.steps[stepIndex].status = 'failed';
    saga.steps[stepIndex].error = error.message || error;
    saga.status = 'compensating';
    saga.error = error.message || error;

    await saga.save();

    const event = createSagaStepFailedEvent(sagaId, stepName, error);
    const message = this.producer.buildMessage(sagaId, event, correlationId);
    
    await this.producer.publish(TOPICS.SAGA_STEP_FAILED, message, {
      critical: true,
      correlationId,
    });

    console.log(`❌ Saga step failed: ${sagaId} - ${stepName}`);

    await this.compensate(sagaId, correlationId);

    return saga;
  }

  async compensate(sagaId, correlationId) {
    // CHANGE: Check MongoDB connection
    this._ensureMongoConnection();
    
    // CHANGE: Use this.Saga instead of imported Saga
    const saga = await this.Saga.findOne({ sagaId });
    if (!saga) {
      throw new Error(`Saga not found: ${sagaId}`);
    }

    const definition = this.sagaDefinitions.get(saga.sagaType);
    if (!definition) {
      throw new Error(`Saga definition not found for type: ${saga.sagaType}`);
    }

    console.log(`🔄 Starting compensation for saga: ${sagaId}`);

    const completedSteps = saga.steps
      .map((step, index) => ({ ...step.toObject(), index }))
      .filter(step => step.status === 'completed')
      .reverse();

    for (const step of completedSteps) {
      const stepDef = definition.steps[step.index];
      
      if (stepDef.compensate) {
        try {
          console.log(`🔄 Compensating step: ${step.stepName}`);
          
          await stepDef.compensate(saga.payload, step.compensationData, correlationId);
          
          saga.steps[step.index].status = 'compensated';
          await saga.save();
          
          console.log(`✅ Compensated step: ${step.stepName}`);
        } catch (compensationError) {
          console.error(`❌ Compensation failed for step ${step.stepName}:`, compensationError);
          saga.steps[step.index].error = `Compensation failed: ${compensationError.message}`;
          await saga.save();
        }
      }
    }

    saga.status = 'compensated';
    await saga.save();

    const event = createSagaFailedEvent(sagaId, saga.error);
    const message = this.producer.buildMessage(sagaId, event, correlationId);
    
    await this.producer.publish(TOPICS.SAGA_FAILED, message, {
      critical: false,
      correlationId,
    });

    console.log(`✅ Saga compensated: ${sagaId}`);

    return saga;
  }

  async getSagaStatus(sagaId) {
    // CHANGE: Check MongoDB connection
    this._ensureMongoConnection();
    
    // CHANGE: Use this.Saga instead of imported Saga
    const saga = await this.Saga.findOne({ sagaId });
    if (!saga) {
      throw new Error(`Saga not found: ${sagaId}`);
    }
    return saga;
  }
}

module.exports = SagaCoordinator;