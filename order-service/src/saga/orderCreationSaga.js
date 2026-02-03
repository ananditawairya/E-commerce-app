// backend/order-service/src/saga/orderCreationSaga.js
// CHANGE: Enhanced validation with better error handling for missing products

const axios = require('axios');

const PRODUCT_API_URL = process.env.PRODUCT_API_URL || 'http://localhost:4002/api/products';

// CHANGE: Group items by seller for coordinated processing
const groupItemsBySeller = (items) => {
  const sellerGroups = new Map();

  items.forEach(item => {
    if (!sellerGroups.has(item.sellerId)) {
      sellerGroups.set(item.sellerId, []);
    }
    sellerGroups.get(item.sellerId).push(item);
  });

  return sellerGroups;
};

const orderCreationSaga = {
  name: 'ORDER_CREATION',
  steps: [
    {
      name: 'VALIDATE_ITEMS',
      execute: async (payload, correlationId) => {
        console.log(`🔍 Validating items for order: ${payload.orderId}`);

        const validationResults = [];

        // CHANGE: Validate each item exists and has sufficient stock
        for (const item of payload.items) {
          // CHANGE: Log the exact variant being validated
          console.log(`🔍 Validating: Product ${item.productId}, Variant ${item.variantId}, Quantity ${item.quantity}`);
          try {
            const response = await axios.get(
              `${PRODUCT_API_URL}/${item.productId}/stock`,
              {
                params: { variantId: item.variantId },
                headers: {
                  'X-Correlation-ID': correlationId,
                },
                timeout: 5000,
              }
            );

            const stockInfo = response.data;

             // CHANGE: Verify the response is for the correct variant
            if (item.variantId && stockInfo.variantId !== item.variantId) {
              throw new Error(
                `Variant mismatch: requested ${item.variantId}, got ${stockInfo.variantId}`
              );
            }

            if (stockInfo.stock < item.quantity) {
              throw new Error(
                `Insufficient stock for ${item.productName}${item.variantId ? ` (${item.variantName})` : ''}: ` +
                `Available ${stockInfo.stock}, Requested ${item.quantity}`
              );
            }

            validationResults.push({
              productId: item.productId,
              variantId: item.variantId,
              available: stockInfo.stock,
              requested: item.quantity,
              valid: true,
            });

                        
            console.log(`✅ Validated: ${item.productName}${item.variantId ? ` (${item.variantName})` : ''} - ${item.quantity} units available`);
          } catch (error) {
            // CHANGE: Enhanced error handling for 404 and other errors
            if (error.response?.status === 404) {
              const productInfo = item.variantId
                ? `Product ${item.productId} variant ${item.variantId}`
                : `Product ${item.productId}`;
              throw new Error(
                `${productInfo} not found. Please ensure the product exists before creating an order.`
              );
            }

            // CHANGE: Handle network/timeout errors
            if (error.code === 'ECONNREFUSED') {
              throw new Error(
                `Product service unavailable. Cannot validate ${item.productName}.`
              );
            }

            if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
              throw new Error(
                `Timeout validating ${item.productName}. Product service may be slow or unavailable.`
              );
            }

            // CHANGE: Re-throw with context
            console.error(`❌ Validation failed for ${item.productId} variant ${item.variantId}:`, error.message);
            throw new Error(
              `Validation failed for ${item.productName}${item.variantId ? ` (${item.variantName})` : ''}: ${error.response?.data?.message || error.message}`
            );
          }
        }

        return { validationResults };
      },
      compensate: async (payload, stepData, correlationId) => {
        // CHANGE: No compensation needed for validation step
        console.log(`ℹ️  No compensation needed for validation step`);
      },
    },

    {
      name: 'CONFIRM_ORDER',
      execute: async (payload, correlationId) => {
        console.log(`✅ Confirming order: ${payload.orderId}`);

        // CHANGE: Order confirmation logic
        const confirmedAt = new Date().toISOString();
        console.log(`📡 Stock deduction will be handled by Kafka OrderCreated event`);
        return {
          confirmedAt,
          status: 'confirmed',
        };
      },
      compensate: async (payload, stepData, correlationId) => {
        console.log(`🔄 Cancelling order: ${payload.orderId}`);

        // CHANGE: Order cancellation logic (update order status to cancelled)
        // This is handled in the order service's cancelOrder method
      },
    },
    {
      name: 'NOTIFY_SELLERS',
      execute: async (payload, correlationId) => {
        console.log(`📧 Notifying sellers for order: ${payload.orderId}`);

        const sellerGroups = groupItemsBySeller(payload.items);
        const notifications = [];

        // CHANGE: Send notification to each seller
        for (const [sellerId, items] of sellerGroups.entries()) {
          try {
            // CHANGE: Mock notification (replace with actual notification service)
            const notification = {
              sellerId,
              orderId: payload.orderId,
              itemCount: items.length,
              totalAmount: items.reduce((sum, item) => sum + (item.price * item.quantity), 0),
              items: items.map(item => ({
                productName: item.productName,
                variantName: item.variantName,
                quantity: item.quantity,
                price: item.price,
              })),
              notifiedAt: new Date().toISOString(),
            };

            notifications.push(notification);

            console.log(`✅ Notified seller: ${sellerId} (${items.length} items)`);
          } catch (error) {
            // CHANGE: Notification failure is non-critical, log and continue
            console.warn(`⚠️  Failed to notify seller ${sellerId}:`, error.message);
          }
        }

        return { notifications };
      },
      compensate: async (payload, stepData, correlationId) => {
        console.log(`🔄 Sending cancellation notifications for order: ${payload.orderId}`);

        // CHANGE: Send cancellation notifications to sellers
        for (const notification of stepData.notifications) {
          try {
            // CHANGE: Mock cancellation notification
            console.log(`✅ Sent cancellation notice to seller: ${notification.sellerId}`);
          } catch (error) {
            console.warn(`⚠️  Failed to send cancellation notice to seller ${notification.sellerId}:`, error.message);
          }
        }
      },
    },
  ],
};

module.exports = orderCreationSaga;