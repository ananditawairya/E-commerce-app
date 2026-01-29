// backend/order-service/src/resolvers/orderResolvers.js

const Cart = require('../models/Cart');
const Order = require('../models/Order');
const { requireBuyer, requireSeller, authenticate } = require('../middleware/auth');
const axios = require('axios');

// CHANGE: Enhanced function to get product details including variant stock
const getProductDetails = async (productId, variantId = null) => {
  try {
    const response = await axios.post(
      `${process.env.PRODUCT_SERVICE_URL}/graphql`,
      {
        query: `
          query GetProduct($id: ID!) {
            product(id: $id) {
              id
              name
              sellerId
              variants {
                id
                name
                stock
              }
            }
          }
        `,
        variables: { id: productId },
      }
    );

    const product = response.data.data.product;
    if (!product) {
      throw new Error('Product not found');
    }

    // CHANGE: If variantId is provided, find the specific variant and return its stock
    if (variantId) {
      const variant = product.variants.find(v => v.id === variantId);
      if (!variant) {
        throw new Error('Variant not found');
      }
      return {
        ...product,
        availableStock: variant.stock,
        variantName: variant.name,
      };
    }

    // CHANGE: If no variant, return total stock from all variants
    const totalStock = product.variants.reduce((sum, v) => sum + v.stock, 0);
    return {
      ...product,
      availableStock: totalStock,
    };
  } catch (error) {
    throw new Error(`Failed to fetch product details: ${error.message}`);
  }
};

// CHANGE: Add function to deduct stock from product-service
const deductStock = async (productId, variantId, quantity) => {
  try {
    const response = await axios.post(
      `${process.env.PRODUCT_SERVICE_URL}/graphql`,
      {
        query: `
          mutation DeductStock($productId: ID!, $variantId: ID!, $quantity: Int!) {
            deductStock(productId: $productId, variantId: $variantId, quantity: $quantity)
          }
        `,
        variables: { productId, variantId, quantity },
      }
    );

    if (response.data.errors) {
      throw new Error(response.data.errors[0].message);
    }

    return response.data.data.deductStock;
  } catch (error) {
    throw new Error(`Failed to deduct stock: ${error.message}`);
  }
};

