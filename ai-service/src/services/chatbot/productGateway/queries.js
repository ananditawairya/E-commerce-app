const RETRIEVE_PRODUCTS_QUERY = `
  query RetrieveProducts(
    $search: String
    $category: String
    $minPrice: Float
    $maxPrice: Float
    $inStockOnly: Boolean
    $sortBy: ProductSortBy
    $limit: Int
    $offset: Int
  ) {
    products(
      search: $search
      category: $category
      minPrice: $minPrice
      maxPrice: $maxPrice
      inStockOnly: $inStockOnly
      sortBy: $sortBy
      limit: $limit
      offset: $offset
    ) {
      id
      name
      description
      category
      basePrice
      images
      createdAt
      variants {
        id
        name
        priceModifier
        effectivePrice
        stock
      }
    }
  }
`;

const RETRIEVE_PRODUCTS_LEGACY_QUERY = `
  query RetrieveProductsLegacy(
    $search: String
    $category: String
    $limit: Int
    $offset: Int
  ) {
    products(
      search: $search
      category: $category
      limit: $limit
      offset: $offset
    ) {
      id
      name
      description
      category
      basePrice
      images
      createdAt
      variants {
        id
        name
        priceModifier
        effectivePrice
        stock
      }
    }
  }
`;

const PRODUCT_BY_ID_QUERY = `
  query ProductById($id: ID!) {
    product(id: $id) {
      id
      name
      description
      category
      basePrice
      images
      createdAt
      variants {
        id
        name
        priceModifier
        effectivePrice
        stock
      }
    }
  }
`;

const GET_CATEGORIES_QUERY = `
  query GetCategories {
    categories
  }
`;

module.exports = {
  GET_CATEGORIES_QUERY,
  PRODUCT_BY_ID_QUERY,
  RETRIEVE_PRODUCTS_LEGACY_QUERY,
  RETRIEVE_PRODUCTS_QUERY,
};
