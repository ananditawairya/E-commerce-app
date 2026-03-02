// backend/shared/saga/Saga.js
// Use mongoose instance passed from service, not a new one

const sagaStepSchema = {
  stepName: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'compensated'],
    default: 'pending',
  },
  startedAt: Date,
  completedAt: Date,
  error: String,
  compensationData: Object,
};

const sagaSchemaDefinition = {
  sagaId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  sagaType: {
    type: String,
    required: true,
    enum: ['ORDER_CREATION', 'ORDER_CANCELLATION'],
  },
  status: {
    type: String,
    enum: ['started', 'completed', 'failed', 'compensating', 'compensated'],
    default: 'started',
  },
  correlationId: {
    type: String,
    required: true,
  },
  payload: {
    type: Object,
    required: true,
  },
  steps: [sagaStepSchema],
  currentStep: {
    type: Number,
    default: 0,
  },
  error: String,
};

// Export factory function instead of model directly
module.exports = (mongoose) => {
  // Check if model already exists to avoid OverwriteModelError
  if (mongoose.models.Saga) {
    return mongoose.models.Saga;
  }

  const sagaSchema = new mongoose.Schema(sagaSchemaDefinition, {
    timestamps: true,
  });

  // Configure toJSON for GraphQL compatibility
  sagaSchema.set('toJSON', {
    virtuals: true,
    transform: (doc, ret) => {
      ret.id = ret._id.toString();
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  });

  return mongoose.model('Saga', sagaSchema);
};