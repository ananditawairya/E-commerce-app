/**
 * Executes saga steps in sequence for one saga definition.
 * @param {{sagaCoordinator: object, orderCreationSaga: object}} deps Service dependencies.
 * @param {object} saga Saga state payload.
 * @param {string} correlationId Correlation id.
 * @return {Promise<void>} No return value.
 */
async function executeSagaSteps(deps, saga, correlationId) {
  const { sagaCoordinator, orderCreationSaga } = deps;
  const definition = orderCreationSaga;

  for (let index = 0; index < definition.steps.length; index += 1) {
    const step = definition.steps[index];

    try {
      console.log(`🔄 Executing saga step: ${step.name}`);

      const stepData = await step.execute(saga.payload, correlationId);

      await sagaCoordinator.completeStep(saga.sagaId, step.name, stepData, correlationId);

      console.log(`✅ Saga step completed: ${step.name}`);
    } catch (error) {
      console.error(`❌ Saga step failed: ${step.name}`, error.message);

      await sagaCoordinator.failStep(saga.sagaId, step.name, error, correlationId);

      throw error;
    }
  }
}

/**
 * Creates one order per seller and executes saga workflow for each.
 * @param {{
 *   Order: object,
 *   kafkaProducer: object,
 *   sagaCoordinator: object,
 *   orderCreationSaga: object,
 * }} deps Service dependencies.
 * @param {string} userId Buyer user id.
 * @param {{items: object[], totalAmount: number, shippingAddress: object}} input Order payload.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object[]>} Created orders.
 */
async function createOrder(deps, userId, input, correlationId) {
  const {
    Order,
    kafkaProducer,
    sagaCoordinator,
    orderCreationSaga,
  } = deps;
  const { items, shippingAddress } = input;

  if (!sagaCoordinator) {
    throw new Error('Saga coordinator not initialized');
  }

  const itemsBySeller = items.reduce((accumulator, item) => {
    if (!accumulator[item.sellerId]) {
      accumulator[item.sellerId] = [];
    }
    accumulator[item.sellerId].push(item);
    return accumulator;
  }, {});

  const sellerIds = Object.keys(itemsBySeller);
  const createdOrders = [];

  for (const sellerId of sellerIds) {
    const sellerItems = itemsBySeller[sellerId];
    const sellerTotal = sellerItems.reduce(
      (sum, item) => sum + (item.price * item.quantity),
      0
    );

    const order = new Order({
      orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      buyerId: userId,
      items: sellerItems,
      totalAmount: sellerTotal,
      shippingAddress,
      status: 'pending',
      paymentMethod: 'mock',
    });

    await order.save();

    try {
      const saga = await sagaCoordinator.startSaga(
        'ORDER_CREATION',
        {
          orderId: order.orderId,
          buyerId: order.buyerId,
          items: order.items,
          totalAmount: order.totalAmount,
          shippingAddress: order.shippingAddress,
        },
        `${correlationId}-${sellerId}`
      );

      await executeSagaSteps({ sagaCoordinator, orderCreationSaga }, saga, `${correlationId}-${sellerId}`);

      await kafkaProducer.publishOrderCreated(
        {
          orderId: order.orderId,
          buyerId: order.buyerId,
          items: order.items,
          totalAmount: order.totalAmount,
          createdAt: order.createdAt,
        },
        `${correlationId}-${sellerId}`
      );

      createdOrders.push(order);

      console.log(`✅ Order created successfully via saga: ${order.orderId} for seller: ${sellerId}`);
    } catch (error) {
      order.status = 'cancelled';
      await order.save();

      console.error(`❌ Order creation saga failed: ${order.orderId}`, error.message);
      createdOrders.push(order);
    }
  }

  return createdOrders;
}

/**
 * Updates status for seller-owned order.
 * @param {{Order: object, kafkaProducer: object}} deps Service dependencies.
 * @param {string} orderId Order id.
 * @param {string} sellerId Seller user id.
 * @param {string} status Next status.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Updated order.
 */
async function updateOrderStatus(deps, orderId, sellerId, status, correlationId) {
  const { Order, kafkaProducer } = deps;
  const order = await Order.findById(orderId);

  if (!order) {
    const error = new Error('Order not found');
    error.code = 'ORDER_NOT_FOUND';
    throw error;
  }

  const hasItems = order.items.some((item) => item.sellerId === sellerId);
  if (!hasItems) {
    const error = new Error('Unauthorized to update this order');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  order.status = status;
  await order.save();

  setImmediate(async () => {
    try {
      await kafkaProducer.publishOrderStatusUpdated(order.orderId, status, correlationId);
    } catch (error) {
      console.error('Failed to publish order status update event:', error);
    }
  });

  return order;
}

/**
 * Cancels seller-owned order when cancelable.
 * @param {{Order: object, kafkaProducer: object}} deps Service dependencies.
 * @param {string} orderId Order id.
 * @param {string} sellerId Seller user id.
 * @param {string} correlationId Correlation id.
 * @return {Promise<object>} Cancelled order.
 */
async function cancelOrder(deps, orderId, sellerId, correlationId) {
  const { Order, kafkaProducer } = deps;
  const order = await Order.findById(orderId);

  if (!order) {
    const error = new Error('Order not found');
    error.code = 'ORDER_NOT_FOUND';
    throw error;
  }

  const hasItems = order.items.some((item) => item.sellerId === sellerId);
  if (!hasItems) {
    const error = new Error('Unauthorized to cancel this order');
    error.code = 'UNAUTHORIZED';
    throw error;
  }

  if (order.status === 'cancelled' || order.status === 'delivered') {
    const error = new Error('Order cannot be cancelled');
    error.code = 'CANNOT_CANCEL_ORDER';
    throw error;
  }

  order.status = 'cancelled';
  await order.save();

  await kafkaProducer.publishOrderCancelled(
    {
      orderId: order.orderId,
      buyerId: order.buyerId,
      items: order.items,
      totalAmount: order.totalAmount,
    },
    correlationId
  );

  return order;
}

module.exports = {
  cancelOrder,
  createOrder,
  executeSagaSteps,
  updateOrderStatus,
};
