// backend/product-service/src/kafka/kafkaConsumer.js
// CHANGE: Use shared Kafka consumer with service-specific handlers

const KafkaConsumer = require('../../../shared/kafka/KafkaConsumer');
const { TOPICS } = require('../../../shared/kafka/events/OrderEvents');
const productService = require('../services/productService');

class ProductServiceConsumer {
  constructor() {
    this.consumer = new KafkaConsumer('product-service', 'product-service-group');
    this._registerHandlers();
  }

  _registerHandlers() {
    // CHANGE: Register handler for OrderCreated events
    this.consumer.registerHandler(TOPICS.ORDER_CREATED, async (event, context) => {
      await this._handleOrderCreated(event, context);
    });

    // CHANGE: Register handler for OrderCancelled events to restore stock
    this.consumer.registerHandler(TOPICS.ORDER_CANCELLED, async (event, context) => {
      await this._handleOrderCancelled(event, context);
    });
  }

  async start() {
    // CHANGE: Subscribe to both ORDER_CREATED and ORDER_CANCELLED topics
    await this.consumer.subscribe([TOPICS.ORDER_CREATED, TOPICS.ORDER_CANCELLED]);
    
    // CHANGE: Enable DLQ for failed stock operations
    await this.consumer.start({
      enableDLQ: true,
      maxRetries: 3,
      retryDelay: 1000,
    });
  }

  async disconnect() {
    return this.consumer.disconnect();
  }

  // CHANGE: Fix saga order detection to use proper correlation ID pattern
  async _handleOrderCreated(event, context) {
    const { orderId, items } = event.payload;
    const { correlationId } = context;

    console.log(`🛒 Processing OrderCreated: ${orderId} (${items.length} items)`);

    // CHANGE: More specific saga order detection - look for seller ID suffix pattern
    const isSagaOrder = correlationId && correlationId.match(/-[a-f0-9]{24}$/);
    
    if (isSagaOrder) {
      console.log(`⚠️ Skipping stock deduction for saga order: ${orderId} (stock already deducted via reservation confirmation)`);
      return;
    }

    // CHANGE: Track deduction results for each item
    const deductionLog = [];

    // CHANGE: Process items sequentially with error isolation
    for (const item of items) {
      try {
        // CHANGE: Log the item being processed
        console.log(`🔄 Deducting stock for item:`, {
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          productName: item.productName,
          variantName: item.variantName,
        });

        await productService.deductStock(
          item.productId,
          item.variantId,
          item.quantity,
          orderId,
          correlationId
        );

        deductionLog.push({
          productId: item.productId,
          variantId: item.variantId,
          status: 'success',
        });

        console.log(
          `✅ Stock deducted: ${item.productName}${item.variantName ? ` (${item.variantName})` : ''} ` +
          `(variant: ${item.variantId}, qty: ${item.quantity})`
        );
      } catch (error) {
        deductionLog.push({
          productId: item.productId,
          variantId: item.variantId,
          status: 'failed',
          error: error.message,
        });

        console.error(
          `❌ Stock deduction failed for Product ${item.productId}, ` +
          `Variant ${item.variantId || 'default'}:`,
          error.message
        );
        
        // CHANGE: Don't throw - continue processing other items
        // The DLQ mechanism will handle retry for failed items
      }
    }

    // CHANGE: Log final deduction summary
    const successCount = deductionLog.filter(r => r.status === 'success').length;
    const failCount = deductionLog.filter(r => r.status === 'failed').length;

    console.log(`✅ Completed stock deduction for order: ${orderId}`, {
      total: items.length,
      successful: successCount,
      failed: failCount,
    });

    // CHANGE: Throw error only if ALL items failed (for DLQ retry)
    if (failCount > 0 && successCount === 0) {
      const failedItems = deductionLog.filter(r => r.status === 'failed');
      throw new Error(
        `All stock deductions failed for order ${orderId}: ` +
        failedItems.map(f => f.error).join('; ')
      );
    }

    // CHANGE: Log warning if partial failure occurred
    if (failCount > 0) {
      console.error(`⚠️ Some items failed to deduct stock:`, 
        deductionLog.filter(r => r.status === 'failed')
      );
    }
  }

  // CHANGE: Enhanced order cancellation handler with proper stock restoration
  async _handleOrderCancelled(event, context) {
    const { orderId, items } = event.payload;
    const { correlationId } = context;

    console.log(`❌ Processing OrderCancelled: ${orderId} (${items.length} items) - Restoring stock`);

    // CHANGE: Track restoration for each item
    const restorationLog = [];

    // CHANGE: Process items sequentially to restore stock with validation
    for (const item of items) {
      try {
        // CHANGE: Log the item being processed
        console.log(`🔄 Restoring stock for cancelled order item:`, {
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          productName: item.productName,
          variantName: item.variantName,
          orderId,
        });

        // CHANGE: Use restoreStock method instead of deductStock with negative quantity
        await productService.restoreStock(
          item.productId,
          item.variantId,
          item.quantity,
          orderId,
          correlationId
        );

        restorationLog.push({
          productId: item.productId,
          variantId: item.variantId,
          status: 'success',
        });

        console.log(
          `✅ Stock restored for cancelled order: ${item.productName}${item.variantName ? ` (${item.variantName})` : ''} ` +
          `(variant: ${item.variantId}, qty: ${item.quantity}, order: ${orderId})`
        );
      } catch (error) {
        restorationLog.push({
          productId: item.productId,
          variantId: item.variantId,
          status: 'failed',
          error: error.message,
        });

        console.error(
          `❌ Stock restoration failed for cancelled order - Product ${item.productId}, ` +
          `Variant ${item.variantId || 'default'}, Order ${orderId}:`,
          error.message
        );
        
        // CHANGE: Don't throw - continue restoring other items
      }
    }

    // CHANGE: Log final restoration summary
    const successCount = restorationLog.filter(r => r.status === 'success').length;
    const failCount = restorationLog.filter(r => r.status === 'failed').length;

    console.log(`✅ Completed stock restoration for cancelled order: ${orderId}`, {
      total: items.length,
      successful: successCount,
      failed: failCount,
    });

    if (failCount > 0) {
      console.error(`⚠️ Some items failed to restore stock for cancelled order ${orderId}:`, 
        restorationLog.filter(r => r.status === 'failed')
      );
    }
  }
}

module.exports = new ProductServiceConsumer();