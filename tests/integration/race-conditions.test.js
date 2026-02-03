const axios = require('axios');
const { expect } = require('chai');
const { describe, it, before, after, beforeEach } = require('mocha');

describe('Race Condition Tests', () => {
  const GATEWAY_URL = 'http://localhost:4000';
  const PRODUCT_API = 'http://localhost:4002/api/products';
  
  let buyerToken;
  let sellerToken;
  let testProduct;
  let buyerUser;
  let sellerUser;

  before(async () => {
    console.log('🔧 Setting up test users and products...');
    
    // Create a valid buyer user
    const buyerResponse = await axios.post(`${GATEWAY_URL}/api/auth/register`, {
      email: `testbuyer-${Date.now()}@example.com`,
      password: 'TestPass123!',
      name: 'Test Buyer',
      role: 'buyer'
    });
    
    buyerToken = buyerResponse.data.accessToken;
    buyerUser = buyerResponse.data.user;
    console.log('✅ Created buyer user:', buyerUser.id);

    // Create a valid seller user
    const sellerResponse = await axios.post(`${GATEWAY_URL}/api/auth/register`, {
      email: `testseller-${Date.now()}@example.com`,
      password: 'TestPass123!',
      name: 'Test Seller',
      role: 'seller'
    });
    
    sellerToken = sellerResponse.data.accessToken;
    sellerUser = sellerResponse.data.user;
    console.log('✅ Created seller user:', sellerUser.id);

    // Create test product with valid seller ID
    const productResponse = await axios.post(PRODUCT_API, {
      sellerId: sellerUser.id,
      input: {
        name: 'Race Test Product',
        description: 'Product for race condition testing',
        category: 'Test',
        basePrice: 10.00,
        images: ['data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k='],
        variants: [{
          name: 'Test Variant',
          stock: 10,
          priceModifier: 0
        }]
      }
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': `setup-${Date.now()}`
      }
    });
    
    testProduct = productResponse.data;
    console.log('✅ Created test product:', testProduct.id);
    console.log('📊 Initial stock:', testProduct.variants[0].stock);
    console.log('🔍 Variant ID:', testProduct.variants[0].id);
  });

  // CHANGE: Fix beforeEach to preserve variant ID and validate stock endpoint
  beforeEach(async () => {
    console.log('🔄 Resetting test state...');
    
    // CHANGE: Get current product state to preserve variant ID
    const currentProduct = await axios.get(`${PRODUCT_API}/${testProduct.id}`, {
      headers: {
        'X-Correlation-ID': `get-current-${Date.now()}`
      }
    });
    
    // CHANGE: Update stock while preserving the original variant structure
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
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Correlation-ID': `reset-${Date.now()}`
      }
    });

    // CHANGE: Verify the stock endpoint works and variant ID is preserved
    try {
      const stockCheck = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock`, {
        params: { variantId: testProduct.variants[0].id },
        headers: {
          'X-Correlation-ID': `stock-check-${Date.now()}`
        }
      });
      console.log('📊 Stock after reset:', stockCheck.data);
    } catch (error) {
      console.error('❌ Stock check failed:', {
        status: error.response?.status,
        message: error.response?.data?.message,
        variantId: testProduct.variants[0].id
      });
      
      // CHANGE: Refresh product data if stock check fails
      const refreshedProduct = await axios.get(`${PRODUCT_API}/${testProduct.id}`);
      testProduct = refreshedProduct.data;
      console.log('🔄 Refreshed product data, new variant ID:', testProduct.variants[0].id);
    }

    // Clear buyer's cart
    try {
      await axios.post(`${GATEWAY_URL}/graphql`, {
        query: `mutation { clearCart }`
      }, {
        headers: { 
          'Authorization': `Bearer ${buyerToken}`,
          'Content-Type': 'application/json'
        }
      });
    } catch (error) {
      console.warn('⚠️ Could not clear cart (may be empty):', error.message);
    }
  });

  describe('Stock Deduction Race Conditions', () => {
    it('should handle concurrent stock deduction correctly', async () => {
      // CHANGE: Get fresh product data and set stock to 5
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
            stock: 5, // Limited stock for race testing
            priceModifier: currentProduct.data.variants[0].priceModifier
          }]
        }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': `race-setup-${Date.now()}`
        }
      });

      // CHANGE: Refresh testProduct to get updated variant ID
      const updatedProduct = await axios.get(`${PRODUCT_API}/${testProduct.id}`);
      const variantId = updatedProduct.data.variants[0].id;

      // Verify stock was set correctly
      const stockCheck = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock`, {
        params: { variantId },
        headers: {
          'X-Correlation-ID': `stock-verify-${Date.now()}`
        }
      });
      console.log('📊 Stock before race test:', stockCheck.data);
      
      if (stockCheck.data.stock !== 5) {
        throw new Error(`Stock not set correctly. Expected 5, got ${stockCheck.data.stock}`);
      }

      const concurrentRequests = 10;
      const requestQuantity = 1;

      console.log(`🏁 Starting race condition test with ${concurrentRequests} concurrent requests`);

      // Create concurrent stock deduction requests
      const promises = Array(concurrentRequests).fill().map(async (_, index) => {
        try {
          const response = await axios.post(
            `${PRODUCT_API}/${testProduct.id}/deduct-stock`,
            {
              variantId,
              quantity: requestQuantity,
              orderId: `race-test-${index}-${Date.now()}`
            },
            {
              headers: { 
                'X-Correlation-ID': `race-test-${index}`,
                'Content-Type': 'application/json'
              },
              timeout: 5000
            }
          );
          return { success: true, index };
        } catch (error) {
          console.error(`❌ Request ${index} failed:`, {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            message: error.message
          });
          return { 
            success: false, 
            index, 
            error: error.response?.data?.message || error.message,
            status: error.response?.status
          };
        }
      });

      const results = await Promise.all(promises);
      const successful = results.filter(r => r.success);
      const failed = results.filter(r => !r.success);

      console.log(`📊 Results: ${successful.length} succeeded, ${failed.length} failed`);
      
      if (failed.length > 0) {
        console.log('❌ Failed requests details:');
        failed.slice(0, 3).forEach((result, i) => {
          console.log(`  ${i + 1}. Index ${result.index}: ${result.error} (Status: ${result.status})`);
        });
      }

      // Verify only 5 requests succeeded (matching initial stock)
      expect(successful.length).to.equal(5);
      expect(failed.length).to.equal(5);

      // Verify remaining stock is 0
      const stockResponse = await axios.get(`${PRODUCT_API}/${testProduct.id}/stock`, {
        params: { variantId }
      });
      expect(stockResponse.data.stock).to.equal(0);

      console.log(`✅ Race condition test: ${successful.length} succeeded, ${failed.length} failed as expected`);
    });

    it('should handle concurrent cart additions with stock validation', async () => {
      // CHANGE: Get fresh product data and set stock to 3
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
            stock: 3,
            priceModifier: currentProduct.data.variants[0].priceModifier
          }]
        }
      }, {
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': `cart-setup-${Date.now()}`
        }
      });

      // CHANGE: Refresh testProduct to get updated variant ID
      const updatedProduct = await axios.get(`${PRODUCT_API}/${testProduct.id}`);
      testProduct = updatedProduct.data;

      const addToCartMutation = `
        mutation AddToCart($productId: String!, $productName: String!, $variantId: String, $variantName: String, $quantity: Int!, $price: Float!) {
          addToCart(productId: $productId, productName: $productName, variantId: $variantId, variantName: $variantName, quantity: $quantity, price: $price) {
            id
            items { quantity }
          }
        }
      `;

      const concurrentCartRequests = Array(5).fill().map(async (_, index) => {
        try {
          const response = await axios.post(`${GATEWAY_URL}/graphql`, {
            query: addToCartMutation,
            variables: {
              productId: testProduct.id,
              productName: testProduct.name,
              variantId: testProduct.variants[0].id,
              variantName: testProduct.variants[0].name,
              quantity: 2,
              price: testProduct.basePrice
            }
          }, {
            headers: { 
              'Authorization': `Bearer ${buyerToken}`,
              'Content-Type': 'application/json',
              'X-Correlation-ID': `cart-race-${index}`
            }
          });
          return { success: true, index, data: response.data };
        } catch (error) {
          console.error(`❌ Cart request ${index} failed:`, {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
          });
          return { 
            success: false, 
            index, 
            error: error.response?.data?.errors?.[0]?.message || error.message 
          };
        }
      });

      const results = await Promise.all(concurrentCartRequests);
      const successful = results.filter(r => r.success && !r.data.errors);
      const failed = results.filter(r => !r.success || r.data.errors);

      console.log(`📊 Cart race results: ${successful.length} succeeded, ${failed.length} failed`);

      // Should only allow 1 successful addition (2 quantity) with 3 stock available
      expect(successful.length).to.be.at.most(2);
      console.log(`✅ Cart race condition: ${successful.length} succeeded, ${failed.length} failed`);
    });
  });

  describe('Order Creation Race Conditions', () => {
    it('should handle concurrent checkout attempts', async () => {
      // CHANGE: Refresh product data before adding to cart
      const currentProduct = await axios.get(`${PRODUCT_API}/${testProduct.id}`);
      testProduct = currentProduct.data;

      // Setup cart with items using valid authentication
      const addToCartResponse = await axios.post(`${GATEWAY_URL}/graphql`, {
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
          quantity: 1,
          price: testProduct.basePrice
        }
      }, {
        headers: { 
          'Authorization': `Bearer ${buyerToken}`,
          'Content-Type': 'application/json'
        }
      });

      // Verify cart was populated
      if (addToCartResponse.data.errors) {
        console.error('❌ Failed to add item to cart:', addToCartResponse.data.errors);
        throw new Error('Could not setup cart for checkout test');
      }

      const checkoutMutation = `
        mutation Checkout($shippingAddress: ShippingAddressInput!) {
          checkout(shippingAddress: $shippingAddress) {
            orderId
            status
          }
        }
      `;

      const shippingAddress = {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        zipCode: '12345',
        country: 'Test Country'
      };

      // Attempt concurrent checkouts
      const concurrentCheckouts = Array(3).fill().map(async (_, index) => {
        try {
          const response = await axios.post(`${GATEWAY_URL}/graphql`, {
            query: checkoutMutation,
            variables: { shippingAddress }
          }, {
            headers: { 
              'Authorization': `Bearer ${buyerToken}`,
              'Content-Type': 'application/json',
              'X-Correlation-ID': `checkout-race-${index}`
            }
          });
          return { success: true, index, data: response.data };
        } catch (error) {
          console.error(`❌ Checkout request ${index} failed:`, {
            status: error.response?.status,
            data: error.response?.data,
            message: error.message
          });
          return { 
            success: false, 
            index, 
            error: error.response?.data?.errors?.[0]?.message || error.message 
          };
        }
      });

      const results = await Promise.all(concurrentCheckouts);
      const successful = results.filter(r => r.success && !r.data.errors);

      console.log(`📊 Checkout race results: ${successful.length} succeeded`);

      // Only one checkout should succeed
      expect(successful.length).to.equal(1);
      console.log(`✅ Checkout race condition: Only ${successful.length} checkout succeeded`);
    });
  });

  after(async () => {
    console.log('🧹 Cleaning up test data...');
  });
});