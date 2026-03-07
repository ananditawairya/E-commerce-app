const { Kind, getOperationAST, parse } = require('graphql');

const publicRootFieldsByOperation = {
  query: new Set([
    'products',
    'product',
    'categories',
    'searchSuggestions',
    'getTrendingProducts',
    'getSimilarProducts',
    '__schema',
    '__type',
  ]),
  mutation: new Set(['login', 'register', 'sendChatMessage']),
};

/**
 * Builds a fragment definition map for quick lookup.
 * @param {import('graphql').DocumentNode} documentNode Parsed GraphQL document.
 * @return {Map<string, import('graphql').FragmentDefinitionNode>} Fragment map.
 */
function buildFragmentMap(documentNode) {
  const fragments = new Map();

  for (const definition of documentNode.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) {
      fragments.set(definition.name.value, definition);
    }
  }

  return fragments;
}

/**
 * Collects root field names for an operation selection set.
 * @param {import('graphql').SelectionSetNode} selectionSet Root selection set.
 * @param {Map<string, import('graphql').FragmentDefinitionNode>} fragmentMap Fragment definitions.
 * @param {Set<string>} [visitedFragments] Cycle guard.
 * @return {Set<string>} Root field names.
 */
function collectRootFieldNames(selectionSet, fragmentMap, visitedFragments = new Set()) {
  const fieldNames = new Set();

  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      fieldNames.add(selection.name.value);
      continue;
    }

    if (selection.kind === Kind.INLINE_FRAGMENT) {
      for (const fieldName of collectRootFieldNames(
        selection.selectionSet,
        fragmentMap,
        visitedFragments
      )) {
        fieldNames.add(fieldName);
      }
      continue;
    }

    if (selection.kind === Kind.FRAGMENT_SPREAD) {
      const fragmentName = selection.name.value;
      if (visitedFragments.has(fragmentName)) {
        continue;
      }

      const fragmentDefinition = fragmentMap.get(fragmentName);
      if (!fragmentDefinition) {
        continue;
      }

      visitedFragments.add(fragmentName);
      for (const fieldName of collectRootFieldNames(
        fragmentDefinition.selectionSet,
        fragmentMap,
        visitedFragments
      )) {
        fieldNames.add(fieldName);
      }
    }
  }

  return fieldNames;
}

/**
 * Checks whether an operation can bypass authentication.
 * @param {string|undefined} operationName GraphQL operation name.
 * @param {string} query GraphQL query document.
 * @return {boolean} True when operation is public.
 */
function isPublicOperation(operationName, query) {
  if (typeof query !== 'string' || !query.trim()) {
    return false;
  }

  let documentNode;
  try {
    documentNode = parse(query, { noLocation: true });
  } catch (error) {
    return false;
  }

  const operationNode = getOperationAST(documentNode, operationName || null);
  if (!operationNode) {
    return false;
  }

  const allowedRootFields = publicRootFieldsByOperation[operationNode.operation];
  if (!allowedRootFields) {
    return false;
  }

  const fragmentMap = buildFragmentMap(documentNode);
  const rootFieldNames = collectRootFieldNames(operationNode.selectionSet, fragmentMap);

  if (rootFieldNames.size === 0) {
    return false;
  }

  for (const fieldName of rootFieldNames) {
    if (!allowedRootFields.has(fieldName)) {
      return false;
    }
  }

  return true;
}

/**
 * Creates authentication middleware that validates user token via auth service.
 * @param {{
 *   authServiceUrl: string,
 *   fetch: Function,
 * }} deps Dependencies.
 * @return {import('express').RequestHandler} Express auth middleware.
 */
function createAuthenticateToken({ authServiceUrl, fetch }) {
  return async (req, res, next) => {
    const operationName = req.body?.operationName;
    const query = req.body?.query || '';

    if (isPublicOperation(operationName, query)) {
      console.log(`⚠️  Skipping auth for public operation: ${operationName || 'unnamed'}`);
      return next();
    }

    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      console.error('❌ No token provided for protected operation:', operationName);
      return res.status(401).json({ error: 'Access token required' });
    }

    try {
      const response = await fetch(`${authServiceUrl}/api/users/verify-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': req.correlationId,
        },
        body: JSON.stringify({ token }),
        timeout: 5000,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('❌ Token verification failed:', {
          status: response.status,
          error: errorData,
          operation: operationName,
        });
        return res.status(403).json({ error: 'Invalid or expired token' });
      }

      const result = await response.json();
      if (!result.valid) {
        console.error('❌ Token marked as invalid:', { operation: operationName });
        return res.status(403).json({ error: 'Invalid token' });
      }

      req.user = result;
      console.log(`✅ Auth successful for ${operationName}:`, {
        userId: result.userId,
        role: result.role,
      });
      return next();
    } catch (error) {
      console.error('❌ Authentication error:', {
        message: error.message,
        operation: operationName,
        code: error.code,
      });

      if (error.code === 'ECONNREFUSED') {
        return res.status(503).json({ error: 'Authentication service unavailable' });
      }

      return res.status(500).json({ error: 'Authentication failed' });
    }
  };
}

module.exports = {
  createAuthenticateToken,
  isPublicOperation,
};