const resolvers = {
  Cart: {
    totalAmount: (cart) => {
      return cart.items.reduce((total, item) => total + (item.price * item.quantity), 0);
    },
  },

  Query: {
    myCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        let cart = await Cart.findOne({ userId: user.userId });

        if (!cart) {
          cart = new Cart({ userId: user.userId, items: [] });
          await cart.save();
        }

        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    myOrders: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        const orders = await Order.find({ buyerId: user.userId })
          .sort({ createdAt: -1 });
        return orders;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    sellerOrders: async (_, __, context) => {
      try {
        const user = await requireSeller(context);
        const orders = await Order.find({ 'items.sellerId': user.userId })
          .sort({ createdAt: -1 });
        return orders;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    order: async (_, { id }, context) => {
      try {
        const user = await authenticate(context);
        const order = await Order.findById(id);

        if (!order) {
          throw new Error('Order not found');
        }

        // Check authorization
        const isBuyer = user.role === 'buyer' && order.buyerId === user.userId;
        const isSeller = user.role === 'seller' &&
          order.items.some(item => item.sellerId === user.userId);

        if (!isBuyer && !isSeller) {
          throw new Error('Unauthorized');
        }

        return order;
      } catch (error) {
        throw new Error(error.message);
      }
    },
  },

  Mutation: {
    addToCart: async (_, { productId, variantId, quantity, price }, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Validate stock availability before adding to cart
        const productDetails = await getProductDetails(productId, variantId);

        let cart = await Cart.findOne({ userId: user.userId });
        if (!cart) {
          cart = new Cart({ userId: user.userId, items: [] });
        }

        // CHANGE: Calculate total requested quantity (existing + new)
        const existingItem = cart.items.find(
          item => item.productId === productId &&
            (item.variantId || null) === (variantId || null)
        );
        const existingQuantity = existingItem ? existingItem.quantity : 0;
        const totalRequestedQuantity = existingQuantity + quantity;

        // CHANGE: Check if total requested quantity exceeds available stock
        if (totalRequestedQuantity > productDetails.availableStock) {
          throw new Error(
            `Insufficient stock. Available: ${productDetails.availableStock}, ` +
            `Already in cart: ${existingQuantity}, ` +
            `Requested: ${quantity}. ` +
            `Maximum you can add: ${productDetails.availableStock - existingQuantity}`
          );
        }

        // CHANGE: Add or update cart item only if stock is sufficient
        if (existingItem) {
          existingItem.quantity = totalRequestedQuantity;
        } else {
          cart.items.push({ productId, variantId, quantity, price });
        }

        await cart.save();
        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    updateCartItem: async (_, { productId, variantId, quantity }, context) => {
      try {
        const user = await requireBuyer(context);

        // CHANGE: Validate stock availability when updating quantity
        if (quantity > 0) {
          const productDetails = await getProductDetails(productId, variantId);

          if (quantity > productDetails.availableStock) {
            throw new Error(
              `Insufficient stock. Available: ${productDetails.availableStock}, ` +
              `Requested: ${quantity}`
            );
          }
        }

        const cart = await Cart.findOne({ userId: user.userId });

        if (!cart) {
          throw new Error('Cart not found');
        }

        const itemIndex = cart.items.findIndex(
          item => item.productId === productId &&
            (item.variantId || null) === (variantId || null)
        );

        if (itemIndex === -1) {
          throw new Error('Item not found in cart');
        }

        if (quantity <= 0) {
          cart.items.splice(itemIndex, 1);
        } else {
          cart.items[itemIndex].quantity = quantity;
        }

        await cart.save();
        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    removeFromCart: async (_, { productId, variantId }, context) => {
      try {
        const user = await requireBuyer(context);
        const cart = await Cart.findOne({ userId: user.userId });

        if (!cart) {
          throw new Error('Cart not found');
        }

        cart.items = cart.items.filter(
          item => !(item.productId === productId &&
            (item.variantId || null) === (variantId || null))
        );

        await cart.save();
        return cart;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    clearCart: async (_, __, context) => {
      try {
        const user = await requireBuyer(context);
        await Cart.findOneAndUpdate(
          { userId: user.userId },
          { items: [] }
        );
        return true;
      } catch (error) {
        return false;
      }
    },

    checkout: async (_, { shippingAddress }, context) => {
      try {
        const user = await requireBuyer(context);
        const cart = await Cart.findOne({ userId: user.userId });

        if (!cart || cart.items.length === 0) {
          throw new Error('Cart is empty');
        }

        // CHANGE: Validate stock availability for all items before checkout
        const stockValidationPromises = cart.items.map(async (item) => {
          const productDetails = await getProductDetails(item.productId, item.variantId);

          if (item.quantity > productDetails.availableStock) {
            throw new Error(
              `Insufficient stock for ${productDetails.name}${item.variantId ? ` (${productDetails.variantName})` : ''}. ` +
              `Available: ${productDetails.availableStock}, Requested: ${item.quantity}`
            );
          }

          return productDetails;
        });

        // CHANGE: Wait for all stock validations to complete
        const productDetailsArray = await Promise.all(stockValidationPromises);

        // Fetch product details for each item
        const orderItems = await Promise.all(
          cart.items.map(async (item, index) => {
            const product = productDetailsArray[index];
            return {
              productId: item.productId,
              productName: product.name,
              variantId: item.variantId,
              variantName: item.variantId ? product.variantName : null,
              quantity: item.quantity,
              price: item.price,
              sellerId: product.sellerId,
            };
          })
        );

        const totalAmount = orderItems.reduce(
          (total, item) => total + (item.price * item.quantity),
          0
        );

        const order = new Order({
          orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          buyerId: user.userId,
          items: orderItems,
          totalAmount,
          shippingAddress,
          status: 'pending',
          paymentMethod: 'mock',
        });

        await order.save();

        // CHANGE: Deduct stock from product-service after successful order creation
        console.log('📦 Deducting stock for order items...');
        const stockDeductionPromises = cart.items.map(async (item) => {
          if (!item.variantId) {
            throw new Error(`Variant ID is required for stock deduction`);
          }
          
          try {
            await deductStock(item.productId, item.variantId, item.quantity);
            console.log(`✅ Stock deducted: Product ${item.productId}, Variant ${item.variantId}, Quantity ${item.quantity}`);
          } catch (error) {
            console.error(`❌ Failed to deduct stock for product ${item.productId}:`, error.message);
            throw error;
          }
        });

        // CHANGE: Wait for all stock deductions to complete
        await Promise.all(stockDeductionPromises);
        console.log('✅ All stock deductions completed successfully');

        // Clear cart
        cart.items = [];
        await cart.save();

        return order;
      } catch (error) {
        throw new Error(error.message);
      }
    },

    updateOrderStatus: async (_, { orderId, status }, context) => {
      try {
        const user = await requireSeller(context);
        const order = await Order.findById(orderId);

        if (!order) {
          throw new Error('Order not found');
        }

        // Check if seller has items in this order
        const hasItems = order.items.some(item => item.sellerId === user.userId);
        if (!hasItems) {
          throw new Error('Unauthorized');
        }

        order.status = status;
        await order.save();

        return order;
      } catch (error) {
        throw new Error(error.message);
      }
    },
  },
};

module.exports = resolvers;