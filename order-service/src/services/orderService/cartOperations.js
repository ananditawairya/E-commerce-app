/**
 * Ensures a cart exists for user and returns it.
 * @param {{Cart: object}} deps Service dependencies.
 * @param {string} userId Buyer user id.
 * @return {Promise<object>} Cart document.
 */
async function getCart(deps, userId) {
  const { Cart } = deps;
  let cart = await Cart.findOne({ userId });

  if (!cart) {
    cart = new Cart({ userId, items: [] });
    await cart.save();
  }

  return cart;
}

/**
 * Adds one item to cart or increments existing quantity.
 * @param {{Cart: object}} deps Service dependencies.
 * @param {string} userId Buyer user id.
 * @param {{
 *   productId: string,
 *   productName: string,
 *   variantId?: string,
 *   variantName?: string,
 *   quantity: number,
 *   price: number,
 * }} input Item payload.
 * @return {Promise<object>} Updated cart.
 */
async function addToCart(deps, userId, input) {
  const { Cart } = deps;
  const {
    productId,
    productName,
    variantId,
    variantName,
    quantity,
    price,
  } = input;

  let cart = await Cart.findOne({ userId });

  if (!cart) {
    cart = new Cart({ userId, items: [] });
  }

  const existingItemIndex = cart.items.findIndex(
    (item) => item.productId === productId
      && (item.variantId || null) === (variantId || null)
  );

  if (existingItemIndex > -1) {
    cart.items[existingItemIndex].quantity += quantity;
    cart.items[existingItemIndex].productName = productName;
    if (variantName) {
      cart.items[existingItemIndex].variantName = variantName;
    }
  } else {
    cart.items.push({
      productId,
      productName,
      variantId,
      variantName,
      quantity,
      price,
    });
  }

  await cart.save();
  return cart;
}

/**
 * Updates existing cart item quantity.
 * @param {{Cart: object}} deps Service dependencies.
 * @param {string} userId Buyer user id.
 * @param {{productId: string, variantId?: string, quantity: number}} input Update payload.
 * @return {Promise<object>} Updated cart.
 */
async function updateCartItem(deps, userId, input) {
  const { Cart } = deps;
  const { productId, variantId, quantity } = input;

  const cart = await Cart.findOne({ userId });

  if (!cart) {
    const error = new Error('Cart not found');
    error.code = 'CART_NOT_FOUND';
    throw error;
  }

  const itemIndex = cart.items.findIndex(
    (item) => item.productId === productId
      && (item.variantId || null) === (variantId || null)
  );

  if (itemIndex === -1) {
    const error = new Error('Item not found in cart');
    error.code = 'ITEM_NOT_FOUND';
    throw error;
  }

  if (quantity <= 0) {
    cart.items.splice(itemIndex, 1);
  } else {
    cart.items[itemIndex].quantity = quantity;
  }

  await cart.save();
  return cart;
}

/**
 * Removes one item from buyer cart.
 * @param {{Cart: object}} deps Service dependencies.
 * @param {string} userId Buyer user id.
 * @param {{productId: string, variantId?: string}} input Remove payload.
 * @return {Promise<object>} Updated cart.
 */
async function removeFromCart(deps, userId, input) {
  const { Cart } = deps;
  const { productId, variantId } = input;

  const cart = await Cart.findOne({ userId });

  if (!cart) {
    const error = new Error('Cart not found');
    error.code = 'CART_NOT_FOUND';
    throw error;
  }

  cart.items = cart.items.filter(
    (item) => !(item.productId === productId
      && (item.variantId || null) === (variantId || null))
  );

  await cart.save();
  return cart;
}

/**
 * Clears all cart items for user.
 * @param {{Cart: object}} deps Service dependencies.
 * @param {string} userId Buyer user id.
 * @return {Promise<boolean>} True when cleared.
 */
async function clearCart(deps, userId) {
  const { Cart } = deps;
  await Cart.findOneAndUpdate(
    { userId },
    { items: [] }
  );
  return true;
}

module.exports = {
  addToCart,
  clearCart,
  getCart,
  removeFromCart,
  updateCartItem,
};
