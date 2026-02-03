// backend/order-service/src/saga/orderCreationSaga.js
// CHANGE: Enhanced saga with stock reservation system

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
      name: 'RESERVE_STOCK',
      execute: async (payload, correlationId) => {
        console.log(`🔒 Reserving stock for order: ${payload.orderId}`);

        const reservations = [];

        // CHANGE: Reserve stock for each item instead of just validating
        for (const item of payload.items) {
          console.log(`🔒 Reserving stock: Product ${item.productId}, Variant ${item.variantId}, Quantity ${item.quantity}`);
          
          try {
            const response = await axios.post(
              `${PRODUCT_API_URL}/${item.productId}/reserve-stock`,
              {
                variantId: item.variantId,
                quantity: item.quantity,
                orderId: payload.orderId,
                timeoutMs: 300000, // 5 minutes
              },
              {
                headers: {
                  'X-Correlation-ID': correlationId,
                },
                timeout: 10000,
              }
            );

            const reservation = response.data;
            reservations.push({
              productId: item.productId,
              variantId: item.variantId,
              reservationId: reservation.reservationId,
              quantity: item.quantity,
              productName: item.productName,
              variantName: item.variantName,
            });

            console.log(`✅ Stock reserved: ${item.productName}${item.variantName ? ` (${item.variantName})` : ''} - Reservation: ${reservation.reservationId}`);
          } catch (error) {
            // CHANGE: Enhanced error handling for reservation failures
            if (error.response?.status === 404) {
              const productInfo = item.variantId
                ? `Product ${item.productId} variant ${item.variantId}`
                : `Product ${item.productId}`;
              throw new Error(
                `${productInfo} not found. Please ensure the product exists before creating an order.`
              );
            }

            if (error.response?.status === 409) {
              throw new Error(
                `Insufficient stock for ${item.productName}${item.variantId ? ` (${item.variantName})` : ''}. ` +
                `Please check availability and try again.`
              );
            }

            // CHANGE: Handle network/timeout errors
            if (error.code === 'ECONNREFUSED') {
              throw new Error(
                `Product service unavailable. Cannot reserve stock for ${item.productName}.`
              );
            }

            if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
              throw new Error(
                `Timeout reserving stock for ${item.productName}. Product service may be slow or unavailable.`
              );
            }

            // CHANGE: Re-throw with context
            console.error(`❌ Stock reservation failed for ${item.productId} variant ${item.variantId}:`, error.message);
            throw new Error(
              `Stock reservation failed for ${item.productName}${item.variantId ? ` (${item.variantName})` : ''}: ${error.response?.data?.message || error.message}`
            );
          }
        }

        return { reservations };
      },
      compensate: async (payload, stepData, correlationId) => {
        console.log(`🔄 Releasing stock reservations for order: ${payload.orderId}`);

        // CHANGE: Release all reservations made in this step
        if (stepData.reservations) {
          for (const reservation of stepData.reservations) {
            try {
              await axios.post(
                `${PRODUCT_API_URL}/${reservation.productId}/release-reservation`,
                {
                  variantId: reservation.variantId,
                  reservationId: reservation.reservationId,
                },
                {
                  headers: {
                    'X-Correlation-ID': correlationId,
                  },
                  timeout: 10000,
                }
              );
              
              console.log(`✅ Released reservation: ${reservation.reservationId} for ${reservation.productName}`);
            } catch (error) {
              console.error(`❌ Failed to release reservation ${reservation.reservationId}:`, error.message);
            }
          }
        }
      },
    },

    {
      name: 'CONFIRM_ORDER',
      execute: async (payload, correlationId) => {
        console.log(`✅ Confirming order: ${payload.orderId}`);

        // CHANGE: Order confirmation logic - no payment processing yet
        const confirmedAt = new Date().toISOString();
        console.log(`📋 Order confirmed without payment processing (MVP)`);
        
        return {
          confirmedAt,
          status: 'confirmed',
        };
      },
      compensate: async (payload, stepData, correlationId) => {
        console.log(`🔄 Cancelling order confirmation: ${payload.orderId}`);
        // CHANGE: Order cancellation logic (update order status to cancelled)
        // This is handled in the order service's cancelOrder method
      },
    },

    {
      name: 'CONFIRM_STOCK_RESERVATIONS',
      execute: async (payload, correlationId) => {
        console.log(`🔒 Confirming stock reservations for order: ${payload.orderId}`);

        // CHANGE: Get reservations from RESERVE_STOCK step data stored in saga
        const reserveStockStep = payload.sagaSteps?.find(s => s.stepName === 'RESERVE_STOCK');
        const reservations = reserveStockStep?.compensationData?.reservations || [];

        // CHANGE: If no reservations found in saga data, skip this step
        if (reservations.length === 0) {
          console.log(`⚠️ No reservations found for order: ${payload.orderId}`);
          return { confirmedReservations: [] };
        }

        for (const reservation of reservations) {
          try {
            await axios.post(
              `${PRODUCT_API_URL}/${reservation.productId}/confirm-reservation`,
              {
                variantId: reservation.variantId,
                reservationId: reservation.reservationId,
                orderId: payload.orderId,
              },
              {
                headers: {
                  'X-Correlation-ID': correlationId,
                },
                timeout: 10000,
              }
            );

            console.log(`✅ Confirmed reservation: ${reservation.reservationId} for ${reservation.productName}`);
          } catch (error) {
            console.error(`❌ Failed to confirm reservation ${reservation.reservationId}:`, error.message);
            throw new Error(`Failed to confirm stock reservation for ${reservation.productName}: ${error.message}`);
          }
        }

        return { confirmedReservations: reservations };
      },
      compensate: async (payload, stepData, correlationId) => {
        console.log(`🔄 Compensating confirmed reservations for order: ${payload.orderId}`);

        // CHANGE: For confirmed reservations, we need to restore stock manually
        if (stepData.confirmedReservations) {
          for (const reservation of stepData.confirmedReservations) {
            try {
              await axios.post(
                `${PRODUCT_API_URL}/${reservation.productId}/restore-stock`,
                {
                  variantId: reservation.variantId,
                  quantity: reservation.quantity,
                  orderId: payload.orderId,
                },
                {
                  headers: {
                    'X-Correlation-ID': correlationId,
                  },
                  timeout: 10000,
                }
              );
              
              console.log(`✅ Restored stock for ${reservation.productName} (${reservation.quantity} units)`);
            } catch (error) {
              console.error(`❌ Failed to restore stock for ${reservation.productName}:`, error.message);
            }
          }
        }
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
        if (stepData.notifications) {
          for (const notification of stepData.notifications) {
            try {
              // CHANGE: Mock cancellation notification
              console.log(`✅ Sent cancellation notice to seller: ${notification.sellerId}`);
            } catch (error) {
              console.warn(`⚠️  Failed to send cancellation notice to seller ${notification.sellerId}:`, error.message);
            }
          }
        }
      },
    },
  ],
};

module.exports = orderCreationSaga;