// backend/shared/kafka/events/UserEvents.js
// CHANGE: Centralized user event schemas

const TOPICS = {
  USER_REGISTERED: 'user.registered',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
};

const createUserRegisteredEvent = (user) => ({
  eventType: 'UserRegistered',
  payload: {
    userId: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    createdAt: user.createdAt,
  },
});

const createUserUpdatedEvent = (userId, changes) => ({
  eventType: 'UserUpdated',
  payload: {
    userId,
    changes,
    updatedAt: new Date().toISOString(),
  },
});

module.exports = {
  TOPICS,
  createUserRegisteredEvent,
  createUserUpdatedEvent,
};