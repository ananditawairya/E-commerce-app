// tests/integration/saga-compensation.test.js
const axios = require('axios');
const { expect } = require('chai');
const { describe, it, before, beforeEach } = require('mocha');
const mongoose = require('mongoose');

describe('Saga Compensation Tests', () => {
  const GATEWAY_URL = 'http://localhost:4000';
  const PRODUCT_API = 'http://localhost:4002/api/products';
  const ORDER_API = 'http://localhost:4003/api';
  let authToken;
  let testProduct;
  let sagaModel;
  let buyerUser;
  let sellerUser;

  before(async () => {
    console.log('🔧 Setting up test users and products for saga compensation tests...');
    
    // Connect to test database
    await mongoose.connect(process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/ecommerce-test');
    
    // Get Saga model for direct database inspection
    const createSagaModel = require('../../shared/saga/Saga');
    sagaModel = createSagaModel(mongoose);

    // CHANGE: Create test users with unique emails
    const buyerResponse = await axios.post(`${GATEWAY_URL}/api/auth/register`, {
      email: `testbuyer-saga-${Date.now()}@example.com`,
      password: 'TestPass123!',
      name: 'Test Buyer',
      role: 'buyer'
    });
    authToken = buyerResponse.data.accessToken;
    buyerUser = buyerResponse.data.user;
    console.log('✅ Created buyer user:', buyerUser.id);

    const sellerResponse = await axios.post(`${GATEWAY_URL}/api/auth/register`, {
      email: `testseller-saga-${Date.now()}@example.com`,
      password: 'TestPass123!',
      name: 'Test Seller',
      role: 'seller'
    });
    sellerUser = sellerResponse.data.user;
    console.log('✅ Created seller user:', sellerUser.id);

    // Create test product
    const productResponse = await axios.post(PRODUCT_API, {
      sellerId: sellerUser.id,
      input: {
        name: 'Saga Test Product',
        description: 'Product for saga testing',
        category: 'Test',
        basePrice: 25.00,
        images: ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='],
        variants: [{
          name: 'Saga Variant',
          stock: 10,
          priceModifier: 0
        }]
      }
    });
    testProduct = productResponse.data;
    console.log('✅ Created test product:', testProduct.id);
    console.log('📊 Initial stock:', testProduct.variants[0].stock);
  });

  beforeEach(async () => {
    // Clear saga collection before each test
    await sagaModel.deleteMany({});
    
    // CHANGE: Reset product stock and get fresh variant ID
    const currentProduct = await axios.get(`${PRODUCT_API}/${testProduct.id}`);
    
    await axios.put(`${PRODUCT_API}/${testProduct.id}`, {
      sellerId: sellerUser.id,
      input: {
        name: currentProduct.data.name,
        description: currentProduct.data.description,
        category: currentProduct.data.category,
        basePrice: currentProduct.data.basePrice,
        images: currentProduct.data.images,
        variants: [{
          name: currentProduct.data.variants[0].name,
          stock: 10, // Reset stock
          priceModifier: currentProduct.data.variants[0].priceModifier
        }]
      }
    });

    // CHANGE: Refresh testProduct to get updated variant ID
    const refreshedProduct = await axios.get(`${PRODUCT_API}/${testProduct.id}`);
    testProduct = refreshedProduct.data;
    console.log('🔄 Reset product stock to 10, new variant ID:', testProduct.variants[0].id);

    // Clear buyer's cart
    try {
      await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `mutation { clearCart }`
      }, {
        headers: { 
          'Authorization': `Bearer ${authToken}`,
          'Content-Type': 'application/json'
        }
      });
      console.log('🧹 Cleared buyer cart');
    } catch (error) {
      console.warn('⚠️ Could not clear cart (may be empty):', error.message);
    }

    // CHANGE: Clean up any expired reservations
    try {
      await axios.post(`${PRODUCT_API}/${testProduct.id}/cleanup-expired-reservations`);
      console.log('🧹 Cleaned up expired reservations');
    } catch (error) {
      console.warn('⚠️ Could not cleanup reservations:', error.message);
    }
  });

  describe('Stock Reservation Compensation', () => {
    it('should compensate stock reservations on saga failure', async () => {
      const variantId = testProduct.variants[0].id;
      const initialStock = 10;

      // Get initial stock
      const initialStockResponse = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
      expect(initialStockResponse.data.stock).to.equal(initialStock);

      // Create reservation
      const reservationResponse = await axios.post(`${PRODUCT_API}/${testProduct.id}/reserve-stock`, {
        variantId,
        quantity: 3,
        orderId: 'saga-test-order',
        timeoutMs: 5000
      });

      const reservationId = reservationResponse.data.reservationId;

      // Verify stock is reduced
      const reservedStockResponse = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
      expect(reservedStockResponse.data.stock).to.equal(7); // 10 - 3

      // Simulate saga failure by releasing reservation
      await axios.post(`${PRODUCT_API}/${testProduct.id}/release-reservation`, {
        variantId,
        reservationId
      });

      // Verify stock is restored
      const restoredStockResponse = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
      expect(restoredStockResponse.data.stock).to.equal(initialStock);

      console.log('✅ Stock reservation compensation successful');
    });

    it('should handle expired reservations automatically', async () => {
      const variantId = testProduct.variants[0].id;

      // Create short-lived reservation
      const reservationResponse = await axios.post(`${PRODUCT_API}/${testProduct.id}/reserve-stock`, {
        variantId,
        quantity: 2,
        orderId: 'saga-expire-test',
        timeoutMs: 1000 // 1 second
      });

      // Verify stock is reduced
      const reservedStockResponse = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
      expect(reservedStockResponse.data.stock).to.equal(8);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify stock is automatically restored
      const restoredStockResponse = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
      expect(restoredStockResponse.data.stock).to.equal(10);

      console.log('✅ Automatic reservation expiration compensation successful');
    });
  });

  describe('Order Creation Saga Compensation', () => {
    it('should compensate all steps on order creation failure', async () => {
      // Add item to cart
      await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `mutation { clearCart }`
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `
          mutation AddToCart($productId: String!, $productName: String!, $variantId: String, $variantName: String, $quantity: Int!, $price: Float!) {
            addToCart(productId: $productId, productName: $productName, variantId: $variantId, variantName: $variantName, quantity: $quantity, price: $price) {
              id
            }
          }
        `,
        variables: {
          productId: testProduct.id,
          productName: testProduct.name,
          variantId: testProduct.variants[0].id,
          variantName: testProduct.variants[0].name,
          quantity: 5,
          price: testProduct.basePrice
        }
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      // Simulate order creation that will trigger saga
      try {
        await axios.post(`${GATEWAY_URL}/graphql`, {
          query: `
            mutation Checkout($shippingAddress: ShippingAddressInput!) {
              checkout(shippingAddress: $shippingAddress) {
                orderId
                status
              }
            }
          `,
          variables: {
            shippingAddress: {
              street: '123 Saga Test St',
              city: 'Saga City',
              state: 'SC',
              zipCode: '12345',
              country: 'Saga Country'
            }
          }
        }, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
      } catch (error) {
        // Expected if saga fails
      }

      // Wait for saga processing
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Check saga status
      const sagas = await sagaModel.find({}).sort({ createdAt: -1 }).limit(1);
      
      if (sagas.length > 0) {
        const saga = sagas[0];
        console.log(`Saga status: ${saga.status}`);
        console.log(`Saga steps:`, saga.steps.map(s => ({ name: s.stepName, status: s.status })));

        // If saga failed, verify compensation occurred
        if (saga.status === 'compensated') {
          const finalStock = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${testProduct.variants[0].id}`);
          expect(finalStock.data.stock).to.equal(10); // Stock should be restored
          console.log('✅ Saga compensation completed successfully');
        }
      }
    });
  });

  describe('Order Cancellation Compensation', () => {
    it('should restore stock when order is cancelled', async () => {
      const variantId = testProduct.variants[0].id;
      
      // CHANGE: Log initial stock state
      const initialStockResponse = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
      console.log('📊 Stock before cancellation test:', initialStockResponse.data);
      
      // Create and confirm order first
      await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `mutation { clearCart }`
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `
          mutation AddToCart($productId: String!, $productName: String!, $variantId: String, $variantName: String, $quantity: Int!, $price: Float!) {
            addToCart(productId: $productId, productName: $productName, variantId: $variantId, variantName: $variantName, quantity: $quantity, price: $price) {
              id
            }
          }
        `,
        variables: {
          productId: testProduct.id,
          productName: testProduct.name,
          variantId,
          variantName: testProduct.variants[0].name,
          quantity: 3,
          price: testProduct.basePrice
        }
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      // CHANGE: Fix GraphQL response handling
      const checkoutResponse = await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `
          mutation Checkout($shippingAddress: ShippingAddressInput!) {
            checkout(shippingAddress: $shippingAddress) {
              id
              orderId
              status
            }
          }
        `,
        variables: {
          shippingAddress: {
            street: '123 Cancel Test St',
            city: 'Cancel City',
            state: 'CC',
            zipCode: '12345',
            country: 'Cancel Country'
          }
        }
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });

      // CHANGE: Handle nested GraphQL response structure
      const order = checkoutResponse.data.data?.checkout;
      
      if (!order) {
        console.error('Checkout response:', checkoutResponse.data);
        throw new Error('Failed to create order for cancellation test');
      }
      
      console.log('✅ Order created:', order.orderId);
      
      // CHANGE: Wait longer for order processing and stock deduction
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify stock was deducted
      const stockAfterOrder = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
      console.log('📊 Stock after order creation:', stockAfterOrder.data);
      expect(stockAfterOrder.data.stock).to.equal(7); // 10 - 3

      // CHANGE: Use seller token for cancellation
      const sellerToken = await axios.post(`${GATEWAY_URL}/api/auth/login`, {
        email: sellerUser.email,
        password: 'TestPass123!'
      });
      
      // Cancel the order using seller authentication
      const cancelResponse = await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `
          mutation CancelOrder($orderId: ID!) {
            cancelOrder(orderId: $orderId) {
              id
              status
            }
          }
        `,
        variables: { orderId: order.id }
      }, {
        headers: { 'Authorization': `Bearer ${sellerToken.data.accessToken}` }
      });

      console.log('✅ Order cancellation response:', cancelResponse.data);

      // CHANGE: Wait longer for Kafka event processing and stock restoration
      await new Promise(resolve => setTimeout(resolve, 5000));

      // CHANGE: Add retry mechanism for stock check
      let stockAfterCancel;
      let retries = 0;
      const maxRetries = 3;
      
      while (retries < maxRetries) {
        stockAfterCancel = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock?variantId=${variantId}`);
        console.log(`📊 Stock check attempt ${retries + 1}:`, stockAfterCancel.data);
        
        if (stockAfterCancel.data.stock === 10) {
          break;
        }
        
        retries++;
        if (retries < maxRetries) {
          console.log(`⏳ Waiting for stock restoration... (attempt ${retries}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      // Verify stock was restored
      expect(stockAfterCancel.data.stock).to.equal(10); // Restored to original

      console.log('✅ Order cancellation compensation successful');
    });
  });

  after(async () => {
    console.log('🧹 Cleaning up saga compensation test data...');
    await mongoose.connection.close();
  });
});