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
            
            if (stockInfo.stock < item.quantity) {
              throw new Error(
                `Insufficient stock for ${item.productName}: ` +
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
            
            console.log(`✅ Validated: ${item.productName} (${item.quantity} units)`);
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
            console.error(`❌ Validation failed for ${item.productId}:`, error.message);
            throw new Error(
              `Validation failed for ${item.productName}: ${error.response?.data?.message || error.message}`
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
      name: 'RESERVE_STOCK_ALL_SELLERS',
      execute: async (payload, correlationId) => {
        console.log(`📦 Reserving stock across all sellers for order: ${payload.orderId}`);
        
        const sellerGroups = groupItemsBySeller(payload.items);
        const reservations = [];
        
        // CHANGE: Reserve stock for each seller's items atomically
        for (const [sellerId, items] of sellerGroups.entries()) {
          console.log(`📦 Processing seller: ${sellerId} (${items.length} items)`);
          
          const sellerReservations = [];
          
          try {
            // CHANGE: Reserve all items for this seller
            for (const item of items) {
              await axios.post(
                `${PRODUCT_API_URL}/${item.productId}/deduct-stock`,
                {
                  variantId: item.variantId,
                  quantity: item.quantity,
                  orderId: payload.orderId,
                },
                {
                  headers: {
                    'X-Correlation-ID': correlationId,
                  },
                  timeout: 10000,
                }
              );
              
              sellerReservations.push({
                sellerId,
                productId: item.productId,
                variantId: item.variantId,
                quantity: item.quantity,
                productName: item.productName,
              });
              
              console.log(`✅ Reserved: ${item.productName} (${item.quantity} units) - Seller: ${sellerId}`);
            }
            
            reservations.push(...sellerReservations);
          } catch (error) {
            // CHANGE: If any seller's reservation fails, throw to trigger compensation
            console.error(`❌ Stock reservation failed for seller ${sellerId}:`, error.message);
            
            // CHANGE: Store partial reservations for compensation
            if (sellerReservations.length > 0) {
              reservations.push(...sellerReservations);
            }
            
            throw new Error(
              `Stock reservation failed for seller ${sellerId}: ${error.response?.data?.message || error.message}`
            );
          }
        }
        
        console.log(`✅ All stock reserved across ${sellerGroups.size} sellers`);
        
        return { 
          reservations,
          sellerCount: sellerGroups.size,
        };
      },
      compensate: async (payload, stepData, correlationId) => {
        console.log(`🔄 Releasing reserved stock for order: ${payload.orderId}`);
        
        // CHANGE: Release all reserved stock across all sellers
        for (const reservation of stepData.reservations) {
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
            
            console.log(
              `✅ Released: ${reservation.productName} (${reservation.quantity} units) - Seller: ${reservation.sellerId}`
            );
          } catch (error) {
            console.error(
              `❌ Failed to release stock for ${reservation.productId} (Seller: ${reservation.sellerId}):`,
              error.message
            );
          }
        }
        
        console.log(`✅ All stock released for order: ${payload.orderId}`);
      },
    },
    {
      name: 'CONFIRM_ORDER',
      execute: async (payload, correlationId) => {
        console.log(`✅ Confirming order: ${payload.orderId}`);
        
        // CHANGE: Order confirmation logic
        const confirmedAt = new Date().toISOString();
        
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